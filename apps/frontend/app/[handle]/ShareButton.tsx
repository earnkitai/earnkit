import { pagePath } from '../../lib/earnkit/reserved-routes';

export const SHARE_LABEL = 'Share';

/**
 * v3 Stage 3 (spec 5.6), v3.1 (Profile board): the white Share pill in the profile's hero. The share route
 * (share/route.ts) records the share and opens X with the card and the page. Server-safe.
 */
export default function ShareButton({ handle }: { handle: string }) {
  return (
    <a
      href={`${pagePath(handle)}/share`}
      className="inline-flex h-11 min-h-11 shrink-0 items-center justify-center rounded-full bg-s-light px-5 text-[14px] font-bold text-s-ink hover:bg-s-light-hover motion-safe:transition-colors motion-safe:duration-200"
    >
      {SHARE_LABEL}
    </a>
  );
}
