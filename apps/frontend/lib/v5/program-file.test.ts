import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { programProblems } from './program-checks';
import { ProgramFile, eligibilityOf } from './program-file';
import { programFixture } from './fixtures/program';

const DIR = join(import.meta.dirname, '..', '..', '..', '..', 'programs');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, unknown>;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

test('every programs/*.json parses', () => {
  assert.ok(files.length > 0);
  for (const f of files) {
    const r = ProgramFile.safeParse(read(f));
    assert.ok(r.success, `${f}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
  }
});

test('an unknown chain fails; any_chain lists none', () => {
  const base = programFixture({ id: 'chain-test' });
  assert.equal(ProgramFile.safeParse({ ...base, chains: ['foo'] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, chains: ['solana'] }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, chains: [], any_chain: true }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, chains: [] }).success, false);
});

test('status unlisted fails', () => {
  const base = programFixture({ id: 'status-test' });
  assert.equal(ProgramFile.safeParse({ ...base, status: 'unlisted' }).success, false);
});

test('eligibilityOf base-builder-grants: its explicit four items', () => {
  const p = ProgramFile.parse(read('base-builder-grants.json'));
  assert.deepEqual(eligibilityOf(p), [{ kind: 'live_product' }, { kind: 'chain', value: 'base' }, { kind: 'builder_codes' }, { kind: 'users' }]);
});

test('eligibilityOf circle-developer-grants: derived, live product then chain arc', () => {
  const p = ProgramFile.parse(read('circle-developer-grants.json'));
  assert.equal(p.eligibility, undefined);
  assert.deepEqual(eligibilityOf(p), [{ kind: 'live_product' }, { kind: 'chain', value: 'arc' }]);
});

test('eligibilityOf: an explicit list wins; derived items for contract, new work and in person', () => {
  const explicit = programFixture({ id: 'e1', eligibility: [{ kind: 'users', note: '100 users' }] });
  assert.deepEqual(eligibilityOf(explicit), [{ kind: 'users', note: '100 users' }]);
  const derived = programFixture({
    id: 'e2',
    chains: ['arc'],
    needs_contract: 'arc',
    existing_work: 'new_work_only',
    starts_at: '2026-10-01T00:00:00Z',
    in_person: true,
  });
  assert.deepEqual(eligibilityOf(derived), [
    { kind: 'contract_on', value: 'arc' },
    { kind: 'new_work_after', value: '2026-10-01T00:00:00Z' },
    { kind: 'in_person' },
  ]);
});

test('a form.fields map round-trips', () => {
  const form = { platform: 'google' as const, url: 'https://docs.google.com/forms/d/e/x/viewform', fields: { project_name: 'entry.123' } };
  const p = programFixture({ id: 'form-test', form });
  assert.deepEqual(ProgramFile.parse(JSON.parse(JSON.stringify(p))).form, form);
  const bz = ProgramFile.parse(read('base-builder-grants.json'));
  assert.equal(bz.form?.platform, 'google');
  assert.equal(bz.form?.fields?.email, 'entry.567744978');
});

test('a required item without a todo, or any item without a kind, fails', () => {
  const base = programFixture({ id: 'req-test' });
  const [r] = base.submission_requirements;
  assert.equal(ProgramFile.safeParse({ ...base, submission_requirements: [{ ...r, todo: undefined }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, submission_requirements: [{ ...r, kind: undefined }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, submission_requirements: [{ ...r, required: false, todo: undefined }] }).success, true);
});

test('unknown keys are stripped', () => {
  const p = ProgramFile.parse({ ...programFixture({ id: 'strip-test' }), x_handles: ['base'], campaign: {} });
  assert.equal('x_handles' in p, false);
  assert.equal('campaign' in p, false);
});

test('the catalog fields default, and the four edited programs carry theirs', () => {
  const p = ProgramFile.parse(programFixture({ id: 'cat-default' }));
  assert.equal(p.submit, 'either');
  assert.equal(p.sign_in, 'none');
  assert.deepEqual(p.needs, []);
  assert.deepEqual(p.prefers, []);
  assert.equal(p.min_tier, undefined);
  const base = ProgramFile.parse(read('base-builder-grants.json'));
  assert.deepEqual([base.submit, base.sign_in, base.needs, base.prefers], ['either', 'google', ['demo_video'], ['builder_codes', 'smart_wallet', 'onchainkit']]);
  const avax = ProgramFile.parse(read('avalanche-team1-mini-grants.json'));
  assert.deepEqual([avax.sign_in, avax.platform_name], ['platform', 'Avalanche Builder Hub']);
  assert.deepEqual(ProgramFile.parse(read('z-fellows.json')).needs, ['founder_video']);
  assert.deepEqual(ProgramFile.parse(read('arc-builders-fund.json')).needs, ['deck']);
  for (const f of ['base-builder-grants', 'avalanche-team1-mini-grants', 'z-fellows', 'arc-builders-fund'])
    assert.deepEqual(programProblems(read(`${f}.json`) as never, new Date('2026-11-10T00:00:00Z')), [], f);
});

test('catalog fields that do not fit are refused', () => {
  const base = programFixture({ id: 'cat-bad' });
  assert.equal(ProgramFile.safeParse({ ...base, sign_in: 'platform' }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, sign_in: 'platform', platform_name: 'Hub' }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, sign_in: 'google', platform_name: 'Hub' }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, min_tier: 'flagged' }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, min_tier: 'live' }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, prefers: ['unknown_sdk'] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, prefers: ['smart_wallet', 'base'] }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'integration', value: 'nope' }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'integration' }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'integration', value: 'smart_wallet' }] }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, needs: ['passport'] }).success, false);
});

test('eligibilityOf passes an explicit integration item through', () => {
  const p = programFixture({ id: 'cat-elig', eligibility: [{ kind: 'integration', value: 'smart_wallet' }] });
  assert.deepEqual(eligibilityOf(p), [{ kind: 'integration', value: 'smart_wallet' }]);
});

test('a rule item needs a note and takes no value (v6.1.6)', () => {
  const base = programFixture({ id: 'rule-test' });
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'rule', note: 'a clear open source license on the repo' }] }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'rule' }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'rule', note: 'x', value: 'y' }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'rule', note: 'ends with a stop.' }] }).success, false);
});

test('L1c-2 (v6.1.10): a rule item may carry up to 8 lower-case keywords of at most 30 characters; no other item takes them', () => {
  const base = programFixture({ id: 'kw-test' });
  const rule = (keywords: unknown) => ({ ...base, eligibility: [{ kind: 'rule', note: 'a hands-first experience for Meta VR devices', keywords }] });
  const ok = ProgramFile.safeParse(rule(['vr', 'quest', 'mini app']));
  assert.ok(ok.success);
  assert.deepEqual(eligibilityOf(ok.data!)[0], { kind: 'rule', note: 'a hands-first experience for Meta VR devices', keywords: ['vr', 'quest', 'mini app'] });
  assert.equal(ProgramFile.safeParse(rule(['VR'])).success, false);
  assert.equal(ProgramFile.safeParse(rule([' vr'])).success, false);
  assert.equal(ProgramFile.safeParse(rule([''])).success, false);
  assert.equal(ProgramFile.safeParse(rule(['x'.repeat(31)])).success, false);
  assert.equal(ProgramFile.safeParse(rule(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).success, false);
  assert.equal(ProgramFile.safeParse(rule([])).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, eligibility: [{ kind: 'demo_video', keywords: ['vr'] }] }).success, false);
});

test('L1c-2 (v6.1.10): the catalog keywords are on the domain rules, none on licence rules; L1e-2 (v6.1.13): Thiel names who its person rule is for', () => {
  const kw = (f: string) => eligibilityOf(ProgramFile.parse(read(`${f}.json`))).flatMap((i) => i.keywords ?? []);
  assert.deepEqual(kw('meta-vr-start-competition-2026'), ['vr', 'quest', 'hands-first', 'oculus']);
  assert.deepEqual(kw('codegeist-2026'), ['atlassian', 'atlassian forge', 'jira', 'confluence']);
  assert.deepEqual(kw('qnx-global-hackathon-2026'), ['qnx']);
  assert.deepEqual(kw('paypal-ai-hackathon'), ['paypal']);
  assert.deepEqual(kw('farcaster-developer-rewards'), ['farcaster', 'mini app', 'warpcast']);
  assert.deepEqual(kw('kiroween-2026'), ['kiro']);
  assert.deepEqual(kw('solana-mobile-builder-grants'), ['solana mobile', 'seeker', 'saga', 'android']);
  assert.deepEqual(kw('ugreen-ai-nas-hackathon-2026'), ['ugreen', 'nas']);
  assert.deepEqual(kw('otf-internet-freedom-fund'), ['censorship', 'circumvention', 'privacy', 'vpn', 'tor']);
  assert.deepEqual(kw('goose-grant-program'), ['goose']);
  assert.deepEqual(kw('filecoin-open-grants'), ['filecoin', 'fvm', 'ipfs']);
  assert.deepEqual(kw('lido-lego-grants'), ['lido', 'steth']);
  // Fix round 1: phrases, never a bare "hook" or "v4" (a React hook is not Uniswap).
  assert.deepEqual(kw('uniswap-foundation-open-grants'), ['uniswap', 'v4 hook', 'uniswap hook']);
  assert.deepEqual(kw('uniswap-foundation-security-fund'), ['uniswap', 'v4 hook', 'uniswap hook']);
  // Final round: never a bare "meta" (Meta's models) or "forge" (every Foundry README) either.
  for (const f of files) assert.ok(!eligibilityOf(ProgramFile.parse(read(f))).some((i) => (i.keywords ?? []).some((k) => ['hook', 'v4', 'meta', 'forge'].includes(k))), f);
  // L1e-2 (v6.1.13, fix round 1 T3-R2): who the age rule is for, never a bare number or "fellowship"; Avalanche's ecosystem rule names its chain.
  assert.deepEqual(kw('thiel-fellowship'), ['student', 'students', 'college', 'university', 'dropout', 'drop out', 'undergrad']);
  assert.deepEqual(kw('avalanche-team1-mini-grants'), ['avalanche', 'avax', 'team1', 'subnet']);
  for (const f of ['antler-us-residency', 'github-secure-open-source-fund', 'herodevs-sustainability-fund', 'sovereign-tech-fund'])
    assert.deepEqual(kw(f), [], f);
});
