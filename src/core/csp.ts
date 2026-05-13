/**
 * Shared Content-Security-Policy for the iframe-isolated note `/raw/:id` route
 * across both the local viewer (src/viewer/server.ts) and the cloud relay
 * (src/cloud/server.ts).
 *
 * The rationale lives in AGENTS.md hard rules: notes run inside a null-origin
 * sandboxed iframe (sandbox="allow-scripts allow-popups allow-forms" WITHOUT
 * allow-same-origin), so this CSP works alongside that. `connect-src 'none'`
 * is the load-bearing line — even though scripts can execute in the note,
 * they cannot fetch/XHR/WebSocket anywhere, which prevents data exfiltration.
 *
 * Keep this header identical between viewer and cloud — if they drift, a note
 * could behave differently depending on which surface served it, and threat
 * model reasoning falls apart.
 */
export const RAW_NOTE_CSP = [
  "default-src 'self' 'unsafe-inline' data: blob: https:",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data: https:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'none'",
  "base-uri 'self'",
].join("; ");

export function rawNoteHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": RAW_NOTE_CSP,
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
  };
}

/**
 * Headers for capability-URL responses (`/p/:token/...` in cloud relay, W4).
 * Same CSP as the local raw-note route — published note must not behave
 * differently from a privately viewed one. Adds noindex + tightens referrer.
 */
export function sharedNoteHeaders(): Record<string, string> {
  return {
    ...rawNoteHeaders(),
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
  };
}
