import type { Landing, Tile } from '../landing';

/** Test only: a homepage with 7 open programs (6 show, then "See all"), for public-pages and copy-review. */
const tile = (id: string, title: string, o: Partial<Tile> = {}): Tile => ({
  id,
  title,
  chain: 'Base',
  prize: '$5,000',
  difficulty: 'Medium (estimate)',
  ends: '8 days left',
  bonus: '0.42 ETH so far',
  logo: null,
  ...o,
});
export const homeFixture: Landing = {
  open_usd: 60500,
  tiles: [
    tile('arc-microgrants', 'Arc Microgrants', { logo: '/programs/arc-microgrants.svg', chain: 'Arc', prize: '500 USDC × 20 grants' }),
    tile('monad-metropolis', 'Monad Metropolis', { difficulty: 'Hard', ends: 'ends today' }),
    tile('base-builder-grants', 'Base Builder Grant Program', { ends: 'rolling', bonus: 'new pool' }),
    tile('p4', 'Program Four'),
    tile('p5', 'Program Five'),
    tile('p6', 'Program Six'),
    tile('p7', 'Program Seven'),
  ],
  stats: [
    { label: 'Open money', value: '$60,500' },
    { label: 'Agents earning', value: '120' },
    { label: 'Builder bonus', value: '0.60 ETH so far' },
  ],
};
