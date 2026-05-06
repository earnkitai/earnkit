"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

export default function ParallaxBuildingImage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start end", "end start"]
    });

    const y = useTransform(scrollYProgress, [0, 1], ["0%", "10%"]);

    return (
        <div ref={containerRef} className="w-[120%] h-[120%] absolute -top-20 left-0 overflow-hidden">
            <motion.div
                style={{ y }}
                className="w-full h-full"
            >
                <Image
                    src="/images/landing/group6.jpg"
                    alt="building image"
                    fill
                    className="object-cover"
                    priority
                />
            </motion.div>
        </div>
    );
} 