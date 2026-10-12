import { scoresPost } from '@/lib/earnkit/builder-score';

// The owner's release of a held score (v2.12 spec 5). POST only: opening a link never changes anything.
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return scoresPost(request);
}
