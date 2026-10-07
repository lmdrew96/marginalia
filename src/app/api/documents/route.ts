import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { deleteObject, getObjectBuffer, putObject } from "@/lib/r2";
import {
  convertDocxToPdf,
  convertToHtml,
  detectFormat,
  DocxConversionUnavailableError,
  isDocx,
} from "@/lib/convert";
import { sanitizeDocumentHtml } from "@/lib/sanitize";

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

  const { title, key } = await req.json();
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

  let content: string;
  let pageCount: number;
  try {
    const t0 = performance.now();
    const buffer = await getObjectBuffer(fileKey);
    const t1 = performance.now();
    const converted = await convertToHtml(buffer, format);
    pageCount = converted.pageCount;
    const t2 = performance.now();
    content = sanitizeDocumentHtml(converted.html);
    const t3 = performance.now();
    console.log(
      `[ingest] ${fileKey} (${(buffer.length / 1024).toFixed(0)}KB): ` +
        `fetch=${(t1 - t0).toFixed(0)}ms convert=${(t2 - t1).toFixed(0)}ms sanitize=${(t3 - t2).toFixed(0)}ms`,
    );
  } catch (err) {
    console.error("Document conversion failed:", err);
    return NextResponse.json(
      { error: "Couldn't process this file." },
      { status: 422 },
    );
  }

  const [doc] = await db
    .insert(documents)
    .values({ userId, title, fileUrl: fileKey, format, content, pageCount })
    .returning();

  return NextResponse.json(doc, { status: 201 });
}
