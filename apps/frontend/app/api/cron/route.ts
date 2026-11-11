import { cronPost } from '../../../lib/v5/cron';
import { refuseFor } from '../../../lib/v5/route-methods';

// The daily job: .github/workflows/earnkit-cron.yml calls this with CRON_SECRET.
export const dynamic = 'force-dynamic';

/** The freshness probe and the owner's digest; Bearer CRON_SECRET only. */
export async function POST(request: Request) {
  return cronPost(request);
}

/** L31-1 (v6.1.16 Task 17): every method this route does not serve is 405 with its Allow (`METHODS_BY_ROUTE`). */
const refuse = refuseFor('/api/cron');
export const GET = refuse;
export const HEAD = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
export const OPTIONS = refuse;
