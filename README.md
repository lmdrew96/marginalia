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

In production Gotenberg runs as a Cloudflare Container inside the Worker (`worker.ts`, `containers` in `wrangler.jsonc`), reached through the private `GOTENBERG` binding. It has no public URL and sleeps after 5 idle minutes, so the first Word upload after a quiet spell waits a few seconds for it to start. Setting `GOTENBERG_URL` overrides the container. If conversion can't run, Word uploads fail with an "unavailable" message and PDFs still work.

## Deploy

Marginalia runs on Cloudflare Workers through [OpenNext](https://opennext.js.org/cloudflare). The Worker is configured in `wrangler.jsonc` and `open-next.config.ts`.

- `pnpm preview` builds the Worker and serves it locally in the Workers runtime. Use it to test anything server-side (PDF extraction, uploads) before shipping, since `pnpm dev` runs on Node instead.
- Deploys go through the Workers Builds git connection to `lmdrew96/marginalia`, not a local `pnpm deploy`. A local deploy pushes `wrangler.jsonc` over the dashboard's settings.
- It needs the Workers Paid plan: Containers require it, and the bundle (about 3.2 MB gzipped) is over the free plan's 3 MB limit.

### Environment

Runtime values go in the Worker's Settings → Variables and secrets, as type **Secret**. A deploy keeps secrets but drops plain-text variables that aren't in `wrangler.jsonc`.

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Clerk's middleware also reads it at runtime)
- `DATABASE_URL`
- `CLERK_SECRET_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `ANTHROPIC_API_KEY`

The `NEXT_PUBLIC_CLERK_*` values (publishable key, sign-in/up URLs, fallback redirects) are compiled into the client at build time, so they also have to be build variables in Workers Builds. The publishable key goes in both places. With it only at build time, every request fails with "Missing publishableKey". Clerk's keys must come from the same instance (`pk_live_…` with `sk_live_…`). `THREADNOTES_URL` is optional and defaults to `https://research.adhdesigns.dev`.
