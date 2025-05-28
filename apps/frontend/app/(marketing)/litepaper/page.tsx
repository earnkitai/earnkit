import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Litepaper | EarnKit',
    description: 'EarnKit\'s litepaper outlines our vision for the future of AI agents and blockchain technology.',
};

export default function Litepaper() {
    return (
        <main
            className="min-h-screen bg-litepaperBg rounded-[56px] py-[160px]"
        >
            <div className="container mx-auto max-w-2xl">
                <div className='pt-20 pb-10 md:pt-0 md:py-[24px] flex flex-col items-center justify-center gap-[1.1rem]'>
                    <h1 className="text-center text-4xl w-[70%] md:w-full md:text-3xl leading-[48px] md:leading-[38px] font-bold font-funnel-display text-black">EarnKit Litepaper</h1>
                    <p className="max-w-max text-center rounded-full border border-black/[40%] px-[12px] py-[2px] font-funnel-sans font-semibold text-[12px] text-black/[40%]"> Version 1.1
                    </p>
                </div>

                {/* Introduction: The End of Human UX in Crypto */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Introduction: The End of Human UX in Crypto</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            For years, crypto has promised to eliminate intermediaries and automate finance. Instead, we&apos;ve built a system that depends on human approvals, pop-up wallets, and manual interventions at every step.
                        </p>
                        <p>
                            Web3 isn&apos;t automated. It&apos;s manual.
                        </p>
                        <p>
                            And while users have tolerated these inefficiencies for years, they&apos;ve also limited crypto&apos;s adoption, reach, and potential.
                        </p>

                    </div>
                    <h2 className="text-black font-funnel-sans font-semibold text-[20px] leading-[32px]">User experience isn&apos;t the problem. Humans are.</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            Now, a shift is happening. AI agents are moving from passive analysts to autonomous actors. They are no longer waiting for humans to click &quot;confirm.&quot; They are ready to act. What they&apos;ve lacked is a body—the ability to execute autonomously.
                        </p>
                        <p>
                            That&apos;s where EarnKit comes in.
                        </p>

                    </div>
                </section>


                {/* The Problem */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">The Problem: Crypto UX Has Failed</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            Web3 is built for human-to-protocol interaction:
                        </p>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <ul className='m-0 p-0 px-6 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                Wallet pop-ups
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Transaction approvals
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Multi-step workflows
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Cross-chain complexity
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            Every interaction requires human intervention. This bottleneck has slowed innovation, stifled adoption, and made scaling impossible.
                        </p>
                        <p>
                            Even as AI agents emerge, they face the same problem: they can analyze, but they cannot act.
                        </p>
                        <p>
                            They are brains without bodies.
                        </p>
                        <p>
                            Crypto doesn&apos;t need better UX.
                        </p>
                        <p>
                            It needs <span className='font-bold'>no UX</span> at all.
                        </p>
                    </div>
                </section>



                {/* Abstract */}
                {/* <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-[#2563E4] font-funnel-sans font-semibold text-[24px] leading-[32px]">Abstract</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            The future of business is small, fast, and AI-powered. Traditional companies relied on large teams to scale, but automation is eliminating the need for size. In the coming years, billion-dollar businesses will be built by lean teams of 5-10 people, where AI agents handle operations, execution, and decision-making.
                        </p>
                        <p>
                            Yet in web3, AI remains passive—capable of generating insights but unable to take real action. Governance, token operations, and liquidity management still require human intervention.
                        </p>
                        <p>
                            EarnKit is the missing execution layer for AI in web3. It is a low-code/no-code framework that allows AI agents to autonomously execute transactions, manage DeFi operations, participate in governance, and integrate with NFT protocols—without smart contract expertise.
                        </p>
                        <p>
                            By embedding AI agents with wallet access, intent parsing, and on-chain execution, EarnKit removes friction and unlocks new monetization models. Unlike developer-first solutions, it is designed for founders and operators, enabling seamless AI-driven automation across web3.
                        </p>
                        <p>
                            EarnKit is not just a tool; it is the infrastructure for autonomous web3 companies, redefining how AI powers decentralized innovation.
                        </p>
                    </div>
                </section> */}


                {/* Introduction: A New Era of Autonomous Execution */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Introduction: A New Era of Autonomous Execution</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            For more than a decade, crypto has promised to remove intermediaries, streamline transactions, and unlock new forms of digital ownership. But the reality has been different.
                        </p>
                        <p>
                            Web3 is still <strong>too hard to use</strong>.
                        </p>
                        <p>
                            Wallet pop-ups, complex transactions, endless approvals, and fragmented chains—<strong>crypto UX has failed</strong> to deliver on its promise of simplicity and automation.
                        </p>
                        <p>
                            This isn&apos;t just a design problem. It&apos;s a structural one.
                        </p>
                        <p>
                            The crypto stack was built for humans to click, confirm, and sign. And as a result, <strong>human intervention</strong> has been the primary bottleneck holding Web3 back.
                        </p>
                        <p>
                            Now, that&apos;s about to change.
                        </p>
                        <p>
                            This document outlines EarnKit&apos;s mission, technology, and strategy as the execution layer for AI agents in Web3. It describes the current limitations in AI agent execution, EarnKit&apos;s solution, and its roadmap for delivering autonomous, agent-native infrastructure to the crypto ecosystem.
                        </p>
                    </div>
                </section>


                {/* What is Earnkit */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">What is Earnkit</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            EarnKit is the <strong>execution layer</strong> for AI agents in Web3.
                        </p>
                        <p>
                            We give AI agents the ability to:
                        </p>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <ul className='m-0 p-0 px-6 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                Hold assets
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Sign transactions
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Execute strategies
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Operate across chains
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Govern treasuries
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                And collaborate with other agents
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            All without human intervention.
                        </p>
                        <p>
                            We are removing humans from the loop—by design.
                        </p>
                    </div>
                </section>


                {/* How EarnKit Works */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">How EarnKit Works (At a High Level)</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            EarnKit provides three core capabilities:
                        </p>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>1. Smart Wallet</p>
                        <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p>
                                Account abstraction wallet that hold assets and execute without approvals.
                            </p>
                        </div>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>2. Intent Parsing Engine</p>
                        <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p>
                                AI-native engine that translates strategies into executable actions.
                            </p>
                        </div>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>3. Cross-Chain Execution</p>
                        <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p>
                                Agents operate seamlessly across Base, Ethereum, Arbitrum, and Monad.
                            </p>
                        </div>
                    </div>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            Agents use EarnKit to <strong>sign</strong>, <strong>execute</strong>, and <strong>act</strong>.
                        </p>
                        <p>
                            No pop-ups. No friction. No delays.
                        </p>
                    </div>
                </section>


                {/* What this unlocks */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">What This Unlocks</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            With EarnKit, AI agents can:
                        </p>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <ul className='m-0 p-0 px-6 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                Trade and manage liquidity across chains
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Govern DAOs autonomously
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Manage treasuries without human oversight
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Execute complex DeFi strategies in real time
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Collaborate as multi-agent systems to scale execution and capital management
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            For the first time, crypto moves at <strong>machine speed</strong>.
                        </p>


                    </div>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            Markets can react in milliseconds.
                        </p>
                    </div>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            Agents become <strong>autonomous capital allocators</strong>, not passive tools.
                        </p>
                    </div>
                </section>


                {/* Who Is EarnKit For? */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Who Is EarnKit For?</h2>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            We&apos;re building for the first adopters of agent-native execution:
                        </p>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 font-funnel-sans text-[20px] leading-[28px]'>DeFi Traders</p>
                        <p>
                            who need speed, efficiency, and automation
                        </p>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 font-funnel-sans text-[20px] leading-[28px]'>DAOs</p>
                        <p>
                            that require autonomous treasury management
                        </p>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 font-funnel-sans text-[20px] leading-[28px]'>AI-Native Funds</p>
                        <p>
                            focused on fully automated portfolio execution and governance participation
                        </p>
                    </div>

                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            These are the users who need <strong>execution today</strong>, and they are already building on EarnKit.
                        </p>
                    </div>
                </section>




                {/* The World We Are Building */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">The World We Are Building</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            A world where capital moves without human intervention.
                        </p>
                        <p>
                            A world where agents trade, govern, and collaborate at scale.
                        </p>
                        <p>
                            A world where crypto finally fulfills its promise of <strong>automation and autonomy</strong>.
                        </p>
                        <p>
                            EarnKit is delivering the <strong>execution layer</strong> that makes this world possible.
                        </p>
                        <p>
                            We are enabling a <strong>machine-to-machine economy</strong>, where agents act, capital flows, and opportunity scales—without human friction.
                        </p>
                        <p>
                            This isn&apos;t the future of crypto UX.
                        </p>
                        <p>
                            It&apos;s the <strong>end of crypto UX altogether</strong>.
                        </p>
                    </div>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                        <p>
                            For partnership and inquiries: <a href="mailto:j@earnkit.com" className="text-black/80 underline font-normal leading-[25px] ml-1 underline-offset-2">j@earnkit.com</a>
                        </p>
                    </div>

                </section>

                {/* Footer */}
                <div className="pb-10 md:pb-0 text-center mt-12 flex flex-col items-center justify-center gap-[20px]">
                    <p className="w-[70%] md:w-full text-color2 font-funnel-sans font-medium text-[20px] leading-[28px] p-[12px]">Join the AI-powered web3 revolution with EarnKit.</p>
                    <div>
                        <p className='font-funnel-sans font-medium text-[18px] leading-[25px] text-color3 flex flex-col md:flex-row items-center gap-2 md:gap-0'>Get Started: <Link href="https://www.earnkit.com" className="text-color3 underline font-normal text-[18px] leading-[25px] ml-2 underline-offset-2">www.earnkit.com</Link></p>
                    </div>
                    <div>
                        <p className='font-funnel-sans font-medium text-[18px] leading-[25px] text-color3 flex flex-col md:flex-row items-center gap-2'>Connect with Us:
                            <Link href="https://x.com/EarnKit_ai" className="text-color3 font-normal text-[18px] leading-[25px] ml-1 flex items-center gap-2" aria-label="EarnKit_ai" target="_blank">
                                <span className='p-1 w-[24px] h-[24px] bg-color3 rounded-[4px] max-w-max flex items-center justify-center '>
                                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M19.9786 2.03265H23.6996L15.5702 11.324L25.1338 23.9674H17.6456L11.7806 16.2993L5.06967 23.9674H1.34638L10.0415 14.0293L0.867188 2.03265H8.54549L13.847 9.04166L19.9786 2.03265ZM18.6726 21.7402H20.7345L7.42512 4.14289H5.21252L18.6726 21.7402Z" fill="#ffffff" />
                                    </svg>
                                </span>
                                Twitter/X
                            </Link>

                            <Link href="https://warpcast.com/earnkit" className="text-color3 font-normal text-[18px] leading-[25px] ml-1 flex items-center gap-2" target="_blank" aria-label="EarnKit Warpcast">
                                <span className='p-1 w-[24px] h-[24px] bg-color3 rounded-[4px] max-w-max flex items-center justify-center '>
                                    <svg width="26" height="24" viewBox="0 0 26 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path fillRule="evenodd" clipRule="evenodd" d="M8.85231 23.6425H0.606267V22.7412C0.606267 22.3263 0.942589 21.99 1.35743 21.99H1.50764V21.0887C1.50764 20.6738 1.84393 20.3375 2.25877 20.3375V6.96724H1.43254L0.456055 3.66222H4.81266V0.357239H21.1874V3.66222H25.5441L24.5676 6.96724H23.7413V20.3375C24.1562 20.3375 24.4925 20.6738 24.4925 21.0887V21.99H24.6427C25.0575 21.99 25.3938 22.3263 25.3938 22.7412V23.6425H17.1571V22.7412C17.1571 22.3263 17.4934 21.99 17.9082 21.99H18.0584V21.0887C18.0584 20.6824 18.3809 20.3515 18.7838 20.338V12.9764C18.5181 10.0285 16.0171 7.71837 13.0001 7.71837C9.98303 7.71837 7.48197 10.0285 7.2163 12.9764V20.3377C7.6235 20.3465 7.95093 20.6793 7.95093 21.0887V21.5393V21.99H8.10114C8.51599 21.99 8.85231 22.3263 8.85231 22.7412V23.6425Z" fill="#ffffff" />
                                    </svg>
                                </span>
                                Warpcast
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </main >
    );
}