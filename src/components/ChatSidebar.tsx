"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Highlight } from "@/db/schema";
import { CloseIcon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import type {
  QuizLength,
  QuizQuestion,
} from "@/app/api/documents/[id]/quiz/route";
import type { Grade, GradeVerdict } from "@/app/api/documents/[id]/quiz/grade/route";

// A quiz lives only in this component — nothing about it is saved.
// `picked` is the chosen option on a multiple-choice question; `typed` is
// the reader's short answer; `grade` is Claude's verdict on it, if asked.
// All reset on each new question.
type Quiz = {
  questions: QuizQuestion[];
  // How many the reader asked for; Claude may write fewer on thin pages.
  requested: number;
  index: number;
  revealed: boolean;
  picked: number | null;
  typed: string;
  grade: Grade | null;
  grading: boolean;
};

const VERDICT_LABELS: Record<GradeVerdict, string> = {
  correct: "✓ Got it",
  partial: "◐ Partly",
  incorrect: "✗ Missed it",
};
// Page numbers stay strings while being typed, so a cleared field isn't
// forced back to a number.
type QuizSetup = {
  scope: "all" | "range";
  from: string;
  to: string;
  count: QuizLength;
};

// Mirrors QUIZ_LENGTHS in the quiz route (a value import would pull the
// server route into the client bundle).
const QUIZ_LENGTH_OPTIONS: QuizLength[] = [5, 10, 20];

// Space left below the panel so it reads as a card, not a wall.
const PANEL_GAP_PX = 16;

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
  stickyTop,
  currentPage,
  onJumpToPage,
}: {
  documentId: string;
  highlights: Highlight[];
  initialMessages: ChatMessage[];
  open: boolean;
  onClose: () => void;
  // 0 until the PDF has loaded.
  pageCount: number;
  // Height of the reader toolbar; the sidebar stays pinned just below it
  // while the document scrolls.
  stickyTop: number;
  // Sent with each message so Claude gets the pages around it.
  currentPage: number;
  onJumpToPage: (pageNumber: number) => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(
    initialMessages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSetup, setQuizSetup] = useState<QuizSetup | null>(null);
  // Which pages Claude could see on the last reply ("all" or "41-118").
  const [contextPages, setContextPages] = useState<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  // Fill exactly the visible space from the sidebar's top to the bottom of
  // the window. At the top of a document the app header still sits above
  // it, so a fixed viewport height would push the input off-screen.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const aside = asideRef.current;
      if (!aside) return;
      const top = Math.max(stickyTop, aside.getBoundingClientRect().top);
      aside.style.height = `${window.innerHeight - top - PANEL_GAP_PX}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [open, stickyTop]);

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
        body: JSON.stringify({ message: text, currentPage }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Chat request failed");
      }
      setContextPages(res.headers.get("X-Context-Pages"));

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
            ? { fromPage: setupFrom, toPage: setupTo, count: quizSetup.count }
            : { count: quizSetup.count },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't build a quiz");
      setQuizSetup(null);
      setQuiz({
        questions: body.questions,
        requested: body.requested,
        index: 0,
        revealed: false,
        picked: null,
        typed: "",
        grade: null,
        grading: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build a quiz");
    } finally {
      setQuizLoading(false);
    }
  }

  async function gradeAnswer() {
    const q = quiz?.questions[quiz.index];
    if (!quiz || !q || !quiz.typed.trim() || quiz.grading) return;
    const index = quiz.index;
    setError(null);
    setQuiz({ ...quiz, grading: true });
    let grade: Grade | null = null;
    try {
      const res = await fetch(`/api/documents/${documentId}/quiz/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q.question,
          modelAnswer: q.answer,
          response: quiz.typed,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't grade that answer");
      grade = body as Grade;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't grade that answer");
    }
    // Ignore a late reply if the reader has moved on to another question.
    setQuiz((prev) =>
      prev && prev.index === index ? { ...prev, grading: false, grade } : prev,
    );
  }

  if (!open) return null;

  const current = quiz?.questions[quiz.index];
  const source = current
    ? highlights.find((h) => h.id === current.highlightId)
    : undefined;

  return (
    <aside
      ref={asideRef}
      className="fade-in sticky mr-4 flex w-full max-w-sm flex-col self-start overflow-hidden rounded-2xl border border-border bg-background shadow-paper"
      style={{ top: stickyTop }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="eyebrow">Ask Claude</p>
          <h2 className="font-display text-base font-semibold">
            About this reading
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {!quiz && (
            <button
              onClick={() =>
                setQuizSetup((s) =>
                  s
                    ? null
                    : {
                        scope: "all",
                        from: "1",
                        to: String(pageCount),
                        count: 10,
                      },
                )
              }
              disabled={pageCount === 0 || quizLoading}
              aria-expanded={!!quizSetup}
              className="rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface hover:text-on-surface disabled:opacity-50"
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
          <div className="flex items-center gap-2">
            <span className="text-secondary">Questions</span>
            <div
              role="radiogroup"
              aria-label="Number of questions"
              className="flex rounded-full border border-border p-0.5"
            >
              {QUIZ_LENGTH_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={quizSetup.count === n}
                  onClick={() => setQuizSetup({ ...quizSetup, count: n })}
                  className={`min-w-10 rounded-full px-2.5 py-0.5 tabular-nums transition-colors ${
                    quizSetup.count === n
                      ? "bg-foreground text-background"
                      : "text-secondary hover:text-foreground"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
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
              className="rounded-full bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
            >
              {quizLoading ? "Writing quiz…" : "Start"}
            </button>
          </div>
        </form>
      )}

      {quiz && current ? (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-secondary">
                Question {quiz.index + 1} of {quiz.questions.length}
              </p>
              {quiz.index === 0 && quiz.questions.length < quiz.requested && (
                <p className="text-xs text-secondary">
                  These pages only had enough for {quiz.questions.length}.
                </p>
              )}
            </div>
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
          {current.kind === "multiple_choice" ? (
            <div className="flex flex-col gap-2" role="group" aria-label="Choices">
              {current.choices.map((choice, i) => {
                const isCorrect = i === current.correctIndex;
                const isPicked = i === quiz.picked;
                // Once answered, the right option and a wrong pick are marked
                // with a label as well as a border, so color isn't the only cue.
                const border = !quiz.revealed
                  ? "border-border hover:bg-surface"
                  : isCorrect
                    ? "border-2 border-accent-fill"
                    : isPicked
                      ? "border-2 border-error"
                      : "border-border opacity-70";
                return (
                  <button
                    key={i}
                    onClick={() =>
                      setQuiz({ ...quiz, picked: i, revealed: true })
                    }
                    disabled={quiz.revealed}
                    aria-pressed={isPicked}
                    className={`rounded-lg border px-3 py-2 text-left text-sm ${border}`}
                  >
                    {quiz.revealed && (isCorrect || isPicked) && (
                      <span
                        className={`mb-1 block text-xs font-semibold ${isCorrect ? "text-secondary" : "text-error"}`}
                      >
                        {isCorrect
                          ? isPicked
                            ? "✓ Correct"
                            : "✓ Right answer"
                          : "✗ Your pick"}
                      </span>
                    )}
                    <Markdown>{choice}</Markdown>
                  </button>
                );
              })}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (quiz.typed.trim()) setQuiz({ ...quiz, revealed: true });
              }}
              className="flex flex-col gap-2"
            >
              <textarea
                value={quiz.typed}
                onChange={(e) => setQuiz({ ...quiz, typed: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                readOnly={quiz.revealed}
                rows={3}
                placeholder="Type your answer…"
                aria-label="Your answer"
                className="resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
              />
              {!quiz.revealed && (
                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setQuiz({ ...quiz, revealed: true })}
                    className="text-xs text-secondary hover:underline"
                  >
                    Skip — show answer
                  </button>
                  <button
                    type="submit"
                    disabled={!quiz.typed.trim()}
                    className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                  >
                    Check answer
                  </button>
                </div>
              )}
            </form>
          )}
          {quiz.revealed && (
            <>
              <div className="rounded-lg border border-border px-3 py-2 text-sm">
                <p className="mb-1 text-xs font-medium text-secondary">
                  {current.kind === "multiple_choice"
                    ? "Why"
                    : "Model answer — compare it with yours"}
                </p>
                <Markdown>{current.answer}</Markdown>
              </div>
              {current.kind === "short_answer" &&
                quiz.typed.trim() &&
                (quiz.grade ? (
                  <div
                    className={`fade-in rounded-lg border-2 px-3 py-2 text-sm ${
                      quiz.grade.verdict === "correct"
                        ? "border-accent-fill"
                        : quiz.grade.verdict === "partial"
                          ? "border-marker"
                          : "border-error"
                    }`}
                  >
                    <p
                      className={`mb-1 text-xs font-semibold ${
                        quiz.grade.verdict === "incorrect"
                          ? "text-error"
                          : "text-secondary"
                      }`}
                    >
                      {VERDICT_LABELS[quiz.grade.verdict]}
                    </p>
                    <Markdown>{quiz.grade.feedback}</Markdown>
                  </div>
                ) : (
                  <button
                    onClick={() => void gradeAnswer()}
                    disabled={quiz.grading}
                    className="self-start rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface hover:text-on-surface disabled:opacity-50"
                  >
                    {quiz.grading ? "Grading…" : "Grade me"}
                  </button>
                ))}
              {error && <p className="text-xs text-error">{error}</p>}
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
                    setQuiz({
                      ...quiz,
                      index: quiz.index + 1,
                      revealed: false,
                      picked: null,
                      typed: "",
                      grade: null,
                      grading: false,
                    })
                  }
                  className="self-end rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                >
                  Next question
                </button>
              ) : (
                <button
                  onClick={() => setQuiz(null)}
                  className="self-end rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                >
                  Done
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {highlights.length > 0 && (
            // Capped so a long highlight list can't push the messages and
            // input out of the pinned sidebar.
            <div className="flex max-h-48 shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-border px-4 py-3">
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
                      // max-w-full + min-w-0 keep wide code blocks and
                      // tables scrolling inside the bubble.
                      m.role === "user"
                        ? "min-w-0 max-w-full self-end rounded-lg bg-foreground px-3 py-2 text-sm text-background"
                        : "min-w-0 max-w-full self-start rounded-lg bg-surface px-3 py-2 text-sm text-on-surface"
                    }
                  >
                    {m.content ? (
                      <Markdown>{m.content}</Markdown>
                    ) : (
                      m.role === "assistant" && sending && "…"
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="mt-2 text-xs text-error">{error}</p>}
          </div>

          {contextPages && (
            <p className="border-t border-border px-4 pt-2 text-xs text-secondary">
              {contextPages === "all"
                ? "Claude can see the whole document."
                : `Claude can see pages ${contextPages.replace("-", "–")}. Scroll elsewhere and ask again to move that window.`}
            </p>
          )}

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
              className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
