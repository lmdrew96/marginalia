import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getObjectBuffer, putObject } from "@/lib/r2";
import { convertToHtml, detectFormat, type EncodedImage } from "@/lib/convert";
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

  const format = detectFormat(key);
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 400 },
    );
  }

  async function uploadImage(image: EncodedImage): Promise<string> {
    const imageKey = `${userId}/images/${crypto.randomUUID()}.${image.ext}`;
    await putObject(imageKey, image.buffer, image.contentType);
    return `/api/images/${imageKey}`;
  }

  let content: string;
  try {
    const t0 = performance.now();
    const buffer = await getObjectBuffer(key);
    const t1 = performance.now();
    const html = await convertToHtml(buffer, format, uploadImage);
    const t2 = performance.now();
    content = sanitizeDocumentHtml(html);
    const t3 = performance.now();
    console.log(
      `[ingest] ${key} (${(buffer.length / 1024).toFixed(0)}KB): ` +
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
    .values({ userId, title, fileUrl: key, format, content })
    .returning();

  return NextResponse.json(doc, { status: 201 });
}
