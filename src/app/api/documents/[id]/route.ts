import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { documents, highlights } from "@/db/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { getDownloadUrl, deleteObject } from "@/lib/r2";
import { deleteExcerpt, getThreadNotesSettings } from "@/lib/threadnotes";

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

  // Highlights saved to ThreadNotes take their excerpts with them. Do this
  // before anything is deleted here, so a failure leaves the excerpt ids in
  // place to retry with.
  const synced = await db
    .select({ excerptId: highlights.threadnotesExcerptId })
    .from(highlights)
    .where(
      and(eq(highlights.documentId, id), isNotNull(highlights.threadnotesExcerptId)),
    );
  if (synced.length > 0) {
    const { apiKey } = await getThreadNotesSettings(userId);
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Its highlights are also ThreadNotes excerpts. Reconnect ThreadNotes in Settings to remove them too.",
        },
        { status: 409 },
      );
    }
    try {
      await Promise.all(synced.map((h) => deleteExcerpt(apiKey, h.excerptId!)));
    } catch (err) {
      console.error(`Deleting ThreadNotes excerpts for document ${id} failed:`, err);
      return NextResponse.json(
        { error: "Couldn't remove its excerpts from ThreadNotes. Try again." },
        { status: 502 },
      );
    }
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

const isPage = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 1;

// The reader reports the page it's on (lastPage), and the page count for
// documents ingested before it was stored (pageCount). pageCount only fills
// a missing value; ingest sets it for new documents.
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

  const { pageCount, lastPage } = await req.json().catch(() => ({}));
  if (pageCount === undefined && lastPage === undefined) {
    return NextResponse.json(
      { error: "Send pageCount or lastPage" },
      { status: 400 },
    );
  }
  if (
    (pageCount !== undefined && !isPage(pageCount)) ||
    (lastPage !== undefined && !isPage(lastPage))
  ) {
    return NextResponse.json(
      { error: "pageCount and lastPage must be positive integers" },
      { status: 400 },
    );
  }
  if (lastPage !== undefined) {
    await db.update(documents).set({ lastPage }).where(eq(documents.id, id));
  }
  if (pageCount !== undefined && doc.pageCount === null) {
    await db
      .update(documents)
      .set({ pageCount })
      .where(and(eq(documents.id, id), isNull(documents.pageCount)));
  }
  return NextResponse.json({ ok: true });
}
