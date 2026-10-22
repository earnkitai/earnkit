'use client';

import { useEffect, useRef, useState } from 'react';
import { AGENTS, CONNECTOR_LINE, Command, MCP_URL, tabKeyTarget, type Agent } from '../components/sections/agents';

export { tabKeyTarget };
import { segRail, segTab } from '../components/site/SegTabs';

/** The code block (Docs board): the page colour on the light card, 22px round, mono 14px; a long line scrolls inside it. */
const CODE_BOX = 'flex items-start gap-3 rounded-[22px] bg-s-page py-3 pl-[22px] pr-3 text-s-text md:py-4';

/** The copy button: 40px square (44px on a phone), copies `text` and announces "Copied" or "Copy failed" in its own live region. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = (next: 'copied' | 'failed') => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  };
  return (
    <>
      <button
        type="button"
        aria-label="Copy the command"
        onClick={() => {
          // No clipboard (an insecure origin, an old browser) fails the same way as a refused write.
          if (!navigator.clipboard) return show('failed');
          navigator.clipboard.writeText(text).then(
            () => show('copied'),
            () => show('failed'),
          );
        }}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-s-panel-hover text-s-foot-link hover:bg-s-panel-inner hover:text-s-text motion-safe:transition-colors md:h-10 md:w-10"
      >
        {state === 'copied' ? (
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
        {COPY_SAID[state]}
      </span>
    </>
  );
}

/** What the copy button's live region says. */
export const COPY_SAID = { idle: '', copied: 'Copied', failed: 'Copy failed' } as const;

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
 * One agent's panel, every string from AGENTS: for an agent that pastes the EarnKit link (no command), the link first
 * (review fix: the steps say "paste the EarnKit link", so it sits above them); its note, its steps (numbered when there
 * are two or more, as in the install sheet), the command, then the after line and the after command. Cursor's "Or add"
 * reads "Add" here (no deep link above it).
 */
export function AgentPanel({ agent }: { agent: Agent }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] text-s-ink-body">
      {!agent.code && <Code text={MCP_URL} />}
      {agent.note && <p>{agent.note}</p>}
      {agent.steps.length > 1 ? (
        <ol className="list-decimal space-y-1.5 pl-5">
          {agent.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      ) : (
        <p>{agent.steps[0].replace(/^Or add/, 'Add')}</p>
      )}
      {agent.code && <Code text={agent.code} />}
      {agent.after && <p>{agent.after}</p>}
      {agent.afterCode && <Code text={agent.afterCode} />}
    </div>
  );
}

/**
 * v3.1 site Task 10: the docs install card's agent tabs (AGENTS order, Grok Bot first) and the chosen agent's panel.
 * Task 11: the tabs wrap on a phone and rove: only the chosen tab is in the Tab order, the arrow keys (and Home, End)
 * move to and choose the next one.
 */
export default function InstallCard() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const agent = AGENTS[active];
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px] text-s-ink-body">{CONNECTOR_LINE}</p>
      <div role="tablist" aria-label="Your agent" className={`${segRail('light')} self-start`}>
        {AGENTS.map((a, i) => (
          <button
            key={a.name}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`docs-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls="docs-agent-panel"
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              const next = tabKeyTarget(e.key, i, AGENTS.length);
              if (next === null) return;
              e.preventDefault();
              setActive(next);
              tabs.current[next]?.focus();
            }}
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
