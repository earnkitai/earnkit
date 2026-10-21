/**
 * Every outbound destination on the marketing site, in one place.
 * The install path is the "Add to your agent" sheet (AddToAgent).
 *
 * X and DOCS are defined in lib/earnkit/footer-links.ts (the footer's link allowlist needs them too) and
 * re-exported here so every existing `app/lib/links` import keeps working. lib/earnkit never imports from
 * app/ (fix round 1, Important #1): the dependency runs the other way, same as every other lib/earnkit module.
 */
export { DOCS, X } from '../../lib/earnkit/footer-links';
