import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LaunchError, xProfileUrl } from './tokens';

test('X handle in any common form becomes a profile URL', () => {
  for (const v of [
    'earnkit_ai',
    '@earnkit_ai',
    'https://x.com/earnkit_ai',
    'https://twitter.com/earnkit_ai/',
    'x.com/earnkit_ai?s=20'.replace(/^/, 'https://'),
  ]) {
    assert.equal(xProfileUrl(v), 'https://x.com/earnkit_ai');
  }
});

test('non-handles are rejected', () => {
  for (const v of [
    'not a handle!',
    '',
    'https://example.com/me',
    'waytoolonghandle_1234',
  ]) {
    assert.throws(() => xProfileUrl(v), LaunchError);
  }
});
