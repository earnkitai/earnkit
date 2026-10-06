import { guideSourceList, programGuide, type GuideFacts } from '../guide';
import type { GuidePage } from '../landing';

/**
 * Test only: guide pages for public-pages and copy-review. The full one is guide.test.ts's Arc
 * fixture (v2.7 §2's example), with dotted hosts so every source renders as a link.
 */
export const GUIDE_NOW = new Date('2026-10-06T12:00:00Z');

const base: GuideFacts = {
  past_rounds: [], focus: null, best_bet: null, difficulty_override: null,
  winners_per_round: null, tag: null, each_time: [], submission_requirements: [], rules: [], chains: ['arc'],
};
type Facts = Parameters<typeof programGuide>[0] & { source_url: string };
export const arcFacts: Facts = {
  ...base,
  title: 'Arc Microgrants',
  summary: '500 USDC × 20 grants · closes Oct 14, 11:59 PM ET',
  ends_at: new Date('2026-10-15T03:59:00Z'),
  status: 'active',
  source_url: 'https://community.arc.io/public/events/arc-microgrants',
  past_rounds: [{
    label: 'Arc Microgrants R2', source_url: 'https://community.arc.io/r2', own: true, submissions: 160, winners: 20,
    themes: [{ theme: 'Agent wallets paying for APIs', count: 2 }, { theme: 'USDC payroll and payouts', count: 3 }],
    examples: [{ name: 'PayStream', what: 'streamed salaries in USDC', why: 'live mainnet demo', source_url: 'https://x.com/arc/status/1' }],
  }],
  focus: { areas: ['Stablecoin payments', 'FX', 'Agentic commerce'], source_url: 'https://www.arc.io/blog/focus' },
  best_bet: 'A USDC payout tool with a live mainnet demo',
};
const BONUS = { cell: '0.18 ETH so far', board: 'earnkit.com/bonus/arc-microgrants-2026-09-16' };

const page = (facts: Facts, bonus: typeof BONUS | null, o: Partial<GuidePage> = {}): GuidePage => {
  const guide = programGuide(facts, bonus, GUIDE_NOW);
  return {
    guide,
    title: facts.title,
    logo: null,
    open: facts.status === 'active',
    board_path: bonus ? '/bonus/arc-microgrants-2026-09-16' : null,
    source_url: facts.source_url,
    sources: guideSourceList(facts, [{ label: 'program page', url: facts.source_url }]),
    ecosystem: guide.wants?.ecosystem ?? 'Arc',
    ...o,
  };
};

/** Every part: what won last time, what Arc wants now, the best bet, the builder bonus. */
export const fullGuide = page(arcFacts, BONUS, { logo: '/programs/arc-microgrants.svg' });
/** No past round with themes: no "What won" part. */
export const partialGuide = page({ ...arcFacts, past_rounds: [] }, BONUS);
/** No guide facts and no bonus (today's programs until Task 8): the header and the actions only. */
export const emptyGuide = page(
  {
    ...arcFacts, title: 'Circle Developer Grants', summary: 'milestone-based USDC grants · rolling', ends_at: null,
    source_url: 'https://www.circle.com/grant', past_rounds: [], focus: null, best_bet: null,
  },
  null,
);
/** Ruling 22 (plan): a closed program still renders, header "· closed", no "Ask your agent". */
export const closedGuide = page({ ...arcFacts, status: 'closed' }, null);
/**
 * Ruling C2/C3: what every real program shows after Task 8: a predecessor round (not own), so
 * "What won before" and a basis naming the round.
 */
export const predecessorGuide = page(
  {
    ...arcFacts,
    past_rounds: [{ ...arcFacts.past_rounds[0], own: undefined, label: "Arc's HackMoney 2026 track" }],
  },
  BONUS,
);
