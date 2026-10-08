import { verifyStart } from '@/lib/earnkit/github-verify';

// v2.9 B9: the sign-in link: checks the one-time nonce, then sends the builder to GitHub.
export const dynamic = 'force-dynamic';
export const GET = verifyStart;
