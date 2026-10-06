import { db } from "@/db";
import { pageOcr, type Document } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getObjectBuffer } from "@/lib/r2";
import { extractPdfPageTexts, type PageText } from "@/lib/convert/pdf";

// ~100k tokens. Above this a document is sent to Claude in page ranges
// instead of whole, and a quiz asks for a smaller range.
export const MAX_CONTEXT_CHARS = 400_000;

// Extracting a long PDF takes seconds, and chat asks for it on every
// message. Keep the last few documents' text in memory so a warm server
// skips that. Keyed by the R2 key, which never changes for a document.
const CACHE_SIZE = 20;
const pdfTextCache = new Map<string, PageText[]>();

const getPdfPageTexts = async (fileKey: string): Promise<PageText[]> => {
  const cached = pdfTextCache.get(fileKey);
  if (cached) {
    // Re-insert so the Map's insertion order doubles as recency.
    pdfTextCache.delete(fileKey);
    pdfTextCache.set(fileKey, cached);
    return cached;
  }
  const { pages } = await extractPdfPageTexts(
    await getObjectBuffer(fileKey),
    1,
    Number.MAX_SAFE_INTEGER,
  );
  pdfTextCache.set(fileKey, pages);
  if (pdfTextCache.size > CACHE_SIZE) {
    pdfTextCache.delete(pdfTextCache.keys().next().value!);
  }
  return pages;
};

/**
 * Every page's text, in order. Scanned pages use their OCR'd words once
 * they've been made selectable; until then their text is empty. OCR is
 * read fresh each time since it can be added after the PDF is cached.
 */
export const getDocumentPageTexts = async (
  doc: Document,
): Promise<PageText[]> => {
  const [pages, ocrRows] = await Promise.all([
    getPdfPageTexts(doc.fileUrl),
    db.select().from(pageOcr).where(eq(pageOcr.documentId, doc.id)),
  ]);
  const ocrByPage = new Map(
    ocrRows.map((p) => [p.pageNumber, p.words.map((w) => w.text).join(" ")]),
  );
  return pages.map((p) => ({
    pageNumber: p.pageNumber,
    text: p.text.trim() || ocrByPage.get(p.pageNumber) || "",
  }));
};

/** `[Page N]` blocks for the pages that have any text. */
export const formatPages = (pages: PageText[]): string =>
  pages
    .filter((p) => p.text)
    .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
    .join("\n\n");
