# Project: "echo" — OSINT Aggregator Application

I want to build an application called **"echo"**.

## Concept

The backend will provide wrappers and services around various OSINT analysis tools. Two of the simplest starting examples:
- The **Sherlock** Python library
- A third-party API like **GetContact** (for phone number lookups)

Many more services will be added in the future — I plan to integrate a wide variety of them.

---

## Backend Requirements (initial scope)

1. **Basic wrappers** over external services and libraries.
2. **Scaffolding for user registration** (implementation can come later — just lay the groundwork for now).
3. **Scaffolding for payments**: Stripe, crypto, Privat24, Monobank, LiqPay (implementation can come later).
4. **Endpoints for the frontend** so it can display results.
5. **Handling long-running requests** — build in resilience for operations that take a while.
6. **Overload protection** — e.g. if the app is saturated or there's a queue, the system should fail gracefully rather than being unreachable.
7. **Hosting target** — one of: Hetzner VPS/VDS, Contabo VPS/VDS, or Cloudflare.
8. **Preferred stack** (latest versions, best practices, not over-engineered):
   - NestJS
   - Docker
   - PostgreSQL / MySQL
   - Drizzle (v1+)  
   - Effect-TS (v4)
   - Testing: Vitest / Playwright
   - Linting: Oxlint / Biome
   - API testing: Bruno
   - Anything else is your choice
9. **Caching** — likely worth planning for.

---

## Frontend Requirements

1. **Lightweight site**, deployable to Cloudflare, Contabo, or Hetzner.
2. **SSG or SSR** — my current preference is **Astro with Svelte in hybrid mode**.
3. **Multi-language switching**.
4. *(Future, not required now)* — page state persistence and caching.
5. **Interactive feedback during long parses** — e.g. showing which sites are currently being scanned. Possibly, in the future, a graph of connections/visibilities, or generated result tables.

---

## What I want from you

These are just my initial thoughts — we need to **brainstorm**, sketch out several plans and architectures, and consider:
- How the whole system could work end to end
- Which technologies fit best
- Other important questions I may not have considered

**Current focus: backend.**

Please produce **several distinct plans in Markdown format** so I can review them, pick one, optionally tweak it, and then start development.