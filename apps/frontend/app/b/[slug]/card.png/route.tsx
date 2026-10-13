import { ImageResponse } from 'next/og';
import { builderScoreEnabled } from '@/lib/earnkit/builder-score-flag';
import { SCORE_COLORS } from '@/lib/earnkit/profile-data';
import { cardModel } from '@/lib/earnkit/share';
import { cachedProfile } from '../profile-load';

const WHITE = '#F6F9FE'; // ek-white
const SOFT = '#A3C5FE'; // ek-blue-soft
const TRACK = '#112969'; // ek-navy
const RING = 360;
const STROKE = 26;
const R = (RING - STROKE) / 2 - 4;

/** The ring's arc from 12 o'clock, clockwise, `score` of 100 (as ScoreRing). Pure. */
function arcPath(score: number): string {
  const c = RING / 2;
  const a = (Math.min(99.99, score) / 100) * 2 * Math.PI;
  const x = c + R * Math.sin(a);
  const y = c - R * Math.cos(a);
  return `M ${c} ${c - R} A ${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

/**
 * v2.12 spec 7: the share card, 1200x630, the profile's ring (orange to purple on navy), "Top N% of
 * builders", the top outcome in plain words and the name. Drawn on request from the same cached,
 * per-person profile read as the page (profile-data.ts privacy rules: hidden or no public score is
 * a 404, a held day never shows, never a private repo or a wallet as the name), cached 10 minutes
 * like the page. The slug is canonical lowercase; an old slug moves to the current card.
 */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!builderScoreEnabled()) return new Response('Not found', { status: 404 });
  const slug = (await params).slug;
  const lower = slug.toLowerCase();
  const data = await cachedProfile(lower);
  if (!data) return new Response('Not found', { status: 404 });
  if ('redirect' in data || slug !== lower) {
    const to = 'redirect' in data ? data.redirect : lower;
    return new Response(null, { status: 308, headers: { Location: `/b/${encodeURIComponent(to)}/card.png`, 'Cache-Control': 'public, max-age=600' } });
  }
  if (!('score' in data)) return new Response('Not found', { status: 404 });
  const m = cardModel(data);
  const shown = Math.max(0, Math.min(100, Math.round(m.score)));
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 88px',
          backgroundColor: SCORE_COLORS.panel,
          backgroundImage: `radial-gradient(circle at 92% 8%, rgba(155, 107, 255, 0.22), transparent 42%), radial-gradient(circle at 4% 100%, rgba(255, 122, 26, 0.14), transparent 40%)`,
          color: WHITE,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 72 }}>
          <div style={{ display: 'flex', width: RING, height: RING, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} style={{ position: 'absolute', top: 0, left: 0 }}>
              <defs>
                <linearGradient id="ring" x1="0" y1="0" x2="0" y2={RING} gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor={SCORE_COLORS.from} />
                  <stop offset="1" stopColor={SCORE_COLORS.to} />
                </linearGradient>
              </defs>
              <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke={TRACK} strokeWidth={STROKE} />
              {shown > 0 ? <path d={arcPath(shown)} fill="none" stroke="url(#ring)" strokeWidth={STROKE} strokeLinecap="round" /> : null}
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 132, fontWeight: 700, lineHeight: 1, letterSpacing: -4 }}>{String(shown)}</div>
              <div style={{ fontSize: 26, color: SOFT, marginTop: 10 }}>of 100</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 34, color: SCORE_COLORS.from, fontWeight: 600 }}>{m.handle}</div>
            <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.08, marginTop: 18, letterSpacing: -1 }}>{m.top}</div>
            <div style={{ fontSize: 36, color: '#E5EEFC', marginTop: 26, lineHeight: 1.25 }}>{m.outcome}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 26, color: SOFT }}>
          <div style={{ display: 'flex' }}>Verified builder score</div>
          <div style={{ display: 'flex', color: WHITE, fontWeight: 700, fontSize: 30 }}>EarnKit</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600', 'X-Content-Type-Options': 'nosniff' } },
  );
}
