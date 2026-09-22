import Link from 'next/link';
import WaitlistButton from './WaitlistButton';

const wordmarkPath =
  'M5.37168 11.7803C5.37168 8.82407 7.76817 6.42758 10.7244 6.42758C13.6806 6.42758 16.0771 8.82407 16.0771 11.7803H21.4095C21.4095 5.87909 16.6256 1.09521 10.7244 1.09521C4.82319 1.09521 0.039314 5.87909 0.039314 11.7803H5.37168ZM0 17.1676C2.97529 17.1676 5.38723 14.7557 5.38723 11.7804H10.7196C10.7196 17.7007 5.92027 22.5 0 22.5V17.1676ZM16.0613 11.7803C16.0613 14.7304 18.4529 17.122 21.403 17.122V22.4543C15.5079 22.4543 10.729 17.6754 10.729 11.7803H16.0613ZM111.439 5.60699C112.656 5.60699 113.642 4.62083 113.642 3.40434C113.642 2.18785 112.656 1.2017 111.439 1.2017C110.223 1.2017 109.237 2.18785 109.237 3.40434C109.237 4.62083 110.223 5.60699 111.439 5.60699ZM119.721 11.6079V14.5958C119.731 16.5085 121.209 17.9798 123.763 17.9884L123.748 22.3936C119.42 22.3791 115.337 19.5449 115.316 14.6099L115.316 14.6008L115.316 3.1863H119.721V7.20256H123.755V11.6079H119.721ZM109.237 22.2053V6.90054H113.642V22.2053H109.237ZM60.9593 21.4843V22.2053H65.3646V6.9005H60.9593V7.70528C59.9918 7.25771 58.914 7.00798 57.7778 7.00798C53.5877 7.00798 50.191 10.4047 50.191 14.5948C50.191 18.7849 53.5877 22.1816 57.7778 22.1816C58.914 22.1816 59.9918 21.9319 60.9593 21.4843ZM54.5963 14.5948C54.5963 12.8377 56.0207 11.4133 57.7778 11.4133C59.5349 11.4133 60.9593 12.8377 60.9593 14.5948C60.9593 16.3519 59.5349 17.7763 57.7778 17.7763C56.0207 17.7763 54.5963 16.3519 54.5963 14.5948ZM83.6103 11.4133C81.8532 11.4133 80.4288 12.8377 80.4288 14.5948V22.1744H76.0235V14.5948C76.0235 10.4047 79.4202 7.00801 83.6103 7.00801C87.8004 7.00801 91.1971 10.4047 91.1971 14.5948V22.1744H86.7918V14.5948C86.7918 12.8377 85.3674 11.4133 83.6103 11.4133ZM75.2094 11.4131L75.1573 7.00816L74.2627 7.01873C70.0962 7.02631 66.6683 10.3923 66.6683 14.5948V22.1698H71.0736V14.5948C71.0736 12.8549 72.5024 11.424 74.2768 11.424H74.2898L75.2094 11.4131ZM44.8872 1.6867L44.8457 1.68679L44.7502 1.68679V1.6876C39.1316 1.76092 34.5994 6.33843 34.5994 11.9745C34.5994 17.6105 39.1316 22.188 44.7502 22.2614V22.2623L49.172 22.2622L49.172 17.857L44.8787 17.857C42.4124 17.8534 40.3019 16.3322 39.431 14.1772L47.0371 14.1772V9.77191L39.431 9.7719C40.2991 7.62347 42.3993 6.10492 44.8558 6.09208L49.172 6.09208L49.172 1.68678L44.8872 1.6867ZM92.5515 22.1214V2.87718H96.9568V22.1214H92.5515ZM102.798 2.9487C102.778 5.79026 101.503 9.17073 98.6714 11.2355L97.0126 12.4452L103.112 22.1774H108.311L102.844 13.4538C105.88 10.4527 107.18 6.39581 107.203 2.97904L102.798 2.9487Z';

function Wordmark() {
  return (
    <svg
      width="124"
      height="23"
      viewBox="0 0 124 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="EarnKit"
    >
      <path fillRule="evenodd" clipRule="evenodd" d={wordmarkPath} fill="currentColor" />
    </svg>
  );
}

function Mark() {
  return (
    <svg
      width="29"
      height="28"
      viewBox="0 0 29 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="EarnKit"
    >
      <path
        d="M14.5258 6.97539C10.6587 6.97539 7.52377 10.1103 7.52377 13.9774H0.548389C0.548389 6.25789 6.80628 0 14.5258 0C22.2453 0 28.5032 6.25789 28.5032 13.9774H21.5278C21.5278 10.1103 18.3929 6.97539 14.5258 6.97539Z"
        fill="currentColor"
      />
      <path
        d="M7.54423 13.9775C7.54423 17.8695 4.38911 21.0246 0.49707 21.0246V28C8.24151 28 14.5196 21.7219 14.5196 13.9775H7.54423Z"
        fill="currentColor"
      />
      <path
        d="M28.495 20.965C24.6358 20.965 21.5074 17.8366 21.5074 13.9774H14.532C14.532 21.689 20.7834 27.9404 28.495 27.9404V20.965Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function Header() {
  return (
    <>
      {/* Desktop */}
      <header className="hidden h-[12vh] w-full items-center justify-between gap-4 font-funnel-display md:flex">
        <div className="flex min-h-full flex-1 items-center rounded-[56px] bg-ek-navy px-12 lg:px-20">
          <Link
            href="/"
            className="logoSVG flex-shrink-0 text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Wordmark />
          </Link>
        </div>

        <WaitlistButton className="min-h-full min-w-[20%] rounded-[56px]" />
      </header>

      {/* Mobile */}
      <header className="container2 fixed bottom-0 z-50 flex w-full flex-col items-center justify-between font-funnel-display md:hidden">
        <div className="absolute left-0 top-[-56px] text-ek-black">
          <svg
            className="-rotate-90"
            width="56"
            height="56"
            viewBox="0 0 56 56"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M0 0 H56 V56 H0 Z M0 56 A56 56 0 0 1 56 0 L56 56 Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        </div>
        <div className="absolute right-0 top-[-56px] text-ek-black">
          <svg
            className="rotate-180"
            width="56"
            height="56"
            viewBox="0 0 56 56"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M0 0 H56 V56 H0 Z M0 56 A56 56 0 0 1 56 0 L56 56 Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        </div>

        <div className="mobile-header-bg z-30 flex h-[10dvh] w-full flex-row items-center justify-between gap-4 bg-ek-black px-6">
          <Link
            href="/"
            className="text-ek-blue-light transition-colors hover:text-ek-white"
          >
            <Mark />
          </Link>
          <WaitlistButton className="px-6 py-2.5 text-base" />
        </div>
      </header>
    </>
  );
}
