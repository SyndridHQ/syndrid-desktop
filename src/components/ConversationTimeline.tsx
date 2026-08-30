import { useMemo, useSyncExternalStore } from "react";
import { conversationStore } from "../runtime/conversationStore";

interface ConversationTimelineProps {
  threadId: string | null;
}

export function ConversationTimeline({
  threadId,
}: ConversationTimelineProps) {
  const messages = useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getSnapshot,
    conversationStore.getSnapshot,
  );
  const selectedMessages = useMemo(
    () =>
      threadId
        ? messages.filter((message) => message.threadId === threadId)
        : [],
    [messages, threadId],
  );

  if (selectedMessages.length === 0) return null;

  return (
    <section className="message-list" aria-live="polite">
      {selectedMessages.map((message) => (
        <article
          className={`message-card message-${message.role}`}
          key={message.id}
        >
          <div className="message-meta">
            <span>{message.role === "user" ? "You" : "Syndrid"}</span>
            {message.streaming && (
              <span className="streaming-badge">Streaming</span>
            )}
          </div>
          <p>{message.text || (message.streaming ? "…" : "")}</p>
        </article>
      ))}
    </section>
  );
}
