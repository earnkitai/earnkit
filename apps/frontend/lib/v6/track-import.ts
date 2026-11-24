/**
 * v3.8 E10 (plan item 6, "Import fixes for stale ledger rows"): the track import (scripts/track-import.mts). Reads the
 * Jenil AI ledger export (`jenil_ai.grants`) and writes one track row per grant for one owner, in the E9 state model.
 *
 * Dry run by default: the plan is made inside a READ ONLY transaction that is rolled back, as people-backfill does;
 * `--apply` writes the same plan in one transaction and is idempotent (a second run finds every row unchanged).
 *
 * A grant goes to the catalog program with its id, else the one whose source or submission link is the grant's url,
 * else it is unresolved until `--map` names its catalog program (private rows for programs outside the catalog come
 * with E8, `private_rows`, which is held; this branch writes catalog rows only). The known hard rows (`HARD_ROWS`) override the export's stage;
 * the two rows the export lacks (Delphi, Ship or Die) carry no link in any source, so they are imported only when the
 * run names their program (`--map delphi=<program id or https link>`); otherwise the summary lists them unresolved.
 * Nothing is invented: no link, no amount, no deadline zone. A date-only deadline is kept as words in the note, never
 * stored as an instant, because its zone is not known (the Fe row error).
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { type Db, sql } from '../v5/db';
import { newApplicationId } from './claims';

const Grant = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  org: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  amount_usd: z.number().nullable().optional(),
  deadline: z.string().nullable().optional(),
  stage: z.string(),
  notes: z.string().nullable().optional(),
  submitted_on: z.string().nullable().optional(),
  won_on: z.string().nullable().optional(),
  kind: z.enum(['cash', 'credits']).nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
export type Grant = z.infer<typeof Grant>;
export const ExportFile = z.object({ as_of: z.string(), source: z.literal('jenil_ai.grants'), count: z.number(), grants: z.array(Grant) });

/** What one grant becomes on the track row. */
export type Target = {
  status: 'started' | 'applied' | 'won' | 'rejected' | 'skipped';
  held: boolean;
  stage: 'found' | 'registered' | 'interview' | null;
  sent_on: string | null;
  amount_usd: number | null;
  kind: 'cash' | 'credits' | null;
  note: string;
};

/** The export's stages: what each becomes. `duplicate` is not imported. */
export function targetOf(g: Grant): Target | null {
  const kind = g.kind ?? null;
  const base = { held: false, stage: null, sent_on: null, amount_usd: null, kind, note: noteOf(g) } as const;
  switch (g.stage) {
    case 'found':
    case 'researching':
      return { ...base, status: 'started', held: true, stage: 'found' };
    case 'drafting':
    case 'held':
      return { ...base, status: 'started', held: true };
    case 'registered':
      return { ...base, status: 'started', held: true, stage: 'registered' };
    case 'submitted':
      return { ...base, status: 'applied', sent_on: g.submitted_on ?? null };
    case 'interview':
      return { ...base, status: 'applied', stage: 'interview', sent_on: g.submitted_on ?? null };
    case 'accepted':
    case 'won':
      // Credits are not dollars: a credits win keeps no amount (the note says what was granted).
      return { ...base, status: 'won', sent_on: g.submitted_on ?? null, amount_usd: kind === 'cash' ? (g.amount_usd ?? null) : null };
    case 'rejected':
      return { ...base, status: 'rejected', sent_on: g.submitted_on ?? null };
    default:
      return null;
  }
}

const noteOf = (g: Grant): string =>
  [`Imported from Jenil AI ledger (${g.id}, ${g.stage}).`, g.kind === 'credits' && g.amount_usd ? `Credits, about $${g.amount_usd} in value.` : '',
    g.deadline ? `Deadline ${g.deadline} (date only, zone not given).` : ''].filter(Boolean).join(' ').slice(0, 280);

/**
 * The hard rows (plan v3.8 section 10, cutover check 4): what Jenil AI's ledger has wrong or lacks, as of Nov 24 2026.
 * `missing` rows are not in the export and need their program named by `--map`.
 */
export const HARD_ROWS: { id: string; name: string; fix: (t: Target) => Target; missing?: true }[] = [
  { id: 'fe-builders-challenge', name: 'Fe Builders Challenge', fix: (t) => ({ ...t, status: 'skipped', held: false, stage: null, sent_on: null, note: 'Registered only (FE-041), never submitted; skipped by Jenil on Nov 24.' }) },
  { id: 'paypal-ai-hackathon-allowance', name: 'PayPal AI Hackathon (Allowance)', fix: (t) => ({ ...t, status: 'applied', held: false, stage: null, sent_on: '2026-11-12', note: 'Submitted Nov 12 (the export still said held).' }) },
  { id: 'tavily-startups', name: 'Tavily for Startups', fix: (t) => ({ ...t, kind: 'credits', amount_usd: t.status === 'won' ? null : t.amount_usd, note: `${t.note} Kind: credits, not cash.`.slice(0, 280) }) },
  { id: 'aiven-startups', name: 'Aiven for Startups', fix: (t) => ({ ...t, status: 'applied', held: false, stage: 'interview', note: 'At interview (the export still said found).' }) },
  { id: 'soonami-venturethon', name: 'soonami Venturethon 11', fix: (t) => ({ ...t, status: 'applied', held: false, stage: 'interview', amount_usd: null, note: 'In progress: accepted into the cohort Nov 16; not a win.' }) },
  { id: 'delphi', name: 'Delphi', missing: true, fix: (t) => ({ ...t, status: 'skipped', held: false, stage: null, note: 'Skipped; imported without its build brief.' }) },
  { id: 'ship-or-die', name: 'Ship or Die', missing: true, fix: (t) => ({ ...t, status: 'applied', held: false, stage: null, note: 'Already entered with Pip & Crew; do not re-enter.' }) },
];

const BLANK: Target = { status: 'started', held: true, stage: null, sent_on: null, amount_usd: null, kind: null, note: '' };

export type Line = {
  grant: string; name: string; program_id: string | null;
  action: 'create' | 'update' | 'unchanged' | 'not_imported' | 'unresolved';
  status?: string; stage?: string | null; why?: string; hard?: true;
};
export type Summary = { as_of: string; grants: number; create: number; update: number; unchanged: number; not_imported: number; unresolved: number; hard_rows: number };
type Planned = Line & { target?: Target };

const slugUrl = (u: string | null | undefined) => (u ? u.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() : '');

/** The plan: every grant's line, made with reads only. */
export async function plan(db: Db, owner: string, file: z.infer<typeof ExportFile>, map: Record<string, string>): Promise<{ summary: Summary; lines: Planned[] }> {
  const programs = await db<{ id: string; source_url: string | null; submission_url: string | null }[]>`
    SELECT id, file->>'source_url' AS source_url, file->>'submission_url' AS submission_url FROM programs`;
  const ids = new Set(programs.map((p) => p.id));
  const byUrl = new Map<string, string>();
  for (const p of programs) for (const u of [p.source_url, p.submission_url]) if (u && !byUrl.has(slugUrl(u))) byUrl.set(slugUrl(u), p.id);
  const existing = await db<{ program_id: string; status: string; held_at: Date | null; stage: string | null; sent_at: Date | null; amount_usd: string | null; note: string | null }[]>`
    SELECT DISTINCT ON (program_id) program_id, status, held_at, stage, sent_at, amount_usd, note FROM applications WHERE owner = ${owner}
    ORDER BY program_id, at DESC`;
  const have = new Map(existing.map((r) => [r.program_id, r]));
  const hard = new Map(HARD_ROWS.map((h) => [h.id, h]));

  const items: { g: Grant | null; id: string; name: string; target: Target | null; hard: boolean }[] = file.grants.map((g) => {
    const h = hard.get(g.id);
    const t = targetOf(g);
    return { g, id: g.id, name: g.name, target: t && h ? h.fix(t) : t, hard: !!h };
  });
  for (const h of HARD_ROWS) if (h.missing && !file.grants.some((g) => g.id === h.id)) items.push({ g: null, id: h.id, name: h.name, target: h.fix(BLANK), hard: true });

  const lines: Planned[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const hardMark = it.hard ? { hard: true as const } : {};
    if (!it.target) {
      lines.push({ grant: it.id, name: it.name, program_id: null, action: 'not_imported', why: `stage ${it.g?.stage}`, ...hardMark });
      continue;
    }
    const mapped = map[it.id];
    const url = mapped?.startsWith('https://') ? mapped : it.g?.url ?? null;
    const programId = mapped && !mapped.startsWith('https://') ? mapped : ids.has(it.id) ? it.id : byUrl.get(slugUrl(url)) ?? null;
    if (programId && !ids.has(programId)) {
      lines.push({ grant: it.id, name: it.name, program_id: programId, action: 'unresolved', why: '--map names no catalog program', ...hardMark });
      continue;
    }
    if (!programId) {
      lines.push({ grant: it.id, name: it.name, program_id: null, action: 'unresolved', why: 'no catalog program: pass --map', ...hardMark });
      continue;
    }
    if (seen.has(programId)) {
      lines.push({ grant: it.id, name: it.name, program_id: programId, action: 'not_imported', why: 'another grant in the export is this program', ...hardMark });
      continue;
    }
    seen.add(programId);
    const t = it.target;
    const cur = have.get(programId);
    const same = cur && cur.status === t.status && !!cur.held_at === t.held && (cur.stage ?? null) === t.stage
      && (cur.amount_usd === null ? null : Number(cur.amount_usd)) === t.amount_usd && (cur.note ?? '') === t.note;
    lines.push({
      grant: it.id, name: it.name, program_id: programId, action: !cur ? 'create' : same ? 'unchanged' : 'update',
      status: t.held ? 'held' : t.status, stage: t.stage, target: t, ...hardMark,
    });
  }
  const count = (a: Line['action']) => lines.filter((l) => l.action === a).length;
  return {
    summary: {
      as_of: file.as_of, grants: file.grants.length, create: count('create'), update: count('update'), unchanged: count('unchanged'),
      not_imported: count('not_imported'), unresolved: count('unresolved'),
      hard_rows: lines.filter((l) => l.hard).length,
    },
    lines,
  };
}

/** Writes the plan's create and update lines (one row per program, no project), each with one history line. */
async function applyPlan(tx: Db, owner: string, installationId: number, lines: Planned[], now: Date): Promise<void> {
  for (const l of lines) {
    if ((l.action !== 'create' && l.action !== 'update') || !l.target || !l.program_id) continue;
    const t = l.target;
    const sentAt = t.sent_on ? new Date(`${t.sent_on}T00:00:00Z`) : null;
    const amounts = t.amount_usd !== null ? tx.json({ USD: t.amount_usd }) : null;
    const proof = t.status === 'applied' || t.status === 'won' || t.status === 'rejected' ? tx.json({ confirmation: `Jenil AI ledger ${l.grant}${t.sent_on ? `, submitted ${t.sent_on}` : ''}` }) : null;
    const cur = await tx<{ ctid: string }[]>`SELECT ctid::text FROM applications WHERE owner = ${owner} AND program_id = ${l.program_id} ORDER BY at DESC LIMIT 1`;
    if (cur.length > 0) {
      await tx`UPDATE applications SET status = ${t.status}, held_at = ${t.held ? now : null}, stage = ${t.stage}, amount_usd = ${t.amount_usd},
        amounts = ${amounts}, note = ${t.note}, at = ${now}, title = ${l.name}, proof = COALESCE(${proof}, proof),
        sent_at = COALESCE(${sentAt}, sent_at), submitted_by = CASE WHEN ${t.status} = 'started' OR ${t.status} = 'skipped' THEN submitted_by ELSE COALESCE(submitted_by, 'builder') END,
        claimed_at = NULL, claimed_by = NULL
        WHERE ctid = ${cur[0].ctid}::tid`;
    } else {
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, amounts, note, at, title, submitted_by, sent_at, held_at, stage, proof, application_id)
        VALUES (${owner}, ${installationId}, ${l.program_id}, ${t.status}, ${t.amount_usd}, ${amounts}, ${t.note}, ${now}, ${l.name},
          ${t.status === 'started' || t.status === 'skipped' ? null : 'builder'}, ${sentAt}, ${t.held ? now : null}, ${t.stage}, ${proof}, ${newApplicationId()})`;
    }
    await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at, source)
      VALUES (${owner}, ${installationId}, ${l.program_id}, ${t.held ? 'held' : t.status}, ${t.amount_usd}, ${t.note}, ${now}, 'import')`;
  }
}

/** The installation an import's rows are filed under: the owner's newest. */
async function installationOf(db: Db, owner: string): Promise<number | null> {
  if (owner.startsWith('i:')) return Number(owner.slice(2)) || null;
  const id = Number(owner.slice(2));
  const [r] = await db<{ id: number }[]>`SELECT id FROM installations WHERE builder_id = ${id} OR former_builder_id = ${id} ORDER BY id DESC LIMIT 1`;
  return r?.id ?? null;
}

class DryRun extends Error {}

/** `--file <export.json> --owner <b:id | i:id> [--map grant=program_id|https-link]... [--apply]`. */
export async function main(argv: string[], out: (s: string) => void = console.log, now: Date = new Date()): Promise<{ summary: Summary; lines: Line[] }> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const apply = argv.includes('--apply');
  const path = arg('--file');
  const owner = arg('--owner') ?? '';
  if (!path) throw new Error('--file takes the export JSON path');
  if (!/^[bi]:\d+$/.test(owner)) throw new Error('--owner takes b:<builder id> or i:<installation id>');
  const map: Record<string, string> = {};
  argv.forEach((a, i) => {
    if (a !== '--map') return;
    const [k, v] = (argv[i + 1] ?? '').split('=');
    if (!k || !v) throw new Error('--map takes grant=program_id or grant=https://link');
    map[k] = v;
  });
  const file = ExportFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  let result!: { summary: Summary; lines: Planned[] };
  const work = async (tx: Db) => {
    result = await plan(tx, owner, file, map);
    if (!apply) return;
    const inst = await installationOf(tx, owner);
    if (inst === null) throw new Error(`no installation for ${owner}: nothing written`);
    await applyPlan(tx, owner, inst, result.lines, now);
  };
  if (apply) await sql().begin(work);
  else await sql().begin('read only', async (tx) => { await work(tx); throw new DryRun(); }).catch((e) => { if (!(e instanceof DryRun)) throw e; });
  const lines: Line[] = result.lines.map(({ target: _t, ...l }) => l);
  out(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', owner, ...result.summary }, null, 2));
  for (const l of lines) out(JSON.stringify(l));
  return { summary: result.summary, lines };
}
