import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectArg, ProjectInput, parseProject, projectKeyOf } from './project-input';

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
  // Final round: cleaned as parseProject cleans, so the raw project and the parsed one key the same.
  for (const raw of [{ name: 'My  App' }, { name: 'My\tApp\u200b' }, { name: 'X', repo_url: 'github.com/a/b' }, { name: 'X', repo_url: ' https://github.com/A/B.git ' }, { name: 'n'.repeat(100) }]) {
    const parsed = parseProject({ ...raw, description: 'd' });
    assert.ok(parsed.ok);
    assert.equal(projectKeyOf(raw), projectKeyOf(parsed.project), JSON.stringify(raw));
  }
  assert.equal(projectKeyOf({ name: 'My  App' }), 'name:my app');
  // A link that is not a web link is no repo key: the name stands, as in find.
  assert.equal(projectKeyOf({ name: 'X', repo_url: 'github.com/a/b' }), 'name:x');
});

test('B4 (v6.1.13): one canonical repo link for projectKeyOf and the repo read; every spelling of one repo is one key', async () => {
  const { canonicalRepoLink } = await import('./project-input');
  const { repoKey } = await import('./repo-facts');
  const key = 'https://github.com/lane11/keyrepo';
  for (const v of [
    'https://github.com/lane11/keyrepo', 'https://www.github.com/lane11/keyrepo', 'https://github.com/lane11/keyrepo/tree/main',
    'https://github.com/lane11/keyrepo/blob/main/README.md', 'https://github.com/lane11/keyrepo?tab=readme-ov-file', 'https://github.com/lane11/keyrepo#readme',
    'http://github.com/lane11/keyrepo', 'https://github.com:8443/lane11/keyrepo', 'https://github.com/lane11/keyrepo.git?x=1',
    'https://me@github.com/lane11/keyrepo', 'https://GitHub.com/Lane11/KeyRepo/', 'https://github.com/lane11/keyrepo.git/',
  ]) {
    assert.equal(canonicalRepoLink(v), key, v);
    assert.equal(projectKeyOf({ name: 'X', repo_url: v }), key, v);
    assert.equal(repoKey(v), 'lane11/keyrepo', v);
  }
  // Another host keeps its path, less a tree or blob suffix.
  assert.equal(canonicalRepoLink('https://www.GitLab.com/group/sub/proj/-/tree/main?x=1#y'), 'https://gitlab.com/group/sub/proj');
  // Fix round 1 (M1): any `-` suffix folds; a subgroup named tree is kept.
  assert.equal(canonicalRepoLink('https://gitlab.com/group/sub/proj/-/issues'), 'https://gitlab.com/group/sub/proj');
  assert.equal(canonicalRepoLink('https://gitlab.com/group/tree/proj'), 'https://gitlab.com/group/tree/proj');
  assert.equal(canonicalRepoLink('https://gitlab.com/group/tree/proj/-/blob/main/x.md'), 'https://gitlab.com/group/tree/proj');
  assert.equal(canonicalRepoLink('ftp://github.com/a/b'), null);
  assert.equal(canonicalRepoLink('not a link'), null);
  assert.equal(repoKey('https://gitlab.com/a/b'), null);
});

test('Low 13 (v6.1.13): a name key folds Unicode, so one name in any form is one project', () => {
  assert.equal(projectKeyOf({ name: 'Café' }), projectKeyOf({ name: 'Café' }));
  assert.equal(projectKeyOf({ name: 'STRASSE' }), projectKeyOf({ name: 'straße' }));
  assert.equal(projectKeyOf({ name: 'ＺＩＰ' }), 'name:zip');
});

test('T1, Review Focus 3 (v6.1.14): a chain object without mainnet keeps its chain on mainnet; the bare string still parses; a mainnet not true or false is still named', () => {
  const c = '0x' + 'b'.repeat(40);
  const r = parseProject({ ...base, chains: [{ chain: 'base', contract: c }, 'arc', { chain: 'monad', mainnet: null }] });
  assert.ok(r.ok);
  assert.deepEqual(r.project.chains, [{ chain: 'base', mainnet: true, contract: c }, { chain: 'arc', mainnet: true }, { chain: 'monad', mainnet: true }]);
  assert.deepEqual(r.problems, []);
  // Left out and true are one entry.
  const same = parseProject({ ...base, chains: [{ chain: 'base', contract: c }, { chain: 'base', mainnet: true, contract: c }] });
  assert.ok(same.ok);
  assert.deepEqual(same.project.chains, [{ chain: 'base', mainnet: true, contract: c }]);
  const bad = parseProject({ ...base, chains: [{ chain: 'base', mainnet: 'yes' }] });
  assert.ok(bad.ok);
  assert.equal(bad.project.chains, undefined);
  assert.deepEqual(bad.problems, ['chain base dropped: mainnet must be true or false']);
  assert.equal(ProjectInput.shape.chains.parse([{ chain: 'base' }])![0].mainnet, true);
});

test('F1 (v6.1.14 fix round 1): a chain object that names a testnet in any form is a testnet, with no problem line', () => {
  const c = '0x' + 'd'.repeat(40);
  const forms: [unknown, string][] = [
    [{ chain: 'base', testnet: true, contract: c }, 'base'],
    [{ chain: 'base', network: 'sepolia', contract: c }, 'base'],
    [{ chain: 'base', network: 'base-sepolia', contract: c }, 'base'],
    [{ chain: 'base', chain_id: 84532, contract: c }, 'base'],
    [{ chain: 'base', chainId: '84532', contract: c }, 'base'],
    [{ chain: 'base-sepolia', contract: c }, 'base'],
    [{ chain: 'base', mainnet: true, testnet: true, contract: c }, 'base'],
    [{ chain: 'sepolia', contract: c }, 'ethereum'],
    [{ chain: 'ethereum', chain_id: 11155111, contract: c }, 'ethereum'],
    [{ chain: 'ethereum', network: 'holesky', contract: c }, 'ethereum'],
    [{ chain: 'ethereum', chain_id: 17000, contract: c }, 'ethereum'],
    [{ chain: 'arbitrum', chain_id: 421614, contract: c }, 'arbitrum'],
    [{ chain: 'polygon', network: 'amoy', contract: c }, 'polygon'],
    [{ chain: 'polygon', chain_id: 80002, contract: c }, 'polygon'],
    [{ chain: 'avalanche', network: 'fuji', contract: c }, 'avalanche'],
    [{ chain: 'avalanche', chain_id: 43113, contract: c }, 'avalanche'],
    [{ chain: 'monad-testnet', contract: c }, 'monad'],
    [{ chain_id: 84532, contract: c }, 'base'],
    ['base-sepolia', 'base'],
  ];
  for (const [entry, chain] of forms) {
    const r = parseProject({ ...base, chains: [entry] });
    assert.ok(r.ok);
    assert.deepEqual(r.problems, [], JSON.stringify(entry));
    assert.deepEqual(r.project.chains?.map((x) => [x.chain, x.mainnet]), [[chain, false]], JSON.stringify(entry));
  }
  const sol = parseProject({ ...base, chains: [{ chain: 'solana', network: 'devnet' }, 'solana-devnet'] });
  assert.ok(sol.ok);
  assert.deepEqual(sol.project.chains, [{ chain: 'solana', mainnet: false }]);
  // A mainnet id or network stays mainnet; an unknown id is named, not guessed.
  const main = parseProject({ ...base, chains: [{ chain: 'base', chain_id: 8453, contract: c }, { chain: 'base', network: 'mainnet' }] });
  assert.ok(main.ok);
  assert.deepEqual(main.project.chains, [{ chain: 'base', mainnet: true, contract: c }, { chain: 'base', mainnet: true }]);
  const odd = parseProject({ ...base, chains: [{ chain: 'base', chain_id: 999999, contract: c }] });
  assert.ok(odd.ok);
  assert.equal(odd.project.chains, undefined);
  assert.deepEqual(odd.problems, ['chain base dropped: chain_id 999999 is not a known network; send mainnet true or false']);
});

test('F4 (v6.1.14 fix round 1): the chains examples in the description parse as written', () => {
  const desc = (ProjectArg.shape.chains.description ?? '') as string;
  const examples = [...desc.matchAll(/\{ "chain"[^}]*\}/g)].map((m) => JSON.parse(m[0]));
  assert.equal(examples.length, 2);
  const r = parseProject({ ...base, chains: ['base', ...examples] });
  assert.ok(r.ok);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.project.chains?.map((x) => [x.chain, x.mainnet, Boolean(x.contract)]), [['base', true, false], ['base', true, true], ['solana', true, true]]);
});

test('L13-15 (v6.1.14): only a code host is a repo; any other link is the live link, and a shortener never counts as code', async () => {
  const { isCodeHost } = await import('./project-input');
  for (const u of ['https://github.com/a/b', 'https://gitlab.com/g/p', 'https://codeberg.org/a/b', 'https://bitbucket.org/a/b', 'https://gitlab.example.gitlab.com/a/b', 'https://www.github.com/a/b', 'https://gist.github.com/a/1'])
    assert.equal(isCodeHost(u), true, u);
  for (const u of ['https://bit.ly/3xYz', 'https://example.com/a/b', 'https://notgithub.com/a/b', 'https://github.com.evil.io/a/b', 'not a link'])
    assert.equal(isCodeHost(u), false, u);
  // The bit.ly case (lane 13, S14): read as the live link, named for the agent; no repo, no repo key.
  const r = parseProject({ name: 'FUTO thing', description: 'An app', repo_url: 'https://bit.ly/3xYz' });
  assert.ok(r.ok);
  assert.equal(r.project.repo_url, undefined);
  assert.equal(r.project.live_url, 'https://bit.ly/3xYz');
  assert.deepEqual(r.problems, ['repo_url is not a code host; read as the live link']);
  assert.equal(projectKeyOf({ name: 'FUTO thing', repo_url: 'https://bit.ly/3xYz' }), 'name:futo thing');
  // A live link given too stays; the other link is dropped.
  const both = parseProject({ name: 'X', description: 'd', repo_url: 'https://example.com/x', live_url: 'https://x.app' });
  assert.ok(both.ok);
  assert.equal(both.project.live_url, 'https://x.app/');
  assert.equal(both.project.repo_url, undefined);
  assert.deepEqual(both.problems, ['repo_url dropped: not a code host']);
  // With no description, a link that is not a code host does not stand in for it.
  assert.deepEqual(parseProject({ name: 'X', repo_url: 'https://bit.ly/3xYz' }), { ok: false, problem: 'description: missing' });
});
