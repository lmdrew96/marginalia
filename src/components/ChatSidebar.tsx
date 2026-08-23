"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Highlight } from "@/db/schema";
import { CloseIcon } from "@/components/icons";

type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function ChatSidebar({
  documentId,
  pageNumber,
  pageText,
  pageHighlights,
  initialMessages,
  open,
  onClose,
}: {
  documentId: string;
  pageNumber: number;
  pageText: string;
  pageHighlights: Highlight[];
  initialMessages: ChatMessage[];
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(
    initialMessages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ message: text, pageNumber, pageText }),
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

  if (!open) return null;

  return (
    <aside className="flex w-full max-w-sm flex-col border-l border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Ask about this reading</h2>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="text-secondary hover:text-foreground"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {pageHighlights.length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
          <p className="text-xs font-medium text-secondary">
            Highlights on this page
          </p>
          {pageHighlights.map((h) => (
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
            Ask a question about page {pageNumber} — I can only see this page
            unless you tell me otherwise.
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
          placeholder="Ask about this page…"
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
    </aside>
  );
}
