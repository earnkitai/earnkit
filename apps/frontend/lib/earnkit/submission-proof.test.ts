import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proofProblem } from './submission-proof';
import { SafeFetchError } from './safe-fetch';

const program = {
  id: 'arc-microgrants',
  submission_proof: { host: 'dorahacks.io', path_pattern: '^/buidl/\\d+$' },
};
const URL_OK = 'https://dorahacks.io/buidl/12345';
const REPO = 'https://github.com/alice/tipjar';
const LIVE = 'https://tipjar.example';

test('proofProblem: no submission_proof on the program at all', async () => {
  const problem = await proofProblem(
    { id: 'no-proof', submission_proof: null },
    URL_OK,
    REPO,
    LIVE,
  );
  assert.match(problem!, /no public submission page/);
});

test('proofProblem: wrong host is refused before any fetch', async () => {
  let called = false;
  const problem = await proofProblem(
    program,
    'https://evil.example/buidl/12345',
    REPO,
    LIVE,
    { fetchText: async () => ((called = true), 'x') },
  );
  assert.match(problem!, /must be on dorahacks\.io/);
  assert.equal(called, false);
});

test('proofProblem: a www. host still matches (leniency), a different host does not', async () => {
  const problem = await proofProblem(
    program,
    'https://www.dorahacks.io/buidl/12345',
    REPO,
    LIVE,
    { fetchText: async () => `See ${REPO}` },
  );
  assert.equal(problem, null);
});

test('proofProblem: path mismatch (not a specific entry) is refused before any fetch', async () => {
  let called = false;
  const problem = await proofProblem(
    program,
    'https://dorahacks.io/hackathons/arc',
    REPO,
    LIVE,
    { fetchText: async () => ((called = true), 'x') },
  );
  assert.match(problem!, /doesn't look like one specific entry/);
  assert.equal(called, false);
});

test('proofProblem: a page without either link is refused', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => '<html>Some unrelated BUIDL page about pandas.</html>',
  });
  assert.match(problem!, /doesn't link to your repo or live site/);
});

test('proofProblem: the repo link in another case or form still matches (normalized)', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, undefined, {
    fetchText: async () =>
      '<a href="HTTPS://GitHub.com/Alice/TipJar/">Repo</a>',
  });
  assert.equal(problem, null);
});

test('proofProblem: the live host alone (no repo match) is enough', async () => {
  const problem = await proofProblem(program, URL_OK, undefined, LIVE, {
    fetchText: async () => 'Try it live: https://www.tipjar.example/demo',
  });
  assert.equal(problem, null);
});

test('proofProblem: an oversize page is refused with a specific message, not the retry note', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => {
      throw new SafeFetchError('larger than 512000 bytes');
    },
  });
  assert.match(problem!, /larger than EarnKit can check/);
});

test('proofProblem: a fetch failure (network, timeout, a bad status) retries daily', async () => {
  const problem = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => {
      throw new SafeFetchError('answered 404, not 200');
    },
  });
  assert.equal(problem, "couldn't check yet; we retry daily.");

  const problem2 = await proofProblem(program, URL_OK, REPO, LIVE, {
    fetchText: async () => {
      throw new Error('ECONNRESET');
    },
  });
  assert.equal(problem2, "couldn't check yet; we retry daily.");
});

test('proofProblem: no repo or live link to check against is refused before any fetch', async () => {
  let called = false;
  const problem = await proofProblem(program, URL_OK, undefined, undefined, {
    fetchText: async () => ((called = true), 'x'),
  });
  assert.match(problem!, /no repo_url or live_url/);
  assert.equal(called, false);
});

test('proofProblem: an invalid submission URL is refused', async () => {
  assert.match(
    (await proofProblem(program, 'not a url', REPO, LIVE))!,
    /not a valid link/,
  );
  assert.match(
    (await proofProblem(program, 'http://dorahacks.io/buidl/1', REPO, LIVE))!,
    /must be https/,
  );
});
