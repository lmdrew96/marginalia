// One-time migration (v0.17.0): adds the grade_requests table behind the
// daily limit on Claude-graded short answers. Additive and idempotent. Run
// it before the new code deploys: the grade route reads and writes it.
//
//   node --env-file=.env.local scripts/add-grade-requests.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`CREATE TABLE IF NOT EXISTS grade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`;
await sql`CREATE INDEX IF NOT EXISTS grade_requests_user_created
  ON grade_requests (user_id, created_at)`;
console.log("grade_requests is in place.");
