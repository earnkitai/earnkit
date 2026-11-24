/**
 * v3.8 E8 (plan item 5, cutover A3): private program rows. A program that cannot pass the public official-page check
 * (apply by email, a thin client-rendered page, a form the official page does not link) is saved by a builder's agent
 * as visible to that owner only, so `track` can still point at it.
 *
 * Private rows live in their own table, `private_programs`, keyed by (owner, id). No public read (lists, guides, the
 * sitemap, llms.txt, find's catalog, the programs API, the owner digest) queries that table, so a private row cannot
 * leak by a missing filter; `private-rows.test.ts` checks every public read anyway. A private row is never submitted
 * by an agent: track records only the builder's own send on it. Behind the `private_rows` flag.
 */
import { z } from 'zod';
import { type Db, sql } from '../v5/db';
import { LIMITS, hit } from '../v5/rate-limit';
import { PRIVATE_PREFIX, isTimeZone } from '../v5/program-file';
import { cleanText } from '../v5/controls';
import { TELL_AMOUNT } from '../v5/amount';
import { moneyText } from '../v5/programs-read';
import { refuse } from '../v5/tool-input';


/** What an agent sends to save one (`track` `action: add_private`, field `private`): only what the builder gave. */
export const PrivateProgramInput = z
  .object({
    title: z.string().trim().min(1).max(120).describe("The program's name as its page gives it"),
    url: z.string().url().max(500).refine((u) => /^https:\/\//i.test(u), 'url: an https link').describe('Where the builder found it or applies'),
    organizer: z.string().trim().min(1).max(80).optional(),
    reward: z.string().trim().min(1).max(120).optional().describe('The reward as the program states it'),
    ends_at: z.string().datetime({ offset: true }).optional().describe('The deadline with its offset, like 2026-11-25T05:29:00+05:30'),
    tz: z.string().min(1).refine(isTimeZone, 'tz: an IANA time zone like "Asia/Kolkata"').optional(),
    note: z.string().transform((x) => cleanText(x, 280)).optional(),
  })
  .strict();
export type PrivateProgramIn = z.infer<typeof PrivateProgramInput>;

/** A saved private row as track reads it. */
export type PrivateProgram = PrivateProgramIn & { id: string; owner: string };

/** Lower-case words joined by dashes, at most 60 characters. Pure. */
export const privateSlug = (title: string): string =>
  title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'program';

/** The id a title is saved under: `private-` and its slug. Pure. */
export const privateIdOf = (title: string): string => `${PRIVATE_PREFIX}${privateSlug(title)}`;

type Row = { owner: string; id: string; file: PrivateProgramIn };
const toProgram = (r: Row): PrivateProgram => ({ ...r.file, id: r.id, owner: r.owner });

/**
 * Saves (or, for the same title, updates) a private row for `owner`, counted against `LIMITS.privateRows` per owner a
 * day. A new title whose slug another of the owner's rows already uses gets `-2`, `-3` and so on. `limited` with the
 * seconds to wait when over the limit; nothing is written then.
 */
export async function savePrivate(owner: string, input: PrivateProgramIn, now: Date): Promise<{ program: PrivateProgram; created: boolean } | { limited: number }> {
  const db = sql();
  const mine = await db<Row[]>`SELECT owner, id, file FROM private_programs WHERE owner = ${owner}`;
  const same = mine.find((r) => sameTitle(r.file.title, input.title));
  if (!same) {
    const { limit, windowSeconds } = LIMITS.privateRows;
    const h = await hit(`privateRows:${owner}`, limit, windowSeconds, now);
    if (!h.allowed) return { limited: h.retryAfter };
  }
  const taken = new Set(mine.map((r) => r.id));
  const base = privateIdOf(input.title);
  let id = same?.id ?? base;
  for (let n = 2; !same && taken.has(id); n++) id = `${base}-${n}`;
  await db`INSERT INTO private_programs (owner, id, file, created_at, updated_at) VALUES (${owner}, ${id}, ${db.json(input)}, ${now}, ${now})
    ON CONFLICT (owner, id) DO UPDATE SET file = EXCLUDED.file, updated_at = EXCLUDED.updated_at`;
  return { program: { ...input, id, owner }, created: !same };
}

/** Titles compared case, accents and punctuation folded. Pure. */
const sameTitle = (a: string, b: string) => privateSlug(a) === privateSlug(b);

/** `owner`'s private row named by `name` (its id, or its title folded), or null. Never another owner's. */
export async function privateProgramOf(owner: string, name: string): Promise<PrivateProgram | null> {
  const rows = await sql()<Row[]>`SELECT owner, id, file FROM private_programs WHERE owner = ${owner} ORDER BY id`;
  const id = name.trim().toLowerCase();
  const hit = rows.find((r) => r.id === id) ?? rows.find((r) => sameTitle(r.file.title, name));
  return hit ? toProgram(hit) : null;
}

/** Every private row of `owner`, by id. */
export async function privatePrograms(owner: string): Promise<PrivateProgram[]> {
  return (await sql()<Row[]>`SELECT owner, id, file FROM private_programs WHERE owner = ${owner} ORDER BY id`).map(toProgram);
}

/** v3.8 E10: `owner`'s private rows read in `db` (a transaction: the track import's plan). */
export async function privateRowsIn(db: Db, owner: string): Promise<PrivateProgram[]> {
  return (await db<Row[]>`SELECT owner, id, file FROM private_programs WHERE owner = ${owner} ORDER BY id`).map(toProgram);
}

/** v3.8 E10: the track import's write of one private row under its own id, with no daily limit (an owner's own import). */
export async function putPrivate(db: Db, owner: string, id: string, file: PrivateProgramIn, now: Date): Promise<void> {
  const parsed = PrivateProgramInput.parse(file);
  await db`INSERT INTO private_programs (owner, id, file, created_at, updated_at) VALUES (${owner}, ${id}, ${db.json(parsed)}, ${now}, ${now})
    ON CONFLICT (owner, id) DO UPDATE SET file = EXCLUDED.file, updated_at = EXCLUDED.updated_at`;
}

/** The statuses track takes on a private row: no gap steps (it has no catalog items) and no standing-approval send. */
export const PRIVATE_STATUSES = ['started', 'held', 'applied', 'won', 'rejected', 'no_result', 'skipped', 'unskip'] as const;
type PrivateStatus = (typeof PRIVATE_STATUSES)[number];
const SENT = ['applied', 'won', 'rejected', 'no_result'];

/** What one private-row write did: `note` when nothing was written (the builder line), else `ok`. */
export type PrivateWrite = { ok: true; status: PrivateStatus } | { ok: false; note: string };

export const PRIVATE_NOT_SENT = (title: string) => `${title} isn't sent yet. Tell me once it's in.`;
export const PRIVATE_NOT_SKIPPED = (title: string) => `${title} isn't skipped.`;

/**
 * Writes `status` on `owner`'s row of private program `p` (one row per private program: no project, no round) and one
 * history line, in one transaction. A result needs a sent row; unskip needs a skipped one and removes it. `amount` is
 * the win's money (a positive number and its upper-case currency), required for won by the caller.
 */
export async function writePrivate(
  owner: string, installationId: number, p: PrivateProgram, status: PrivateStatus,
  o: { now: Date; note?: string; amount?: { value: number; currency: string } },
): Promise<PrivateWrite> {
  return sql().begin(async (tx) => {
    const [row] = await tx<{ status: string }[]>`
      SELECT status FROM applications WHERE owner = ${owner} AND program_id = ${p.id} AND project_id IS NULL FOR UPDATE`;
    if (['won', 'rejected', 'no_result'].includes(status) && !(row && SENT.includes(row.status))) return { ok: false, note: PRIVATE_NOT_SENT(p.title) } as const;
    if (status === 'unskip') {
      if (row?.status !== 'skipped') return { ok: false, note: PRIVATE_NOT_SKIPPED(p.title) } as const;
      await tx`DELETE FROM applications WHERE owner = ${owner} AND program_id = ${p.id} AND project_id IS NULL`;
    } else {
      const stored = status === 'held' ? 'started' : status;
      const usd = o.amount?.currency === 'USD' ? o.amount.value : null;
      const amounts = o.amount ? tx.json({ [o.amount.currency]: o.amount.value }) : null;
      const sentAt = status === 'applied' ? o.now : null;
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, amounts, note, at, title, submitted_by, sent_at, sent_by_installation_id, held_at)
        VALUES (${owner}, ${installationId}, ${p.id}, ${stored}, ${usd}, ${amounts}, ${o.note ?? null}, ${o.now}, ${p.title},
          ${status === 'applied' ? 'builder' : null}, ${sentAt}, ${sentAt ? installationId : null}, ${status === 'held' ? o.now : null})
        ON CONFLICT (owner, program_id, (COALESCE(project_id, ''))) DO UPDATE SET
          status = EXCLUDED.status, installation_id = EXCLUDED.installation_id, at = EXCLUDED.at, title = EXCLUDED.title,
          amount_usd = COALESCE(EXCLUDED.amount_usd, applications.amount_usd), amounts = COALESCE(EXCLUDED.amounts, applications.amounts),
          note = COALESCE(EXCLUDED.note, applications.note), submitted_by = COALESCE(applications.submitted_by, EXCLUDED.submitted_by),
          sent_at = COALESCE(applications.sent_at, EXCLUDED.sent_at), sent_by_installation_id = COALESCE(applications.sent_by_installation_id, EXCLUDED.sent_by_installation_id),
          held_at = EXCLUDED.held_at`;
    }
    await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at, source)
      VALUES (${owner}, ${installationId}, ${p.id}, ${status}, ${o.amount?.currency === 'USD' ? o.amount.value : null}, ${o.note ?? null}, ${o.now}, 'builder')`;
    return { ok: true, status } as const;
  });
}

export const PRIVATE_SAVED = (title: string) => `Saved ${title} for you only. It's on no public list, and only you send it.`;
export const PRIVATE_UPDATED = (title: string) => `Updated ${title}. It stays private to you.`;
export const PRIVATE_LIMIT = "That's today's limit for private programs. Try again tomorrow.";
export const PRIVATE_BUILDER_SENDS = (title: string) => `Only you can send ${title}. Tell me once it's in.`;
export const PRIVATE_NO_STEPS = 'A private program has no steps to mark done. Nothing was recorded.';
const NOTHING = 'Nothing was recorded.';

/** The agent's words on a saved row: its id, who sees it, who sends it. Pure. */
export const privateSavedNote = (id: string) =>
  `Private program ${id}: only this builder sees it. Track it by that id. EarnKit never submits it; the builder sends it and you call track applied with submitted_by builder.`;

type PrivateTrackIn = { status: string; submitted_by?: 'agent' | 'builder'; note?: string; amount_usd?: number; amount?: number | string; currency?: string };
type Said = { show_to_builder: string; agent_note: string; refused?: true };

/**
 * track on one of the owner's private rows (`private_rows` on): the builder line and agent note for `i.status`. A send
 * is the builder's own only (`submitted_by: builder`); an agent's send is refused, so a private row is never submitted
 * by an agent. A win takes a positive amount (amount_usd, or amount as a number with its currency).
 */
export async function trackPrivate(ctx: { installationId: number; now: Date }, owner: string, p: PrivateProgram, i: PrivateTrackIn): Promise<Said> {
  const status = (PRIVATE_STATUSES as readonly string[]).includes(i.status) ? (i.status as PrivateStatus) : null;
  if (status === null) return refuse({ show_to_builder: '', agent_note: PRIVATE_NO_STEPS });
  if (status === 'applied' && i.submitted_by !== 'builder')
    return refuse({ show_to_builder: PRIVATE_BUILDER_SENDS(p.title), agent_note: `${NOTHING} A private program is never sent by an agent. When the builder has sent it, call track applied with submitted_by builder.` });
  let amount: { value: number; currency: string } | undefined;
  if (status === 'won') {
    const value = i.amount_usd ?? (typeof i.amount === 'number' ? i.amount : Number.NaN);
    const currency = i.amount_usd !== undefined ? 'USD' : (i.currency ?? 'USD').trim().toUpperCase();
    if (!(Number.isFinite(value) && value > 0) || !/^[A-Z]{3}$/.test(currency)) return refuse({ show_to_builder: TELL_AMOUNT, agent_note: `${NOTHING} Pass amount_usd, or amount as a number with currency.` });
    amount = { value, currency };
  }
  const w = await writePrivate(owner, ctx.installationId, p, status, { now: ctx.now, note: i.note, amount });
  if (!w.ok) return refuse({ show_to_builder: w.note, agent_note: NOTHING });
  const t = p.title;
  const show = status === 'applied' ? `Sent ${t}.`
    : status === 'held' ? `Held ${t}.`
    : status === 'won' ? `Tracked: ${moneyText(amount!.value, amount!.currency)} from ${t}.`
    : status === 'rejected' ? `Noted: ${t} said no.`
    : status === 'skipped' ? `Skipped ${t}. Say unskip and I bring it back.`
    : status === 'unskip' ? `${t} is back.`
    : status === 'started' ? '' : 'Tracked.';
  return { show_to_builder: show, agent_note: `Recorded on private program ${p.id}.` };
}
