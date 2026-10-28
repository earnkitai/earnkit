import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { mcpCall, mcpListTools } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { humanStrings, humanTextFiles } from './human-text';
import { tools } from './tools';
import { TOKEN_ON_ITS_WAY } from './bench-find';

/**
 * v4.0 Task 11 (docs/design-docs-and-implementation-plans/v4-builder-tokens.md, Build E2): the per-project coin offers
 * are retired. Builder tokens (one per builder, at setup step 3) replaced them. (a) no builder-facing string says
 * "coin"; (b) an old agent's `tell coin` is answered with the builder token (a no is the builder token's no); (c) the
 * tools expose no `confirm` (the project coin launch).
 */
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');

/** The word itself, never part of an identifier (coin_address, coin_backers, --ek-s-coin-ring). */
const COIN = /(?<![\w-])coins?(?![\w-])/i;
/** Not builder text: a SQL statement or fragment, a log tag. */
const notCopy = (s: string) => /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|JOIN|COALESCE|GROUP BY|IS NULL)\b/.test(s) || /^\s*\[[\w -]+\]/.test(s);

test('(a) no reply or page string says "coin": every string literal and JSX text under lib/earnkit and app', () => {
  const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
  const files = humanTextFiles(ROOT).filter((f) => /^apps\/frontend\/(lib\/earnkit|app)\/.*\.tsx?$/.test(f));
  assert.ok(files.length > 100, `the scan found the sources (${files.length})`);
  const hits: string[] = [];
  for (const f of files)
    for (const { text, line } of humanStrings(f, readFileSync(join(ROOT, f), 'utf8')))
      if (/\s/.test(text.trim()) && COIN.test(text) && !notCopy(text)) hits.push(`${f}:${line}: ${text.trim().slice(0, 120)}`);
  assert.deepEqual(hits, []);
  // The retired modules are gone.
  for (const f of ['coin-moments.ts', 'token-offers.ts', 'raising.ts']) assert.equal(existsSync(join(import.meta.dirname, f)), false, f);
});

let n = 0;
/** A signed-in builder (an X account, so a builder token can be kept for them). */
async function signedIn(tag: string) {
  n++;
  const t = `ek_v4r_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const own = (await connectInstallation(t))!.own;
  const handle = `v4r${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `95${RUN}${n}${tag.length}`, username: handle, name: 'v4r', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  return { ctx, id: c.id };
}
const tokenRow = async (id: number) => (await sql()<{ status: string }[]>`SELECT status FROM builder_tokens WHERE builder_id = ${id}`)[0]?.status ?? null;

test('(b) an old agent\'s tell coin { answer: "no" } is the builder token\'s no; token "ask" and coin raising never mention a coin', db, async () => {
  const prev = process.env.EARNKIT_BUILDER_TOKENS;
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  try {
    const p = await signedIn('n');
    const no = await mcpCall(p.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'no' } });
    assert.equal(no.isError, false, no.text);
    assert.equal(await tokenRow(p.id), 'declined');
    assert.doesNotMatch(show(no), COIN);
    // "launch my token" (token: 'ask', an old agent's) and an old coin yes answer as tell move_up kind 'token' yes does,
    // and the no is kept.
    const asTokenYes = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'token', project_key: null, answer: 'yes' } }));
    assert.equal(show(await mcpCall(p.ctx, 'tell', { token: 'ask' })), asTokenYes);
    assert.equal(show(await mcpCall(p.ctx, 'tell', { coin: { project_key: 'someone/app', answer: 'yes' } })), asTokenYes);
    assert.doesNotMatch(asTokenYes, COIN);
    assert.equal(await tokenRow(p.id), 'declined');
    // An old backing switch changes nothing and says nothing about a coin.
    const raising = await mcpCall(p.ctx, 'tell', { coin: { raising: true } });
    assert.equal(raising.isError, false, raising.text);
    assert.doesNotMatch(show(raising), COIN);
    // A token already on its way is unchanged by an old coin no.
    const q = await signedIn('q');
    await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status) SELECT ${q.id}, x_user_id, 'launching' FROM builder_profiles WHERE builder_id = ${q.id}`;
    assert.equal(show(await mcpCall(q.ctx, 'tell', { coin: { project_key: 'x/y', answer: 'no' } })), TOKEN_ON_ITS_WAY);
    assert.equal(await tokenRow(q.id), 'launching');
  } finally {
    process.env.EARNKIT_BUILDER_TOKENS = prev;
  }
});

test('(c) the tools expose no confirm (the project coin launch), with or without the old EARNKIT_RAISING', db, async () => {
  assert.equal(Object.hasOwn(tools, 'confirm'), false);
  const prev = process.env.EARNKIT_RAISING;
  try {
    for (const v of ['on', undefined]) {
      if (v === undefined) delete process.env.EARNKIT_RAISING;
      else process.env.EARNKIT_RAISING = v;
      const p = await signedIn(`c${v ?? ''}`);
      const names = (await mcpListTools(p.ctx)).map((t) => t.name);
      assert.ok(names.includes('find') && names.includes('tell'), names.join());
      assert.equal(names.includes('confirm'), false, names.join());
      // No tool text names a coin: the descriptions, and the tell field old agents still send is undocumented ((b)).
      const texts: string[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'description' && typeof x === 'string' ? texts.push(x) : walk(x);
      };
      walk(await mcpListTools(p.ctx));
      assert.ok(texts.length > 20, `${texts.length} descriptions`);
      for (const t of texts) assert.doesNotMatch(t, COIN, t);
    }
  } finally {
    if (prev === undefined) delete process.env.EARNKIT_RAISING;
    else process.env.EARNKIT_RAISING = prev;
  }
});
