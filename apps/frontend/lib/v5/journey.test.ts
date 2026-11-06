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
import { approvePath } from '../v6/record';
import { evidence, liveRows } from '../v6/fixtures/evidence-builder';

process.env.EARNKIT_AUTH_SECRET ??= 'journey-test-secret-0123456789abcdef';
after(() => sql().end());
before(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;
const CLOSINGS = [
  /Say yes to apply to all \d+, numbers to skip, or "do \d+" and I'll make the change first\.$/,
  /Say yes to apply to all \d+, or numbers to skip\.$/,
  /Say "do \d+" and I'll make the change first\.$/,
  /Nothing fits yet\. I'll say when something opens\.$/,
  /Say yes to apply, or skip it\.$/,
  /Say yes to apply, skip it, or "do \d+" and I'll make the change first\.$/,
];
const seen: string[] = [];

/** Registers a client, issues a token and connects it as /mcp does; returns the installation id. */
async function stranger(): Promise<number> {
  registerClient({ redirect_uris: ['http://127.0.0.1:8123/callback'], client_name: 'Journey Agent' });
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
  assert.ok(gaps.length > 0 || /Nothing fits yet\. I'll say when something opens\.$/.test(show), show);
  // A program's own setup steps ("First: sign in to its hub") are the program's, not EarnKit asking who they are.
  const ours = show.replace(/ First: [^\n]*/g, '').replace(/^In person, apply to attend first:\n(\d+\. [^\n]*\n?)+/m, '');
  assert.doesNotMatch(ours, /\b(email|sign in|sign up|log in|your name|your team|telegram|account)\b/i);
  assert.equal(reply.as_reported, false);
});

test('the owner: ready or the builder codes gap, then applied and won on the ledger', async () => {
  const id = await stranger();
  const reply = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  const ready = (reply.ready as { program_id: string }[]).map((p) => p.program_id);
  const gaps = reply.gaps as { program_id: string; kind?: string; gap?: { kind: string } }[];
  const inGaps = gaps.some((g) => g.program_id === 'base-builder-grants');
  assert.ok(ready.includes('base-builder-grants') || inGaps, JSON.stringify({ ready, gaps }));
  if (inGaps) assert.match(JSON.stringify(gaps.find((g) => g.program_id === 'base-builder-grants')), /builder_codes|Builder Codes/);

  const top = ready[0];
  const t = await track(id, { program_id: top, status: 'applied' });
  assert.equal((t.ledger as { applied: number }).applied, 1);
  const after1 = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  assert.match(after1.show_to_builder as string, /Ledger: 1 applied/);

  const w = await track(id, { program_id: top, status: 'won', amount_usd: 5000 });
  assert.equal((w.ledger as { won: number }).won, 1);
  const after2 = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  assert.match(after2.show_to_builder as string, /Ledger: 1 applied.*, 1 won/);
});

test('a program closing in 3 days appears in since.closing on the second call', async () => {
  const id = await stranger();
  const first = await find(id, 'earnkit', { live_url: 'https://earnkit.com', users: true });
  const pick = (first.ready as { program_id: string }[])[0].program_id;
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

test('the owner, linked: record set, approved on /me, find fills from it, started, applied, and the next find says so', async () => {
  const id = await stranger();
  const b = await upsertBuilder({ github_id: 990_001, login: 'jenil', name: 'Jenil', avatar_url: null }, NOW);
  await linkInstallation(id, b.id, NOW);
  const { rec, project: p } = project('earnkit');
  const live = async () => evidence({ live: liveRows({ url: 'https://earnkit.com', url_ok: true }) });
  const at = (now: Date) => ({ installationId: id, builderId: b.id, now, gh: rec.fetch, evidence: live });
  const call = async (now: Date, tool: string, args: Record<string, unknown>) => {
    const r = await mcpCall(at(now), tool, args);
    assert.equal(r.isError, false, r.text);
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
  assert.match(set.show_to_builder as string, /^Saved\./);
  const before = await call(NOW, 'find', { project: { ...p, live_url: 'https://earnkit.com', users: true } });
  const z0 = (before.ready as { program_id: string; fields: { key: string; from: string }[] }[]).find((x) => x.program_id === 'z-fellows')!;
  assert.notEqual(z0.fields.find((f) => f.key === 'problem')!.from, 'record');

  // The builder approves on /me.
  let record = await getRecord(b.id);
  for (const path of ['projects.earnkit.answers.problem', 'traction.line_pre_launch']) record = approvePath(record, path, NOW);
  await saveRecord(b.id, record, NOW);

  const t1 = new Date(NOW.getTime() + H);
  const first = await call(t1, 'find', { project: { ...p, live_url: 'https://earnkit.com', users: true } });
  assert.equal(first.linked, true);
  const z = (first.ready as { program_id: string; from_record: number; fields: { key: string; from: string; value: string | null }[] }[]).find((x) => x.program_id === 'z-fellows')!;
  assert.deepEqual(z.fields.find((f) => f.key === 'problem')!.value, 'Builders lose weeks on grant forms.');
  assert.ok(z.from_record >= 2);
  assert.match(first.show_to_builder as string, /\d+ from your record, \d+ from the repo/);

  const top = (first.ready as { program_id: string }[])[0].program_id;
  const started = await call(new Date(t1.getTime() + 60_000), 'track', { program_id: top, status: 'started', project_id: 'earnkit' });
  assert.equal(started.show_to_builder, 'Started. Nothing else will submit this one for 24 hours.');
  const applied = await call(new Date(t1.getTime() + 120_000), 'track', { program_id: top, status: 'applied', submitted_by: 'agent', fields_used: ['email', 'problem'], project_id: 'earnkit' });
  assert.equal((applied.ledger as { applied: number }).applied, 1);

  const next = await call(new Date(NOW.getTime() + 10 * H), 'find', { project: { ...p, live_url: 'https://earnkit.com', users: true } });
  assert.deepEqual((next.applied_overnight as { program_id: string }[]).map((a) => a.program_id), [top]);
  assert.match(next.show_to_builder as string, /\n\nApplied overnight: [^\n]+\./);
  assert.ok(!(next.ready as { program_id: string }[]).some((x) => x.program_id === top));
});

test('every line the builder saw follows the copy rules and ends with one closing line', () => {
  assert.ok(seen.length >= 8);
  for (const show of seen) {
    assert.doesNotMatch(show, /\p{Extended_Pictographic}/u, show);
    assert.doesNotMatch(show, /—/, show);
    assert.doesNotMatch(show, /\b(coin|points|score|rank|streak|token)s?\b/i, show);
    assert.doesNotMatch(show, /\b(find|track|show_to_builder|agent_note|program_id|amount_usd|gap_done)\b|\.json\b/, show);
    const isReply = /Ready to apply|One change away|Nothing fits yet/.test(show);
    if (!isReply) continue;
    const last = show.split('\n').at(-1)!;
    assert.equal(CLOSINGS.filter((c) => c.test(last)).length, 1, show);
    assert.equal(show.split('\n').filter((l) => /^(Say yes|Say "do|Nothing fits yet)/.test(l)).length, 1, show);
  }
});
