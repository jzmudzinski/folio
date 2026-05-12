// Minimal interactive prompt helpers built on node:readline. We avoid pulling
// in a prompt library because:
//   - the only prompts we have are y/n + a single string (MCP scope path);
//   - it has to work in a Bun-compiled binary without npm at runtime.

import { createInterface } from "node:readline/promises";

export async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
    const ans = (await rl.question(question + suffix)).trim().toLowerCase();
    if (!ans) return defaultYes;
    return ans === "y" || ans === "yes" || ans === "t" || ans === "tak";
  } finally {
    rl.close();
  }
}

export async function askString(question: string, defaultValue?: string): Promise<string> {
  if (!process.stdin.isTTY) return defaultValue ?? "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}] ` : " ";
    const ans = (await rl.question(question + suffix)).trim();
    if (!ans) return defaultValue ?? "";
    return ans;
  } finally {
    rl.close();
  }
}
