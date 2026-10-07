import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { deleteObject, putObject } from "@/lib/r2";
import { ingestDocument } from "@/lib/ingest";
import { downloadPdf, markReading, resolveArticle } from "@/lib/threadnotes";

export const runtime = "nodejs";

/**
 * Opens a ThreadNotes paper in Marginalia: the existing document if it's
 * been opened before, otherwise a new one from its PDF. Answers
 * { needsUpload: true } when there's no PDF to fetch, so the reader can
 * upload one by hand.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { articleId } = await params;
  const resolved = await resolveArticle(userId, articleId);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const { apiKey, projectId, article } = resolved;

  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.threadnotesArticleId, article.id),
      ),
    );
  if (existing) {
    await markReading(apiKey, article);
    return NextResponse.json({ documentId: existing.id });
  }

  // The PDF stored in ThreadNotes first, then the open-access copy.
  let pdf: Buffer | null = null;
  for (const url of [article.pdfUrl, article.oaUrl]) {
    if (url) pdf = await downloadPdf(url);
    if (pdf) break;
  }
  if (!pdf) {
    return NextResponse.json({ needsUpload: true }, { status: 422 });
  }

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
    return NextResponse.json({ documentId: doc.id }, { status: 201 });
  } catch (err) {
    console.error(`Opening ThreadNotes article ${article.id} failed:`, err);
    await deleteObject(fileKey).catch((cleanupErr) =>
      console.error(`Couldn't delete unused upload ${fileKey}:`, cleanupErr),
    );
    return NextResponse.json(
      { error: "Couldn't process this paper's PDF. Try uploading it instead." },
      { status: 422 },
    );
  }
}
