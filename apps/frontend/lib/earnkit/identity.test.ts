import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { JOIN_QUESTIONS, JOIN_QUESTIONS_JOINER, answerJoin, answerPickup, coveredRoots, findEarlier, joinOnProvenTie, linkInstallations, offerPickup, pendingJoinOf, pickupQuestion, rootOf, statedUsers } from './identity';
import { dueSources } from './sources';
import { loginContests, loginStands, ruleContest } from './login-contests';
import { identityInput, noteIdentity } from './identity-input';
import { ensureProfile } from './profiles';
import { connectInstallation, saveInstallation, sharedGroup } from './installations';
import { readBank } from './answer-bank';
import { tokenLineFor } from './token-gate';
import { PICKUP_TEXT, yesNo, handlers, tools } from './tools';
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
  const tools_ = handlers as unknown as { list_programs: (i: unknown, c: unknown) => Promise<{ pick_up?: unknown; show_to_builder: string }> };
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
  const pick = handlers.pick_up_entries as (i: unknown, c: unknown) => Promise<Reply>;
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

test('Ruling H10 (I3): one question per reply: with a pickup, the reply asks only it; no lead question, no outcome ask; the lead comes on the next reply', db, async () => {
  const { upsertProgram } = await import('./programs');
  const { ProgramFile } = await import('./program-file');
  const { committedProgram } = await import('./fixtures/program-file');
  const user = `ghq${randomBytes(4).toString('hex')}`;
  const repo = `https://github.com/${user}/app`;
  const old = await install();
  await entry(old.id, repo);
  const fresh = await install();
  const arc = { ...committedProgram('arc-microgrants'), id: `idt-lead-${stamp()}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(arc));
  const GOOD = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };
  const fits = [{ repo: 'TipJar', repo_url: repo, verdicts: [{ program_id: arc.id, program: arc.id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }], product: GOOD }];
  type Listed = { show_to_builder: string; pick_up?: { question: string }; lead?: { program_id: string; repo: string }; ask_outcome?: unknown };
  const list = handlers.list_programs as (i: unknown, c: unknown) => Promise<Listed>;
  const ctx = {
    installationId: fresh.id, ownInstallationId: fresh.id, pickupDeps: linesOf(repo, old.id),
    matchProjects: async () => ({ checked: 1, scored: 1, fits }), roundPools: async () => new Map(), repoCoins: async () => new Map(),
  };
  try {
    const first = await list({ github_user: user }, ctx);
    assert.ok(first.pick_up, 'the pickup is offered');
    assert.ok(first.show_to_builder.startsWith(first.pick_up!.question), first.show_to_builder);
    assert.equal(first.show_to_builder.split('?').length - 1, 1, `exactly one question: ${first.show_to_builder}`);
    assert.doesNotMatch(first.show_to_builder, /Want me to finish it|Want the 3 easiest/);
    assert.ok(!('lead' in first) && !('ask_outcome' in first));
    // The pickup was asked; the next reply asks the lead's question, with lead.program_id.
    const next = await list({ github_user: user }, ctx);
    assert.ok(!next.pick_up);
    assert.match(next.show_to_builder, /Your TipJar can win 500 USDC on Arc by Oct 14\. Want me to finish it\?$/);
    assert.equal(next.show_to_builder.split('?').length - 1, 1);
    assert.deepEqual(next.lead, { program_id: arc.id, repo: 'TipJar' });
    // "show more": the tables carry no lead field (their close is the offer).
    const more = await list({ github_user: user, more: true }, ctx);
    assert.ok(!('lead' in more));
  } finally {
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${arc.id}`;
  }
});

// ---- v2.12.1 Task 5: the identity input and merges on proven ties only

const NOW = new Date('2026-10-14T12:00:00Z');
/** Runs `fn` with EARNKIT_BUILDER_SCORE and the event log on (the file's other cases run with them off). */
async function scoreOn<T>(fn: () => Promise<T>): Promise<T> {
  const was = { score: process.env.EARNKIT_BUILDER_SCORE, log: process.env.EARNKIT_EVENT_LOG };
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    return await fn();
  } finally {
    if (was.score === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was.score;
    if (was.log === undefined) delete process.env.EARNKIT_EVENT_LOG;
    else process.env.EARNKIT_EVENT_LOG = was.log;
  }
}
const person = async () => (await install()).id;

test('5.2 noteIdentity proposes agent sources and remembers the reported login, never as proof', db, () =>
  scoreOn(async () => {
    const id = await person();
    await ensureProfile(id, NOW);
    await noteIdentity(id, identityInput({ github_login: 'lee', projects: [{ name: 'TipJar', what: 'a tip jar', repo: 'lee/tipjar', live_url: 'https://tip.example.com' }] }), NOW);
    const [p] = await sql()`SELECT github_login, reported_github, identity->'projects'->0->>'what' AS what FROM builder_profiles WHERE builder_id = ${id}`;
    assert.deepEqual({ ...p }, { github_login: null, reported_github: 'lee', what: 'a tip jar' });
    const s = await sql()`SELECT kind, state, proposed_by FROM builder_sources WHERE builder_id = ${id} ORDER BY kind`;
    assert.deepEqual(s.map((r) => `${r.kind}:${r.state}:${r.proposed_by}`), ['repo:proposed:agent', 'site:proposed:agent']);
    const [e] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'identity_given' AND installation_id = ${id}`;
    assert.equal(e.n, 1);
    // Again the same day: no second event; the reported login is unchanged, so no new discovery.
    await sql()`UPDATE discovery_queue SET done_at = now() WHERE builder_id = ${id}`;
    await noteIdentity(id, identityInput({ github_login: 'lee', projects: [] }), NOW);
    const [e2] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'identity_given' AND installation_id = ${id}`;
    assert.equal(e2.n, 1);
    const [q] = await sql()<{ done: boolean }[]>`SELECT done_at IS NOT NULL AS done FROM discovery_queue WHERE builder_id = ${id}`;
    assert.equal(q.done, true);
  }));

test('5.2b noteIdentity proposes packages and chain-named contracts with their project key; wallets are remembered, never proven', db, () =>
  scoreOn(async () => {
    const id = await person();
    await ensureProfile(id, NOW);
    const w = '0x' + randomBytes(20).toString('hex');
    const c = 'base:0x' + randomBytes(20).toString('hex');
    await noteIdentity(id, identityInput({ projects: [{ name: 'Lib', package: 'left-pad' }, { name: 'Py', package: 'pypi:requests' }, { name: 'Coin', contracts: [c] }], wallets: [w] }), NOW);
    const s = await sql()`SELECT kind, ref, project_key FROM builder_sources WHERE builder_id = ${id} ORDER BY kind, ref`;
    assert.deepEqual(s.map((r) => `${r.kind}:${r.ref}:${r.project_key}`), [`contract:${c}:${c}`, 'package_npm:left-pad:left-pad', 'package_pypi:requests:pypi:requests']);
    const [iw] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM installation_wallets WHERE installation_id = ${id} AND wallet = ${w}`;
    assert.equal(iw.n, 1);
    const [pw] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM person_wallets WHERE wallet = ${w}`;
    assert.equal(pw.n, 0);
  }));

test('5.3 the same reported login or wallet on two installations never joins them', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    const w = '0x' + randomBytes(20).toString('hex');
    for (const id of [a, b]) {
      await ensureProfile(id, NOW);
      await noteIdentity(id, identityInput({ github_login: 'lee', wallets: [w] }), NOW);
    }
    assert.notEqual(await rootOf(a), await rootOf(b));
    assert.equal(await joinOnProvenTie(a, { github_login: 'lee' }), 0);
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

test('5.4 (fix rounds 1, 2) a GitHub login another group already proved asks both groups; only both yeses join, and the older page stays', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    const login = `lee-${b}`;
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await sql()`UPDATE builder_profiles SET x_user_id = ${`9${b}`}, x_handle = ${`h${b}`.slice(0, 15)}, claimed_at = now(), github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${b}`;
    const [{ slug: older }] = await sql()<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${a}`;
    assert.equal(await joinOnProvenTie(a, { github_login: login }), 1, 'one group asked');
    assert.notEqual(await rootOf(a), await rootOf(b), 'nothing joins before both say yes');
    assert.deepEqual(await pendingJoinOf(b), { installation_id: a, tie: 'github_login', side: 'target' });
    assert.deepEqual(await pendingJoinOf(a), { installation_id: a, tie: 'github_login', side: 'joiner' });
    assert.equal(await answerJoin(b, true), 'waiting');
    assert.notEqual(await rootOf(a), await rootOf(b), 'one yes never joins');
    assert.equal(await pendingJoinOf(b), null, 'answered');
    assert.equal(await answerJoin(a, true), 'linked');
    const root = await rootOf(a);
    assert.equal(root, await rootOf(b));
    assert.equal(await pendingJoinOf(root), null);
    // The older group (the earliest installation) keeps its page: a newer claim never takes it over.
    // The proven login fills its gap (as in v2.12), so the slug follows the login; the old one redirects.
    const [p] = await sql()`SELECT slug, x_user_id, x_handle, github_login FROM builder_profiles WHERE builder_id = ${root}`;
    assert.deepEqual({ ...p }, { slug: login, x_user_id: null, x_handle: null, github_login: login });
    const [h] = await sql()`SELECT builder_id FROM profile_slug_history WHERE old_slug = ${older}`;
    assert.equal(h.builder_id, root);
  }));

test('5.4b a GitHub sign-in: the first one for a login proves it with no question; a second group\'s is a pending join, never a merge; flag off nothing', db, async () => {
  const { saveVerification } = await import('./github-verify');
  const login = `sv-${stamp()}`.slice(0, 39);
  const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
  const row = (installation_id: number) => ({ installation_id, project_id: null, repo_key: `${login}/r`, purpose: 'entry' as const, wallet: null, symbol: null });
  const [a, b] = [await person(), await person()];
  await saveVerification(row(a), user, NOW);
  await saveVerification(row(b), user, NOW);
  assert.notEqual(await rootOf(a), await rootOf(b));
  const [none] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM pending_joins WHERE installation_id IN (${a}, ${b}) OR target IN (${a}, ${b})`;
  assert.equal(none.n, 0, 'flag off: no pending join');
  await scoreOn(async () => {
    const [c, d] = [await person(), await person()];
    const l2 = `${login}-2`.slice(0, 39);
    await saveVerification({ ...row(c), repo_key: `${l2}/r` }, { ...user, login: l2 }, NOW);
    assert.equal(await pendingJoinOf(c), null, 'the first sign-in for a login asks no one');
    await saveVerification({ ...row(d), repo_key: `${l2}/r` }, { ...user, login: l2 }, NOW);
    assert.notEqual(await rootOf(c), await rootOf(d));
    assert.deepEqual(await pendingJoinOf(c), { installation_id: d, tie: 'github_login', side: 'target' });
  });
});

test('5.12 phishing: a victim completing a sign-in link made for an attacker\'s agent never merges it; both agents are asked once; a no deletes; both yeses join', db, async () => {
  const { saveVerification } = await import('./github-verify');
  await scoreOn(async () => {
    const login = `vic-${stamp()}`.slice(0, 39);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const victim = await install();
    const ctxOf = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false }) as never;
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    await handlers.list_programs({}, ctxOf(victim.id));
    await signIn(victim.id);
    await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${victim.id}`;
    const [{ slug }] = await sql()<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${victim.id}`;
    // The attacker's agent sends the victim its sign-in link; the victim completes it.
    const attacker = await install();
    await handlers.list_programs({}, ctxOf(attacker.id));
    await signIn(attacker.id);
    assert.notEqual(await rootOf(attacker.id), await rootOf(victim.id), 'no merge');
    assert.equal((await pendingJoinOf(victim.id))?.side, 'target');
    assert.equal((await pendingJoinOf(attacker.id))?.side, 'joiner');
    // Each agent's next find carries the one yes, first, once.
    for (const id of [victim.id, attacker.id]) {
      const out = (await handlers.list_programs({}, ctxOf(id))) as { show_to_builder: string; pick_up?: { question: string } };
      // T6 carry: the target is asked about the other agent, the joining agent about itself.
      const want = id === victim.id ? JOIN_QUESTIONS.github_login : JOIN_QUESTIONS_JOINER.github_login;
      assert.ok(out.show_to_builder.startsWith(want), out.show_to_builder);
      assert.equal(out.pick_up?.question, want);
      assert.equal((out.show_to_builder.match(/\?/g) ?? []).length, 1, 'one question');
      const again = JSON.stringify(await handlers.list_programs({}, ctxOf(id)));
      assert.doesNotMatch(again, /[Aa]nother agent/, 'asked once');
    }
    // The attacker says yes: nothing joins. The victim says no: the pending join is gone.
    assert.match(JSON.stringify(await tools.tell({ pickup: 'yes' }, ctxOf(attacker.id))), /says yes too/);
    assert.notEqual(await rootOf(attacker.id), await rootOf(victim.id));
    await tools.tell({ pickup: 'no' }, ctxOf(victim.id));
    assert.equal(await pendingJoinOf(victim.id), null);
    assert.equal(await pendingJoinOf(attacker.id), null);
    assert.notEqual(await rootOf(attacker.id), await rootOf(victim.id));
    // Asked again later (a new sign-in), both yeses join; the older page stays, hidden stays hidden.
    await signIn(attacker.id);
    await tools.tell({ pickup: 'yes' }, ctxOf(attacker.id));
    assert.match(JSON.stringify(await tools.tell({ pickup: 'yes' }, ctxOf(victim.id))), /on your page now/);
    const root = await rootOf(victim.id);
    assert.equal(root, await rootOf(attacker.id));
    const [p] = await sql()`SELECT slug, hidden FROM builder_profiles WHERE builder_id = ${root}`;
    assert.deepEqual({ ...p }, { slug, hidden: true });
  });
});

test('5.13 (round 2 addendum) a merge keeps hide and held from either side: hide wins, a held score stays under review', db, () =>
  scoreOn(async () => {
    for (const side of ['root', 'other'] as const) {
      const [a, b] = [await person(), await person()];
      await ensureProfile(a, NOW);
      await ensureProfile(b, NOW);
      const [{ slug }] = await sql()<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${a}`;
      await sql()`UPDATE builder_profiles SET held = true, hidden = true WHERE builder_id = ${side === 'root' ? a : b}`;
      await sql()`INSERT INTO pending_joins (installation_id, target, tie, target_yes, joiner_yes) VALUES (${b}, ${a}, 'github_login', true, null)`;
      assert.equal(await answerJoin(b, true), 'linked');
      const [p] = await sql()`SELECT slug, held, hidden FROM builder_profiles WHERE builder_id = ${await rootOf(a)}`;
      assert.deepEqual({ ...p }, { slug, held: true, hidden: true }, side);
    }
  }));

test('5.14 a later find without identity keeps the last one; a merge keeps the side whose report has projects', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await noteIdentity(b, identityInput({ projects: [{ name: 'TipJar', what: 'a tip jar', repo: 'lee/tipjar' }] }), NOW);
    await noteIdentity(b, identityInput(undefined), NOW);
    const [kept] = await sql()`SELECT identity->'projects'->0->>'name' AS n FROM builder_profiles WHERE builder_id = ${b}`;
    assert.equal(kept.n, 'TipJar');
    await sql()`UPDATE builder_profiles SET identity = ${sql().json({ github_login: null, projects: [], wallets: [] })} WHERE builder_id = ${a}`;
    await linkInstallations(a, [b]);
    const [m] = await sql()`SELECT identity->'projects'->0->>'name' AS n FROM builder_profiles WHERE builder_id = ${await rootOf(a)}`;
    assert.equal(m.n, 'TipJar');
  }));

test('5.15 agent proposals are capped at 25 projects per person, in one insert; only reported or tracked ones are read, verified first', db, () =>
  scoreOn(async () => {
    const id = await person();
    await ensureProfile(id, NOW);
    const first = identityInput({ projects: Array.from({ length: 25 }, (_, k) => ({ name: `a${k}`, live_url: `https://a${k}-${id}.example.com` })) });
    assert.equal((await noteIdentity(id, first, NOW)).proposed, 25);
    const more = identityInput({ projects: Array.from({ length: 5 }, (_, k) => ({ name: `b${k}`, live_url: `https://b${k}-${id}.example.com` })) });
    assert.equal((await noteIdentity(id, more, NOW)).proposed, 0, 'a 26th project is refused');
    const [n] = await sql()<{ n: number }[]>`SELECT count(DISTINCT project_key)::int AS n FROM builder_sources WHERE builder_id = ${id} AND proposed_by = 'agent'`;
    assert.equal(n.n, 25);
    // The latest report names only b0..b4 (none proposed): of a0..a24 only tracked ones are read.
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, ${`https://a3-${id}.example.com`}, 'a3', 'app', false, false)`;
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof) VALUES (${id}, 'repo', ${`v${id}/x`}, ${`v${id}/x`}, 'server', 'verified', 'github_signin')`;
    const due = await dueSources('2999-01-01', 1000, [id]);
    assert.deepEqual(due.map((s) => s.ref), [`v${id}/x`, `https://a3-${id}.example.com`], 'verified first, then the tracked proposal');
    await noteIdentity(id, first, NOW);
    assert.equal((await dueSources('2999-01-01', 1000, [id])).length, 26, 'the latest report names them all again');
  }));

test('5.16 a merge moves the other\'s coin moments (a clash keeps the root\'s)', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await sql()`INSERT INTO coin_moments (builder_id, project_key, moment) VALUES (${a}, 'k', 'built_live'), (${b}, 'k', 'countable'), (${b}, 'j', 'first_five')`;
    await linkInstallations(a, [b]);
    const root = Math.min(a, b);
    const rows = await sql()`SELECT builder_id, project_key, moment FROM coin_moments WHERE builder_id IN (${a}, ${b}) ORDER BY project_key`;
    assert.deepEqual(rows.map((r) => `${r.builder_id}:${r.project_key}:${r.moment}`), [`${root}:j:first_five`, `${root}:k:${root === a ? 'built_live' : 'countable'}`]);
  }));

test('5.5 two people claimed with different X accounts are never joined by a GitHub tie', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    for (const id of [a, b]) {
      await ensureProfile(id, NOW);
      await sql()`UPDATE builder_profiles SET x_user_id = ${`8${id}`}, x_handle = ${`k${id}`.slice(0, 15)}, claimed_at = now() WHERE builder_id = ${id}`;
    }
    await sql()`UPDATE builder_profiles SET github_login = ${`ann-${b}`}, github_basis = 'signin' WHERE builder_id = ${b}`;
    assert.equal(await joinOnProvenTie(a, { github_login: `ann-${b}` }), 0);
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

test('5.6 a login proven only by the X field match never joins anyone', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    await sql()`UPDATE builder_profiles SET github_login = ${`zed-${b}`}, github_basis = 'x_match' WHERE builder_id = ${b}`;
    assert.equal(await joinOnProvenTie(a, { github_login: `zed-${b}` }), 0);
  }));

test('5.7 a shared client never joins, and the flag off joins no one', db, async () => {
  const login = `sh-${stamp()}`.slice(0, 39);
  const a = (await install({ shared: true })).id;
  const b = await person();
  await scoreOn(async () => {
    await ensureProfile(b, NOW);
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${b}`;
    assert.equal(await joinOnProvenTie(a, { github_login: login }), 0);
  });
  const c = await person();
  assert.equal(await joinOnProvenTie(c, { github_login: login }), 0);
  assert.notEqual(await rootOf(c), await rootOf(b));
});

test('5.8 merging moves claim codes and proven wallets, drops the loser\'s live score and projects, and re-reads the root', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    await ensureProfile(a, NOW);
    await ensureProfile(b, NOW);
    const w = '0x' + randomBytes(20).toString('hex');
    const code = `c-${stamp()}`;
    await sql()`INSERT INTO claim_codes (code_hash, builder_id) VALUES (${code}, ${b})`;
    await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${w}, ${b})`;
    for (const id of [a, b]) {
      await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
        VALUES (${id}, 10, '{}'::jsonb, false, 0, 0, 'v2', 'c', now(), now())`;
      await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, 'k', 'K', 'code', false, false)`;
    }
    await linkInstallations(a, [b]);
    const root = Math.min(a, b);
    const other = Math.max(a, b);
    const [cc] = await sql()`SELECT builder_id FROM claim_codes WHERE code_hash = ${code}`;
    assert.equal(cc.builder_id, root);
    const [pw] = await sql()`SELECT builder_id FROM person_wallets WHERE wallet = ${w}`;
    assert.equal(pw.builder_id, root);
    assert.equal((await sql()`SELECT 1 FROM builder_live WHERE builder_id = ${other}`).length, 0);
    assert.equal((await sql()`SELECT 1 FROM builder_projects WHERE builder_id = ${other}`).length, 0);
    const [live] = await sql()`SELECT read_at FROM builder_live WHERE builder_id = ${root}`;
    assert.equal(live.read_at, null);
  }));

test('5.9 linking never merges two people with different X accounts (pickup or any other path)', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    for (const id of [a, b]) {
      await ensureProfile(id, NOW);
      await sql()`UPDATE builder_profiles SET x_user_id = ${`7${id}`}, x_handle = ${`m${id}`.slice(0, 15)}, claimed_at = now() WHERE builder_id = ${id}`;
    }
    await linkInstallations(a, [b]);
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

test('5.10 flag on, find takes identity and never offers a pickup; flag off, identity is ignored', db, async () => {
  const repo = `https://github.com/pk${process.pid}${Date.now()}/tipjar`;
  const owner = repo.split('/')[3];
  const earlier = await install({ github_user: owner });
  await entry(earlier.id, repo);
  const ctx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false, pickupDeps: linesOf(repo, earlier.id) }) as never;
  const on = await install();
  await scoreOn(async () => {
    const out = (await handlers.list_programs({ github_user: owner, identity: { github_login: owner, projects: [{ name: 'TipJar', what: 'a tip jar', repo }] } }, ctx(on.id))) as Record<string, unknown>;
    assert.ok(!JSON.stringify(out).includes('Pick up'), JSON.stringify(out));
    const [p] = await sql()`SELECT reported_github FROM builder_profiles WHERE builder_id = ${on.id}`;
    assert.equal(p.reported_github, owner);
  });
  const off = await install();
  const before = await handlers.list_programs({ github_user: owner }, ctx(off.id));
  assert.match(JSON.stringify(before), /Pick up/);
  const [none] = await sql()`SELECT count(*)::int AS n FROM builder_profiles WHERE builder_id = ${off.id}`;
  assert.equal(none.n, 0);
});

test('5.11 a deploy wallet the agent typed joins no one (held for the owner\'s ruling: it is agent-reported)', db, () =>
  scoreOn(async () => {
    const [a, b] = [await person(), await person()];
    const w = '0x' + randomBytes(20).toString('hex');
    for (const id of [a, b])
      await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, owner_wallet)
        VALUES (${id}, ${`installation:${id}`}, ${`o/r${id}`}, 'base', ${`0x${randomBytes(32).toString('hex')}`}, 'deployed', 0, ${w})`;
    assert.equal(await joinOnProvenTie(a, { deploy_wallet: w }), 0);
    assert.notEqual(await rootOf(a), await rootOf(b));
  }));

// ---- Fix round 2: contested GitHub logins, and every merge path needs both yeses

/** A ReaderDeps whose GitHub answers come from `gh`; any other read throws. */
function ghReader(gh: Record<string, unknown>): never {
  const no = async () => {
    throw new Error('unexpected read');
  };
  return {
    gh: async (path: string) => {
      if (!(path in gh)) throw new Error(`no fake for ${path}`);
      return gh[path];
    },
    probe: no, fetchText: no, json: no, baseTxs: no, ghGraphql: no, tokenTransfers: no, contractOrigin: no,
    arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, now: NOW,
  } as never;
}
const discoverAs = async (root: number, login: string, twitter: string | null) => {
  const { discover } = await import('./discovery');
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${root}, 'signin') ON CONFLICT (builder_id) DO UPDATE SET done_at = NULL`;
  await discover(NOW, {
    deadline: Date.now() + 30_000, only: [root], login: async () => ({ login, basis: 'signin' }),
    reader: ghReader({ [`/users/${login}`]: { twitter_username: twitter }, [`/users/${login}/repos?type=owner&per_page=100`]: [], [`/users/${login}/orgs`]: [] }),
  });
};

test('5.17 reverse phish: the attacker\'s group proved the login first; the victim\'s own later sign-in never merges without both yeses, and the login stands for neither', db, async () => {
  const { saveVerification } = await import('./github-verify');
  await scoreOn(async () => {
    const login = `rv-${stamp()}`.slice(0, 39);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    const attacker = await person();
    await ensureProfile(attacker, NOW);
    await signIn(attacker); // the victim completed the attacker's link first
    await discoverAs(attacker, login, 'vicx');
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof) VALUES (${attacker}, 'repo', ${`${login}/app`}, ${`${login}/app`}, 'server', 'verified', 'repo_owner')`;
    const [held] = await sql()`SELECT github_login FROM builder_profiles WHERE builder_id = ${attacker}`;
    assert.equal(held.github_login, login, 'uncontested: the first proof stands');
    const victim = await person();
    await ensureProfile(victim, NOW);
    await signIn(victim);
    assert.notEqual(await rootOf(victim), await rootOf(attacker));
    assert.equal((await pendingJoinOf(attacker))?.side, 'target');
    assert.equal((await pendingJoinOf(victim))?.side, 'joiner');
    assert.equal(await answerJoin(attacker, true), 'waiting');
    assert.notEqual(await rootOf(victim), await rootOf(attacker), 'the holder\'s yes alone never merges');
    assert.equal(await answerJoin(victim, false), 'declined');
    assert.notEqual(await rootOf(victim), await rootOf(attacker));
    // Contested: the attacker's page loses the login and its GitHub work is not yet confirmed.
    const [a] = await sql()`SELECT github_login, github_basis FROM builder_profiles WHERE builder_id = ${attacker}`;
    assert.deepEqual({ ...a }, { github_login: null, github_basis: null });
    const [src] = await sql()`SELECT state, proof FROM builder_sources WHERE builder_id = ${attacker} AND ref = ${`${login}/app`}`;
    assert.deepEqual({ ...src }, { state: 'proposed', proof: null });
    assert.equal(await loginStands(attacker, login, 'vicx'), false);
    assert.equal(await loginStands(victim, login, 'vicx'), false);
  });
});

test('5.18 a contested login is confirmed for neither, then for the group whose confirmed X is the one GitHub lists; the admin list shows it and a ruling settles it', db, async () => {
  const { saveVerification } = await import('./github-verify');
  await scoreOn(async () => {
    const login = `ct-${stamp()}`.slice(0, 39);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    const [a, b] = [await person(), await person()];
    for (const id of [a, b]) {
      await ensureProfile(id, NOW);
      await signIn(id);
    }
    const handle = `cx${b}`.slice(0, 15);
    for (const id of [a, b]) await discoverAs(id, login, handle);
    const logins = async () => (await sql()`SELECT builder_id, github_login FROM builder_profiles WHERE builder_id IN (${a}, ${b}) ORDER BY builder_id`).map((r) => r.github_login);
    assert.deepEqual(await logins(), [null, null], 'contested: confirmed for neither');
    const listed = (await loginContests()).find((c) => c.login === login);
    assert.deepEqual(listed?.groups, [a, b].sort((x, y) => x - y));
    // a claims a different X; b claims the X GitHub lists: b's next discovery confirms the login.
    await sql()`UPDATE builder_profiles SET x_user_id = ${`5${a}`}, x_handle = ${`ax${a}`.slice(0, 15)}, claimed_at = now() WHERE builder_id = ${a}`;
    await sql()`UPDATE builder_profiles SET x_user_id = ${`5${b}`}, x_handle = ${handle}, claimed_at = now() WHERE builder_id = ${b}`;
    for (const id of [a, b]) await discoverAs(id, login, handle);
    const [pa, pb] = await logins();
    assert.deepEqual([pa, pb], [null, login]);
    // The owner rules for a instead: b loses it, a gets it on its next discovery.
    await ruleContest(login, a);
    for (const id of [b, a]) await discoverAs(id, login, handle);
    assert.deepEqual(await logins(), [login, null]);
    assert.equal((await loginContests()).find((c) => c.login === login)?.ruled, a);
  });
});

test('5.19 the admin page lists contested logins with a confirm button per group (POST rule_login)', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../../app/admin/scores/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /loginContests\(\)/);
  assert.match(page, /name="action" value="rule_login"/);
});

test('5.20 every merge path needs both yeses: with the flag on, a v2.9 pickup yes never links', db, async () => {
  const repo = `https://github.com/pz${process.pid}${Date.now()}/tipjar`;
  const earlier = await install({ github_user: repo.split('/')[3] });
  await entry(earlier.id, repo);
  const later = await install();
  const offered = await offerPickup(later.id, { github_users: [repo.split('/')[3]] }, linesOf(repo, earlier.id));
  assert.ok(offered);
  await scoreOn(async () => {
    const r = await answerPickup(later.id, true, linesOf(repo, earlier.id, later.id));
    assert.equal(r.status, 'none');
    assert.notEqual(await rootOf(later.id), await rootOf(earlier.id));
  });
});

// ---- v2.12.1 Task 6 carries (binding): the X claim against contested logins, dormant installs, the joiner's question

test('6.13 reverse phish with X: an attacker holding a victim\'s login claims their own X, then names the victim\'s X through setXHandle: still not confirmed', db, async () => {
  const { saveVerification } = await import('./github-verify');
  const { bindX } = await import('./claim');
  const { setXHandle } = await import('./profiles');
  await scoreOn(async () => {
    const login = `rx-${stamp()}`.slice(0, 39);
    const victimX = `vx${process.pid}`.slice(0, 15);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    const [attacker, victim] = [await person(), await person()];
    for (const id of [attacker, victim]) await ensureProfile(id, NOW);
    await signIn(attacker); // the victim completed the attacker's link first
    await signIn(victim);
    // The attacker claims their own X, and its prefill is the victim's X (GitHub's field).
    await bindX(attacker, { id: `7${attacker}`, username: `ax${attacker}`.slice(0, 15), name: 'A', avatar: null }, NOW);
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin', twitter_prefill = ${victimX} WHERE builder_id = ${attacker}`;
    const r = await setXHandle(attacker, 'yes');
    assert.equal(r.ok, false, 'a claimed page never takes a handle through setXHandle');
    const [p] = await sql()`SELECT x_handle FROM builder_profiles WHERE builder_id = ${attacker}`;
    assert.equal(p.x_handle, `ax${attacker}`.slice(0, 15));
    assert.equal(await loginStands(attacker, login, victimX), false);
    // A handle written straight into x_handle without a claim never stands either.
    await sql()`UPDATE builder_profiles SET x_handle = ${victimX} WHERE builder_id = ${victim}`;
    assert.equal(await loginStands(victim, login, victimX), false, 'unclaimed: no X claim, no standing');
  });
});

test('6.14 (fix round 1) a dormant prover still contests: an old install that proved the login is a second group, and neither stands', db, async () => {
  const { saveVerification } = await import('./github-verify');
  const { contestants } = await import('./login-contests');
  await scoreOn(async () => {
    const login = `dm-${stamp()}`.slice(0, 39);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    const [old, fresh] = [await person(), await person()];
    await signIn(old);
    await sql()`UPDATE installations SET last_seen_at = now() - interval '31 days' WHERE id = ${old}`;
    await ensureProfile(fresh, NOW);
    await signIn(fresh);
    assert.deepEqual(await contestants(login), [old, fresh].sort((a, b) => a - b));
    assert.equal(await loginStands(fresh, login, null), false, 'contested: no one stands without a ruling or a matching X claim');
    assert.ok((await loginContests()).some((c) => c.login === login));
  });
});

test('6.14b (fix round 1) the stuck case: a dormant group holding the login in its profile is released when another group proves it; a matching X claim then stands', db, async () => {
  const { saveVerification } = await import('./github-verify');
  const { bindX } = await import('./claim');
  await scoreOn(async () => {
    const login = `st-${stamp()}`.slice(0, 39);
    const twitter = `tw${process.pid}${Date.now() % 1000}`.slice(0, 15);
    const user = { login, created_at: new Date('2020-01-01'), public_repos: 3 };
    const signIn = (id: number) => saveVerification({ installation_id: id, project_id: null, repo_key: `${login}/app`, purpose: 'entry', wallet: null, symbol: null }, user, NOW);
    const [old, fresh] = [await person(), await person()];
    await ensureProfile(old, NOW);
    await signIn(old);
    await sql()`UPDATE builder_profiles SET github_login = ${login}, github_basis = 'signin' WHERE builder_id = ${old}`;
    await sql()`UPDATE installations SET last_seen_at = now() - interval '90 days' WHERE id = ${old}`;
    await ensureProfile(fresh, NOW);
    await signIn(fresh);
    const [o] = await sql()`SELECT github_login FROM builder_profiles WHERE builder_id = ${old}`;
    assert.equal(o.github_login, null, 'the dormant holder no longer stands, so it lets go');
    assert.equal(await loginStands(fresh, login, twitter), false);
    await bindX(fresh, { id: `6${fresh}`, username: twitter, name: 'F', avatar: null }, NOW);
    assert.equal(await loginStands(fresh, login, twitter), true, 'the X GitHub lists, claimed: it stands');
    await discoverAs(fresh, login, twitter);
    const [f] = await sql()`SELECT github_login FROM builder_profiles WHERE builder_id = ${fresh}`;
    assert.equal(f.github_login, login);
  });
});

test('6.15 the joining agent\'s question reads for the agent that just signed in; the holder keeps "Another agent ..."', () => {
  assert.equal(JOIN_QUESTIONS.github_login, 'Another agent signed in as your GitHub. Add it to your page?');
  assert.equal(JOIN_QUESTIONS.x_user_id, 'Another agent signed in with your X. Add it to your page?');
  for (const q of Object.values(JOIN_QUESTIONS_JOINER)) {
    assert.match(q, /Add this agent to your EarnKit page\?$/);
    assert.equal((q.match(/\?/g) ?? []).length, 1);
    assert.doesNotMatch(q, /—|–|^Another agent/);
  }
});
