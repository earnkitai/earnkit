import type { ReactNode } from 'react';
import { Panel } from '../../components/common/Panel';
import { X } from '../../lib/links';
import {
  CLANKER_CUT_PCT,
  CONTACT_EMAIL,
  MINI_LINE,
  RECORD_STEPS,
  RECORDS_HISTORY,
  RECORDS_IP,
  RECORDS_READ,
  RECORDS_READ_LEAD,
  RECORDS_REMOVAL_AFTER,
  RECORDS_REMOVAL_LEAD,
  RECORDS_RETENTION,
  RECORDS_SENT,
  RECORDS_SENT_LEAD,
  RECORDS_TITLE,
  RECORDS_WHY,
  RECORDS_WITH,
  SAFE_ADDRESS,
  SPLIT_KEPT_V213,
  feeTable,
} from '../../../lib/earnkit/policy';

const link = 'text-ek-text underline underline-offset-4 transition-colors hover:text-ek-text';

/** `aside` sits beside the heading. */
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const heading = <h2 className="font-funnel-display text-2xl font-medium text-ek-text md:text-3xl">{title}</h2>;
  return (
    <div
      id={title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}
      className="scroll-mt-32 grid gap-4 border-t border-ek-line py-10 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-14">
      {aside ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 self-start">
          {heading}
          {aside}
        </div>
      ) : (
        heading
      )}
      <div className="max-w-2xl space-y-4 font-funnel-sans text-base font-light leading-relaxed text-ek-body md:text-lg">
        {children}
      </div>
    </div>
  );
}

const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-2 pl-5 marker:text-ek-muted">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
);

function Table({ head, rows }: { head: [string, string]; rows: [string, string | number][] }) {
  return (
    <table className="w-full font-funnel-sans text-sm md:text-base">
      <thead>
        <tr className="text-left text-ek-muted">
          <th scope="col" className="pb-3 font-medium">{head[0]}</th>
          <th scope="col" className="w-20 pb-3 text-right font-medium">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([a, b]) => (
          <tr key={a} className="border-t border-ek-line text-ek-body">
            <td className="py-3 pr-4">{a}</td>
            <td className="py-3 text-right tabular-nums text-ek-text">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The public policy (v2.5 §4), /terms#policy since v2.9 F22: matching, the fee split (v2.13's three
 * rows, then the MINI line, F24), the optional token, no affiliation, what EarnKit records (v2.11
 * T12), contact. Every number comes from lib/earnkit/policy.ts, which reads the constants the code applies.
 */
export default function PolicySection() {
  return (
    <>
      <Panel className="py-12 md:py-16" label="Policy">
        <h2 id="policy" className="scroll-mt-32 font-funnel-display text-2xl font-medium text-ek-text md:text-4xl">
          How EarnKit works
        </h2>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-body md:text-lg">
          Plain answers on matching and token fees.
        </p>
      </Panel>

      <Panel className="py-2 md:py-4">
        <Section title="How matching works">
          <p>
            EarnKit keeps a list of open builder programs: grants, hackathons and bounties. Their facts come from
            each program&apos;s own public page.
          </p>
          <p>
            Your agent shares the repos you choose. EarnKit shows the programs your work fits, and adds up the top
            prize one winner can get in each. It never adds up whole prize pools. Programs that don&apos;t state a
            per-winner amount aren&apos;t counted.
          </p>
          <p>You submit on each program&apos;s own site. EarnKit never decides a program&apos;s winners.</p>
        </Section>

        <Section title="Where token fees go">
          <p>
            A project launches its token through EarnKit. The launch protocol keeps {CLANKER_CUT_PCT}% of trading fees.
            The rest is split, paid in WETH on Base:
          </p>
          <Table head={['Recipient', 'Share']} rows={feeTable()} />
          <p>{MINI_LINE}.</p>
          <p>
            EarnKit&apos;s share goes to its Safe on Base:{' '}
            <a
              href={`https://basescan.org/address/${SAFE_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`block break-all font-funnel-sans text-sm md:text-base ${link}`}
            >
              {SAFE_ADDRESS}
            </a>
          </p>
          <p>{SPLIT_KEPT_V213}</p>
        </Section>


        <Section title="The token is optional">
          <p>
            Every entry is offered a token, named after the project. Turn it down and there&apos;s no token.
          </p>
        </Section>

        <Section title="No affiliation">
          <p>
            EarnKit lists programs by their factual names. EarnKit isn&apos;t affiliated with or endorsed by any
            program or its organizer.
          </p>
        </Section>

        {/* v2.11 T12: id what-earnkit-records (RECORDS_ANCHOR); the entry page links it. */}
        <Section title={RECORDS_TITLE}>
          <p>{RECORDS_SENT_LEAD}</p>
          <List items={RECORDS_SENT} />
          <p>{RECORDS_READ_LEAD}</p>
          <List items={RECORDS_READ} />
          <p>{RECORDS_IP}</p>
          <p>{RECORDS_HISTORY}</p>
          <List items={RECORD_STEPS} />
          <p>{RECORDS_WITH.join(' ')}</p>
          <p>
            {RECORDS_WHY} {RECORDS_RETENTION}
          </p>
          <p>
            {RECORDS_REMOVAL_LEAD}{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
              {CONTACT_EMAIL}
            </a>
            . {RECORDS_REMOVAL_AFTER.join(' ')}
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions, or something on a leaderboard looks wrong: email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
              {CONTACT_EMAIL}
            </a>{' '}
            or message{' '}
            <a href={X} target="_blank" rel="noopener noreferrer" className={link}>
              @EarnKitAI
            </a>{' '}
            on X.
          </p>
        </Section>
      </Panel>
    </>
  );
}
