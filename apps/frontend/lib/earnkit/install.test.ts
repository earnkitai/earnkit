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
const llms = readFileSync(join(PUBLIC, 'llms.txt'), 'utf8');
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

test('Claude Code: user scope, then /mcp to approve', () => {
  const cc = byName('Claude Code');
  assert.equal(cc.code, CLAUDE_CODE);
  assert.equal(cc.after, 'Then type /mcp, pick earnkit, approve.');
});

test('Codex: codex mcp add with the EarnKit URL, then log in', () => {
  const cx = byName('Codex');
  assert.ok(cx.code?.startsWith('codex mcp add earnkit'), cx.code);
  assert.ok(cx.code?.includes('https://earnkit.com/mcp'));
  assert.equal(cx.code, CODEX);
  assert.equal(cx.after, 'Then run codex mcp login earnkit and approve.');
});

test('every icon is a local file logoFileProblem accepts, rendered as a decorative 20px img', () => {
  for (const a of AGENTS) {
    assert.match(a.icon, /^\/images\/agents\/[a-z-]+\.svg$/, a.name);
    const file = join(PUBLIC, a.icon);
    assert.ok(existsSync(file), `${a.name}: ${file}`);
    assert.equal(logoFileProblem(a.icon, readFileSync(file)), null, a.name);
    assert.ok(html.includes(`<img src="${a.icon}" alt="" width="20" height="20"`), a.name);
  }
  // Never fetched from elsewhere at runtime.
  assert.doesNotMatch(html, /<img[^>]*src="https?:/);
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
    ...files.map((f): [string, string] => [f, readFileSync(f, 'utf8')]),
  ];
  for (const [label, text] of all)
    for (const word of ['VS Code', 'vscode', '.vscode'])
      assert.ok(!text.includes(word), `${label}: ${word}`);
  // The old catch-all tab is gone too; the link box above the tabs serves any other agent.
  assert.doesNotMatch(html, /Other agents|mcp-remote/);
  assert.ok(html.includes('https://earnkit.com/mcp'));
});

test('llms.txt: the token is not optional, the builder bonus, the starting phrase, both commands, no campaigns section', () => {
  for (const m of llms.matchAll(/optional/g)) {
    const near = llms.slice(Math.max(0, m.index - 40), m.index + 'optional'.length + 40);
    assert.ok(!near.includes('token'), near);
  }
  assert.ok(llms.includes('builder bonus'));
  assert.ok(llms.includes('What can I earn?'));
  assert.ok(llms.includes(CLAUDE_CODE));
  assert.ok(llms.includes('Then type /mcp, pick earnkit, approve.'));
  assert.ok(llms.includes(CODEX));
  assert.ok(llms.includes('codex mcp login earnkit'));
  assert.ok(llms.includes('Any other MCP client: add https://earnkit.com/mcp as a remote server'));
  assert.ok(llms.includes('the builder earns 40% of its trading'));
  assert.ok(!llms.includes('EarnKit also runs its own campaigns'));
  assert.ok(!llms.includes('## EarnKit campaigns'));
});
