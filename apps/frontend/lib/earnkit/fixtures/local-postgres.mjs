/**
 * Per-file test databases create and drop databases, so they only ever run against a local Postgres:
 * the URL host must be localhost, 127.0.0.1 or ::1 (or a unix socket: no host, or a host= path).
 */
export function isLocalPostgres(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const param = u.searchParams.get('host');
  if (param && !param.startsWith('/') && !['localhost', '127.0.0.1', '::1'].includes(param.toLowerCase())) return false;
  return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
export function assertLocalPostgres(url) {
  if (!isLocalPostgres(url)) throw new Error('per-file test databases only run against a local Postgres (localhost, 127.0.0.1 or ::1)');
}
