"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// const quarters = [
//     {
//         key: "q1",
//         label: "Live Now",
//         heading: "EarnKit SDK (fee engine + smart wallet billing)",
//         subheading: "Developers building agents",
//         status: <span className="text-[#7CA6FF]">Now active for funds and protocol teams.</span>,
//     },
//     {
//         key: "q2",
//         label: "Q2 2025",
//         heading: "Analytics",
//         subheading: "Developers & teams",
//         status: <span className="italic text-[#7CA6FF]">Built for active traders and allocators.</span>,
//     },
//     {
//         key: "q3",
//         label: "Q3 2025",
//         heading: "Agent templates",
//         subheading: "Builders & creators",
//         status: <span className="italic text-[#7CA6FF]">Perfect for creators, power users, and builders on Farcaster.</span>,
//     },
//     {
//         key: "q4",
//         label: "Late Q4 2025",
//         heading: "Public launch",
//         subheading: "Waitlist only",
//         status: <span className="italic text-[#7CA6FF]">Waitlist unlocks the gate.</span>,
//     },
// ];

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

// const contentVariants = {
//     initial: (dir: number) => ({
//         opacity: 0,
//         y: dir > 0 ? 60 : -60,
//     }),
//     animate: {
//         opacity: 1,
//         y: 0,
//         transition: { duration: 0.5, type: "spring" },
//     },
//     exit: (dir: number) => ({
//         opacity: 0,
//         y: dir > 0 ? -60 : 60,
//         transition: { duration: 0.4 },
//     }),
// };

const PaymentFlow: React.FC = () => {
  return (
    <div className="w-full max-w-2xl text-center">
      {/* Top Payment */}
      <div className="bg-color3 text-white py-4 px-6 rounded-2xl text-lg font-semibold">
        $100 Payment
      </div>

      {/* Split Arrow */}
<div className="flex flex-col items-center my-6">
  {/* Vertical line */}
  <div className="w-px h-6 bg-white/80" />

  {/* Horizontal split */}
  <div className="w-full flex justify-between items-center">
    <div className="h-px bg-white/80 flex-1" />
    <div className="h-px bg-white/80 flex-1" />
  </div>

  {/* Down lines to each box */}
  <div className="w-full max-w-xl flex justify-between mt-0">
    {[0, 1, 2].map((_, i) => (
      <div key={i} className="flex flex-col items-center">
        {/* vertical line */}
        <div className="w-px h-6 bg-white/80 relative">
          {/* arrowhead */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
            <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-white/90" />
          </div>
        </div>
      </div>
    ))}
  </div>
</div>

      {/* Split Boxes */}
      <div className="w-full grid grid-cols-3 gap-6">
        <div className="rounded-2xl p-4 bg-color6 text-white">
          <div className="text-xl font-bold">$5</div>
          <div className="text-sm opacity-80">EarnKit Fee</div>
        </div>

        <div className="rounded-2xl p-4 bg-color6 text-white">
          <div className="text-xl font-bold">$10</div>
          <div className="text-sm opacity-80">Token Buyback</div>
        </div>

        <div className="rounded-2xl p-4 bg-color6 text-white">
          <div className="text-xl font-bold">$85</div>
          <div className="text-sm opacity-80">Your Wallet</div>
        </div>
      </div>

      {/* Caption */}
      <p className="mt-6 text-sm text-blue-200">
        Example: 10% buyback configured. You set the split.
      </p>
    </div>
  );
};


export default function BuybackDedicatedSection() {
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
        <section className="w-full flex flex-col md:flex-row items-stretch justify-center bg-transparent rounded-[56px] overflow-hidden mt-10">
            {/* Left Side */}
            <aside className="h-[90vh] md:h-[90vh] w-full md:w-1/2 bg-color5 flex flex-col justify-center items-center relative p-6 md:p-6 overflow-hidden rounded-[56px]">
                {/* Animated background circles */}

                <div
                    className="absolute -left-[50%] w-[200%] h-[200%] z-0 pointer-events-none"
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
                            custom={direction}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="self-start ml-10 md:ml-20 w-[95%] md:w-[70%] flex-1 md:min-h-[350px] flex flex-col justify-end mb-8 md:mb-20 mt-10"
                        >
                            <h2 className="w-[80%] text-color8 font-funnel-sans text-3xl md:text-[3rem] 2xl:text-[3.3rem] font-medium mb-6 leading-tight">
                                Your token, <br/> doing real work.
                            </h2>
                            <p className="w-[80%] text-color6 text-left font-funnel-sans text-lg md:text-xl my-2">
                                 EarnKit makes tokens part of the business
model. Every payment your agent earns can buy back your token automatically, tying token
economics directly to product usage. You set the percentage. EarnKit handles the routing.
No token? No problem. The buyback is optional. EarnKit works as a usage-based payments SDK
without it.
                            </p>
                            {/* <div className="w-[80%] text-color6 font-funnel-sans italic text-lg mb-4 md:mb-10 mt-4">
                                {quarters[selected].status}
                            </div> */}
                        </motion.div>
                    </AnimatePresence>
                    {/* <div className="grid grid-cols-2 gap-[1rem] w-full mt-12 ">
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
                    </div> */}
                </div>
                {/* Pills */}

            </aside>
            {/* Right Side */}
            <aside className="w-full h-[90vh] md:h-[90vh] md:w-1/2 bg-color2 flex flex-col justify-center items-start rounded-[56px] p-14 px-10 md:p-28">
     <PaymentFlow />
                {
                /* <div className="flex-1 flex flex-col justify-start">
                    <h2 className="text-color8 font-funnel-display text-4xl md:text-[3.2rem] font-semibold mb-8 leading-tight">
                        We&apos;re Shipping Fast. <br />Join Early.
                    </h2>
                </div> */}
            </aside>
        </section>
    );
} 