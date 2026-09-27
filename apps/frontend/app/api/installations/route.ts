import { createInstallation } from '@/lib/earnkit/installations';

/** Called once by the MCP server on first connect. Returns the token to keep. */
export async function POST() {
  const token = await createInstallation();
  return Response.json({ token }, { status: 201 });
}
