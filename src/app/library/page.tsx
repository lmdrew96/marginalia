import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { documents, folders, highlights } from "@/db/schema";
import { asc, eq, desc, sql } from "drizzle-orm";
import { UploadDocument } from "@/components/UploadDocument";
import { LibraryView, type LibraryDoc } from "@/components/LibraryView";
import { BookOpenIcon } from "@/components/icons";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// "today", "yesterday", "3 days ago", "2 months ago".
const timeAgo = (date: Date): string => {
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (days > -1) return "today";
  if (days > -30) return relative.format(days, "day");
  if (days > -365) return relative.format(Math.round(days / 30), "month");
  return relative.format(Math.round(days / 365), "year");
};

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [docs, userFolders] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        uploadedAt: documents.uploadedAt,
        pageCount: documents.pageCount,
        lastOpenedAt: documents.lastOpenedAt,
        folderId: documents.folderId,
        threadnotesArticleId: documents.threadnotesArticleId,
        highlightCount: sql<number>`count(${highlights.id})::int`,
      })
      .from(documents)
      .leftJoin(highlights, eq(highlights.documentId, documents.id))
      .where(eq(documents.userId, userId))
      .groupBy(documents.id)
      .orderBy(desc(documents.uploadedAt)),
    db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(asc(folders.name)),
  ]);

  // Relative times are worked out here, so the browser renders exactly
  // what the server did.
  const libraryDocs: LibraryDoc[] = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    folderId: doc.folderId,
    fromThreadNotes: doc.threadnotesArticleId !== null,
    highlightCount: doc.highlightCount,
    uploadedAt: doc.uploadedAt.getTime(),
    lastOpenedAt: doc.lastOpenedAt?.getTime() ?? null,
    meta: [
      doc.pageCount !== null && plural(doc.pageCount, "page"),
      plural(doc.highlightCount, "highlight"),
      doc.lastOpenedAt
        ? `opened ${timeAgo(doc.lastOpenedAt)}`
        : `added ${timeAgo(doc.uploadedAt)}`,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Reading desk</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Your library
          </h1>
        </div>
        <UploadDocument />
      </div>

      {docs.length === 0 ? (
        <div className="fade-in flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <BookOpenIcon className="h-10 w-10 text-accent" />
          <h2 className="font-display text-2xl font-semibold">
            Nothing on the desk yet
          </h2>
          <p className="max-w-sm text-secondary">
            Upload a PDF or Word file to start reading. Highlight what matters,
            write in the margins, and ask Claude about any page.
          </p>
        </div>
      ) : (
        <LibraryView docs={libraryDocs} folders={userFolders} />
      )}
    </div>
  );
}
