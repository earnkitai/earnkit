import { notAllowed, preflight } from '../../../lib/v5/http';
import { tokenPost } from '../../../lib/v5/oauth-routes';

/** Next passes a context as the second argument; tokenPost's second is its test deps. */
export async function POST(request: Request) {
  return tokenPost(request);
}
export const OPTIONS = preflight;
/** L19-1: every other method is 405 with Allow. */
const refuse = () => notAllowed('POST, OPTIONS', true);
export const GET = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
