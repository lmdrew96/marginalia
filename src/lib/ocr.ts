import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, OCR_MODEL } from "@/lib/anthropic";

// Claude's vision tokenization has an effective resolution ceiling around
// ~1568px on the long edge — sending a full-resolution scan past that burns
// tokens with no accuracy gain.
const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 85;
const MAX_OUTPUT_TOKENS = 4096;

const OCR_SYSTEM_PROMPT = `You transcribe scanned document pages into clean semantic HTML, matching how a well-formed EPUB page is marked up.

Rules:
- Output ONLY an HTML fragment using these tags: <p> <h1> <h2> <h3> <ul> <ol> <li> <strong> <em> <blockquote> <br> <a href="...">
- Use <h1>/<h2>/<h3> for titles and section headings, in that order of visual prominence. Use <p> for body paragraphs, <ul>/<ol> with <li> for lists, <blockquote> for indented or quoted passages.
- Wrap any literal URL or email address that is visibly printed on the page in <a href="...">exact visible text</a>. Never invent a link that isn't printed on the page.
- Do not include <img>, <table>, markdown syntax, code fences, or any commentary about the image.
- If the page has no legible text, output nothing.`;

export type OcrImage = {
  data: string;
  mediaType: "image/jpeg";
};

export async function prepareImageForOcr(buffer: Buffer): Promise<OcrImage> {
  const resized = await sharp(buffer)
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { data: resized.toString("base64"), mediaType: "image/jpeg" };
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}

export type TranscribeResult =
  | { ok: true; html: string }
  | { ok: false; reason: "truncated" };

export async function transcribePage(
  image: OcrImage,
): Promise<TranscribeResult> {
  const response = await anthropic.messages.create({
    model: OCR_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: OCR_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: image.data,
            },
          },
          { type: "text", text: "Transcribe this page." },
        ],
      },
    ],
  });

  // A truncated response could be mid-tag (unclosed <p>, a dangling <a
  // href="...) — inserting it and marking the page done would silently lose
  // the rest of the page with no retry path. Leave it pending instead.
  if (response.stop_reason === "max_tokens") {
    return { ok: false, reason: "truncated" };
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  // Empty is a legitimate outcome — a blank or illegible scanned page has
  // nothing to transcribe — so it's still `ok`, just with no HTML to insert.
  const html = stripCodeFence(textBlock?.text.trim() ?? "");
  return { ok: true, html };
}
