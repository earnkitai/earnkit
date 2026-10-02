import { SPONSOR_NOT_OPEN, escrowEnabled } from '@/lib/earnkit/escrow';
import { confirmTx } from '@/lib/earnkit/sponsor';
import { SponsorError } from '@/lib/earnkit/sponsor-rules';
import { NotFoundError } from '@/lib/earnkit/programs';
import { receiptNotFoundMessage } from '@/lib/earnkit/receipt-error';

/** The fund/award pages report a tx hash; this verifies it onchain. Public and idempotent. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  // Until EarnKit's escrow is configured on this deployment there is nothing to confirm.
  if (!escrowEnabled())
    return Response.json({ error: SPONSOR_NOT_OPEN }, { status: 503 });
  const { ref } = await params;
  const body = (await request.json().catch(() => null)) as {
    tx?: unknown;
  } | null;
  const raw = typeof body?.tx === 'string' ? body.tx : '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw))
    return Response.json(
      { error: 'tx must be a transaction hash' },
      { status: 400 },
    );
  const tx = raw as `0x${string}`;
  try {
    // Routed by what the receipt contains: a funding receipt (draft, a lazily-expired draft it
    // rescues, or a re-confirm of a campaign that's already live) or an award receipt.
    return Response.json({ ok: true, ...(await confirmTx(ref, tx)) });
  } catch (err) {
    const receiptMsg = receiptNotFoundMessage(err);
    if (receiptMsg)
      return Response.json({ error: receiptMsg }, { status: 400 });
    if (err instanceof SponsorError || err instanceof NotFoundError)
      return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
