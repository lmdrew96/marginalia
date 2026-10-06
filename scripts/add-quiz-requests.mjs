// One-time migration (v0.13.1): adds the quiz_requests table behind the
// daily quiz limit. Additive and idempotent. Run it before the new code
// deploys: the quiz route reads and writes this table.
//
//   node --env-file=.env.local scripts/add-quiz-requests.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`CREATE TABLE IF NOT EXISTS quiz_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS quiz_requests_user_created
  ON quiz_requests (user_id, created_at)`;
console.log("quiz_requests is in place.");
