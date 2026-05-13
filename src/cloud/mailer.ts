/**
 * Email delivery for the cloud relay.
 *
 * Current use case: `folio publish --recipient bob@example.com` emails the
 * capability URL to the named recipient. Plaintext email is a passthrough
 * to the mailer — the cloud DB stores only a SHA-256 hash so the address
 * is never persisted, only the link recipient hash + the in-flight outbound
 * message bytes (held by the mailer until delivered).
 *
 * Providers:
 *   - **Resend (HTTP API).** RESEND_API_KEY + FOLIO_MAIL_FROM env vars on
 *     the cloud server. No SMTP lib dependency — just `fetch` to Resend's
 *     /emails endpoint. Default for production once both vars are set.
 *   - **Console (dev).** Opt-in via FOLIO_MAIL_DEV=1. Logs subject + to;
 *     full body only when FOLIO_DEBUG=1. Used by tests and local cloud
 *     instances without an API key.
 *   - **None.** No env vars at all → getMailer() returns null. Callers
 *     skip sending (and skip the related share-creation side effect).
 *
 * The `setMailer()` test injection point overrides everything for unit tests.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  ok: boolean;
  error?: string;
  message_id?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<MailResult>;
}

class ConsoleMailer implements Mailer {
  async send(msg: MailMessage): Promise<MailResult> {
    // Always log the metadata so operators can confirm a send happened;
    // body only when FOLIO_DEBUG=1 so capability URLs don't leak to journald
    // by default.
    console.log(`[folio-mailer:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
    if (process.env.FOLIO_DEBUG) {
      console.log(`[folio-mailer:console] text:\n${msg.text}`);
    }
    return { ok: true, message_id: `console-${Date.now()}` };
  }
}

class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(msg: MailMessage): Promise<MailResult> {
    let res: Response;
    try {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });
    } catch (e: any) {
      return { ok: false, error: `resend transport error: ${e?.message ?? String(e)}` };
    }
    if (!res.ok) {
      let detail = "";
      try { detail = await res.text(); } catch {}
      return { ok: false, error: `resend HTTP ${res.status}: ${detail.slice(0, 200)}` };
    }
    try {
      const body = (await res.json()) as { id?: string };
      return { ok: true, message_id: body.id };
    } catch {
      return { ok: true };
    }
  }
}

let _override: Mailer | null = null;

/** Inject a mailer for tests. Pass null to clear. */
export function setMailer(m: Mailer | null): void {
  _override = m;
}

/**
 * Resolve the mailer configured for this process. Order:
 *   1. setMailer() override (test injection)
 *   2. RESEND_API_KEY + FOLIO_MAIL_FROM → ResendMailer
 *   3. FOLIO_MAIL_DEV=1 → ConsoleMailer (dev / smoke tests)
 *   4. null → no mailer; caller should skip send-related side effects
 */
export function getMailer(): Mailer | null {
  if (_override) return _override;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.FOLIO_MAIL_FROM;
  if (key && from) return new ResendMailer(key, from);
  if (process.env.FOLIO_MAIL_DEV === "1") return new ConsoleMailer();
  return null;
}

/** Quick check whether outbound email is wired up for this server. */
export function isMailerConfigured(): boolean {
  return getMailer() !== null;
}

export interface ShareEmailOpts {
  url: string;
  recipient: string;
  scope_type: "note" | "thread";
  scope_label?: string;
  expires_at: string | null;
}

/**
 * Render an outbound share invite. Keep it boring: subject says what it is,
 * body has the URL prominent + a single-line "expires" + a tiny note that
 * the URL was sent to this address. No tracking pixel, no fancy branding —
 * deliverability beats aesthetics for capability links.
 */
export function renderShareEmail(opts: ShareEmailOpts): { subject: string; html: string; text: string } {
  const noun = opts.scope_type === "thread" ? "thread" : "note";
  const subject = `A Folio ${noun} was shared with you`;
  const expiresLine = opts.expires_at
    ? `This link expires on ${opts.expires_at.slice(0, 10)}.`
    : `This link doesn't expire until it's revoked.`;
  const text = [
    `Someone shared a Folio ${noun} with you.`,
    ``,
    `Open it:`,
    opts.url,
    ``,
    expiresLine,
    `If you weren't expecting this, you can ignore the email — no account is created.`,
    ``,
    `— Folio`,
  ].join("\n");
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a; background: #f5f3ee; padding: 30px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; padding: 30px 32px; border-radius: 12px; border: 1px solid rgba(10,10,10,0.08);">
    <p style="margin: 0 0 18px; color: #6b6b66; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase;">Folio</p>
    <h1 style="margin: 0 0 16px; font-weight: 500; font-size: 22px; letter-spacing: -0.01em;">Someone shared a ${noun} with you.</h1>
    <p style="margin: 0 0 24px;">Open it in any browser:</p>
    <p style="margin: 0 0 24px;"><a href="${esc(opts.url)}" style="display: inline-block; background: #0a0a0a; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; font-weight: 500;">Open ${noun}</a></p>
    <p style="margin: 0 0 4px; font-size: 13px; color: #6b6b66; word-break: break-all;">${esc(opts.url)}</p>
    <hr style="border: 0; border-top: 1px solid rgba(10,10,10,0.08); margin: 24px 0;">
    <p style="margin: 0 0 8px; color: #6b6b66; font-size: 13px;">${esc(expiresLine)}</p>
    <p style="margin: 0; color: #a8a89e; font-size: 12px;">If you weren't expecting this, you can ignore it — no account is created.</p>
  </div>
</body></html>`;
  return { subject, html, text };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
