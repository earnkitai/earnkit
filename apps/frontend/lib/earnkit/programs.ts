import { sql } from './db';
import type { ProgramFile, SubmissionRequirement } from './program-file';

export class NotFoundError extends Error {}

/** ISO timestamp, or "rolling" for programs without a deadline. */
const deadline = (endsAt: Date | null) => endsAt?.toISOString() ?? 'rolling';

export const isOpen = (p: { status: string; ends_at: Date | null }) =>
  p.status === 'active' && (p.ends_at === null || p.ends_at > new Date());

type ProgramRow = {
  id: string;
  organizer: string;
  title: string;
  description: string;
  source_url: string;
  submission_url: string;
  reward: string;
  starts_at: Date | null;
  ends_at: Date | null;
  status: 'active' | 'closed';
  key_requirement: string;
  existing_work: 'allowed' | 'new_work_only' | 'unknown';
  /** verified_at as YYYY-MM-DD text (read via to_char so time zones can't shift the day). */
  verified_on: string | null;
  builder_steps: { kind: string; detail: string; each_entry?: true }[];
  summary: string;
  tag: string | null;
  rules: string[];
  submission_requirements: SubmissionRequirement[];
};

/** Open programs: marked active and the deadline hasn't passed. */
export async function listPrograms() {
  const db = sql();
  const programs = await db<
    Pick<
      ProgramRow,
      | 'id'
      | 'title'
      | 'organizer'
      | 'reward'
      | 'ends_at'
      | 'key_requirement'
      | 'existing_work'
      | 'verified_on'
      | 'builder_steps'
      | 'summary'
      | 'tag'
    >[]
  >`
    SELECT id, title, organizer, reward, ends_at, key_requirement, existing_work,
      to_char(verified_at, 'YYYY-MM-DD') AS verified_on, builder_steps, summary, tag
    FROM programs
    WHERE status = 'active' AND (ends_at IS NULL OR ends_at > now())
    ORDER BY ends_at NULLS LAST`;
  const tracks = await db<{ id: string; program_id: string; name: string }[]>`
    SELECT id, program_id, name FROM tracks
    WHERE program_id IN ${db(programs.map((p) => p.id).concat(''))}
    ORDER BY id`;

  return programs.map((p) => ({
    id: p.id,
    title: p.title,
    organizer: p.organizer,
    reward: p.reward,
    deadline: deadline(p.ends_at),
    key_requirement: p.key_requirement,
    existing_work: p.existing_work,
    verified_at: p.verified_on,
    builder_steps: p.builder_steps,
    summary: p.summary,
    tag: p.tag,
    tracks: tracks.filter((t) => t.program_id === p.id).map((t) => t.name),
  }));
}

export async function getProgramRow(programId: string) {
  const [program] = await sql()<ProgramRow[]>`
    SELECT *, to_char(verified_at, 'YYYY-MM-DD') AS verified_on FROM programs WHERE id = ${programId}`;
  if (!program)
    throw new NotFoundError(
      `No program with id "${programId}". Call list_programs for current ids.`,
    );
  return program;
}

export async function getProgram(programId: string) {
  const db = sql();
  const program = await getProgramRow(programId);
  const tracks = await db<
    { id: string; name: string; description: string; requirements: string[] }[]
  >`
    SELECT id, name, description, requirements FROM tracks WHERE program_id = ${programId} ORDER BY id`;
  const starters = await db<
    {
      track_id: string | null;
      title: string;
      what_to_build: string;
      requirements: string[];
      build_context: unknown;
    }[]
  >`SELECT track_id, title, what_to_build, requirements, build_context FROM starters
    WHERE program_id = ${programId} ORDER BY id`;

  const trackName = (id: string | null) =>
    tracks.find((t) => t.id === id)?.name ?? null;

  return {
    id: program.id,
    title: program.title,
    organizer: program.organizer,
    description: program.description,
    reward: program.reward,
    key_requirement: program.key_requirement,
    existing_work: program.existing_work,
    verified_at: program.verified_on,
    builder_steps: program.builder_steps,
    starts_at: program.starts_at?.toISOString() ?? null,
    deadline: deadline(program.ends_at),
    open: isOpen(program),
    rules: program.rules,
    tracks: tracks.map(({ name, description, requirements }) => ({
      name,
      description,
      requirements,
    })),
    submission_requirements: program.submission_requirements,
    source_url: program.source_url,
    submission_url: program.submission_url,
    starters: starters.map((s) => ({
      track: trackName(s.track_id),
      title: s.title,
      what_to_build: s.what_to_build,
      requirements: s.requirements,
      build_context: s.build_context,
    })),
    starters_note:
      'Starters are optional ideas to get going quickly. The builder can build anything that meets the requirements.',
  };
}

/** Replaces the program, its tracks, and its starters with the file's contents. */
export async function upsertProgram(p: ProgramFile) {
  await sql().begin(async (tx) => {
    const row = {
      id: p.id,
      organizer: p.organizer,
      title: p.title,
      description: p.description,
      source_url: p.source_url,
      submission_url: p.submission_url,
      reward: p.reward,
      key_requirement: p.key_requirement,
      existing_work: p.existing_work,
      verified_at: p.verified_at,
      builder_steps: tx.json(p.builder_steps),
      summary: p.summary,
      tag: p.tag ?? null,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      status: p.status,
      rules: p.rules,
      submission_requirements: tx.json(p.submission_requirements),
    };
    await tx`
      INSERT INTO programs ${tx(row)}
      ON CONFLICT (id) DO UPDATE SET ${tx(row, Object.keys(row).filter((k) => k !== 'id') as (keyof typeof row)[])}`;

    await tx`DELETE FROM starters WHERE program_id = ${p.id}`;
    await tx`DELETE FROM tracks WHERE program_id = ${p.id}`;
    for (const t of p.tracks) {
      await tx`INSERT INTO tracks ${tx({
        id: `${p.id}/${t.slug}`,
        program_id: p.id,
        name: t.name,
        description: t.description,
        requirements: t.requirements,
      })}`;
    }
    for (const s of p.starters) {
      await tx`INSERT INTO starters ${tx({
        program_id: p.id,
        track_id: s.track ? `${p.id}/${s.track}` : null,
        title: s.title,
        what_to_build: s.what_to_build,
        requirements: s.requirements,
        build_context: tx.json(s.build_context),
      })}`;
    }
  });
}
