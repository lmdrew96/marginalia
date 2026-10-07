import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import {
  documents,
  highlights,
  bookmarks,
  chatMessages,
  pageOcr,
} from "@/db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { getOwnedDocument } from "@/lib/documents";
import { getDownloadUrl } from "@/lib/r2";
import { DocumentReader } from "@/components/DocumentReader";
import { ArrowLeftIcon } from "@/components/icons";

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

  const [fileUrl, docHighlights, docBookmarks, recentChat, ocrPages] =
    await Promise.all([
      getDownloadUrl(doc.fileUrl),
      db
        .select()
        .from(highlights)
        .where(eq(highlights.documentId, id))
        .orderBy(asc(highlights.pageNumber), asc(highlights.pageStartOffset)),
      db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.documentId, id))
        .orderBy(asc(bookmarks.pageNumber)),
      db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.documentId, id))
        .orderBy(desc(chatMessages.createdAt))
        .limit(20),
      db.select().from(pageOcr).where(eq(pageOcr.documentId, id)),
      // For "last opened" on the library card.
      db
        .update(documents)
        .set({ lastOpenedAt: new Date() })
        .where(eq(documents.id, id)),
    ]);
  const docChatMessages = recentChat.reverse();

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 pt-5 pb-1">
        <Link
          href="/library"
          className="flex items-center gap-1.5 justify-self-start rounded-full px-2.5 py-1 text-sm text-secondary transition-colors hover:bg-surface hover:text-on-surface"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Library
        </Link>
        <h1 className="max-w-[50vw] truncate text-center font-display text-lg font-semibold tracking-tight">
          {doc.title}
        </h1>
        {doc.threadnotesArticleId ? (
          <span
            className="justify-self-end text-xs text-secondary"
            title="Highlights and their notes are saved to ThreadNotes as excerpts on this paper."
          >
            Saving to ThreadNotes
          </span>
        ) : (
          <span />
        )}
      </header>
      <DocumentReader
        documentId={id}
        fileUrl={fileUrl}
        initialHighlights={docHighlights}
        initialBookmarks={docBookmarks}
        initialChatMessages={docChatMessages}
        initialOcrPages={ocrPages}
        reportPageCount={doc.pageCount === null}
      />
    </div>
  );
}
