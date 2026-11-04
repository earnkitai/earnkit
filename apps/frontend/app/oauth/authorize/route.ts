import { authorizeGet } from '@/lib/v5/oauth-routes';

/** Next passes a context as the second argument; authorizeGet's second is its test deps. */
export async function GET(request: Request) {
  return authorizeGet(request);
}
