"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ThreadNotesProject } from "@/lib/threadnotes";

/**
 * Picks the ThreadNotes project the Papers page reads from. Choosing one
 * saves it right away and reloads the list.
 */
export const ThreadNotesProjectPicker = ({
  projects,
  currentId,
}: {
  projects: ThreadNotesProject[];
  currentId: string | null;
}): React.JSX.Element => {
  const router = useRouter();
  const [pickedId, setPickedId] = useState(currentId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (id: string) => {
    const previous = pickedId;
    setPickedId(id);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/threadnotes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Switching failed (${res.status})`);
      router.refresh();
    } catch (err) {
      console.error(err);
      setPickedId(previous);
      setError(err instanceof Error ? err.message : "Switching failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="threadnotes-project" className="text-sm text-secondary">
          Project
        </label>
        <select
          id="threadnotes-project"
          value={pickedId}
          onChange={(e) => void choose(e.target.value)}
          disabled={busy || projects.length === 0}
          className="min-w-0 max-w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {!pickedId && <option value="">Pick a project…</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.articleCount})
            </option>
          ))}
        </select>
        {busy && <span className="text-sm text-secondary">Switching…</span>}
      </div>
      {projects.length === 0 && (
        <p className="text-sm text-secondary">
          You don&apos;t have any projects in ThreadNotes yet.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
