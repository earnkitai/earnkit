import { randomBytes } from 'node:crypto';
import { sql } from '../db';

/**
 * v3.1 F3: no rank shows under RANK_MIN_POOL ranked builders. A test about rank words adds `n` listed, ranked builders
 * (claimed, a confirmed project with its verified repo, as bench-rank.test.ts listed) at `score` (default 0, below
 * everyone under test), so the pool reaches the minimum. Returns their ids (for an `only` pool).
 */
export async function padPool(n: number, score = 0): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const tag = randomBytes(4).toString('hex');
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`pad-${tag}`}) RETURNING id`;
    const key = `pad${tag}/p`;
    await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle) VALUES (${id}, ${`pad-${tag}`}, ${key}, ${`padx${tag}`}, ${`pad${tag}`})`;
    await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at) VALUES (${id}, ${score}, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, chains) VALUES (${id}, ${key}, 'P', 'app', true, true, '{}')`;
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
    ids.push(id);
  }
  return ids;
}
