import HomeView from './HomeView';
import { getLanding } from './lib/landing-cache';

/** The landing data is read server-side and revalidated every 10 minutes. */
export const revalidate = 600;

export default async function Home() {
  return <HomeView landing={await getLanding()} />;
}
