import { programRevertGet, programRevertPost } from '@/lib/earnkit/program-revert-page';

/**
 * v4.10.2 Task 4 (R7): the owner's revert link from the daily program-changes digest. GET shows a confirm page with
 * one button and changes nothing (mail scanners open links); the button's POST reverts, once. The signed token alone
 * decides.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request) => programRevertGet(request);
export const POST = (request: Request) => programRevertPost(request);
