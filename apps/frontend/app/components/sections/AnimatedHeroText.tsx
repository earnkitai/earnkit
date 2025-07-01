"use client";

import { motion } from "framer-motion";

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
                className="max-w-[75%] lg:max-w-[65%] text-center flex flex-col justify-center font-medium font-funnel-display text-[3rem] lg:text-[7rem] 2xl:text-[12dvh] tracking-tight leading-[1.05]"
                style={{ willChange: "transform, opacity" }}
            >
                <h1 className="text-white">
                    Easiest Way
                </h1>
                <h1 className="text-white">
                    to Monetize Your
                </h1>
                <h1 className="text-white">
                    AI Agent
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
                className="max-w-[70%] lg:max-w-[29%] text-center flex flex-col justify-center mt-6"
                style={{ willChange: "transform, opacity" }}
            >
                <p className="text-color8 font-funnel-sans text-xl lg:text-[1.2rem] 2xl:text-[2dvh] font-medium leading-[1.4]">
                    Add usage-based fees to your agent in minutes—without rebuilding your stack.
                </p>
            </motion.div>
        </>
    );
} 