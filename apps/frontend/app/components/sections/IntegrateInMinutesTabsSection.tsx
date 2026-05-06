"use client";
import { useState } from "react";
import Image from "next/image";
import { Icons } from "@/app/components/ui/Icons";

const tabData = {
  "AI Assistant": {
    subtitle: "Drop the prompt into Claude Code, Cursor, or any AI coding tool. Your assistant has full context via earnkit.com/llms.txt and can wire up payments and buybacks in one shot.",
    type: "ai-prompt",
    prompt: `Read https://earnkit.com/llms.txt for context about EarnKit.\n\nProvide a brief overview of what EarnKit is and how it works. Keep your initial explanation concise (2-3 sentences).\n\nGiven what you know about my agent and token, help me integrate EarnKit, set up usage based pricing, and configure automated buybacks.`
  },
  "Quick Start": {
    subtitle: "Get up and running with just a few lines of code.",
    type: "code-block",
    code: `import { EarnKit } from '@earnkit/sdk'\n\nconst earn = new EarnKit({\n  pricePerCall: '0.001',\n  token: '0xYourToken',\n  buybackPercent: 30,\n})\n\nawait earn.charge(userId)`
  },
} as const;

type TabKey = keyof typeof tabData;

export default function IntegrateInMinutesTabsSection() {
  const [activeTab, setActiveTab] = useState<TabKey>("AI Assistant");
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative w-full min-h-[900px] flex flex-col items-center justify-start py-24 md:py-32 px-6 md:px-0 overflow-hidden bg-color5 rounded-[56px] mt-10">
      {/* Background Decor */}
      <div className="absolute bottom-0 right-[50%] left-[50%] transform -translate-x-1/2 w-[80%] md:w-[40%] h-[80%] md:h-[70%] z-0 pointer-events-none select-none">
        <Image
          src="/images/landing/sectionbg.png"
          alt="section background"
          fill
          style={{ objectFit: 'contain', objectPosition: 'bottom right' }}
          priority
        />
      </div>
      <div className="absolute inset-0 w-full h-full z-0 bg-[url('/images/landing/grid.png')] bg-repeat opacity-20 pointer-events-none" style={{ backgroundSize: '50px 50px' }} />

      {/* Header */}
      <div className="relative z-10 text-center mb-16">
        <h2 className="text-4xl md:text-5xl font-funnel-display font-semibold text-color8 tracking-tight mb-4">
          Integrate in Minutes
        </h2>
        <p className="text-xl md:text-2xl text-color7 font-funnel-sans">
          Pick your path.
        </p>
      </div>

      {/* Tabs Switcher */}
      <div className="relative z-10 flex gap-8 mb-12">
        {(Object.keys(tabData) as TabKey[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-lg md:text-2xl font-semibold px-2 transition-colors duration-200 ${
              activeTab === tab ? "text-color8 border-b-2 border-color8" : "text-color1 hover:text-color6"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="relative z-10 w-full max-w-6xl px-4">
        {activeTab === "AI Assistant" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left Side: Text and Logos */}
            <div className="flex flex-col gap-6">
              <div className="flex gap-4 mb-4">
                {/* Placeholder icons for Claude, GPT, etc */}
                <div className="w-8 h-8 opacity-70 grayscale hover:grayscale-0 transition-all cursor-pointer"><Icons.imIcon1 /></div>
                <div className="w-8 h-8 opacity-70 grayscale hover:grayscale-0 transition-all cursor-pointer"><Icons.imIcon2 /></div>
                <div className="w-8 h-8 opacity-70 grayscale hover:grayscale-0 transition-all cursor-pointer"><Icons.imIcon3 /></div>
                <div className="w-8 h-8 opacity-70 grayscale hover:grayscale-0 transition-all cursor-pointer"><Icons.imIcon4 /></div>
              </div>
              <h3 className="text-3xl font-bold text-white font-funnel-display">Delegate confidently</h3>
              <p className="text-lg text-color7 leading-relaxed font-funnel-sans max-w-md">
                {tabData["AI Assistant"].subtitle}
              </p>
            </div>

            {/* Right Side: Prompt Card (Ref: image_b56977.png) */}
            <div className="bg-[#1a1a1a]/80 backdrop-blur-md border border-white/10 rounded-3xl p-8 shadow-2xl relative">
              <div className="text-gray-300 font-funnel-sans text-sm md:text-base whitespace-pre-wrap leading-relaxed">
                {tabData["AI Assistant"].prompt}
              </div>
              <div className="mt-8 flex justify-end">
                <button 
                  onClick={() => handleCopy(tabData["AI Assistant"].prompt)}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl transition-all border border-white/10"
                >
                  <Icons.citIcon4 className="w-4 h-4" /> 
                  {copied ? "Copied!" : "Copy prompt"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
             <div className="w-full max-w-3xl bg-[#0d0d0d] rounded-3xl border border-color6 p-8 mb-8">
                <pre className="text-green-400 font-mono text-sm md:text-lg overflow-x-auto">
                    <code>{tabData["Quick Start"].code}</code>
                </pre>
             </div>
             
             <div className="flex flex-wrap items-center justify-center gap-6">
                <button className="bg-white text-black font-bold px-8 py-4 rounded-full hover:bg-gray-200 transition-all">
                    Read the Docs
                </button>
                <div 
                    onClick={() => handleCopy("npm install @earnkit/sdk")}
                    className="bg-color5 border border-color6 px-6 py-4 rounded-full flex items-center gap-3 cursor-pointer hover:border-color8 transition-all"
                >
                    <code className="text-color8">$ npm install @earnkit/sdk</code>
                    <Icons.citIcon4 className="w-4 h-4 text-color1" />
                </div>
             </div>
          </div>
        )}
      </div>
    </section>
  );
}