import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatMessages, highlights } from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { anthropic, CHAT_MODEL, DAILY_MESSAGE_LIMIT } from "@/lib/anthropic";
import { stripHtmlToText } from "@/lib/sanitize";

// Stopgap: sends a leading slice of the whole document as context now that
// there are no discrete pages. Replaced by viewport-scoped context in the
// chat-rescoping follow-up patch.
const CONTEXT_CHAR_LIMIT = 12000;

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

  const { message } = await req.json();
  if (!message) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );
  }

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

  const [docHighlights, recentHistory] = await Promise.all([
    db.select().from(highlights).where(eq(highlights.documentId, id)),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.documentId, id))
      .orderBy(desc(chatMessages.createdAt))
      .limit(20),
  ]);

  await db
    .insert(chatMessages)
    .values({ documentId: id, userId, role: "user", content: message });

  const highlightsBlock = docHighlights.length
    ? docHighlights.map((h) => `- "${h.textContent}"`).join("\n")
    : "(none)";

  const contextText = stripHtmlToText(doc.content).slice(
    0,
    CONTEXT_CHAR_LIMIT,
  );

  const systemPrompt = `You are Marginalia's reading assistant, embedded in a sidebar next to the document the user is reading. Answer using the excerpt below as your primary context. Keep answers concise and conversational.

Document: "${doc.title}"
Excerpt:
"""
${contextText}
"""

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
              text: systemPrompt,
              cache_control: { type: "ephemeral" },
            },
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
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
