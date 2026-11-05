import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { saveInstallation } from './installations';
import { POST } from '../../app/mcp/route';
import { OLD_TOOL_TEXT } from './old-tools';

after(() => sql().end());

const TEXT =
  "EarnKit's tools changed. Refresh this server's tool list, or remove and re-add the EarnKit connector. The tools are now find (what this repo can earn) and track (what the builder did).";
const token = 'ek_oldtools_' + Math.random().toString(36).slice(2);
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` };
const post = (body: unknown) => POST(new Request('https://earnkit.test/mcp', { method: 'POST', headers, body: JSON.stringify(body) }));
const call = (id: number, name: string, args: unknown = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
type Msg = { id: number; result: { isError?: boolean; content: { text: string }[] } };

test('old tool names get the refresh message as an error result', async () => {
  await saveInstallation(token, null);
  assert.equal(OLD_TOOL_TEXT, TEXT);
  for (const name of ['score', 'tell', 'prepare', 'confirm', 'list_programs', 'get_program', 'prepare_submission', 'confirm_entry', 'record_submission', 'launch_token', 'tell_earnkit']) {
    const r = await post(call(7, name, { x: 1 }));
    assert.equal(r.status, 200);
    const m = (await r.json()) as Msg;
    assert.equal(m.id, 7);
    assert.equal(m.result.isError, true);
    assert.equal(m.result.content[0].text, TEXT);
  }
});

test('find still works, and in a batch only the old call is answered directly', async () => {
  await saveInstallation(token, null);
  const init = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
  assert.equal((await post(init)).status, 200);
  const f = (await (await post(call(2, 'find', { project: { name: 'X', description: 'An app.' } }))).json()) as Msg;
  assert.notEqual(f.result.isError, true);
  assert.notEqual(f.result.content[0].text, TEXT);
  const batch = (await (await post([call(3, 'score'), call(4, 'find', { project: { name: 'X', description: 'An app.' } })])).json()) as Msg[];
  assert.equal(batch.length, 2);
  const byId = new Map(batch.map((m) => [m.id, m]));
  assert.equal(byId.get(3)!.result.content[0].text, TEXT);
  assert.equal(byId.get(3)!.result.isError, true);
  assert.notEqual(byId.get(4)!.result.content[0].text, TEXT);
});
