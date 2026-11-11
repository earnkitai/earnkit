import { notAllowed } from '../../../lib/v5/http';
import { authorizeGet } from '../../../lib/v5/oauth-routes';

/** Next passes a context as the second argument; authorizeGet's second is its test deps. */
export async function GET(request: Request) {
  return authorizeGet(request);
}
/** L19-1: every other method is 405 with Allow. */
const refuse = () => notAllowed('GET');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
