import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { benchEnabled } from '../../lib/earnkit/builder-score-flag';

export const dynamic = 'force-dynamic';

/**
 * v2.13: /llms.txt, what agents read about EarnKit. Today's text (lib/earnkit/llms/v212.txt, the
 * former public/llms.txt) byte for byte with the Bench flag off; the Bench's (v213.txt, no builder
 * bonus) with it on. The app runs from apps/frontend (next start) or the repo root (tests).
 */
export async function GET() {
  const name = benchEnabled() ? 'v213.txt' : 'v212.txt';
  for (const dir of [join(process.cwd(), 'lib/earnkit/llms'), join(process.cwd(), 'apps/frontend/lib/earnkit/llms')]) {
    try {
      return new Response(await readFile(join(dir, name), 'utf8'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
      });
    } catch {
      // Try the next place.
    }
  }
  return new Response('Not found', { status: 404 });
}
