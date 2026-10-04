import { ImageResponse } from 'next/og';
import { sql } from '@/lib/earnkit/db';
import { monogramFor } from '@/lib/earnkit/token-proposal';

/**
 * The default token logo (v2.3 §2): the ticker's first letters on a colour from the project id.
 * The link carries the ticker (`?s=SYMBOL`) and must match the stored one, so the year-long
 * immutable cache can never serve one ticker's logo for another.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new Response('Not found', { status: 404 });
  const [row] = await sql()<{ token_symbol: string | null }[]>`
    SELECT token_symbol FROM projects WHERE id = ${id}`;
  // Only a validated ticker is ever drawn; never free text.
  if (!row?.token_symbol || !/^[A-Z0-9]{3,6}$/.test(row.token_symbol))
    return new Response('Not found', { status: 404 });
  if (new URL(req.url).searchParams.get('s') !== row.token_symbol)
    return new Response('Not found', { status: 404 });
  const { letters, background } = monogramFor(id, row.token_symbol);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background, color: '#FFFFFF', fontSize: letters.length > 2 ? 190 : 240, fontWeight: 700, letterSpacing: -4 }}>
        {letters}
      </div>
    ),
    { width: 512, height: 512, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  );
}
