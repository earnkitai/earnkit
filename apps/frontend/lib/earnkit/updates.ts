import { sql } from './db';
import { noteEvent } from './events';
import { CONFIRMED_PROOFS } from './confirmed';
import { HOST_ZONE } from './hosting';
import { REPO_KEY, mainConfirmed, mainProjectOf } from './main-project';
import { pageUrl } from './reserved-routes';
import { checkUpdate, type OwnLinks } from './update-text';
import { weekFactsFor } from './week-facts';
import { mondayOf, weekOfMonday } from './weeks';

/**
 * v2.13 spec "3. Every week: the ship log": the agent posts one paragraph a week for the person's
 * one project; EarnKit checks it (update-text.ts), stores it on that week's row with the facts it
 * checked, and lets the builder hide a week or turn posting off. `builderId` is the group root.
 * Only a one project that passes the Bench gate (mainConfirmed), and only a row this builder holds:
 * the first confirmed owner of a shared repo keeps its ship log (T4 ruling).
 */
export type Reply = { show_to_builder: string; agent_note?: string; schedule_weekly_update?: string };
export const UPDATE_LINES = {
  posted: "Posted this week's update.",
  postedAt: (link: string) => `Posted this week's update: ${link}`,
  changed: "Changed this week's update.",
  hidden: 'Hidden from your page.',
  on: "Done. I'll post what you ship here every week.",
  off: "Okay, I've stopped posting updates.",
} as const;
export const NOT_CONFIRMED_NOTE = "The project isn't confirmed as theirs yet, so there is nothing to post to. Push the proof line from find first. Don't show this note.";
/** F2: a shared repo's week another builder holds (the first confirmed owner keeps the ship log). */
export const HELD_NOTE = "Another builder already posts this repo's weekly updates, so there is nothing to post here. Don't show this note.";
export const HIDE_DATE_NOTE = "hide takes a date, YYYY-MM-DD, any day of that week. Don't show this note.";
export const HIDE_NONE_NOTE = "There is no update that week. Don't show this note.";
export const WEEKLY_UPDATE_NOTE =
  'Once, if you can run scheduled tasks: schedule a weekly task (Mondays) in this project folder that reads git log for the past week and what you deployed, ' +
  'writes one plain paragraph (at most 280 characters, links only to the live site or the repo) and calls tell with update: { text }. ' +
  "Then call tell with updates: { on: true, scheduled: true }. Never ask the builder to write it. Don't show this note.";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fix round 1 (ruling on review 5): the links an update may hold. Only the origins of the one
 * project's CONFIRMED site sources, its EarnKit-hosted <slug>.earnkit.com site, and its GitHub repo
 * when the one project is a confirmed repo key. Never builder_projects.link (it may be an unproven
 * site) and never a package registry.
 */
export async function ownLinks(builderId: number): Promise<OwnLinks> {
  const key = await mainProjectOf(builderId);
  if (!key) return { sites: [], repo: null };
  const sites = await sql()<{ ref: string }[]>`
    SELECT ref FROM builder_sources WHERE builder_id = ${builderId} AND kind = 'site' AND state = 'verified'
      AND proof = ANY(${[...CONFIRMED_PROOFS]}::text[]) AND lower(project_key) = lower(${key})`;
  const hosted = await sql()<{ slug: string }[]>`
    SELECT h.slug FROM hosted_sites h JOIN installations i ON i.id = h.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND lower(h.repo_key) = lower(${key}) AND h.status = 'live'`;
  const origins = [...sites.map((s) => s.ref), ...hosted.map((h) => `https://${h.slug}.${HOST_ZONE}`)]
    .map((r) => (URL.canParse(r) ? r : `https://${r}`))
    .filter((r) => URL.canParse(r) && new URL(r).protocol === 'https:')
    .map((r) => new URL(r).origin);
  const repo = REPO_KEY.test(key.toLowerCase()) && (await mainConfirmed(builderId)) ? key.toLowerCase() : null;
  return { sites: [...new Set(origins)], repo };
}

export async function postUpdate(builderId: number, text: unknown, now: Date): Promise<Reply> {
  const key = await mainProjectOf(builderId);
  if (!key || !(await mainConfirmed(builderId))) return { show_to_builder: '', agent_note: NOT_CONFIRMED_NOTE };
  const checked = checkUpdate(text, await ownLinks(builderId));
  if (!checked.ok) return { show_to_builder: '', agent_note: checked.note };
  const monday = mondayOf(now);
  const week = weekOfMonday(monday)!;
  // The text still posts when the facts can't be read; the Monday cron fills them in.
  const facts = await weekFactsFor(builderId, monday, now).catch((err: unknown) => {
    console.error(`[updates] weekFactsFor ${err instanceof Error ? err.name : 'error'}`);
    return {};
  });
  // Another builder's row (a shared repo) is left alone: the WHERE skips it and nothing returns.
  const [r] = await sql()<{ was: string | null }[]>`
    WITH old AS (SELECT text AS was FROM project_updates WHERE project_key = ${key} AND week = ${monday})
    INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${builderId}, ${key}, ${monday}, ${checked.text}, ${sql().json(facts as never)})
    ON CONFLICT (project_key, week) DO UPDATE SET text = EXCLUDED.text, facts = project_updates.facts || EXCLUDED.facts, hidden = false,
      edited_at = CASE WHEN project_updates.text IS NULL THEN project_updates.edited_at ELSE now() END
    WHERE project_updates.builder_id = EXCLUDED.builder_id
    RETURNING (SELECT was FROM old) AS was`;
  if (!r) return { show_to_builder: '', agent_note: HELD_NOTE };
  await noteEvent('update_posted', () => ({
    type: 'update_posted', dedupe_key: `update_posted:${key.toLowerCase()}:${week}`, installation_id: builderId, repo_key: key.toLowerCase(), detail: { week },
  }));
  if (r.was !== null) return { show_to_builder: UPDATE_LINES.changed };
  const [p] = await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${builderId} AND x_user_id IS NOT NULL`;
  return { show_to_builder: p?.handle ? UPDATE_LINES.postedAt(pageUrl(p.handle)) : UPDATE_LINES.posted };
}

export async function hideUpdate(builderId: number, day: unknown): Promise<Reply> {
  const t = typeof day === 'string' && DATE.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  if (!t || !Number.isFinite(t.getTime()) || t.toISOString().slice(0, 10) !== day) return { show_to_builder: '', agent_note: HIDE_DATE_NOTE };
  const monday = mondayOf(t);
  const key = await mainProjectOf(builderId);
  const [r] = key
    ? await sql()<{ key: string }[]>`
        UPDATE project_updates SET hidden = true WHERE builder_id = ${builderId} AND project_key = ${key} AND week = ${monday} AND text IS NOT NULL
        RETURNING project_key AS key`
    : [];
  if (!r) return { show_to_builder: '', agent_note: HIDE_NONE_NOTE };
  const week = weekOfMonday(monday)!;
  await noteEvent('update_hidden', () => ({
    type: 'update_hidden', dedupe_key: `update_hidden:${r.key.toLowerCase()}:${week}`, installation_id: builderId, repo_key: r.key.toLowerCase(), detail: { week },
  }));
  return { show_to_builder: UPDATE_LINES.hidden };
}

export async function setUpdates(builderId: number, u: { on: boolean; scheduled?: boolean }, now: Date): Promise<Reply> {
  if (!u.on) {
    // T8 fix round 1: the weekly-task note (bench-find.ts weekly_note_at) is due again once posting is back on.
    await sql()`UPDATE builder_profiles SET updates_on_at = NULL, updates_scheduled_at = NULL,
      standing_seen = COALESCE(standing_seen, '{}'::jsonb) - 'weekly_note_at' WHERE builder_id = ${builderId}`;
    return { show_to_builder: UPDATE_LINES.off };
  }
  const [p] = await sql()<{ sched: Date | null }[]>`
    UPDATE builder_profiles SET updates_on_at = COALESCE(updates_on_at, ${now}),
      updates_scheduled_at = CASE WHEN ${u.scheduled === true} THEN COALESCE(updates_scheduled_at, ${now}) ELSE updates_scheduled_at END
    WHERE builder_id = ${builderId} RETURNING updates_scheduled_at AS sched`;
  return { show_to_builder: UPDATE_LINES.on, ...(!p?.sched && { schedule_weekly_update: WEEKLY_UPDATE_NOTE }) };
}
