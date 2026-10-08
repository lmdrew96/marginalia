// One-time migration (v0.25.0): adds last_page to documents so the reader
// reopens where you left off. Additive and idempotent. Run it before the
// new code deploys: every documents query selects this column.
//
//   node --env-file=.env.local scripts/add-last-page.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_page integer`;
console.log("documents.last_page is in place.");
