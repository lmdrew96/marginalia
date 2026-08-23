export type HighlightRect = {
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
};

export type PositionAnchor = {
  rects: HighlightRect[];
};

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const HIGHLIGHT_COLOR_STYLES: Record<HighlightColor, string> = {
  yellow: "rgba(250, 204, 21, 0.35)",
  green: "rgba(74, 222, 128, 0.35)",
  blue: "rgba(96, 165, 250, 0.35)",
  pink: "rgba(244, 114, 182, 0.35)",
};
