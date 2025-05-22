import Image from "next/image";

const features = [
    {
        image: "/images/landing/wallet.png",
        text: "Trustless smart wallets, powered by ERC-4337",
    },
    {
        image: "/images/landing/agnostic.png",
        text: "Strategy primitives that compose across protocols",
    },
    {
        image: "/images/landing/minutes.png",
        text: "Semantic memory for evolving logic",
    },
    {
        image: "/images/landing/flashIcon.png",
        text: "Orchestration that turns intent into action",
    },
];

export default function CarouselFeatures() {
    return (
        <section className="w-full flex flex-col items-center justify-center py-10">
            <div className="w-full ">
                <div
                    className="flex gap-6 md:gap-10 overflow-x-scroll no-scrollbar scroll-smooth pl-20"
                    style={{ scrollSnapType: "x mandatory" }}
                >
                    {features.map((feature, idx) => (
                        <div
                            key={idx}
                            className="w-[80vw] sm:w-[340px] md:min-w-[35%] h-full min-h-[220px] md:h-[30%] rounded-[36px] bg-color12 flex flex-col items-start justify-center p-8 md:p-10 gap-6 shadow-lg"
                        >
                            <div className="w-20 h-20 md:w-24 md:h-24 flex items-center justify-center mb-2 relative">
                                <Image src={feature.image} alt="feature icon" fill className="object-contain" />
                            </div>
                            <p className="w-[75%] text-left text-color11 font-funnel-sans text-2xl font-normal leading-[1.4]">
                                {feature.text}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
} 