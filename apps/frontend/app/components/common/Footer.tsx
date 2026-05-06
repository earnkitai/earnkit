import Link from "next/link";
// import { InvestorsIcons } from "../ui/TeamIcons";
// import Marquee from "react-fast-marquee";
import { Icons } from "../ui/Icons";

export default function Footer() {
    return (
        <footer className="w-full pb-24 md:pb-0">
            <section aria-labelledby="footer-content" className="w-full rounded-[56px] mt-10">
                <div className="mx-auto flex flex-col-reverse md:flex-row justify-between">
                    {/* Logo and Tagline */}
                    <div className="md:mt-0 mb-8 lg:mb-0 flex-1 flex flex-col md:flex-row gap-16 md:gap-8 items-center justify-start bg-color1 pl-0 md:pl-24 py-10 pt-16 md:pt-32 rounded-[56px]">
                        <div>
                            <Link href="/" className="flex-shrink-0 text-white" target="_blank">
                                <svg width="181" height="32" viewBox="0 0 181 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M15.5918 16.4082C15.5915 25.0192 8.61111 32 0 32V24.2441C4.3275 24.2441 7.83562 20.7356 7.83594 16.4082H15.5918ZM23.3623 16.4082C23.3627 20.699 26.841 24.1777 31.1318 24.1777V31.9336C22.5574 31.9336 15.6059 24.9826 15.6055 16.4082H23.3623ZM174.141 9.74902H180.007V16.1562H174.141V20.5029C174.155 23.2849 176.305 25.425 180.02 25.4375L179.998 31.8447C173.703 31.8236 167.762 27.7015 167.732 20.5234V3.90723H174.141V9.74902ZM71.5225 8.13379H65.2451C61.672 8.15246 58.6172 10.3613 57.3545 13.4863H68.418V19.8936H57.3545C58.6212 23.0281 61.691 25.241 65.2783 25.2461H71.5225V31.6543H65.0908V31.6523C56.9184 31.5455 50.3262 24.8872 50.3262 16.6895C50.3264 8.49191 56.9186 1.83441 65.0908 1.72754V1.72559H71.5225V8.13379ZM95.0762 31.5713H88.668V30.5225C87.2606 31.1734 85.6925 31.5361 84.04 31.5361C77.9456 31.5359 73.0049 26.5955 73.0049 20.501C73.005 14.4066 77.9457 9.46605 84.04 9.46582C85.6926 9.46582 87.2606 9.82946 88.668 10.4805V9.30957H95.0762V31.5713ZM165.297 31.5713H158.89V9.30957H165.297V31.5713ZM155.932 3.60547C155.897 8.57532 154.007 14.4765 149.591 18.8418L157.543 31.5303H149.98L141.109 17.375L143.522 15.6152C147.64 12.612 149.496 7.69465 149.524 3.56152L155.932 3.60547ZM121.615 9.46582C127.71 9.46595 132.65 14.4065 132.65 20.501V31.5264H126.242V20.501C126.242 17.9454 124.171 15.8742 121.615 15.874C119.06 15.874 116.987 17.9453 116.987 20.501V31.5264H110.58V20.501C110.58 14.4065 115.521 9.46582 121.615 9.46582ZM109.396 15.873L108.058 15.8896H108.039C105.458 15.8896 103.38 17.9703 103.38 20.501V31.5195H96.9717V20.501C96.9718 14.3883 101.958 9.49248 108.019 9.48145L109.319 9.46582L109.396 15.873ZM141.028 31.4492H134.62V3.45703H141.028V31.4492ZM84.04 15.874C81.4845 15.8742 79.4132 17.9455 79.4131 20.501C79.4131 23.0566 81.4845 25.1287 84.04 25.1289C86.5958 25.1289 88.668 23.0568 88.668 20.501C88.6678 17.9453 86.5957 15.874 84.04 15.874ZM15.5996 0.865234C24.1828 0.865503 31.1414 7.82403 31.1416 16.4072H23.3848C23.3845 12.1076 19.8992 8.62136 15.5996 8.62109C11.2998 8.62109 7.81372 12.1075 7.81348 16.4072H0.0576172C0.0578621 7.82386 7.01619 0.865234 15.5996 0.865234ZM162.094 1.02051C163.863 1.02067 165.297 2.45527 165.297 4.22461C165.297 5.99378 163.863 7.42757 162.094 7.42773C160.324 7.42773 158.89 5.99388 158.89 4.22461C158.89 2.45517 160.324 1.02051 162.094 1.02051Z" fill="#E5EEFC" />
                                </svg>
                            </Link>
                            {/* <p className="font-funnel-sans text-color8 text-lg">AI Agent Framework</p> */}
                        </div>
                        <Link
                            href="http://jenil.com/chat"
                            target="_blank"
                            className="inline-flex items-center max-w-max justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8"
                        >
                            <Icons.sparkleIcon className="w-6 h-6 transition group-hover:text-color8 text-color7" />
                            Book a Call
                        </Link>
                    </div>

                    {/* Navigation Links */}
                    <div className="grid grid-cols-2 gap-x-24 gap-y-8 bg-color5 rounded-[56px] p-10 px-20">
                        {/* Socials Column */}
                        <div>
                            <h3 className="text-color1 font-semibold font-funnel-display mb-4 text-left">Socials</h3>
                            <ul className="space-y-3">
                                <li className="text-left"><Link href="https://x.com/EarnKit_ai" className="text-color6 hover:text-white font-funnel-sans" target="_blank" aria-label="EarnKit_ai">Twitter/X</Link></li>
                                <li className="text-left"><Link href="https://warpcast.com/earnkit" className="text-color6 hover:text-white font-funnel-sans" target="_blank" aria-label="EarnKit Warpcast">Warpcast</Link></li>
                                <li className="text-left"><Link href="https://www.linkedin.com/company/earnkit" className="text-color6 hover:text-white font-funnel-sans" target="_blank" aria-label="EarnKit LinkedIn">LinkedIn</Link></li>
                            </ul>
                        </div>

                        {/* EarnKit Column */}
                        <div>
                            <h3 className="text-blue-500 font-semibold mb-4 font-funnel-display text-left" >EarnKit</h3>
                            <ul className="space-y-3">
                                <li className="text-left"><Link href="https://docs.earnkit.com" className="text-color6 hover:text-white font-funnel-sans" target="_blank">Docs</Link></li>
                                <li className="text-left"><Link href="https://blog.earnkit.com/" className="text-color6 hover:text-white font-funnel-sans">Blog</Link></li>
                                <li className="text-left"><Link href="/roadmap" className="text-color6 hover:text-white font-funnel-sans" target="_blank">Roadmap</Link></li>
                                <li className="text-left"><Link href="/litepaper" className="text-color6 hover:text-white font-funnel-sans" target="_blank">Litepaper</Link></li>
                            </ul>
                        </div>
                    </div>
                </div>


            </section>
            {/* Investors Section */}
            {/* <section aria-labelledby="investors-heading" className="w-full px-0 py-4 md:py-10">
                <div className="relative w-full overflow-hidden">
                    <div className="flex items-center gap-16 whitespace-nowrap">
                        <Marquee>
                            <figure className="inline-flex items-center justify-center h-16 mx-8 ">
                                <div className="w-32 h-12 flex items-center justify-center ">
                                    <InvestorsIcons.LAO aria-label="LAO investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.VoltCapital aria-label="Volt Capital investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.Galaxy aria-label="Galaxy investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.Ideo aria-label="Ideo investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.Acapital aria-label="Acapital investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.Scalar aria-label="Scalar investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.gcr aria-label="GCR investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.defiAlliance aria-label="Defi Alliance investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.block0 aria-label="Block0 investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                            <figure className="inline-flex items-center justify-center h-16 mx-8">
                                <div className="w-32 h-12 flex items-center justify-center">
                                    <InvestorsIcons.cooperTurnley aria-label="Cooper Turnley investor logo" className="max-h-full text-color6 object-scale-down" />
                                </div>
                            </figure>
                        </Marquee>
                    </div>
                </div>
            </section> */}
        </footer>
    );
}