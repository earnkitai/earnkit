"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

const tabData = {
  "AI Assistant": {
    subtitle: "Drop the prompt into Claude Code, Cursor, or any AI coding tool. Your assistant has full context via earnkit.com/llms.txt and can wire up payments and buybacks in one shot.",
    type: "ai-prompt",
    prompt: `Read https://earnkit.com/llms.txt for context about EarnKit.\n\nProvide a brief overview of what EarnKit is and how it works. Keep your initial explanation concise (2-3 sentences).\n\nGiven what you know about my agent and token, help me integrate EarnKit, set up usage based pricing, and configure automated buybacks.`
  },
  "Quick Start": {
    subtitle: "Get up and running with just a few lines of code.",
    type: "code-block",
    code: (
      <code className="text-sm md:text-lg font-mono leading-relaxed">
        <span className="text-purple-400">import</span> {"{ "} 
        <span className="text-blue-300">EarnKit</span> {" } "} 
        <span className="text-purple-400">from</span> <span className="text-green-300">'@earnkit/sdk'</span>
        {"\n\n"}
        <span className="text-purple-400">const</span> earn = <span className="text-purple-400">new</span> <span className="text-blue-300">EarnKit</span>({"{"}
        {"\n  "}pricePerCall: <span className="text-green-300">'0.001'</span>,
        {"\n  "}token: <span className="text-green-300">'0xYourToken'</span>, <span className="text-gray-500">//optional</span> 
        {"\n  "}buybackPercent: <span className="text-orange-300">30</span>, <span className="text-gray-500">//optional</span> 
        {"\n"}{"}"})
        {"\n\n"}
        <span className="text-purple-400">await</span> earn.<span className="text-yellow-200">charge</span>(userId)
      </code>
    )
  },
} as const;

type TabKey = keyof typeof tabData;

export default function IntegrateInMinutesSection() {
  const [activeTab, setActiveTab] = useState<TabKey>("AI Assistant");
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Fixed SVG Icons with camelCase properties
  const CopyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy h-3.5 w-3.5"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
  );

  const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check h-3.5 w-3.5"><path d="M20 6L9 17l-5-5"></path></svg>
  );

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
            onClick={() => {
              setActiveTab(tab);
              setCopied(false);
            }}
            className={`text-lg md:text-2xl font-semibold px-2 transition-colors duration-200 ${
              activeTab === tab ? "text-color8 border-b-2 border-color8" : "text-color1 hover:text-color6"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-6xl px-4">
        {activeTab === "AI Assistant" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4 mb-4">
                {/* Logo Icons - Fixed fillRule and clipRule */}
                <div className="opacity-50 grayscale hover:grayscale-0 transition-all cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fillRule="nonzero"></path></svg>
                </div>
                <div className="opacity-50 grayscale hover:grayscale-0 transition-all cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="currentColor" className="h-7 w-7"><path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61-41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"></path></svg>
                </div>
                <div className="opacity-50 grayscale hover:grayscale-0 transition-all cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none" className="h-7 w-7"><path d="M60 10C30 10 15 35 15 55C15 75 30 95 45 100V110H55V100C55 100 60 102 65 100V110H75V100C90 95 105 75 105 55C105 35 90 10 60 10Z" fill="#888"></path><path d="M20 45C5 40 0 50 5 60C10 70 20 65 25 55C28 48 25 45 20 45Z" fill="#888"></path><path d="M100 45C115 40 120 50 115 60C110 70 100 65 95 55C92 48 95 45 100 45Z" fill="#888"></path><path d="M45 15Q35 5 30 8" stroke="#666" strokeWidth="4" strokeLinecap="round"></path><path d="M75 15Q85 5 90 8" stroke="#666" strokeWidth="4" strokeLinecap="round"></path><circle cx="45" cy="35" r="6" fill="#050810"></circle><circle cx="75" cy="35" r="6" fill="#050810"></circle><circle cx="46" cy="34" r="2.5" fill="#555"></circle><circle cx="76" cy="34" r="2.5" fill="#555"></circle></svg>
                </div>
                <div className="opacity-50 grayscale hover:grayscale-0 transition-all cursor-pointer">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className="h-7 w-7 text-white"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"></path></svg>
                </div>
                <div className="opacity-50 grayscale hover:grayscale-0 transition-all cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="3 3 34 34" fill="none" className="h-7 w-7 text-white"><path d="M37 20.034C27.8809 20.5837 20.5808 27.8809 20.0326 37H19.966C19.4163 27.8809 12.1177 20.5837 3 20.034V19.9674C12.1191 19.4163 19.4163 12.1191 19.966 3H20.0326C20.5822 12.1191 27.8809 19.4163 37 19.9674V20.034Z" fill="currentColor"></path></svg>
                </div>
              </div>
              <h3 className="text-3xl font-bold text-white font-funnel-display">Delegate confidently</h3>
              <p className="text-lg text-color7 leading-relaxed font-funnel-sans max-w-md">
                {tabData["AI Assistant"].subtitle}
              </p>
            </div>

            <div className="bg-[#1a1a1a]/80 backdrop-blur-md border border-white/10 rounded-3xl p-8 shadow-2xl relative">
              <div className="text-gray-300 font-funnel-sans text-sm md:text-base whitespace-pre-wrap leading-relaxed">
                {tabData["AI Assistant"].prompt}
              </div>
              <div className="mt-8 flex justify-end">
                <button 
                  onClick={() => handleCopy(tabData["AI Assistant"].prompt)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all border ${
                    copied 
                    ? "bg-green-500/20 border-green-500/50 text-green-400" 
                    : "bg-white/10 hover:bg-white/20 text-white border-white/10"
                  }`}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />} 
                  {copied ? "Copied!" : "Copy prompt"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
             <div className="w-full max-w-3xl bg-[#0d0d0d] rounded-3xl border border-color6 p-8 mb-8 overflow-x-auto">
                <pre className="font-mono text-sm md:text-lg">
                    {tabData["Quick Start"].code}
                </pre>
             </div>
             
             <div className="flex flex-wrap items-center justify-center gap-6">
                <Link href="https://docs.earnkit.com" className="inline-flex text-nowrap items-center justify-center gap-2 px-6 md:px-10 py-4 md:py-6 outline outline-2 bg-color6 outline-color6 border border-color6 rounded-full text-color3 text-xl md:text-2xl font-funnel-sans font-medium group transition hover:bg-color7 hover:border-color7 hover:outline-color7 hover:text-color3" target="_blank">
                    Read the Docs
                </Link>
                <div 
                    onClick={() => handleCopy("npm install @earnkit/sdk")}
                    className={`bg-color5 outline outline-2 border px-6 py-4 md:py-6 rounded-full flex items-center gap-3 cursor-pointer transition-all ${
                      copied 
                      ? "outline-green-500 border-green-500" 
                      : "outline-color6 border-color6 hover:border-color8 hover:outline-color8"
                    }`}
                >
                    <code className={copied ? "text-green-400" : "text-color8"}>
                      $ npm install @earnkit/sdk
                    </code>
                    <div className={copied ? "text-green-400" : "text-color1"}>
                      {copied ? <CheckIcon /> : <CopyIcon />}
                    </div>
                </div>
             </div>
          </div>
        )}
      </div>
    </section>
  );
}