import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person } from './fixtures/find';
import { BASE_GRANTS_ID } from './builder-code';
import { isoWeekOf } from './weeks';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { draftByCode } from './post-drafts';

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

test('went live: ahead of the apply step for 48 hours, word for word; a different version; then the limit; then the apply step again', db, async () => {
  const k = await kit('pl');
  // Live 3 days ago (settled a day ago: under 48 hours since it could be posted).
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pl${k.id}`}, 'kit', ${k.key}, ${k.id}, 1, 1, 'live', ${new Date(Date.now() - 3 * DAY)})`;
  const r1 = await mcpCall(k.ctx, 'find', {});
  const s1 = rule(show(r1));
  const tap1 = links(s1)[0]!;
  assert.match(tap1, shortLink(k.handle));
  assert.equal(s1, [
    'Kit went live this week.',
    'Your post for X, with your page card:',
    '"Kit is live. 8 weeks from first commit."',
    `Post it in one tap: ${tap1}`,
    'Want a different version?',
  ].join('\n'));
  assert.deepEqual([moveUp(r1)?.kind, moveUp(r1)?.project_key], ['post', k.key], 'before the apply step');
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
    'Your post for X, with your page card:',
    '"8 weeks from first commit, Kit is live."',
    `Post it in one tap: ${tap2}`,
    'Want a different version?',
  ].join('\n'));
  // Again: one asked draft a day, so the post they have stays.
  mock.timers.setTime(WEDNESDAY + 120_000);
  const s3 = rule(show(await mcpCall(k.ctx, 'tell', { move_up: { kind: 'post', project_key: k.key, answer: 'yes' } })), 0);
  assert.equal(s3, `That's the last new version for today. The one you have still works: ${tap2}`);
  // Answered once: another yes is "Okay.".
  assert.equal(show(await mcpCall(k.ctx, 'tell', { move_up: { kind: 'post', project_key: k.key, answer: 'yes' } })), 'Okay.');

  // Two days on, the live post was offered already: the apply step is back.
  mock.timers.setTime(WEDNESDAY + 2 * DAY);
  try {
    const r4 = await mcpCall(k.ctx, 'find', {});
    assert.equal(moveUp(r4)?.kind, 'apply', show(r4));
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
    'Your post for X, with your page card:',
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
    'Your post for X, with your page card:',
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

/** Final review 1: the program file's owner-reviewed proof hosts, for one test (restored after). */
async function withProofHosts(hosts: string[], run: () => Promise<void>) {
  const [{ before }] = await sql()<{ before: string[] }[]>`SELECT proof_hosts AS before FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  await sql()`UPDATE programs SET proof_hosts = ${hosts}::text[] WHERE id = ${BASE_GRANTS_ID}`;
  try {
    await run();
  } finally {
    await sql()`UPDATE programs SET proof_hosts = ${before}::text[] WHERE id = ${BASE_GRANTS_ID}`;
  }
}

test('final review 1: a program that lists no proof hosts or X accounts: an acceptance told is acknowledged, never asked for a proof link, never a post', db, async () => {
  const k = await kit('pn');
  const [{ hosts, handles }] = await sql()<{ hosts: string[]; handles: string[] }[]>`SELECT proof_hosts AS hosts, x_handles AS handles FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  assert.deepEqual([hosts, handles], [[], []], 'no program file lists any today');
  await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'applied' }] });
  for (const proof_url of [undefined, 'https://docs.base.org/get-started/grant-recipients-october']) {
    const r = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', ...(proof_url && { proof_url }) }] });
    const s = rule(show(r), 0);
    assert.equal(s, 'Congrats. Saved.');
    assert.doesNotMatch(String(r.reply?.agent_note ?? ''), /proof_url|nothing to show the builder/);
  }
  assert.equal((await sql()`SELECT 1 FROM post_drafts WHERE builder_id = ${k.id}`).length, 0);
});

test('owner ruling 3: an acceptance told without a proof link asks for one; with the link the agent checked, it is drafted', db, () => withProofHosts(['docs.base.org'], async () => {
  const k = await kit('po');
  const [{ title }] = await sql()<{ title: string }[]>`SELECT title FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  const proof = 'https://docs.base.org/get-started/grant-recipients-october';
  // Fix round: no entry or application in the program before: no post and no proof question, whatever the link.
  const stranger = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: proof }] });
  assert.equal(show(stranger), '', 'only the saved note');
  assert.equal((await sql()`SELECT 1 FROM post_drafts WHERE builder_id = ${k.id}`).length, 0);
  // The unverified tell itself wrote an accepted row: it never counts as the entry.
  assert.equal(show(await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: proof }] })), '');
  // They applied (as told earlier): now the acceptance can be a post.
  await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'applied' }] });
  const none = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted' }] });
  assert.equal(show(none), "Send me a public link that shows it, like the program's post.");
  assert.match(String(none.reply?.agent_note), /proof_url/);
  assert.equal((await sql()`SELECT 1 FROM post_drafts WHERE builder_id = ${k.id}`).length, 0, 'never on the builder\'s word alone');
  // A link on the builder's own site is not proof.
  const own = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: `https://github.com/${k.key}` }] });
  assert.equal(show(own), "Send me a public link that shows it, like the program's post.");
  // An X post from an account the program file doesn't list, the listing page itself, or a shared host: not proof.
  for (const bad of ['https://x.com/base/status/1849000000000000000', 'https://docs.base.org/get-started/builders', 'https://forms.gle/urqjBJYJjR6Vqqre6/viewanalytics'])
    assert.equal(show(await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: bad }] })), "Send me a public link that shows it, like the program's post.", bad);
  // An award the agent passes is never printed.
  const r = await mcpCall(k.ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: proof, prize_usd: 50000 }] });
  const s = rule(show(r));
  const tap = links(s)[0]!;
  assert.equal(s, [
    'Your post for X, with your page card:',
    `"Kit was accepted into the ${title}."`,
    `Post it in one tap: ${tap}`,
    'Want a different version?',
  ].join('\n'));
  assert.doesNotMatch(String(r.reply?.agent_note), /nothing to show the builder/);
  const d = (await draftByCode(tap.split('/').pop()!))!;
  assert.equal(d.proof_url, proof);
  assert.doesNotMatch(s, /50,000|\$/);
}));

test('fix round: a different version only of the latest draft, within its 14 days', db, async () => {
  const k = await kit('pr');
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`pr${k.id}`}, 'kit', ${k.key}, ${k.id}, 1, 1, 'live', ${new Date(Date.now() - 3 * DAY)})`;
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
