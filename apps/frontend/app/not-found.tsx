import Link from 'next/link';
import Footer from './components/common/Footer';
import { CARD_RUST, PAGE_COL, PILL_WHITE } from './components/site/ui';
import { NOT_FOUND_BIG, NOT_FOUND_HOME, NOT_FOUND_METADATA, NOT_FOUND_TEXT } from '../lib/v5/site-copy';

export const metadata = NOT_FOUND_METADATA;

/**
 * Launch ready L10: every unknown page and handle gets the site's own 404 (never Next's white default).
 * v3.1 site Task 10 (NotFound board): the rust card, "404" big in the rust accent, one line, "Go home." (L21-21, v6.1.16); the full footer.
 * QA item 13: its own title, once. The metadata export titles the unmatched-path 404. A route that calls notFound() keeps
 * its own metadata in the browser (the layout's title), so each such route's generateMetadata returns NOT_FOUND_METADATA
 * when its entity is missing; the component renders no `<title>`, which would be a second one in <head>.
 */
export default function NotFound() {
  return (
    <>
      <div className={`${PAGE_COL} pb-6 pt-2`}>
        <section
          aria-labelledby="not-found-title"
          className={`${CARD_RUST.replace('rounded-[36px]', 'rounded-[32px] md:rounded-[40px]')} flex flex-col items-center gap-[18px] px-6 py-14 text-center md:px-10 md:py-20`}
        >
          <p className="ek-serif text-[96px] leading-[0.9] text-s-rust-on md:text-[140px]">{NOT_FOUND_BIG}</p>
          <h1 id="not-found-title" className="ek-serif text-[32px] leading-none md:text-[44px]">
            {NOT_FOUND_TEXT}
          </h1>
          <Link href="/" className={`${PILL_WHITE} mt-2`}>
            {NOT_FOUND_HOME}
          </Link>
        </section>
      </div>
      <Footer />
    </>
  );
}
