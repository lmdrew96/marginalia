import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/highlight-types";

const ownedHighlight = async (id: string, userId: string) => {
  const [highlight] = await db
    .select()
    .from(highlights)
    .where(eq(highlights.id, id));
  if (!highlight) return null;
  const doc = await getOwnedDocument(highlight.documentId, userId);
  return doc ? highlight : null;
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await ownedHighlight(id, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { color } = await req.json();
  if (!HIGHLIGHT_COLORS.includes(color as HighlightColor)) {
    return NextResponse.json(
      { error: `color must be one of: ${HIGHLIGHT_COLORS.join(", ")}` },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(highlights)
    .set({ color })
    .where(eq(highlights.id, id))
    .returning();
  return NextResponse.json(updated);
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
  if (!(await ownedHighlight(id, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(highlights).where(eq(highlights.id, id));
  return NextResponse.json({ ok: true });
}
