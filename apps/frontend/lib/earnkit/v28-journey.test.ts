import './fixtures/no-network-checks';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { getProgramRow, listPrograms, upsertProgram } from './programs';
import { guideText, programGuide } from './guide';
import { moneyText, openMoneyUsd } from './stats';
import { handlers } from './tools';
import { tokenLineFor } from './token-gate';
import { TECHNICAL_TERMS, type TokenFlowDeps } from './token-launch';
import { syncOutcomeFile } from './outcomes';
import { normalizeRepoUrl } from './campaigns';

/**
 * v2.8 end to end (Task 12, spec Testing "Journey"): a builder with no repo picks Arc, answers the
 * coach's questions, gets a draft and the pre-submit check, says yes to the builder bonus and token
 * (token launched), gets a copy-paste kit, records the entry, sees Also qualifies for Base (a
 * prefilled link there), and later gets a win alert from a sourced outcome.
 *
 * Real program files, a real database (its own throwaway one, as v27-journey.test.ts: other DB-gated
 * files run in parallel and change what "What can I earn?" shows). Fakes for tokens.fun (the deploy
 * records what the real one would) and GitHub (the token gate and the repo-facts cache). No network,
 * no broadcast.
 */

const localDb = (() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
})();
const dbTest = {
  skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres',
};

/** Copied from copy-review.test.ts (it lives in a test file): human-facing "coin"/"coins". */
function coinWords(text: string): string[] {
  const stripped = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\/\S*/g, ' ')
    .replace(/\b\w*_\w*\b/g, ' ')
    .replace(/\b[a-z]+[A-Z]\w*\b/g, ' ');
  return stripped.match(/\bcoins?\b/gi) ?? [];
}

const PROGRAMS_DIR = join(import.meta.dirname, '../../../../programs');
const SCHEMA = join(import.meta.dirname, '../../db/schema.sql');
const FAR = '2099-01-01T00:00:00Z';
const sharedUrl = process.env.DATABASE_URL;
const journeyDb = `earnkit_v28_journey_${process.pid}`;

before(async () => {
  if (!sharedUrl || !localDb) return;
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
    await admin.unsafe(`CREATE DATABASE ${journeyDb}`);
  } finally {
    await admin.end();
  }
  const url = new URL(sharedUrl);
  url.pathname = `/${journeyDb}`;
  const fresh = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await fresh.unsafe(readFileSync(SCHEMA, 'utf8'));
  } finally {
    await fresh.end();
  }
  // db.ts connects on first use, so every read below goes to the journey's own database.
  process.env.DATABASE_URL = url.toString();
});

after(async () => {
  if (!sharedUrl || !localDb) return;
  await sql().end();
  process.env.DATABASE_URL = sharedUrl;
  const admin = postgres(sharedUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${journeyDb}`);
  } finally {
    await admin.end();
  }
});

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>) {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

type Reply = Record<string, unknown> & { show_to_builder: string };

/** Base as a second program after Arc (Task 9's `first` rule: the bank covered none of these). */
const BASE_QUESTIONS = [
  // Ruling C25: the heading counts every item shown, the bullet included.
  "Base Builder Grant Program: 4 quick questions, then I'll write your application.",
  '1. Who has used TipJar so far?',
  '2. What will you ship in the next 3 months? And who is building TipJar with you?',
  '3. Your full name, email, X and Telegram?',
  // v2.8.1 §C12: the Loom demo and the Builder Code are asked in this first round.
  '- A Loom product demo, how it makes money today, your Base Builder Code, your main challenge right now and the credits you want?',
].join('\n');


/** v2.10 item 3: the first prepare for a program starts with its guide; returns what follows it. */
async function afterGuide(programId: string, text: string) {
  const g = guideText(programGuide(await getProgramRow(programId)));
  assert.ok(text.startsWith(`${g}\n\n`), text);
  return text.slice(g.length + 2);
}

test('v2.8 journey: Arc from no repo to a sourced win, through the coach, the confirmation, the kit and Also qualifies', dbTest, () =>
  withEnv({ TOKENSFUN_DEPLOY_API_KEY: 'test-key', EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'v28-journey-secret' }, async () => {
    const replies: [string, unknown][] = [];
    const keep = <T>(label: string, r: T) => {
      replies.push([label, r]);
      return r;
    };

    // 1. Every real program file, as programs:sync loads it. Curated programs are made active with a
    //    2099 deadline so the journey never depends on real dates; campaign files keep their status.
    const files = readdirSync(PROGRAMS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const raw = JSON.parse(readFileSync(join(PROGRAMS_DIR, f), 'utf8'));
      if (!raw.campaign) Object.assign(raw, { status: 'active', ends_at: raw.ends_at ? FAR : raw.ends_at });
      await upsertProgram(ProgramFile.parse(raw));
    }
    const arc = ProgramFile.parse(JSON.parse(readFileSync(join(PROGRAMS_DIR, 'arc-microgrants.json'), 'utf8')));
    const base = ProgramFile.parse(JSON.parse(readFileSync(join(PROGRAMS_DIR, 'base-builder-grants.json'), 'utf8')));
    const stamp = `${process.pid}-${Date.now()}`;
    const [{ id: inst }] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash) VALUES (${`v28-journey-${stamp}`}) RETURNING id`;

    // The fakes: tokens.fun's deploy (records what the real one records) and GitHub (the token gate
    // reads the repo and its earnkit.txt line). The repo-facts cache says the repo is on Arc and Base.
    const repo = `https://github.com/alice/tipjar-${stamp}`;
    const deploys: string[] = [];
    const tokenDeps = {
      available: () => true,
      limit: async () => {},
      check: async () => true,
      gate: {
        repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
        owner: async () => ({ status: 'ok' as const, text: tokenLineFor(inst, repo)! }),
        screen: async () => {},
      },
      deploy: async (d: { projectId: number; name: string; symbol: string; creatorWallet: string }) => {
        deploys.push(d.creatorWallet);
        const url = `https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`;
        await sql()`UPDATE projects SET token_url = ${url}, token_status = 'launched', coin_address = ${'0x' + randomBytes(20).toString('hex')},
          coin_launched_at = now(), token_name = ${d.name}, token_symbol = ${d.symbol}, token_repo_key = ${normalizeRepoUrl(repo)}
          WHERE id = ${d.projectId}`;
        return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: url };
      },
    } as unknown as TokenFlowDeps;
    const ctx = {
      installationId: inst,
      roundPools: async () => new Map(),
      tokenDeps,
      entryDeps: { fetchProof: async () => `<html><a href="${repo}">TipJar</a></html>` },
    };
    await sql()`
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES (
        ${repo.replace('https://github.com/', '').toLowerCase()}, now(),
        ${sql().json({ arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' }, base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } })},
        '{}')`;

    // 2. "What can I earn?" with no repo: the open money first, the token line last.
    const list = keep('list_programs', (await handlers.list_programs({ agent_can_build: true, more: true /* v2.10 item 2 */ }, ctx)) as Reply);
    // v2.9 F21: the one money figure over the same open programs.
    const cards = await listPrograms();
    assert.ok(list.show_to_builder.startsWith(`${moneyText(openMoneyUsd(cards))} in prizes open right now.`), list.show_to_builder);
    // v2.10 item 1: one plain bonus line right before the closing offer; no token line.
    assert.match(list.show_to_builder, /\n\nBuilder bonus: no tokens yet, so yours would be first\n\n[^\n]+$/, list.show_to_builder);

    // 3. Arc, with the project only: the coach's questions are the whole screen.
    const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
    const project = { name: 'TipJar', repo_url: repo, live_url: 'https://tipjar.xyz', contracts: ['0xcccccccccccccccccccccccccccccccccccccccc'] };
    const asked = keep('prepare_submission (questions)', (await handlers.prepare_submission({ program_id: 'arc-microgrants', project }, ctx)) as Reply & {
      questions: { keys: string[]; text: string }[];
    });
    // Ruling 26 (plan): at most 3 questions, only for what only the builder can say. Arc's form has
    // one such field (the public profile; the agent drafts the description), so it asks one.
    // v2.8.1 §C11: the wallet is asked with it, in this same round (no wallet is known yet).
    assert.equal(
      // v2.10 item 3: the first prepare for Arc shows its guide first.
      await afterGuide('arc-microgrants', asked.show_to_builder),
      "Arc Microgrants: 1 quick question, then I'll write your application.\n" +
        "1. Your public builder profile? And the wallet for your token's fees and any bonus (0x…)? No wallet yet? Make one at keys.coinbase.com.",
    );
    assert.ok(!('kit' in asked));

    // 4. The agent's draft and the builder's three answers: the draft, at most 3 fixes, then the offer.
    const answers: Record<string, string> = {
      description: 'TipJar lets fans tip creators in USDC on Arc mainnet; 120 creators received 900 tips in the first month.',
      builder_profile: 'https://github.com/alice',
      payout_wallet: W,
    };
    for (const q of asked.questions) for (const k of q.keys) answers[k] ??= `Answer for ${k}`;
    const draft = keep('prepare_submission (draft)', (await handlers.prepare_submission(
      { program_id: 'arc-microgrants', project, answers, coach_asked: true },
      ctx,
    )) as Reply & { ready: boolean; fixes: unknown[]; shown_wallet?: string });
    assert.equal(draft.ready, true);
    assert.ok(draft.show_to_builder.startsWith('|'), draft.show_to_builder);
    assert.ok(draft.fixes.length <= 3);
    assert.match(draft.show_to_builder, /\n\nReady\. Yes submits your entry and launches \$/);
    // v2.8.1 §C11: the wallet from the coach round is on the offer; the confirmation is a single yes.
    assert.match(draft.show_to_builder, / Wallet: 0x1581…b9a3\. yes \/ skip the token$/);
    assert.equal(draft.shown_wallet, W);
    assert.ok(!('kit' in draft));

    // 5. "Yes, go" with the wallet: the token launches (the fake deploy), then the copy-paste kit
    //    (DoraHacks: the builder pastes each answer), every Arc field in it. The agent echoes shown_wallet.
    const confirmed = keep('confirm_entry (go)', (await handlers.confirm_entry(
      { program_id: 'arc-microgrants', project, answers, builder_confirmed: true, decision: 'go', wallet: draft.shown_wallet },
      ctx,
    )) as Reply & { project_id: number; token: { status: string }; kit: { mode: string; show_to_builder: string } });
    assert.equal(confirmed.token.status, 'launched');
    assert.equal(confirmed.kit.mode, 'copy_paste');
    for (const r of arc.submission_requirements) assert.ok(confirmed.kit.show_to_builder.includes(r.label), r.label);
    assert.deepEqual(deploys, [W]);

    // 6. The builder submitted on DoraHacks: the same entry; Also qualifies lists Base. (v2.9 T12,
    //    G15 M1: Base needs real users, so it is offered once the builder has said TipJar has them.)
    await handlers.tell_earnkit({ repo_facts: [{ repo: repo.replace('https://github.com/', ''), has_users: true }] }, ctx);
    const recorded = keep('record_submission', (await handlers.record_submission(
      {
        program_id: 'arc-microgrants',
        project,
        submission_data: answers,
        payout_wallet: W,
        builder_submitted: true,
        external_submission_url: 'https://dorahacks.io/buidl/31337',
      },
      ctx,
    )) as Reply & { project_id: number; also_qualifies?: { id: string; title: string }[] });
    assert.equal(recorded.project_id, confirmed.project_id);
    assert.ok(recorded.also_qualifies?.some((r) => r.title === 'Base Builder Grant Program'), JSON.stringify(recorded.also_qualifies));
    // v2.10 item 1: Also qualifies has no bonus sentences; the reply has at most one bonus line.
    assert.ok(recorded.show_to_builder.endsWith('Say "enter it here too" for any of them.'), recorded.show_to_builder);
    assert.doesNotMatch(recorded.show_to_builder, /rides on|moves to your next entry/);
    assert.ok((recorded.show_to_builder.match(/Builder bonus:/g)?.length ?? 0) <= 1, recorded.show_to_builder);

    // 7. "Enter it here too" for Base: one round, pinned. (The brief's "at most 1" holds only once
    //    the bank answers something the coach would ask: Task 9's `first` rule, accepted in its
    //    re-review. Arc banked a description and a profile link, which Base's questions don't
    //    cover, so Base asks 3 and a bullet.) "Go" there launches nothing (one token per repo) and
    //    the kit is Base's prefilled Google form link.
    const baseAsked = keep('prepare_submission (Base)', (await handlers.prepare_submission({ program_id: 'base-builder-grants', project }, ctx)) as Reply & {
      questions?: { keys: string[]; bullet?: boolean }[];
    });
    // v2.10 item 3: the first prepare for Base shows its guide first.
    assert.equal(await afterGuide('base-builder-grants', baseAsked.show_to_builder), BASE_QUESTIONS);
    assert.equal(baseAsked.questions?.filter((q) => !q.bullet).length, 3);
    assert.equal(baseAsked.questions?.filter((q) => q.bullet).length, 1);
    assert.ok(!('kit' in baseAsked));
    const baseAnswers: Record<string, string> = {
      full_name: 'Alice Doe',
      email: 'alice@example.com',
      x_handle: '@alice',
      telegram: '@alice',
      project_name_description: 'TipJar: tips for creators in USDC.',
      founding_team: 'Alice, solo builder; shipped two payment apps.',
      demo_loom: 'https://loom.com/share/abc',
      contract_address: '0x1111111111111111111111111111111111111111',
      track: base.submission_requirements.find((r) => r.key === 'track')!.options![0],
      usage_numbers: '120 creators got 900 tips in the first month.',
      revenue: '1% fee on each tip.',
      gtm_plan: 'Recurring tips by March; 500 creators by June.',
      builder_code: 'bc_tipjar',
      primary_challenge: 'User acquisition',
      credits: 'None',
    };
    const baseGo = keep('confirm_entry (Base go)', (await handlers.confirm_entry(
      { program_id: 'base-builder-grants', project, answers: baseAnswers, builder_confirmed: true, decision: 'go', wallet: W },
      ctx,
    )) as Reply & { token?: { status: string }; kit: { mode: string; prefilled_url?: string } });
    assert.equal(deploys.length, 1, 'one token per repo: no second launch');
    assert.notEqual(baseGo.token?.status, 'launched');
    assert.equal(baseGo.kit.mode, 'prefilled_link');
    assert.ok(baseGo.kit.prefilled_url?.startsWith(base.form!.url), baseGo.kit.prefilled_url);

    // 8. Later: the weekly routine commits Arc's announcement; the next check leads with the win.
    const synced = await syncOutcomeFile({
      program_id: 'arc-microgrants',
      round_label: 'Arc Microgrants 2026',
      source_url: 'https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq',
      // Today: an announcement only labels entries made by its day (never a date the clock passes).
      captured_at: new Date().toISOString().slice(0, 10),
      complete: true,
      // The round's window (final review I4, re-review I-A): from Arc's start to today, so today's entry is in it.
      entries_from: '2026-01-01',
      entries_until: new Date().toISOString().slice(0, 10),
      results: [
        { repo: repo.replace('https://', ''), result: 'won', prize_usd: 500 },
        { name: 'Someone Else', result: 'won', prize_usd: 500 },
      ],
    });
    assert.deepEqual(synced, { matched: 1, unmatched: 1, others: 0 });
    const later = keep('list_programs (later)', (await handlers.list_programs({ agent_can_build: true, more: true /* v2.10 item 2 */ }, ctx)) as Reply & {
      since_you_last_checked?: string;
    });
    const since = later.since_you_last_checked ?? later.show_to_builder;
    assert.match(since, /you won \$500 in Arc Microgrants with TipJar/);
    assert.match(later.show_to_builder, /^Since you last checked: you won \$500 in Arc Microgrants with TipJar/);

    // 8b. v2.8.1 §F19: "40%" exactly once in the whole Arc entry flow (first message, coach, draft and
    //     offer, launch and kit, "Entered in…" and Also qualifies): in the offer's Yes line. Never on
    //     the later program (Base). The bonus note at most once per reply.
    const builderText = (r: unknown) => [(r as Reply).show_to_builder, (r as { kit?: { show_to_builder?: string } }).kit?.show_to_builder ?? ''].join('\n');
    const forty = (labels: string[]) =>
      replies.filter(([l]) => labels.includes(l)).reduce((n, [, r]) => n + (builderText(r).match(/40%/g)?.length ?? 0), 0);
    assert.equal(forty(['list_programs', 'prepare_submission (questions)', 'prepare_submission (draft)', 'confirm_entry (go)', 'record_submission']), 1);
    assert.equal(replies.filter(([, r]) => /40%/.test(builderText(r))).map(([l]) => l).join(), 'prepare_submission (draft)');
    assert.match(draft.show_to_builder, /Yes submits your entry and launches \$[A-Z0-9]+ \(TipJar\): 40% of its fees to you, plus the builder bonus\./);
    for (const [label, r] of replies) {
      assert.ok((builderText(r).match(/builder bonus (rides|counts|is in)/gi)?.length ?? 0) <= 1, label);
      assert.doesNotMatch(builderText(r), /no builder bonus:|don't add to it/, label);
    }

    // 9. Every reply: no em dash, no Clanker, never "coin"; builder text names no tool, field or file.
    for (const [label, r] of replies) {
      const all = JSON.stringify(r);
      assert.doesNotMatch(all, /—/, label);
      assert.doesNotMatch(all, /clanker/i, label);
      const shown = (r as Reply).show_to_builder;
      assert.deepEqual(coinWords(shown), [], label);
      assert.doesNotMatch(shown, TECHNICAL_TERMS, label);
      // The kit's own text: never "coin" (field labels are expected there, so no tool-name scan).
      const kit = (r as { kit?: { show_to_builder?: string } }).kit?.show_to_builder;
      if (kit) assert.deepEqual(coinWords(kit), [], `${label} kit`);
    }
  }));
