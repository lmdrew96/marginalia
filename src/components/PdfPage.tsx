"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight } from "@/db/schema";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_STYLES,
  type HighlightColor,
  type OcrWord,
} from "@/lib/highlight-types";
import { findRangeForOffsets } from "@/lib/dom-offset";

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
 * boxes (one per pdf.js span). Overlapping translucent boxes stack darker,
 * so merge boxes that sit on the same line and touch.
 */
const mergeLineRects = (rects: Rect[]): Rect[] => {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: Rect[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    const sameLine =
      last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5;
    if (sameLine && r.x <= last.x + last.w + 0.005) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.w = right - last.x;
      last.y = top;
      last.h = bottom - top;
    } else {
      merged.push({ ...r });
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
  onHighlightColorChange,
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
  onHighlightColorChange: (id: string, color: HighlightColor) => void;
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
  // Open highlight menu: which highlight, and where it was clicked (as
  // fractions of the page, so it stays put across a zoom).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);

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
    });
  };

  return (
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
      title={hoverId ? "Click to change or remove highlight" : undefined}
      className="relative mx-auto bg-white shadow-md"
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
              className="absolute rounded-[2px]"
              style={{
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

      {menu && menuHighlight && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Highlight options"
          className="absolute z-[3] flex -translate-x-1/2 translate-y-2 items-center gap-1.5 rounded-lg border border-border bg-background p-1.5 shadow-lg"
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
  );
}
