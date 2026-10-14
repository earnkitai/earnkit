import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { bindX } from './claim';
import { personCode } from './attribution';
import { COUNT_LINES, countableNow, moveUpNo, moveUpYes, nowRank } from './make-countable';
import { refreshPerson, rescorePerson, trackingHeld } from './person-score';
import { FORMULA_V2 } from './score-v2';
import { ProgramFile } from './program-file';
import { listPrograms, upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { STARTERS } from './starters';
import { currentStep } from './stand-view';
import type { ReaderDeps } from './source-readers';

/**
 * v2.12.1 T9 (spec 3): one yes makes a project's use countable. Count past users (a provable
 * contract is tracked at once; an unprovable one gets the one-tap link), count future users (the
 * attribution line for the agent), a way to take tips (the tip-jar steps for the agent), and a no
 * that keeps the step away for 30 days. DB-gated; every chain read is a fake.
 */

process.env.EARNKIT_AUTH_SECRET ||= 'v2121-t9-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const ENV = { EARNKIT_BUILDER_SCORE: 'on', X_CLIENT_ID: 'v2121-t9-x', X_CLIENT_SECRET: 'v2121-t9-xs' } as const;
for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
const NOW = new Date();
const DAY = 86_400_000;
const randomAddress = () => '0x' + randomBytes(20).toString('hex');

async function profile(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t9-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`t9-${id}`})`;
  return id;
}
/** A person with a page (X claimed). */
async function claimed(handle: string): Promise<number> {
  const id = await profile();
  const r = await bindX(id, { id: `t9${randomBytes(6).toString('hex')}`, username: `${handle}${randomBytes(2).toString('hex')}`, name: handle, avatar: null }, NOW);
  assert.equal(r.ok, true);
  return id;
}
const unclaimed = profile;

/**
 * A chain where the contract was created by `deployer` and called by `callers` other people, spread
 * over 10 days (no burst), each once. Every other read throws (discovery's GitHub reads fail alone).
 */
function fakeChain(o: { deployer: string; callers: number; codes?: string }): ReaderDeps {
  const no = async (): Promise<never> => {
    throw new Error('unexpected read');
  };
  const items = Array.from({ length: o.callers }, (_, i) => ({
    timestamp: new Date(NOW.getTime() - (1 + (i % 10)) * DAY).toISOString(),
    status: 'ok',
    from: { hash: randomAddress() },
    value: '0',
    ...(o.codes && { raw_input: o.codes }),
  }));
  return {
    gh: no, ghGraphql: no, probe: no, fetchText: no, json: no, tokenTransfers: no, arcLogs: no, arcHead: no, arcSender: no,
    baseTxs: async () => ({ items, next_page_params: null }),
    contractOrigin: async () => ({ deployer: o.deployer, created_at: '2026-01-02T00:00:00Z' }),
    usdPerNative: async () => 3000,
    walletCreations: async () => [],
    now: NOW,
  };
}
/** Read the person's sources now and rescore (the guard cleared), as find's refresh does. */
async function refresh(id: number, reader: ReaderDeps) {
  await sql()`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${id}`;
  await refreshPerson(id, { now: NOW, deadline: Date.now() + 8000, reader });
}
/** A contract the agent reported for a project named `name` (identity), then one refresh. */
async function agentContract(id: number, name: string, ref: string, reader: ReaderDeps) {
  await sql()`UPDATE builder_profiles SET identity = ${sql().json({ github_login: null, wallets: [], projects: [{ name, what: null, repo: null, live_url: null, package: null, contracts: [ref] }] } as never)} WHERE builder_id = ${id}`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by) VALUES (${id}, 'contract', ${ref}, ${ref}, 'proposed', 'agent')`;
  await refresh(id, reader);
}
/** A contract EarnKit tracks (verified, EarnKit deployed it) for project `key`. */
async function trackedContract(id: number, key: string, ref: string) {
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by, proof, verified_at) VALUES (${id}, 'contract', ${ref}, ${key}, 'verified', 'server', 'deployer', now())`;
  await rescorePerson(id, NOW);
}
/** A live app with no payment side yet, as the rescore leaves it. */
async function siteProject(id: number, key: string, name: string, what: string) {
  await sql()`
    INSERT INTO builder_projects (builder_id, project_key, name, what, link, kind, confirmed, shipped, people, last_active_at)
    VALUES (${id}, ${key}, ${name}, ${what}, ${`https://${key}.example.com`}, 'app', true, true, 0, now())`;
}
const TESTED = { ...STARTERS, 'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: NOW.toISOString().slice(0, 10) } };
const FRESH = { deployOn: () => true, hostOn: true, starters: TESTED };
/**
 * An open program with the arc-tipjar starter, open only while `fn` runs: other test files share the
 * DB, and an open Easy program changes their fresh build.
 */
async function withTips<T>(fn: (program: string) => Promise<T>): Promise<T> {
  const p = { ...committedProgram('arc-microgrants'), id: `v2121-t9-tips-${randomBytes(4).toString('hex')}`, status: 'active', ends_at: new Date(NOW.getTime() + 7 * DAY).toISOString() };
  await upsertProgram(ProgramFile.parse(p));
  try {
    return await fn(p.id);
  } finally {
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${p.id}`;
  }
}
const step = (id: number) => currentStep(id, { fresh: FRESH });
/**
 * T10 fix round 1 (minor): only this test's tip-jar program for this person. Other test files leave
 * open programs with the arc-tipjar starter in the shared DB; they are hidden for this person only
 * ("not interested", per installation), so nothing global changes.
 */
async function onlyTips(id: number, program: string) {
  const others = (await listPrograms()).filter((c) => c.fresh_build?.starter === 'arc-tipjar' && c.id !== program);
  for (const c of others)
    await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status) VALUES (${id}, '', ${c.id}, 'not_interested') ON CONFLICT DO NOTHING`;
}

test('9.4 count past users: a provable contract counts at once and the reply names the people and the rank', dbTest, async () => {
  const id = await claimed('tf_dev');
  const [W, C] = [randomAddress(), randomAddress()];
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const reader = fakeChain({ deployer: W, callers: 140 });
  await agentContract(id, 'tokens.fun', `base:${C}`, reader);
  const s0 = await step(id);
  assert.equal(s0?.kind, 'count_past');
  assert.match(s0!.line, /Your rank goes up today\.$/, 'provable and not held: the step promises it');
  assert.equal(await countableNow(id, `base:${C}`, reader), true);
  const r = await moveUpYes(id, `base:${C}`, NOW, { reader });
  // The rank part depends on how many people the shared DB has ranked: either wording, or none.
  assert.match(r.show_to_builder, /^Done\. 140 people who used tokens\.fun now count\.( You're now (#\d+ of \d+|in the top \d+% of people building with AI)\.)?$/);
  const [s] = await sql()`SELECT state, proof FROM builder_sources WHERE builder_id = ${id} AND ref = ${`base:${C}`}`;
  assert.deepEqual({ ...s }, { state: 'verified', proof: 'deploy_wallet' });
  // Counted now: the step moves on (no longer count_past).
  assert.notEqual((await step(id))?.kind, 'count_past');
});

test('9.5 an unprovable contract is not counted; the one tap to prove it is the reply', dbTest, async () => {
  const id = await claimed('tf_dev2');
  const C2 = randomAddress();
  const reader = fakeChain({ deployer: randomAddress(), callers: 10 });
  await agentContract(id, 'tokens.fun', `base:${C2}`, reader);
  const s0 = await step(id);
  assert.equal(s0?.kind, 'count_past');
  assert.match(s0!.line, /I'll send you a link to show it's yours\.$/);
  assert.equal(await countableNow(id, `base:${C2}`, reader), false);
  const r = await moveUpYes(id, `base:${C2}`, NOW, { reader });
  assert.match(r.show_to_builder, /^One tap shows it's yours: https:\/\/earnkit\.com\/claim\/wallet\?t=\S+$/);
  const [s] = await sql()`SELECT state FROM builder_sources WHERE builder_id = ${id} AND ref = ${`base:${C2}`}`;
  assert.equal(s.state, 'proposed', 'nothing is decided from a yes it cannot prove');
});

test('9.5b an unclaimed person is sent to the claim first (the wallet page needs a claimed page)', dbTest, async () => {
  const id = await unclaimed();
  const ref = `base:${randomAddress()}`;
  const reader = fakeChain({ deployer: randomAddress(), callers: 10 });
  await agentContract(id, 'tokens.fun', ref, reader);
  const r = await moveUpYes(id, ref, NOW, { reader });
  assert.match(r.show_to_builder, /^Claim your page with X first: earnkit\.com\/claim\/[a-z2-7]{12}$/);
});

test('9.6 future users: the reply is one line and the agent gets the suffix to add; tags with the person code count', dbTest, async () => {
  const id = await claimed('tag_dev');
  const C3 = randomAddress();
  await trackedContract(id, 'lee/app', `base:${C3}`);
  assert.equal((await step(id))?.kind, 'tag_future');
  const r = await moveUpYes(id, 'lee/app', NOW, { reader: fakeChain({ deployer: randomAddress(), callers: 0 }) });
  assert.equal(r.show_to_builder, COUNT_LINES.added);
  assert.equal(r.show_to_builder, 'Added. People using it will count as they come in.');
  assert.deepEqual(r.attribution!.codes, [personCode(id), 'earnkit']);
  assert.match(r.agent_note!, /data_suffix/);
  // Calls carrying the person's own code are tagged on their own tracked contract.
  await refresh(id, fakeChain({ deployer: randomAddress(), callers: 12, codes: `0xa9059cbb${r.attribution!.data_suffix.slice(2)}` }));
  const [p] = await sql()<{ tagged: boolean }[]>`SELECT tagged FROM builder_projects WHERE builder_id = ${id} AND project_key = 'lee/app'`;
  assert.equal(p.tagged, true);
  assert.notEqual((await step(id))?.kind, 'tag_future', 'tagged: no longer offered');
});

test('9.6b future users on a contract EarnKit does not track yet: proven first, never promised', dbTest, async () => {
  const id = await claimed('tag_dev2');
  const ref = `base:${randomAddress()}`;
  // A proposed contract with no past callers: no count_past step, so the step is to tag it.
  const reader = fakeChain({ deployer: randomAddress(), callers: 0 });
  await agentContract(id, 'app', ref, reader);
  const s0 = await step(id);
  // Not confirmed (a claimed person): confirming it comes before tagging.
  assert.equal(s0?.kind, 'confirm');
  await sql()`UPDATE builder_projects SET confirmed = true WHERE builder_id = ${id}`;
  assert.equal((await step(id))?.kind, 'tag_future');
  const r = await moveUpYes(id, ref, NOW, { reader });
  assert.match(r.show_to_builder, /^One tap shows it's yours: https:\/\/earnkit\.com\/claim\/wallet\?t=/);
  assert.equal(r.attribution, undefined);
});

test('9.7 a payment side: the agent gets the tip-jar steps for that app; the deploy enters nothing', dbTest, () =>
  withTips(async (program) => {
    const id = await claimed('shop_dev');
    await siteProject(id, 'shop', 'Shop', 'a coffee shop site');
    await onlyTips(id, program);
    assert.equal((await step(id))?.kind, 'payment');
    const r = await moveUpYes(id, 'shop', NOW, { fresh: FRESH });
    assert.equal(r.show_to_builder, "On it. I'll tell you when people can tip.");
    assert.deepEqual(r.prepare, { program_id: program, starter: 'arc-tipjar' });
    assert.match(r.agent_note!, /arc-tipjar/);
    // Ruling 3: the tip jar never enters a grant the builder didn't choose.
    assert.match(r.agent_note!, /never call confirm for this program unless the builder asks/);
    assert.match(r.agent_note!, /tips: true/);
    const [entry] = await sql()`SELECT 1 FROM projects WHERE installation_id = ${id}`;
    assert.equal(entry, undefined);
    // Nothing EarnKit can deploy to: said plainly, nothing promised, and the step isn't offered.
    const offFresh = { ...FRESH, deployOn: () => false };
    const off = await moveUpYes(id, 'shop', NOW, { fresh: offFresh });
    assert.equal(off.show_to_builder, COUNT_LINES.noted);
    assert.equal(await currentStep(id, { fresh: offFresh }), null);
  }),
);

test('9.7c payment uses the real entered and hidden programs: an entered one is reused, a hidden one never', dbTest, () =>
  withTips(async (program) => {
    const id = await claimed('shop_dev3');
    await siteProject(id, 'shop', 'Shop', 'a coffee shop site');
    await onlyTips(id, program);
    await sql()`INSERT INTO projects (installation_id, program_id, name, repo_url) VALUES (${id}, ${program}, 'Shop', 'https://github.com/lee/shop')`;
    const r = await moveUpYes(id, 'shop', NOW, { fresh: FRESH });
    assert.deepEqual(r.prepare, { program_id: program, starter: 'arc-tipjar' }, 'reused, never a second entry');
    const n = await sql()`SELECT 1 FROM projects WHERE installation_id = ${id}`;
    assert.equal(n.length, 1);
    // Hidden ("not interested"): no tip jar under it, so no payment step at all.
    const other = await claimed('shop_dev4');
    await siteProject(other, 'shop', 'Shop', 'a coffee shop site');
    await onlyTips(other, program);
    assert.equal((await step(other))?.kind, 'payment');
    await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status) VALUES (${other}, '', ${program}, 'not_interested')`;
    assert.equal(await step(other), null);
  }),
);

test('9.7b an app that already takes tips is never offered a way to take tips', dbTest, () =>
  withTips(async () => {
    const id = await claimed('tj_dev');
    await siteProject(id, 'tipjar', 'tipjar', 'a tip jar');
    assert.equal(await step(id), null);
  }),
);

test('9.8 a no: nothing changes, "Okay.", and that step is not offered again for 30 days', dbTest, () =>
  withTips(async () => {
    const id = await claimed('no_dev');
    await siteProject(id, 'shop', 'Shop', 'a coffee shop site');
    assert.equal((await step(id))?.kind, 'payment');
    const r = await moveUpNo(id, NOW, null, FRESH);
    assert.equal(r.show_to_builder, COUNT_LINES.noted);
    assert.equal(r.show_to_builder, 'Okay.');
    assert.equal(await step(id), null);
    // 31 days later it may come back.
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{declined}', ${sql().json({ 'payment:shop': new Date(NOW.getTime() - 31 * DAY).toISOString() } as never)})
      WHERE builder_id = ${id}`;
    assert.equal((await step(id))?.kind, 'payment');
  }),
);

test('9.9 a yes to a step that no longer applies (another project of theirs named) changes nothing', dbTest, () =>
  withTips(async () => {
    const id = await claimed('gone_dev');
    await siteProject(id, 'shop', 'Shop', 'a coffee shop site');
    await siteProject(id, 'notes', 'Notes', 'a notes app');
    const r = await moveUpYes(id, 'notes', NOW, { fresh: FRESH });
    assert.equal(r.show_to_builder, COUNT_LINES.noted);
    assert.equal(r.prepare, undefined);
  }),
);

test('9.4c count past users while the rescore is held: no "today" promise; the done line says the rank shows after a review', dbTest, async () => {
  const id = await claimed('held_dev');
  const [W, C] = [randomAddress(), randomAddress()];
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const reader = fakeChain({ deployer: W, callers: 140 });
  await agentContract(id, 'tokens.fun', `base:${C}`, reader);
  // A public score of 0 yesterday: counting 140 people is a jump the owner reviews first.
  await sql()`
    INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${new Date(NOW.getTime() - DAY).toISOString().slice(0, 10)}, 0, 0, '{}'::jsonb, '{}'::jsonb, ${FORMULA_V2}, 'v2-launch', false)`;
  assert.equal(await trackingHeld(id, `base:${C}`, NOW), true);
  const s0 = await step(id);
  assert.equal(s0?.kind, 'count_past');
  assert.equal(s0!.line, "tokens.fun has people using it who aren't counted yet. Want me to count them?");
  const r = await moveUpYes(id, `base:${C}`, NOW, { reader });
  assert.equal(r.show_to_builder, 'Done. 140 people who used tokens.fun now count. Your new rank shows after a quick review.');
  // The dry run wrote nothing; the real count did.
  const [s] = await sql()`SELECT state FROM builder_sources WHERE builder_id = ${id} AND ref = ${`base:${C}`}`;
  assert.equal(s.state, 'verified');
});

test('9.16 a step is offered only when its yes can deliver (ruling 4)', dbTest, async () => {
  // Unclaimed with X sign-in off: no claim link and no wallet page, so an unprovable contract is no step.
  const id = await unclaimed();
  const ref = `base:${randomAddress()}`;
  const reader = fakeChain({ deployer: randomAddress(), callers: 10 });
  await agentContract(id, 'tokens.fun', ref, reader);
  assert.equal((await step(id))?.kind, 'count_past');
  const was = { a: process.env.X_CLIENT_ID, b: process.env.X_CLIENT_SECRET };
  delete process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_SECRET;
  try {
    assert.notEqual((await step(id))?.kind, 'count_past');
  } finally {
    process.env.X_CLIENT_ID = was.a;
    process.env.X_CLIENT_SECRET = was.b;
  }
  // No secret: no person code, so no future-users step (and no wallet page for a claimed person).
  const tagger = await claimed('tag_dev3');
  await trackedContract(tagger, 'lee/app2', `base:${randomAddress()}`);
  assert.equal((await step(tagger))?.kind, 'tag_future');
  const secret = process.env.EARNKIT_AUTH_SECRET;
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    assert.notEqual((await step(tagger))?.kind, 'tag_future');
  } finally {
    process.env.EARNKIT_AUTH_SECRET = secret;
  }
});

test('9.10 the rank words after a count: "#3 of 40" under 50 ranked, then the top share, else nothing', () => {
  assert.equal(nowRank({ ranked: true, rank: 3, total: 40 }), "You're now #3 of 40.");
  assert.equal(nowRank({ ranked: false, rank: 0, total: 40 }), null);
  assert.match(nowRank({ ranked: true, rank: 5, total: 200 }) ?? '', /^You're now in the top \d+% of people building with AI\.$/);
});

test('9.11 every reply line is plain: no technical word, no em dash', () => {
  const lines = [COUNT_LINES.done(140, 'tokens.fun', "You're now #3 of 40."), COUNT_LINES.done(1, 'Shop', null), COUNT_LINES.added, COUNT_LINES.tapLink('https://earnkit.com/claim/wallet?t=x'),
    COUNT_LINES.tips, COUNT_LINES.cantTips, COUNT_LINES.claimFirst('earnkit.com/claim/abc'), COUNT_LINES.noted];
  for (const l of lines) {
    assert.doesNotMatch(l.replace('tokens.fun', ''), /\b(contract|wallet address|builder code|repo|commit|onchain|base|arc|monad|tempo)\b|—/i, l);
  }
  assert.equal(COUNT_LINES.done(1, 'Shop', null), 'Done. 1 person who used Shop now counts.');
});

// ---- go_live (ruling S15): the yes puts a named app online through EarnKit hosting.

const R2_ENV = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'r2-secret-t9', R2_BUCKET: 'sites' };
const R2_OFF = Object.fromEntries(Object.keys(R2_ENV).map((k) => [k, undefined]));
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const was: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
/** A person whose only app is made but not live (the agent named it): the step is go_live. */
async function madeApp(login: string): Promise<{ id: number; key: string }> {
  const id = await unclaimed();
  const key = `${login}/recipes`;
  await sql()`
    INSERT INTO builder_projects (builder_id, project_key, name, what, link, kind, confirmed, shipped, people, last_active_at)
    VALUES (${id}, ${key}, 'Recipes', 'a recipe planner', null, 'app', false, false, 0, now())`;
  return { id, key };
}
type Told = { show_to_builder: string; agent_note?: string; host?: { upload_url?: string } };
const tell = async (id: number, move_up: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const { tools } = await import('./tools');
  return (await tools.tell({ move_up }, { installationId: id, ...extra } as never)) as Told;
};

test('9.13 go_live with hosting off: the GitHub Pages steps for the agent; "live" only once its own Pages link loads', dbTest, () =>
  withEnv(R2_OFF, async () => {
    const login = `gl${randomBytes(3).toString('hex')}`;
    const { id, key } = await madeApp(login);
    assert.equal((await step(id))?.kind, 'go_live');
    const yes = await tell(id, { kind: 'go_live', project_key: key, answer: 'yes' });
    assert.equal(yes.show_to_builder, "On it. I'll send you the link when it's live.");
    assert.match(yes.agent_note!, /gh-pages/);
    assert.match(yes.agent_note!, /live_url/);
    // Another site is never called live.
    const wrong = await tell(id, { kind: 'go_live', project_key: key, answer: 'yes', live_url: 'https://example.com/' });
    assert.equal(wrong.show_to_builder, '');
    assert.match(wrong.agent_note!, /own GitHub Pages link/);
    // Its own Pages link that doesn't load yet: nothing said (another person: the live check is cached per link).
    const other = await madeApp(`${login}x`);
    const down = await tell(other.id, { kind: 'go_live', project_key: other.key, answer: 'yes', live_url: `https://${login}x.github.io/recipes/` }, { verifyDeps: { probe: async () => { throw new Error('404'); } } });
    assert.equal(down.show_to_builder, '');
    assert.match(down.agent_note!, /doesn't load yet/);
    const up = await tell(id, { kind: 'go_live', project_key: key, answer: 'yes', live_url: `https://${login}.github.io/recipes/` }, { verifyDeps: { probe: async () => undefined } });
    assert.equal(up.show_to_builder, `Recipes is live: ${login}.github.io/recipes`);
    const [s] = await sql()<{ ref: string; state: string }[]>`SELECT ref, state FROM builder_sources WHERE builder_id = ${id} AND kind = 'site'`;
    assert.deepEqual({ ...s }, { ref: `https://${login}.github.io/recipes/`, state: 'proposed' });
  }),
);

test('9.14 go_live with hosting on: an upload URL when the repo is shown theirs; the sign-in link otherwise; the proof line when neither', dbTest, async () => {
  const login = `gl${randomBytes(3).toString('hex')}`;
  await withEnv({ ...R2_ENV, GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret' }, async () => {
    const { id, key } = await madeApp(login);
    const signIn = await tell(id, { kind: 'go_live', project_key: key, answer: 'yes' });
    assert.match(signIn.show_to_builder, /^One click to prove Recipes is yours, then it goes live: \S+$/);
    assert.match(signIn.agent_note!, /signed in/);
    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
      VALUES (${key}, ${login}, ${id}, '2020-01-01', 3, 'host')`;
    const yes = await tell(id, { kind: 'go_live', project_key: key, answer: 'yes' });
    assert.equal(yes.show_to_builder, "On it. I'll send you the link when it's live.");
    assert.match(yes.host?.upload_url ?? '', /\/api\/host\/upload\?t=/);
    assert.match(yes.agent_note!, /upload_url/);
  });
  await withEnv({ ...R2_ENV, GITHUB_OAUTH_CLIENT_ID: undefined, GITHUB_OAUTH_CLIENT_SECRET: undefined }, async () => {
    const { id, key } = await madeApp(`${login}b`);
    const gate = { repoVerified: async () => false, owner: async () => { throw new Error('404'); }, latest: async () => null };
    const line = await tell(id, { kind: 'go_live', project_key: key, answer: 'yes' }, { deployDeps: { gate } });
    assert.equal(line.show_to_builder, '');
    assert.match(line.agent_note!, /earnkit\.txt[\s\S]*"token: [0-9a-f]+"/);
  });
});

test('9.15 go_live: a yes for another of their projects, or with no step, changes nothing', dbTest, () =>
  withEnv(R2_OFF, async () => {
    const { id } = await madeApp(`gl${randomBytes(3).toString('hex')}`);
    await sql()`
      INSERT INTO builder_projects (builder_id, project_key, name, what, link, kind, confirmed, shipped, people, last_active_at)
      VALUES (${id}, 'lee/other', 'Other', null, null, 'app', false, false, 0, now() - interval '1 day')`;
    assert.equal((await tell(id, { kind: 'go_live', project_key: 'lee/other', answer: 'yes' })).show_to_builder, 'Okay.');
  }),
);

test('9.18 (fix round 2) the tip deploy never nudges toward the grant: no draft, no "working on", no token offer remembered', dbTest, () =>
  withTips(async (program) => {
    const id = await claimed('tips_dev');
    await siteProject(id, 'shop', 'Shop', 'a coffee shop site');
    const { tools } = await import('./tools');
    const was = process.env.DEPLOY_CHAINS;
    // A deploy refused on its chain still went through the draft before: now nothing but the deploy line.
    process.env.DEPLOY_CHAINS = 'base';
    try {
      const r = (await tools.prepare(
        { program_id: program, project: { name: 'Shop', repo_url: 'https://github.com/lee/shop' }, tips: true,
          deploy: { chain: 'arc', bytecode: '0x6080', abi: [{ type: 'constructor' }], owner_wallet: randomAddress() } },
        { installationId: id } as never,
      )) as { show_to_builder: string; deploy?: unknown; coach?: unknown };
      assert.ok(r.deploy, 'the deploy step answered');
      assert.ok(!('coach' in r));
      assert.doesNotMatch(r.show_to_builder, /Ready to submit|What won|working on/i, r.show_to_builder);
      const notip = (await tools.prepare({ program_id: program, tips: true }, { installationId: id } as never)) as { agent_note: string };
      assert.match(notip.agent_note, /pass deploy too/);
    } finally {
      if (was === undefined) delete process.env.DEPLOY_CHAINS;
      else process.env.DEPLOY_CHAINS = was;
    }
    const [i] = await sql()<{ working_on: string[] | null }[]>`SELECT working_on FROM installations WHERE id = ${id}`;
    assert.ok(!(i.working_on ?? []).includes(program), 'never "working on" the grant');
    const offers = await sql()`SELECT 1 FROM token_offers WHERE installation_id = ${id} AND program_id = ${program}`;
    assert.equal(offers.length, 0, 'no token offer remembered');
    await sql()`UPDATE builder_live SET read_at = now() WHERE builder_id = ${id}`;
    const f = (await tools.find({}, { installationId: id } as never)) as { show_to_builder: string };
    assert.doesNotMatch(f.show_to_builder, /working on/i, f.show_to_builder);
  }),
);

test('9.19 (fix round 2) a program hidden in any installation of the person hides the tip jar', dbTest, () =>
  withTips(async (program) => {
    const id = await claimed('grp_dev');
    await siteProject(id, 'shop', 'Shop', 'a coffee shop site');
    await onlyTips(id, program);
    assert.equal((await step(id))?.kind, 'payment');
    const [{ id: member }] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash, builder_id) VALUES (${`v2121-t9m-${randomBytes(8).toString('hex')}`}, ${id}) RETURNING id`;
    await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status) VALUES (${member}, '', ${program}, 'not_interested')`;
    assert.equal(await step(id), null);
  }),
);

test('9.20 (fix round 2) a signed wallet\'s contract is theirs even when that wallet deployed another person\'s verified contract', dbTest, async () => {
  const id = await claimed('dw_dev');
  const [W, C] = [randomAddress(), randomAddress()];
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
  const other = await claimed('dw_other');
  await sql()`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by, proof, verified_at, deployer)
    VALUES (${other}, 'contract', ${`base:${randomAddress()}`}, 'x', 'verified', 'server', 'repo_link', now(), ${W})`;
  const reader = fakeChain({ deployer: W, callers: 30 });
  await agentContract(id, 'tokens.fun', `base:${C}`, reader);
  const s0 = await step(id);
  assert.equal(s0?.kind, 'count_past');
  assert.match(s0!.line, /Want me to count them\?( Your rank goes up today\.)?$/, 'provable: never the link');
  const r = await moveUpYes(id, `base:${C}`, NOW, { reader });
  assert.match(r.show_to_builder, /^Done\. 30 people who used tokens\.fun now count\./);
});

// ---- Fix round 3: through the MCP server's own input schemas, as a real agent calls them.

const DEPLOYER_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
async function mcpClient(installationId: number) {
  const { createMcpServer } = await import('./mcp');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const server = createMcpServer({ installationId });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't9', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]).text) as Record<string, unknown>;

test('9.21 (fix round 3) tips: true reaches prepare through the MCP schema: only the deploy, no draft, no "working on"', dbTest, () =>
  withEnv({ DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY, DEPLOY_CHAINS: 'base' }, () =>
    withTips(async (program) => {
      const id = await claimed('mcp_tips');
      const client = await mcpClient(id);
      try {
        const { tools: listed } = await client.listTools();
        const props = listed.find((t) => t.name === 'prepare')!.inputSchema.properties as Record<string, unknown>;
        assert.ok('tips' in props, 'listed with the flag on and deploys on');
        const r = await client.callTool({
          name: 'prepare',
          arguments: {
            program_id: program, project: { name: 'Shop', repo_url: 'https://github.com/lee/shop' }, tips: true,
            deploy: { chain: 'arc', bytecode: '0x6080', abi: [{ type: 'constructor' }], owner_wallet: randomAddress() },
          },
        });
        const out = textOf(r);
        assert.ok(out.deploy, 'the deploy step answered');
        assert.ok(!('coach' in out) && !('guide' in out), JSON.stringify(out));
        const [i] = await sql()<{ working_on: string[] | null }[]>`SELECT working_on FROM installations WHERE id = ${id}`;
        assert.ok(!(i.working_on ?? []).includes(program), 'never "working on" the grant: tips was not stripped');
        const offers = await sql()`SELECT 1 FROM token_offers WHERE installation_id = ${id} AND program_id = ${program}`;
        assert.equal(offers.length, 0);
      } finally {
        await client.close();
      }
    }),
  ),
);

test('9.22 (fix round 3) move_up.live_url reaches go_live through the MCP schema; flag off lists neither field', dbTest, () =>
  withEnv({ ...R2_OFF, DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY, DEPLOY_CHAINS: 'base' }, async () => {
    const { id, key } = await madeApp(`gl${randomBytes(3).toString('hex')}`);
    const client = await mcpClient(id);
    try {
      const r = textOf(await client.callTool({ name: 'tell', arguments: { move_up: { kind: 'go_live', project_key: key, answer: 'yes', live_url: 'https://example.com/' } } }));
      assert.match(String(r.agent_note), /own GitHub Pages link/, 'live_url arrived (stripped, it would be the Pages steps)');
    } finally {
      await client.close();
    }
    const flag = process.env.EARNKIT_BUILDER_SCORE;
    delete process.env.EARNKIT_BUILDER_SCORE;
    try {
      const off = await mcpClient(id);
      const { tools: listed } = await off.listTools();
      await off.close();
      assert.ok(!('tips' in (listed.find((t) => t.name === 'prepare')!.inputSchema.properties as Record<string, unknown>)));
      assert.ok(!('move_up' in (listed.find((t) => t.name === 'tell')!.inputSchema.properties as Record<string, unknown>)));
    } finally {
      process.env.EARNKIT_BUILDER_SCORE = flag;
    }
  }),
);

// ---- v2.12.1 T10 (spec 3b): the reply that confirms a project's use is countable offers its coin.

test('10.12 the countable reply offers the coin as its one yes (once); without launches it is the T9 line', dbTest, () =>
  withEnv({ TOKENSFUN_DEPLOY_API_KEY: 'test' }, async () => {
    const id = await claimed('coin_tag');
    const W = randomAddress().toLowerCase();
    await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${W}, ${id})`;
    await trackedContract(id, 'lee/app', `base:${randomAddress()}`);
    // Fix round 1 (ruling 3): offered only with a confirmed repo (its yes can launch).
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at)
      VALUES (${id}, 'repo', 'lee/app', 'lee/app', 'repo_owner', 'verified', 'server', now())`;
    assert.equal((await step(id))?.kind, 'tag_future');
    const r = await moveUpYes(id, 'lee/app', NOW, { reader: fakeChain({ deployer: randomAddress(), callers: 0 }) });
    const [p] = await sql()<{ name: string }[]>`SELECT name FROM builder_projects WHERE builder_id = ${id} AND project_key = 'lee/app'`;
    const named = r.show_to_builder.replace(/\$[A-Z0-9]+ \([^)]+\)/, '$X (X)');
    assert.equal(named, `${COUNT_LINES.added} Want to launch a coin, $X (X), for ${p.name}? You'd get 40% of its trading fees, paid to ${W.slice(0, 6)}…${W.slice(-4)}.`, r.show_to_builder);
    assert.equal(r.coin?.project_key, 'lee/app');
    assert.match(r.coin!.agent_note, /tell with coin/);
    assert.equal((r.show_to_builder.match(/\?/g) ?? []).length, 1);
    const [m] = await sql()`SELECT moment FROM coin_moments WHERE builder_id = ${id}`;
    assert.equal(m.moment, 'countable');
  }),
);

test('10.12b without token launches (the key unset) the countable reply is the T9 line alone', dbTest, async () => {
  const id = await claimed('coin_tag2');
  await trackedContract(id, 'lee/app', `base:${randomAddress()}`);
  const r = await moveUpYes(id, 'lee/app', NOW, { reader: fakeChain({ deployer: randomAddress(), callers: 0 }) });
  assert.equal(r.show_to_builder, COUNT_LINES.added);
  assert.equal(r.coin, undefined);
});
