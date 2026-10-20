'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MCP_URL = 'https://earnkit.com/mcp';

export type AgentName = 'Grok Bot' | 'Muse' | 'OpenClaw' | 'Claude Code' | 'Cursor' | 'Codex';

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
 * - openclaw.svg: OpenClaw's lobster mark from its official site, https://openclaw.ai/favicon.svg, the same paths;
 *   its gradient fill flattened to one color and the eyes dropped (the tab draws the mark in one color).
 *
 * Commands: Claude Code per https://code.claude.com/docs/en/mcp (--transport http, --scope user,
 * then /mcp to sign in); Codex per https://developers.openai.com/codex/mcp
 * (codex mcp add <name> --url <url>, then codex mcp login <name>); OpenClaw per https://docs.openclaw.ai/tools/mcp
 * (openclaw mcp add <name> --url <url> --transport streamable-http, then openclaw mcp login <name>).
 * The personal agents (Grok Bot, Muse, OpenClaw) lead; Instinct documents no way to add an MCP server, so it has no tab.
 * Launch-ready L1: Claude Code's line is user scope (EarnKit works in every folder). One-click links only where the
 * agent documents one: Cursor's MCP install deep link (Cursor docs, "Add to Cursor" links:
 * cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64 of the server's config>), shown first in
 * its tab. Claude Code, Codex, Grok Bot, Muse and OpenClaw document none, so none is made up.
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
    name: 'Muse',
    icon: '/images/agents/muse.svg',
    steps: [
      'Add a custom integration in Muse.',
      'Paste the EarnKit link and save.',
    ],
  },
  {
    name: 'OpenClaw',
    icon: '/images/agents/openclaw.svg',
    steps: ['Run this where OpenClaw runs:'],
    code: `openclaw mcp add earnkit --url ${MCP_URL} --transport streamable-http`,
    after: 'Then sign in:',
    afterCode: 'openclaw mcp login earnkit',
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
    install: `cursor://anysphere.cursor-deeplink/mcp/install?name=earnkit&config=${encodeURIComponent(btoa(JSON.stringify({ url: MCP_URL })))}`,
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
    after: 'Then sign in:',
    afterCode: 'codex mcp login earnkit',
  },
];

const COPY_PRIMARY =
  'inline-flex min-h-11 shrink-0 items-center rounded-full bg-ek-brand px-4 font-funnel-sans text-sm font-medium text-ek-text transition-colors hover:bg-ek-accent';
const COPY_SECONDARY =
  'inline-flex min-h-11 shrink-0 items-center rounded-full border border-ek-line-strong px-4 font-funnel-sans text-sm font-medium text-ek-text transition-colors hover:bg-ek-chip';
/** A flat block for a link or a command: the page's black inside the sheet, one hairline. */
const CODE_BOX = 'flex items-center gap-3 border border-ek-line bg-ek-page py-2 pl-4 pr-2';

function CopyButton({ text, label, primary = false }: { text: string; label: string; primary?: boolean }) {
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
      className={primary ? COPY_PRIMARY : COPY_SECONDARY}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Launch ready L10: no "no account" (the agent signs the builder in with X once). */
export const INTRO = 'Free. Your agent connects with this link:';

/** v2.7: the starting phrase, everywhere (spec Decisions). */
export const START_PROMPT = 'What can I earn?';

/**
 * The install path: the EarnKit link plus short steps for each agent, then what to ask: the
 * starting phrase, or a program's own ("What can I earn on Arc Microgrants?") from its card.
 * v3 Stage 3 (spec 5.8): a flat sheet on the surface colour with hairline tabs; a bottom sheet on a
 * phone (fixed to the bottom edge, scrolling inside), a centred sheet from sm. Every target is 44px;
 * focus rings come from the page's own :focus-visible rule.
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

  // Rendered on document.body: an ancestor with backdrop-filter (the sticky header's blur) would
  // otherwise become this fixed overlay's containing block and squeeze it into the header. The modal
  // only opens in the browser; a server render (tests) gets it inline.
  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-agent-title"
      className="fixed inset-0 z-[100] bg-ek-glass sm:flex sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="fixed inset-x-0 bottom-0 max-h-[90dvh] w-full overflow-y-auto border-t border-ek-line bg-ek-surface px-4 pb-8 pt-5 text-left sm:relative sm:inset-auto sm:max-w-lg sm:border sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-ek-muted transition-colors hover:bg-ek-chip hover:text-ek-text sm:right-5 sm:top-5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>

        <h2 id="add-to-agent-title" className="pr-12 font-funnel-display text-2xl font-medium tracking-[-0.02em] text-ek-text md:text-[2rem]">
          Add EarnKit to your agent
        </h2>
        <p className="mt-2 font-funnel-sans text-base text-ek-muted">{INTRO}</p>

        <div className={`${CODE_BOX} mt-5`}>
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-ek-text md:text-base">{MCP_URL}</code>
          <CopyButton text={MCP_URL} label="Copy the EarnKit link" primary />
        </div>

        <div role="tablist" aria-label="Your agent" className="mt-6 flex flex-wrap border-b border-ek-line">
          {AGENTS.map((a, i) => (
            <button
              key={a.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 font-funnel-sans text-sm font-medium transition-colors ${
                i === active ? 'border-ek-text text-ek-text' : 'border-transparent text-ek-muted hover:text-ek-text'
              }`}
            >
              {/* An SVG mark is drawn in white, dimmed with the tab; an app icon (PNG) keeps its colors. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.icon}
                alt=""
                width="20"
                height="20"
                className={`h-5 w-5 object-contain ${a.icon.endsWith('.png') ? 'rounded-[5px]' : 'brightness-0 invert'} ${i === active ? '' : 'opacity-60'}`}
              />
              {a.name}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="mt-5 font-funnel-sans text-base text-ek-body">
          {agent.install && (
            <a href={agent.install} className={`${COPY_PRIMARY} mb-4`}>
              Add to {agent.name}
            </a>
          )}
          {/* Launch ready L10: numbers only for two or more steps (never "1. Or add this"). */}
          {agent.steps.length > 1 ? (
            <ol className="list-decimal space-y-1.5 pl-5">
              {agent.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : (
            <p>{agent.steps[0]}</p>
          )}
          {agent.code && (
            <div className={`${CODE_BOX} mt-3 items-start`}>
              <pre className="min-w-0 flex-1 whitespace-pre-wrap py-2 font-mono text-sm text-ek-text">
                <Command text={agent.code} />
              </pre>
              <CopyButton text={agent.code} label={`Copy the ${agent.name} setup`} />
            </div>
          )}
          {agent.after && <p className="mt-3">{agent.after}</p>}
          {agent.afterCode && (
            <div className={`${CODE_BOX} mt-3 items-start`}>
              <pre className="min-w-0 flex-1 whitespace-pre-wrap py-2 font-mono text-sm text-ek-text">
                <Command text={agent.afterCode} />
              </pre>
              <CopyButton text={agent.afterCode} label={`Copy the ${agent.name} login`} />
            </div>
          )}
        </div>

        <p className="mt-6 border-t border-ek-line pt-5 font-funnel-sans text-base text-ek-text">
          Then ask your agent: <span className="text-ek-accent">&ldquo;{prompt}&rdquo;</span>
        </p>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

/**
 * A command or config that wraps only between words: a flag like --transport never splits at its hyphens. Lines
 * first (final fix I1): a multi-line block (Cursor's mcp.json) keeps its line breaks and indentation.
 */
export function Command({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, l) => (
        <span key={l}>
          {l > 0 && '\n'}
          {line.split(' ').map((word, i) => (
            <span key={i}>
              {i > 0 && ' '}
              <span className="whitespace-nowrap">{word}</span>
            </span>
          ))}
        </span>
      ))}
    </>
  );
}
