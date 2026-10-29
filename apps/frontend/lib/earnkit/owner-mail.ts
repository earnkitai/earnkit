import { sql } from './db';
import { DIGEST_FROM_DEFAULT, resendMailer, type Mailer } from './digest';
import { CONTACT_EMAIL } from './policy';

/**
 * v4.0 Task 12: the owner's own emails (to CONTACT_EMAIL, from DIGEST_FROM_DEFAULT) over the weekly email's Resend mailer:
 * the Safe at $5,000 (safe-watch.ts) and a gas wallet running low (cron.ts). State lives in owner_alerts.
 */

/** Whether the owner's email can go: RESEND_API_KEY is set. */
export const ownerMailEnabled = (env: Record<string, string | undefined> = process.env) => Boolean(env.RESEND_API_KEY?.trim());

/**
 * One email to the owner. `key` is Resend's Idempotency-Key, so a retried send never mails twice. No-ops (returns
 * without throwing) when RESEND_API_KEY is unset. A failed send throws (digest.ts MailError).
 */
export async function ownerMail(subject: string, text: string, key: string, mailer?: Mailer): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return;
  await (mailer ?? resendMailer(apiKey))({ to: CONTACT_EMAIL, from: DIGEST_FROM_DEFAULT, subject, text, headers: {}, idempotencyKey: key });
}

/** A needs_owner gas line, its wallet and chain. */
export type GasAlert = { line: string; wallet: string; chain: 'base' | 'arc' };

/**
 * The gas lines of a run's needs_owner: 'bonus-ledger' when the payout wallet's gas is why (`bonusGasLow`; the line
 * also stands for other waits) with the payout wallet, and each 'deployer-gas:<chain>' with the deployer. A line whose
 * wallet is unknown is left out. Pure.
 */
export function gasAlerts(lines: string[], bonusGasLow: boolean, payout: string | null, deployer: string | null): GasAlert[] {
  const out: GasAlert[] = [];
  for (const line of lines) {
    if (line === 'bonus-ledger' && bonusGasLow && payout) out.push({ line, wallet: payout, chain: 'base' });
    const m = line.match(/^deployer-gas:(base|arc)$/);
    if (m && deployer) out.push({ line, wallet: deployer, chain: m[1] as 'base' | 'arc' });
  }
  return out;
}

const GAS_WHO: Record<string, string> = { 'bonus-ledger': 'payout wallet', 'deployer-gas': 'deployer wallet' };
const TOP_UP_TEXT = { base: 'Send it a little ETH on Base.', arc: 'Send it a little USDC on Arc.' } as const;
export const GAS_SUBJECT = "EarnKit's gas wallet is running low";

/**
 * The gas-low email, at most once a UTC day per line (owner_alerts 'gas:<line>', state = the date). Returns whether
 * it mailed. No key: nothing, false. A failed send gives the day back (the next run tries again) and throws.
 */
export async function ownerGasMail(a: GasAlert, now: Date, mailer?: Mailer): Promise<boolean> {
  if (!ownerMailEnabled()) return false;
  const kind = `gas:${a.line}`;
  const day = now.toISOString().slice(0, 10);
  const [prev] = await sql()<{ state: string | null }[]>`SELECT state FROM owner_alerts WHERE kind = ${kind}`;
  const [claimed] = await sql()<{ kind: string }[]>`
    INSERT INTO owner_alerts (kind, state, at) VALUES (${kind}, ${day}, ${now})
    ON CONFLICT (kind) DO UPDATE SET state = EXCLUDED.state, at = EXCLUDED.at
      WHERE owner_alerts.state IS DISTINCT FROM EXCLUDED.state
    RETURNING kind`;
  if (!claimed) return false;
  const who = GAS_WHO[a.line.split(':')[0]] ?? 'gas wallet';
  const text = [`EarnKit's ${who} ${a.wallet} is running low on gas.`, '', TOP_UP_TEXT[a.chain]].join('\n');
  try {
    await ownerMail(GAS_SUBJECT, text, `${kind}:${day}`, mailer);
  } catch (err) {
    await sql()`UPDATE owner_alerts SET state = ${prev?.state ?? null} WHERE kind = ${kind} AND state = ${day}`;
    throw err;
  }
  return true;
}
