/**
 * v3.8 flags-on suite: `track` as an agent that follows the shipping flags calls it, for tests whose subject is not the
 * send gate. With `track_v2` on, an applied with no `proof` gets one and a held with no `held_reason`
 * gets needs_yes (E9: applied needs proof, held a reason). With `draft_check` on,
 * an agent's applied that the gate refuses for want of a checked draft is sent the real way (E11): a passing check of
 * a draft built from the form's required fields (the program's title and organizer, so it names the program) (after a started when no unsent row holds it, a minute before
 * its close for a program closed since), then applied with that
 * draft as `final`; a refused started is the answer. Flags off, this is `track` exactly. A test of the gate or of proof itself calls
 * `track` from ../track directly.
 */
import { flagOn } from '../flags';
import { getProgram, listRef, programByName, programIdOf } from '../programs';
import { lastListIds } from '../installations';
import { track as realTrack, type TrackContext } from '../track';
import { FINAL_NEEDED, NO_CHECK } from '../../v6/drafts';

/** The proof the flags-on suite sends with an applied. */
export const TEST_PROOF = { url: 'https://example.com/confirmation' };

/** `track`, as an agent does it with the shipping flags on (see the file comment). */
export async function track(c: TrackContext, input: unknown): ReturnType<typeof realTrack> {
  const args = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  // E9: with `track_v2` on, held needs held_reason; an agent holding for the builder's go gives needs_yes.
  if (args && args.status === 'held' && flagOn('track_v2') && args.held_reason === undefined) return realTrack(c, { ...args, held_reason: 'needs_yes' });
  if (!args || String(args.status ?? '').trim().toLowerCase() !== 'applied') return realTrack(c, input);
  const withProof = flagOn('track_v2') && args.proof === undefined ? { ...args, proof: TEST_PROOF } : args;
  const first = await realTrack(c, withProof);
  // The gate's note, with whatever the reply adds around it (a matched name, an unknown project_id).
  if (!first.refused || (!first.agent_note.includes(FINAL_NEEDED) && !first.agent_note.includes(NO_CHECK)) || args.final !== undefined) return first;
  const name = programIdOf(String(args.program_id ?? ''));
  const listed = (await getProgram(name)) ? null : listRef(name, await lastListIds(c.installationId));
  const row = (await getProgram(listed ?? name)) ?? (await programByName(name, c.now, { strict: true })).row;
  if (!row) return first;
  // The started takes the program and the project only: the send's own arguments (fields_used and the rest) are not its.
  const rest = Object.fromEntries((['program_id', 'project', 'project_id'] as const).filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
  const final = draftOf(row);
  const check = () => realTrack(c, { action: 'check', program_id: row.id, fields: final });
  // The check is stored on the owner's unsent row: one another agent of the builder started holds it already.
  let checked = await check();
  if (/Not stored/.test(checked.agent_note)) {
    let started = await realTrack(c, { ...rest, status: 'started' });
    // A program closed since: its agent started it while it was open, a minute before it closed.
    const ends = row.file.ends_at ? Date.parse(row.file.ends_at) : NaN;
    if (started.refused && ends <= c.now.getTime()) started = await realTrack({ ...c, now: new Date(ends - 60_000) }, { ...rest, status: 'started' });
    if (started.refused) return started;
    checked = await check();
  }
  if (!checked.check?.pass) throw new Error(`fixtures/send: the test draft did not pass: ${checked.agent_note}`);
  // Not stored after a started of its own: a parallel send took the unsent row meanwhile; the send answers as it would.
  return realTrack(c, { ...withProof, final });
}

type Row = NonNullable<Awaited<ReturnType<typeof getProgram>>>;
/** The test draft: the form's required text fields, each naming the program (its title and organizer). */
const draftOf = (row: Row): Record<string, string> =>
  Object.fromEntries(row.file.submission_requirements.filter((r) => r.required && r.type !== 'file').map((r) => [r.key, `${row.file.title}, ${row.file.organizer}`.replace(/—/g, '-')]));

/** The check `track` runs before a send, alone (`draft_check` on), for a test that takes its rows after it; off, nothing. */
export async function checkDraft(c: TrackContext, programId: string): Promise<void> {
  const row = await getProgram(programId);
  if (!flagOn('draft_check') || !row) return;
  const checked = await realTrack(c, { action: 'check', program_id: row.id, fields: draftOf(row) });
  if (!checked.check?.pass || /Not stored/.test(checked.agent_note)) throw new Error(`fixtures/send: the test draft was not stored as passing: ${checked.agent_note}`);
}
