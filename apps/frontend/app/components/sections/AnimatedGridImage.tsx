"use client";

import Image from "next/image";
import { motion } from "framer-motion";

export default function AnimatedGridImage() {
    return (
        <aside className="w-full h-[calc(100dvh-10vh)] md:min-h-screen md:w-1/2 relative rounded-[56px] overflow-hidden bg-black flex items-center justify-center">
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{
                    duration: 0.3,
                    ease: "easeOut",
                    type: "spring",
                    stiffness: 100
                }}
                style={{ willChange: "transform, opacity" }}
                className="w-[105%] h-[105%] absolute -top-[2.5%] -left-[2.5%] -bottom-[2.5%]"
            >
                <Image
                    src="/images/landing/grid5.png"
                    alt="grid image"
                    fill
                    className="w-[105%] h-[105%] object-cover"
                    priority
                    quality={100}
                />
            </motion.div>
        </aside>
    );
} 