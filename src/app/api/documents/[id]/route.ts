import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOwnedDocument } from "@/lib/documents";
import { getDownloadUrl } from "@/lib/r2";

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

  const downloadUrl = await getDownloadUrl(doc.fileUrl);
  return NextResponse.json({ ...doc, downloadUrl });
}
