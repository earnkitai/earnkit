'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AGENTS, CONNECTOR_LINE, Command, MCP_URL, tabKeyTarget } from './agents';
import { segRail, segTab } from '../site/SegTabs';

export { AGENTS, Command };
export type { Agent, AgentName } from './agents';


const COPY_PRIMARY =
  'inline-flex min-h-11 shrink-0 items-center rounded-full bg-s-blue px-4 text-sm font-semibold text-s-on-blue motion-safe:transition-colors duration-200 hover:bg-s-blue-top';
const COPY_SECONDARY =
  'inline-flex min-h-11 shrink-0 items-center rounded-full border border-s-line-hover px-4 text-sm font-semibold text-s-text motion-safe:transition-colors duration-200 hover:bg-s-panel-inner';
/** A block for a link or a command: the page colour inside the sheet, rounded 22px (v3.1). */
const CODE_BOX = 'flex items-center gap-3 rounded-[22px] bg-s-page py-2 pl-4 pr-2';

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
/** Review fix: the connector line, so the default (Grok Bot) tab has it too. */
export const INTRO = `Free. ${CONNECTOR_LINE} Your agent connects with this link:`;

/** v2.7: the starting phrase, everywhere (spec Decisions). */
export const START_PROMPT = 'What can I earn?';

/**
 * The install path: the EarnKit link plus short steps for each agent, then what to ask: the
 * starting phrase, or a program's own ("What can I earn on Arc Microgrants?") from its card.
 * v3.1 (SITE tokens): a panel sheet rounded 32px over the scrim, the agent tabs as a SegTabs pill rail that wraps,
 * code blocks on the page colour; a bottom sheet on a phone (fixed to the bottom edge, scrolling inside),
 * a centred sheet from sm. Every target is 44px; focus rings come from the page's own :focus-visible rule.
 */
export default function AddToAgent({ onClose, prompt = START_PROMPT }: { onClose: () => void; prompt?: string }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
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
      className="fixed inset-0 z-[100] bg-s-scrim sm:flex sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="fixed inset-x-0 bottom-0 max-h-[90dvh] w-full overflow-y-auto rounded-t-[32px] bg-s-panel px-4 pb-8 pt-5 text-left text-s-text sm:relative sm:inset-auto sm:max-w-lg sm:rounded-[32px] sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-s-muted motion-safe:transition-colors hover:bg-s-panel-inner hover:text-s-text sm:right-5 sm:top-5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>

        <h2 id="add-to-agent-title" className="ek-serif pr-12 text-[32px] leading-none text-s-text md:text-[40px]">
          Add EarnKit to your agent
        </h2>
        <p className="mt-3 text-base text-s-muted">{INTRO}</p>

        <div className={`${CODE_BOX} mt-5`}>
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-s-text md:text-base">{MCP_URL}</code>
          <CopyButton text={MCP_URL} label="Copy the EarnKit link" primary />
        </div>

        {/* Every agent's tab shows in full: the rail wraps onto more rows on a narrow sheet (never scrolls or fades). */}
        <div role="tablist" aria-label="Your agent" className={`${segRail('sheet')} mt-6`}>
          {/* The tab pattern, as on /docs (InstallCard): only the chosen tab is in the Tab order; arrows, Home and End move and choose. */}
          {AGENTS.map((a, i) => (
            <button
              key={a.name}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              id={`sheet-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-controls="sheet-agent-panel"
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                const next = tabKeyTarget(e.key, i, AGENTS.length);
                if (next === null) return;
                e.preventDefault();
                setActive(next);
                tabs.current[next]?.focus();
              }}
              className={`${segTab('sheet', i === active)} gap-2 pl-3`}
            >
              {/* An SVG mark takes the tab's text colour (ink on the white current tab, white dimmed otherwise); an app icon (PNG) keeps its colors. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.icon}
                alt=""
                width="20"
                height="20"
                className={`h-5 w-5 object-contain ${a.icon.endsWith('.png') ? 'rounded-[5px]' : i === active ? 'brightness-0' : 'brightness-0 invert'} ${i === active ? '' : 'opacity-60'}`}
              />
              {a.name}
            </button>
          ))}
        </div>

        <div id="sheet-agent-panel" role="tabpanel" aria-labelledby={`sheet-tab-${active}`} className="mt-5 text-base text-s-card-body">
          {agent.note && <p className="mb-3 text-s-muted">{agent.note}</p>}
          {agent.install && (
            <a href={agent.install} className={`${COPY_PRIMARY} ${agent.installNote ? 'mb-2' : 'mb-4'}`}>
              {agent.installLabel ?? `Add to ${agent.name}`}
            </a>
          )}
          {agent.installNote && <p className="mb-4">{agent.installNote}</p>}
          {agent.stepsLead && <p className="mb-1.5 text-s-muted">{agent.stepsLead}</p>}
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
          {agent.message && (
            <div className={`${CODE_BOX} mt-3 items-start`}>
              <p className="min-w-0 flex-1 py-2 text-sm text-s-text">{agent.message}</p>
              <CopyButton text={agent.message} label={`Copy the message for ${agent.name}`} />
            </div>
          )}
          {agent.code && (
            <div className={`${CODE_BOX} mt-3 items-start`}>
              <pre className="min-w-0 flex-1 whitespace-pre-wrap py-2 font-mono text-sm text-s-text">
                <Command text={agent.code} />
              </pre>
              <CopyButton text={agent.code} label={`Copy the ${agent.name} setup`} />
            </div>
          )}
          {agent.after && <p className="mt-3">{agent.after}</p>}
          {agent.afterCode && (
            <div className={`${CODE_BOX} mt-3 items-start`}>
              <pre className="min-w-0 flex-1 whitespace-pre-wrap py-2 font-mono text-sm text-s-text">
                <Command text={agent.afterCode} />
              </pre>
              <CopyButton text={agent.afterCode} label={`Copy the ${agent.name} login`} />
            </div>
          )}
          {agent.last && <p className="mt-3">{agent.last}</p>}
        </div>

        <p className="mt-6 border-t border-s-line pt-5 text-base text-s-text">
          Then ask your agent: <span className="text-s-icon-blue">&ldquo;{prompt}&rdquo;</span>
        </p>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
