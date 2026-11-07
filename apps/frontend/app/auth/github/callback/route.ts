import { callbackGet } from '@/lib/v6/link-routes';

/** Next passes a context as the second argument; callbackGet's second is its test deps. */
export async function GET(request: Request) {
  return callbackGet(request);
}
