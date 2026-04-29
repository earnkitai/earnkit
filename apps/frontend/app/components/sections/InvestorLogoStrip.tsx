import Image from "next/image";
import Link from "next/link";

export default function InvestorLogoStrip() {
    const investorLogos = [
        { src: "/images/investors/THE_LAO.png", alt: "The LAO" },
        { src: "/images/investors/VOLT_CAPITAL.png", alt: "Volt Capital" },
        { src: "/images/investors/GALAXY_DIGITAL.png", alt: "Galaxy Digital" },
        { src: "/images/investors/IDEO.png", alt: "IDEO" },
        { src: "/images/investors/ACAPITAL.png", alt: "A Capital" },
        { src: "/images/investors/SCALAR.png", alt: "Scalar" },
        { src: "/images/investors/gcr-logo-black.png", alt: "GCR" },
        { src: "/images/investors/DEFI_ALLIANCE.png", alt: "Alliance" },
        { src: "/images/investors/BLOCK0.png", alt: "Block0" },
        { src: "/images/investors/COOPER_TURLEY.png", alt: "Cooper Turley" },
    ];

    return (
        <section className="w-full min-h-[40vh] bg-color5 rounded-[56px] mt-10 flex flex-col items-center justify-center px-6 py-20 text-center">
            
            {/* Final CTA Content */}
            <div className="max-w-3xl mb-16">
                <h2 className="text-color11 font-funnel-display text-4xl md:text-5xl font-bold tracking-tight">
                    Start charging for your agent.
                </h2>
                <p className="text-color11/80 font-funnel-sans text-lg md:text-xl mt-4">
                    EarnKit is live on Base. Drop it into your stack and ship in minutes.
                </p>
                
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
                    <Link href="https://app.earnkit.com" className="inline-flex text-nowrap items-center w-full justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 bg-color6 outline-color6 border border-color6 rounded-full text-color3 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:bg-color7 hover:border-color7 hover:outline-color7 hover:text-color3" target="_blank">
                        Get Started
                    </Link>
                    <Link href="https://docs.earnkit.com" className="inline-flex text-nowrap items-center w-full justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8" target="_blank">
                        Read the Docs
                    </Link>
                </div>
            </div>

            {/* Quiet Logo Strip */}
            <div className="w-full flex flex-col items-center gap-10 mt-8">
                <p className="text-color11/40 font-funnel-sans text-xs uppercase tracking-[0.3em] font-medium">
                    Backed by
                </p>
                
                {/* Using a single row with flex-nowrap on desktop to match the reference.
                    Grayscale and low opacity for the 'quiet' look.
                */}
                <div className="w-full max-w-5xl flex flex-wrap items-center justify-center gap-x-10 gap-y-8 md:gap-x-14">
                    {investorLogos.map((logo, index) => (
                        <div key={index} className="relative h-5 md:h-7 w-24 md:w-32 flex-shrink-0 transition-all duration-300 opacity-40 grayscale contrast-125 hover:opacity-100 hover:grayscale-0">
                            <Image 
                                src={logo.src} 
                                alt={logo.alt} 
                                fill 
                                className="object-contain"
                                sizes="(max-width: 768px) 100px, 150px"
                            />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}