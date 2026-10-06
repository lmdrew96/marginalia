import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OcrWord } from "@/lib/highlight-types";

// Tesseract reads small print far better from an upscaled image — render
// the page so its long edge is about this many pixels.
const OCR_LONG_EDGE_PX = 2400;
// Below this, tesseract's "words" are mostly specks and texture from photos
// or scan noise, not text.
const MIN_WORD_CONFIDENCE = 30;

/**
 * OCRs the given pages in the browser with tesseract.js and returns each
 * page's words with their positions as fractions of the page. Browser-only:
 * imports tesseract.js lazily, and renders pages to an offscreen canvas.
 */
export const ocrPages = async (
  pdf: PDFDocumentProxy,
  pageNumbers: number[],
  onPageDone: (pageNumber: number, words: OcrWord[]) => Promise<void>,
): Promise<void> => {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    for (const pageNumber of pageNumbers) {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = OCR_LONG_EDGE_PX / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;

      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              const text = word.text.trim();
              if (!text || word.confidence < MIN_WORD_CONFIDENCE) continue;
              const { x0, y0, x1, y1 } = word.bbox;
              words.push({
                text,
                x: x0 / canvas.width,
                y: y0 / canvas.height,
                w: (x1 - x0) / canvas.width,
                h: (y1 - y0) / canvas.height,
              });
            }
          }
        }
      }
      // Free the canvas's backing store now rather than waiting on GC — a
      // long scanned document would otherwise pile these up.
      canvas.width = 0;
      canvas.height = 0;
      await onPageDone(pageNumber, words);
    }
  } finally {
    await worker.terminate();
  }
};
