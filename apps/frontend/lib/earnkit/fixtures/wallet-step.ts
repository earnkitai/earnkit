import { sql } from '../db';

/**
 * v3.1 wallet proof: marks the optional wallet step as offered already (standing_seen.wallet_asked), for a test about
 * another ranked step (v31-wallet-proof.test.ts covers the wallet step itself). v4.0: this also answers setup step 3
 * (wallet-offer.ts walletSetupDue), which otherwise comes before every ranked ask once the App connects.
 */
export async function walletOffered(builderId: number): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_asked', now()::text) WHERE builder_id = ${builderId}`;
}

/**
 * v4.7.1 T1: marks the ranked check_fits ask as asked already, for a test about another ranked step of a builder with no
 * fit (v471-money.test.ts and v472-next-step.test.ts cover check_fits itself). The open grants still lead. v4.7.2 T2: the
 * ask is per program now (check_fits_asked is never read), so this says no to it ('needs:<id>', at `at`) for every
 * program in the table; a program added after this call can still be asked.
 */
export async function checkFitsAsked(builderId: number, at = new Date().toISOString()): Promise<void> {
  const rows = await sql()<{ id: string }[]>`SELECT id FROM programs`;
  const declined = Object.fromEntries(rows.map((r) => [`needs:${r.id}`, at]));
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
    COALESCE(standing_seen->'declined', '{}'::jsonb) || ${sql().json(declined as never)}::jsonb) WHERE builder_id = ${builderId}`;
}

/**
 * v3.1 wallet proof security follow-up: the page's X sign-in for `token` as X user `xId`, as a browser does it
 * (walletXStart, then the X callback with a fake X), returning the browser's X-check cookie ("name=value") or null.
 */
export async function walletXSignIn(token: string, xId: string): Promise<string | null> {
  const { walletXStart } = await import('../wallet-proof');
  const { xSignInCallback } = await import('../x-install');
  const r = await walletXStart(new Request(`https://earnkit.com/claim/wallet/x?t=${encodeURIComponent(token)}`, { headers: { 'x-real-ip': `10.8.${Math.floor(Math.random() * 250)}.1` } }));
  if (r.status !== 302) return null;
  const state = new URL(r.headers.get('location')!).searchParams.get('state')!;
  // A test with a mocked clock: the sign-in row lives 15 minutes from the database's own now (the callback's check).
  const { sql } = await import('../db');
  const { tokenUseKey } = await import('../wallet-proof');
  await sql()`UPDATE x_signins SET expires_at = now() + interval '15 minutes' WHERE purpose = 'wallet' AND link_hash = ${tokenUseKey(token)}`;
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const back = await xSignInCallback(new Request(`https://earnkit.com/x/callback?state=${state}&code=c`, { headers: { cookie } }), {
    limit: async () => {},
    x: { exchange: async () => 'tok', me: async () => ({ id: xId, username: 'someone', name: 'S', avatar: null }) },
  });
  const set = back?.headers.getSetCookie().find((c) => c.startsWith('__Host-ekwx-') && !/Max-Age=0/.test(c));
  return set ? set.split(';')[0] : null;
}

/**
 * v4.7 T3 (token after money): the token offer waits for one application or draft (wallet-offer.ts tokenOfferDue). For a
 * test about the offer itself: one application told (builder_program_status applied) to a committed program that is
 * not open yet (base-batches-005: upcoming, never a fit, no results question), so no open fit or reply line changes.
 */
export async function moneyStepDone(builderId: number, programId = 'base-batches-005'): Promise<void> {
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, login, status) VALUES (${builderId}, ${programId}, '', 'applied')
    ON CONFLICT DO NOTHING`;
}
