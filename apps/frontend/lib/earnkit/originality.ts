import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knownIdeas from '../../../../programs/ideas/known-ideas.json';
import { sql } from './db';
import { githubAppEnabled } from './github-app';
import { benchConfirmedSql } from './main-project';
import { APP_PROOF, appClient } from './repo-proof';

/**
 * Scoring and clarity R3: Originality, 0 to 100, a separate value per main project. Shown next to Shipping, never
 * ranked. A project's text (its description, then its README, markdown stripped) is embedded by a small local
 * sentence model (no paid API) and compared with every other builder's project and with a short list of well-known
 * public ideas (programs/ideas/known-ideas.json). Runs in the hourly cron (originalityStep), never in a request.
 * Privacy: the text is never stored, only its hash, its vector and the nearest list (other projects by key only).
 */

/** The model. Part of every text hash, so a new model re-embeds everything. */
export const MODEL = 'Xenova/all-MiniLM-L6-v2';
export const DIMS = 384;
/** At most this many projects are checked a run. */
export const ORIGINALITY_PER_RUN = 20;
/** The README's first characters that count (after the markdown is stripped). */
export const README_CHARS = 4000;
/** A project's README is read again at most this often while its description stays the same. */
export const RECHECK_MS = 7 * 86_400_000;
/** A project whose README couldn't be read (no App token) is tried again after this long. */
export const RETRY_MS = 6 * 3_600_000;
/** Similarity at or under LOW is 100, at or over HIGH is 0. */
export const SIM = { low: 0.35, high: 0.9 } as const;
const NEAREST = 3;

export type Embed = (texts: string[]) => Promise<number[][]>;
export type Near = { kind: 'project'; key: string; similarity: number } | { kind: 'idea'; title: string; similarity: number };

/** Originality from the highest similarity: 100 at or under SIM.low, 0 at or over SIM.high, linear between. Pure. */
export function originalityOf(maxSim: number): number {
  if (!Number.isFinite(maxSim)) return 100;
  return Math.max(0, Math.min(100, Math.round((100 * (SIM.high - maxSim)) / (SIM.high - SIM.low))));
}

/** Cosine similarity (the vectors need not be normalized). 0 for an empty or zero vector. Pure. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** At most this many bytes of a README are decoded (GitHub's README can be huge). */
export const README_MAX_BYTES = 64 * 1024;

/**
 * A README's words: code, HTML, images, badges, link targets, URLs and markdown marks removed, spaces squashed. The
 * input is cut to README_CHARS before any pattern runs, and no pattern nests a quantifier over overlapping characters
 * (line patterns use [ \t], never \s, so they never backtrack across lines). Pure.
 */
export function stripMarkdown(raw: string): string {
  return raw
    .slice(0, README_CHARS)
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(~~~|$)/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*\[[^\]\n]+\]:[ \t]*\S.*$/gm, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*_=|:][ \t]*){3,}$/gm, ' ')
    .replace(/[*_~|#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What is embedded: the description first (the model reads only the start), then the README's words. Pure. */
export function originalityText(description: string, readme: string | null): string {
  const words = readme ? stripMarkdown(readme).trim() : '';
  return [description.trim(), words].filter(Boolean).join('\n');
}

/** The hash a text is stored under (the model's name included). Pure. */
export const textHash = (text: string) => createHash('sha256').update(`${MODEL}\n${text}`).digest('hex');

type Other = { kind: 'project'; key: string; builder_id: number; vec: number[] } | { kind: 'idea'; title: string; vec: number[] };

/** The NEAREST closest of `others` (another builder's project, or an idea) and the highest similarity. Pure. */
export function nearestOf(vec: number[], self: { key: string; builder_id: number }, others: Other[]): { max: number; nearest: Near[] } {
  const scored: Near[] = [];
  for (const o of others) {
    if (o.kind === 'project' && (o.builder_id === self.builder_id || o.key === self.key)) continue;
    const similarity = Math.round(cosine(vec, o.vec) * 1000) / 1000;
    scored.push(o.kind === 'project' ? { kind: 'project', key: o.key, similarity } : { kind: 'idea', title: o.title, similarity });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return { max: scored[0]?.similarity ?? 0, nearest: scored.slice(0, NEAREST) };
}

let model: Promise<(texts: string[], o: object) => Promise<{ tolist(): number[][] }>> | null = null;
/**
 * The local model (transformers.js, quantized MiniLM: mean pooling, normalized, 384 numbers), loaded once per process
 * on first use. Its files are downloaded once from Hugging Face into EARNKIT_MODEL_DIR (default: the OS temp dir).
 * EARNKIT_EMBED_OFF=1 refuses (tests set it, so no test downloads the model by accident).
 */
export const localEmbed: Embed = async (texts) => {
  if (process.env.EARNKIT_EMBED_OFF === '1') throw new Error('embedding is off');
  model ??= (async () => {
    const t = await import('@huggingface/transformers');
    t.env.cacheDir = process.env.EARNKIT_MODEL_DIR || join(tmpdir(), 'earnkit-models');
    return (await t.pipeline('feature-extraction', MODEL, { dtype: 'q8' })) as never;
  })().catch((err: unknown) => {
    model = null;
    throw err;
  });
  const out = await (await model)(texts, { pooling: 'mean', normalize: true });
  return out.tolist();
};

const ideaList = (): string[] => [...new Set((knownIdeas as { ideas: string[] }).ideas.map((x) => x.trim()).filter(Boolean))];

/** The known ideas' vectors: cached rows by text hash, the missing ones embedded once and stored. */
async function ideaVectors(embed: Embed): Promise<{ title: string; vec: number[] }[]> {
  const db = sql();
  const ideas = ideaList().map((title) => ({ title, hash: textHash(title) }));
  const rows = await db<{ text_hash: string; embedding: number[] }[]>`
    SELECT text_hash, embedding FROM known_idea_embeddings WHERE text_hash IN ${db(ideas.map((i) => i.hash))}`;
  const have = new Map(rows.map((r) => [r.text_hash, r.embedding.map(Number)]));
  const missing = ideas.filter((i) => !have.has(i.hash));
  if (missing.length) {
    const vecs = await embed(missing.map((i) => i.title));
    for (const [n, i] of missing.entries()) {
      have.set(i.hash, vecs[n]);
      await db`INSERT INTO known_idea_embeddings (text_hash, idea, embedding) VALUES (${i.hash}, ${i.title}, ${vecs[n]}::real[])
        ON CONFLICT (text_hash) DO NOTHING`;
    }
  }
  return ideas.map((i) => ({ title: i.title, vec: have.get(i.hash)! }));
}

/** The README's text through the App's client (base64 in the JSON answer), or null when there is none or it failed. */
export async function readReadme(get: <T>(path: string) => Promise<T | null>, key: string): Promise<string | null> {
  const r = await get<{ content?: unknown; encoding?: unknown }>(`/repos/${key}/readme`);
  if (typeof r?.content !== 'string' || r.encoding !== 'base64') return null;
  // Only the first README_MAX_BYTES are decoded (4 base64 characters carry 3 bytes; GitHub wraps lines with \n).
  const b64 = r.content.replace(/[^A-Za-z0-9+/=]/g, '').slice(0, Math.ceil(README_MAX_BYTES / 3) * 4);
  return Buffer.from(b64, 'base64').subarray(0, README_MAX_BYTES).toString('utf8');
}

type Due = {
  id: number; key: string; description: string; desc_hash: string;
  /** The stored row: its builder, text and description hashes, and whether it has a vector. */
  owner: number | null; text_hash: string | null; old_desc: string | null; has_vec: boolean;
};

/**
 * R3's cron step: the main projects with an App-proven repo that are due (no embedding yet, another builder owned the
 * row, the description changed, or the README wasn't checked in RECHECK_MS), at most ORIGINALITY_PER_RUN while
 * `deadline` allows. Each one's README is read with its installation token; the text is embedded only when its hash
 * changed. Then Originality is written for every changed project, and for every other project a changed one is now
 * among the nearest of (so an earlier project's Originality drops when a close one arrives, and rises when it moves away).
 */
export async function originalityStep(
  now: Date,
  o: { deadline: number; only?: number[]; ghFetch?: typeof fetch; embed?: Embed },
): Promise<{ step: 'skipped' } | { checked: number; embedded: number; updated: number }> {
  if (!githubAppEnabled()) return { step: 'skipped' };
  const db = sql();
  const recheck = new Date(now.getTime() - RECHECK_MS);
  const retry = new Date(now.getTime() - RETRY_MS);
  const due = await db<Due[]>`
    WITH mains AS (
      SELECT p.builder_id AS id, lower(b.project_key) AS key, b.what,
        (SELECT NULLIF(trim(x.signals->>'description'), '') FROM builder_sources s
          JOIN LATERAL ((SELECT l.signals, l.read_at AS at FROM source_live l WHERE l.source_id = s.id AND l.ok)
            UNION ALL (SELECT r.signals, r.day::timestamptz AS at FROM source_readings r WHERE r.source_id = s.id AND r.ok ORDER BY r.day DESC LIMIT 1)
            ORDER BY at DESC LIMIT 1) x ON true
          WHERE s.builder_id = p.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND lower(s.project_key) = lower(b.project_key)
          LIMIT 1) AS gh
      FROM builder_profiles p
      JOIN builder_projects b ON b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) AND ${benchConfirmedSql(db)}
      WHERE EXISTS (SELECT 1 FROM builder_sources a WHERE a.builder_id = p.builder_id AND a.kind = 'repo' AND a.state = 'verified' AND a.proof = ${APP_PROOF}
          AND regexp_replace(lower(trim(a.ref)), '^(https?://)?(www[.])?github[.]com/', '') = lower(b.project_key))
        ${o.only ? db`AND p.builder_id IN ${db(o.only.length ? o.only : [-1])}` : db``}
    ), described AS (
      -- The builder's own words (what) and GitHub's description, once each.
      SELECT id, key, CASE WHEN gh IS NULL THEN COALESCE(what, '') WHEN what IS NULL OR strpos(gh, rtrim(what, '…')) > 0 THEN gh
        ELSE what || E'\n' || gh END AS description
      FROM mains
    )
    SELECT d.id, d.key, d.description, encode(sha256(convert_to(d.description, 'UTF8')), 'hex') AS desc_hash,
      e.builder_id AS owner, e.text_hash, e.desc_hash AS old_desc, (e.embedding IS NOT NULL) AS has_vec
    FROM described d LEFT JOIN project_embeddings e ON e.project_key = d.key
    WHERE e.project_key IS NULL OR e.builder_id <> d.id
      OR (e.embedding IS NULL AND e.checked_at < ${retry})
      OR (e.embedding IS NOT NULL AND (e.desc_hash IS DISTINCT FROM encode(sha256(convert_to(d.description, 'UTF8')), 'hex') OR e.checked_at < ${recheck}))
    ORDER BY (e.project_key IS NULL) DESC, e.checked_at NULLS FIRST, d.id
    LIMIT ${ORIGINALITY_PER_RUN}`;
  if (due.length === 0) return { checked: 0, embedded: 0, updated: 0 };
  const embed = o.embed ?? localEmbed;
  const ghFetch = o.ghFetch ?? fetch;
  const changed = new Map<string, { id: number; vec: number[]; text_hash: string; desc_hash: string }>();
  let checked = 0;
  for (const d of due) {
    if (Date.now() >= o.deadline) break;
    checked++;
    // Another builder's row for the same repo: theirs is dropped (a derived cache), and this one starts fresh.
    if (d.owner !== null && d.owner !== d.id) await db`DELETE FROM project_embeddings WHERE project_key = ${d.key} AND builder_id = ${d.owner}`;
    const owned = d.owner === d.id && d.has_vec;
    const stamp = (descHash: string | null) => db`
      INSERT INTO project_embeddings (project_key, builder_id, desc_hash, checked_at) VALUES (${d.key}, ${d.id}, ${descHash}, ${now})
      ON CONFLICT (project_key) DO UPDATE SET checked_at = EXCLUDED.checked_at, desc_hash = COALESCE(EXCLUDED.desc_hash, project_embeddings.desc_hash)`;
    const get = await appClient(d.id, d.key, ghFetch);
    if (!get) {
      await stamp(null);
      continue;
    }
    const readme = await readReadme(get, d.key);
    const text = originalityText(d.description, readme);
    const hash = textHash(text);
    // No new vector for: nothing to embed, the same text, or a README read that failed while the description stayed.
    if (!text || (owned && (d.text_hash === hash || (readme === null && d.old_desc === d.desc_hash)))) {
      await stamp(owned ? d.desc_hash : null);
      continue;
    }
    const [vec] = await embed([text]);
    if (!Array.isArray(vec) || vec.length !== DIMS) throw new Error('embedding: wrong size');
    changed.set(d.key, { id: d.id, vec, text_hash: hash, desc_hash: d.desc_hash });
  }
  const updated = changed.size ? await rescoreOriginality(changed, embed, now) : 0;
  return { checked, embedded: changed.size, updated };
}

/**
 * Writes the changed projects' vectors with their Originality and nearest list, then rescoring every stored project a
 * changed vector now beats its nearest list for (or that listed a changed project before). Cosine in JS (N is small).
 */
async function rescoreOriginality(
  changed: Map<string, { id: number; vec: number[]; text_hash: string; desc_hash: string }>,
  embed: Embed,
  now: Date,
): Promise<number> {
  const db = sql();
  const ideas = (await ideaVectors(embed)).map((i) => ({ kind: 'idea' as const, ...i }));
  const rows = await db<{ key: string; builder_id: number; embedding: number[]; nearest: Near[] }[]>`
    SELECT project_key AS key, builder_id, embedding, nearest FROM project_embeddings WHERE embedding IS NOT NULL`;
  const projects = new Map<string, { key: string; builder_id: number; vec: number[]; nearest: Near[] }>(
    rows.map((r) => [r.key, { key: r.key, builder_id: r.builder_id, vec: r.embedding.map(Number), nearest: r.nearest ?? [] }]),
  );
  for (const [key, c] of changed) projects.set(key, { key, builder_id: c.id, vec: c.vec, nearest: [] });
  const others: Other[] = [...[...projects.values()].map((p) => ({ kind: 'project' as const, key: p.key, builder_id: p.builder_id, vec: p.vec })), ...ideas];
  let n = 0;
  for (const [key, c] of changed) {
    const { max, nearest } = nearestOf(c.vec, { key, builder_id: c.id }, others);
    await db`
      INSERT INTO project_embeddings (project_key, builder_id, text_hash, desc_hash, embedding, originality, nearest, computed_at, checked_at)
      VALUES (${key}, ${c.id}, ${c.text_hash}, ${c.desc_hash}, ${c.vec}::real[], ${originalityOf(max)}, ${db.json(nearest as never)}, ${now}, ${now})
      ON CONFLICT (project_key) DO UPDATE SET builder_id = EXCLUDED.builder_id, text_hash = EXCLUDED.text_hash, desc_hash = EXCLUDED.desc_hash,
        embedding = EXCLUDED.embedding, originality = EXCLUDED.originality, nearest = EXCLUDED.nearest,
        computed_at = EXCLUDED.computed_at, checked_at = EXCLUDED.checked_at`;
    n++;
  }
  for (const p of projects.values()) {
    if (changed.has(p.key)) continue;
    const floor = p.nearest.length < NEAREST ? -Infinity : Math.min(...p.nearest.map((x) => x.similarity));
    const touched = [...changed].some(([key, c]) =>
      (c.id !== p.builder_id && cosine(p.vec, c.vec) > floor) || p.nearest.some((x) => x.kind === 'project' && x.key === key));
    if (!touched) continue;
    const { max, nearest } = nearestOf(p.vec, p, others);
    await db`UPDATE project_embeddings SET originality = ${originalityOf(max)}, nearest = ${db.json(nearest as never)} WHERE project_key = ${p.key}`;
    n++;
  }
  return n;
}

/** The builder's main project's Originality, or null before it is computed (or for another builder's row). */
export async function readOriginality(builderId: number, key: string | null): Promise<number | null> {
  if (!key) return null;
  const [r] = await sql()<{ originality: number | null }[]>`
    SELECT originality FROM project_embeddings WHERE project_key = lower(${key}) AND builder_id = ${builderId}`;
  return r?.originality ?? null;
}
