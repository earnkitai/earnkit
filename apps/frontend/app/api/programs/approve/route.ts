import { approveGet, approvePost } from '@/lib/v5/programs-api';

/**
 * The owner's approve link for a pending program write. GET shows a confirm page and changes
 * nothing (mail scanners open links); the button's POST approves, once. The signed token decides.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request) => approveGet(request);
export const POST = (request: Request) => approvePost(request);
