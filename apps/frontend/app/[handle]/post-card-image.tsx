import type { ReactNode } from 'react';
import type { PostCardFacts, PostCardView } from '../../lib/earnkit/post-card';
import { pageUrl } from '../../lib/earnkit/reserved-routes';
import { SITE as S } from '../../lib/earnkit/site-theme';
import { CardPhoto, CardWordmark, DISPLAY, SANS } from './card-parts';

/**
 * v3.1 one-tap posts, Task 5 (design 4): the card of one post, drawn with the site's v3.1 tokens (site-theme.ts SITE)
 * and its display face, Kaftan Serif, for the headline and the numbers (Funnel Sans for the words). Three layouts so
 * a builder's cards never read as one template, each echoing a profile card:
 * - `number` (a weekly, went live, news): the neutral card, "Week 6" or "Live" very large with the summary under it, and a
 *   navy panel of numbers (the Shipping card's navy);
 * - `milestone` (4, 8, 12, 26 or 52 weeks in a row): the rust Streak card, the streak number alone at 300px and the 12
 *   weeks of code as squares;
 * - `text` (a verified win, acceptance or funding; the coin): the blue hero, the program as the headline.
 * The token pill only with the builder's launched token (post-card.ts reads it live); never a price. Pure.
 * GTM W4: as the page's card, one of the site's cards on the page's dark ground (24px margin, 36px corners), the words
 * in Funnel Sans (the site's) and no label under 24px, the photo from card-parts.tsx (never GitHub's default picture:
 * the initial instead).
 */

/** At most `max` characters, cut at a word, with an ellipsis. Pure. */
export const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, '')}…`;
};
/** The headline's size: smaller as it gets longer, so a program's name stays two lines. Pure. */
export const textHeadSize = (s: string) => (s.length <= 18 ? 112 : s.length <= 30 ? 92 : s.length <= 46 ? 74 : 60);

/** The top row: the wordmark and, with a launched builder token, its pill ("$SYMBOL · N holders"). */
function Top({ backing, pill }: { backing: string | null; pill: { bg: string; fg: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <CardWordmark height={24} />
      {backing ? (
        <div style={{ display: 'flex', padding: '10px 22px', borderRadius: 999, backgroundColor: pill.bg, color: pill.fg, fontSize: 24, fontWeight: 600 }}>{backing}</div>
      ) : null}
    </div>
  );
}

/** The bottom row: the person and the page. */
function Foot({ f, ink, soft, ring }: { f: PostCardFacts; ink: string; soft: string; ring: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <CardPhoto avatar={f.avatar} name={f.name} size={56} ring={ring} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 600, color: ink, lineHeight: 1.15 }}>{clip(f.name, 34)}</div>
        <div style={{ display: 'flex', fontSize: 24, color: soft }}>{pageUrl(f.handle)}</div>
      </div>
    </div>
  );
}

function Squares({ grid, on, off, size }: { grid: boolean[]; on: string; off: string; size: number }) {
  return (
    <div style={{ display: 'flex', gap: Math.round(size / 4) }}>
      {grid.map((lit, i) => (
        <div key={i} style={{ display: 'flex', width: size, height: size, borderRadius: Math.round(size / 4), backgroundColor: lit ? on : off }} />
      ))}
    </div>
  );
}

function Frame({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', padding: 24, backgroundColor: S.page, color: S.text, fontFamily: SANS }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, padding: '40px 48px 38px', borderRadius: 36, backgroundImage: bg }}>
        {children}
      </div>
    </div>
  );
}

function NumberCard({ f, v }: { f: PostCardFacts; v: PostCardView }) {
  const stats = v.stats.slice(0, 4);
  // Four numbers sit two by two; up to three, one above the other.
  const wide = stats.length > 3;
  const rows = wide ? [stats.slice(0, 2), stats.slice(2)] : stats.map((s) => [s]);
  return (
    <Frame bg={`linear-gradient(180deg, ${S.cardTop}, ${S.cardBottom})`}>
      <Top backing={v.backing} pill={{ bg: S.blue, fg: S.onBlue }} />
      <div style={{ display: 'flex', gap: 48, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
          {v.kicker ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 400, color: S.muted }}>
              {v.big === 'Live' ? <div style={{ display: 'flex', width: 16, height: 16, borderRadius: 8, backgroundColor: S.live }} /> : null}
              {clip(v.kicker, 40)}
            </div>
          ) : null}
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: v.big.length > 8 ? 120 : wide ? 150 : 176, lineHeight: 1, letterSpacing: -4, marginTop: 6, whiteSpace: 'nowrap' }}>{v.big}</div>
          {v.sub ? <div style={{ display: 'flex', marginTop: 22, fontSize: 34, fontWeight: 400, lineHeight: 1.28, color: S.cardBody, maxWidth: 640 }}>{clip(v.sub, 110)}</div> : null}
        </div>
        {stats.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'center', gap: 26, width: wide ? 420 : 320, padding: '30px 34px', borderRadius: 36, backgroundImage: `linear-gradient(180deg, ${S.navy}, ${S.navyInner})`, border: `1px solid ${S.blueLine}` }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display: 'flex', gap: 24 }}>
                {row.map((s) => (
                  <div key={s.label} style={{ display: 'flex', flexDirection: 'column', width: wide ? 164 : 250 }}>
                    <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 56, lineHeight: 1, color: S.text }}>{s.value}</div>
                    <div style={{ display: 'flex', marginTop: 4, fontSize: 24, fontWeight: 400, color: S.onNavy }}>{s.label}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Foot f={f} ink={S.text} soft={S.dim} ring={S.lineHover} />
        {v.grid ? <Squares grid={v.grid} on={S.barOn} off={S.navyTrack} size={20} /> : null}
      </div>
    </Frame>
  );
}

function MilestoneCard({ f, v }: { f: PostCardFacts; v: PostCardView }) {
  return (
    <Frame bg={`linear-gradient(160deg, ${S.rustTop}, ${S.rustBottom})`}>
      <Top backing={v.backing} pill={{ bg: S.rustOn, fg: S.ink }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
        <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 300, lineHeight: 0.86, letterSpacing: -10, color: S.rustSoft }}>{v.big}</div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 64, lineHeight: 1, color: S.text }}>weeks in a row</div>
          {v.kicker ? <div style={{ display: 'flex', marginTop: 14, fontSize: 30, fontWeight: 400, color: S.rustLight }}>{clip(v.kicker, 40)}</div> : null}
          {v.sub ? <div style={{ display: 'flex', marginTop: 16, fontSize: 28, fontWeight: 400, lineHeight: 1.3, color: S.chipText, maxWidth: 560 }}>{clip(`This week: ${v.sub.charAt(0).toLowerCase()}${v.sub.slice(1)}`, 96)}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {v.grid ? <Squares grid={v.grid} on={S.rustOn} off={S.rustOff} size={34} /> : null}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <Foot f={f} ink={S.text} soft={S.rustSub} ring={S.rustLine} />
          <div style={{ display: 'flex', gap: 40 }}>
            {v.stats.slice(0, 3).map((s) => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 44, lineHeight: 1, color: S.text }}>{s.value}</div>
                <div style={{ display: 'flex', marginTop: 4, fontSize: 24, fontWeight: 400, color: S.rustSub }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function TextCard({ f, v }: { f: PostCardFacts; v: PostCardView }) {
  const size = textHeadSize(v.big);
  return (
    <Frame bg={`linear-gradient(150deg, ${S.blueTop}, ${S.blue} 45%, ${S.blueBottom})`}>
      <Top backing={v.backing} pill={{ bg: S.light, fg: S.ink }} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {v.kicker ? <div style={{ display: 'flex', fontSize: 32, fontWeight: 400, color: S.onBlueSoft }}>{v.kicker}</div> : null}
        <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: size, lineHeight: 1.02, letterSpacing: -size / 36, marginTop: 8, maxWidth: 1060 }}>{clip(v.big, 60)}</div>
        {v.sub ? <div style={{ display: 'flex', marginTop: 18, fontSize: 34, fontWeight: 400, color: S.onBlueSoft }}>{clip(v.sub, 70)}</div> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Foot f={f} ink={S.onBlue} soft={S.onBlueSoft} ring={S.blueButtonHover} />
        {v.stats.length ? (
          <div style={{ display: 'flex', gap: 36, padding: '20px 30px', borderRadius: 28, backgroundColor: S.inset22 }}>
            {v.stats.slice(0, 3).map((s) => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontFamily: DISPLAY, fontSize: 44, lineHeight: 1, color: S.onBlue }}>{s.value}</div>
                <div style={{ display: 'flex', marginTop: 4, fontSize: 24, fontWeight: 400, color: S.onBlueSoft }}>{s.label}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

/** The post's card, in its moment's layout. Pure. */
export function postCard(f: PostCardFacts, avatar: string | null) {
  const facts = { ...f, avatar };
  if (f.view.layout === 'milestone') return <MilestoneCard f={facts} v={f.view} />;
  if (f.view.layout === 'text') return <TextCard f={facts} v={f.view} />;
  return <NumberCard f={facts} v={f.view} />;
}
