import { pickPost } from '@/lib/earnkit/github-connect';

// Sign-in first: the repo picker's button (several repos in the installation). Off (404) with GitHub sign-in off.
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => pickPost(request);
