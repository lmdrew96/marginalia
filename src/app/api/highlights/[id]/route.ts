import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/lib/highlight-types";
import {
  deleteExcerpt,
  getThreadNotesSettings,
  saveHighlightAsExcerpt,
} from "@/lib/threadnotes";

const MAX_COMMENT_LENGTH = 10_000;

const ownedHighlight = async (id: string, userId: string) => {
  const [highlight] = await db
    .select()
    .from(highlights)
    .where(eq(highlights.id, id));
  if (!highlight) return null;
  const doc = await getOwnedDocument(highlight.documentId, userId);
  return doc ? { highlight, doc } : null;
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
  const owned = await ownedHighlight(id, userId);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { color, comment } = await req.json();
  if (color === undefined && comment === undefined) {
    return NextResponse.json(
      { error: "color or comment is required" },
      { status: 400 },
    );
  }
  if (
    color !== undefined &&
    !HIGHLIGHT_COLORS.includes(color as HighlightColor)
  ) {
    return NextResponse.json(
      { error: `color must be one of: ${HIGHLIGHT_COLORS.join(", ")}` },
      { status: 400 },
    );
  }
  if (
    comment !== undefined &&
    comment !== null &&
    (typeof comment !== "string" || comment.length > MAX_COMMENT_LENGTH)
  ) {
    return NextResponse.json(
      {
        error: `comment must be a string of at most ${MAX_COMMENT_LENGTH} characters, or null`,
      },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(highlights)
    .set({
      ...(color !== undefined && { color }),
      // A blank comment is the same as no comment.
      ...(comment !== undefined && { comment: comment?.trim() || null }),
    })
    .where(eq(highlights.id, id))
    .returning();

  // The note is the excerpt's comment; color stays in Marginalia.
  if (comment === undefined) return NextResponse.json(updated);
  const synced = await saveHighlightAsExcerpt(userId, owned.doc, updated);
  return NextResponse.json({
    ...synced.highlight,
    threadnotesError: synced.threadnotesError,
  });
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
  const owned = await ownedHighlight(id, userId);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Remove the excerpt first, so a ThreadNotes failure leaves both in place
  // to retry rather than an excerpt with no highlight. Without a saved key
  // (ThreadNotes disconnected) there's nothing to reach; delete locally.
  const excerptId = owned.highlight.threadnotesExcerptId;
  if (excerptId) {
    const { apiKey } = await getThreadNotesSettings(userId);
    if (apiKey) {
      try {
        await deleteExcerpt(apiKey, excerptId);
      } catch (err) {
        console.error(`Deleting ThreadNotes excerpt ${excerptId} failed:`, err);
        return NextResponse.json(
          { error: "Couldn't remove it from ThreadNotes. Try again." },
          { status: 502 },
        );
      }
    }
  }

  await db.delete(highlights).where(eq(highlights.id, id));
  return NextResponse.json({ ok: true });
}
