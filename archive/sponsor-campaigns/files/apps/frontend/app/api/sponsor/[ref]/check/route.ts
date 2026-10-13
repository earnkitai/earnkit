import { SPONSOR_NOT_OPEN, escrowEnabled } from '@/lib/earnkit/escrow';
import { checkChain, loadCampaign, paidCount } from '@/lib/earnkit/sponsor';
import { SponsorError } from '@/lib/earnkit/sponsor-rules';
import { NotFoundError } from '@/lib/earnkit/programs';
import { RateLimitError, clientIp, enforce } from '@/lib/earnkit/rate-limit';

const baseUrl = () =>
  (process.env.EARNKIT_URL ?? 'https://earnkit.com').replace(/\/$/, '');

/**
 * The fund/award pages poll this after sending: EarnKit reads the chain for the campaign's bound
 * wallet (funding) or its escrow (award). No body, nothing trusted from the caller. Public and
 * idempotent; finished campaigns answer from the database without touching the chain, a ref is
 * read from the chain at most every 15 s (`checkChain`), and each IP gets 60 checks a minute.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  // Until EarnKit's escrow is configured on this deployment there is nothing to check.
  if (!escrowEnabled())
    return Response.json({ error: SPONSOR_NOT_OPEN }, { status: 503 });
  try {
    await enforce(
      'chainChecks',
      clientIp(request.headers),
      'Too many checks from this address.',
    );
  } catch (err) {
    if (!(err instanceof RateLimitError)) throw err;
    return Response.json(
      { error: err.message },
      { status: 429, headers: { 'Retry-After': String(err.retryAfter) } },
    );
  }
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
