// Scoring and clarity R3 (fix round 2): Originality's embedder, run as a short-lived child process by originality.ts
// workerEmbed, so the model's memory (about 250 MB) never stays in the always-on web process. Plain ESM, no app imports.
// stdin: a JSON array of texts. stdout: a JSON array of vectors (384 numbers each, mean pooled, normalized). Then exits.
// The model files are cached in EARNKIT_MODEL_DIR (default: <os tmpdir>/earnkit-models), downloaded once from Hugging Face.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = process.env.EARNKIT_EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';
const BATCH = 4;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  const texts = JSON.parse(await readStdin());
  if (!Array.isArray(texts) || !texts.every((t) => typeof t === 'string')) throw new Error('stdin: expected an array of strings');
  const t = await import('@huggingface/transformers');
  t.env.cacheDir = process.env.EARNKIT_MODEL_DIR || join(tmpdir(), 'earnkit-models');
  const extract = await t.pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  // Small batches: one batch pads every text to the longest (up to 512 tokens), and attention memory grows with it.
  const vectors = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const out = await extract(texts.slice(i, i + BATCH), { pooling: 'mean', normalize: true });
    vectors.push(...out.tolist());
    out.dispose?.();
  }
  process.stdout.write(JSON.stringify(vectors), () => process.exit(0));
} catch (err) {
  process.stderr.write(`embed-worker: ${err instanceof Error ? err.name : 'error'}\n`);
  process.exit(1);
}
