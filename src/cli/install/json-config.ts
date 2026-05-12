// Safe atomic mutation of large JSON config files (~/.claude.json especially —
// it holds the user's full session history and project state alongside MCP
// config, so corrupting it is high blast-radius).
//
// Strategy:
//   1. Read + parse current JSON (return empty object if file missing).
//   2. Apply mutation in memory.
//   3. Write to temp file in the same directory.
//   4. On first touch this session, copy original to .folio-backup-<ts>.
//   5. Atomically rename temp → target (same-fs guarantee).

import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const backedUpThisSession = new Set<string>();

export function readJsonConfig<T = Record<string, any>>(file: string): T {
  if (!existsSync(file)) return {} as T;
  const raw = readFileSync(file, "utf-8");
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch (e: any) {
    throw new Error(`Could not parse ${file}: ${e?.message ?? e}`);
  }
}

export function writeJsonConfigAtomic(file: string, data: unknown): { backupPath: string | null } {
  const dir = dirname(file);
  let backupPath: string | null = null;
  if (existsSync(file) && !backedUpThisSession.has(file)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = join(dir, `.${basename(file)}.folio-backup-${ts}`);
    copyFileSync(file, backupPath);
    backedUpThisSession.add(file);
  }
  const tmp = join(dir, `.${basename(file)}.folio-tmp-${process.pid}`);
  const json = JSON.stringify(data, null, 2);
  // Sanity check: round-trip parse before writing so we never persist garbage.
  JSON.parse(json);
  writeFileSync(tmp, json);
  renameSync(tmp, file);
  return { backupPath };
}

/**
 * Apply `mutator` to the file's parsed contents and write atomically.
 * Returns the value of `extract` over the mutated config, or undefined.
 */
export function mutateJsonConfig<T = Record<string, any>, R = void>(
  file: string,
  mutator: (cfg: T) => void,
  extract?: (cfg: T) => R,
): { backupPath: string | null; result: R | undefined } {
  const cfg = readJsonConfig<T>(file);
  mutator(cfg);
  const { backupPath } = writeJsonConfigAtomic(file, cfg);
  return { backupPath, result: extract ? extract(cfg) : undefined };
}

/** Used by `folio doctor` so it can print the config-mtime hint. */
export function jsonConfigMtime(file: string): Date | null {
  if (!existsSync(file)) return null;
  try {
    return statSync(file).mtime;
  } catch {
    return null;
  }
}

/** Reset the per-process backup memo. Tests use this to avoid cross-test leak. */
export function _resetBackupMemoForTests(): void {
  backedUpThisSession.clear();
}
