import { cronPost } from '@/lib/earnkit/cron';

// The daily jobs (v2.4 §3): .github/workflows/earnkit-cron.yml calls this with CRON_SECRET.
export const dynamic = 'force-dynamic';

/** Scoring, freezing, the 48 h review, payouts and the fee refresh; Bearer CRON_SECRET only. */
export async function POST(request: Request) {
  return cronPost(request);
}
