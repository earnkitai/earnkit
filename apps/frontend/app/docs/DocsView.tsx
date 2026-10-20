'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { COLUMN, H1, H2, LEDE, ROW, ROWS, SUB } from '../components/common/Panel';
import { TEXT_LINK } from '../components/common/Button';
import { AGENTS, Command } from '../components/sections/AddToAgent';
import {
  DOCS_CONTACT, DOCS_CONTACT_LEAD, DOCS_DO, DOCS_DO_SUB, DOCS_DO_TITLE, DOCS_INSTALL_SUB, DOCS_INSTALL_TITLE, DOCS_LEDE,
  DOCS_NUMBERS, DOCS_NUMBERS_TITLE, DOCS_ORIGINALITY, DOCS_SELECTORS, DOCS_SELECTORS_SUB, DOCS_SELECTORS_TITLE, DOCS_TERMS_LINK,
  DOCS_TERMS_TITLE, DOCS_TITLE, DOCS_WEEK, DOCS_WEEK_TITLE,
} from '../../lib/earnkit/docs-copy';

/** A section: the title left, its content right from md (as the program guide does), stacked on a phone. */
function Part({ title, id, sub, children }: { title: string; id?: string; sub?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="grid scroll-mt-20 gap-6 border-t border-ek-line py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-14">
      <div>
        <h2 className={H2}>{title}</h2>
        {sub && <p className={SUB}>{sub}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Label left, text right: a hairline row. */
function Pairs({ items }: { items: { label: string; text: string }[] }) {
  return (
    <div className={ROWS}>
      {items.map((i) => (
        <div key={i.label} className={`${ROW} md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`}>
          <p className="font-funnel-sans text-base font-medium text-ek-text">{i.label}</p>
          <p className="min-w-0 break-words font-funnel-sans text-base text-ek-body">{i.text}</p>
        </div>
      ))}
    </div>
  );
}

function Code({ text }: { text: string }) {
  return (
    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap border border-ek-line bg-ek-page px-4 py-3 font-mono text-sm text-ek-text">
      <code>
        <Command text={text} />
      </code>
    </pre>
  );
}

/** v3 Stage 3 (spec 5.6): the Docs page. Pure; every string is in docs-copy.ts or AGENTS. */
export default function DocsView() {
  return (
    <div className={`${COLUMN} pb-4 pt-8 md:pt-12`}>
      <h1 className={H1}>{DOCS_TITLE}</h1>
      <p className={LEDE}>{DOCS_LEDE}</p>

      <div className="mt-10 md:mt-14">
        <Part title={DOCS_INSTALL_TITLE} sub={DOCS_INSTALL_SUB}>
          <div className={ROWS}>
            {AGENTS.map((a) => (
              <div key={a.name} className={`${ROW} items-start`}>
                <h3 className="font-funnel-sans text-base font-medium text-ek-text">{a.name}</h3>
                <div className="min-w-0 font-funnel-sans text-base text-ek-body">
                  {a.steps.map((s) => (
                    <p key={s}>{s}</p>
                  ))}
                  {a.code && <Code text={a.code} />}
                  {a.after && <p className="mt-3">{a.after}</p>}
                  {a.afterCode && <Code text={a.afterCode} />}
                </div>
              </div>
            ))}
          </div>
        </Part>

        <Part title={DOCS_DO_TITLE} sub={DOCS_DO_SUB}>
          <Pairs items={DOCS_DO} />
        </Part>

        <Part title={DOCS_NUMBERS_TITLE}>
          <Pairs items={DOCS_NUMBERS} />
          <p className="mt-4 font-funnel-sans text-base text-ek-muted">{DOCS_ORIGINALITY}</p>
        </Part>

        <Part title={DOCS_WEEK_TITLE}>
          <Pairs items={DOCS_WEEK} />
        </Part>

        <Part title={DOCS_SELECTORS_TITLE} id="selectors" sub={DOCS_SELECTORS_SUB}>
          <div className={ROWS}>
            {DOCS_SELECTORS.map((i) => (
              <div key={i.label} className={`${ROW} md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`}>
                <p className="font-funnel-sans text-base font-medium text-ek-text">{i.label}</p>
                <code className="min-w-0 break-all font-mono text-sm text-ek-body">{i.text}</code>
              </div>
            ))}
          </div>
          <p className="mt-4 font-funnel-sans text-base text-ek-body">
            {DOCS_CONTACT_LEAD}{' '}
            <a href={`mailto:${DOCS_CONTACT}`} className="text-ek-text underline underline-offset-4">
              {DOCS_CONTACT}
            </a>
          </p>
        </Part>

        <Part title={DOCS_TERMS_TITLE}>
          <Link href="/terms" className={TEXT_LINK}>
            {DOCS_TERMS_LINK}
          </Link>
        </Part>
      </div>
    </div>
  );
}
