import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { closedAt, dateStatus, foldId, getProgram, isOpenAt, isOpenAt as isOpen, listListedPrograms, listOpenPrograms, programByName, unknownProgramLine, upsertProgram } from './programs';
import { programFixture } from './fixtures/program';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test('upsert: created, then unchanged, then updated with one program_changes row', async () => {
  const p = programFixture({ id: 't-upsert', ends_at: '2026-12-01T00:00:00Z' });
  assert.equal(await upsertProgram(p, 'file', NOW), 'created');
  assert.equal(await upsertProgram(p, 'file', NOW), 'unchanged');
  assert.equal(await upsertProgram({ ...p, ends_at: '2026-12-15T00:00:00Z' }, 'file', NOW), 'updated');
  const changes = await sql()`SELECT fields FROM program_changes WHERE program_id = 't-upsert'`;
  assert.deepEqual(changes.map((c) => c.fields), [['ends_at']]);
  const row = await getProgram('t-upsert');
  assert.equal(row?.file.ends_at, '2026-12-15T00:00:00Z');
  assert.equal(row?.source, 'file');
  assert.equal((await sql()`SELECT ends_at FROM programs WHERE id = 't-upsert'`)[0].ends_at.toISOString(), '2026-12-15T00:00:00.000Z');
});

test('upsert: a change outside the named fields is updated with no program_changes row', async () => {
  const p = programFixture({ id: 't-desc' });
  await upsertProgram(p, 'file', NOW);
  assert.equal(await upsertProgram({ ...p, description: 'New words.' }, 'file', NOW), 'updated');
  assert.equal((await sql()`SELECT count(*)::int AS n FROM program_changes WHERE program_id = 't-desc'`)[0].n, 0);
});

test('FR-1 (v6.1.15): a need, todo, guidance or description edit inside the form records no change; a real field change does', async () => {
  const p = programFixture({ id: 't-need' });
  await upsertProgram(p, 'file', NOW);
  const req = p.submission_requirements[0];
  const reworded = { ...req, need: 'project name', todo: 'the project name', description: 'As on the site.', guidance: { judges: 'clarity', source_url: 'https://example.com/judging' } };
  assert.equal(await upsertProgram({ ...p, submission_requirements: [reworded, ...p.submission_requirements.slice(1)] }, 'file', NOW), 'updated');
  const count = async () => (await sql()`SELECT count(*)::int AS n FROM program_changes WHERE program_id = 't-need'`)[0].n;
  assert.equal(await count(), 0);
  // A new label, a required flag or a new field is a form change.
  assert.equal(await upsertProgram({ ...p, submission_requirements: [{ ...reworded, label: 'Your project' }, ...p.submission_requirements.slice(1)] }, 'file', NOW), 'updated');
  assert.equal(await count(), 1);
  assert.deepEqual((await sql()`SELECT fields FROM program_changes WHERE program_id = 't-need'`).map((c) => c.fields), [['submission_requirements']]);
});

test('getProgram: null for an unknown id', async () => {
  assert.equal(await getProgram('t-nope'), null);
});

test('listOpenPrograms: closed, past deadline, stale over 14 days and old api rows are out', async () => {
  await upsertProgram(programFixture({ id: 't-open' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-closed', status: 'closed' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-past', ends_at: daysAgo(1).toISOString() }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-stale' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-stale-new' }), 'file', NOW);
  await sql()`UPDATE programs SET stale_since = ${daysAgo(15)} WHERE id = 't-stale'`;
  await sql()`UPDATE programs SET stale_since = ${daysAgo(3)} WHERE id = 't-stale-new'`;
  await upsertProgram(programFixture({ id: 't-file-old', verified_at: dateOf(daysAgo(30)) }), 'file', NOW);
  await upsertProgram(programFixture({ id: 't-api-old', verified_at: dateOf(daysAgo(30)) }), 'api', NOW);
  await upsertProgram(programFixture({ id: 't-api-new', verified_at: dateOf(daysAgo(2)) }), 'api', NOW);
  await upsertProgram(
    programFixture({ id: 't-upcoming', status: 'upcoming', opens_note: 'Opens in December', submission_requirements: [] }),
    'file',
    NOW,
  );

  const open = ids(await listOpenPrograms(NOW));
  for (const id of ['t-open', 't-stale-new', 't-file-old', 't-api-new']) assert.ok(open.includes(id), id);
  for (const id of ['t-closed', 't-past', 't-stale', 't-api-old', 't-upcoming']) assert.ok(!open.includes(id), id);

  const listed = ids(await listListedPrograms(NOW));
  assert.ok(listed.includes('t-upcoming'));
  assert.ok(listed.includes('t-open'));
  assert.ok(!listed.includes('t-closed'));
});

test('readers skip a row whose file does not parse', async () => {
  await upsertProgram(programFixture({ id: 't-broken' }), 'file', NOW);
  await sql()`UPDATE programs SET file = file - 'title' WHERE id = 't-broken'`;
  assert.equal(await getProgram('t-broken'), null);
  assert.ok(!ids(await listOpenPrograms(NOW)).includes('t-broken'));
});

test('the synced program files are in the table', async () => {
  const row = await getProgram('base-builder-grants');
  assert.equal(row?.source, 'file');
  assert.equal(row?.file.form?.platform, 'google');
});

test('L23-2 (v6.1.16): isOpenAt is the one open test: active and not past ends_at, whatever status the run last wrote; it agrees with dateStatus', () => {
  const p = programFixture({ id: 't-isopen', ends_at: '2026-11-05T00:00:00Z' });
  assert.equal(isOpenAt(p, NOW), true);
  assert.equal(isOpenAt(p, new Date('2026-11-06T00:00:00Z')), false);
  assert.equal(isOpenAt({ ...p, status: 'closed' }, NOW), false);
  // Fix round 1 (M1): an upcoming program is open from its start, as dateStatus opens it; not before.
  assert.equal(isOpenAt({ ...p, status: 'upcoming', starts_at: '2026-11-01T00:00:00Z' }, NOW), true);
  assert.equal(isOpenAt({ ...p, status: 'upcoming', starts_at: '2026-11-04T12:01:00Z' }, NOW), false);
  assert.equal(isOpenAt({ ...p, status: 'upcoming', starts_at: null }, NOW), false);
  assert.equal(isOpenAt({ ...p, ends_at: null }, NOW), true);
  // An active program one minute past its close, before any run: closed, as the run would write it.
  const past = { ...p, ends_at: new Date(NOW.getTime() - 60_000).toISOString() };
  assert.equal(isOpenAt(past, NOW), false);
  assert.equal(closedAt(past, NOW), true);
  assert.equal(dateStatus(past, NOW), 'closed');
  for (const at of ['2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z'])
    assert.equal(isOpenAt(p, new Date(at)), dateStatus(p, new Date(at)) === null, at);
});

test('lane 20 audit (v6.1.16): paypal-ai-hackathon closes at 2026-11-12 12:00 PT, on time', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const p = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/paypal-ai-hackathon.json'), 'utf8'));
  assert.equal(Date.parse(p.ends_at), Date.parse('2026-11-12T20:00:00Z'));
  assert.equal(isOpen(p, new Date('2026-11-12T19:59:59Z')), true);
  assert.equal(isOpen(p, new Date('2026-11-12T20:00:01Z')), false);
});

test('Review Focus 3 (v6.1.12, F4): a program by its id, title or organizer, any case, spaces and punctuation ignored', async () => {
  const one = async (name: string) => {
    const r = await programByName(name, NOW);
    return { id: r.row?.id ?? null, line: r.row ? null : unknownProgramLine(r.suggest) };
  };
  // Exactly one match resolves.
  for (const [name, id] of [
    ['yc', 'y-combinator'], ['YC', 'y-combinator'], ['ycombinator', 'y-combinator'], ['Y Combinator', 'y-combinator'], ['y-combinator', 'y-combinator'],
    ['Y.Combinator', 'y-combinator'], ['Thiel Foundation', 'thiel-fellowship'], ['Circle Developer', 'circle-developer-grants'],
    ['a16z', 'a16z-speedrun'], ['Solana Foundation', 'solana-foundation-grants'], ['monad blitz oregon', 'monad-blitz-oregon'],
    // Final fix (v6.1.12, I2): a unique start of four characters or more; an organizer's whole name, brackets or not.
    ['kiro', 'kiroween-2026'], ['Kiro (AWS)', 'kiroween-2026'], ['atlassian', 'codegeist-2026'], ['Ethereum Security', 'ethereum-security-subsidy-program'],
  ] as const) assert.deepEqual(await one(name), { id, line: null }, name);
  // L1e-1 (v6.1.13): an organizer's first word that leads to exactly one program resolves, whatever field matched.
  for (const [name, id] of [['floss', 'floss-fund-zerodha'], ['thiel', 'thiel-fellowship'], ['ethereum', 'ethereum-security-subsidy-program']] as const)
    assert.deepEqual(await one(name), { id, line: null }, name);
  // L12-3 (v6.1.14): every word in the organizer of one program resolves it (it was only offered in v6.1.13).
  assert.deepEqual(await one('Ethereum Foundation'), { id: 'ethereum-security-subsidy-program', line: null });
  // Two or more real matches still ask, the question alone.
  assert.deepEqual(await one('circle'), { id: null, line: 'Which program do you mean: Circle Developer Grants, Arc Builders Fund or Arc Microgrants: Built with Arc Studio?' });
  // Under four characters or part of an organizer's name: none (a bracketed organizer word of four or more names its
  // program, L12-5, v6.1.14: below).
  for (const name of ['aws', 'fi', 'kir']) assert.deepEqual(await one(name), { id: null, line: 'Which program do you mean? Say its name.' }, name);
  // L1i-8 (v6.1.16.1): one candidate, two, three; none asks for the name.
  assert.equal(unknownProgramLine(['A']), 'Which program do you mean: A?');
  assert.equal(unknownProgramLine(['A', 'B']), 'Which program do you mean: A or B?');
  assert.equal(unknownProgramLine(['A', 'B', 'C', 'D']), 'Which program do you mean: A, B or C?');
  assert.equal(unknownProgramLine([]), 'Which program do you mean? Say its name.');
  // Several: the first three by rank (open first, then the larger award, the sooner close), as a question.
  assert.deepEqual(await one('Base'), { id: null, line: "Which program do you mean: Base Builder Grant Program, Base Ecosystem Fund or Base Batches 005?" });
  // Lane 20 (v6.1.16): Monad Blitz Oregon is closed, so the open ones lead.
  assert.deepEqual(await one('monad'), { id: null, line: "Which program do you mean: Monad Blitz @广州 (Guangzhou), Monad Nitro or Monad Metropolis Hackathon?" });
  assert.deepEqual(await one('Monad Blitz'), { id: null, line: "Which program do you mean: Monad Blitz @广州 (Guangzhou) or Monad Blitz Oregon?" });
  assert.deepEqual(await one('uniswap'), { id: null, line: "Which program do you mean: Uniswap Foundation Open Grants or Uniswap Foundation Security Fund (UFSF) Audit Subsidies?" });
  // None.
  for (const name of ['qqq-unknown', '', '  ', '?!']) assert.deepEqual(await one(name), { id: null, line: 'Which program do you mean? Say its name.' }, name);
});

test('L12-3, L12-5 (v6.1.14): every word of a lookup names one program, organizer words in brackets included; a word naming none is no program', async () => {
  const one = async (name: string) => {
    const r = await programByName(name, NOW);
    return { id: r.row?.id ?? null, line: r.row ? null : unknownProgramLine(r.suggest) };
  };
  // Every word (stopwords and years aside) in one program's id, title or organizer resolves it.
  for (const [name, id] of [
    ['paypal hackathon', 'paypal-ai-hackathon'], ['PayPal Hackathon 2026', 'paypal-ai-hackathon'], ['thiel fellowship 2027', 'thiel-fellowship'],
    ['the thiel fellowship program', 'thiel-fellowship'], ['zerodha', 'floss-fund-zerodha'], ['Zerodha fund', 'floss-fund-zerodha'],
    ['Ethereum Foundation', 'ethereum-security-subsidy-program'],
  ] as const) assert.deepEqual(await one(name), { id, line: null }, name);
  // Several programs every word names: the first two by rank, as a question.
  assert.match((await one('solana grants')).line ?? '', /^Which program do you mean: Solana [^?]+ or Solana [^?]+\?$/);
  // A word that names no program: no program, never a guess from the other words.
  // Fix round 1 (T7-F3): beside another typed word a short word names an id or title word, or the id's initials.
  assert.deepEqual(await one('yc batch'), { id: 'y-combinator', line: null });
  // Two Arc programs: asked, by rank.
  for (const name of ['arc grants', 'arc fund'])
    assert.deepEqual(await one(name), { id: null, line: 'Which program do you mean: Arc Builders Fund, Arc Microgrants or Arc Microgrants: Built with Arc Studio?' }, name);
  // A short word never names a bracketed organizer, even beside another word.
  assert.deepEqual(await one('aws grants'), { id: null, line: 'Which program do you mean? Say its name.' });
  // T7-F4: only stopwords, or only "foundation", is no program.
  for (const name of ['foundation', 'grants', 'the fund', 'grant program 2027', 'Foundation Grants'])
    assert.deepEqual(await one(name), { id: null, line: 'Which program do you mean? Say its name.' }, name);
  for (const name of ['l12-nope', 'base-nope', 'monad-xyz', 'Combinator Labs', 'paypal qqq', '2027'])
    assert.deepEqual(await one(name), { id: null, line: 'Which program do you mean? Say its name.' }, name);
});

test('L31-4 (v6.1.16 Task 17): program ids are matched after NFKC folding; the row names the real id', async () => {
  assert.equal(foldId(' ｂａｓｅ-ｂｕｉｌｄｅｒ-ｇｒａｎｔｓ '), 'base-builder-grants');
  assert.equal(foldId('Base-Builder-Grants'), 'base-builder-grants');
  assert.equal((await getProgram('ｂａｓｅ-ｂｕｉｌｄｅｒ-ｇｒａｎｔｓ'))?.id, 'base-builder-grants');
  const { row } = await programByName('ｂａｓｅ-ｂｕｉｌｄｅｒ-ｇｒａｎｔｓ', NOW);
  assert.equal(row?.id, 'base-builder-grants');
  // NFD accents are not compatibility forms: no match (lane 31's t-7 stays).
  assert.equal(await getProgram('cafe\u0301-grant'), null);
});

test('L24-3 (v6.1.16 Task 11): the strict lookup takes an id, an exact title or title words with one uncommon word', async () => {
  const { COMMON_WORDS, programByName, upsertProgram: up } = await import('./programs');
  const { programFixture: fx } = await import('./fixtures/program');
  const now = new Date('2026-11-04T12:00:00Z');
  await up(fx({ id: 'l24p-second', title: 'Second Grant' }), 'file', now);
  assert.equal(COMMON_WORDS.size, 14 + 26 + 23);
  for (const w of ['next', 'build', 'start', 'first', 'open', 'apply'])
    assert.equal((await programByName(w, now, { strict: true })).row, null, w);
  assert.equal((await programByName('Second Grant', now, { strict: true })).row?.id, 'l24p-second');
  assert.equal((await programByName('paypal', now, { strict: true })).row?.id, 'paypal-ai-hackathon');
  // v6.1.16 Task 15 (controller's ruling): initials count as a title word in the strict lookup; common words still do not.
  // Fix round 1b: initials in any case; an English word (COMMON_WORDS) never.
  assert.equal((await programByName('YC', now, { strict: true })).row?.id, 'y-combinator');
  assert.equal((await programByName('yc', now, { strict: true })).row?.id, 'y-combinator');
  for (const w of ['as', 'am', 'mm', 'AS']) assert.equal((await programByName(w, now, { strict: true })).row, null, w);
  assert.equal((await programByName('ai', now, { strict: true })).row, null);
  // find's lookup is unchanged.
  assert.equal((await programByName('yc', now)).row?.id, 'y-combinator');
});
