import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { replayFetch } from './fixtures/github';
import { mcpCall } from './fixtures/mcp-call';
import { lastGaps } from './installations';
import { shownReadyOf } from './find';

after(() => sql().end());
beforeEach(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;
const CLOSINGS = [
  /Say yes to apply to all \d+, numbers to skip, or "do \d+" and I'll make the change first\.$/,
  /Say yes to apply to all \d+, or numbers to skip\.$/,
  /Say yes to apply, or skip it\.$/,
  /Say yes to apply, skip it, or "do \d+" and I'll make the change first\.$/,
  /Say "do \d+" and I'll make the change first\.$/,
  /Nothing fits yet\. I'll say when something opens\.$/,
  // v6.1.6 (R18a): a rule-only gap is named with "yes r".
  /Say yes to apply, skip it, or "yes \d+" if its rule fits you\.$/,
  /Say yes to apply to all \d+, numbers to skip, or "yes \d+" if its rule fits you\.$/,
  /Say yes to apply(, skip it| to all \d+, numbers to skip), "yes \d+" if its rule fits you, or "do \d+" and I'll make the change first\.$/,
  /Say "yes \d+" if its rule fits you(, or "do \d+" and I'll make the change first)?\.$/,
];

async function installation() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'find-' + Math.random()}) RETURNING id`;
  return r.id as number;
}
const rec = replayFetch('earnkit');
// The agent knows the live link (it passes it); whether real people use it, it does not say.
const PROJECT = { name: 'EarnKit', description: 'Grants for builders.', repo_url: `https://github.com/${rec.repo}`, live_url: 'https://earnkit.com' };
const ctx = (id: number, now = NOW) => ({ installationId: id, builderId: null, now, gh: rec.fetch });
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
  // Up to five remote and two in person (v6.1.4).
  const shownReady = reply.ready as { in_person: boolean }[];
  assert.ok(shownReady.filter((p) => !p.in_person).length > 0 && shownReady.filter((p) => !p.in_person).length <= 5);
  assert.ok(shownReady.filter((p) => p.in_person).length <= 2);
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
      'Ready to apply, 1:',
      '1. Arbitrum Mentorship Program: Cohort 2, $100K in prizes, closes in 32 days. Long odds: few prizes for many entries. Drafted: 2 of 22 answers from the repo, 17 more by your agent. Needs your top 3 successes, whether you raised funds before and current TVL range.',
      '',
      'One change away, 3:',
      '2. Circle Developer Grants, $5,000 to $100,000 USDC grants: deploy the contract on Arc.',
      '3. FLOSS/fund, $10,000 to $100,000: tell me if real people use it.',
      '4. Antler US Residency, $500K to $1M investment. Their rule: at least one co-founder already has independent US work authorization; no visa sponsorship. Say "yes 4" if that is you.',
      '',
      'In person, apply to attend first:',
      '5. Y Combinator Winter 2027 Batch, $500K investment. A YC account to start the application.',
      "6. Alliance ALL19, $400K at admission, closes in 14 days. Start the application with the first founder's email.",
      '',
      'Before applying: Sign in once to Y Combinator for 1 of them. Needs your click: Y Combinator Winter 2027 Batch.',
      '',
      'Say yes to apply, skip it, "yes 4" if its rule fits you, or "do 2" and I\'ll make the change first.',
    ].join('\n'),
  );
  // Only what nobody but the builder can give: no contacts or team. Whole words, so a program named Team1 is not "team".
  for (const p of reply.ready as { needs: string[]; setup: string[] }[])
    for (const n of p.needs.filter((x) => !p.setup.includes(x))) assert.doesNotMatch(n, /email|name|\bteam\b|telegram|x profile/i);
});

test('find saves every gap it found for track to read (last_gaps)', async () => {
  type G = { program_id: string; gap: { what: string } };
  // Every gap of this project, with its first gap's what, as filter.all lists them.
  const every = (await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } })).reply!.gaps as G[];
  const want = Object.fromEntries(every.map((g) => [g.program_id, g.gap.what]));
  // A default find shows only some of them, and still saves them all.
  const id = await installation();
  const shown = (await mcpCall(ctx(id), 'find', { project: PROJECT })).reply!.gaps as G[];
  assert.ok(every.length > shown.length, `fixture needs more gaps than a default find shows: ${every.length} vs ${shown.length}`);
  const saved = await lastGaps(id);
  assert.deepEqual(saved, want);
  assert.ok(Object.keys(saved).length > shown.length);
  for (const g of shown) assert.equal(saved[g.program_id], g.gap.what);
});

test('default list: in-person programs never take a remote ready slot (v6.1.4)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  const show = r.reply!.show_to_builder as string;
  const ready = r.reply!.ready as { title: string; in_person: boolean }[];
  const remote = ready.filter((p) => !p.in_person);
  const attend = ready.filter((p) => p.in_person);
  assert.ok(remote.length >= 1 && remote.length <= 5, show);
  assert.ok(attend.length <= 2, show);
  assert.match(show, /^Ready to apply/m);
  // v6.1.6 (R18a): rule-only programs are one answer away, so one remote program is ready, as in v6.1.4.
  assert.deepEqual(remote.map((p) => p.title), ['Arbitrum Mentorship Program: Cohort 2'], show);
  const block = show.split('\n\nIn person, apply to attend first:\n')[1]?.split('\n\n')[0] ?? '';
  assert.ok(block.split('\n').filter(Boolean).length <= 2, show);
});

/** A synthetic in-person program (the real ones close once their attend-by date passes). */
async function withInPerson<T>(run: () => Promise<T>): Promise<T> {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-attend', title: 'Attend Summit', in_person: true, setup: ['apply to attend and get accepted'] }), 'file', NOW);
  try {
    return await run();
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-attend'`;
  }
}

test('the numbers the builder sees are the n of each item: ready in order, gaps, then in person', async () => withInPerson(async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { all: true } });
  const reply = r.reply!;
  const show = reply.show_to_builder as string;
  const ready = reply.ready as { program_id: string; title: string; n: number; in_person: boolean }[];
  const gaps = reply.gaps as { program_id: string; title: string; n: number }[];
  const printed = (n: number) => new RegExp(`^${n}\\. ([^,]+),`, 'm').exec(show)?.[1];
  // The full list, so the synthetic in-person program shows past the default two (v6.1.4).
  assert.equal(printed(1), ready[0].title);
  assert.deepEqual([ready[0].in_person, ready[0].n], [false, 1]);
  assert.equal(printed(36), ready[3].title);
  assert.equal(ready[3].n, 36);
  const inPerson = ready.find((p) => p.in_person)!;
  assert.equal(printed(inPerson.n), inPerson.title);
  // The real in-person programs are open now too: from the first in-person one on, every ready item is in person, numbered after every gap.
  assert.equal(inPerson.program_id, 'f-attend');
  assert.ok(ready.slice(ready.indexOf(inPerson)).every((p) => p.in_person && gaps.every((g) => g.n < p.n)));
  for (const x of [...ready, ...gaps]) assert.equal(printed(x.n), x.title, String(x.n));
  assert.deepEqual([...ready, ...gaps].map((x) => x.n).sort((a, b) => a - b), Array.from({ length: ready.length + gaps.length }, (_, i) => i + 1));
  assert.match(reply.agent_note as string, /numbers the builder says are each item's n/);
}));

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

test('find with program_id: a closed program is closed, an upcoming one not open yet; neither offers a draft', async () => {
  const id = await installation();
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-shut', title: 'Shut Grants', status: 'closed' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f-past', title: 'Past Grants', ends_at: '2026-11-01T00:00:00Z' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f-soon', title: 'Soon Grants', status: 'upcoming', opens_note: 'Opens in January' }), 'file', NOW);
  for (const pid of ['f-shut', 'f-past']) {
    const r = await mcpCall(ctx(id), 'find', { program_id: pid, project: PROJECT });
    const show = r.reply!.show_to_builder as string;
    assert.match(show, /This one is closed\.$/, show);
    assert.doesNotMatch(show, /draft/);
    assert.match(r.reply!.agent_note as string, /draft nothing/);
  }
  const soon = await mcpCall(ctx(id), 'find', { program_id: 'f-soon' });
  const show = soon.reply!.show_to_builder as string;
  assert.match(show, /Not open yet: Opens in January\.$/, show);
  assert.doesNotMatch(show, /draft/);
});

test('a 2,000-character description is cut, not refused: find still answers ready and gaps', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: { ...PROJECT, description: 'Grants for builders. '.repeat(100) } });
  assert.equal(r.isError, false, r.text);
  assert.ok((r.reply!.ready as unknown[]).length > 0);
  assert.ok(Array.isArray(r.reply!.gaps));
  assert.deepEqual(r.reply!.problems, ['description cut to 280 characters']);
  assert.doesNotMatch(r.reply!.show_to_builder as string, /^Open now/);
});

test('find with no project: the open list and the ask for the project', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', {});
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.match(show, /^Open now:\n/);
  assert.ok(show.includes('Alliance ALL19, $400K at admission, closes in'), show);
  const lines = show.split('\n');
  for (const line of lines.slice(1)) assert.ok(line.endsWith('.'), line);
  assert.equal(lines.at(-1), "Tell me which project and I'll match it.");
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

test('filter.all lists the rest with a reason; the leftover count is in the note otherwise', async () => withInPerson(async () => {
  const id = await installation();
  const capped = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.match(capped.reply!.agent_note as string, /\d+ more fit; ask with filter\.all for the full list\./);
  const all = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { all: true } });
  assert.ok((all.reply!.ready as unknown[]).length > 5);
  const notFit = all.reply!.not_fit as { program_id: string; reason: string }[];
  assert.ok(notFit.every((n) => n.reason.length > 0));
  assert.ok(!notFit.some((n) => n.program_id === 'base-builder-grants'));
  const { live_url: _, ...noLink } = PROJECT;
  const offline = await mcpCall(ctx(id), 'find', { project: noLink, filter: { all: true } });
  assert.ok((offline.reply!.not_fit as { program_id: string; reason: string }[]).some((n) => n.program_id === 'base-builder-grants' && n.reason.length > 0));
  const grants = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { category: 'investment', all: true } });
  assert.ok((grants.reply!.ready as { category: string }[]).every((p) => p.category === 'investment'));
}));

test('a repo read that fails never fails find', async () => {
  const id = await installation();
  const broken = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const r = await mcpCall({ installationId: id, builderId: null, now: NOW, gh: broken }, 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
});

test('a result past due is asked once', async () => {
  const id = await installation();
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-due', title: 'Due Grant', results_due: { date: '2026-11-01' } }), 'file', NOW);
  try {
    const t = await mcpCall(ctx(id), 'track', { program_id: 'f-due', status: 'applied' });
    assert.equal(t.isError, false, t.text);
    const first = await mcpCall(ctx(id), 'find', { project: PROJECT });
    assert.deepEqual(first.reply!.ask_outcome, [{ program_id: 'f-due', title: 'Due Grant' }]);
    assert.match(first.reply!.agent_note as string, /Due Grant/);
    const second = await mcpCall(ctx(id), 'find', { project: PROJECT });
    assert.deepEqual(second.reply!.ask_outcome, []);
  } finally {
    // v6.1.2: a leftover Due Grant is the only non-in-person ready line in later finds; it must not outlive this test.
    await sql()`DELETE FROM programs WHERE id = 'f-due'`;
  }
});

// v6.1: the record side of find.
const LIVE = async () => {
  const { evidence, liveRows } = await import('../v6/fixtures/evidence-builder');
  return evidence({ live: liveRows({ url: 'https://earnkit.com', url_ok: true }) });
};
let ghId = 920_000;
/** A linked installation whose builder holds `patch` (merged by the builder, `approve` approved). */
async function linkedWith(patch: Record<string, unknown>, approve: string[] = []) {
  const { saveInstallation, connectInstallation } = await import('./installations');
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, approvePath, mergeRecord } = await import('../v6/record');
  const token = 'find-linked-' + Math.random();
  await saveInstallation(token, 'Claude Code');
  const id = (await connectInstallation(token))!.id;
  const b = await upsertBuilder({ github_id: ++ghId, login: 'fl' + ghId, name: 'FL', avatar_url: null }, NOW);
  await linkInstallation(id, b.id, NOW);
  const m = mergeRecord(EMPTY_RECORD, patch, 'builder', NOW);
  assert.deepEqual(m.problems, []);
  await saveRecord(b.id, approve.reduce((r, p) => approvePath(r, p, NOW), m.record), NOW);
  return { id, builderId: b.id };
}
const OWNER_RECORD = {
  person: { name: 'Jenil Thakker', email: 'jenil@example.com' },
  projects: [{ id: 'earnkit', name: 'EarnKit', repo_url: `https://github.com/${rec.repo}`, live_url: 'https://earnkit.com', answers: { problem: { text: 'Builders lose weeks on grant forms.' } } }],
};
const OAUTH_ENV = { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_URL: 'https://earnkit.test', EARNKIT_AUTH_SECRET: 'find-test-secret' };
async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('unlinked without oauth is v5', async () => {
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /Sign in once at/);
  assert.doesNotMatch(show, /record/i);
  assert.equal(r.reply!.linked, false);
  assert.equal('sign_in' in r.reply!, false);
  assert.ok(CLOSINGS.some((c) => c.test(show.split('\n').at(-1)!)), show);
  assert.deepEqual([r.reply!.record_missing, r.reply!.evidence_summary, r.reply!.applied_overnight, r.reply!.released, r.reply!.auto_apply], [[], null, [], [], false]);
  // v6.1.3 R4: the blockers are named unlinked too.
  assert.ok((r.reply!.blockers as unknown[]).length > 0);
  assert.doesNotMatch(r.reply!.agent_note as string, /approved answers|style contract/);
});

test('unlinked with sign-in configured: the closing line, then the sign-in as its second sentence (R5a)', async () => withEnv(OAUTH_ENV, async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  const show = r.reply!.show_to_builder as string;
  const blocks = show.split('\n\n');
  const link = r.reply!.sign_in as string;
  assert.match(link, /\/link\//);
  const sentence = ` Sign in once at ${link} and I read your repo for proof and remember you.`;
  assert.ok(blocks.at(-1)!.endsWith(sentence), show);
  assert.ok(CLOSINGS.some((c) => c.test(blocks.at(-1)!.slice(0, -sentence.length))), show);
  assert.equal(show.match(/Sign in once at/g)!.length, 1);
  assert.equal(r.reply!.linked, false);
}));

test('linked: record fields, what the record lacks, blockers, and the own tier read once a day', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD, ['projects.earnkit.answers.problem']);
  let reads = 0;
  const evidence = async () => {
    reads++;
    return LIVE();
  };
  const r = await mcpCall({ ...ctx(id), builderId, evidence }, 'find', { project: PROJECT, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const reply = r.reply!;
  assert.equal(reply.linked, true);
  const ready = reply.ready as { program_id: string; from_record: number; fields: { key: string; from: string; value: string | null; style?: string }[]; need_you: string[] }[];
  const z = ready.find((p) => p.program_id === 'z-fellows')!;
  assert.ok(z.from_record > 0, JSON.stringify(z));
  const problem = z.fields.find((f) => f.key === 'problem')!;
  assert.deepEqual([problem.from, problem.value, typeof problem.style], ['record', 'Builders lose weeks on grant forms.', 'string']);
  assert.equal(z.fields.find((f) => f.key === 'email')!.value, 'jenil@example.com');
  assert.ok((reply.record_missing as string[]).includes('your founder video link'), JSON.stringify(reply.record_missing));
  const blockers = reply.blockers as { program_id: string; sign_in: string | null; needs_click: boolean; needs: string[] }[];
  // v6.1.2: Avalanche now carries an eligibility gap; Y Combinator is the ready program with a platform sign-in (and a click).
  const yc = blockers.find((b) => b.program_id === 'y-combinator')!;
  assert.deepEqual([yc.sign_in, yc.needs_click], ['Y Combinator', true]);
  assert.deepEqual(blockers.find((b) => b.program_id === 'z-fellows')?.needs, ['founder_video']);
  assert.deepEqual((reply.evidence_summary as { tier: string }).tier, 'live');
  const show = reply.show_to_builder as string;
  assert.match(show, /^1\. [^\n]+ \d+ from your record, \d+ from the repo/m);
  assert.match(show, /\n\nBefore applying: [^\n]*Sign in once to Y Combinator for 1 of them\.[^\n]*Still missing from your record: [^\n]+\./);
  assert.match(show, /\n\nYour project reads as live, no verified usage yet\. Next: [^\n]+\.\n\n/);
  assert.doesNotMatch(show, /Sign in once at/);
  assert.match(reply.agent_note as string, /Fit approved answers by cutting, never by adding; the style contract travels on each field\./);
  assert.match(reply.agent_note as string, /Sign-ins and clicks the builder must do are in blockers/);
  assert.equal(reads, 1);

  // Inside 24 hours: no read, the stored tier.
  const { getRecord } = await import('../v6/builders');
  const stored = (await getRecord(builderId)).projects[0];
  assert.equal(stored.evidence_read_at, NOW.toISOString());
  assert.equal(stored.last_tier?.tier, 'live');
  const again = await mcpCall({ ...ctx(id, new Date(NOW.getTime() + 2 * H)), builderId, evidence }, 'find', { project: PROJECT });
  assert.equal(reads, 1);
  assert.equal((again.reply!.evidence_summary as { tier: string }).tier, 'live');

  // A read that throws: no summary, nothing stored, one problem.
  const { id: id2, builderId: b2 } = await linkedWith(OWNER_RECORD);
  const broken = await mcpCall({ ...ctx(id2), builderId: b2, evidence: async () => { throw new Error('down'); } }, 'find', { project: PROJECT });
  assert.equal(broken.isError, false, broken.text);
  assert.equal(broken.reply!.evidence_summary, null);
  assert.ok((broken.reply!.problems as string[]).includes('evidence not read'));
  assert.doesNotMatch(broken.reply!.agent_note as string, /evidence not read/);
  assert.equal((await getRecord(b2)).projects[0].evidence_read_at, undefined);
});

test('min_tier above the project tier moves the program to gaps with kind tier; unknown tier passes', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-tier', title: 'Tier Grant', min_tier: 'used' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith(OWNER_RECORD);
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    const gaps = r.reply!.gaps as { program_id: string; gap: { kind: string; item: string; what: string; effort: string; agent_can: boolean } }[];
    const g = gaps.find((x) => x.program_id === 'f-tier');
    assert.ok(g, JSON.stringify(gaps.map((x) => x.program_id)));
    assert.deepEqual(g.gap, { kind: 'tier', item: 'tier:used', what: '25 funded wallets on mainnet in 90 days; you have 0', effort: 'weeks', agent_can: false, details: { tier: 'live', min_tier: 'used' } });
    assert.ok(!ids(r.reply!.ready).includes('f-tier'));
    // A read that fails leaves the own tier unknown: the bar falls back to the provisional one (R3c), building here.
    const other = await linkedWith(OWNER_RECORD);
    const u = await mcpCall({ ...ctx(other.id), builderId: other.builderId, evidence: async () => { throw new Error('down'); } }, 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(u.reply!.gaps).includes('f-tier'));
    assert.match(u.reply!.show_to_builder as string, /Tier Grant, Up to \$5,000: Link GitHub so EarnKit can confirm your product has users\./);
    // Unlinked (v6.1.3 R3): the repo read reads as building at most, so a used bar is a gap; an unread repo has no bar.
    const v5 = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(v5.reply!.gaps).includes('f-tier'));
    const unread = await mcpCall(ctx(await installation()), 'find', { project: { ...PROJECT, private: true }, filter: { all: true } });
    assert.ok(ids(unread.reply!.ready).includes('f-tier'));
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-tier'`;
  }
});

// v6.1.3 R3: unlinked, a provisional tier from the repo read gates min_tier; it never reaches evidence_summary.
const CONFIRM = 'Link GitHub so EarnKit can confirm your product is live';
async function withLiveBar<T>(run: () => Promise<T>): Promise<T> {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-live', title: 'Live Grant', min_tier: 'live' }), 'file', NOW);
  try {
    return await run();
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-live'`;
  }
}

/** The builder's text has Live Grant as a ready line and no confirm line. */
function assertLiveReady(show: string) {
  assert.match(show, /^\d+\. Live Grant, Up to \$5,000\. /m, show);
  assert.doesNotMatch(show, /Link GitHub so EarnKit can confirm/, show);
}

test('unlinked: each bar names itself in the gap line (R3b)', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { provisionalGate } = await import('../v6/find-record');
  const ready = { program_id: 'f', status: 'ready' as const, gaps: [], reason: null, long_shot: null, rules: [] };
  const line = (min: 'used' | 'live' | 'building', tier: 'building' | 'unverified' | 'live') =>
    provisionalGate(ready, { id: 'f', file: programFixture({ id: 'f', min_tier: min }) } as never, tier).gaps[0]?.what;
  assert.equal(line('used', 'live'), 'Link GitHub so EarnKit can confirm your product has users');
  assert.equal(line('live', 'building'), 'Link GitHub so EarnKit can confirm your product is live');
  assert.equal(line('building', 'unverified'), 'Link GitHub so EarnKit can confirm your product has code');
});

test('unlinked: a public repo with no live URL from code and no mainnet contract is a gap with the link line (R3)', async () => withLiveBar(async () => {
  const { live_url: _, ...noLink } = PROJECT;
  const r = await mcpCall(ctx(await installation()), 'find', { project: noLink, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, false);
  assert.ok(!ids(r.reply!.ready).includes('f-live'));
  const g = (r.reply!.gaps as { program_id: string; n: number; gap: { kind: string; what: string; details?: unknown } }[]).find((x) => x.program_id === 'f-live');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(g.gap.kind, 'tier');
  assert.equal(g.gap.what, CONFIRM);
  assert.match(r.reply!.show_to_builder as string, new RegExp(`^${g.n}\\. Live Grant, Up to \\$5,000: ${CONFIRM}\\.$`, 'm'));
  assert.equal(r.reply!.evidence_summary, null);
  // A live URL the agent reports is not the code's: still the gap (the earnkit repo has no homepage).
  const reported = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
  assert.ok(ids(reported.reply!.gaps).includes('f-live'));
  assert.equal(reported.reply!.evidence_summary, null);
}));

test('unlinked: a live URL read from the code passes the live bar (R3)', async () => withLiveBar(async () => {
  const dash = replayFetch('nextjs-dashboard');
  const r = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch }, 'find', {
    project: { name: 'Dashboard', description: 'A dashboard.', repo_url: `https://github.com/${dash.repo}` }, filter: { all: true },
  });
  assert.equal(r.isError, false, r.text);
  assert.ok(ids(r.reply!.ready).includes('f-live'), JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(r.reply!.evidence_summary, null);
  assertLiveReady(r.reply!.show_to_builder as string);
  // R3a: the agent passing the live URL (as the note asks) keeps the code's homepage: still live.
  const passed = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch }, 'find', {
    project: { name: 'Dashboard', description: 'A dashboard.', repo_url: `https://github.com/${dash.repo}`, live_url: 'https://dashboard-v1-ashy.vercel.app' }, filter: { all: true },
  });
  assert.equal(passed.isError, false, passed.text);
  assert.ok(ids(passed.reply!.ready).includes('f-live'), JSON.stringify(ids(passed.reply!.gaps)));
  assertLiveReady(passed.reply!.show_to_builder as string);
}));

test('linked with an empty record: the provisional bar holds after sign-in, with the line for the bar (R3c)', async () => withLiveBar(async () => {
  const { id, builderId } = await linkedWith({});
  const { live_url: _, ...noLink } = PROJECT;
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: noLink, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.linked, true);
  const g = (r.reply!.gaps as { program_id: string; n: number; gap: { kind: string; what: string } }[]).find((x) => x.program_id === 'f-live');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(g.gap.kind, 'tier');
  assert.match(r.reply!.show_to_builder as string, new RegExp(`^${g.n}\\. Live Grant, Up to \\$5,000: Link GitHub so EarnKit can confirm your product is live\\.$`, 'm'));
  assert.equal(r.reply!.evidence_summary, null);
}));

test('unlinked: a repo that could not be read applies no tier bar (R3)', async () => withLiveBar(async () => {
  const { live_url: _, ...noLink } = PROJECT;
  const r = await mcpCall(ctx(await installation()), 'find', { project: { ...noLink, private: true }, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
  assert.ok(ids(r.reply!.ready).includes('f-live'));
  assert.ok(!(r.reply!.gaps as { gap: { kind: string } }[]).some((g) => g.gap.kind === 'tier'));
}));

test('unlinked: blockers name the sign-ins, clicks and documents as linked does, never outside_approval (R4)', async () => withInPerson(async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
  const blockers = r.reply!.blockers as { program_id: string; sign_in: string | null; needs_click: boolean; needs: string[]; outside_approval?: true }[];
  const yc = blockers.find((b) => b.program_id === 'y-combinator');
  assert.ok(yc, JSON.stringify(blockers));
  assert.equal(yc.sign_in, 'Y Combinator');
  assert.ok(blockers.every((b) => !('outside_approval' in b)));
  // Only ready programs are named; the in-person one keeps its own block.
  const ready = new Set(ids(r.reply!.ready));
  assert.ok(blockers.every((b) => ready.has(b.program_id)));
  const show = r.reply!.show_to_builder as string;
  assert.match(show, /Sign in once to Y Combinator for 1 of them\./);
  assert.match(show, /\n\nIn person, apply to attend first:\n/);
  assert.equal(r.reply!.evidence_summary, null);
  assert.deepEqual(r.reply!.record_missing, []);
}));

test('auto_apply changes the closing line and the agent note; never removes a program', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 2, never: ['z-fellows'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  const show = r.reply!.show_to_builder as string;
  const blocked = new Set((r.reply!.blockers as { program_id: string; sign_in: string | null; needs_click: boolean }[]).filter((b) => b.sign_in || b.needs_click).map((b) => b.program_id));
  const free = (r.reply!.ready as { program_id: string; in_person: boolean }[]).filter((p) => !p.in_person && !blocked.has(p.program_id)).length;
  assert.ok(free >= 1, show);
  assert.match(show, new RegExp(`\\n\\nApplying tonight to ${Math.min(2, free)}; say stop to hold any\\.$`));
  assert.doesNotMatch(show, /Say yes/);
  assert.equal(r.reply!.auto_apply, true);
  assert.match(r.reply!.agent_note as string, /^Standing approval is on: for each ready program within the limits, call track started/m);
  assert.ok(!ids(r.reply!.ready).includes('z-fellows'));
});

type B = { program_id: string; sign_in: string | null; needs_click: boolean; outside_approval?: true };
/** The ready programs the agent may send alone tonight: no sign-in, click or approval limit in the way. */
const freeOf = (reply: Record<string, unknown>) => {
  const blocked = new Set((reply.blockers as B[]).filter((b) => b.sign_in || b.needs_click || b.outside_approval).map((b) => b.program_id));
  return (reply.ready as { program_id: string; in_person: boolean }[]).filter((p) => !p.in_person && !blocked.has(p.program_id));
};

test('categories limit only what the agent sends alone: an investment program stays ready, not counted tonight', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, categories: ['grant', 'hackathon', 'bounty'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const ready = r.reply!.ready as { program_id: string; title: string; category: string; in_person: boolean }[];
  const invest = ready.filter((p) => p.category === 'investment');
  assert.ok(invest.length > 0, JSON.stringify(ids(ready)));
  const blockers = r.reply!.blockers as B[];
  for (const p of invest) assert.equal(blockers.find((b) => b.program_id === p.program_id)?.outside_approval, true, p.program_id);
  assert.ok(blockers.filter((b) => b.outside_approval).every((b) => invest.some((p) => p.program_id === b.program_id)));
  const free = freeOf(r.reply!);
  assert.ok(free.every((p) => !invest.some((x) => x.program_id === p.program_id)));
  const show = r.reply!.show_to_builder as string;
  const named = invest.filter((p) => !blockers.find((b) => b.program_id === p.program_id)!.needs_click).map((p) => p.title);
  assert.ok(named.length > 0);
  assert.ok(show.includes(`Outside your standing approval, you say yes yourself: ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`}.`), show);
  assert.match(show, free.length > 0 ? new RegExp(`\\n\\nApplying tonight to ${free.length}; say stop to hold any\\.$`) : /Say yes/);
  assert.match(r.reply!.agent_note as string, /outside_approval/);
});

test('max_ask_usd keeps a larger ask out of tonight and names it; a program with no stated amount is not over it', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-big', title: 'Big Grant', reward: 'Up to $50,000 per grant', summary: 'Up to $50,000 · rolling', max_award_usd: 50_000 }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f-open', title: 'Open Grant' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, max_ask_usd: 10_000 } });
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    assert.equal(r.isError, false, r.text);
    const ready = ids(r.reply!.ready);
    assert.ok(ready.includes('f-big') && ready.includes('f-open'), JSON.stringify(ready));
    const blockers = r.reply!.blockers as B[];
    assert.deepEqual(blockers.find((b) => b.program_id === 'f-big'), { program_id: 'f-big', sign_in: null, needs_click: false, needs: [], outside_approval: true });
    assert.equal(blockers.find((b) => b.program_id === 'f-open'), undefined);
    const free = ids(freeOf(r.reply!));
    assert.ok(free.includes('f-open') && !free.includes('f-big'), JSON.stringify(free));
    const show = r.reply!.show_to_builder as string;
    assert.match(show, /Outside your standing approval, you say yes yourself: [^\n]*Big Grant[^\n]*\./);
    assert.doesNotMatch(show, /yourself: [^\n]*Open Grant/);
    assert.match(show, new RegExp(`\\n\\nApplying tonight to ${free.length}; say stop to hold any\\.$`));
    // With auto_apply off, the limits change nothing.
    const off = await linkedWith({ ...OWNER_RECORD, policy: { max_ask_usd: 10_000, categories: ['grant'] } });
    const o = await mcpCall({ ...ctx(off.id), builderId: off.builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(o.reply!.ready).includes('f-big'));
    assert.ok((o.reply!.blockers as B[]).every((b) => !b.outside_approval));
    assert.doesNotMatch(o.reply!.show_to_builder as string, /Outside your standing approval/);
  } finally {
    await sql()`DELETE FROM programs WHERE id IN ('f-big', 'f-open')`;
  }
});

test('never removes a program from the list entirely', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { never: ['z-fellows'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  const listed = [...ids(r.reply!.ready), ...ids(r.reply!.gaps), ...ids(r.reply!.not_fit), ...ids(r.reply!.blockers)];
  assert.ok(!listed.includes('z-fellows'), JSON.stringify(listed));
  assert.doesNotMatch(r.reply!.show_to_builder as string, /Z Fellows/);
});

test('a stale claim shows in released; a live one stays ready, marked', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const { claim } = await import('../v6/claims');
  await claim(`b:${builderId}`, 'alliance-all19', 'earnkit', id, new Date(NOW.getTime() - 25 * H));
  // v6.1.4: the default list shows two in-person programs (YC and Alliance), so the live claim is on one shown.
  await claim(`b:${builderId}`, 'y-combinator', 'earnkit', id, new Date(NOW.getTime() - H));
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  assert.deepEqual(r.reply!.released, ['alliance-all19']);
  assert.match(r.reply!.agent_note as string, /released: alliance-all19/);
  const ready = r.reply!.ready as { program_id: string; claimed_since?: string }[];
  assert.ok(ids(ready).includes('alliance-all19'));
  assert.equal(ready.find((p) => p.program_id === 'y-combinator')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
  assert.match(r.reply!.agent_note as string, /claimed_since is claimed by one of the builder's agents: submit it only if you made that claim\./);
});

test('find with program_id, linked: the record fills an approved answer; unlinked as before', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD, ['projects.earnkit.answers.problem']);
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { program_id: 'z-fellows', project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const fields = r.reply!.fields as { key: string; from: string; value: string | null; style?: string }[];
  const problem = fields.find((f) => f.key === 'problem')!;
  assert.deepEqual([problem.from, problem.value, typeof problem.style], ['record', 'Builders lose weeks on grant forms.', 'string']);
  assert.equal(fields.find((f) => f.key === 'email')!.value, 'jenil@example.com');
  assert.match(r.reply!.agent_note as string, /Fit approved answers by cutting, never by adding; the style contract travels on each field\./);
  // Without a project, the record still fills (the first project).
  const bare = await mcpCall({ ...ctx(id), builderId }, 'find', { program_id: 'z-fellows' });
  assert.equal((bare.reply!.fields as { key: string; from: string }[]).find((f) => f.key === 'problem')!.from, 'record');
  const v5 = await mcpCall(ctx(await installation()), 'find', { program_id: 'z-fellows', project: PROJECT });
  const v5fields = v5.reply!.fields as { from: string }[];
  assert.ok(v5fields.every((f) => f.from !== 'record'));
  assert.doesNotMatch(v5.reply!.agent_note as string, /Fit approved answers/);
});

test('a failed own read keeps the stored tier line; a broken link never fails find; the open list carries the sign-in line', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  const later = await mcpCall({ ...ctx(id, new Date(NOW.getTime() + 30 * H)), builderId, evidence: async () => { throw new Error('down'); } }, 'find', { project: PROJECT });
  assert.equal((later.reply!.evidence_summary as { tier: string }).tier, 'live');
  assert.ok((later.reply!.problems as string[]).includes('evidence not read'));

  const broken = await mcpCall({ ...ctx(await installation()), linkUrl: async () => { throw new Error('db blip'); } }, 'find', { project: PROJECT });
  assert.equal(broken.isError, false, broken.text);
  assert.equal('sign_in' in broken.reply!, false);

  await withEnv(OAUTH_ENV, async () => {
    const open = await mcpCall(ctx(await installation()), 'find', {});
    const link = open.reply!.sign_in as string;
    assert.match(link, /\/link\//);
    assert.match(open.reply!.show_to_builder as string, /^Open now:\n/);
    const openLines = (open.reply!.show_to_builder as string).split('\n');
    assert.equal(openLines.at(-1), `Sign in once at ${link} so I remember you across agents.`);
    assert.deepEqual(openLines.slice(-3, -1), ["Tell me which project and I'll match it.", '']);
    for (const line of openLines.slice(1, -3)) assert.ok(line.endsWith('.'), line);
  });
});

// shownReadyOf: the split and cap of the ready list, pure (v6.1.5).
type V = { id: string; in_person: boolean };
const isIn = (v: V) => v.in_person;
const remote = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, in_person: false }));
const inPerson = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, in_person: true }));

test('shownReadyOf: zero remote and three in person gives the first two in person only', () => {
  assert.deepEqual(shownReadyOf(inPerson(3), false, isIn).map((v) => v.id), ['p0', 'p1']);
});

test('shownReadyOf: six remote and zero in person gives the first five remote', () => {
  assert.deepEqual(shownReadyOf(remote(6), false, isIn).map((v) => v.id), ['r0', 'r1', 'r2', 'r3', 'r4']);
});

test('shownReadyOf: all returns everything unchanged', () => {
  const input = [...inPerson(3), ...remote(6)];
  assert.deepEqual(shownReadyOf(input, true, isIn), input);
});

test('shownReadyOf: remote first, then in person, even when the input interleaves them', () => {
  const [r, p] = [remote(3), inPerson(3)];
  const input = [p[0], r[0], p[1], r[1], p[2], r[2]];
  assert.deepEqual(shownReadyOf(input, false, isIn).map((v) => v.id), ['r0', 'r1', 'r2', 'p0', 'p1']);
});

// v6.1.6: the audit's project A (a Base agent with a public repo, a live URL and Base mainnet). Its repo was not
// recorded; the read replays the earnkit fixture repo under the project's own name, description and live URL.
const PROJECT_A = {
  name: 'Arkanoid Breakout Orchestrator',
  description: 'ERC-8004 compliant AI agent on Base that orchestrates Arkanoid Breakout game sessions',
  repo_url: `https://github.com/${rec.repo}`,
  live_url: 'https://arkanoid-breakout-five.vercel.app',
  chains: [{ chain: 'base', mainnet: true }],
};
type G = { program_id: string; n: number; gap: { kind: string; item: string; what: string }; also: { kind: string; item: string; what: string }[]; rules: string[] };
const lineOf = (show: string, n: number) => show.split('\n').find((l) => l.startsWith(`${n}. `)) ?? '';
const BASE_RULE = 'a pre-seed or seed stage startup that chooses Base as its home';
/** The block of the reply that starts with `head`, up to the next blank line. */
const blockOf = (show: string, head: string) => show.split('\n\n').find((b) => b.startsWith(head)) ?? '';

test('project A (R18a): Base Ecosystem Fund is one answer away; gap_done with its rule item makes it ready, no rule sentence (v6.1.6)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: PROJECT_A, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'base-ecosystem-fund');
  assert.ok(g, show);
  assert.deepEqual([g.gap.kind, g.gap.what, g.also], ['rule', BASE_RULE, []]);
  assert.match(g.gap.item, /^rule:[0-9a-f]{8}$/);
  const line = lineOf(blockOf(show, 'One change away'), g.n);
  assert.equal(line, `${g.n}. Base Ecosystem Fund, pre-seed and seed investment. Their rule: ${BASE_RULE}. Say "yes ${g.n}" if that is you.`);
  assert.ok((r.reply!.agent_note as string).includes('A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again.'));
  const t = await mcpCall(ctx(id), 'track', { program_id: 'base-ecosystem-fund', status: 'gap_done', item: g.gap.item });
  assert.equal(t.isError, false, t.text);
  const again = await mcpCall(ctx(id), 'find', { project: PROJECT_A, filter: { all: true } });
  const show2 = again.reply!.show_to_builder as string;
  const p = (again.reply!.ready as { program_id: string; n: number }[]).find((x) => x.program_id === 'base-ecosystem-fund');
  assert.ok(p, show2);
  const readyLine = lineOf(blockOf(show2, 'Ready to apply'), p.n);
  assert.match(readyLine, /Base Ecosystem Fund/);
  assert.doesNotMatch(readyLine, /Their rule/);
});

test('project A with filter.all: a demo-video gap and a rule share one gap line; every rule gap is in its line (v6.1.6)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_A, filter: { all: true } });
  const show = r.reply!.show_to_builder as string;
  const gaps = r.reply!.gaps as G[];
  const mixed = gaps.find((x) => x.gap.kind === 'demo_video' && x.also.some((a) => a.kind === 'rule'));
  assert.ok(mixed, show);
  const rule = mixed.also.find((a) => a.kind === 'rule')!.what;
  assert.match(lineOf(show, mixed.n), new RegExp(`^${mixed.n}\\. [^\\n]*: a demo video\\. Their rule: `));
  assert.ok(lineOf(show, mixed.n).endsWith(`Their rule: ${rule}.`), lineOf(show, mixed.n));
  for (const x of gaps) for (const a of [x.gap, ...x.also].filter((a) => a.kind === 'rule')) assert.ok(lineOf(show, x.n).includes(` Their rule: ${a.what}.`), lineOf(show, x.n));
});

test('find with program_id: each rule on its own line after the money, before Apply at (v6.1.6)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'base-ecosystem-fund' });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(r.reply!.rules, ['a pre-seed or seed stage startup that chooses Base as its home']);
  const lines = (r.reply!.show_to_builder as string).split('\n');
  assert.match(lines[0], /^Base Ecosystem Fund, /);
  assert.equal(lines[1], 'Their rule: a pre-seed or seed stage startup that chooses Base as its home.');
  assert.match(lines[2], /^Apply at /);
});

test('R18c: a rule-only program above the project tier shows the tier gap first, never "yes n" (v6.1.6)', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-rule-used', title: 'Rule Grant', min_tier: 'used', eligibility: [{ kind: 'rule', note: 'a team of two or more' }] }), 'file', NOW);
  try {
    const { live_url: _, ...noLink } = PROJECT;
    const r = await mcpCall(ctx(await installation()), 'find', { project: noLink, filter: { all: true } });
    assert.equal(r.isError, false, r.text);
    const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'f-rule-used');
    assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
    assert.deepEqual([g.gap.kind, g.also.map((a) => a.kind)], ['tier', ['rule']]);
    const line = lineOf(r.reply!.show_to_builder as string, g.n);
    assert.equal(line, `${g.n}. Rule Grant, Up to $5,000: Link GitHub so EarnKit can confirm your product has users. Their rule: a team of two or more.`);
    assert.doesNotMatch(line, /Say "yes/);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-rule-used'`;
  }
});
