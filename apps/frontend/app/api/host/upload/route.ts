import { hostUploadPost } from '@/lib/earnkit/hosting';

// v2.9 C12: the one-time upload URL from prepare (host: true). One zip, checked, then R2.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return hostUploadPost(request);
}
