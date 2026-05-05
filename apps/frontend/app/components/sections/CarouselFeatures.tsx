'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function CarouselFeatures() {
  return (
    <section className="w-full flex flex-col items-center justify-center py-10 px-6 md:px-16">
      {/* Grid container */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8 md:gap-10">
        {/* Card 1: Connect any treasury */}
        <div className="w-full flex flex-col rounded-[28px] border-[3px] bg-color5 border-transparent p-8 md:p-10 transition-all duration-300 ease-in-out">
          <div className="h-24 w-24 mb-8 relative flex items-center justify-start">
            <div className="relative h-[86px] w-full">
              <Image
                src="/images/landing/pricing-glow.png"
                alt="pricing"
                fill
                className="object-contain"
                quality={100}
              />
            </div>
          </div>

          <div className="flex flex-col flex-grow">
            <h3 className="text-left text-color11 font-funnel-display text-2xl font-semibold min-h-[4rem] flex items-center">
              Connect any treasury
            </h3>
            <p className="text-color11 font-funnel-sans text-[1rem] font-normal leading-relaxed">
              Plug into{' '}
              <Link
                href={'https://splits.org/'}
                target="_blank"
                className="inline-block align-middle mx-1"
              >
                <img
                  src={'/images/landing/splits_wordmark_dark.svg'}
                  className="h-4"
                  alt="SPLITS"
                />
              </Link>{' '}
              or
              <Link
                href={'https://safe.global/'}
                target="_blank"
                className="inline-block align-middle mx-1"
              >
                <img
                  src={'/images/landing/safe-logo-wallet.svg'}
                  className="h-4 invert brightness-0"
                  alt="SAFE"
                />
              </Link>{' '}
              multisig. Your revenue flows in, buybacks flow out. No migration
              needed.
            </p>
          </div>
        </div>

        {/* Card 2: Works with any token */}
        <div className="w-full flex flex-col rounded-[28px] border-[3px] bg-color5 border-transparent p-8 md:p-10 transition-all duration-300 ease-in-out">
          <div className="h-24 w-24 mb-8 relative flex items-center justify-start">
            <Image
              src="/images/landing/automated_buybacks-glow.png"
              alt="buybacks"
              fill
              className="object-contain"
              quality={100}
            />
          </div>

          <div className="flex flex-col flex-grow">
            <h3 className="text-left text-color11 font-funnel-display text-2xl font-semibold min-h-[4rem] flex items-center">
              Works with any token
            </h3>
            {/* 
                FIX: Removed flex-wrap from the paragraph to let the browser handle 
                natural text wrapping, and changed Links to inline-block.
            */}
            <p className="text-color11 font-funnel-sans text-[1rem] font-normal leading-[1.8]">
              Launched on{' '}
              <Link
                href={'https://tokens.fun/'}
                target="_blank"
                className="inline-block align-middle translate-y-[-1px]"
              >
                <img
                  src={'/images/landing/TOKENS_LOGO_WHITE.png'}
                  className="h-3 mx-1"
                  alt="TOKENS"
                />
              </Link>
              ,{' '}
              <Link
                href={'https://clanker.world/'}
                target="_blank"
                className="inline-block align-middle translate-y-[-1px]"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 98 16"
                  className="h-3 mx-1"
                >
                  <path
                    fill="currentColor"
                    d="M7.321 12.368V10.38h2.052v2.422a2.37 2.37 0 0 1-2.376 2.378H2.354C1.037 15.18 0 14.12 0 12.801V3.158C0 1.838 1.037.779 2.354.779h4.643a2.37 2.37 0 0 1 2.376 2.379V5.47H7.321v-1.88c0-.52-.41-.909-.928-.909H2.98c-.518 0-.928.39-.928.908v8.778c0 .52.41.909.928.909h3.413c.518 0 .928-.39.928-.909ZM11.79 15.18V.78h2.052v12.497h6.35v1.902H11.79ZM28.266.78l4.903 14.4h-2.073l-1.167-3.417h-5.291l-1.123 3.416H21.42L26.322.78h1.944Zm-.972 2.745-2.03 6.379h4.06l-2.03-6.379ZM44.776.78v14.4H42.79L36.7 4.52v10.66h-1.987V.78h1.987l6.09 10.702V.779h1.987ZM47.512 15.18V.78h2.052v6.788L54.553.78h2.462L51.68 7.893l5.594 7.286h-2.505L49.564 8.26v6.92h-2.052ZM58.604 15.18V.78h8.466v1.902h-6.415v4.195h5.832v1.902h-5.832v4.498h6.436v1.902h-8.487ZM77.585 15.18l-2.829-5.817h-3.304v5.816H69.4V.78h7.106c1.339 0 2.375 1.06 2.375 2.379v3.827c0 1.167-.712 2.054-1.9 2.335l2.85 5.86h-2.246Zm-.755-8.606V3.59c0-.519-.39-.908-.93-.908h-4.448v4.8H75.9c.54 0 .929-.39.929-.908Z"
                  ></path>
                  <path
                    fill="#8A63D2"
                    d="M97.839.78h-2.413v14.442h2.413V.779ZM92.812 6.246h-2.414v8.977h2.414V6.246ZM87.803 11.71H85.39v3.512h2.413V11.71Z"
                  ></path>
                </svg>
              </Link>
              ,
              <Link
                href={'https://www.doppler.lol/'}
                target="_blank"
                className="inline-block align-middle translate-y-[-1px]"
              >
                <img
                  src={'/images/landing/doppler.svg'}
                  className="h-3 mx-1"
                  alt="DOPPLER"
                />
              </Link>
              , or deployed your own contract.{' '}
              <Link
                href={'https://www.earnkit.com/'}
                target="_blank"
                className="inline-block align-middle translate-y-[-2px]"
              >
                <svg
                  viewBox="0 0 124 23"
                  fill="none"
                  className="h-3 mx-1"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M5.37168 11.7803C5.37168 8.82407 7.76817 6.42758 10.7244 6.42758C13.6806 6.42758 16.0771 8.82407 16.0771 11.7803H21.4095C21.4095 5.87909 16.6256 1.09521 10.7244 1.09521C4.82319 1.09521 0.039314 5.87909 0.039314 11.7803H5.37168ZM0 17.1676C2.97529 17.1676 5.38723 14.7557 5.38723 11.7804H10.7196C10.7196 17.7007 5.92027 22.5 0 22.5V17.1676ZM16.0613 11.7803C16.0613 14.7304 18.4529 17.122 21.403 17.122V22.4543C15.5079 22.4543 10.729 17.6754 10.729 11.7803H16.0613ZM111.439 5.60699C112.656 5.60699 113.642 4.62083 113.642 3.40434C113.642 2.18785 112.656 1.2017 111.439 1.2017C110.223 1.2017 109.237 2.18785 109.237 3.40434C109.237 4.62083 110.223 5.60699 111.439 5.60699ZM119.721 11.6079V14.5958C119.731 16.5085 121.209 17.9798 123.763 17.9884L123.748 22.3936C119.42 22.3791 115.337 19.5449 115.316 14.6099L115.316 14.6008L115.316 3.1863H119.721V7.20256H123.755V11.6079H119.721ZM109.237 22.2053V6.90054H113.642V22.2053H109.237ZM60.9593 21.4843V22.2053H65.3646V6.9005H60.9593V7.70528C59.9918 7.25771 58.914 7.00798 57.7778 7.00798C53.5877 7.00798 50.191 10.4047 50.191 14.5948C50.191 18.7849 53.5877 22.1816 57.7778 22.1816C58.914 22.1816 59.9918 21.9319 60.9593 21.4843ZM54.5963 14.5948C54.5963 12.8377 56.0207 11.4133 57.7778 11.4133C59.5349 11.4133 60.9593 12.8377 60.9593 14.5948C60.9593 16.3519 59.5349 17.7763 57.7778 17.7763C56.0207 17.7763 54.5963 16.3519 54.5963 14.5948ZM83.6103 11.4133C81.8532 11.4133 80.4288 12.8377 80.4288 14.5948V22.1744H76.0235V14.5948C76.0235 10.4047 79.4202 7.00801 83.6103 7.00801C87.8004 7.00801 91.1971 10.4047 91.1971 14.5948V22.1744H86.7918V14.5948C86.7918 12.8377 85.3674 11.4133 83.6103 11.4133ZM75.2094 11.4131L75.1573 7.00816L74.2627 7.01873C70.0962 7.02631 66.6683 10.3923 66.6683 14.5948V22.1698H71.0736V14.5948C71.0736 12.8549 72.5024 11.424 74.2768 11.424H74.2898L75.2094 11.4131ZM44.8872 1.6867L44.8457 1.68679L44.7502 1.68679V1.6876C39.1316 1.76092 34.5994 6.33843 34.5994 11.9745C34.5994 17.6105 39.1316 22.188 44.7502 22.2614V22.2623L49.172 22.2622L49.172 17.857L44.8787 17.857C42.4124 17.8534 40.3019 16.3322 39.431 14.1772L47.0371 14.1772V9.77191L39.431 9.7719C40.2991 7.62347 42.3993 6.10492 44.8558 6.09208L49.172 6.09208L49.172 1.68678L44.8872 1.6867ZM92.5515 22.1214V2.87718H96.9568V22.1214H92.5515ZM102.798 2.9487C102.778 5.79026 101.503 9.17073 98.6714 11.2355L97.0126 12.4452L103.112 22.1774H108.311L102.844 13.4538C105.88 10.4527 107.18 6.39581 107.203 2.97904L102.798 2.9487Z"
                    fill="currentColor"
                  ></path>
                </svg>
              </Link>{' '}
              works with any ERC-20 on Base.
            </p>
          </div>
        </div>

        {/* Card 3: Set your strategy */}
        <div className="w-full flex flex-col rounded-[28px] border-[3px] bg-color5 border-transparent p-8 md:p-10 transition-all duration-300 ease-in-out">
          <div className="h-24 w-24 mb-8 relative flex items-center justify-start">
            <div className="relative h-[80px] w-full">
              <Image
                src="/images/landing/flashIcon-glow.png"
                alt="splits"
                fill
                className="object-contain"
                quality={100}
              />
            </div>
          </div>

          <div className="flex flex-col flex-grow">
            <h3 className="text-left text-color11 font-funnel-display text-2xl font-semibold min-h-[4rem] flex items-center">
              Set your strategy
            </h3>
            <p className="text-color11 font-funnel-sans text-[1rem] font-normal leading-relaxed">
              Choose your buyback percentage, frequency, and burn or hold.
              Adjust anytime. Executes automatically.
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
