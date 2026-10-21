import { Panel } from '../../components/common/Panel';

const TERMS = [
  'Your deposit goes into its own escrow contract on Base. EarnKit cannot take it; the contract only pays it out as below.',
  'After the deadline you pick winners and amounts that add up to the whole prize (90% of the deposit). The other 10% is EarnKit’s fee, paid only at that moment.',
  'If you have not picked winners 7 days after the deadline, EarnKit may propose the top entries, with public reasons; they can be paid 3 days later unless you award first.',
  'If no entry qualifies, or EarnKit removes a campaign that breaks these terms or the law, everything is refunded to your wallet, fee included.',
  'If nothing has been paid 60 days after the deadline, you can take the deposit back yourself.',
  'Your campaign text and picks are public. Do not post anything misleading, illegal, or that you have no right to post.',
  'Smart contracts carry risk. The contracts are tested and audited, but use only funds you can afford to have at risk. Pools are capped per campaign.',
];

/** The terms a sponsor agrees to on the fund page (/terms#sponsor-terms since v2.9 F22). */
export default function SponsorTermsSection() {
  return (
    <Panel className="py-12 md:py-16" label="Sponsor terms">
      <h2 id="sponsor-terms" className="scroll-mt-32 ek-serif text-[32px] leading-none text-ek-text md:text-[44px]">
        Sponsor terms
      </h2>
      <ol className="mt-8 max-w-2xl list-decimal space-y-3 pl-5 font-funnel-sans text-base font-light text-ek-body md:text-lg">
        {TERMS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
    </Panel>
  );
}
