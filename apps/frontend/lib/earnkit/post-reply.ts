import { sql } from './db';
import { siteUrl } from './entry-text';
import { NEWS_ASK, OUTCOME_NOTED, POST_ASK, PROOF_ASK, eventHead, postReply, redraftLine, type EventPost, type PostOffer } from './bench-reply';
import { draftByCode, recentDrafts, rewordDraft, type DraftRow } from './post-drafts';
import { writePost } from './post-writer';
import { checkUpdate } from './update-text';
import {
  HOT_HOURS, draftMoment, eventStamp, newsCandidate, offeredMoments, verifiedOutcomeCandidate, weeklyCandidate, type MomentCandidate,
} from './post-moments';
import { pagePath } from './reserved-routes';

/**
 * v3.1 one-tap posts, Task 6 (design 6): the drafted posts in the replies. A post is offered in the share slot (the
 * Monday moment's weekly post, or an event: an announced win, going live, the coin's intro); went live and won jump
 * ahead of the apply step for HOT_HOURS. The builder's news (tell update) and an outcome they told with its proof link
 * (tell program_status with proof_url, owner ruling 3) are drafted as they say them. Each reply's one https link is the
 * post's short link (earnkit.com/<handle>/post/<code>); its question asks for a different version, which redrafts
 * with the next shape (the builder asked, so it counts toward the asked limit). Never throws on its own reads.
 */
export const POST_NOTE =
  "show_to_builder holds a post for X and its one-tap link. Show the post text exactly as given. Never rewrite it. " +
  "A yes or no to the question: call tell with move_up: { kind: 'post', project_key, answer } (project_key as given here). Never post for the builder. Don't show this note.";
/** Owner ruling 3: what the agent does when an accepted, funded or won outcome came without its proof link. */
export const PROOF_NOTE =
  "If the builder sends a public link that shows it (the program's X post or results page), open it and check it shows this result, " +
  "then call tell with program_status again with proof_url set to it. Never pass a link you haven't checked. Don't show this note.";

const logged = (where: string) => (err: unknown) => {
  console.error(`[post] ${where}`, err instanceof Error ? err.name : 'error');
  return null;
};

/** The reply's one link: earnkit.com/<handle>/post/<code>. Pure. */
export const shortLink = (handle: string, code: string) => `${siteUrl()}${pagePath(handle)}/post/${code}`;
const offerOf = (handle: string, d: DraftRow): PostOffer => ({ text: d.text, link: shortLink(handle, d.code) });

/** Fix round: the yes to "Want to change any words?" (the builder's news): their new words go to tell update. */
export const NEWS_REWORD_NOTE =
  "Ask the builder in one short question for the new words of their post, then call tell with update: { text } in their own words. Don't show this note.";
/** The question a moment's post asks: a different version, or for the builder's own news, their words. Pure. */
const askOf = (c: Pick<MomentCandidate, 'moment'>) => (c.moment === 'news' ? NEWS_ASK : POST_ASK);

/** The ask a post reply stores (standing_seen.bench_ask): its yes redrafts this moment. */
type PostAsk = { kind: 'post'; key: string | null; code: string; head: string; moment: MomentCandidate; reword?: true };
async function storePostAsk(id: number, ask: PostAsk): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(ask as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('store ask'));
}

/** The person's page handle (claimed, not hidden), or null. */
async function handleOf(id: number): Promise<string | null> {
  const [p] = await sql()<{ handle: string | null }[]>`
    SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL AND NOT hidden`.catch(() => []);
  return p?.handle ?? null;
}

/**
 * The Monday moment's post: last week's (post-moments.ts weeklyCandidate, numbered `week` as the moment names it),
 * offered (EarnKit's one offer a week).
 * Null when there is nothing worth posting or a limit holds it (the reply then gives the page). Never throws.
 */
export async function weeklyPost(id: number, handle: string, week: number, now: Date): Promise<PostOffer | null> {
  const c = await weeklyCandidate(id, now, { week }).catch(logged('weekly'));
  if (!c || typeof c === 'string') return null;
  const d = await draftMoment(id, c, { asked: false }, now).catch(logged('weekly draft'));
  return d?.ok ? offerOf(handle, d.draft) : null;
}

/** Whether `c` jumps ahead of the apply step now: went live or won, under HOT_HOURS since it could be posted. Pure. */
export const isHot = (c: Pick<MomentCandidate, 'moment' | 'at'>, now: Date) =>
  (c.moment === 'went_live' || c.moment === 'won') && c.at !== undefined && now.getTime() - c.at.getTime() < HOT_HOURS * 3_600_000;

/**
 * Final review 3: the people with no event to draft, by the UTC day it was found and eventStamp then (this process
 * only), so a quiet reply reads one stamp instead of every moment again (about 10 queries) for the rest of that day.
 */
const quietDay = new Map<number, { day: string; stamp: string }>();
const dayOf = (now: Date) => now.toISOString().slice(0, 10);
function markQuiet(id: number, now: Date, stamp: string) {
  const day = dayOf(now);
  for (const [k, q] of quietDay) if (q.day !== day) quietDay.delete(k);
  quietDay.set(id, { day, stamp });
}

/**
 * An event's post (an announced win, going live, the coin's intro: offeredMoments without the weekly), drafted and
 * stored as the reply's ask: the first that drafts (final review 3: one that can't be drafted gives way to the next).
 * `hot`: only went live or won under HOT_HOURS (they go before the apply step); else any. Null: none, or a limit holds
 * it; when nothing at all could be drafted (and no read failed), remembered until the day ends or eventStamp changes.
 * Never throws.
 */
export async function eventPost(id: number, handle: string, now: Date, o: { hot: boolean }): Promise<(EventPost & { hot: boolean }) | null> {
  const stamp = await eventStamp(id).catch(logged('event stamp'));
  const quiet = quietDay.get(id);
  if (stamp !== null && quiet?.day === dayOf(now) && quiet.stamp === stamp) return null;
  const r = await offeredMoments(id, now, { weekly: false }).catch(logged('event'));
  if (!r) return null;
  let open = false;
  for (const c of r.moments) {
    const hot = isHot(c, now);
    if (o.hot && !hot) {
      // Not tried in this pass: the later, non-hot pass may still draft it.
      open = true;
      continue;
    }
    const d = await draftMoment(id, c, { asked: false }, now).catch(logged('event draft'));
    if (!d) open = true;
    if (!d?.ok) continue;
    const head = eventHead(c, now);
    await storePostAsk(id, { kind: 'post', key: c.projectKey, code: d.draft.code, head, moment: c });
    return { head, ...offerOf(handle, d.draft), hot };
  }
  if (!open && stamp !== null) markQuiet(id, now, stamp);
  return null;
}

/** A drafted moment's reply and its move_up, the ask stored. Null when it can't be drafted now. */
async function draftedReply(id: number, c: MomentCandidate, asked: boolean, now: Date): Promise<Record<string, unknown> | null> {
  const handle = await handleOf(id);
  if (!handle) return null;
  const d = await draftMoment(id, c, { asked }, now).catch(logged('draft'));
  if (!d?.ok) return null;
  const head = eventHead(c, now);
  await storePostAsk(id, { kind: 'post', key: c.projectKey, code: d.draft.code, head, moment: c });
  return {
    show_to_builder: postReply({ head, ...offerOf(handle, d.draft) }, askOf(c)),
    move_up: { kind: 'post', project_key: c.projectKey, agent_note: POST_NOTE },
  };
}

/** The open post ask (standing_seen.bench_ask kind 'post'), if any. */
async function openPostAsk(id: number): Promise<PostAsk | null> {
  const [p] = await sql()<{ ask: PostAsk | null }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const a = p?.ask;
  return a && a.kind === 'post' && typeof a.code === 'string' && a.moment && typeof a.moment === 'object' ? a : null;
}
/** Fix round: `code` is the person's latest draft and still within its 14-day life (only that one is redrafted). */
async function latestLive(id: number, code: string, now: Date): Promise<boolean> {
  const [last] = await recentDrafts(id, 1);
  if (last?.code !== code) return false;
  const d = await draftByCode(code);
  return Boolean(d && d.builder_id === id && d.expires_at.getTime() > now.getTime());
}

/**
 * tell update { text }: the builder's news as their post (post-moments.ts newsCandidate: checked as an update is; 24
 * hours apart). Null when no post is drafted (the update's own reply stands). Never throws.
 */
export async function newsPost(id: number, text: unknown, now: Date): Promise<Record<string, unknown> | null> {
  // Fix round: new words after a yes to the news post's "Want to change any words?" (the ask marked reword) reword that draft in place:
  // the same moment key, code and link, never a second news post.
  const open = await openPostAsk(id).catch(logged('open ask'));
  if (open?.reword && (open.moment as MomentCandidate).moment === 'news' && (await latestLive(id, open.code, now).catch(() => false))) {
    const reworded = await rewordNews(id, open, text, now).catch(logged('reword'));
    if (reworded) return reworded;
  }
  const c = await newsCandidate(id, text, now).catch(logged('news'));
  if (!c || typeof c === 'string') return null;
  return draftedReply(id, c, true, now);
}

/** The news post `open` in the builder's new words (checked as an update and as a note is), its ask kept. Null: not usable. */
async function rewordNews(id: number, open: PostAsk, text: unknown, now: Date): Promise<Record<string, unknown> | null> {
  const handle = await handleOf(id);
  const own = await (await import('./updates')).ownLinks(id);
  const checked = checkUpdate(text, own);
  if (!handle || !checked.ok) return null;
  const post = writePost({ moment: 'news', note: checked.text }, []);
  if (!post) return null;
  const d = await rewordDraft(open.code, id, post.text, now);
  if (!d) return null;
  await storePostAsk(id, { ...open, reword: undefined });
  return {
    show_to_builder: postReply({ head: open.head, ...offerOf(handle, d) }, NEWS_ASK),
    move_up: { kind: 'post', project_key: open.key, agent_note: POST_NOTE },
  };
}

/**
 * tell program_status accepted, funded or won (owner ruling 3): drafted only with a proof link the agent checked
 * (proofUrlOk) for a program the builder had an entry or application in (`entered`, read before the tell was stored);
 * without the link, the builder is asked for it; for a program that lists no proof hosts or X accounts, a plain
 * acknowledgement (final review 1: no link could prove it). Null: no entry, no page or project to post for, or a limit holds it.
 * Never throws.
 */
export async function outcomePost(
  id: number, s: { program_id: string; status: 'accepted' | 'funded' | 'won'; proof_url?: unknown }, o: { entered: boolean }, now: Date,
): Promise<Record<string, unknown> | null> {
  // Fix round: never an amount the agent states (prize_usd is not read here); the award is the announced one only.
  const c = await verifiedOutcomeCandidate(id, { programId: s.program_id, result: s.status, proofUrl: s.proof_url, entered: o.entered }).catch(logged('outcome'));
  if (c === 'no_proof') return { show_to_builder: PROOF_ASK, agent_note: PROOF_NOTE };
  // Final review 1: the program lists no proof hosts or X accounts, so no link could prove it: a plain acknowledgement.
  if (c === 'no_proof_source') return { show_to_builder: OUTCOME_NOTED };
  if (!c || typeof c === 'string') return null;
  return draftedReply(id, c, false, now);
}

/**
 * The yes to "Want a different version?": the stored moment drafted again with the next shape (asked by the builder,
 * so the asked limit holds), only for the person's latest draft within its 14-day life. Its reply asks again; when no
 * new version can be written (the limit, or no other wording) the post they have stays, its link the reply's one link.
 * The yes to "Want to change any words?" (the builder's news) asks for their words (NEWS_REWORD_NOTE). Never throws.
 */
export async function redraftAnswer(id: number, ask: { key: string | null; code?: unknown; head?: unknown; moment?: unknown }, now: Date): Promise<Record<string, unknown> | null> {
  const c = ask.moment as MomentCandidate | undefined;
  if (!c || typeof c !== 'object' || typeof c.momentKey !== 'string' || typeof ask.code !== 'string' || typeof ask.head !== 'string') return null;
  const handle = await handleOf(id);
  if (!handle) return null;
  // Fix round: only the latest draft, within its 14-day life.
  if (!(await latestLive(id, ask.code, now).catch(() => false))) return null;
  // The builder's own news: their new words (tell update), the same draft reworded; the ask stays open for them.
  if (c.moment === 'news') {
    await storePostAsk(id, { kind: 'post', key: c.projectKey, code: ask.code, head: ask.head, moment: c, reword: true });
    return { show_to_builder: '', agent_note: NEWS_REWORD_NOTE };
  }
  const d = await draftMoment(id, c, { asked: true }, now).catch(logged('redraft'));
  if (d?.ok) {
    await storePostAsk(id, { kind: 'post', key: c.projectKey, code: d.draft.code, head: ask.head, moment: c });
    return {
      show_to_builder: postReply({ head: ask.head, ...offerOf(handle, d.draft) }, POST_ASK),
      move_up: { kind: 'post', project_key: c.projectKey, agent_note: POST_NOTE },
    };
  }
  const why = d && !d.ok && d.reason === 'no_post' ? 'only' : 'limit';
  return { show_to_builder: redraftLine(why, shortLink(handle, ask.code)) };
}
