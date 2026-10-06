"use client";

import { useLayoutEffect, useRef } from "react";
import {
  HIGHLIGHT_COLOR_STYLES,
  type HighlightColor,
} from "@/lib/highlight-types";
import { Markdown } from "@/components/Markdown";

export type MarginNote = {
  highlightId: string;
  comment: string;
  color: string;
  // Top of the highlight, as a fraction of the page height.
  y: number;
};

const NOTE_GAP_PX = 8;

/**
 * The comment column beside one page. Each note starts level with its
 * highlight; notes that would overlap are pushed down below the one above.
 */
export const MarginNotes = ({
  notes,
  pageHeight,
  activeId,
  onOpen,
  onHover,
}: {
  notes: MarginNote[];
  pageHeight: number;
  activeId: string | null;
  onOpen: (highlightId: string) => void;
  onHover: (highlightId: string | null) => void;
}): React.JSX.Element => {
  const noteRefs = useRef(new Map<string, HTMLElement>());

  const sorted = [...notes].sort((a, b) => a.y - b.y);

  // Stacking needs each note's rendered height, so it's done on the DOM
  // after layout (before paint) rather than through state.
  useLayoutEffect(() => {
    let bottom = -Infinity;
    for (const note of [...notes].sort((a, b) => a.y - b.y)) {
      const el = noteRefs.current.get(note.highlightId);
      if (!el) continue;
      const top = Math.max(note.y * pageHeight, bottom + NOTE_GAP_PX);
      el.style.top = `${top}px`;
      bottom = top + el.offsetHeight;
    }
  }, [notes, pageHeight]);

  return (
    <div className="absolute inset-y-0 right-0 w-56" data-no-highlight>
      {sorted.map((note) => (
        // A div, not a <button>: the rendered markdown can contain links,
        // which can't nest inside a button.
        <div
          key={note.highlightId}
          role="button"
          tabIndex={0}
          ref={(el) => {
            if (el) noteRefs.current.set(note.highlightId, el);
            else noteRefs.current.delete(note.highlightId);
          }}
          onClick={(e) => {
            if ((e.target as Element).closest("a")) return;
            onOpen(note.highlightId);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpen(note.highlightId);
            }
          }}
          onMouseEnter={() => onHover(note.highlightId)}
          onMouseLeave={() => onHover(null)}
          title="Edit comment"
          className="absolute inset-x-0 max-h-48 cursor-pointer overflow-hidden rounded-md border-l-4 bg-surface px-3 py-2 text-left text-sm text-on-surface shadow-sm"
          style={{
            top: note.y * pageHeight,
            borderLeftColor:
              HIGHLIGHT_COLOR_STYLES[note.color as HighlightColor] ??
              HIGHLIGHT_COLOR_STYLES.yellow,
            outline:
              activeId === note.highlightId
                ? "1px solid var(--on-surface-secondary)"
                : undefined,
          }}
        >
          <Markdown>{note.comment}</Markdown>
        </div>
      ))}
    </div>
  );
};
