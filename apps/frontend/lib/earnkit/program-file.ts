import { z } from 'zod';

/**
 * The format of `programs/<slug>.json`, the file Claude Code writes when a
 * program is added. `pnpm program:upsert` validates against this before
 * touching the database.
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

/**
 * Something only the builder can do. The agent skips any step it can already do itself
 * (e.g. GitHub or a host already connected) and asks for the rest.
 */
const BuilderStep = z
  .object({
    kind: z.enum(['github', 'hosting', 'wallet', 'login', 'video', 'info']),
    /** A few words, e.g. "a few USDC on Arc" or "DoraHacks". */
    detail: z.string().min(1).max(120),
    /**
     * true = needed for every entry (a pitch video, program-specific answers).
     * Omitted = one-time setup that carries over to later entries (GitHub, a host, a login,
     * a funded wallet, a profile link).
     */
    each_entry: z.literal(true).optional(),
  })
  .strict();

const BuildContext = z
  .object({ label: z.string().min(1), url: z.string().url().optional() })
  .strict();

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
    /** Program-wide rules and requirements every project must meet. */
    /** The one requirement that decides fit, in a few words (e.g. "Deployed on Arc mainnet"). */
    key_requirement: z.string().min(1).max(120),
    /**
     * Can a builder submit something they already built?
     * "allowed": yes. "new_work_only": only work done during the program counts.
     * "unknown": the source doesn't say. Never guess.
     */
    existing_work: z.enum(['allowed', 'new_work_only', 'unknown']),
    /** Date every fact in this file was last checked against the official sources (YYYY-MM-DD). */
    verified_at: z.string().date(),
    builder_steps: z.array(BuilderStep),
    rules: z.array(z.string().min(1)),
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

    if (
      p.starts_at &&
      p.ends_at &&
      Date.parse(p.starts_at) >= Date.parse(p.ends_at)
    ) {
      issue('starts_at must be before ends_at');
    }
  });
export type ProgramFile = z.infer<typeof ProgramFile>;
