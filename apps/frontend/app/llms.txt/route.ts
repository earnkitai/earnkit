import { LLMS_TEXT } from '../../lib/v5/llms';

export const dynamic = 'force-static';

/** /llms.txt: what agents and researchers read about EarnKit. */
export async function GET() {
  return new Response(LLMS_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
