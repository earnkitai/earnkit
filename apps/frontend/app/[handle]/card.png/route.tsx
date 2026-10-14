import { builderScoreEnabled } from '../../../lib/earnkit/builder-score-flag';
import { cardResponse } from '../card-response';

/** v2.12.1 spec "Card": earnkit.com/<x-handle>/card.png (card-response.tsx). Flag off: 404. */
export async function GET(_: Request, { params }: { params: Promise<{ handle: string }> }) {
  if (!builderScoreEnabled()) return new Response('Not found', { status: 404 });
  const { handle } = await params;
  return cardResponse(handle, `/${handle}`);
}
