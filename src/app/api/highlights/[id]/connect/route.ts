import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { highlights, type Document, type Highlight } from "@/db/schema";
import { getOwnedDocument } from "@/lib/documents";
import {
  CONNECTION_RELATIONS,
  ThreadNotesError,
  connectExcerpt,
  getLibrary,
  getThreadNotesSettings,
  type ConnectionRelation,
} from "@/lib/threadnotes";

export const runtime = "nodejs";

const MAX_BECAUSE_LENGTH = 2_000;

type Connectable = { highlight: Highlight; doc: Document; apiKey: string; excerptId: string };

/** The signed-in reader's highlight, if it's saved to ThreadNotes. */
const connectable = async (
  params: Promise<{ id: string }>,
): Promise<Connectable | NextResponse> => {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const [highlight] = await db.select().from(highlights).where(eq(highlights.id, id));
  const doc = highlight && (await getOwnedDocument(highlight.documentId, userId));
  if (!highlight || !doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!highlight.threadnotesExcerptId || !doc.threadnotesProjectId) {
    return NextResponse.json(
      { error: "Save this highlight to ThreadNotes before connecting it." },
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
  return { highlight, doc, apiKey, excerptId: highlight.threadnotesExcerptId };
};

const threadNotesFailure = (err: unknown, what: string): NextResponse => {
  console.error(`${what} failed:`, err);
  if (err instanceof ThreadNotesError && (err.status === 401 || err.status === 403)) {
    return NextResponse.json(
      { error: "ThreadNotes didn't accept your API key. Update it in Settings." },
      { status: 409 },
    );
  }
  if (err instanceof ThreadNotesError && err.status === 404) {
    return NextResponse.json(
      { error: "That isn't in ThreadNotes anymore." },
      { status: 404 },
    );
  }
  return NextResponse.json({ error: "Couldn't reach ThreadNotes. Try again." }, { status: 502 });
};

/**
 * What the highlight can connect to: its project's questions, then its
 * papers (minus the one it's from).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const found = await connectable(params);
  if (found instanceof NextResponse) return found;
  try {
    const library = await getLibrary(found.apiKey, found.doc.threadnotesProjectId!);
    return NextResponse.json({
      questions: (library.questions ?? []).map(({ id, q, theme }) => ({ id, q, theme })),
      articles: library.articles
        .filter((a) => a.id !== found.doc.threadnotesArticleId)
        .map(({ id, title, year }) => ({ id, title, year })),
    });
  } catch (err) {
    return threadNotesFailure(err, `Listing connection targets for highlight ${found.highlight.id}`);
  }
}

/** Connects the highlight's excerpt to a question or paper, with a reason. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { toType, toId, relation, because } = await req.json().catch(() => ({}));
  if (
    (toType !== "question" && toType !== "article") ||
    typeof toId !== "string" ||
    !toId ||
    !CONNECTION_RELATIONS.includes(relation) ||
    typeof because !== "string" ||
    !because.trim() ||
    because.length > MAX_BECAUSE_LENGTH
  ) {
    return NextResponse.json(
      {
        error: `Send toType ("question" or "article"), toId, relation (${CONNECTION_RELATIONS.join(", ")}) and because (at most ${MAX_BECAUSE_LENGTH} characters)`,
      },
      { status: 400 },
    );
  }
  const found = await connectable(params);
  if (found instanceof NextResponse) return found;
  try {
    const result = await connectExcerpt(found.apiKey, {
      excerptId: found.excerptId,
      toType,
      toId,
      relation: relation as ConnectionRelation,
      because: because.trim(),
    });
    return NextResponse.json(result);
  } catch (err) {
    return threadNotesFailure(err, `Connecting highlight ${found.highlight.id}`);
  }
}
