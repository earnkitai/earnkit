import Image from "next/image";
export default function CarouselFeatures() {
    return (
        <section className="w-full flex flex-col items-center justify-center py-10">
            <div className="w-full ">
                <div
                    className="w-auto h-full flex gap-10 md:gap-10 overflow-x-scroll no-scrollbar scroll-smooth px-12 md:px-20"
                    style={{ scrollSnapType: "x mandatory" }}
                >

                    <div
                        className="min-w-[350px] md:min-w-[33%] h-full min-h-[250px] md:h-auto rounded-[36px] bg-color12 flex flex-row md:flex-col items-center md:items-start justify-center md:justify-between p-8 md:p-10 gap-6 shadow-lg"
                    >
                        <div className="w-36 h-36 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                            <Image src="/images/landing/usage_based_pricing.png" alt="feature icon" fill className="object-contain" quality={100} />
                        </div>
                        <p className="w-[80%] text-left text-color10 font-funnel-display text-2xl font-semibold leading-[1.4] tracking-[2%]">
                            Usage-based pricing
                            <span className="block text-color11 font-funnel-sans text-[1rem] font-normal leading-[1.4] tracking-[2%] mt-1">
                                (per prompt or API call)
                            </span>
                        </p>

                    </div>
                    <div
                        className="min-w-[350px] md:min-w-[33%] h-full min-h-[250px] md:h-auto rounded-[36px] bg-color12 flex flex-row md:flex-col items-center md:items-start justify-center md:justify-between p-8 md:p-10 gap-6 shadow-lg"
                    >
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
                    <div
                        className="min-w-[350px] md:min-w-[33%] h-full min-h-[250px] md:h-auto rounded-[36px] bg-color12 flex flex-row md:flex-col items-center md:items-start justify-center md:justify-between p-8 md:p-10 gap-6 shadow-lg"
                    >
                        <div className="w-36 h-36 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                            <Image src="/images/landing/flashIcon.png" alt="feature icon" fill className="object-contain" quality={100} />
                        </div>
                        <p className="w-[80%] text-left text-color10 font-funnel-display text-2xl font-semibold leading-[1.4] tracking-[2%]">
                            Transaction fees
                            <span className="block text-color11 font-funnel-sans text-[1rem] font-normal leading-[1.4] tracking-[2%] mt-1">
                                From onchain actions (swap, bridge, mint)
                            </span>
                        </p>
                    </div>
                    <div
                        className="min-w-[350px] md:min-w-[33%] h-full min-h-[250px] md:h-auto rounded-[36px] bg-color12 flex flex-row md:flex-col items-center md:items-start justify-center md:justify-between p-8 md:p-10 gap-6 shadow-lg"
                    >
                        <div className="w-36 h-36 md:w-24 md:h-24 flex items-center justify-center mb-4 relative">
                            <Image src="/images/landing/subscriptions.png" alt="feature icon" fill className="object-contain" quality={100} />
                        </div>
                        <p className="w-[80%] text-left text-color10 font-funnel-display text-2xl font-semibold leading-[1.4] tracking-[2%]">
                            Subscriptions
                            <span className="block text-color11 font-funnel-sans text-[1rem] font-normal leading-[1.4] tracking-[2%] mt-1">
                                With wallet-native billing
                            </span>
                        </p>
                    </div>

                </div>
            </div>
        </section>
    );
} 