import { weekGet, weekPost } from '@/lib/earnkit/week-links';

// v3 Stage 1 (spec 5.4): the Monday email's Looks right and Hide this week links. GET shows the week and one button
// (mail scanners change nothing); only the button's POST approves or hides. The signed token alone decides; idempotent.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request) => weekGet(request);
export const POST = (request: Request) => weekPost(request);
