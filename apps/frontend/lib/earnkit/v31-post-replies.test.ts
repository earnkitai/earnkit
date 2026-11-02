import type { ProofFetch } from './outcome-proof';
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { pathQuiet } from './fixtures/wallet-step';
import { BASE_GRANTS_ID } from './builder-code';
import { isoWeekOf, mondayOf } from './weeks';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { draftByCode } from './post-drafts';
import { READY_SET } from './bench-find';

// v4.10 Task 4: this file pins the reply the path gives; a fresh session now opens with the ready set instead
// (v410-find.test.ts), so the set is off here (bench-find.ts READY_SET).
READY_SET.on = false;

/**
 * v3.1 one-tap posts, Task 6 (design 6): the post replies through the real MCP layer, word for word with fixture values:
 * going live (ahead of the apply step for 48 hours, then the apply step again), a different version and its limit, the
 * builder's news (tell update), and an outcome told with and without its proof link (owner ruling 3). Each reply: at
 * most one https link (the post's short link), exactly one question where it asks, no em dash, no points (owner ruling 5).
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const rule = (s: string, asks = 1) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), asks, s);
  assert.doesNotMatch(s, /—|points/, s);
  return s;
};
const moveUp = (r: R) => r.reply?.move_up as { kind: string; project_key: string; agent_note: string } | undefined;
const shortLink = (handle: string) => new RegExp(`^https://earnkit\\.com/${handle}/post/[a-z2-7]{10}$`);
let seq = 0;

/** A ranked builder whose one project ("Kit", a public repo) has code in the weeks `ages` ago; Base's grant fits it. */
async function kit(tag: string, ages = [1, 2, 3, 4, 5, 6, 7, 8]) {
  const key = `${tag}${RUN}${++seq}/kit`;
  const handle = `${tag}${RUN}${seq}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, seen: { connect_done: '2026-09-01T00:00:00.000Z' }, projects: [{ key, name: 'Kit', confirmed: true }] });
  await sql()`UPDATE builder_projects SET commit_weeks = ${ages.map((a) => isoWeekOf(new Date(Date.now() - a * 7 * DAY))).sort()}::text[] WHERE builder_id = ${id}`;
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at) SELECT id, '{"private": false}'::jsonb, true, now() FROM builder_sources WHERE builder_id = ${id}
    ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: [{ program_id: BASE_GRANTS_ID, program: BASE_GRANTS_ID, status: 'likely', missing: [], effort: 'none', note: null }],
  }];
  const ctx = { installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  return { id, key, handle, ctx };
}

test('went live: v4.7 T3, behind an unapplied fit; then for 48 hours, word for word; a different version; then the limit; then quiet', db, async () => {
  const k = await kit('pl');
  // Live 3 days ago (settled a day ago: under 48 hours since it could be posted).
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pl${k.id}`}, 'kit', ${k.key}, ${k.id}, 1, 1, 'live', ${new Date(Date.now() - 3 * DAY)})`;
  // v4.7 T3 fix round 1 (R11): money first: while Base's grant is open and unapplied, its ask comes first and the post
  // waits. v4.8 Task 1: the path's hook is that ask; the post is one of the older asks, after the path is parked.
  assert.equal(moveUp(await mcpCall(k.ctx, 'find', {}))?.kind, 'apply');
  await mcpCall(k.ctx, 'tell', { submitted: { program_id: BASE_GRANTS_ID } });
  await pathQuiet(k.id);
  const r1 = await mcpCall(k.ctx, 'find', {});
  const s1 = rule(show(r1));
  const tap1 = links(s1)[0]!;
  // v4.7.1 T1 fix round 2 (R6): never "You qualify" for the program told applied (v4.8: no "Open now:" either).
  assert.doesNotMatch(s1, /You qualify for the Base Builder Grant Program|Open now:/, s1);
  assert.match(tap1, shortLink(k.handle));
  assert.equal(s1, [
    'Kit went live this week.',
    'Your post for X:',
    '"Kit is live. 8 weeks from first commit."',
    `Post it in one tap: ${tap1}`,
    // v4.7 T4: the post step's why, its own paragraph before the question.
    '',
    'A post with real numbers is what reviewers read.',
    '',
    'Want a different version?',
  ].join('\n'));
  assert.deepEqual([moveUp(r1)?.kind, moveUp(r1)?.project_key], ['post', k.key], 'once no fit is unapplied');
  assert.match(moveUp(r1)!.agent_note, /Show the post text exactly as given\. Never rewrite it\./);
  // The card frozen with it: "Live" and the weeks it took.
  const d1 = (await draftByCode(tap1.split('/').pop()!))!;
  assert.equal(d1.moment, 'went_live');
  assert.equal(d1.card.weeks, 8);

  // Yes, a minute later: a different version (the next shape; the builder asked).
  mock.timers.setTime(WEDNESDAY + 60_000);
  const r2 = await mcpCall(k.ctx, 'tell', { move_up: { kind: 'post', project_key: k.key, answer: 'yes' } });
  const s2 = rule(show(r2));
  const tap2 = links(s2)[0]!;
  assert.notEqual(tap2, tap1);
  assert.equal(s2, [
    'Kit went live this week.',
    'Your post for X:',
    '"8 weeks from first commit, Kit is live."',
    `Post it in one tap: ${tap2}`,
    // v4.7 T4 fix round 0 (R15): the redraft carries the post why too.
    '',
    'A post with real numbers is what reviewers read.',
    '',
    'Want a different version?',
  ].join('\n'));
  // Again: one asked draft a day, so the post they have stays.
  mock.timers.setTime(WEDNESDAY + 120_000);
  const s3 = rule(show(await mcpCall(k.ctx, 'tell', { move_up: { kind: 'post', project_key: k.key, answer: 'yes' } })), 0);
  assert.equal(s3, `That's the last new version for today. The one you have still works: ${tap2}`);
  // Answered once: another yes is "Okay.".
  assert.equal(show(await mcpCall(k.ctx, 'tell', { move_up: { kind: 'post', project_key: k.key, answer: 'yes' } })), 'Okay.');

  // Two days on, the live post was offered already: never again.
  mock.timers.setTime(WEDNESDAY + 2 * DAY);
  try {
    const r4 = await mcpCall(k.ctx, 'find', {});
    assert.notEqual(moveUp(r4)?.kind, 'post', show(r4));
  } finally {
    mock.timers.setTime(WEDNESDAY);
  }
});

test('the builder\'s news (tell update): posted to the page and drafted in their own words; a change asks for their words and rewords the same post', db, async () => {
  const k = await kit('pn');
  const r = await mcpCall(k.ctx, 'tell', { update: { text: 'first paying customer today, $9/mo, from a stranger' } });
  const s = rule(show(r));
  const tap = links(s)[0]!;
  assert.match(tap, shortLink(k.handle));
  assert.equal(s, [
    'Added to your page.',
    'Your post for X:',
    '"first paying customer today, $9/mo, from a stranger"',
    `Post it in one tap: ${tap}`,
    'Want to change any words?',
  ].join('\n'));
  assert.equal(moveUp(r)?.kind, 'post');
  const [u] = await sql()<{ text: string }[]>`SELECT text FROM project_updates WHERE builder_id = ${k.id} AND text IS NOT NULL`;
  assert.equal(u.text, 'first paying customer today, $9/mo, from a stranger', 'on the page as before');
  // Yes: the agent asks for the new words (nothing shown, no second post).
  const yes = await mcpCall(k.ctx, 'tell', { move_up: { kind: 'post', project_key: k.key, answer: 'yes' } });
  assert.equal(show(yes), '');
  assert.match(String(yes.reply?.agent_note), /new words.*tell with update/);
  // Their words: the same post (the same link and moment), reworded.
  const again = await mcpCall(k.ctx, 'tell', { update: { text: 'first paying customer today, from a stranger' } });
  assert.equal(rule(show(again)), [
    'Added to your page.',
    'Your post for X:',
    '"first paying customer today, from a stranger"',
    `Post it in one tap: ${tap}`,
    'Want to change any words?',
  ].join('\n'));
  const rows = await sql()<{ text: string; moment_key: string }[]>`SELECT text, moment_key FROM post_drafts WHERE builder_id = ${k.id}`;
  assert.equal(rows.length, 1, 'never a second news post');
  assert.equal(rows[0].text, 'first paying customer today, from a stranger');
  // Hype words in the new words: not used; the update's own reply stands.
  const hype = show(await mcpCall(k.ctx, 'tell', { update: { text: 'so excited about our first customer!!' } }));
  assert.doesNotMatch(hype, /Your post for X/);
});

/**
 * Final review 1, fix wave (3): the program's proof hosts and X accounts for one test, as a fixture (restored after),
 * so the test never depends on what the committed program file lists today.
 */
async function withProofHosts(hosts: string[], run: () => Promise<void>, handles: string[] = []) {
  const [{ before, xs }] = await sql()<{ before: string[]; xs: string[] }[]>`SELECT proof_hosts AS before, x_handles AS xs FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  await sql()`UPDATE programs SET proof_hosts = ${hosts}::text[], x_handles = ${handles}::text[] WHERE id = ${BASE_GRANTS_ID}`;
  try {
    await run();
  } finally {
    await sql()`UPDATE programs SET proof_hosts = ${before}::text[], x_handles = ${xs}::text[] WHERE id = ${BASE_GRANTS_ID}`;
  }
}
/** Proof ruling (last fix wave A): a proof page naming the builder by their verified handle. */
const namesHandle = (handle: string) => (async () => `<html><title>Recipients</title><p>October recipients: Kit by @${handle}, and others.</p></html>`) as ProofFetch;

test('final review 1: a program that lists no proof hosts or X accounts: an acceptance told is acknowledged, never asked for a proof link, never a post', db, () => withProofHosts([], async () => {
  const k = await kit('pn');
  const [{ hosts, handles }] = await sql()<{ hosts: string[]; handles: string[] }[]>`SELECT proof_hosts AS hosts, x_handles AS handles FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  assert.deepEqual([hosts, handles], [[], []], 'the fixture lists none');
  await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'applied' }] });
  for (const proof_url of [undefined, 'https://docs.base.org/get-started/grant-recipients-october']) {
    const r = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', ...(proof_url && { proof_url }) }] });
    const s = rule(show(r), 0);
    assert.equal(s, 'Congrats. Saved.');
    assert.doesNotMatch(String(r.reply?.agent_note ?? ''), /proof_url|nothing to show the builder/);
  }
  assert.equal((await sql()`SELECT 1 FROM post_drafts WHERE builder_id = ${k.id}`).length, 0);
}));

test('owner ruling 3: an acceptance told without a proof link asks for one; with the link the agent checked and that names the builder, it is drafted (no earlier entry needed)', db, () => withProofHosts(['docs.base.org/get-started/'], async () => {
  const kk = await kit('po');
  const k = { ...kk, ctx: { ...kk.ctx, proofFetch: namesHandle(kk.handle) } };
  const [{ title }] = await sql()<{ title: string }[]>`SELECT title FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  const proof = 'https://docs.base.org/get-started/grant-recipients-october';
  // v3.1 cold read round 2 (owner): an outcome post needs verification (the proof checks), not an earlier application.
  // GTM W2: a short congrats, never nothing.
  // v3.1 cold read (owner-approved rewrite 8): no proof link yet: one line asks for the announcement.
  const askProof = `Congrats on the ${title}. Got the announcement link? I'll turn it into a post.`;
  const none = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted' }] });
  assert.equal(show(none), askProof);
  assert.match(String(none.reply?.agent_note), /proof_url/);
  assert.equal((await sql()`SELECT 1 FROM post_drafts WHERE builder_id = ${k.id}`).length, 0, 'never on the builder\'s word alone');
  // A link on the builder's own site is not proof.
  const own = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: `https://github.com/${k.key}` }] });
  assert.equal(show(own), askProof);
  // An X post from an account the program file doesn't list, the listing page itself, or a shared host: not proof.
  for (const bad of ['https://x.com/base/status/1849000000000000000', 'https://docs.base.org/get-started/builders', 'https://docs.base.org/other/recipients', 'https://forms.gle/urqjBJYJjR6Vqqre6/viewanalytics'])
    assert.equal(show(await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: bad }] })), askProof, bad);
  // An award the agent passes is never printed.
  const r = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: proof, prize_usd: 50000 }] });
  const s = rule(show(r));
  const tap = links(s)[0]!;
  // v4.0 Task 8 fix round 1 (ruling 3): the accepted nudge's approved line, with the post's link; the week's nudge.
  assert.equal(s, `You got into ${title}. Huge, well earned. Want to share it? ${tap}`);
  assert.equal(moveUp(r)?.kind, 'outcome_share');
  const [{ week }] = await sql()<{ week: string | null }[]>`SELECT standing_seen->>'nudge_week' AS week FROM builder_profiles WHERE builder_id = ${k.id}`;
  assert.equal(week, mondayOf(new Date()));
  assert.equal(show(await mcpCall(k.ctx, 'tell', { move_up: { kind: 'outcome_share', project_key: k.key, answer: 'yes' } })), `Your post is ready to share: ${tap}`);
  assert.doesNotMatch(String(r.reply?.agent_note), /nothing to show the builder/);
  const d = (await draftByCode(tap.split('/').pop()!))!;
  assert.equal(d.proof_url, proof);
  assert.doesNotMatch(s, /50,000|\$/);
  // Proof ruling: a page on the listed path that names only the project, not the builder, is no proof (asked again).
  const other = await kit('pq');
  const unnamed = await mcpCall({ ...other.ctx, proofFetch: (async () => '<p>October recipients: Kit.</p>') as ProofFetch }, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: proof }] });
  assert.equal(show(unnamed), askProof);
}));

test('v4.7 T4 fix round 0 (R15): a win told with its proof: the post, then the post why line, then its question; move_up.why', db, () => withProofHosts(['docs.base.org/get-started/'], async () => {
  const kk = await kit('pw');
  const k = { ...kk, ctx: { ...kk.ctx, proofFetch: namesHandle(kk.handle) } };
  const proof = 'https://docs.base.org/get-started/grant-recipients-october';
  // A win is told on an entry.
  await sql()`INSERT INTO projects (program_id, name, installation_id, submitted_at) VALUES (${BASE_GRANTS_ID}, 'Kit', ${k.id}, now())`;
  const r = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'won', proof_url: proof }] });
  const s = rule(show(r));
  assert.match(s, /\nPost it in one tap: \S+\n\nA post with real numbers is what reviewers read\.\n\nWant a different version\?$/, s);
  assert.equal(s.split('?').length - 1, 1, s);
  const m = moveUp(r) as { kind: string; agent_note: string; why?: string } | undefined;
  assert.equal(m?.kind, 'post');
  assert.equal(m?.why, 'A post with real numbers is what reviewers read.');
  assert.match(m!.agent_note, /If they ask why, answer from move_up\.why\./);
}));

test('fix round: a different version only of the latest draft, within its 14 days', db, async () => {
  const k = await kit('pr');
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pr${k.id}`}, 'kit', ${k.key}, ${k.id}, 1, 1, 'live', ${new Date(Date.now() - 3 * DAY)})`;
  // v4.7 T3 fix round 1 (R11): the post waits behind an unapplied fit, so Base's grant is applied to first.
  await mcpCall(k.ctx, 'tell', { submitted: { program_id: BASE_GRANTS_ID } });
  assert.equal(moveUp(await mcpCall(k.ctx, 'find', {}))?.kind, 'post');
  const [{ ask }] = await sql()<{ ask: unknown }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${k.id}`;
  const reopen = () => sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('bench_ask', ${sql().json(ask as never)}::jsonb) WHERE builder_id = ${k.id}`;
  const yes = async () => show(await mcpCall(k.ctx, 'tell', { move_up: { kind: 'post', project_key: k.key, answer: 'yes' } }));
  // A newer draft exists: the old one is not redrafted.
  const { createDraft } = await import('./post-drafts');
  const newer = await createDraft({ builderId: k.id, projectKey: k.key, moment: 'news', momentKey: `news:${k.key}:x`, shape: 'note', text: 'Kit has dark mode.', asked: true }, new Date(Date.now() + 60_000));
  assert.ok(newer.ok);
  assert.equal(await yes(), 'Okay.');
  // The latest again, but expired: not redrafted either.
  await sql()`DELETE FROM post_drafts WHERE code = ${newer.ok ? newer.draft.code : ''}`;
  await sql()`UPDATE post_drafts SET expires_at = ${new Date(Date.now() - 60_000)} WHERE builder_id = ${k.id}`;
  await reopen();
  assert.equal(await yes(), 'Okay.');
  assert.equal((await sql()`SELECT 1 FROM post_drafts WHERE builder_id = ${k.id}`).length, 1, 'no new draft');
});
