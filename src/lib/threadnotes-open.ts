import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { deleteObject, putObject } from "@/lib/r2";
import { ingestDocument } from "@/lib/ingest";
import { downloadPdf, markReading, resolveArticle } from "@/lib/threadnotes";

export type OpenResult =
  | { kind: "opened"; documentId: string; created: boolean }
  // No PDF to fetch, so the reader uploads one by hand.
  | { kind: "needsUpload"; title: string }
  | { kind: "error"; status: number; error: string };

/**
 * Opens a ThreadNotes paper in Marginalia: the existing document if it's
 * been opened before, otherwise a new one from its PDF. Either way the
 * paper is marked "reading" in ThreadNotes.
 */
export const openThreadNotesArticle = async (
  userId: string,
  articleId: string,
): Promise<OpenResult> => {
  // An already-opened paper opens from here even if ThreadNotes is down;
  // only its status update needs ThreadNotes.
  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.threadnotesArticleId, articleId),
      ),
    );

  const resolved = await resolveArticle(userId, articleId);
  if (existing) {
    if (resolved.ok) await markReading(resolved.apiKey, resolved.article);
    else console.error(`Couldn't update status of ThreadNotes article ${articleId}: ${resolved.error}`);
    return { kind: "opened", documentId: existing.id, created: false };
  }
  if (!resolved.ok) {
    return { kind: "error", status: resolved.status, error: resolved.error };
  }
  const { apiKey, projectId, article } = resolved;

  // The PDF stored in ThreadNotes first, then the open-access copy.
  let pdf: Buffer | null = null;
  for (const url of [article.pdfUrl, article.oaUrl]) {
    if (url) pdf = await downloadPdf(url);
    if (pdf) break;
  }
  if (!pdf) return { kind: "needsUpload", title: article.title };

  const fileKey = `${userId}/${crypto.randomUUID()}-threadnotes.pdf`;
  try {
    await putObject(fileKey, pdf, "application/pdf");
    const doc = await ingestDocument({
      userId,
      title: article.title,
      fileKey,
      format: "pdf",
      threadnotes: { articleId: article.id, projectId },
    });
    await markReading(apiKey, article);
    return { kind: "opened", documentId: doc.id, created: true };
  } catch (err) {
    console.error(`Opening ThreadNotes article ${article.id} failed:`, err);
    await deleteObject(fileKey).catch((cleanupErr) =>
      console.error(`Couldn't delete unused upload ${fileKey}:`, cleanupErr),
    );
    return {
      kind: "error",
      status: 422,
      error: "Couldn't process this paper's PDF. Try uploading it instead.",
    };
  }
};
