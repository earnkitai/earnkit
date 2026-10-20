import Footer from '../components/common/Footer';
import DocsView from './DocsView';
import { DOCS_DESCRIPTION } from '../../lib/earnkit/docs-copy';

export function generateMetadata() {
  return {
    title: 'Docs · EarnKit',
    description: DOCS_DESCRIPTION,
    alternates: { canonical: 'https://earnkit.com/docs' },
  };
}

/** v3 Stage 3 (spec 5.6): the one Docs page, in the site's own system. */
export default function DocsPage() {
  return (
    <>
      <DocsView />
      <Footer />
    </>
  );
}
