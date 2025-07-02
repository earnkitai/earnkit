import Footer from '@/app/components/common/Footer';
import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Litepaper | EarnKit',
};

export default function Litepaper() {
    return (
        <>
            <main
                className="min-h-screen bg-litepaperBg rounded-[56px] py-[160px]"
            >
                <div className="container mx-auto max-w-2xl">
                    <div className='pt-20 pb-10 md:pt-0 md:py-[24px] flex flex-col items-center justify-center gap-[1.1rem]'>
                        <h1 className="text-center text-4xl w-[70%] md:w-full md:text-3xl leading-[48px] md:leading-[38px] font-bold font-funnel-display text-black">EarnKit Litepaper</h1>
                        <p className="max-w-max text-center rounded-full border border-black/[40%] px-[12px] py-[2px] font-funnel-sans font-semibold text-[12px] text-black/[40%]"> Version 1.2
                        </p>
                    </div>

                    {/* Abstract */}
                    <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                        <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Abstract</h2>
                        <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                EarnKit is a monetization protocol purpose-built for crypto-native AI agents. It allows developers to integrate global payment rails and pricing primitives into their agents with just a few lines of code. With native support for smart wallet billing, flexible fee formats, and integration with leading AI and Web3 infrastructure, EarnKit helps developers go from prompts to revenue without building payments from scratch.
                            </p>
                        </div>
                    </section>

                    {/* Ecosystem Overview */}
                    <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                        <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Ecosystem Overview</h2>
                        <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                While the agent ecosystem has seen explosive growth with the rise of LLMs, most agents remain unmonetized or rely on speculative tokens. Web2-native monetization infrastructure is currently incompatible with smart wallets, while Web3 protocols lack tools tailored to agents. EarnKit fills this gap by offering a vertically integrated monetization stack optimized for crypto.
                            </p>
                            <p>
                                As AI agents evolve from hobby projects to serious businesses, monetization will define which agents succeed. EarnKit makes it possible for any agent—whether it posts onchain data, creates tokens, or executes DeFi transactions—to earn revenue in ETH or stablecoins.
                            </p>
                        </div>
                    </section>

                    {/* Core Philosophy */}
                    <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                        <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Core Philosophy</h2>
                        <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                EarnKit is built on the principle that monetization should be:
                            </p>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <ul className='m-0 p-0 px-6 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                    <strong>Frictionless</strong>: Fees are auto-deducted via smart wallets or EOA.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    <strong>Composable</strong>: Works with frameworks like Langchain, ElizaOS, and AgentKit.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    <strong>Configurable</strong>: Developers choose fee formats: usage-based, subscriptions, tx fees, or credits.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    <strong>Crypto-Native</strong>: All revenue settles onchain in ETH or stablecoins.
                                </li>
                            </ul>
                        </div>
                        <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                EarnKit helps developers connect LLM and onchain usage into one simple SDK for monetizing their agents.
                            </p>
                        </div>
                    </section>

                    {/* Feature Overview */}
                    <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                        <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Feature Overview</h2>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p className='font-medium p-0 m-0 px-0 font-funnel-sans text-[20px] leading-[28px]'>Smart Wallet Billing</p>
                            <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                                <p>
                                    Integrated with Privy, Turnkey, and EOAs. Fees are auto-deducted without approvals.
                                </p>
                            </div>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p className='font-medium p-0 m-0 px-0 font-funnel-sans text-[20px] leading-[28px]'>Modular Fee Primitives</p>
                            <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                                <p>
                                    Supports usage-based pricing, credits, transaction fees, and subscriptions.
                                </p>
                            </div>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p className='font-medium p-0 m-0 px-0 font-funnel-sans text-[20px] leading-[28px]'>Analytics + Revenue Tracking</p>
                            <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                                <p>
                                    Built-in dashboard to track earnings, transactions, and usage per agent.
                                </p>
                            </div>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p className='font-medium p-0 m-0 px-0 font-funnel-sans text-[20px] leading-[28px]'>Framework Support</p>
                            <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                                <p>
                                    Compatible with Langchain, ElizaOS, AgentKit, and other major frameworks.
                                </p>
                            </div>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p className='font-medium p-0 m-0 px-0 font-funnel-sans text-[20px] leading-[28px]'>Multi-chain Support</p>
                            <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                                <p>
                                    Built for Base, Optimism, Lens, Monad, Solana, and more.
                                </p>
                            </div>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <p className='font-medium p-0 m-0 px-0 font-funnel-sans text-[20px] leading-[28px]'>Developer Templates</p>
                            <div className='flex flex-col font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                                <p>
                                    Pre-built monetized agents make it easy to launch quickly.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Technical Architecture */}
                    <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                        <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Technical Architecture</h2>
                        <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                EarnKit provides a set of SDKs and smart contracts that allow developers to:
                            </p>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <ul className='m-0 p-0 px-6 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                    Register an agent and configure pricing parameters.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    Integrate monetization via SDK in &lt;10 lines of code.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    Collect payments via smart wallet deductions.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    Track revenue via hosted analytics dashboards.
                                </li>
                            </ul>
                        </div>
                    </section>

                    {/* Distribution & Developer Growth */}
                    <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                        <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Distribution & Developer Growth</h2>
                        <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                EarnKit bootstraps distribution through:
                            </p>
                        </div>

                        <div className='flex flex-col gap-[12px] font-funnel-sans text-[1rem] leading-[22.4px] text-black/[80%] tracking-normal'>
                            <ul className='m-0 p-0 px-6 list-disc space-y-[8px] text-sm leading-normal font-funnel-sans font-normal text-black/[80%] text-[16px] custom-list'>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal '>
                                    <strong>Owned Agents</strong>: High-utility agents (like token creators, traders, software engineering agents) act as distribution engines.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    <strong>Templates & SDKs</strong>: Developers can use or fork monetized agent templates.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    <strong>Slack Community & Support</strong>: Co-building support for early-stage builders.
                                </li>
                                <li className='font-normal text-[16px] leading-[22px] tracking-normal'>
                                    <strong>Global Infrastructure</strong>: ETH + stablecoin billing out of the box.
                                </li>
                            </ul>
                        </div>
                    </section>

                    {/* Conclusion */}
                    <section className="bg-white rounded-[8px] px-14 md:px-[100px] py-[80px] mb-6 mt-[40px] flex flex-col gap-[28px]">
                        <h2 className="text-color2 font-funnel-sans font-semibold text-[24px] leading-[32px]">Conclusion</h2>
                        <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                AI agents will become the dominant interface for how we use crypto. But without monetization, most agents can&apos;t sustain themselves or grow. EarnKit fixes this by making payments native to the crypto agent economy. With a simple SDK, global payment support, and integrations across the stack, EarnKit gives developers everything they need to go from agent to a revenue generating business.
                            </p>
                        </div>
                        {/* <div className='flex flex-col gap-[1rem] font-funnel-sans text-[1rem] leading-[22.4px] text-black/80 tracking-normal'>
                            <p>
                                For partnership and inquiries: <a href="mailto:j@earnkit.com" className="text-black/80 underline font-normal leading-[25px] ml-1 underline-offset-2">j@earnkit.com</a>
                            </p>
                        </div> */}
                    </section>

                    {/* Footer */}
                    <div className="pb-10 md:pb-0 text-center mt-12 flex flex-col items-center justify-center gap-[20px]">
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
            <Footer />
        </>
    );
}