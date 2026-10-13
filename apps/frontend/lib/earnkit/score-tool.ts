import { emptyReasonOf, publicRow, publicScore, siteShowsUse, type EmptyReason } from './builder-score';
import { sql } from './db';
import { enqueueDiscovery, publicHttpsOrigin, DISCOVER_CAPS } from './discovery';
import { profileCode } from './discovery-clues';
import { prizeOf } from './entry-text';
import { eventLogEnabled, noteEvent } from './events';
import { noteLineIssued } from './github-verify';
import { PROFILE_URL, consentOnce, ensureProfile } from './profiles';
import { listPrograms } from './programs';
import { CARD_OFFER_NOTE, offerCard } from './share';
import { MAX, partDeltas, topPercent, type Parts } from './score';
import { tokenLineFor } from './token-gate';

/**
 * v2.12 spec 7: the `score` tool's reply (registered only while EARNKIT_BUILDER_SCORE=on): the
 * public score, top N%, the change since the person last asked, what moved it, the one next step
 * with the most expected points, and a program line when one fits. One question at most.
 */
export const SCORE_SHARED = 'Open EarnKit in your own coding agent to see your score.';
export const MORE_USERS_LINE = 'More people using what you shipped moves your score most.';
export const WORKING_LINE = 'Your score is being worked out now. Ask again in an hour.';
export const HELD_LINE = 'Your newest score is in a quick review.';
export const SITE_LINE = 'Link your live site so staying power counts?';
/** A site a repo only links is shown, never scored (T6): its step is the earnkit.txt line. */
export const SITE_TXT_LINE = 'Add a one-line earnkit.txt to your live site so staying power counts?';
export type NextAction = { kind: 'link_repo' | 'link_site' | 'add_package' | 'ship_to_users' | 'wait_read'; points: number; line: string; agent_note: string };

export const FILL_LINES: Record<EmptyReason, { ask: string; say: string }> = {
  ownership_unproven: { ask: "Your repos aren't linked yet. Add a one-line earnkit.txt so they count?", say: "Your repos aren't linked yet; say link them and I'll add a one-line earnkit.txt." },
  no_github: { ask: "Your work isn't linked yet. Add earnkit.txt to your live site so it counts?", say: "Your work isn't linked yet; say link it and I'll add earnkit.txt to your live site." },
  nothing_live: { ask: 'Nothing of yours has outside users yet. Ship it to users and your score fills in.', say: 'Nothing of yours has outside users yet. Ship it to users and your score fills in.' },
  read_failed: { ask: "EarnKit couldn't read your work yet. It tries again within the hour.", say: "EarnKit couldn't read your work yet. It tries again within the hour." },
};
export const SCORE_NOTES = {
  link: "On a yes, push each proof_line line to its repo's earnkit.txt on the default branch. EarnKit checks within the hour; call score again then. Never ask the builder to edit files.",
  site: 'On a yes, add the proof_line line for the site to earnkit.txt at its root and redeploy it. EarnKit checks within the hour; call score again then.',
  siteUnknown: "On a yes, ask for the live site's link, pass it to find in local_git.live_urls, then call score again for its earnkit.txt line.",
  none: 'Nothing to do now.',
};

/** Expected points of each step, from the stored parts; the largest wins. Pure. */
export function nextAction(p: { parts: Parts | null; missing: EmptyReason | null; hasPackage: boolean; hasSite: boolean; linkedSite?: boolean }): NextAction {
  if (p.missing === 'ownership_unproven') return { kind: 'link_repo', points: MAX.users, line: FILL_LINES.ownership_unproven.ask, agent_note: SCORE_NOTES.link };
  if (p.missing === 'no_github') return { kind: 'link_site', points: MAX.users, line: FILL_LINES.no_github.ask, agent_note: SCORE_NOTES.site };
  if (p.missing === 'read_failed') return { kind: 'wait_read', points: 0, line: FILL_LINES.read_failed.say, agent_note: SCORE_NOTES.none };
  const users = p.parts?.users.points ?? 0;
  // Only a person with no outside user at all hears "nothing of yours has outside users yet".
  if (users === 0) return { kind: 'ship_to_users', points: MAX.users, line: FILL_LINES.nothing_live.say, agent_note: SCORE_NOTES.none };
  const ship: NextAction = { kind: 'ship_to_users', points: MAX.users - users, line: MORE_USERS_LINE, agent_note: SCORE_NOTES.none };
  const site: NextAction | null = p.hasSite
    ? null
    : { kind: 'link_site', points: MAX.staying / 2, line: p.linkedSite ? SITE_TXT_LINE : SITE_LINE, agent_note: SCORE_NOTES.site };
  return site && site.points > ship.points ? site : ship;
}

const NAMES: Record<keyof Parts, string> = { users: 'users', money: 'money', staying: 'staying power', recency: 'recency', consistency: 'shipping consistency' };
/** The parts that moved by a point or more, biggest first ("Users +6, staying power -1."); null when none did. Pure. */
export function movedLine(d: Record<keyof Parts, number>): string | null {
  const moved = (Object.keys(d) as (keyof Parts)[]).filter((k) => Math.abs(d[k]) >= 1).sort((a, b) => Math.abs(d[b]) - Math.abs(d[a]));
  if (moved.length === 0) return null;
  const s = moved.map((k) => `${NAMES[k]} ${d[k] > 0 ? '+' : '-'}${Math.round(Math.abs(d[k]))}`).join(', ');
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

/** v2.12 spec 7 (R13): find's second line with a score: "You: score 41, top 22%. earnkit.com/b/lee" (no link when hidden). Pure. */
export const youLine = (a: { score: number; percentile: number; slug: string; hidden?: boolean }): string =>
  `You: score ${a.score}, top ${topPercent(a.percentile)}%.${a.hidden ? '' : ` ${PROFILE_URL(a.slug)}`}`;

/**
 * v2.12 spec 7 (R13, R14): find's second line: the score line, else the step that fills an empty
 * profile, said (not asked) when line 1 already asks; null with no profile or nothing to say. Pure.
 */
export function secondLine(a: {
  profile: { slug: string; hidden?: boolean } | null;
  score: { score: number; percentile: number } | null;
  missing: EmptyReason | null;
  lineOneAsks: boolean;
}): string | null {
  if (!a.profile) return null;
  if (a.score) return youLine({ ...a.score, slug: a.profile.slug, hidden: a.profile.hidden });
  return a.missing ? FILL_LINES[a.missing][a.lineOneAsks ? 'say' : 'ask'] : null;
}

export const programLine = (c: { title: string; prize: string }) => `${c.title} fits you: ${c.prize}.`;

/**
 * The reply's lines. `since`: 'last' (the last time they asked) or 'week' (the event log is off).
 * `hidden`: no profile link (a hidden profile is a 404). Pure.
 */
export function scoreLines(a: {
  score: number; percentile: number; change: number | null; since?: 'last' | 'week'; moved: string | null; held: boolean;
  slug: string; hidden?: boolean; next: NextAction; program: string | null;
}): string {
  const when = a.since === 'week' ? 'this week' : 'since you last asked';
  const change = a.change === null || a.change === 0 ? '' : `, ${a.change > 0 ? 'up' : 'down'} ${Math.abs(a.change)} ${when}`;
  return [
    `Score ${a.score}, top ${topPercent(a.percentile)}%${change}.${a.hidden ? '' : ` ${PROFILE_URL(a.slug)}`}`,
    a.held ? HELD_LINE : a.moved,
    // Money first (spec 7): a program that fits comes before the next step.
    a.program,
    a.next.line,
  ].filter((x): x is string => Boolean(x)).join('\n');
}

/** What the program line reads of a listPrograms card (T9 adds agent_completable; absent is true). */
export type ScoreProgram = {
  title: string; summary: string; chains: readonly string[]; investment: boolean; earnkit_campaign: boolean;
  starts_at: Date | null; agent_completable?: boolean;
};
export type ScoreReply = {
  show_to_builder: string;
  agent_note?: string;
  score: number | null;
  percentile: number | null;
  /** The earnkit.txt lines for the next step: a repo's `token:` line or a site's `profile:` line. */
  proof_line?: ({ repo: string; line: string } | { site: string; line: string })[];
  /** The once-only card offer was made in this reply (share.ts). */
  card_offer?: { agent_note: string };
};
type Ctx = { installationId: number; ownInstallationId?: number; sharedClient?: boolean };
type SourceFact = { kind: string; ref: string; project_key: string; state: string; proof: string | null };

const DAY_MS = 86_400_000;
const lines = (...xs: (string | null)[]) => xs.filter((x): x is string => Boolean(x)).join('\n');

/**
 * The score tool. A shared client is never a person (plan R2): one plain line, nothing read or
 * written. Everyone else gets a profile (and a discovery run) if this is their first call, their
 * public score (never a held one), and one score_viewed event a minute.
 */
export async function scoreReply(ctx: Ctx, now: Date, deps: { programs?: () => Promise<ScoreProgram[]> } = {}): Promise<ScoreReply> {
  const shared: ScoreReply = { show_to_builder: SCORE_SHARED, score: null, percentile: null };
  if (ctx.sharedClient) return shared;
  const id = ctx.installationId;
  const made = await ensureProfile(id, now);
  if (!made) return shared;
  if (made.created) await enqueueDiscovery(id, 'first_find');
  const { profile } = made;
  const link = profile.hidden ? null : PROFILE_URL(profile.slug);
  const pub = await publicScore(id);
  const sources = await sql()<SourceFact[]>`
    SELECT kind, ref, project_key, state, proof FROM builder_sources WHERE builder_id = ${id} AND state <> 'rejected' ORDER BY id`;
  const verified = sources.filter((s) => s.state === 'verified');
  const sites = verified.filter((s) => s.kind === 'site');
  const hasSite = sites.some(siteShowsUse);
  const hasPackage = verified.some((s) => s.kind === 'package_npm' || s.kind === 'package_pypi');
  // The step's earnkit.txt lines: proposed repos, or sites still to prove (proposed, or only linked by a repo).
  const repoLines = () => sources.filter((s) => s.kind === 'repo' && s.state === 'proposed').slice(0, DISCOVER_CAPS.remotes);
  // Discovery's clue 6 order: proposed sites first, then by id.
  const siteLines = () =>
    sources
      .filter((s) => s.kind === 'site' && (s.state === 'proposed' || !siteShowsUse(s)))
      .sort((a, b) => Number(b.state === 'proposed') - Number(a.state === 'proposed'))
      .slice(0, DISCOVER_CAPS.sites);
  // In review: the profile says so, or a score newer than the public one is held and not released.
  const [heldRow] = await sql()`
    SELECT 1 FROM builder_scores s WHERE s.builder_id = ${id} AND s.day > ${pub?.day ?? '0001-01-01'}::date AND NOT ${publicRow()} LIMIT 1`;
  const held = profile.held || Boolean(heldRow);

  let reply: ScoreReply;
  let next: NextAction | null = null;
  if (!pub || pub.score === 0) {
    const [scored] = await sql()`SELECT 1 FROM builder_scores WHERE builder_id = ${id} LIMIT 1`;
    let text: string;
    if (!scored) text = lines(WORKING_LINE, link); // the first cron run hasn't scored them yet
    else if (!pub && held) text = lines(HELD_LINE, link); // a first score, in review
    else {
      // A public 0, even after an earlier positive score: its fill step, now.
      let missing = (await emptyReasonOf(id, { anyHistory: true })) ?? 'nothing_live';
      // Unproven, but nothing to put a token line in: the step is the site's earnkit.txt line.
      if (missing === 'ownership_unproven' && repoLines().length === 0) missing = 'no_github';
      next = nextAction({ parts: pub?.parts ?? null, missing, hasPackage, hasSite });
      text = lines(held ? HELD_LINE : null, next.line, link);
    }
    reply = { show_to_builder: text, score: null, percentile: null };
  } else {
    const before = await previous(id, pub.day, now);
    const change = before ? pub.score - before.score : null;
    const moved = before?.parts ? movedLine(partDeltas(pub.parts, before.parts)) : null;
    next = nextAction({ parts: pub.parts, missing: null, hasPackage, hasSite, linkedSite: sites.length > 0 && !hasSite });
    const program = await programFor(id, pub.day, now, deps.programs ?? (listPrograms as () => Promise<ScoreProgram[]>));
    reply = {
      show_to_builder: scoreLines({
        score: pub.score, percentile: pub.percentile, change, since: before?.since, moved, held,
        slug: profile.slug, hidden: profile.hidden, next, program,
      }),
      score: pub.score,
      percentile: pub.percentile,
    };
  }
  if (next) Object.assign(reply, await proofLines(ctx, next, repoLines(), siteLines(), now));
  // v2.12 spec 1 (final review I4): the consent line, once per person, as find does, before the card
  // offer (which stays last): a person whose first call is score sees it here. It carries the link,
  // so a bare link line goes. Marked shown only as the reply goes out; never fails the tool.
  const consent = await consentOnce(id).catch((err: unknown) => {
    console.error('[score] consent', err instanceof Error ? err.name : 'error');
    return null;
  });
  if (consent) reply.show_to_builder = lines(...reply.show_to_builder.split('\n').filter((l) => l !== link), consent);
  // v2.12 spec 7 "The offer": once, last, and only when nothing above asks (plan R14).
  const offer =
    reply.score !== null
      ? await offerCard(id, /\?/.test(reply.show_to_builder)).catch((err: unknown) => {
          console.error('[score] card offer', err instanceof Error ? err.name : 'error');
          return null;
        })
      : null;
  if (offer) Object.assign(reply, { show_to_builder: lines(reply.show_to_builder, offer), card_offer: { agent_note: CARD_OFFER_NOTE } });
  const shown = pub && pub.score > 0 ? pub : null;
  await noteEvent('score_viewed', () => ({
    type: 'score_viewed',
    dedupe_key: `score_viewed:${id}:${Math.floor(now.getTime() / 60_000)}`,
    installation_id: id,
    detail: { score: shown?.score ?? null, day: shown?.day ?? null },
  }));
  return reply;
}

/**
 * What the score is compared with: the public score they were shown when they last asked (the last
 * score_viewed event), or, with the event log off, the public score 7 days ago.
 */
async function previous(id: number, day: string, now: Date): Promise<{ score: number; parts: Parts | null; since: 'last' | 'week' } | null> {
  if (eventLogEnabled()) {
    const [e] = await sql()<{ detail: { score?: unknown; day?: unknown } }[]>`
      SELECT detail FROM builder_events WHERE type = 'score_viewed' AND installation_id = ${id} ORDER BY at DESC, id DESC LIMIT 1`;
    const score = e?.detail?.score;
    if (typeof score !== 'number') return null;
    const seen = typeof e.detail.day === 'string' ? e.detail.day : null;
    const [row] = seen && seen !== day ? await sql()<{ parts: Parts }[]>`SELECT parts FROM builder_scores WHERE builder_id = ${id} AND day = ${seen}` : [];
    return { score, parts: seen === day ? null : (row?.parts ?? null), since: 'last' };
  }
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
  const [row] = await sql()<{ score: number; parts: Parts }[]>`
    SELECT s.score, s.parts FROM builder_scores s
    WHERE s.builder_id = ${id} AND s.day <= ${weekAgo}::date
      AND ${publicRow()}
    ORDER BY s.day DESC LIMIT 1`;
  return row ? { score: row.score, parts: row.parts, since: 'week' } : null;
}

/** The first open, agent-completable program on a chain of the top project's verified contracts, as one line; null when none. */
async function programFor(id: number, day: string, now: Date, programs: () => Promise<ScoreProgram[]>): Promise<string | null> {
  const chains = await sql()<{ chain: string }[]>`
    SELECT DISTINCT split_part(b.ref, ':', 1) AS chain FROM builder_scores s
    JOIN builder_sources b ON b.builder_id = s.builder_id AND b.project_key = s.top_outcome->>'key'
    WHERE s.builder_id = ${id} AND s.day = ${day}::date AND b.kind = 'contract' AND b.state = 'verified'`;
  if (chains.length === 0) return null;
  const on = new Set(chains.map((c) => c.chain));
  // Never an investment (a16z speedrun): it is not a prize the agent can win for them.
  const card = (await programs()).find(
    (c) => c.agent_completable !== false && !c.earnkit_campaign && !c.investment && (!c.starts_at || c.starts_at <= now) && c.chains.some((x) => on.has(x)),
  );
  return card ? programLine({ title: card.title, prize: prizeOf(card) }) : null;
}

/**
 * The next step's earnkit.txt lines and agent note. A repo gets the v2.11 token line (recorded as
 * issued, R4 b); a site its profile line. Discovery is queued again so the pushed line is checked.
 */
async function proofLines(ctx: Ctx, next: NextAction, repos: SourceFact[], sites: SourceFact[], now: Date): Promise<Pick<ScoreReply, 'agent_note' | 'proof_line'>> {
  const id = ctx.installationId;
  const own = ctx.ownInstallationId ?? id;
  const out: NonNullable<ScoreReply['proof_line']> = [];
  if (next.kind === 'link_repo')
    for (const r of repos) {
      const url = `https://github.com/${r.ref}`;
      const line = tokenLineFor(own, url);
      if (!line) continue;
      await noteLineIssued(own, url, now);
      out.push({ repo: r.ref, line });
    }
  if (next.kind === 'link_site')
    for (const s of sites) {
      const origin = publicHttpsOrigin(s.ref);
      const code = origin && profileCode(id, origin);
      if (origin && code) out.push({ site: origin, line: `profile: ${code}` });
    }
  if (next.kind !== 'link_repo' && next.kind !== 'link_site') return { agent_note: next.agent_note };
  // No line to give: a site's link is still unknown; a repo line needs the auth secret (never unset in production).
  if (out.length === 0) return { agent_note: next.kind === 'link_site' ? SCORE_NOTES.siteUnknown : SCORE_NOTES.none };
  await enqueueDiscovery(id, 'local_repo');
  return { agent_note: next.agent_note, proof_line: out };
}
