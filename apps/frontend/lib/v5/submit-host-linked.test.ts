/**
 * v3.8 G-A (item 6): a builder link off the source's site and the submit-platform list is allowed in the automated lane
 * when the official page itself links that exact URL. Regression: Growth's soonami Venturethon 11 write (submission on
 * app.foundance.org, linked from soonami.io/venturethon) was refused before the page was read. Fixtures are the saved
 * payload and the trimmed page; nothing here touches the network.
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiUrlProblems, offSiteLinks } from './api-text';
import { sql } from './db';
import { offSiteUnlinked } from './official-page';
import { getProgram } from './programs';
import { writePost } from './programs-api';
import { ProgramFile } from './program-file';

after(() => sql().end());

const TOKEN = 'q'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURES = join(import.meta.dirname, 'fixtures', 'pages');
const PAGE = readFileSync(join(FIXTURES, 'soonami-venturethon.html'), 'utf8');
const PAYLOAD = JSON.parse(readFileSync(join(FIXTURES, 'soonami-venturethon.payload.json'), 'utf8')) as {
  program: Record<string, unknown>;
} & Record<string, unknown>;
const FOUNDANCE = 'https://app.foundance.org/events/soonami-venturethon-11';

/** The suite's flags (pnpm test:flags-on sets them), restored after a test that sets its own. */
const FLAGS = process.env.EARNKIT_FLAGS;
beforeEach(() => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  if (FLAGS === undefined) delete process.env.EARNKIT_FLAGS;
  else process.env.EARNKIT_FLAGS = FLAGS;
});

const post = (payload: unknown) =>
  new Request('https://earnkit.com/api/programs/write', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

/** Growth's saved soonami payload, as of today (verified_at must be fresh), with `over` on the program. */
const payload = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...PAYLOAD,
  program: { ...PAYLOAD.program, id, verified_at: TODAY, ...over },
});

const send = async (body: unknown, page = PAGE) => {
  const read: string[] = [];
  const res = await writePost(post(body), {
    probe: async () => {},
    readPage: async (url) => {
      read.push(url);
      return page;
    },
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, read };
};

const HOST_PROBLEM = "submission_url: app.foundance.org is neither on soonami.io (the source's domain) nor a known submit platform";

test("Growth's soonami payload goes live: the official page links its Foundance form", async () => {
  const out = await send(payload('soonami-venturethon-11'));
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.result, 'created');
  assert.equal(out.json.live, true);
  // soonami.io is not yet tied to soonami, and the link is on the page, so not information only.
  assert.equal(out.json.organizer, 'new');
  assert.equal(out.json.info_only, false);
  assert.deepEqual(out.read, ['https://soonami.io/venturethon']);
  const row = (await getProgram('soonami-venturethon-11'))!;
  assert.equal(row.file.submission_url, FOUNDANCE);
  assert.equal(row.file.info_only, undefined);
});

test('the same works with auto_live on for everyone', async () => {
  process.env.EARNKIT_FLAGS = 'auto_live';
  const out = await send(payload('soonami-linked-flag'));
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.result, 'created');
});

test('an off-site host the official page does not link is still refused, and nothing goes live', async () => {
  const out = await send(payload('soonami-unlinked', { submission_url: 'https://app.foundance.org/events/some-other-event' }));
  assert.equal(out.status, 400);
  assert.deepEqual(out.json.problems, [`${HOST_PROBLEM}, and the official page does not link it`]);
  assert.equal(await getProgram('soonami-unlinked'), null);

  // Same host, different path: the exact link must be on the page, not just its host.
  const page = PAGE.replace(FOUNDANCE, 'https://app.foundance.org/events/elsewhere');
  const other = await send(payload('soonami-unlinked-2'), page);
  assert.equal(other.status, 400);
  assert.deepEqual(other.json.problems, [`${HOST_PROBLEM}, and the official page does not link it`]);
});

test('a page on a shared or submit platform never vouches for an off-site link, even when it links it', async () => {
  const out = await send(
    payload('soonami-on-platform', {
      source_url: 'https://soonami.notion.site/venturethon',
      submission_url: FOUNDANCE,
      pool_source_url: undefined,
    }),
  );
  assert.equal(out.status, 400);
  assert.deepEqual(out.json.problems, [
    "submission_url: app.foundance.org is neither on soonami.notion.site (the source's domain) nor a known submit platform; the official page is on notion.site, so its links do not vouch for it",
  ]);
});

test("a write without the check's fields keeps main's rule: the off-site host is refused and the page is never read", async () => {
  const { amount_quote: _a, deadline_quote: _d, found_by_query: _q, found_by_source: _s, ...plain } = payload('soonami-held');
  const out = await send(plain);
  assert.equal(out.status, 400);
  assert.deepEqual(out.json.problems, [HOST_PROBLEM]);
  assert.deepEqual(out.read, []);
});

test('with any other problem the off-site link is named too, before the page is read', async () => {
  const out = await send(payload('soonami-other-problem', { verified_at: '2020-01-01' }));
  assert.equal(out.status, 400);
  assert.deepEqual(out.json.problems, ['verified_at: more than 7 days ago; check the source again', HOST_PROBLEM]);
  assert.deepEqual(out.read, []);
});

test('pure: offSiteLinks names the off-site builder links; offSiteUnlinked keeps the ones the page does not link', () => {
  const p = ProgramFile.parse({ ...PAYLOAD.program, verified_at: TODAY });
  assert.deepEqual(offSiteLinks(p), [{ field: 'submission_url', url: FOUNDANCE, problem: HOST_PROBLEM }]);
  assert.deepEqual(apiUrlProblems(p), [HOST_PROBLEM]);
  assert.deepEqual(offSiteUnlinked(offSiteLinks(p), 'https://soonami.io/venturethon', [`${FOUNDANCE}/`]), []);
  assert.deepEqual(offSiteUnlinked(offSiteLinks(p), 'https://soonami.io/venturethon', []), [`${HOST_PROBLEM}, and the official page does not link it`]);
  // A dirty source_url is refused by its own rule, so there is nothing to vouch for.
  assert.deepEqual(offSiteLinks({ ...p, source_url: 'http://soonami.io/venturethon' }), []);
});
