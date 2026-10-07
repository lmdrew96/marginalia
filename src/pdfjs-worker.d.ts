// pdfjs-dist ships no types for its worker entry; it's only handed to
// pdfjs via globalThis.pdfjsWorker (see src/lib/convert/pdf.ts).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
