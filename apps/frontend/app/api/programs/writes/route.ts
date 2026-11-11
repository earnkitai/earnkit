import { writesGet } from '../../../../lib/v5/programs-api';
import { refuseFor } from '../../../../lib/v5/route-methods';

/** The owner's audit log of program writes and the writes waiting for approval (Bearer EARNKIT_PROGRAMS_TOKEN). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return writesGet(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/programs/writes');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
