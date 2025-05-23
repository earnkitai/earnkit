import Image from "next/image";
export default function CarouselFeatures() {
    return (
        <section className="w-full flex flex-col items-center justify-center py-10">
            <div className="w-full ">
                <div
                    className="w-auto flex gap-6 md:gap-10 overflow-x-scroll no-scrollbar scroll-smooth px-20"
                    style={{ scrollSnapType: "x mandatory" }}
                >

                    <div
                        className="w-[80vw] sm:w-[340px] md:min-w-[33%] h-full min-h-[220px] md:h-[30%] rounded-[36px] bg-color12 flex flex-col items-start justify-center p-8 md:p-10 gap-6 shadow-lg"
                    >
                        <div className="w-20 h-20 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                            <Image src="/images/landing/WALLET.png" alt="feature icon" fill className="object-contain" quality={100} />
                        </div>
                        <p className="w-[80%] text-left text-color11 font-funnel-sans text-2xl font-normal leading-[1.4]">
                            Trustless smart wallets, powered by ERC-4337
                        </p>
                    </div>
                    <div
                        className="w-[80vw] sm:w-[340px] md:min-w-[33%] h-full min-h-[220px] md:h-[30%] rounded-[36px] bg-color12 flex flex-col items-start justify-center p-8 md:p-10 gap-6 shadow-lg"
                    >
                        <div className="w-20 h-20 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                            <Image src="/images/landing/AGNOSTIC.png" alt="feature icon" fill className="object-contain" quality={100} />
                        </div>
                        <p className="w-[80%] text-left text-color11 font-funnel-sans text-2xl font-normal leading-[1.4]">
                            Strategy primitives that compose across protocols
                        </p>
                    </div>
                    <div
                        className="w-[80vw] sm:w-[340px] md:min-w-[33%] h-full min-h-[220px] md:h-[30%] rounded-[36px] bg-color12 flex flex-col items-start justify-center p-8 md:p-10 gap-6 shadow-lg"
                    >
                        <div className="w-20 h-20 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                            <Image src="/images/landing/MINUTES.png" alt="feature icon" fill className="object-contain" quality={100} />
                        </div>
                        <p className="w-[80%] text-left text-color11 font-funnel-sans text-2xl font-normal leading-[1.4]">
                            Semantic memory for evolving logic
                        </p>
                    </div>
                    <div
                        className="w-[80vw] sm:w-[340px] md:min-w-[33%] h-full min-h-[220px] md:h-[30%] rounded-[36px] bg-color12 flex flex-col items-start justify-center p-8 md:p-10 gap-6 shadow-lg"
                    >
                        <div className="w-20 h-20 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                            <Image src="/images/landing/flashIcon.png" alt="feature icon" fill className="object-contain" quality={100} />
                        </div>
                        <p className="w-[80%] text-left text-color11 font-funnel-sans text-2xl font-normal leading-[1.4]">
                            Orchestration that turns intent into action
                        </p>
                    </div>

                </div>
            </div>
        </section>
    );
} 