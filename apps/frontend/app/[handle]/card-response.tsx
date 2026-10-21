import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { WORDMARK_D } from '../components/ui/Logo';
import { benchCardFacts, benchShareText, dollars, streakWords, type BenchCardFacts } from '../../lib/earnkit/bench-data';
import { noteEvent } from '../../lib/earnkit/events';
import { shareIntentText } from '../../lib/earnkit/page-data';
import { resolveHandle } from '../../lib/earnkit/profiles';
import { rankSplit } from '../../lib/earnkit/rank';
import { pagePath, pageUrl } from '../../lib/earnkit/reserved-routes';
import { CARD_CACHE } from '../../lib/earnkit/share';
import { THEME as T } from '../../lib/earnkit/theme';

/**
 * v2.12.1 spec "Card": the share card of the page at `path` and its share link, used by
 * /<handle>/card.png and /<handle>/share (and /b/<handle>/... for a reserved handle). Both check the
 * live row on every request (hidden, unclaimed or unknown: a no-store 404; another case or a rename:
 * a 308 to the page's own path), so the card follows the page at once; a shared cache may keep the
 * image 60 seconds (CARD_CACHE).
 *
 * v3 Stage 3 Task 6 (spec 5.8): the card draws the flat system from THEME: a black card, white type, one accent,
 * hairlines; the wordmark top left, the Backing pill top right, the name and @handle, the rank line as the headline,
 * then the numbers (Shipping, and Earned when there is money), the project and streak, the page URL.
 */

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

export type CardFont = { name: string; data: ArrayBuffer; weight: 500 | 700; style: 'normal' };

// Funnel Display, read once per process (assets/fonts, OFL). A missing file draws the default font.
let fonts: Promise<CardFont[]> | null = null;
export function loadFonts() {
  fonts ??= (async () => {
    const out: CardFont[] = [];
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

/** The headline's size: 64px (the rank line always fits), smaller for a long project or name so it stays two lines at X's mobile preview (about 500px wide). Pure. */
export const headlineSize = (s: string) => (s.length <= 40 ? 64 : 52);

/** The wordmark, white, at `height` px (the 124x23 viewBox of Logo.tsx). */
export function CardWordmark({ height }: { height: number }) {
  return (
    <svg viewBox="0 0 124 23" width={Math.round((height * 124) / 23)} height={height}>
      <path fillRule="evenodd" clipRule="evenodd" d={WORDMARK_D} fill={T.text} />
    </svg>
  );
}

/** The photo in a hairline ring, or the first letter on the raised spot. */
function CardPhoto({ avatar, handle }: { avatar: string | null; handle: string }) {
  const ring = `2px solid ${T.borderStrong}`;
  return avatar ? (
    // eslint-disable-next-line @next/next/no-img-element -- satori draws a plain img
    <img src={avatar} width={88} height={88} alt="" style={{ width: 88, height: 88, borderRadius: 44, objectFit: 'cover', border: ring }} />
  ) : (
    <div style={{ display: 'flex', width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: T.raised, border: ring, fontSize: 40, fontWeight: 500, color: T.text }}>
      {handle.replace(/^_+/, '').charAt(0).toUpperCase() || '?'}
    </div>
  );
}

/** One number with its word under it. */
function CardNumber({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', fontSize: 56, fontWeight: 500, lineHeight: 1, letterSpacing: -1.5, color: T.text }}>{value}</div>
      <div style={{ display: 'flex', marginTop: 10, fontSize: 28, fontWeight: 500, color: T.muted }}>{label}</div>
    </div>
  );
}

/**
 * v2.13 spec "Card (OG image)", v3 Task 6: the wordmark and the Backing pill, the photo, the name and @handle, the rank
 * line as the headline ("#3 of 40 builders"; without a rank the project, else the name), the numbers under it
 * (Shipping, and Earned from $1; none without a rank), the project and the streak, the page URL. Pure.
 */
export function benchCard(f: BenchCardFacts, avatar: string | null, font: boolean) {
  const streak = streakWords(f.streak);
  const named = f.name !== `@${f.handle}`;
  // v3.1 F3: under RANK_MIN_POOL the score line is "Shipping 60" alone: no rank headline, the numbers still show.
  const words = f.bench ? f.bench.replace(/^Shipping \d+(?: · |$)/, '') : '';
  const rank = words ? rankSplit(words) : null;
  const big = rank ? `${rank.lead}${rank.rest ? ` ${rank.rest}` : ''}` : (f.project ?? f.name);
  const size = headlineSize(big);
  const numbers: [string, string][] = f.bench && f.score !== null
    ? [[String(f.score), 'Shipping'], ...(f.earned !== null && f.earned > 0 ? [[dollars(f.earned), 'Earned'] as [string, string]] : [])]
    : [];
  const foot = [rank ? f.project : null, streak].filter(Boolean).join(' · ');
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '52px 64px 48px',
        backgroundColor: T.page,
        color: T.text,
        fontFamily: font ? 'Funnel Display' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <CardWordmark height={26} />
        {f.raising ? (
          <div style={{ display: 'flex', padding: '10px 22px', borderRadius: 999, border: `2px solid ${T.borderStrong}`, color: T.accent, fontSize: 26, fontWeight: 500 }}>Backing · ${f.raising}</div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <CardPhoto avatar={avatar} handle={f.handle} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 500, letterSpacing: -1, lineHeight: 1.1, maxWidth: 900 }}>{f.name}</div>
          {named ? <div style={{ display: 'flex', fontSize: 28, fontWeight: 500, color: T.muted }}>@{f.handle}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: size, fontWeight: 500, lineHeight: 1.05, letterSpacing: -size / 32, maxWidth: 1072 }}>{big}</div>
        {numbers.length ? (
          <div style={{ display: 'flex', gap: 72, marginTop: 36 }}>
            {numbers.map(([value, label]) => (
              <CardNumber key={label} value={value} label={label} />
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 30, fontWeight: 500 }}>
        <div style={{ display: 'flex', color: T.body, maxWidth: 700 }}>{foot}</div>
        <div style={{ display: 'flex', color: T.muted }}>{pageUrl(f.handle)}</div>
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
  // v2.13: the post says what the card shows (benchShareText). Task 7: no Earned read here; the text never carries it.
  const f = await benchCardFacts(who.builderId, { money: false });
  if (!f) return notFound();
  const location = shareIntentText(who.handle, benchShareText(f));
  const day = new Date().toISOString().slice(0, 10);
  await noteEvent('card_shared', () => ({ type: 'card_shared', dedupe_key: `card_shared:${who.builderId}:${day}`, installation_id: who.builderId }));
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
