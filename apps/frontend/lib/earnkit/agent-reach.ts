import { sql } from './db';

/**
 * GTM W2 (2026-10-23): what the builder's agent can do, so the replies' notes fit it.
 * - `hosted`: the agent has no folder of the builder's code (Grok Bot, Muse, Instinct, OpenClaw's chat, or any agent
 *   that told find agent_can_build: false), so a note never says "this folder" or "git log" to it.
 * - `schedules`: the agent can run a weekly routine of its own (Grok Bot, which registers as Cursor, Cursor, OpenClaw,
 *   Hermes; any agent_can_build: false agent too), so EarnKit may ask once to check in every Monday.
 * Read from the caller's own installation's registered name (installations.client_name) and the builder's
 * standing_seen.no_folder (set when find was told agent_can_build: false). Never throws: a failed read is a local agent
 * that can't schedule (the old notes, no check-in question).
 */
export type AgentReach = { hosted: boolean; schedules: boolean };

/** Registered names of agents with no folder of the builder's code (whole words, any case). */
const HOSTED_NAMES = /\b(grok|muse|meta|instinct|openclaw)\b/i;
/** Registered names of agents that can run a weekly routine (whole words, any case). */
const SCHEDULER_NAMES = /\b(grok|cursor|openclaw|hermes)\b/i;

/** The pure rule: a registered client name and the remembered agent_can_build: false. Pure. */
export function reachOf(clientName: string | null, noFolder: boolean): AgentReach {
  const name = clientName ?? '';
  return { hosted: noFolder || HOSTED_NAMES.test(name), schedules: noFolder || SCHEDULER_NAMES.test(name) };
}

export async function agentReach(own: number, builderId: number): Promise<AgentReach> {
  try {
    const [r] = await sql()<{ name: string | null; no_folder: boolean }[]>`
      SELECT (SELECT client_name FROM installations WHERE id = ${own}) AS name,
        COALESCE((SELECT (standing_seen->>'no_folder')::boolean FROM builder_profiles WHERE builder_id = ${builderId}), false) AS no_folder`;
    return reachOf(r?.name ?? null, r?.no_folder === true);
  } catch (err) {
    console.error('[reach] read', err instanceof Error ? err.name : 'error');
    return { hosted: false, schedules: false };
  }
}

/** find was told agent_can_build: false: remembered (standing_seen.no_folder), so tell's notes fit the agent too. Never throws. */
export async function rememberNoFolder(builderId: number): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"no_folder": true}'::jsonb
    WHERE builder_id = ${builderId} AND NOT COALESCE((standing_seen->>'no_folder')::boolean, false)`.catch((err: unknown) =>
    console.error('[reach] remember', err instanceof Error ? err.name : 'error'));
}
