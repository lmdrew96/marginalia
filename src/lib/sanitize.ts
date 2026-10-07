import sanitizeHtml from "sanitize-html";

// sanitize-html parses with htmlparser2, so it runs on Cloudflare Workers.
// DOMPurify needs a DOM, which meant jsdom on the server, and jsdom can't
// load there.
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
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { img: ["src", "alt"], a: ["href"] },
  });
}
