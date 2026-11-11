import { linkPost } from '@/lib/v6/link-routes';

/** Next passes the route params as the second argument; the handler's third is its test deps. */
type Ctx = { params: Promise<{ code: string }> };

/** POST /link/<code>/confirm (L27-4, v6.1.16): the confirm page's button. GET /link/<code> is the page itself. */
export async function POST(request: Request, { params }: Ctx) {
  return linkPost(request, (await params).code);
}
