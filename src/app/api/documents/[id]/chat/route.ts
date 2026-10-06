import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages, highlights } from "@/db/schema";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { anthropic, CHAT_MODEL, DAILY_MESSAGE_LIMIT } from "@/lib/anthropic";
import {
  formatPages,
  getDocumentPageTexts,
  MAX_CONTEXT_CHARS,
} from "@/lib/page-text";
import type { PageText } from "@/lib/convert/pdf";
import { getClaudeInstructions, instructionsBlock } from "@/lib/settings";

export const runtime = "nodejs";

// Long documents are split into fixed runs of pages of about this size.
// Claude gets the run the reader is in plus the neighboring run nearest
// their page. Fixed boundaries keep the document part of the prompt
// identical (and cached) while the reader moves around inside a range.
const CHUNK_CHARS = 100_000;

/**
 * Header naming the pages Claude was given, e.g. "all" or "41-118". Read by
 * ChatSidebar (route files can't export non-route values, so it repeats
 * the name).
 */
const CONTEXT_PAGES_HEADER = "X-Context-Pages";

const pagesForContext = (
  pages: PageText[],
  currentPage: number,
): { pages: PageText[]; whole: boolean } => {
  const total = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (total <= MAX_CONTEXT_CHARS) return { pages, whole: true };

  const chunks: PageText[][] = [[]];
  let size = 0;
  for (const page of pages) {
    const last = chunks[chunks.length - 1];
    if (last.length > 0 && size + page.text.length > CHUNK_CHARS) {
      chunks.push([page]);
      size = page.text.length;
    } else {
      last.push(page);
      size += page.text.length;
    }
  }

  const found = chunks.findIndex(
    (c) => currentPage <= c[c.length - 1].pageNumber,
  );
  const index = found === -1 ? chunks.length - 1 : found;
  const chunk = chunks[index];
  const middle =
    (chunk[0].pageNumber + chunk[chunk.length - 1].pageNumber) / 2;
  // The nearer neighbor, or the other one at either end of the document.
  const nearer = currentPage < middle ? index - 1 : index + 1;
  const neighbor =
    nearer >= 0 && nearer < chunks.length ? nearer : 2 * index - nearer;
  const picked = [index, neighbor]
    .filter((i) => i >= 0 && i < chunks.length)
    .sort((a, b) => a - b);
  return { pages: picked.flatMap((i) => chunks[i]), whole: false };
};

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

  const history = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.documentId, id))
    .orderBy(chatMessages.createdAt);

  return NextResponse.json(history);
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

  const { message, currentPage } = await req.json();
  if (!message) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );
  }
  const readerPage =
    Number.isInteger(currentPage) && currentPage >= 1 ? currentPage : 1;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, since),
      ),
    );
  if (count >= DAILY_MESSAGE_LIMIT) {
    return NextResponse.json(
      { error: "Daily chat limit reached — try again tomorrow." },
      { status: 429 },
    );
  }

  let allPages: PageText[];
  try {
    allPages = await getDocumentPageTexts(doc);
  } catch (err) {
    console.error("Chat page extraction failed:", err);
    return NextResponse.json(
      { error: "Couldn't read this document's pages." },
      { status: 502 },
    );
  }

  const [docHighlights, recentHistory, instructions] = await Promise.all([
    db
      .select()
      .from(highlights)
      .where(eq(highlights.documentId, id))
      .orderBy(asc(highlights.pageNumber), asc(highlights.pageStartOffset)),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.documentId, id))
      .orderBy(desc(chatMessages.createdAt))
      .limit(20),
    getClaudeInstructions(userId),
  ]);

  await db
    .insert(chatMessages)
    .values({ documentId: id, userId, role: "user", content: message });

  const context = pagesForContext(allPages, readerPage);
  const firstPage = context.pages[0]?.pageNumber ?? 1;
  const lastPage = context.pages.at(-1)?.pageNumber ?? 1;
  const scope = context.whole
    ? "the whole document"
    : `pages ${firstPage}–${lastPage} of ${allPages.length}`;
  const pagesText =
    formatPages(context.pages) ||
    "(These pages have no text yet. If they're scanned, the reader can make them selectable.)";

  // Cached: only changes when the reader moves into a different range.
  const documentPrompt = `You are Marginalia's reading assistant, embedded in a sidebar next to the document the user is reading. Answer using the document text below as your primary context, citing page numbers when it helps. Keep answers concise and conversational. Markdown is rendered.

Document: "${doc.title}" (${allPages.length} pages). You can see ${scope}.${
    context.whole
      ? ""
      : " If the reader asks about pages outside that range, say you can't see them from here and suggest scrolling there first."
  }
<document>
${pagesText}
</document>`;

  // Changes often (new highlights, scrolling), so it sits after the cache
  // breakpoint.
  const highlightsBlock = docHighlights.length
    ? docHighlights
        .map(
          (h) =>
            `- (p. ${h.pageNumber}) "${h.textContent}"` +
            (h.comment ? `\n  Reader's note: ${h.comment}` : ""),
        )
        .join("\n")
    : "(none)";
  const readerPrompt = `The reader is on page ${readerPage}.

Highlights the reader has made in this document:
${highlightsBlock}`;

  const orderedHistory = recentHistory.reverse();

  const encoder = new TextEncoder();
  let fullText = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          model: CHAT_MODEL,
          max_tokens: 4096,
          output_config: { effort: "medium" },
          system: [
            {
              type: "text",
              text: documentPrompt,
              cache_control: { type: "ephemeral" },
            },
            ...instructionsBlock(instructions),
            { type: "text", text: readerPrompt },
          ],
          messages: [
            ...orderedHistory.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            { role: "user" as const, content: message },
          ],
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        await anthropicStream.finalMessage();

        await db.insert(chatMessages).values({
          documentId: id,
          userId,
          role: "assistant",
          content: fullText,
        });
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      [CONTEXT_PAGES_HEADER]: context.whole
        ? "all"
        : `${firstPage}-${lastPage}`,
    },
  });
}
