import { z } from 'zod';
import { CAMPAIGN_KEYS, CampaignConfig } from './campaigns';
import { earnkitTexts } from './campaign-text';
import { CHAINS } from './match';
import { amountStated, poolStated } from './pool';
import { apiPlatformOf, prefillKindOf, urlHost } from './submit-hosts';

/**
 * The format of `programs/<slug>.json`, the file Claude Code writes when a
 * program is added. `pnpm programs:check` validates against this; every deploy validates
 * again and syncs the files to the database.
 */

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use a lowercase slug like "my-program"');

export const PROJECT_FIELDS = [
  'name',
  'description',
  'repo_url',
  'live_url',
  'demo_url',
  'token_url',
] as const;
export type ProjectField = (typeof PROJECT_FIELDS)[number];

/** Whether entries get a token at submission (v2.3): encouraged and allowed launch by default; off never. A funder setting, never displayed (v2.4). */
export const TOKEN_POLICIES = ['encouraged', 'allowed', 'off'] as const;
export type TokenPolicy = (typeof TOKEN_POLICIES)[number];

/**
 * v2.8 Part D.1: the fixed vocabulary of form field kinds. The coach's built-in guidance, its
 * questions and the answer bank are all keyed by kind (coach.ts DEFAULT_GUIDANCE).
 */
export const FIELD_KINDS = [
  'name', 'one_liner', 'problem', 'solution', 'how_it_works', 'traction', 'team', 'why_you',
  'use_of_funds', 'milestones', 'demo_video', 'links', 'contact', 'other',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

const HttpsSource = z.string().url().startsWith('https://');

/**
 * v2.8 Ruling 9 (plan): a program's own guidance for one field, sourced from its rubric or past
 * winners. Each part overrides the kind's default; source_url is required.
 */
const FieldGuidance = z
  .object({
    judges: z.string().min(1).max(140).optional(),
    questions: z.array(z.string().min(1).max(120)).max(2).optional(),
    pattern: z.string().min(1).max(140).optional(),
    limit_words: z.number().int().positive().optional(),
    source_url: HttpsSource,
  })
  .strict();
export type FieldGuidance = z.infer<typeof FieldGuidance>;

export const SubmissionRequirement = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/, 'use snake_case keys'),
    /** The question as the program's form asks it. */
    label: z.string().min(1),
    type: z.enum(['text', 'url', 'email', 'choice', 'file']),
    required: z.boolean(),
    /** Limits, format, or what the organizer is looking for. */
    description: z.string().optional(),
    options: z.array(z.string()).optional(),
    /**
     * v2.7 C5: the item as a short builder to-do for "Before you submit: …" ("a live link on Arc
     * mainnet"): lowercase start, at most 40 characters, no trailing punctuation. Without it, the
     * label is normalized (entry-text.ts todoOf).
     */
    todo: z
      .string()
      .min(1)
      .max(40)
      .refine((s) => !/https?:\/\/|www\./i.test(s), 'no links')
      .refine((s) => !/[.?:!;,]$/.test(s), 'no trailing punctuation')
      .refine((s) => s === s.trim() && !/^\p{Lu}(\p{Ll}|\s)/u.test(s), 'lowercase start, no outer spaces')
      .optional(),
    /** Filled automatically from this project field when the agent knows it. */
    project_field: z.enum(PROJECT_FIELDS).optional(),
    /**
     * Who can answer: "project" = the agent can draft it from the project
     * itself; "builder" = personal info the agent must ask for.
     */
    from: z.enum(['project', 'builder']),
    /**
     * v2.8 Part D.1: what the field is for (FIELD_KINDS). Optional in the schema (runtime default
     * `other`); `pnpm programs:check` requires it on every requirement (Ruling 9 (plan)).
     */
    kind: z.enum(FIELD_KINDS).optional(),
    /** v2.8 Ruling 9 (plan): this program's guidance for the field, over the kind's default. */
    guidance: FieldGuidance.optional(),
    /** The form's character limit, when it states one. */
    max_chars: z.number().int().positive().optional(),
  })
  .strict()
  .refine((r) => r.type !== 'choice' || (r.options && r.options.length > 0), {
    message: 'choice fields need options',
  });
export type SubmissionRequirement = z.infer<typeof SubmissionRequirement>;

const BuildContext = z
  .object({ label: z.string().min(1), url: z.string().url().optional() })
  .strict();

/** A short, plain idea for a builder: 3-12 words, no links, no markup. */
const Idea = z
  .string()
  .min(1)
  .refine(
    (s) => !/https?:\/\/|www\./i.test(s),
    'ideas cannot contain links',
  )
  .refine((s) => {
    const words = s.trim().split(/\s+/).filter(Boolean);
    return words.length >= 3 && words.length <= 12;
  }, 'ideas must be 3 to 12 words');

/** v2.7 §2: a short guide string, like `ideas` but 1-12 words ("FX" is one): no links, no markup. */
export const ShortText = z
  .string()
  .min(1)
  .max(100)
  .refine((s) => !/https?:\/\/|www\./i.test(s), 'no links')
  .refine((s) => {
    const n = s.trim().split(/\s+/).filter(Boolean).length;
    return n >= 1 && n <= 12;
  }, 'must be 1 to 12 words');

const HttpsUrl = z.string().url().startsWith('https://');

/** v2.7 fix round 1 (Finding 7): the same "no links" rule as ShortText, for fields that aren't
 * word-capped (a round's label, an example's name). */
const noLinks = <T extends z.ZodString>(schema: T) =>
  schema.refine((s) => !/https?:\/\/|www\./i.test(s), 'no links');

/** v2.7 §2: a program's own logo, shown on its card and guide page via <img> only. */
const GuideLogo = z
  .object({ path: z.string().min(1), source_url: HttpsUrl })
  .strict();
export type GuideLogo = z.infer<typeof GuideLogo>;

const PastRoundTheme = z
  .object({ theme: ShortText, count: z.number().int().positive() })
  .strict();

const PastRoundExample = z
  .object({
    name: noLinks(z.string().min(1).max(60)),
    what: ShortText,
    /** v2.7 fix round 1 (Finding 2 / Ruling C2): omitted when no judge or organizer stated why. */
    why: ShortText.optional(),
    source_url: HttpsUrl,
  })
  .strict();

/**
 * v2.7 §2: a published round of winners, newest first (Ruling 2 (plan)).
 * v2.7 fix round 1 (Finding 1 / Ruling C2): `submissions`/`winners` are `null` (or left out) when
 * the count isn't published, or comes from a different kind of program or a different metric.
 */
const PastRound = z
  .object({
    label: noLinks(z.string().min(1).max(80)),
    source_url: HttpsUrl,
    /**
     * v2.7 Ruling C4: true only when this round is the program's own past round. Left out (or
     * false) means a predecessor event (Ruling C2): the guide names it and never says "last round".
     */
    own: z.boolean().optional(),
    submissions: z.number().int().positive().nullable().optional(),
    winners: z.number().int().positive().nullable().optional(),
    /**
     * v2.7 final review M3: how many of `winners` the source describes, when it doesn't describe
     * them all (at most `winners`). Theme counts are out of these, so the guide shows them without
     * a denominator ("(4 winners)", then "(4)").
     */
    themes_of: z.number().int().positive().optional(),
    themes: z.array(PastRoundTheme).min(1).max(3).optional(),
    examples: z.array(PastRoundExample).min(1).max(2).optional(),
  })
  .strict();
export type PastRound = z.infer<typeof PastRound>;

/** v2.7 §2: what a program (or its ecosystem) is prioritizing right now. */
const Focus = z
  .object({
    areas: z.array(ShortText).min(1).max(3),
    source_url: HttpsUrl,
    ecosystem: z.string().min(1).max(40).optional(),
  })
  .strict();
export type Focus = z.infer<typeof Focus>;

/**
 * v2.7 Ruling 5 (plan): when set, wins over the computed difficulty and shows as not an estimate.
 * v2.7 fix round 1 (Finding 3): `basis` is spec §2 "short text" (ShortText), like `best_bet`.
 * v2.8 Ruling 11 (plan): `estimate: true` shows it as an estimate ("Hard (estimate)").
 * v2.8 Ruling 12 (plan): or the EarnKit rating, Easy only, shown as just "Easy" (no basis, no
 * label); its `source_url` is the program page that gives its facts.
 */
const StatedDifficulty = z
  .object({
    level: z.enum(['Easy', 'Medium', 'Hard']),
    basis: ShortText,
    source_url: HttpsUrl,
    estimate: z.literal(true).optional(),
  })
  .strict();
const EarnkitRating = z
  .object({
    level: z.literal('Easy'),
    rated_by: z.literal('earnkit'),
    source_url: HttpsUrl,
  })
  .strict();
const DifficultyOverride = z.union([EarnkitRating, StatedDifficulty]);
export type DifficultyOverride = z.infer<typeof DifficultyOverride>;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode/re-encode round-trip: any byte sequence that isn't valid UTF-8 fails to survive it
 * (an invalid byte becomes U+FFFD on decode, which re-encodes to different bytes). Catches, e.g.,
 * a UTF-16 file (its BOM and null bytes aren't valid UTF-8 on their own). */
function isValidUtf8(bytes: Buffer): boolean {
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

/**
 * v2.7 fix round 1 (Finding 4): element names and attributes are matched with an optional
 * namespace prefix, so a namespace can't smuggle a banned tag or attribute past a plain regex.
 */
const SVG_BAD_PATTERNS: RegExp[] = [
  /<!DOCTYPE|<!ENTITY/i,
  // Any namespace-prefixed element (e.g. <s:script>, <s:foreignObject>) is refused outright.
  /<\/?[a-zA-Z][\w-]*:[\w-]+/,
  // script, foreignObject, iframe, embed, object, set and animate: prefixed or not.
  /<\/?(?:[\w-]+:)?(?:script|foreignObject|iframe|embed|object|set|animate)\b/i,
  // Any on* event-handler attribute, prefixed or not (xlink:onerror=, onload=, ...).
  /\bon[a-zA-Z]+\s*=/i,
  // CSS that can load or run anything: url(...) or @import, in <style> or a style= attribute.
  /url\(|@import/i,
];

/** Every href/xlink:href value in the file; unquoted, single- or double-quoted. */
function hrefValues(svg: string): string[] {
  const re = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const values: string[] = [];
  for (const m of svg.matchAll(re)) values.push(m[1] ?? m[2] ?? m[3] ?? '');
  return values;
}

/**
 * v2.7 Ruling 23 (plan): why a program logo file can't be served, or null. Logos render only via
 * <img>, but a file that would run script if opened directly is refused anyway. Pure.
 */
export function logoFileProblem(path: string, bytes: Buffer | null): string | null {
  if (bytes === null) return `logo.path: ${path} not found under apps/frontend/public`;
  if (bytes.length > 200_000) return `logo.path: ${path} is over 200 KB`;
  if (path.endsWith('.png'))
    return bytes.subarray(0, 8).equals(PNG_SIGNATURE) ? null : `logo.path: ${path} is not a PNG`;
  const unsafe = `logo.path: ${path} has scripts, event handlers or external links`;
  if (!isValidUtf8(bytes)) return unsafe;
  const svg = bytes.toString('utf8');
  if (SVG_BAD_PATTERNS.some((p) => p.test(svg))) return unsafe;
  // Any href/xlink:href must be a same-document fragment (#...); anything else (a relative path,
  // a protocol-relative //host, a scheme, or a raw/encoded javascript:/data:) is refused.
  if (hrefValues(svg).some((v) => !v.startsWith('#'))) return unsafe;
  return null;
}

/**
 * Proof a submission is a public page EarnKit can point to (e.g. a DoraHacks BUIDL): the
 * hostname it's published on, and a regex matched against the URL's path to confirm it's a
 * specific submission, not just the platform's homepage. Null when submissions aren't public
 * pages on a known host (e.g. a Google Form, or a private review dashboard).
 */
const SubmissionProof = z
  .object({
    host: z.string().min(1),
    /** Anchored (^...$) so it matches one specific entry path, never a prefix of a wider page. */
    path_pattern: z
      .string()
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'path_pattern must be a valid regex')
      .refine(
        (p) => p.startsWith('^') && p.endsWith('$'),
        'path_pattern must be anchored: start with ^ and end with $',
      ),
  })
  .strict();
export type SubmissionProof = z.infer<typeof SubmissionProof>;

/** v2.8 Ruling 15 (plan): a URL whose host is optimism.io or a subdomain of it. Pure. */
export function isOptimismUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'optimism.io' || host.endsWith('.optimism.io');
}

/**
 * v2.8 Part D.4, C13: the judging criteria the program's source states (e.g. Arc's "Judged on
 * relevance to Arc, technical credibility, ..."), in its words. They go to the agent with its drafting
 * guidance. A criterion becomes a builder fix only through a hand-written `fix`: the field kind it
 * belongs in, what it needs (a link, a number or a date) and the exact thing to add, e.g.
 * `{ "kind": "solution", "needs": "link", "add": "link the contract on the Arc explorer" }`, shown as
 * "<that field>: link the contract on the Arc explorer." when that field's answer has none.
 */
export const Judging = z
  .object({
    criteria: z
      .array(
        z
          .object({
            text: ShortText,
            fix: z
              .object({
                kind: z.enum(FIELD_KINDS),
                needs: z.enum(['link', 'number', 'date']),
                add: z
                  .string()
                  .min(1)
                  .max(80)
                  .refine((t) => /^\p{Ll}/u.test(t), 'lowercase start (it follows "<Field>: ")')
                  .refine((t) => !/[.?!]$/.test(t), 'no trailing punctuation'),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    source_url: HttpsSource,
  })
  .strict();
export type Judging = z.infer<typeof Judging>;

/**
 * v2.8 Ruling 8 (plan): a public form's field ids, read once at listing from the public form
 * (read-only; nothing is submitted) and re-read by the weekly routine. Never fetched at request time.
 * `fields` maps requirement keys to `entry.<n>` (Google), the field name (Airtable) or the URL
 * parameter (Tally). `sign_in` (Ruling C19): `"email_only"` when the form's only sign-in cause is
 * Google's verified email collection (Google only, no file question); `true` for a file question
 * or any other sign-in cause; `false` for none.
 */
const SubmitForm = z
  .object({
    url: HttpsSource,
    fields: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().min(1).max(200)),
    sign_in: z.union([z.boolean(), z.literal('email_only')]),
    read_at: z.string().date(),
  })
  .strict();
export type SubmitForm = z.infer<typeof SubmitForm>;

export const ProgramFile = z
  .object({
    id: slug,
    organizer: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    source_url: z.string().url(),
    submission_url: z.string().url(),
    reward: z.string().min(1),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    /** null = rolling (no deadline), e.g. grant programs that review in cohorts. */
    ends_at: z.string().datetime({ offset: true }).nullable(),
    status: z.enum(['active', 'closed']),
    /** The day these facts were last checked against source_url (YYYY-MM-DD). */
    verified_at: z.string().date(),
    /**
     * Can a builder submit something they already built?
     * "allowed": yes. "new_work_only": only work done during the program counts.
     * "unknown": the source doesn't say. Never guess.
     */
    existing_work: z.enum(['allowed', 'new_work_only', 'unknown']),
    /** v2.3: token at submission. Leave out for the default, encouraged. */
    token_policy: z.enum(TOKEN_POLICIES).default('encouraged'),
    /** What only the builder can do, a few words each. setup carries over to later entries. */
    setup: z.array(z.string().min(1).max(80)),
    /** Needed again for every entry (a pitch video, program-specific answers). */
    each_time: z.array(z.string().min(1).max(80)),
    /**
     * Chains a project must use to count (for matching a builder's repos). At least one, unless
     * `any_chain` (v2.8 Ruling 13 (plan)), which lists none.
     */
    chains: z.array(z.enum(CHAINS)),
    /** v2.8 Ruling 13 (plan): the program isn't tied to one chain, so it fits any repo. */
    any_chain: z.boolean().default(false),
    /**
     * v2.8 Ruling C5: the award is an investment in the company (an accelerator such as a16z
     * speedrun), not a prize: the card reads "up to $1M investment", never "per winner".
     */
    investment: z.boolean().default(false),
    /**
     * v2.8.1 §B8 (fix round 1): entering needs a repo or a live product, per the program's source.
     * An editorial call, never inferred: a no-repo builder sees "needs a repo" on it, and only a
     * program with `false` can be their offer. Optional in the schema (sponsor campaigns have none);
     * `pnpm programs:check` requires it on every file.
     */
    needs_repo: z.boolean().optional(),
    /**
     * v2.9 A5: the live link counts only with a deployed contract on this chain's mainnet (Arc
     * Microgrants: arc). One of the file's chains, unless any_chain.
     */
    needs_contract: z.enum(CHAINS).optional(),
    /**
     * v2.9 A2: the lowest real-product score (0 to 6, match.ts productScore) a repo needs for a
     * matched row. An any_chain program needs 5 or more (a16z: 5). 0: no floor.
     */
    min_product_score: z.number().int().min(0).max(6).default(0),
    /** One short line the builder sees: reward + deadline as the organizer states it. */
    summary: z.string().min(1).max(90),
    /**
     * The most one winner gets, in USD, only when the source states a per-winner amount
     * (e.g. "500 USDC per microgrant", "up to $5,000"). Breaks ties between equally quick fits
     * in list_programs; leave it out otherwise (unknown sorts as 0).
     */
    max_award_usd: z.number().positive().optional(),
    /**
     * v2.7.1: the program's total prize pool in USD, only when its own source states one
     * ("$840,000 in prizes", "10,000 USDC pool"). `reward` must state it (pool.ts
     * poolStated), and a "+" after it there ("$250,000+") carries through to the page. Leave it
     * out when no pool is published.
     */
    pool_usd: z.number().positive().optional(),
    /**
     * v2.7.1 review: the smallest award, only when the source states a range ("from $5,000 to
     * $100,000"): the card then reads "$5K–$100K per grant". Needs max_award_usd, below it, and
     * stated in `reward`.
     */
    min_award_usd: z.number().positive().optional(),
    /**
     * v2.7.1: where the pool is stated, when that is not `source_url` (Circle's Cohort 2 total is on
     * its grants portal, circle.questbook.app). Only with `pool_usd`.
     */
    pool_source_url: HttpsUrl.optional(),
    /** Shown next to the title so the builder isn't misled about effort or odds. */
    tag: z.enum(['long shot', 'needs a live product']).optional(),
    /**
     * Up to 3 short, plain ideas (3-12 words each) drawn from the program's stated focus or its
     * published winners. Never invent a winner or a focus the source doesn't state.
     */
    ideas: z.array(Idea).max(3).default([]),
    /**
     * Set only when submissions are public pages on a known host (e.g. DoraHacks /buidl/<id>);
     * null otherwise (a Google Form, a private review dashboard, EarnKit's own MCP flow).
     */
    submission_proof: SubmissionProof.nullable().default(null),
    /**
     * v2.6 §4: whether this program's entries can earn the builder bonus. On by default; set
     * `false` to opt out (EarnKit and sponsor campaigns are excluded regardless, by `bonusOn`).
     */
    builder_bonus: z.boolean().default(true),
    /** Program-wide rules and requirements every project must meet. */
    rules: z.array(z.string().min(1)),
    /** Present only for EarnKit's own campaigns: builders submit to EarnKit and we pay winners. */
    campaign: CampaignConfig.optional(),
    submission_requirements: z.array(SubmissionRequirement).min(1),
    tracks: z
      .array(
        z
          .object({
            slug,
            name: z.string().min(1),
            description: z.string().min(1),
            requirements: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .default([]),
    starters: z
      .array(
        z
          .object({
            /** Track slug. Required when the program has tracks. */
            track: slug.optional(),
            title: z.string().min(1),
            what_to_build: z.string().min(1),
            requirements: z.array(z.string().min(1)),
            build_context: z.array(BuildContext),
          })
          .strict(),
      )
      .default([]),
    /** v2.7 Ruling 23 (plan): programs/<id>.svg or .png under apps/frontend/public. */
    logo: GuideLogo.optional(),
    /** v2.7 §2: published rounds, newest first, at most 5. Never invented; each carries a source_url. */
    past_rounds: z.array(PastRound).max(5).default([]),
    /** v2.7 §2: up to 3 current focus areas, from the program's tracks or the ecosystem's priorities. */
    focus: Focus.optional(),
    /**
     * v2.7 Ruling 8 (plan): EarnKit's curated advice, never generated; must follow from
     * past_rounds/focus. v2.7 fix round 1 (Finding 3): spec §2 "short text" (ShortText).
     */
    best_bet: ShortText.optional(),
    /** v2.7 Ruling 5 (plan): set only when the organizer publishes odds another way. */
    difficulty_override: DifficultyOverride.nullable().default(null),
    /**
     * v2.7 Ruling 6 (plan): set only when source_url states how many winners a round has.
     * Nullable (fix round 1, Finding 1): the DB column already returns null.
     */
    winners_per_round: z.number().int().positive().nullable().optional(),
    /** v2.8 Part D.4: set only where the source states judging criteria. */
    judging: Judging.optional(),
    /**
     * v2.8 Ruling 27 (plan): the form's host when it isn't submission_url's (e.g. a program page
     * that links to a DoraHacks form). It picks the submit mode and the proof.
     */
    submit_host: z
      .string()
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'submit_host is a bare lowercase host like "dorahacks.io"')
      .optional(),
    /** v2.8 Ruling 27 (plan): the listing confirmed agents may submit through the platform's agent API. */
    submit_api: z.boolean().default(false),
    /** v2.8 Ruling 8 (plan): a Google, Airtable or Tally form's field ids, for the prefilled link. */
    form: SubmitForm.optional(),
    /**
     * v2.8 Part G, Ruling 30 (plan): where results are announced and the date the source says they
     * are due. After `expected`, the agent asks the builder once, and the weekly routine reads `url`.
     */
    results: z
      .object({ url: HttpsUrl, expected: z.string().date() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });

    // v2.8 Ruling 13 (plan): one chain at least, unless the program fits any chain (then none).
    if (p.any_chain && p.chains.length > 0) issue('any_chain programs list no chains');
    if (!p.any_chain && p.chains.length === 0) issue('chains needs at least one chain (or any_chain: true)');
    if (p.needs_contract && !p.any_chain && !p.chains.includes(p.needs_contract)) issue('needs_contract must be one of the chains');
    // v2.9 A2 (Pre-flight P24): a program open to any chain matches products only.
    if (p.any_chain && p.min_product_score < 5) issue('any_chain programs need min_product_score of 5 or more');
    // v2.9 A4, A6 (Pre-flight P24): a program that needs a live product is never Easy.
    if (p.tag === 'needs a live product' && p.difficulty_override?.level === 'Easy')
      issue('a "needs a live product" program is never Easy: remove the Easy difficulty_override');
    // v2.10 item 10: an EarnKit Easy rating needs a small award (at most $1,000 per winner) or sourced odds.
    if (
      p.difficulty_override &&
      'rated_by' in p.difficulty_override &&
      (p.max_award_usd ?? Infinity) > 1000 &&
      !p.past_rounds.some((r) => r.submissions && r.winners)
    )
      issue('an EarnKit Easy rating needs at most $1,000 per winner or sourced odds');

    // v2.8 Ruling 15 (plan): Optimism is not listed (owner, 2026-10-07).
    if (isOptimismUrl(p.source_url) || isOptimismUrl(p.submission_url)) issue('Optimism programs are not listed');

    // v2.7.1: a pool only where the curated source text states it, never on a campaign.
    if (p.pool_source_url !== undefined && p.pool_usd === undefined) issue('pool_source_url needs pool_usd');
    if (p.min_award_usd !== undefined) {
      if (p.max_award_usd === undefined || p.min_award_usd >= p.max_award_usd) issue('min_award_usd needs a larger max_award_usd');
      else if (!amountStated(p.min_award_usd, p.reward)) issue(`min_award_usd ${p.min_award_usd} must be stated in reward`);
    }
    if (p.pool_usd !== undefined) {
      if (p.campaign) issue('pool_usd is for curated programs, not campaigns');
      else if (!poolStated(p.pool_usd, p.reward))
        issue(`pool_usd ${p.pool_usd} must be stated in reward (e.g. "$${p.pool_usd.toLocaleString('en-US')}")`);
    }

    const keys = p.submission_requirements.map((r) => r.key);

    // v2.8 Rulings 8, 27 (plan): the submit host, the agent API and the prefilled form.
    const host = p.submit_host ?? urlHost(p.submission_url);
    if (p.submit_api && !apiPlatformOf(host)) issue(`submit_api is only for a host with an agent API (Superteam Earn, Karma GAP), not ${host}`);
    if (p.form) {
      const formHost = urlHost(p.form.url);
      if (formHost === 'forms.gle') issue('form.url must be the full viewform link');
      else if (!prefillKindOf(host) || prefillKindOf(formHost) !== prefillKindOf(host))
        issue('form is only for a Google, Airtable or Tally form on the submit host');
      else if (formHost === 'docs.google.com' && !/^\/forms\/d\/e\/[\w-]+\/viewform$/.test(new URL(p.form.url).pathname))
        issue('form.url must be the full viewform link');
      else if (new URL(p.form.url).search) issue('form.url has no query string');
      if (p.form.sign_in === 'email_only' && formHost !== 'docs.google.com') issue('form.sign_in "email_only" is for Google forms');
      for (const k of Object.keys(p.form.fields)) if (!keys.includes(k)) issue(`form.fields key "${k}" is not a submission requirement key`);
      if (formHost === 'docs.google.com')
        for (const [k, v] of Object.entries(p.form.fields)) if (!/^entry\.\d+$/.test(v)) issue(`form.fields.${k} must be "entry.<number>"`);
    }

    if (p.campaign) {
      for (const k of Object.values(CAMPAIGN_KEYS)) {
        if (!keys.includes(k))
          issue(`campaign programs need a "${k}" submission requirement`);
      }
      if (!p.starts_at || !p.ends_at)
        issue('campaigns need starts_at and ends_at (the scoring window)');
      if (p.campaign.kind === 'earnkit' && p.starts_at && p.ends_at) {
        // v2.4 §3: dates and amounts are never hand-written in an EarnKit campaign's texts.
        const t = earnkitTexts({ starts_at: p.starts_at, ends_at: p.ends_at, campaign: p.campaign });
        const fix = 'run pnpm campaign golive <slug> --texts-only --write';
        if (p.reward !== t.reward) issue(`reward must be the generated text (${fix}): "${t.reward}"`);
        if (p.summary !== t.summary) issue(`summary must be the generated text (${fix}): "${t.summary}"`);
        if (JSON.stringify(p.rules) !== JSON.stringify(t.rules))
          issue(`rules must be the generated rules (${fix})`);
      }
    }
    if (new Set(keys).size !== keys.length)
      issue('submission requirement keys must be unique');

    const trackSlugs = p.tracks.map((t) => t.slug);
    if (new Set(trackSlugs).size !== trackSlugs.length)
      issue('track slugs must be unique');

    if (p.tracks.length > 0) {
      const perTrack = new Map<string, number>();
      for (const s of p.starters) {
        if (!s.track)
          issue(`starter "${s.title}" needs a track (this program has tracks)`);
        else if (!trackSlugs.includes(s.track))
          issue(`starter "${s.title}" names unknown track "${s.track}"`);
        else perTrack.set(s.track, (perTrack.get(s.track) ?? 0) + 1);
      }
      for (const [track, n] of perTrack) {
        if (n > 1)
          issue(`track "${track}" has ${n} starters (max 1 per track)`);
      }
    } else {
      if (p.starters.some((s) => s.track))
        issue('starters cannot name a track: this program has no tracks');
      if (p.starters.length > 2)
        issue(
          `${p.starters.length} starters (max 2 for a program without tracks)`,
        );
    }

    // v2.5 M4 / v2.6 Ruling 8 (plan): a builder bonus round is the program's window, so a windowed
    // program with a builder bonus needs its start (never a round counting activity from 1970).
    // Every program has the bonus by default now, so this applies unless the file opted out or is
    // a campaign (campaigns already require starts_at/ends_at together, above).
    if (p.builder_bonus !== false && !p.campaign && p.ends_at && !p.starts_at)
      issue('builder bonus on a program with ends_at needs starts_at (the round is the window)');

    if (
      p.starts_at &&
      p.ends_at &&
      Date.parse(p.starts_at) >= Date.parse(p.ends_at)
    ) {
      issue('starts_at must be before ends_at');
    }

    // v2.7 §2: program guide facts (logo, past_rounds, focus, best_bet). Fix round 1 (Finding 1):
    // submissions/winners are nullable, so every guard here checks `!= null`, not `!== undefined`.
    for (const r of p.past_rounds) {
      if (r.submissions != null && r.winners != null && r.submissions < r.winners)
        issue('submissions must be at least winners');
      if (r.themes && r.winners != null) {
        const winners = r.winners;
        const over =
          r.themes.some((t) => t.count > winners) ||
          r.themes.reduce((sum, t) => sum + t.count, 0) > winners;
        if (over) issue("theme counts can't exceed the round's winners");
      }
      if (r.themes_of != null) {
        if (!r.themes) issue('themes_of needs themes');
        if (r.winners != null && r.themes_of > r.winners) issue("themes_of can't exceed the round's winners");
        if (r.themes && r.themes.reduce((sum, t) => sum + t.count, 0) > r.themes_of)
          issue("theme counts can't exceed themes_of");
      }
    }
    const roundLabels = p.past_rounds.map((r) => r.label);
    if (new Set(roundLabels).size !== roundLabels.length)
      issue('past round labels must be unique');

    if (p.logo) {
      const svg = `programs/${p.id}.svg`;
      const png = `programs/${p.id}.png`;
      if (p.logo.path !== svg && p.logo.path !== png)
        issue(`logo.path must be ${svg} or .png`);
    }

    if (p.best_bet && p.past_rounds.length === 0 && !p.focus)
      issue('best_bet must be drawn from past_rounds or focus');
  });
export type ProgramFile = z.infer<typeof ProgramFile>;

/**
 * v2.7 Task 4 carry (Ruling C5): `pnpm programs:check` requires a `todo` on every required
 * submission item, so "Before you submit: …" always reads as a curated builder to-do, never a
 * normalized form label. A check-time rule (not the schema), so DB rows and test fixtures without
 * one still parse; the runtime keeps its label fallback. Returns the keys missing one. Pure.
 */
export const requiredWithoutTodo = (p: Pick<ProgramFile, 'submission_requirements'>): string[] =>
  p.submission_requirements.filter((r) => r.required && !r.todo).map((r) => r.key);

/**
 * v2.8 Ruling 9 (plan): `pnpm programs:check` requires a `kind` on every requirement, like `todo`.
 * A check-time rule, so DB rows and fixtures without one still parse (runtime default `other`).
 * Returns the keys missing one. Pure.
 */
/** v2.8.1 §B8 (fix round 1): `pnpm programs:check` requires `needs_repo` on every program file. Pure. */
export const needsRepoMissing = (p: Pick<ProgramFile, 'needs_repo'>): boolean => p.needs_repo === undefined;

export const requirementsWithoutKind = (p: Pick<ProgramFile, 'submission_requirements'>): string[] =>
  p.submission_requirements.filter((r) => !r.kind).map((r) => r.key);
