import { db } from "@/db";
import { documents, type Document } from "@/db/schema";
import { getObjectBuffer } from "@/lib/r2";
import { convertToHtml, type SupportedFormat } from "@/lib/convert";
import { sanitizeDocumentHtml } from "@/lib/sanitize";

/**
 * Turns a file already in R2 into a library document. Throws when the file
 * can't be read or converted.
 */
export const ingestDocument = async ({
  userId,
  title,
  fileKey,
  format,
  threadnotes,
}: {
  userId: string;
  title: string;
  fileKey: string;
  format: SupportedFormat;
  threadnotes?: { articleId: string; projectId: string };
}): Promise<Document> => {
  const t0 = performance.now();
  const buffer = await getObjectBuffer(fileKey);
  const t1 = performance.now();
  const converted = await convertToHtml(buffer, format);
  const t2 = performance.now();
  const content = sanitizeDocumentHtml(converted.html);
  const t3 = performance.now();
  console.log(
    `[ingest] ${fileKey} (${(buffer.length / 1024).toFixed(0)}KB): ` +
      `fetch=${(t1 - t0).toFixed(0)}ms convert=${(t2 - t1).toFixed(0)}ms sanitize=${(t3 - t2).toFixed(0)}ms`,
  );

  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      title,
      fileUrl: fileKey,
      format,
      content,
      pageCount: converted.pageCount,
      threadnotesArticleId: threadnotes?.articleId ?? null,
      threadnotesProjectId: threadnotes?.projectId ?? null,
    })
    .returning();
  return doc;
};
