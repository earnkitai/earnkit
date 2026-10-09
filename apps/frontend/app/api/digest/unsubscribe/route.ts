import { digestUnsubscribeGet, digestUnsubscribePost } from '@/lib/earnkit/digest';

// v2.9 E19: the weekly email's unsubscribe. GET shows a confirm page with a POST button (link
// scanners unsubscribe nobody); POST is the RFC 8058 one-click (List-Unsubscribe-Post). The token
// alone decides; idempotent.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request) => digestUnsubscribeGet(request);
export const POST = (request: Request) => digestUnsubscribePost(request);
