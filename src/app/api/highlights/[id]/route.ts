import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { highlights } from "@/db/schema";
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
  const [highlight] = await db
    .select()
    .from(highlights)
    .where(eq(highlights.id, id));

  if (!highlight) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const doc = await getOwnedDocument(highlight.documentId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(highlights).where(eq(highlights.id, id));
  return NextResponse.json({ ok: true });
}
