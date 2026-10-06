import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile } from './program-file';

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

function baseProgram() {
  return JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../../../programs', firstProgramFile()),
      'utf8',
    ),
  );
}

test('ProgramFile: accepts ideas and submission_proof', () => {
  const base = baseProgram();
  const parsed = ProgramFile.parse({
    ...base,
    ideas: ['A tiny app already live on Arc', 'A small working demo'],
    submission_proof: { host: 'dorahacks.io', path_pattern: '^/buidl/\\d+$' },
  });
  assert.deepEqual(parsed.ideas, [
    'A tiny app already live on Arc',
    'A small working demo',
  ]);
  assert.deepEqual(parsed.submission_proof, {
    host: 'dorahacks.io',
    path_pattern: '^/buidl/\\d+$',
  });
});

test('ProgramFile: submission_proof.path_pattern must be anchored (^...$)', () => {
  const base = baseProgram();
  for (const path_pattern of ['/buidl/\\d+', '^/buidl/\\d+', '/buidl/\\d+$']) {
    assert.throws(
      () =>
        ProgramFile.parse({
          ...base,
          submission_proof: { host: 'dorahacks.io', path_pattern },
        }),
      /path_pattern must be anchored/,
    );
  }
  assert.doesNotThrow(() =>
    ProgramFile.parse({
      ...base,
      submission_proof: { host: 'dorahacks.io', path_pattern: '^/buidl/\\d+$' },
    }),
  );
});

test('ProgramFile: ideas and submission_proof default to empty/null', () => {
  const base = baseProgram();
  delete base.ideas;
  delete base.submission_proof;
  const parsed = ProgramFile.parse(base);
  assert.deepEqual(parsed.ideas, []);
  assert.equal(parsed.submission_proof, null);
});

test('ProgramFile: rejects more than 3 ideas', () => {
  const base = baseProgram();
  assert.throws(() =>
    ProgramFile.parse({
      ...base,
      ideas: [
        'A tiny app already live on Arc',
        'A small working demo today',
        'A prototype testing a real use case',
        'One idea too many for this program',
      ],
    }),
  );
});

test('ProgramFile: rejects a link inside an idea', () => {
  const base = baseProgram();
  assert.throws(() =>
    ProgramFile.parse({
      ...base,
      ideas: ['See https://example.com for inspiration please'],
    }),
  );
});

test('ProgramFile: rejects an idea outside the 3-12 word range', () => {
  const base = baseProgram();
  assert.throws(() =>
    ProgramFile.parse({ ...base, ideas: ['Too short'] }),
  );
  assert.throws(() =>
    ProgramFile.parse({
      ...base,
      ideas: [
        'This idea has way too many words in it to count as a short plain idea at all',
      ],
    }),
  );
});

test('ProgramFile: rejects an invalid submission_proof regex', () => {
  const base = baseProgram();
  assert.throws(() =>
    ProgramFile.parse({
      ...base,
      submission_proof: { host: 'dorahacks.io', path_pattern: '^(unclosed' },
    }),
  );
});

test('ProgramFile: every committed program file validates', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const result = ProgramFile.safeParse(
      JSON.parse(readFileSync(join(dir, f), 'utf8')),
    );
    assert.ok(result.success, `${f}: ${JSON.stringify(result.error?.issues)}`);
  }
});

test('v2.6 Ruling 8: a windowed program with a builder bonus needs starts_at (its round is the window)', () => {
  const base = baseProgram();
  assert.throws(
    () => ProgramFile.parse({ ...base, starts_at: null, ends_at: '2026-10-15T03:59:00Z' }),
    /builder bonus on a program with ends_at needs starts_at/,
  );
  // Rolling (no end): unchanged.
  assert.doesNotThrow(() => ProgramFile.parse({ ...base, starts_at: null, ends_at: null }));
  // Opted out of the builder bonus: unchanged.
  assert.doesNotThrow(() =>
    ProgramFile.parse({ ...base, builder_bonus: false, starts_at: null, ends_at: '2026-10-15T03:59:00Z' }),
  );
});

test('ProgramFile: builder_bonus defaults to true and accepts false', () => {
  const base = baseProgram();
  delete base.builder_bonus;
  assert.equal(ProgramFile.parse(base).builder_bonus, true);
  assert.equal(ProgramFile.parse({ ...base, builder_bonus: false }).builder_bonus, false);
});
