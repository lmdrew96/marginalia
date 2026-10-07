// One-time migration (v0.20.0): links Marginalia to ThreadNotes. Adds the
// user's ThreadNotes API key and chosen project to user_settings, the
// ThreadNotes article (and its project) a document was opened from, and the
// excerpt each highlight is saved as. All nullable, additive, and
// idempotent. Run it before the new code deploys: the reader selects every
// documents and highlights column.
//
//   node --env-file=.env.local scripts/add-threadnotes-link.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS threadnotes_api_key text`;
await sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS threadnotes_project_id text`;
await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS threadnotes_article_id text`;
await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS threadnotes_project_id text`;
await sql`ALTER TABLE highlights ADD COLUMN IF NOT EXISTS threadnotes_excerpt_id text`;
// One document per ThreadNotes article per user, so opening it again goes
// back to the same highlights.
await sql`CREATE UNIQUE INDEX IF NOT EXISTS documents_user_threadnotes_article
  ON documents (user_id, threadnotes_article_id)
  WHERE threadnotes_article_id IS NOT NULL`;
console.log("ThreadNotes columns are in place.");
