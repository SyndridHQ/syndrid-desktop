import { memo, useMemo, useSyncExternalStore } from "react";
import {
  conversationStore,
  type ConversationMessage,
} from "../runtime/conversationStore";

interface ConversationTimelineProps {
  threadId: string | null;
}

const ConversationMessageCard = memo(function ConversationMessageCard({
  message,
}: {
  message: ConversationMessage;
}) {
  return (
    <article className={`message-card message-${message.role}`}>
      <div className="message-meta">
        <span>{message.role === "user" ? "You" : "Syndrid"}</span>
        {message.streaming && (
          <span className="streaming-badge">Streaming</span>
        )}
      </div>
      <p>{message.text || (message.streaming ? "…" : "")}</p>
    </article>
  );
});

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
        <ConversationMessageCard key={message.id} message={message} />
      ))}
    </section>
  );
}
