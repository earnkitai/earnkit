import Footer from '../../components/common/Footer';
import { CARD_NEUTRAL, PAGE_COL } from '../../components/site/ui';
import { WALLET_TEXT, walletXLead, type WalletPage } from '../../../lib/earnkit/wallet-proof';
import WalletSign from './WalletSign';

/** The card's title: Kaftan Serif, 44px on a phone, 56px from md. */
export const WALLET_H1 = 'ek-serif text-[44px] leading-none text-s-text md:text-[56px]';

/**
 * v3.1 wallet proof fix round: the signing page's body (the layout adds the site nav). A neutral card in the page
 * column: an expired, used or busy link is one line; else the title, what happens, the Basescan line, the X step when
 * a reward wallet exists, the exact message and the buttons (WalletSign). Then the minimal footer. Pure render.
 */
export default function WalletView({ state }: { state: WalletPage }) {
  return (
    <>
      <div className={`${PAGE_COL} pb-6 pt-2`}>
        <section data-ek-wallet="" aria-labelledby="wallet-title" className={`${CARD_NEUTRAL} mx-auto flex max-w-[680px] flex-col gap-5 px-5 py-8 md:px-10 md:py-12`}>
          {state.kind === 'gone' ? (
            <p id="wallet-title" className="ek-serif text-[32px] leading-tight text-s-text md:text-[40px]">
              {state.line}
            </p>
          ) : (
            <WalletSign
              token={state.token}
              message={state.message}
              lead={state.needX && state.current ? walletXLead(state.handle, state.current) : null}
              xHref={state.xHref}
              text={WALLET_TEXT}
              titleClass={WALLET_H1}
            />
          )}
        </section>
      </div>
      <Footer variant="minimal" />
    </>
  );
}
