import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Footer from '../components/common/Footer';
import MeView from './MeView';
import { ME_DESCRIPTION, ME_TITLE } from '../../lib/v5/site-copy';
import { authSecret, meData, problemShown } from '../../lib/v6/me-view';
import { COOKIE, sessionBuilder } from '../../lib/v6/sessions';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${ME_TITLE} · EarnKit`, description: ME_DESCRIPTION, robots: { index: false, follow: false } };

/** The signed-in builder's record (proxy.ts sends a visitor without a session to /docs#record first). */
type Query = { problem?: string | string[]; sig?: string | string[]; link?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MePage({ searchParams }: { searchParams: Promise<Query> }) {
  const now = new Date();
  const token = (await cookies()).get(COOKIE)?.value;
  const builder = token ? await sessionBuilder(`${COOKIE}=${token}`, now) : null;
  if (!builder) redirect('/docs#record');
  const q = await searchParams;
  // Only a line /me's own handlers signed is shown; React escapes it. ?link= is the code GitHub sign-in came back with.
  const problem = problemShown(one(q.problem), one(q.sig), authSecret());
  return (
    <>
      <MeView data={await meData(builder, now, one(q.link))} problem={problem} />
      <Footer />
    </>
  );
}
