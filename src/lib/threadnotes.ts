import { db } from "@/db";
import {
  highlights,
  userSettings,
  type Document,
  type Highlight,
} from "@/db/schema";
import { eq } from "drizzle-orm";

// ThreadNotes (research.adhdesigns.dev) holds the reader's saved papers.
// Every call is server-to-server with the reader's own API key, which never
// reaches the browser. Override the base URL to point at a local ThreadNotes.
const BASE_URL = process.env.THREADNOTES_URL ?? "https://research.adhdesigns.dev";

export type ArticleStatus = "to-read" | "reading" | "done";

export type ThreadNotesArticle = {
  id: string;
  title: string;
  year: number | null;
  doi: string | null;
  url: string | null;
  status: ArticleStatus;
  isOpenAccess: boolean;
  oaUrl: string | null;
  // Signed for an hour; re-list for a fresh one.
  pdfUrl: string | null;
};

export type ThreadNotesProject = {
  id: string;
  name: string;
  articleCount: number;
  active: boolean;
};

export type ThreadNotesLibrary = {
  project: { id: string; name: string };
  articles: ThreadNotesArticle[];
  projects: ThreadNotesProject[];
};

export class ThreadNotesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ThreadNotesError";
  }
}

const call = async (
  apiKey: string,
  query: Record<string, string>,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> => {
  const url = `${BASE_URL}/api/excerpts?${new URLSearchParams(query)}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : res.statusText;
    throw new ThreadNotesError(`ThreadNotes ${res.status}: ${detail}`, res.status);
  }
  return body;
};

/**
 * The articles in a project, plus every project to choose from. With no
 * projectId ThreadNotes answers for its active project — only use that to
 * get the project list.
 */
export const getLibrary = async (
  apiKey: string,
  projectId?: string,
): Promise<ThreadNotesLibrary> =>
  (await call(apiKey, projectId ? { projectId } : {})) as ThreadNotesLibrary;

/** Saves a highlight as an excerpt and returns the excerpt's id. */
export const createExcerpt = async (
  apiKey: string,
  projectId: string,
  excerpt: { quote: string; comment?: string; page: number; articleId: string },
): Promise<string> => {
  const body = (await call(apiKey, { projectId }, {
    method: "POST",
    body: excerpt,
  })) as { id?: string; excerpt?: { id?: string } } | null;
  const id = body?.id ?? body?.excerpt?.id;
  if (!id) throw new ThreadNotesError("ThreadNotes didn't return an excerpt id", 502);
  return id;
};

export const updateExcerpt = async (
  apiKey: string,
  excerptId: string,
  changes: { quote?: string; comment?: string; page?: number | null },
): Promise<void> => {
  await call(apiKey, { excerptId }, { method: "PATCH", body: changes });
};

/** Removes an excerpt. One that's already gone counts as removed. */
export const deleteExcerpt = async (
  apiKey: string,
  excerptId: string,
): Promise<void> => {
  try {
    await call(apiKey, { excerptId }, { method: "DELETE" });
  } catch (err) {
    if (err instanceof ThreadNotesError && err.status === 404) return;
    throw err;
  }
};

export const setArticleStatus = async (
  apiKey: string,
  articleId: string,
  status: ArticleStatus,
): Promise<void> => {
  await call(apiKey, { articleId }, { method: "PATCH", body: { status } });
};

export type ThreadNotesSettings = {
  apiKey: string | null;
  projectId: string | null;
};

export const getThreadNotesSettings = async (
  userId: string,
): Promise<ThreadNotesSettings> => {
  const [row] = await db
    .select({
      apiKey: userSettings.threadnotesApiKey,
      projectId: userSettings.threadnotesProjectId,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return { apiKey: row?.apiKey ?? null, projectId: row?.projectId ?? null };
};

/** Forgets a saved project ThreadNotes no longer knows (trashed or gone). */
export const clearThreadNotesProject = async (userId: string): Promise<void> => {
  await db
    .update(userSettings)
    .set({ threadnotesProjectId: null, updatedAt: new Date() })
    .where(eq(userSettings.userId, userId));
};

/**
 * Opening a paper starts reading it. A paper already marked done stays
 * done — reopening it to check a quote isn't rereading it.
 */
export const markReading = async (
  apiKey: string,
  article: ThreadNotesArticle,
): Promise<void> => {
  if (article.status !== "to-read") return;
  try {
    await setArticleStatus(apiKey, article.id, "reading");
  } catch (err) {
    // The paper still opens; the status is only bookkeeping.
    console.error(`Couldn't mark ThreadNotes article ${article.id} as reading:`, err);
  }
};

const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Downloads a paper's PDF, or returns null when the link doesn't lead to
 * one (open-access links often point at a landing page instead).
 */
export const downloadPdf = async (url: string): Promise<Buffer | null> => {
  if (!url.startsWith("https://")) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`PDF download from ${url} failed: ${res.status}`);
      return null;
    }
    if (Number(res.headers.get("content-length") ?? 0) > MAX_PDF_BYTES) {
      console.error(`PDF at ${url} is over the size limit`);
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) {
      console.error(`PDF at ${url} is over the size limit`);
      return null;
    }
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      console.error(`${url} didn't return a PDF`);
      return null;
    }
    return bytes;
  } catch (err) {
    console.error(`PDF download from ${url} failed:`, err);
    return null;
  }
};

export type ResolvedArticle =
  | {
      ok: true;
      apiKey: string;
      projectId: string;
      article: ThreadNotesArticle;
    }
  | { ok: false; status: number; error: string };

/**
 * Looks up one article in the reader's chosen ThreadNotes project, with a
 * fresh pdfUrl. Fails with a message the reader can act on.
 */
export const resolveArticle = async (
  userId: string,
  articleId: string,
): Promise<ResolvedArticle> => {
  const { apiKey, projectId } = await getThreadNotesSettings(userId);
  if (!apiKey) {
    return { ok: false, status: 409, error: "Connect ThreadNotes in Settings first." };
  }
  if (!projectId) {
    return { ok: false, status: 409, error: "Pick a ThreadNotes project first." };
  }
  let library: ThreadNotesLibrary;
  try {
    library = await getLibrary(apiKey, projectId);
  } catch (err) {
    console.error("ThreadNotes library lookup failed:", err);
    if (err instanceof ThreadNotesError && err.status === 404) {
      await clearThreadNotesProject(userId);
      return {
        ok: false,
        status: 409,
        error: "That ThreadNotes project is gone. Pick another one.",
      };
    }
    if (err instanceof ThreadNotesError && (err.status === 401 || err.status === 403)) {
      return {
        ok: false,
        status: 409,
        error: "ThreadNotes didn't accept your API key. Update it in Settings.",
      };
    }
    return { ok: false, status: 502, error: "Couldn't reach ThreadNotes. Try again." };
  }
  const article = library.articles.find((a) => a.id === articleId);
  if (!article) {
    return { ok: false, status: 404, error: "That paper isn't in your ThreadNotes project." };
  }
  return { ok: true, apiKey, projectId, article };
};

/**
 * Saves a highlight on a ThreadNotes-linked document as an excerpt on its
 * article: creates the excerpt the first time (or when an earlier attempt
 * failed), updates its comment after that. The highlight itself is already
 * saved, so a ThreadNotes failure comes back as an error to show, not a
 * thrown one.
 */
export const saveHighlightAsExcerpt = async (
  userId: string,
  doc: Document,
  highlight: Highlight,
): Promise<{ highlight: Highlight; threadnotesError?: string }> => {
  if (!doc.threadnotesArticleId || !doc.threadnotesProjectId) return { highlight };
  const { apiKey } = await getThreadNotesSettings(userId);
  if (!apiKey) {
    return {
      highlight,
      threadnotesError: "Saved here, but not to ThreadNotes: connect it in Settings.",
    };
  }
  try {
    if (highlight.threadnotesExcerptId) {
      await updateExcerpt(apiKey, highlight.threadnotesExcerptId, {
        comment: highlight.comment ?? "",
      });
      return { highlight };
    }
    const excerptId = await createExcerpt(apiKey, doc.threadnotesProjectId, {
      quote: highlight.textContent,
      ...(highlight.comment && { comment: highlight.comment }),
      page: highlight.pageNumber,
      articleId: doc.threadnotesArticleId,
    });
    const [linked] = await db
      .update(highlights)
      .set({ threadnotesExcerptId: excerptId })
      .where(eq(highlights.id, highlight.id))
      .returning();
    return { highlight: linked };
  } catch (err) {
    console.error(`Saving highlight ${highlight.id} to ThreadNotes failed:`, err);
    return {
      highlight,
      threadnotesError: "Saved here, but ThreadNotes didn't get it. Add or edit its note to retry.",
    };
  }
};
