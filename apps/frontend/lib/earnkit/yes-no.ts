/**
 * v2.8.1 §E18: a yes or no in any form an agent passes it (a boolean, 1/0, "yes", "sure", "nope",
 * "not now"); null when unclear. Pure; tools.ts re-exports it. v2.12 (R23): moved here out of
 * aliases.ts, which is archived on or after 2026-11-09 (archive/tool-aliases).
 */
export function yesNo(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 0) return v === 1;
  const t = typeof v === 'string' ? v.trim().toLowerCase().replace(/[.!]+$/, '') : '';
  if (['yes', 'y', 'true', 'yeah', 'yep', 'sure', 'ok', 'okay'].includes(t)) return true;
  if (['no', 'n', 'false', 'nope', 'not now'].includes(t)) return false;
  return null;
}
