import { memo, useCallback, useSyncExternalStore } from "react";
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
  const subscribe = useCallback(
    (listener: () => void) => conversationStore.subscribeThread(threadId, listener),
    [threadId],
  );
  const getSnapshot = useCallback(
    () => conversationStore.getThreadSnapshot(threadId),
    [threadId],
  );
  const selectedMessages = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  if (selectedMessages.length === 0) return null;

  return (
    <section
      className="message-list"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
      aria-atomic="false"
    >
      {selectedMessages.map((message) => (
        <ConversationMessageCard key={message.id} message={message} />
      ))}
    </section>
  );
}
