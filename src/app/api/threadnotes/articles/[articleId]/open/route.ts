import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { openThreadNotesArticle } from "@/lib/threadnotes-open";

export const runtime = "nodejs";

/**
 * Opens a ThreadNotes paper in Marginalia. Answers { needsUpload: true }
 * when there's no PDF to fetch, so the reader can upload one by hand.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { articleId } = await params;
  const result = await openThreadNotesArticle(userId, articleId);
  switch (result.kind) {
    case "opened":
      return NextResponse.json(
        { documentId: result.documentId },
        { status: result.created ? 201 : 200 },
      );
    case "needsUpload":
      return NextResponse.json({ needsUpload: true }, { status: 422 });
    case "error":
      return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
