// L24-5 (Break): `__proto__` and `constructor` keys leak JavaScript internals into builder text
// (`[object Object] is not something I keep and function Object() { [native code] } ...`).
// Expected (v6.1.16 Task 11): Object.hasOwn over an allowlist; `"__proto__" is not something I keep.` (key through quoteName); policy stays off.
import { run, agent, builder, link, call, db } from './lib.mts';
await run('L24-5', 25, async (c) => {
  const B = await builder(`${c.tag}-b`); const A = await agent(`${c.tag}-a`, c.ip(1)); await link(A, B);
  const r = await call(A, 'record', '{"set":{"__proto__":{"policy":{"auto_apply":true}},"constructor":{"policy":{"auto_apply":true}}}}');
  const [p] = await db`SELECT record->'policy'->>'auto_apply' AS a FROM builders WHERE id = ${B.id}`;
  const leak = /\[object Object\]|native code|function Object/.test(r.sb);
  const named = /"?__proto__"? is not something I keep/.test(r.sb) || /not something I keep/.test(r.sb);
  return { pass: !leak && named && p?.a !== 'true', actual: `record set {__proto__, constructor} said "${r.sb}"; policy auto_apply ${p?.a ?? 'unset'}` };
});
