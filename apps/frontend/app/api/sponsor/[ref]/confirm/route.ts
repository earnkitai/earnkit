import {
  confirmAward,
  confirmFunding,
  loadCampaign,
} from '@/lib/earnkit/sponsor';
import { SponsorError } from '@/lib/earnkit/sponsor-rules';
import { NotFoundError } from '@/lib/earnkit/programs';
import { receiptNotFoundMessage } from '@/lib/earnkit/receipt-error';

/** The fund/award pages report a tx hash; this verifies it onchain. Public and idempotent. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const body = (await request.json().catch(() => ({}))) as { tx?: string };
  if (!/^0x[0-9a-fA-F]{64}$/.test(body.tx ?? ''))
    return Response.json(
      { error: 'tx must be a transaction hash' },
      { status: 400 },
    );
  const tx = body.tx as `0x${string}`;
  try {
    const row = await loadCampaign(ref);
    // draft/expired → confirmFunding (it rescues a funded draft that lazily expired); live →
    // confirmAward. Any other state (awarded, refunded, taken_down) is terminal.
    if (row.state === 'draft' || row.state === 'expired')
      return Response.json({ ok: true, ...(await confirmFunding(ref, tx)) });
    if (row.state === 'live')
      return Response.json({ ok: true, ...(await confirmAward(ref, tx)) });
    return Response.json(
      { error: `This campaign is ${row.state}.` },
      { status: 400 },
    );
  } catch (err) {
    const receiptMsg = receiptNotFoundMessage(err);
    if (receiptMsg)
      return Response.json({ error: receiptMsg }, { status: 400 });
    if (err instanceof SponsorError || err instanceof NotFoundError)
      return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
