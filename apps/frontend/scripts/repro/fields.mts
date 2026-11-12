/** A find reply's field by key: the reply's `fields` list first, else any object with that key and a value. */
export const fieldOf = (o: any, key: string): any => {
  const top = Array.isArray(o?.fields) ? o.fields.find((f: any) => f?.key === key) : null;
  if (top) return top;
  const walk = (x: any): any => {
    if (!x || typeof x !== 'object') return null;
    if (Array.isArray(x)) { for (const y of x) { const f = walk(y); if (f) return f; } return null; }
    if (x.key === key && 'value' in x) return x;
    for (const v of Object.values(x)) { const f = walk(v); if (f) return f; }
    return null;
  };
  return walk(o);
};
