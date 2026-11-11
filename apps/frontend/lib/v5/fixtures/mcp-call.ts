/**
 * An agent's call as the /mcp route makes it: the real server and its registered tools and schemas
 * (unknown keys stripped or refused before the handler runs), over an in-memory transport.
 * `reply` is the JSON the tool returned, or null for an error text.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, type McpContext } from '../mcp';

export type McpResult = { isError: boolean; text: string; reply: Record<string, unknown> | null; structured?: Record<string, unknown> };

async function connected(ctx: McpContext) {
  const server = createMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'earnkit-test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

export async function mcpCall(ctx: McpContext, name: string, args: Record<string, unknown> = {}): Promise<McpResult> {
  const client = await connected(ctx);
  try {
    // An SDK that answers invalid arguments with a JSON-RPC error (not an isError result) throws here.
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
    return { isError: r.isError === true, text, reply, ...(r.structuredContent ? { structured: r.structuredContent as Record<string, unknown> } : {}) };
  } finally {
    await client.close();
  }
}

export async function mcpListTools(ctx: McpContext) {
  const client = await connected(ctx);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

/** The server's name and version as a client sees them after initialize (L29-30, v6.1.16 Task 15). */
export async function mcpServerInfo(ctx: McpContext) {
  const client = await connected(ctx);
  try {
    return client.getServerVersion();
  } finally {
    await client.close();
  }
}

/** The server's instructions as a client sees them after initialize. */
export async function mcpInstructions(ctx: McpContext) {
  const client = await connected(ctx);
  try {
    return client.getInstructions();
  } finally {
    await client.close();
  }
}
