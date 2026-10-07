"use client";

import Link from "next/link";
import { useState } from "react";
import type { ThreadNotesProject } from "@/lib/threadnotes";

export const ThreadNotesSettingsForm = ({
  initialConnected,
  initialProjects,
  initialProjectId,
  loadError,
}: {
  initialConnected: boolean;
  initialProjects: ThreadNotesProject[];
  initialProjectId: string | null;
  // Set when a key is saved but ThreadNotes couldn't list its projects.
  loadError: string | null;
}): React.JSX.Element => {
  const [connected, setConnected] = useState(initialConnected);
  const [projects, setProjects] = useState(initialProjects);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [pickedId, setPickedId] = useState(initialProjectId ?? "");
  const [keyDraft, setKeyDraft] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [notice, setNotice] = useState<string | null>(null);

  const put = async (body: object): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/threadnotes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Saving failed (${res.status})`);
      return data;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Saving failed — try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    const data = await put({ apiKey: keyDraft });
    if (!data) return;
    const list = (data.projects as ThreadNotesProject[]) ?? [];
    setConnected(true);
    setProjects(list);
    setProjectId(null);
    // Start the picker on ThreadNotes' active project.
    setPickedId(list.find((p) => p.active)?.id ?? list[0]?.id ?? "");
    setKeyDraft("");
    setReplacingKey(false);
    setNotice("Connected. Now pick the project to read from.");
  };

  const disconnect = async () => {
    if (!(await put({ apiKey: null }))) return;
    setConnected(false);
    setProjects([]);
    setProjectId(null);
    setPickedId("");
    setNotice("Disconnected. Your highlights stay here.");
  };

  const saveProject = async () => {
    if (!(await put({ projectId: pickedId }))) return;
    setProjectId(pickedId);
    setNotice("Saved.");
  };

  const keyForm = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="password"
        value={keyDraft}
        onChange={(e) => setKeyDraft(e.target.value)}
        placeholder="ThreadNotes API key"
        autoComplete="off"
        aria-label="ThreadNotes API key"
        className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-sm"
      />
      <button
        type="button"
        onClick={() => void connect()}
        disabled={!keyDraft.trim() || busy}
        className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
      >
        {busy ? "Checking…" : "Connect"}
      </button>
      {replacingKey && (
        <button
          type="button"
          onClick={() => {
            setReplacingKey(false);
            setKeyDraft("");
          }}
          className="rounded-full px-3 py-1.5 text-sm text-secondary hover:bg-surface"
        >
          Cancel
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-medium">ThreadNotes</h2>
      <p className="text-sm text-secondary">
        Open papers from your ThreadNotes library here. Each highlight is saved
        to ThreadNotes as an excerpt on that paper, with its page and margin
        note. Your key stays on Marginalia&apos;s server.
      </p>

      {!connected || replacingKey ? (
        keyForm
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="threadnotes-project" className="text-sm">
              Project
            </label>
            <select
              id="threadnotes-project"
              value={pickedId}
              onChange={(e) => {
                setPickedId(e.target.value);
                setNotice(null);
              }}
              disabled={projects.length === 0}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              {!pickedId && <option value="">Pick a project…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.articleCount})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void saveProject()}
              disabled={!pickedId || pickedId === projectId || busy}
              className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            >
              Use this project
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {projectId && (
              <Link href="/threadnotes" className="text-accent hover:underline">
                Open your papers
              </Link>
            )}
            <button
              type="button"
              onClick={() => setReplacingKey(true)}
              className="text-secondary hover:text-on-surface"
            >
              Replace key
            </button>
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={busy}
              className="text-secondary hover:text-error"
            >
              Disconnect
            </button>
          </div>
        </>
      )}

      {notice && <p className="text-sm text-secondary">{notice}</p>}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
