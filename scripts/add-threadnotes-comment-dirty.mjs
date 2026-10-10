// One-time migration (v0.28.2): marks highlights whose margin note didn't
// reach ThreadNotes, so reopening the paper pushes the note instead of
// pulling the older excerpt comment over it. Additive and idempotent. Run it
// before the new code deploys: the reader selects every highlights column.
//
//   node --env-file=.env.local scripts/add-threadnotes-comment-dirty.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`ALTER TABLE highlights
  ADD COLUMN IF NOT EXISTS threadnotes_comment_dirty boolean NOT NULL DEFAULT false`;
console.log("highlights.threadnotes_comment_dirty is in place.");
