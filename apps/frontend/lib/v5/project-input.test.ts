import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProject, projectKeyOf } from './project-input';

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

test('a missing name, or a missing description with no repo link, is the only refusal', () => {
  assert.equal(parseProject({ description: 'x' }).ok, false);
  assert.equal(parseProject({ name: 'X', description: '   ' }).ok, false);
  assert.equal(parseProject(null).ok, false);
});

test('an over-long name or description is cut, with a problem line, never refused', () => {
  const r = parseProject({ name: 'n'.repeat(200), description: 'd'.repeat(2000) });
  assert.ok(r.ok);
  assert.equal(r.project.name.length, 80);
  assert.equal(r.project.description.length, 280);
  assert.deepEqual(r.problems, ['name cut to 80 characters', 'description cut to 280 characters']);
});

test('users: true, false or not reported (null)', () => {
  const t = parseProject({ ...base, users: true });
  const f = parseProject({ ...base, users: false });
  const n = parseProject(base);
  assert.ok(t.ok && f.ok && n.ok);
  assert.equal(t.project.users, true);
  assert.equal(f.project.users, false);
  assert.equal(n.project.users, null);
});

test('a clean report parses with no problems and keeps the flags', () => {
  const r = parseProject({ ...base, repo_url: 'https://github.com/a/b', private: false, builder_codes: true, users: true, first_commit_at: '2026-01-02' });
  assert.ok(r.ok);
  assert.deepEqual(r.problems, []);
  assert.equal(r.project.builder_codes, true);
  assert.equal(r.project.first_commit_at, '2026-01-02T00:00:00.000Z');
});

test('a bare string chain is a mainnet chain; an unknown bare string is dropped by name', () => {
  const r = parseProject({ ...base, chains: ['base', 'Arc', 'nowhere'] });
  assert.ok(r.ok);
  assert.deepEqual(r.project.chains, [{ chain: 'base', mainnet: true }, { chain: 'arc', mainnet: true }]);
  assert.deepEqual(r.problems, ['chain nowhere dropped: not a known chain']);
});

test('C13: chains are deduplicated by chain, mainnet and contract; entries beyond 20 are named, not read', () => {
  const c = '0x' + 'b'.repeat(40);
  const r = parseProject({ ...base, chains: ['base', 'base', { chain: 'Base', mainnet: true }, { chain: 'base', mainnet: true, contract: c }, { chain: 'base', mainnet: true, contract: c.toUpperCase().replace('0X', '0x') }, { chain: 'base', mainnet: false }] });
  assert.ok(r.ok);
  assert.deepEqual(r.project.chains, [{ chain: 'base', mainnet: true }, { chain: 'base', mainnet: true, contract: c }, { chain: 'base', mainnet: false }]);
  assert.deepEqual(r.problems, []);
  const many = parseProject({ ...base, chains: Array.from({ length: 10_000 }, () => 'base') });
  assert.ok(many.ok);
  assert.deepEqual(many.project.chains, [{ chain: 'base', mainnet: true }]);
  assert.deepEqual(many.problems, []);
  // Repeats are dropped before the cap: twenty copies never push a real chain out.
  const real = parseProject({ ...base, chains: [...Array.from({ length: 20 }, () => 'base'), 'arc', 'tempo', 'monad', 'robinhood', 'avalanche'] });
  assert.ok(real.ok);
  assert.deepEqual(real.project.chains?.map((x) => x.chain), ['base', 'arc', 'tempo', 'monad', 'robinhood', 'avalanche']);
  assert.deepEqual(real.problems, []);
  // Twenty-five different entries: twenty read, five named.
  const wide = parseProject({ ...base, chains: Array.from({ length: 25 }, (_, i) => `x${i}`) });
  assert.ok(wide.ok);
  assert.equal(wide.problems.length, 21);
  assert.equal(wide.problems[20], '5 chains beyond 20 were not read');
});

test('C14: a commit date after now plus one day is dropped with a problem; today and tomorrow stand', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const r = parseProject({ ...base, first_commit_at: '2099-01-01', last_commit_at: '+275760-09-13T00:00:00.000Z' }, now);
  assert.ok(r.ok);
  assert.equal(r.project.first_commit_at, undefined);
  assert.equal(r.project.last_commit_at, undefined);
  assert.deepEqual(r.problems, ['last_commit_at is in the future; not used', 'first_commit_at is in the future; not used']);
  const ok = parseProject({ ...base, last_commit_at: '2026-11-11T11:00:00Z' }, now);
  assert.ok(ok.ok);
  assert.equal(ok.project.last_commit_at, '2026-11-11T11:00:00.000Z');
  assert.deepEqual(ok.problems, []);
});

test('C15: control and format characters are stripped from every project string; nothing left is missing', () => {
  assert.deepEqual(parseProject({ name: '​‌‍﻿', description: 'd' }), { ok: false, problem: 'name: missing' });
  const r = parseProject({ name: '‮Tip\u0000jar​', description: 'Tips\u0007 for⁦ creators.', repo_url: 'https://github.com/a/b​', chains: ['ba​se'] });
  assert.ok(r.ok);
  assert.equal(r.project.name, 'Tipjar');
  assert.equal(r.project.description, 'Tips for creators.');
  assert.equal(r.project.repo_url, 'https://github.com/a/b');
  assert.deepEqual(r.project.chains, [{ chain: 'base', mainnet: true }]);
  // A tab or line break becomes one space, so two lines keep their word boundary (final review I1).
  const two = parseProject({ name: 'Tip\tjar', description: 'Built on Base.\nUsed by 200 people.\r\n\tDaily.' });
  assert.ok(two.ok);
  assert.equal(two.project.name, 'Tip jar');
  assert.equal(two.project.description, 'Built on Base. Used by 200 people. Daily.');
  // Joiners inside a word or emoji sequence stay; stray ones go.
  const joined = parseProject({ name: '\u0645\u06CC\u200C\u062E\u0648\u0627\u0645 \u{1F468}\u200D\u{1F469}', description: '\u200Dd\u200C' });
  assert.ok(joined.ok);
  assert.equal(joined.project.name, '\u0645\u06CC\u200C\u062E\u0648\u0627\u0645 \u{1F468}\u200D\u{1F469}');
  assert.equal(joined.project.description, 'd');
});

test('C16: a name or description that is not text says so, not missing', () => {
  assert.deepEqual(parseProject({ name: 42, description: 'd' }), { ok: false, problem: 'name: not text' });
  assert.deepEqual(parseProject({ name: 'X', description: true }), { ok: false, problem: 'description: not text' });
  assert.deepEqual(parseProject({ name: 'X', description: null }), { ok: false, problem: 'description: missing' });
});

test('B21 (v6.1.8): a Solana address is base58 of 32 to 44 characters; EVM chains keep 0x and 40 hex; a rejected one is named', () => {
  const orca = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
  const r = parseProject({ ...base, chains: [{ chain: 'solana', mainnet: true, contract: orca }] });
  assert.ok(r.ok);
  assert.deepEqual(r.project.chains, [{ chain: 'solana', mainnet: true, contract: orca }]);
  assert.deepEqual(r.problems, []);
  // An EVM address on Solana, a base58 one on Base, and base58 with a 0 (not in the alphabet) are each named.
  const bad = parseProject({ ...base, chains: [
    { chain: 'solana', mainnet: true, contract: '0x' + 'a'.repeat(40) },
    { chain: 'base', mainnet: true, contract: orca },
    { chain: 'solana', mainnet: false, contract: '0' + orca.slice(1) },
  ] });
  assert.ok(bad.ok);
  assert.deepEqual(bad.problems, [
    `contract on solana dropped: 0x${'a'.repeat(40)} is not a Solana address`,
    `contract on base dropped: ${orca} is not an 0x address`,
    `contract on solana dropped: 0${orca.slice(1)} is not a Solana address`,
  ]);
  assert.deepEqual(bad.project.chains, [{ chain: 'solana', mainnet: true }, { chain: 'base', mainnet: true }, { chain: 'solana', mainnet: false }]);
  // Too short or too long for base58.
  for (const contract of ['a'.repeat(31), 'a'.repeat(45)]) {
    const r2 = parseProject({ ...base, chains: [{ chain: 'solana', mainnet: true, contract }] });
    assert.ok(r2.ok);
    assert.deepEqual(r2.problems, [`contract on solana dropped: ${contract} is not a Solana address`]);
  }
});

test('C58 (v6.1.8): the description may be left out when a repo link is given; never without one', () => {
  const r = parseProject({ name: 'linux', repo_url: 'https://github.com/torvalds/linux' });
  assert.ok(r.ok);
  assert.equal(r.project.description, '');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(parseProject({ name: 'linux' }), { ok: false, problem: 'description: missing' });
  // A repo link that does not hold up is no link.
  assert.equal(parseProject({ name: 'linux', repo_url: 'not a link' }).ok, false);
});

test('projectKeyOf: the repo link lower-cased without a trailing slash or .git, else name:, else empty (v6.1.10, L1c-1)', () => {
  assert.equal(projectKeyOf({ name: 'X', repo_url: 'https://github.com/Acme/App.git' }), 'https://github.com/acme/app');
  assert.equal(projectKeyOf({ repo_url: 'https://github.com/Acme/App/' }), 'https://github.com/acme/app');
  assert.equal(projectKeyOf({ name: 'X', repo_url: 'https://github.com/acme/app' }), projectKeyOf({ name: 'Y', repo_url: 'https://GitHub.com/acme/app/' }));
  assert.equal(projectKeyOf({ name: '  My App ' }), 'name:my app');
  assert.equal(projectKeyOf({ name: 'My App', repo_url: '' }), 'name:my app');
  assert.equal(projectKeyOf({ name: '   ' }), '');
  assert.equal(projectKeyOf({}), '');
  assert.equal(projectKeyOf(null), '');
  assert.equal(projectKeyOf({ name: 7, repo_url: 7 }), '');
});
