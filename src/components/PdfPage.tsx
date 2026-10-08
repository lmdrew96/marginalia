"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight } from "@/db/schema";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_STYLES,
  type HighlightColor,
  type OcrWord,
} from "@/lib/highlight-types";
import { findRangeForOffsets } from "@/lib/dom-offset";
import { ChatIcon } from "@/components/icons";
import { MarginNotes, type MarginNote } from "@/components/MarginNotes";

type PdfJs = typeof import("pdfjs-dist");

// Rects as fractions of the page box, so they don't depend on zoom.
type Rect = { x: number; y: number; w: number; h: number };

// Browsers refuse (or silently blank) canvases past roughly this many
// pixels — at high zoom on a high-DPI screen, drop the pixel ratio instead.
const MAX_CANVAS_PIXELS = 16_777_216;
// Render pages a little before they scroll into view, and drop their
// canvases once they're well out of it, so long documents stay light.
const VISIBILITY_MARGIN = "1200px 0px";

let measureCtx: CanvasRenderingContext2D | null = null;
const measureTextWidth = (text: string, fontSize: number): number => {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return 0;
  measureCtx.font = `${fontSize}px sans-serif`;
  return measureCtx.measureText(text).width;
};

/**
 * One line of a highlight comes back from getClientRects() as several
 * boxes (one per pdf.js span, at slightly different heights), and the
 * boxes of neighbouring lines can overlap. Translucent boxes stack darker
 * wherever they overlap, so: group the boxes into lines, merge each line
 * left to right into one band, and split any overlap between lines down
 * the middle.
 */
const mergeLineRects = (rects: Rect[]): Rect[] => {
  const center = (r: Rect) => r.y + r.h / 2;
  const lines: { top: number; bottom: number; rects: Rect[] }[] = [];
  for (const r of [...rects].sort((a, b) => center(a) - center(b))) {
    const line = lines[lines.length - 1];
    if (line && center(r) <= line.bottom) {
      line.top = Math.min(line.top, r.y);
      line.bottom = Math.max(line.bottom, r.y + r.h);
      line.rects.push(r);
    } else {
      lines.push({ top: r.y, bottom: r.y + r.h, rects: [r] });
    }
  }
  for (let i = 1; i < lines.length; i++) {
    const above = lines[i - 1];
    const below = lines[i];
    if (above.bottom > below.top) {
      const middle = (above.bottom + below.top) / 2;
      above.bottom = middle;
      below.top = middle;
    }
  }

  const merged: Rect[] = [];
  for (const line of lines) {
    const runs: { left: number; right: number }[] = [];
    for (const r of [...line.rects].sort((a, b) => a.x - b.x)) {
      const last = runs[runs.length - 1];
      if (last && r.x <= last.right + 0.005) {
        last.right = Math.max(last.right, r.x + r.w);
      } else {
        runs.push({ left: r.x, right: r.x + r.w });
      }
    }
    for (const run of runs) {
      merged.push({
        x: run.left,
        y: line.top,
        w: run.right - run.left,
        h: line.bottom - line.top,
      });
    }
  }
  return merged;
};

export function PdfPage({
  pdf,
  pdfjs,
  pageNumber,
  baseWidth,
  baseHeight,
  scale,
  highlights,
  ocrWords,
  marginWidth,
  onHighlightColorChange,
  onHighlightCommentChange,
  onHighlightDelete,
}: {
  pdf: PDFDocumentProxy;
  pdfjs: PdfJs;
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  scale: number;
  highlights: Highlight[];
  ocrWords: OcrWord[] | undefined;
  // Width reserved to the right of the page for margin notes; 0 hides them.
  marginWidth: number;
  onHighlightColorChange: (id: string, color: HighlightColor) => void;
  // Resolves false if the save failed, so the editor can stay open.
  onHighlightCommentChange: (
    id: string,
    comment: string | null,
  ) => Promise<boolean>;
  onHighlightDelete: (id: string) => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Bumped whenever the text layer is rebuilt, so highlight boxes are
  // re-measured against the new layout.
  const [layerVersion, setLayerVersion] = useState(0);
  const [rects, setRects] = useState<Record<string, Rect[]>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Open highlight menu: which highlight, where it was clicked (as
  // fractions of the page, so it stays put across a zoom), and whether it's
  // showing the comment editor instead of the color/remove row.
  const [menu, setMenu] = useState<{
    id: string;
    x: number;
    y: number;
    editing: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const closeOnOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  // The highlight can disappear underneath an open menu (deleted from
  // elsewhere, or a failed save rolled back) — don't leave the menu orphaned.
  const menuHighlight = menu
    ? highlights.find((h) => h.id === menu.id)
    : undefined;

  const width = Math.floor(baseWidth * scale);
  const height = Math.floor(baseHeight * scale);

  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: VISIBILITY_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let textLayer: { cancel: () => void } | null = null;

    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const outputScale = Math.min(
        window.devicePixelRatio || 1,
        Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
      );
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      const task = page.render({
        canvas,
        viewport,
        transform:
          outputScale !== 1
            ? [outputScale, 0, 0, outputScale, 0, 0]
            : undefined,
      });
      renderTask = task;
      await task.promise;
      if (cancelled) return;

      // Scanned pages get the OCR layer below instead (React-rendered).
      const container = textLayerRef.current;
      if (ocrWords || !container) return;
      container.replaceChildren();
      // TextLayer sizes its container with a CSS round() expression built
      // on these properties — without them the layer collapses to 0×0 and
      // nothing is selectable (no error).
      container.style.setProperty("--total-scale-factor", `${scale}`);
      container.style.setProperty("--scale-round-x", "1px");
      container.style.setProperty("--scale-round-y", "1px");
      const textContent = await page.getTextContent();
      if (cancelled) return;
      const layer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container,
        viewport,
      });
      textLayer = layer;
      await layer.render();
      if (!cancelled) setLayerVersion((v) => v + 1);
    })().catch((err) => {
      if (cancelled || err instanceof pdfjs.RenderingCancelledException) {
        return;
      }
      console.error(`Failed to render page ${pageNumber}:`, err);
      setError("Couldn't render this page.");
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [visible, scale, pdf, pdfjs, pageNumber, ocrWords]);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const layer = textLayerRef.current;
    // A pdf.js layer is ready once layerVersion has been bumped; the OCR
    // layer is plain React output, so it's in the DOM by now.
    if (!page || !layer || (!ocrWords && layerVersion === 0)) return;
    const box = page.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const next: Record<string, Rect[]> = {};
    for (const h of highlights) {
      const range = findRangeForOffsets(
        layer,
        h.pageStartOffset,
        h.pageEndOffset,
      );
      if (!range) continue;
      next[h.id] = mergeLineRects(
        Array.from(range.getClientRects())
          .filter((r) => r.width > 1 && r.height > 1)
          .map((r) => ({
            x: (r.left - box.left) / box.width,
            y: (r.top - box.top) / box.height,
            w: r.width / box.width,
            h: r.height / box.height,
          })),
      );
    }
    setRects(next);
  }, [highlights, layerVersion, ocrWords, visible, scale]);

  // Highlight boxes sit under the text layer (so text stays selectable on
  // top of them) — clicks are matched to a highlight by position instead.
  const highlightAt = (e: React.MouseEvent<HTMLDivElement>): string | null => {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    for (const [id, list] of Object.entries(rects)) {
      if (
        list.some(
          (r) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h,
        )
      ) {
        return id;
      }
    }
    return null;
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (menuRef.current?.contains(e.target as Node)) return;
    if (!window.getSelection()?.isCollapsed) return;
    const id = highlightAt(e);
    if (!id) return;
    const box = e.currentTarget.getBoundingClientRect();
    setMenu({
      id,
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
      editing: false,
    });
  };

  /** Opens the comment editor just below the end of a highlight. */
  const openCommentEditor = (id: string) => {
    const highlight = highlights.find((h) => h.id === id);
    const last = rects[id]?.at(-1);
    if (!highlight || !last) return;
    setDraft(highlight.comment ?? "");
    setMenu({ id, x: last.x + last.w / 2, y: last.y + last.h, editing: true });
  };

  const saveComment = async (id: string, comment: string | null) => {
    setSavingComment(true);
    const saved = await onHighlightCommentChange(id, comment);
    setSavingComment(false);
    if (saved) setMenu(null);
  };

  const marginNotes = useMemo(
    (): MarginNote[] =>
      highlights.flatMap((h) => {
        const top = rects[h.id]?.[0];
        return h.comment && top
          ? [{ highlightId: h.id, comment: h.comment, color: h.color, y: top.y }]
          : [];
      }),
    [highlights, rects],
  );

  return (
    <div
      className="relative mx-auto shrink-0"
      style={{ width: width + marginWidth }}
    >
      <div
        ref={pageRef}
        data-page-number={pageNumber}
        onClick={handleClick}
        onMouseMove={(e) =>
          setHoverId(
            menuRef.current?.contains(e.target as Node) ? null : highlightAt(e),
          )
        }
        onMouseLeave={() => setHoverId(null)}
        title={
          hoverId ? "Click to comment on, recolor, or remove highlight" : undefined
        }
        className="relative rounded-[3px] bg-white shadow-paper"
        style={{ width, height, cursor: hoverId ? "pointer" : undefined }}
      >
        {visible && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{ width, height }}
          />
        )}

        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ mixBlendMode: "multiply" }}
        >
          {highlights.flatMap((h) =>
            (rects[h.id] ?? []).map((r, i) => (
              <div
                key={`${h.id}-${i}`}
                className={`absolute rounded-[2px] ${isFresh(h) ? "marker-sweep" : ""}`}
                style={{
                  // Multi-line highlights sweep one line after another.
                  animationDelay: `${i * 90}ms`,
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  backgroundColor:
                    HIGHLIGHT_COLOR_STYLES[h.color as HighlightColor] ??
                    HIGHLIGHT_COLOR_STYLES.yellow,
                  outline:
                    hoverId === h.id || menu?.id === h.id
                      ? "1px solid rgba(0, 0, 0, 0.35)"
                      : "none",
                }}
              />
            )),
          )}
        </div>

        {/* Marks highlights that carry a comment — the only sign of one when
            the margin is collapsed or hidden on narrow screens. */}
        <div className="pointer-events-none absolute inset-0 z-[2]">
          {highlights.map((h) => {
            const first = rects[h.id]?.[0];
            if (!h.comment || !first) return null;
            return (
              <span
                key={h.id}
                className="absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent-fill text-on-accent shadow-sm"
                style={{
                  left: `${(first.x + first.w) * 100}%`,
                  top: `${first.y * 100}%`,
                }}
              >
                <ChatIcon className="h-2.5 w-2.5" />
              </span>
            );
          })}
        </div>

        {visible && ocrWords ? (
          <div ref={textLayerRef} className="textLayer ocrLayer">
            {ocrWords.map((word, i) => {
              const fontSize = word.h * height;
              const measured = measureTextWidth(word.text, fontSize);
              const scaleX = measured > 0 ? (word.w * width) / measured : 1;
              return (
                <span
                  key={i}
                  style={{
                    left: word.x * width,
                    top: word.y * height,
                    fontSize,
                    transform: `scaleX(${scaleX})`,
                  }}
                >
                  {i < ocrWords.length - 1 ? `${word.text} ` : word.text}
                </span>
              );
            })}
          </div>
        ) : (
          visible && <div ref={textLayerRef} className="textLayer" />
        )}

        {menu && menuHighlight && menu.editing && (
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Highlight comment"
            data-no-highlight
            className="fade-in absolute z-[3] flex w-72 -translate-x-1/2 translate-y-2 flex-col gap-2 rounded-xl border border-border bg-background p-2 shadow-paper"
            style={{ left: `${menu.x * 100}%`, top: `${menu.y * 100}%` }}
          >
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void saveComment(menuHighlight.id, draft);
                }
              }}
              rows={4}
              placeholder="Write a note — markdown works"
              aria-label="Comment"
              className="resize-y rounded-md border border-border bg-background p-2 text-sm text-foreground"
            />
            <div className="flex items-center gap-2">
              {menuHighlight.comment && (
                <button
                  onClick={() => void saveComment(menuHighlight.id, null)}
                  disabled={savingComment}
                  className="rounded-md px-2 py-1 text-sm text-error hover:bg-surface disabled:opacity-50"
                >
                  Delete comment
                </button>
              )}
              <span className="flex-1" />
              <button
                onClick={() => setMenu(null)}
                className="rounded-md px-2 py-1 text-sm hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveComment(menuHighlight.id, draft)}
                disabled={savingComment}
                className="rounded-full bg-accent-fill px-3 py-1 text-sm text-on-accent disabled:opacity-50"
              >
                {savingComment ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}

        {menu && menuHighlight && !menu.editing && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Highlight options"
            data-no-highlight
            className="fade-in absolute z-[3] flex -translate-x-1/2 translate-y-2 items-center gap-1.5 rounded-full border border-border bg-background p-1.5 shadow-paper"
            style={{ left: `${menu.x * 100}%`, top: `${menu.y * 100}%` }}
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                role="menuitemradio"
                aria-checked={menuHighlight.color === c}
                aria-label={`Change highlight to ${c}`}
                onClick={() => {
                  if (menuHighlight.color !== c) {
                    onHighlightColorChange(menuHighlight.id, c);
                  }
                  setMenu(null);
                }}
                className="h-6 w-6 rounded-full border-2"
                style={{
                  backgroundColor: HIGHLIGHT_COLOR_STYLES[c],
                  borderColor:
                    menuHighlight.color === c ? "currentColor" : "transparent",
                }}
              />
            ))}
            <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
            <button
              role="menuitem"
              onClick={() => openCommentEditor(menuHighlight.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-surface"
            >
              <ChatIcon className="h-4 w-4" />
              {menuHighlight.comment ? "Edit comment" : "Comment"}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                onHighlightDelete(menuHighlight.id);
                setMenu(null);
              }}
              className="rounded-md px-2 py-1 text-sm text-error hover:bg-surface"
            >
              Remove
            </button>
          </div>
        )}

        {error && (
          <p className="absolute inset-x-0 top-4 text-center text-sm text-error">
            {error}
          </p>
        )}
      </div>

      {marginWidth > 0 && marginNotes.length > 0 && (
        <MarginNotes
          notes={marginNotes}
          pageHeight={height}
          activeId={menu?.id ?? hoverId}
          onOpen={openCommentEditor}
          onHover={setHoverId}
        />
      )}
    </div>
  );
}

// A highlight made in the last few seconds gets the marker-sweep animation;
// older ones (on load, or re-rendered by zoom) just appear.
const FRESH_MS = 4000;
const isFresh = (h: Highlight): boolean =>
  Date.now() - new Date(h.createdAt).getTime() < FRESH_MS;
