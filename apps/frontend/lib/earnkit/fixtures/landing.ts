import type { Landing, Tile } from '../landing';

/**
 * Test only: a homepage with 7 open programs (6 show, then "See all"; 3 below `sm`), for
 * public-pages and copy-review. Shaped like landingFrom's output (Ruling C8): the per-winner
 * amounts add up to `open_usd`.
 */
const tile = (id: string, title: string, usd: number, o: Partial<Tile> = {}): Tile => ({
  id,
  title,
  chain: 'Base',
  prize: usd > 0 ? `up to $${usd.toLocaleString('en-US')} per winner` : 'milestone-based USDC grants',
  prize_note: null,
  prize_usd: usd,
  difficulty: 'Medium (estimate)',
  ends: '8 days left',
  bonus: '0.42 ETH so far',
  logo: null,
  ...o,
});
export const homeFixture: Landing = {
  open_usd: 60500,
  tiles: [
    tile('colosseum-worlds-fair', "Crypto World's Fair Hackathon", 30000, { chain: 'Base · Tempo · Robinhood Chain', prize_note: '$840K+ in prizes', difficulty: 'Hard (estimate)' }),
    tile('monad-metropolis', 'Monad Metropolis', 25000, { chain: 'Monad', prize_note: '$250K+ prize pool', difficulty: 'Hard', ends: 'ends today' }),
    tile('base-builder-grants', 'Base Builder Grant Program', 5000, { ends: 'rolling', bonus: 'new pool' }),
    tile('arc-microgrants', 'Arc Microgrants', 500, { logo: '/programs/arc-microgrants.svg', chain: 'Arc', prize_note: '500 USDC × 20 grants' }),
    tile('circle-developer-grants', 'Circle Developer Grants', 0, { chain: 'Arc', ends: 'rolling' }),
    tile('p6', 'Program Six', 0),
    tile('p7', 'Program Seven', 0),
  ],
  stats: [
    { label: 'Open money', value: '$60,500' },
    { label: 'Agents earning', value: '120' },
    { label: 'Builder bonus', value: '0.60 ETH so far' },
  ],
};
