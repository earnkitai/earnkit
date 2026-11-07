import { unlinkPost } from '@/lib/v6/me-routes';

/** Next passes a context as the second argument; the handler's second is its test deps. */
export async function POST(request: Request) {
  return unlinkPost(request);
}
