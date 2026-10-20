import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AddToAgent, { AGENTS } from '../../app/components/sections/AddToAgent';
import { logoFileProblem } from './program-file';

// v2.8 Ruling 18 (plan), Ruling C1: the install tabs (Muse kept as the 5th), local icons, no
// editor tab anywhere, and llms.txt telling agents the same.

// The app's JSX uses the classic runtime under tsx (as in public-pages.test.ts).
(globalThis as { React?: typeof React }).React = React;

const FRONTEND = join(import.meta.dirname, '../..');
const PUBLIC = join(FRONTEND, 'public');
const html = renderToStaticMarkup(React.createElement(AddToAgent, { onClose: () => {} }));
const llms = readFileSync(join(import.meta.dirname, 'llms/v213.txt'), 'utf8');
const readme = readFileSync(join(FRONTEND, '../../README.md'), 'utf8');
const byName = (name: string) => AGENTS.find((a) => a.name === name)!;

const CLAUDE_CODE = 'claude mcp add --transport http --scope user earnkit https://earnkit.com/mcp';
const CODEX = 'codex mcp add earnkit --url https://earnkit.com/mcp';

test('the tabs are Grok Bot, Claude Code, Cursor, Codex, Muse; Grok Bot is selected first', () => {
  assert.deepEqual(AGENTS.map((a) => a.name), ['Grok Bot', 'Claude Code', 'Cursor', 'Codex', 'Muse']);
  const first = html.match(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>(.*?)<\/button>/);
  assert.ok(first, 'a selected tab');
  assert.match(first[1], /Grok Bot$/);
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
});

test('Claude Code: user scope, then /mcp and Authenticate (the menu item Claude Code shows)', () => {
  const cc = byName('Claude Code');
  assert.equal(cc.code, CLAUDE_CODE);
  assert.equal(cc.after, 'Then open Claude Code, type /mcp, pick earnkit, choose Authenticate.');
});

test('Codex: codex mcp add with the EarnKit URL, then log in', () => {
  const cx = byName('Codex');
  assert.ok(cx.code?.startsWith('codex mcp add earnkit'), cx.code);
  assert.ok(cx.code?.includes('https://earnkit.com/mcp'));
  assert.equal(cx.code, CODEX);
  assert.equal(cx.after, 'Then sign in:');
  // Fix round 1: the login command can be copied too.
  assert.equal(cx.afterCode, 'codex mcp login earnkit');
  const src = readFileSync(join(FRONTEND, 'app/components/sections/AddToAgent.tsx'), 'utf8');
  assert.match(src, /<CopyButton text=\{agent\.afterCode\}/);
});

test('Cursor points at ~/.cursor/mcp.json; commands wrap only at spaces', () => {
  assert.deepEqual(byName('Cursor').steps, ['Or add this to ~/.cursor/mcp.json:']);
  const src = readFileSync(join(FRONTEND, 'app/components/sections/AddToAgent.tsx'), 'utf8');
  assert.doesNotMatch(src, /overflow-wrap:anywhere|break-all/);
});

test('every icon is a local file logoFileProblem accepts, rendered as a decorative 20px img', () => {
  for (const a of AGENTS) {
    assert.match(a.icon, /^\/images\/agents\/[a-z-]+\.(svg|png)$/, a.name);
    const file = join(PUBLIC, a.icon);
    assert.ok(existsSync(file), `${a.name}: ${file}`);
    assert.equal(logoFileProblem(a.icon, readFileSync(file)), null, a.name);
    assert.ok(html.includes(`<img src="${a.icon}" alt="" width="20" height="20"`), a.name);
  }
  // Never fetched from elsewhere at runtime.
  assert.doesNotMatch(html, /<img[^>]*src="https?:/);
});

test('v2.8.1 (owner): Grok Bot shows its own app icon (not Grok\'s logomark); Muse shows its official logo, not a placeholder', () => {
  assert.equal(byName('Grok Bot').icon, '/images/agents/grok-bot.png');
  assert.ok(!existsSync(join(PUBLIC, '/images/agents/grok.svg')), "Grok's logomark is gone");
  const png = readFileSync(join(PUBLIC, '/images/agents/grok-bot.png'));
  assert.equal(png.readUInt32BE(16), 64, 'a 64px icon for a 20px tab');
  const muse = readFileSync(join(PUBLIC, byName('Muse').icon), 'utf8');
  assert.doesNotMatch(muse, /<text\b/, 'no letter placeholder');
  assert.match(muse, /<path d="M24\.6257 16\.1214/, "Muse's mark from muse.ai");
  // The app icon keeps its colors; SVG marks take the tab's color.
  assert.match(html, /<img src="\/images\/agents\/grok-bot\.png" alt="" width="20" height="20" class="[^"]*rounded-\[5px\]/);
  assert.doesNotMatch(html, /<img src="\/images\/agents\/grok-bot\.png"[^>]*brightness-0/);
});

/** Every non-test source file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no editor tab anywhere: the modal, llms.txt, the README, app/ and lib/', () => {
  const files = [...sources(join(FRONTEND, 'app')), ...sources(join(FRONTEND, 'lib'))];
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  const all: [string, string][] = [
    ['install modal', html],
    ['llms.txt', llms],
    ['README.md', readme],
    // v2.14 T4 fix round 1: oauth.ts AGENT_APP_SCHEMES lists editor URL schemes an OAuth redirect may use
    // (a security allowlist, not an install tab); only that one line is left out of the scan.
    ...files.map((f): [string, string] => [f, readFileSync(f, 'utf8').replace(/^export const AGENT_APP_SCHEMES = .*$/m, '')]),
  ];
  for (const [label, text] of all)
    for (const word of ['VS Code', 'vscode', '.vscode'])
      assert.ok(!text.includes(word), `${label}: ${word}`);
  // The old catch-all tab is gone too; the link box above the tabs serves any other agent.
  assert.doesNotMatch(html, /Other agents|mcp-remote/);
  assert.ok(html.includes('https://earnkit.com/mcp'));
});

test('launch-ready L1: Claude Code installs at user scope everywhere it is written; Cursor\'s one-click link comes first and carries the EarnKit config', () => {
  assert.equal(byName('Claude Code').code, CLAUDE_CODE);
  for (const [label, text] of [['README.md', readme], ['llms.txt', llms]] as const)
    assert.ok(text.includes(CLAUDE_CODE), label);
  const cursor = byName('Cursor');
  const link = new URL(cursor.install!);
  assert.equal(`${link.protocol}//${link.host}${link.pathname}`, 'cursor://anysphere.cursor-deeplink/mcp/install');
  assert.equal(link.searchParams.get('name'), 'earnkit');
  assert.deepEqual(JSON.parse(atob(link.searchParams.get('config')!)), { url: 'https://earnkit.com/mcp' });
  // Only Cursor documents a one-click install link: no other tab gets one.
  assert.deepEqual(AGENTS.filter((a) => a.install).map((a) => a.name), ['Cursor']);
  // In Cursor's tab the button is first, before the manual steps.
  const src = readFileSync(join(FRONTEND, 'app/components/sections/AddToAgent.tsx'), 'utf8');
  assert.ok(src.indexOf('{agent.install && (') < src.indexOf('{agent.steps.map('), 'the one-click button renders above the steps');
});
