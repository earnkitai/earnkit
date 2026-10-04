import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerMatches, secretMatches } from './http';

const SECRET = 's'.repeat(40);

test('secretMatches: exact, constant time; an unset or short secret never matches', () => {
  assert.equal(secretMatches(SECRET, SECRET), true);
  assert.equal(secretMatches(SECRET + 'x', SECRET), false);
  assert.equal(secretMatches('', SECRET), false);
  assert.equal(secretMatches(undefined, SECRET), false);
  assert.equal(secretMatches('', ''), false);
  assert.equal(secretMatches('short', 'short'), false);
  assert.equal(secretMatches(SECRET, undefined), false);
});

test('bearerMatches reads "Bearer <secret>" only', () => {
  assert.equal(bearerMatches(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(bearerMatches(SECRET, SECRET), false);
  assert.equal(bearerMatches(`Basic ${SECRET}`, SECRET), false);
  assert.equal(bearerMatches(null, SECRET), false);
});
