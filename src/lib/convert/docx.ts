import { getCloudflareContext } from "@opennextjs/cloudflare";

// Word files are converted to PDF by Gotenberg (a LibreOffice service run
// alongside the app), so they open in the same page reader as PDFs.
// Locally: docker run --rm -p 3001:3000 gotenberg/gotenberg:8
// On Workers it's a container behind the GOTENBERG binding (worker.ts).
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const isDocx = (filename: string): boolean => /\.docx$/i.test(filename);

export class DocxConversionUnavailableError extends Error {}

type GotenbergEnv = {
  GOTENBERG?: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
};

const CONVERT_PATH = "/forms/libreoffice/convert";

// GOTENBERG_URL wins when set; in development it defaults to the local
// Docker container; otherwise the Worker's container binding is used.
const sendToGotenberg = async (form: FormData): Promise<Response> => {
  const url =
    process.env.GOTENBERG_URL ??
    (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);
  if (url) {
    return fetch(`${url}${CONVERT_PATH}`, { method: "POST", body: form });
  }

  const { GOTENBERG } = getCloudflareContext().env as GotenbergEnv;
  if (!GOTENBERG) {
    throw new DocxConversionUnavailableError(
      "No GOTENBERG_URL and no GOTENBERG container binding",
    );
  }
  // One shared instance: it wakes on demand and sleeps when idle.
  return GOTENBERG.getByName("main").fetch(
    new Request(`http://gotenberg${CONVERT_PATH}`, { method: "POST", body: form }),
  );
};

export async function convertDocxToPdf(
  buffer: Buffer,
  filename: string,
): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buffer)]), filename);

  let res: Response;
  try {
    res = await sendToGotenberg(form);
  } catch (err) {
    if (err instanceof DocxConversionUnavailableError) throw err;
    // Connection refused, container failed to start, etc.
    throw new DocxConversionUnavailableError(
      `Gotenberg unreachable: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Gotenberg returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
