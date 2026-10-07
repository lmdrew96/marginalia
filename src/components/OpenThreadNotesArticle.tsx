"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UploadDocument } from "@/components/UploadDocument";

/**
 * Opens a ThreadNotes paper in the reader. When its PDF can't be fetched,
 * swaps to an upload button that links the uploaded file to the paper.
 */
export const OpenThreadNotesArticle = ({
  articleId,
  opened,
}: {
  articleId: string;
  // Already a document here, so this just goes back to it.
  opened: boolean;
}): React.JSX.Element => {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "opening" | "needsUpload">("idle");
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setStatus("opening");
    setError(null);
    try {
      const res = await fetch(`/api/threadnotes/articles/${articleId}/open`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (body.needsUpload) {
        setStatus("needsUpload");
        return;
      }
      if (!res.ok) throw new Error(body.error ?? `Opening failed (${res.status})`);
      router.push(`/read/${body.documentId}`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Opening failed — try again.");
      setStatus("idle");
    }
  };

  if (status === "needsUpload") {
    return (
      <div className="flex flex-col items-end gap-1 text-right">
        <p className="text-xs text-secondary">
          No PDF to fetch for this one. Upload your copy:
        </p>
        <UploadDocument threadnotesArticleId={articleId} label="Upload PDF" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void open()}
        disabled={status === "opening"}
        className="rounded-full bg-accent-fill px-4 py-1.5 text-sm font-medium text-on-accent shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === "opening"
          ? opened
            ? "Opening…"
            : "Fetching PDF…"
          : opened
            ? "Continue reading"
            : "Open"}
      </button>
      {error && <p className="max-w-56 text-right text-xs text-error">{error}</p>}
    </div>
  );
};
