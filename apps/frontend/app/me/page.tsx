import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Footer from '../components/common/Footer';
import MeView from './MeView';
import { ME_DESCRIPTION, ME_TITLE } from '../../lib/v5/site-copy';
import { authSecret, isAnswerPath, meData, problemShown } from '../../lib/v6/me-view';
import { draftOf, sessionBuilder, sessionToken } from '../../lib/v6/sessions';
import { flagOn } from '../../lib/v5/flags';
import { getRecord } from '../../lib/v6/builders';
import { WITHDRAW_COPY } from '../../lib/v6/consent';

export const dynamic = 'force-dynamic';
/** L27-21 (v6.1.16): noindex and no canonical (no `alternates`; the layout sets none). */
export const metadata = { title: `${ME_TITLE} · EarnKit`, description: ME_DESCRIPTION, robots: { index: false, follow: false } };

/** The signed-in builder's record (proxy.ts sends a visitor without a session to /docs#record first). */
type Query = { problem?: string | string[]; note?: string | string[]; sig?: string | string[]; link?: string | string[]; at?: string | string[]; saved?: string | string[]; open?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const openOf = (v: string | undefined) => (v && isAnswerPath(v) ? v : null);

export default async function MePage({ searchParams }: { searchParams: Promise<Query> }) {
  const now = new Date();
  // One parser for the session cookie (v6.1.7 B2): the first session cookie in the raw header under the current name
  // only (L43-3, v6.1.19: the old ek_me is never read in production), as the gate and every post read it.
  const cookie = (await headers()).get('cookie');
  const token = sessionToken(cookie);
  const builder = token ? await sessionBuilder(cookie, now) : null;
  if (!token || !builder) redirect('/docs#record');
  // v3.8 E12 (`form`): after sign-in, the one form first, until it is saved.
  const consent = flagOn('form') ? (await getRecord(builder.id)).consent : undefined;
  if (flagOn('form') && !consent) redirect('/me/start');
  const q = await searchParams;
  // Only a line /me's own handlers signed is shown; React escapes it. ?link= is the code GitHub sign-in came back with.
  const problem = problemShown('problem', one(q.problem), one(q.sig), builder.id, now, authSecret());
  const note = problem ? null : problemShown('note', one(q.note), one(q.sig), builder.id, now, authSecret());
  // L43-4 (v6.1.19): what the builder typed into a refused form, for 15 minutes; React escapes it as every value.
  // Fix round 1 (M6): read only while a signed refusal line shows.
  const data = await meData(builder, now, token, one(q.link), problem ? await draftOf(cookie, now) : null);
  return (
    <>
      {/* L27-9, L27-10 (v6.1.16): `saved` and `at` name a section (unsigned: they only place `Saved.` and a signed line). */}
      {/* L35-24 (v6.1.17 Task 4): `open` names the one answer shown in full (unsigned: it only opens a row). */}
      <MeView data={data} problem={problem} note={note} saved={one(q.saved) ?? null} at={one(q.at) ?? null} open={openOf(one(q.open))} />
      {/* v3.8 E12 (`form`): change the form's answers, or withdraw all of them at once. */}
      {consent ? (
        <section aria-label={WITHDRAW_COPY.title} className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-8">
          <h2 className="text-[20px]">{WITHDRAW_COPY.title}</h2>
          <p className="text-[16px] leading-normal">{consent.fill || consent.submit || consent.list || consent.corpus ? WITHDRAW_COPY.on : WITHDRAW_COPY.off}</p>
          <a href="/me/start" className="underline underline-offset-4">{WITHDRAW_COPY.change}</a>
          <form method="post" action="/me/consent">
            <input type="hidden" name="csrf" value={data.csrf} />
            <input type="hidden" name="action" value="withdraw" />
            <button type="submit" className="rounded border px-4 py-2">{WITHDRAW_COPY.button}</button>
          </form>
        </section>
      ) : null}
      {/* L21-22 (v6.1.16): with a linked agent the install pill goes; the Ask line stays. */}
      <Footer linked={data.installations.length > 0} />
    </>
  );
}
