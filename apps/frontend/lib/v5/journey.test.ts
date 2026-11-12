/**
 * The whole flow end to end through the real MCP server: a stranger, the owner, a closing program, a chain
 * with no registry entry, and the copy rules on every line the builder sees. One database; four recorded repos.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { replayFetch } from './fixtures/github';
import { mcpCall } from './fixtures/mcp-call';
import { registerClient } from './oauth';
import { connectInstallation, saveInstallation } from './installations';
import { getRecord, linkInstallation, saveRecord, upsertBuilder } from '../v6/builders';
import { approvePath, mergeRecord } from '../v6/record';
import { evidence, liveRows } from '../v6/fixtures/evidence-builder';
/** L29-7 (v6.1.16 Task 15): every ready program of a find reply: what the agent may send, in person and the builder's to send. */
const allReady = (r: Record<string, unknown>): unknown[] => [...((r.ready as unknown[]) ?? []), ...((r.in_person as unknown[]) ?? []), ...((r.you_send as unknown[]) ?? [])];

process.env.EARNKIT_AUTH_SECRET ??= 'journey-test-secret-0123456789abcdef';
after(() => sql().end());
before(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;
const CLOSINGS = [
  // FR-1 (v6.1.16 Task 14 fix round 1): signed out with a repo, sign-in comes first: no apply offer until linked.
  /Sign in once and I check the repo is yours; then say yes\.$/,
  // v6.1.8 (1a): one action. The gap lines carry their own "do n" and "yes n".
  // L24-9 (v6.1.16 Task 11): "ready" when other blocks are listed.
  // L29-17, L29-27 (v6.1.16 Task 15): no second action; a yes that needs answers names them.
  /Say yes and (?:tell me [^\n]+, and )?I apply to all \d+( ready)?\.$/,
  /Say yes and tell me [^\n]+, and I (?:apply to|draft) [^\n]+\.$/,
  /Nothing is ready yet\. Do real people use it\? Say yes, sign in once, and I check\.$/,
  // L16-11 (v6.1.16): one ready program is named.
  // L24-8, L24-10 (v6.1.16 Task 11): the do offer and the drafts fold into this one.
  /Say yes and I apply to (?!all \d+( ready)?\. )[^\n]+\.$/,
  // L24-28 (v6.1.16 Task 11): the one ready program over the limit.
  /[^\n]+ is over your limit\. Say yes and I apply\.$/,
  /Say yes and I draft all \d+ for you to send\.$/,
  /Say yes and I draft it for you to send\.$/,
  /Nothing is ready yet\.( Say "yes \d+" if that rule fits you and I get it ready\.| Say "do \d+" and I [^\n]+\.)?$/,
  // Final fix (v6.1.12, I1): the users yes on a program with a setup step or a rule left.
  /Nothing is ready yet\. Do real people use it\? Say yes and I look again\.$/,
  // O2 (v6.1.10): in-person programs listed and nothing remote ready.
  /Nothing remote is ready yet\. Say yes and I start the in-person applications\.$/,
  /Nothing fits yet\. Ask again any time and I show what is new\.$/,
  // L24-11 (v6.1.16 Task 11): the one standing-approval line.
  /Applying now to [^\n]+ under your standing approval\. (Say stop and I hold any of them|Say yes and I also apply to [^\n]+)\.$/,
];
const seen: string[] = [];

/** Registers a client, issues a token and connects it as /mcp does; returns the installation id. */
async function stranger(): Promise<number> {
  await registerClient({ redirect_uris: ['http://127.0.0.1:8123/callback'], client_name: 'Journey Agent' });
  const token = 'journey-' + Math.random();
  await saveInstallation(token, 'Journey Agent');
  const caller = await connectInstallation(token);
  assert.ok(caller);
  return caller.id;
}

function project(slug: string) {
  const rec = replayFetch(slug);
  return { rec, project: { name: slug, description: 'An app.', repo_url: `https://github.com/${rec.repo}` } };
}
const ctx = (id: number, fetch: typeof globalThis.fetch, now = NOW) => ({ installationId: id, builderId: null, now, gh: fetch });

async function find(id: number, slug: string, over: Record<string, unknown> = {}, now = NOW) {
  const { rec, project: p } = project(slug);
  const r = await mcpCall(ctx(id, rec.fetch, now), 'find', { project: { ...p, ...over } });
  assert.equal(r.isError, false, r.text);
  seen.push(r.reply!.show_to_builder as string);
  return r.reply!;
}
async function track(id: number, args: Record<string, unknown>) {
  const r = await mcpCall(ctx(id, replayFetch('earnkit').fetch), 'track', args);
  assert.equal(r.isError, false, r.text);
  seen.push(r.reply!.show_to_builder as string);
  return r.reply!;
}

test('a stranger with an app on no chain gets gaps or "Nothing fits yet" and no ask for who they are', async () => {
  const id = await stranger();
  const reply = await find(id, 'nextjs-dashboard');
  const show = reply.show_to_builder as string;
  const gaps = reply.gaps as unknown[];
  assert.ok(gaps.length > 0 || /Nothing fits yet\. Ask again any time and I show what is new\.$/.test(show), show);
  // A program's own setup steps ("First: sign in to its hub") and its blockers ("Before applying: Sign in once to
  // its hub", v6.1.3 R4) are the program's, not EarnKit asking who they are.
  // L29-34 (v6.1.16 Task 15): the users question's ruled sign-in checks the product, it never asks who they are.
  const ours = show.replace(/ First: [^\n]*/g, '').replace(/^Before applying: [^\n]*/m, '').replace(/^In person \(\d+\):\n(\d+\. [^\n]*\n?)+/m, '')
    .replace('Do real people use it? Say yes, sign in once, and I check.', '');
  assert.doesNotMatch(ours, /\b(email|sign in|sign up|log in|your name|your team|telegram|account)\b/i);
  assert.equal(reply.as_reported, false);
});

test('the owner: ready or the builder codes gap, then applied and won on the ledger', async () => {
  const id = await stranger();
  const reply = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  const ready = (allReady(reply) as { program_id: string }[]).map((p) => p.program_id);
  const gaps = reply.gaps as { program_id: string; kind?: string; gap?: { kind: string } }[];
  const inGaps = gaps.some((g) => g.program_id === 'base-builder-grants');
  assert.ok(ready.includes('base-builder-grants') || inGaps, JSON.stringify({ ready, gaps }));
  if (inGaps) assert.match(JSON.stringify(gaps.find((g) => g.program_id === 'base-builder-grants')), /builder_codes|Builder Codes/);

  const top = ready[0];
  // L28-3 (v6.1.16 Task 14): unsigned in, the agent never sends with the repo; the builder's own send is kept by name.
  const t = await track(id, { program_id: top, status: 'applied', submitted_by: 'builder' });
  assert.equal((t.ledger as { applied: number }).applied, 1);
  const after1 = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  // L29-1 (v6.1.16 Task 15): the applications by name.
  assert.match(after1.show_to_builder as string, /Your applications: [^\n]+ \(sent Nov 4, waiting\)\./);

  const w = await track(id, { program_id: top, status: 'won', amount_usd: 5000 });
  assert.equal((w.ledger as { won: number }).won, 1);
  const after2 = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  assert.match(after2.show_to_builder as string, /Your applications: [^\n]+ \(sent Nov 4, won \$5,000\)\./);
});

test('a program closing in 3 days appears in since.closing on the second call', async () => {
  const id = await stranger();
  const first = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  const pick = (allReady(first) as { program_id: string }[])[0].program_id;
  const p = (await getProgram(pick))!.file;
  const ends = new Date(NOW.getTime() + 3 * 24 * H).toISOString();
  await upsertProgram({ ...p, ends_at: ends }, 'file', new Date(NOW.getTime() + H));
  const second = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true }, new Date(NOW.getTime() + 2 * H));
  const closing = (second.since as { closing: { program_id: string; closes_at: string }[] }).closing;
  assert.ok(closing.some((c) => c.program_id === pick), JSON.stringify(closing));
});

test('a Solana repo gets a reply, no crash, and nothing is taken as reported', async () => {
  const id = await stranger();
  const reply = await find(id, 'saber-distributor');
  assert.equal(reply.as_reported, false);
  assert.ok(typeof reply.show_to_builder === 'string' && (reply.show_to_builder as string).length > 0);
  const base = await find(await stranger(), 'onchain-reaction');
  assert.ok(typeof base.show_to_builder === 'string');
});

test('the owner, linked: record set, approved on /me, find fills from it, started, applied; a send the record cannot fill is outside the standing approval (F1)', async () => {
  const id = await stranger();
  const b = await upsertBuilder({ github_id: 990_001, login: 'earnkitai' /* L28-3 (v6.1.16 Task 14): the repo's owner */, name: 'Jenil', avatar_url: null }, NOW);
  await linkInstallation(id, b.id, NOW);
  const { rec, project: p } = project('earnkit');
  const live = async () => evidence({ live: liveRows({ url: 'https://earnkit.com', url_ok: true }) });
  const at = (now: Date) => ({ installationId: id, builderId: b.id, now, gh: rec.fetch, evidence: live });
  // L29-9 (v6.1.16 Task 15): a send outside the standing approval is recorded and answered as a refusal (isError).
  const call = async (now: Date, tool: string, args: Record<string, unknown>) => {
    const r = await mcpCall(at(now), tool, args);
    assert.equal(r.isError, /^Sent, but outside your standing approval/.test(String(r.reply?.show_to_builder)), r.text);
    seen.push(r.reply!.show_to_builder as string);
    return r.reply!;
  };

  // The agent writes what the builder said; nothing is approved yet.
  const set = await call(NOW, 'record', {
    set: {
      person: { name: 'Jenil Thakker', email: 'jenil@example.com' },
      projects: [{ id: 'earnkit', name: 'EarnKit', repo_url: `https://github.com/${rec.repo}`, live_url: 'https://earnkit.com', answers: { problem: { text: 'Builders lose weeks on grant forms.' } } }],
      traction: { line_pre_launch: 'Pre-launch, launching 2026-12-01.' },
    },
  });
  assert.equal(set.show_to_builder, 'Saved 1 answer and 6 facts. Approve the answer at earnkit.com/me and it goes into drafts.');
  // v6.1.4: Z Fellows is the fourth in-person program, past the default two, so the full list shows it.
  const before = await call(NOW, 'find', { project: { ...p, live_url: 'https://earnkit.com', users: true }, filter: { all: true } });
  assert.ok((allReady(before) as { program_id: string }[]).some((x) => x.program_id === 'z-fellows'));
  // L26-4 (v6.1.16 Task 12): a program's fields in full come with its own find.
  const zFields = async (now: Date) => ((await call(now, 'find', { program_id: 'z-fellows', project: { ...p, live_url: 'https://earnkit.com', users: true } })).fields as { key: string; from: string; value: string | null }[]);
  assert.notEqual((await zFields(NOW)).find((f) => f.key === 'problem')!.from, 'record');

  // The builder approves on /me and turns standing approval on there.
  let record = mergeRecord(await getRecord(b.id), { policy: { auto_apply: true, max_per_night: 3 } }, 'builder', NOW).record;
  for (const path of ['projects.earnkit.answers.problem', 'traction.line_pre_launch']) record = approvePath(record, path, NOW);
  await saveRecord(b.id, record, NOW);

  const t1 = new Date(NOW.getTime() + H);
  // Z Fellows is past the default two in-person programs (v6.1.4), so the full list shows the one the record fills.
  const first = await call(t1, 'find', { project: { ...p, live_url: 'https://earnkit.com', users: true }, filter: { all: true } });
  assert.equal(first.linked, true);
  const z = (allReady(first) as { program_id: string; from_record: number; fields: { key: string; from: string; value: string | null }[] }[]).find((x) => x.program_id === 'z-fellows')!;
  assert.deepEqual((await zFields(t1)).find((f) => f.key === 'problem')!.value, 'Builders lose weeks on grant forms.');
  assert.ok(z.from_record >= 2);
  // L29-26 (v6.1.16 Task 15): the full view is names and money; the counts are in the JSON.
  assert.equal((first.show_to_builder as string).split('\n').find((l) => l.startsWith('1. ')), '1. Arbitrum Mentorship Program: Cohort 2, up to $100,000.');

  const topReady = (allReady(first) as { program_id: string; fields: { key: string; required: boolean }[] }[])[0];
  const top = topReady.program_id;
  // v6.1.9 S6: a send under standing approval names every required answer it filled.
  const required = topReady.fields.filter((f) => f.required).map((f) => f.key);
  const started = await call(new Date(t1.getTime() + 60_000), 'track', { program_id: top, status: 'started', project_id: 'earnkit' });
  // L29-32 (v6.1.16 Task 15): started has no builder text; the note names it.
  assert.equal(started.show_to_builder, '');
  assert.match(started.agent_note as string, /^Started Arbitrum Mentorship Program: Cohort 2\. /);
  const applied = await call(new Date(t1.getTime() + 120_000), 'track', { program_id: top, status: 'applied', submitted_by: 'agent', fields_used: [...new Set(['email', 'problem', ...required])], project_id: 'earnkit' });
  assert.equal((applied.ledger as { applied: number }).applied, 1);
  // F1 (v6.1.10): the find held it back ("Before I send") for answers only the builder gives that the record lacks,
  // so naming every key does not make the send one under standing approval.
  // L29-6 (v6.1.16 Task 15): it is not on the list the approval covers.
  assert.ok(!((first.tonight as { programs: { program_id: string }[] } | undefined)?.programs ?? []).some((x) => x.program_id === top));
  assert.equal(applied.show_to_builder, 'Sent, but outside your standing approval: a required answer was missing.');

  const next = await call(new Date(NOW.getTime() + 10 * H), 'find', { project: { ...p, live_url: 'https://earnkit.com', users: true } });
  assert.deepEqual(next.applied_overnight, []);
  assert.doesNotMatch(next.show_to_builder as string, /Applied under your standing approval/);
  assert.ok(!(allReady(next) as { program_id: string }[]).some((x) => x.program_id === top));
});

test('every line the builder saw follows the copy rules and ends with one closing line', () => {
  assert.ok(seen.length >= 8);
  for (const show of seen) {
    assert.doesNotMatch(show, /\p{Extended_Pictographic}/u, show);
    assert.doesNotMatch(show, /—/, show);
    assert.doesNotMatch(show, /\b(coin|points|score|rank|streak|token)s?\b/i, show);
    assert.doesNotMatch(show, /\b(find|track|show_to_builder|agent_note|program_id|amount_usd|gap_done)\b|\.json\b/, show);
    const isReply = /Ready to apply|One step away|In person \(|Nothing fits yet/.test(show);
    // O2 (v6.1.10, Review Focus 5, fix round 1): a reply that lists in-person programs never ends on the bare "Nothing is
    // ready yet."; with no remote step shown it ends on starting the in-person applications.
    if (/^In person \(/m.test(show)) {
      assert.notEqual(show.split('\n').at(-1), 'Nothing is ready yet.', show);
      if (!/^(Ready to apply|One step away) \(/m.test(show)) assert.match(show, /Nothing remote is ready yet\. Say yes and I start the in-person applications\.$/, show);
    }
    if (!isReply) continue;
    // The first find after a link adds the linked notice to the closing line (security M2).
    // Fix round 1 (v6.1.14, F2): a proof gap with no link to give adds the linkless sign-in to the closing line.
    // L29-33 (v6.1.16 Task 15): the closing is its own line; the sign-in and the linked notice are their own lines.
    const CLOSING_START = /^(Say yes|Say "do|Say "yes|Nothing fits yet|Nothing is ready yet|Nothing remote is ready yet|Applying now to |.+ is over your limit\. Say yes|Sign in once and I check the repo is yours)/;
    const last = show.split('\n').find((l) => CLOSING_START.test(l)) ?? '';
    if (/^\d+\. .*: proof that /m.test(show)) assert.match(show, /^Sign in once\b/m, show);
    assert.equal(CLOSINGS.filter((c) => c.test(last)).length, 1, show);
    assert.equal(show.split('\n').filter((l) => /^(Say yes|Say "do|Say "yes|Nothing fits yet|Nothing is ready yet|Nothing remote is ready yet|Applying now to |.+ is over your limit\. Say yes|Sign in once and I check the repo is yours)/.test(l)).length, 1, show);
    // Each "yes n" and "do n" is said once (v6.1.8, 1a).
    for (const ask of show.match(/"(yes|do) \d+"/g) ?? []) assert.equal(show.split(ask).length, 2, show);
  }
});
