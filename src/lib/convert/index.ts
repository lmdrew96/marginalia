import { convertPdfToHtml } from "./pdf";
import type { EncodedImage } from "./pdf-images";

export type { EncodedImage };
export type SupportedFormat = "pdf";

export function detectFormat(filename: string): SupportedFormat | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  return null;
}

export async function convertToHtml(
  buffer: Buffer,
  format: SupportedFormat,
  uploadImage: (image: EncodedImage) => Promise<string>,
): Promise<string> {
  switch (format) {
    case "pdf":
      return convertPdfToHtml(buffer, uploadImage);
  }
}
