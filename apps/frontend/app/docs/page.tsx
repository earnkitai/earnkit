import Footer from '../components/common/Footer';
import DocsView from './DocsView';
import { DOCS_DESCRIPTION } from '../../lib/earnkit/docs-copy';

/** v3.1 W9: rendered per request (no DB read) so the Backing sentence follows EARNKIT_RAISING. */
export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return {
    title: 'Docs · EarnKit',
    description: DOCS_DESCRIPTION,
    alternates: { canonical: 'https://earnkit.com/docs' },
  };
}

/** v3 Stage 3 (spec 5.6), v3.1 site Task 10: the one Docs page (Docs board), with the full footer. */
export default function DocsPage() {
  return (
    <>
      <DocsView />
      <Footer />
    </>
  );
}
