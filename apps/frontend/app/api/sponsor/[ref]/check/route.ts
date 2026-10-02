import { SPONSOR_NOT_OPEN, escrowEnabled } from '@/lib/earnkit/escrow';
import { checkChain, loadCampaign, paidCount } from '@/lib/earnkit/sponsor';
import { SponsorError } from '@/lib/earnkit/sponsor-rules';
import { NotFoundError } from '@/lib/earnkit/programs';

const baseUrl = () =>
  (process.env.EARNKIT_URL ?? 'https://earnkit.com').replace(/\/$/, '');

/**
 * The fund/award pages poll this after sending: EarnKit reads the chain for the campaign's bound
 * wallet (funding) or its escrow (award). No body, nothing trusted from the caller. Public and
 * idempotent; finished campaigns answer from the database without touching the chain.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  // Until EarnKit's escrow is configured on this deployment there is nothing to check.
  if (!escrowEnabled())
    return Response.json({ error: SPONSOR_NOT_OPEN }, { status: 503 });
  const { ref } = await params;
  if (!/^0x[0-9a-f]{64}$/.test(ref))
    return Response.json({ error: 'No such campaign.' }, { status: 404 });
  try {
    const { fundingProblem } = await checkChain(await loadCampaign(ref));
    const row = await loadCampaign(ref);
    return Response.json({
      state: row.state,
      ...(row.program_id && {
        campaign_url: `${baseUrl()}/campaigns/${row.program_id}`,
      }),
      ...(row.state === 'awarded' && {
        paid: await paidCount(row),
      }),
      ...(fundingProblem && { problem: fundingProblem }),
    });
  } catch (err) {
    if (err instanceof NotFoundError)
      return Response.json({ error: err.message }, { status: 404 });
    if (err instanceof SponsorError)
      return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
