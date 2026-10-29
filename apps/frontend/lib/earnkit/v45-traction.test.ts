import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { ignitionClues } from './discovery-clues';
import { discoverPerson } from './discovery';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { mcpCall } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import type { ReaderDeps } from './source-readers';

/** v4.5 Task 1: Hardhat Ignition deploy files are contract clues (never a GitHub or Alchemy read: fakes only). */
appEnv();
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const addr = () => '0x' + randomBytes(20).toString('hex');
const A = '0x' + 'ab'.repeat(20);
const B = '0x' + 'cd'.repeat(20);
const C = '0x' + 'ef'.repeat(20);

test('1.1 ignition: deployed_addresses entries on Base with the journal\'s sender per future id', () => {
  const deployed = JSON.stringify({ 'Counter#Counter': A.toUpperCase().replace('0X', '0x'), 'Other#Token': B, 'Bad#Thing': 'nope' });
  const journal = [
    JSON.stringify({ type: 'DEPLOYMENT_INITIALIZE', chainId: 8453 }),
    JSON.stringify({ type: 'DEPLOYMENT_EXECUTION_STATE_INITIALIZE', futureId: 'Counter#Counter', from: C.toUpperCase().replace('0X', '0x') }),
    'not json "futureId"',
    JSON.stringify({ type: 'NETWORK_INTERACTION_REQUEST', futureId: 'Other#Token', networkInteraction: { id: 1, from: C } }),
  ].join('\n');
  assert.deepEqual(ignitionClues(deployed, journal, '8453'), [
    { chain: 'base', address: A, deployer: C, via: 'ignition' },
    { chain: 'base', address: B, deployer: C, via: 'ignition' },
  ]);
  assert.deepEqual(ignitionClues(deployed, null, '8453').map((c) => c.deployer), [null, null]);
  assert.deepEqual(ignitionClues(deployed, '', '8453').map((c) => c.deployer), [null, null]);
});

test('1.2 ignition: other chains, malformed JSON and non-objects give none', () => {
  const deployed = JSON.stringify({ 'Counter#Counter': A });
  assert.deepEqual(ignitionClues(deployed, null, '1'), []);
  assert.deepEqual(ignitionClues(deployed, null, '84532'), []);
  assert.deepEqual(ignitionClues(deployed, null, 'abc'), []);
  assert.deepEqual(ignitionClues('not json', null, '8453'), []);
  assert.deepEqual(ignitionClues('[]', null, '8453'), []);
  assert.deepEqual(ignitionClues('null', null, '8453'), []);
  assert.equal(ignitionClues(deployed, null, '5042')[0]?.chain, 'arc');
});

let n = 0;
/** A signed-in person whose repo is proven by the App, with the given files. */
async function person(files: Record<string, string>) {
  const run = String(process.pid % 100000);
  const handle = `ign${run}${++n}`;
  const key = `${handle}/chain`;
  const t = `ek_v45_${run}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `96${run}${n}`, username: handle.slice(0, 15), name: handle, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: false }, 'find', { identity: { project: { name: 'chain', repo: `https://github.com/${key}` } } });
  const gh = fakeGitHub({ [key]: { id: Number(`7${run}${n}`), owner: handle, installation: 500 + n, pulls: [], commits: [], created: '2025-01-01T00:00:00Z', files } });
  const proof = await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  assert.equal((proof as { ok?: boolean }).ok, true, JSON.stringify(proof));
  return { id: c.id, gh };
}
const reader = (gh: ReturnType<typeof fakeGitHub>, onchain: { deployer: string | null; created_at: string | null }): ReaderDeps => {
  const no = async (): Promise<never> => { throw new Error('unexpected read'); };
  return { gh: (async () => ({})) as ReaderDeps["gh"], ghGraphql: no, probe: no, fetchText: no, json: no, walletCreations: async () => [], contractOrigin: async () => onchain, ghFetch: gh, now: new Date() };
};
const contracts = async (id: number) => (await sql()<{ ref: string; state: string; proof: string | null; reject_reason: string | null }[]>`
  SELECT ref, state, proof, reject_reason FROM builder_sources WHERE builder_id = ${id} AND kind = 'contract'`);

test('1.3 an ignition deploy file with a matching onchain deployer is a verified repo_link', dbTest, async () => {
  const [contract, deployer] = [addr(), addr()];
  const p = await person({
    'ignition/deployments/chain-8453/deployed_addresses.json': JSON.stringify({ 'Counter#Counter': contract }),
    'ignition/deployments/chain-8453/journal.jsonl': JSON.stringify({ type: 'DEPLOYMENT_EXECUTION_STATE_INITIALIZE', futureId: 'Counter#Counter', from: deployer }) + '\n',
  });
  await discoverPerson(p.id, { deadline: Date.now() + 10_000, reader: reader(p.gh, { deployer, created_at: '2025-06-01T00:00:00Z' }) });
  assert.deepEqual((await contracts(p.id)).map((r) => ({ ...r })), [{ ref: `base:${contract}`, state: 'verified', proof: 'repo_link', reject_reason: null }]);
});

test('1.4 a file naming a contract whose onchain deployer differs is rejected; no journal means no deployer, also rejected', dbTest, async () => {
  const [contract, deployer, other, bare] = [addr(), addr(), addr(), addr()];
  const p = await person({
    'ignition/deployments/chain-8453/deployed_addresses.json': JSON.stringify({ 'A#A': contract, 'B#B': bare }),
    'ignition/deployments/chain-8453/journal.jsonl': JSON.stringify({ type: 'DEPLOYMENT_EXECUTION_STATE_INITIALIZE', futureId: 'A#A', from: deployer }) + '\n',
  });
  await discoverPerson(p.id, { deadline: Date.now() + 10_000, reader: reader(p.gh, { deployer: other, created_at: '2025-06-01T00:00:00Z' }) });
  const rows = await contracts(p.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.state === 'rejected' && r.proof === null), JSON.stringify(rows));
});
