// One recognized word on a scanned page. Coordinates are fractions of the
// page's width/height, so they hold at any zoom level.
export type OcrWord = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const HIGHLIGHT_COLOR_STYLES: Record<HighlightColor, string> = {
  yellow: "rgba(250, 204, 21, 0.35)",
  green: "rgba(74, 222, 128, 0.35)",
  blue: "rgba(96, 165, 250, 0.35)",
  pink: "rgba(244, 114, 182, 0.35)",
};
