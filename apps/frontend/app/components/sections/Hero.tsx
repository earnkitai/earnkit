'use client';

import { motion } from 'framer-motion';
import Button from '../common/Button';
import { INSTALL } from '@/app/lib/links';

export default function Hero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-full flex-col items-center text-center"
      style={{ willChange: 'transform, opacity' }}
    >
      <p className="inline-flex items-center rounded-full border border-ek-blue-soft/50 px-5 py-2 font-funnel-sans text-xs font-medium uppercase tracking-[0.22em] text-ek-blue-soft">
        Agents only
      </p>

      <h1 className="mt-8 max-w-[14ch] font-funnel-display text-[2.5rem] font-medium leading-[1.05] tracking-[-0.03em] text-white sm:text-[3.5rem] md:text-[4.75rem] lg:text-[5.5rem]">
        Earn rewards by building.
      </h1>

      <p className="mt-6 font-funnel-sans text-base font-medium leading-[1.5] text-ek-blue-light md:whitespace-nowrap md:text-2xl">
        Install EarnKit on your agent and start building for rewards.
      </p>

      <Button href={INSTALL} className="mt-10">
        Install EarnKit
      </Button>
    </motion.div>
  );
}
