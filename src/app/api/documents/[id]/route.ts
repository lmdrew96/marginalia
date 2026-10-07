import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { getDownloadUrl, deleteObject } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(
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

  const downloadUrl = await getDownloadUrl(doc.fileUrl);
  return NextResponse.json({ ...doc, downloadUrl });
}

export async function DELETE(
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

  // Extracted images aren't tracked in a table, but their keys are embedded
  // in the document's own stored content as /api/images/<key> src paths —
  // reuse that instead of leaving them orphaned in R2.
  const imageKeys = [...doc.content.matchAll(/\/api\/images\/([^"]+)/g)].map(
    (m) => m[1],
  );

  await Promise.all(
    [doc.fileUrl, ...imageKeys].map((key) =>
      deleteObject(key).catch((err) =>
        console.error(`Failed to delete R2 object ${key}:`, err),
      ),
    ),
  );

  // highlights/bookmarks/chat_messages cascade via FK.
  await db.delete(documents).where(eq(documents.id, id));

  return NextResponse.json({ ok: true });
}

// The reader reports the page count for documents ingested before it was
// stored. Only fills a missing value; ingest sets it for new documents.
export async function PATCH(
  req: Request,
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

  const { pageCount } = await req.json().catch(() => ({}));
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return NextResponse.json(
      { error: "pageCount must be a positive integer" },
      { status: 400 },
    );
  }
  if (doc.pageCount === null) {
    await db
      .update(documents)
      .set({ pageCount })
      .where(and(eq(documents.id, id), isNull(documents.pageCount)));
  }
  return NextResponse.json({ ok: true });
}
