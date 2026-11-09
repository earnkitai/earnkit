/**
 * What moved since this installation's last find: programs new and shown, changes to programs
 * shown or in the owner's ledger (from program_changes), and shown ready programs closing within
 * 7 days. Empty on the first find.
 */
import { sql } from './db';
import { closeDay } from './deadline';
import { programsById, type ProgramRow } from './programs';

export type Since = {
  /** The last find this is measured from (ISO), or null on the first find. */
  from: string | null;
  new: { program_id: string; title: string }[];
  changed: { program_id: string; title: string; what: string }[];
  closing: { program_id: string; title: string; closes_at: string }[];
};

const DAY = 86_400_000;
const FORM_FIELDS = ['form', 'submission_url', 'submission_requirements'];

/** "Nov 20": the close day in the program's zone, else in UTC. Pure. */
function dayOf(p: ProgramRow['file']): string | null {
  if (!p.ends_at) return null;
  return closeDay(p) ?? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(p.ends_at));
}

/** The changed fields in builder words; `firstOpen`: no status change before this one, so it was never open (C33). Pure. */
function whatOf(p: ProgramRow['file'], fields: Set<string>, firstOpen: boolean): string | null {
  if (fields.has('status') && p.status === 'closed') return 'closed';
  const out: string[] = [];
  if (fields.has('status') && p.status === 'active') out.push(firstOpen ? 'now open' : 'open again');
  if (fields.has('ends_at')) out.push(p.ends_at ? `deadline moved to ${dayOf(p)}` : 'no deadline now');
  if (fields.has('max_award_usd')) out.push('amount changed');
  if (FORM_FIELDS.some((f) => fields.has(f))) out.push('form changed');
  return out.length > 0 ? out.join(', ') : null;
}

export async function since(
  owner: string,
  lastFindAt: Date | null,
  programs: ProgramRow[],
  ready: string[],
  now: Date,
  gaps: string[] = [],
): Promise<Since> {
  if (!lastFindAt) return { from: null, new: [], changed: [], closing: [] };
  const byId = new Map(programs.map((p) => [p.id, p]));
  const shown = new Set([...ready, ...gaps]);

  const applied = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM applications WHERE owner = ${owner} AND status <> 'skipped'`;
  const watched = new Set([...shown, ...applied.map((r) => r.program_id)]);
  const rows = await sql()<{ program_id: string; fields: string[] }[]>`
    SELECT program_id, fields FROM program_changes
    WHERE at > ${lastFindAt} AND program_id = ANY(${[...watched]}) ORDER BY at DESC`;
  const fieldsOf = new Map<string, Set<string>>();
  for (const r of rows) {
    const s = fieldsOf.get(r.program_id) ?? new Set<string>();
    for (const f of r.fields) s.add(f);
    fieldsOf.set(r.program_id, s);
  }
  for (const p of await programsById([...fieldsOf.keys()].filter((id) => !byId.has(id)))) byId.set(p.id, p);

  const fresh = (id: string) => (byId.get(id)?.created_at.getTime() ?? 0) > lastFindAt.getTime();
  // v6.1.7 C33: a program whose only status change is the one that opened it was upcoming (or closed) since it was
  // created, never active: it is "now open". An earlier status change means it was open before: "open again".
  const opened = [...fieldsOf].filter(([, f]) => f.has('status')).map(([id]) => id);
  const statusChanges = new Map(
    opened.length === 0 ? [] : (await sql()<{ program_id: string; n: number }[]>`
      SELECT program_id, count(*)::int AS n FROM program_changes
      WHERE program_id = ANY(${opened}) AND 'status' = ANY(fields) AND at <= ${now} GROUP BY program_id`).map((r) => [r.program_id, r.n]),
  );
  const changed: Since['changed'] = [];
  for (const [id, fields] of fieldsOf) {
    const p = byId.get(id);
    const what = p && !fresh(id) ? whatOf(p.file, fields, (statusChanges.get(id) ?? 0) <= 1) : null;
    if (p && what) changed.push({ program_id: id, title: p.file.title, what });
  }
  const closing: Since['closing'] = [];
  for (const id of ready) {
    const e = byId.get(id)?.file.ends_at;
    const t = e ? Date.parse(e) : NaN;
    if (t > now.getTime() && t <= now.getTime() + 7 * DAY) closing.push({ program_id: id, title: byId.get(id)!.file.title, closes_at: new Date(t).toISOString() });
  }
  return {
    from: lastFindAt.toISOString(),
    new: [...shown].filter((id) => byId.has(id) && fresh(id)).map((id) => ({ program_id: id, title: byId.get(id)!.file.title })),
    changed,
    closing,
  };
}
