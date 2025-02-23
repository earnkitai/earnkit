import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Litepaper | EarnKit',
    description: 'EarnKit\'s litepaper outlines our vision for the future of AI agents and blockchain technology.',
};

export default function Litepaper() {
    return (
        <main
            className="min-h-screen bg-[#E2E8EE] rounded-[56px] py-[60px]"
        >
            <div className="container mx-auto max-w-2xl">
                <div className='pt-20 pb-10 md:pt-0 md:py-[24px] flex flex-col items-center justify-center gap-[1.1rem]'>
                    <h1 className="text-center text-4xl w-[70%] md:w-full md:text-3xl leading-[48px] md:leading-[38px] font-bold font-funnel-display text-black">EarnKit Litepaper</h1>
                    <p className="max-w-max text-center rounded-full border border-black/[40%] px-[12px] py-[2px] font-funnel-sans font-semibold text-[12px] text-black/[40%]"> Version 1.1
                    </p>
                </div>
                {/* Abstract */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
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
                </section>


                {/* Introduction */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-[#2563E4] font-funnel-sans font-semibold text-[24px] leading-[32px]">Introduction: A New Paradigm for AI and web3</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            The future of startups is not dominated by massive corporations but by millions of hyper-specialized, AI-driven ventures—each lean, fast, and infinitely scalable. The old model of 100-person teams is disappearing, replaced by small, API-connected businesses where AI handles operations, marketing, and execution.
                        </p>
                        <p>
                            Naval Ravikant describes this shift:
                        </p>
                        <p>
                            &quot;I think we&apos;re going to see more and more billion-dollar businesses built by four or five people. The contract work trend is increasing, and the size of the average company is decreasing. Large teams are no longer necessary.&quot;
                        </p>
                        <p>
                            Yet in web3, AI remains incomplete—capable of analyzing trends but unable to execute on-chain actions autonomously. While businesses automate sales, marketing, and finance, their blockchain operations remain manual and complex.
                        </p>
                        <p>
                            EarnKit changes this. It is a low-code/no-code execution framework that allows AI agents to interact with smart contracts, manage DeFi liquidity, execute governance actions, and automate on-chain transactions.
                        </p>
                        <p>
                            As AI drives software costs toward zero, EarnKit enables founders to build scalable, profitable, AI-powered businesses—without large teams, technical bottlenecks, or operational friction. This is the next evolution of web3: autonomous, AI-driven, and execution-focused.
                        </p>
                    </div>
                </section>


                {/* The Problem: AI Without Execution is Incomplete */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-[#2563E4] font-funnel-sans font-semibold text-[24px] leading-[32px]">The Problem: AI Without Execution is Incomplete</h2>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            AI has revolutionized productivity, but in web3, it remains purely analytical—limited to data insights, market predictions, and strategy recommendations. When it comes to real execution—making transactions, managing assets, deploying contracts, or running governance actions—AI still depends on humans.
                        </p>
                    </div>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            This creates three major roadblocks:
                        </p>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>1. Complexity Barrier</p>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>Web3 tools are built for developers, requiring smart contract knowledge.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Founders and operators struggle to automate workflows without hiring blockchain engineers.
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>2. Execution Bottlenecks</p>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                AI agents lack wallets, on-chain access, and transaction-signing capabilities.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Web3 operations remain manual, preventing full automation.
                            </li>
                        </ul>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>3. Monetization Gaps</p>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                There is no scalable, sustainable model for AI-driven automation in web3.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Current AI agents cannot generate revenue through on-chain interactions.
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            Despite advances in AI and blockchain, the vision of autonomous, agentic web3 businesses remains unfulfilled.
                        </p>
                    </div>
                </section>

                {/* The EarnKit Solution: AI Agents That Execute */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-[#2563E4] font-funnel-sans font-semibold text-[24px] leading-[32px]">The EarnKit Solution: AI Agents That Execute</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            EarnKit bridges the gap between AI intelligence and on-chain execution, making web3 interactions frictionless, scalable, and automated.
                        </p>
                    </div>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            With EarnKit, founders can:
                        </p>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <ul className='m-0 p-0 px-4 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                Deploy AI agents in minutes &ndash; No coding required. Launch AI-driven on-chain automation using smart contracts or APIs.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Enable autonomous execution &ndash; AI agents execute transactions, manage assets, participate in governance, and interact with DeFi/NFT protocols.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Monetize AI capabilities &ndash; Build, deploy, and generate revenue from AI-powered web3 applications.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Seamlessly integrate across ecosystems &ndash; Support for major blockchains, DeFi protocols, and web3 social platforms like Farcaster.
                            </li>
                        </ul>
                    </div>
                </section>


                {/* How EarnKit Works */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-[#2563E4] font-funnel-sans font-semibold text-[24px] leading-[32px]">How EarnKit Works</h2>


                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>1. Autonomous AI Agents</p>
                        <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p>
                                EarnKit provides a framework where AI agents are embedded with an execution layer, giving them:
                            </p>
                        </div>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Smart Wallets &ndash; The ability to sign and execute blockchain transactions.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Intent Parsing Engine &ndash; Transforms user prompts into structured on-chain actions.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                On-Chain Access &ndash; Seamless interaction with DeFi, NFT, and governance protocols.
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>2. No-Code AI Deployment</p>
                        <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p>
                                EarnKit removes technical barriers, allowing users to:
                            </p>
                        </div>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Choose from pre-built workflows or create custom automation.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Integrate AI execution into existing dApps via API.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Deploy AI agents to social platforms like Farcaster, enabling interactive automation.
                            </li>
                        </ul>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 px-2 font-funnel-sans text-[20px] leading-[28px]'>3. Monetization & Business Model</p>
                        <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p>
                                EarnKit enables a scalable AI-agent economy through:
                            </p>
                        </div>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Transaction Fees &ndash; AI agents generate micro-fees for every on-chain action.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Premium AI Services &ndash; Access advanced automation capabilities via subscription.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                EarnKit Agent Marketplace &ndash; Users can create, license, or sell AI automation models.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Protocol Token Economy &ndash; Select AI functionalities are powered by EarnKit&apos;s native token.

                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            Despite advances in AI and blockchain, the vision of autonomous, agentic web3 businesses remains unfulfilled.
                        </p>
                    </div>
                </section>

                {/* The EarnKit Advantage: Why We Win */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-[#2563E4] font-funnel-sans font-semibold text-[24px] leading-[32px]">The EarnKit Advantage: Why We Win</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            EarnKit is built by the team behind Coinvise, which has scaled thousands of web3 projects. Our experience gives us an unmatched advantage in:
                        </p>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <ul className='m-0 p-0 px-6 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                Founder-Centric Product Design &ndash; Built for ease of use, not technical complexity.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Proven Monetization Models &ndash; Designed for sustainable AI adoption.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                Deep web3 Infrastructure Expertise &ndash; Positioned as the dominant AI-agent execution layer.
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            Unlike other AI frameworks that are developer-first, EarnKit is built for operators, founders, and business leaders—enabling rapid AI adoption across web3.
                        </p>
                    </div>
                </section>

                {/* Use Cases: Unlocking the Next Era of web3 */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-[#2563E4] font-funnel-sans font-semibold text-[24px] leading-[32px]">Use Cases: Unlocking the Next Era of web3</h2>
                    <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            EarnKit&apos;s AI-powered execution agents unlock new business models across multiple industries:
                        </p>
                    </div>

                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 font-funnel-sans text-[20px] leading-[28px]'>DeFi & Trading</p>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                AI-driven automated trading strategies with real-time execution.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Smart AI-powered portfolio rebalancing and liquidity management.
                            </li>
                        </ul>
                    </div>


                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 font-funnel-sans text-[20px] leading-[28px]'>Community & Governance</p>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                AI agents that participate in DAOs, manage governance proposals, and execute treasury actions.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Intelligent polling and sentiment analysis for on-chain decision-making.
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 font-funnel-sans text-[20px] leading-[28px]'>NFT & Creator Economy</p>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                AI-powered dynamic NFT pricing and bidding.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Automated token creation, airdrops, and gated access to digital assets.
                            </li>
                        </ul>
                    </div>
                    <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p className='font-medium p-0 m-0 font-funnel-sans text-[20px] leading-[28px]'>Enterprise & web3 SaaS</p>
                        <ul className='m-0 p-0 px-6 list-disc space-y-2 text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                AI-driven compliance monitoring for on-chain transactions.
                            </li>
                            <li className='font-normal text-[16px] leading-[22px]'>
                                Automating on-chain business operations (payroll, invoicing, rewards).
                            </li>
                        </ul>
                    </div>
                </section>

                {/* Conclusion */}
                <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                    <h2 className="text-blue-600 font-funnel-sans font-semibold text-[24px] leading-[32px]">Conclusion: The Future of web3 is Autonomous</h2>
                    <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                        <p>
                            AI has already transformed how we interact with software. EarnKit transforms how AI interacts with web3.
                        </p>
                        <p>
                            By merging AI intelligence with on-chain execution, EarnKit eliminates friction, reduces complexity, and unlocks the next phase of decentralized innovation.
                        </p>
                        <p>
                            EarnKit is not just a tool—it is the infrastructure for AI-driven web3 automation.
                        </p>

                    </div>
                </section>

                {/* Footer */}
                <div className="pb-10 md:pb-0 text-center mt-12 flex flex-col items-center justify-center gap-[20px]">
                    <p className="w-[70%] md:w-full text-[#2563E4] font-funnel-sans font-medium text-[20px] leading-[28px] p-[12px]">Join the AI-powered web3 revolution with EarnKit.</p>
                    <div>
                        <p className='font-funnel-sans font-medium text-[18px] leading-[25px] text-[#183E81] flex flex-col md:flex-row items-center gap-2 md:gap-0'>Get Started: <Link href="https://www.earnkit.com" className="text-[#183E81] underline font-normal text-[18px] leading-[25px] ml-1 underline-offset-2">www.earnkit.com</Link></p>
                    </div>
                    <div>
                        <p className='font-funnel-sans font-medium text-[18px] leading-[25px] text-[#183E81] flex flex-col md:flex-row items-center gap-2 md:gap-0'>Connect with Us:
                            <Link href="https://x.com/EarnKit_ai" className="text-[#183E81] font-normal text-[18px] leading-[25px] ml-1 flex items-center gap-2" aria-label="EarnKit_ai" target="_blank">
                                <span className='p-1 w-[24px] h-[24px] bg-[#183E81] rounded-[4px] max-w-max flex items-center justify-center '>
                                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M19.9786 2.03265H23.6996L15.5702 11.324L25.1338 23.9674H17.6456L11.7806 16.2993L5.06967 23.9674H1.34638L10.0415 14.0293L0.867188 2.03265H8.54549L13.847 9.04166L19.9786 2.03265ZM18.6726 21.7402H20.7345L7.42512 4.14289H5.21252L18.6726 21.7402Z" fill="#ffffff" />
                                    </svg>
                                </span>
                                Twitter/X
                            </Link>

                            <Link href="https://warpcast.com/earnkit" className="text-[#183E81] font-normal text-[18px] leading-[25px] ml-1 flex items-center gap-2" target="_blank" aria-label="EarnKit Warpcast">
                                <span className='p-1 w-[24px] h-[24px] bg-[#183E81] rounded-[4px] max-w-max flex items-center justify-center '>
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