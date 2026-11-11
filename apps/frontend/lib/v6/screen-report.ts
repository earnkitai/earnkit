/**
 * The pilot's two files for a program: `markdownReport` (totals, one section per tier with each applicant's
 * line, rows, flags and problems, then what could not be read) and `csvReport` (one row per applicant).
 * Public evidence only: a pitch is never written. Pure.
 */
import type { Applicant } from './applicants';
import type { Evidence } from './evidence';
import type { Placement, Tier } from './tiers';
import { ruleWords } from './tier-words';

/** `result` and `amount` (L22-12, v6.1.16): the program's outcome for the applicant and its money in the one format, when posted. */
export type ScreenRow = { applicant: Applicant; evidence: Evidence | null; placement: Placement; line: string; result?: string | null; amount?: string | null };

/** The order a reviewer reads: the strongest first, flagged before the ones with nothing to read. */
export const ORDER: Tier[] = ['used', 'live', 'building', 'flagged', 'unverified'];
const NO_TIER = 'no tier';
const tierOf = (r: ScreenRow) => r.placement.tier ?? NO_TIER;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Every note segment saying something was not read, from the evidence's notes and each block's note. Pure. */
function notRead(e: Evidence | null): string[] {
  if (!e) return [];
  const notes = [...e.notes, e.live.note, e.code?.note, e.team?.note, ...e.onchain.map((c) => c.note)];
  const segs = notes.flatMap((n) => (n ? n.split('; ') : []));
  return [...new Set(segs.filter((s) => /(^|\s)not read\b/.test(s)))];
}

/** The markdown report for `program` on `now`'s date. Pure. */
export function markdownReport(program: string, rows: ScreenRow[], now: Date): string {
  const groups = [...ORDER, NO_TIER].map((t) => ({ t, rows: rows.filter((r) => tierOf(r) === t) }));
  const out: string[] = [`# ${program} screening, ${now.toISOString().slice(0, 10)}`, ''];
  out.push(
    `${rows.length} applicants, each placed by what EarnKit could read in public: the site, the public repo and mainnet contracts. Read ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
  );
  out.push('## Totals', '', '| tier | count |', '|---|---|');
  for (const g of groups) if (g.t !== NO_TIER || g.rows.length) out.push(`| ${g.t} | ${g.rows.length} |`);
  out.push(`| all | ${rows.length} |`, '');

  for (const g of groups) {
    if (!g.rows.length) continue;
    out.push(`## ${g.t} (${g.rows.length})`, '');
    for (const r of g.rows) {
      const a = r.applicant;
      out.push(`### ${oneLine(a.name)} (${oneLine(a.ref)})`, '', r.line);
      const bullets = [
        // A flag's detail opens `because`; it is shown once, as the flag.
        ...r.placement.because.filter((b) => !r.placement.flags.some((f) => f.detail === b)),
        ...r.placement.flags.map((f) => `flag: ${ruleWords(f.rule)}, ${f.detail}`),
        ...a.problems.map((p) => `problem: ${p}`),
        ...(r.evidence?.repo ? [`repo: ${r.evidence.repo}`] : []),
        ...(r.evidence?.live.url ? [`site: ${r.evidence.live.url}`] : []),
      ];
      out.push(...bullets.map((b) => `- ${oneLine(b)}`), '');
    }
  }

  out.push('## What EarnKit could not read', '');
  const unread = new Map<string, string[]>();
  for (const r of rows) for (const n of notRead(r.evidence)) unread.set(n, [...(unread.get(n) ?? []), oneLine(r.applicant.ref)]);
  if (!unread.size) out.push('Everything listed was read.');
  else for (const [n, refs] of unread) out.push(`- ${n}: ${refs.join(', ')}`);
  return `${out.join('\n').trimEnd()}\n`;
}

const HEADER = [
  // #15 (v6.1.15): outside_senders_90d names the count; funded_senders_90d carries the same value. alias until v6.1.16
  'ref', 'name', 'tier', 'result', 'amount', 'flags', 'outside_senders_90d', 'funded_senders_90d', 'senders_90d', 'chains_mainnet', 'last_push_at', 'contributors_90d',
  'template_name', 'template_overlap', 'own_share', 'url_ok', 'line', 'problems',
];

/** One CSV cell: a leading = + - @ is defused for spreadsheets, then quoted when it holds a comma, quote or newline. Pure. */
function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The CSV report: the header and one row per applicant. Pure. */
export function csvReport(rows: ScreenRow[]): string {
  const lines = [HEADER.join(',')];
  for (const r of rows) {
    const e = r.evidence;
    const mainnet = (e?.onchain ?? []).filter((c) => c.mainnet === true && c.is_contract === true && c.counted === true);
    const top = [...mainnet].sort((x, y) => (y.funded_senders_90d ?? -1) - (x.funded_senders_90d ?? -1) || (y.senders_90d ?? -1) - (x.senders_90d ?? -1))[0];
    lines.push(
      [
        r.applicant.ref, r.applicant.name, r.placement.tier ?? NO_TIER, r.result ?? null, r.amount ?? null, [...new Set(r.placement.flags.map((f) => f.rule))].join(' '),
        top?.funded_senders_90d, top?.funded_senders_90d /* alias until v6.1.16 */, top?.senders_90d, e?.depth?.chains_mainnet.join(' '), e?.code?.last_push_at,
        e?.team?.contributors_90d, e?.code?.template_name, e?.code?.template_overlap, e?.code?.own_share, e?.live.url_ok,
        r.line, r.applicant.problems.join('; '),
      ].map(cell).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
