import { writePost } from '@/lib/v5/programs-api';

/** The owner's Grok Bot adds, updates and closes API programs (Bearer EARNKIT_PROGRAMS_TOKEN). 404 while the API is off. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return writePost(request);
}
