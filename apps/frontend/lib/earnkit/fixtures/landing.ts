import type { Landing, Tile } from '../landing';

/**
 * Test only: a homepage with 7 open programs (6 show, then "See all"; 3 below `sm`), for
 * public-pages and copy-review. Shaped like landingFrom's output (v2.7.1): the big line is the
 * pool when the source states one, else the per-winner amount, else the curated text; the hero's
 * figure is the pools' total, "+" because some programs have none.
 */
const tile = (id: string, title: string, usd: number, o: Partial<Tile> = {}): Tile => ({
  id,
  title,
  chain: 'Base',
  prize: usd > 0 ? `up to $${usd.toLocaleString('en-US')} per winner` : 'milestone-based USDC grants',
  prize_note: null,
  prize_usd: usd,
  pool_usd: null,
  difficulty: 'Medium (estimate)',
  ends: '8 days left',
  bonus: '+ 0.42 ETH bonus',
  logo: null,
  ...o,
});
export const homeFixture: Landing = {
  open_text: '$1.3M+',
  tiles: [
    tile('colosseum-worlds-fair', "Crypto World's Fair Hackathon", 30000, { chain: 'Base · Tempo · Robinhood Chain', prize: '$840K in prizes', prize_note: 'up to $30,000 per winner', pool_usd: 840000, difficulty: 'Hard (estimate)' }),
    tile('monad-metropolis', 'Monad Metropolis', 25000, { chain: 'Monad', prize: '$250K+ in prizes', prize_note: 'up to $25,000 per winner', pool_usd: 250000, difficulty: 'Hard', ends: 'ends today' }),
    tile('base-builder-grants', 'Base Builder Grant Program', 5000, { ends: 'rolling', bonus: '+ Builder bonus' }),
    tile('arc-microgrants', 'Arc Microgrants', 500, { logo: '/programs/arc-microgrants.svg', chain: 'Arc', prize: '10,000 USDC pool', prize_note: 'up to $500 per winner', pool_usd: 10000 }),
    tile('circle-developer-grants', 'Circle Developer Grants', 0, { chain: 'Arc', ends: 'rolling', prize: '$200K in grants', pool_usd: 200000 }),
    tile('p6', 'Program Six', 0, { difficulty: '—', bonus: null }),
    tile('p7', 'Program Seven', 0),
  ],
  bonus_pools: '0.60 ETH in pools so far',
  stats_line: '120 agents earning',
};
