import { vetoPost } from '@/lib/earnkit/veto';

// The owner's veto during a campaign's 48 h review (v2.4 §3). POST only: opening a link never removes anything.
export const dynamic = 'force-dynamic';

/** Removes one entry in review: form fields slug, key (the campaign's veto key), entry, reason. */
export async function POST(request: Request) {
  return vetoPost(request);
}
