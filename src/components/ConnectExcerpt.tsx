"use client";

import { useEffect, useState } from "react";

type Targets = {
  questions: { id: string; q: string; theme: string }[];
  articles: { id: string; title: string; year: number | null }[];
};

// Read as "this highlight … the target".
const RELATIONS = [
  { value: "connects_to", label: "connects to" },
  { value: "evidenced_by", label: "is evidenced by" },
  { value: "instance_of", label: "is an instance of" },
  { value: "tension_with", label: "is in tension with" },
  { value: "contradicts", label: "contradicts" },
] as const;

/**
 * Connects a highlight's ThreadNotes excerpt to a question or paper in its
 * project, with the reader's reason. Questions are offered first.
 */
export const ConnectExcerpt = ({
  highlightId,
  onClose,
}: {
  highlightId: string;
  onClose: () => void;
}): React.JSX.Element => {
  const [targets, setTargets] = useState<Targets | null>(null);
  const [target, setTarget] = useState("");
  const [relation, setRelation] = useState<string>(RELATIONS[0].value);
  const [because, setBecause] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/highlights/${highlightId}/connect`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        if (!cancelled) setTargets(body);
      })
      .catch((err) => {
        console.error("Loading connection targets failed:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load ThreadNotes.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [highlightId]);

  const connect = async () => {
    const [toType, toId] = target.split(":");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/highlights/${highlightId}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toType, toId, relation, because }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setDone(
        !body.created
          ? "Already connected in ThreadNotes."
          : body.questionStarted
            ? "Connected. The question is now Exploring."
            : "Connected in ThreadNotes.",
      );
    } catch (err) {
      console.error("Connecting highlight failed:", err);
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const empty = targets && targets.questions.length === 0 && targets.articles.length === 0;
  const fieldClass =
    "rounded-md border border-border bg-background p-1.5 text-sm text-foreground";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-on-surface-secondary">Connect in ThreadNotes</p>
      {done ? (
        <>
          <p className="text-sm">{done}</p>
          <button
            onClick={onClose}
            className="self-end rounded-full bg-accent-fill px-3 py-1 text-sm text-on-accent"
          >
            Done
          </button>
        </>
      ) : (
        <>
          {!targets && !error && <p className="text-sm text-secondary">Loading…</p>}
          {empty && (
            <p className="text-sm text-secondary">
              This ThreadNotes project has no questions or other papers to connect to yet.
            </p>
          )}
          {targets && !empty && (
            <>
              <label className="flex flex-col gap-1 text-xs text-on-surface-secondary">
                This highlight
                <select
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  className={fieldClass}
                >
                  {RELATIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="Connect to"
                className={fieldClass}
              >
                <option value="" disabled>
                  Choose a question or paper…
                </option>
                {targets.questions.length > 0 && (
                  <optgroup label="Questions">
                    {targets.questions.map((q) => (
                      <option key={q.id} value={`question:${q.id}`}>
                        {q.q}
                      </option>
                    ))}
                  </optgroup>
                )}
                {targets.articles.length > 0 && (
                  <optgroup label="Papers">
                    {targets.articles.map((a) => (
                      <option key={a.id} value={`article:${a.id}`}>
                        {a.year ? `${a.title} (${a.year})` : a.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <textarea
                value={because}
                onChange={(e) => setBecause(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && target && because.trim()) {
                    e.preventDefault();
                    void connect();
                  }
                }}
                rows={3}
                maxLength={2000}
                placeholder="Because… (in your own words)"
                aria-label="Because"
                className={`resize-y ${fieldClass}`}
              />
            </>
          )}
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="rounded-md px-2 py-1 text-sm hover:bg-surface">
              Cancel
            </button>
            {targets && !empty && (
              <button
                onClick={() => void connect()}
                disabled={busy || !target || !because.trim()}
                className="rounded-full bg-accent-fill px-3 py-1 text-sm text-on-accent disabled:opacity-50"
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
