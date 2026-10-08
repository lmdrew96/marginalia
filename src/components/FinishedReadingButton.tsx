"use client";

import { useEffect, useState } from "react";
import type { ArticleStatus } from "@/lib/threadnotes";

/**
 * Marks a ThreadNotes paper finished (status "done" in ThreadNotes), with
 * an undo. Shows nothing until the current status has loaded.
 */
export const FinishedReadingButton = ({
  documentId,
  onError,
}: {
  documentId: string;
  onError: (message: string | null) => void;
}): React.JSX.Element | null => {
  const [status, setStatus] = useState<ArticleStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [justFinished, setJustFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}/threadnotes-status`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `status ${res.status}`);
        if (!cancelled) setStatus(body.status);
      })
      .catch((err) => console.error("Loading ThreadNotes status failed:", err));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!justFinished) return;
    const timer = setTimeout(() => setJustFinished(false), 4000);
    return () => clearTimeout(timer);
  }, [justFinished]);

  const save = async (next: "done" | "reading") => {
    setSaving(true);
    onError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/threadnotes-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Saving status failed (${res.status})`);
      setStatus(next);
      setJustFinished(next === "done");
    } catch (err) {
      console.error(err);
      onError(err instanceof Error ? err.message : "Couldn't update ThreadNotes — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (status === null) return null;

  if (status === "done") {
    return (
      <div className="flex items-stretch rounded-full bg-background/40">
        <span className="px-3 py-1.5 text-on-surface-secondary" role="status">
          {justFinished ? "Marked done in ThreadNotes ✓" : "Finished ✓"}
        </span>
        <button
          onClick={() => void save("reading")}
          disabled={saving}
          title="Mark it as still reading"
          className="rounded-r-full px-3 py-1.5 transition-colors hover:bg-background/60 disabled:opacity-50"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => void save("done")}
      disabled={saving}
      className="rounded-full px-3 py-1.5 transition-colors hover:bg-background/60 disabled:opacity-50"
    >
      {saving ? "Saving…" : "Finished reading"}
    </button>
  );
};
