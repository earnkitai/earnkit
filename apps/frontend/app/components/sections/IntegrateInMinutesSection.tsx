import { Icons } from "@/app/components/ui/Icons";
import Image from "next/image";

const features = [
    {
        icon: <Icons.imIcon1 />,
        title: "Earn SDK",
        description: "Add fees to your agent with just a few lines of code—charge for LLM calls, onchain actions, and more.",
    },
    {
        icon: <Icons.imIcon2 />,
        title: "Smart Wallet Support",
        description: "No popups. Fees are automatically charged from user wallets via Privy, Turnkey, or any EOA.",
    },
    {
        icon: <Icons.imIcon3 />,
        title: "Built-in Analytics",
        description: "See how much each agent is earning and what users are doing.",
    },
    {
        icon: <Icons.imIcon4 />,
        title: "Works With Your Stack",
        description: "Compatible with Langchain, AgentKit, ElizaOS, and more.",
    },
];

export default function IntegrateInMinutesSection() {
    return (
        <section
            className="relative w-full min-h-[800px] md:min-h-[950px] flex flex-col items-center justify-center py-24 md:py-32 px-14 md:px-0 overflow-hidden bg-color5 rounded-[56px] mt-10"
        >
            <div className="absolute bottom-0 right-[50%] left-[50%] transform -translate-x-1/2 w-[80%] md:w-[40%] h-[80%] md:h-[70%] z-10 pointer-events-none select-none">
                <Image
                    src="/images/landing/sectionbg.png"
                    alt="section background"
                    fill
                    style={{ objectFit: 'contain', objectPosition: 'bottom right' }}
                    priority
                />
            </div>
            {/* Grid background overlay */}
            <div className="absolute inset-0 w-full h-full z-0 bg-[url('/images/landing/grid.png')] bg-repeat opacity-20 pointer-events-none" style={{ backgroundSize: '50px 50px' }} />
            {/* Decorative bottom right image */}

            <h2 className="w-[90%] md:w-full text-4xl md:text-5xl font-funnel-display font-semibold md:text-center mb-20 z-10 text-color8 tracking-tight">
                Integrate in Minutes
            </h2>
            <div className="flex flex-1 w-full items-center justify-center z-100 mb-20 md:mb-32">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-16 md:gap-x-32 md:gap-y-32 w-full max-w-5xl">
                    {features.map((feature, idx) => (
                        <div key={idx} className="flex flex-col md:flex-row items-start md:items-center gap-8 md:bg-transparent rounded-[28px] p-8 md:p-8 border border-[3px] border-color6 md:border-none">
                            <div className="flex items-center justify-center mt-1 w-[60px] md:w-[80px] min-w-[60px] md:min-w-[80px] h-[60px] md:h-[80px] min-h-[60px] md:min-h-[80px]">
                                {feature.icon}
                            </div>
                            <div>
                                <h3 className="text-2xl md:text-2xl font-bold mb-3 text-color8 font-funnel-display">
                                    {feature.title}
                                </h3>
                                <p className="text-lg md:text-xl text-color7 font-funnel-sans leading-[1.6]">
                                    {feature.description}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
} 