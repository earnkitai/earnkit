import { sql } from '@/lib/earnkit/db';

/** Token images uploaded through launch_token (EarnKit hosts them for tokens.fun). */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new Response('Not found', { status: 404 });
  const [row] = await sql()<
    { token_image: Buffer | null; token_image_type: string | null }[]
  >`
    SELECT token_image, token_image_type FROM projects WHERE id = ${id}`;
  if (!row?.token_image || !row.token_image_type)
    return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(row.token_image), {
    headers: {
      'Content-Type': row.token_image_type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
