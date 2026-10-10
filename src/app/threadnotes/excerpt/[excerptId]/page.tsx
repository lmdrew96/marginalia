import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, highlights } from "@/db/schema";
import { BookOpenIcon } from "@/components/icons";

/**
 * A linkable way back from a ThreadNotes excerpt card: opens the reader at
 * the highlight the excerpt was saved from.
 */
export default async function OpenThreadNotesExcerptPage({
  params,
}: {
  params: Promise<{ excerptId: string }>;
}) {
  const { userId, redirectToSignIn } = await auth();
  // Comes back here after signing in, so the link still opens the highlight.
  if (!userId) return redirectToSignIn();

  const { excerptId } = await params;
  const [found] = await db
    .select({ highlightId: highlights.id, documentId: documents.id })
    .from(highlights)
    .innerJoin(documents, eq(highlights.documentId, documents.id))
    .where(and(eq(highlights.threadnotesExcerptId, excerptId), eq(documents.userId, userId)))
    .limit(1);
  if (found) redirect(`/read/${found.documentId}?highlight=${found.highlightId}`);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-14">
      <div className="fade-in flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <BookOpenIcon className="h-10 w-10 text-accent" />
        <h1 className="font-display text-2xl font-semibold">
          That highlight isn&apos;t in Marginalia anymore
        </h1>
        <p className="max-w-sm text-secondary">
          It was removed here, or saved to ThreadNotes from somewhere else.
        </p>
        <div className="mt-2 flex gap-4 text-sm">
          <Link href="/threadnotes" className="text-accent hover:underline">
            Your ThreadNotes papers
          </Link>
          <Link href="/library" className="text-accent hover:underline">
            Library
          </Link>
        </div>
      </div>
    </div>
  );
}
