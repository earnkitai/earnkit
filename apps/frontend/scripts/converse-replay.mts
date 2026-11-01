/**
 * v4.8 Task 6: the lazy scripts of the target conversation, replayed on a local restored production snapshot, each
 * reply checked by the merge gate (lib/earnkit/fixtures/converse.ts gateFailures). It writes to that database (the
 * builder's path, said parts, an "applied" row), so run it on a throwaway copy of the snapshot, never anything shared.
 *
 *   cd apps/frontend
 *   DATABASE_URL=postgresql://localhost:5432/<snapshot copy> OWN=27 WALK=A npx tsx scripts/converse-replay.mts
 *   DATABASE_URL=postgresql://localhost:5432/<snapshot copy> WALK=B npx tsx scripts/converse-replay.mts
 *
 * - A (OWN, the installation): the session opener, then a lazy agent's yes to each reply's structured ask (move_up):
 *   "sure", the blanks ("just me, nothing raised"), "sent", "ok"; then silence and a new session two days later.
 * - B: a fresh signed-out installation in this database: the opener, then "2".
 * - Real work ends a walk's session: pushing a change to the builder's repo (Builder Codes) or connecting GitHub
 *   needs the builder's own accounts, so the script records that the step was offered and goes no further there.
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
const walk = (process.env.WALK ?? 'A').toUpperCase();
if (walk !== 'A' && walk !== 'B') {
  console.error('WALK must be A or B.');
  process.exit(2);
}

await import('../lib/earnkit/fixtures/test-guard');
await import('../lib/earnkit/fixtures/no-network-checks');
Object.assign(process.env, { X_CLIENT_ID: 'replay-x-id', X_CLIENT_SECRET: 'replay-x-secret' });
process.env.EARNKIT_AUTH_SECRET ??= 'converse-replay-secret';
process.env.EARNKIT_URL ??= 'https://earnkit.com';

const { sql } = await import('../lib/earnkit/db');
const { conversation, gateFailures, transcript } = await import('../lib/earnkit/fixtures/converse');
const { saveInstallation, connectInstallation } = await import('../lib/earnkit/installations');
const { PUSHED_ASK } = await import('../lib/earnkit/bench-find');
const { CODES_OFFER, GAP_GO, GAP_FIRST_ASK, GAP_HELP_ASK, GAP_HELP_ASK_ONE, GAP_DO_IT_ASK } = await import('../lib/earnkit/conversation');
/** The asks whose yes is real work in the builder's repo or accounts (the agent does it, or helps them do it). */
const WORK_ASKS = [CODES_OFFER, GAP_GO, GAP_FIRST_ASK, GAP_HELP_ASK, GAP_HELP_ASK_ONE, GAP_DO_IT_ASK];
type Reply = import('../lib/earnkit/fixtures/converse').Reply;
type Turn = import('../lib/earnkit/fixtures/converse').Turn;

const DAY = 86_400_000;
const BLANKS = 'just me, nothing raised';
const replies: Reply[] = [];
const notes: string[] = [];

type MoveUp = { kind: string; project_key: string | null; [k: string]: unknown };
const moveUpOf = (r: Reply) => (r.reply?.move_up as MoveUp | undefined) ?? null;
const lastPara = (r: Reply) => r.show.split(/\n\s*\n/).at(-1)?.trim() ?? '';

/**
 * The lazy agent's next turn from the reply's structured ask: the reply's own word ("sent", the blanks) or a yes to
 * its move_up; null when the reply asks for nothing EarnKit can take, or the step is real work outside EarnKit.
 */
function next(r: Reply): Turn | 'real_work' | null {
  const m = moveUpOf(r);
  const end = lastPara(r);
  if (end.includes(PUSHED_ASK)) return 'real_work';
  if (!m) return null;
  const ask = { kind: m.kind, project_key: m.project_key ?? null };
  if (/\bReply "sent"/i.test(end)) return { says: 'sent', tell: { move_up: { ...ask, answer: 'sent' } } };
  if (/\bReply with (?:both|them|it)\b/i.test(end)) return { says: BLANKS, tell: { move_up: { ...ask, answer: 'yes', blanks: BLANKS } } };
  if (/\?\s*[^?]*$/.test(end) || /\bsay ok\b/i.test(end)) return { says: replies.length === 1 ? 'sure' : 'ok', tell: { move_up: { ...ask, answer: 'yes' } } };
  return null;
}

async function own(id: number) {
  const [r] = await sql()<{ b: number | null; s: boolean }[]>`SELECT builder_id AS b, shared_client AS s FROM installations WHERE id = ${id}`;
  if (!r) throw new Error(`no installation ${id} in this database`);
  return { installationId: r.b ?? id, ownInstallationId: id, sharedClient: r.s };
}

async function walkA() {
  const id = Number(process.env.OWN ?? 27);
  const ctx = await own(id);
  const turn = conversation(ctx as never, { builderId: ctx.installationId });
  const play = async (t: Turn) => {
    const r = await turn(t);
    if (r) replies.push(r);
    return r;
  };
  let r = await play({ find: {} });
  // The first session: at most 8 lazy replies, until real work or nothing to answer. A yes to a work ask is played
  // once (EarnKit's reply tells the agent to do it); the work itself can't be done here, so the session ends after it.
  for (let i = 0; r && i < 8; i++) {
    const t = next(r);
    if (t === 'real_work') {
      notes.push(`turn ${r.turn}: real work offered (${moveUpOf(r)?.kind ?? 'a step'}); the replay can't push to the repo, so the session ends here, not done yet.`);
      break;
    }
    if (!t) {
      notes.push(`turn ${r.turn}: nothing structured to answer; the session ends here.`);
      break;
    }
    const work = WORK_ASKS.some((a) => lastPara(r!).endsWith(a));
    r = await play(t);
    if (work && r) {
      notes.push(`turn ${r.turn}: the yes to a step that is real work (${moveUpOf(r)?.kind ?? 'a step'}); the replay can't do it, so the session ends here, not done yet.`);
      break;
    }
  }
  // Silence, then a new session two days later.
  await play({ wait: 2 * DAY });
  await play({ find: {} });
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
try {
  await (walk === 'A' ? walkA() : walkB());
  console.log(`=== WALK ${walk} ===\n\n${transcript(replies)}\n`);
  for (const n of notes) console.log(`note: ${n}`);
  const fails = gateFailures(replies);
  console.log(`\n=== GATE: ${fails.length ? `${fails.length} failure(s)` : 'pass'} ===`);
  for (const f of fails) console.log(`turn ${f.turn} ${f.rule}: ${f.reason}`);
  code = fails.length ? 1 : 0;
} catch (err) {
  console.error(err);
  code = 2;
} finally {
  await sql().end();
}
process.exit(code);
