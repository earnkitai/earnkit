import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_EMPTY_NOTE, UPDATE_LINK_NOTE, UPDATE_MENTION_NOTE, UPDATE_NUMBER_NOTE, UPDATE_SECRET_NOTE, checkUpdate, updateLongNote } from './update-text';

const OWN = { sites: ['https://recipes.app'], repo: 'maya/recipes' };
const fw = (s: string) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
const ZW = '\u200B';
const SEED = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
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
  assert.equal(ok('github.com/maya/recipes has the new parser'), 'https://github.com/maya/recipes has the new parser', 'an own link is stored as its parsed href');
  assert.equal(ok('Live at https://recipes.app.'), 'Live at https://recipes.app/.');
  assert.equal(ok('ekupdlink0 is a word now'), 'ekupdlink0 is a word now', 'a typed placeholder-like word is kept (review 7)');
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
    // Fix round 1 (review 2, 3, 4): what an own link may hold, and look-alike prefixes.
    'https://recipes.app/<script>alert(1)</script>', 'https://recipes.app/"><img/src=x/onerror=alert(1)>', 'https://recipes.app/&lt;b&gt;',
    'https://recipes.app/\u202Eelpmaxe.live', `https://recipes.app/${ZW}x`, 'https://github.com/maya/recipes#<anything>',
    'https://recipes.app/?r=https://evil.example/claim', 'https://recipes.app/,evil.example', 'https://github.com/maya/recipes#evil.example',
    'see \u00EBgithub.com/maya/recipes', 'see \u0430github.com/maya/recipes',
    'https://github.com/maya/recipes/../../evil/x', 'https://github.com\\@evil.example/maya/recipes', 'https://recipes.app:8443/',
    // Fix round 2 (review 3): no % anywhere in an own link.
    'https://recipes.app/?r=evil%E3%80%82example', 'https://recipes.app/?r=https%253A%252F%252Fevil%252Eexample', 'https://recipes.app/?x=%40everyone',
  ])
    refused(raw, UPDATE_LINK_NOTE);
  // The @ and digit-run rules hold inside an own link too.
  refused('https://recipes.app/@everyone', UPDATE_MENTION_NOTE);
  refused('https://recipes.app/4155550100', UPDATE_NUMBER_NOTE);
});

test('5.2b own links are only the proven sites and the confirmed repo (review 5)', () => {
  assert.deepEqual(checkUpdate('Live at https://recipes.app/x', { sites: [], repo: 'maya/recipes' }), { ok: false, note: UPDATE_LINK_NOTE });
  assert.deepEqual(checkUpdate('https://github.com/maya/recipes', { sites: ['https://recipes.app'], repo: null }), { ok: false, note: UPDATE_LINK_NOTE });
  assert.deepEqual(checkUpdate('See https://www.npmjs.com/package/recipes', OWN), { ok: false, note: UPDATE_LINK_NOTE });
  assert.deepEqual(checkUpdate('See https://maya.earnkit.com/', { sites: ['https://maya.earnkit.com'], repo: null }), { ok: true, text: 'See https://maya.earnkit.com/' });
});

test('5.3 keys, tokens, seed phrases and addresses are refused (review focus 2)', () => {
  for (const raw of [
    `key 0x${'ab'.repeat(32)}`, 'token ghp_0123456789abcdefghijABCDEFGHIJ0123', 'sk-0123456789abcdefghij0123456789', 'AKIAABCDEFGHIJKLMNOP',
    'my seed phrase is in here', 'the 12 words are safe', `send to 0x${'1'.repeat(40)}`, '-----BEGIN PRIVATE KEY-----',
    // Fix round 1 (review 1): split by hidden characters or written full width, cleanText would rebuild them.
    `0x${ZW}${'ab'.repeat(20)}`, fw(`0x${'ab'.repeat(20)}`), `AKIA${ZW}ABCDEFGHIJKLMNOP`, `${fw('AKIA')}ABCDEFGHIJKLMNOP`,
    `s${ZW}k-abcdefghijabcdefghijabcd`, `gh${ZW}p_abcdefghijABCDEFGHIJabcdefghij`, `my se${ZW}ed phrase is here`, `my ${fw('seed')} phrase is here`,
    // Fix round 1 (review 6): more key shapes, and a bare BIP39 phrase.
    'sk_live_abcdefghijABCDEFGHIJabcd', 'send to 7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', `key ${'abcdef'.repeat(10)}abcd`,
    'abandon ability able about above absent absorb abstract absurd abuse access accident', `token ${'aB3'.repeat(11)}`,
    // Fix round 2 (review 1): combining marks on a secret's letters.
    'ghp_' + 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ'.split('').join('\u0300'), SEED.replace(/a/g, 'a\u0300'), 'AKIA\u0301ABCDEFGHIJKLMNOP',
    // Fix round 2 (review 2): Latin mixed with Cyrillic or Greek look-alikes in one word.
    '0x' + 'deadbeef'.repeat(5).replace(/a/g, '\u0430').replace(/e/g, '\u0435'), '\u0410KIAABCDEFGHIJKLMNOP', SEED.replace(/a/g, '\u0430'),
  ])
    refused(raw, UPDATE_SECRET_NOTE);
  // Real prose keeps its accents and its other scripts.
  assert.equal(ok('Caf\u00E9 menu and a na\u00EFve parser shipped'), 'Caf\u00E9 menu and a na\u00EFve parser shipped');
  assert.equal(ok('Added \u0440\u0443\u0441\u0441\u043A\u0438\u0439 and \u03B5\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC menus'), 'Added \u0440\u0443\u0441\u0441\u043A\u0438\u0439 and \u03B5\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC menus');
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
