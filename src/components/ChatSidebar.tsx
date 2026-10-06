"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Highlight } from "@/db/schema";
import { CloseIcon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import type { QuizQuestion } from "@/app/api/documents/[id]/quiz/route";

// A quiz lives only in this component — nothing about it is saved.
type Quiz = { questions: QuizQuestion[]; index: number; revealed: boolean };
// Page numbers stay strings while being typed, so a cleared field isn't
// forced back to a number.
type QuizSetup = { scope: "all" | "range"; from: string; to: string };

type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function ChatSidebar({
  documentId,
  highlights,
  initialMessages,
  open,
  onClose,
  pageCount,
  onJumpToPage,
}: {
  documentId: string;
  highlights: Highlight[];
  initialMessages: ChatMessage[];
  open: boolean;
  onClose: () => void;
  // 0 until the PDF has loaded.
  pageCount: number;
  onJumpToPage: (pageNumber: number) => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(
    initialMessages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSetup, setQuizSetup] = useState<QuizSetup | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    setError(null);
    setInput("");
    setSending(true);

    const userMsg: DisplayMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantId = `local-${Date.now()}-a`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      const res = await fetch(`/api/documents/${documentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m,
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setSending(false);
    }
  }

  const setupFrom = Number(quizSetup?.from);
  const setupTo = Number(quizSetup?.to);
  const setupValid =
    quizSetup?.scope === "all" ||
    (Number.isInteger(setupFrom) &&
      Number.isInteger(setupTo) &&
      setupFrom >= 1 &&
      setupFrom <= setupTo &&
      setupTo <= pageCount);

  async function startQuiz() {
    if (!quizSetup || !setupValid) return;
    setError(null);
    setQuizLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          quizSetup.scope === "range"
            ? { fromPage: setupFrom, toPage: setupTo }
            : {},
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't build a quiz");
      setQuizSetup(null);
      setQuiz({ questions: body.questions, index: 0, revealed: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build a quiz");
    } finally {
      setQuizLoading(false);
    }
  }

  if (!open) return null;

  const current = quiz?.questions[quiz.index];
  const source = current
    ? highlights.find((h) => h.id === current.highlightId)
    : undefined;

  return (
    <aside className="flex w-full max-w-sm flex-col border-l border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Ask about this reading</h2>
        <div className="flex items-center gap-3">
          {!quiz && (
            <button
              onClick={() =>
                setQuizSetup((s) =>
                  s ? null : { scope: "all", from: "1", to: String(pageCount) },
                )
              }
              disabled={pageCount === 0 || quizLoading}
              aria-expanded={!!quizSetup}
              className="rounded-md border border-border px-2 py-0.5 text-xs disabled:opacity-50"
            >
              Quiz me
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close chat"
            className="text-secondary hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {quizSetup && !quiz && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void startQuiz();
          }}
          className="flex flex-col gap-2 border-b border-border px-4 py-3 text-sm"
        >
          <p className="text-xs font-medium text-secondary">
            Quiz me on… (your highlights get extra weight)
          </p>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="quiz-scope"
              checked={quizSetup.scope === "all"}
              onChange={() => setQuizSetup({ ...quizSetup, scope: "all" })}
            />
            The whole document ({pageCount} pages)
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input
              type="radio"
              name="quiz-scope"
              checked={quizSetup.scope === "range"}
              onChange={() => setQuizSetup({ ...quizSetup, scope: "range" })}
            />
            Pages
            <input
              type="number"
              min={1}
              max={pageCount}
              value={quizSetup.from}
              onChange={(e) =>
                setQuizSetup({ ...quizSetup, scope: "range", from: e.target.value })
              }
              aria-label="First page"
              className="w-16 rounded-md border border-border bg-transparent px-2 py-0.5"
            />
            to
            <input
              type="number"
              min={1}
              max={pageCount}
              value={quizSetup.to}
              onChange={(e) =>
                setQuizSetup({ ...quizSetup, scope: "range", to: e.target.value })
              }
              aria-label="Last page"
              className="w-16 rounded-md border border-border bg-transparent px-2 py-0.5"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setQuizSetup(null)}
              disabled={quizLoading}
              className="rounded-md px-2 py-1 text-sm hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!setupValid || quizLoading}
              className="rounded-md bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
            >
              {quizLoading ? "Writing quiz…" : "Start"}
            </button>
          </div>
        </form>
      )}

      {quiz && current ? (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-secondary">
              Question {quiz.index + 1} of {quiz.questions.length}
            </p>
            <button
              onClick={() => setQuiz(null)}
              className="text-xs text-secondary hover:underline"
            >
              End quiz
            </button>
          </div>
          <div className="rounded-lg bg-surface px-3 py-2 text-sm text-on-surface">
            <Markdown>{current.question}</Markdown>
          </div>
          {quiz.revealed ? (
            <>
              <div className="rounded-lg border border-border px-3 py-2 text-sm">
                <Markdown>{current.answer}</Markdown>
              </div>
              <button
                onClick={() => onJumpToPage(current.pageNumber)}
                className="rounded-md border border-border px-2 py-1 text-left text-xs text-secondary hover:bg-surface hover:text-on-surface-secondary"
              >
                {source
                  ? `From your highlight on p. ${current.pageNumber}: “${source.textContent}”`
                  : `From p. ${current.pageNumber}`}
              </button>
              {quiz.index < quiz.questions.length - 1 ? (
                <button
                  onClick={() =>
                    setQuiz({ ...quiz, index: quiz.index + 1, revealed: false })
                  }
                  className="self-end rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                >
                  Next question
                </button>
              ) : (
                <button
                  onClick={() => setQuiz(null)}
                  className="self-end rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                >
                  Done
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => setQuiz({ ...quiz, revealed: true })}
              className="self-start rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Show answer
            </button>
          )}
        </div>
      ) : (
        <>
          {highlights.length > 0 && (
            <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
              <p className="text-xs font-medium text-secondary">
                Highlights you&apos;ve made
              </p>
              {highlights.map((h) => (
                <button
                  key={h.id}
                  onClick={() =>
                    send(`Can you explain this: "${h.textContent}"`)
                  }
                  disabled={sending}
                  className="group truncate rounded-md border border-border px-2 py-1 text-left text-xs text-secondary transition-colors hover:bg-surface disabled:opacity-50"
                >
                  <span className="group-hover:text-on-surface-secondary">
                    Ask about: “{h.textContent}”
                  </span>
                </button>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <p className="text-sm text-secondary">
                Ask a question about this reading.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.role === "user"
                        ? "self-end rounded-lg bg-foreground px-3 py-2 text-sm text-background"
                        : "self-start rounded-lg bg-surface px-3 py-2 text-sm text-on-surface"
                    }
                  >
                    {m.content || (m.role === "assistant" && sending ? "…" : "")}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="mt-2 text-xs text-error">{error}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-border p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this reading…"
              disabled={sending}
              className="flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
