"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

export default function ParallaxOctoImage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start end", "end start"]
    });

    const y = useTransform(scrollYProgress, [0, 1], ["0%", "10%"]);

    return (
        <div ref={containerRef} className="absolute -top-[10%] -left-[10%] w-[130%] h-[130%] bg-color4 overflow-hidden">
            <motion.div
                style={{ y }}
                className="w-full h-full"
            >
                <Image
                    src="/images/landing/octo.png"
                    alt="Octopus background"
                    fill
                    className="object-cover mix-blend-hard-light"
                    quality={100}
                    priority
                />
            </motion.div>
        </div>
    );
} 