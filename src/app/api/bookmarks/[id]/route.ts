import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookmarks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [bookmark] = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.id, id));

  if (!bookmark) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const doc = await getOwnedDocument(bookmark.documentId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(bookmarks).where(eq(bookmarks.id, id));
  return NextResponse.json({ ok: true });
}
