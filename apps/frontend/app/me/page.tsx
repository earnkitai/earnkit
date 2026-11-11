import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Footer from '../components/common/Footer';
import MeView from './MeView';
import { ME_DESCRIPTION, ME_TITLE } from '../../lib/v5/site-copy';
import { authSecret, meData, problemShown } from '../../lib/v6/me-view';
import { COOKIE, cookieValue, sessionBuilder } from '../../lib/v6/sessions';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${ME_TITLE} · EarnKit`, description: ME_DESCRIPTION, robots: { index: false, follow: false } };

/** The signed-in builder's record (proxy.ts sends a visitor without a session to /docs#record first). */
type Query = { problem?: string | string[]; note?: string | string[]; sig?: string | string[]; link?: string | string[]; at?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MePage({ searchParams }: { searchParams: Promise<Query> }) {
  const now = new Date();
  // One parser for the session cookie (v6.1.7 B2): the first ek_me in the raw header, as the gate and every post read it.
  const cookie = (await headers()).get('cookie');
  const token = cookieValue(cookie, COOKIE);
  const builder = token ? await sessionBuilder(cookie, now) : null;
  if (!token || !builder) redirect('/docs#record');
  const q = await searchParams;
  // Only a line /me's own handlers signed is shown; React escapes it. ?link= is the code GitHub sign-in came back with.
  const problem = problemShown('problem', one(q.problem), one(q.sig), builder.id, now, authSecret());
  const note = problem ? null : problemShown('note', one(q.note), one(q.sig), builder.id, now, authSecret());
  const data = await meData(builder, now, token, one(q.link));
  return (
    <>
      <MeView data={data} problem={problem} note={note} saved={one(q.at) ?? null} />
      {/* L21-22 (v6.1.16): with a linked agent the install pill goes; the Ask line stays. */}
      <Footer linked={data.installations.length > 0} />
    </>
  );
}
