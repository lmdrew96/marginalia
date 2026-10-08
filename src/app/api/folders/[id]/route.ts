import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { folders } from "@/db/schema";
import {
  folderNameTaken,
  getOwnedFolder,
  parseFolderName,
} from "@/lib/folders";

/** Renames a folder. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await getOwnedFolder(id, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { name: raw } = await req.json().catch(() => ({}));
  const parsed = parseFolderName(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (await folderNameTaken(userId, parsed.name, id)) {
    return NextResponse.json(
      { error: `You already have a folder called "${parsed.name}".` },
      { status: 409 },
    );
  }

  const [folder] = await db
    .update(folders)
    .set({ name: parsed.name })
    .where(eq(folders.id, id))
    .returning();
  return NextResponse.json(folder);
}

/** Deletes a folder. Its documents stay, unfiled. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await getOwnedFolder(id, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.delete(folders).where(eq(folders.id, id));
  return NextResponse.json({ ok: true });
}
