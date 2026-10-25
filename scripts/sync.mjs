#!/usr/bin/env node
/**
 * xSypher — Automated Feed, Sitemap & Open Graph Synchronization Script
 *
 * Designed for the companion GitHub Pages repository (<org>.github.io).
 *
 * Pipeline:
 *   1. Fetches runtime tombstones from https://xsypher.com/api/deleted-slugs
 *      and combines them with the compiled-in KNOWN_DELETED_SLUGS and
 *      DELETED_SLUG_PATTERNS from lib/deleted-slugs.ts.
 *   2. Fetches the live RSS 2.0 feed (https://xsypher.com/feed.xml) and
 *      the XML sitemaps (/sitemap/pages.xml & /sitemap/articles.xml) to build
 *      the candidate article list and map <image:loc> featured images.
 *   3. Validates every candidate article URL via HTTP GET:
 *      - Must return HTTP 200 OK
 *      - Must NOT redirect to the homepage (/) or a non-article route
 *      - Must NOT match a tombstoned/fixture slug or soft-404 page
 *      - Follows 301 redirects from Article.previousSlugs to the canonical slug
 *   4. Extracts rich metadata from the live article HTML & NewsArticle JSON-LD:
 *      - Cover/banner image (Sitemap <image:loc> -> NewsArticle JSON-LD image ->
 *        <meta property="og:image"> -> /fallback-cover.webp), strictly rejecting
 *        STALE_ASSET_PATTERNS from lib/stale-assets.ts
 *      - Category name & canonical /category/{slug} link
 *      - Topic tags (<meta property="article:tag"> / JSON-LD keywords)
 *      - Reading time (JSON-LD timeRequired PTxM)
 *      - Canonical URL (<link rel="canonical">)
 *   5. Renders responsive, 100% dofollow article banner cards between
 *      <!-- ARTICLES:START --> and <!-- ARTICLES:END --> in index.html and
 *      updates the dynamic CollectionPage + ItemList (BlogPosting/TechArticle)
 *      JSON-LD structured data.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ────────────────────────────────────────────────────────────
const SITE_URL = (process.env.SITE_URL || "https://xsypher.com").replace(/\/+$/, "");
const CANONICAL_ORIGIN = (process.env.CANONICAL_ORIGIN || SITE_URL).replace(/\/+$/, "");
const MAX_ARTICLES = Math.max(1, Math.min(30, Number(process.env.MAX_ARTICLES) || 12));
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.OG_CONCURRENCY) || 5));
const TIMEOUT_MS = Math.max(3000, Number(process.env.SYNC_TIMEOUT_MS) || 15000);

const BRAND_BANNER = `${CANONICAL_ORIGIN}/og-image.png`;
const FALLBACK_COVER = `${CANONICAL_ORIGIN}/fallback-cover.webp`;
const FALLBACK_ICON = `${CANONICAL_ORIGIN}/icon.svg`;

// Exact stale asset patterns from lib/stale-assets.ts
const STALE_ASSET_PATTERNS = [
  "homenest",
  "movers",
  "logo-4-squares",
  "placeholder-cover",
  "dummy-image",
  "sample-image",
  "lorem-ipsum",
];

// Exact deleted/fixture slugs & patterns from lib/deleted-slugs.ts & lib/ghost-content.ts
const KNOWN_DELETED_SLUGS = new Set([
  "tiptap-editor",
  "ultimate-testing-document",
  "tiptap-editor-ultimate-testing-document",
  "test",
  "testing",
  "test-post",
  "test-article",
  "test-document",
  "test-page",
  "post-test",
  "dummy",
  "dummy-post",
  "sample",
  "sample-post",
  "untitled",
  "hello-world",
  "my-first-post",
  "my-first-article",
  "lorem-ipsum",
]);

const DELETED_SLUG_PATTERNS = [
  /^(test|testing|dummy|sample|untitled)(-|_)?\d*$/i,
  /^(tmp|temp|copy-of|untitled|lorem-ipsum)-/i,
  /^(article|post|draft)-\d+$/i,
];

// Known category display names -> canonical category slugs from SiteHeader.tsx
const CATEGORY_SLUG_MAP = {
  "ai": "ai",
  "artificial intelligence": "ai",
  "ai & machine learning": "ai",
  "cybersecurity": "cybersecurity",
  "security": "cybersecurity",
  "gadgets": "gadgets",
  "hardware": "gadgets",
  "hardware & gadgets": "gadgets",
  "software": "software",
  "software architecture": "software",
  "programming": "programming",
  "startups": "startups",
  "business": "business",
  "tech business": "business",
  "gaming": "gaming",
  "reviews": "reviews",
  "how-to": "how-to",
  "howto": "how-to",
  "guides": "how-to",
  "opinion": "opinion",
  "science": "science",
};

function resolveHtmlPath() {
  const candidates = [
    process.env.HTML_PATH,
    path.resolve(process.cwd(), "index.html"),
    path.resolve(process.cwd(), "gh-pages/index.html"),
    path.resolve(__dirname, "../index.html"),
    path.resolve(__dirname, "../../gh-pages/index.html"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(process.cwd(), "index.html");
}

const HTML_PATH = resolveHtmlPath();

// ── Logging & Text Utilities ─────────────────────────────────────────────────
function log(msg) {
  console.log(`[sync] ${msg}`);
}
function warn(msg) {
  console.warn(`[sync:warn] ${msg}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(value) {
  return decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDeletedOrFixtureSlug(slug, dynamicTombstones) {
  if (!slug) return true;
  const norm = String(slug).trim().toLowerCase();
  if (!norm) return true;
  if (KNOWN_DELETED_SLUGS.has(norm)) return true;
  if (dynamicTombstones && dynamicTombstones.has(norm)) return true;
  return DELETED_SLUG_PATTERNS.some((re) => re.test(norm));
}

function isStaleAsset(url) {
  if (!url) return true;
  let decoded = String(url).trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // ignore
  }
  const lower = decoded.toLowerCase();
  if (lower.includes("/og-fallback.")) return true;
  return STALE_ASSET_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isRasterImageUrl(url) {
  if (!url) return false;
  try {
    const pathname = new URL(url, CANONICAL_ORIGIN).pathname.toLowerCase();
    return !pathname.endsWith(".svg") && !pathname.endsWith(".svgz");
  } catch {
    return false;
  }
}

function normalizeImageUrl(rawUrl) {
  if (!rawUrl) return null;
  const trimmed = decodeEntities(String(rawUrl)).trim();
  if (!trimmed || isStaleAsset(trimmed)) return null;
  let resolved = trimmed;
  if (trimmed.startsWith("/")) {
    resolved = `${CANONICAL_ORIGIN}${trimmed}`;
  } else if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  if (!isRasterImageUrl(resolved)) return null;
  return resolved;
}

function resolveCategorySlug(categoryName) {
  if (!categoryName) return "ai";
  const norm = String(categoryName).trim().toLowerCase();
  if (CATEGORY_SLUG_MAP[norm]) return CATEGORY_SLUG_MAP[norm];
  const slugified = norm.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return CATEGORY_SLUG_MAP[slugified] || slugified || "ai";
}

function toCanonicalUrl(urlOrPath) {
  try {
    const u = new URL(urlOrPath, SITE_URL);
    const out = new URL(u.pathname + u.search, CANONICAL_ORIGIN);
    return out.href.replace(/\/+$/, "");
  } catch {
    return `${CANONICAL_ORIGIN}`;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "xSypher-GitHubPages-Sync/2.0 (+https://xsypher.com/robots.txt)",
        "Accept": options.accept || "*/*",
        ...(options.headers || {}),
      },
      ...options,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── Step 1: Fetch Runtime Tombstones (/api/deleted-slugs) ────────────────────
async function fetchRuntimeTombstones() {
  const set = new Set();
  try {
    const res = await fetchWithTimeout(`${SITE_URL}/api/deleted-slugs`, {
      accept: "application/json",
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.slugs)) {
        for (const s of data.slugs) {
          if (typeof s === "string" && s.trim()) set.add(s.trim().toLowerCase());
        }
      }
      log(`Runtime tombstones loaded: ${set.size}`);
    }
  } catch (err) {
    warn(`Could not fetch /api/deleted-slugs (using compiled-in list): ${err.message}`);
  }
  return set;
}

// ── Step 2: Fetch & Parse RSS 2.0 Feed (/feed.xml) ───────────────────────────
async function fetchRssArticles(dynamicTombstones) {
  const feedUrl = `${SITE_URL}/feed.xml`;
  log(`Fetching RSS feed: ${feedUrl}`);
  const res = await fetchWithTimeout(feedUrl, {
    accept: "application/rss+xml, application/xml, text/xml",
  });
  if (!res.ok) {
    throw new Error(`RSS feed returned HTTP ${res.status}`);
  }
  const xml = await res.text();
  return parseRssXml(xml, dynamicTombstones);
}

function parseRssXml(xml, dynamicTombstones) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const extractTag = (tag) => {
      const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
      const m = re.exec(block);
      return m ? decodeEntities(m[1]).trim() : null;
    };
    const extractAttr = (tag, attr) => {
      const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i");
      const m = re.exec(block);
      return m ? decodeEntities(m[1]).trim() : null;
    };

    const title = stripHtml(extractTag("title"));
    const link = extractTag("link") || extractTag("guid");
    const pubDateRaw = extractTag("pubDate");
    const description = stripHtml(extractTag("description"));
    const author = stripHtml(extractTag("author") || extractTag("dc:creator")) || "xSypher Editorial";
    const category = stripHtml(extractTag("category"));
    const mediaUrl =
      extractAttr("media:content", "url") ||
      extractAttr("media:thumbnail", "url") ||
      extractAttr("enclosure", "url");

    if (!title || !link) continue;

    let slug = null;
    try {
      const parsed = new URL(link, SITE_URL);
      const m = parsed.pathname.match(/^\/article\/([^/?#]+)$/);
      if (m) slug = decodeURIComponent(m[1]);
    } catch {
      // ignore malformed URL
    }

    if (!slug || isDeletedOrFixtureSlug(slug, dynamicTombstones)) {
      if (slug) warn(`Skipping tombstoned/fixture slug from RSS: ${slug}`);
      continue;
    }

    const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
    items.push({
      slug,
      title,
      probeUrl: `${SITE_URL}/article/${encodeURIComponent(slug)}`,
      canonicalUrl: `${CANONICAL_ORIGIN}/article/${encodeURIComponent(slug)}`,
      pubDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null,
      deck: description ? description.slice(0, 260) : "",
      author,
      category: category || null,
      tags: [],
      readingTime: null,
      image: normalizeImageUrl(mediaUrl),
    });
  }
  return items;
}

// ── Step 3: Fetch Sitemaps (/sitemap/pages.xml & /sitemap/articles.xml) ──────
async function fetchSitemapData(dynamicTombstones) {
  const imageMap = new Map();
  const fallbackArticles = [];
  const endpoints = [
    `${SITE_URL}/sitemap/pages.xml`,
    `${SITE_URL}/sitemap/articles.xml`,
  ];

  for (const endpoint of endpoints) {
    try {
      log(`Fetching sitemap: ${endpoint}`);
      const res = await fetchWithTimeout(endpoint, {
        accept: "application/xml, text/xml",
      });
      if (!res.ok) {
        warn(`Sitemap ${endpoint} returned HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
      let m;
      while ((m = urlRegex.exec(xml)) !== null) {
        const block = m[1];
        const locMatch = /<loc>([\s\S]*?)<\/loc>/i.exec(block);
        if (!locMatch) continue;
        const loc = decodeEntities(locMatch[1]).trim();
        let slug = null;
        try {
          const u = new URL(loc, SITE_URL);
          const pm = u.pathname.match(/^\/article\/([^/?#]+)$/);
          if (pm) slug = decodeURIComponent(pm[1]);
        } catch {
          // ignore
        }
        if (!slug || isDeletedOrFixtureSlug(slug, dynamicTombstones)) continue;

        const imgLocMatch = /<image:loc>([\s\S]*?)<\/image:loc>/i.exec(block);
        const imgTitleMatch = /<image:title>([\s\S]*?)<\/image:title>/i.exec(block);
        const newsTitleMatch = /<news:title>([\s\S]*?)<\/news:title>/i.exec(block);
        const lastmodMatch = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(block);
        const newsDateMatch = /<news:publication_date>([\s\S]*?)<\/news:publication_date>/i.exec(block);

        const imgUrl = imgLocMatch ? normalizeImageUrl(imgLocMatch[1]) : null;
        if (imgUrl && !imageMap.has(slug)) {
          imageMap.set(slug, imgUrl);
        }

        const fallbackTitle = stripHtml(
          (newsTitleMatch && newsTitleMatch[1]) ||
          (imgTitleMatch && imgTitleMatch[1]) ||
          slug.replace(/-/g, " ")
        );
        const dateStr = (newsDateMatch && newsDateMatch[1]) || (lastmodMatch && lastmodMatch[1]);
        const pubDate = dateStr ? new Date(decodeEntities(dateStr).trim()) : null;

        fallbackArticles.push({
          slug,
          title: fallbackTitle,
          probeUrl: `${SITE_URL}/article/${encodeURIComponent(slug)}`,
          canonicalUrl: `${CANONICAL_ORIGIN}/article/${encodeURIComponent(slug)}`,
          pubDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null,
          deck: "",
          author: "xSypher Editorial",
          category: null,
          tags: [],
          readingTime: null,
          image: imgUrl,
        });
      }
    } catch (err) {
      warn(`Sitemap fetch error (${endpoint}): ${err.message}`);
    }
  }

  log(`Sitemap images mapped: ${imageMap.size}`);
  return { imageMap, fallbackArticles };
}

// ── Step 4: Validate HTTP 200 & Extract Article Metadata ─────────────────────
function extractMetaContent(html, attrName, attrValue) {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

function extractAllMetaContents(html, attrName, attrValue) {
  const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const results = [];
  const re = new RegExp(
    `<meta[^>]+(?:${attrName}=["']${escaped}["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+${attrName}=["']${escaped}["'])[^>]*>`,
    "gi"
  );
  let m;
  while ((m = re.exec(html)) !== null) {
    const val = decodeEntities(m[1] || m[2] || "").trim();
    if (val) results.push(val);
  }
  return results;
}

function extractArticleJsonLd(html) {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
          ? parsed["@graph"]
          : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const t = node["@type"];
        const types = Array.isArray(t) ? t : [t];
        if (types.includes("NewsArticle") || types.includes("BlogPosting") || types.includes("TechArticle") || types.includes("Article")) {
          return node;
        }
      }
    } catch {
      // ignore invalid JSON-LD block
    }
  }
  return null;
}

async function validateAndEnrichArticle(article, sitemapImages, dynamicTombstones) {
  try {
    const res = await fetchWithTimeout(article.probeUrl, {
      method: "GET",
      accept: "text/html,application/xhtml+xml",
    });

    if (res.status !== 200) {
      warn(`DROP [${article.slug}]: HTTP ${res.status}`);
      return null;
    }

    const finalUrl = res.url || article.probeUrl;
    let finalParsed;
    try {
      finalParsed = new URL(finalUrl);
    } catch {
      warn(`DROP [${article.slug}]: invalid final URL ${finalUrl}`);
      return null;
    }

    // Reject redirects to homepage or any non-/article/ route
    const slugMatch = finalParsed.pathname.match(/^\/article\/([^/?#]+)$/);
    if (!slugMatch) {
      warn(`DROP [${article.slug}]: redirected to non-article path (${finalParsed.pathname})`);
      return null;
    }

    const resolvedSlug = decodeURIComponent(slugMatch[1]);
    if (isDeletedOrFixtureSlug(resolvedSlug, dynamicTombstones)) {
      warn(`DROP [${article.slug}]: resolved slug "${resolvedSlug}" is tombstoned`);
      return null;
    }

    const html = await res.text();

    // Guard against soft-404 documents
    const robotsMeta = extractMetaContent(html, "name", "robots") || "";
    if (robotsMeta.toLowerCase().includes("noindex")) {
      warn(`DROP [${article.slug}]: page carries noindex meta directive`);
      return null;
    }

    const jsonLd = extractArticleJsonLd(html);

    // 1. Canonical URL resolution
    let canonical = `${CANONICAL_ORIGIN}/article/${encodeURIComponent(resolvedSlug)}`;
    const linkCanonicalMatch = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i.exec(html);
    if (linkCanonicalMatch && linkCanonicalMatch[1]) {
      const candidateCanon = toCanonicalUrl(decodeEntities(linkCanonicalMatch[1]).trim());
      if (candidateCanon.includes(`/article/`)) {
        canonical = candidateCanon;
      }
    }

    // 2. Cover Image resolution:
    //    Priority: RSS media -> Sitemap <image:loc> -> JSON-LD image -> og:image (prefer non-/api/og R2 photo) -> /api/og -> fallback
    let jsonLdImg = null;
    if (jsonLd?.image) {
      const imgNode = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
      jsonLdImg = typeof imgNode === "string" ? imgNode : imgNode?.url;
    }
    const ogImg =
      extractMetaContent(html, "property", "og:image") ||
      extractMetaContent(html, "name", "twitter:image");

    const preferredCandidates = [
      article.image,
      sitemapImages.get(resolvedSlug),
      sitemapImages.get(article.slug),
      normalizeImageUrl(jsonLdImg),
      ogImg && !ogImg.includes("/api/og") ? normalizeImageUrl(ogImg) : null,
      ogImg ? normalizeImageUrl(ogImg) : null,
    ].filter(Boolean);

    const coverImage = preferredCandidates[0] || FALLBACK_COVER;

    // 3. Title & Deck enrichment
    const enrichedTitle =
      article.title ||
      stripHtml(jsonLd?.headline) ||
      extractMetaContent(html, "property", "og:title") ||
      resolvedSlug;

    const enrichedDeck =
      article.deck ||
      stripHtml(jsonLd?.description) ||
      extractMetaContent(html, "name", "description") ||
      extractMetaContent(html, "property", "og:description") ||
      "Read the full technical analysis and original reporting on xSypher.";

    // 4. Category resolution
    const categoryName =
      article.category ||
      stripHtml(jsonLd?.articleSection) ||
      extractMetaContent(html, "property", "article:section") ||
      "Technology";
    const categorySlug = resolveCategorySlug(categoryName);

    // 5. Tags resolution
    const metaTags = extractAllMetaContents(html, "property", "article:tag");
    const jsonKeywords = typeof jsonLd?.keywords === "string"
      ? jsonLd.keywords.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(jsonLd?.keywords)
        ? jsonLd.keywords
        : [];
    const tags = [...new Set([...metaTags, ...jsonKeywords])].slice(0, 4);

    // 6. Reading time resolution (e.g. PT6M -> 6 min read)
    let readingTime = article.readingTime;
    if (!readingTime && typeof jsonLd?.timeRequired === "string") {
      const tm = jsonLd.timeRequired.match(/PT(\d+)M/i);
      if (tm) readingTime = Number(tm[1]);
    }

    // 7. Publication & Modification Date resolution
    const pubIso =
      extractMetaContent(html, "property", "article:published_time") ||
      jsonLd?.datePublished ||
      (article.pubDate ? article.pubDate.toISOString() : new Date().toISOString());
    const modIso =
      extractMetaContent(html, "property", "article:modified_time") ||
      jsonLd?.dateModified ||
      pubIso;

    // 8. Author resolution
    let authorName = article.author;
    if ((!authorName || authorName === "xSypher Editorial") && jsonLd?.author) {
      const authNode = Array.isArray(jsonLd.author) ? jsonLd.author[0] : jsonLd.author;
      if (authNode?.name) authorName = stripHtml(authNode.name);
    }

    return {
      slug: resolvedSlug,
      title: enrichedTitle,
      deck: enrichedDeck.slice(0, 240),
      canonicalUrl: canonical,
      image: coverImage,
      categoryName,
      categorySlug,
      categoryUrl: `${CANONICAL_ORIGIN}/category/${encodeURIComponent(categorySlug)}`,
      tags,
      readingTime: readingTime || 5,
      publishedAt: new Date(pubIso),
      modifiedAt: new Date(modIso),
      author: authorName || "xSypher Editorial",
    };
  } catch (err) {
    warn(`DROP [${article.slug}]: validation error (${err.message})`);
    return null;
  }
}

async function validateArticlesConcurrent(candidates, sitemapImages, dynamicTombstones) {
  log(`Validating & enriching ${candidates.length} candidate URLs (concurrency=${CONCURRENCY})...`);
  const results = new Array(candidates.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor++;
      results[index] = await validateAndEnrichArticle(
        candidates[index],
        sitemapImages,
        dynamicTombstones
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker())
  );

  // Deduplicate by canonical URL while preserving order
  const seen = new Set();
  const valid = [];
  for (const item of results) {
    if (!item) continue;
    if (seen.has(item.canonicalUrl)) continue;
    seen.add(item.canonicalUrl);
    valid.push(item);
  }
  log(`Validated ${valid.length}/${candidates.length} live canonical articles.`);
  return valid;
}

// ── Step 5: Render Rich HTML Cards & Dynamic JSON-LD ─────────────────────────
function formatDisplayDate(date) {
  if (!date || isNaN(date.getTime())) return "Oct 2026";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function renderArticleCard(article, isFeatured) {
  const url = escapeHtml(article.canonicalUrl);
  const title = escapeHtml(article.title);
  const deck = escapeHtml(article.deck);
  const img = escapeHtml(article.image);
  const catName = escapeHtml(article.categoryName);
  const catUrl = escapeHtml(article.categoryUrl);
  const author = escapeHtml(article.author);
  const dateDisplay = escapeHtml(formatDisplayDate(article.publishedAt));
  const dateIso = escapeHtml(article.publishedAt.toISOString());
  const readMins = escapeHtml(`${article.readingTime || 5} min read`);
  const cardClass = isFeatured ? "article-card featured" : "article-card";
  const badgeText = isFeatured ? `Lead Deep Dive · ${catName}` : catName;

  const tagsHtml =
    article.tags && article.tags.length > 0
      ? `\n          <div class="card-tags" aria-label="Article tags">${article.tags
          .map((t) => `<span class="card-tag">#${escapeHtml(t)}</span>`)
          .join("")}</div>`
      : "";

  return `      <article class="${cardClass}" itemscope itemtype="https://schema.org/TechArticle">
        <a href="${url}" class="card-media" aria-label="${title}">
          <img src="${img}" alt="${title}" loading="lazy" width="640" height="360" itemprop="image">
          <span class="card-badge"><i aria-hidden="true"></i> ${badgeText}</span>
        </a>
        <div class="card-body">
          <div class="card-kicker-row">
            <a href="${catUrl}" class="card-cat" itemprop="articleSection">${catName}</a>
            <span class="card-readtime">${readMins}</span>
          </div>
          <h3 class="card-title" itemprop="headline"><a href="${url}" itemprop="url mainEntityOfPage">${title}</a></h3>
          <p class="card-excerpt" itemprop="description">${deck}</p>${tagsHtml}
          <div class="card-foot">
            <span class="card-author" itemprop="author" itemscope itemtype="https://schema.org/Person">
              <img src="${escapeHtml(FALLBACK_ICON)}" alt="" width="22" height="22" loading="lazy">
              <span itemprop="name">${author}</span>
            </span>
            <span class="card-source-tag" title="Original Publication Source">xsypher.com</span>
            <span class="card-date"><time datetime="${dateIso}" itemprop="datePublished">${dateDisplay}</time></span>
          </div>
          <a href="${url}" class="card-cta">Read full analysis on xSypher <span aria-hidden="true">→</span></a>
        </div>
      </article>`;
}

function buildCollectionJsonLd(articles) {
  const nowIso = new Date().toISOString();
  const itemListElement = articles.map((a, idx) => ({
    "@type": "ListItem",
    "position": idx + 1,
    "url": a.canonicalUrl,
    "name": a.title,
    "item": {
      "@type": ["BlogPosting", "TechArticle"],
      "@id": `${a.canonicalUrl}#article`,
      "headline": a.title,
      "description": a.deck,
      "url": a.canonicalUrl,
      "isBasedOn": a.canonicalUrl,
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": a.canonicalUrl,
      },
      "image": {
        "@type": "ImageObject",
        "@id": `${a.canonicalUrl}#primaryimage`,
        "url": a.image,
        "width": 1200,
        "representativeOfPage": true,
        "caption": a.title,
      },
      "datePublished": a.publishedAt.toISOString(),
      "dateModified": a.modifiedAt.toISOString(),
      "author": {
        "@type": a.author.startsWith("xSypher") ? "Organization" : "Person",
        "name": a.author,
      },
      "publisher": {
        "@type": "Organization",
        "@id": `${CANONICAL_ORIGIN}/#organization`,
        "name": "xSypher Media",
        "url": `${CANONICAL_ORIGIN}/`,
        "logo": {
          "@type": "ImageObject",
          "url": `${CANONICAL_ORIGIN}/xsypher-logo-full.png`,
        },
      },
      "articleSection": a.categoryName,
      ...(a.tags && a.tags.length ? { "keywords": a.tags.join(", ") } : {}),
      "timeRequired": `PT${Math.max(1, Number(a.readingTime) || 5)}M`,
      "isAccessibleForFree": true,
      "inLanguage": "en-US",
    },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": "https://thexsypher.github.io/#showcase-collection",
    "name": "xSypher — Engineering Showcase & Selected Publications",
    "description":
      "Live syndicated index of the latest original engineering deep dives, cybersecurity advisories, AI benchmarks and hardware reviews published on xSypher.",
    "url": "https://thexsypher.github.io/",
    "isPartOf": { "@id": `${CANONICAL_ORIGIN}/#website` },
    "about": { "@id": `${CANONICAL_ORIGIN}/#organization` },
    "publisher": { "@id": `${CANONICAL_ORIGIN}/#organization` },
    "inLanguage": "en-US",
    "dateModified": nowIso,
    "numberOfItems": articles.length,
    "mainEntity": {
      "@type": "ItemList",
      "name": "Latest Publications from xSypher",
      "itemListOrder": "https://schema.org/ItemListOrderDescending",
      "numberOfItems": articles.length,
      "itemListElement": itemListElement,
    },
  };
}

function renderLiveIndex(articles) {
  const items = articles
    .map((a) => {
      const url = escapeHtml(a.canonicalUrl);
      const title = escapeHtml(a.title);
      const rawSnippet = a.deck || a.description || "Independent technology news, deep-dive analysis, and research.";
      const cleanSnippet = rawSnippet.trim().replace(/\s+/g, " ");
      const snippet = escapeHtml(
        cleanSnippet.length > 160 ? `${cleanSnippet.slice(0, 157).trim()}...` : cleanSnippet
      );
      return `        <li><a href="${url}" rel="dofollow"><strong>${title}</strong></a> - ${snippet}</li>`;
    })
    .join("\n");

  return [
    `    <!-- LIVE_INDEX_START -->`,
    `    <div class="live-index-wrapper" style="margin: 2rem 0; padding: 1.5rem; background: var(--card, #12151f); border: 1px solid var(--line, #1e2636); border-radius: var(--radius, 14px);">`,
    `      <h3 style="font-family: var(--font-display, inherit); font-size: 1.15rem; margin-top: 0; margin-bottom: 0.75rem; color: var(--ink, #fff);">Real-Time Publication Index</h3>`,
    `      <ul class="live-editorial-index" style="list-style: disc; padding-left: 1.5rem; margin: 0; display: flex; flex-direction: column; gap: 0.65rem;">`,
    items,
    `      </ul>`,
    `    </div>`,
    `    <!-- LIVE_INDEX_END -->`,
  ].join("\n");
}

function syncArticleMarkdownFiles(articles) {
  const articlesDir = path.resolve(__dirname, "..", "articles");
  if (!fs.existsSync(articlesDir)) {
    fs.mkdirSync(articlesDir, { recursive: true });
  }

  let count = 0;
  for (const a of articles) {
    if (!a.slug) continue;
    const filePath = path.join(articlesDir, `${a.slug}.md`);
    const canonicalUrl = a.canonicalUrl || `${CANONICAL_ORIGIN}/article/${a.slug}`;
    const pubIso = a.publishedAt && !isNaN(a.publishedAt.getTime())
      ? a.publishedAt.toISOString()
      : new Date().toISOString();
    const pubDateStr = pubIso.slice(0, 10);
    const summary = a.deck || a.description || "";
    const cleanSnippet = summary.trim().replace(/\s+/g, " ");
    const snippet = cleanSnippet.length > 280 ? `${cleanSnippet.slice(0, 277).trim()}...` : cleanSnippet;
    const author = a.author || "xSypher Editorial Team";
    const categoryName = a.categoryName || "Technology";
    const categorySlug = a.categorySlug || categoryName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const tags = Array.isArray(a.tags) ? a.tags : [];

    const yamlLines = [
      "---",
      `title: ${JSON.stringify(a.title)}`,
      `description: ${JSON.stringify(snippet)}`,
      `canonical_url: ${JSON.stringify(canonicalUrl)}`,
      `published_at: ${JSON.stringify(pubIso)}`,
      `author: ${JSON.stringify(author)}`,
      `category: ${JSON.stringify(categoryName)}`,
      `category_slug: ${JSON.stringify(categorySlug)}`,
    ];

    if (tags.length > 0) {
      yamlLines.push("tags:");
      for (const t of tags) {
        yamlLines.push(`  - ${JSON.stringify(t)}`);
      }
    } else {
      yamlLines.push("tags: []");
    }

    if (a.image) {
      yamlLines.push(`cover_image: ${JSON.stringify(a.image)}`);
    }

    yamlLines.push("---");
    yamlLines.push("");

    const bodyLines = [
      `# ${a.title}`,
      "",
      `> **Original Publication:** This research was originally published on **[xSypher](${canonicalUrl})** on ${pubDateStr}.`,
      "",
      "## Executive Summary",
      "",
      summary ? summary.trim() : snippet,
      "",
      "---",
      "",
      "### Primary Research & Full Investigation",
      `Read the full analysis, verified benchmarks, and interactive system models on **[xSypher: ${a.title}](${canonicalUrl})**.`,
      "",
      `- **Canonical Reference:** [${canonicalUrl}](${canonicalUrl})`,
      `- **Editorial Vertical:** [${categoryName}](${CANONICAL_ORIGIN}/category/${categorySlug})`,
      `- **Publisher:** [xSypher Media](${CANONICAL_ORIGIN})`,
      "",
    ];

    const content = [...yamlLines, ...bodyLines].join("\n");
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content) {
      fs.writeFileSync(filePath, content, "utf8");
      count++;
    }
  }

  if (count > 0) {
    log(`Synchronized ${count} article markdown files in articles/.`);
  }
}

function updateIndexHtml(originalHtml, articles) {
  const gridCards = articles
    .map((a, idx) => renderArticleCard(a, idx === 0 && articles.length >= 4))
    .join("\n");

  const syncDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const syncIso = new Date().toISOString();

  let html = originalHtml;

  // 1. Inject live text index between <!-- LIVE_INDEX_START --> and <!-- LIVE_INDEX_END -->
  const liveIndexMarkerRe = /<!-- LIVE_INDEX_START[\s\S]*?-->[\s\S]*?<!-- LIVE_INDEX_END -->/;
  if (liveIndexMarkerRe.test(html)) {
    html = html.replace(liveIndexMarkerRe, renderLiveIndex(articles));
  } else {
    warn("Could not find <!-- LIVE_INDEX_START --> ... <!-- LIVE_INDEX_END --> markers in index.html");
  }

  // 2. Inject article cards between <!-- ARTICLES:START ... --> and <!-- ARTICLES:END -->
  const markerRe = /<!-- ARTICLES:START[\s\S]*?-->[\s\S]*?<!-- ARTICLES:END -->/;
  const replacementBlock = [
    `<!-- ARTICLES:START — auto-synced from ${CANONICAL_ORIGIN}/feed.xml -->`,
    `    <div class="article-grid" id="article-grid" aria-live="polite">`,
    gridCards,
    `    </div>`,
    `    <!-- ARTICLES:END -->`,
  ].join("\n");

  if (markerRe.test(html)) {
    html = html.replace(markerRe, replacementBlock);
  } else {
    throw new Error("Could not find <!-- ARTICLES:START --> ... <!-- ARTICLES:END --> markers in index.html");
  }

  // 3. Inject dynamic CollectionPage + ItemList JSON-LD
  const jsonLdString = JSON.stringify(buildCollectionJsonLd(articles), null, 2);
  const schemaRe = /<script[^>]+id=["']collection-schema["'][^>]*>[\s\S]*?<\/script>/i;
  if (schemaRe.test(html)) {
    html = html.replace(
      schemaRe,
      `<script type="application/ld+json" id="collection-schema">\n${jsonLdString}\n</script>`
    );
  } else {
    throw new Error('Could not find <script id="collection-schema"> in index.html');
  }

  // 4. Update sync status badge & build timestamp
  html = html.replace(
    /<span id="sync-text">[\s\S]*?<\/span>/,
    `<span id="sync-text">Live Editorial Feed · Updated ${escapeHtml(syncDate)}</span>`
  );
  html = html.replace(
    /<time id="build-time"[^>]*>[\s\S]*?<\/time>/,
    `<time id="build-time" datetime="${escapeHtml(syncIso)}">${escapeHtml(syncDate)}</time>`
  );

  return html;
}

// ── Main Execution ───────────────────────────────────────────────────────────
async function main() {
  log(`Origin: ${SITE_URL} (Canonical: ${CANONICAL_ORIGIN})`);
  log(`Target HTML: ${HTML_PATH}`);

  if (!fs.existsSync(HTML_PATH)) {
    console.error(`[sync] ERROR: Target HTML file not found at ${HTML_PATH}`);
    process.exit(1);
  }

  const originalHtml = fs.readFileSync(HTML_PATH, "utf8");
  const dynamicTombstones = await fetchRuntimeTombstones();

  // Fetch RSS + Sitemap in parallel
  const [rssResult, sitemapResult] = await Promise.allSettled([
    fetchRssArticles(dynamicTombstones),
    fetchSitemapData(dynamicTombstones),
  ]);

  const rssArticles = rssResult.status === "fulfilled" ? rssResult.value : [];
  if (rssResult.status === "rejected") {
    warn(`RSS fetch failed: ${rssResult.reason?.message || rssResult.reason}`);
  }

  const sitemapImages =
    sitemapResult.status === "fulfilled" ? sitemapResult.value.imageMap : new Map();
  const sitemapFallback =
    sitemapResult.status === "fulfilled" ? sitemapResult.value.fallbackArticles : [];

  // Combine candidates: RSS primary, sitemap fallback if RSS is empty or has fewer than MAX_ARTICLES
  const candidateMap = new Map();
  for (const a of rssArticles) {
    candidateMap.set(a.slug, a);
  }
  for (const a of sitemapFallback) {
    if (!candidateMap.has(a.slug) && candidateMap.size < MAX_ARTICLES * 2) {
      candidateMap.set(a.slug, a);
    }
  }

  const candidates = [...candidateMap.values()].slice(0, MAX_ARTICLES + 6);
  if (candidates.length === 0) {
    warn("No candidate articles retrieved from RSS or Sitemap. Preserving existing index.html without failing.");
    process.exit(0);
  }

  const validated = await validateArticlesConcurrent(
    candidates,
    sitemapImages,
    dynamicTombstones
  );

  if (validated.length === 0) {
    warn("0 candidate URLs passed HTTP 200 validation. Preserving existing index.html without overwriting.");
    process.exit(0);
  }

  const finalArticles = validated.slice(0, MAX_ARTICLES);
  const updatedHtml = updateIndexHtml(originalHtml, finalArticles);

  // Compare ignoring volatile ISO timestamps if needed, or write updated HTML
  fs.writeFileSync(HTML_PATH, updatedHtml, "utf8");
  log(`Successfully updated ${HTML_PATH} with ${finalArticles.length} verified articles.`);

  syncArticleMarkdownFiles(finalArticles);
}

main().catch((err) => {
  console.error(`[sync] Unhandled fatal error: ${err.stack || err.message}`);
  process.exit(1);
});
