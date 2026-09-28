'use client';

import { useEffect, useRef, useState } from 'react';

const MCP_URL = 'https://earnkit.com/mcp';

type Agent = {
  name: string;
  steps: string[];
  code?: string;
};

const AGENTS: Agent[] = [
  {
    name: 'Grok Bot',
    steps: [
      'Add an MCP connector in Grok Bot.',
      'Paste the EarnKit link and save.',
    ],
  },
  {
    name: 'Muse',
    steps: [
      'Add a custom integration in Muse.',
      'Paste the EarnKit link and save.',
    ],
  },
  {
    name: 'Claude Code',
    steps: ['Run this in your terminal:'],
    code: `claude mcp add --transport http earnkit ${MCP_URL}`,
  },
  {
    name: 'Cursor',
    steps: ['Open Settings, then MCP, and add this to your config:'],
    code: JSON.stringify(
      { mcpServers: { earnkit: { url: MCP_URL } } },
      null,
      2,
    ),
  },
  {
    name: 'Other agents',
    steps: [
      'Paste the EarnKit link wherever your agent adds MCP servers or connectors.',
      'If it only runs local servers, use:',
    ],
    code: `npx -y mcp-remote ${MCP_URL}`,
  },
];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={label}
      className="flex-shrink-0 rounded-full bg-ek-blue-bright px-4 py-2 font-funnel-sans text-sm font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** The install path: the EarnKit link plus short steps for each agent. */
export default function AddToAgent({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const agent = AGENTS[active];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-agent-title"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ek-black/85 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[32px] bg-ek-navy-deep p-6 text-left md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-ek-navy text-ek-blue-light transition-colors hover:bg-ek-blue-strong hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>

        <h2
          id="add-to-agent-title"
          className="pr-12 font-funnel-display text-2xl font-medium text-ek-white md:text-3xl"
        >
          Add EarnKit to your agent
        </h2>
        <p className="mt-2 font-funnel-sans text-base font-light text-ek-blue-soft">
          Free, no account. Your agent connects with this link:
        </p>

        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-ek-black/60 py-2 pl-4 pr-2">
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-ek-white md:text-base">
            {MCP_URL}
          </code>
          <CopyButton text={MCP_URL} label="Copy the EarnKit link" />
        </div>

        <div
          role="tablist"
          aria-label="Your agent"
          className="mt-7 flex flex-wrap gap-2"
        >
          {AGENTS.map((a, i) => (
            <button
              key={a.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`rounded-full px-4 py-2 font-funnel-sans text-sm font-medium transition-colors ${
                i === active
                  ? 'bg-ek-blue-light text-ek-navy-deep'
                  : 'bg-ek-navy text-ek-blue-light hover:bg-ek-blue-strong'
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          className="mt-5 font-funnel-sans text-base text-ek-blue-light"
        >
          <ol className="list-decimal space-y-1.5 pl-5 font-light">
            {agent.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {agent.code && (
            <div className="mt-3 flex items-start gap-3 rounded-2xl bg-ek-black/60 py-2 pl-4 pr-2">
              <pre className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-sm text-ek-white">
                {agent.code}
              </pre>
              <CopyButton
                text={agent.code}
                label={`Copy the ${agent.name} setup`}
              />
            </div>
          )}
        </div>

        <p className="mt-7 border-t border-ek-navy pt-5 font-funnel-sans text-base text-ek-white">
          Then ask your agent:{' '}
          <span className="text-ek-blue-bright">
            &ldquo;Anything worth building?&rdquo;
          </span>
        </p>
      </div>
    </div>
  );
}
