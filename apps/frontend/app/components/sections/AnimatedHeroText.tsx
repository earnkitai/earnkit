"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export default function AnimatedHeroText() {
    return (
        <>
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                    duration: 0.5,
                    ease: "easeOut",
                    type: "spring",
                    stiffness: 100
                }}
                className="max-w-[75%] lg:max-w-[75%] text-center flex flex-col justify-center font-medium font-funnel-display text-[2.5rem] lg:text-[5rem] 2xl:text-[8dvh] tracking-tight leading-[1.05]"
                style={{ willChange: "transform, opacity" }}
            >
                <h1 className="text-white">
                    Set up Onchain Payments
                </h1>
                <h1 className="text-white">
                    For Your
                </h1>
                <h1 className="text-white">
                    AI Agent in Minutes.
                </h1>
            </motion.div>
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                    duration: 0.5,
                    ease: "easeOut",
                    delay: 0.2,
                    type: "spring",
                    stiffness: 100
                }}
                className="max-w-[70%] lg:max-w-[70%] text-center flex flex-col justify-center mt-6"
                style={{ willChange: "transform, opacity" }}
            >
                <p className="text-color8 font-funnel-sans text-lg lg:text-[1.125rem] 2xl:text-[2dvh] font-medium leading-[1.4]">
                    Charge users in ETH or any ERC20 on Base. Got a token? Route a slice of revenue to
buy it back automatically.
                </p>
            </motion.div>
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                    duration: 0.5,
                    ease: "easeOut",
                    delay: 0.2,
                    type: "spring",
                    stiffness: 100
                }}
                className="max-w-[70%] lg:max-w-[70%] text-center flex gap-4 justify-center mt-6"
                style={{ willChange: "transform, opacity" }}
            >
                <Link href="https://app.earnkit.com" className="inline-flex text-nowrap items-center w-full justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 bg-color6 outline-color6 border border-color6 rounded-full text-color3 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:bg-color7 hover:border-color7 hover:outline-color7 hover:text-color3" target="_blank">
                    Get Started
                </Link>
                <Link href="https://docs.earnkit.com" className="inline-flex text-nowrap items-center w-full justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8" target="_blank">
                    Read the Docs
                </Link>
            </motion.div>
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                    duration: 0.5,
                    ease: "easeOut",
                    delay: 0.2,
                    type: "spring",
                    stiffness: 100
                }}
                className="max-w-[70%] lg:max-w-[70%] text-center flex justify-center mt-4"
                style={{ willChange: "transform, opacity" }}
            >
                <span className="text-sm text-nowrap flex items-center gap-2">Powered by <img src="/images/landing/splits_wordmark_dark.svg" className="h-4"/> <span>•</span>  Used by <img src="/images/landing/TOKENS_LOGO_WHITE.png" className="h-3"/></span>
            </motion.div>
        </>
    );
 }