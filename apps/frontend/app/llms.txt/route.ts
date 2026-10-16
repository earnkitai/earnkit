import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { benchEnabled, raisingEnabled } from '../../lib/earnkit/builder-score-flag';

export const dynamic = 'force-dynamic';

/** Final fix (controller ruling): with EARNKIT_RAISING off, the Bench's text names no raising. Pure. */
const withoutRaising = (text: string) =>
  text.replace('with chain, raising and weekly filters.', 'with chain and weekly filters.').replace('- Raising through a tokens.fun coin:', '- A tokens.fun coin for the project:');

/**
 * v2.13: /llms.txt, what agents read about EarnKit. Today's text (lib/earnkit/llms/v212.txt, the
 * former public/llms.txt) byte for byte with the Bench flag off; the Bench's (v213.txt, no builder
 * bonus) with it on. The app runs from apps/frontend (next start) or the repo root (tests).
 */
export async function GET() {
  const name = benchEnabled() ? 'v213.txt' : 'v212.txt';
  for (const dir of [join(process.cwd(), 'lib/earnkit/llms'), join(process.cwd(), 'apps/frontend/lib/earnkit/llms')]) {
    try {
      const text = await readFile(join(dir, name), 'utf8');
      return new Response(benchEnabled() && !raisingEnabled() ? withoutRaising(text) : text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
      });
    } catch {
      // Try the next place.
    }
  }
  return new Response('Not found', { status: 404 });
}
