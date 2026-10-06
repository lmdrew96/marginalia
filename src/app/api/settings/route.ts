import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { getClaudeInstructions, MAX_INSTRUCTIONS_LENGTH } from "@/lib/settings";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    claudeInstructions: await getClaudeInstructions(userId),
  });
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { claudeInstructions } = await req.json();
  if (
    typeof claudeInstructions !== "string" ||
    claudeInstructions.length > MAX_INSTRUCTIONS_LENGTH
  ) {
    return NextResponse.json(
      {
        error: `claudeInstructions must be a string of at most ${MAX_INSTRUCTIONS_LENGTH} characters`,
      },
      { status: 400 },
    );
  }

  const value = claudeInstructions.trim();
  const [saved] = await db
    .insert(userSettings)
    .values({ userId, claudeInstructions: value })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { claudeInstructions: value, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({ claudeInstructions: saved.claudeInstructions });
}
