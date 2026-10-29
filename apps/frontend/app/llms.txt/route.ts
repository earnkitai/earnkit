import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/**
 * v2.13: /llms.txt, what agents read about EarnKit: the Bench's text (lib/earnkit/llms/v213.txt, no
 * builder bonus). The app runs from apps/frontend (next start) or the repo root (tests).
 */
export async function GET() {
  const name = 'v213.txt';
  for (const dir of [join(process.cwd(), 'lib/earnkit/llms'), join(process.cwd(), 'apps/frontend/lib/earnkit/llms')]) {
    try {
      const text = await readFile(join(dir, name), 'utf8');
      return new Response(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
      });
    } catch {
      // Try the next place.
    }
  }
  return new Response('Not found', { status: 404 });
}
