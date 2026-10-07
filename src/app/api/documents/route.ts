import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { deleteObject, getObjectBuffer, putObject } from "@/lib/r2";
import {
  convertDocxToPdf,
  detectFormat,
  DocxConversionUnavailableError,
  isDocx,
} from "@/lib/convert";
import { ingestDocument } from "@/lib/ingest";
import {
  markReading,
  resolveArticle,
  type ResolvedArticle,
} from "@/lib/threadnotes";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.uploadedAt));

  return NextResponse.json(docs);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // threadnotesArticleId: a manual upload of a ThreadNotes paper whose PDF
  // couldn't be fetched. The document is linked to that article.
  const { title, key, threadnotesArticleId } = await req.json();
  if (!title || !key) {
    return NextResponse.json(
      { error: "title and key are required" },
      { status: 400 },
    );
  }
  // Upload keys are minted under the caller's id (see upload-url); anything
  // else is someone else's file.
  if (typeof key !== "string" || !key.startsWith(`${userId}/`)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let threadnotes: Extract<ResolvedArticle, { ok: true }> | null = null;
  if (threadnotesArticleId !== undefined) {
    if (typeof threadnotesArticleId !== "string" || !threadnotesArticleId) {
      return NextResponse.json(
        { error: "threadnotesArticleId must be a string" },
        { status: 400 },
      );
    }
    const resolved = await resolveArticle(userId, threadnotesArticleId);
    if (!resolved.ok) {
      // The browser already uploaded the file; it has no other use.
      await deleteObject(key).catch((err) =>
        console.error(`Couldn't delete unused upload ${key}:`, err),
      );
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    threadnotes = resolved;
  }

  // Word files become PDFs here, so everything downstream only sees PDFs.
  const fromDocx = isDocx(key);
  const fileKey = fromDocx ? key.replace(/\.docx$/i, ".pdf") : key;
  const format = detectFormat(fileKey);
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 },
    );
  }

  if (fromDocx) {
    try {
      const docx = await getObjectBuffer(key);
      const pdf = await convertDocxToPdf(docx, key.split("/").pop() ?? key);
      await putObject(fileKey, pdf, "application/pdf");
    } catch (err) {
      console.error("Word conversion failed:", err);
      const unavailable = err instanceof DocxConversionUnavailableError;
      return NextResponse.json(
        {
          error: unavailable
            ? "Word conversion isn't available right now — try again later, or upload a PDF."
            : "Couldn't convert this Word file. Try saving it as a PDF and uploading that.",
        },
        { status: unavailable ? 503 : 422 },
      );
    }
    // The PDF is the document now; the .docx has no further use.
    await deleteObject(key).catch((err) =>
      console.error(`Couldn't delete converted upload ${key}:`, err),
    );
  }

  try {
    const doc = await ingestDocument({
      userId,
      title: threadnotes ? threadnotes.article.title : title,
      fileKey,
      format,
      threadnotes: threadnotes
        ? { articleId: threadnotes.article.id, projectId: threadnotes.projectId }
        : undefined,
    });
    if (threadnotes) await markReading(threadnotes.apiKey, threadnotes.article);
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("Document conversion failed:", err);
    return NextResponse.json(
      { error: "Couldn't process this file." },
      { status: 422 },
    );
  }
}
