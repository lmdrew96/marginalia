import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { highlights } from "@/db/schema";
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
    .from(highlights)
    .where(eq(highlights.documentId, id))
    .orderBy(asc(highlights.pageNumber), asc(highlights.createdAt));

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

  const { pageNumber, textContent, positionAnchor, color } = await req.json();
  if (!pageNumber || !textContent || !positionAnchor) {
    return NextResponse.json(
      { error: "pageNumber, textContent, and positionAnchor are required" },
      { status: 400 },
    );
  }

  const [highlight] = await db
    .insert(highlights)
    .values({
      documentId: id,
      pageNumber,
      textContent,
      positionAnchor,
      color: color ?? "yellow",
    })
    .returning();

  return NextResponse.json(highlight, { status: 201 });
}
