import { writesGet } from '@/lib/v5/programs-api';

/** The owner's audit log of program writes and the writes waiting for approval (Bearer EARNKIT_PROGRAMS_TOKEN). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return writesGet(request);
}
