import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import {
  clearThreadNotesProject,
  getLibrary,
  getThreadNotesSettings,
  ThreadNotesError,
  type ArticleStatus,
  type ThreadNotesLibrary,
} from "@/lib/threadnotes";
import { OpenThreadNotesArticle } from "@/components/OpenThreadNotesArticle";
import { BookOpenIcon } from "@/components/icons";

const STATUS_LABELS: Record<ArticleStatus, string> = {
  "to-read": "To read",
  reading: "Reading",
  done: "Done",
};

const Message = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element => (
  <div className="fade-in flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
    <BookOpenIcon className="h-10 w-10 text-accent" />
    <h2 className="font-display text-2xl font-semibold">{title}</h2>
    <div className="max-w-sm text-secondary">{children}</div>
  </div>
);

const settingsLink = (
  <Link href="/settings" className="text-accent hover:underline">
    Settings
  </Link>
);

export default async function ThreadNotesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { apiKey, projectId } = await getThreadNotesSettings(userId);

  let library: ThreadNotesLibrary | null = null;
  let problem: React.JSX.Element | null = null;
  if (!apiKey) {
    problem = (
      <Message title="Connect ThreadNotes">
        Add your ThreadNotes API key in {settingsLink} to open your saved papers
        here.
      </Message>
    );
  } else if (!projectId) {
    problem = (
      <Message title="Pick a project">
        Choose which ThreadNotes project to read from in {settingsLink}.
      </Message>
    );
  } else {
    try {
      library = await getLibrary(apiKey, projectId);
    } catch (err) {
      console.error("Loading the ThreadNotes library failed:", err);
      const status = err instanceof ThreadNotesError ? err.status : 0;
      if (status === 404) await clearThreadNotesProject(userId);
      problem =
        status === 404 ? (
          <Message title="That project is gone">
            It was trashed or removed in ThreadNotes. Pick another in{" "}
            {settingsLink}.
          </Message>
        ) : status === 401 || status === 403 ? (
          <Message title="ThreadNotes didn't accept your key">
            Replace it in {settingsLink}.
          </Message>
        ) : (
          <Message title="Couldn't reach ThreadNotes">
            Try again in a moment.
          </Message>
        );
    }
  }

  const articleIds = library?.articles.map((a) => a.id) ?? [];
  const opened = new Set(
    articleIds.length === 0
      ? []
      : (
          await db
            .select({ articleId: documents.threadnotesArticleId })
            .from(documents)
            .where(
              and(
                eq(documents.userId, userId),
                inArray(documents.threadnotesArticleId, articleIds),
              ),
            )
        ).map((d) => d.articleId),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-14">
      <div>
        <p className="eyebrow">From ThreadNotes</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          {library ? library.project.name : "Your papers"}
        </h1>
        {library && (
          <p className="mt-1 text-sm text-secondary">
            Highlights you make in these papers are saved to ThreadNotes as
            excerpts. Switch projects in {settingsLink}.
          </p>
        )}
      </div>

      {problem ??
        (library && library.articles.length === 0 ? (
          <Message title="No papers in this project">
            Save papers to it in ThreadNotes and they&apos;ll show up here.
          </Message>
        ) : (
          <ul className="flex flex-col gap-3">
            {library?.articles.map((article) => (
              <li
                key={article.id}
                className="fade-in flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface/30 px-5 py-4 shadow-sm"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-display text-lg font-semibold">
                    {article.title}
                  </span>
                  <span className="text-sm text-secondary">
                    {[
                      article.year,
                      STATUS_LABELS[article.status] ?? article.status,
                      article.isOpenAccess && "Open access",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <OpenThreadNotesArticle
                  articleId={article.id}
                  opened={opened.has(article.id)}
                />
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
