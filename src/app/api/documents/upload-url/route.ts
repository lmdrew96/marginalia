import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getUploadUrl } from "@/lib/r2";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename, contentType } = await req.json();
  if (!filename || contentType !== "application/pdf") {
    return NextResponse.json(
      { error: "PDF uploads only for now" },
      { status: 400 },
    );
  }

  const key = `${userId}/${crypto.randomUUID()}-${filename}`;
  const uploadUrl = await getUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl, key });
}
