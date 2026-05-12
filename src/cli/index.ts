import { init } from "./commands/init";
import { newNote } from "./commands/new";
import { list } from "./commands/list";
import { search } from "./commands/search";
import { statsCmd } from "./commands/stats";
import { serve } from "./commands/serve";
import { finalizeCmd } from "./commands/finalize";
import { openCmd } from "./commands/open";
import { cleanupCmd } from "./commands/cleanup";
import { reindexCmd } from "./commands/reindex";
import { exportCmd } from "./commands/export";
import { updateCmd } from "./commands/update";
import { versionCmd } from "./commands/version";
import { installCmd } from "./commands/install";
import { uninstallCmd } from "./commands/uninstall";
import { doctorCmd } from "./commands/doctor";
import { c, out } from "./io";

interface ParsedArgs {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const cmd = args[0] ?? "help";
  const rest = args.slice(1);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

function help(): number {
  out(c.bold("Folio — Visual communication for AI ↔ humans"));
  out("");
  out("Usage: " + c.cyan("folio <command> [args]"));
  out("");
  out(c.bold("Commands:"));
  out(`  ${c.cyan("init")}              Initialize ~/Folio (create dirs, config, db)`);
  out(`  ${c.cyan("new")}               Create a new note (--title, --html, --type, --thread, --theme)`);
  out(`  ${c.cyan("list")}              List recent notes (--type, --thread, --final, --limit, --json)`);
  out(`  ${c.cyan("search <query>")}    Full-text search (--type, --limit, --json)`);
  out(`  ${c.cyan("finalize <id>")}     Mark note as final (skip auto-cleanup)`);
  out(`  ${c.cyan("open <id|slug>")}    Open note in default browser (via viewer)`);
  out(`  ${c.cyan("stats")}             Show counts + analytics`);
  out(`  ${c.cyan("cleanup")}           Auto-trash non-final notes past expiry (--dry-run, --grace-days N)`);
  out(`  ${c.cyan("reindex")}           Rebuild FTS index from HTML files on disk (after tokenizer changes)`);
  out(`  ${c.cyan("export <id>")}       Export note as HTML (--standalone inlines theme CSS, --out path to file or stdout)`);
  out(`  ${c.cyan("serve")}             Start local viewer on http://127.0.0.1:4810`);
  out(`  ${c.cyan("update")}            Check + install latest release from GitHub (--check, --force, --pre, --json)`);
  out(`  ${c.cyan("install")}           Wire Folio into an agent client (--target claude-code | openclaw | all, --skill-only, --mcp-only, --scope, --dry-run, --yes)`);
  out(`  ${c.cyan("uninstall")}         Remove Folio wiring (--target claude-code | openclaw | all, --skill-only, --mcp-only, --scope, --all-scopes, --dry-run, --yes)`);
  out(`  ${c.cyan("doctor")}            Show install state for every detected target + warnings (--json)`);
  out(`  ${c.cyan("version")}           Print Folio version + system info (--json) — also: --version, -v`);
  out(`  ${c.cyan("help")}              This help`);
  out("");
  out(c.dim("Run `folio init` first if you haven't yet."));
  return 0;
}

function flagBool(v: string | boolean | undefined, dflt = false): boolean {
  if (v === undefined) return dflt;
  if (typeof v === "boolean") return v;
  return v === "1" || v.toLowerCase() === "true" || v === "";
}

function flagStr(v: string | boolean | undefined): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

function flagInt(v: string | boolean | undefined): number | undefined {
  const s = flagStr(v);
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function main(argv = process.argv): Promise<number> {
  const { cmd, positional, flags } = parseArgs(argv);
  try {
    switch (cmd) {
      case "init":
        return await init();
      case "new": {
        const htmlFile = (() => {
          const v = flagStr(flags.html);
          if (v && v.startsWith("@")) return v.slice(1);
          return undefined;
        })();
        return await newNote({
          title: flagStr(flags.title) ?? positional[0] ?? "",
          type: flagStr(flags.type),
          htmlFile,
          htmlInline: !htmlFile ? flagStr(flags["html-inline"]) : undefined,
          thread: flagStr(flags.thread),
          theme: flagStr(flags.theme),
          themeProfile: flagStr(flags["theme-profile"]) as any,
          tags: flagStr(flags.tags)?.split(",").map((s) => s.trim()).filter(Boolean),
          isFinal: flagBool(flags.final),
          jsonOut: flagBool(flags.json),
        });
      }
      case "list":
        return await list({
          type: flagStr(flags.type),
          thread: flagStr(flags.thread),
          isFinal: flags.final !== undefined ? flagBool(flags.final) : undefined,
          limit: flagInt(flags.limit),
          jsonOut: flagBool(flags.json),
        });
      case "search":
        return await search({
          query: positional[0] ?? flagStr(flags.q) ?? "",
          type: flagStr(flags.type),
          limit: flagInt(flags.limit),
          jsonOut: flagBool(flags.json),
        });
      case "finalize":
        return await finalizeCmd(positional[0] ?? "");
      case "open":
        return await openCmd(positional[0] ?? "");
      case "stats":
        return await statsCmd({ jsonOut: flagBool(flags.json) });
      case "cleanup":
        return await cleanupCmd({
          dryRun: flagBool(flags["dry-run"]),
          graceDays: flagInt(flags["grace-days"]),
          jsonOut: flagBool(flags.json),
        });
      case "reindex":
        return await reindexCmd();
      case "export":
        return await exportCmd({
          idOrSlug: positional[0] ?? "",
          standalone: flagBool(flags.standalone),
          out: flagStr(flags.out),
        });
      case "serve":
        return await serve();
      case "version":
      case "--version":
      case "-v":
        return await versionCmd({ jsonOut: flagBool(flags.json) });
      case "update":
        return await updateCmd({
          check: flagBool(flags.check),
          force: flagBool(flags.force),
          prerelease: flagBool(flags.pre) || flagBool(flags.prerelease),
          jsonOut: flagBool(flags.json),
        });
      case "install":
        return await installCmd({
          target: flagStr(flags.target),
          skillOnly: flagBool(flags["skill-only"]),
          mcpOnly: flagBool(flags["mcp-only"]),
          scope: flagStr(flags.scope),
          dryRun: flagBool(flags["dry-run"]),
          yes: flagBool(flags.yes) || flagBool(flags.y),
          jsonOut: flagBool(flags.json),
        });
      case "uninstall":
        return await uninstallCmd({
          target: flagStr(flags.target),
          skillOnly: flagBool(flags["skill-only"]),
          mcpOnly: flagBool(flags["mcp-only"]),
          scope: flagStr(flags.scope),
          allScopes: flagBool(flags["all-scopes"]),
          dryRun: flagBool(flags["dry-run"]),
          yes: flagBool(flags.yes) || flagBool(flags.y),
          jsonOut: flagBool(flags.json),
        });
      case "doctor":
        return await doctorCmd({ jsonOut: flagBool(flags.json) });
      case "help":
      case undefined:
      case "":
        return help();
      default:
        process.stderr.write(c.err(`Unknown command: ${cmd}\n`));
        help();
        return 1;
    }
  } catch (e: any) {
    process.stderr.write(c.err(`✗ ${e?.message ?? e}\n`));
    if (process.env.FOLIO_DEBUG) console.error(e);
    return 1;
  }
}
