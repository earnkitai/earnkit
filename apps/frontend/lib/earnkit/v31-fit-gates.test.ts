import './fixtures/no-network-checks';
import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { walletOffered } from './fixtures/wallet-step';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { EARNKIT_FIT_REPO, EARNKIT_KEY, EARNKIT_PRODUCT, EARNKIT_REPO_FIT, committedFacts, earnkitRepoFit } from './fixtures/earnkit-repo';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { fitGate, fitRepoOf, newProgramOf, repoCanWin } from './alerts';
import { canApply, layout, qualifies, type Card, type YourRepos } from './present';
import { MatchProjectsInput, SKIP_REASONS, matchProjects, type MatchDeps } from './match-projects';

/**
 * v3.1 F1: the owner's repo (earnkitai/earnkit) gets its program fits, and investments join the fit lines. On
 * production the owner's ranked reply said "No open program fits EarnKit yet." while Base Builder Grants (Base,
 * rolling) and Alliance ALL19 (any chain, an investment, closes Nov 18) should be candidates.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-fit-gates-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await sql().end();
});
const RUN = String(process.pid % 100000);

/** A committed program file as an open curated row (alerts.ts openCuratedRows). */
const row = (name: string) => {
  const f = ProgramFile.parse(committedProgram(name));
  return {
    ...f, any_chain: f.any_chain === true, investment: f.investment === true, campaign: null, tag: f.tag ?? null,
    ends_at: f.ends_at ? new Date(f.ends_at) : null, starts_at: f.starts_at ? new Date(f.starts_at) : null,
    opened_at: new Date('2026-10-01T00:00:00Z'), past_rounds: f.past_rounds ?? [], match_floor: null, match_precision: null,
  } as unknown as Parameters<typeof newProgramOf>[0];
};
/** A committed program file as find's card (programs.ts programCard's matching fields). */
const card = (name: string): Card => {
  const f = ProgramFile.parse(committedProgram(name));
  return {
    id: f.id, title: f.title, summary: f.summary, tag: f.tag ?? null, each_time: f.each_time, ends_at: f.ends_at ? new Date(f.ends_at) : null,
    max_award_usd: f.max_award_usd ?? null, chains: f.chains, any_chain: f.any_chain === true, investment: f.investment === true,
  };
};

test('the EarnKit fixture: product tier and good odds from productScore and productOdds, under 50 transactions (1 to 3 users)', () => {
  assert.equal(EARNKIT_PRODUCT.tier, 'product');
  assert.equal(EARNKIT_PRODUCT.odds, 'good');
  assert.ok((EARNKIT_FIT_REPO.tx_count ?? 0) < 50);
});

test('(a) which gate drops Base Builder Grants for an EarnKit-like repo', () => {
  const gate = fitGate(newProgramOf(row('base-builder-grants')), EARNKIT_FIT_REPO, { apply: true });
  assert.equal(gate, null, 'gate: ' + gate);
});

test('(b) which gate drops Alliance ALL19 (any chain, investment)', () => {
  const gate = fitGate(newProgramOf(row('alliance-all19')), EARNKIT_FIT_REPO, { apply: true });
  assert.equal(gate, null, 'gate: ' + gate);
});

test('(b2) alerts keep their precision: neither program is alerted for this repo (a nag needs a close, not-Hard row)', () => {
  assert.equal(fitGate(newProgramOf(row('base-builder-grants')), EARNKIT_FIT_REPO), 'close');
  assert.equal(fitGate(newProgramOf(row('alliance-all19')), EARNKIT_FIT_REPO), 'close');
});

test('(c) find path: layout() over EARNKIT_REPO_FIT keeps both rows and canApply is true for both', () => {
  const repos: YourRepos = { checked: 1, scored: 1, fits: [EARNKIT_REPO_FIT] };
  const { rows } = layout({ cards: [card('base-builder-grants'), card('alliance-all19')], repos, entries: [] });
  assert.deepEqual(rows.map((r) => r.card.id).sort(), ['alliance-all19', 'base-builder-grants']);
  for (const r of rows) assert.equal(canApply(r), true, `${r.card.id}: ${r.odds} ${r.low_reason}`);
  // The money "you qualify for" keeps its rule: a row still waiting on measured users is never counted.
  for (const r of rows) assert.equal(qualifies(r), false, r.card.id);
});

test('(c2) find path: a row waiting on something else than users, or a repo with low odds, is never an apply candidate', () => {
  const low = { ...EARNKIT_REPO_FIT, product: { ...EARNKIT_PRODUCT, odds: 'low' as const, low_reason: 'live link not loading' } };
  const { rows } = layout({ cards: [card('base-builder-grants'), card('alliance-all19')], repos: { checked: 1, fits: [low] }, entries: [] });
  for (const r of rows) assert.equal(canApply(r), false, r.card.id);
});

test('(d) repoCanWin equals fitGate === null for every committed program and both fixtures', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  assert.ok(names.length > 5);
  const repos = [EARNKIT_FIT_REPO, fitRepoOf(EARNKIT_REPO_FIT, null)!];
  assert.ok(repos[1], 'the RepoFit converts');
  for (const name of names) {
    const p = newProgramOf(row(name));
    for (const r of repos)
      for (const o of [{}, { apply: true }]) assert.equal(repoCanWin(p, r, o), fitGate(p, r, o) === null, `${name} ${JSON.stringify(o)}`);
  }
});

test('(d2) apply candidates never take a program that counts only new work', () => {
  const p = newProgramOf({ ...row('base-builder-grants'), existing_work: 'new_work_only' } as Parameters<typeof newProgramOf>[0]);
  assert.equal(fitGate(p, EARNKIT_FIT_REPO, { apply: true }), 'close');
});

// ---- Root cause: the matcher skipped every earnkitai repo as "EarnKit's own repo" ----

const json = (b: unknown, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });
const README = `# EarnKit\n\n${'EarnKit connects builders with capital: programs, a weekly ship log and a public page. '.repeat(30)}`;
const CONTRACT = '0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e';
/** GitHub for earnkitai/earnkit: a repo with a README and a Base mainnet config naming its contract. */
function github(u: URL): Response | undefined {
  const p = u.pathname;
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  if (u.host === 'raw.githubusercontent.com' && p.startsWith(`/${EARNKIT_KEY}/`)) {
    if (p.endsWith('/README.md')) return json(README);
    if (p.endsWith('/hardhat.config.ts')) return json(`networks: { base: { url: 'https://mainnet.base.org', chainId: 8453 } } // ${CONTRACT}`);
    return undefined;
  }
  if (u.host !== 'api.github.com') return undefined;
  if (p === `/repos/${EARNKIT_KEY}`)
    return json({
      name: 'earnkit', full_name: EARNKIT_KEY, html_url: `https://github.com/${EARNKIT_KEY}`, homepage: 'https://earnkit.com',
      default_branch: 'main', created_at: day(60), pushed_at: day(0), fork: false, archived: false, is_template: false,
      private: false, visibility: 'public', owner: { login: 'earnkitai' }, description: 'Money for builders who ship', topics: [],
    });
  if (p.startsWith(`/repos/${EARNKIT_KEY}/git/trees/`))
    return json({ tree: [{ path: 'README.md', type: 'blob', size: README.length }, { path: 'hardhat.config.ts', type: 'blob', size: 120 }, { path: 'package.json', type: 'blob', size: 300 }] });
  if (p === `/repos/${EARNKIT_KEY}/commits`) return json(Array.from({ length: 30 }, (_, i) => ({ sha: `e${i}`, author: null })));
  if (p === '/search/commits') return json({ items: [] });
  return undefined;
}
async function withGitHub<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => github(new URL(String(url))) ?? json({ message: 'Not Found' }, 404)) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}
const deps = (o: Partial<MatchDeps> = {}): MatchDeps => {
  const store = new Map<string, { ok: boolean; checked_at: Date; n?: number | null }>();
  return {
    programs: [committedFacts('base-builder-grants'), committedFacts('alliance-all19')],
    cache: { load: async () => null, save: async () => {} },
    checks: {
      probe: async () => {},
      getCode: async () => '0x6080',
      txCounter: async () => 3,
      cache: { get: async (k) => store.get(k) ?? null, set: async (k, ok, now, extra) => void store.set(k, { ok, checked_at: now, n: extra?.n ?? null }) },
    },
    ...o,
  };
};

test('(root cause) the matcher skips earnkitai/earnkit as EarnKit\'s own repo; proven the builder\'s own (ownEarnkit), it is matched', async () => {
  const input = MatchProjectsInput.parse({ repos: [EARNKIT_KEY] });
  const skipped = await withGitHub(() => matchProjects(input, deps()));
  assert.deepEqual(skipped.fits, []);
  assert.deepEqual(skipped.skipped, [{ name: 'earnkit', reason: SKIP_REASONS.earnkit }]);
  const mine = await withGitHub(() => matchProjects(input, deps({ ownEarnkit: [EARNKIT_KEY] })));
  assert.equal(mine.fits.length, 1, JSON.stringify(mine));
  const [f] = mine.fits;
  assert.equal(f.key, EARNKIT_KEY);
  assert.equal(f.product?.tier, 'product', JSON.stringify(f.product));
  assert.deepEqual(f.verdicts.map((v) => v.program_id).sort(), ['alliance-all19', 'base-builder-grants']);
  assert.deepEqual(mine.skipped ?? [], []);
});

// ---- Through mcpCall: find and score ----

let n = 0;
/** A ranked builder (signed in with X, the repo proven by the App) whose match holds `fit`'s rows for `key`. */
async function rankedBuilder(tag: string, key: string, fitFor: (key: string) => ReturnType<typeof earnkitRepoFit>, onMatch?: (deps: MatchDeps) => void) {
  n++;
  const t = `ek_v31f1_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `f1${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `98${RUN}${n}${tag.length}`, username: handle, name: 'f1', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  // v4.0: setup step 3 answered (this test is about another reply).
  await walletOffered(c.id);
  const matcher = (async (_input: unknown, d: MatchDeps) => {
    onMatch?.(d);
    return { checked: 1, scored: 1, fits: [fitFor(key)] };
  }) as never;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: matcher };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${key}` } } });
  const gid = 7100 + n * 10 + (Number(RUN) % 7);
  // The repo's owner is an org (earnkitai) or another account: the builder is its admin, as the owner is on earnkitai.
  const proved = await installApp({
    builderId: c.id, repoKey: key, login: handle,
    gh: fakeGitHub({ [key]: { id: gid, owner: key.split('/')[0], ownerType: 'Organization', admins: [handle], installation: gid + 1 } }),
  });
  assert.ok(!('notProven' in proved), JSON.stringify(proved));
  // The connect weeks are another task's moment: answered, so they never take the step here.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id };
}
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
/** Task 16: the program the ranked reply names (its apply step or money line): the first of `titles` it holds. */
const named = (s: string, titles: string[]) => titles.find((t) => s.includes(t)) ?? null;
const BASE_TITLE = committedProgram('base-builder-grants').title as string;
const ALLIANCE_TITLE = committedProgram('alliance-all19').title as string;

async function syncTwo() {
  for (const name of ['base-builder-grants', 'alliance-all19']) await upsertProgram(ProgramFile.parse(committedProgram(name)));
}

test('(e) mcpCall find for a ranked builder whose kept match holds both: the reply names one (Task 16), the lead is Base, never "No open program fits"', db, async () => {
  // A fixed day 28 days before Alliance ALL19 closes (Nov 18): within APPLY_WINDOW_DAYS, so it is the Best fit.
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T12:00:00Z') });
  try {
    await syncTwo();
    const b = await rankedBuilder('e', `f1e${RUN}/earnkit`, (k) => earnkitRepoFit([committedFacts('base-builder-grants'), committedFacts('alliance-all19')], k));
    const r = await mcpCall(b.ctx, 'find', {});
    const s = show(r);
    assert.ok(!/No open program fits/.test(s), s);
    // Both matched: Base is the lead (the fit lines' first grant, byRelevance). v3.1 cold read: an investment that takes a
    // company with a full-time team (Alliance) is never offered unprompted, so the apply step is Base's.
    assert.equal((r.reply?.lead as { program_id?: string } | undefined)?.program_id, 'base-builder-grants', s);
    assert.equal(named(s, [ALLIANCE_TITLE, BASE_TITLE]), BASE_TITLE, s);
    assert.match(s, /\nBase Builder Grant Program is still open, up to \$5,000\. I can draft it in a minute\.\nWant me to\?$/, s);
    assert.doesNotMatch(s, /Alliance/, s);
    assert.ok(links(s).length <= 1, s);
    assert.equal(questions(s), 1, s);
    assert.doesNotMatch(s, /—/);
  } finally {
    mock.timers.reset();
  }
});

test('(f) mcpCall score: Base is the lead there too (score reads every open program, so its Best fit may close sooner)', db, async () => {
  await syncTwo();
  const b = await rankedBuilder('f', `f1f${RUN}/earnkit`, (k) => earnkitRepoFit([committedFacts('base-builder-grants'), committedFacts('alliance-all19')], k));
  const r = await mcpCall(b.ctx, 'score', {});
  const s = show(r);
  assert.ok(!/No open program fits/.test(s), s);
  assert.equal(questions(s), 1, s);
  assert.equal((r.reply?.lead as { program_id?: string } | undefined)?.program_id, 'base-builder-grants', s);
});

test('(g) find hands the matcher ownEarnkit only for an EarnKit repo the builder proved with the App', db, async () => {
  let seen: MatchDeps | null = null;
  const b = await rankedBuilder('g', EARNKIT_KEY, (k) => earnkitRepoFit([committedFacts('base-builder-grants')], k), (d) => {
    seen = d;
  });
  seen = null;
  await mcpCall(b.ctx, 'find', {});
  assert.deepEqual((seen as MatchDeps | null)?.ownEarnkit, [EARNKIT_KEY]);
  let other: MatchDeps | null = null;
  const c = await rankedBuilder('h', `f1h${RUN}/earnkit`, (k) => earnkitRepoFit([committedFacts('base-builder-grants')], k), (d) => {
    other = d;
  });
  other = null;
  await mcpCall(c.ctx, 'find', {});
  assert.ok(other, 'matched');
  assert.equal((other as MatchDeps | null)?.ownEarnkit, undefined);
});
