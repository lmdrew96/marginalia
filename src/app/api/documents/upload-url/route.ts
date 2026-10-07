import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getUploadUrl } from "@/lib/r2";
import { DOCX_MIME, isDocx } from "@/lib/convert/docx";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename, contentType } = await req.json();
  // The extension decides how the file is processed, so it must agree with
  // the content type the upload is signed for.
  const ok =
    typeof filename === "string" &&
    ((/\.pdf$/i.test(filename) && contentType === "application/pdf") ||
      (isDocx(filename) && contentType === DOCX_MIME));
  if (!ok) {
    return NextResponse.json(
      { error: "Upload a PDF or Word (.docx) file" },
      { status: 400 },
    );
  }

  const key = `${userId}/${crypto.randomUUID()}-${filename}`;
  const uploadUrl = await getUploadUrl(key, contentType);

  return NextResponse.json({ uploadUrl, key });
}
