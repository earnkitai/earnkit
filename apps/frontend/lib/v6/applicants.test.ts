import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CsvError, identicalPitches, parseApplicants, resolveRepo, sharedContributors, type Applicant } from './applicants';
import { liveRows } from './fixtures/evidence-builder';

const CSV = readFileSync(join(import.meta.dirname, 'fixtures', 'applicants.csv'), 'utf8');
const app = (o: Partial<Applicant>): Applicant => ({
  ref: 'a', name: 'A', repo_url: null, live_url: null, contracts: [], pitch: null, problems: [], ...o,
});

test('the fixture CSV of 8 rows parses: links normalized, a quoted name with a comma, contracts lowercased', () => {
  const apps = parseApplicants(CSV, { chain: 'base' });
  assert.equal(apps.length, 8);
  const by = new Map(apps.map((a) => [a.ref, a]));
  assert.equal(by.get('ek-1')?.repo_url, 'https://github.com/earnkitai/earnkit');
  assert.equal(by.get('ek-2')?.name, 'Onchain Reaction, the game');
  assert.deepEqual(by.get('ek-2')?.contracts, [{ chain: 'base', address: '0x426e2ca323fa707bd1921eccce0a27ad7804b2a2' }]);
  assert.equal(by.get('ek-5')?.repo_url, null);
  assert.equal(by.get('ek-5')?.live_url, 'https://abi.ninja/');
  assert.match(by.get('ek-1')?.pitch ?? '', /^EarnKit finds/);
});

test('bad rows do not stop the run', () => {
  const apps = parseApplicants(CSV, { chain: 'base' });
  const bad = new Map([
    ['ek-6', 'repo link not on GitHub'],
    ['ek-7', 'repo link is a GitHub account, not a repo'],
    ['ek-8', 'contract foo:0x426E2ca323fa707bD1921ECcCe0A27ad7804B2a skipped: unknown chain foo, address not 40 hex characters'],
  ]);
  for (const a of apps) {
    if (bad.has(a.ref)) {
      assert.deepEqual(a.problems, [bad.get(a.ref)], a.ref);
      assert.equal(a.repo_url, null);
      assert.deepEqual(a.contracts, []);
    } else assert.deepEqual(a.problems, [], a.ref);
  }
  assert.equal(apps.filter((a) => a.problems.length === 0).length, 5);
});

test('columns by any of their names, any case; bare addresses take the chain passed; no ref is the row number', () => {
  const csv = 'Project,GitHub,Website,Address,Summary\r\nOne,github.com/a/b.git,one.xyz,0x' + 'a'.repeat(40) + ' arbitrum:0x' + 'b'.repeat(40) + ',"line one\nline two"\r\n';
  const [a] = parseApplicants(csv, { chain: 'arc' });
  assert.equal(a.ref, 'row 1');
  assert.equal(a.name, 'One');
  assert.equal(a.repo_url, 'https://github.com/a/b');
  assert.equal(a.live_url, 'one.xyz');
  assert.deepEqual(a.contracts, [{ chain: 'arc', address: `0x${'a'.repeat(40)}` }, { chain: 'arbitrum', address: `0x${'b'.repeat(40)}` }]);
  assert.equal(a.pitch, 'line one\nline two');
});

test('a CSV that cannot be read at all throws CsvError', () => {
  assert.throws(() => parseApplicants(''), CsvError);
  assert.throws(() => parseApplicants('name,notes\nx,y\n'), CsvError);
  assert.throws(() => parseApplicants('name,repo\n"open,https://github.com/a/b\n'), CsvError);
  // A header alone is an empty list, not an error.
  assert.deepEqual(parseApplicants('name,repo\n'), []);
});

test('identicalPitches: four rows with one pitch in different case and punctuation read 3 each, a distinct one 0', () => {
  const counts = identicalPitches(parseApplicants(CSV, { chain: 'base' }));
  for (const ref of ['ek-3', 'ek-4', 'ek-7', 'ek-8']) assert.equal(counts.get(ref), 3, ref);
  for (const ref of ['ek-1', 'ek-2', 'ek-5', 'ek-6']) assert.equal(counts.get(ref), 0, ref);
});

test('identicalPitches: 90% of shingles is the same pitch, a short pitch inside a long one is not, no pitch is 0', () => {
  const long = [...Array(40)].map((_, i) => `word${i}`).join(' ');
  const counts = identicalPitches([
    app({ ref: 'a', pitch: long }),
    app({ ref: 'b', pitch: `${long} extra` }),
    app({ ref: 'c', pitch: 'word0 word1 word2 word3 word4 word5' }),
    app({ ref: 'd', pitch: null }),
  ]);
  assert.equal(counts.get('a'), 1);
  assert.equal(counts.get('b'), 1);
  assert.equal(counts.get('c'), 0);
  assert.equal(counts.get('d'), 0);
});

test('sharedContributors: others sharing one login, case ignored; no logins is 0', () => {
  const counts = sharedContributors(new Map([['a', ['Alice', 'bob']], ['b', ['alice']], ['c', ['bob']], ['d', []], ['e', ['zed']]]));
  assert.deepEqual([...counts], [['a', 2], ['b', 1], ['c', 1], ['d', 0], ['e', 0]]);
});

test("resolveRepo: the applicant's repo first, else the first repo the page links, never an account page", () => {
  const live = liveRows({ github_links: ['https://github.com/buidlguidl/abi.ninja', 'https://github.com/other/repo'] });
  assert.equal(resolveRepo(app({}), live), 'https://github.com/buidlguidl/abi.ninja');
  assert.equal(resolveRepo(app({ repo_url: 'https://github.com/a/b' }), live), 'https://github.com/a/b');
  assert.equal(resolveRepo(app({}), liveRows({ github_links: ['https://github.com/someone'] })), null);
  assert.equal(resolveRepo(app({}), liveRows()), null);
});
