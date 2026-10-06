import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pageOcr } from "@/db/schema";
import { getOwnedDocument } from "@/lib/documents";
import type { OcrWord } from "@/lib/highlight-types";

// OCR runs in the reader with tesseract.js (it needs word positions to build
// a selectable text layer, which a vision model's transcription doesn't
// give). This route only stores the result for one page.

const MAX_WORDS_PER_PAGE = 20000;

function isFraction(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function isOcrWord(w: unknown): w is OcrWord {
  if (!w || typeof w !== "object") return false;
  const { text, x, y, w: width, h } = w as Record<string, unknown>;
  return (
    typeof text === "string" &&
    text.length > 0 &&
    isFraction(x) &&
    isFraction(y) &&
    isFraction(width) &&
    isFraction(h)
  );
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

  const { pageNumber, words } = await req.json();
  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    !Array.isArray(words) ||
    words.length > MAX_WORDS_PER_PAGE ||
    !words.every(isOcrWord)
  ) {
    return NextResponse.json(
      { error: "pageNumber and a valid words array are required" },
      { status: 400 },
    );
  }

  const [saved] = await db
    .insert(pageOcr)
    .values({ documentId: id, pageNumber, words })
    .onConflictDoUpdate({
      target: [pageOcr.documentId, pageOcr.pageNumber],
      set: { words },
    })
    .returning();

  return NextResponse.json(saved, { status: 201 });
}
