import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { prefill, unvouchedRequired } from './prefill';
import { repoFacts, type RepoFacts } from './repo-facts';
import { parseProject } from './project-input';
import { ProgramFile } from './program-file';
import type { ProgramRow } from './programs';
import { replayFetch } from './fixtures/github';
import { programFixture } from './fixtures/program';
import { STYLE_CONTRACT } from '../v6/answer-brief';
import { EMPTY_RECORD, approvePath, mergeRecord, type BuilderRecord } from '../v6/record';

after(() => sql().end());
beforeEach(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const toRow = (file: ProgramRow['file']): ProgramRow => ({
  id: file.id, file, source: 'file', created_at: NOW, updated_at: NOW, verified_at: null, stale_since: null,
});
const fromFile = (slug: string) =>
  toRow(ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', `${slug}.json`), 'utf8'))));

async function factsOf(slug: string, over: Record<string, unknown> = {}): Promise<RepoFacts> {
  const rec = replayFetch(slug);
  const r = parseProject({ name: 'App', description: 'An app.', repo_url: `https://github.com/${rec.repo}`, ...over });
  assert.ok(r.ok);
  return repoFacts(r.project, { gh: rec.fetch, now: NOW });
}

const req = (o: Record<string, unknown>) => ({ required: true, from: 'project', kind: 'other', todo: 'an answer', ...o });
const rowWith = (reqs: unknown[], over: Record<string, unknown> = {}) =>
  toRow(programFixture({ id: 'p', submission_requirements: reqs as never, ...over }));

const FILLED = 3; // live_product_url, project_name_description, demo_loom (no contract in the recorded facts)
test('base-builder-grants: facts fill; prose, team and contacts go to the agent; traction to the builder', async () => {
  const facts = await factsOf('earnkit', { live_url: 'https://earnkit.com', demo_url: 'https://loom.com/share/x' });
  const out = prefill(fromFile('base-builder-grants'), facts);
  const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
  assert.equal(by.live_product_url.from, 'earnkit');
  assert.ok(by.live_product_url.value);
  assert.equal(by.live_product_url.form_id, 'entry.1792418505');
  assert.equal(by.project_name_description.from, 'earnkit');
  assert.ok(by.project_name_description.value);
  assert.equal(by.demo_loom.value, 'https://loom.com/share/x');
  assert.equal(by.track.from, 'agent');
  assert.equal(by.track.value, null);
  assert.deepEqual(by.track.sources, ['the options', 'the description']);
  assert.equal(by.founding_team.from, 'agent');
  assert.equal(by.founding_team.value, null);
  assert.ok((by.founding_team.sources ?? []).length > 0);
  assert.equal(by.email.from, 'agent');
  assert.deepEqual(by.email.sources?.slice(0, 2), ['git config and the environment', 'what the builder told you']);
  assert.equal(by.usage_numbers.from, 'builder');
  assert.equal(by.usage_numbers.value, null);
  assert.equal(by.full_name.from, 'agent');
  assert.deepEqual(out.fields.filter((f) => f.from === 'builder').map((f) => f.key), ['contract_address', 'usage_numbers']);
  assert.equal(out.filled, FILLED);
  // The name, one-liner, live and demo links are what the agent passed, not the repo read: none counts.
  assert.equal(out.facts_from_repo, 0);
  assert.equal(out.total, out.fields.filter((f) => f.required).length);
  assert.equal(out.total, 16);
});

test('contract_address: a known Base contract fills; none is a builder field', async () => {
  const facts = await factsOf('earnkit');
  const addr = `0x${'1'.repeat(40)}`;
  const p = fromFile('base-builder-grants');
  const withC = prefill(p, { ...facts, contracts: [{ chain: 'base', address: addr }] }).fields.find((f) => f.key === 'contract_address');
  assert.equal(withC?.from, 'earnkit');
  assert.equal(withC?.value, addr);
  const none = prefill(p, { ...facts, contracts: [] }).fields.find((f) => f.key === 'contract_address');
  assert.equal(none?.from, 'builder');
  assert.equal(none?.value, null);
});

test('a choice fills when exactly one option names a chain in the facts', async () => {
  const facts = await factsOf('onchain-reaction');
  const p = rowWith([req({ key: 'network', label: 'Network', type: 'choice', options: ['Base', 'Solana'] })]);
  const f = prefill(p, facts).fields[0];
  assert.equal(f.value, 'Base');
  assert.equal(f.from, 'earnkit');
});

test('a choice stays open when two options match; a multi_choice joins matches', async () => {
  const facts = await factsOf('onchain-reaction', { description: 'A payments and lending app' });
  const one = prefill(rowWith([req({ key: 'track', label: 'Track', type: 'choice', options: ['Payments', 'Lending'] })]), facts).fields[0];
  assert.equal(one.value, null);
  assert.equal(one.from, 'agent');
  const many = prefill(rowWith([req({ key: 'tracks', label: 'Tracks', type: 'multi_choice', options: ['Payments', 'Lending', 'Gaming'] })]), facts).fields[0];
  assert.equal(many.value, 'Payments; Lending');
});

test('prose fields carry sources in order and the requirement guidance', async () => {
  const facts = await factsOf('earnkit', { live_url: 'https://earnkit.com' });
  const g = { judges: 'clear problem', pattern: 'who, pain, cost', source_url: 'https://example.com/g' };
  const f = prefill(rowWith([req({ key: 'problem', label: 'Problem', type: 'text', kind: 'problem', guidance: g })]), facts).fields[0];
  assert.equal(f.from, 'agent');
  assert.equal(f.value, null);
  assert.equal(f.guidance, 'clear problem; who, pain, cost');
  const s = f.sources ?? [];
  assert.ok(s[0].startsWith('README: '));
  assert.ok(s.some((x) => x.startsWith('live: https://earnkit.com')));
  assert.ok(s.some((x) => x.startsWith('first commit: ')));
  assert.equal(s[s.length - 1], 'guidance: clear problem; who, pain, cost');
});

test('contract with none on the program chain is a builder field; chain fills the display name', async () => {
  const facts = await factsOf('nextjs-dashboard');
  const out = prefill(rowWith([
    req({ key: 'contract_address', label: 'Contract', type: 'text' }),
    req({ key: 'chain', label: 'Chain', type: 'text' }),
  ]), { ...facts, contracts: [], chains: [{ chain: 'base', mainnet: true, basis: 'reported' }] });
  assert.equal(out.fields[0].from, 'builder');
  assert.equal(out.fields[0].value, null);
  assert.equal(out.fields[1].value, 'Base');
  assert.equal(out.fields[1].from, 'earnkit');
});

test('file, demo_video and raised with no value are builder fields; team and contact are the agent\'s', async () => {
  const facts = await factsOf('nextjs-dashboard');
  const out = prefill(rowWith([
    req({ key: 'deck', label: 'Deck', type: 'file' }),
    req({ key: 'vid', label: 'Video', type: 'url', kind: 'demo_video' }),
    req({ key: 'raised', label: 'Raised', type: 'text', kind: 'raised' }),
    req({ key: 'team', label: 'Team', type: 'text', kind: 'team' }),
    req({ key: 'email', label: 'Email', type: 'email', kind: 'contact' }),
  ]), facts);
  assert.deepEqual(out.fields.map((f) => f.from), ['builder', 'builder', 'builder', 'agent', 'agent']);
});

test('facts_from_repo counts links, contract and chain values, never the passed name, description or a choice', () => {
  const facts: RepoFacts = {
    name: 'App', description: 'An AI agent on Base.', repo_url: 'https://github.com/a/b', public: true, as_reported: false,
    live_url: null, demo_url: null, chains: [{ chain: 'base', mainnet: true, basis: 'code' }],
    contracts: [{ chain: 'base', address: '0x' + 'a'.repeat(40), basis: 'code' }], builder_codes: false, users: null,
    first_commit_at: null, last_commit_at: null, readme_excerpt: null, homepage: null, integrations: [],
    repo_url_basis: 'code', live_url_basis: null, demo_url_basis: null,
  };
  const row = rowWith([
    req({ key: 'name', label: 'Name', type: 'text', kind: 'name', project_field: 'name' }),
    req({ key: 'one_liner', label: 'One line', type: 'text', kind: 'one_liner', project_field: 'description' }),
    req({ key: 'repo', label: 'Repo', type: 'url', kind: 'links', project_field: 'repo_url' }),
    req({ key: 'contract_address', label: 'Contract', type: 'text', kind: 'other' }),
    req({ key: 'chain', label: 'Chain', type: 'text', kind: 'other' }),
    req({ key: 'track', label: 'Track', type: 'choice', kind: 'other', options: ['AI agent', 'Payments'] }),
  ]);
  const out = prefill(row, facts);
  assert.equal(out.filled, 6);
  assert.equal(out.facts_from_repo, 3);
});

test('facts_from_repo is 0 for reported-only facts, even with a passed repo, live link, chain and contract', async () => {
  const r = parseProject({
    name: 'App', description: 'An app.', repo_url: 'https://github.com/someone/secret', live_url: 'https://app.example.com/', private: true,
    chains: [{ chain: 'base', mainnet: true, contract: '0x' + 'c'.repeat(40) }],
  });
  assert.ok(r.ok);
  const facts = await repoFacts(r.project, { now: NOW });
  assert.equal(facts.as_reported, true);
  const out = prefill(fromFile('base-builder-grants'), facts);
  assert.ok(out.filled > 0);
  assert.equal(out.facts_from_repo, 0);
});

test('facts_from_repo: a public read counts the repo link it read', async () => {
  const facts = await factsOf('earnkit');
  const row = rowWith([req({ key: 'repo', label: 'Repo', type: 'url', kind: 'links', project_field: 'repo_url' })]);
  assert.equal(prefill(row, facts).facts_from_repo, 1);
});

/** A record with the given patch merged by the builder, then the listed paths approved. */
function recordWith(patch: unknown, approve: string[] = []): BuilderRecord {
  const m = mergeRecord(EMPTY_RECORD, patch, 'builder', NOW);
  assert.deepEqual(m.problems, []);
  return approve.reduce((r, path) => approvePath(r, path, NOW), m.record);
}
const PROBLEM = { answers: { problem: { text: 'Builders lose weeks finding grants and rewriting the same answers for each form.', short: 'Builders lose weeks on grant forms.' } } };
const rec = (record: BuilderRecord, verifiedUsage: string | null = null) => ({ record, projectId: null, verifiedUsage });
const problemRow = (over: Record<string, unknown> = {}) => rowWith([req({ key: 'problem', label: 'Problem', type: 'text', kind: 'problem', todo: 'the problem', ...over })]);

test('an approved answer fills a prose field from the record, with the style contract', async () => {
  const facts = await factsOf('earnkit');
  const out = prefill(problemRow(), facts, rec(recordWith(PROBLEM, ['answers.problem'])));
  const f = out.fields[0];
  assert.equal(f.from, 'record');
  assert.equal(f.value, PROBLEM.answers.problem.text);
  assert.equal(f.style, STYLE_CONTRACT);
  assert.equal(out.from_record, 1);
  assert.equal(out.filled, 1);
  assert.deepEqual(out.need_you, []);
});

test('unapproved answers are not fitted', async () => {
  const facts = await factsOf('earnkit');
  const out = prefill(problemRow(), facts, rec(recordWith(PROBLEM)));
  const f = out.fields[0];
  assert.notEqual(f.from, 'record');
  assert.equal(f.value, null);
  assert.equal(f.style, undefined);
  // Lane 8 #1 (v6.1.10): linked, an answer the record does not hold is the builder's to give once (never sent as
  // the agent's), with the sources to help word it.
  assert.equal(f.from, 'builder');
  assert.equal(f.sources?.at(-1), 'the builder, once: store the answer with record before using it');
  assert.deepEqual(out.need_you, ['the problem']);
  assert.deepEqual(unvouchedRequired(out.fields).map((x) => x.key), ['problem']);
  assert.deepEqual(unvouchedRequired(prefill(problemRow(), facts, rec(recordWith(PROBLEM, ['answers.problem']))).fields), []);
  // Unlinked (no record): v5's agent field, without the ask-once source.
  assert.ok(!prefill(problemRow(), facts).fields[0].sources?.some((x) => x.includes('store the answer')));
});

test('max_chars under 300 picks the short answer; above it the full text', async () => {
  const facts = await factsOf('earnkit');
  const r = rec(recordWith(PROBLEM, ['answers.problem']));
  assert.equal(prefill(problemRow({ max_chars: 200 }), facts, r).fields[0].value, PROBLEM.answers.problem.short);
  assert.equal(prefill(problemRow({ max_chars: 500 }), facts, r).fields[0].value, PROBLEM.answers.problem.text);
});

test('traction: verified usage wins over the pre-launch line; neither leaves it to the builder', async () => {
  const facts = await factsOf('earnkit');
  const row = rowWith([req({ key: 'traction', label: 'Traction', type: 'text', kind: 'traction', todo: 'your traction' })]);
  const withLine = recordWith({ traction: { line_pre_launch: 'Pre-launch, launching 2026-12-01, 140 on the waitlist.' } }, ['traction.line_pre_launch']);
  const usage = '1,240 distinct funded wallets in 90 days on Base, 12,300 transactions, live since 2026-08-02';
  const verified = prefill(row, facts, rec(withLine, usage)).fields[0];
  assert.deepEqual([verified.from, verified.value, verified.style], ['record', usage, undefined]);
  const line = prefill(row, facts, rec(withLine)).fields[0];
  assert.deepEqual([line.from, line.value, line.style], ['record', 'Pre-launch, launching 2026-12-01, 140 on the waitlist.', STYLE_CONTRACT]);
  const nothing = prefill(row, facts, rec(EMPTY_RECORD)).fields[0];
  assert.deepEqual([nothing.from, nothing.value], ['builder', null]);
  // An unapproved line is not used either.
  const unapproved = recordWith({ traction: { line_pre_launch: 'Pre-launch.' } });
  assert.equal(prefill(row, facts, rec(unapproved)).fields[0].from, 'builder');
});

test('person facts fill contact fields; other handles and files stay the builder', async () => {
  const facts = await factsOf('earnkit');
  const record = recordWith({ person: { name: 'Jenil Thakker', email: 'jenil@example.com', x: 'jenil' }, docs: { demo_video_url: 'https://loom.com/share/demo' } });
  const row = rowWith([
    req({ key: 'email', label: 'Email', type: 'email', kind: 'contact', todo: 'your email' }),
    req({ key: 'first_name', label: 'First name', type: 'text', kind: 'contact', todo: 'your first name' }),
    req({ key: 'last_name', label: 'Last name', type: 'text', kind: 'contact', todo: 'your last name' }),
    req({ key: 'x_handle', label: 'X handle', type: 'text', kind: 'contact', todo: 'your X handle' }),
    req({ key: 'telegram', label: 'Telegram', type: 'text', kind: 'contact', todo: 'your Telegram username' }),
    req({ key: 'deck', label: 'Pitch deck', type: 'file', kind: 'other', todo: 'your deck file' }),
    req({ key: 'demo', label: 'Demo video', type: 'url', kind: 'demo_video', todo: 'a demo video' }),
  ]);
  const out = prefill(row, facts, rec(record));
  const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
  assert.deepEqual([by.email.from, by.email.value], ['record', 'jenil@example.com']);
  assert.equal(by.first_name.value, 'Jenil');
  assert.equal(by.last_name.value, 'Thakker');
  assert.equal(by.x_handle.value, 'jenil');
  assert.equal(by.demo.value, 'https://loom.com/share/demo');
  assert.equal(by.email.style, undefined);
  assert.deepEqual([by.telegram.from, by.deck.from], ['builder', 'builder']);
  assert.deepEqual(out.need_you, ['your Telegram username', 'your deck file']);
  assert.equal(out.from_record, 5);
});

test('team, raised and links from the record; the project answer wins over the record-wide one', async () => {
  const facts = await factsOf('earnkit');
  const record = recordWith(
    {
      team: [{ name: 'Jenil', role: 'founder' }, { name: 'Ada' }],
      company: { raised_usd: 250000, raised_from: 'angels' },
      projects: [{ id: 'earnkit', repo_url: 'https://github.com/jenil/earnkit', live_url: 'https://earnkit.com', answers: { solution: { text: 'Project solution.' } } }],
      answers: { solution: { text: 'Record solution.' } },
    },
    ['company.raised', 'answers.solution', 'projects.earnkit.answers.solution'],
  );
  const row = rowWith([
    req({ key: 'team', label: 'Team', type: 'text', kind: 'team', todo: 'the team' }),
    req({ key: 'raised', label: 'Raised so far', type: 'text', kind: 'raised', todo: 'money raised' }),
    req({ key: 'links', label: 'Links', type: 'text', kind: 'links', todo: 'links' }),
    req({ key: 'how', label: 'How it works', type: 'text', kind: 'how_it_works', todo: 'how it works' }),
  ]);
  const by = Object.fromEntries(prefill(row, facts, { record, projectId: 'earnkit', verifiedUsage: null }).fields.map((f) => [f.key, f]));
  assert.equal(by.team.value, 'Jenil (founder), Ada');
  assert.equal(by.raised.value, '$250,000 from angels');
  assert.equal(by.links.value, 'https://earnkit.com https://github.com/jenil/earnkit');
  assert.deepEqual([by.how.from, by.how.value, by.how.style], ['record', 'Project solution.', STYLE_CONTRACT]);
});

test('the counts are over required fields: an optional record field is in fields but not in from_record', async () => {
  const facts = await factsOf('earnkit');
  const record = recordWith({ person: { name: 'Ada Lovelace', email: 'ada@example.com' }, ...PROBLEM }, ['answers.problem']);
  const row = rowWith([
    req({ key: 'email', label: 'Email', type: 'email', kind: 'contact', todo: 'your email' }),
    req({ key: 'problem', label: 'Problem', type: 'text', kind: 'problem', todo: 'the problem', required: false }),
    req({ key: 'telegram', label: 'Telegram', type: 'text', kind: 'contact', todo: 'your Telegram username' }),
  ]);
  const out = prefill(row, facts, rec(record));
  assert.equal(out.fields.find((f) => f.key === 'problem')!.from, 'record');
  assert.equal(out.from_record, 1);
  assert.equal(out.filled, 2);
  assert.equal(out.total, 2);
  assert.ok(out.from_record + out.repo_required + out.need_you.length <= out.total);
});

/** Facts whose live and repo links were both read from the code. */
const LINK_FACTS: RepoFacts = {
  name: 'App', description: 'An app.', repo_url: 'https://github.com/a/b', public: true, as_reported: false,
  live_url: 'https://app.example.com', demo_url: null, chains: [], contracts: [], builder_codes: false, users: null,
  first_commit_at: null, last_commit_at: null, readme_excerpt: null, homepage: null, integrations: [],
  repo_url_basis: 'code', live_url_basis: 'code', demo_url_basis: null,
};

test('R1: each link field gets one URL by its key and label; X, deck and other links are the builder', () => {
  const out = prefill(rowWith([
    req({ key: 'x_url', label: 'X profile', type: 'url', kind: 'links', todo: 'your X profile' }),
    req({ key: 'website', label: 'Website', type: 'url', kind: 'links', todo: 'your website' }),
    req({ key: 'repo_url', label: 'GitHub repo', type: 'url', kind: 'links', project_field: 'repo_url', todo: 'your repo' }),
    req({ key: 'other_links', label: 'Other links', type: 'url', kind: 'links', todo: 'other links' }),
    req({ key: 'pitch_deck', label: 'Pitch deck', type: 'url', kind: 'links', todo: 'your pitch deck' }),
  ]), LINK_FACTS);
  const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
  assert.deepEqual([by.x_url.value, by.x_url.from], [null, 'builder']);
  assert.deepEqual([by.pitch_deck.value, by.pitch_deck.from], [null, 'builder']);
  assert.deepEqual([by.website.value, by.website.from], ['https://app.example.com', 'earnkit']);
  assert.deepEqual([by.repo_url.value, by.repo_url.from], ['https://github.com/a/b', 'earnkit']);
  assert.deepEqual([by.other_links.value, by.other_links.from], [null, 'builder']);
  assert.equal(out.facts_from_repo, 2);
});

test('R1a: repo words beat live words: "App repository" and "Link to the app\'s source code" take the repo URL', () => {
  const out = prefill(rowWith([
    req({ key: 'app_repo', label: 'App repository', type: 'url', kind: 'links' }),
    req({ key: 'src', label: "Link to the app's source code", type: 'url', kind: 'links' }),
  ]), LINK_FACTS);
  for (const f of out.fields) assert.deepEqual([f.key, f.value, f.from], [f.key, 'https://github.com/a/b', 'earnkit']);
});

test('R1: a url field never gets two URLs; a text field labelled only "Links" may take both', () => {
  const out = prefill(rowWith([
    req({ key: 'links', label: 'Links', type: 'text', kind: 'links' }),
    req({ key: 'relevant', label: 'Relevant links', type: 'url', kind: 'links' }),
    req({ key: 'code', label: 'Source code', type: 'url', kind: 'links' }),
    req({ key: 'live', label: 'Live product', type: 'url', kind: 'links', project_field: 'live_url' }),
  ]), { ...LINK_FACTS, live_url: null, live_url_basis: null });
  const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
  assert.equal(by.links.value, 'https://github.com/a/b');
  assert.equal(by.relevant.value, 'https://github.com/a/b');
  assert.equal(by.code.value, 'https://github.com/a/b');
  // project_field decides: no live URL is the builder's, never the repo in its place.
  assert.deepEqual([by.live.value, by.live.from], [null, 'builder']);
  const both = prefill(rowWith([req({ key: 'links', label: 'Links', type: 'text', kind: 'links' })]), LINK_FACTS).fields[0];
  assert.equal(both.value, 'https://app.example.com https://github.com/a/b');
  for (const f of prefill(rowWith([
    req({ key: 'relevant', label: 'Relevant links', type: 'url', kind: 'links' }),
    req({ key: 'url', label: 'URL', type: 'url', kind: 'links' }),
  ]), LINK_FACTS).fields) assert.equal(f.value, 'https://app.example.com');
});

test('R2/R2a unlinked: consent, amounts, phone, birthday and traction are the builder; contacts and prose stay the agent', () => {
  const out = prefill(rowWith([
    req({ key: 'email', label: 'Email', type: 'email', kind: 'contact' }),
    req({ key: 'phone', label: 'Phone', type: 'text', kind: 'other' }),
    req({ key: 'birthday', label: 'Birthday', type: 'text', kind: 'other' }),
    req({ key: 'consent_team1', label: 'I consent', type: 'choice', kind: 'other', options: ['Yes'] }),
    req({ key: 'requested_amount_usd', label: 'Requested amount', type: 'text', kind: 'other' }),
    req({ key: 'traction', label: 'Traction', type: 'text', kind: 'traction' }),
    req({ key: 'raised', label: 'Raised', type: 'text', kind: 'raised' }),
    req({ key: 'problem', label: 'Problem', type: 'text', kind: 'problem' }),
    req({ key: 'usage', label: 'How do people use it?', type: 'text', kind: 'other' }),
  ]), LINK_FACTS);
  const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
  // R2a: unlinked, a contact is the agent's (it knows who it works for); linked it is the builder's.
  assert.equal(by.email.from, 'agent');
  assert.deepEqual(by.email.sources?.slice(0, 2), ['git config and the environment', 'what the builder told you']);
  assert.equal(prefill(rowWith([req({ key: 'email', label: 'Email', type: 'email', kind: 'contact' })]), LINK_FACTS, rec(EMPTY_RECORD)).fields[0].from, 'builder');
  // A contact-kind phone or birthday is still the builder's.
  const zf = prefill(rowWith([req({ key: 'dob', label: 'Birthday', type: 'text', kind: 'contact' }), req({ key: 'tel', label: 'Phone Number', type: 'text', kind: 'contact' })]), LINK_FACTS);
  assert.deepEqual(zf.fields.map((f) => f.from), ['builder', 'builder']);
  for (const k of ['phone', 'birthday', 'consent_team1', 'requested_amount_usd', 'traction', 'raised'])
    assert.deepEqual([k, by[k].value, by[k].from], [k, null, 'builder']);
  assert.equal(by.problem.from, 'agent');
  // "age" is a whole word: "usage" is not a personal fact.
  assert.equal(by.usage.from, 'agent');
});

test('R1 linked: the record fills a url field with one link, and an X profile not at all', () => {
  const record = recordWith({ projects: [{ id: 'earnkit', repo_url: 'https://github.com/jenil/earnkit', live_url: 'https://earnkit.com' }] });
  const out = prefill(rowWith([
    req({ key: 'website', label: 'Website', type: 'url', kind: 'links' }),
    req({ key: 'x_url', label: 'X profile', type: 'url', kind: 'links' }),
  ]), LINK_FACTS, { record, projectId: 'earnkit', verifiedUsage: null });
  const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
  assert.deepEqual([by.website.value, by.website.from], ['https://earnkit.com', 'record']);
  assert.deepEqual([by.x_url.value, by.x_url.from], [null, 'builder']);
});

test('an other text field with nothing to draft from is the builder\'s, never the agent\'s with no sources (v6.1.6)', () => {
  const none: RepoFacts = { ...LINK_FACTS, repo_url: null, live_url: null, repo_url_basis: null, live_url_basis: null, public: false, as_reported: true };
  const row = rowWith([req({ key: 'batch_preference', label: 'Batch preference', type: 'text', description: 'Choose Winter 2027, or name a later batch.' })]);
  const bare = prefill(row, none).fields[0];
  assert.equal(bare.from, 'builder');
  assert.equal(bare.sources, undefined);
  assert.equal(prefill(row, none, rec(EMPTY_RECORD)).fields[0].from, 'builder');
  const withRepo = prefill(row, LINK_FACTS).fields[0];
  assert.equal(withRepo.from, 'agent');
  assert.ok((withRepo.sources ?? []).length > 0);
});

test('C42: a record value longer than the field is marked to cut, with the note; one that fits is not', async () => {
  const facts = await factsOf('earnkit');
  const long = 'x'.repeat(299);
  const r = rec(recordWith({ answers: { one_liner: { text: long } } }, ['answers.one_liner']));
  const row = rowWith([req({ key: 'tagline', label: 'Tagline', type: 'text', kind: 'one_liner', max_chars: 60, todo: 'a tagline' })]);
  const f = prefill(row, facts, r).fields[0];
  assert.deepEqual([f.from, f.value, f.fit, f.fit_note], ['record', long, 'cut', 'Cut to 60 characters, keeping the meaning.']);
  // A short form longer than the field is cut too.
  const s = rec(recordWith(PROBLEM, ['answers.problem']));
  const tight = prefill(problemRow({ max_chars: 20 }), facts, s).fields[0];
  assert.deepEqual([tight.value, tight.fit], [PROBLEM.answers.problem.short, 'cut']);
  const fits = prefill(problemRow({ max_chars: 200 }), facts, s).fields[0];
  assert.equal('fit' in fits, false);
});

test('B16: a short form whose text is not approved is never used; an agent\'s new short drops the approval', async () => {
  const facts = await factsOf('earnkit');
  const approved = recordWith(PROBLEM, ['answers.problem']);
  const changed = mergeRecord(approved, { answers: { problem: { short: 'Builders serve 5,000 paying customers.' } } }, 'agent', NOW).record;
  const f = prefill(problemRow({ max_chars: 200 }), facts, rec(changed)).fields[0];
  assert.notEqual(f.from, 'record');
  assert.equal(f.value, null);
});

test('S12 (v6.1.9): with no repo read to confirm them, what the agent reported is the agent\'s to draft, never EarnKit\'s', () => {
  const read: RepoFacts = {
    name: 'App', description: 'The leading DeFi super app with 50,000 daily users', repo_url: 'https://github.com/a/b', public: true, as_reported: false,
    live_url: null, demo_url: null, chains: [{ chain: 'base', mainnet: true, basis: 'reported' }], contracts: [], builder_codes: false, users: null,
    first_commit_at: null, last_commit_at: null, readme_excerpt: null, homepage: null, integrations: [],
    repo_url_basis: 'code', live_url_basis: null, demo_url_basis: null,
  };
  const row = rowWith([
    req({ key: 'name', label: 'Name', type: 'text', kind: 'name', project_field: 'name' }),
    req({ key: 'building', label: 'What are you building', type: 'text', kind: 'one_liner' }),
    req({ key: 'repo', label: 'Repo', type: 'url', kind: 'links', project_field: 'repo_url' }),
  ]);
  for (const facts of [{ ...read, notes: ['empty' as const] }, { ...read, as_reported: true, public: false, repo_url_basis: 'reported' as const }]) {
    const out = prefill(row, facts);
    const by = Object.fromEntries(out.fields.map((f) => [f.key, f]));
    for (const k of ['name', 'building']) {
      assert.equal(by[k].from, 'agent', k);
      assert.equal(by[k].value, null, k);
      assert.equal(by[k].sources![0], 'what the builder told you', k);
    }
    // F2 (v6.1.10): the two are the agent's drafts, not filled by EarnKit and never "need you".
    assert.deepEqual(out.need_you, []);
    assert.equal(out.filled, 1);
  }
  // A repo read that is not empty: the passed name and description stay EarnKit's values as before.
  const out = prefill(row, read);
  assert.deepEqual(out.fields.map((f) => f.from), ['earnkit', 'earnkit', 'earnkit']);
});

test('F1 fix round 2 (v6.1.10): unvouchedRequired is every required builder field without a value and every agent field with no sources; never by kind or key', () => {
  const f = (key: string, from: string, o: { sources?: string[]; value?: string; required?: boolean; kind?: string } = {}) =>
    ({ key, label: key, type: 'text', required: o.required ?? true, kind: o.kind ?? 'other', value: o.value ?? null, from, ...(o.sources ? { sources: o.sources } : {}) }) as never;
  const fields = [
    f('a', 'earnkit', { value: 'x' }), f('b', 'record', { value: 'x' }), f('c', 'agent', { sources: ['README: x'] }),
    f('d', 'agent', { sources: [] }), f('e', 'agent'), f('linkedin', 'builder', { kind: 'links' }), f('chains_and_tools', 'builder', { kind: 'how_it_works', sources: ['README: x'] }),
    f('opt', 'builder', { required: false }),
  ];
  assert.deepEqual(unvouchedRequired(fields).map((x: { key: string }) => x.key), ['d', 'e', 'linkedin', 'chains_and_tools']);
});

test('lane 8 #8 (v6.1.10): need_you is every required builder field without a record value, the same list the line names', async () => {
  const facts = await factsOf('earnkit');
  const row = rowWith([
    req({ key: 'problem', label: 'Problem', type: 'text', kind: 'problem', todo: 'the problem' }),
    req({ key: 'phone', label: 'Phone', type: 'text', kind: 'other', todo: 'your phone' }),
    req({ key: 'email', label: 'Email', type: 'email', kind: 'contact', todo: 'your email' }),
  ]);
  const unlinked = prefill(row, facts);
  assert.deepEqual(unlinked.need_you, ['your phone']);
  const linked = prefill(row, facts, rec(recordWith({ person: { email: 'a@example.com' } })));
  assert.deepEqual(linked.need_you, ['the problem', 'your phone']);
});
