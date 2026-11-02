import { programApproveGet, programApprovePost } from '@/lib/earnkit/program-approve';

/**
 * v4.10.1 Task 4 (R4): the owner's approve link for a pending program write. GET shows a confirm page with one button
 * and changes nothing (mail scanners open links); the button's POST approves, once. The signed token alone decides.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request) => programApproveGet(request);
export const POST = (request: Request) => programApprovePost(request);
