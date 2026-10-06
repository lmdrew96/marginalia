import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "blockquote",
  "br",
  "span",
  "img",
  "a",
];

export function sanitizeDocumentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["src", "alt", "href"],
  });
}

/**
 * Plain-text extraction for our own converter output (already sanitized,
 * limited tag set) — not for arbitrary untrusted HTML. Inserts newlines at
 * block boundaries before stripping tags, since DOMPurify's KEEP_CONTENT
 * default would otherwise glue adjacent paragraphs together with no space.
 */
export function stripHtmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|h1|h2|h3|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return DOMPurify.sanitize(withBreaks, { ALLOWED_TAGS: [] })
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}
