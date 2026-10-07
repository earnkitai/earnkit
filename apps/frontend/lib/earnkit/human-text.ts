import ts from 'typescript';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * v2.8 Ruling 16 (plan): the character human text never uses. Written as the escape: this file is
 * excluded from the scan, since the cooked value of this literal is the character it bans.
 */
export const EM_DASH = '\u2014';

/**
 * v2.8 Ruling 16 (plan): the human text in one source file: string literals, template literal
 * parts and JSX text. Comments are trivia, so the scanner never sees them. Pure.
 */
export function humanStrings(path: string, source: string): { text: string; line: number }[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const out: { text: string; line: number }[] = [];
  const add = (n: ts.Node, text: string) =>
    out.push({ text, line: file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1 });
  const walk = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n, n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) add(n, n.text);
    else if (ts.isJsxText(n) && n.text.trim()) add(n, n.text);
    ts.forEachChild(n, walk);
  };
  walk(file);
  return out;
}

const SOURCE_DIRS = ['apps/frontend/app', 'apps/frontend/lib', 'apps/frontend/scripts'];
const TEXT_FILES = ['apps/frontend/public/llms.txt', 'programs/README.md', 'README.md', 'apps/frontend/README.md'];
const skip = (p: string) =>
  /\.test\.tsx?$/.test(p) || p.includes('/fixtures/') || p.includes('node_modules') || p.endsWith('/human-text.ts');

/** Every file Ruling 16 (plan) scans, repo-relative. */
export function humanTextFiles(root: string): string[] {
  const files: string[] = [...TEXT_FILES];
  const walkDir = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = `${dir}/${name}`;
      if (skip(rel)) continue;
      if (statSync(join(root, rel)).isDirectory()) walkDir(rel);
      else if (/\.(ts|tsx|mts)$/.test(name)) files.push(rel);
    }
  };
  SOURCE_DIRS.forEach(walkDir);
  for (const name of readdirSync(join(root, 'programs'))) if (name.endsWith('.json')) files.push(`programs/${name}`);
  return files.map((f) => relative(root, join(root, f)));
}
