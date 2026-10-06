import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logoFileProblem, ProgramFile } from './program-file';

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

// v2.7 §2: program guide facts (logo, past_rounds, focus, best_bet, difficulty_override, winners_per_round).
// `valid` is arc-microgrants.json (the first program file), id "arc-microgrants".
test('ProgramFile: with no new fields, past_rounds is [] and difficulty_override is null', () => {
  const valid = baseProgram();
  const parsed = ProgramFile.parse(valid);
  assert.deepEqual(parsed.past_rounds, []);
  assert.equal(parsed.difficulty_override, null);
});

test('ProgramFile: a full guide parses', () => {
  const valid = baseProgram();
  const guide = {
    logo: { path: 'programs/arc-microgrants.svg', source_url: 'https://www.arc.network/brand' },
    winners_per_round: 20,
    past_rounds: [
      {
        label: 'Arc Microgrants 2026 Q2',
        source_url: 'https://example.org/winners',
        submissions: 160,
        winners: 20,
        themes: [{ theme: 'USDC payroll and payouts', count: 3 }],
        examples: [
          {
            name: 'PayStream',
            what: 'streamed salaries in USDC',
            why: 'live mainnet demo',
            source_url: 'https://example.org/paystream',
          },
        ],
      },
    ],
    focus: { areas: ['Stablecoin payments', 'FX', 'Agentic commerce'], source_url: 'https://example.org/focus' },
    best_bet: 'A USDC payout tool with a live mainnet demo',
    difficulty_override: null,
  };
  assert.equal(ProgramFile.safeParse({ ...valid, ...guide }).success, true);
});

test('ProgramFile: refuses invalid guide facts, with a message naming the rule', () => {
  const valid = baseProgram();
  const round = (overrides: Record<string, unknown> = {}) => ({
    label: 'Round 1',
    source_url: 'https://example.org/winners',
    submissions: 160,
    winners: 20,
    ...overrides,
  });
  const refused = (file: unknown, pattern: RegExp) => {
    const result = ProgramFile.safeParse(file);
    assert.equal(result.success, false);
    assert.ok(
      result.error!.issues.some((i) => pattern.test(`${i.path.join('.')}: ${i.message}`)),
      `expected an issue matching ${pattern} in ${JSON.stringify(result.error!.issues)}`,
    );
  };

  refused(
    { ...valid, past_rounds: [round({ winners: 30, submissions: 20 })] },
    /submissions must be at least winners/,
  );
  refused(
    {
      ...valid,
      past_rounds: [
        round({
          themes: [
            { theme: 'A', count: 1 },
            { theme: 'B', count: 1 },
            { theme: 'C', count: 1 },
            { theme: 'D', count: 1 },
          ],
        }),
      ],
    },
    /<=3/,
  );
  refused(
    {
      ...valid,
      past_rounds: [
        round({
          examples: [
            { name: 'A', what: 'did a thing', why: 'judges liked it', source_url: 'https://e.org/a' },
            { name: 'B', what: 'did a thing', why: 'judges liked it', source_url: 'https://e.org/b' },
            { name: 'C', what: 'did a thing', why: 'judges liked it', source_url: 'https://e.org/c' },
          ],
        }),
      ],
    },
    /<=2/,
  );
  refused(
    { ...valid, past_rounds: [round({ examples: [] })] },
    />=1/,
  );
  refused(
    {
      ...valid,
      focus: {
        areas: ['Payments', 'FX', 'Agentic commerce', 'One too many'],
        source_url: 'https://example.org/focus',
      },
    },
    /<=3/,
  );
  refused(
    {
      ...valid,
      past_rounds: [
        round({ themes: [{ theme: 'This particular theme has way too many words to be a short theme', count: 1 }] }),
      ],
    },
    /1 to 12 words/,
  );
  refused(
    {
      ...valid,
      past_rounds: [round({ themes: [{ theme: 'See https://example.com for this', count: 1 }] })],
    },
    /no links/,
  );
  refused(
    { ...valid, past_rounds: [round({ winners: 5, themes: [{ theme: 'Big theme', count: 6 }] })] },
    /theme counts can't exceed the round's winners/,
  );
  refused(
    {
      ...valid,
      past_rounds: [
        round({
          winners: 5,
          themes: [
            { theme: 'Theme one', count: 3 },
            { theme: 'Theme two', count: 3 },
          ],
        }),
      ],
    },
    /theme counts can't exceed the round's winners/,
  );
  refused(
    {
      ...valid,
      past_rounds: [
        round({
          examples: [{ name: 'A', what: 'did a thing', why: 'judges liked it' }],
        }),
      ],
    },
    /source_url/,
  );
  refused(
    { ...valid, focus: { areas: ['Payments'] } },
    /source_url/,
  );
  refused(
    { ...valid, logo: { path: 'programs/other.svg', source_url: 'https://arc.network/brand' } },
    /logo\.path must be programs\/arc-microgrants\.svg or \.png/,
  );
  refused(
    { ...valid, best_bet: 'A USDC payout tool with a live mainnet demo' },
    /best_bet must be drawn from past_rounds or focus/,
  );
  refused(
    { ...valid, past_rounds: [round({ label: 'Same label' }), round({ label: 'Same label' })] },
    /labels must be unique/,
  );
  refused(
    {
      ...valid,
      difficulty_override: { level: 'Trivial', basis: 'x', source_url: 'https://example.org' },
    },
    /Trivial|invalid/i,
  );
  refused({ ...valid, winners_per_round: 0 }, />0/);
});

test('logoFileProblem: file presence, size, PNG signature, and SVG script/link checks', () => {
  const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(10)]);
  assert.equal(logoFileProblem('programs/a.png', png), null);
  assert.match(logoFileProblem('programs/a.png', Buffer.from('<svg/>'))!, /not a PNG/);
  assert.match(logoFileProblem('programs/a.svg', null)!, /not found/);
  assert.match(logoFileProblem('programs/a.svg', Buffer.alloc(200_001))!, /over 200 KB/);
  for (const bad of [
    '<svg><script>x</script></svg>',
    '<svg onload="x()"/>',
    '<svg><a href="https://e.com"/></svg>',
    '<svg><image xlink:href="data:image/png;base64,AA"/></svg>',
    '<svg><foreignObject/></svg>',
  ])
    assert.match(logoFileProblem('programs/a.svg', Buffer.from(bad))!, /scripts, event handlers or external links/, bad);
  assert.equal(
    logoFileProblem('programs/a.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')),
    null,
  );
});
