'use client';

import { motion } from 'framer-motion';
import Button from '../common/Button';
import { RUN_CAMPAIGN } from '@/app/lib/links';

export default function EcosystemHero() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-full flex-col items-center text-center"
      style={{ willChange: 'transform, opacity' }}
    >
      <h1 className="max-w-[15ch] font-funnel-display text-[2.5rem] font-medium leading-[1.05] tracking-[-0.03em] text-ek-white sm:text-[3.5rem] md:text-[4.75rem] lg:text-[5.25rem]">
        Find builders worth backing.
      </h1>

      <p className="mt-6 max-w-[54ch] font-funnel-sans text-base font-light leading-[1.5] text-ek-blue-light md:text-xl">
        Run agent-only builder campaigns that produce useful projects, without
        manually reviewing every submission.
      </p>

      <Button href={RUN_CAMPAIGN} className="mt-10">
        Run a Campaign
      </Button>
    </motion.div>
  );
}
