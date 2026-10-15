import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_EMPTY_NOTE, UPDATE_LINK_NOTE, UPDATE_MENTION_NOTE, UPDATE_NUMBER_NOTE, UPDATE_SECRET_NOTE, checkUpdate, updateLongNote } from './update-text';

const OWN = { live: 'https://recipes.app', repo: 'maya/recipes' };
const ok = (raw: string) => {
  const r = checkUpdate(raw, OWN);
  assert.ok(r.ok, `${raw}: ${'note' in r ? r.note : ''}`);
  return r.text;
};
const refused = (raw: string, note: string) => assert.deepEqual(checkUpdate(raw, OWN), { ok: false, note }, raw);

test('5.1 one plain paragraph is kept; the project\'s own live site and repo may be linked', () => {
  assert.equal(ok('Added fridge photo import, so it plans a week of meals from a picture.'), 'Added fridge photo import, so it plans a week of meals from a picture.');
  assert.equal(ok('Shipped  login.\n\nTry it at https://recipes.app/new'), 'Shipped login. Try it at https://recipes.app/new');
  assert.equal(ok('Code: https://github.com/Maya/recipes/pull/3'), 'Code: https://github.com/Maya/recipes/pull/3');
  assert.equal(ok('github.com/maya/recipes has the new parser'), 'github.com/maya/recipes has the new parser');
  assert.equal(ok('Faster search — and a dark mode'), 'Faster search, and a dark mode', 'no em dashes in public text');
  assert.equal(ok('Moved to Next.js 16'), 'Moved to Next.js 16', 'a library name is not a link');
  assert.equal(ok('x'.repeat(280)).length, 280);
});

test('5.2 any other link is refused, however it is written (review focus 2)', () => {
  for (const raw of [
    'See https://evil.example/claim', 'see evil.example', 'see evil[.]example', 'see evil(.)example',
    'https://recipes.app.evil.example', 'https://recipes.app@evil.example', 'http://recipes.app/x',
    'https://github.com/someone-else/recipes', 'https://github.com/maya/recipes-evil', 'https://gist.github.com/maya/1',
    'gist.github.com/maya/recipes', 'javascript:alert(1)', 'Free money at bit.ly/xyz',
  ])
    refused(raw, UPDATE_LINK_NOTE);
});

test('5.3 keys, tokens, seed phrases and addresses are refused (review focus 2)', () => {
  for (const raw of [
    `key 0x${'ab'.repeat(32)}`, 'token ghp_0123456789abcdefghijABCDEFGHIJ0123', 'sk-0123456789abcdefghij0123456789', 'AKIAABCDEFGHIJKLMNOP',
    'my seed phrase is in here', 'the 12 words are safe', `send to 0x${'1'.repeat(40)}`, '-----BEGIN PRIVATE KEY-----',
  ])
    refused(raw, UPDATE_SECRET_NOTE);
});

test('5.4 at most 280 characters after cleaning; empty is refused', () => {
  refused('x'.repeat(281), updateLongNote(281));
  refused('   ', UPDATE_EMPTY_NOTE);
  assert.deepEqual(checkUpdate(42, OWN), { ok: false, note: UPDATE_EMPTY_NOTE });
  assert.match(updateLongNote(281), /281 characters/);
});

test('5.4b mentions and long numbers are refused with their own note, not the links note (F16)', () => {
  refused('Thanks @maya', UPDATE_MENTION_NOTE);
  refused('Call me on +1 415 555 0100', UPDATE_NUMBER_NOTE);
  refused('Order 12345678 shipped', UPDATE_NUMBER_NOTE);
  assert.equal(ok('Shipped for the 2026-2027 season'), 'Shipped for the 2026-2027 season', 'a year range is not a number run');
  assert.notEqual(UPDATE_MENTION_NOTE, UPDATE_LINK_NOTE);
  assert.notEqual(UPDATE_NUMBER_NOTE, UPDATE_LINK_NOTE);
});
