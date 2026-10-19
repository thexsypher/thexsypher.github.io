# xSypher — Official Platform Showcase (`<org>.github.io`)

> Elite GitHub Pages hub for the **xSypher** publication at **https://xsypher.com**.  
> Pure static, zero analytics widgets, maximum crawl budget & DA transfer.

---

## 1) Repository Findings — Verified Facts

### Canonical Origin & URL Structure
| Concern | Verdict | Source |
|---|---|---|
| **Production origin** | `https://xsypher.com` — hard-coded in `lib/seo.ts:PRODUCTION_SITE_URL`. Loopback (`localhost`, `*.local`, `*.internal`) and `www.xsypher.com` are normalized to the apex so no canonical ever `localhost`s or `308`s. | `lib/seo.ts:resolveSiteUrl()` |
| **Article URL** | `https://xsypher.com/article/{slug}` — `slug` is the editorial slug + unique index. Historical slugs live in `Article.previousSlugs` (GIN) and `301` to the current slug. Deleted slugs return **HTTP 410** via `DeletedArticleSlug` tombstone + `middleware.ts` cache. | `app/(public)/article/[slug]/page.tsx`, `lib/db/schema.ts` |
| **Category** | `/category/{slug}` — `Category.slug` unique. Supports parent hierarchy (`parentId → Category.id`). Archive pages paginated. | `components/layout/SiteHeader:NAV_ROW`, `lib/db/schema:category` |
| **Tag** | `/tag/{slug}` — `Tag.slug` unique, join via `_ArticleToTag`. | `lib/db/schema` |
| **Author** | `/author/{slug}` — `Author.slug` via `AuthorProfileView`. Anonymous articles render editorial persona (`xSypher AI Desk` / `CyberOps` / `Dev Desk`). | `lib/personas.ts`, `app/(public)/author/[slug]/page.tsx` |
| **Static pages** | `/page/{slug}` — `about`, `contact`, `advertising`, `careers`, `media-kit`, `editorial-policy`, `editorial-standards`, `corrections`, `transparency`, `privacy-policy`, `terms-of-use`, `cookie-policy`, `disclaimer`, `sitemap`, etc. Latest wire at `/latest`, series at `/series`. | `app/(public)/page/*` |
| **RSS feed** | `GET https://xsypher.com/feed.xml` — RSS 2.0 + `atom:link rel=self`. **20 items**, sorted `publishedAt DESC` where `status=PUBLISHED AND publishedAt <= NOW()`. Fields: `<title>`, `<link>` (`/article/{slug}`), `<guid isPermaLink>`, `<pubDate>` (UTC), `<description>` (= `deck`), `<author>` (persona-aware). Cache: `unstable_cache` tag `articles`, `revalidate 3600`, `s-maxage 3600`. **No `<media:content>` / `<enclosure>` image** — images must be sourced from sitemap or OG crawl. | `app/feed.xml/route.ts` |
| **Sitemap index** | `GET https://xsypher.com/sitemap.xml` — `<sitemapindex>` → `/sitemap/pages.xml` (paginated `?page=N`, 45k/page) + `/sitemap/articles.xml` (Google News, `news:news`, 48h window). Index revalidates 3600. | `app/sitemap.xml/route.ts` |
| **Sitemap pages** | `GET https://xsypher.com/sitemap/pages.xml` — static pages + categories + tags + authors + **published articles with `<image:image><image:loc>`** (featured image). `changefreq`/`priority` per static route. Paginated. | `app/sitemap/pages.xml/route.ts` |
| **Sitemap news** | `GET https://xsypher.com/sitemap/articles.xml` — Google News sitemap, `publication_name=xSypher`, `language=en`. | `app/sitemap/articles.xml/route.ts` |
| **Robots** | `GET https://xsypher.com/robots.txt` — disallows `/admin/*`, `/api/*`, `/invite/*`, `/unsubscribe/*`. **Allows `/_next/`** and `/*?_rsc=*` (fixed post-SEO-2026-10-17). Explicit AI-crawler policy: **Option A — allow all major AI crawlers** (`GPTBot`, `CCBot`, `Anthropic`, etc.) for visibility. Change to `disallow` for Option B. | `app/robots.ts` |
| **Redirects** | `www.xsypher.com/*` → `308 https://xsypher.com/:path*` (permanent). Legacy `/page/privacy` → `/page/privacy-policy`, etc. | `next.config.ts:redirects()` |
| **Images** | **Stored:** `Article.img` column (absolute URL → Cloudflare R2 bucket via `NEXT_PUBLIC_R2_PUBLIC_BASE`, or legacy numeric Pexels ID). **Transform:** `lib/image-url:optimizeImageUrl()` rewrites to `/cdn-cgi/image/width={w},format=auto,quality=82{path}` only when host supports transforms (not `*.r2.dev` / `*.r2.cloudflarestorage.com`). **Display widths:** `articleHero 1400`, `cardHero 960`, `card 640`, `row 300`. **Brand card:** `/og-image.png` 1200×630 (archive pages only). **Fallback:** `/fallback-cover.webp` for articles with no image. **Stale guard:** `lib/stale-assets` blocks known placeholders from ever becoming `og:image`. Metadata path uses `articleFeaturedImageUrl` (featured only, never `ogImage` override). | `lib/image-url.ts`, `lib/seo.ts:articleFeaturedImageUrl`, `lib/stale-assets.ts` |
| **Structured data** | `NewsArticle` per article (`headline`, `image` as `ImageObject` width 1200, `author` persona-aware, `publisher` linked to `Organization#id`, `isAccessibleForFree`, `timeRequired`, `articleSection`, `keywords`). `CollectionPage` for home/category/tag. `Organization` + `WebSite` (with `SearchAction`) site-wide injected in `app/(public)/layout.tsx`. | `lib/seo:generateNewsArticleJsonLd`, `lib/entity-schema:generateOrganizationJsonLd`, `lib/article-schema:withEditorialSchema` |
| **Caching** | `unstable_cache` tagged `articles`, `article:{slug}`, `categories`, `authors`, `homepage`. Publish/edit/unpublish/delete invalidates `articles` which drops feed, sitemap, article and listing caches atomically. Homepage `force-static revalidate 300`, article `force-static revalidate 3600`, feed/sitemap `revalidate 3600` + data-cache 86400. | `lib/cached-queries.ts`, `lib/cache-tags.ts` |

### Verified Technology Stack (from `package.json` + configs)

| Domain | Technology | Version / Note |
|---|---|---|
| **Framework** | Next.js App Router + Turbopack | `16.4.0` · `output:standalone` · `compress:true` |
| **UI** | React | `19.2.8` · `react-dom 19.2.8` |
| **Language** | TypeScript | `5.9.3` · `strict:true` · `noEmit` |
| **Styling** | Tailwind CSS + CSS variables | `4.x` via `@tailwindcss/postcss` · `globals.css` tokens `--ink/--surface/--accent` |
| **DB** | PostgreSQL — Neon serverless / Supabase / plain TCP | `@neondatabase/serverless 1.2`, `@neon/config 1.8`, `postgres 3.4` (TCP pool) · read-replica via `DATABASE_URL_REPLICA` |
| **ORM** | Drizzle ORM + drizzle-kit | `0.45.3` + `0.31` · schema in `lib/db/schema.ts` · migrations in `drizzle/` |
| **Auth** | NextAuth (Auth.js) v5 + Drizzle adapter | `5.0.0-beta.32` + `@auth/drizzle-adapter 1.11` · `authorize(role,cap)` capability layer · `buildArticleScope(actor)` · TOTP 2FA encrypted at rest |
| **Content store** | Cloudflare R2 (S3) | `@aws-sdk/s3-request-presigner 3.1141` · `contentUrl` column bridges Postgres → R2 JSON/HTML · public base `NEXT_PUBLIC_R2_PUBLIC_BASE` · `media.xsypher.com` custom domain |
| **Avatars** | Cloudinary | `2.11` · `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` |
| **Editor** | TipTap + lowlight + sanitize | `@tiptap/* 3.31` (starter-kit, image, link, table, heading, highlight, underline, strike, text-align, code-block-lowlight, suggestion) · `lowlight 3.3` · `highlight.js 11.12` · `isomorphic-dompurify 4.2` · `sanitize-html 2.17` · `tiptap-markdown 0.9` · Mermaid 12, Recharts 3.10, react-tweet 3.3 |
| **Queues** | BullMQ + IORedis + Redis | `bullmq 6.3` + `ioredis 6.0` · `REDIS_URL` · AOF-persisted `redis` container · `xsypher-worker` container · `tsx lib/queue/worker.ts` |
| **Media ops** | Sharp, QR, cropping | `sharp 0.35` · `qrcode 1.5` · `react-easy-crop 6.2` |
| **Validation** | Zod + hookform | `zod 4.6` · `react-hook-form 7.88` · `@hookform/resolvers` |
| **Anims** | Framer Motion | `13.4` |
| **Email** | Resend | `6.28` · `RESEND_API_KEY` · `EMAIL_FROM_ADDRESS` |
| **Observability** | Sentry | `@sentry/nextjs 11.5` · `instrumentation*.ts` |
| **Infra** | Docker + Oracle Cloud ARM64 | Multi-stage non-root `Dockerfile` + `Dockerfile.worker` · `docker-compose.prod.yml` (web + worker + redis) · Node 22 |
| **CI/CD** | GitHub Actions (verify → ssh deploy) | `.github/workflows/deploy.yml` · `tsc --noEmit` → `vitest` → `npm audit --audit-level=high` → `build` gate → SSH `migrate.mjs` → `docker compose build/up` → `healthz` probe |
| **Misc** | LRU cache, WebSocket, theming | `lru-cache 11.5` · `ws 8.22` · `next-themes 0.4` · `mermaid 12` · `recharts 3.10` |

---

## 2) What This Repo Is

This repo **is** `https://<your-org>.github.io` — a pure-static GitHub Pages site.  
It does **not** replace `xsypher.com`; it **funnels** crawl budget and DA to it:

- Every article card is a plain `<a href="https://xsypher.com/article/{slug}">` — zero JS routing, zero `rel="nofollow"`/`sponsored`.
- JSON-LD declares an `ItemList → BlogPosting` graph with canonical + image for each story.
- The origin (`xsypher.com`) is the only indexed entity; this page is a **passthrough**, not a competitor (no competing `Organization`, no self-canonical over articles).

---

## 3) File Map

```
<org>.github.io/
├── index.html                 # standalone showcase + publications (embedded CSS, JSON-LD)
├── scripts/
│   └── sync.mjs               # feed → sitemap images → OG fallback → validate → inject
└── .github/
    └── workflows/
        └── sync.yml           # schedule (q6h) + workflow_dispatch + push → sync → commit
```

`index.html` is self-contained: no build step, no CDN JS required for crawl. Sync is Node built-ins only (`fetch`, `fs`).

---

## 4) Deploy (one-time)

1. Create or open `https://github.com/<org>/<org>.github.io`.
2. Push this repo's content to `main` (root = `index.html`):
   ```bash
   # from this checkout
   git init
   git add index.html scripts/sync.mjs .github/workflows/sync.yml README.md
   git commit -m "feat: xSypher showcase + publications sync"
   git branch -M main
   git remote add origin https://github.com/<org>/<org>.github.io.git
   git push -u origin main
   ```
3. GitHub → Settings → Pages → Build & deployment → **Source: Deploy from branch**, Branch `main` / `root` → Save.
4. Wait ~60s → `https://<org>.github.io` is live. Verify:
   ```bash
   curl -s https://<org>.github.io/ | grep -q 'xsypher.com/article/' && echo "ok"
   curl -s https://<org>.github.io/ | grep -q 'CollectionPage' && echo "ok"
   ```

*Custom domain (optional):* Settings → Pages → Custom domain `showcase.xsypher.com` → add `CNAME showcase → <org>.github.io` in Cloudflare DNS; the meta canonical still points at `xsypher.com/`, so no index competition.

---

## 5) Automation — How Sync Works

```
CRON (q6h) / workflow_dispatch / push
        │
        ▼
 fetch https://xsypher.com/feed.xml  (RSS 2.0, 20 items, persona-aware)
        │  parse <item>{title,link,guid,pubDate,description,author}
        │
 fetch https://xsypher.com/sitemap/pages.xml[?page=N]  (image:loc per <url>)
        │  map slug → featuredImage (stale placeholders dropped)
        │
 for each slug without sitemap image:
   fetch https://xsypher.com/article/{slug}  (max 5 concurrent)
        │  extract <meta property="og:image"> / twitter:image / first R2 <img>
        │  reject .svg, stale, non-raster
        │
 validate each canonical URL
        │  GET + follow redirects; drop if !200 or homepage-redirected or homepage-soft-404
        │
 render <article class="article-card">…</article> grid
   + CollectionPage { ItemList → BlogPosting[] }  (image + datePublished + publisher#id)
        │
 inject between <!-- ARTICLES:START … --> / <!-- ARTICLES:END -->
   + replace #collection-schema JSON-LD
   + update #sync-text + #build-time
        │
 if html unchanged → exit 0 (no empty commit)
 else git add index.html && commit -m "chore: sync latest publications …" && push
```

**Fault tolerance:** any network failure, empty feed, or 0 validated URLs → log & exit 0 preserving existing cards. No broken link is ever injected.

**Dofollow guarantee:** the injected HTML contains only `<a href="https://xsypher.com/article/{slug}">` — verified post-sync by `grep -q 'rel="nofollow"' && exit 1`.

**Cron:** `0 */6 * * *` (00,06,12,18 UTC). Adjust in `sync.yml`. Immediate run via Actions → *Sync Latest Publications* → Run workflow.

### Env knobs (workflow → `env:`)

| Var | Default | Effect |
|---|---|---|
| `SITE_URL` | `https://xsypher.com` | Origin to crawl. Change for staging (`https://staging.xsypher.com`). |
| `MAX_ARTICLES` | `12` | Cards in grid (1–30). |
| `OG_CONCURRENCY` | `5` | Parallel article OG fetches. |

### Run locally

```bash
node scripts/sync.mjs
# or
SITE_URL=https://staging.xsypher.com MAX_ARTICLES=8 node scripts/sync.mjs
```

No `npm install` — uses Node 18+ built-in `fetch`.

---

## 6) SEO — What Transfers Authority

- **100% dofollow.** No `rel="nofollow|sponsored|ugc"` anywhere. No JS-only routing — `href` is crawlable link juice.
- **Structured data.** `Organization` (`@id https://xsypher.com/#organization`, `alternateName` variants) + `WebSite` (with `SearchAction`) + `AboutPage` + **dynamic `CollectionPage` → `ItemList` → `BlogPosting`** per article (canonical, `headline`, `datePublished`, `author`, `publisher#id`, `image ImageObject`). Mirrors `lib/seo:generateNewsArticleJsonLd`.
- **Semantic HTML5.** `<header>` → `<main>` → `<section aria-labelledby>` → `<article>` → `<footer>`. Heading hierarchy `h1→h2→h3`, `<time datetime>`, `aria-live="polite"` grid.
- **Meta directives.** `robots: index, follow, max-image-preview:large, max-snippet:-1` + `googlebot` + `bingbot`. `canonical https://xsypher.com/` on self, article cards canonical at origin.
- **OG/Twitter parity.** `og:image` = `https://xsypher.com/og-image.png` 1200×630, `twitter:card summary_large_image` — ensures unfurl even with no JS.
- **Internal linking depth.** Every card → category page (`/category/{slug}`) + article canonical. Footer mirrors production IA (`/latest`, `/series`, every policy page, RSS, sitemap, robots, author roots) — all dofollow to origin.
- **Image SEO hygiene.** `sitemap/pages.xml → image:loc` is primary source; stale placeholders blocked (`lib/stale-assets` logic ported); fallback is brand card (never a broken `src`). `width` declared on JSON-LD `ImageObject`; `max-image-preview:large` enabled site-wide.
- **No self-competition.** This page never self-canonicalizes over `/article/*` content; `/article/{slug}` entities exist only in the `ItemList` graph pointing at the origin.

**Validate:**
```bash
# Rich Results Test
# → https://search.google.com/test/rich-results?url=https://<org>.github.io
# Check: Organization ✓, WebSite ✓, BreadcrumbList ✓, CollectionPage ✓, ItemList (12) ✓
#
# Robots + preview
curl -s https://<org>.github.io/ | grep -iE 'robots|max-image-preview'
# Crawl sample
curl -s https://<org>.github.io/ | grep -o 'https://xsypher.com/article/[^"]*"' | head
```

---

## 7) Keeping the Showcase Current

- **Publishing flow:** editor hits Publish in xSypher → DB row + R2 body → cache tags invalidate → feed/sitemap revalidate within 3600s → next showcase cron (≤6h) pulls it → card appears, JSON-LD updated → committed.
- **Renames/deletes:** renamed slug → sitemap `301` → sync follows redirect → card updates; deleted slug → origin `410` → validation drops it → next sync removes the card (no 404 injected).
- **Manual refresh:** GitHub → Actions → `Sync Latest Publications` → Run workflow (completes in <10s when warm).
- **Pages redeploys automatically** on push — no manual publish step.

---

## 8) Customization

- **Brand copy:** edit the hero/mission/architecture prose in `index.html` — keep dofollow contract (no `nofollow`, `href` must stay `https://xsypher.com/...`).
- **Stay in dark theme:** tokens at `:root{--bg --accent --ink …}` — accent is `#ff0a2b` (matches `--accent #e60000` on origin light theme, lifted for dark contrast).
- **Add a locale:** duplicate the `Organization` `alternateName` array; do not change its `@id` (the Knowledge Graph link).
- **Extra verticals:** coverage cards model `NAV_ROW` in `SiteHeader.tsx` — add in same `<a class=focus-card>` pattern.

---

## 9) License

Showcase template © xSypher Media. Origin content retains its own rights. Forks must preserve the canonical + dofollow contract so attribution consolidates at `xsypher.com`.
