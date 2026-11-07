import { preflight } from '@/lib/v5/http';
import { reviewersPost } from '@/lib/v6/reviewers';

/** The owner marks a signed-in builder as a program's reviewer (Bearer EARNKIT_PROGRAMS_TOKEN). 404 while the API is off. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = reviewersPost;
export const OPTIONS = preflight;
