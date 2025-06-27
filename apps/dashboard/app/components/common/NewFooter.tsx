import Link from 'next/link';
import { Icons } from '../sections/icons';

// Use the public path for the logo

export default function NewFooter() {
    return (
        <footer className="w-full p-[68px] flex flex-col md:flex-row items-end justify-between bg-black rounded-[56px]">
            {/* Left: Earny icon, logo and tagline */}
            <div className="flex flex-col items-start mb-4 md:mb-0 min-w-[220px]">
                <div className="flex items-center space-x-2">
                    <Icons.earnyLogoBlack className="h-10 w-auto text-white" />
                </div>
                <span className="text-color1 text-sm mt-4 flex items-center font-medium">
                    Your Earning Assistant
                    <Icons.sparkleWhiteIcon className="ml-1 h-3 w-3 fill-current text-color1" />
                </span>
            </div>



            {/* Right: Powered by Earnkit */}
            <div className="flex gap-14 items-center">
                {/* Center: Social links */}
                <div className="flex space-x-8 text-white/40 font-funnel-sans mb-4 md:mb-0">
                    <Link href="https://x.com/EarnKit_ai" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Twitter/X</Link>
                    <Link href="https://warpcast.com/earnkit" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Warpcast</Link>
                    <Link href="https://www.linkedin.com/company/earnkit" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">LinkedIn</Link>
                </div>

                <a
                    href="https://earnkit.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center border border-white/10 rounded-lg px-4 py-2 text-neutral-400 transition text-sm font-medium"
                >
                    <span className="mr-2 text-white/40 uppercase text-xs">POWERED BY</span>
                    <svg width="68" height="12" viewBox="0 0 68 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6.29114 6.15393C6.29103 9.38308 3.67363 12.0006 0.444458 12.0006V9.09241C2.06728 9.09241 3.38283 7.77673 3.38293 6.15393H6.29114ZM9.2052 6.15393C9.20535 7.76297 10.5102 9.06799 12.1193 9.06799V11.9762C8.90383 11.9762 6.29715 9.36933 6.297 6.15393H9.2052ZM65.7462 3.65686H67.9464V6.06018H65.7462V7.68909C65.7517 8.73237 66.5583 9.535 67.9513 9.53967L67.9435 11.943C65.5827 11.9351 63.355 10.3887 63.3439 7.6969V1.46643H65.7462V3.65686ZM27.2648 3.05139H24.9103C23.5706 3.05858 22.4248 3.88649 21.9513 5.05823H26.1007V7.46155H21.9513C22.4263 8.63686 23.5779 9.46637 24.923 9.46838H27.2648V11.8707H24.8536L24.5675 11.86C21.6363 11.6742 19.3165 9.2375 19.3165 6.2594C19.3167 3.18533 21.789 0.68904 24.8536 0.649048V0.648071H27.2648V3.05139ZM36.0978 11.8405H33.6945V11.4469C33.1667 11.691 32.5788 11.8268 31.9591 11.8268C29.6737 11.8268 27.8205 9.97452 27.8204 7.68909C27.8204 5.40359 29.6736 3.55042 31.9591 3.55042C32.5788 3.55042 33.1667 3.68715 33.6945 3.93127V3.49182H36.0978V11.8405ZM62.4308 11.8405H60.0275V3.49182H62.4308V11.8405ZM58.9181 1.35315C58.9052 3.21683 58.1961 5.43005 56.5402 7.06702L59.5226 11.8248H56.6866L53.3595 6.51624L54.2648 5.85706C55.8091 4.73084 56.5051 2.88649 56.5157 1.33655L58.9181 1.35315ZM46.0499 3.55042C48.3353 3.55061 50.1876 5.40371 50.1876 7.68909V11.8229H47.7853V7.68909C47.7853 6.73079 47.0082 5.95393 46.0499 5.95374C45.0915 5.95374 44.3146 6.73067 44.3146 7.68909V11.8229H41.9113V7.68909C41.9113 5.40359 43.7644 3.55042 46.0499 3.55042ZM41.4669 5.95374L40.9659 5.95959H40.9581C39.9905 5.95982 39.2111 6.74018 39.2111 7.68909V11.8209H36.8087V7.68909C36.8087 5.3968 38.6787 3.56041 40.9513 3.55627L41.4386 3.55042L41.4669 5.95374ZM53.3292 11.7946H50.9269V1.29749H53.3292V11.7946ZM31.9591 5.95374C31.0007 5.95374 30.2238 6.73067 30.2238 7.68909C30.2238 8.64744 31.0007 9.42444 31.9591 9.42444C32.9175 9.42444 33.6944 8.64745 33.6945 7.68909C33.6945 6.73067 32.9175 5.95374 31.9591 5.95374ZM6.29407 0.325806C9.51279 0.325943 12.1222 2.93518 12.1222 6.15393H9.21399C9.21399 4.54153 7.90643 3.23415 6.29407 3.23401C4.68158 3.23401 3.37415 4.54145 3.37415 6.15393H0.465942C0.465942 2.93509 3.07523 0.325806 6.29407 0.325806ZM61.2286 0.383423C61.892 0.383423 62.4305 0.921277 62.4308 1.58459C62.4308 2.24813 61.8922 2.78674 61.2286 2.78674C60.5653 2.78656 60.0275 2.24802 60.0275 1.58459C60.0277 0.921392 60.5654 0.383609 61.2286 0.383423Z" fill="white" fillOpacity="0.8" />
                    </svg>
                </a>
            </div>
        </footer>
    );
}
