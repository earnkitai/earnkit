/**
 * Every outbound destination on the marketing site, in one place.
 * The install path is the homepage's "Add to your agent" modal (AddToAgent).
 */
export const X = 'https://x.com/earnkit_ai';
export const FOLLOW_X = X;
export const RUN_CAMPAIGN =
  'mailto:j@earnkit.com?subject=Running%20a%20campaign%20on%20EarnKit';
export const FOR_ECOSYSTEMS = '/for-ecosystems';
export const FOR_AGENTS = '/';

/**
 * DOCS, FOR_SPONSORS, JENIL_X and CONTACT_EMAIL are defined in lib/earnkit/footer-links.ts (the
 * footer's link allowlist needs them too) and re-exported here so every existing `app/lib/links`
 * import keeps working. lib/earnkit never imports from app/ (fix round 1, Important #1): the
 * dependency runs the other way, same as every other lib/earnkit module.
 */
export { DOCS, FOR_SPONSORS, JENIL_X, CONTACT_EMAIL } from '../../lib/earnkit/footer-links';
