import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.uploadedAt));

  return NextResponse.json(docs);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title, key } = await req.json();
  if (!title || !key) {
    return NextResponse.json(
      { error: "title and key are required" },
      { status: 400 },
    );
  }

  const [doc] = await db
    .insert(documents)
    .values({ userId, title, fileUrl: key, format: "pdf" })
    .returning();

  return NextResponse.json(doc, { status: 201 });
}
