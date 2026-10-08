import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { folders } from "@/db/schema";
import { folderNameTaken, parseFolderName } from "@/lib/folders";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name: raw } = await req.json().catch(() => ({}));
  const parsed = parseFolderName(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (await folderNameTaken(userId, parsed.name)) {
    return NextResponse.json(
      { error: `You already have a folder called "${parsed.name}".` },
      { status: 409 },
    );
  }

  const [folder] = await db
    .insert(folders)
    .values({ userId, name: parsed.name })
    .returning();
  return NextResponse.json(folder, { status: 201 });
}
