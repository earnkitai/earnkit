import { revertGet, revertPost } from '@/lib/v5/programs-api';

/**
 * The owner's revert link for an applied program write. GET shows a confirm page and changes
 * nothing (mail scanners open links); the button's POST reverts, once. The signed token decides.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request) => revertGet(request);
export const POST = (request: Request) => revertPost(request);
