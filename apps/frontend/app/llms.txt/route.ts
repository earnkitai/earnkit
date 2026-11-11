import { LLMS_TEXT } from '../../lib/v5/llms';
import { refuseFor } from '../../lib/v5/route-methods';

export const dynamic = 'force-static';

/** /llms.txt: what agents and researchers read about EarnKit. */
export async function GET() {
  return new Response(LLMS_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/llms.txt');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
