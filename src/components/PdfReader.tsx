"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import type { Highlight, Bookmark } from "@/db/schema";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_STYLES,
  type HighlightColor,
  type PositionAnchor,
} from "@/lib/highlight-types";

GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export function PdfReader({
  documentId,
  fileUrl,
  initialHighlights,
  initialBookmarks,
}: {
  documentId: string;
  fileUrl: string;
  initialHighlights: Highlight[];
  initialBookmarks: Bookmark[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [color, setColor] = useState<HighlightColor>("yellow");
  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDocument({ url: fileUrl })
      .promise.then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      })
      .catch(() => !cancelled && setError("Couldn't load this PDF."));
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;
    let cancelled = false;
    let renderTask: ReturnType<
      import("pdfjs-dist").PDFPageProxy["render"]
    > | null = null;

    (async () => {
      const page = await pdfDoc.getPage(currentPage);
      if (cancelled) return;

      const containerWidth = containerRef.current?.clientWidth ?? 800;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(containerWidth / baseViewport.width, 1.5);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      renderTask = page.render({ canvasContext: ctx, viewport, canvas });
      await renderTask.promise;
      if (cancelled) return;

      const textLayerDiv = textLayerRef.current!;
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      if (cancelled) return;
      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();
    })().catch(() => !cancelled && setError("Couldn't render this page."));

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, currentPage]);

  const handleMouseUp = useCallback(async () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !textLayerRef.current) return;

    const text = selection.toString().trim();
    if (!text) return;

    const anchorInLayer = textLayerRef.current.contains(
      selection.anchorNode,
    );
    if (!anchorInLayer) return;

    const containerRect = textLayerRef.current.getBoundingClientRect();
    const range = selection.getRangeAt(0);
    const clientRects = Array.from(range.getClientRects());

    const rects = clientRects
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        xFrac: (r.left - containerRect.left) / containerRect.width,
        yFrac: (r.top - containerRect.top) / containerRect.height,
        wFrac: r.width / containerRect.width,
        hFrac: r.height / containerRect.height,
      }));

    if (rects.length === 0) return;

    const positionAnchor: PositionAnchor = { rects };
    selection.removeAllRanges();

    const res = await fetch(`/api/documents/${documentId}/highlights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageNumber: currentPage,
        textContent: text,
        positionAnchor,
        color,
      }),
    });
    if (res.ok) {
      const highlight = await res.json();
      setHighlights((prev) => [...prev, highlight]);
    }
  }, [documentId, currentPage, color]);

  async function deleteHighlight(id: string) {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    await fetch(`/api/highlights/${id}`, { method: "DELETE" });
  }

  const currentBookmark = bookmarks.find((b) => b.pageNumber === currentPage);

  async function toggleBookmark() {
    if (currentBookmark) {
      setBookmarks((prev) => prev.filter((b) => b.id !== currentBookmark.id));
      await fetch(`/api/bookmarks/${currentBookmark.id}`, {
        method: "DELETE",
      });
      return;
    }
    const res = await fetch(`/api/documents/${documentId}/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageNumber: currentPage }),
    });
    if (res.ok) {
      const bookmark = await res.json();
      setBookmarks((prev) => [...prev, bookmark]);
    }
  }

  if (error) {
    return <p className="p-8 text-red-600">{error}</p>;
  }

  const pageHighlights = highlights.filter(
    (h) => h.pageNumber === currentPage,
  );

  return (
    <div className="flex flex-1 flex-col items-center gap-4 py-8">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Prev
          </button>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Page {currentPage} of {numPages || "…"}
          </span>
          <button
            onClick={() =>
              setCurrentPage((p) => Math.min(numPages, p + 1))
            }
            disabled={currentPage >= numPages}
            className="rounded-md border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-1">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Highlight color ${c}`}
              className="h-6 w-6 rounded-full border-2"
              style={{
                backgroundColor: HIGHLIGHT_COLOR_STYLES[c],
                borderColor: c === color ? "currentColor" : "transparent",
              }}
            />
          ))}
        </div>

        <button
          onClick={toggleBookmark}
          className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
        >
          {currentBookmark ? "★ Bookmarked" : "☆ Bookmark this page"}
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative w-full max-w-3xl"
        onMouseUp={handleMouseUp}
      >
        <canvas ref={canvasRef} className="mx-auto block" />
        <div
          ref={textLayerRef}
          className="textLayer absolute left-1/2 top-0 -translate-x-1/2"
        />
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
          {pageHighlights.map((h) => {
            const anchor = h.positionAnchor as PositionAnchor;
            return anchor.rects.map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                className="pointer-events-auto absolute cursor-pointer"
                title="Click to remove highlight"
                onClick={() => deleteHighlight(h.id)}
                style={{
                  left: `${r.xFrac * 100}%`,
                  top: `${r.yFrac * 100}%`,
                  width: `${r.wFrac * 100}%`,
                  height: `${r.hFrac * 100}%`,
                  backgroundColor:
                    HIGHLIGHT_COLOR_STYLES[h.color as HighlightColor] ??
                    HIGHLIGHT_COLOR_STYLES.yellow,
                }}
              />
            ));
          })}
        </div>
      </div>
    </div>
  );
}
