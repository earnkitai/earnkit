import Link from 'next/link';
import { Icons } from '../sections/icons';

export default function NewFooter() {
    return (
        <footer className="w-full p-[40px] md:p-[68px] flex flex-col md:flex-row items-center md:items-end justify-between bg-black rounded-[56px]">
            {/* Left: Earny icon, logo and tagline */}
            <div className="flex flex-col items-center md:items-start mb-4 md:mb-0 mt-4 md:mt-0 min-w-[220px] font-funnel-sans">
                <div className="flex items-center space-x-2">
                    <Icons.earnyLogoBlack className="h-10 w-auto text-white" />
                </div>
                <span className="text-color16 text-lg md:text-lg mt-4 flex items-center">
                    Your Earning Assistant
                    <Icons.sparkelOrangeIcon className="ml-1 h-4 w-4 fill-current text-color16" />
                </span>
            </div>



            {/* Right: Powered by Earnkit */}
            <div className="flex gap-14 items-center pt-8 md:pt-0">
                {/* Center: Social links */}
                <div className="flex space-x-8 text-color2 font-funnel-sans mb-4 md:mb-0">
                    <Link href="https://farcaster.xyz/earny" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Farcaster</Link>
                </div>
            </div>
        </footer>
    );
}
