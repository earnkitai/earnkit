import Footer from '@/app/components/common/Footer';
import { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Roadmap | EarnKit',
    description: 'Explore EarnKit\'s roadmap and upcoming milestones. Track our progress as we build the future of AI agent framework.',
};

interface RoadmapQuarter {
    id: string;
    title: string;
    date: string;
    description: string;
    items: string[];
    status: 'ACTIVE' | 'TBD';
    bgColor: string;
}

const roadmapData: RoadmapQuarter[] = [
    {
        id: 'q1',
        title: 'Q1: Pre-Launch',
        date: 'Jan - March 2025',
        description: 'Our goal for this quarter is to complete building the AI agent framework, release architecture, litepaper and our first few AI agents. Here\'s what we\'re shipping this quarter:',
        items: [
            'Open-source EarnKit\'s AI agent framework',
            'Platform architecture',
            'Litepaper',
            'AI agents on Farcaster',
            'Onboarding early access users'
        ],
        status: 'ACTIVE',
        bgColor: 'bg-[#2563E4]'
    },
    {
        id: 'q2',
        title: 'Q2: Launch',
        date: 'April - June 2025',
        description: 'Our goal for this quarter is to launch our no-code platform and reward campaigns for early users. Here\'s what we plan to build this quarter: ',
        items: [
            'EarnKit smart wallet',
            'No-code AI agent creation',
            'Access to AI agents on EarnKit\'s platform',
            'EarnKit\'s NFT sale',
        ],
        status: 'TBD',
        bgColor: 'bg-[#183E81]'
    },
    {
        id: 'q3',
        title: 'Q3: Integrations & Partnerships',
        date: 'July - September 2025',
        description: 'Our goal for this quarter is to build a strong community and distribution of users through key integrations and partnerships. This will enable you to use platforms you already love with agents unlocking a much simpler UX and efficiency. Here\'s our plan for building agents across these use- cases: ',
        items: [
            'Trade: all kinds of tokens, perps and other assets.',
            'Launch: Tokens, NFTs, Airdrops',
            'Staking and earning yield',
            'Lending & borrowing'
        ],
        status: 'TBD',
        bgColor: 'bg-[#192548]'
    },
    {
        id: 'q4',
        title: 'Q4: Growth',
        date: 'October - December 2025',
        description: 'In this quarter, we plan to extend access to EarnKit users with our mobile app on iOS, token incentives and focus more deeply on use-cases that enable better workflow automation for your day to day crypto use using AI agents.',
        items: [],
        status: 'TBD',
        bgColor: 'bg-[#151837]'
    }
];

export default function Roadmap() {
    return (
        <>
            <main
                className="min-h-screen bg-[#F8F9FB] rounded-[56px]"
                style={{
                    backgroundImage: `url('/images/roadmap/grid.png')`,
                    backgroundRepeat: 'repeat',
                    backgroundSize: '12.5rem 12.5rem', // Adjust this value based on your grid size
                }}
            >
                <div className="container mx-auto px-8 md:px-4 py-10 md:py-24 max-w-3xl">

                    {/* Header Section */}
                    <div className="bg-white rounded-[56px] p-12 md:p-[100px]">
                        <h1 className="text-4xl text-black font-funnel-display font-bold mb-[40px]">Roadmap</h1>
                        <p className="text-black/[80%] font-funnel-sans font-[1rem] leading-[1.5rem]">
                            This roadmap highlights key milestones our team aims to achieve every
                            quarter this year. One of EarnKit&apos;s core values is transparency and
                            consistently shipping updates so you&apos;re a part of this journey with us.
                        </p>
                    </div>

                    {/* Roadmap Quarters */}
                    <div className="font-funnel-sans">
                        {roadmapData.map((quarter) => (
                            <div
                                key={quarter.id}
                                className={`${quarter.bgColor} rounded-[56px] p-12 md:p-[100px] text-white flex flex-col gap-[28px]`}
                            >
                                <div className="flex flex-col md:flex-row justify-between items-start mb-8">
                                    <div>
                                        <h2 className="text-3xl font-semibold mb-[10px]">{quarter.title}</h2>
                                        <p className="text-white/[80%] italic font-funnel-sans text-[14px] leading-[1.5rem]">{quarter.date}</p>
                                    </div>
                                    {quarter.status === 'ACTIVE' ? (
                                        <span className="bg-transparent border border-[#B8CCE0] text-[#B8CCE0] px-[12px] py-[2px] mt-2 rounded-full text-[12px] leading-[1rem]">
                                            ACTIVE
                                        </span>
                                    ) : (
                                        <span className="bg-transparent border border-[#B8CCE0] text-[#B8CCE0] px-[12px] py-[2px] mt-2 rounded-full text-[12px] leading-[1rem]">
                                            TBD
                                        </span>
                                    )}
                                </div>
                                <p className="text-white/[80%] font-funnel-sans text-[1rem] leading-[1.5rem]">{quarter.description}</p>
                                {quarter.items.length > 0 && (
                                    <ul className="text-white/[80%] list-disc list-disc-white/[80%] list-inside px-[25px] space-y-[8px] font-funnel-sans font-[1rem] leading-[1.5rem]">
                                        {quarter.items.map((item, index) => (
                                            <li key={index}>{item}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

            </main>
            <Footer /></>
    );
}
