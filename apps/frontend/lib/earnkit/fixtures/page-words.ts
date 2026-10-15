import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const decode = (t: string) => t.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** A page's words: the text and the aria-label, alt and title attributes above the site footer (shared site chrome, flag-off parity). */
export const pageWords = (el: React.ReactElement) => {
  const h = renderToStaticMarkup(el).split('<footer')[0];
  const attrs = [...h.matchAll(/\b(?:aria-label|alt|title)="([^"]*)"/g)].map((m) => m[1]);
  return decode([h.replace(/<[^>]+>/g, '\n'), ...attrs].join('\n'));
};
