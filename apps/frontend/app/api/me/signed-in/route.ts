import { refuseFor } from '../../../../lib/v5/route-methods';
import { hasSession } from '../../../../lib/v6/sessions';

/**
 * Whether the visitor is signed in (v6.1.17 Task 4), for the header's `Your record` after load: `{ signedIn: boolean }`
 * and nothing else, never stored by any cache. A failed read answers false (the footer still links /me).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let signedIn = false;
  try {
    signedIn = await hasSession(request.headers.get('cookie'), new Date());
  } catch (err) {
    console.error('[signed-in] read failed', (err as { name?: string } | null)?.name ?? 'unknown');
  }
  return Response.json({ signedIn }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`, L31-1). */
const refuse = refuseFor('/api/me/signed-in');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
