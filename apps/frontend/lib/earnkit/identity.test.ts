import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { answerPickup, findEarlier, linkInstallations, offerPickup, pickupQuestion, statedUsers } from './identity';
import { connectInstallation, saveInstallation, sharedGroup } from './installations';
import { readBank } from './answer-bank';
import { tokenLineFor } from './token-gate';
import { PICKUP_TEXT, tools, yesNo } from './tools';
import { TECHNICAL_TERMS } from './token-launch';

process.env.EARNKIT_AUTH_SECRET ??= 'identity-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// ---- Pure

test('v2.8.1 §E18: the pickup question names the count', () => {
  assert.equal(pickupQuestion(2), 'Pick up your 2 earlier entries?');
  assert.equal(pickupQuestion(1), 'Pick up your earlier entry?');
});

test('v2.8.1 §E18: stated GitHub users are validated, lowercased, deduped, at most 5', () => {
  assert.deepEqual(statedUsers({ github_users: ['Alice', 'alice', null, undefined, 'bad user', "x'; drop", 'b-o-b'] }), ['alice', 'b-o-b']);
  assert.equal(statedUsers({ github_users: ['a', 'b', 'c', 'd', 'e', 'f'] }).length, 5);
});

test('v2.8.1 §E18: yes and no in the forms agents pass them', () => {
  for (const y of [true, 1, 'yes', 'Yes.', ' y ', 'sure', 'OK']) assert.equal(yesNo(y), true, String(y));
  for (const n of [false, 0, 'no', 'No!', 'nope', 'not now']) assert.equal(yesNo(n), false, String(n));
  for (const u of [undefined, null, 'maybe', '', 2, {}]) assert.equal(yesNo(u), null, String(u));
});

test('v2.8.1 §E18: pickup copy: no em dashes, no tool or file names, never "coin"', () => {
  for (const [k, t] of Object.entries(PICKUP_TEXT)) {
    assert.doesNotMatch(t, /—/, k);
    assert.doesNotMatch(t, TECHNICAL_TERMS, k);
    assert.doesNotMatch(t, /pick_up_entries|\bcoin/i, k);
  }
});

// ---- With the database

const stamp = () => `${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;
async function install(o: { github_user?: string; wallet?: string; shared?: boolean } = {}) {
  const token = `ek_test_${stamp()}`;
  await saveInstallation(token, undefined, o.shared ?? false);
  const caller = (await connectInstallation(token))!;
  if (o.github_user) await sql()`UPDATE installations SET github_user = ${o.github_user} WHERE id = ${caller.own}`;
  if (o.wallet) await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${caller.own}, ${o.wallet.toLowerCase()})`;
  return { token, id: caller.own };
}
async function entry(installationId: number, repo: string | null, o: { wallet?: string } = {}) {
  const programId = `idt-${stamp()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const [row] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id, repo_url, creator_wallet)
    VALUES (${programId}, 'Tip Jar', ${installationId}, ${repo}, ${o.wallet ?? null}) RETURNING id`;
  return row.id;
}
const fileWith = (text: string) => ({ owner: async () => ({ status: 'ok' as const, text }), latest: async () => null });
const missing = { owner: async () => ({ status: 'missing' as const }), latest: async () => null };

test('v2.8.1 §E18: a new install naming the same GitHub user is offered its earlier entries; yes + proof links them', db, async () => {
  const user = `ghu${randomBytes(4).toString('hex')}`;
  const repo = `https://github.com/${user}/tipjar`;
  const old = await install({ github_user: user });
  await entry(old.id, repo);
  await entry(old.id, `https://github.com/${user}/other`);
  await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id) VALUES (${old.id}, ${'github.com/' + user + '/tipjar'}, 'team', 'Alice and Bob', 'p')`;
  await sql()`UPDATE installations SET alert_state = '{"top": {"1": true}}' WHERE id = ${old.id}`;

  const fresh = await install();
  // Nothing stated: no offer.
  assert.equal(await offerPickup(fresh.id, {}), null);
  // The GitHub user stated now (any case).
  const offer = await offerPickup(fresh.id, { github_users: [user.toUpperCase()] });
  assert.deepEqual(offer, { question: 'Pick up your 2 earlier entries?', entries: 2 });
  // Asked once: the next call doesn't repeat it (the answer still works).
  assert.equal(await offerPickup(fresh.id, { github_users: [user] }), null);

  // Yes without the proof line: nothing linked; the agent is told what to push.
  const needs = await answerPickup(fresh.id, true, missing);
  assert.equal(needs.status, 'needs_proof');
  // The proof goes in the newest earlier entry's repo.
  assert.deepEqual(needs, { status: 'needs_proof', repo: `github.com/${user}/other`, line: tokenLineFor(fresh.id, `https://github.com/${user}/other`), unreadable: false });
  assert.equal((await connectInstallation(fresh.token))!.id, fresh.id, 'not linked yet');
  // Another agent's line (the old installation's own code) proves nothing for this one.
  assert.equal((await answerPickup(fresh.id, true, fileWith(tokenLineFor(old.id, repo)!))).status, 'needs_proof');

  // With this agent's line: linked.
  const done = await answerPickup(fresh.id, true, fileWith(`payout_wallet: 0x${'1'.repeat(40)}\n${tokenLineFor(fresh.id, `https://github.com/${user}/other`)}\n`));
  assert.deepEqual(done, { status: 'linked', entries: 2 });
  // The new token now acts as the earlier installation: entries, bank and alerts carry over.
  const caller = (await connectInstallation(fresh.token))!;
  assert.deepEqual({ id: caller.id, own: caller.own }, { id: old.id, own: fresh.id });
  assert.equal((await readBank(caller.id, `github.com/${user}/tipjar`)).get('team'), 'Alice and Bob');
  const [st] = await sql()<{ alert_state: unknown }[]>`SELECT alert_state FROM installations WHERE id = ${caller.id}`;
  assert.deepEqual(st.alert_state, { top: { '1': true } });
  // The old agent still works, as the same builder.
  assert.equal((await connectInstallation(old.token))!.id, old.id);
  // Never offered again once linked.
  assert.equal(await offerPickup(fresh.id, { github_users: [user] }), null);
});

test('v2.8.1 §E18: a no is remembered; nothing links and it is not asked again', db, async () => {
  const user = `ghn${randomBytes(4).toString('hex')}`;
  const old = await install();
  await entry(old.id, `https://github.com/${user}/app`);
  const fresh = await install();
  assert.ok(await offerPickup(fresh.id, { github_users: [user] }), 'matched by the repo owner of an earlier entry');
  assert.deepEqual(await answerPickup(fresh.id, false), { status: 'declined' });
  assert.equal(await offerPickup(fresh.id, { github_users: [user] }), null);
  assert.deepEqual(await answerPickup(fresh.id, true, fileWith('')), { status: 'none' });
  assert.equal((await connectInstallation(fresh.token))!.id, fresh.id);
});

test('v2.8.1 §E18: a wallet stated now matches; earlier entries without a GitHub repo get no offer (nothing to prove)', db, async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  const old = await install({ wallet });
  await entry(old.id, 'https://gitlab.com/someone/app');
  const fresh = await install();
  assert.equal(await offerPickup(fresh.id, { wallet }), null);
  await entry(old.id, `https://github.com/w${randomBytes(3).toString('hex')}/app`);
  assert.deepEqual(await offerPickup(fresh.id, { wallet: wallet.toUpperCase().replace('0X', '0x') }), { question: 'Pick up your 2 earlier entries?', entries: 2 });
  // An installation that never entered has nothing to pick up.
  const empty = await install({ wallet: `0x${randomBytes(20).toString('hex')}` });
  void empty;
  assert.equal(await findEarlier(fresh.id, { wallet: `0x${randomBytes(20).toString('hex')}` }), null);
});

test('v2.8.1 §E18: on a hosted install, only what is stated now matches, never the remembered state', db, async () => {
  const user = `ghs${randomBytes(4).toString('hex')}`;
  const old = await install();
  await entry(old.id, `https://github.com/${user}/app`);
  // A shared registration that remembers another user's GitHub name from an earlier call.
  const shared = await install({ shared: true, github_user: user });
  const tools_ = tools as unknown as { list_programs: (i: unknown, c: unknown) => Promise<{ pick_up?: unknown; show_to_builder: string }> };
  const ctx = { installationId: shared.id, ownInstallationId: shared.id, sharedClient: true, matchProjects: async () => ({ fits: [] }), roundPoolsWei: async () => new Map(), repoCoins: async () => new Map() };
  const r = await tools_.list_programs({}, ctx);
  assert.ok(!('pick_up' in r), 'no offer from remembered state');
  assert.doesNotMatch(r.show_to_builder, /Pick up/);
  // Stated in this exchange: offered (and the proof still applies).
  const s = await tools_.list_programs({ github_user: user }, ctx);
  assert.ok('pick_up' in s);
  assert.match(s.show_to_builder, /^Pick up your earlier entry\?\n\n/);
});

test('v2.8.1 §E18: linking merges groups: rows move to the oldest root, clashes keep the newer answer, members follow', db, async () => {
  const a = await install();
  const b = await install();
  const c = await install();
  await entry(a.id, null);
  await entry(b.id, null);
  await entry(c.id, null);
  await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id, updated_at) VALUES
    (${a.id}, 'k', 'team', 'old', 'p', now() - interval '1 day'), (${b.id}, 'k', 'team', 'new', 'p', now())`;
  await sql()`INSERT INTO installation_wallets (installation_id, wallet) VALUES (${b.id}, ${'0x' + 'e'.repeat(40)})`;
  // b and c first, then a joins (a is older, so it becomes the root).
  assert.equal(await linkInstallations(c.id, [b.id]), 2);
  assert.equal((await connectInstallation(c.token))!.id, b.id);
  assert.equal(await linkInstallations(a.id, [b.id]), 3);
  for (const t of [a, b, c]) assert.equal((await connectInstallation(t.token))!.id, a.id);
  assert.equal((await readBank(a.id, 'k')).get('team'), 'new');
  const [w] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM installation_wallets WHERE installation_id = ${a.id}`;
  assert.equal(w.n, 1);
});

test('v2.8.1 §E17: the per-agent launch floor is the shared one when the group has a hosted install', db, async () => {
  const plain = await install();
  const hosted = await install({ shared: true });
  assert.equal(await sharedGroup(plain.id), false);
  assert.equal(await sharedGroup(hosted.id), true);
  await linkInstallations(hosted.id, [plain.id]);
  assert.equal(await sharedGroup(Math.min(plain.id, hosted.id)), true);
});

test('v2.8.1 §E18: the pick_up_entries tool: what to push, then picked up; builder text names no tool or file', db, async () => {
  const user = `ght${randomBytes(4).toString('hex')}`;
  const old = await install();
  await entry(old.id, `https://github.com/${user}/app`);
  const fresh = await install();
  type Reply = { show_to_builder: string; agent_note?: string; entries?: number };
  const pick = tools.pick_up_entries as (i: unknown, c: unknown) => Promise<Reply>;
  const ctx = (deps: unknown) => ({ installationId: fresh.id, ownInstallationId: fresh.id, pickupDeps: deps });
  assert.equal((await pick({ answer: 'yes' }, ctx(missing))).show_to_builder, PICKUP_TEXT.none, 'nothing offered yet');
  await offerPickup(fresh.id, { github_users: [user] });
  assert.equal((await pick({ answer: 'maybe' }, ctx(missing))).show_to_builder, PICKUP_TEXT.unclear);
  const line = tokenLineFor(fresh.id, `https://github.com/${user}/app`)!;
  const needs = await pick({ answer: 'yes' }, ctx(missing));
  assert.equal(needs.show_to_builder, PICKUP_TEXT.proof);
  assert.ok(needs.agent_note?.includes(`"${line}"`) && needs.agent_note.includes(`github.com/${user}/app`), needs.agent_note);
  const down = await pick({ answer: true }, ctx({ owner: async () => ({ status: 'error', message: 'x' }), latest: async () => null }));
  assert.equal(down.show_to_builder, PICKUP_TEXT.unreadable);
  // Pushed to a feature branch: the latest pushed branch proves it too.
  const done = await pick({ answer: 'Yes' }, ctx({ owner: async () => ({ status: 'missing' }), latest: async () => ({ branch: 'feat', file: { status: 'ok', text: line } }) }));
  assert.deepEqual({ text: done.show_to_builder, entries: done.entries }, { text: PICKUP_TEXT.linked, entries: 1 });
  assert.equal((await connectInstallation(fresh.token))!.id, old.id);
});
