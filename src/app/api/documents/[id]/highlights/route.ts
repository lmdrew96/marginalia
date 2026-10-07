import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { saveHighlightAsExcerpt } from "@/lib/threadnotes";

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

  const rows = await db
    .select()
    .from(highlights)
    .where(eq(highlights.documentId, id))
    .orderBy(asc(highlights.pageNumber), asc(highlights.pageStartOffset));

  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
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

  const { pageNumber, pageStartOffset, pageEndOffset, textContent, color } =
    await req.json();
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    !Number.isInteger(pageStartOffset) ||
    !Number.isInteger(pageEndOffset) ||
    pageStartOffset < 0 ||
    pageEndOffset <= pageStartOffset ||
    !textContent
  ) {
    return NextResponse.json(
      {
        error:
          "pageNumber, pageStartOffset, pageEndOffset, and textContent are required",
      },
      { status: 400 },
    );
  }

  const [highlight] = await db
    .insert(highlights)
    .values({
      documentId: id,
      pageNumber,
      pageStartOffset,
      pageEndOffset,
      textContent,
      color: color ?? "yellow",
    })
    .returning();

  const synced = await saveHighlightAsExcerpt(userId, doc, highlight);
  return NextResponse.json(
    { ...synced.highlight, threadnotesError: synced.threadnotesError },
    { status: 201 },
  );
}
