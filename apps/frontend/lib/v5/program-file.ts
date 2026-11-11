/**
 * The program record: the format of `programs/<slug>.json` and of every API-written program.
 * Unknown keys are stripped. `pnpm programs:check` validates files against it, and the database
 * stores the parsed record whole (`programs.file`). Also: the eligibility items and categories.
 */
import { z } from 'zod';
import { isIntegrationKey } from '../v6/integrations';
import { isKnownChain } from './chains';

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use a lowercase slug like "my-program"');
const HttpsUrl = z.string().url().startsWith('https://');
const noLinks = (schema: z.ZodString) =>
  schema.refine((s) => !/https?:\/\/|www\./i.test(s), 'no links');
const chainSlug = z.string().refine(isKnownChain, 'not a known chain (chains.ts)');

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const PROJECT_FIELDS = ['name', 'description', 'repo_url', 'live_url', 'demo_url', 'token_url'] as const;

/** What a form field is for; drafting guidance is keyed by kind. */
export const FIELD_KINDS = [
  'name', 'one_liner', 'problem', 'solution', 'how_it_works', 'traction', 'team', 'why_you', 'milestones', 'use_of_funds',
  'competitors', 'risks', 'ecosystem_fit', 'what_next', 'past_work', 'help_needed', 'demo_video', 'links', 'contact', 'raised', 'other',
  // L28-8, L28-9 (v6.1.16 Task 14): team questions that each read their own record fact.
  'team_size', 'team_roles', 'team_full_time', 'team_links', 'team_usernames', 'cofounder_email',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** L28-8 (v6.1.16 Task 14): the team kinds that each read one record fact (prefill), by the question they ask. */
export const TEAM_KINDS = ['team_size', 'team_roles', 'team_full_time', 'team_links', 'team_usernames', 'cofounder_email'] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];

/**
 * L28-8 (v6.1.16 Task 14): the team kind a `team` field's label asks for, or null when it asks who is on the team (or
 * something else): a count (`Team size`), a role (`Roles`), full time (`Full time?`), profile links (`Team links`),
 * usernames or handles (`GitHub usernames`), a second founder's email (`Co-founder email`). A label that also asks
 * names, emails or backgrounds is a whole-team question and stays `team`. Pure.
 */
export function teamKindOf(label: string): TeamKind | null {
  const l = label.toLowerCase();
  const whole = /\bnames?\b|\bemails?\b|background|\bbio\b|experience|skills/.test(l);
  if (/how many|number of|team size|how large|headcount|\bsize\b/.test(l) && !/equity/.test(l)) return 'team_size';
  if (/full[- ]?time|commitment|committed/.test(l)) return 'team_full_time';
  if (whole) return /e-?mail/.test(l) && /2nd|second|co-?founder|other founder/.test(l) && !/\bnames?\b|\broles?\b/.test(l) ? 'cofounder_email' : null;
  if (/\broles?\b/.test(l)) return 'team_roles';
  if (/linkedin|profiles?\b|\blinks?\b/.test(l)) return 'team_links';
  if (/user ?names?\b|handles?\b/.test(l)) return 'team_usernames';
  return null;
}

/** The kinds of the builder's answer bank. */
export const ANSWER_KINDS = [
  'one_liner', 'problem', 'solution', 'traction', 'team', 'why_you', 'milestones', 'use_of_funds',
  'competitors', 'risks', 'ecosystem_fit', 'what_next', 'past_work', 'help_needed',
] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** Who submits: the builder's agent, the builder by hand, or either. */
export const SUBMIT = ['agent', 'builder', 'either'] as const;
/** What the program's form asks the builder to sign in with. */
export const SIGN_IN = ['none', 'google', 'github', 'email', 'platform'] as const;
/** Extra material the program asks for beyond the form's fields. */
export const NEEDS = ['founder_video', 'demo_video', 'resume', 'deck', 'pitch_pdf'] as const;
/** The lowest standing of work the program accepts. */
export const MIN_TIER = ['used', 'live', 'building'] as const;

/** A short guide string: 1 to 12 words, no links. */
export const ShortText = noLinks(
  z
    .string()
    .min(1)
    .max(100)
    .refine((s) => {
      const n = s.trim().split(/\s+/).filter(Boolean).length;
      return n >= 1 && n <= 12;
    }, 'must be 1 to 12 words'),
);

/** A short, plain idea for a builder: 3 to 12 words, no links. */
const Idea = noLinks(
  z
    .string()
    .min(1)
    .refine((s) => {
      const n = s.trim().split(/\s+/).filter(Boolean).length;
      return n >= 3 && n <= 12;
    }, 'ideas must be 3 to 12 words'),
);

const FieldGuidance = z.object({
  judges: z.string().min(1).max(140).optional(),
  questions: z.array(z.string().min(1).max(120)).max(2).optional(),
  pattern: z.string().min(1).max(140).optional(),
  limit_words: z.number().int().positive().optional(),
  source_url: HttpsUrl,
});

/** One question on the program's form. `todo` is the builder's to-do, required on required items. */
export const SubmissionRequirement = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/, 'use snake_case keys'),
    label: z.string().min(1),
    type: z.enum(['text', 'url', 'email', 'choice', 'multi_choice', 'file']),
    required: z.boolean(),
    description: z.string().optional(),
    options: z.array(z.string()).optional(),
    todo: z
      .string()
      .min(1)
      .max(40)
      .refine((s) => !/https?:\/\/|www\./i.test(s), 'no links')
      .refine((s) => !/[.?:!;,]$/.test(s), 'no trailing punctuation')
      .refine((s) => s === s.trim() && !/^\p{Lu}(\p{Ll}|\s)/u.test(s), 'lowercase start, no outer spaces')
      .optional(),
    /** M4 (v6.1.15 fix round 1): the noun phrase read after "Needs your" when the to-do is a clause ("the problem you
     *  solve" reads "problem statement"); the to-do otherwise. */
    need: z
      .string()
      .min(1)
      .max(40)
      .refine((s) => !/[.?:!;,]$/.test(s), 'no trailing punctuation')
      .refine((s) => s === s.trim() && !/\byou\b/i.test(s), 'a noun phrase, no "you", no outer spaces')
      .optional(),
    project_field: z.enum(PROJECT_FIELDS).optional(),
    /** "project": drafted from the project itself; "builder": personal, asked of the builder. */
    from: z.enum(['project', 'builder']),
    kind: z.enum(FIELD_KINDS),
    guidance: FieldGuidance.optional(),
    max_chars: z.number().int().positive().optional(),
  })
  .refine((r) => (r.type !== 'choice' && r.type !== 'multi_choice') || (r.options && r.options.length > 0), {
    message: 'choice and multi_choice fields need options',
  })
  .refine((r) => !r.required || r.todo !== undefined, { message: 'a required item needs a "todo"', path: ['todo'] });
export type SubmissionRequirement = z.infer<typeof SubmissionRequirement>;

const GuideLogo = z.object({ path: z.string().min(1), source_url: HttpsUrl });

const PastRound = z.object({
  label: noLinks(z.string().min(1).max(80)),
  source_url: HttpsUrl,
  own: z.boolean().optional(),
  submissions: z.number().int().positive().nullable().optional(),
  winners: z.number().int().positive().nullable().optional(),
  themes_of: z.number().int().positive().optional(),
  themes: z.array(z.object({ theme: ShortText, count: z.number().int().positive() })).min(1).max(3).optional(),
  examples: z
    .array(
      z.object({
        name: noLinks(z.string().min(1).max(60)),
        what: ShortText,
        why: ShortText.optional(),
        source_url: HttpsUrl,
      }),
    )
    .min(1)
    .max(2)
    .optional(),
});

const Focus = z.object({
  areas: z.array(ShortText).min(1).max(3),
  source_url: HttpsUrl,
  ecosystem: z.string().min(1).max(40).optional(),
});

/** The application form: its platform, and its prefill field ids keyed by requirement key. */
const Form = z.object({
  platform: z.enum(['google', 'airtable', 'tally', 'typeform', 'other']),
  url: HttpsUrl.optional(),
  fields: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().min(1).max(200)).optional(),
});

/** When results are announced: a date, or a number of weeks after the close. */
const ResultsDue = z
  .object({
    date: z.string().date().optional(),
    weeks_after_close: z.number().int().positive().optional(),
  })
  .refine((r) => r.date !== undefined || r.weeks_after_close !== undefined, 'results_due needs date or weeks_after_close');

/**
 * What eligibility EarnKit can check against a repo or a builder's answer. `rule` is the exception: a
 * requirement the source states that EarnKit cannot check (a licence, a stage, who the team is). It is a
 * confirmation gap (R18a): shown to the builder as "Their rule" until confirmed once, never counted toward the
 * two-gap limit.
 */
export const ELIGIBILITY_KINDS = [
  'live_product', 'chain', 'contract_on', 'builder_codes', 'users', 'new_work_after', 'demo_video', 'in_person', 'feature', 'integration', 'rule',
] as const;
export type EligibilityKind = (typeof ELIGIBILITY_KINDS)[number];
const EligibilityItemSchema = z
  .object({
    kind: z.enum(ELIGIBILITY_KINDS),
    value: z.string().min(1).max(100).optional(),
    note: z.string().min(1).max(140).optional(),
    /** L1c-2 (v6.1.10), a rule only: lower-case words or phrases that name what the rule is about ("vr", "mini app").
     *  A project that names none of them in its name, description, README or topics is unlikely to meet the rule, so
     *  the program shows only in the full list. A licence rule carries none; a person rule may name who it is for
     *  ("student", "college": L1e-2, v6.1.13), and then it shows only on a hit. Eight at most. */
    keywords: z.array(z.string().min(1).max(30).refine((k) => k === k.toLowerCase() && k === k.trim(), 'a keyword is lower-case, no outer spaces')).min(1).max(8).optional(),
  })
  // A rule is its note, read as a sentence ("Their rule: {note}."): a note, no value, no full stop of its own.
  .refine((i) => i.kind !== 'rule' || (i.note !== undefined && i.value === undefined && !i.note.endsWith('.')), {
    message: 'a rule needs a note (no trailing full stop) and takes no value',
  })
  .refine((i) => i.kind === 'rule' || i.keywords === undefined, { message: 'only a rule takes keywords' });
export type EligibilityItem = z.infer<typeof EligibilityItemSchema>;

export const PROGRAM_CATEGORIES = ['grant', 'hackathon', 'investment', 'bounty'] as const;
export type Category = (typeof PROGRAM_CATEGORIES)[number];

export const ProgramFile = z
  .object({
    id: slug,
    organizer: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    source_url: z.string().url(),
    submission_url: z.string().url(),
    /** The organizer's official site, when it is not source_url's. */
    official_url: HttpsUrl.optional(),
    reward: z.string().min(1),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    /** null = rolling (no deadline). */
    ends_at: z.string().datetime({ offset: true }).nullable(),
    /** The program's IANA time zone, when the summary's suffix does not name it. */
    tz: z.string().min(1).refine(isTimeZone, 'tz: an IANA time zone like "America/Los_Angeles"').optional(),
    /** The application asks for revenue or traction. */
    wants_revenue: z.boolean().optional(),
    /** `upcoming` is listed but not open; it needs `opens_note`. */
    status: z.enum(['active', 'upcoming', 'closed']),
    opens_note: z
      .string()
      .min(1)
      .max(140)
      .refine((t) => !/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|xyz|io|org|app|net)\b/i.test(t), 'opens_note has no links')
      .refine((t) => !/\u2014/.test(t), 'opens_note: no em dashes')
      .optional(),
    in_person: z.boolean().default(false),
    /** Where an in-person program is held, from its own text: 1 to 40 characters, no links (L21-16, v6.1.16). */
    city: z
      .string()
      .min(1)
      .max(40)
      .refine((t) => !/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|xyz|io|org|app|net)\b/i.test(t), 'city has no links')
      .optional(),
    /** The day these facts were last checked against source_url (YYYY-MM-DD). */
    verified_at: z.string().date(),
    /** Whether work built before the program counts: never guessed. */
    existing_work: z.enum(['allowed', 'new_work_only', 'unknown']),
    setup: z.array(z.string().min(1).max(80)),
    each_time: z.array(z.string().min(1).max(80)),
    /** Registered chain slugs; none when `any_chain`. */
    chains: z.array(chainSlug),
    any_chain: z.boolean().default(false),
    /** The source requires one of `chains` at the project's core. */
    chain_required: z.boolean().optional(),
    /** The award is an investment in the company, not a prize. */
    investment: z.boolean().default(false),
    category: z.enum(PROGRAM_CATEGORIES).optional(),
    needs_repo: z.boolean().optional(),
    /** v6.1.14 L1f-1: the program's rule is an open source license or open source software, so a private repo is one
     *  step (a public repo) from it, never ready. */
    open_source: z.boolean().default(false),
    /** A deployed contract on this chain's mainnet is required. */
    needs_contract: chainSlug.optional(),
    min_product_score: z.number().int().min(0).max(6).default(0),
    summary: z.string().min(1).max(90),
    max_award_usd: z.number().positive().optional(),
    pool_usd: z.number().positive().optional(),
    min_award_usd: z.number().positive().optional(),
    pool_source_url: HttpsUrl.optional(),
    tag: z.enum(['long shot', 'needs a live product']).optional(),
    ideas: z.array(Idea).max(3).default([]),
    rules: z.array(z.string().min(1)),
    /** At least one, except on an upcoming or closed program. */
    submission_requirements: z.array(SubmissionRequirement),
    eligibility: z.array(EligibilityItemSchema).max(10).optional(),
    logo: GuideLogo.optional(),
    past_rounds: z.array(PastRound).max(5).default([]),
    focus: Focus.optional(),
    best_bet: ShortText.optional(),
    winners_per_round: z.number().int().positive().nullable().optional(),
    form: Form.optional(),
    results_due: ResultsDue.optional(),
    submit: z.enum(SUBMIT).default('either'),
    sign_in: z.enum(SIGN_IN).default('none'),
    /** The platform the builder signs in on; only with sign_in: platform. */
    platform_name: z.string().min(1).max(60).optional(),
    needs: z.array(z.enum(NEEDS)).default([]),
    min_tier: z.enum(MIN_TIER).optional(),
    /** Integration keys (v6/integrations.ts) and chain slugs the program favors. */
    prefers: z.array(z.string().refine((k) => isIntegrationKey(k) || isKnownChain(k), 'not an integration key or a known chain')).max(10).default([]),
    /** Owner-only: where a reviewer is reached. Never listed, guided or replied. */
    reviewers_contact: z.string().min(1).max(200).optional(),
  })
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (p.sign_in === 'platform' && !p.platform_name) issue('sign_in: platform needs platform_name');
    if (p.sign_in !== 'platform' && p.platform_name) issue('platform_name is only for sign_in: platform');
    for (const e of p.eligibility ?? [])
      if (e.kind === 'integration' && !isIntegrationKey(e.value ?? '')) issue(`eligibility integration: "${e.value ?? ''}" is not an integration key`);
    if (p.status === 'upcoming' && !p.opens_note) issue('an upcoming program needs opens_note');
    if (p.status !== 'upcoming' && p.opens_note) issue('opens_note is only for an upcoming program');
    // v6.1.16 Task 16 (L30-1): a closed program may have none too, so the daily run can close an upcoming program whose
    // window passed before its requirements were published.
    if (p.status === 'active' && p.submission_requirements.length === 0)
      issue('submission_requirements needs at least one item (only an upcoming or closed program may have none)');
    if (p.any_chain && p.chains.length > 0) issue('any_chain programs list no chains');
    if (!p.any_chain && p.chains.length === 0) issue('chains needs at least one chain (or any_chain: true)');
    if (p.chain_required && (p.any_chain || p.chains.length === 0)) issue('chain_required needs the chains it requires (never any_chain)');
    if (p.needs_contract && !p.any_chain && !p.chains.includes(p.needs_contract)) issue('needs_contract must be one of the chains');
    if (p.pool_source_url !== undefined && p.pool_usd === undefined) issue('pool_source_url needs pool_usd');
    if (p.min_award_usd !== undefined && (p.max_award_usd === undefined || p.min_award_usd >= p.max_award_usd))
      issue('min_award_usd needs a larger max_award_usd');
    if (p.starts_at && p.ends_at && Date.parse(p.starts_at) >= Date.parse(p.ends_at)) issue('starts_at must be before ends_at');

    const keys = p.submission_requirements.map((r) => r.key);
    if (new Set(keys).size !== keys.length) issue('submission requirement keys must be unique');
    for (const k of Object.keys(p.form?.fields ?? {}))
      if (!keys.includes(k)) issue(`form.fields key "${k}" is not a submission requirement key`);

    for (const r of p.past_rounds) {
      if (r.submissions != null && r.winners != null && r.submissions < r.winners) issue('submissions must be at least winners');
      const themed = r.themes?.reduce((sum, t) => sum + t.count, 0) ?? 0;
      if (r.winners != null && themed > r.winners) issue("theme counts can't exceed the round's winners");
      if (r.themes_of != null && (!r.themes || themed > r.themes_of || (r.winners != null && r.themes_of > r.winners)))
        issue('themes_of needs themes, at most winners, and at least their counts');
    }
    const labels = p.past_rounds.map((r) => r.label);
    if (new Set(labels).size !== labels.length) issue('past round labels must be unique');
    if (p.logo && p.logo.path !== `programs/${p.id}.svg` && p.logo.path !== `programs/${p.id}.png`)
      issue(`logo.path must be programs/${p.id}.svg or .png`);
    if (p.best_bet && p.past_rounds.length === 0 && !p.focus) issue('best_bet must be drawn from past_rounds or focus');
  });
export type Program = z.infer<typeof ProgramFile>;

/**
 * The program's category: the record's own, else investment, else hackathon (a pool with no
 * per-winner amount, or in person), else grant. Pure.
 */
export const categoryOf = (
  p: Pick<Program, 'category' | 'investment' | 'pool_usd' | 'max_award_usd' | 'in_person'>,
): Category =>
  p.category ??
  (p.investment ? 'investment' : (p.pool_usd != null && p.max_award_usd == null) || p.in_person ? 'hackathon' : 'grant');

/** The notes of the program's `rule` items, in file order: what EarnKit shows and never checks. Pure. */
export const ruleNotes = (p: Program): string[] => eligibilityOf(p).flatMap((i) => (i.kind === 'rule' && i.note ? [i.note] : []));

/**
 * What the program requires, as items EarnKit can check: the record's own `eligibility`, else
 * derived from its fields. Each chain of a chain_required program is one item; any one satisfies. Pure.
 */
export function eligibilityOf(p: Program): EligibilityItem[] {
  if (p.eligibility) return p.eligibility;
  const items: EligibilityItem[] = [];
  if (p.tag === 'needs a live product') items.push({ kind: 'live_product' });
  if (p.chain_required) for (const c of p.chains) items.push({ kind: 'chain', value: c });
  if (p.needs_contract) items.push({ kind: 'contract_on', value: p.needs_contract });
  if (p.existing_work === 'new_work_only' && p.starts_at) items.push({ kind: 'new_work_after', value: p.starts_at });
  if (p.in_person) items.push({ kind: 'in_person' });
  return items;
}
