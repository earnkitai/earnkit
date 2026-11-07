/** The /me gate: no live session is a 302 to /docs#record before the page renders (lib/v6/me-routes.ts). */
import { meGet } from './lib/v6/me-routes';

export function proxy(request: Request) {
  return meGet(request);
}

export const config = { matcher: ['/me'] };
