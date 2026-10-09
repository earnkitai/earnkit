# earnkit-host

The Cloudflare Worker (free plan) that serves builder sites at `<project>-<user>.earnkit.com`.

## What it serves

- `Host` must be exactly one label under `ZONE`, matching `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`, and not reserved (`HOST_RESERVED` in `apps/frontend/lib/earnkit/host-names.ts` plus the `RESERVED` var). Anything else is a 404 with no R2 read.
- Files come from the R2 bucket `earnkit-sites` at `sites/<slug>/<path>`. `/` and paths ending in `/` serve `index.html`; a missing extensionless path whose `<path>/index.html` exists is a 301 to `<path>/` (query kept), else the site's `404.html`, then a plain 404. Paths with `..`, `.`, `//`, `\`, control bytes or bad percent-encoding are a 400.
- `state/<slug>.json` (`{ "status": "live" | "review" | "killed" | "ended", "login": "..." }`) is the kill switch: `review` and `killed` serve "This site was taken down." and `ended` serves "This site has ended.", both 410. No state object is a 404.
- Only `GET` and `HEAD`; other methods are 405.
- Every response, errors included, carries `HOST_HEADERS`: `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals; form-action 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Edge cache (Cache API), one entry per slug and decoded path (query string, Host spelling and percent-encoding never split it):
  - the state per slug: 60 s (an unknown slug is cached as "none");
  - 200 files: 240 s; 404s and 301s: 60 s; the site's `404.html` lookup has its own entry; 410s come from the cached state.
  - A takedown shows within 300 s (60 s of state plus 240 s of file).
- R2 reads stay bounded: after the first miss, repeats of the same path or slug read nothing until the entry expires. Worst case: a flood of distinct missing paths on one live site costs at most 2 reads per request (the file and `<path>/index.html`; the state and the site's `404.html` are cached once per edge location); an unknown slug costs 1. At the free plan's 100k requests a day that is about 6M reads a month, under R2's 10M free Class B reads.
- Errors are logged by name only (`host worker error`) to the free Workers logs.

## Owner setup (once, by hand)

1. Create the R2 bucket `earnkit-sites` (free plan).
2. Set `RESERVED` in `wrangler.toml` to every existing DNS name in the zone beyond `HOST_RESERVED`, comma separated. Set `EARNKIT_RESERVED_SUBDOMAINS` on Railway to the same list.
3. From this folder on your own machine: `npx wrangler deploy`.
4. DNS: a proxied wildcard record `*.earnkit.com` (AAAA `100::`). Explicit records for reserved names keep their current targets.
5. Routes: `*.earnkit.com/*` to this Worker, and one exclusion route (Worker: none) per reserved name (`www`, `docs`, `api`, `mcp`, `app`, `mail`, `admin`, `status`, `abuse`, `host`, and every existing record). Set the route's request-limit failure mode to "Fail closed (block)".
6. Check each reserved name in a browser after adding the routes: it must reach its own service, not this Worker's "Not found.".

Never deploy from CI.

## Local checks

- Tests: `pnpm test` (runs `src/**/*.test.ts` with the frontend lib tests).
- Typecheck: `pnpm host:typecheck` (Worker code without Node types, then the tests with them).
