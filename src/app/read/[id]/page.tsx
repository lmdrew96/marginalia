import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { highlights, bookmarks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { getDownloadUrl } from "@/lib/r2";
import { PdfReader } from "@/components/PdfReader";

export default async function ReadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const doc = await getOwnedDocument(id, userId);
  if (!doc) notFound();

  const [downloadUrl, docHighlights, docBookmarks] = await Promise.all([
    getDownloadUrl(doc.fileUrl),
    db
      .select()
      .from(highlights)
      .where(eq(highlights.documentId, id))
      .orderBy(asc(highlights.pageNumber)),
    db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.documentId, id))
      .orderBy(asc(bookmarks.pageNumber)),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <Link href="/library" className="text-sm text-zinc-500 hover:underline">
          ← Library
        </Link>
        <h1 className="text-sm font-medium">{doc.title}</h1>
        <span />
      </header>
      <PdfReader
        documentId={id}
        fileUrl={downloadUrl}
        initialHighlights={docHighlights}
        initialBookmarks={docBookmarks}
      />
    </div>
  );
}
