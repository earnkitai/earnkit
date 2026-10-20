import { BTN_SECONDARY } from '../components/common/Button';
import { pagePath } from '../../lib/earnkit/reserved-routes';

export const SHARE_LABEL = 'Share';

/**
 * v3 Stage 3 (spec 5.6): the share button on the page itself. The share route (share/route.ts) records the share
 * and opens X with the card and the page. Server-safe.
 */
export default function ShareButton({ handle }: { handle: string }) {
  return (
    <a href={`${pagePath(handle)}/share`} className={BTN_SECONDARY}>
      {SHARE_LABEL}
    </a>
  );
}
