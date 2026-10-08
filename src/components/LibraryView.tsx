"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DeleteDocumentButton } from "@/components/DeleteDocumentButton";

export type LibraryDoc = {
  id: string;
  title: string;
  folderId: string | null;
  fromThreadNotes: boolean;
  highlightCount: number;
  uploadedAt: number;
  lastOpenedAt: number | null;
  // "12 pages · 3 highlights · opened yesterday", built on the server.
  meta: string;
};

export type LibraryFolder = { id: string; name: string };

type Sort = "opened" | "added" | "title";
type Filter = "all" | "threadnotes" | "uploads" | "unopened" | "highlighted";
type FolderView = "all" | "unfiled" | string;

const SORTS: Record<Sort, string> = {
  opened: "Recently opened",
  added: "Recently added",
  title: "Title A–Z",
};

const FILTERS: Record<Filter, string> = {
  all: "All papers",
  threadnotes: "From ThreadNotes",
  uploads: "My uploads",
  unopened: "Not opened yet",
  highlighted: "Has highlights",
};

const MATCHES: Record<Filter, (d: LibraryDoc) => boolean> = {
  all: () => true,
  threadnotes: (d) => d.fromThreadNotes,
  uploads: (d) => !d.fromThreadNotes,
  unopened: (d) => d.lastOpenedAt === null,
  highlighted: (d) => d.highlightCount > 0,
};

const COMPARE: Record<Sort, (a: LibraryDoc, b: LibraryDoc) => number> = {
  // Never-opened papers count from when they were added.
  opened: (a, b) =>
    (b.lastOpenedAt ?? b.uploadedAt) - (a.lastOpenedAt ?? a.uploadedAt),
  added: (a, b) => b.uploadedAt - a.uploadedAt,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
};

const chip = (active: boolean): string =>
  `rounded-full border px-3 py-1 text-sm transition-colors ${
    active
      ? "border-accent bg-accent-fill text-on-accent"
      : "border-border text-secondary hover:bg-surface hover:text-on-surface"
  }`;

const selectClass =
  "rounded-full border border-border bg-background px-3 py-1.5 text-sm text-on-surface";

/** Search, sort, filter and folders over the reader's documents. */
export const LibraryView = ({
  docs,
  folders,
}: {
  docs: LibraryDoc[];
  folders: LibraryFolder[];
}): React.JSX.Element => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("opened");
  const [filter, setFilter] = useState<Filter>("all");
  const [folderView, setFolderView] = useState<FolderView>("all");
  // "new" while naming a new folder, or the id of the folder being renamed.
  const [naming, setNaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A folder deleted elsewhere (or just now) falls back to All.
  const currentFolder = folders.find((f) => f.id === folderView);
  const view: FolderView =
    folderView === "all" || folderView === "unfiled" || currentFolder
      ? folderView
      : "all";

  const inView = (d: LibraryDoc): boolean =>
    view === "all" ? true : view === "unfiled" ? d.folderId === null : d.folderId === view;
  const needle = query.trim().toLowerCase();
  const shown = docs
    .filter(inView)
    .filter(MATCHES[filter])
    .filter((d) => !needle || d.title.toLowerCase().includes(needle))
    .sort(COMPARE[sort]);
  const narrowed = needle !== "" || filter !== "all";

  const send = async (url: string, method: string, body?: unknown): Promise<unknown> => {
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      startTransition(() => router.refresh());
      return json;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "That didn't work — try again.");
      return null;
    }
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name || !naming) {
      setNaming(null);
      return;
    }
    if (naming === "new") {
      const folder = (await send("/api/folders", "POST", { name })) as LibraryFolder | null;
      if (!folder) return;
      setFolderView(folder.id);
    } else if (!(await send(`/api/folders/${naming}`, "PATCH", { name }))) {
      return;
    }
    setNaming(null);
  };

  const startNaming = (target: string, initial: string) => {
    setNaming(target);
    setNameDraft(initial);
    setError(null);
  };

  const deleteFolder = async (folder: LibraryFolder) => {
    if (
      !window.confirm(
        `Delete the folder "${folder.name}"? Its papers stay in your library, unfiled.`,
      )
    ) {
      return;
    }
    if (await send(`/api/folders/${folder.id}`, "DELETE")) setFolderView("all");
  };

  const nameInput = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void saveName();
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
        maxLength={60}
        placeholder="Folder name"
        aria-label="Folder name"
        className="w-40 rounded-full border border-border bg-background px-3 py-1 text-sm"
      />
      <button type="submit" disabled={pending} className="rounded-full px-2.5 py-1 text-sm text-accent hover:bg-surface">
        Save
      </button>
      <button type="button" onClick={() => setNaming(null)} className="rounded-full px-2.5 py-1 text-sm text-secondary hover:bg-surface">
        Cancel
      </button>
    </form>
  );

  const count = (pred: (d: LibraryDoc) => boolean): number => docs.filter(pred).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Folders">
        <button onClick={() => setFolderView("all")} className={chip(view === "all")}>
          All <span className="tabular-nums opacity-70">{docs.length}</span>
        </button>
        {folders.length > 0 && (
          <button onClick={() => setFolderView("unfiled")} className={chip(view === "unfiled")}>
            Unfiled <span className="tabular-nums opacity-70">{count((d) => d.folderId === null)}</span>
          </button>
        )}
        {folders.map((f) => (
          <button key={f.id} onClick={() => setFolderView(f.id)} className={chip(view === f.id)}>
            {f.name} <span className="tabular-nums opacity-70">{count((d) => d.folderId === f.id)}</span>
          </button>
        ))}
        {naming === "new" ? (
          nameInput
        ) : (
          <button
            onClick={() => startNaming("new", "")}
            className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-secondary transition-colors hover:bg-surface hover:text-on-surface"
          >
            + New folder
          </button>
        )}
      </div>

      {currentFolder && (
        <div className="-mt-2 flex items-center gap-2 text-sm">
          {naming === currentFolder.id ? (
            nameInput
          ) : (
            <>
              <button
                onClick={() => startNaming(currentFolder.id, currentFolder.name)}
                className="rounded-full px-2.5 py-1 text-secondary hover:bg-surface hover:text-on-surface"
              >
                Rename folder
              </button>
              <button
                onClick={() => void deleteFolder(currentFolder)}
                className="rounded-full px-2.5 py-1 text-error hover:bg-surface"
              >
                Delete folder
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles"
          aria-label="Search titles"
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-1.5 text-sm"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          aria-label="Show"
          className={selectClass}
        >
          {Object.entries(FILTERS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort by"
          className={selectClass}
        >
          {Object.entries(SORTS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center text-secondary">
          <p>
            {narrowed
              ? "No papers match."
              : view === "unfiled"
                ? "Every paper is in a folder."
                : "This folder is empty. Move papers here with the menu on each one."}
          </p>
          {narrowed && (
            <button
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="text-sm text-accent hover:underline"
            >
              Clear search and filter
            </button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((doc) => {
            const unopened = doc.lastOpenedAt === null;
            return (
              <li
                key={doc.id}
                className="fade-in group flex items-center rounded-xl border border-l-4 border-border bg-surface/30 shadow-sm transition-shadow hover:shadow-paper"
                style={{
                  borderLeftColor: unopened ? "var(--marker)" : "var(--accent-fill)",
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
                  <span className="text-sm text-secondary">{doc.meta}</span>
                </Link>
                <div className="flex items-center gap-2 pr-4">
                  {folders.length > 0 && (
                    <select
                      value={doc.folderId ?? ""}
                      onChange={(e) =>
                        void send(`/api/documents/${doc.id}`, "PATCH", {
                          folderId: e.target.value || null,
                        })
                      }
                      disabled={pending}
                      aria-label={`Folder for ${doc.title}`}
                      title="Move to folder"
                      className="max-w-36 rounded-full border border-border bg-background px-2 py-1 text-xs text-secondary"
                    >
                      <option value="">Unfiled</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <DeleteDocumentButton documentId={doc.id} title={doc.title} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
