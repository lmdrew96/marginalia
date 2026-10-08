// One-time migration (v0.27.0): adds library folders. A folders table, and
// documents.folder_id (null = unfiled; deleting a folder unfiles its
// documents). Additive and idempotent. Run it before the new code deploys:
// every documents query selects folder_id.
//
//   node --env-file=.env.local scripts/add-folders.mjs

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS folders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS folders_user_name ON folders (user_id, name)`;
await sql`
  ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL
`;
console.log("folders and documents.folder_id are in place.");
