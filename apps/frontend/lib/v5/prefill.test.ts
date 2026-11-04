import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { prefill } from './prefill';
import { repoFacts, type RepoFacts } from './repo-facts';
import { parseProject } from './project-input';
import { ProgramFile } from './program-file';
import type { ProgramRow } from './programs';
import { replayFetch } from './fixtures/github';
import { programFixture } from './fixtures/program';

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

test('base-builder-grants: facts fill, prose goes to the agent, personal stays with the builder', async () => {
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
  assert.equal(by.founding_team.from, 'builder');
  assert.equal(by.usage_numbers.from, 'agent');
  assert.equal(by.usage_numbers.value, null);
  assert.ok(by.usage_numbers.sources?.some((s) => s.startsWith('live: ')));
  assert.equal(by.full_name.from, 'builder');
  assert.equal(by.contract_address.from, facts.contracts.some((c) => c.chain === 'base') ? 'earnkit' : 'builder');
  assert.equal(out.filled, out.fields.filter((f) => f.from === 'earnkit').length);
  assert.equal(out.total, out.fields.filter((f) => f.required).length);
  assert.equal(out.total, 16);
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

test('file, team, raised and demo_video with no value are builder fields', async () => {
  const facts = await factsOf('nextjs-dashboard');
  const out = prefill(rowWith([
    req({ key: 'deck', label: 'Deck', type: 'file' }),
    req({ key: 'raised', label: 'Raised', type: 'text', kind: 'raised' }),
    req({ key: 'vid', label: 'Video', type: 'url', kind: 'demo_video' }),
  ]), facts);
  assert.deepEqual(out.fields.map((f) => f.from), ['builder', 'builder', 'builder']);
});
