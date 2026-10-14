import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { EVENT_TYPES, LOGIN_BASES } from './events';
import { xSignInEnabled } from './builder-score-flag';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

test('1.4 the new event types and login basis are listed', () => {
  for (const t of ['identity_given', 'page_claimed', 'x_renamed', 'wallet_proven', 'refreshed', 'use_tracked', 'builder_code_issued', 'coin_offered', 'coin_answered', 'page_ready_shown', 'news_shown'])
    assert.ok((EVENT_TYPES as readonly string[]).includes(t), t);
  assert.ok((LOGIN_BASES as readonly string[]).includes('x_match'));
});

test('1.5 X sign-in is on only with both the id and the secret', () => {
  assert.equal(xSignInEnabled({}), false);
  assert.equal(xSignInEnabled({ X_CLIENT_ID: 'a' }), false);
  assert.equal(xSignInEnabled({ X_CLIENT_ID: 'a', X_CLIENT_SECRET: ' ' }), false);
  assert.equal(xSignInEnabled({ X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b' }), true);
});

test('1.6 the v2.12.1 tables, columns, checks and the internal coin program exist', dbTest, async () => {
  const cols = await sql()<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'builder_profiles'`;
  for (const c of ['x_user_id', 'x_name', 'x_avatar_url', 'claimed_at', 'reported_github', 'page_ready_shown_at', 'standing_seen', 'card_moments', 'base_builder_code', 'identity', 'github_basis'])
    assert.ok(cols.some((r) => r.column_name === c), c);
  for (const t of ['claim_codes', 'x_oauth_states', 'person_wallets', 'builder_live', 'builder_projects', 'source_live', 'read_usage', 'coin_moments', 'pending_joins'])
    assert.equal((await sql()`SELECT to_regclass(${t}) AS r`)[0].r, t);
  const [coin] = await sql()<{ status: string; token_policy: string; builder_bonus: boolean }[]>`
    SELECT status, token_policy, builder_bonus FROM programs WHERE id = 'earnkit-coin'`;
  assert.deepEqual(coin, { status: 'closed', token_policy: 'encouraged', builder_bonus: false });
  const id = 2_100_900_000 + (process.pid % 900);
  await sql().begin(async (tx) => {
    await tx`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${id}, 'coin', 'base:0x0000000000000000000000000000000000000001', 'k', 'x_match', 'verified', 'server')`;
    await tx`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${id}, 'site', 'https://a.earnkit.com', 'k', 'earnkit_hosted', 'verified', 'server')`;
    await tx`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${id}, 'contract', 'base:0x0000000000000000000000000000000000000002', 'k', 'wallet_signed', 'verified', 'server')`;
    await assert.rejects(tx`INSERT INTO person_wallets (builder_id, wallet) VALUES (${id}, '0xABC')`);
    throw new Error('rollback');
  }).catch((e: Error) => assert.equal(e.message, 'rollback'));
});
