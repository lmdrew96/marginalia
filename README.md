Marginalia is a reading room for PDFs: highlights, margin notes, and Ask Claude in the sidebar, with highlights saved to ThreadNotes as excerpts.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Environment variables live in `.env.local`. Note that its `DATABASE_URL` points at the production database.

## Word (.docx) uploads

Word files are converted to PDF by [Gotenberg](https://gotenberg.dev). In development the app expects it on port 3001:

```bash
docker run --rm -p 3001:3000 gotenberg/gotenberg:8
```

Elsewhere, set `GOTENBERG_URL` to the service's address. Without it, Word uploads fail with an "unavailable" message and PDFs still work.

## Deploy

Marginalia runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Worker is configured in `wrangler.jsonc` and `open-next.config.ts`.

- `pnpm preview` builds the Worker and serves it locally in the Workers runtime. Use it to test anything server-side (PDF extraction, uploads) before shipping, since `pnpm dev` runs on Node instead.
- Deploys go through the Workers Builds git connection to `lmdrew96/marginalia`, not a local `pnpm deploy`. A local deploy pushes `wrangler.jsonc` over the dashboard's settings.
- The Worker bundle is about 4.4 MB gzipped, so it needs the Workers Paid plan (10 MB limit; free is 3 MB).

### Environment

Runtime values go in the Worker's Settings → Variables and secrets, as type **Secret**. A deploy keeps secrets but drops plain-text variables that aren't in `wrangler.jsonc`.

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk's middleware also reads it at runtime)
- `DATABASE_URL`
- `CLERK_SECRET_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `ANTHROPIC_API_KEY`
- `GOTENBERG_URL` (once Gotenberg is hosted)

The `NEXT_PUBLIC_CLERK_*` values (publishable key, sign-in/up URLs, fallback redirects) are compiled into the client at build time, so they also have to be build variables in Workers Builds. The publishable key goes in both places. With it only at build time, every request fails with "Missing publishableKey". Clerk's keys must come from the same instance (`pk_live_…` with `sk_live_…`). `THREADNOTES_URL` is optional and defaults to `https://research.adhdesigns.dev`.
