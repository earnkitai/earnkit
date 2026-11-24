import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Footer from '../../components/common/Footer';
import { CARD_PANEL, H1_SITE, PAGE_COL } from '../../components/site/ui';
import { flagOn } from '../../../lib/v5/flags';
import { getRecord } from '../../../lib/v6/builders';
import { CONSENT_ITEMS, START_COPY } from '../../../lib/v6/consent';
import { authSecret, csrfToken, utcDay } from '../../../lib/v6/me-view';
import { sessionBuilder, sessionToken } from '../../../lib/v6/sessions';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${START_COPY.title} · EarnKit`, robots: { index: false, follow: false } };

type Query = { e?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** v3.8 E12 (`form`): the one onboarding form after sign-in. Off, it is /me. */
export default async function StartPage({ searchParams }: { searchParams: Promise<Query> }) {
  if (!flagOn('form')) redirect('/me');
  const now = new Date();
  const cookie = (await headers()).get('cookie');
  const token = sessionToken(cookie);
  const builder = token ? await sessionBuilder(cookie, now) : null;
  if (!token || !builder) redirect('/docs#record');
  const current = (await getRecord(builder.id)).consent;
  const e = one((await searchParams).e);
  const problem = e === 'adult' ? START_COPY.needAdult : e === 'wallet' ? START_COPY.walletLong : null;
  const csrf = csrfToken(builder.id, utcDay(now), authSecret(), token);
  return (
    <>
      <div className={`${PAGE_COL} flex flex-col gap-4 pt-8 md:pt-12`}>
        <h1 className={H1_SITE}>{START_COPY.title}</h1>
        <form method="post" action="/me/consent" className={`${CARD_PANEL} flex flex-col gap-4 p-6 md:p-8`}>
          <input type="hidden" name="csrf" value={csrf} />
          <input type="hidden" name="action" value="save" />
          <p className="text-[16px] leading-normal text-s-muted">{START_COPY.lead}</p>
          {CONSENT_ITEMS.map(([key, words]) => (
            <label key={key} className="flex items-start gap-3 text-[16px] leading-normal">
              <input type="checkbox" name={key} defaultChecked={current ? current[key] : false} className="mt-1" />
              <span>{words}</span>
            </label>
          ))}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[16px] leading-normal">{START_COPY.adult}</legend>
            <label className="flex items-center gap-3"><input type="radio" name="adult" value="yes" defaultChecked={current?.adult === true} required /> Yes</label>
            <label className="flex items-center gap-3"><input type="radio" name="adult" value="no" defaultChecked={current?.adult === false} /> No</label>
          </fieldset>
          <label className="flex flex-col gap-2 text-[16px] leading-normal">
            <span>{START_COPY.wallet}</span>
            <input type="text" name="wallet" maxLength={120} defaultValue={current?.wallet ?? ''} className="rounded border px-3 py-2" />
          </label>
          {problem ? <p role="alert" className="text-[16px] leading-normal">{problem}</p> : null}
          <button type="submit" className="self-start rounded border px-4 py-2">{START_COPY.save}</button>
          <p className="text-[14px] leading-normal text-s-muted">
            <a href="/privacy" className="underline underline-offset-4">What is public and what stays private</a>
          </p>
        </form>
      </div>
      <Footer />
    </>
  );
}
