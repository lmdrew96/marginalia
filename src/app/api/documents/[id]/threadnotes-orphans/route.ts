import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { highlights, type Document, type Highlight } from "@/db/schema";
import { getOwnedDocument } from "@/lib/documents";
import {
  getArticleExcerpts,
  getThreadNotesSettings,
  saveHighlightAsExcerpt,
} from "@/lib/threadnotes";

export const runtime = "nodejs";

// A highlight's excerpt id is stored just after ThreadNotes creates the
// excerpt; anything newer than this could still be mid-save.
const SETTLE_MS = 2 * 60 * 1000;

type Linked = { userId: string; doc: Document; apiKey: string; articleId: string };

const linkedDocument = async (
  params: Promise<{ id: string }>,
): Promise<Linked | NextResponse> => {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const doc = await getOwnedDocument(id, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!doc.threadnotesArticleId) {
    return NextResponse.json(
      { error: "This document isn't from ThreadNotes." },
      { status: 409 },
    );
  }
  const { apiKey } = await getThreadNotesSettings(userId);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Connect ThreadNotes in Settings first." },
      { status: 409 },
    );
  }
  return { userId, doc, apiKey, articleId: doc.threadnotesArticleId };
};

/**
 * Highlights whose excerpt is gone from ThreadNotes, or null when
 * ThreadNotes couldn't say (down, timed out, article trashed).
 */
const findOrphans = async (linked: Linked): Promise<Highlight[] | null> => {
  let excerptIds: Set<string>;
  try {
    const excerpts = await getArticleExcerpts(linked.apiKey, linked.articleId);
    excerptIds = new Set(excerpts.map((e) => e.id));
  } catch (err) {
    console.error(`Listing excerpts of ThreadNotes article ${linked.articleId} failed:`, err);
    return null;
  }
  const synced = await db
    .select()
    .from(highlights)
    .where(
      and(
        eq(highlights.documentId, linked.doc.id),
        isNotNull(highlights.threadnotesExcerptId),
        lt(highlights.createdAt, new Date(Date.now() - SETTLE_MS)),
      ),
    );
  return synced.filter((h) => !excerptIds.has(h.threadnotesExcerptId!));
};

/** Ids of this document's highlights whose excerpt was deleted in ThreadNotes. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const linked = await linkedDocument(params);
  if (linked instanceof NextResponse) return linked;
  const orphans = await findOrphans(linked);
  return NextResponse.json({ highlightIds: (orphans ?? []).map((h) => h.id) });
}

type Action = "readd" | "remove" | "keep";

/**
 * Resolves orphaned highlights: "readd" saves each as a new excerpt,
 * "remove" deletes it here only (its excerpt is already gone), "keep"
 * unlinks it so it stays Marginalia-only. Only highlights that are still
 * orphaned right now are touched.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { action, highlightIds } = await req.json().catch(() => ({}));
  if (
    !["readd", "remove", "keep"].includes(action) ||
    !Array.isArray(highlightIds) ||
    highlightIds.length === 0 ||
    !highlightIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: 'Send action ("readd", "remove" or "keep") and highlightIds' },
      { status: 400 },
    );
  }
  const linked = await linkedDocument(params);
  if (linked instanceof NextResponse) return linked;

  const orphans = await findOrphans(linked);
  if (!orphans) {
    return NextResponse.json(
      { error: "Couldn't check with ThreadNotes. Try again." },
      { status: 502 },
    );
  }
  const wanted = new Set<string>(highlightIds);
  const targets = orphans.filter((h) => wanted.has(h.id));
  const ids = targets.map((h) => h.id);

  switch (action as Action) {
    case "remove":
      if (ids.length > 0) await db.delete(highlights).where(inArray(highlights.id, ids));
      return NextResponse.json({ removed: ids, updated: [] });
    case "keep": {
      const updated =
        ids.length === 0
          ? []
          : await db
              .update(highlights)
              .set({ threadnotesExcerptId: null })
              .where(inArray(highlights.id, ids))
              .returning();
      return NextResponse.json({ removed: [], updated });
    }
    case "readd": {
      const updated: Highlight[] = [];
      let failed = 0;
      for (const h of targets) {
        // Without its dead excerpt id, saving creates a new excerpt.
        const result = await saveHighlightAsExcerpt(linked.userId, linked.doc, {
          ...h,
          threadnotesExcerptId: null,
        });
        if (result.threadnotesError) failed++;
        else updated.push(result.highlight);
      }
      return NextResponse.json({
        removed: [],
        updated,
        ...(failed > 0 && {
          error: `Couldn't re-add ${failed === 1 ? "one highlight" : `${failed} highlights`} to ThreadNotes. Try again.`,
        }),
      });
    }
  }
}
