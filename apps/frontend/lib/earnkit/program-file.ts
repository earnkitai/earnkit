import { z } from 'zod';
import { CAMPAIGN_KEYS, CampaignConfig } from './campaigns';
import { earnkitTexts } from './campaign-text';
import { CHAINS } from './match';

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
    /** Filled automatically from this project field when the agent knows it. */
    project_field: z.enum(PROJECT_FIELDS).optional(),
    /**
     * Who can answer: "project" = the agent can draft it from the project
     * itself; "builder" = personal info the agent must ask for.
     */
    from: z.enum(['project', 'builder']),
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
    name: z.string().min(1).max(60),
    what: ShortText,
    why: ShortText,
    source_url: HttpsUrl,
  })
  .strict();

/** v2.7 §2: a published round of winners, newest first (Ruling 2 (plan)). */
const PastRound = z
  .object({
    label: z.string().min(1).max(80),
    source_url: HttpsUrl,
    submissions: z.number().int().positive().optional(),
    winners: z.number().int().positive().optional(),
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

/** v2.7 Ruling 5 (plan): when set, wins over the computed difficulty and shows as not an estimate. */
const DifficultyOverride = z
  .object({
    level: z.enum(['Easy', 'Medium', 'Hard']),
    basis: z.string().min(1),
    source_url: HttpsUrl,
  })
  .strict();
export type DifficultyOverride = z.infer<typeof DifficultyOverride>;

/**
 * v2.7 Ruling 23 (plan): why a program logo file can't be served, or null. Logos render only via
 * <img>, but a file that would run script if opened directly is refused anyway. Pure.
 */
export function logoFileProblem(path: string, bytes: Buffer | null): string | null {
  if (bytes === null) return `logo.path: ${path} not found under apps/frontend/public`;
  if (bytes.length > 200_000) return `logo.path: ${path} is over 200 KB`;
  if (path.endsWith('.png'))
    return bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG' ? null : `logo.path: ${path} is not a PNG`;
  const svg = bytes.toString('utf8');
  return /<script|<foreignObject|\son[a-z]+\s*=|href\s*=\s*["']\s*(?:https?:|javascript:|data:)/i.test(svg)
    ? `logo.path: ${path} has scripts, event handlers or external links`
    : null;
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
    /** Chains a project must use to count (for matching a builder's repos). */
    chains: z.array(z.enum(CHAINS)).min(1),
    /** One short line the builder sees: reward + deadline as the organizer states it. */
    summary: z.string().min(1).max(90),
    /**
     * The most one winner gets, in USD, only when the source states a per-winner amount
     * (e.g. "500 USDC per microgrant", "up to $5,000"). Breaks ties between equally quick fits
     * in list_programs; leave it out otherwise (unknown sorts as 0).
     */
    max_award_usd: z.number().positive().optional(),
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
    /** v2.7 Ruling 8 (plan): EarnKit's curated advice, never generated; must follow from past_rounds/focus. */
    best_bet: z.string().min(1).optional(),
    /** v2.7 Ruling 5 (plan): set only when the organizer publishes odds another way. */
    difficulty_override: DifficultyOverride.nullable().default(null),
    /** v2.7 Ruling 6 (plan): set only when source_url states how many winners a round has. */
    winners_per_round: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });

    const keys = p.submission_requirements.map((r) => r.key);
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

    // v2.7 §2: program guide facts (logo, past_rounds, focus, best_bet).
    for (const r of p.past_rounds) {
      if (
        r.submissions !== undefined &&
        r.winners !== undefined &&
        r.submissions < r.winners
      )
        issue('submissions must be at least winners');
      if (r.themes && r.winners !== undefined) {
        const over =
          r.themes.some((t) => t.count > r.winners!) ||
          r.themes.reduce((sum, t) => sum + t.count, 0) > r.winners;
        if (over) issue("theme counts can't exceed the round's winners");
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
