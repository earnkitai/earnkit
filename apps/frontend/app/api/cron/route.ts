import { cronPost } from '@/lib/v5/cron';

// The daily job: .github/workflows/earnkit-cron.yml calls this with CRON_SECRET.
export const dynamic = 'force-dynamic';

/** The freshness probe and the owner's digest; Bearer CRON_SECRET only. */
export async function POST(request: Request) {
  return cronPost(request);
}
