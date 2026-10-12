import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUE_PATHS, cnameSite, foundryBroadcast, githubProfileClues, githubRemote, hardhatDeployment, npmPackage,
  pagesSite, profileCode, profileCodesIn, pypiPackage, vercelSites, wranglerSites,
} from './discovery-clues';

const A = '0x' + 'ab'.repeat(20);
const B = '0x' + 'cd'.repeat(20);

test('4.1 CNAME: the first host line, as an https origin; junk is null', () => {
  assert.equal(cnameSite('# pages\napp.tipjar.xyz\n'), 'https://app.tipjar.xyz');
  assert.equal(cnameSite('not a host at all'), null);
  assert.equal(cnameSite(''), null);
});

test('4.2 vercel.json: alias string or list; bad JSON is []', () => {
  assert.deepEqual(vercelSites('{"alias":"tip.example.com"}'), ['https://tip.example.com']);
  assert.deepEqual(vercelSites('{"alias":["a.example.com","b.example.com"]}'), ['https://a.example.com', 'https://b.example.com']);
  assert.deepEqual(vercelSites('{nope'), []);
});

test('4.3 wrangler.toml: route patterns and custom domains, wildcards and paths stripped, workers.dev kept', () => {
  const toml = 'name = "tips"\nroutes = [ { pattern = "tips.example.com/*", zone_name = "example.com" } ]\n[[routes]]\npattern = "*.api.example.com/v1/*"\n';
  assert.deepEqual(wranglerSites(toml), ['https://tips.example.com', 'https://api.example.com']);
  assert.deepEqual(wranglerSites('route = "x.example.org/*"'), ['https://x.example.org']);
});

test('4.4 GitHub Pages: user site and project site', () => {
  assert.equal(pagesSite('Jenil04', 'jenil04.github.io'), 'https://jenil04.github.io/');
  assert.equal(pagesSite('Jenil04', 'podtips'), 'https://jenil04.github.io/podtips/');
});

test('4.5 package.json and pyproject.toml names; private and invalid names are null', () => {
  assert.equal(npmPackage('{"name":"@lee/tipjar","version":"1.0.0"}'), '@lee/tipjar');
  assert.equal(npmPackage('{"name":"tipjar","private":true}'), null);
  assert.equal(npmPackage('{"name":"Bad Name"}'), null);
  assert.equal(pypiPackage('[project]\nname = "tip-jar"\nversion = "0.1"\n'), 'tip-jar');
  assert.equal(pypiPackage('[tool.poetry]\nname = "tipjar"\n'), 'tipjar');
  assert.equal(pypiPackage('[build-system]\nrequires = []\n'), null);
});

test('4.6 foundry broadcast: CREATE and CREATE2 on Base and Arc with their sender; other chains and calls dropped', () => {
  const run = (chain: number) => JSON.stringify({
    chain,
    transactions: [
      { transactionType: 'CREATE', contractAddress: A, transaction: { from: B } },
      { transactionType: 'CALL', contractAddress: null, transaction: { from: B } },
      { transactionType: 'CREATE2', contractAddress: B.toUpperCase().replace('0X', '0x'), transaction: { from: A } },
    ],
  });
  assert.deepEqual(foundryBroadcast('broadcast/Deploy.s.sol/8453/run-latest.json', run(8453)), [
    { chain: 'base', address: A, deployer: B, via: 'foundry' },
    { chain: 'base', address: B, deployer: A, via: 'foundry' },
  ]);
  assert.equal(foundryBroadcast('broadcast/Deploy.s.sol/5042/run-latest.json', run(5042))[0].chain, 'arc');
  assert.deepEqual(foundryBroadcast('broadcast/Deploy.s.sol/1/run-latest.json', run(1)), []);
  assert.deepEqual(foundryBroadcast('broadcast/x/8453/run-latest.json', 'not json'), []);
});

test('4.7 hardhat-deploy: address and receipt.from, chain from .chainId or the folder name', () => {
  const file = JSON.stringify({ address: A, receipt: { from: B }, abi: [] });
  assert.deepEqual(hardhatDeployment('deployments/base/TipJar.json', file), { chain: 'base', address: A, deployer: B, via: 'hardhat' });
  assert.deepEqual(hardhatDeployment('deployments/mainnet-x/TipJar.json', file, '5042'), { chain: 'arc', address: A, deployer: B, via: 'hardhat' });
  assert.equal(hardhatDeployment('deployments/sepolia/TipJar.json', file), null);
  assert.equal(hardhatDeployment('deployments/base/.chainId', '8453'), null);
});

test('4.8 the GitHub profile: blog as a site (https added), twitter_username kept for the prefill only', () => {
  assert.deepEqual(githubProfileClues({ blog: 'lee.dev', twitter_username: 'lee_builds' }), { site: 'https://lee.dev', twitter: 'lee_builds' });
  assert.deepEqual(githubProfileClues({ blog: '', twitter_username: 'not valid!' }), { site: null, twitter: null });
});

test('4.9 git remotes: ssh and https GitHub remotes to owner/repo; others null', () => {
  assert.equal(githubRemote('git@github.com:Lee/TipJar.git'), 'lee/tipjar');
  assert.equal(githubRemote('https://github.com/Lee/TipJar'), 'lee/tipjar');
  assert.equal(githubRemote('https://gitlab.com/lee/tipjar.git'), null);
});

test('4.10 the earnkit.txt profile line: bound to the person and the origin; parsed case-insensitively', () => {
  const c = profileCode(7, 'https://tip.example.com', 's'.repeat(40))!;
  assert.match(c, /^[0-9a-f]{16}$/);
  assert.notEqual(c, profileCode(8, 'https://tip.example.com', 's'.repeat(40)));
  assert.notEqual(c, profileCode(7, 'https://other.example.com', 's'.repeat(40)));
  assert.equal(profileCode(7, 'https://tip.example.com', undefined), null);
  assert.deepEqual(profileCodesIn(`# x\nProfile: ${c.toUpperCase()}\ntoken: abc\n`), [c]);
  assert.ok(CLUE_PATHS.includes('CNAME') && CLUE_PATHS.includes('wrangler.toml'));
});
