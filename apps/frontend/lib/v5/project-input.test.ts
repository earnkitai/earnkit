import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProject } from './project-input';

const base = { name: 'Tipjar', description: 'Tips for creators.' };

test('a bad live_url is dropped with a problem and the project still parses', () => {
  const r = parseProject({ ...base, live_url: 'javascript:alert(1)', demo_url: 'https://demo.example.com/x' });
  assert.ok(r.ok);
  assert.equal(r.project.live_url, undefined);
  assert.equal(r.project.demo_url, 'https://demo.example.com/x');
  assert.deepEqual(r.problems, ['live_url dropped: not a web link']);
});

test('an unknown chain is dropped with a problem, a known one kept', () => {
  const r = parseProject({ ...base, chains: [{ chain: 'foo', mainnet: true }, { chain: 'Base', mainnet: true, contract: '0x' + 'a'.repeat(40) }] });
  assert.ok(r.ok);
  assert.deepEqual(r.project.chains, [{ chain: 'base', mainnet: true, contract: '0x' + 'a'.repeat(40) }]);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /chain foo dropped/);
});

test('a bad contract and a bad date are dropped; the chain stays', () => {
  const r = parseProject({ ...base, chains: [{ chain: 'base', mainnet: false, contract: '0x12' }], last_commit_at: 'yesterday' });
  assert.ok(r.ok);
  assert.deepEqual(r.project.chains, [{ chain: 'base', mainnet: false }]);
  assert.equal(r.project.last_commit_at, undefined);
  assert.equal(r.problems.length, 2);
});

test('a missing name or an over-long description is the only refusal', () => {
  assert.equal(parseProject({ description: 'x' }).ok, false);
  assert.equal(parseProject({ ...base, description: 'x'.repeat(281) }).ok, false);
  assert.equal(parseProject(null).ok, false);
});

test('a clean report parses with no problems and keeps the flags', () => {
  const r = parseProject({ ...base, repo_url: 'https://github.com/a/b', private: false, builder_codes: true, users: true, first_commit_at: '2026-01-02' });
  assert.ok(r.ok);
  assert.deepEqual(r.problems, []);
  assert.equal(r.project.builder_codes, true);
  assert.equal(r.project.first_commit_at, '2026-01-02T00:00:00.000Z');
});
