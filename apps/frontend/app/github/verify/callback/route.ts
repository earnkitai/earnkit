import { verifyCallback } from '@/lib/earnkit/github-verify';

// v2.9 B9: GitHub's redirect back: consumes the nonce, checks ownership, shows one plain line.
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => verifyCallback(request);
