import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bookmarks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";

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
    .from(bookmarks)
    .where(eq(bookmarks.documentId, id))
    .orderBy(asc(bookmarks.pageNumber));

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

  const { pageNumber, label } = await req.json();
  if (!pageNumber) {
    return NextResponse.json(
      { error: "pageNumber is required" },
      { status: 400 },
    );
  }

  const [bookmark] = await db
    .insert(bookmarks)
    .values({ documentId: id, pageNumber, label })
    .returning();

  return NextResponse.json(bookmark, { status: 201 });
}
