"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight, Bookmark, ChatMessage, PageOcr } from "@/db/schema";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_STYLES,
  type HighlightColor,
  type OcrWord,
} from "@/lib/highlight-types";
import { getOffsetInRoot } from "@/lib/dom-offset";
import { ocrPages } from "@/lib/ocr";
import { ChatSidebar } from "@/components/ChatSidebar";
import { PdfPage } from "@/components/PdfPage";
import { BookmarkIcon, ChatIcon, CloseIcon } from "@/components/icons";

type PdfJs = typeof import("pdfjs-dist");
type PageSize = { width: number; height: number };

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;
// Fit-to-width stops here so a wide window doesn't blow a page up to
// poster size.
const MAX_FIT_SCALE = 1.5;
const COLUMN_PADDING_PX = 32;
// Room to the right of each page for margin notes (a 224px note column plus
// a gap). Below this column width the margin is dropped so the page stays
// readable; commented highlights still show their marker.
const MARGIN_GUTTER_PX = 240;
const MIN_COLUMN_FOR_MARGIN_PX = 640;

export function DocumentReader({
  documentId,
  fileUrl,
  initialHighlights,
  initialBookmarks,
  initialChatMessages,
  initialOcrPages,
}: {
  documentId: string;
  fileUrl: string;
  initialHighlights: Highlight[];
  initialBookmarks: Bookmark[];
  initialChatMessages: ChatMessage[];
  initialOcrPages: PageOcr[];
}) {
  const columnRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Page + how far down it the reader was, captured before a zoom so the
  // same spot can be scrolled back into place after pages resize.
  const zoomAnchorRef = useRef<{ page: number; fraction: number } | null>(
    null,
  );

  const [pdfjs, setPdfjs] = useState<PdfJs | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  // Pages whose PDF has no text at all — scans or flattened exports.
  const [textlessPages, setTextlessPages] = useState<number[] | null>(null);
  const [columnWidth, setColumnWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit width
  const [color, setColor] = useState<HighlightColor>("yellow");
  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights);
  const [bookmark, setBookmark] = useState<Bookmark | null>(
    initialBookmarks[0] ?? null,
  );
  const [ocrWords, setOcrWords] = useState<Record<number, OcrWord[]>>(() =>
    Object.fromEntries(initialOcrPages.map((p) => [p.pageNumber, p.words])),
  );
  const [ocrProgress, setOcrProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const showMargin =
    columnWidth >= MIN_COLUMN_FOR_MARGIN_PX && highlights.some((h) => h.comment);
  const marginWidth = showMargin ? MARGIN_GUTTER_PX : 0;
  const widestPage = Math.max(0, ...pageSizes.map((s) => s.width));
  const fitScale =
    columnWidth > 0 && widestPage > 0
      ? Math.min(
          MAX_FIT_SCALE,
          Math.max(
            MIN_SCALE,
            (columnWidth - COLUMN_PADDING_PX - marginWidth) / widestPage,
          ),
        )
      : 1;
  const scale = zoom ?? fitScale;

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<PdfJs["getDocument"]> | null = null;
    (async () => {
      // Dynamic import: pdfjs-dist evaluates `new DOMMatrix()` at module
      // load, which crashes the server render of this client component.
      const lib = await import("pdfjs-dist");
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      loadingTask = lib.getDocument({ url: fileUrl });
      const doc = await loadingTask.promise;
      if (cancelled) return;

      const sizes: PageSize[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const { width, height } = (await doc.getPage(n)).getViewport({
          scale: 1,
        });
        sizes.push({ width, height });
      }
      if (cancelled) return;
      setPdfjs(lib);
      setPdf(doc);
      setPageSizes(sizes);

      const textless: number[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const { items } = await (await doc.getPage(n)).getTextContent();
        if (cancelled) return;
        if (!items.some((item) => "str" in item && item.str.trim())) {
          textless.push(n);
        }
      }
      setTextlessPages(textless);
    })().catch((err) => {
      if (cancelled) return;
      console.error("Failed to load PDF:", err);
      setError("Couldn't load this PDF.");
    });
    return () => {
      cancelled = true;
      loadingTask
        ?.destroy()
        .catch((err: unknown) => console.error("PDF cleanup failed:", err));
    };
  }, [fileUrl]);

  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const observer = new ResizeObserver(() =>
      setColumnWidth(column.clientWidth),
    );
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  const toolbarBottom = () =>
    toolbarRef.current?.getBoundingClientRect().bottom ?? 0;

  const pageElement = (n: number) =>
    columnRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${n}"]`,
    ) ?? null;

  /** The page at the top of the reading area, under the sticky toolbar. */
  const topVisiblePage = (): { page: number; el: HTMLElement } | null => {
    const top = toolbarBottom();
    const pages =
      columnRef.current?.querySelectorAll<HTMLElement>("[data-page-number]") ??
      [];
    for (const el of pages) {
      if (el.getBoundingClientRect().bottom > top) {
        return { page: Number(el.dataset.pageNumber), el };
      }
    }
    return null;
  };

  const zoomTo = (next: number | null) => {
    const top = topVisiblePage();
    if (top) {
      const box = top.el.getBoundingClientRect();
      zoomAnchorRef.current = {
        page: top.page,
        fraction: (toolbarBottom() - box.top) / box.height,
      };
    }
    setZoom(
      next === null ? null : Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)),
    );
  };

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    zoomAnchorRef.current = null;
    const el = pageElement(anchor.page);
    if (!el) return;
    const box = el.getBoundingClientRect();
    window.scrollBy(0, box.top + anchor.fraction * box.height - toolbarBottom());
  }, [scale]);

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) {
      map.set(h.pageNumber, [...(map.get(h.pageNumber) ?? []), h]);
    }
    return map;
  }, [highlights]);

  async function handleMouseUp(e: React.MouseEvent) {
    // Selecting text in the comment editor isn't a highlight.
    if ((e.target as Element).closest("[data-no-highlight]")) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const startNode = range.startContainer;
    const startEl =
      startNode instanceof Element ? startNode : startNode.parentElement;
    const pageEl = startEl?.closest<HTMLElement>("[data-page-number]");
    if (!pageEl || !columnRef.current?.contains(pageEl)) return;
    const layer = pageEl.querySelector<HTMLElement>(".textLayer");
    if (!layer) return;

    // A selection that runs onto the next page is cut at the end of the
    // page it started on — a highlight belongs to exactly one page.
    const start = getOffsetInRoot(layer, range.startContainer, range.startOffset);
    const end = getOffsetInRoot(layer, range.endContainer, range.endOffset);
    const text = (layer.textContent ?? "")
      .slice(start, end)
      .replace(/\s+/g, " ")
      .trim();
    if (end <= start || !text) return;
    selection.removeAllRanges();

    setActionError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/highlights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageNumber: Number(pageEl.dataset.pageNumber),
          pageStartOffset: start,
          pageEndOffset: end,
          textContent: text,
          color,
        }),
      });
      if (!res.ok) throw new Error(`Saving highlight failed (${res.status})`);
      const highlight: Highlight = await res.json();
      setHighlights((prev) => [...prev, highlight]);
    } catch (err) {
      console.error(err);
      setActionError("Couldn't save that highlight — try again.");
    }
  }

  async function deleteHighlight(id: string) {
    const removed = highlights.find((h) => h.id === id);
    if (!removed) return;
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    setActionError(null);
    try {
      const res = await fetch(`/api/highlights/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Deleting highlight failed (${res.status})`);
    } catch (err) {
      console.error(err);
      setHighlights((prev) => [...prev, removed]);
      setActionError("Couldn't remove that highlight — try again.");
    }
  }

  async function changeHighlightColor(id: string, next: HighlightColor) {
    const previous = highlights.find((h) => h.id === id)?.color;
    if (!previous) return;
    const setColorOf = (c: string) =>
      setHighlights((prev) =>
        prev.map((h) => (h.id === id ? { ...h, color: c } : h)),
      );
    setColorOf(next);
    setActionError(null);
    try {
      const res = await fetch(`/api/highlights/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: next }),
      });
      if (!res.ok) throw new Error(`Recoloring highlight failed (${res.status})`);
    } catch (err) {
      console.error(err);
      setColorOf(previous);
      setActionError("Couldn't change that highlight's color — try again.");
    }
  }

  async function changeHighlightComment(
    id: string,
    comment: string | null,
  ): Promise<boolean> {
    setActionError(null);
    try {
      const res = await fetch(`/api/highlights/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error(`Saving comment failed (${res.status})`);
      const updated: Highlight = await res.json();
      setHighlights((prev) =>
        prev.map((h) => (h.id === id ? { ...h, comment: updated.comment } : h)),
      );
      return true;
    } catch (err) {
      console.error(err);
      setActionError("Couldn't save that comment — try again.");
      return false;
    }
  }

  async function saveBookmarkHere() {
    const top = topVisiblePage();
    if (!top) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageNumber: top.page }),
      });
      if (!res.ok) throw new Error(`Saving bookmark failed (${res.status})`);
      setBookmark(await res.json());
    } catch (err) {
      console.error(err);
      setActionError("Couldn't save the bookmark — try again.");
    }
  }

  async function removeBookmark() {
    const removed = bookmark;
    if (!removed) return;
    setBookmark(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/bookmarks/${removed.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Removing bookmark failed (${res.status})`);
    } catch (err) {
      console.error(err);
      setBookmark(removed);
      setActionError("Couldn't remove the bookmark — try again.");
    }
  }

  function scrollToPage(pageNumber: number) {
    const el = pageElement(pageNumber);
    if (!el) return;
    window.scrollBy({
      top: el.getBoundingClientRect().top - toolbarBottom(),
      behavior: "smooth",
    });
  }

  const pendingOcrPages = (textlessPages ?? []).filter((n) => !(n in ocrWords));

  async function runOcr() {
    if (!pdf || pendingOcrPages.length === 0) return;
    setOcrError(null);
    setOcrProgress({ done: 0, total: pendingOcrPages.length });
    try {
      await ocrPages(pdf, pendingOcrPages, async (pageNumber, words) => {
        const res = await fetch(`/api/documents/${documentId}/ocr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageNumber, words }),
        });
        if (!res.ok) throw new Error(`Saving OCR failed (${res.status})`);
        setOcrWords((prev) => ({ ...prev, [pageNumber]: words }));
        setOcrProgress((p) => p && { ...p, done: p.done + 1 });
      });
    } catch (err) {
      console.error("OCR failed:", err);
      setOcrError(
        "Couldn't finish reading the scanned pages — run it again to pick up where it stopped.",
      );
    } finally {
      setOcrProgress(null);
    }
  }

  if (error) {
    return <p className="p-8 text-error">{error}</p>;
  }

  return (
    <div className="flex flex-1 flex-col items-center">
      <div
        ref={toolbarRef}
        className="sticky top-0 z-10 flex w-full flex-wrap items-center justify-center gap-4 border-b border-border bg-background px-4 py-3"
      >
        <div className="flex items-center gap-1">
          <button
            onClick={() => zoomTo(scale / ZOOM_STEP)}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            className="h-8 w-8 rounded-md border border-border disabled:opacity-40"
          >
            −
          </button>
          <button
            onClick={() => zoomTo(null)}
            title="Fit to width"
            className="min-w-16 rounded-md border border-border px-2 py-1.5 text-sm tabular-nums"
          >
            {zoom === null ? "Fit" : `${Math.round(scale * 100)}%`}
          </button>
          <button
            onClick={() => zoomTo(scale * ZOOM_STEP)}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            className="h-8 w-8 rounded-md border border-border disabled:opacity-40"
          >
            +
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
          onClick={saveBookmarkHere}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5"
        >
          <BookmarkIcon filled={!!bookmark} className="h-4 w-4" />
          Bookmark here
        </button>

        {bookmark && (
          <div className="flex items-stretch rounded-md border border-border">
            <button
              onClick={() => scrollToPage(bookmark.pageNumber)}
              className="px-3 py-1.5"
            >
              Go to bookmark (p. {bookmark.pageNumber})
            </button>
            <button
              onClick={removeBookmark}
              aria-label="Remove bookmark"
              title="Remove bookmark"
              className="border-l border-border px-2 text-secondary hover:text-error"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <button
          onClick={() => setChatOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5"
        >
          {!chatOpen && <ChatIcon className="h-4 w-4" />}
          {chatOpen ? "Close chat" : "Ask Claude"}
        </button>

        {(pendingOcrPages.length > 0 || ocrProgress) && (
          <button
            onClick={runOcr}
            disabled={!!ocrProgress}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
          >
            {ocrProgress
              ? `Reading scanned pages… ${ocrProgress.done}/${ocrProgress.total}`
              : `Make scanned pages selectable (${pendingOcrPages.length})`}
          </button>
        )}
      </div>

      {(ocrError || actionError) && (
        <p className="pt-3 text-sm text-error">{ocrError ?? actionError}</p>
      )}

      <div className="flex w-full flex-1 justify-center gap-4 overflow-hidden">
        <div
          ref={columnRef}
          onMouseUp={handleMouseUp}
          className="flex min-w-0 flex-1 flex-col gap-6 overflow-x-auto px-4 py-8"
        >
          {!pdf || !pdfjs ? (
            <p className="text-center text-secondary">Loading document…</p>
          ) : (
            pageSizes.map((size, i) => (
              <PdfPage
                key={i + 1}
                pdf={pdf}
                pdfjs={pdfjs}
                pageNumber={i + 1}
                baseWidth={size.width}
                baseHeight={size.height}
                scale={scale}
                highlights={highlightsByPage.get(i + 1) ?? NO_HIGHLIGHTS}
                ocrWords={ocrWords[i + 1]}
                marginWidth={marginWidth}
                onHighlightColorChange={changeHighlightColor}
                onHighlightCommentChange={changeHighlightComment}
                onHighlightDelete={deleteHighlight}
              />
            ))
          )}
        </div>

        <ChatSidebar
          documentId={documentId}
          highlights={highlights}
          initialMessages={initialChatMessages}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          pageCount={pageSizes.length}
          onJumpToPage={scrollToPage}
        />
      </div>
    </div>
  );
}

// Shared empty array so pages without highlights keep a stable prop and
// don't re-measure on every highlight change elsewhere in the document.
const NO_HIGHLIGHTS: Highlight[] = [];
