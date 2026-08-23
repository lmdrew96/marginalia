"use client";

import { useEffect, useRef, useState } from "react";
import type { Highlight, Bookmark, ChatMessage } from "@/db/schema";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_STYLES,
  type HighlightColor,
} from "@/lib/highlight-types";
import {
  getOffsetInRoot,
  findRangeForOffsets,
  wrapRangeInMark,
  unwrapMark,
  getTopVisibleOffset,
} from "@/lib/dom-offset";
import { ChatSidebar } from "@/components/ChatSidebar";
import { BookmarkIcon, ChatIcon } from "@/components/icons";

function applyHighlightToDom(root: HTMLElement, highlight: Highlight) {
  const range = findRangeForOffsets(
    root,
    highlight.startOffset,
    highlight.endOffset,
  );
  if (!range) return;
  wrapRangeInMark(
    range,
    HIGHLIGHT_COLOR_STYLES[highlight.color as HighlightColor] ??
      HIGHLIGHT_COLOR_STYLES.yellow,
    highlight.id,
  );
}

export function DocumentReader({
  documentId,
  content,
  initialHighlights,
  initialBookmarks,
  initialChatMessages,
}: {
  documentId: string;
  content: string;
  initialHighlights: Highlight[];
  initialBookmarks: Bookmark[];
  initialChatMessages: ChatMessage[];
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [color, setColor] = useState<HighlightColor>("yellow");
  const [highlights, setHighlights] = useState<Highlight[]>(initialHighlights);
  const [bookmark, setBookmark] = useState<Bookmark | null>(
    initialBookmarks[0] ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [htmlContent, setHtmlContent] = useState(content);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const pendingOcrCount = (htmlContent.match(/data-ocr="pending"/g) ?? [])
    .length;

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    root.innerHTML = htmlContent;
    for (const highlight of initialHighlights) {
      applyHighlightToDom(root, highlight);
    }
    // Only re-run if the document itself changes — this effect owns the
    // subtree imperatively from here on, React must never re-render it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, htmlContent]);

  async function runOcr() {
    setOcrRunning(true);
    setOcrError(null);
    try {
      // The endpoint caps how many pages it OCRs per call so one request
      // can't run past the function's time limit — loop until nothing's
      // left pending or a call fails.
      for (;;) {
        const res = await fetch(`/api/documents/${documentId}/ocr`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "OCR failed");
        setHtmlContent(data.content);
        // ocred === 0 means this pass made no progress (every remaining
        // page failed) — stop instead of retrying the same failures forever.
        if (data.remaining <= 0 || data.ocred === 0) {
          if (data.remaining > 0) {
            setOcrError(
              `${data.remaining} page(s) couldn't be transcribed — try again later.`,
            );
          }
          break;
        }
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "OCR failed");
    } finally {
      setOcrRunning(false);
    }
  }

  async function handleMouseUp() {
    const selection = window.getSelection();
    const root = contentRef.current;
    if (!selection || selection.isCollapsed || !root) return;
    if (!root.contains(selection.anchorNode)) return;

    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    const startOffset = getOffsetInRoot(
      root,
      range.startContainer,
      range.startOffset,
    );
    const endOffset = getOffsetInRoot(root, range.endContainer, range.endOffset);
    selection.removeAllRanges();
    if (endOffset <= startOffset) return;

    const res = await fetch(`/api/documents/${documentId}/highlights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startOffset,
        endOffset,
        textContent: text,
        color,
      }),
    });
    if (!res.ok) return;
    const highlight: Highlight = await res.json();
    setHighlights((prev) => [...prev, highlight]);
    applyHighlightToDom(root, highlight);
  }

  async function deleteHighlight(id: string) {
    const root = contentRef.current;
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    const mark = root?.querySelector<HTMLElement>(
      `mark[data-highlight-id="${id}"]`,
    );
    if (mark) unwrapMark(mark);
    await fetch(`/api/highlights/${id}`, { method: "DELETE" });
  }

  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const mark = (e.target as HTMLElement).closest("mark[data-highlight-id]");
    const id = mark?.getAttribute("data-highlight-id");
    if (id) deleteHighlight(id);
  }

  async function saveBookmarkHere() {
    const root = contentRef.current;
    if (!root) return;
    const offset = getTopVisibleOffset(root);
    if (offset === null) return;

    const res = await fetch(`/api/documents/${documentId}/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset }),
    });
    if (res.ok) {
      const saved: Bookmark = await res.json();
      setBookmark(saved);
    }
  }

  function goToBookmark() {
    const root = contentRef.current;
    if (!root || !bookmark) return;
    const range = findRangeForOffsets(root, bookmark.offset, bookmark.offset);
    const el =
      range?.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range?.startContainer as HTMLElement | null);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  if (error) {
    return <p className="p-8 text-error">{error}</p>;
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-4 py-8">
      <div className="flex flex-wrap items-center justify-center gap-4">
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
          <button
            onClick={goToBookmark}
            className="rounded-md border border-border px-3 py-1.5"
          >
            Go to bookmark
          </button>
        )}

        <button
          onClick={() => setChatOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5"
        >
          {!chatOpen && <ChatIcon className="h-4 w-4" />}
          {chatOpen ? "Close chat" : "Ask Claude"}
        </button>

        {pendingOcrCount > 0 && (
          <button
            onClick={runOcr}
            disabled={ocrRunning}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
          >
            {ocrRunning
              ? "Scanning pages…"
              : `Run OCR (${pendingOcrCount} page${pendingOcrCount === 1 ? "" : "s"})`}
          </button>
        )}
      </div>

      {ocrError && <p className="text-sm text-error">{ocrError}</p>}

      <div className="flex w-full flex-1 justify-center gap-4 overflow-hidden">
        <div
          ref={contentRef}
          onMouseUp={handleMouseUp}
          onClick={handleContentClick}
          className="w-full max-w-3xl leading-relaxed [&_h1]:mb-4 [&_h1]:mt-8 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:mb-4 [&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md"
        />

        <ChatSidebar
          documentId={documentId}
          highlights={highlights}
          initialMessages={initialChatMessages}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      </div>
    </div>
  );
}
