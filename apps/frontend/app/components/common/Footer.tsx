import Link from "next/link";

export default function Footer() {
    return (
        <section aria-labelledby="footer-content" className="w-full bg-[#101128] px-14 md:px-16 lg:px-20 py-14 mb-24 md:py-20 rounded-[56px]">
            <div className="max-w-7xl mx-auto flex flex-col-reverse md:flex-row justify-between">
                {/* Logo and Tagline */}
                <div className="mt-24 md:mt-0 mb-8 lg:mb-0 flex flex-col gap-4 items-center justify-end">
                    <Link href="https://earnkit.com" className="flex-shrink-0 mr-10 transition-colors ml-4" target="_blank">
                        <svg width="120" height="24" viewBox="0 0 181 32" fill="none" xmlns="http://www.w3.org/2000/svg" >
                            <path className="transitions-colors" fillRule="evenodd" clipRule="evenodd" d="M7.81335 16.4077C7.81335 12.1077 11.2992 8.62189 15.5991 8.62189C19.8991 8.62189 23.3849 12.1077 23.3849 16.4077H31.141C31.141 7.82408 24.1827 0.865723 15.5991 0.865723C7.01554 0.865723 0.0571842 7.82408 0.0571842 16.4077H7.81335ZM0 24.2438C4.32769 24.2438 7.83598 20.7355 7.83598 16.4078H15.5921C15.5921 25.0191 8.6113 32 0 32V24.2438ZM23.3619 16.4076C23.3619 20.6987 26.8406 24.1774 31.1317 24.1774V31.9336C22.557 31.9336 15.6058 24.9824 15.6058 16.4076H23.3619ZM162.093 7.42835C163.863 7.42835 165.297 5.99394 165.297 4.2245C165.297 2.45506 163.863 1.02065 162.093 1.02065C160.324 1.02065 158.89 2.45506 158.89 4.2245C158.89 5.99394 160.324 7.42835 162.093 7.42835ZM174.14 16.1569V20.5029C174.155 23.285 176.304 25.4251 180.019 25.4376L179.998 31.8453C173.702 31.8241 167.762 27.7017 167.733 20.5236L167.733 20.5103L167.733 3.90734H174.14V9.74918L180.007 9.74918V16.1569H174.14ZM158.89 31.5714V9.30987H165.297V31.5714H158.89ZM88.6681 30.5226V31.5713H95.0758V9.30982H88.6681V10.4804C87.2607 9.8294 85.693 9.46615 84.0405 9.46615C77.9458 9.46615 73.0051 14.4068 73.0051 20.5015C73.0051 26.5962 77.9458 31.5369 84.0405 31.5369C85.693 31.5369 87.2607 31.1736 88.6681 30.5226ZM79.4128 20.5015C79.4128 17.9457 81.4847 15.8738 84.0405 15.8738C86.5962 15.8738 88.6681 17.9457 88.6681 20.5015C88.6681 23.0573 86.5962 25.1292 84.0405 25.1292C81.4847 25.1292 79.4128 23.0573 79.4128 20.5015ZM121.615 15.8739C119.059 15.8739 116.987 17.9458 116.987 20.5015V31.5264H110.58V20.5015C110.58 14.4069 115.52 9.46619 121.615 9.46619C127.71 9.46619 132.65 14.4069 132.65 20.5015V31.5264H126.243V20.5015C126.243 17.9458 124.171 15.8739 121.615 15.8739ZM109.395 15.8737L109.32 9.46641L108.018 9.48179C101.958 9.49282 96.9721 14.3887 96.9721 20.5015V31.5198H103.38V20.5015C103.38 17.9707 105.458 15.8895 108.039 15.8895H108.058L109.395 15.8737ZM65.2905 1.72612L65.2301 1.72623L65.0912 1.72624V1.72742C56.9187 1.83406 50.3264 8.49226 50.3264 16.6902C50.3264 24.888 56.9187 31.5462 65.0912 31.6529V31.6542L71.5228 31.6542V25.2465L65.278 25.2465C61.6907 25.2414 58.6209 23.0287 57.3542 19.8941L68.4175 19.8941V13.4864L57.3541 13.4864C58.6168 10.3614 61.6717 8.1526 65.2448 8.13394L71.5228 8.13393V1.72623L65.2905 1.72612ZM134.62 31.4493V3.45772H141.028V31.4493H134.62ZM149.524 3.56174C149.496 7.69493 147.64 12.612 143.522 15.6152L141.109 17.3748L149.981 31.5308H157.543L149.591 18.8419C154.007 14.4766 155.898 8.57572 155.932 3.60588L149.524 3.56174Z" fill="#B8CCE0" />
                        </svg>
                    </Link>
                    <p className="font-funnel-sans text-[#B8CCE0]">AI Agent Framework</p>
                </div>

                {/* Navigation Links */}
                <div className="grid grid-cols-2 gap-x-20 gap-y-8">
                    {/* Socials Column */}
                    <div>
                        <h3 className="text-blue-500 font-semibold font-funnel-display mb-4 text-center md:text-left">Socials</h3>
                        <ul className="space-y-3">
                            <li className="text-center md:text-left"><Link href="https://x.com/EarnKit_ai" className="text-[#B8CCE0] hover:text-white font-funnel-sans" target="_blank" aria-label="EarnKit_ai">Twitter/X</Link></li>
                            <li className="text-center md:text-left"><Link href="https://warpcast.com/earnkit" className="text-[#B8CCE0] hover:text-white font-funnel-sans" target="_blank" aria-label="EarnKit Warpcast">Warpcast</Link></li>
                            <li className="text-center md:text-left"><Link href="https://www.linkedin.com/company/earnkit" className="text-[#B8CCE0] hover:text-white font-funnel-sans" target="_blank" aria-label="EarnKit LinkedIn">LinkedIn</Link></li>
                        </ul>
                    </div>

                    {/* EarnKit Column */}
                    <div>
                        <h3 className="text-blue-500 font-semibold mb-4 font-funnel-display text-center md:text-left" >EarnKit</h3>
                        <ul className="space-y-3">
                            <li className="text-center md:text-left"><Link href="https://docs.earnkit.com" className="text-[#B8CCE0] hover:text-white font-funnel-sans" target="_blank">Docs</Link></li>
                            <li className="text-center md:text-left"><Link href="/" className="text-[#B8CCE0] hover:text-white font-funnel-sans">Blog</Link></li>
                            <li className="text-center md:text-left"><Link href="https://earnkit.com/roadmap" className="text-[#B8CCE0] hover:text-white font-funnel-sans" target="_blank">Roadmap</Link></li>
                            <li className="text-center md:text-left"><Link href="https://earnkit.com/litepaper" className="text-[#B8CCE0] hover:text-white font-funnel-sans" target="_blank">Litepaper</Link></li>
                        </ul>
                    </div>
                </div>
            </div>
        </section>
    );
}