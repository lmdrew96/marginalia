import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { highlights } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { anthropic, QUIZ_MODEL } from "@/lib/anthropic";

export type QuizQuestion = {
  question: string;
  answer: string;
  highlightId: string;
};

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
          highlight: {
            type: "integer",
            description: "Number of the highlight the question is drawn from",
          },
        },
        required: ["question", "answer", "highlight"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write review questions for a student from the passages they highlighted in a reading. Draw every question only from the numbered highlights (and the reader's own notes on them) — never from outside knowledge or parts of the reading they didn't highlight. Write between 5 and 10 questions; fewer only if the highlights are too thin to support more without repeating. Mix recall with "why/how" questions that check understanding. Keep each answer to a sentence or two, grounded in the highlight. Set "highlight" to the number of the highlight each question comes from. Markdown is fine in questions and answers.`;

export async function POST(
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

  const docHighlights = await db
    .select()
    .from(highlights)
    .where(eq(highlights.documentId, id))
    .orderBy(asc(highlights.pageNumber), asc(highlights.pageStartOffset));
  if (docHighlights.length === 0) {
    return NextResponse.json(
      { error: "Highlight something first — the quiz is built from your highlights." },
      { status: 400 },
    );
  }

  const highlightList = docHighlights
    .map(
      (h, i) =>
        `${i + 1}. (p. ${h.pageNumber}) "${h.textContent}"` +
        (h.comment ? `\n   Reader's note: ${h.comment}` : ""),
    )
    .join("\n");

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: QUIZ_MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: QUIZ_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Reading: "${doc.title}"\n\nHighlights:\n${highlightList}`,
        },
      ],
    });
  } catch (err) {
    console.error("Quiz generation failed:", err);
    const status =
      err instanceof Anthropic.RateLimitError ? 429 : 502;
    return NextResponse.json(
      { error: "Couldn't build a quiz right now — try again in a moment." },
      { status },
    );
  }

  if (response.stop_reason !== "end_turn") {
    console.error(`Quiz generation stopped early: ${response.stop_reason}`);
    return NextResponse.json(
      { error: "Couldn't build a quiz from these highlights." },
      { status: 502 },
    );
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let questions: QuizQuestion[];
  try {
    const parsed = JSON.parse(text) as {
      questions: { question: string; answer: string; highlight: number }[];
    };
    // Drop any question pointing at a highlight that doesn't exist, so
    // every answer can link back to its source.
    questions = parsed.questions.flatMap((q) => {
      const source = docHighlights[q.highlight - 1];
      return source && q.question && q.answer
        ? [{ question: q.question, answer: q.answer, highlightId: source.id }]
        : [];
    });
  } catch (err) {
    console.error("Quiz response wasn't valid JSON:", err);
    questions = [];
  }

  if (questions.length === 0) {
    return NextResponse.json(
      { error: "Couldn't build a quiz from these highlights." },
      { status: 502 },
    );
  }

  return NextResponse.json({ questions });
}
