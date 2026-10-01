export const metadata = { title: 'Sponsor terms · EarnKit' };

const TERMS = [
  'Your deposit goes into its own escrow contract on Base. EarnKit cannot take it; the contract only pays it out as below.',
  'After the deadline you pick winners and amounts that add up to the whole prize (90% of the deposit). The other 10% is EarnKit’s fee, paid only at that moment.',
  'If you have not picked winners 7 days after the deadline, EarnKit may pick the top entries and pay them, with public reasons.',
  'If no entry qualifies, or EarnKit removes a campaign that breaks these terms or the law, everything is refunded to your wallet, fee included.',
  'If nothing has been paid 60 days after the deadline, you can take the deposit back yourself.',
  'Your campaign text and picks are public. Do not post anything misleading, illegal, or that you have no right to post.',
  'Smart contracts carry risk. The contracts are tested and audited, but use only funds you can afford to have at risk. Pools are capped per campaign.',
];

export default function SponsorTerms() {
  return (
    <div className="w-full pt-4">
      <section className="rounded-[40px] bg-ek-navy-deep px-6 py-12 md:rounded-[56px] md:px-16 md:py-16">
        <h1 className="font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
          Sponsor terms
        </h1>
        <ol className="mt-8 list-decimal space-y-3 pl-5 font-funnel-sans text-base font-light text-ek-blue-light">
          {TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
