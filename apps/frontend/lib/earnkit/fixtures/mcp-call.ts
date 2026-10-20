import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp';
import type { ToolContext, ToolName } from '../tools';

/**
 * v2.14 spec 6 (D15): an agent's call as the MCP route makes it: the real server, the real registered tools
 * and their schemas (zod parses and strips unknown keys before the handler runs), tools/call over an
 * in-memory transport. `reply` is the JSON the tool returned, or null for an error text.
 */
export type McpResult = { isError: boolean; text: string; reply: Record<string, unknown> | null };

async function connected(ctx: ToolContext, campaignOpen: boolean) {
  const server = createMcpServer(ctx, { campaignOpen });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'earnkit-test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

export async function mcpCall(
  ctx: ToolContext,
  name: ToolName,
  args: Record<string, unknown> = {},
  o: { campaignOpen?: boolean } = {},
): Promise<McpResult> {
  const client = await connected(ctx, o.campaignOpen ?? false);
  try {
    // An SDK that answers invalid arguments with a JSON-RPC error (instead of an isError result) throws here.
    const r = await client.callTool({ name, arguments: args }).catch((err: unknown) => ({
      isError: true,
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    }));
    const text = ((r.content as { type: string; text?: string }[] | undefined) ?? []).map((c) => c.text ?? '').join('');
    let reply: Record<string, unknown> | null = null;
    try {
      reply = JSON.parse(text) as Record<string, unknown>;
    } catch {
      reply = null;
    }
    return { isError: r.isError === true, text, reply };
  } finally {
    await client.close();
  }
}

export async function mcpListTools(ctx: ToolContext) {
  const client = await connected(ctx, false);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}
