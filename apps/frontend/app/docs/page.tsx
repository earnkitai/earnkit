import Footer from '../components/common/Footer';
import DocsView from './DocsView';
import { DOCS_DESCRIPTION, DOCS_INSTALL_TITLE } from '../../lib/v5/site-copy';
import { pageMeta } from '../lib/meta';

export function generateMetadata() {
  return pageMeta({ path: '/docs', title: `${DOCS_INSTALL_TITLE} · EarnKit`, description: DOCS_DESCRIPTION });
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
