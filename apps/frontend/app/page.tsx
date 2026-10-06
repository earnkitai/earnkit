import HomeView from './HomeView';
import { getLanding } from './lib/landing-cache';

/** v2.7 §1: the landing data is read server-side and revalidated every 10 minutes. */
export const revalidate = 600;

/** The homepage: one cached read (or null on failure, Ruling 21 (plan)), rendered by HomeView. */
export default async function Home() {
  return <HomeView landing={await getLanding()} />;
}
