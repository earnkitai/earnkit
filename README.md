# EarnKit — marketing site

Next.js marketing site. This repo was reduced to the frontend only; the API
server, dashboard, buyback co-signer and the `@earnkit/earn` SDK were removed
in favour of a new product direction. Everything deleted is recoverable from
git history (`git log -- apps/earn-backend`, etc.) and from `origin/main`.

## Layout

```
apps/frontend/
  app/
    page.tsx                  landing page
    layout.tsx                root layout, metadata, OG tags
    (marketing)/litepaper/    litepaper (Notion-backed)
    (marketing)/roadmap/
    privacy/ terms/ risk-disclosure/ token-creator-agreement/
    components/{common,sections,ui}/
    lib/notion.ts             Notion client for the litepaper
  public/                     images, video, og, robots.txt, llms.txt
```

## Local setup

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## Environment

Only the litepaper needs env. Everything else renders without it.

```
NOTION_API_KEY=
NOTION_DATABASE_ID=
```

## Deploy

Railway, via `apps/frontend/railway.toml` (nixpacks; `pnpm build:frontend` /
`pnpm start:frontend`).
