import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { ImageResponse } from 'next/og';
import { benchCardFacts, benchShareText, profileData } from '../../lib/earnkit/bench-data';
import { noteEvent } from '../../lib/earnkit/events';
import { postCardFacts } from '../../lib/earnkit/post-card';
import { CODE_PATTERN } from '../../lib/earnkit/post-drafts';
import { shareIntentText } from '../../lib/earnkit/page-data';
import { resolveHandle } from '../../lib/earnkit/profiles';
import { rankSplit } from '../../lib/earnkit/rank';
import { SCORE_TITLE, STREAK_TITLE } from '../../lib/earnkit/site-copy';
import { pagePath } from '../../lib/earnkit/reserved-routes';
import { CARD_CACHE } from '../../lib/earnkit/share';
import { profileSite } from '../../lib/earnkit/site-data';
import { SITE as S } from '../../lib/earnkit/site-theme';
import { shareCardFacts, type CardProject, type CardTile, type ShareCardFacts } from './card-facts';
import { CardMark, CardPhoto, CardRing, DISPLAY, SANS } from './card-parts';
import { postCard } from './post-card-image';

/** The wordmark (card-parts.tsx), kept here for scripts/og.mts. */
export { CardWordmark } from './card-parts';

/**
 * v2.12.1 spec "Card": the share card of the page at `path` and its share link, used by
 * /<handle>/card.png and /<handle>/share (and /b/<handle>/... for a reserved handle). Both check the
 * live row on every request (hidden, unclaimed or unknown: a no-store 404; another case or a rename:
 * a 308 to the page's own path), so the card follows the page at once; a shared cache may keep the
 * image 60 seconds (CARD_CACHE).
 *
 * GTM W4 (2026-10-23): the card is the profile in small, in the v3.1 site language (DESIGN.md): the page's dark
 * ground, the blue hero (photo, name in Kaftan Serif, @handle, the project panel with its verified live host and
 * quiet facts, earnkit.com/<handle> with the mark), and beside it up to two big facts as the profile's own cards
 * (card-facts.ts: the navy Shipping ring while ranked, the white Token card (holders), a win, the rust streak; the commits
 * tile went with Highlights' commit count, v3.1 Highlights competence), and one of the site's paintings in a slot no fact fills. No confirmed project: one calm line in
 * the hero. Drawn to read at X's phone preview (about 0.42 of 1200px): nothing under 24px.
 */

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** The live row behind `handle` at `path`: the person, or the 404 or 308 (to `<page>/<suffix>`) to send. */
export async function live(handle: string, path: string, suffix: string): Promise<{ builderId: number; handle: string } | Response> {
  const r = await resolveHandle(handle);
  if (!r) return notFound();
  const move = (to: string) => new Response(null, { status: 308, headers: { Location: `${to}/${suffix}`, 'Cache-Control': 'no-store' } });
  if ('redirect' in r) return move(r.redirect);
  if (pagePath(r.handle) !== path) return move(pagePath(r.handle));
  return r;
}

export type CardFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: 'normal' };

// Read once per process from assets/fonts: Funnel Sans 400 and 600 (OFL; static instances of app/fonts' variable face,
// as woff, which the image renderer reads) and Kaftan Serif (owner-owned licence; app/fonts/kaftan-serif.woff2 as woff). A missing file draws the default font.
const FONT_FILES: { name: string; file: string; weight: CardFont['weight'] }[] = [
  { name: 'Funnel Sans', file: 'funnel-sans-latin-400.woff', weight: 400 },
  { name: 'Funnel Sans', file: 'funnel-sans-latin-600.woff', weight: 600 },
  { name: 'Kaftan Serif', file: 'kaftan-serif.woff', weight: 400 },
];
let fonts: Promise<CardFont[]> | null = null;
export function loadFonts() {
  fonts ??= (async () => {
    const out: CardFont[] = [];
    for (const f of FONT_FILES) {
      for (const dir of [join(process.cwd(), 'assets/fonts'), join(process.cwd(), 'apps/frontend/assets/fonts')]) {
        try {
          const b = await readFile(join(dir, f.file));
          out.push({ name: f.name, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, weight: f.weight, style: 'normal' });
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

/**
 * GitHub's default picture (the octocat on grey, or a generated identicon) is a 420x420 PNG whatever size is asked
 * for; an uploaded picture comes back at the size asked (page-data avatarUrl asks for 200). So a 420x420 PNG from
 * GitHub's avatars host is the default, and the card draws the initial instead. Pure.
 */
export function githubDefault(url: string, type: string, buf: Uint8Array): boolean {
  if (type !== 'image/png' || !/^https:\/\/avatars\.githubusercontent\.com\//.test(url) || buf.byteLength < 24) return false;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return dv.getUint32(16) === 420 && dv.getUint32(20) === 420;
}

// The picture as a data URL, kept 10 minutes per URL (at most 200): X's own host or GitHub's avatars host only (page-data avatarUrl), 3 s, 1 MB, jpeg or png; never GitHub's default picture.
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
      if (buf.byteLength > 0 && buf.byteLength <= 1_000_000 && !githubDefault(url, type, buf)) data = `data:${type};base64,${buf.toString('base64')}`;
    }
  } catch {
    data = null;
  }
  if (avatars.size >= 200) avatars.delete(avatars.keys().next().value!);
  avatars.set(url, { at: Date.now(), data });
  return data;
}

/** The name's size in Kaftan Serif: as large as fits one line in the hero (wide: the hero alone), two for the longest. Pure. */
export const nameSize = (name: string, wide: boolean) => {
  const n = name.length;
  if (wide) return n <= 17 ? 104 : n <= 22 ? 84 : 64;
  return n <= 13 ? 80 : n <= 16 ? 68 : n <= 20 ? 56 : 44;
};
/** At most `max` characters, cut at a word, with an ellipsis. Pure. */
const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, '')}…`;
};

/** The quiet facts as one line that fits the panel (about 36 characters at 26px): the first, and the second when it fits. Pure. */
export const factsLine = (facts: string[]) => facts.reduce((line, x) => (!line ? x : `${line} · ${x}`.length <= 36 ? `${line} · ${x}` : line), '');

const PAD = 24;
const GAP = 16;
const SIDE = 404;
const INNER_H = 630 - 2 * PAD;

/** One of the profile's cards: its fill, 36px corners. */
function Card({ bg, border, width, height, pad = 32, children }: { bg: string; border?: string; width: number; height: number; pad?: number; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width, height, padding: pad, borderRadius: 36, backgroundColor: bg, ...(border ? { border: `2px solid ${border}` } : {}) }}>
      {children}
    </div>
  );
}

/** Base's official blue square in a white tile (the profile's BaseTile). */
function BaseTile() {
  return (
    <div style={{ display: 'flex', width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: S.light }}>
      <div style={{ display: 'flex', width: 18, height: 18, borderRadius: 3, backgroundColor: S.baseBlue }} />
    </div>
  );
}

/** The project panel inside the hero: its letter tile, the name, the verified live host, the quiet facts. */
function ProjectPanel({ p }: { p: CardProject }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: 26, borderRadius: 28, backgroundColor: S.inset }}>
      <div style={{ display: 'flex', width: 88, height: 88, flexShrink: 0, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: p.earnkit ? S.light : p.color, fontFamily: DISPLAY, fontSize: 48, lineHeight: 1, color: S.text }}>
        {p.earnkit ? <CardMark size={44} color={S.blue} /> : p.letter}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: p.name.length > 15 ? 40 : 50, lineHeight: 1, color: S.onBlue }}>{clip(p.name, 22)}</div>
          {p.onBase ? <BaseTile /> : null}
        </div>
        {p.live ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 28, fontWeight: 600, color: S.onBlue }}>
            <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 7, backgroundColor: S.live, border: `2px solid ${S.onBlue}` }} />
            {clip(p.live, 30)}
          </div>
        ) : null}
        {p.facts.length ? <div style={{ display: 'flex', fontSize: 26, color: S.onBlueSoft }}>{factsLine(p.facts)}</div> : null}
      </div>
    </div>
  );
}

/** The blue hero: photo, name and @handle; the project panel or the calm line; the page's address with the mark. */
function Hero({ f, avatar, wide }: { f: ShareCardFacts; avatar: string | null; wide: boolean }) {
  const size = nameSize(f.name, wide);
  const width = wide ? 1200 - 2 * PAD : 1200 - 2 * PAD - GAP - SIDE;
  const named = f.name !== `@${f.handle}`;
  return (
    <Card bg={S.blue} width={width} height={INNER_H} pad={40}>
      <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'flex-start', gap: wide ? 32 : 28 }}>
        <CardPhoto avatar={avatar} name={f.name} size={wide ? 136 : 96} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: size, lineHeight: 1, letterSpacing: -size / 60, color: S.onBlue }}>{clip(f.name, 40)}</div>
          {named ? <div style={{ display: 'flex', fontSize: 30, color: S.onBlueSoft }}>@{f.handle}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 24 }} />
      {f.project ? (
        <ProjectPanel p={f.project} />
      ) : f.idle ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '28px 30px', borderRadius: 28, backgroundColor: S.inset }}>
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: f.idle.line.length > 18 ? 44 : 56, lineHeight: 1, color: S.onBlue }}>{f.idle.line}</div>
          {f.idle.sub ? <div style={{ display: 'flex', fontSize: 26, color: S.onBlueSoft }}>{f.idle.sub}</div> : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, fontSize: 26, color: S.onBlueSoft }}>
        <CardMark size={26} color={S.onBlue} />
        {f.url}
      </div>
    </Card>
  );
}

/** Twelve weeks of code as squares (the Streak card's). */
function Weeks({ grid }: { grid: boolean[] }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {grid.map((on, i) => (
        <div key={i} style={{ display: 'flex', width: 22, height: 22, borderRadius: 6, backgroundColor: on ? S.rustOn : S.rustOff }} />
      ))}
    </div>
  );
}

/** One big fact beside the hero, drawn as the profile's card for it. */
function Tile({ t, height, grid }: { t: CardTile; height: number; grid: boolean[] }) {
  const tall = height > 400;
  switch (t.kind) {
    case 'score': {
      const r = t.rank ? rankSplit(t.rank) : null;
      return (
        <Card bg={S.navy} width={SIDE} height={height}>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, color: S.text }}>{SCORE_TITLE}</div>
          <div style={{ display: 'flex', flexDirection: tall ? 'column' : 'row', alignItems: tall ? 'flex-start' : 'center', gap: 24, flex: 1, marginTop: 16 }}>
            <CardRing score={t.score} size={tall ? 220 : 148} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {r ? <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: r.lead.length > 4 ? 46 : 56, lineHeight: 1, color: S.text }}>{r.lead}</div> : null}
              <div style={{ display: 'flex', fontSize: 26, color: S.onNavy }}>{r ? (r.rest ?? '') : 'out of 100'}</div>
            </div>
          </div>
        </Card>
      );
    }
    case 'backing':
      return (
        <Card bg={S.light} width={SIDE} height={height}>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, color: S.inkBody }}>Token</div>
          <div style={{ display: 'flex', flex: 1 }} />
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: t.symbol.length > 6 ? 64 : 84, lineHeight: 1, color: S.ink }}>${t.symbol}</div>
          {t.backers !== null ? <div style={{ display: 'flex', marginTop: 10, fontSize: 26, color: S.inkMuted }}>{`${t.backers.toLocaleString('en-US')} holders`}</div> : null}
        </Card>
      );
    case 'won':
      return (
        <Card bg={S.cardTop} border={S.line} width={SIDE} height={height}>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, color: S.cardBody }}>Won</div>
          <div style={{ display: 'flex', flex: 1 }} />
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: t.program.length > 24 ? 40 : 52, lineHeight: 1.05, color: S.text }}>{clip(t.program, 44)}</div>
          {t.when ? <div style={{ display: 'flex', marginTop: 10, fontSize: 24, color: S.cardBody }}>{t.when}</div> : null}
        </Card>
      );
    case 'streak':
      return (
        <Card bg={S.rust} width={SIDE} height={height}>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 600, color: S.rustSoft }}>{STREAK_TITLE}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, flex: 1 }}>
            <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: tall ? 220 : 140, lineHeight: 0.8, color: S.rustSoft }}>{String(t.weeks)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', fontFamily: DISPLAY, fontSize: 34, lineHeight: 1.05, color: S.text, paddingBottom: 4 }}>
              <div style={{ display: 'flex' }}>{t.weeks === 1 ? 'week' : 'weeks'}</div>
              <div style={{ display: 'flex' }}>in a row</div>
            </div>
          </div>
          <div style={{ display: 'flex', marginTop: 22 }}>
            <Weeks grid={grid} />
          </div>
        </Card>
      );
  }
}

/** The paintings the card can hang (public/art, the site's own, public domain), as data URLs; null when unread. */
export type CardArt = { tall: string | null; half: string | null };

/**
 * A painting in a card-sized frame, cropped to cover it around a point (`x`, `y`: 0 to 1 across the picture). The
 * site's paintings, never a drawing: the Eckersberg arches stand tall, the Panini oculus sits in a half.
 */
function Painting({ src, w, h, natural, x, y }: { src: string; w: number; h: number; natural: [number, number]; x: number; y: number }) {
  const k = Math.max(w / natural[0], h / natural[1]);
  const [iw, ih] = [Math.ceil(natural[0] * k), Math.ceil(natural[1] * k)];
  const left = -Math.round(Math.min(iw - w, Math.max(0, iw * x - w / 2)));
  const top = -Math.round(Math.min(ih - h, Math.max(0, ih * y - h / 2)));
  return (
    <div style={{ display: 'flex', position: 'relative', width: w, height: h, borderRadius: 36, overflow: 'hidden', backgroundColor: S.panel }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- satori draws a plain img */}
      <img src={src} width={iw} height={ih} alt="" style={{ position: 'absolute', left, top, width: iw, height: ih }} />
    </div>
  );
}
/** The Eckersberg (1600x1036) on its middle arch; the Panini (700x383) on the oculus. */
export const ART_FILES = { tall: 'hero-eckersberg-1600.jpg', half: 'foot-panini-700.jpg' } as const;
const ART_SIZE = { tall: [1600, 1036] as [number, number], half: [700, 383] as [number, number] };

/**
 * The page's share card (GTM W4): the blue hero and, beside it, two slots: up to two of the profile's cards for its
 * strongest verified facts (card-facts.ts), and a painting in any slot left (two facts: none; one: the Panini oculus
 * under it; none: the Eckersberg arches, tall). Without the painting the hero takes the width. `grid`: the last 12 weeks
 * of code, for the streak card's squares. Pure.
 */
export function benchCard(f: ShareCardFacts, avatar: string | null, grid: boolean[] = [], art: CardArt = { tall: null, half: null }) {
  const tiles = f.tiles;
  const half = (INNER_H - GAP) / 2;
  const hang = tiles.length === 0 ? art.tall : tiles.length === 1 ? art.half : null;
  const side = tiles.length > 0 || hang !== null;
  const tileH = tiles.length === 1 && !hang ? INNER_H : half;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', gap: GAP, padding: PAD, backgroundColor: S.page, color: S.text, fontFamily: SANS }}>
      <Hero f={f} avatar={avatar} wide={!side} />
      {side ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
          {tiles.map((t) => (
            <Tile key={t.kind} t={t} height={tileH} grid={grid} />
          ))}
          {hang && tiles.length === 0 ? <Painting src={hang} w={SIDE} h={INNER_H} natural={ART_SIZE.tall} x={0.5} y={0.42} /> : null}
          {hang && tiles.length === 1 ? <Painting src={hang} w={SIDE} h={half} natural={ART_SIZE.half} x={0.56} y={0.3} /> : null}
        </div>
      ) : null}
    </div>
  );
}

let art: Promise<CardArt> | null = null;
/** The paintings, read once per process from public/art; a missing file is null (the card then goes without). */
export function loadArt(): Promise<CardArt> {
  art ??= (async () => {
    const read = async (file: string) => {
      for (const dir of [join(process.cwd(), 'public/art'), join(process.cwd(), 'apps/frontend/public/art')]) {
        try {
          return `data:image/jpeg;base64,${(await readFile(join(dir, file))).toString('base64')}`;
        } catch {
          // Try the next place.
        }
      }
      return null;
    };
    return { tall: await read(ART_FILES.tall), half: await read(ART_FILES.half) };
  })();
  return art;
}

/** The share card's facts and the 12 weeks of code, from the page's own reads (profileData, profileSite); null without a claim. */
export async function shareCardRead(builderId: number, now = new Date()): Promise<{ facts: ShareCardFacts; grid: boolean[] } | null> {
  const d = await profileData(builderId, now);
  if (!d) return null;
  const site = await profileSite(builderId, d, now);
  return { facts: shareCardFacts(d, site), grid: d.grid.slice(-12).map((g) => g.on) };
}

/**
 * The card at `path`. v3.1 one-tap posts (Task 5): with `m`, a post's code on this page, that post's card
 * (post-card.ts); an unknown code, another person's or a moment without a card of its own draws the page's card.
 */
export async function cardResponse(handle: string, path: string, m: string | null = null): Promise<Response> {
  const code = m && CODE_PATTERN.test(m) ? m : null;
  // A rename or another case keeps the post's card (the code is checked before it goes in the Location).
  const who = await live(handle, path, code ? `card.png?m=${code}` : 'card.png');
  if (who instanceof Response) return who;
  const headers = { 'Cache-Control': CARD_CACHE, 'X-Content-Type-Options': 'nosniff' };
  const post = code ? await postCardFacts(who.builderId, code) : null;
  if (post) {
    const [font, avatar] = await Promise.all([loadFonts(), avatarData(post.avatar)]);
    return new ImageResponse(postCard(post, avatar), { width: 1200, height: 630, ...(font.length ? { fonts: font } : {}), headers });
  }
  const read = await shareCardRead(who.builderId);
  if (!read) return notFound();
  const [font, avatar, paintings] = await Promise.all([loadFonts(), avatarData(read.facts.avatar), loadArt()]);
  return new ImageResponse(benchCard(read.facts, avatar, read.grid, paintings), { width: 1200, height: 630, ...(font.length ? { fonts: font } : {}), headers });
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
