import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { documents, highlights } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { UploadDocument } from "@/components/UploadDocument";
import { DeleteDocumentButton } from "@/components/DeleteDocumentButton";
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

  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      uploadedAt: documents.uploadedAt,
      pageCount: documents.pageCount,
      lastOpenedAt: documents.lastOpenedAt,
      highlightCount: sql<number>`count(${highlights.id})::int`,
    })
    .from(documents)
    .leftJoin(highlights, eq(highlights.documentId, documents.id))
    .where(eq(documents.userId, userId))
    .groupBy(documents.id)
    .orderBy(desc(documents.uploadedAt));

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
        <ul className="flex flex-col gap-3">
          {docs.map((doc) => {
            const unopened = doc.lastOpenedAt === null;
            const meta = [
              doc.pageCount !== null && plural(doc.pageCount, "page"),
              plural(doc.highlightCount, "highlight"),
              doc.lastOpenedAt
                ? `opened ${timeAgo(doc.lastOpenedAt)}`
                : `added ${timeAgo(doc.uploadedAt)}`,
            ].filter(Boolean);
            return (
              <li
                key={doc.id}
                className="fade-in group flex items-center rounded-xl border border-l-4 border-border bg-surface/30 shadow-sm transition-shadow hover:shadow-paper"
                style={{
                  borderLeftColor: unopened
                    ? "var(--marker)"
                    : "var(--accent-fill)",
                }}
              >
                <Link
                  href={`/read/${doc.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-1 px-5 py-4"
                >
                  {unopened && <span className="eyebrow">New</span>}
                  <span className="truncate font-display text-lg font-semibold group-hover:text-accent">
                    {doc.title}
                  </span>
                  <span className="text-sm text-secondary">
                    {meta.join(" · ")}
                  </span>
                </Link>
                <div className="pr-4">
                  <DeleteDocumentButton documentId={doc.id} title={doc.title} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
