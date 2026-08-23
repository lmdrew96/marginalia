import { PNG } from "pngjs";
import { encode as encodeJpeg } from "jpeg-js";
import type { PDFPageProxy } from "pdfjs-dist";

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

type RawImage = {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
};

export type EncodedImage = {
  buffer: Buffer;
  contentType: "image/png" | "image/jpeg";
  ext: "png" | "jpg";
};

// Full-page scans/painted art decode to millions of RGBA bytes — encoding
// that losslessly as PNG is slow and produces bloated output for content
// that's photographic, not flat-color/line-art. Above this pixel count,
// alpha-free images switch to JPEG (much faster to encode, far smaller).
// RGBA images always stay PNG regardless of size — JPEG can't represent
// transparency, and downgrading it silently would be a real quality loss.
const JPEG_THRESHOLD_PIXELS = 200_000;
const JPEG_QUALITY = 82;

function toRgba(img: RawImage): Buffer | null {
  const { width, height, kind, data } = img;
  if (!width || !height || !data?.length) return null;

  if (kind === 3 /* RGBA_32BPP */) {
    if (data.length < width * height * 4) return null;
    return Buffer.from(data);
  }
  if (kind === 2 /* RGB_24BPP */) {
    if (data.length < width * height * 3) return null;
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
      rgba[j] = data[i];
      rgba[j + 1] = data[i + 1];
      rgba[j + 2] = data[i + 2];
      rgba[j + 3] = 255;
    }
    return rgba;
  }
  if (kind === 1 /* GRAYSCALE_1BPP */) {
    const rgba = Buffer.alloc(width * height * 4);
    const bytesPerRow = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * bytesPerRow + (x >> 3)] ?? 0;
        const bit = 7 - (x & 7);
        const value = (byte >> bit) & 1 ? 255 : 0;
        const j = (y * width + x) * 4;
        rgba[j] = rgba[j + 1] = rgba[j + 2] = value;
        rgba[j + 3] = 255;
      }
    }
    return rgba;
  }
  // Unrecognized/unsupported pixel format — skip rather than corrupt output.
  return null;
}

function encodeImage(img: RawImage, pdfjs: PdfjsModule): EncodedImage | null {
  const rgba = toRgba(img);
  if (!rgba) return null;

  const { width, height, kind } = img;
  const pixels = width * height;
  const hasAlpha = kind === pdfjs.ImageKind.RGBA_32BPP;

  if (!hasAlpha && pixels > JPEG_THRESHOLD_PIXELS) {
    const { data } = encodeJpeg({ data: rgba, width, height }, JPEG_QUALITY);
    return { buffer: data, contentType: "image/jpeg", ext: "jpg" };
  }

  const png = new PNG({ width, height });
  png.data = rgba;
  return { buffer: PNG.sync.write(png), contentType: "image/png", ext: "png" };
}

/**
 * Decodes a page's embedded images only — no upload. Object resolution
 * (page.objs.get) and pixel decoding are tied to this page's pdfjs state
 * and must run in-process here, but the actual R2 upload is pure I/O with
 * no such dependency, so it's deliberately left to the caller to run
 * across ALL pages' images concurrently instead of one at a time per page
 * — sequential uploads were the main reason large PDFs felt eternal to
 * convert.
 */
// page.objs.get(objId, callback) only ever calls its callback — there's no
// reject path — so a try/catch around it is a no-op. If pdfjs's internal
// decode for that object fails in a way that never calls objs.resolve()
// (observed with a JBig2-compressed image pdfjs couldn't decode), the
// callback simply never fires and an unguarded await hangs forever,
// stalling the entire document's conversion on one bad image. This
// timeout is the only way out of that.
const IMAGE_OBJECT_TIMEOUT_MS = 5000;

function getImageObject(
  page: PDFPageProxy,
  objId: string,
): Promise<RawImage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, IMAGE_OBJECT_TIMEOUT_MS);

    page.objs.get(objId, (data: RawImage) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data ?? null);
    });
  });
}

export async function decodePageImages(
  page: PDFPageProxy,
  pdfjs: PdfjsModule,
): Promise<EncodedImage[]> {
  const opList = await page.getOperatorList();
  const images: EncodedImage[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;

    const objId = opList.argsArray[i][0] as string;
    if (seen.has(objId)) continue;
    seen.add(objId);

    const imgData = await getImageObject(page, objId);
    if (!imgData) continue;

    const encoded = encodeImage(imgData, pdfjs);
    if (encoded) images.push(encoded);
  }

  return images;
}
