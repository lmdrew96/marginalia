"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@/components/icons";

export function DeleteDocumentButton({
  documentId,
  title,
}: {
  documentId: string;
  title: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${title}"? This can't be undone.`)) return;

    setDeleting(true);
    const res = await fetch(`/api/documents/${documentId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.refresh();
    } else {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      aria-label={`Delete ${title}`}
      className="rounded-md p-1.5 text-secondary hover:bg-surface hover:text-on-surface disabled:opacity-50"
    >
      <TrashIcon className="h-4 w-4" />
    </button>
  );
}
