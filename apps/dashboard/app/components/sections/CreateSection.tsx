'use client';

import { useState } from 'react';
import { FieldLabel } from '../ui/FieldBits';

type FlowType = 'token' | 'splits' | 'safe';
type TokenSubTab = 'Tokens' | 'Clanker' | 'Doppler';

const TABS = [
  { name: 'Tokens', image: '/images/landing/token_logo.png' },
  { name: 'Clanker', image: '/images/landing/clanker-logo.png' },
  { name: 'Doppler', image: '/images/landing/doppler.svg' },
] as const;

const FLOW_OPTIONS = [
  {
    id: 'token' as FlowType,
    title: <>Token</>,
    subtitle:
      'Add your existing token and we handle everything else for the buyback.',
    image: '/images/landing/token.png',
    imgtitle: 'Token',
  },
  {
    id: 'splits' as FlowType,
    title: (
      <img
        src="/images/landing/splits_full_logo.svg"
        className="h-[26px] brightness-0 invert-0"
      />
    ),
    subtitle:
      'Add your existing splits contract and we handle everything else for the buyback.',
    image: '/images/landing/splits.jpg',
    imgtitle: 'Splits',
  },
  {
    id: 'safe' as FlowType,
    title: (
      <img
        src="/images/landing/safe-logo-wallet.svg"
        className="h-[26px] brightness-0 invert-0"
      />
    ),
    subtitle:
      'Add your existing safe contract and we handle everything else for the buyback.',
    image: '/images/landing/safe.jpg',
    imgtitle: 'Safe',
    disabled: true,
  },
];

export default function CreateSection() {
  const [activeSection, setActiveSection] = useState<'none' | 'form'>('none');
  const [flowType, setFlowType] = useState<FlowType>('token');
  const [tokenTab, setTokenTab] = useState<TokenSubTab>('Tokens');

  // Splits Form State
  const [splitsAddress, setSplitsAddress] = useState('');
  const [targetToken, setTargetToken] = useState('');
  const [threshold, setThreshold] = useState('');
  const [slippage, setSlippage] = useState('');

  const currentFlow =
    FLOW_OPTIONS.find((opt) => opt.id === flowType) || FLOW_OPTIONS[0];

  return (
    <header className="flex-1 flex flex-col font-funnel-display items-center bg-background overflow-y-auto relative">
      <div className="w-full justify-center">
        {activeSection === 'none' ? (
          <div className="w-full flex flex-col items-center pb-20">
            {/* Hero Section - Preserved original UI exactly */}
            <div className="relative overflow-hidden backdrop-blur-lg h-[40vh] w-full flex justify-center items-center">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `
                linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 1) 90%),
                radial-gradient(circle, #d1d5db 1px, transparent 1px)
                `,
                  backgroundSize: '100% 100%, 15px 15px',
                }}
              />
              <div className="relative z-10 mt-28 w-full text-center">
                <h1 className="text-4xl sm:text-5xl md:text-6xl text-foreground">
                  Create Token Buyback
                </h1>
                <p className="my-5 md:my-6 px-1 text-sm md:text-lg text-muted-foreground">
                  Select the type of buyback integration.
                </p>
              </div>
            </div>

            {/* Selection Cards - Preserved original card UI structure */}
            <div className="w-full max-w-6xl mx-auto px-4 md:px-8 mt-4 relative md:z-20">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {FLOW_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (!option.disabled) {
                        setFlowType(option.id);
                        setActiveSection('form');
                      }
                    }}
                    disabled={option.disabled}
                    className={`group relative flex flex-col items-center text-center gap-4 pt-10 pb-8 rounded-[3rem] select-none border border-border transition-all duration-300 ${
                      option.disabled
                        ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                        : 'bg-gray-50 hover:border-gray-400 cursor-pointer'
                    }`}
                  >
                    <div className="w-16 h-16 flex items-center justify-center rounded-3xl bg-background border overflow-hidden">
                      {/* Using standard img tag as in original code to avoid Next/Image config issues */}
                      <img
                        src={option.image}
                        alt={option.imgtitle}
                        className="w-8 h-8 object-contain"
                      />
                    </div>
                    <div className="max-w-[280px]">
                      <h4 className="font-bold text-xl text-foreground transition-colors flex items-center justify-center gap-2">
                        {option.title}
                      </h4>
                      <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                        {option.subtitle}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-6xl mx-auto flex flex-col items-center px-4 sm:px-8 py-20">
            {/* Main Form Content*/}
            <main className="flex-1 max-w-2xl bg-background md:bg-background md:border md:border-border rounded-[4rem] p-6 md:p-10 w-full md:shadow-sm">
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                {/* Dynamic Header matching selected card */}
                <div className="mb-8 flex items-center gap-4 pb-4">
                  {/* <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center rounded-3xl bg-background border border-border overflow-hidden">
                    back
                  </div> */}
                  <div>
                    <h2 className="text-3xl font-bold mb-2 text-foreground">
                      {currentFlow.title}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {currentFlow.subtitle}
                    </p>
                  </div>
                </div>

                {/* Token Flow Content */}
                {flowType === 'token' && (
                  <div className="space-y-6">
                    <div className="space-y-1.5 outline-none rounded-xl p-1 -m-1 transition-all">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {TABS.map((tab) => (
                          <button
                            key={tab.name}
                            onClick={() => setTokenTab(tab.name)}
                            className={`group relative h-[100px] w-full flex flex-col items-center justify-center text-center gap-2 rounded-[2rem] select-none border-2 transition-all duration-300 ${
                              tokenTab === tab.name
                                ? 'bg-[#34C759]/10 border-primary text-primary'
                                : 'bg-gray-100 border-border text-muted-foreground'
                            }`}
                          >
                            <img
                              src={tab.image}
                              alt={tab.name}
                              className={`h-4 brightness-0 invert-0 object-contain`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-8 mt-4 border-2 border-dashed border-border rounded-3xl bg-gray-100/30 flex items-center justify-center min-h-[200px]">
                      <p className="text-muted-foreground">
                        Flow for {tokenTab}
                      </p>
                    </div>
                  </div>
                )}

                {/* Splits Flow Content - Uses original form input styling */}
                {flowType === 'splits' && (
                  <div className="space-y-6">
                    <div className="space-y-1.5">
                      <FieldLabel label="Owner Wallet Address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={splitsAddress}
                        onChange={(e) => setSplitsAddress(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground transition-all"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        The Safe that controls your split.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Existing split address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={splitsAddress}
                        onChange={(e) => setSplitsAddress(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground transition-all"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        The 0xSplits V2 contract already deployed on Base.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Token to buy back & burn" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={targetToken}
                        onChange={(e) => setTargetToken(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground transition-all"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        ERC-20 on Base. Revenue is swapped into this token and
                        burned.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Recovery address" required />
                      <input
                        type="text"
                        placeholder="0x..."
                        value={targetToken}
                        onChange={(e) => setTargetToken(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground transition-all"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Emergency sweep destination — your own EOA.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Your email" required />
                      <input
                        type="text"
                        placeholder="you@example.com"
                        value={targetToken}
                        onChange={(e) => setTargetToken(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground transition-all"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Becomes the root authenticator on your Turnkey sub-org.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <FieldLabel label="Trigger threshold (USD)" required />
                      <input
                        type="number"
                        placeholder="0.5"
                        value={threshold}
                        onChange={(e) => setThreshold(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 border border-border rounded-2xl focus:ring-1 focus:ring-primary outline-none text-sm text-foreground transition-all"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Minimum accumulated value before a buyback executes.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <button className="w-full mt-10 py-4 text-xl bg-primary text-background rounded-full font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all">
                Setup Buyback
              </button>

              {/* Form Footer / Navigation - Preserved from original */}
              <div className="flex justify-between items-center mt-6 pt-6 border-t border-border">
                <button
                  onClick={() => setActiveSection('none')}
                  className="flex items-center gap-2 text-foreground hover:text-primary transition-colors text-sm font-medium px-4 py-2 -ml-4 cursor-pointer"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  Back
                </button>
              </div>
            </main>
          </div>
        )}
      </div>
    </header>
  );
}
