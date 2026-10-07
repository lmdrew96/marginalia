"use client";

import { useState } from "react";

export const ClaudeInstructionsForm = ({
  initial,
  maxLength,
}: {
  initial: string;
  maxLength: number;
}): React.JSX.Element => {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setStatus("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claudeInstructions: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Saving failed (${res.status})`);
      setSaved(body.claudeInstructions);
      setDraft(body.claudeInstructions);
      setStatus("saved");
    } catch (err) {
      console.error(err);
      setError("Couldn't save your instructions — try again.");
      setStatus("idle");
    }
  };

  const dirty = draft !== saved;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor="claude-instructions" className="font-medium">
        Claude Instructions
      </label>
      <p className="text-sm text-secondary">
        Sent to Claude with your chat messages and quizzes. Use it for things
        like how you like explanations pitched, your course or field, or
        answer length. Leave it empty for Claude&apos;s default behavior.
      </p>
      <textarea
        id="claude-instructions"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setStatus("idle");
        }}
        maxLength={maxLength}
        rows={8}
        placeholder="e.g. I'm a second-year psych student. Explain with everyday examples and keep answers short."
        className="resize-y rounded-md border border-border bg-transparent p-3 text-sm"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || status === "saving"}
          className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && !dirty && (
          <span className="text-sm text-secondary">Saved.</span>
        )}
        <span className="ml-auto text-xs tabular-nums text-secondary">
          {draft.length}/{maxLength}
        </span>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </form>
  );
};
