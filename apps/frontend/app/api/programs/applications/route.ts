import { applicationsGet } from '../../../../lib/v5/programs-api';
import { refuseFor } from '../../../../lib/v5/route-methods';

/** The owner's list of every send, with totals (Bearer EARNKIT_PROGRAMS_TOKEN; v6.1.18 L18-5). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return applicationsGet(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/programs/applications');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
