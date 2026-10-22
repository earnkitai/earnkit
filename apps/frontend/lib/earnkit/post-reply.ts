import { sql } from './db';
import { siteUrl } from './entry-text';
import { POST_ASK, PROOF_ASK, eventHead, postReply, redraftLine, type EventPost, type PostOffer } from './bench-reply';
import type { DraftRow } from './post-drafts';
import {
  HOT_HOURS, draftMoment, newsCandidate, offeredMoment, verifiedOutcomeCandidate, weeklyCandidate, type MomentCandidate,
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

/** The ask a post reply stores (standing_seen.bench_ask): its yes redrafts this moment. */
type PostAsk = { kind: 'post'; key: string | null; code: string; head: string; moment: MomentCandidate };
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
 * An event's post (an announced win, going live, the coin's intro: offeredMoment without the weekly), drafted and
 * stored as the reply's ask. `hot`: only went live or won under HOT_HOURS (they go before the apply step); else any.
 * Null: none, or a limit holds it. Never throws.
 */
export async function eventPost(id: number, handle: string, now: Date, o: { hot: boolean }): Promise<(EventPost & { hot: boolean }) | null> {
  const r = await offeredMoment(id, now, { weekly: false }).catch(logged('event'));
  const c = r?.moment;
  if (!c) return null;
  const hot = isHot(c, now);
  if (o.hot && !hot) return null;
  const d = await draftMoment(id, c, { asked: false }, now).catch(logged('event draft'));
  if (!d?.ok) return null;
  const head = eventHead(c, now);
  await storePostAsk(id, { kind: 'post', key: c.projectKey, code: d.draft.code, head, moment: c });
  return { head, ...offerOf(handle, d.draft), hot };
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
    show_to_builder: postReply({ head, ...offerOf(handle, d.draft) }, POST_ASK),
    move_up: { kind: 'post', project_key: c.projectKey, agent_note: POST_NOTE },
  };
}

/**
 * tell update { text }: the builder's news as their post (post-moments.ts newsCandidate: checked as an update is; 24
 * hours apart). Null when no post is drafted (the update's own reply stands). Never throws.
 */
export async function newsPost(id: number, text: unknown, now: Date): Promise<Record<string, unknown> | null> {
  const c = await newsCandidate(id, text, now).catch(logged('news'));
  if (!c || typeof c === 'string') return null;
  return draftedReply(id, c, true, now);
}

/**
 * tell program_status accepted, funded or won (owner ruling 3): drafted only with a proof link the agent checked
 * (proofUrlOk); without one, the builder is asked for it. Null: no page or project to post for, or a limit holds it.
 * Never throws.
 */
export async function outcomePost(
  id: number, s: { program_id: string; status: 'accepted' | 'funded' | 'won'; proof_url?: unknown; prize_usd?: number }, now: Date,
): Promise<Record<string, unknown> | null> {
  const c = await verifiedOutcomeCandidate(id, { programId: s.program_id, result: s.status, proofUrl: s.proof_url, awardUsd: s.prize_usd ?? null }).catch(logged('outcome'));
  if (c === 'no_proof') return { show_to_builder: PROOF_ASK, agent_note: PROOF_NOTE };
  if (!c || typeof c === 'string') return null;
  return draftedReply(id, c, false, now);
}

/**
 * The yes to "Want a different version?": the stored moment drafted again with the next shape (asked by the builder,
 * so the asked limit holds). Its reply asks again; when no new version can be written (the limit, or no other wording)
 * the post they have stays, its link the reply's one link. Never throws.
 */
export async function redraftAnswer(id: number, ask: { key: string | null; code?: unknown; head?: unknown; moment?: unknown }, now: Date): Promise<Record<string, unknown> | null> {
  const c = ask.moment as MomentCandidate | undefined;
  if (!c || typeof c !== 'object' || typeof c.momentKey !== 'string' || typeof ask.code !== 'string' || typeof ask.head !== 'string') return null;
  const handle = await handleOf(id);
  if (!handle) return null;
  const d = await draftMoment(id, c, { asked: true }, now).catch(logged('redraft'));
  if (d?.ok) {
    await storePostAsk(id, { kind: 'post', key: c.projectKey, code: d.draft.code, head: ask.head, moment: c });
    return {
      show_to_builder: postReply({ head: ask.head, ...offerOf(handle, d.draft) }, POST_ASK),
      move_up: { kind: 'post', project_key: c.projectKey, agent_note: POST_NOTE },
    };
  }
  const why = d && !d.ok && d.reason === 'no_post' ? (c.moment === 'news' ? 'own_words' : 'only') : 'limit';
  return { show_to_builder: redraftLine(why, shortLink(handle, ask.code)) };
}
