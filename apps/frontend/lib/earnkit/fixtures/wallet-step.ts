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
 * v4.8 Task 1: the path (conversation.ts bestMove) leads every ranked reply that has a program to name, so a test about
 * another ranked step (connect, the Monday block, a post, the check-in, the wallet, the token offer, titles, the ship
 * line, the standing paragraph) parks every program in the table for the path ('path:<id>', a no to the path's step
 * within DECLINE_MS; the older asks never read that key): the path is quiet and the older reply answers.
 * v48-conversation.test.ts covers the path itself. A program added after this call can still be named.
 */
export async function pathQuiet(builderId: number, o: { at?: string; except?: string[] } = {}): Promise<void> {
  const at = o.at ?? new Date().toISOString();
  const rows = await sql()<{ id: string }[]>`SELECT id FROM programs`;
  const declined = Object.fromEntries(rows.filter((r) => !o.except?.includes(r.id)).map((r) => [`path:${r.id}`, at]));
  // `except`: those programs are left (unparked), so the path names only them.
  if (o.except?.length)
    await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{declined}', (standing_seen->'declined') - ${o.except.map((x) => `path:${x}`)}::text[])
      WHERE builder_id = ${builderId} AND standing_seen ? 'declined'`;
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
    COALESCE(standing_seen->'declined', '{}'::jsonb) || ${sql().json(declined as never)}::jsonb) WHERE builder_id = ${builderId}`;
}

/** v4.8 Task 1: undoes pathQuiet (every 'path:<id>' no removed), so the path names programs again. */
export async function pathUnquiet(builderId: number): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{declined}',
      (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(standing_seen->'declined') AS e(k, v) WHERE k NOT LIKE 'path:%'))
    WHERE builder_id = ${builderId} AND jsonb_typeof(standing_seen->'declined') = 'object'`;
}

/**
 * v4.7.1 T1: marks the ranked program asks as answered already, for a test about another ranked step (the check-in, the
 * wallet, the token offer, titles, the ship line). v4.7.2 T2: per program ('needs:<id>', at `at`). v4.8 Task 1: and the
 * path parked (pathQuiet), so the older asks answer. A program added after this call can still be named.
 */
export async function checkFitsAsked(builderId: number, at = new Date().toISOString()): Promise<void> {
  await pathQuiet(builderId, { at });
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
