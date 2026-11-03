import { sql } from '../db';
import type { ShareOpen } from '../weekly-moment';

/**
 * v4.10.3 Task 3 fix round 1: an open share offer as the retired Monday question left it (standing_seen.share_open,
 * before v4.10.3), so tests can answer one through tell (weekly-moment.ts answerShare). No production code writes it now.
 */
export async function oldShareOffer(builderId: number, o: ShareOpen): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('share_open', ${sql().json(o as never)}::jsonb)
    WHERE builder_id = ${builderId}`;
}
