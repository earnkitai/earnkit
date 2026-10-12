import { EMPTY_LINE, type EmptyProfile, type ProfileData } from '../profile-data';

/** v2.12 T10: a full public profile (profile-pages.test.ts and the design pass). */
export const fullProfile: ProfileData = {
  name: '@lee_builds',
  slug: 'lee_builds',
  score: 41,
  top_percent: 22,
  change_7d: 6,
  stats: [
    { value: '1,240 users', meaning: 'people who used what they shipped' },
    { value: '14 months live', meaning: 'how long the work kept being used' },
    { value: '$3.1k fees and volume', meaning: 'money through what they built, last 12 months' },
  ],
  projects: [
    {
      key: 'lee/tipjar',
      title: 'tipjar',
      numbers: ['1,100 users', '$3.1k'],
      sources: [
        { kind: 'github', label: 'lee/tipjar', href: 'https://github.com/lee/tipjar' },
        { kind: 'site', label: 'tipjar.app', href: 'https://tipjar.app' },
        { kind: 'onchain', label: '0x7a3f…91c2', href: 'https://basescan.org/address/0x7a3f00000000000000000000000000000000091c2' },
      ],
      entries: [{ program: 'Arc Microgrants', outcome: 'won' }],
    },
    {
      key: 'lee/docs-kit',
      title: 'docs-kit',
      numbers: ['140 users'],
      sources: [
        { kind: 'github', label: 'lee/docs-kit', href: 'https://github.com/lee/docs-kit' },
        { kind: 'packages', label: 'npm docs-kit', href: 'https://www.npmjs.com/package/docs-kit' },
      ],
      entries: [],
    },
  ],
  sources: [
    { kind: 'github', label: 'lee/tipjar', href: 'https://github.com/lee/tipjar' },
    { kind: 'site', label: 'tipjar.app', href: 'https://tipjar.app' },
    { kind: 'onchain', label: '0x7a3f…91c2', href: 'https://basescan.org/address/0x7a3f00000000000000000000000000000000091c2' },
    { kind: 'github', label: 'lee/docs-kit', href: 'https://github.com/lee/docs-kit' },
    { kind: 'packages', label: 'npm docs-kit', href: 'https://www.npmjs.com/package/docs-kit' },
  ],
  // 90 days, rising with a dip: a deterministic curve ending at the score.
  spark: Array.from({ length: 90 }, (_, i) => Math.round(18 + (23 * i) / 89 + 3 * Math.sin(i / 7) * (1 - i / 89))),
  stricter_note: null,
};

export const emptyProfile: EmptyProfile = { name: 'Builder', slug: 'b-x7k2m9qa', line: EMPTY_LINE };
