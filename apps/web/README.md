# @echo/web

Minimal Astro + Svelte + Tailwind frontend for poking the echo API.

## Stack

- Astro 5 (pages + layout)
- Svelte 5 (the single interactive island — `ProviderConsole.svelte`)
- TypeScript everywhere
- Tailwind 4 via `@tailwindcss/vite`

## Run

The frontend needs the backend running. From the repo root:

```bash
docker compose up -d            # postgres, redis, api, worker, osint-py
pnpm install                    # picks up the new @echo/web workspace member
pnpm --filter @echo/web dev     # opens http://localhost:4321
```

The API enables CORS for any `localhost` / `127.0.0.1` origin in dev, so
the browser can hit `http://localhost:3000/api/lookups` directly.

## What's on the page

A single console (`/`) with:

1. A dropdown of every active provider (sherlock, maigret, whatsmyname,
   socialscan, socid-extractor, mailcat, phonenumbers, phoneinfoga,
   telegram-resolve, truecaller, ignorant, hibp-pwned-passwords, ghunt,
   exiftool).
2. A form that adapts to the selected provider, prefilled with the
   same test triple as the Bruno collection (`efinswim`,
   `efinswim@gmail.com`, `+48537529192`).
3. A streaming event log that pretty-prints each SSE event as it
   arrives, terminating on `Final` or `Failed`.

A Cancel button does both: closes the EventSource and issues
`DELETE /api/lookups/<id>` so the backend tears down the job.

## Overrides

`PUBLIC_API_BASE` in an `.env` file overrides the default
`http://localhost:3000/api` — useful when pointing at a remote stack.

## Out of scope

This UI is intentionally tiny. It does NOT:

- Persist lookups (the backend already does that in Postgres).
- Resume mid-stream via `Last-Event-ID` (you can replay a lookup by
  re-running it).
- Pretty-render provider-specific outputs (everything is raw JSON).
- Use a state store / router beyond a single page.

Anything beyond that belongs in a real product surface, not the dev
console.
