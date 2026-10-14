import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_CAPS, identityInput } from './identity-input';

test('5.1 identity is read leniently: junk is dropped, caps hold, the old local_git maps in', () => {
  assert.deepEqual(identityInput('nonsense'), { github_login: null, projects: [], wallets: [] });
  const i = identityInput({
    github_login: 'Lee-Dev',
    projects: [
      { name: 'TipJar', what: 'a tip jar <b>now</b>', repo: 'git@github.com:lee-dev/tipjar.git', live_url: 'https://tip.example.com/x', contracts: ['base:0x' + 'a'.repeat(40), '0x' + 'b'.repeat(40), 'monad:0x' + 'c'.repeat(40)] },
      { name: '', live_url: 'http://localhost:3000' },
      ...Array.from({ length: 40 }, (_, k) => ({ name: `p${k}`, live_url: `https://p${k}.example.com` })),
    ],
    wallets: ['0x' + 'd'.repeat(40), 'not a wallet'],
  }, { emails: [], remotes: ['lee-dev/other'], live_urls: ['https://other.example.com'] });
  assert.equal(i.github_login, 'lee-dev');
  assert.equal(i.projects.length, IDENTITY_CAPS.projects);
  assert.deepEqual(i.projects[0], {
    name: 'TipJar', what: 'a tip jar now', repo: 'lee-dev/tipjar', live_url: 'https://tip.example.com', package: null,
    contracts: ['base:0x' + 'a'.repeat(40), 'monad:0x' + 'c'.repeat(40)],
  });
  assert.deepEqual(i.wallets, ['0x' + 'd'.repeat(40)]);
});

test('5.1b the old local_git fills in when there is room; bad logins, packages and odd shapes are dropped, never thrown', () => {
  const i = identityInput(
    { github_login: 'bad login!', projects: [{ name: 'Lib', package: 'Left-Pad' }, { name: 'Py', package: 'pypi:requests' }, { name: 'X', package: '../etc' }, null, 7], wallets: 'nope' },
    { emails: [], remotes: ['lee/other'], live_urls: ['https://other.example.com'] },
  );
  assert.equal(i.github_login, null);
  assert.deepEqual(i.projects.map((p) => [p.name, p.package, p.repo, p.live_url]), [
    ['Lib', 'left-pad', null, null],
    ['Py', 'pypi:requests', null, null],
    ['other', null, 'lee/other', null],
    ['other.example.com', null, null, 'https://other.example.com'],
  ]);
  assert.deepEqual(i.wallets, []);
  assert.deepEqual(identityInput({ projects: { length: 3 }, wallets: [{}, 1] }), { github_login: null, projects: [], wallets: [] });
});
