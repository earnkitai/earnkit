import { signinGet } from '../../../lib/earnkit/x-link';

/** v2.14: the fallback "Sign in with X" link (lib/earnkit/x-link.ts). */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return signinGet(request, (await params).code);
}
