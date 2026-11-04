import Footer from '../components/common/Footer';
import DocsView from './DocsView';
import { DOCS_DESCRIPTION } from '../../lib/v5/site-copy';

export function generateMetadata() {
  return {
    title: 'Docs · EarnKit',
    description: DOCS_DESCRIPTION,
    alternates: { canonical: 'https://earnkit.com/docs' },
  };
}

/** The one Docs page, with the full footer. It reads nothing, so it is static. */
export default function DocsPage() {
  return (
    <>
      <DocsView />
      <Footer />
    </>
  );
}
