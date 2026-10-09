import { hostTakedownPost } from '@/lib/earnkit/hosting';

// v2.9 C14: the owner's kill switch and review for hosted sites; Bearer ADMIN_VETO_SECRET only.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return hostTakedownPost(request);
}
