'use client';

import { useEffect, useRef, useState } from 'react';
import { AGENTS, Command, MCP_URL, type Agent } from '../components/sections/agents';
import { segRail, segTab } from '../components/site/SegTabs';

/** The code block (Docs board): the page colour on the light card, 22px round, mono 14px; a long line scrolls inside it. */
const CODE_BOX = 'flex items-start gap-3 rounded-[22px] bg-s-page py-3 pl-[22px] pr-3 text-s-text md:py-4';

/** The copy button: 40px square (44px on a phone), copies `text` and announces "Copied" in its own live region. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <>
      <button
        type="button"
        aria-label="Copy the command"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false),
          );
        }}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-s-panel-hover text-s-foot-link hover:bg-s-panel-inner hover:text-s-text motion-safe:transition-colors md:h-10 md:w-10"
      >
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="14" height="14" x="8" y="8" rx="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}

function Code({ text }: { text: string }) {
  return (
    <div className={CODE_BOX}>
      <pre data-ek-code="" className="min-w-0 flex-1 self-center overflow-x-auto whitespace-pre-wrap py-1 font-mono text-[14px] leading-[1.6]">
        <Command text={text} />
      </pre>
      <CopyButton text={text} />
    </div>
  );
}

/**
 * One agent's panel, every string from AGENTS: its steps as one line, the command (or the EarnKit link, for an agent
 * that pastes it), then the after line and the after command. Cursor's "Or add" reads "Add" here (no deep link above it).
 */
export function AgentPanel({ agent }: { agent: Agent }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] text-s-ink-body">
      <p>{agent.steps.map((s) => s.replace(/^Or add/, 'Add')).join(' ')}</p>
      <Code text={agent.code ?? MCP_URL} />
      {agent.after && <p>{agent.after}</p>}
      {agent.afterCode && <Code text={agent.afterCode} />}
    </div>
  );
}

/** v3.1 site Task 10: the docs install card's agent tabs (AGENTS order, Grok Bot first) and the chosen agent's panel. */
export default function InstallCard() {
  const [active, setActive] = useState(0);
  const agent = AGENTS[active];
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Your agent" className={`${segRail('light')} self-start`}>
        {AGENTS.map((a, i) => (
          <button
            key={a.name}
            id={`docs-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls="docs-agent-panel"
            onClick={() => setActive(i)}
            className={segTab('light', i === active)}
          >
            {a.name}
          </button>
        ))}
      </div>
      <div id="docs-agent-panel" role="tabpanel" aria-labelledby={`docs-tab-${active}`}>
        <AgentPanel agent={agent} />
      </div>
    </div>
  );
}
