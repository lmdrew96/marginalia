import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { documents, highlights, bookmarks } from "@/db/schema";
import { getOwnedDocument } from "@/lib/documents";
import { getObjectBuffer } from "@/lib/r2";
import { mapWithConcurrency } from "@/lib/concurrency";
import { sanitizeDocumentHtml } from "@/lib/sanitize";
import { prepareImageForOcr, transcribePage } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 60;

const OCR_CONCURRENCY = 4;
// Bounds a single request's runtime so a timeout can only cost this many
// Haiku calls — the button just re-runs for whatever's left (`remaining`).
const MAX_PAGES_PER_REQUEST = 15;

const PENDING_IMG_RE = /<img\b[^>]*\bdata-ocr="pending"[^>]*>/g;
const SRC_ATTR_RE = /\bsrc="([^"]+)"/;

// Offsets (highlights/bookmarks) are computed client-side by concatenating
// DOM text node lengths in document order (src/lib/dom-offset.ts) — no
// added whitespace, entities decoded. This mirrors that over the raw stored
// HTML well enough to gate on: not an exact remap, just a safety threshold.
function textOffsetBefore(html: string, index: number): number {
  return html
    .slice(0, index)
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").length;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await getOwnedDocument(id, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allMatches = [...doc.content.matchAll(PENDING_IMG_RE)];
  if (allMatches.length === 0) {
    return NextResponse.json(
      { error: "No scanned pages to OCR" },
      { status: 400 },
    );
  }

  // OCR only ever inserts text where none existed before, so a highlight or
  // bookmark anchored before the first scanned page is unaffected. One at
  // or after it would silently point at the wrong text once we insert —
  // refuse rather than corrupt a saved highlight.
  const cutoff = textOffsetBefore(doc.content, allMatches[0].index ?? 0);
  const [riskyHighlight] = await db
    .select({ id: highlights.id })
    .from(highlights)
    .where(and(eq(highlights.documentId, id), gte(highlights.startOffset, cutoff)))
    .limit(1);
  const [riskyBookmark] = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.documentId, id), gte(bookmarks.offset, cutoff)))
    .limit(1);
  if (riskyHighlight || riskyBookmark) {
    return NextResponse.json(
      {
        error:
          "Can't run OCR: there's a highlight or bookmark on or after a scanned page. Remove it first, then try again.",
      },
      { status: 409 },
    );
  }

  const batch = allMatches.slice(0, MAX_PAGES_PER_REQUEST);

  const results = await mapWithConcurrency(batch, OCR_CONCURRENCY, async (match) => {
    const tag = match[0];
    const src = tag.match(SRC_ATTR_RE)?.[1];
    if (!src || !src.startsWith(`/api/images/${userId}/`)) {
      return { tag, ok: false as const };
    }
    const key = src.replace(/^\/api\/images\//, "");
    try {
      const buffer = await getObjectBuffer(key);
      const image = await prepareImageForOcr(buffer);
      const transcribed = await transcribePage(image);
      if (!transcribed.ok) return { tag, ok: false as const };
      const html = sanitizeDocumentHtml(transcribed.html);
      return { tag, src, html, ok: true as const };
    } catch (err) {
      console.error(`OCR failed for ${key}:`, err);
      return { tag, ok: false as const };
    }
  });

  let content = doc.content;
  let succeeded = 0;
  for (const result of results) {
    if (!result.ok) continue;
    succeeded++;
    const replacement = `<img src="${result.src}" alt="" data-ocr="done" />${result.html}`;
    // Function replacer — a $&/$1-style sequence in the model's transcribed
    // text (prices, code) would otherwise be interpreted as a replacement
    // pattern by string-mode String.replace.
    content = content.replace(result.tag, () => replacement);
  }

  if (succeeded > 0) {
    await db.update(documents).set({ content }).where(eq(documents.id, id));
  }

  return NextResponse.json({
    content,
    ocred: succeeded,
    remaining: allMatches.length - succeeded,
  });
}
