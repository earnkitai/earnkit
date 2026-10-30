import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Footer from '../../components/common/Footer';
import { CARD_NEUTRAL, PAGE_COL } from '../../components/site/ui';
import { clientIp } from '../../../lib/earnkit/rate-limit';
import { STRIPE_TEXT, stripePageState } from '../../../lib/earnkit/stripe';
import StripeForm from './StripeForm';

/**
 * v4.6: the Stripe connect page, in the wallet page's shell (neutral card, Kaftan title, minimal footer). The link
 * (stripe.ts stripePageState, a 'stripe'-purpose token) and the form do the rest. Never indexed; never sent as a referrer.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Connect Stripe | EarnKit', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function StripePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await searchParams;
  const state = await stripePageState(typeof t === 'string' ? t : '', new Date(), { ip: clientIp(await headers()) });
  return (
    <>
      <div className={`${PAGE_COL} pb-6 pt-2`}>
        <section data-ek-stripe="" aria-labelledby="stripe-title" className={`${CARD_NEUTRAL} mx-auto flex max-w-[680px] flex-col gap-5 px-5 py-8 md:px-10 md:py-12`}>
          {state.kind === 'gone' ? (
            <p id="stripe-title" className="ek-serif text-[32px] leading-tight text-s-text md:text-[40px]">
              {state.line}
            </p>
          ) : (
            <StripeForm token={state.token} text={STRIPE_TEXT} />
          )}
        </section>
      </div>
      <Footer variant="minimal" />
    </>
  );
}
