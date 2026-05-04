import Image from 'next/image';

export default function CarouselFeatures() {
  return (
    <section className="w-full flex flex-col items-center justify-center py-10 px-6 md:px-16">
      {/* Grid container */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-10">
        {/* Card 1: Usage-based pricing */}
        <div className="w-full flex flex-col rounded-[28px] border-[3px] bg-color5 border-transparent p-8 md:p-10 transition-all duration-300 ease-in-out">
          {/* Icon Container - Fixed height ensures titles start at the same position */}
          <div className="h-[86px] w-24 mb-10 relative">
            <Image
              src="/images/landing/pricing-glow.png"
              alt="pricing"
              fill
              className="object-contain"
              quality={100}
            />
          </div>

          <div className="flex flex-col flex-grow">
            {/* Title Container - min-h ensures title alignment even with line wraps */}
            <h3 className="text-left text-color11 font-funnel-display text-2xl font-semibold min-h-[3.5rem] flex items-center">
              Usage-based pricing
            </h3>
            {/* Subtitle Container */}
            <p className="text-color11 font-funnel-sans text-[1rem] font-normal">
              Charge per prompt, per call, per swap, per anything. Priced in ETH
              or any ERC20 on Base.
            </p>
          </div>
        </div>

        {/* Card 2: Automated buybacks */}
        <div className="w-full flex flex-col rounded-[28px] border-[3px] bg-color5 border-transparent p-8 md:p-10 transition-all duration-300 ease-in-out">
          <div className="h-24 w-24 mb-7 relative">
            <Image
              src="/images/landing/automated_buybacks-glow.png"
              alt="buybacks"
              fill
              className="object-contain"
              quality={100}
            />
          </div>

          <div className="flex flex-col flex-grow">
            <h3 className="text-left text-color11 font-funnel-display text-2xl font-semibold min-h-[3.5rem] flex items-center">
              Automated buybacks
            </h3>
            <p className="text-color11 font-funnel-sans text-[1rem] font-normal">
              Route a percentage of every payment to buy back your token,
              automatically. You set the percentage, EarnKit handles the
              routing.
            </p>
          </div>
        </div>

        {/* Card 3: Powered by Splits */}
        <div className="w-full flex flex-col rounded-[28px] border-[3px] bg-color5 border-transparent p-8 md:p-10 transition-all duration-300 ease-in-out">
          <div className="h-20 w-24 mb-11 relative">
            <Image
              src="/images/landing/flashIcon-glow.png"
              alt="splits"
              fill
              className="object-contain"
              quality={100}
            />
          </div>

          <div className="flex flex-col flex-grow">
            <div className="min-h-[3.5rem] flex items-center">
              <h3 className="text-left text-color11 font-funnel-display text-2xl font-semibold flex gap-2 items-center">
                Powered by{' '}
                <img
                  src="/images/landing/splits_wordmark_dark.svg"
                  className="h-6"
                  alt="Splits"
                />
              </h3>
            </div>
            <p className="text-color11 font-funnel-sans text-[1rem] font-normal">
              Revenue settles in an onchain escrow contract built on Splits, the
              treasury layer used across onchain teams. Every transaction is
              verifiable.
            </p>
          </div>
        </div>

        {/* PRESERVED DEAD CODE & COMMENTS */}
        {/* <div className="min-w-[350px] md:min-w-[33%] h-full min-h-[250px] md:h-auto rounded-[36px] bg-color12 flex flex-row md:flex-col items-center md:items-start justify-center md:justify-between p-8 md:p-10 gap-6 shadow-lg">
                    <div className="w-36 h-36 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                        <Image src="/images/landing/credit_based_billing.png" alt="feature icon" fill className="object-contain" quality={100} />
                    </div>
                    <p className="w-[80%] text-left text-color10 font-funnel-display text-2xl font-semibold leading-[1.4] tracking-[2%]">
                        Credit-based billing
                        <span className="block text-color11 font-funnel-sans text-[1rem] font-normal leading-[1.4] tracking-[2%] mt-1">
                            Offer free credits, then let users top up and spend them
                        </span>
                    </p>
                </div>
                ... (remaining dead code preserved in your source) 
                */}
      </div>
    </section>
  );
}
