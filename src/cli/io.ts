const CSI = "\x1b[";
const C = {
  reset: `${CSI}0m`,
  dim: `${CSI}2m`,
  bold: `${CSI}1m`,
  red: `${CSI}31m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  blue: `${CSI}34m`,
  magenta: `${CSI}35m`,
  cyan: `${CSI}36m`,
};

const isTTY = process.stdout.isTTY;

function paint(s: string, color: keyof typeof C): string {
  if (!isTTY) return s;
  return `${C[color]}${s}${C.reset}`;
}

export const c = {
  ok: (s: string) => paint(s, "green"),
  warn: (s: string) => paint(s, "yellow"),
  err: (s: string) => paint(s, "red"),
  info: (s: string) => paint(s, "blue"),
  dim: (s: string) => paint(s, "dim"),
  bold: (s: string) => (isTTY ? `${C.bold}${s}${C.reset}` : s),
  cyan: (s: string) => paint(s, "cyan"),
  magenta: (s: string) => paint(s, "magenta"),
};

export function out(s: string): void {
  console.log(s);
}
export function err(s: string): void {
  console.error(s);
}
export function json(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}
