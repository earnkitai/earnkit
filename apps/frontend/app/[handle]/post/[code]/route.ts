import { postResponse } from '../../post-response';

/** v3.1 one-tap posts: earnkit.com/<x-handle>/post/<code> counts the tap and opens X with the drafted post (post-response.ts). */
export async function GET(req: Request, { params }: { params: Promise<{ handle: string; code: string }> }) {
  const { handle, code } = await params;
  return postResponse(handle, `/${handle}`, code, { request: req });
}
