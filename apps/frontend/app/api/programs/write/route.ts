import { programsWritePost } from '@/lib/earnkit/programs-api';

/**
 * v4.9 Task 2: the owner's Grok Bot adds, updates and closes API programs (Bearer EARNKIT_PROGRAMS_TOKEN). 404 while
 * the token is unset or EARNKIT_PROGRAMS_API=off. The checks and answers are in lib/earnkit/programs-api.ts.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return programsWritePost(request);
}
