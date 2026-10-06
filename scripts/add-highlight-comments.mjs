// One-time migration (v0.8.0): adds the nullable highlights.comment column
// for margin notes. Additive and idempotent — safe to run before the new
// code deploys, and it must run before, since the reader selects every
// highlight column.
//
//   node --env-file=.env.local scripts/add-highlight-comments.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE highlights ADD COLUMN IF NOT EXISTS comment text`;
console.log("highlights.comment is in place.");
