import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { bindX } from './claim';
import { codesIn } from './builder-code';
import { attributionFor, attributionSuffix, baseBuilderCode, personCode } from './attribution';

/** v2.12.1 T9 (spec 3 "Count future users"): person codes, the ERC-8021 suffix, Base codes. */

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date('2026-10-14T10:00:00Z');

async function claimed(handle: string): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-t9a-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${id}, ${`t9a-${id}`})`;
  const r = await bindX(id, { id: `t9a${randomBytes(6).toString('hex')}`, username: handle, name: handle, avatar: null }, NOW);
  assert.equal(r.ok, true);
  return id;
}

test('9.1 a person code is stable, ek_ plus 10 characters, different per person', () => {
  const was = process.env.EARNKIT_AUTH_SECRET;
  process.env.EARNKIT_AUTH_SECRET = 's';
  try {
    assert.match(personCode(7)!, /^ek_[a-z2-7]{10}$/);
    assert.equal(personCode(7), personCode(7));
    assert.notEqual(personCode(7), personCode(8));
    assert.equal(personCode(7, ''), null, 'no secret, no code');
  } finally {
    if (was === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = was;
  }
});

test('9.2 the suffix carries the codes in ERC-8021 form; the readers decode it back', () => {
  const s = attributionSuffix(['ek_abcdefghij', 'earnkit']);
  assert.deepEqual(codesIn(`0xa9059cbb${'0'.repeat(128)}${s.slice(2)}`), ['ek_abcdefghij', 'earnkit']);
});

test('9.3 a Base code is asked for only when switched on, read from any of its known field names, and stored', dbTest, async () => {
  const id = await claimed(`bd${randomBytes(4).toString('hex')}`);
  const was = process.env.EARNKIT_BASE_AGENT_CODES;
  try {
    delete process.env.EARNKIT_BASE_AGENT_CODES;
    assert.equal(await baseBuilderCode(id, '0x' + 'a'.repeat(40), { post: async () => { throw new Error('not called'); } }), null);
    process.env.EARNKIT_BASE_AGENT_CODES = 'on';
    // A failed call or an answer without a usable code stores nothing (the failure is logged by name only).
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a);
    try {
      assert.equal(await baseBuilderCode(id, '0x' + 'a'.repeat(40), { post: async () => { throw new Error('down'); } }), null);
    } finally {
      console.error = orig;
    }
    assert.deepEqual(logged, [['[attribution] base code', 'Error']]);
    assert.equal(await baseBuilderCode(id, '0x' + 'a'.repeat(40), { post: async () => ({ code: 'has spaces' }) }), null);
    let posts = 0;
    const deps = { post: async () => { posts++; return { builderCode: 'bc_x1' }; } };
    assert.equal(await baseBuilderCode(id, '0x' + 'a'.repeat(40), deps), 'bc_x1');
    assert.equal(await baseBuilderCode(id, '0x' + 'a'.repeat(40), deps), 'bc_x1');
    assert.equal(posts, 1);
    const id2 = await claimed(`bd${randomBytes(4).toString('hex')}`);
    assert.equal(await baseBuilderCode(id2, '0x' + 'b'.repeat(40), { post: async () => ({ builder_code: 'bc_y2' }) }), 'bc_y2');
  } finally {
    if (was === undefined) delete process.env.EARNKIT_BASE_AGENT_CODES;
    else process.env.EARNKIT_BASE_AGENT_CODES = was;
  }
});

test('9.3b attribution: Base apps carry the stored Base code when issued, other chains the person code; earnkit always second', dbTest, async () => {
  process.env.EARNKIT_AUTH_SECRET ||= 'v2121-t9a-secret';
  const id = await claimed(`bd${randomBytes(4).toString('hex')}`);
  const mine = personCode(id)!;
  const arc = await attributionFor(id, 'arc');
  assert.deepEqual(arc!.codes, [mine, 'earnkit']);
  assert.deepEqual(codesIn(`0x${'0'.repeat(8)}${arc!.data_suffix.slice(2)}`), [mine, 'earnkit']);
  // No proven wallet: the person code on Base too.
  assert.deepEqual((await attributionFor(id, 'base'))!.codes, [mine, 'earnkit']);
  await sql()`UPDATE builder_profiles SET base_builder_code = 'bc_z3' WHERE builder_id = ${id}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${'0x' + randomBytes(20).toString('hex')}, ${id})`;
  const was = process.env.EARNKIT_BASE_AGENT_CODES;
  process.env.EARNKIT_BASE_AGENT_CODES = 'on';
  try {
    assert.deepEqual((await attributionFor(id, 'base'))!.codes, ['bc_z3', 'earnkit']);
    assert.deepEqual((await attributionFor(id, 'monad'))!.codes, [mine, 'earnkit']);
  } finally {
    if (was === undefined) delete process.env.EARNKIT_BASE_AGENT_CODES;
    else process.env.EARNKIT_BASE_AGENT_CODES = was;
  }
});
