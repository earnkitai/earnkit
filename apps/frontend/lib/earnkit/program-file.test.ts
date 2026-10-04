import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile, tokenPolicyLine } from './program-file';

/** The repo's first program file (any one will do; they all predate token_policy). */
function firstProgramFile() {
  const dir = join(import.meta.dirname, '../../../../programs');
  return readdirSync(dir).filter((f) => f.endsWith('.json'))[0];
}

test('ProgramFile: token_policy defaults to encouraged and refuses unknown values', () => {
  const base = JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../../../programs', firstProgramFile()),
      'utf8',
    ),
  );
  delete base.token_policy;
  assert.equal(ProgramFile.parse(base).token_policy, 'encouraged');
  assert.equal(
    ProgramFile.parse({ ...base, token_policy: 'off' }).token_policy,
    'off',
  );
  assert.throws(() =>
    ProgramFile.parse({ ...base, token_policy: 'sometimes' }),
  );
});

test('tokenPolicyLine', () => {
  assert.equal(tokenPolicyLine('encouraged'), 'Entries get a token');
  assert.equal(tokenPolicyLine('allowed'), null);
  assert.equal(tokenPolicyLine('off'), 'No tokens for entries');
});
