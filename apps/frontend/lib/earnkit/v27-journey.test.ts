import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { tools } from './tools';

/**
 * v2.7 end to end (Task 9): the builder's journey over the real program files, against a real
 * database. "What can I earn?" (the Difficulty column, the builder bonus close), a program's guide,
 * then the token step: missing items first, then "a token on Base" with no Clanker anywhere.
 * DB-gated; nothing leaves the machine (the ticker check is a local fetch stub).
 *
 * It runs in its own throwaway database (created from db/schema.sql, dropped after): the other
 * DB-gated test files run in parallel and add open campaigns and program copies to the shared one,
 * which would change what "What can I earn?" shows and how it closes (Ruling 10).
 */

/**
 * It creates and drops a database, so it needs CREATEDB and runs only against a local server
 * (localhost, 127.0.0.1 or ::1); anything else skips.
 */
const localDb = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
})();
const dbTest = {
  skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres',
};

/** Copied from copy-review.test.ts (it lives in a test file): human-facing "coin"/"coins". */
function coinWords(text: string): string[] {
  const stripped = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ')
    .replace(/\b\w*_\w*\b/g, ' ')
    .replace(/\b[a-z]+[A-Z]\w*\b/g, ' ');
  return stripped.match(/\bcoins?\b/gi) ?? [];
}

const PROGRAMS_DIR = join(import.meta.dirname, '../../../../programs');
const SCHEMA = join(import.meta.dirname, '../../db/schema.sql');
const FAR = '2099-01-01T00:00:00Z';
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v27_journey_${process.pid}`;

before(async () => {
  if (!sharedUrl || !localDb) return;
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
    await admin.unsafe(`CREATE DATABASE ${journeyDb}`);
  } finally {
    await admin.end();
  }
  const url = new URL(sharedUrl);
  url.pathname = `/${journeyDb}`;
  const fresh = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await fresh.unsafe(readFileSync(SCHEMA, 'utf8'));
  } finally {
    await fresh.end();
  }
  // db.ts connects on first use, so every read below goes to the journey's own database.
  process.env.DATABASE_URL = url.toString();
});

after(async () => {
  if (!sharedUrl || !localDb) return;
  await sql().end();
  process.env.DATABASE_URL = sharedUrl;
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
  } finally {
    await admin.end();
  }
});

test('v2.7 journey: what can I earn, the guide, then the token step', dbTest, async () => {
  // 1. Every real program file, as programs:sync would load it. Curated programs (no campaign) are
  //    made active with a 2099 deadline, so the journey never depends on real dates or closures
  //    (C17 fix round); campaign files keep their own status (Campaign #1 stays closed).
  const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, f), 'utf8'));
    if (!raw.campaign) Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
    await upsertProgram(ProgramFile.parse(raw));
  }

  // 2. A fresh installation (the agent's connection).
  const stamp = `${process.pid}-${Date.now()}`;
  const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`v27-journey-${stamp}`}, ${W}) RETURNING id`;

  // 3. "What can I earn?": the Difficulty column; the message closes on the builder bonus.
  const list = (await tools.list_programs(
    { agent_can_build: true },
    {
      installationId: id,
      // v2.8 Ruling C4: Easy programs sort first, so Arc (Easy) is always in the first table.
      roundPoolsWei: async () => new Map([['arc-microgrants', 6n * 10n ** 17n]]),
    },
  )) as { show_to_builder: string };
  const first = list.show_to_builder;
  assert.match(first, /\| Difficulty \|/, first);
  // v2.8 Ruling 24 (plan): the site's pool figure (the shared test DB may hold other open programs,
  // so only its form is checked here; landing.test.ts pins it to openFigure).
  assert.match(first, /^\$[\d.]+[KM]?\+? in prizes open right now\.\n\n/, first);
  assert.ok(
    first.trimEnd().endsWith(
      'Every entry gets a token: you earn 40% of its trading fees, and its fees fund the builder bonus. 0.60 ETH so far.',
    ),
    first,
  );
  assert.doesNotMatch(first, /affiliated/i);
  assert.deepEqual(coinWords(first), []);

  // 4. The guide: the header and the difficulty line.
  const program = (await tools.get_program({ program_id: 'arc-microgrants' }, { installationId: id })) as {
    guide: { text: string };
  };
  assert.ok(program.guide.text.startsWith('Arc Microgrants · '), program.guide.text);
  assert.match(program.guide.text, /^Difficulty: /m);

  // 5-6. The token step, with the ticker check stubbed locally (every ticker free).
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const realFetch = globalThis.fetch;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  globalThis.fetch = (async (url: string | URL) =>
    String(url).includes('/api/check-ticker')
      ? Response.json({ available: true })
      : new Response('', { status: 503 })) as typeof fetch;
  type Reply = { ready: boolean; show_to_builder: string; token?: unknown };
  const prep = async (project: Record<string, string>) =>
    (await tools.prepare_submission(
      {
        program_id: 'arc-microgrants',
        project,
        answers: { description: 'Tips on Arc', builder_profile: 'https://github.com/alice' },
      },
      { installationId: id },
    )) as Reply;
  const repo_url = `https://github.com/alice/tipjar-${stamp}`;
  try {
    // 5. Before going live: what's missing comes first, and there is no token yet.
    const notReady = await prep({ name: 'TipJar', repo_url });
    assert.equal(notReady.ready, false);
    assert.ok(notReady.show_to_builder.startsWith('Before you submit:'), notReady.show_to_builder);
    assert.ok(!('token' in notReady));
    assert.doesNotMatch(notReady.show_to_builder, /\| Token \|/);

    // 6. Every answer: the Token row says a token on Base, and no Clanker anywhere in the reply.
    const ready = await prep({ name: 'TipJar', repo_url, live_url: 'https://tipjar.example' });
    assert.equal(ready.ready, true);
    assert.match(ready.show_to_builder, /\| Token \| Your entry gets a token on Base, \$TIPJAR: /);
    assert.doesNotMatch(JSON.stringify(ready), /clanker/i);
    assert.deepEqual(coinWords(ready.show_to_builder), []);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});
