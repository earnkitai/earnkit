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

    // v2.5 M4: a builder bonus round is the program's window, so a windowed program with a
    // builder bonus needs its start (never a round counting activity from 1970).
    if (p.submission_proof && p.ends_at && !p.starts_at)
      issue('submission_proof on a program with ends_at needs starts_at (the builder bonus round is the window)');

    if (
      p.starts_at &&
      p.ends_at &&
      Date.parse(p.starts_at) >= Date.parse(p.ends_at)
    ) {
      issue('starts_at must be before ends_at');
    }
  });
export type ProgramFile = z.infer<typeof ProgramFile>;
