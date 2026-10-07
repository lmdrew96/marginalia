import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { gradeRequests } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { anthropic, DAILY_GRADE_LIMIT, GRADE_MODEL } from "@/lib/anthropic";
import { getClaudeInstructions, instructionsBlock } from "@/lib/settings";

export const runtime = "nodejs";

export type GradeVerdict = "correct" | "partial" | "incorrect";
export type Grade = { verdict: GradeVerdict; feedback: string };

const MAX_FIELD_CHARS = 4000;

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
    feedback: { type: "string" },
  },
  required: ["verdict", "feedback"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You grade a student's short answer to a review question about a reading. You get the question, the model answer, and the student's answer.

Judge meaning, not wording: an answer in the student's own words that captures the model answer's key idea is "correct". "partial" means they got part of it, or the right idea with a real gap or error. "incorrect" means they missed the key idea.

"feedback" is one or two sentences addressed to the student: say what they got, and if anything is missing or wrong, name it plainly. Be encouraging but honest. Markdown is fine.`;

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

  const { question, modelAnswer, response } = await req
    .json()
    .catch(() => ({}));
  const fields = [question, modelAnswer, response];
  if (
    !fields.every(
      (f) => typeof f === "string" && f.trim() && f.length <= MAX_FIELD_CHARS,
    )
  ) {
    return NextResponse.json(
      { error: "question, modelAnswer and response are required" },
      { status: 400 },
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(gradeRequests)
    .where(
      and(eq(gradeRequests.userId, userId), gte(gradeRequests.createdAt, since)),
    );
  if (count >= DAILY_GRADE_LIMIT) {
    return NextResponse.json(
      { error: "Daily grading limit reached — compare with the model answer for now." },
      { status: 429 },
    );
  }
  // Counted once the request reaches Claude, like quizzes.
  await db.insert(gradeRequests).values({ userId });

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: GRADE_MODEL,
      max_tokens: 1024,
      output_config: {
        format: { type: "json_schema", schema: GRADE_SCHEMA },
      },
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        ...instructionsBlock(await getClaudeInstructions(userId)),
      ],
      messages: [
        {
          role: "user",
          content: `Reading: "${doc.title}"\n\n<question>\n${question}\n</question>\n\n<model_answer>\n${modelAnswer}\n</model_answer>\n\n<student_answer>\n${response}\n</student_answer>`,
        },
      ],
    });
  } catch (err) {
    console.error("Grading failed:", err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return NextResponse.json(
      { error: "Couldn't grade that right now — try again in a moment." },
      { status },
    );
  }

  if (message.stop_reason !== "end_turn") {
    console.error(`Grading stopped early: ${message.stop_reason}`);
    return NextResponse.json(
      { error: "Couldn't grade that answer." },
      { status: 502 },
    );
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    const grade = JSON.parse(text) as Grade;
    if (!["correct", "partial", "incorrect"].includes(grade.verdict)) {
      throw new Error(`Unexpected verdict: ${grade.verdict}`);
    }
    return NextResponse.json(grade);
  } catch (err) {
    console.error("Grade response wasn't valid:", err);
    return NextResponse.json(
      { error: "Couldn't grade that answer." },
      { status: 502 },
    );
  }
}
