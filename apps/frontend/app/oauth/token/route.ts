import { preflight } from '@/lib/v5/http';
import { tokenPost } from '@/lib/v5/oauth-routes';

/** Next passes a context as the second argument; tokenPost's second is its test deps. */
export async function POST(request: Request) {
  return tokenPost(request);
}
export const OPTIONS = preflight;
