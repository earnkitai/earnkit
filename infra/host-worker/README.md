# earnkit-host

The Cloudflare Worker (free plan) that serves builder sites at `<project>-<user>.earnkit.com`.

## What it serves

- `Host` must be exactly one label under `ZONE`, matching `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`, and not reserved (`HOST_RESERVED` in `apps/frontend/lib/earnkit/host-names.ts` plus the `RESERVED` var). Anything else is a 404 with no R2 read.
- Files come from the R2 bucket `earnkit-sites` at `sites/<slug>/<path>`. `/` and paths ending in `/` serve `index.html`; a missing extensionless path tries `<path>/index.html`, then the site's `404.html`, then a plain 404. Paths with `..`, `.`, `//`, `\`, control bytes or bad percent-encoding are a 400.
- `state/<slug>.json` (`{ "status": "live" | "review" | "killed" | "ended", "login": "..." }`) is the kill switch: `review` and `killed` serve "This site was taken down." and `ended` serves "This site has ended.", both 410. No state object is a 404.
- Only `GET` and `HEAD`; other methods are 405.
- Every response, errors included, carries `HOST_HEADERS`: `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals; form-action 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- 200 responses are cached at the edge for 300 s (`Cache-Control: public, max-age=300`), one entry per slug and path (the query string is ignored). The state is read only on a cache miss, so a takedown shows within 5 minutes.

## Owner setup (once, by hand)

1. Create the R2 bucket `earnkit-sites` (free plan).
2. Set `RESERVED` in `wrangler.toml` to every existing DNS name in the zone beyond `HOST_RESERVED`, comma separated. Set `EARNKIT_RESERVED_SUBDOMAINS` on Railway to the same list.
3. From this folder on your own machine: `npx wrangler deploy`.
4. DNS: a proxied wildcard record `*.earnkit.com` (AAAA `100::`). Explicit records for reserved names keep their current targets.
5. Routes: `*.earnkit.com/*` to this Worker, and one exclusion route (Worker: none) per reserved name (`www`, `docs`, `api`, `mcp`, `app`, `mail`, `admin`, `status`, `abuse`, `host`, and every existing record).

Never deploy from CI.

## Local checks

- Tests: `pnpm test` (runs `src/**/*.test.ts` with the frontend lib tests).
- Typecheck: `pnpm host:typecheck`.
