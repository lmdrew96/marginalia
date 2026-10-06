// One-time migration (v0.7.0): highlights and bookmarks move from offsets
// into the reflowed HTML (whole document) to page-based anchors on the real
// PDF pages.
//
//   node --env-file=.env.local scripts/migrate-page-anchors.mjs schema
//     Additive only: new nullable columns, old columns made nullable, and
//     the page_ocr table. Safe to run while the old app is still live.
//   node --env-file=.env.local scripts/migrate-page-anchors.mjs backfill [--apply]
//     Re-anchors every highlight/bookmark that has no page yet. Dry run
//     unless --apply. Idempotent — re-run after deploy to catch anything
//     the old app created in between.
//   node --env-file=.env.local scripts/migrate-page-anchors.mjs finalize
//     Destructive: makes the new columns NOT NULL and drops the old ones.
//     Run only once the new reader is deployed and checked.

import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const sql = neon(process.env.DATABASE_URL);
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const stage = process.argv[2];
const apply = process.argv.includes("--apply");

async function schema() {
  await sql`ALTER TABLE highlights
    ADD COLUMN IF NOT EXISTS page_number integer,
    ADD COLUMN IF NOT EXISTS page_start_offset integer,
    ADD COLUMN IF NOT EXISTS page_end_offset integer`;
  await sql`ALTER TABLE highlights
    ALTER COLUMN start_offset DROP NOT NULL,
    ALTER COLUMN end_offset DROP NOT NULL`;
  await sql`ALTER TABLE bookmarks ADD COLUMN IF NOT EXISTS page_number integer`;
  await sql`ALTER TABLE bookmarks ALTER COLUMN "offset" DROP NOT NULL`;
  await sql`CREATE TABLE IF NOT EXISTS page_ocr (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number integer NOT NULL,
    words jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS page_ocr_document_page
    ON page_ocr (document_id, page_number)`;
  console.log("schema: done");
}

async function finalize() {
  const [{ count: h }] =
    await sql`SELECT count(*)::int AS count FROM highlights WHERE page_number IS NULL`;
  const [{ count: b }] =
    await sql`SELECT count(*)::int AS count FROM bookmarks WHERE page_number IS NULL`;
  if (h > 0 || b > 0) {
    console.error(
      `finalize: refusing — ${h} highlight(s) and ${b} bookmark(s) still have no page. Run backfill first, or delete them.`,
    );
    process.exit(1);
  }
  await sql`ALTER TABLE highlights
    ALTER COLUMN page_number SET NOT NULL,
    ALTER COLUMN page_start_offset SET NOT NULL,
    ALTER COLUMN page_end_offset SET NOT NULL,
    DROP COLUMN start_offset,
    DROP COLUMN end_offset`;
  await sql`ALTER TABLE bookmarks
    ALTER COLUMN page_number SET NOT NULL,
    DROP COLUMN "offset"`;
  console.log("finalize: done");
}

// --- backfill -------------------------------------------------------------

let pdfjs;
async function loadPageTexts(key) {
  pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { Body } = await r2.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
  );
  const data = new Uint8Array(await Body.transformToByteArray());
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: path.join(
      process.cwd(),
      "node_modules/pdfjs-dist/standard_fonts/",
    ),
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    // Exactly what pdf.js's TextLayer writes into the DOM: one span per
    // item with textContent = item.str, nothing between them. The reader's
    // page offsets count over this same string.
    pages.push(items.map((i) => i.str ?? "").join(""));
  }
  await doc.destroy();
  return pages;
}

// The old offsets counted over the reflowed HTML's text nodes. Close enough
// to recover each highlight's rough position in the document, which is all
// it's used for (picking between repeated matches).
const htmlText = (html) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/**
 * The whole PDF's text with whitespace removed (the reflow joined lines and
 * items with spaces the PDF doesn't have, and vice versa), plus a map from
 * each kept character back to its page and in-page offset.
 */
function buildIndex(pageTexts) {
  let text = "";
  const map = [];
  pageTexts.forEach((pageText, p) => {
    for (let i = 0; i < pageText.length; i++) {
      if (/\s/.test(pageText[i])) continue;
      text += pageText[i];
      map.push({ page: p + 1, offset: i });
    }
  });
  return { text, map };
}

/** All matches of needle, picking the one nearest the expected position. */
function findNearest(index, needle, expectedFraction) {
  if (!needle) return null;
  let best = null;
  let from = 0;
  for (;;) {
    const at = index.text.indexOf(needle, from);
    if (at === -1) break;
    const distance = Math.abs(at / index.text.length - expectedFraction);
    if (!best || distance < best.distance) best = { at, distance };
    from = at + 1;
  }
  return best?.at ?? null;
}

const squash = (s) => s.replace(/\s+/g, "");

async function backfill() {
  const docs = await sql`
    SELECT d.id, d.title, d.file_url, d.content FROM documents d
    WHERE EXISTS (SELECT 1 FROM highlights h WHERE h.document_id = d.id AND h.page_number IS NULL)
       OR EXISTS (SELECT 1 FROM bookmarks b WHERE b.document_id = d.id AND b.page_number IS NULL)`;
  console.log(`backfill (${apply ? "APPLY" : "dry run"}): ${docs.length} document(s)`);

  const unmatched = [];
  let moved = 0;
  for (const doc of docs) {
    const pageTexts = await loadPageTexts(doc.file_url);
    const index = buildIndex(pageTexts);
    const oldText = htmlText(doc.content);
    const oldLength = Math.max(1, oldText.length);

    const hs = await sql`SELECT id, start_offset, text_content FROM highlights
      WHERE document_id = ${doc.id} AND page_number IS NULL`;
    for (const h of hs) {
      const needle = squash(h.text_content);
      const at = findNearest(index, needle, h.start_offset / oldLength);
      if (at === null) {
        unmatched.push({ kind: "highlight", doc: doc.title, id: h.id, text: h.text_content });
        continue;
      }
      const start = index.map[at];
      const last = index.map[at + needle.length - 1];
      // Highlights belong to one page now — one that ran across a page
      // break keeps the part on the page where it started.
      const crossesPage = last.page !== start.page;
      const pageText = pageTexts[start.page - 1];
      const end = crossesPage ? pageText.length : last.offset + 1;
      const text = pageText.slice(start.offset, end).replace(/\s+/g, " ").trim();
      console.log(
        `  highlight ${h.id} → p.${start.page} [${start.offset}, ${end})${crossesPage ? " (clipped at page break)" : ""}: "${text.slice(0, 60)}"`,
      );
      if (apply) {
        await sql`UPDATE highlights SET page_number = ${start.page},
          page_start_offset = ${start.offset}, page_end_offset = ${end},
          text_content = ${text} WHERE id = ${h.id}`;
      }
      moved++;
    }

    const bs = await sql`SELECT id, "offset" FROM bookmarks
      WHERE document_id = ${doc.id} AND page_number IS NULL`;
    for (const b of bs) {
      const fraction = b.offset / oldLength;
      const needle = squash(oldText.slice(b.offset, b.offset + 200)).slice(0, 40);
      const at = findNearest(index, needle, fraction);
      // No text to match (e.g. bookmark on an image) — fall back to the
      // same relative position in the PDF.
      const mapIndex =
        at ?? Math.min(index.map.length - 1, Math.floor(fraction * index.map.length));
      const page =
        index.map[mapIndex]?.page ??
        Math.min(pageTexts.length, Math.floor(fraction * pageTexts.length) + 1);
      console.log(`  bookmark ${b.id} → p.${page}${at === null ? " (by position)" : ""}`);
      if (apply) {
        await sql`UPDATE bookmarks SET page_number = ${page} WHERE id = ${b.id}`;
      }
      moved++;
    }
  }

  console.log(`\nre-anchored: ${moved}, unmatched: ${unmatched.length}`);
  for (const u of unmatched) {
    console.log(`  UNMATCHED ${u.kind} ${u.id} in "${u.doc}": "${u.text.slice(0, 80)}"`);
  }
}

const stages = { schema, backfill, finalize };
if (!stages[stage]) {
  console.error("usage: migrate-page-anchors.mjs schema | backfill [--apply] | finalize");
  process.exit(1);
}
await stages[stage]();
