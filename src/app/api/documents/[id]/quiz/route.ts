import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { highlights, quizRequests } from "@/db/schema";
import { and, asc, between, eq, gte, sql } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { anthropic, DAILY_QUIZ_LIMIT, QUIZ_MODEL } from "@/lib/anthropic";
import { getClaudeInstructions, instructionsBlock } from "@/lib/settings";
import {
  formatPages,
  getDocumentPageTexts,
  MAX_CONTEXT_CHARS,
} from "@/lib/page-text";

export const runtime = "nodejs";

type QuizQuestionBase = {
  question: string;
  // The model answer for short answers; why the right choice is right for
  // multiple choice.
  answer: string;
  pageNumber: number;
  // Set when the question was drawn from one of the reader's highlights.
  highlightId: string | null;
};

export type QuizQuestion =
  | (QuizQuestionBase & {
      kind: "multiple_choice";
      choices: string[];
      correctIndex: number;
    })
  | (QuizQuestionBase & { kind: "short_answer" });

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["multiple_choice", "short_answer"] },
          question: { type: "string" },
          choices: {
            type: "array",
            items: { type: "string" },
            description:
              "Four answer options for multiple_choice; empty for short_answer",
          },
          correct: {
            type: "integer",
            description:
              "Index into choices of the right option for multiple_choice; 0 for short_answer",
          },
          answer: { type: "string" },
          page: {
            type: "integer",
            description: "Page number the answer comes from",
          },
          highlight: {
            type: "integer",
            description:
              "Number of the highlight the question is drawn from, or 0 if it isn't drawn from a highlight",
          },
        },
        required: [
          "kind",
          "question",
          "choices",
          "correct",
          "answer",
          "page",
          "highlight",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You write review questions to help a student study a reading. You get the text of the pages they chose, and the passages they highlighted there (with any notes they wrote on them).

Write between 5 and 10 questions covering the most important ideas in those pages. The highlights mark what the reader found important, so weight them heavily: when there are highlights, draw roughly half or more of the questions from them, and use the reader's notes to see what they were thinking about. Fill the rest from the key ideas elsewhere in the pages. Draw only from the given text, never outside knowledge.

Mix recall with "why/how" questions that check understanding, and mix two kinds of question, roughly half each:
- "multiple_choice": four options in "choices", exactly one right, with "correct" set to its index. Make the wrong options plausible to someone who skimmed — not obviously silly — and keep all four similar in length. "answer" says in a sentence or two why the right option is right.
- "short_answer": the reader types a response, so ask something answerable in a sentence or two. Leave "choices" empty and set "correct" to 0. "answer" is the model answer, grounded in the text. For each question set "page" to the page the answer comes from, and "highlight" to the number of the highlight it's drawn from (0 if none). Markdown is fine in questions and answers.`;

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

  // No range means the whole document.
  const { fromPage, toPage } = await req.json().catch(() => ({}));
  const hasRange = fromPage !== undefined || toPage !== undefined;
  if (
    hasRange &&
    (!Number.isInteger(fromPage) ||
      !Number.isInteger(toPage) ||
      fromPage < 1 ||
      toPage < fromPage)
  ) {
    return NextResponse.json(
      { error: "fromPage and toPage must be page numbers, from ≤ to" },
      { status: 400 },
    );
  }
  const from: number = hasRange ? fromPage : 1;
  const to: number = hasRange ? toPage : Number.MAX_SAFE_INTEGER;

  let pages: { pageNumber: number; text: string }[];
  try {
    pages = (await getDocumentPageTexts(doc)).filter(
      (p) => p.pageNumber >= from && p.pageNumber <= to,
    );
  } catch (err) {
    console.error("Quiz page extraction failed:", err);
    return NextResponse.json(
      { error: "Couldn't read this document's pages." },
      { status: 502 },
    );
  }
  const lastPage = pages.at(-1)?.pageNumber ?? from;

  const [rangeHighlights, instructions] = await Promise.all([
    db
      .select()
      .from(highlights)
      .where(
        and(
          eq(highlights.documentId, id),
          between(highlights.pageNumber, from, lastPage),
        ),
      )
      .orderBy(asc(highlights.pageNumber), asc(highlights.pageStartOffset)),
    getClaudeInstructions(userId),
  ]);

  const pagesText = formatPages(pages);
  if (!pagesText) {
    return NextResponse.json(
      {
        error:
          "There's no readable text on those pages. If they're scanned, make them selectable first.",
      },
      { status: 400 },
    );
  }

  if (pagesText.length > MAX_CONTEXT_CHARS) {
    return NextResponse.json(
      {
        error:
          "That's too much text for one quiz — pick a smaller page range.",
      },
      { status: 413 },
    );
  }

  const highlightList = rangeHighlights.length
    ? rangeHighlights
        .map(
          (h, i) =>
            `${i + 1}. (p. ${h.pageNumber}) "${h.textContent}"` +
            (h.comment ? `\n   Reader's note: ${h.comment}` : ""),
        )
        .join("\n")
    : "(none in these pages)";

  const scope = hasRange ? `pages ${from}–${lastPage}` : "the whole document";

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quizRequests)
    .where(
      and(eq(quizRequests.userId, userId), gte(quizRequests.createdAt, since)),
    );
  if (count >= DAILY_QUIZ_LIMIT) {
    return NextResponse.json(
      { error: "Daily quiz limit reached — try again tomorrow." },
      { status: 429 },
    );
  }
  // Counted once the request reaches Claude, whether or not it succeeds —
  // the tokens are spent either way.
  await db.insert(quizRequests).values({ userId });

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: QUIZ_MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: QUIZ_SCHEMA },
      },
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        ...instructionsBlock(instructions),
      ],
      messages: [
        {
          role: "user",
          content: `Reading: "${doc.title}" (${scope})\n\n<pages>\n${pagesText}\n</pages>\n\nHighlights:\n${highlightList}`,
        },
      ],
    });
  } catch (err) {
    console.error("Quiz generation failed:", err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return NextResponse.json(
      { error: "Couldn't build a quiz right now — try again in a moment." },
      { status },
    );
  }

  if (response.stop_reason !== "end_turn") {
    console.error(`Quiz generation stopped early: ${response.stop_reason}`);
    return NextResponse.json(
      { error: "Couldn't build a quiz from these pages." },
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
      questions: {
        kind: "multiple_choice" | "short_answer";
        question: string;
        choices: string[];
        correct: number;
        answer: string;
        page: number;
        highlight: number;
      }[];
    };
    questions = parsed.questions.flatMap((q): QuizQuestion[] => {
      if (!q.question || !q.answer) return [];
      const source = q.highlight > 0 ? rangeHighlights[q.highlight - 1] : null;
      // Trust the highlight's own page over the model's; otherwise keep the
      // page only if it's inside the quizzed range.
      const base = {
        question: q.question,
        answer: q.answer,
        pageNumber:
          source?.pageNumber ??
          (q.page >= from && q.page <= lastPage ? q.page : from),
        highlightId: source?.id ?? null,
      };
      if (q.kind === "short_answer") return [{ ...base, kind: "short_answer" }];
      // A multiple-choice question without a valid right option is useless;
      // drop it rather than show it.
      const choices = q.choices.filter((c) => c.trim());
      if (
        choices.length < 2 ||
        choices.length !== q.choices.length ||
        !Number.isInteger(q.correct) ||
        q.correct < 0 ||
        q.correct >= choices.length
      ) {
        return [];
      }
      // Shuffle so the right option isn't always where the model put it.
      const order = shuffle(choices.map((_, i) => i));
      return [
        {
          ...base,
          kind: "multiple_choice",
          choices: order.map((i) => choices[i]),
          correctIndex: order.indexOf(q.correct),
        },
      ];
    });
  } catch (err) {
    console.error("Quiz response wasn't valid JSON:", err);
    questions = [];
  }

  if (questions.length === 0) {
    return NextResponse.json(
      { error: "Couldn't build a quiz from these pages." },
      { status: 502 },
    );
  }

  return NextResponse.json({ questions });
}

const shuffle = <T>(items: T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
