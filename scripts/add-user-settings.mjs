// One-time migration (v0.13.0): adds the user_settings table for the
// Claude Instructions setting. Additive and idempotent. Run it before the
// new code deploys: chat and quiz read this table on every request.
//
//   node --env-file=.env.local scripts/add-user-settings.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`CREATE TABLE IF NOT EXISTS user_settings (
  user_id text PRIMARY KEY,
  claude_instructions text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
)`;
console.log("user_settings is in place.");
