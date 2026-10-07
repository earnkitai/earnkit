'use client';

import { useEffect, useRef, useState } from 'react';
import BonusPill from '../ui/BonusPill';

const MCP_URL = 'https://earnkit.com/mcp';

export type AgentName = 'Grok Bot' | 'Claude Code' | 'Cursor' | 'Codex' | 'Muse';

export type Agent = {
  name: AgentName;
  /** The tab's icon: a local SVG under public/ ("/images/agents/<file>.svg"), never fetched from elsewhere. */
  icon: string;
  /** One-click install deep link, when the agent supports one. */
  install?: string;
  steps: string[];
  code?: string;
  /** One line after the command (the approve step). */
  after?: string;
};

/**
 * v2.8 Ruling 18 (plan), Ruling C1: the install tabs, Grok Bot first. The editor tab and "Other agents"
 * are gone; the EarnKit link box above the tabs serves any other agent.
 *
 * Icon sources (each the maker's official brand or press kit, stored locally, single color):
 * - grok.svg: xAI brand guidelines, https://x.ai/legal/brand-guidelines
 *   (SpaceXAI_Grok_Assets.zip, Grok_Logomark_Dark.svg), unchanged.
 * - claude-code.svg: Anthropic press kit, https://www.anthropic.com/press-kit
 *   (Claude logos/3 Claude Spark/SVG/Claude Spark - Clay.svg), unchanged.
 * - cursor.svg: Cursor brand page, https://cursor.com/brand
 *   (cursor-brand-assets.zip, Cube/SVG/CUBE_2D_LIGHT.svg), the same path with its class style
 *   written as a fill attribute.
 * - codex.svg: OpenAI brand guidelines, https://openai.com/brand/
 *   (openai-logos.zip, OAI_OpenAI-Blossom_Black.svg), the same path with the viewBox cropped to
 *   the mark (the clear space is the tab's own padding at 20px).
 * - muse.svg: an EarnKit "M" monogram. Meta's brand center has no Muse mark, and its company logo
 *   needs Meta's approval, so no Meta mark is used.
 *
 * Commands: Claude Code per https://code.claude.com/docs/en/mcp (--transport http, --scope user,
 * then /mcp to sign in); Codex per https://developers.openai.com/codex/mcp
 * (codex mcp add <name> --url <url>, then codex mcp login <name>).
 */
export const AGENTS: Agent[] = [
  {
    name: 'Grok Bot',
    icon: '/images/agents/grok.svg',
    steps: [
      'Add an MCP connector in Grok Bot.',
      'Paste the EarnKit link and save.',
    ],
  },
  {
    name: 'Claude Code',
    icon: '/images/agents/claude-code.svg',
    steps: ['Run this in your terminal:'],
    code: `claude mcp add --transport http --scope user earnkit ${MCP_URL}`,
    after: 'Then type /mcp, pick earnkit, approve.',
  },
  {
    name: 'Cursor',
    icon: '/images/agents/cursor.svg',
    install: `cursor://anysphere.cursor-deeplink/mcp/install?name=earnkit&config=${btoa(JSON.stringify({ url: MCP_URL }))}`,
    steps: ['Or open Settings, then MCP, and add this to your config:'],
    code: JSON.stringify(
      { mcpServers: { earnkit: { url: MCP_URL } } },
      null,
      2,
    ),
  },
  {
    name: 'Codex',
    icon: '/images/agents/codex.svg',
    steps: ['Run this in your terminal:'],
    code: `codex mcp add earnkit --url ${MCP_URL}`,
    after: 'Then run codex mcp login earnkit and approve.',
  },
  {
    name: 'Muse',
    icon: '/images/agents/muse.svg',
    steps: [
      'Add a custom integration in Muse.',
      'Paste the EarnKit link and save.',
    ],
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

/** v2.7: the starting phrase, everywhere (spec Decisions). */
export const START_PROMPT = 'What can I earn?';

/**
 * The install path: the EarnKit link plus short steps for each agent, then what to ask: the
 * starting phrase, or a program's own ("What can I earn on Arc Microgrants?") from its card.
 */
export default function AddToAgent({ onClose, prompt = START_PROMPT }: { onClose: () => void; prompt?: string }) {
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
              className={`inline-flex items-center gap-2 rounded-full py-2 pl-3 pr-4 font-funnel-sans text-sm font-medium transition-colors ${
                i === active
                  ? 'bg-ek-blue-light text-ek-navy-deep'
                  : 'bg-ek-navy text-ek-blue-light hover:bg-ek-blue-strong'
              }`}
            >
              {/* One color per state: the mark is drawn dark on the light tab, light on the navy one. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.icon}
                alt=""
                width="20"
                height="20"
                className={`h-5 w-5 object-contain ${i === active ? 'brightness-0' : 'brightness-0 invert'}`}
              />
              {a.name}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          className="mt-5 font-funnel-sans text-base text-ek-blue-light"
        >
          {agent.install && (
            <a
              href={agent.install}
              className="mb-4 inline-flex rounded-full bg-ek-blue-bright px-5 py-2.5 font-medium text-ek-navy-deep transition-colors hover:bg-ek-blue-soft"
            >
              Add to {agent.name}
            </a>
          )}
          <ol className="list-decimal space-y-1.5 pl-5 font-light">
            {agent.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {agent.code && (
            <div className="mt-3 flex items-start gap-3 rounded-2xl bg-ek-black/60 py-2 pl-4 pr-2">
              <pre className="min-w-0 flex-1 whitespace-pre-wrap py-1.5 font-mono text-sm text-ek-white [overflow-wrap:anywhere]">
                {agent.code}
              </pre>
              <CopyButton
                text={agent.code}
                label={`Copy the ${agent.name} setup`}
              />
            </div>
          )}
          {agent.after && <p className="mt-3 font-light">{agent.after}</p>}
          {/* v2.8 Ruling 19 (plan): the builder bonus pill under the steps. */}
          <div className="mt-4">
            <BonusPill size="sm" />
          </div>
        </div>

        <p className="mt-7 border-t border-ek-navy pt-5 font-funnel-sans text-base text-ek-white">
          Then ask your agent:{' '}
          <span className="text-ek-blue-bright">
            &ldquo;{prompt}&rdquo;
          </span>
        </p>
      </div>
    </div>
  );
}
