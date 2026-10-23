import { sql } from '../db';

/**
 * v3.1 wallet proof: marks the optional wallet step as offered already (standing_seen.wallet_asked), for a test about
 * another ranked step (v31-wallet-proof.test.ts covers the wallet step itself).
 */
export async function walletOffered(builderId: number): Promise<void> {
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('wallet_asked', now()::text) WHERE builder_id = ${builderId}`;
}
