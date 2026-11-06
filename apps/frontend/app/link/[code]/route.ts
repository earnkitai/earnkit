import { linkGet } from '@/lib/v6/link-routes';

/** Next passes the route params as the second argument; linkGet's third is its test deps. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return linkGet(request, (await params).code);
}
