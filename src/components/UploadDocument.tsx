"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function UploadDocument() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    "idle" | "uploading" | "converting" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);

    try {
      const urlRes = await fetch("/api/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
        }),
      });
      if (!urlRes.ok) throw new Error((await urlRes.json()).error);
      const { uploadUrl, key } = await urlRes.json();

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed");

      setStatus("converting");
      const docRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name.replace(/\.pdf$/i, ""), key }),
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
        accept="application/pdf"
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
        className="rounded-full bg-foreground px-5 py-2.5 font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === "uploading"
          ? "Uploading…"
          : status === "converting"
            ? "Converting…"
            : "Upload a PDF"}
      </button>
      {status === "converting" && (
        <p className="text-xs text-secondary">
          Extracting text and images — this can take a bit for longer PDFs.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
