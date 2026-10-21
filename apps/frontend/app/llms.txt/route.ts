import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { raisingEnabled } from '../../lib/earnkit/builder-score-flag';

export const dynamic = 'force-dynamic';

/** v3.1: the llms.txt line for confirm (Backing only); removed with EARNKIT_RAISING off. */
const CONFIRM_LINE = "- confirm: only opens Backing, by project_id, after the builder's yes.\n";

/** Final fix (controller ruling): with EARNKIT_RAISING off, the Bench's text names no raising. Pure. */
const withoutRaising = (text: string) =>
  text
    .replace('- Backing through a tokens.fun coin:', '- A tokens.fun coin for the project:')
    // v3.1 (spec 3.4, D1): confirm is registered only with EARNKIT_RAISING on, so it is named only then.
    .replace(CONFIRM_LINE, '');

/**
 * v2.13: /llms.txt, what agents read about EarnKit: the Bench's text (lib/earnkit/llms/v213.txt, no
 * builder bonus). The app runs from apps/frontend (next start) or the repo root (tests).
 */
export async function GET() {
  const name = 'v213.txt';
  for (const dir of [join(process.cwd(), 'lib/earnkit/llms'), join(process.cwd(), 'apps/frontend/lib/earnkit/llms')]) {
    try {
      const text = await readFile(join(dir, name), 'utf8');
      return new Response(!raisingEnabled() ? withoutRaising(text) : text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
      });
    } catch {
      // Try the next place.
    }
  }
  return new Response('Not found', { status: 404 });
}
