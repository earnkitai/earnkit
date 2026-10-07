import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logoFileProblem, ProgramFile, requiredWithoutTodo, requirementsWithoutKind } from './program-file';

/**
 * A committed program file that predates token_policy and lists one chain. v2.8 Task 6: named, not
 * the alphabetically first file, since a16z-speedrun (any_chain, no chains) now sorts first.
 */
function firstProgramFile() {
  return 'arc-microgrants.json';
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

/** The first committed program file without its v2.7 guide facts, so these tests don't depend on
 * the curated data (Task 8 backfilled it). */
function baseProgram() {
  const p = JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../../../programs', firstProgramFile()),
      'utf8',
    ),
  );
  for (const k of ['logo', 'past_rounds', 'focus', 'best_bet', 'difficulty_override', 'winners_per_round']) delete p[k];
  return p;
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
        own: true,
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
  // Ruling C4: `own` is a boolean when stated; left out, the round is a predecessor event.
  refused({ ...valid, past_rounds: [round({ own: 'yes' })] }, /past_rounds\.0\.own/);
  assert.equal(ProgramFile.parse({ ...valid, past_rounds: [round()] }).past_rounds[0].own, undefined);
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
    /past_rounds\.0\.themes:.*<=3/,
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
    /past_rounds\.0\.examples:.*<=2/,
  );
  refused(
    { ...valid, past_rounds: [round({ examples: [] })] },
    /past_rounds\.0\.examples:.*>=1/,
  );
  refused(
    {
      ...valid,
      focus: {
        areas: ['Payments', 'FX', 'Agentic commerce', 'One too many'],
        source_url: 'https://example.org/focus',
      },
    },
    /focus\.areas:.*<=3/,
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
  // Final review M3: themes_of is at most winners, needs themes, and bounds the theme counts.
  refused(
    { ...valid, past_rounds: [round({ winners: 5, themes_of: 6, themes: [{ theme: 'Big theme', count: 1 }] })] },
    /themes_of can't exceed the round's winners/,
  );
  refused({ ...valid, past_rounds: [round({ winners: 5, themes_of: 4 })] }, /themes_of needs themes/);
  refused(
    { ...valid, past_rounds: [round({ winners: 5, themes_of: 2, themes: [{ theme: 'Big theme', count: 3 }] })] },
    /theme counts can't exceed themes_of/,
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
  refused({ ...valid, winners_per_round: 0 }, /winners_per_round:.*>0/);

  // Fix round 1, Finding 3: best_bet and difficulty_override.basis are ShortText (short, no links).
  refused(
    {
      ...valid,
      focus: { areas: ['Payments'], source_url: 'https://example.org/focus' },
      best_bet:
        'This best bet sentence has way too many words for a short guide string here',
    },
    /best_bet:.*1 to 12 words/,
  );
  refused(
    {
      ...valid,
      focus: { areas: ['Payments'], source_url: 'https://example.org/focus' },
      best_bet: 'See https://example.com for the bet',
    },
    /best_bet:.*no links/,
  );
  refused(
    {
      ...valid,
      difficulty_override: {
        level: 'Hard',
        basis: 'This basis sentence has way too many words for a short guide string',
        source_url: 'https://example.org',
      },
    },
    /difficulty_override\.basis:.*1 to 12 words/,
  );
  refused(
    {
      ...valid,
      difficulty_override: {
        level: 'Hard',
        basis: 'See https://example.com for the odds',
        source_url: 'https://example.org',
      },
    },
    /difficulty_override\.basis:.*no links/,
  );

  // Fix round 1, Finding 7: a round's label and an example's name refuse links too.
  refused(
    { ...valid, past_rounds: [round({ label: 'See https://example.com for details' })] },
    /past_rounds\.0\.label:.*no links/,
  );
  refused(
    {
      ...valid,
      past_rounds: [
        round({
          examples: [
            { name: 'See https://x.example', what: 'did a thing', source_url: 'https://e.org/a' },
          ],
        }),
      ],
    },
    /past_rounds\.0\.examples\.0\.name:.*no links/,
  );
});

// Fix round 1, Finding 1 (Ruling C2): submissions/winners are null (written, not omitted) when
// the count isn't sourced, borrowed from a different kind of program, or a different metric.
test('ProgramFile: null submissions/winners/winners_per_round parse', () => {
  const valid = baseProgram();
  const parsed = ProgramFile.parse({
    ...valid,
    past_rounds: [
      {
        label: 'Base Batches 003',
        source_url: 'https://example.org/winners',
        submissions: null,
        winners: null,
        themes: [{ theme: 'Agentic commerce', count: 2 }],
      },
    ],
    winners_per_round: null,
  });
  assert.equal(parsed.past_rounds[0].submissions, null);
  assert.equal(parsed.past_rounds[0].winners, null);
  assert.equal(parsed.winners_per_round, null);
});

// Fix round 1, Finding 2 (Ruling C2): an example with no stated reason omits `why` (never invents one).
test('ProgramFile: an example with no why parses', () => {
  const valid = baseProgram();
  const parsed = ProgramFile.parse({
    ...valid,
    past_rounds: [
      {
        label: 'Round 1',
        source_url: 'https://example.org/winners',
        submissions: 160,
        winners: 20,
        examples: [
          {
            name: 'PayStream',
            what: 'streamed salaries in USDC',
            source_url: 'https://example.org/paystream',
          },
        ],
      },
    ],
  });
  assert.equal(parsed.past_rounds[0].examples![0].why, undefined);
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

// Fix round 1, Finding 6: only the first 4 of 8 PNG signature bytes were checked.
test('logoFileProblem: a PNG must match all 8 signature bytes, not just the first 4', () => {
  const fakePng = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG'), Buffer.from('<svg onload="x()"/>')]);
  assert.match(logoFileProblem('programs/a.png', fakePng)!, /not a PNG/);
});

// Fix round 1, Finding 4: every bypass the review found, now caught.
test('logoFileProblem: catches each review-found bypass', () => {
  const bypasses: [string, string | Buffer][] = [
    ['namespace-prefixed <s:script>', '<svg xmlns:s="urn:x"><s:script>alert(1)</s:script></svg>'],
    [
      'DOCTYPE internal entity',
      '<!DOCTYPE svg [<!ENTITY x "<script>alert(1)</script>">]><svg>&x;</svg>',
    ],
    ['encoded javascript: href', '<svg><a href="&#106;avascript:alert(1)"/></svg>'],
    ['<set> targeting href', '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>'],
    ['protocol-relative href', '<svg><use href="//evil.example/x.svg#a"/></svg>'],
    ['CSS @import url() in <style>', '<svg><style>@import url(https://evil.example/x.css);</style></svg>'],
    ['CSS url() in a style attribute', '<svg><rect style="fill:url(https://evil.example/x.png)"/></svg>'],
    ['namespace-prefixed <s:foreignObject>', '<svg xmlns:s="urn:x"><s:foreignObject/></svg>'],
    ['XHTML <iframe src=javascript:>', '<svg><iframe src="javascript:alert(1)"></iframe></svg>'],
    ['UTF-16LE with a BOM', Buffer.from('﻿<svg onload="x()"/>', 'utf16le')],
  ];
  for (const [label, src] of bypasses) {
    const bytes = Buffer.isBuffer(src) ? src : Buffer.from(src);
    assert.match(logoFileProblem('programs/a.svg', bytes)!, /scripts, event handlers or external links/, label);
  }
  // A same-document fragment href is still allowed.
  assert.equal(
    logoFileProblem('programs/a.svg', Buffer.from('<svg><use href="#a"/><symbol id="a"/></svg>')),
    null,
  );
});

test('C5: a requirement todo is a short lowercase phrase: at most 40 characters, no trailing punctuation or links', async () => {
  const { SubmissionRequirement } = await import('./program-file');
  const req = { key: 'live', label: 'Live deployment on Arc mainnet', type: 'url', required: true, from: 'project' };
  assert.equal(SubmissionRequirement.parse({ ...req, todo: 'a live link on Arc mainnet' }).todo, 'a live link on Arc mainnet');
  assert.equal(SubmissionRequirement.parse(req).todo, undefined, 'optional');
  for (const todo of ['a live link on Arc mainnet, deployed and working', 'a live link.', 'A live link', 'see https://x.y', ''])
    assert.equal(SubmissionRequirement.safeParse({ ...req, todo }).success, false, todo);
  // Arc's live item reads as the spec gives it.
  const arc = ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/arc-microgrants.json'), 'utf8')));
  assert.equal(arc.submission_requirements.find((r) => r.key === 'live_deployment_url')?.todo, 'a live link on Arc mainnet');
});

test('C5 carry: requiredWithoutTodo names required items with no todo; optional items and committed files pass', () => {
  const req = (key: string, required: boolean, todo?: string) => ({
    key, label: key, type: 'text' as const, required, from: 'project' as const, ...(todo ? { todo } : {}),
  });
  assert.deepEqual(
    requiredWithoutTodo({ submission_requirements: [req('a', true, 'a thing'), req('b', true), req('c', false)] }),
    ['b'],
  );
  for (const f of readdirSync(join(import.meta.dirname, '../../../../programs')).filter((f) => f.endsWith('.json'))) {
    const p = ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', f), 'utf8')));
    assert.deepEqual(requiredWithoutTodo(p), [], f);
  }
});

// ---- v2.8 Task 6: the EarnKit rating, any_chain, Avalanche, no Optimism ----

test('v2.8 Ruling 12: an EarnKit rating is Easy only, with no basis (strict)', () => {
  const base = baseProgram();
  const source_url = 'https://e/program';
  const rated = ProgramFile.parse({ ...base, difficulty_override: { level: 'Easy', rated_by: 'earnkit', source_url } });
  assert.deepEqual(rated.difficulty_override, { level: 'Easy', rated_by: 'earnkit', source_url });
  assert.equal(ProgramFile.safeParse({ ...base, difficulty_override: { level: 'Hard', rated_by: 'earnkit', source_url } }).success, false);
  assert.equal(
    ProgramFile.safeParse({ ...base, difficulty_override: { level: 'Easy', rated_by: 'earnkit', basis: 'x', source_url } }).success,
    false,
  );
});

test('v2.8 Ruling 11: an estimate override parses', () => {
  const o = { level: 'Hard', estimate: true, basis: 'a16z publishes no acceptance figures', source_url: 'https://e/faq' };
  assert.deepEqual(ProgramFile.parse({ ...baseProgram(), difficulty_override: o }).difficulty_override, o);
});

test('v2.8 Ruling 13: chains need one entry unless any_chain, and any_chain lists none', () => {
  const base = baseProgram();
  assert.equal(ProgramFile.safeParse({ ...base, chains: [] }).success, false);
  const any = ProgramFile.parse({ ...base, chains: [], any_chain: true });
  assert.equal(any.any_chain, true);
  assert.deepEqual(any.chains, []);
  assert.equal(ProgramFile.parse(base).any_chain, false);
  const both = ProgramFile.safeParse({ ...base, chains: ['base'], any_chain: true });
  assert.equal(both.success, false);
  assert.match(JSON.stringify(both.error!.issues), /any_chain programs list no chains/);
});

test('v2.8 Ruling 15: Optimism programs are refused by source_url or submission_url host', () => {
  const base = baseProgram();
  for (const p of [
    { ...base, source_url: 'https://atlas.optimism.io/x' },
    { ...base, submission_url: 'https://optimism.io/apply' },
  ]) {
    const r = ProgramFile.safeParse(p);
    assert.equal(r.success, false);
    assert.match(JSON.stringify(r.error!.issues), /Optimism programs are not listed/);
  }
  // A look-alike host is not Optimism.
  assert.equal(ProgramFile.safeParse({ ...base, source_url: 'https://notoptimism.io/x' }).success, true);
});

test('v2.8 Ruling 14: avalanche is a chain', () => {
  assert.deepEqual(ProgramFile.parse({ ...baseProgram(), chains: ['avalanche'] }).chains, ['avalanche']);
});

test('v2.8 fix round 1: the Optimism rule never touches Base or a committed program', async () => {
  const { isOptimismUrl } = await import('./program-file');
  for (const u of ['https://docs.base.org', 'https://www.base.org/build', 'https://paragraph.com/@grants.base.eth/x'])
    assert.equal(isOptimismUrl(u), false, u);
  const dir = join(import.meta.dirname, '../../../../programs');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    assert.equal(isOptimismUrl(p.source_url) || isOptimismUrl(p.submission_url), false, f);
  }
  assert.equal(isOptimismUrl('https://OPTIMISM.IO/x'), true);
  assert.equal(isOptimismUrl('https://retrofunding.optimism.io'), true);
});

test('v2.8 Ruling C5: investment defaults to false; the speedrun file sets it', () => {
  assert.equal(ProgramFile.parse(baseProgram()).investment, false);
  const sr = ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/a16z-speedrun.json'), 'utf8')));
  assert.equal(sr.investment, true);
});

// ---- v2.8 Task 9: field kinds, guidance overrides, judging (Part D, Ruling 9 (plan)) ----

test('v2.8 Part D: kind, guidance, max_chars and judging parse; bad values fail', () => {
  const base = baseProgram();
  const withReq = (patch: Record<string, unknown>) => ({
    ...base,
    submission_requirements: [{ ...base.submission_requirements[0], ...patch }, ...base.submission_requirements.slice(1)],
  });
  const source_url = 'https://e/program';
  assert.equal(ProgramFile.parse(withReq({ kind: 'traction' })).submission_requirements[0].kind, 'traction');
  assert.equal(ProgramFile.safeParse(withReq({ kind: 'bogus' })).success, false);
  assert.equal(ProgramFile.safeParse(withReq({ guidance: { questions: ['a?', 'b?'], source_url } })).success, true);
  assert.equal(ProgramFile.safeParse(withReq({ guidance: { questions: ['a?', 'b?', 'c?'], source_url } })).success, false);
  assert.equal(ProgramFile.safeParse(withReq({ guidance: { judges: 'x' } })).success, false, 'source_url is required');
  assert.equal(ProgramFile.safeParse(withReq({ guidance: { judges: 'x'.repeat(141), source_url } })).success, false);
  assert.equal(ProgramFile.safeParse(withReq({ max_chars: 280 })).success, true);
  assert.equal(ProgramFile.safeParse(withReq({ max_chars: 0 })).success, false);
  const criterion = { text: 'Technical credibility' };
  const judged = (c: unknown) => ProgramFile.safeParse({ ...base, judging: { criteria: [c], source_url } }).success;
  assert.equal(judged(criterion), true);
  assert.equal(ProgramFile.safeParse({ ...base, judging: { criteria: Array(6).fill(criterion), source_url } }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, judging: { criteria: [], source_url } }).success, false);
  // C13: no keyword lists; a fix is hand-written as field kind + what it needs + the exact thing to add.
  assert.equal(judged({ ...criterion, words: ['contract'] }), false);
  const fix = { kind: 'solution', needs: 'link', add: 'link the contract on the Arc explorer' };
  assert.equal(judged({ ...criterion, fix }), true);
  assert.equal(judged({ ...criterion, fix: { ...fix, kind: 'bogus' } }), false);
  assert.equal(judged({ ...criterion, fix: { ...fix, needs: 'word' } }), false);
  assert.equal(judged({ ...criterion, fix: { ...fix, add: 'Link the contract' } }), false, 'lowercase start');
  assert.equal(judged({ ...criterion, fix: { ...fix, add: 'link the contract.' } }), false, 'no final period');
});

test('v2.8 Ruling 9: requirementsWithoutKind lists keys without a kind; every committed file has one on each', () => {
  const r = (key: string, kind?: string) => ({ key, label: key, type: 'text' as const, required: false, from: 'project' as const, ...(kind ? { kind: kind as 'other' } : {}) });
  assert.deepEqual(requirementsWithoutKind({ submission_requirements: [r('a', 'other'), r('b'), r('c')] }), ['b', 'c']);
  for (const f of readdirSync(join(import.meta.dirname, '../../../../programs')).filter((f) => f.endsWith('.json'))) {
    const p = ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', f), 'utf8')));
    assert.deepEqual(requirementsWithoutKind(p), [], f);
  }
});

// ---- v2.8 Task 10, Rulings 8 and 27 (plan): submit_host, submit_api and the prefilled form.
const programJson = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', `${name}.json`), 'utf8'));
const issues = (p: unknown) => {
  const r = ProgramFile.safeParse(p);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

test('10.10 the committed Base file carries its Google form: full viewform link, requirement keys, entry ids', () => {
  const base = ProgramFile.parse(programJson('base-builder-grants'));
  assert.ok(base.form);
  assert.match(base.form.url, /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/);
  assert.equal(base.form.sign_in, false);
  const keys = base.submission_requirements.map((r) => r.key);
  for (const [k, v] of Object.entries(base.form.fields)) {
    assert.ok(keys.includes(k), k);
    assert.match(v, /^entry\.\d+$/);
  }
  assert.equal(base.submit_api, false);
});

test('10.10 form: https, requirement keys only, never a forms.gle link; submit_api only on an agent-API host', () => {
  const base = programJson('base-builder-grants');
  assert.deepEqual(issues(base), []);
  assert.ok(issues({ ...base, form: { ...base.form, url: 'http://docs.google.com/forms/d/e/1FAIpQ/viewform' } }).length > 0, 'https');
  assert.ok(issues({ ...base, form: { ...base.form, fields: { nope: 'entry.1' } } }).includes('form.fields key "nope" is not a submission requirement key'));
  assert.ok(issues({ ...base, form: { ...base.form, url: 'https://forms.gle/urqjBJYJjR6Vqqre6' } }).includes('form.url must be the full viewform link'));
  assert.ok(issues({ ...base, form: { ...base.form, url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform?usp=send_form' } }).length > 0, 'no query string');
  assert.ok(issues({ ...base, form: { ...base.form, fields: { email: 'emailAddress' } } }).includes('form.fields.email must be "entry.<number>"'));
  // A form on a host that isn't a Google, Airtable or Tally form.
  const arc = programJson('arc-microgrants');
  assert.ok(issues({ ...arc, form: { url: 'https://tally.so/r/abc', fields: {}, sign_in: false, read_at: '2026-10-07' } }).length > 0);
  // Tally on a Tally host is fine.
  assert.deepEqual(issues({ ...arc, submission_url: 'https://tally.so/r/abc', form: { url: 'https://tally.so/r/abc', fields: {}, sign_in: false, read_at: '2026-10-07' } }), []);
  // submit_api only where the platform has an agent API.
  assert.ok(issues({ ...arc, submit_api: true }).some((m) => m.startsWith('submit_api is only for a host with an agent API')));
  assert.deepEqual(issues({ ...arc, submission_url: 'https://superteam.fun/earn/listing/x', submit_api: true }), []);
  assert.deepEqual(issues({ ...arc, submit_host: 'gap.karmahq.xyz', submit_api: true }), []);
  assert.ok(issues({ ...arc, submit_host: 'https://dorahacks.io' }).length > 0, 'a bare host');
});
