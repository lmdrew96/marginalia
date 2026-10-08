"use client";

import { useEffect, useState } from "react";
import type { Highlight } from "@/db/schema";
import { CloseIcon } from "@/components/icons";

type Action = "readd" | "remove" | "keep";

const ACTIONS: { action: Action; label: string; danger?: boolean }[] = [
  { action: "readd", label: "Re-add to ThreadNotes" },
  { action: "keep", label: "Keep here only" },
  { action: "remove", label: "Remove here", danger: true },
];

const snippet = (text: string): string =>
  text.length > 90 ? `${text.slice(0, 90).trimEnd()}…` : text;

/**
 * A quiet banner when highlights on this paper lost their excerpt in
 * ThreadNotes, with a review list to re-add, keep, or remove each one.
 * Dismissing changes nothing; it comes back the next time the paper opens.
 */
export const ThreadNotesOrphans = ({
  documentId,
  highlights,
  onResolved,
}: {
  documentId: string;
  highlights: Highlight[];
  onResolved: (result: { removed: string[]; updated: Highlight[] }) => void;
}): React.JSX.Element | null => {
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}/threadnotes-orphans`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `status ${res.status}`);
        if (!cancelled) setOrphanIds(body.highlightIds ?? []);
      })
      .catch((err) => console.error("Checking ThreadNotes excerpts failed:", err));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Highlights deleted here meanwhile drop out of the list.
  const orphans = highlights.filter((h) => orphanIds.includes(h.id));
  if (dismissed || orphans.length === 0) return null;

  const apply = async (action: Action, ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/threadnotes-orphans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, highlightIds: ids }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      const removed: string[] = body.removed ?? [];
      const updated: Highlight[] = body.updated ?? [];
      onResolved({ removed, updated });
      const done = new Set([...removed, ...updated.map((h) => h.id)]);
      setOrphanIds((prev) => prev.filter((id) => !done.has(id)));
      if (body.error) setError(body.error);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "That didn't work — try again.");
    } finally {
      setBusy(false);
    }
  };

  const buttons = (ids: string[]) =>
    ACTIONS.map(({ action, label, danger }) => (
      <button
        key={action}
        onClick={() => void apply(action, ids)}
        disabled={busy}
        className={`rounded-full px-2.5 py-1 text-xs transition-colors hover:bg-background/60 disabled:opacity-50 ${
          danger ? "text-error" : ""
        }`}
      >
        {label}
      </button>
    ));

  const count = orphans.length;
  return (
    <div
      role="status"
      className="fade-in mt-3 w-full max-w-xl rounded-xl border border-border bg-surface/90 px-4 py-2.5 text-sm text-on-surface shadow-paper"
    >
      <div className="flex items-center gap-3">
        <p className="flex-1">
          {count === 1
            ? "1 highlight was removed from ThreadNotes."
            : `${count} highlights were removed from ThreadNotes.`}
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-full px-2.5 py-1 font-medium text-accent transition-colors hover:bg-background/60"
        >
          {open ? "Hide" : "Review"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss for now"
          title="Dismiss for now"
          className="rounded-full p-1 text-on-surface-secondary transition-colors hover:text-on-surface"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          <p className="text-xs text-on-surface-secondary">
            &ldquo;Keep here only&rdquo; leaves the highlight in Marginalia; later
            edits to it won&apos;t go to ThreadNotes.
          </p>
          <ul className="flex flex-col gap-2">
            {orphans.map((h) => (
              <li key={h.id} className="flex flex-col gap-1">
                <span>
                  <span className="text-on-surface-secondary">p. {h.pageNumber} · </span>
                  &ldquo;{snippet(h.textContent)}&rdquo;
                </span>
                <div className="flex flex-wrap gap-1">{buttons([h.id])}</div>
              </li>
            ))}
          </ul>
          {count > 1 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
              <span className="mr-1 text-xs text-on-surface-secondary">For all {count}:</span>
              {buttons(orphans.map((h) => h.id))}
            </div>
          )}
          {error && <p className="text-xs text-error">{error}</p>}
        </div>
      )}
    </div>
  );
};
