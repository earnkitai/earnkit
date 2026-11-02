import { programWritesGet } from '@/lib/earnkit/programs-read';

/**
 * v4.9 Task 3: the owner's audit log of program writes (Bearer EARNKIT_PROGRAMS_TOKEN, the write API's gate): the last
 * 100 rows { at, program_id, action, result, reason }, never a body. 404 while the API is off.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return programWritesGet(request);
}
