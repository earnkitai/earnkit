import { verifyConfirm, verifyStart } from '@/lib/earnkit/github-verify';

// v2.9 B9, Ruling G8: the sign-in link shows a confirm page (GET); its button (POST) sends the
// builder to GitHub.
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => verifyStart(request);
export const POST = (request: Request) => verifyConfirm(request);
