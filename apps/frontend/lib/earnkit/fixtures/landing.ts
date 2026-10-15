import type { Landing, Tile } from '../landing';
import { NO_CELL } from '../present';

/**
 * Test only: a homepage with 7 open programs (v2.8: all 7 in the carousel), for
 * public-pages and copy-review. Shaped like landingFrom's output (v2.7.1): the big line is the
 * pool when the source states one, else the per-winner amount, else the curated text; the hero's
 * figure is the one money figure (the top prizes summed). Sorted by pool (byPool).
 */
const tile = (id: string, title: string, usd: number, o: Partial<Tile> = {}): Tile => ({
  id,
  title,
  chain: 'Base',
  prize: usd > 0 ? `up to $${usd.toLocaleString('en-US')} per winner` : 'milestone-based USDC grants',
  prize_note: null,
  prize_usd: usd,
  pool_usd: null,
  difficulty: 'Medium',
  days_left: '8 days left',
  has_bonus: true,
  bonus_amount: '0.42 ETH',
  logo: null,
  ...o,
});
export const homeFixture: Landing = {
  // v2.9 F21: moneyText(openMoneyUsd) of these programs' top prizes (prize_usd): $160,500.
  open_text: '$160.5K',
  tiles: [
    tile('colosseum-worlds-fair', "Crypto World's Fair Hackathon", 30000, { chain: 'Base · Tempo · Robinhood Chain', prize: '$840K in prizes', prize_note: 'up to $30,000 per winner', pool_usd: 840000, difficulty: 'Hard' }),
    tile('monad-metropolis', 'Monad Metropolis', 25000, { chain: 'Monad', prize: '$250K+ in prizes', prize_note: 'up to $25,000 per winner', pool_usd: 250000, difficulty: 'Hard', days_left: 'ends today' }),
    tile('circle-developer-grants', 'Circle Developer Grants', 100000, { chain: 'Arc', days_left: 'rolling', prize: '$200K in grants', prize_note: '$5K–$100K per grant', pool_usd: 200000 }),
    tile('arc-microgrants', 'Arc Microgrants', 500, { logo: '/programs/arc-microgrants.svg', chain: 'Arc', prize: '10,000 USDC pool', prize_note: '500 USDC per grant', pool_usd: 10000 }),
    tile('base-builder-grants', 'Base Builder Grant Program', 5000, { prize: 'up to $5,000 per grant', days_left: 'rolling', bonus_amount: null }),
    tile('p6', 'Program Six', 0, { difficulty: NO_CELL, has_bonus: false, bonus_amount: null }),
    tile('p7', 'Program Seven', 0),
  ],
  stats_line: '120 agents earning',
  won_line: null,
  // v2.13: the Bench sections are off (flag off); landing.test.ts 12.x passes its own.
  bench: null,
};
