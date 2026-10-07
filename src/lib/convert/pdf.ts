type TextItem = {
  str: string;
  x: number;
  y: number;
  height: number;
};

type Line = {
  y: number;
  height: number;
  text: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function groupIntoLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; height: number; items: TextItem[] }[] = [];

  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(item.height, last?.height ?? item.height) * 0.4;
    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.items.push(item);
    } else {
      lines.push({ y: item.y, height: item.height, items: [item] });
    }
  }

  return lines.map((line) => ({
    y: line.y,
    height: line.height,
    text: line.items
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

/**
 * Drops running headers/footers (page folios, chapter running heads) from
 * a page's line list. Confirmed against a real book: this chrome sits at
 * the extreme top/bottom of every page, in a smaller font than body text,
 * separated from the real content by a distinctly larger line gap than
 * normal — e.g. body lines 14pt apart, but a ~21pt gap to the header and
 * a ~28pt gap to the footer. Without this, chrome gets extracted as
 * regular paragraphs and interrupts the reading flow mid-sentence at
 * every single page boundary.
 */
function stripHeaderFooter(lines: Line[], bodyHeight: number): Line[] {
  if (lines.length < 2 || bodyHeight <= 0) return lines;
  let result = lines;

  const isChrome = (candidate: Line, neighbor: Line) =>
    candidate.height < bodyHeight * 0.95 &&
    Math.abs(candidate.y - neighbor.y) > neighbor.height * 1.3;

  const first = result[0];
  if (isChrome(first, result[1])) {
    result = result.slice(1);
  }

  if (result.length >= 2) {
    const last = result[result.length - 1];
    const prev = result[result.length - 2];
    if (isChrome(last, prev)) {
      result = result.slice(0, -1);
    }
  }

  return result;
}

function linesToParagraphHtml(lines: Line[], bodyHeight: number): string[] {
  const paragraphs: string[] = [];
  let current: Line[] = [];

  function flush() {
    if (current.length === 0) return;
    const text = current
      .map((l) => l.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      const maxHeight = Math.max(...current.map((l) => l.height));
      const ratio = bodyHeight > 0 ? maxHeight / bodyHeight : 1;
      const tag = ratio > 1.5 ? "h1" : ratio > 1.3 ? "h2" : ratio > 1.15 ? "h3" : "p";
      paragraphs.push(`<${tag}>${escapeHtml(text)}</${tag}>`);
    }
    current = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text) continue;
    const prev = lines[i - 1];
    if (prev) {
      const gap = prev.y - line.y;
      const refHeight = Math.max(prev.height, line.height) || 1;
      if (gap > refHeight * 1.4) {
        flush();
      }
    }
    current.push(line);
  }
  flush();

  return paragraphs;
}

type PdfDocument = Awaited<
  ReturnType<
    typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]
  >["promise"]
>;

/**
 * Just enough of a 2D DOMMatrix for pdfjs on Cloudflare Workers, which has
 * none. pdfjs builds one at module load and, in the worker, scales and
 * translates one for Type3 glyph masks; its Node fallback (@napi-rs/canvas)
 * is a native module that can't load there. Text extraction needs nothing
 * more.
 */
class AffineMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[]) {
    if (init?.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
  }

  multiplySelf(m: AffineMatrix): this {
    const { a, b, c, d, e, f } = this;
    this.a = a * m.a + c * m.b;
    this.b = b * m.a + d * m.b;
    this.c = a * m.c + c * m.d;
    this.d = b * m.c + d * m.d;
    this.e = a * m.e + c * m.f + e;
    this.f = b * m.e + d * m.f + f;
    return this;
  }

  scaleSelf(sx = 1, sy = sx): this {
    return this.multiplySelf(new AffineMatrix([sx, 0, 0, sy, 0, 0]));
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf(new AffineMatrix([1, 0, 0, 1, tx, ty]));
  }
}

async function openPdf(buffer: Buffer): Promise<PdfDocument> {
  const globals = globalThis as { DOMMatrix?: unknown; pdfjsWorker?: unknown };
  globals.DOMMatrix ??= AffineMatrix;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdfjs runs its worker in this thread on the server. By default it
  // imports the worker by path, which doesn't exist once bundled (and
  // there's no node_modules on Workers at all). Handing it the bundled
  // module through globalThis.pdfjsWorker skips that lookup.
  globals.pdfjsWorker ??= await import(
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );

  // Only text is read here, so standard font files aren't needed.
  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
  }).promise;
}

async function pageLines(doc: PdfDocument, pageNum: number): Promise<Line[]> {
  const page = await doc.getPage(pageNum);
  const textContent = await page.getTextContent();

  const items: TextItem[] = textContent.items
    .filter(
      (item): item is Extract<typeof item, { transform: number[] }> =>
        "transform" in item,
    )
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      height: item.height || Math.abs(item.transform[3]) || 10,
    }))
    .filter((item) => item.str.trim().length > 0);

  return groupIntoLines(items);
}

export type PageText = { pageNumber: number; text: string };

/**
 * Plain text of each page in `from`..`to` (1-based, inclusive; `to` is
 * clamped to the last page). Scanned pages come back with empty text —
 * their words live in page_ocr, not the PDF.
 */
export async function extractPdfPageTexts(
  buffer: Buffer,
  from: number,
  to: number,
): Promise<{ numPages: number; pages: PageText[] }> {
  const doc = await openPdf(buffer);
  const pages: PageText[] = [];
  for (let n = Math.max(1, from); n <= Math.min(to, doc.numPages); n++) {
    const lines = await pageLines(doc, n);
    pages.push({ pageNumber: n, text: lines.map((l) => l.text).join("\n") });
  }
  return { numPages: doc.numPages, pages };
}

export async function convertPdfToHtml(
  buffer: Buffer,
): Promise<{ html: string; pageCount: number }> {
  const tParse0 = performance.now();
  const doc = await openPdf(buffer);
  const tParse1 = performance.now();

  const linesByPage: Line[][] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    linesByPage.push(await pageLines(doc, pageNum));
  }
  const tPages = performance.now();

  console.log(
    `[pdf-convert] pages=${doc.numPages}: ` +
      `parse=${(tParse1 - tParse0).toFixed(0)}ms pageWalk=${(tPages - tParse1).toFixed(0)}ms`,
  );

  const allLines = linesByPage.flat();
  const heights = allLines.map((l) => l.height).sort((a, b) => a - b);
  const bodyHeight = heights[Math.floor(heights.length / 2)] || 10;

  // Paragraph breaks are computed per-page — y resets at each page boundary,
  // so a cross-page gap comparison is meaningless and can wrongly merge the
  // bottom of one page with the top of the next. Images aren't extracted:
  // the reader renders the real page, so this HTML is only the text
  // context for Ask Claude.
  const pages = linesByPage.map((lines) =>
    linesToParagraphHtml(stripHeaderFooter(lines, bodyHeight), bodyHeight).join(
      "\n",
    ),
  );

  const html = pages.filter(Boolean).join("\n");
  return { html: html || "<p></p>", pageCount: doc.numPages };
}
