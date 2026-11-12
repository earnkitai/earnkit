import Link from 'next/link';
import { CARD_PANEL, PAGE_COL, PILL_WHITE } from '../../components/site/ui';
import { LINK_ASK_PARTS } from '../../../lib/v5/site-copy';
import type { LinkState } from '../../../lib/v6/link-routes';

const LINE = 'text-[16px] leading-[1.6] text-s-muted';

/**
 * A /link page in the site shell (L27-4, L27-26, v6.1.16): one h1 (the state's title), its line, and for the live code
 * the confirm form (one button, a plain POST to /link/<code>/confirm, no script); every other state links home.
 * `host`: where /me is, for the unlink line.
 */
export default function LinkView({ s, code, host }: { s: LinkState; code: string; host: string }) {
  return (
    <div className={`${PAGE_COL} pb-6 pt-6 md:pt-12`}>
      <section
        aria-labelledby="link-title"
        className={`${CARD_PANEL.replace('rounded-[36px]', 'rounded-[28px] md:rounded-[36px]')} mx-auto flex max-w-[560px] flex-col gap-4 p-6 md:p-9`}
      >
        <h1 id="link-title" className="ek-serif text-[32px] leading-none [overflow-wrap:anywhere] md:text-[44px]">
          {s.agent ? (
            <>
              {/* L43-17 (v6.1.19): one question naming the agent, its own name isolated. */}
              {LINK_ASK_PARTS(s.agent)[0]}
              <bdi>{LINK_ASK_PARTS(s.agent)[1]}</bdi>
              {LINK_ASK_PARTS(s.agent)[2]}
            </>
          ) : (
            s.title
          )}
        </h1>
        {s.state === 'live' ? (
          <>
            <p className={LINE}>
              First seen {s.seen}. {s.line} You can unlink it any time at {host}/me.
            </p>
            <form method="post" action={`/link/${code}/confirm`}>
              <button type="submit" className={PILL_WHITE}>
                Continue with GitHub
              </button>
            </form>
            <p className="text-[14px] leading-[1.6] text-s-muted">
              After you sign in, you confirm the link on your record page. If you did not ask your agent for this just now, close this page.
            </p>
          </>
        ) : (
          <>
            {s.line ? <p className={LINE}>{s.line}</p> : null}
            <Link href="/" className={`${PILL_WHITE} self-start`}>
              Go home.
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
