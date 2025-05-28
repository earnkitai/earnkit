import Link from "next/link";
// import { useState } from "react";

export default function Header() {

    return (
        <>
            <header className="hidden md:flex w-full justify-between items-center h-[12vh] font-funnel-display">
                <div className="flex-1 min-h-full flex justify-between items-center bg-color4 px-[5rem] rounded-[56px]">
                    <Link href="/" className="flex-shrink-0 mr-10 logoSVG transition-colors ml-4" >
                        <svg width="124" height="23" viewBox="0 0 124 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path className="transition-colors" fillRule="evenodd" clipRule="evenodd" d="M5.37168 11.7803C5.37168 8.82407 7.76817 6.42758 10.7244 6.42758C13.6806 6.42758 16.0771 8.82407 16.0771 11.7803H21.4095C21.4095 5.87909 16.6256 1.09521 10.7244 1.09521C4.82319 1.09521 0.039314 5.87909 0.039314 11.7803H5.37168ZM0 17.1676C2.97529 17.1676 5.38723 14.7557 5.38723 11.7804H10.7196C10.7196 17.7007 5.92027 22.5 0 22.5V17.1676ZM16.0613 11.7803C16.0613 14.7304 18.4529 17.122 21.403 17.122V22.4543C15.5079 22.4543 10.729 17.6754 10.729 11.7803H16.0613ZM111.439 5.60699C112.656 5.60699 113.642 4.62083 113.642 3.40434C113.642 2.18785 112.656 1.2017 111.439 1.2017C110.223 1.2017 109.237 2.18785 109.237 3.40434C109.237 4.62083 110.223 5.60699 111.439 5.60699ZM119.721 11.6079V14.5958C119.731 16.5085 121.209 17.9798 123.763 17.9884L123.748 22.3936C119.42 22.3791 115.337 19.5449 115.316 14.6099L115.316 14.6008L115.316 3.1863H119.721V7.20256H123.755V11.6079H119.721ZM109.237 22.2053V6.90054H113.642V22.2053H109.237ZM60.9593 21.4843V22.2053H65.3646V6.9005H60.9593V7.70528C59.9918 7.25771 58.914 7.00798 57.7778 7.00798C53.5877 7.00798 50.191 10.4047 50.191 14.5948C50.191 18.7849 53.5877 22.1816 57.7778 22.1816C58.914 22.1816 59.9918 21.9319 60.9593 21.4843ZM54.5963 14.5948C54.5963 12.8377 56.0207 11.4133 57.7778 11.4133C59.5349 11.4133 60.9593 12.8377 60.9593 14.5948C60.9593 16.3519 59.5349 17.7763 57.7778 17.7763C56.0207 17.7763 54.5963 16.3519 54.5963 14.5948ZM83.6103 11.4133C81.8532 11.4133 80.4288 12.8377 80.4288 14.5948V22.1744H76.0235V14.5948C76.0235 10.4047 79.4202 7.00801 83.6103 7.00801C87.8004 7.00801 91.1971 10.4047 91.1971 14.5948V22.1744H86.7918V14.5948C86.7918 12.8377 85.3674 11.4133 83.6103 11.4133ZM75.2094 11.4131L75.1573 7.00816L74.2627 7.01873C70.0962 7.02631 66.6683 10.3923 66.6683 14.5948V22.1698H71.0736V14.5948C71.0736 12.8549 72.5024 11.424 74.2768 11.424H74.2898L75.2094 11.4131ZM44.8872 1.6867L44.8457 1.68679L44.7502 1.68679V1.6876C39.1316 1.76092 34.5994 6.33843 34.5994 11.9745C34.5994 17.6105 39.1316 22.188 44.7502 22.2614V22.2623L49.172 22.2622L49.172 17.857L44.8787 17.857C42.4124 17.8534 40.3019 16.3322 39.431 14.1772L47.0371 14.1772V9.77191L39.431 9.7719C40.2991 7.62347 42.3993 6.10492 44.8558 6.09208L49.172 6.09208L49.172 1.68678L44.8872 1.6867ZM92.5515 22.1214V2.87718H96.9568V22.1214H92.5515ZM102.798 2.9487C102.778 5.79026 101.503 9.17073 98.6714 11.2355L97.0126 12.4452L103.112 22.1774H108.311L102.844 13.4538C105.88 10.4527 107.18 6.39581 107.203 2.97904L102.798 2.9487Z" fill="currentColor" />
                        </svg>
                    </Link>

                    {/* Desktop Navigation */}
                    <nav className="w-full flex flex-row justify-start items-center text-xl 2xl:text-[1.2rem]  font-funnel-sans font-medium">
                        <Link href="https://docs.earnkit.com" className="text-color6 ml-6 mr-6 hover:text-white transition-colors" target="_blank">
                            Docs
                        </Link>
                        <Link href="https://blog.earnkit.com" className="text-color6 mx-6 hover:text-white transition-colors" target="_blank">
                            Blog
                        </Link>
                        <Link href="/litepaper" className="text-color6 mx-6 hover:text-white transition-colors" >
                            Litepaper
                        </Link>
                        <Link href="/roadmap" className="text-color6 mx-6 hover:text-white transition-colors">
                            Roadmap
                        </Link>
                        <Link href="https://staging.app.earnkit.com" className="mr-6 text-color6  hover:text-white transition-colors ml-auto" target="_blank">
                            Login
                        </Link>
                    </nav>
                </div>
                <Link href="https://staging.app.earnkit.com" target="_blank" className="min-w-[20%] min-h-full flex font-funnel-sans font-medium items-center justify-center bg-color6 rounded-[56px] hover:bg-color7">
                    <nav className="text-xl 2xl:text-[1.2rem]">
                        <span className="min-h-full text-color3">
                            Early Access
                        </span>
                    </nav>
                </Link>
            </header>
            <header className="container2 fixed bottom-0 flex flex-col w-full md:hidden justify-between items-center font-funnel-display z-50">
                <div className="min-h-[100px] h-[12vh] w-full max-w-full rounded-b-[56px] bg-transparent mobile-header-bg"></div>
                <div className="h-[10vh] z-30 h-[10dvh] bg-[#0a0917] flex flex-row justify-center items-center w-full mobile-header-bg">
                    <nav className="flex flex-row justify-start items-center font-funnel-display font-mediumitems-center gap-4 w-full max-w-full overflow-x-auto no-scrollbar">
                        <Link href="/" className="text-color2 hover:text-white transition-colors mr-4 ml-8" target="_blank">
                            <svg width="29" height="28" viewBox="0 0 29 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M14.5258 6.97539C10.6587 6.97539 7.52377 10.1103 7.52377 13.9774H0.548389C0.548389 6.25789 6.80628 0 14.5258 0C22.2453 0 28.5032 6.25789 28.5032 13.9774H21.5278C21.5278 10.1103 18.3929 6.97539 14.5258 6.97539Z" fill="currentColor" />
                                <path d="M7.54423 13.9775C7.54423 17.8695 4.38911 21.0246 0.49707 21.0246V28C8.24151 28 14.5196 21.7219 14.5196 13.9775H7.54423Z" fill="currentColor" />
                                <path d="M28.495 20.965C24.6358 20.965 21.5074 17.8366 21.5074 13.9774H14.532C14.532 21.689 20.7834 27.9404 28.495 27.9404V20.965Z" fill="currentColor" />
                            </svg>
                        </Link>
                        <Link href="#" className="text-color7 hover:text-white transition-colors mr-4 flex-shrink-0 bg-color2 rounded-full px-4 py-1 flex items-center justify-center" target="_blank">
                            Early Access
                        </Link>
                        <Link href="https://app.earnkit.com/login" className="text-color2 hover:text-white transition-colors mr-4 flex-shrink-0" target="_blank">
                            Login
                        </Link>
                        <Link href="https://blog.earnkit.com" className="text-color2 hover:text-white transition-colors mr-4 flex-shrink-0" target="_blank">
                            Blog
                        </Link>
                        <Link href="/litepaper" className="text-color2 hover:text-white transition-colors mr-4 flex-shrink-0">
                            Litepaper
                        </Link>
                        <Link href="/roadmap" className="text-color2 hover:text-white transition-colors mr-4 flex-shrink-0">
                            Roadmap
                        </Link>
                        <Link href="https://docs.earnkit.com" className="text-color2 hover:text-white transition-colors mr-4 flex-shrink-0" target="_blank">
                            Docs
                        </Link>
                    </nav>
                </div>
            </header>
        </>
    );
}