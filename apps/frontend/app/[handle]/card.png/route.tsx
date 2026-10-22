import { cardResponse } from '../card-response';

/** v2.12.1 spec "Card": earnkit.com/<x-handle>/card.png (card-response.tsx); v3.1 one-tap posts: ?m=<code>, one post's card. */
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return cardResponse(handle, `/${handle}`, new URL(req.url).searchParams.get('m'));
}
