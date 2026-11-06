import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CsvError, headerKey, identicalPitches, parseApplicants, resolveRepo, sharedContributors, type Applicant } from './applicants';
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

test('headers normalized: "GitHub URL", "Project Name", "Contract Address", "Live-URL" map', () => {
  assert.equal(headerKey(' GitHub URL '), 'github');
  assert.equal(headerKey('Project Name'), 'project_name');
  assert.equal(headerKey('Contract Address'), 'contract_address');
  assert.equal(headerKey('Live-URL'), 'live');
  assert.equal(headerKey('url'), 'url');
  const csv = `ID,Project Name,GitHub URL,Website URL,Contract Address\nk1,Kite,github.com/kite/app,kite.xyz,0x${'c'.repeat(40)}\n`;
  const [a] = parseApplicants(csv);
  assert.equal(a.ref, 'k1');
  assert.equal(a.name, 'Kite');
  assert.equal(a.repo_url, 'https://github.com/kite/app');
  assert.equal(a.live_url, 'kite.xyz');
  assert.deepEqual(a.contracts, [{ chain: 'base', address: `0x${'c'.repeat(40)}` }]);
});

test('duplicate refs are made unique at parse time and named', () => {
  const apps = parseApplicants('ref,repo\nek-3,github.com/a/one\nek-3,github.com/a/two\nek-3 (2),github.com/a/three\nek-3,github.com/a/four\n');
  assert.deepEqual(apps.map((a) => a.ref), ['ek-3', 'ek-3 (2)', 'ek-3 (2) (2)', 'ek-3 (3)']);
  assert.deepEqual(apps.map((a) => a.problems), [[], ['duplicate ref'], ['duplicate ref'], ['duplicate ref']]);
  // The counts across the list keep every applicant apart.
  assert.equal(identicalPitches(apps).size, 4);
});

test('identicalPitches: pitches under 10 words never match, even word for word', () => {
  const counts = identicalPitches([
    app({ ref: 'a', pitch: 'A DeFi app on Base.' }),
    app({ ref: 'b', pitch: 'a defi app on base' }),
    app({ ref: 'c', pitch: 'TBD' }),
    app({ ref: 'd', pitch: 'tbd' }),
  ]);
  assert.deepEqual([...counts.values()], [0, 0, 0, 0]);
});

test('resolveRepo: starter and SDK owners are skipped; a link sharing a word with the domain or name is preferred', () => {
  const tools = liveRows({ domain: 'kite.xyz', github_links: ['https://github.com/scaffold-eth/scaffold-eth-2', 'https://github.com/coinbase/onchainkit', 'https://github.com/wevm/viem'] });
  assert.equal(resolveRepo(app({ name: 'Kite' }), tools), null);
  const mixed = liveRows({
    domain: 'kite.xyz',
    github_links: ['https://github.com/base/web', 'https://github.com/someone/unrelated', 'https://github.com/kitelabs/contracts'],
  });
  assert.equal(resolveRepo(app({ name: 'Paper Plane' }), mixed), 'https://github.com/kitelabs/contracts');
  // No link shares a word: the first that is not a tool's.
  assert.equal(resolveRepo(app({ name: 'Paper Plane' }), liveRows({ domain: 'pp.io', github_links: mixed.github_links })), 'https://github.com/someone/unrelated');
  // The project name counts too, and a joined name holds the domain word.
  assert.equal(resolveRepo(app({ name: 'Onchain Reaction' }), liveRows({ domain: 'onchainreaction.vercel.app', github_links: ['https://github.com/a/b', 'https://github.com/shijas786/onchain-reaction'] })), 'https://github.com/shijas786/onchain-reaction');
});
