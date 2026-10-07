// One-time migration (v0.16.0): adds page_count and last_opened_at to
// documents for the library cards. Additive and idempotent. Run it before
// the new code deploys: every documents query selects these columns.
//
//   node --env-file=.env.local scripts/add-document-reading-stats.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count integer`;
await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_opened_at timestamptz`;
console.log("documents.page_count and documents.last_opened_at are in place.");
