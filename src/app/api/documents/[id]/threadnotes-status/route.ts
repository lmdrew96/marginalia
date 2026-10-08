import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOwnedDocument } from "@/lib/documents";
import {
  getLibrary,
  getThreadNotesSettings,
  setArticleStatus,
  ThreadNotesError,
  type ArticleStatus,
} from "@/lib/threadnotes";

export const runtime = "nodejs";

type Linked = { apiKey: string; articleId: string; projectId: string };

/** The ThreadNotes paper behind a document, or a response explaining why not. */
const linkedArticle = async (
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
  if (!doc.threadnotesArticleId || !doc.threadnotesProjectId) {
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
  return {
    apiKey,
    articleId: doc.threadnotesArticleId,
    projectId: doc.threadnotesProjectId,
  };
};

const failure = (err: unknown, what: string): NextResponse => {
  console.error(`${what} failed:`, err);
  const status = err instanceof ThreadNotesError ? err.status : 0;
  const error =
    status === 401 || status === 403
      ? "ThreadNotes didn't accept your API key. Update it in Settings."
      : status === 404
        ? "This paper is no longer in ThreadNotes."
        : "Couldn't reach ThreadNotes. Try again.";
  return NextResponse.json({ error }, { status: 502 });
};

/** The paper's reading status in ThreadNotes. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const linked = await linkedArticle(params);
  if (linked instanceof NextResponse) return linked;
  try {
    const library = await getLibrary(linked.apiKey, linked.projectId);
    const article = library.articles.find((a) => a.id === linked.articleId);
    if (!article) {
      return NextResponse.json(
        { error: "This paper is no longer in ThreadNotes." },
        { status: 404 },
      );
    }
    return NextResponse.json({ status: article.status });
  } catch (err) {
    return failure(err, `Reading ThreadNotes status of ${linked.articleId}`);
  }
}

/**
 * Marks the paper finished ("done"), or back to "reading" to undo that.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { status } = await req.json().catch(() => ({}));
  if (status !== "done" && status !== "reading") {
    return NextResponse.json(
      { error: 'status must be "done" or "reading"' },
      { status: 400 },
    );
  }
  const linked = await linkedArticle(params);
  if (linked instanceof NextResponse) return linked;
  try {
    await setArticleStatus(linked.apiKey, linked.articleId, status as ArticleStatus);
    return NextResponse.json({ status });
  } catch (err) {
    return failure(err, `Setting ThreadNotes status of ${linked.articleId}`);
  }
}
