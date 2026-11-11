/**
 * The record side of find for a linked installation: the project it picks, the builder's own tier
 * (read at most once a day, else the stored one), min_tier gating, the never list, blockers
 * and what the record still lacks for the ready programs. Only find calls this. Unlinked (v6.1.3), find uses
 * only `provisionalTier`, `tierGate` and `blockersOf` against the empty record; nothing here is stored.
 */
import { NEEDS_CODE, evaluate, keywordHit, rulesOnly, type Gap, type Verdict } from '../v5/eligibility';
import { categoryOf } from '../v5/program-file';
import { dayWords } from '../v5/deadline';
import type { RecordContext } from '../v5/prefill';
import type { ProgramRow } from '../v5/programs';
import type { RepoFacts } from '../v5/repo-facts';
import { withRecord, readStoredRecord } from './builders';
import type { Evidence, Subject } from './evidence';
import { evidenceSummary, ownEvidence, usageLine } from './own-evidence';
import { PROJECT_ITEM, hasDoc, recordMissing, type BuilderRecord, type Project } from './record';
import { ADD_PROJECT, confirmLine, EVIDENCE_NOT_READ, NO_RECORD_PROJECT, PROOF_READING } from './reply-words';
import { currentBuilderLine } from './tier-words';
import { TIERS, place, type Tier } from './tiers';

export { EVIDENCE_NOT_READ };

export type RecordSide = {
  record: BuilderRecord;
  projectId: string | null;
  verifiedUsage: string | null;
  tier: Tier | null;
  summary: { tier: string | null; line: string } | null;
  problems: string[];
  /** Task 9 fix round 1: after a failed read the summary line says so; the tier gate reads its Next from this line. */
  tier_line?: string;
};
export type Blocker = {
  program_id: string; sign_in: string | null; needs_click: boolean; needs: string[];
  /** With auto_apply: outside the standing approval's categories or max_ask_usd, so the builder says yes to it. */
  outside_approval?: true;
  /** L13-10 (v6.1.14): outside it only by its award, over the builder's max_ask_usd: that limit. */
  over_limit_usd?: number;
};

const sameRepo = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '') === b.toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');

const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * `project_id`, else the project whose repo is the one reported, else the one with the reported name (any case), else
 * none (v6.1.8 C41): another project's answers are never used for this one. Pure.
 */
export function pickProject(record: BuilderRecord, projectId: string | undefined, repoUrl: string | null, name?: string | null): Project | null {
  const byId = projectId ? record.projects.find((p) => p.id === projectId) : undefined;
  // L28-7 (v6.1.16 Task 14): two record projects on one repo (a monorepo) and no project_id: neither, never one for the other.
  if (!byId && sharedRepoProjects(record, projectId, repoUrl).length >= 2) return null;
  return (
    byId ??
    record.projects.find((p) => sameRepo(p.repo_url, repoUrl)) ??
    record.projects.find((p) => sameName(p.name, name)) ??
    null
  );
}


/**
 * L28-7 (v6.1.16 Task 14): with no project_id the record knows, the names of the record projects on this repo when two
 * or more share it (each its name, else its id); else none. Pure.
 */
export function sharedRepoProjects(record: BuilderRecord, projectId: string | undefined, repoUrl: string | null): string[] {
  if (projectId && record.projects.some((p) => p.id === projectId)) return [];
  const on = record.projects.filter((p) => sameRepo(p.repo_url, repoUrl));
  return on.length >= 2 ? on.map((p) => p.name ?? p.id) : [];
}

/** The record, the picked project and its stored usage line, for one program's pre-fill (no evidence read). */
export async function storedRecordContext(builderId: number, projectId: string | undefined, repoUrl: string | null, name?: string | null): Promise<RecordContext> {
  const { record } = await readStoredRecord(builderId);
  const project = pickProject(record, projectId, repoUrl, name);
  return { record, projectId: project?.id ?? null, verifiedUsage: project?.last_tier?.usage ?? null };
}

const isTier = (t: string | undefined): t is Tier => (TIERS as readonly string[]).includes(t ?? '');

/** Loads the record and, for a project with a repo or site, the builder's own tier under the 24-hour rule. */
/** v6.1.16 Task 9 (controller ruling): days a stored tier stands after a failed re-read of the same repo. */
export const READ_GRACE_DAYS = 14;
/** The unverified tier's line a bar gap reads its step from after a failed read past the grace (fix round 1). */
const UNREAD_TIER_LINE = 'Your project is unverified, with nothing recent EarnKit could check. Next: a public repo EarnKit can read.';

export async function recordSide(
  o: { builderId: number; now: Date; projectId?: string; facts: RepoFacts; read: (s: Subject) => Promise<Evidence> },
): Promise<RecordSide> {
  const { record } = await readStoredRecord(o.builderId);
  const project = pickProject(record, o.projectId, o.facts.repo_url, o.facts.name);
  const side: RecordSide = { record, projectId: project?.id ?? null, verifiedUsage: null, tier: null, summary: null, problems: [] };
  // A project_id the record lacks is named by find itself; a project not named at all gets this note.
  if (!project && record.projects.length > 0 && o.projectId === undefined) side.problems.push(NO_RECORD_PROJECT);
  if (!project) return side;
  const stored = project.last_tier;
  if (isTier(stored?.tier)) {
    side.tier = stored.tier;
    // I1 (v6.1.15 fix round 1): a line stored before v6.1.15 reads in today's words.
    side.summary = { tier: stored.tier, line: currentBuilderLine(stored.line) };
    side.verifiedUsage = stored.usage ?? null;
  }
  if (!project.repo_url && !project.live_url) return side;
  const subject: Subject = {
    ...(project.repo_url ? { repo_url: project.repo_url } : {}),
    ...(project.live_url ? { live_url: project.live_url } : {}),
    ...(o.facts.contracts.length > 0 ? { contracts: o.facts.contracts.map((c) => ({ chain: c.chain, address: c.address })) } : {}),
  };
  // L23-14 (v6.1.16): the read failed (a `not read` repo note, or the reader threw: fix round 1, M2). Controller ruling:
  // the stored tier stands only within READ_GRACE_DAYS of its read and only for what it was read from (the same repo, or
  // no repo on either side); else the project reads unverified. Nothing is written, so evidence_read_at stays and the next
  // find tries again. With no stored tier there is nothing to keep: null, and the path goes on as before Task 9.
  const failed = (): RecordSide | null => {
    if (!stored || !side.summary) return null;
    const readAt = stored?.read_at ? Date.parse(stored.read_at) : NaN;
    const sameRepo = subject.repo_url ? stored?.repo_url === subject.repo_url : !stored?.repo_url;
    const fresh = Number.isFinite(readAt) && o.now.getTime() - readAt <= READ_GRACE_DAYS * 86_400_000;
    if (side.summary && stored && sameRepo && fresh)
      return {
        ...side,
        summary: { tier: side.summary.tier, line: `I could not read your repo today; using what I read on ${dayWords(new Date(readAt), o.now)}.` },
        tier_line: side.summary.line,
        problems: [...side.problems, EVIDENCE_NOT_READ],
      };
    return { ...side, tier: 'unverified', summary: { tier: 'unverified', line: 'I could not read your repo today.' }, tier_line: UNREAD_TIER_LINE, verifiedUsage: null, problems: [...side.problems, EVIDENCE_NOT_READ] };
  };
  let evidence: Evidence | null;
  try {
    const r = await ownEvidence(subject, { read: o.read, now: o.now, lastReadAt: project.evidence_read_at ?? null });
    if (!r.read) return side;
    evidence = r.evidence;
  } catch {
    // Nothing stored to keep: no tier, one problem, nothing written.
    return failed() ?? { ...side, problems: [...side.problems, EVIDENCE_NOT_READ] };
  }
  const notRead = evidence && subject.repo_url && evidence.code === null && evidence.notes.some((n) => n.startsWith('not read')) ? failed() : null;
  if (notRead) return notRead;
  const p = place(evidence, { identical_pitch: 0, shared_contributors: 0 }, undefined, o.now);
  const summary = evidence ? evidenceSummary(p, evidence) : null;
  const usage = evidence ? usageLine(evidence, o.now) : null;
  const at = o.now.toISOString();
  // EarnKit's own fields, written on the record directly (never through mergeRecord), under the row's lock.
  await withRecord(o.builderId, o.now, (cur) => {
    const mine = cur.projects.find((x) => x.id === project.id);
    if (!mine) return { record: null, result: null };
    mine.evidence_read_at = at;
    if (summary?.tier) mine.last_tier = { tier: summary.tier, line: summary.line.slice(0, 280), read_at: at, ...(usage ? { usage: usage.slice(0, 280) } : {}), ...(subject.repo_url ? { repo_url: subject.repo_url.slice(0, 300) } : {}) };
    return { record: cur, result: null };
  });
  return { ...side, tier: summary?.tier ?? side.tier, summary: summary ?? side.summary, verifiedUsage: summary ? usage : side.verifiedUsage };
}

const RANK: Record<Tier, number> = { flagged: 0, unverified: 1, building: 2, live: 3, used: 4 };

/** What would lift the project: the line's "Next: ..." part, without its full stop. Pure. */
const nextOf = (line: string | undefined, min: string) => {
  const m = line ? / Next: (.+?)\.?$/.exec(line) : null;
  return m ? m[1] : `the project reading as ${min}`;
};

/** What a program's bar asks for, after "needs a" in a not-fit reason (B20, v6.1.8). */
export const TIER_NEED: Record<'used' | 'live' | 'building', string> = { used: 'live product with users', live: 'live product', building: 'project with code' };

/**
 * A ready verdict, or a gap verdict of rules only (R18c), on a program whose min_tier is above a known tier gets the
 * tier gap as its real gap, ahead of any rules (never ask to confirm a rule for a program out of reach). With no tier
 * at all (B20, v6.1.8: nothing read, no repo or live link reported) a program with a bar is not a fit, never ready
 * and never a gap. The bars are onchain evidence (B20b): a project with no chain, reported or read (`onchain` false),
 * is never gated; `evaluate` turns its `used` bar into the users question. Anything else is unchanged. Pure.
 */
export function tierGate(v: Verdict, row: ProgramRow, tier: Tier | null, line: string | undefined, onchain: boolean): Verdict {
  const min = row.file.min_tier;
  if (!onchain) return v;
  if (min && !tier && v.status !== 'no') return { ...v, status: 'no', gaps: [], reason: `needs a ${TIER_NEED[min]}` };
  if ((v.status !== 'ready' && !(v.status === 'gap' && rulesOnly(v.gaps))) || !min || !tier || RANK[tier] >= RANK[min]) return v;
  const gap: Gap = { kind: 'tier', item: `tier:${min}`, what: nextOf(line, min), effort: 'weeks', agent_can: false, details: { tier, min_tier: min } };
  return { ...v, status: 'gap', gaps: [gap, ...v.gaps] };
}

/**
 * Without the builder's own tier, the tier the public code read alone supports: 'live' for a live URL or a mainnet
 * contract read from the code (a repo homepage counts even when the agent also passes the live URL, R3a; homepage is
 * set only by the read), 'building' for any other public repo read, and for an archived one (C59). Not read (B20,
 * v6.1.8): 'building' for a live link or a repo named, null for neither (no program with a bar fits). A reported live
 * link is an unverified claim in every path (fix round 4): 'live' comes only from the code read or own evidence.
 * Never stored and never shown as the builder's tier. Pure.
 */
export function provisionalTier(facts: RepoFacts): Tier | null {
  if (!facts.public || facts.as_reported) return facts.live_url || facts.repo_url ? 'building' : null;
  // An empty repo was read and holds nothing (final review M6): building only on a reported live link.
  if (facts.notes?.includes('empty')) return facts.live_url ? 'building' : null;
  if (facts.notes?.includes('archived')) return 'building';
  const mainnet = new Set(facts.chains.filter((c) => c.mainnet).map((c) => c.chain));
  if (facts.live_url_basis === 'code' || facts.homepage !== null || facts.contracts.some((c) => c.basis === 'code' && mainnet.has(c.chain))) return 'live';
  return 'building';
}

/** `tierGate` without the builder's own tier: unlinked, the gap names the bar (`proof that ...`, R3b) and the reply asks
 *  the sign-in once (v6.1.14); linked (no own
 *  tier read yet), that the proof is still being read (I2), or, when no project in the record matches the find
 *  (`noProject`), to add it so its proof can be read (I2 nuance, v6.1.9). Pure. */
export const provisionalGate = (v: Verdict, row: ProgramRow, tier: Tier | null, o: { onchain: boolean; linked: boolean; noProject?: boolean }): Verdict =>
  row.file.min_tier
    ? tierGate(v, row, tier, ` Next: ${o.linked ? (o.noProject ? ADD_PROJECT : PROOF_READING) : confirmLine(row.file.min_tier)}`, o.onchain)
    : v;

/**
 * L12-7 (v6.1.14): with no tier at all (nothing read, no repo or live link) a `building` bar asks for code, so a program
 * on one of the project's own chains, or one whose rule keyword the project names (a keyword hit), is never hidden by
 * it when code in a repo is its only change: it is a gap of `code in a repo` (NEEDS_CODE) and its rules, never a no.
 * Anything else is null (the bar decides as before). Pure.
 */
function codeStep(v: Verdict, row: ProgramRow, facts: RepoFacts, tier: Tier | null): Verdict | null {
  if (tier || row.file.min_tier !== 'building' || v.status === 'no' || facts.chains.length === 0) return null;
  if (!v.gaps.every((g) => g.kind === 'rule' || g.item === NEEDS_CODE.item)) return null;
  const own = row.file.chains.some((c) => facts.chains.some((f) => f.chain === c));
  if (!own && !keywordHit(row, facts, v.gaps)) return null;
  return { ...v, status: 'gap', gaps: [NEEDS_CODE, ...v.gaps.filter((g) => g.item !== NEEDS_CODE.item)], reason: null };
}

/** The one gate the list and the one-program reply share (I3): the builder's own tier when read, else the provisional
 *  one. A project's bars apply only when it has a chain (B20b); with no tier, an own-chain or keyword-hit program asks
 *  for code in a repo instead (L12-7, v6.1.14: `codeStep`). Pure. */
export function gateFor(side: RecordSide | null, facts: RepoFacts): (v: Verdict, row: ProgramRow) => Verdict {
  const provisional = provisionalTier(facts);
  const onchain = facts.chains.length > 0;
  return (v, row) => side?.tier
    ? tierGate(v, row, side.tier, side.tier_line ?? side.summary?.line, onchain)
    : codeStep(v, row, facts, provisional) ?? provisionalGate(v, row, provisional, { onchain, linked: side !== null, noProject: side !== null && side.projectId === null });
}

/** The programs the builder lists: everything but the never list, matched on the title or the slug, any case (v6.1.8:
 *  /me asks for titles, older lists hold slugs). Pure. */
export const notNever = (record: BuilderRecord) => {
  const skip = new Set(record.policy.never.map((n) => n.trim().toLowerCase()).filter(Boolean));
  return (row: ProgramRow) => !skip.has(row.id.toLowerCase()) && !skip.has((row.file.title ?? '').trim().toLowerCase());
};

/** The program's category is ticked (none ticked reads as all, v6.1.8 B18). Pure. */
const categoryIn = (record: BuilderRecord, row: ProgramRow) =>
  record.policy.categories.length === 0 || record.policy.categories.includes(categoryOf(row.file));
/** The program's money within max_ask_usd: the larger of its award and its pool; neither stated is never over it. Pure. */
const moneyIn = (record: BuilderRecord, row: ProgramRow) => {
  const cap = record.policy.max_ask_usd;
  const amounts = [row.file.max_award_usd, row.file.pool_usd].filter((n): n is number => typeof n === 'number');
  return cap === undefined || amounts.length === 0 || Math.max(...amounts) <= cap;
};

/** Whether the standing approval's limits cover sending this program alone: its category is ticked and its
 *  money is within max_ask_usd. Pure. */
export const withinApproval = (record: BuilderRecord) => (row: ProgramRow) => categoryIn(record, row) && moneyIn(record, row);

/** A category as a plural noun inside a sentence (v6.1.9 N5): "bounties", "grants". Pure. */
const CATEGORY_PLURAL: Record<string, string> = { grant: 'grants', hackathon: 'hackathons', investment: 'investments', bounty: 'bounties' };
const categoryWords = (c: string) => CATEGORY_PLURAL[c] ?? `${c.toLowerCase()} programs`;

/**
 * Why an agent's send of this program is outside the builder's standing approval, in one plain clause, or null when
 * the policy covers it (the nightly count aside, which the ledger checks under its lock; v6.1.8 B18). Pure.
 */
export function outsideApproval(record: BuilderRecord, row: ProgramRow): string | null {
  if (row.file.in_person) return 'it is in person';
  if (row.file.submit === 'builder') return 'only you may apply to it';
  if (!record.policy.agent_may_submit) return 'your agent may not press submit';
  if (!categoryIn(record, row)) return `${categoryWords(categoryOf(row.file))} are not in your categories`;
  if (!moneyIn(record, row)) return 'its award is above your limit';
  return null;
}
/** The reason when the night's sends under standing approval already reached max_per_night. */
export const NIGHT_LIMIT = 'the daily limit was reached';
/** The reason when an agent's send under standing approval left a required answer out (v6.1.9 S6). */
export const REQUIRED_MISSING = 'a required answer was missing';
/** The reason when the program had closed over an hour before the send (F8, v6.1.12; the ledger's record-time check). */
export const HAD_CLOSED = 'it had closed';

/** The reason when the program's verdict for the project was not ready at send time (v6.1.13, B2). */
export const STEP_AWAY = 'it was still a step away';

/** The reason when the program had not opened at send time (L13-6, v6.1.14). */
export const NOT_OPENED = 'it has not opened yet';

/** The reason when the builder turned standing approval off after the agent's last find saw it on (L13-7, v6.1.14). */
export const APPROVAL_OFF = 'it was off';

/** The record side from the stored record alone (no evidence read, nothing stored): the picked project's stored tier. Pure. */
export function storedSide(rec: RecordContext): RecordSide {
  const stored = rec.record.projects.find((p) => p.id === rec.projectId)?.last_tier;
  const tier = isTier(stored?.tier) ? stored.tier : null;
  return { record: rec.record, projectId: rec.projectId, verifiedUsage: rec.verifiedUsage, tier, summary: tier ? { tier, line: currentBuilderLine(stored!.line) } : null, problems: [] };
}

/**
 * Whether the program's verdict for the project is ready (v6.1.13, B2): find's `evaluate` with the owner's done steps,
 * then find's gate (`gateFor`) on the side's tier. A gap, a rule left to confirm, a bar not met or not a fit is not. Pure.
 */
export const readyAtSend = (row: ProgramRow, facts: RepoFacts, done: Set<string>, side: RecordSide, now: Date): boolean =>
  gateFor(side, facts)(evaluate(row, facts, done, now), row).status === 'ready';

/** The program's required field keys that `fieldsUsed` does not name (none sent: all of them). Pure. */
export const requiredLeftOut = (row: ProgramRow, fieldsUsed: string[] | undefined): string[] =>
  row.file.submission_requirements.filter((r) => r.required && !(fieldsUsed ?? []).includes(r.key)).map((r) => r.key);

/** The sign-in a blocker names: the kind, or the platform's name. Pure. */
const signInOf = (row: ProgramRow): string | null =>
  row.file.sign_in === 'none' ? null : row.file.sign_in === 'platform' ? (row.file.platform_name ?? 'platform') : row.file.sign_in;

/** One blocker per ready program that needs a sign-in, a click or a document the record lacks, or
 *  (with auto_apply) falls outside the standing approval's limits. Pure. */
export function blockersOf(rows: ProgramRow[], record: BuilderRecord): Blocker[] {
  const out: Blocker[] = [];
  const within = withinApproval(record);
  for (const row of rows) {
    const needs_click = row.file.submit === 'builder' || record.policy.agent_may_submit === false;
    const needs = row.file.needs.filter((n) => !hasDoc(record, n));
    const sign_in = signInOf(row);
    const outside = record.policy.auto_apply && !within(row);
    const overLimit = outside && categoryIn(record, row) && record.policy.max_ask_usd !== undefined;
    if (sign_in || needs_click || needs.length > 0 || outside)
      out.push({
        program_id: row.id, sign_in, needs_click, needs,
        ...(outside ? { outside_approval: true as const } : {}), ...(overLimit ? { over_limit_usd: record.policy.max_ask_usd } : {}),
      });
  }
  return out;
}

/** What the record lacks for these programs, in builder words. A traction field reads the usage or the pre-launch line,
 *  never the bank. `repoPassed` (lane 8 #10, v6.1.10): the find passed a repo (or, N5 v6.1.12, a live link), so the project with a link
 *  is not missing. Pure. */
export function missingFor(rows: ProgramRow[], record: BuilderRecord, verifiedUsage: boolean, repoPassed = false): string[] {
  const missing = recordMissing(record, {
    needs: [...new Set(rows.flatMap((r) => r.file.needs))],
    kinds: [...new Set(rows.flatMap((r) => r.file.submission_requirements.map((q) => q.kind)))].filter((k) => k !== 'traction'),
    verifiedUsage,
  });
  return repoPassed ? missing.filter((m) => m !== PROJECT_ITEM) : missing;
}
