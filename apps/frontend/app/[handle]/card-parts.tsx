import { scoreBand } from '../../lib/earnkit/site-copy';
import { SITE as S } from '../../lib/earnkit/site-theme';
import { WORDMARK_D } from '../components/ui/Logo';

/**
 * GTM W4: the pieces both share cards draw (card-response.tsx, the page's card; post-card-image.tsx, a post's card), in
 * the v3.1 site language (DESIGN.md): Kaftan Serif for names and numbers, Funnel Sans for words, the site tokens only.
 */
export const DISPLAY = 'Kaftan Serif';
export const SANS = 'Funnel Sans';

/** The wordmark, white, at `height` px (the 124x23 viewBox of Logo.tsx). */
export function CardWordmark({ height, color = S.text }: { height: number; color?: string }) {
  return (
    <svg viewBox="0 0 124 23" width={Math.round((height * 124) / 23)} height={height}>
      <path fillRule="evenodd" clipRule="evenodd" d={WORDMARK_D} fill={color} />
    </svg>
  );
}

/** EarnKit's mark (the profile hero's 29x28 drawing), in `color`. */
export function CardMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={Math.round((size * 28) / 29)} viewBox="0 0 29 28">
      <path fill={color} d="M14.5258 6.97539C10.6587 6.97539 7.52377 10.1103 7.52377 13.9774H0.548389C0.548389 6.25789 6.80628 0 14.5258 0C22.2453 0 28.5032 6.25789 28.5032 13.9774H21.5278C21.5278 10.1103 18.3929 6.97539 14.5258 6.97539Z" />
      <path fill={color} d="M7.54423 13.9775C7.54423 17.8695 4.38911 21.0246 0.49707 21.0246V28C8.24151 28 14.5196 21.7219 14.5196 13.9775H7.54423Z" />
      <path fill={color} d="M28.495 20.965C24.6358 20.965 21.5074 17.8366 21.5074 13.9774H14.532C14.532 21.689 20.7834 27.9404 28.495 27.9404V20.965Z" />
    </svg>
  );
}

/** The first letter of a name or handle, as the site's Avatar draws it. Pure. */
export const initialOf = (s: string) => s.replace(/^[@_]+/, '').charAt(0).toUpperCase() || '?';

/**
 * The photo, round; without one (none, a failed read or GitHub's default picture: card-response.tsx avatarData) the
 * initial in Kaftan Serif, blue on white, as the profile's blue hero draws it.
 */
export function CardPhoto({ avatar, name, size, ring }: { avatar: string | null; name: string; size: number; ring?: string }) {
  const border = ring ? { border: `3px solid ${ring}` } : {};
  return avatar ? (
    // eslint-disable-next-line @next/next/no-img-element -- satori draws a plain img
    <img src={avatar} width={size} height={size} alt="" style={{ width: size, height: size, flexShrink: 0, borderRadius: size / 2, objectFit: 'cover', backgroundColor: S.light, ...border }} />
  ) : (
    <div style={{ display: 'flex', width: size, height: size, flexShrink: 0, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: S.light, color: S.blue, fontFamily: DISPLAY, fontSize: Math.round(size * 0.52), lineHeight: 1, ...border }}>
      {initialOf(name)}
    </div>
  );
}

const BAND = { good: [S.goodLight, S.goodDeep], mid: [S.midLight, S.midDeep], low: [S.lowLight, S.lowDeep] } as const;

/** The Shipping ring (ScoreRing.tsx): a navy track and the score's arc in its band's one hue, round caps, the number in Kaftan. */
export function CardRing({ score, size }: { score: number; size: number }) {
  const shown = Math.max(0, Math.min(100, Math.round(score)));
  const band = scoreBand(shown);
  const [light, deep] = BAND[band];
  // satori draws outside React's renderer (no useId): one ring per card, so the band names its gradient.
  const id = `ek-ring-${band}`;
  const view = 148;
  const c = view / 2;
  return (
    <div style={{ display: 'flex', position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${view} ${view}`}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={light} />
            <stop offset="1" stopColor={deep} />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={62} fill="none" stroke={S.navyTrack} strokeWidth={12} />
        {shown > 0 ? (
          <circle cx={c} cy={c} r={62} fill="none" stroke={`url(#${id})`} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(2 * Math.PI * 62 * shown) / 100} 1000`} transform={`rotate(-90 ${c} ${c})`} />
        ) : null}
      </svg>
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center', fontFamily: DISPLAY, fontSize: Math.round(size * 0.42), lineHeight: 1, color: S.text }}>
        {String(shown)}
      </div>
    </div>
  );
}
