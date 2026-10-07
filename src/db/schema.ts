import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { OcrWord } from "@/lib/highlight-types";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    fileUrl: text("file_url").notNull(),
    format: text("format").notNull().default("pdf"),
    content: text("content").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Shown on library cards. Null for documents ingested before v0.16.0
    // until the reader opens them once and reports it.
    pageCount: integer("page_count"),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    // Set when the document was opened from a ThreadNotes article; its
    // highlights are then saved to ThreadNotes as excerpts on that article.
    threadnotesArticleId: text("threadnotes_article_id"),
    threadnotesProjectId: text("threadnotes_project_id"),
  },
  (t) => [
    uniqueIndex("documents_user_threadnotes_article")
      .on(t.userId, t.threadnotesArticleId)
      .where(sql`threadnotes_article_id IS NOT NULL`),
  ],
);

export const highlights = pgTable("highlights", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  // Offsets count characters in that page's text layer (the concatenated
  // pdf.js text items, or the OCR words for a scanned page) — not the whole
  // document. See src/lib/dom-offset.ts.
  pageNumber: integer("page_number").notNull(),
  pageStartOffset: integer("page_start_offset").notNull(),
  pageEndOffset: integer("page_end_offset").notNull(),
  textContent: text("text_content").notNull(),
  color: text("color").notNull().default("yellow"),
  // Margin note on the highlight (markdown). Null when there isn't one.
  comment: text("comment"),
  // The ThreadNotes excerpt this highlight is saved as. Null when the
  // document isn't from ThreadNotes, or saving it there failed.
  threadnotesExcerptId: text("threadnotes_excerpt_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bookmarks = pgTable("bookmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Word boxes for scanned pages, produced in the browser by tesseract.js and
// rendered as that page's text layer.
export const pageOcr = pgTable(
  "page_ocr",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    words: jsonb("words").$type<OcrWord[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("page_ocr_document_page").on(t.documentId, t.pageNumber)],
);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per quiz generated, counted against the daily limit.
export const quizRequests = pgTable(
  "quiz_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("quiz_requests_user_created").on(t.userId, t.createdAt)],
);

// One row per short answer Claude grades, counted against its own daily
// limit (separate from quizzes: one quiz can hold several short answers).
export const gradeRequests = pgTable(
  "grade_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("grade_requests_user_created").on(t.userId, t.createdAt)],
);

// One row per user, created on first save.
export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  // Sent to Claude with chat and quiz requests. Empty means none.
  claudeInstructions: text("claude_instructions").notNull().default(""),
  // Used server-side only; never sent to the browser.
  threadnotesApiKey: text("threadnotes_api_key"),
  // The ThreadNotes project to read from, picked in Settings. Always sent,
  // since ThreadNotes' default (its active project) changes under us.
  threadnotesProjectId: text("threadnotes_project_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Highlight = typeof highlights.$inferSelect;
export type NewHighlight = typeof highlights.$inferInsert;
export type Bookmark = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;
export type PageOcr = typeof pageOcr.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
