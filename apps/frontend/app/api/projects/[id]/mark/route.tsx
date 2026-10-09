import { ImageResponse } from 'next/og';
import { sql } from '@/lib/earnkit/db';
import { markFor, type Mark } from '@/lib/earnkit/token-logo';

/** The shape, centred on the gradient: plain CSS, or an SVG polygon for the hexagon. No text. */
function Shape({ shape }: { shape: Mark['shape'] }) {
  const fill = 'rgba(255,255,255,0.92)';
  if (shape === 'hexagon')
    return (
      <svg width="260" height="260" viewBox="0 0 100 100">
        <polygon points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5" fill={fill} />
      </svg>
    );
  const size = shape === 'diamond' ? 190 : 230;
  return (
    <div
      style={{
        width: size,
        height: size,
        background: fill,
        borderRadius: shape === 'circle' ? size / 2 : shape === 'square' ? 36 : 24,
        ...(shape === 'diamond' && { transform: 'rotate(45deg)' }),
      }}
    />
  );
}

/**
 * v2.10 item 12: the generated token logo, sent to tokens.fun when there is no upload and no site
 * or repo logo: a shape and gradient from the project id (markFor), never letters. A PNG drawn on
 * each request, never stored; the same id always draws the same mark, so the onchain link is stable.
 * Only a project with a token (token_symbol set at the launch claim) has one.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  const id = Number(raw);
  if (!/^\d{1,10}$/.test(raw) || !Number.isSafeInteger(id)) return new Response('Not found', { status: 404 });
  const [row] = await sql()<{ token_symbol: string | null }[]>`
    SELECT token_symbol FROM projects WHERE id = ${id}`;
  if (!row?.token_symbol) return new Response('Not found', { status: 404 });
  const mark = markFor(id);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage: `linear-gradient(${mark.angle}deg, ${mark.from}, ${mark.to})`,
        }}
      >
        <Shape shape={mark.shape} />
      </div>
    ),
    {
      width: 512,
      height: 512,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    },
  );
}
