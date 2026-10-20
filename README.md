# xSypher — Official Engineering Showcase & Open Publications Hub

<p align="center">
  <a href="https://xsypher.com">
    <img src="https://thexsypher.github.io/assets/logo.png" alt="xSypher Official Logo" width="360" />
  </a>
</p>

<p align="center">
  <strong>Independent Technology Publication & Systems Engineering Showcase</strong><br />
  Original investigative reporting, benchmark-backed analysis, and deep-dive technical research on AI, cybersecurity, software architecture, and the tech economy.
</p>

<p align="center">
  <a href="https://xsypher.com"><img src="https://img.shields.io/badge/Production-xsypher.com-ff0a2b?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Site"></a>
  <a href="https://thexsypher.github.io"><img src="https://img.shields.io/badge/Showcase-thexsypher.github.io-11141d?style=for-the-badge&logo=githubpages&logoColor=white" alt="GitHub Pages"></a>
  <a href="https://github.com/thexsypher/thexsypher.github.io/actions/workflows/sync.yml"><img src="https://img.shields.io/github/actions/workflow/status/thexsypher/thexsypher.github.io/sync.yml?branch=main&style=for-the-badge&label=Feed%20Sync&color=22c55e" alt="Feed Sync Status"></a>
  <a href="https://xsypher.com/feed.xml"><img src="https://img.shields.io/badge/RSS_2.0-Syndicated-f97316?style=for-the-badge&logo=rss&logoColor=white" alt="RSS 2.0 Feed"></a>
</p>

---

## 🌐 Platform Overview

This repository hosts the official open-source engineering portal and syndication hub for **[xSypher](https://xsypher.com)** at **[thexsypher.github.io](https://thexsypher.github.io/)**. 

It serves two primary engineering functions:
1. **Interactive Architecture Showcase:** A live, zero-dependency technical portal documenting the multi-tier production architecture powering `xsypher.com` (Next.js 16 App Router, Drizzle ORM, Cloudflare R2, Neon Serverless, and ARM64 Docker Compose).
2. **Automated Publication Syndication:** An autonomous, event-driven pipeline that ingests xSypher's live RSS 2.0 feeds and XML sitemaps every 6 hours, compiling a verified, machine-readable catalog with full schema validation and rich JSON-LD semantic graphs.

---

## 🏛️ Production Architecture & Technology Stack

The production platform at `xsypher.com` is engineered from scratch for sub-100ms global response times, sub-second cached full-text search, and zero cold-start database latency.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             xSypher Production Stack                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
      [ Next.js 16 App Router ]                 [ Cloudflare Edge ]
      • React 19 + Turbopack                    • HTTP/3 & 0-RTT TLS
      • Standalone ARM64 Build                  • Global CDN & Image Transforms
      • Scoped CSS Tokens & Tailwind v4         • WebP/AVIF On-The-Fly Resizing
                 │                                         │
        ┌────────┴────────┬────────────────────────────────┤
        ▼                 ▼                                ▼
[ Drizzle ORM 0.45 ]  [ Cloudflare R2 ]          [ BullMQ + Redis Cluster ]
• Postgres PgBouncer   • S3 Object Store          • Redis AOF Persistence
• Primary + Replica    • Article HTML & AST       • Scheduled Dispatcher
• Neon Serverless      • Presigned Uploads        • Worker Service (ARM64)
```

### Verified Subsystems

| Domain | Technology | Implementation Details |
|---|---|---|
| **Core UI & Framework** | `Next.js 16.4` & `React 19.2` | App Router, standalone Docker deployment, Turbopack bundling, and scoped CSS variables (`--ink`, `--surface`, `--accent`). |
| **Relational Data Layer** | `PostgreSQL` & `Drizzle ORM 0.45` | Neon Serverless with connection pooling via PgBouncer. Schema-level migrations with type-safe relational queries. |
| **Blob & Content Storage** | `Cloudflare R2` (S3 API) | Hybrid object storage model. Heavy article bodies (TipTap JSON and sanitized HTML) are decoupled from PostgreSQL and stored in R2. |
| **Editorial & Rich AST** | `TipTap 3.31` Suite | Custom AST extensions for Mermaid 12 diagrams, Recharts interactive data visualizations, and isomorphic DOMPurify sanitization. |
| **Async Worker Engine** | `BullMQ 6.3` & `Redis 6.0` | AOF-persisted background queue running inside dedicated ARM64 worker containers for scheduled article publishing and dispatching. |
| **Identity & Security** | `NextAuth v5` (Auth.js) | Capability-based Role-Based Access Control (RBAC), hardware TOTP 2FA encrypted at rest, and strict per-request CSP nonces. |
| **Search & Caching** | Next.js `unstable_cache` & ISR | Tagged multi-key cache invalidation (`articles`, `categories`, `authors`) delivering sub-millisecond in-memory catalog search. |

---

## 🔄 Automated Feed & Publication Sync Pipeline

The publications grid and structured data on `thexsypher.github.io` are automatically kept in 100% sync with `xsypher.com` via GitHub Actions.

```
[ GitHub Actions Cron ] (Every 6 Hours)
           │
           ├─► 1. Fetch https://xsypher.com/feed.xml (RSS 2.0 Feed)
           ├─► 2. Ingest https://xsypher.com/sitemap/articles.xml (Google News Sitemap)
           ├─► 3. Probe https://xsypher.com/api/deleted-slugs (Tombstone Filter)
           ├─► 4. Validate Candidate URLs (HTTP 200, Canonical Slugs, 0 Redirects)
           ├─► 5. Extract Rich Open Graph & Featured Media (Cloudflare R2 Capped)
           ├─► 6. Synthesize Semantic JSON-LD (CollectionPage + ItemList + BlogPosting)
           └─► 7. Commit & Deploy to GitHub Pages (If Diff Detected)
```

### Fault-Tolerant Invariants Enforced

* **HTTP 200 Verification:** Only live, canonical articles returning HTTP 200 are accepted. Redirects (301) are followed to final destinations; soft-404s and 410 Gone tombstones are immediately pruned.
* **Stale Asset Shield:** Images matching placeholder patterns (`homenest`, `placeholder-cover`, `lorem-ipsum`) are rejected in favor of verified editorial covers.
* **Semantic JSON-LD Integrity:** The workflow enforces strict schema validation for `Organization`, `WebSite`, `AboutPage`, and `CollectionPage` schema blocks prior to publication.
* **Zero External Dependencies:** Built entirely with Node.js 18+ native built-ins (`fetch`, `fs`, `path`).

---

## 🚀 Local Development & Inspection

To inspect, validate, or test the sync pipeline locally:

```bash
# 1. Clone the repository
git clone https://github.com/thexsypher/thexsypher.github.io.git
cd thexsypher.github.io

# 2. Run the syndication pipeline manually
node scripts/sync.mjs

# 3. Test local environment with custom configuration
SITE_URL=https://xsypher.com MAX_ARTICLES=12 node scripts/sync.mjs

# 4. Preview the static portal
npx serve .
# Or open index.html directly in any modern browser
```

---

## 📡 Editorial Desks & Publications Directory

xSypher provides continuous investigative coverage across 13 core technology verticals:

* 🤖 **[AI & Machine Learning](https://xsypher.com/category/ai)** — Autonomous agents, LLM inference benchmarks, evaluation pipelines, and transformer architectures.
* 🛡️ **[Cybersecurity & SecOps](https://xsypher.com/category/cybersecurity)** — Zero-trust identity, EDR/MDR tradeoffs, cryptographic primitives, and vulnerability research.
* 🏗️ **[Software Architecture](https://xsypher.com/category/software)** — Distributed systems, database internals, microservices, and edge runtime performance.
* 💻 **[Programming & Languages](https://xsypher.com/category/programming)** — TypeScript, Rust, Go, Python, and modern systems-level programming paradigms.
* ⚙️ **[Hardware & Gadgets](https://xsypher.com/category/gadgets)** — Silicon architectures, GPU clusters, hardware reviews, and embedded systems.
* 📊 **[Reviews & Benchmarks](https://xsypher.com/category/reviews)** — Objective, reproducible enterprise tool benchmarks and total cost of ownership breakdowns.
* 💼 **[Tech Business & Startups](https://xsypher.com/category/business)** — Venture economics, SaaS metrics, infrastructure pricing, and cloud provider economics.

---

## ⚖️ Standards, Transparency & Editorial Governance

xSypher adheres to the highest standards of journalistic integrity, factual accuracy, and editorial independence:

* 📋 **[Editorial Standards & Ethics](https://xsypher.com/page/editorial-standards)**
* 🔍 **[Editorial & Fact-Checking Policy](https://xsypher.com/page/editorial-policy)**
* ✏️ **[Corrections Policy & Audit Log](https://xsypher.com/page/corrections)**
* 📊 **[Transparency Report](https://xsypher.com/page/transparency)**
* 🔒 **[Privacy Policy](https://xsypher.com/page/privacy-policy)**
* 📜 **[Terms of Use](https://xsypher.com/page/terms-of-use)**

---

## 👥 Connect with xSypher

* **Official Website:** [https://xsypher.com](https://xsypher.com)
* **Engineering Showcase:** [https://thexsypher.github.io](https://thexsypher.github.io/)
* **X / Twitter:** [@ThexSypher](https://x.com/ThexSypher)
* **LinkedIn:** [xSypher Company Page](https://www.linkedin.com/company/xsypher/)
* **GitHub Organization:** [@thexsypher](https://github.com/thexsypher)
* **Threads:** [@thexsypher](https://www.threads.net/@thexsypher)
* **Instagram:** [@thexsypher](https://www.instagram.com/thexsypher)
* **Reddit:** [r/xsypher](https://www.reddit.com/r/xsypher/)
* **RSS Feed:** [https://xsypher.com/feed.xml](https://xsypher.com/feed.xml)

---

<p align="center">
  <sub>© 2026 xSypher Media. All rights reserved. Primary Canonical Origin: <a href="https://xsypher.com/">https://xsypher.com</a></sub>
</p>
