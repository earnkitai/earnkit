import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cache } from 'react';
import Footer from '../../components/common/Footer';
import LinkView from './LinkView';
import { publicOrigin } from '../../../lib/v5/oauth';
import { linkDocTitle, linkState } from '../../../lib/v6/link-routes';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ code: string }> };

/** One read per request (the metadata and the page share it, so a view counts once against the address limit). */
const stateOf = cache(async (code: string) => linkState(code, new Date(), new Headers(await headers())));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await stateOf((await params).code);
  return { title: linkDocTitle(s.title), robots: { index: false, follow: false } };
}

/**
 * GET /link/<code> (L27-4, v6.1.16): every state in the site shell (skip link, header, main, one h1, footer) with the
 * title `{state} · EarnKit`. The page answers 200 for every state: Next sets no 429 or 503 from a page, and its
 * notFound() body is an empty shell, so the state's own status (linkState's `status`) is data only. Never cached,
 * never indexed, never framed (next.config.ts).
 */
export default async function LinkPage({ params }: Props) {
  const { code } = await params;
  const s = await stateOf(code);
  const h = await headers();
  const host = publicOrigin(new Request(`http://${h.get('host') ?? 'localhost'}/`)).replace(/^https?:\/\//, '');
  return (
    <>
      <LinkView s={s} code={code} host={host} />
      <Footer />
    </>
  );
}
