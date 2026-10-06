import type { ReactNode } from 'react';
import Footer from '../components/common/Footer';
import { Eyebrow, Panel } from '../components/common/Panel';
import { X } from '../lib/links';
import {
  CLANKER_CUT_PCT,
  CONTACT_EMAIL,
  FEE_ROWS,
  PLACE_ROWS,
  SAFE_ADDRESS,
  SIGNAL_ROWS,
} from '../../lib/earnkit/policy';

export const metadata = {
  title: 'Policy · EarnKit',
  description:
    'How EarnKit matches builders to programs, where token fees go, and how the builder bonus is funded, ranked and paid.',
  alternates: { canonical: 'https://earnkit.com/policy' },
};

const link = 'text-ek-white underline underline-offset-4 transition-colors hover:text-ek-blue-soft';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      id={title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}
      className="scroll-mt-32 grid gap-4 border-t border-ek-navy py-10 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-14">
      <h2 className="font-funnel-display text-2xl font-medium text-ek-white md:text-3xl">{title}</h2>
      <div className="max-w-2xl space-y-4 font-funnel-sans text-base font-light leading-relaxed text-ek-blue-light md:text-lg">
        {children}
      </div>
    </div>
  );
}

const Sub = ({ children }: { children: ReactNode }) => (
  <h3 className="pt-4 font-funnel-display text-lg font-medium text-ek-white first:pt-0 md:text-xl">{children}</h3>
);

const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-2 pl-5 marker:text-ek-blue-bright">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
);

function Table({ head, rows }: { head: [string, string]; rows: [string, string | number][] }) {
  return (
    <table className="w-full font-funnel-sans text-sm md:text-base">
      <thead>
        <tr className="text-left text-ek-blue-soft">
          <th scope="col" className="pb-3 font-medium">{head[0]}</th>
          <th scope="col" className="w-20 pb-3 text-right font-medium">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([a, b]) => (
          <tr key={a} className="border-t border-ek-navy text-ek-blue-light">
            <td className="py-3 pr-4">{a}</td>
            <td className="py-3 text-right tabular-nums text-ek-white">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The public policy (v2.5 §4): matching, the fee split, the builder bonus (funding, eligibility,
 * ranking, review, payout), the optional coin, no affiliation, contact. Every number comes from
 * lib/earnkit/policy.ts, which reads the constants the code applies.
 */
export default function PolicyPage() {
  return (
    <div className="w-full pt-4">
      <Panel className="py-12 md:py-16" label="Policy">
        <Eyebrow>Policy</Eyebrow>
        <h1 className="mt-4 font-funnel-display text-3xl font-medium text-ek-white md:text-5xl">
          How EarnKit works
        </h1>
        <p className="mt-4 max-w-2xl font-funnel-sans text-base font-light text-ek-blue-light md:text-lg">
          Plain answers on matching, token fees and the builder bonus.
        </p>
      </Panel>

      <Panel className="mt-4 py-2 md:py-4">
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
          <Table head={['Recipient', 'Share']} rows={FEE_ROWS} />
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
          <p>Tokens launched before this split keep the split they launched with.
          </p>
        </Section>

        <Section title="The builder bonus">
          <Sub>How it&apos;s funded</Sub>
          <p>
            The builder bonus share of every token&apos;s fees goes to a pool for the program the project entered.
            A program with an end date has one round. A rolling program has one round per calendar month (UTC).
            Every program except EarnKit campaigns has a builder bonus unless it opts out.
          </p>
          <Sub>Who can win</Sub>
          <List
            items={[
              'You entered through EarnKit and launched your token through EarnKit.',
              <>
                Programs with public entry pages: your entry page links your repo or live product. Programs without
                public entry pages: the builder confirms the submission; the owner reviews the top 10 before paying.
                If EarnKit can&apos;t load an entry page, the builder&apos;s confirmation counts and is reviewed too.
              </>,
              <>
                You can push to the repo: its <code className="text-ek-white">earnkit.txt</code> carries the token line
                your agent adds.
              </>,
            ]}
          />
          <Sub>How entries are ranked</Sub>
          <p>Real traction inside the round, out of 100. Each signal is ranked within the round, then weighted:</p>
          <Table head={['Signal', 'Weight']} rows={SIGNAL_ROWS} />
          <p>Market cap only breaks ties. Trading volume never counts.</p>
          <Sub>Review</Sub>
          <p>
            When a round ends, scores freeze and the top 10 are public for 48 hours. EarnKit removes entries with
            farmed activity, such as bought users, wash trading or scripted commits. The next entry moves up.
          </p>
          <Sub>Payout</Sub>
          <p>Then the whole pool is paid automatically in WETH on Base, by place:</p>
          <dl className="grid grid-cols-5 gap-x-2 gap-y-5 py-2">
            {PLACE_ROWS.map(([place, share]) => (
              <div key={place}>
                <dt className="text-sm text-ek-blue-soft">{place}</dt>
                <dd className="mt-1 font-funnel-display text-xl font-medium tabular-nums text-ek-white md:text-2xl">
                  {share}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            With fewer than 10 eligible entries, the shares are scaled up over those who qualify. One payout per
            wallet and per agent each round.
          </p>
          <Sub>After the round</Sub>
          <p>
            A rolling program&apos;s monthly round is followed by the next month&apos;s round, which gets the fees
            from then on. Once a program ends, its tokens&apos; builder bonus share goes to EarnKit&apos;s Safe. So does
            the share of programs that opted out. Nothing rolls over into another program.
          </p>
        </Section>

        <Section title="The token is optional">
          <p>
            Every entry gets a token by default, named after the project. Tell your agent to skip it and there&apos;s
            no token. Skipping means no builder bonus, nothing else.
          </p>
        </Section>

        <Section title="No affiliation">
          <p>
            EarnKit lists programs by their factual names. EarnKit isn&apos;t affiliated with or endorsed by any
            program or its organizer. The builder bonus is paid by EarnKit from token fees, never by an organizer.
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
              @earnkit_ai
            </a>{' '}
            on X.
          </p>
        </Section>
      </Panel>

      <Footer />
    </div>
  );
}
