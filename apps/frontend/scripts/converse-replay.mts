/**
 * v4.8 Task 6: the lazy scripts of the target conversation, replayed on a local restored production snapshot, each
 * reply checked by the merge gate (lib/earnkit/fixtures/converse.ts gateFailures). It writes to that database (the
 * builder's path, said parts, an "applied" row), so run it on a throwaway copy of the snapshot, never anything shared.
 *
 *   cd apps/frontend
 *   DATABASE_URL=postgresql://localhost:5432/<snapshot copy> OWN=27 WALK=A npx tsx scripts/converse-replay.mts
 *   DATABASE_URL=postgresql://localhost:5432/<snapshot copy> WALK=B npx tsx scripts/converse-replay.mts
 *   DATABASE_URL=... OWN=27 WALK=R [VARIANT=skip] npx tsx scripts/converse-replay.mts   (a fresh copy for each variant)
 *
 * - A (OWN, the installation): the session opener, then a lazy agent's answer to each reply's structured ask
 *   (fixtures/converse.ts lazyNext over move_up): "sure", the blanks ("just me, nothing raised"), "sent", "ok"; then
 *   silence and a new session two days later.
 * - Refuses: a DATABASE_URL not on localhost; the master snapshot `earnkit_replay` (it writes) unless ALLOW_MASTER=1;
 *   LINK_CHECK or EARNKIT_MODEL_TEST set (the test guard would leave the network open).
 * - B: a fresh signed-out installation in this database: the opener, then "2".
 * - S (OWN, v4.8.1): an agent that never answers: five plain finds in one session, then "what can I apply to"
 *   (`ask: programs`), then one more plain find (the owner's 2026-11-01 dogfood). Exits 1 if its first reply is
 *   not a fresh session.
 * - R (OWN, v4.10): the ready set: find, yes (VARIANT=skip: "skip <last number>"), the codes pushed (simulated, see walkR),
 *   "sent", one more find. The set's one builder-only ask is answered in one message, split by field (ANSWERS; v4.10
 *   final fix I1). Needs a fresh copy per variant.
 * - A, S and R first age the snapshot's live session past SESSION_MS (a note says so), so session 0 is a real opener.
 * - Real work ends a walk's session: a push to the builder's repo (Builder Codes, "Say ok once the change is pushed")
 *   or connecting GitHub needs the builder's own accounts, so the script records it and goes no further there. A help
 *   step's "ok" is played as not done yet (EarnKit re-checks it).
 *
 * No network beyond the local database: the test guard (lib/earnkit/fixtures/test-guard.ts) is loaded first, so the
 * vendor keys (GitHub App, X, Resend, Alchemy, tokens.fun, R2, Anthropic, the deployer) are cleared and every
 * fetch, http(s) request and DNS lookup to a host other than localhost is refused; no-network-checks.ts stubs the
 * link and contract checks (every link loads, every address has code with 0 transactions). The Builder Codes check
 * reads a GitHub that lists no App (404). So GitHub, X, Resend and RPC are never reached: a GitHub read fails as if
 * GitHub were down, and the reply uses what the snapshot already holds. X sign-in gets fake keys, only so the
 * signed-out opener can build its local sign-in link.
 *
 * Prints each turn's input and what the builder sees, then the gate result; exits 1 on any gate failure.
 */
import { isLocalPostgres } from '../lib/earnkit/fixtures/local-postgres.mjs';

const url = process.env.DATABASE_URL ?? '';
if (!isLocalPostgres(url) || !new URL(url).hostname) {
  console.error('Refusing: DATABASE_URL must be a local Postgres on localhost (a restored snapshot copy), never production.');
  process.exit(2);
}
// Task 6 fix round 1 (review 7): the replay writes, so a copy is the default; the master snapshot only on purpose.
if (new URL(url).pathname.replace(/^\//, '') === 'earnkit_replay' && process.env.ALLOW_MASTER !== '1') {
  console.error('Refusing: earnkit_replay is the master snapshot and the replay writes to it. Run on a copy (createdb -T earnkit_replay <copy>), or set ALLOW_MASTER=1.');
  process.exit(2);
}
// The test guard leaves the network open under these two; never here.
for (const name of ['LINK_CHECK', 'EARNKIT_MODEL_TEST'])
  if (process.env[name] !== undefined) {
    console.error(`Refusing: ${name} is set, and it would open the network. Unset it.`);
    process.exit(2);
  }
delete process.env.LINK_CHECK;
delete process.env.EARNKIT_MODEL_TEST;
const walk = (process.env.WALK ?? 'A').toUpperCase();
if (walk !== 'A' && walk !== 'B' && walk !== 'S' && walk !== 'R') {
  console.error('WALK must be A, B, S or R.');
  process.exit(2);
}

await import('../lib/earnkit/fixtures/test-guard');
await import('../lib/earnkit/fixtures/no-network-checks');
Object.assign(process.env, { X_CLIENT_ID: 'replay-x-id', X_CLIENT_SECRET: 'replay-x-secret' });
process.env.EARNKIT_AUTH_SECRET ??= 'converse-replay-secret';
process.env.EARNKIT_URL ??= 'https://earnkit.com';

const { sql } = await import('../lib/earnkit/db');
const { conversation, gateFailures, lazyNext, transcript } = await import('../lib/earnkit/fixtures/converse');
const { saveInstallation, connectInstallation } = await import('../lib/earnkit/installations');
const { fakeGitHub } = await import('../lib/earnkit/fixtures/fake-github');
const { appEnv } = await import('../lib/earnkit/fixtures/app-install');
const { BUILDER_CODES_SUFFIX } = await import('../lib/earnkit/builder-code');
const { PUSHED_ASK } = await import('../lib/earnkit/bench-find');
const { SESSION_MS } = await import('../lib/earnkit/conversation');
type Reply = import('../lib/earnkit/fixtures/converse').Reply;
type Turn = import('../lib/earnkit/fixtures/converse').Turn;

const DAY = 86_400_000;
const BLANKS = 'just me, nothing raised';
/** v4.10 final fix (I1): the lazy builder's one reply to the ready set's ask, as the agent splits it by field kind. */
const ANSWERS: Record<string, string> = {
  team: 'just me', raised: 'nothing raised', traction: 'no users yet', demo_video: 'no demo yet',
  // v4.10.1 Task 1: the contact item (one per slot) and the fields asked under their own key.
  'contact.name': 'Jenil T', 'contact.email': 'replay@example.com', 'contact.telegram': '@replay',
  'other:revenue': 'no revenue yet', 'other:primary_challenge': 'User acquisition', 'other:credits': 'no credits needed yet',
  'other:contract_address': 'no contract on Base yet',
};
const replies: Reply[] = [];
const notes: string[] = [];
/** The builder's own project name and handle: the only subjects "{name} is live" is proof for (gateFailures names). */
const names: string[] = [];

const moveUpOf = (r: Reply) => (r.reply?.move_up as { kind?: string } | undefined) ?? null;

async function own(id: number) {
  const [r] = await sql()<{ b: number | null; s: boolean }[]>`SELECT builder_id AS b, shared_client AS s FROM installations WHERE id = ${id}`;
  if (!r) throw new Error(`no installation ${id} in this database`);
  return { installationId: r.b ?? id, ownInstallationId: id, sharedClient: r.s };
}

/**
 * v4.8.1 final fix 1: the snapshot holds the owner's live session (a dogfood minutes before the snapshot), and
 * sessionOf would carry it on. Age its said.at past SESSION_MS (this copy only; the script refuses anything else), so
 * session 0 is a real opener, and say so in the transcript.
 */
async function freshSession(builderId: number) {
  const aged = await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('said', jsonb_build_object(
      'at', ${new Date(Date.now() - SESSION_MS - 60_000).toISOString()}::text, 'keys', COALESCE(standing_seen->'said'->'keys', '[]'::jsonb)))
    WHERE builder_id = ${builderId} AND standing_seen->'said'->>'at' > ${new Date(Date.now() - SESSION_MS).toISOString()} RETURNING 1`;
  if (aged.length) notes.push("the snapshot was mid-session (the owner's live session); it was aged so session 0 starts fresh");
}

async function walkA() {
  const id = Number(process.env.OWN ?? 27);
  const ctx = await own(id);
  const [me] = await sql()<{ name: string | null; handle: string | null }[]>`
    SELECT p.name, f.x_handle AS handle FROM builder_profiles f LEFT JOIN builder_projects p ON p.builder_id = f.builder_id AND lower(p.project_key) = lower(f.main_project_key)
    WHERE f.builder_id = ${ctx.installationId}`;
  names.push(...[me?.name, me?.handle].filter((x): x is string => Boolean(x)));
  await freshSession(ctx.installationId);
  const turn = conversation(ctx as never, { builderId: ctx.installationId });
  const play = async (t: Turn) => {
    const r = await turn(t);
    if (r) replies.push(r);
    return r;
  };
  let r = await play({ find: {} });
  // The first session: at most 10 lazy replies (lazyNext: each reply's own structured ask), until a push the replay
  // can't make or nothing to answer. A help step's "ok" is played as not done yet (the builder never does it here), so
  // EarnKit re-checks, says so once, then moves to the next program.
  for (let i = 0; r && i < 10; i++) {
    const t = lazyNext(r, { blanks: BLANKS, pushed: PUSHED_ASK, answers: ANSWERS });
    if (t === 'real_work') {
      notes.push(`turn ${r.turn}: real work (${moveUpOf(r)?.kind ?? 'a step'}): the agent pushes a change to the repo, which the replay can't do; the session ends here, not done yet.`);
      break;
    }
    if (!t) {
      notes.push(`turn ${r.turn}: nothing structured to answer; the session ends here.`);
      break;
    }
    r = await play(replies.length === 1 && t.says === 'ok' ? { ...t, says: 'sure' } : t);
  }
  // Silence, then a new session two days later.
  await play({ wait: 2 * DAY });
  await play({ find: {} });
}

async function walkS() {
  const id = Number(process.env.OWN ?? 27);
  const ctx = await own(id);
  const [me] = await sql()<{ name: string | null; handle: string | null }[]>`
    SELECT p.name, f.x_handle AS handle FROM builder_profiles f LEFT JOIN builder_projects p ON p.builder_id = f.builder_id AND lower(p.project_key) = lower(f.main_project_key)
    WHERE f.builder_id = ${ctx.installationId}`;
  names.push(...[me?.name, me?.handle].filter((x): x is string => Boolean(x)));
  await freshSession(ctx.installationId);
  const turn = conversation(ctx as never, { builderId: ctx.installationId });
  const turns: Turn[] = [
    ...Array.from({ length: 5 }, () => ({ find: {} }) as Turn),
    { says: 'what can I apply to', find: { ask: 'programs' } } as Turn,
    { find: {} },
  ];
  for (const t of turns) {
    const r = await turn(t);
    if (r) replies.push(r);
  }
  // Final review 9: walk S claims a fresh session; a carried-over one is a different scenario, so it fails the walk.
  if (replies[0] && !replies[0].first) {
    notes.push('walk S: the first reply did not start a fresh session, so this is not the scenario it claims');
    sessionFailed = true;
  }
}

/**
 * v4.10 Task 5, walk R: the owner on a fresh session answers the ready set (OWN). VARIANT=yes (default): find, yes, the
 * codes pushed, sent. VARIANT=skip: find, "skip <the last number in the set>", the codes pushed, sent. The set's one
 * builder-only ask (every field across the set) is answered by lazyNext in one message, split by field (ANSWERS: "just
 * me", "nothing raised", "no users yet", "no demo yet"); the reply's own words are never invented. A push to the builder's repo can't happen in a replay, so when a reply asks for it ("Say ok
 * once the change is pushed"), the codes are simulated: a fake GitHub (fixtures/fake-github.ts, offline) whose copy of
 * the builder's repo carries a Builder Codes file, installed as the tool context's codesFetch; the snapshot's own App
 * proof row (github_verifications) names the installation, and appEnv() gives a local throwaway App key. The agent's
 * "ok" is then a `tell` on that qualify ask (as the tests do), which runs the re-check. Nothing leaves localhost.
 */
async function walkR() {
  const id = Number(process.env.OWN ?? 27);
  const variant = (process.env.VARIANT ?? 'yes').toLowerCase();
  const ctx = (await own(id)) as Record<string, unknown>;
  const [me] = await sql()<{ name: string | null; handle: string | null }[]>`
    SELECT p.name, f.x_handle AS handle FROM builder_profiles f LEFT JOIN builder_projects p ON p.builder_id = f.builder_id AND lower(p.project_key) = lower(f.main_project_key)
    WHERE f.builder_id = ${ctx.installationId}`;
  names.push(...[me?.name, me?.handle].filter((x): x is string => Boolean(x)));
  await freshSession(ctx.installationId as number);
  const turn = conversation(ctx as never, { builderId: ctx.installationId as number, ctx: () => ctx as never });
  const play = async (t: Turn) => {
    const r = await turn(t);
    if (r) replies.push(r);
    return r;
  };
  let r = await play({ find: {} });
  const set = [...(r?.show.matchAll(/^\d+\. /gm) ?? [])].length;
  notes.push(`the owner's set in this snapshot: ${set} program(s)`);
  if (variant === 'skip' && set > 0) {
    const t = lazyNext(r!, { blanks: BLANKS, pushed: PUSHED_ASK, skip: [set], answers: ANSWERS });
    if (t && t !== 'real_work') r = await play(t);
  }
  let sent = false;
  for (let i = 0; r && i < 12 && !sent; i++) {
    let t = lazyNext(r, { blanks: BLANKS, pushed: PUSHED_ASK, answers: ANSWERS });
    if (t === 'real_work') {
      const m = moveUpOf(r);
      if (!ctx.codesFetch) {
        const [v] = await sql()<{ key: string; gid: string }[]>`
          SELECT repo_key AS key, github_installation_id::text AS gid FROM github_verifications
          WHERE installation_id = ${ctx.installationId as number} AND via = 'app' AND purpose = 'app' AND github_installation_id IS NOT NULL ORDER BY verified_at DESC LIMIT 1`;
        if (!v) { notes.push('no App proof row for the owner in this snapshot, so the codes cannot be simulated'); break; }
        appEnv();
        ctx.codesFetch = fakeGitHub({ [v.key]: { id: 1, owner: v.key.split('/')[0], installation: Number(v.gid), files: { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` } } });
        notes.push(`turn ${r.turn}: the agent's push is simulated: the owner's repo ${v.key} carries Builder Codes in a fake GitHub (codesFetch), then the agent says ok (a tell on the qualify ask), which re-checks.`);
      }
      t = { says: 'ok', tell: { move_up: { kind: m?.kind ?? 'qualify', project_key: (m as { project_key?: string } | null)?.project_key ?? null, answer: 'yes' } } } as Turn;
    }
    if (!t) { notes.push(`turn ${r.turn}: nothing structured to answer; the walk ends here.`); break; }
    sent = t.says === 'sent';
    r = await play(t);
  }
  if (!sent) notes.push('walk R did not reach "sent"');
  // "sent" ends the walk; one more find shows the next session's start is a quiet one (the set is tracked now).
  if (sent) await play({ find: {} });
}

async function walkB() {
  const token = `ek_replay_b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(token, undefined, false, 'Claude Code');
  const c = (await connectInstallation(token))!;
  notes.push(`fresh signed-out installation ${c.id}`);
  const turn = conversation({ installationId: c.id, ownInstallationId: c.own, sharedClient: false } as never, { builderId: c.id });
  for (const t of [{ find: {} }, { says: '2', find: { program: '2' } }] as Turn[]) {
    const r = await turn(t);
    if (r) replies.push(r);
  }
  notes.push('then: connecting GitHub needs the builder\'s own X sign-in and GitHub App install; the replay stops at the pick (the fixture test plays the rest).');
}

let code = 0;
let sessionFailed = false;
try {
  await (walk === 'A' ? walkA() : walk === 'S' ? walkS() : walk === 'R' ? walkR() : walkB());
  console.log(`=== WALK ${walk} ===\n\n${transcript(replies)}\n`);
  for (const n of notes) console.log(`note: ${n}`);
  const fails = gateFailures(replies, { names });
  console.log(`\n=== GATE: ${fails.length ? `${fails.length} failure(s)` : 'pass'} ===`);
  for (const f of fails) console.log(`turn ${f.turn} ${f.rule}: ${f.reason}`);
  if (sessionFailed) console.log('=== SESSION: walk S did not start fresh ===');
  code = fails.length || sessionFailed ? 1 : 0;
} catch (err) {
  console.error(err);
  code = 2;
} finally {
  await sql().end();
}
process.exit(code);
