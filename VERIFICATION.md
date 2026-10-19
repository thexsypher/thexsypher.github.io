# Verification Report — xSypher Repository Audit

Generated: 2026-10-19 · Branch: arena/fe61be9d-xcipher · Base: c3710c2

## 1) What was inspected

- `package.json` + `package-lock.json` — full dependency tree
- `next.config.ts` — redirects, rewrites (subdomain admin/preview), headers, `images.remotePatterns` (R2 dynamic, Cloudinary, Pexels, unsplash), `experimental` (serverActions 5mb, workerThreads false)
- `drizzle.config.ts` + `drizzle/` — migrations 0000→0005, schema tables, indexes
- `lib/db/schema.ts` — `article`, `category`, `author`, `tag`, `_ArticleToTag`, `DeletedArticleSlug`, `ArticleRevision`, `ArticleReview`, `PublicationSettings`
- `lib/seo.ts` — `PRODUCTION_SITE_URL`, `siteConfig`, `resolveSiteUrl()`, `BRAND_ALTERNATE_NAMES`, `absoluteImageUrl`, `socialCardUrl`, `constructMetadata`, `articleCanonicalUrl`, `articleFeaturedImageUrl`, `generateNewsArticleJsonLd`, `SITE_URL` guards
- `lib/image-url.ts` — `BRAND_BANNER_PATH /og-image.png`, `ARTICLE_FALLBACK_COVER /fallback-cover.webp`, `optimizeImageUrl` (Cloudflare /cdn-cgi/image/), `resolveImageSrc`, `IMAGE_WIDTHS`, `isRasterImageUrl`
- `lib/entity-schema.ts`, `lib/article-schema.ts` — Organization, CollectionPage, withEditorialSchema
- `lib/personas.ts` — editorial desks (AI Desk, CyberOps, Dev Desk)
- `lib/queries.ts`, `lib/cached-queries.ts`, `lib/cache-tags.ts` — ARTICLE_CARD_COLUMNS/WITH, HOME_ARTICLE_LIMIT 60, tagged unstable_cache
- `app/feed.xml/route.ts` — 20 items, RSS 2.0, revalidate 3600, CACHE_TAGS.articles
- `app/sitemap.xml/route.ts` + `app/sitemap/pages.xml/route.ts` + `app/sitemap/articles.xml/route.ts` — index + pages (45k/page, image:image) + news (48h)
- `app/robots.ts` — explicit allow for /_next/, AI-crawler Option A
- `app/(public)/page.tsx` + `app/(public)/layout.tsx` + `app/(public)/article/[slug]/page.tsx` — homepage hero/placements, org JSON-LD in layout, article 410+tombstone+historicalSlug redirect
- `app/globals.css` — design tokens (--ink, --surface, --accent #e60000 etc.)
- `components/layout/SiteHeader.tsx: NAV_ROW` — AI, Cybersecurity, Gadgets, Software, Programming, Startups, Gaming, Reviews, How-To, Opinion, Science
- `README.md` + `AGENTS.md` — architecture narrative, hybrid storage flow
- `.github/workflows/deploy.yml` — verify (tsc, vitest, audit, build gate) → ssh deploy → migrate.mjs → docker compose → healthz probe

## 2) Findings summary

- Origin is hardcoded production `https://xsypher.com` with localhost/www guards — showcase correctly uses this, never staging.
- RSS has no image tags — sitemap pages.xml is authoritative image source, OG meta is fallback. Showcase implements this priority.
- Article URL is `/article/{slug}` with previousSlugs 301 and tombstone 410 — showcase validates finalUrl to avoid soft-404.
- Image pipeline: R2 raw URL → Cloudflare transform only when custom domain, not r2.dev — showcase mirrors with brand fallback.
- Feed is 20 deep, article feed where clause includes `publishedAt <= NOW()` to exclude scheduled — showcase respects by only trusting feed links.
- Stack is Next 16 / React 19 / TS strict / Tailwind v4 / Drizzle on Neon/Postgres + R2 — showcase badges are verified (no inventing versions).

## 3) Deliverable self-check

- index.html: single file, embedded CSS, no external JS except Google Fonts (optional, degrades to system), semantic HTML5, heading hierarchy h1→h2→h3, <header><main><section><article><footer>, skip-link, time datetime, aria-live grid.
- No analytics widgets: header/hero/arch/stack/articles/footer/entity only — no GH cards, commit graphs, Plausible, GA.
- Verified stack section: 6 groups, 40+ badges, confirmed versions marked ✓.
- Latest Publications: ARTICLES:START/END markers, fallback crawlable cards, syncBadge, build-time, SEO strip explaining dofollow contract.
- SEO: meta robots index,follow,max-image-preview:large, OG + Twitter large, canonical, Organization/WebSite/AboutPage + dynamic CollectionPage/ItemList/BlogPosting, publisher#id linked, alternateName preserved, BreadcrumbList.
- 100% dofollow: grep for nofollow/sponsored fails workflow, every card is <a href="https://xsypher.com/article/slug">.
- Script: Node built-ins only, fetches feed → sitemap images → og fallback (concurrency 5) → validate 200+!homepage → render grid + JSON-LD → inject markers → idempotent (no-op if unchanged) → preserves on feed failure.
- Workflow: schedule 0 */6 * * *, workflow_dispatch, push main; setup-node 22; sync; validate grep checks; commit+push if diff.

## 4) How to verify after Pages deploy

- curl -I https://<org>.github.io → 200
- grep canonical → https://xsypher.com
- Rich Results Test → Organization + WebSite + CollectionPage ItemList recognized
- Search Console → Sitemaps → submit https://<org>.github.io/sitemap.xml if you add one (optional — not required for DA transfer)
- Lighthouse SEO 100 (static, semantic, no JS needed for links)
