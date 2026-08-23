import path from "node:path";
import { decodePageImages, type EncodedImage } from "./pdf-images";
import { mapWithConcurrency } from "@/lib/concurrency";

const IMAGE_UPLOAD_CONCURRENCY = 6;

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

export async function convertPdfToHtml(
  buffer: Buffer,
  uploadImage: (image: EncodedImage) => Promise<string>,
): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Under Next's bundler (Turbopack/webpack), pdfjs's own relative import
  // of its worker script resolves against the bundled chunk output, not
  // node_modules, and fails. Point it at the real file directly so pdfjs
  // never tries to guess the path itself.
  pdfjs.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  );

  const standardFontDataUrl = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/standard_fonts/",
  );

  const tParse0 = performance.now();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
  }).promise;
  const tParse1 = performance.now();

  const linesByPage: Line[][] = [];
  const imageBuffersByPage: EncodedImage[][] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
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

    linesByPage.push(groupIntoLines(items));
    imageBuffersByPage.push(await decodePageImages(page, pdfjs));
  }
  const tPages = performance.now();

  // Decoding images is tied to each page's pdfjs state and stays
  // sequential above, but uploading them is pure I/O with no such
  // dependency — batch every image in the document into one concurrent
  // upload pass instead of one page (or one image) at a time.
  const flatBuffers = imageBuffersByPage.flatMap((images, pageIndex) =>
    images.map((image) => ({ image, pageIndex })),
  );
  const uploaded = await mapWithConcurrency(
    flatBuffers,
    IMAGE_UPLOAD_CONCURRENCY,
    async ({ image, pageIndex }) => {
      try {
        return { pageIndex, src: await uploadImage(image) };
      } catch {
        // A single failed image upload shouldn't fail the whole document.
        return { pageIndex, src: null };
      }
    },
  );
  const imagesByPage: string[][] = imageBuffersByPage.map(() => []);
  for (const { pageIndex, src } of uploaded) {
    if (src) imagesByPage[pageIndex].push(src);
  }
  const tUpload = performance.now();
  console.log(
    `[pdf-convert] pages=${doc.numPages} images=${flatBuffers.length}: ` +
      `parse=${(tParse1 - tParse0).toFixed(0)}ms pageWalk=${(tPages - tParse1).toFixed(0)}ms imageUpload=${(tUpload - tPages).toFixed(0)}ms`,
  );

  const allLines = linesByPage.flat();
  const heights = allLines.map((l) => l.height).sort((a, b) => a - b);
  const bodyHeight = heights[Math.floor(heights.length / 2)] || 10;

  // Paragraph breaks are computed per-page — y resets at each page boundary,
  // so a cross-page gap comparison is meaningless and can wrongly merge the
  // bottom of one page with the top of the next. Images aren't positioned
  // relative to text (pdfjs doesn't give us that without much more work),
  // so they're placed after their page's text — a reasonable approximation
  // for covers/figures, not pixel-accurate placement.
  const pages = linesByPage.map((lines, i) => {
    const paragraphs = linesToParagraphHtml(
      stripHeaderFooter(lines, bodyHeight),
      bodyHeight,
    );
    const images = imagesByPage[i].map(
      (src) => `<img src="${src}" alt="" />`,
    );
    return [...paragraphs, ...images].join("\n");
  });

  const html = pages.filter(Boolean).join("\n");
  return html || "<p></p>";
}
