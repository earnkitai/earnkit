import { stripePost } from '../../../../lib/earnkit/stripe';

/** v4.6: the Stripe connect page's POST ({ t, key }); same origin, rate limited (stripe.ts). The key is never returned. */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return stripePost(request);
}
