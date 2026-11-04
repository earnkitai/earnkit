import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { replayFetch } from './fixtures/github';
import { mcpCall } from './fixtures/mcp-call';

after(() => sql().end());
beforeEach(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;
const CLOSINGS = [
  /Say yes to apply to all \d+, numbers to skip, or "do \d+" and I'll make the change first\.$/,
  /Say yes to apply to all \d+, or numbers to skip\.$/,
  /Say "do \d+" and I'll make the change first\.$/,
  /Nothing fits yet\. I'll say when something opens\.$/,
];

async function installation() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'find-' + Math.random()}) RETURNING id`;
  return r.id as number;
}
const rec = replayFetch('earnkit');
const PROJECT = { name: 'EarnKit', description: 'Grants for builders.', repo_url: `https://github.com/${rec.repo}` };
const ctx = (id: number, now = NOW) => ({ installationId: id, now, gh: rec.fetch });
const ids = (xs: unknown) => (xs as { program_id: string }[]).map((x) => x.program_id);

test('first find has no since', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const reply = r.reply!;
  assert.deepEqual(reply.since, { from: null, new: [], changed: [], closing: [] });
  const show = reply.show_to_builder as string;
  assert.ok(!show.includes('Since'));
  assert.ok(CLOSINGS.some((c) => c.test(show)), show);
  assert.ok((reply.ready as unknown[]).length > 0 && (reply.ready as unknown[]).length <= 5);
  assert.ok((reply.gaps as unknown[]).length <= 3);
  assert.equal(reply.as_reported, false);
  const [row] = await sql()`SELECT last_find_at FROM installations WHERE id = ${id}`;
  assert.equal((row.last_find_at as Date).toISOString(), NOW.toISOString());
  const first = (reply.ready as { fields: { from: string }[]; filled: number }[])[0];
  assert.ok(first.fields.length > 0);
  assert.doesNotMatch(show, /—|\b(coin|points|score|rank|streak|token)s?\b/i);
  assert.equal(
    show,
    [
      'Ready to apply, 5:',
      '1. Alliance ALL19, $400K at admission, closes in 14 days. Drafted.',
      '2. Avalanche Team1 Mini Grants, up to $10,000. Drafted: 8 facts from the repo.',
      '3. Z Fellows, up to $10K investment. Drafted: 2 facts from the repo.',
      '4. ETHGlobal Mumbai, up to $15K per partner prize, closes in 2 days, in person. Drafted: 3 facts from the repo.',
      '5. Arc Builders Fund, investment from Circle Ventures, a long shot: an investment program with no stated amount. Drafted: 1 fact from the repo. Needs your investor deck file.',
      '',
      'One change away, 1:',
      '6. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc and put a live link up.',
      '',
      'Say yes to apply to all 5, numbers to skip, or "do 6" and I\'ll make the change first.',
    ].join('\n'),
  );
  // Only what nobody but the builder can give: no contacts or team.
  for (const p of reply.ready as { needs: string[] }[]) for (const n of p.needs) assert.doesNotMatch(n, /email|name|team|telegram|x profile/i);
});

test('a deadline moved since the last find', async () => {
  const id = await installation();
  await sql()`UPDATE programs SET created_at = ${new Date(NOW.getTime() - 1000 * H)}`;
  await mcpCall(ctx(id), 'find', { project: PROJECT });
  const p = (await getProgram('alliance-all19'))!.file;
  await upsertProgram({ ...p, ends_at: '2026-11-25T23:59:59Z' }, 'file', new Date(NOW.getTime() + H));
  const r = await mcpCall(ctx(id, new Date(NOW.getTime() + 2 * H)), 'find', { project: PROJECT });
  const since = r.reply!.since as { changed: { program_id: string; what: string }[] };
  assert.equal(since.changed[0].program_id, 'alliance-all19');
  assert.match(since.changed[0].what, /^deadline moved/);
  assert.match(r.reply!.show_to_builder as string, /^Since /);
});

test('a skipped program leaves ready and gaps', async () => {
  const id = await installation();
  const before = await mcpCall(ctx(id), 'find', { project: PROJECT });
  const top = ids(before.reply!.ready)[0];
  const t = await mcpCall(ctx(id), 'track', { program_id: top, status: 'skipped' });
  assert.equal(t.isError, false, t.text);
  const after = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.ok(!ids(after.reply!.ready).includes(top));
  assert.ok(!ids(after.reply!.gaps).includes(top));
});

test('find with program_id: the fields, the money and the link', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'alliance-all19', project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const reply = r.reply!;
  assert.ok(Array.isArray(reply.fields) && (reply.fields as unknown[]).length > 0);
  assert.equal((reply.program as { id: string }).id, 'alliance-all19');
  assert.ok(reply.verdict);
  const show = reply.show_to_builder as string;
  assert.ok(show.includes('$400K at admission'), show);
  assert.ok(show.includes('https://alliance.xyz/apply'), show);
  assert.match(show, /Want me to draft it\?$/);
  const bare = await mcpCall(ctx(id), 'find', { program_id: 'alliance-all19' });
  assert.ok((bare.reply!.fields as { value: unknown }[]).every((f) => f.value === null));
  const none = await mcpCall(ctx(id), 'find', { program_id: 'no-such-program' });
  assert.equal(none.isError, false);
  assert.ok((none.reply!.show_to_builder as string).length > 0);
});

test('find with program_id carries the guide, and its rules sit between the two lines and the question', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'base-builder-grants' });
  assert.equal(r.isError, false, r.text);
  const guide = r.reply!.guide as { title: string; rules: string[]; eligibility: string[] };
  assert.equal(guide.title, 'Base Builder Grant Program');
  assert.ok(guide.rules.length > 0 && guide.eligibility.includes('a live product'));
  const lines = (r.reply!.show_to_builder as string).split('\n');
  assert.match(lines[0], /^Base Builder Grant Program, /);
  assert.match(lines[1], /^Apply at https:\/\/forms\.gle\//);
  assert.equal(lines[2], 'Rules:');
  assert.equal(lines.slice(3, -1).length, guide.rules.length);
  assert.equal(lines.at(-1), 'Want me to draft it?');
  const none = await mcpCall(ctx(id), 'find', { program_id: 'no-such-program' });
  assert.equal(none.reply!.guide, null);
});

test('find with no project: the open list and the ask for the project', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', {});
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.match(show, /^Open now:\n/);
  assert.ok(show.includes('Alliance ALL19, $400K at admission, closes in'), show);
  assert.match(r.reply!.agent_note as string, /project/);
  const [row] = await sql()`SELECT last_find_at FROM installations WHERE id = ${id}`;
  assert.equal(row.last_find_at, null);
});

test('a project with problems still matches; the problems go to the agent', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: { ...PROJECT, live_url: 'not a link', chains: [{ chain: 'nochain', mainnet: true }] } });
  assert.equal(r.isError, false, r.text);
  assert.ok((r.reply!.problems as string[]).length === 2);
  assert.match(r.reply!.agent_note as string, /live_url dropped/);
  assert.ok((r.reply!.ready as unknown[]).length > 0);
});

test('filter.all lists the rest with a reason; the leftover count is in the note otherwise', async () => {
  const id = await installation();
  const capped = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.match(capped.reply!.agent_note as string, /\d+ more fit; ask with filter\.all for the full list\./);
  const all = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { all: true } });
  assert.ok((all.reply!.ready as unknown[]).length > 5);
  const notFit = all.reply!.not_fit as { program_id: string; reason: string }[];
  assert.ok(notFit.some((n) => n.program_id === 'base-builder-grants' && n.reason.length > 0));
  const grants = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { category: 'investment', all: true } });
  assert.ok((grants.reply!.ready as { category: string }[]).every((p) => p.category === 'investment'));
});

test('a repo read that fails never fails find', async () => {
  const id = await installation();
  const broken = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const r = await mcpCall({ installationId: id, now: NOW, gh: broken }, 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
});

test('a result past due is asked once', async () => {
  const id = await installation();
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-due', title: 'Due Grant', results_due: { date: '2026-11-01' } }), 'file', NOW);
  const t = await mcpCall(ctx(id), 'track', { program_id: 'f-due', status: 'applied' });
  assert.equal(t.isError, false, t.text);
  const first = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.deepEqual(first.reply!.ask_outcome, [{ program_id: 'f-due', title: 'Due Grant' }]);
  assert.match(first.reply!.agent_note as string, /Due Grant/);
  const second = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.deepEqual(second.reply!.ask_outcome, []);
});
