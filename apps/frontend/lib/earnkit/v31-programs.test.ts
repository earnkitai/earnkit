import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { sql } from './db';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { ProgramFile } from './program-file';
import { listPrograms, openProgramFacts, upsertProgram } from './programs';
import { gatedGuidePage, landingFrom, readGuideIds, readGuidePage } from './landing';
import { openCuratedRows } from './alerts';
import { readStats, type PublicStats } from './stats';
import { prepareSubmission } from './submission';
import { googlePrefill } from './submit-kit';
import { tools } from './tools';

/** v3.1 Task 8 (D2, R15): `unlisted` programs, Avalanche and ETHGlobal Mumbai out, Base's primary challenge as a multi-select. */

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const AVA = 'avalanche-team1-mini-grants';
const MUMBAI = 'ethglobal-mumbai';
const CHALLENGE = [
  'User acquisition',
  'Go-to-market strategy',
  'Smart contract security/auditing',
  'Liquidity bootstrapping',
  'UI/UX improvements',
  'Regulatory compliance guidance',
];

test('(a) an unlisted program: not in listPrograms, the landing, /api/stats open money, find or score; its guide is a 404', db, async () => {
  // A fresh unlisted program (a clone of an open one), alongside the two committed files the sync made unlisted.
  const id = `v31-unlisted-${process.pid}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('arc-microgrants'), id, status: 'unlisted' }));
  const rows = await sql()<{ id: string; status: string }[]>`SELECT id, status FROM programs WHERE id IN (${id}, ${AVA}, ${MUMBAI}) ORDER BY id`;
  assert.deepEqual(rows.map((r) => r.status), ['unlisted', 'unlisted', 'unlisted'], 'the rows stay for old entries');
  const gone = [id, AVA, MUMBAI];
  const cards = await listPrograms();
  for (const g of gone) assert.ok(!cards.some((c) => c.id === g), `${g} not listed`);
  const stats = { open_money_usd: 0, open_money_text: null } as unknown as PublicStats;
  assert.ok(!landingFrom(cards, stats, new Date()).tiles.some((t) => gone.includes(t.id)), 'not on the landing');
  const facts = await openProgramFacts();
  assert.ok(!facts.some((p) => gone.includes(p.id)), 'never a fit (find, score)');
  assert.ok(!(await openCuratedRows()).some((p) => gone.includes(p.id)), 'never a new program alert');
  const ids = await readGuideIds();
  for (const g of gone) {
    assert.ok(!ids.includes(g), `${g} has no guide id`);
    assert.equal(await gatedGuidePage(g, readGuideIds, readGuidePage), null, `${g}: the guide is a 404`);
  }
  assert.ok(ids.includes('arc-microgrants'), 'an open program keeps its guide');
});

test('(b) prepare on an unlisted program refuses (NotFoundError); so does find with its id (never "closed")', db, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`v31-unlisted-b-${process.pid}-${Date.now()}`}) RETURNING id`;
  await assert.rejects(
    tools.prepare({ program_id: AVA, project: { name: 'Tip Jar' } }, { installationId: id }),
    (err: Error) => err.constructor.name === 'NotFoundError',
  );
  // get_program (find with program_id): an unlisted program is unknown, never a guide that says "closed".
  await assert.rejects(tools.find({ program_id: AVA }, { installationId: id }), (err: Error) => err.constructor.name === 'NotFoundError');
});

test('(c) multi_choice: validation, and a Google prefill with the param repeated per option', () => {
  const base = committedProgram('base-builder-grants');
  const req = base.submission_requirements.find((r: { key: string }) => r.key === 'primary_challenge');
  assert.equal(req.type, 'multi_choice');
  assert.deepEqual(req.options, CHALLENGE);
  assert.equal(base.form.fields.primary_challenge, 'entry.475374687');
  // The schema: a multi_choice needs options.
  const noOptions = { ...base, submission_requirements: base.submission_requirements.map((r: { key: string }) => (r.key === 'primary_challenge' ? { ...r, options: undefined } : r)) };
  assert.equal(ProgramFile.safeParse(noOptions).success, false);
  const p = ProgramFile.parse(base);
  const reqs = p.submission_requirements;
  // Validation: options joined by "; ", each one of the options.
  const ok = prepareSubmission(reqs, { answers: { primary_challenge: 'User acquisition; Go-to-market strategy' } });
  assert.ok(ok.complete.some((c) => c.key === 'primary_challenge'));
  const one = prepareSubmission(reqs, { answers: { primary_challenge: 'Liquidity bootstrapping' } });
  assert.ok(one.complete.some((c) => c.key === 'primary_challenge'));
  const bad = prepareSubmission(reqs, { answers: { primary_challenge: 'User acquisition; Hiring' } });
  const m = bad.missing.find((x) => x.key === 'primary_challenge');
  assert.equal(m?.problem, `Must be one of: ${CHALLENGE.join(', ')}.`);
  // The prefill: one entry.475374687 per option, in the answer's order.
  const { url, left } = googlePrefill(p.form!, reqs, { primary_challenge: 'User acquisition; Go-to-market strategy', full_name: 'Ada' });
  const q = new URL(url).searchParams;
  assert.deepEqual(q.getAll('entry.475374687'), ['User acquisition', 'Go-to-market strategy']);
  assert.match(url, /entry\.475374687=User%20acquisition&entry\.475374687=Go-to-market%20strategy/);
  assert.equal(q.get('entry.100652540'), 'Ada');
  assert.ok(!left.includes('primary_challenge'));
  // A part that is not an option is pasted, never put in the link.
  const off = googlePrefill(p.form!, reqs, { primary_challenge: 'User acquisition; Hiring' });
  assert.deepEqual(new URL(off.url).searchParams.getAll('entry.475374687'), []);
  assert.deepEqual(off.left, ['primary_challenge']);
});

test('(d) pnpm programs:check passes (spawn) and the two files are unlisted', () => {
  const root = join(import.meta.dirname, '..', '..', '..', '..');
  const out = execFileSync('npx', ['tsx', 'apps/frontend/scripts/programs-sync.mts', '--check'], { cwd: root, encoding: 'utf8' });
  for (const f of [`${AVA}.json`, `${MUMBAI}.json`, 'base-builder-grants.json'])
    assert.match(out, new RegExp(`Valid: ${f.replace('.', '\\.')}`));
  assert.equal(committedProgram(AVA).status, 'unlisted');
  assert.equal(committedProgram(MUMBAI).status, 'unlisted');
  const base = committedProgram('base-builder-grants');
  assert.equal(base.verified_at, '2026-10-21');
  assert.equal(base.form.read_at, '2026-10-21');
  // The schema: unlisted follows the active rules (requirements needed, no opens_note).
  assert.equal(ProgramFile.safeParse({ ...committedProgram(AVA), submission_requirements: [] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...committedProgram(AVA), opens_note: 'Opens in November.' }).success, false);
});

test('(e) the money total no longer counts Avalanche', db, async () => {
  const before = await readStats();
  // Back to active for one read: the total moves by Avalanche's $10,000, so it counted before and does not now.
  await sql()`UPDATE programs SET status = 'active' WHERE id = ${AVA}`;
  try {
    const was = await readStats();
    assert.equal(was.open_money_usd - before.open_money_usd, 10000);
    assert.ok(was.programs_open > before.programs_open);
  } finally {
    await sql()`UPDATE programs SET status = 'unlisted' WHERE id = ${AVA}`;
  }
  assert.ok(!(await listPrograms()).some((c) => c.id === AVA));
});
