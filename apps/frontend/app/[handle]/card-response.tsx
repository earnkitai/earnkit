import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { benchCardFacts, benchShareText, streakWords, type BenchCardFacts } from '../../lib/earnkit/bench-data';
import { noteEvent } from '../../lib/earnkit/events';
import { shareIntentText } from '../../lib/earnkit/page-data';
import { resolveHandle } from '../../lib/earnkit/profiles';
import { pagePath, pageUrl } from '../../lib/earnkit/reserved-routes';
import { CARD_CACHE } from '../../lib/earnkit/share';

/**
 * v2.12.1 spec "Card": the share card of the page at `path` and its share link, used by
 * /<handle>/card.png and /<handle>/share (and /b/<handle>/... for a reserved handle). Both check the
 * live row on every request (hidden, unclaimed or unknown: a no-store 404; another case or a rename:
 * a 308 to the page's own path), so the card follows the page at once; a shared cache may keep the
 * image 60 seconds (CARD_CACHE).
 */

const NAVY = '#0F1839'; // ek-navy-deep
const WHITE = '#F6F9FE'; // ek-white
const SOFT = '#A3C5FE'; // ek-blue-soft
const ORANGE = '#FF7A1A'; // ek-score-orange
const PURPLE = '#9B6BFF'; // ek-score-purple: shapes only, never text on the card's navy
const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** The live row behind `handle` at `path`: the person, or the 404 or 308 to send. */
async function live(handle: string, path: string, suffix: string): Promise<{ builderId: number; handle: string } | Response> {
  const r = await resolveHandle(handle);
  if (!r) return notFound();
  const move = (to: string) => new Response(null, { status: 308, headers: { Location: `${to}/${suffix}`, 'Cache-Control': 'no-store' } });
  if ('redirect' in r) return move(r.redirect);
  if (pagePath(r.handle) !== path) return move(pagePath(r.handle));
  return r;
}

// Funnel Display, read once per process (assets/fonts, OFL). A missing file draws the default font.
let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 500 | 700; style: 'normal' }[]> | null = null;
function loadFonts() {
  fonts ??= (async () => {
    const out: { name: string; data: ArrayBuffer; weight: 500 | 700; style: 'normal' }[] = [];
    for (const weight of [500, 700] as const) {
      for (const dir of [join(process.cwd(), 'assets/fonts'), join(process.cwd(), 'apps/frontend/assets/fonts')]) {
        try {
          const b = await readFile(join(dir, `funnel-display-latin-${weight}.woff`));
          out.push({ name: 'Funnel Display', data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, weight, style: 'normal' });
          break;
        } catch {
          // Try the next place.
        }
      }
    }
    return out;
  })();
  return fonts;
}

// The X picture as a data URL, kept 10 minutes per URL (at most 200): X's own host only (page-data avatarUrl), 3 s, 1 MB, jpeg or png.
const AVATAR_TTL_MS = 10 * 60_000;
const avatars = new Map<string, { at: number; data: string | null }>();
export async function avatarData(url: string | null, f: typeof fetch = fetch): Promise<string | null> {
  if (!url) return null;
  const hit = avatars.get(url);
  if (hit && Date.now() - hit.at < AVATAR_TTL_MS) return hit.data;
  let data: string | null = null;
  try {
    const res = await f(url, { signal: AbortSignal.timeout(3_000), redirect: 'error' });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (res.ok && (type === 'image/jpeg' || type === 'image/png')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > 0 && buf.byteLength <= 1_000_000) data = `data:${type};base64,${buf.toString('base64')}`;
    }
  } catch {
    data = null;
  }
  if (avatars.size >= 200) avatars.delete(avatars.keys().next().value!);
  avatars.set(url, { at: Date.now(), data });
  return data;
}

/** The headline's size by its length: one or two lines at X's mobile preview (about 500px wide). Pure. */
export const headlineSize = (s: string) => (s.length <= 24 ? 92 : s.length <= 34 ? 76 : s.length <= 48 ? 64 : 52);

/** The photo in its orange to purple ring, or the first letter on navy. */
function CardPhoto({ avatar, handle }: { avatar: string | null; handle: string }) {
  return (
    <div style={{ display: 'flex', width: 120, height: 120, borderRadius: 60, padding: 5, backgroundImage: `linear-gradient(135deg, ${ORANGE}, ${PURPLE})` }}>
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- satori draws a plain img
        <img src={avatar} width={110} height={110} alt="" style={{ width: 110, height: 110, borderRadius: 55, objectFit: 'cover', border: `4px solid ${NAVY}` }} />
      ) : (
        <div style={{ display: 'flex', width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center', backgroundColor: '#112969', border: `4px solid ${NAVY}`, fontSize: 52, fontWeight: 700, color: WHITE }}>
          {handle.replace(/^_+/, '').charAt(0).toUpperCase() || '?'}
        </div>
      )}
    </div>
  );
}

/**
 * v2.13 spec "Card (OG image)": the photo, the name, the score line ("Shipping 62 · Top 4% of builders this week", else nothing), the
 * project's name and the streak, and "Community round $X" while the pill shows. Pure.
 */
export function benchCard(f: BenchCardFacts, avatar: string | null, font: boolean) {
  const streak = streakWords(f.streak);
  const named = f.name !== `@${f.handle}`;
  const big = f.bench ?? f.project ?? f.name;
  const size = headlineSize(big);
  const foot = [f.bench ? f.project : null, streak].filter(Boolean).join(' · ');
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 76px 56px',
        backgroundColor: NAVY,
        backgroundImage: 'radial-gradient(circle at 96% 0%, rgba(155, 107, 255, 0.30), transparent 46%), radial-gradient(circle at 0% 100%, rgba(255, 122, 26, 0.16), transparent 42%)',
        color: WHITE,
        fontFamily: font ? 'Funnel Display' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <CardPhoto avatar={avatar} handle={f.handle} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', fontSize: 48, fontWeight: 700, letterSpacing: -0.5, maxWidth: 640 }}>{f.name}</div>
            {named ? <div style={{ display: 'flex', fontSize: 30, fontWeight: 500, color: SOFT }}>@{f.handle}</div> : null}
          </div>
        </div>
        {f.raising ? (
          <div style={{ display: 'flex', padding: '12px 26px', borderRadius: 40, border: `3px solid ${ORANGE}`, color: ORANGE, fontSize: 30, fontWeight: 700 }}>Community round ${f.raising}</div>
        ) : null}
      </div>
      <div style={{ display: 'flex', fontSize: size, fontWeight: 700, lineHeight: 1.04, letterSpacing: -size / 36, maxWidth: 1048 }}>{big}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 30, fontWeight: 500 }}>
        <div style={{ display: 'flex', color: WHITE, maxWidth: 700 }}>{foot}</div>
        <div style={{ display: 'flex', color: SOFT }}>{pageUrl(f.handle)}</div>
      </div>
    </div>
  );
}

export async function cardResponse(handle: string, path: string): Promise<Response> {
  const who = await live(handle, path, 'card.png');
  if (who instanceof Response) return who;
  const f = await benchCardFacts(who.builderId);
  if (!f) return notFound();
  const [font, avatar] = await Promise.all([loadFonts(), avatarData(f.avatar)]);
  return new ImageResponse(benchCard(f, avatar, font.length > 0), {
    width: 1200, height: 630, ...(font.length ? { fonts: font } : {}), headers: { 'Cache-Control': CARD_CACHE, 'X-Content-Type-Options': 'nosniff' },
  });
}

/**
 * The share link the builder opens: records card_shared (once per person per day) and 302s to the X
 * intent built here (the card's headline and the page). The target is never read from the request.
 */
export async function shareResponse(handle: string, path: string): Promise<Response> {
  const who = await live(handle, path, 'share');
  if (who instanceof Response) return who;
  // v2.13: the post says what the card shows (benchShareText).
  const f = await benchCardFacts(who.builderId);
  if (!f) return notFound();
  const location = shareIntentText(who.handle, benchShareText(f));
  const day = new Date().toISOString().slice(0, 10);
  await noteEvent('card_shared', () => ({ type: 'card_shared', dedupe_key: `card_shared:${who.builderId}:${day}`, installation_id: who.builderId }));
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
