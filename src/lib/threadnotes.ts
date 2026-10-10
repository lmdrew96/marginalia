import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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

// A research question in the project, offered as a connection target.
export type ThreadNotesQuestion = {
  id: string;
  q: string;
  theme: string;
};

export type ThreadNotesLibrary = {
  project: { id: string; name: string };
  articles: ThreadNotesArticle[];
  questions: ThreadNotesQuestion[];
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

export type ThreadNotesExcerpt = {
  id: string;
  quote: string;
  comment: string | null;
  page: number | null;
};

/**
 * Every excerpt on an article. Throws unless ThreadNotes answers with an
 * excerpts list, so a bad answer can't look like "all deleted".
 */
export const getArticleExcerpts = async (
  apiKey: string,
  articleId: string,
): Promise<ThreadNotesExcerpt[]> => {
  const body = (await call(apiKey, { articleId })) as {
    excerpts?: unknown;
  } | null;
  if (!Array.isArray(body?.excerpts)) {
    throw new ThreadNotesError("ThreadNotes didn't return an excerpts list", 502);
  }
  return body.excerpts as ThreadNotesExcerpt[];
};

/**
 * Saves a highlight as an excerpt and returns the excerpt's id. ThreadNotes
 * matches on the quote, so `duplicate` means it handed back an existing
 * excerpt and ignored the comment and page sent with it.
 */
export const createExcerpt = async (
  apiKey: string,
  projectId: string,
  excerpt: { quote: string; comment?: string; page: number; articleId: string },
): Promise<{ excerptId: string; duplicate: boolean }> => {
  const body = (await call(apiKey, { projectId }, {
    method: "POST",
    // `client` labels the excerpt card "Marginalia · p. N"; any other value is a 400.
    body: { ...excerpt, client: "marginalia" },
  })) as { excerptId?: string; duplicate?: boolean; error?: string } | null;
  // ThreadNotes answers 200 with an `error` (and an empty excerptId) when it
  // can't place the excerpt, e.g. the article isn't in that project.
  if (body?.error) throw new ThreadNotesError(body.error, 422);
  if (!body?.excerptId) throw new ThreadNotesError("ThreadNotes didn't return an excerpt id", 502);
  return { excerptId: body.excerptId, duplicate: body.duplicate === true };
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

export const CONNECTION_RELATIONS = [
  "connects_to",
  "tension_with",
  "instance_of",
  "contradicts",
  "evidenced_by",
] as const;
export type ConnectionRelation = (typeof CONNECTION_RELATIONS)[number];

// The targets Marginalia offers; ThreadNotes accepts a few more.
export type ConnectionTarget = "question" | "article";

/**
 * Adds a "because" connection from an excerpt to a question or article in
 * its project. An identical connection already there comes back with
 * created: false; questionStarted means a Not-started question moved to
 * Exploring.
 */
export const connectExcerpt = async (
  apiKey: string,
  connection: {
    excerptId: string;
    toType: ConnectionTarget;
    toId: string;
    relation: ConnectionRelation;
    because: string;
  },
): Promise<{ created: boolean; questionStarted: boolean }> => {
  const body = (await call(apiKey, { action: "connect" }, {
    method: "POST",
    body: connection,
  })) as { created?: boolean; questionStarted?: boolean } | null;
  return { created: body?.created !== false, questionStarted: body?.questionStarted === true };
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
const MAX_REDIRECTS = 5;

// Loopback, private, link-local, CGNAT, and unspecified addresses: a PDF
// link must never reach the server's own network.
const isPrivateAddress = (ip: string): boolean => {
  const v = ip.toLowerCase();
  if (v.includes(":")) {
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = v.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const isPublicHttps = async (url: URL): Promise<boolean> => {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  return addresses.length > 0 && !addresses.some(isPrivateAddress);
};

/**
 * Downloads a paper's PDF, or returns null when the link doesn't lead to
 * one (open-access links often point at a landing page instead). Follows
 * redirects by hand so every hop is checked, and logs only the host:
 * pdfUrl is signed, so the full URL is a credential.
 */
export const downloadPdf = async (link: string): Promise<Buffer | null> => {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    console.error("PDF link isn't a valid URL");
    return null;
  }
  try {
    const signal = AbortSignal.timeout(30_000);
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isPublicHttps(url))) {
        console.error(`PDF link to ${url.host} isn't a public https address`);
        return null;
      }
      res = await fetch(url, { redirect: "manual", cache: "no-store", signal });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) break;
      await res.body?.cancel();
      url = new URL(location, url);
      res = null;
    }
    if (!res) {
      console.error(`PDF link to ${url.host} redirected too many times`);
      return null;
    }
    if (!res.ok || !res.body) {
      console.error(`PDF download from ${url.host} failed: ${res.status}`);
      return null;
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PDF_BYTES) {
        await reader.cancel();
        console.error(`PDF from ${url.host} is over the size limit`);
        return null;
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      console.error(`${url.host} didn't return a PDF`);
      return null;
    }
    return bytes;
  } catch (err) {
    console.error(`PDF download from ${url.host} failed:`, err);
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
 * Records whether the highlight's margin note still has to reach
 * ThreadNotes. Returns the stored row, or the highlight as given if it
 * couldn't be updated.
 */
const setCommentDirty = async (highlight: Highlight, dirty: boolean): Promise<Highlight> => {
  if (highlight.threadnotesCommentDirty === dirty) return highlight;
  try {
    const [row] = await db
      .update(highlights)
      .set({ threadnotesCommentDirty: dirty })
      .where(eq(highlights.id, highlight.id))
      .returning();
    return row ?? highlight;
  } catch (err) {
    console.error(`Marking highlight ${highlight.id}'s note dirty=${dirty} failed:`, err);
    return highlight;
  }
};

/**
 * Saves a highlight on a ThreadNotes-linked document as an excerpt on its
 * article: creates the excerpt the first time (or when an earlier attempt
 * failed), updates its comment after that. The highlight itself is already
 * saved, so a ThreadNotes failure comes back as an error to show, not a
 * thrown one, and marks the note dirty so reopening the paper retries it
 * instead of pulling the older excerpt comment over it.
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
      highlight: await setCommentDirty(highlight, true),
      threadnotesError: "Saved here, but not to ThreadNotes: connect it in Settings.",
    };
  }
  try {
    if (highlight.threadnotesExcerptId) {
      await updateExcerpt(apiKey, highlight.threadnotesExcerptId, {
        comment: highlight.comment ?? "",
      });
      return { highlight: await setCommentDirty(highlight, false) };
    }
    const { excerptId, duplicate } = await createExcerpt(apiKey, doc.threadnotesProjectId, {
      quote: highlight.textContent,
      ...(highlight.comment && { comment: highlight.comment }),
      page: highlight.pageNumber,
      articleId: doc.threadnotesArticleId,
    });
    // An existing excerpt (e.g. from an earlier attempt that saved but didn't
    // link) keeps its old comment and page, so bring them up to date.
    if (duplicate) {
      await updateExcerpt(apiKey, excerptId, {
        comment: highlight.comment ?? "",
        page: highlight.pageNumber,
      });
    }
    // If the link can't be stored (or the highlight was deleted meanwhile),
    // take the excerpt back out so a retry can't leave a duplicate.
    const unlink = async (reason: unknown): Promise<void> => {
      console.error(`Linking excerpt ${excerptId} to highlight ${highlight.id} failed:`, reason);
      // A duplicate was there before this attempt; it isn't ours to remove.
      if (duplicate) return;
      await deleteExcerpt(apiKey, excerptId).catch((err) =>
        console.error(`Couldn't remove unlinked excerpt ${excerptId}:`, err),
      );
    };
    let linked: Highlight | undefined;
    try {
      [linked] = await db
        .update(highlights)
        .set({ threadnotesExcerptId: excerptId, threadnotesCommentDirty: false })
        .where(eq(highlights.id, highlight.id))
        .returning();
    } catch (err) {
      await unlink(err);
      throw err;
    }
    if (!linked) {
      await unlink("highlight no longer exists");
      return { highlight };
    }
    return { highlight: linked };
  } catch (err) {
    console.error(`Saving highlight ${highlight.id} to ThreadNotes failed:`, err);
    return {
      highlight: await setCommentDirty(highlight, true),
      threadnotesError: "Saved here, but ThreadNotes didn't get it. Add or edit its note to retry.",
    };
  }
};
