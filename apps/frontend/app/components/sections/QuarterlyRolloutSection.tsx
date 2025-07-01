"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icons } from "@/app/components/ui/Icons";
import Link from "next/link";

const quarters = [
    {
        key: "q1",
        label: "Live Now",
        heading: "EarnKit SDK (fee engine + smart wallet billing)",
        subheading: "Developers building agents",
        status: <span className="text-[#7CA6FF]">Now active for funds and protocol teams.</span>,
    },
    {
        key: "q2",
        label: "Q2 2025",
        heading: "Analytics",
        subheading: "Developers & teams",
        status: <span className="italic text-[#7CA6FF]">Built for active traders and allocators.</span>,
    },
    {
        key: "q3",
        label: "Q3 2025",
        heading: "Agent templates",
        subheading: "Builders & creators",
        status: <span className="italic text-[#7CA6FF]">Perfect for creators, power users, and builders on Farcaster.</span>,
    },
    {
        key: "q4",
        label: "Late Q4 2025",
        heading: "Public launch",
        subheading: "Waitlist only",
        status: <span className="italic text-[#7CA6FF]">Waitlist unlocks the gate.</span>,
    },
];

// const bgCircleVariants = {
//     initial: (dir: number) => ({
//         opacity: 0,
//         y: dir > 0 ? 40 : -40,
//         scale: 0.95,
//     }),
//     animate: {
//         opacity: 1,
//         y: 0,
//         scale: 1,
//         transition: { duration: 0.7, type: "spring" },
//     },
//     exit: (dir: number) => ({
//         opacity: 0,
//         y: dir > 0 ? -40 : 40,
//         scale: 0.95,
//         transition: { duration: 0.5 },
//     }),
// };

const contentVariants = {
    initial: (dir: number) => ({
        opacity: 0,
        y: dir > 0 ? 60 : -60,
    }),
    animate: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, type: "spring" },
    },
    exit: (dir: number) => ({
        opacity: 0,
        y: dir > 0 ? -60 : 60,
        transition: { duration: 0.4 },
    }),
};

export default function QuarterlyRolloutSection() {
    const [selected, setSelected] = useState(0);
    const [direction, setDirection] = useState(0); // 1 for forward, -1 for backward

    const handleSelect = (idx: number) => {
        if (idx === selected) return;
        setDirection(idx > selected ? 1 : -1);
        setSelected(idx);
    };

    useEffect(() => {
        console.log(selected)
    }, [selected]);

    return (
        <section className="w-full min-h-[700px] flex flex-col md:flex-row items-stretch justify-center bg-transparent rounded-[56px] overflow-hidden mt-10">
            {/* Left Side */}
            <aside className="h-[90vh] md:h-full w-full md:w-1/2 bg-color5 flex flex-col justify-center items-center relative p-6 md:p-6 overflow-hidden rounded-[56px]">
                {/* Animated background circles */}

                <div
                    key={quarters[selected].key + "-bg"}
                    className="absolute -left-[50%] bottom-0 w-[200%] h-[200%] z-0 pointer-events-none"
                >
                    <svg width="100%" height="100%" viewBox="0 0 800 800" className="w-full h-full ">

                        {selected >= 0 && [0, 1, 2, 3].map((i) => (
                            <circle
                                key={i}
                                cx="400"
                                cy="400"
                                r={70 * (i + 1)}
                                fill={selected >= i ? "rgba(19,30,73,1)" : "none"}
                                stroke="rgba(17, 41, 105, 1)"
                                strokeWidth="1"
                                style={{ opacity: 0.5, mixBlendMode: "color-dodge" }}
                            />
                        ))}
                    </svg>
                </div>

                {/* Animated content */}
                <div className="relative z-10 w-full h-full mx-auto flex flex-col items-center justify-center md:pt-24">
                    <AnimatePresence mode="wait" custom={direction}>
                        <motion.div
                            key={quarters[selected].key + "-content"}
                            custom={direction}
                            variants={contentVariants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="self-start ml-10 md:ml-20 w-[95%] md:w-[70%] flex-1 md:min-h-[350px] flex flex-col justify-end mb-8 md:mb-20 mt-10"
                        >
                            <h2 className="w-[80%] text-color8 font-funnel-sans text-3xl md:text-[2.3rem] 2xl:text-[3.3rem] font-medium mb-6 leading-tight">
                                {quarters[selected].heading}
                            </h2>
                            <p className="w-[80%] text-color6 font-funnel-sans text-lg md:text-xl my-2">
                                {quarters[selected].subheading}
                            </p>
                            {/* <div className="w-[80%] text-color6 font-funnel-sans italic text-lg mb-4 md:mb-10 mt-4">
                                {quarters[selected].status}
                            </div> */}
                        </motion.div>
                    </AnimatePresence>
                    <div className="grid grid-cols-2 gap-[1rem] w-full mt-12 ">
                        {quarters.map((q, idx) => (
                            <button
                                key={q.key}
                                onClick={() => handleSelect(idx)}
                                className={`rounded-full px-4 md:px-8 py-8 md:py-12 text-xl font-funnel-sans font-semibold transition-all duration-300 flex items-center justify-center focus:outline-none ${selected === idx
                                    ? "bg-color8 text-color3 shadow-lg"
                                    : "bg-color4 text-color7 hover:bg-color2"
                                    }`}
                            >
                                {q.label}
                                {selected === idx && idx === 0 && (
                                    <span className="ml-2 w-2 h-2 bg-green-400 rounded-full inline-block animate-pulse" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
                {/* Pills */}

            </aside>
            {/* Right Side */}
            <aside className="w-full h-[90vh] md:h-auto md:w-1/2 bg-color2 flex flex-col justify-between items-start rounded-[56px] p-14 md:p-28">
                <div className="flex-1 flex flex-col justify-start">
                    <h2 className="text-color8 font-funnel-display text-4xl md:text-[3.2rem] font-semibold mb-8 leading-tight">
                        We&apos;re Shipping Fast. <br />Join Early.
                    </h2>
                </div>
                <div className="w-full flex flex-col items-start mt-auto">
                    <span className="w-full md:w-[65%] text-color8 font-funnel-sans text-xl font-semibold mb-6">Want to be among the first to start earning from your agent?</span>
                    <Link
                        href="https://form.typeform.com/to/TaK4Xs1E"
                        target="_blank"
                        className="inline-flex items-center max-w-max justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 outline-color7 border border-transparent rounded-full text-color7 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:border-color8 hover:outline-color8 hover:text-color8"
                    >

                        {/* Replace with your sparkle/star icon */}
                        <Icons.sparkleIcon className="w-6 h-6 transition group-hover:text-color8 text-color7" />

                        Join the Waitlist
                    </Link>
                </div>
            </aside>
        </section>
    );
} 