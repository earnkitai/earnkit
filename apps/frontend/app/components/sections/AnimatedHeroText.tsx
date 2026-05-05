'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export default function AnimatedHeroText() {
  return (
    <>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          duration: 0.5,
          ease: 'easeOut',
          type: 'spring',
          stiffness: 100,
        }}
        /* Reduced mobile font size to text-3xl/4xl to fit on 2 lines at 320px */
        className="w-full lg:max-w-[90%] 2xl:max-w-[1200px] text-center flex flex-col justify-center font-medium font-funnel-display text-[1.65rem] sm:text-[2.5rem] md:text-[4rem] lg:text-[5.5rem] 2xl:text-[9dvh] tracking-tight leading-[1.1]"
        style={{ willChange: 'transform, opacity' }}
      >
        <h1 className="text-white">
          Setup automated
          <br /> buybacks for any token
        </h1>
      </motion.div>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          duration: 0.5,
          ease: 'easeOut',
          delay: 0.1,
          type: 'spring',
          stiffness: 100,
        }}
        /* Adjusted max-width and leading for a cleaner mobile look */
        className="w-full max-w-[280px] sm:max-w-[95%] lg:max-w-[85%] text-center flex flex-col justify-center mt-6"
        style={{ willChange: 'transform, opacity' }}
      >
        <p className="text-color8 font-funnel-sans text-sm md:text-2xl 2xl:text-[2.2dvh] font-medium leading-[1.5] md:leading-[1.4]">
          Route revenue from your treasury to buy back and burn your token.
        </p>
      </motion.div>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          duration: 0.5,
          ease: 'easeOut',
          delay: 0.2,
          type: 'spring',
          stiffness: 100,
        }}
        /* Kept the UI layout identical, just cleaned up spacing */
        className="w-full max-w-[280px] md:max-w-[70%] text-center flex flex-col md:flex-row gap-4 justify-center mt-10"
        style={{ willChange: 'transform, opacity' }}
      >
        <Link
          href="https://app.earnkit.com"
          className="inline-flex text-nowrap items-center w-full md:w-auto justify-center gap-2 px-8 md:px-12 py-3 md:py-5 outline outline-2 bg-color6 outline-color6 border border-color6 rounded-full text-color3 text-lg md:text-xl font-funnel-sans font-medium group transition hover:bg-color7 hover:border-color7 hover:outline-color7 hover:text-color3"
          target="_blank"
        >
          Get Started
        </Link>
        <Link
          href="https://docs.earnkit.com"
          className="inline-flex text-nowrap items-center w-full md:w-auto justify-center gap-2 px-8 md:px-12 py-3 md:py-5 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-lg md:text-xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8"
          target="_blank"
        >
          Read the Docs
        </Link>
      </motion.div>
      {/* <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          duration: 0.5,
          ease: 'easeOut',
          delay: 0.2,
          type: 'spring',
          stiffness: 100,
        }}
        className="max-w-[70%] lg:max-w-[70%] text-center flex justify-center mt-6"
        style={{ willChange: 'transform, opacity' }}
      >
        <span className="text-sm text-nowrap flex items-center gap-2">
          Powered by{' '}
          <img src="/images/landing/splits_wordmark_dark.svg" className="h-4" />{' '}
          <span>•</span> Used by{' '}
          <img src="/images/landing/TOKENS_LOGO_WHITE.png" className="h-3" />
        </span>
      </motion.div> */}
    </>
  );
}
