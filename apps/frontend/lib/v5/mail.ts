/**
 * The owner's emails (pending program approvals, the daily program digest) over Resend: to
 * OWNER_EMAIL, from MAIL_FROM, with an idempotency key so a retried send never mails twice.
 * Off (a no-op) without RESEND_API_KEY.
 */

export const OWNER_EMAIL = 'j@earnkit.com';
export const MAIL_FROM = 'EarnKit <digest@earnkit.com>';

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

export type Mailer = (m: { to: string; from: string; subject: string; text: string; idempotencyKey: string }) => Promise<void>;

/** A failed send: `status` is the HTTP status (0: no answer, a timeout or a network error). */
export class MailError extends Error {
  constructor(readonly status: number) {
    super(`Mail failed: ${status}`);
    this.name = 'MailError';
  }
}

/** Resend's API (POST /emails, 10 s). Replies go to OWNER_EMAIL. Never logs the address or the key. */
export const resendMailer =
  (apiKey: string, fetchFn: typeof fetch = fetch): Mailer =>
  async (m) => {
    let res: Response;
    try {
      res = await fetchFn(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
        body: JSON.stringify({ from: m.from, to: [m.to], reply_to: OWNER_EMAIL, subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new MailError(0);
    }
    if (!res.ok) throw new MailError(res.status);
  };

/** Whether the owner's email can go: RESEND_API_KEY is set. */
export const ownerMailEnabled = (env: Record<string, string | undefined> = process.env): boolean => Boolean(env.RESEND_API_KEY?.trim());

/** One email to the owner; false (nothing sent) without RESEND_API_KEY. A failed send throws MailError. */
export async function ownerMail(subject: string, text: string, idempotencyKey: string, mailer?: Mailer): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;
  await (mailer ?? resendMailer(apiKey))({ to: OWNER_EMAIL, from: MAIL_FROM, subject, text, idempotencyKey });
  return true;
}
