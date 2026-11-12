import { Unavailable } from '../programs/[id]/GuideView';
import { GUIDE_UNAVAILABLE } from '../programs/[id]/unavailable';

/**
 * Where proxy.ts sends a guide path when the guide ids could not be read (N3, v6.1.17 Task 4): rendered per request, so
 * the failure is never cached and the next request reads again; the panel is in the server HTML. Not in the sitemap.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program guide · EarnKit', robots: { index: false, follow: false } };

export default function GuideUnavailablePage() {
  return <Unavailable text={GUIDE_UNAVAILABLE} />;
}
