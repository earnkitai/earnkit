import { ZodError } from 'zod';
import { touchInstallation } from '@/lib/earnkit/installations';
import { NotFoundError } from '@/lib/earnkit/programs';
import { isToolName, tools } from '@/lib/earnkit/tools';

export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!isToolName(tool)) return Response.json({ error: `Unknown tool "${tool}"` }, { status: 404 });

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !(await touchInstallation(token))) {
    return Response.json({ error: 'Missing or unknown installation token' }, { status: 401 });
  }

  const input = await request.json().catch(() => ({}));
  try {
    return Response.json(await tools[tool](input));
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'Invalid input', issues: err.issues }, { status: 400 });
    }
    if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
