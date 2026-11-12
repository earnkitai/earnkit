import HomeView from './HomeView';
import { getLanding } from './lib/landing-cache';
import { pageMeta, SITE_TITLE } from './lib/meta';
import { ONE_LINE } from '../lib/v5/site-copy';

export const metadata = pageMeta({ path: '/', title: SITE_TITLE, description: ONE_LINE });

/** The landing data is read server-side and revalidated every 10 minutes. */
export const revalidate = 600;

export default async function Home() {
  return <HomeView landing={await getLanding()} />;
}
