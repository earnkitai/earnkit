import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { answerPickup, coveredRoots, findEarlier, linkInstallations, offerPickup, pickupQuestion, statedUsers } from './identity';
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

test('final fix wave (C1): the proof covers only groups with an entry in that repo (normalized)', () => {
  const entries = [
    { root: 5, repo_url: 'https://github.com/Alice/TipJar/' },
    { root: 3, repo_url: 'https://github.com/mallory/x' },
    { root: 9, repo_url: null },
    { root: 2, repo_url: 'git+https://www.github.com/alice/tipjar' },
  ];
  assert.deepEqual(coveredRoots(entries, 'https://github.com/alice/tipjar'), [2, 5]);
  assert.deepEqual(coveredRoots(entries, 'https://github.com/nobody/none'), []);
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
/** Ruling F13: the repo's earnkit.txt holding these installations' own lines for `repo`. */
const linesOf = (repo: string, ...ids: number[]) => fileWith(ids.map((id) => tokenLineFor(id, repo)).join('\n') + '\n');

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
  const other = `https://github.com/${user}/other`;
  // Ruling F13: the earlier group's own line is in the repo the proof goes in.
  const offer = await offerPickup(fresh.id, { github_users: [user.toUpperCase()] }, linesOf(other, old.id));
  assert.deepEqual(offer, { question: 'Pick up your 2 earlier entries?', entries: 2 });
  // Asked once: the next call doesn't repeat it (the answer still works).
  assert.equal(await offerPickup(fresh.id, { github_users: [user] }, linesOf(other, old.id)), null);

  // Yes without the proof line: nothing linked; the agent is told what to push.
  const needs = await answerPickup(fresh.id, true, missing);
  assert.equal(needs.status, 'needs_proof');
  // The proof goes in the newest earlier entry's repo.
  assert.deepEqual(needs, { status: 'needs_proof', repo: `github.com/${user}/other`, line: tokenLineFor(fresh.id, `https://github.com/${user}/other`), unreadable: false });
  assert.equal((await connectInstallation(fresh.token))!.id, fresh.id, 'not linked yet');
  // Another agent's line (the old installation's own code) proves nothing for this one.
  assert.equal((await answerPickup(fresh.id, true, fileWith(tokenLineFor(old.id, repo)!))).status, 'needs_proof');

  // With this agent's line: linked.
  // This agent's line alone: the earlier group hasn't proven the repo itself (F13), so nothing links.
  assert.deepEqual(await answerPickup(fresh.id, true, linesOf(other, fresh.id)), { status: 'none' });
  await sql()`UPDATE installations SET pickup = ${sql().json({ offered: [old.id], repo: other, entries: 2 })} WHERE id = ${fresh.id}`;
  const done = await answerPickup(fresh.id, true, fileWith(`payout_wallet: 0x${'1'.repeat(40)}\n${tokenLineFor(fresh.id, other)}\n${tokenLineFor(old.id, other)}\n`));
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
  assert.equal(await offerPickup(fresh.id, { github_users: [user] }, linesOf(other, old.id)), null);
});

test('v2.8.1 §E18: a no is remembered; nothing links and it is not asked again', db, async () => {
  const user = `ghn${randomBytes(4).toString('hex')}`;
  const old = await install();
  await entry(old.id, `https://github.com/${user}/app`);
  const fresh = await install();
  const proof = linesOf(`https://github.com/${user}/app`, old.id);
  assert.ok(await offerPickup(fresh.id, { github_users: [user] }, proof), 'matched by the repo owner of an earlier entry');
  assert.deepEqual(await answerPickup(fresh.id, false), { status: 'declined' });
  assert.equal(await offerPickup(fresh.id, { github_users: [user] }, proof), null);
  assert.deepEqual(await answerPickup(fresh.id, true, fileWith('')), { status: 'none' });
  assert.equal((await connectInstallation(fresh.token))!.id, fresh.id);
});

test('v2.8.1 §E18: a wallet stated now matches; earlier entries without a GitHub repo get no offer (nothing to prove)', db, async () => {
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  const old = await install({ wallet });
  await entry(old.id, 'https://gitlab.com/someone/app');
  const fresh = await install();
  assert.equal(await offerPickup(fresh.id, { wallet }), null);
  const ghRepo = `https://github.com/w${randomBytes(3).toString('hex')}/app`;
  await entry(old.id, ghRepo);
  // Ruling F13: not until the earlier group has proven the repo itself.
  assert.equal(await offerPickup(fresh.id, { wallet }, missing), null);
  // G0 N2: the repo is read again only after an hour (the line was added since).
  await sql()`UPDATE installations SET pickup = pickup - 'read' WHERE id = ${fresh.id}`;
  assert.deepEqual(await offerPickup(fresh.id, { wallet: wallet.toUpperCase().replace('0X', '0x') }, linesOf(ghRepo, old.id)), { question: 'Pick up your 2 earlier entries?', entries: 2 });
  // An installation that never entered has nothing to pick up.
  const empty = await install({ wallet: `0x${randomBytes(20).toString('hex')}` });
  void empty;
  assert.equal(await findEarlier(fresh.id, { wallet: `0x${randomBytes(20).toString('hex')}` }), null);
});

test('final fix wave (C2): a hosted install is never offered a pickup, from memory or from what it states', db, async () => {
  const user = `ghs${randomBytes(4).toString('hex')}`;
  const old = await install();
  await entry(old.id, `https://github.com/${user}/app`);
  // A shared registration that remembers another user's GitHub name from an earlier call.
  const shared = await install({ shared: true, github_user: user });
  const tools_ = tools as unknown as { list_programs: (i: unknown, c: unknown) => Promise<{ pick_up?: unknown; show_to_builder: string }> };
  const ctx = { installationId: shared.id, ownInstallationId: shared.id, sharedClient: true, matchProjects: async () => ({ fits: [] }), roundPools: async () => new Map(), repoCoins: async () => new Map() };
  const r = await tools_.list_programs({}, ctx);
  assert.ok(!('pick_up' in r), 'no offer from remembered state');
  assert.doesNotMatch(r.show_to_builder, /Pick up/);
  // Stated in this exchange: still no offer on a hosted agent.
  const s = await tools_.list_programs({ github_user: user }, ctx);
  assert.ok(!('pick_up' in s));
  assert.doesNotMatch(s.show_to_builder, /Pick up/);
  assert.equal(await offerPickup(shared.id, { github_users: [user] }), null);
  // A stale offer on a hosted install never links, even with the proof line.
  await sql()`UPDATE installations SET pickup = ${sql().json({ offered: [old.id], repo: `https://github.com/${user}/app`, entries: 1 })} WHERE id = ${shared.id}`;
  assert.deepEqual(await answerPickup(shared.id, true, fileWith(tokenLineFor(shared.id, `https://github.com/${user}/app`)!)), { status: 'none' });
  assert.equal((await connectInstallation(shared.token))!.id, shared.id);
});

test('final fix wave (C2): a group holding a hosted install is never matched, offered or linked', db, async () => {
  const user = `ghh${randomBytes(4).toString('hex')}`;
  const repo = `https://github.com/${user}/app`;
  // The builder's one entry made through a hosted agent (Grok Bot).
  const hosted = await install({ shared: true });
  await entry(hosted.id, repo);
  const fresh = await install();
  assert.equal(await findEarlier(fresh.id, { github_users: [user] }), null);
  assert.equal(await offerPickup(fresh.id, { github_users: [user] }, linesOf(repo, hosted.id)), null);
  // A hosted member inside an otherwise plain group hides the whole group.
  const plain = await install();
  await entry(plain.id, repo);
  assert.ok(await findEarlier(fresh.id, { github_users: [user] }));
  const member = await install({ shared: true });
  await sql()`UPDATE installations SET builder_id = ${plain.id} WHERE id = ${member.id}`;
  assert.equal(await findEarlier(fresh.id, { github_users: [user] }), null);
  // An offer made before the group turned hosted never links it.
  await sql()`UPDATE installations SET builder_id = NULL WHERE id = ${member.id}`;
  assert.ok(await offerPickup(fresh.id, { github_users: [user] }, linesOf(repo, plain.id)));
  await sql()`UPDATE installations SET builder_id = ${plain.id} WHERE id = ${member.id}`;
  assert.deepEqual(await answerPickup(fresh.id, true, linesOf(repo, fresh.id, plain.id)), { status: 'none' });
  assert.equal((await connectInstallation(fresh.token))!.id, fresh.id);
  // The tools read sharedClient from the group: the plain token linked with a hosted member is hosted.
  assert.equal((await connectInstallation(plain.token))!.shared, true);
  assert.equal((await connectInstallation(fresh.token))!.shared, false);
});

test('final fix wave (C1): only the groups the proof covers link; the question counts only their entries', db, async () => {
  const user = `ghc${randomBytes(4).toString('hex')}`;
  const repo = `https://github.com/${user}/tipjar`;
  // Alice's earlier install: one entry in her repo.
  const alice = await install({ github_user: user });
  await entry(alice.id, repo);
  // Mallory's install claims Alice's GitHub user and enters two programs from another repo.
  const mallory = await install({ github_user: user });
  await entry(mallory.id, 'https://github.com/mallory-x/other');
  await entry(mallory.id, 'https://github.com/mallory-x/other2');
  const fresh = await install();
  const found = await findEarlier(fresh.id, { github_users: [user] });
  assert.deepEqual(found, { roots: [alice.id], entries: 1, repo, counts: { [alice.id]: 1 } });
  assert.deepEqual(await offerPickup(fresh.id, { github_users: [user] }, linesOf(repo, alice.id)), { question: 'Pick up your earlier entry?', entries: 1 });
  const done = await answerPickup(fresh.id, true, linesOf(repo, fresh.id, alice.id));
  assert.deepEqual(done, { status: 'linked', entries: 1 });
  assert.equal((await connectInstallation(fresh.token))!.id, alice.id);
  // Mallory stays outside the group.
  assert.equal((await connectInstallation(mallory.token))!.id, mallory.id);
  const [m] = await sql()<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${mallory.id}`;
  assert.equal(m.builder_id, null);
  // A stale offer naming an uncovered group links only the covered ones.
  const other = await install();
  const third = await install({ github_user: user });
  await entry(third.id, 'https://github.com/someone-else/x');
  await sql()`UPDATE installations SET pickup = ${sql().json({ offered: [third.id, alice.id], repo, entries: 2 })} WHERE id = ${other.id}`;
  assert.deepEqual(await answerPickup(other.id, true, linesOf(repo, other.id, alice.id)), { status: 'linked', entries: 1 });
  assert.equal((await connectInstallation(third.token))!.id, third.id);
  assert.equal((await connectInstallation(other.token))!.id, alice.id);
});

test('final fix wave (M3): linking keeps the earlier-submitted entry per program and repo; no duplicates', db, async () => {
  const a = await install();
  const b = await install();
  const programId = `idt-${stamp()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const add = async (inst: number, repo: string | null, name: string, ago: string) =>
    (await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url, submitted_at)
      VALUES (${programId}, ${name}, ${inst}, ${repo}, now() - ${ago}::interval) RETURNING id`)[0].id;
  // The same repo entered from both agents (b's first), the same no-repo project, and one distinct entry.
  const rootLater = await add(a.id, 'https://github.com/dup-x/app', 'App', '1 hour');
  const otherEarlier = await add(b.id, 'https://GitHub.com/dup-x/app/', 'App', '2 hours');
  const rootNamed = await add(a.id, null, 'Tip Jar', '3 hours');
  const otherNamed = await add(b.id, null, 'tip jar', '1 hour');
  const distinct = await add(b.id, 'https://github.com/dup-x/other', 'Other', '1 hour');
  assert.equal(await linkInstallations(b.id, [a.id]), 3);
  const owner = async (id: number) => (await sql()<{ i: number }[]>`SELECT installation_id AS i FROM projects WHERE id = ${id}`)[0].i;
  assert.equal(await owner(otherEarlier), a.id, 'the earlier entry is the group\'s');
  assert.equal(await owner(rootLater), b.id, 'the later duplicate leaves the group\'s entries');
  assert.equal(await owner(rootNamed), a.id);
  assert.equal(await owner(otherNamed), b.id);
  assert.equal(await owner(distinct), a.id);
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
  await offerPickup(fresh.id, { github_users: [user] }, linesOf(`https://github.com/${user}/app`, old.id));
  assert.equal((await pick({ answer: 'maybe' }, ctx(missing))).show_to_builder, PICKUP_TEXT.unclear);
  const line = tokenLineFor(fresh.id, `https://github.com/${user}/app`)!;
  const needs = await pick({ answer: 'yes' }, ctx(missing));
  assert.equal(needs.show_to_builder, PICKUP_TEXT.proof);
  assert.ok(needs.agent_note?.includes(`"${line}"`) && needs.agent_note.includes(`github.com/${user}/app`), needs.agent_note);
  const down = await pick({ answer: true }, ctx({ owner: async () => ({ status: 'error', message: 'x' }), latest: async () => null }));
  assert.equal(down.show_to_builder, PICKUP_TEXT.unreadable);
  // Pushed to a feature branch: the latest pushed branch proves it too.
  const done = await pick({ answer: 'Yes' }, ctx({ owner: async () => ({ status: 'missing' }), latest: async () => ({ branch: 'feat', file: { status: 'ok', text: `${line}\n${tokenLineFor(old.id, `https://github.com/${user}/app`)}` } }) }));
  assert.deepEqual({ text: done.show_to_builder, entries: done.entries }, { text: PICKUP_TEXT.linked, entries: 1 });
  assert.equal((await connectInstallation(fresh.token))!.id, old.id);
});

test('Ruling F13: a stranger who plants an entry on Alice\'s exact repo is never counted or linked', db, async () => {
  const user = `ghf${randomBytes(4).toString('hex')}`;
  const repo = `https://github.com/${user}/tipjar`;
  // Alice's earlier install: her entry on the repo, its token launched (she proved the repo then).
  const alice = await install({ github_user: user });
  const aliceEntry = await entry(alice.id, repo);
  await sql()`
    UPDATE projects SET token_url = 'https://tokens.fun/coin/0xf13', token_status = 'launched', token_repo_key = ${repo.replace('https://', '')}
    WHERE id = ${aliceEntry}`;
  // The stranger names Alice's GitHub user and plants two entries on her exact repo, never proven.
  const stranger = await install({ github_user: user });
  await entry(stranger.id, repo);
  await entry(stranger.id, repo);
  const fresh = await install();
  // Both groups name the repo; only Alice's proved it. The question counts only her entry.
  assert.deepEqual((await findEarlier(fresh.id, { github_users: [user] }))!.roots, [alice.id, stranger.id]);
  assert.deepEqual(await offerPickup(fresh.id, { github_users: [user] }, linesOf(repo, fresh.id)), { question: 'Pick up your earlier entry?', entries: 1 });
  // Alice proves and says yes: only her group links.
  assert.deepEqual(await answerPickup(fresh.id, true, linesOf(repo, fresh.id)), { status: 'linked', entries: 1 });
  assert.equal((await connectInstallation(fresh.token))!.id, alice.id);
  assert.equal((await connectInstallation(stranger.token))!.id, stranger.id, 'the stranger is never linked');
  const [st] = await sql()<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${stranger.id}`;
  assert.equal(st.builder_id, null);
  // A stale offer naming the stranger's group links nothing of it either.
  const other = await install();
  await sql()`UPDATE installations SET pickup = ${sql().json({ offered: [stranger.id], repo, entries: 2 })} WHERE id = ${other.id}`;
  assert.deepEqual(await answerPickup(other.id, true, linesOf(repo, other.id)), { status: 'none' });
  assert.equal((await connectInstallation(stranger.token))!.id, stranger.id);
  // Only an unproven group names the repo: no offer at all.
  const user2 = `ghg${randomBytes(4).toString('hex')}`;
  const lone = await install({ github_user: user2 });
  await entry(lone.id, `https://github.com/${user2}/app`);
  const fresh2 = await install();
  assert.equal(await offerPickup(fresh2.id, { github_users: [user2] }, linesOf(`https://github.com/${user2}/app`, fresh2.id)), null);
});

// ---- v2.9 B9: identity linking accepts a GitHub sign-in (Pre-flight P8)

async function withSignIn<T>(fn: () => Promise<T>): Promise<T> {
  const old = [process.env.GITHUB_OAUTH_CLIENT_ID, process.env.GITHUB_OAUTH_CLIENT_SECRET];
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
  try {
    return await fn();
  } finally {
    if (old[0] === undefined) delete process.env.GITHUB_OAUTH_CLIENT_ID;
    else process.env.GITHUB_OAUTH_CLIENT_ID = old[0];
    if (old[1] === undefined) delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    else process.env.GITHUB_OAUTH_CLIENT_SECRET = old[1];
  }
}
const signedIn = (installationId: number, repoKey: string, purpose: 'entry' | 'pickup', at: Date) =>
  sql()`INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, verified_at, purpose)
    VALUES (${repoKey}, 'alice', ${installationId}, '2020-01-01', 3, ${at}, ${purpose})`;

test('5.11 v2.9 B9: answerPickup yes passes with a pickup sign-in of the offer\'s repo made after the offer; the reply carries the link until then', db, () =>
  withSignIn(async () => {
    const user = `ghv${randomBytes(4).toString('hex')}`;
    const repo = `https://github.com/${user}/tipjar`;
    const key = `${user}/tipjar`;
    const old = await install({ github_user: user });
    await entry(old.id, repo);
    const fresh = await install();
    const before = new Date(Date.now() - 60_000);
    assert.ok(await offerPickup(fresh.id, { github_users: [user] }, linesOf(repo, old.id)));
    const [{ pickup }] = await sql()<{ pickup: { at?: string } }[]>`SELECT pickup FROM installations WHERE id = ${fresh.id}`;
    assert.ok(pickup.at && !Number.isNaN(Date.parse(pickup.at)), 'the offer keeps when it was made');
    // No sign-in yet: the proof line, and the sign-in link.
    const needs = await answerPickup(fresh.id, true, linesOf(repo, old.id));
    assert.equal(needs.status, 'needs_proof');
    assert.match((needs as { sign_in?: string }).sign_in ?? '', /^https:\/\/earnkit\.com\/github\/verify\?n=[A-Za-z0-9_-]{43}$/);
    // A sign-in from before the offer, or for another purpose, doesn't count.
    await signedIn(fresh.id, key, 'pickup', before);
    await signedIn(fresh.id, key, 'entry', new Date());
    assert.equal((await answerPickup(fresh.id, true, linesOf(repo, old.id))).status, 'needs_proof');
    // A pickup sign-in after the offer: linked, with no proof line of this agent.
    await signedIn(fresh.id, key, 'pickup', new Date());
    assert.deepEqual(await answerPickup(fresh.id, true, linesOf(repo, old.id)), { status: 'linked', entries: 1 });
  }));

test('P8: an earlier group that signed in with GitHub for the repo counts as having proven it (F13)', db, () =>
  withSignIn(async () => {
    const user = `ghw${randomBytes(4).toString('hex')}`;
    const repo = `https://github.com/${user}/tipjar`;
    const old = await install({ github_user: user });
    await entry(old.id, repo);
    const fresh = await install();
    // No lines in the repo at all: unproven, never offered.
    assert.equal(await offerPickup(fresh.id, { github_users: [user] }, fileWith('')), null);
    await signedIn(old.id, `${user}/tipjar`, 'entry', new Date());
    assert.deepEqual(await offerPickup(fresh.id, { github_users: [user] }, fileWith('')), { question: 'Pick up your earlier entry?', entries: 1 });
    await signedIn(fresh.id, `${user}/tipjar`, 'pickup', new Date(Date.now() + 1000));
    assert.deepEqual(await answerPickup(fresh.id, true, fileWith('')), { status: 'linked', entries: 1 });
  }));

test('P8, C2: a hosted group never picks up, signed in or not', db, () =>
  withSignIn(async () => {
    const user = `ghx${randomBytes(4).toString('hex')}`;
    const shared = await install({ shared: true });
    await sql()`UPDATE installations SET pickup = ${sql().json({ offered: [shared.id + 1], repo: `https://github.com/${user}/app`, entries: 1, at: new Date(0).toISOString() })} WHERE id = ${shared.id}`;
    await signedIn(shared.id, `${user}/app`, 'pickup', new Date());
    assert.deepEqual(await answerPickup(shared.id, true, fileWith('')), { status: 'none' });
  }));

// ---- v2.9 T12 (Ruling G0): the v2.8.1 deferred minors N1, N2, N3

/** earnkit.txt reads, counted: the proof codes come from `text`. */
function countedFile(text: string) {
  const reads = { n: 0 };
  return { reads, deps: { owner: async () => (reads.n++, { status: 'ok' as const, text }), latest: async () => null } };
}
const launchedOn = (projectId: number, repo: string) =>
  sql()`
    UPDATE projects SET token_url = ${`https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`}, token_status = 'launched',
      token_repo_key = ${repo.replace('https://', '').toLowerCase()}
    WHERE id = ${projectId}`;

test('G0 N1: a newer entry planted on another of Alice\'s repos never blocks her honest pickup', db, async () => {
  const user = `ghn${randomBytes(4).toString('hex')}`;
  const tipjar = `https://github.com/${user}/tipjar`;
  // Alice's earlier install: her entry on tipjar, its token launched (proven).
  const alice = await install({ github_user: user });
  await launchedOn(await entry(alice.id, tipjar), tipjar);
  // A stranger then names another of her repos: the newest entry, never proven.
  const stranger = await install();
  await entry(stranger.id, `https://github.com/${user}/new-thing`);
  const fresh = await install();
  const found = (await findEarlier(fresh.id, { github_users: [user] }))!;
  assert.equal(found.repo, tipjar, 'the proof goes in the repo a matched group proved');
  assert.deepEqual(found.roots, [alice.id]);
  assert.deepEqual(await offerPickup(fresh.id, { github_users: [user] }, missing), { question: 'Pick up your earlier entry?', entries: 1 });
  assert.deepEqual(await answerPickup(fresh.id, true, linesOf(tipjar, fresh.id)), { status: 'linked', entries: 1 });
  assert.equal((await connectInstallation(fresh.token))!.id, alice.id);
  assert.equal((await connectInstallation(stranger.token))!.id, stranger.id, 'the stranger is never linked');
});

test('G0 N1: Alice\'s own newest repo unproven, an older one proven: the offer uses the proven one', db, async () => {
  const user = `gho${randomBytes(4).toString('hex')}`;
  const old = `https://github.com/${user}/old-app`;
  const alice = await install({ github_user: user });
  await launchedOn(await entry(alice.id, old), old);
  await entry(alice.id, `https://github.com/${user}/newest`);
  const fresh = await install();
  assert.equal((await findEarlier(fresh.id, { github_users: [user] }))!.repo, old);
  assert.deepEqual(await offerPickup(fresh.id, { github_users: [user] }, missing), { question: 'Pick up your 2 earlier entries?', entries: 2 });
});

test('G0 N2: list_programs reads earnkit.txt only when it can change the offer: never once asked, never when tokens prove it, at most once an hour otherwise', db, async () => {
  // Proven by a launched token: no read at all.
  const u1 = `ghp${randomBytes(4).toString('hex')}`;
  const r1 = `https://github.com/${u1}/app`;
  const a1 = await install({ github_user: u1 });
  await launchedOn(await entry(a1.id, r1), r1);
  const f1 = await install();
  const c1 = countedFile('');
  assert.ok(await offerPickup(f1.id, { github_users: [u1] }, c1.deps));
  assert.equal(c1.reads.n, 0, 'a launched token proves it without a read');
  // Asked already: no read on the next calls.
  assert.equal(await offerPickup(f1.id, { github_users: [u1] }, c1.deps), null);
  assert.equal(c1.reads.n, 0);

  // Unproven: one read, then none on repeated calls within the hour.
  const u2 = `ghq${randomBytes(4).toString('hex')}`;
  const r2 = `https://github.com/${u2}/app`;
  const a2 = await install({ github_user: u2 });
  await entry(a2.id, r2);
  const f2 = await install();
  const c2 = countedFile('');
  for (let i = 0; i < 3; i++) assert.equal(await offerPickup(f2.id, { github_users: [u2] }, c2.deps), null);
  assert.equal(c2.reads.n, 1, 'one read an hour for a group that has not proven the repo');
  // An hour later it reads again, and the group's line now counts.
  await sql()`UPDATE installations SET pickup = jsonb_set(pickup, '{read,at}', to_jsonb(${new Date(Date.now() - 3_601_000).toISOString()}::text)) WHERE id = ${f2.id}`;
  const c3 = countedFile(tokenLineFor(a2.id, r2)! + '\n');
  assert.deepEqual(await offerPickup(f2.id, { github_users: [u2] }, c3.deps), { question: 'Pick up your earlier entry?', entries: 1 });
  assert.equal(c3.reads.n, 1);
});

test('G0 N3: linking keeps the duplicate that holds the repo\'s token in the group, even when it was submitted later', db, async () => {
  const a = await install();
  const b = await install();
  const programId = `idt-${stamp()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')`;
  const repo = `https://github.com/dup-n3/app-${stamp()}`;
  const add = async (inst: number, ago: string) =>
    (await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url, submitted_at)
      VALUES (${programId}, 'App', ${inst}, ${repo}, now() - ${ago}::interval) RETURNING id`)[0].id;
  const earlier = await add(a.id, '2 hours');
  const laterWithToken = await add(b.id, '1 hour');
  await launchedOn(laterWithToken, repo);
  assert.equal(await linkInstallations(b.id, [a.id]), 1);
  const owner = async (id: number) => (await sql()<{ i: number }[]>`SELECT installation_id AS i FROM projects WHERE id = ${id}`)[0].i;
  assert.equal(await owner(laterWithToken), a.id, 'the entry with the token stays in the group\'s entries');
  assert.equal(await owner(earlier), b.id);
});
