import { linkGet, linkPost } from '@/lib/v6/link-routes';

/** Next passes the route params as the second argument; the handlers' third is their test deps. */
type Ctx = { params: Promise<{ code: string }> };

export async function GET(request: Request, { params }: Ctx) {
  return linkGet(request, (await params).code);
}

export async function POST(request: Request, { params }: Ctx) {
  return linkPost(request, (await params).code);
}
