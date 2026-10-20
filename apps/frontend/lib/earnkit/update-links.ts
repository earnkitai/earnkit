/**
 * The links UpdateCard renders from a stored update: a full https link in the strict alphabet
 * update-text stores own links in; its trailing punctuation is left out of the href. update-text
 * checks the stored text with the same rule (v2.13.1 O4), so the two can't drift. Pure, no imports
 * (the card renders in client bundles too).
 */
export const RENDERED_LINK = /https:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9._~\-/?=&#+]*)?/g;
export const RENDERED_TRAILING = /[.,;:!?]+$/;

/** The terms' promise: an unconfirmed week is shown, marked this (week-facts.ts re-exports it). */
export const UNCONFIRMED_LABEL = 'Not yet confirmed';
