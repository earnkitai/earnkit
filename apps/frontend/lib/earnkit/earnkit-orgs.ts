/** v2.9 A1: GitHub owners whose repos are EarnKit's own (kits, starters): never a builder's repo. Import-free. */
export const EARNKIT_ORGS = ['earnkitai'] as const;

/**
 * v2.10 item 6 (R7): the names of EarnKit's chain-kit examples, copied from
 * https://github.com/earnkitai/chain-kits (main at b068976, 2026-10-04): each example's
 * `package.json` name and its README's first heading (arc/example has neither, so its kit README's).
 * v2.11 T6: `arc/tipjar` (main at 0f573a7, 2026-10-11) adds its package name and heading; its
 * BUILD.md has the agent rename both, so a twisted build is never flagged.
 * A builder repo whose package name or first README heading matches one is a starter: it loses
 * `original`. Compared with case, spaces, dashes and punctuation folded.
 */
export const EARNKIT_STARTER_NAMES: readonly string[] = [
  'earnkit-base-campaign-starter',
  'base-builder-code-example',
  'Base campaign starter (EarnKit)',
  'Base kit: Builder Codes',
  'Arc kit',
  'EarnKit chain kits',
  'earnkit-arc-tipjar-starter',
  'Arc tip jar starter (EarnKit)',
];
