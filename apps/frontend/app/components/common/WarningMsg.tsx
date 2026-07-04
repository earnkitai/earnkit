"use client";

import { useState } from "react";

export default function WarningMsg() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <div className="flex justify-center p-4">
      <div
        className="
          relative flex items-center gap-3 px-3 py-1.5
          rounded-full border border-[#2563e4] bg-[#1d263f]/80
          text-xs font-medium uppercase
        "
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563e4] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2563e4]"></span>
        </span>

        <span>
          <a
            href="https://clanker.world/clanker/0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07"
            className="underline font-bold underline-offset-2 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            MINI
          </a>{" "}
          is the only official token.
        </span>

        <button
          onClick={() => setIsVisible(false)}
          aria-label="Dismiss"
          className="ml-1 text-text-muted hover:text-text transition-colors leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
