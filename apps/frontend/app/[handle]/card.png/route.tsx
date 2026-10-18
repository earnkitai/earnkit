import { cardResponse } from '../card-response';

/** v2.12.1 spec "Card": earnkit.com/<x-handle>/card.png (card-response.tsx). */
export async function GET(_: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return cardResponse(handle, `/${handle}`);
}
