"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DOCX_MIME } from "@/lib/convert/docx";
import { UploadIcon } from "@/components/icons";

export function UploadDocument({
  threadnotesArticleId,
  label = "Upload a PDF or Word file",
}: {
  // Links the upload to this ThreadNotes paper (its title replaces the
  // file name).
  threadnotesArticleId?: string;
  label?: string;
} = {}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "converting" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [isWord, setIsWord] = useState(false);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setIsWord(/\.docx$/i.test(file.name));
    // Some browsers leave .docx files without a type; the server checks
    // the extension and type agree, so fill it in.
    const contentType =
      file.type || (/\.docx$/i.test(file.name) ? DOCX_MIME : "");

    try {
      const urlRes = await fetch("/api/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType,
        }),
      });
      if (!urlRes.ok) throw new Error((await urlRes.json()).error);
      const { uploadUrl, key } = await urlRes.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      setStatus("converting");
      const docRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: file.name.replace(/\.(pdf|docx)$/i, ""),
          key,
          threadnotesArticleId,
        }),
      });
      if (!docRes.ok) throw new Error((await docRes.json()).error);
      const doc = await docRes.json();

      router.push(`/read/${doc.id}`);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Upload failed");
      return;
    }
    setStatus("idle");
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={`application/pdf,.docx,${DOCX_MIME}`}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === "uploading" || status === "converting"}
        className="flex items-center gap-2 rounded-full bg-accent-fill px-5 py-2.5 font-medium text-on-accent shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <UploadIcon className="h-4 w-4" />
        {status === "uploading"
          ? "Uploading…"
          : status === "converting"
            ? "Converting…"
            : label}
      </button>
      {status === "converting" && (
        <p className="fade-in text-xs text-secondary">
          {isWord
            ? "Turning your Word file into a PDF — the first one in a while can take up to half a minute."
            : "Reading the text — this can take a bit for longer PDFs."}
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
