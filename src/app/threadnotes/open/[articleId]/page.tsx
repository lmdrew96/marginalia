import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { openThreadNotesArticle } from "@/lib/threadnotes-open";
import { UploadDocument } from "@/components/UploadDocument";
import { BookOpenIcon } from "@/components/icons";

/**
 * A linkable way in for other apps (ThreadNotes' "Read in Marginalia"):
 * opens the paper and goes straight to the reader.
 */
export default async function OpenThreadNotesArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { userId, redirectToSignIn } = await auth();
  // Comes back here after signing in, so the link still opens the paper.
  if (!userId) return redirectToSignIn();

  const { articleId } = await params;
  const result = await openThreadNotesArticle(userId, articleId);
  if (result.kind === "opened") redirect(`/read/${result.documentId}`);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-14">
      <div className="fade-in flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <BookOpenIcon className="h-10 w-10 text-accent" />
        {result.kind === "needsUpload" ? (
          <>
            <p className="eyebrow">From ThreadNotes</p>
            <h1 className="font-display text-2xl font-semibold">{result.title}</h1>
            <p className="max-w-sm text-secondary">
              No PDF to fetch for this one. Upload your copy:
            </p>
            <UploadDocument threadnotesArticleId={articleId} label="Upload PDF" />
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold">
              Couldn&apos;t open this paper
            </h1>
            <p className="max-w-sm text-secondary">{result.error}</p>
            <div className="mt-2 flex gap-4 text-sm">
              <Link href="/threadnotes" className="text-accent hover:underline">
                Your ThreadNotes papers
              </Link>
              <Link href="/settings" className="text-accent hover:underline">
                Settings
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
