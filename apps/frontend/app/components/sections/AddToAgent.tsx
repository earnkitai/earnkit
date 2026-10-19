'use client';

import { useEffect, useRef, useState } from 'react';

const MCP_URL = 'https://earnkit.com/mcp';

export type AgentName = 'Grok Bot' | 'Claude Code' | 'Cursor' | 'Codex' | 'Muse';

export type Agent = {
  name: AgentName;
  /**
   * The tab's icon, a local file under public/ ("/images/agents/<file>.svg|png"), never fetched from
   * elsewhere. An SVG mark is drawn in one color (the tab's); a PNG is the app's own icon, in color.
   */
  icon: string;
  /** One-click install deep link, when the agent supports one. */
  install?: string;
  steps: string[];
  code?: string;
  /** One line after the command (the approve step). */
  after?: string;
  /** A command inside `after` the builder runs too, shown with its own Copy button. */
  afterCode?: string;
};

/**
 * v2.8 Ruling 18 (plan), Ruling C1: the install tabs, Grok Bot first. The editor tab and "Other agents"
 * are gone; the EarnKit link box above the tabs serves any other agent.
 *
 * Icon sources (each the maker's own, stored locally; SVG marks drawn in one color):
 * - grok-bot.png: Grok Bot's own app icon (the macOS app by SpaceXAI, "Copyright © 2026 SpaceXAI"),
 *   dist/renderer/assets/app-icon-*.png inside Grok Bot.app's app.asar (the same art as its
 *   icon.icns), scaled from 256px to 64px. Grok Bot is not Grok: Grok's logomark is not used.
 * - claude-code.svg: Anthropic press kit, https://www.anthropic.com/press-kit
 *   (Claude logos/3 Claude Spark/SVG/Claude Spark - Clay.svg), unchanged.
 * - cursor.svg: Cursor brand page, https://cursor.com/brand
 *   (cursor-brand-assets.zip, Cube/SVG/CUBE_2D_LIGHT.svg), the same path with its class style
 *   written as a fill attribute.
 * - codex.svg: OpenAI brand guidelines, https://openai.com/brand/
 *   (openai-logos.zip, OAI_OpenAI-Blossom_Black.svg), the same path with the viewBox cropped to
 *   the mark (the clear space is the tab's own padding at 20px).
 * - muse.svg: Muse's logo from its official site, https://muse.ai/images/landing/brand/muse-logo.svg
 *   (muse.ai is the site Meta's announcement names: https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/),
 *   the same path; its blue gradient fill is flattened to its middle stop (#0064E0), since the
 *   logo checks refuse url() and the tab draws the mark in one color anyway.
 *
 * Commands: Claude Code per https://code.claude.com/docs/en/mcp (--transport http, --scope user,
 * then /mcp to sign in); Codex per https://developers.openai.com/codex/mcp
 * (codex mcp add <name> --url <url>, then codex mcp login <name>).
 */
export const AGENTS: Agent[] = [
  {
    name: 'Grok Bot',
    icon: '/images/agents/grok-bot.png',
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
    after: 'Then open Claude Code, type /mcp, pick earnkit, choose Authenticate.',
  },
  {
    name: 'Cursor',
    icon: '/images/agents/cursor.svg',
    install: `cursor://anysphere.cursor-deeplink/mcp/install?name=earnkit&config=${btoa(JSON.stringify({ url: MCP_URL }))}`,
    steps: ['Or add this to ~/.cursor/mcp.json:'],
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
    after: 'Then run codex mcp login earnkit.',
    afterCode: 'codex mcp login earnkit',
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
      className="flex-shrink-0 rounded-full bg-ek-blue-bright px-4 py-2 font-funnel-sans text-sm font-medium text-ek-page transition-colors hover:bg-ek-blue-soft"
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
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ek-page/85 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[24px] border border-ek-line bg-gradient-to-b from-ek-surface-top to-ek-surface p-6 text-left md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-ek-raised text-ek-text transition-colors hover:bg-ek-chip-hover"
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
          className="pr-12 font-funnel-display text-2xl font-medium text-ek-text md:text-3xl"
        >
          Add EarnKit to your agent
        </h2>
        <p className="mt-2 font-funnel-sans text-base text-ek-muted">
          Free, no account. Your agent connects with this link:
        </p>

        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-ek-page/70 py-2 pl-4 pr-2">
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-ek-text md:text-base">
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
                  ? 'bg-ek-text text-ek-page'
                  : 'bg-ek-chip text-ek-body hover:bg-ek-chip-hover'
              }`}
            >
              {/* One color per state: an SVG mark is drawn dark on the light tab, light on the navy one; an app icon (PNG) keeps its colors. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.icon}
                alt=""
                width="20"
                height="20"
                className={`h-5 w-5 object-contain ${
                  a.icon.endsWith('.png') ? 'rounded-[5px]' : i === active ? 'brightness-0' : 'brightness-0 invert'
                }`}
              />
              {a.name}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          className="mt-5 font-funnel-sans text-base text-ek-body"
        >
          {agent.install && (
            <a
              href={agent.install}
              className="mb-4 inline-flex rounded-full bg-ek-blue-bright px-5 py-2.5 font-medium text-ek-page transition-colors hover:bg-ek-blue-soft"
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
            <div className="mt-3 flex items-start gap-3 rounded-2xl bg-ek-page/70 py-2 pl-4 pr-2">
              <pre className="min-w-0 flex-1 whitespace-pre-wrap py-1.5 font-mono text-sm text-ek-text">
                {agent.code}
              </pre>
              <CopyButton
                text={agent.code}
                label={`Copy the ${agent.name} setup`}
              />
            </div>
          )}
          {agent.after && <p className="mt-3 font-light">{agent.after}</p>}
          {agent.afterCode && (
            <div className="mt-3 flex items-start gap-3 rounded-2xl bg-ek-page/70 py-2 pl-4 pr-2">
              <pre className="min-w-0 flex-1 whitespace-pre-wrap py-1.5 font-mono text-sm text-ek-text">
                {agent.afterCode}
              </pre>
              <CopyButton text={agent.afterCode} label={`Copy the ${agent.name} login`} />
            </div>
          )}
        </div>

        <p className="mt-7 border-t border-ek-line pt-5 font-funnel-sans text-base text-ek-text">
          Then ask your agent:{' '}
          <span className="text-ek-accent">
            &ldquo;{prompt}&rdquo;
          </span>
        </p>
      </div>
    </div>
  );
}
