// Word files are converted to PDF by Gotenberg (a LibreOffice service run
// alongside the app), so they open in the same page reader as PDFs.
// Locally: docker run --rm -p 3001:3000 gotenberg/gotenberg:8
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const isDocx = (filename: string): boolean => /\.docx$/i.test(filename);

export class DocxConversionUnavailableError extends Error {}

export async function convertDocxToPdf(
  buffer: Buffer,
  filename: string,
): Promise<Buffer> {
  const gotenbergUrl =
    process.env.GOTENBERG_URL ??
    (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);
  if (!gotenbergUrl) {
    throw new DocxConversionUnavailableError("GOTENBERG_URL isn't set");
  }

  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buffer)]), filename);

  let res: Response;
  try {
    res = await fetch(`${gotenbergUrl}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    // Connection refused etc. — the service isn't running.
    throw new DocxConversionUnavailableError(
      `Gotenberg unreachable at ${gotenbergUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Gotenberg returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
