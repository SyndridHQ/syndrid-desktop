import type {
  AgentMessageDeltaNotification,
  ThreadSummary,
} from "./protocol";

export interface ConversationMessage {
  id: string;
  threadId: string;
  turnId: string | null;
  role: "user" | "assistant";
  text: string;
  streaming: boolean;
}

type Listener = () => void;

const MAX_MESSAGES = 200;
const listeners = new Set<Listener>();
let messages: readonly ConversationMessage[] = [];

function publish(next: readonly ConversationMessage[]): void {
  if (next === messages) return;
  messages = next;
  for (const listener of listeners) listener();
}

function trimConversation(
  next: readonly ConversationMessage[],
): readonly ConversationMessage[] {
  return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextUserInput(
  value: unknown,
): value is { type: "text"; text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function messagesFromThread(thread: ThreadSummary): ConversationMessage[] {
  const history: ConversationMessage[] = [];

  for (const rawTurn of thread.turns) {
    if (!isRecord(rawTurn) || typeof rawTurn.id !== "string") continue;
    if (!Array.isArray(rawTurn.items)) continue;

    for (const rawItem of rawTurn.items) {
      if (!isRecord(rawItem) || typeof rawItem.id !== "string") continue;

      if (rawItem.type === "userMessage" && Array.isArray(rawItem.content)) {
        const text = rawItem.content
          .filter(isTextUserInput)
          .map((item) => item.text)
          .join("\n");
        if (!text) continue;

        history.push({
          id:
            typeof rawItem.clientId === "string"
              ? rawItem.clientId
              : `user-${rawItem.id}`,
          threadId: thread.id,
          turnId: rawTurn.id,
          role: "user",
          text,
          streaming: false,
        });
        continue;
      }

      if (rawItem.type === "agentMessage" && typeof rawItem.text === "string") {
        history.push({
          id: `assistant-${rawItem.id}`,
          threadId: thread.id,
          turnId: rawTurn.id,
          role: "assistant",
          text: rawItem.text,
          streaming: false,
        });
      }
    }
  }

  return history;
}

function mergeThreadHistory(
  current: readonly ConversationMessage[],
  history: readonly ConversationMessage[],
  threadId: string,
): readonly ConversationMessage[] {
  const otherThreads = current.filter((message) => message.threadId !== threadId);
  const liveThreadMessages = current.filter(
    (message) => message.threadId === threadId,
  );
  const merged = new Map<string, ConversationMessage>();

  for (const message of history) merged.set(message.id, message);
  for (const message of liveThreadMessages) merged.set(message.id, message);

  return trimConversation([...otherThreads, ...merged.values()]);
}

function applyAgentDeltasToMessages(
  current: readonly ConversationMessage[],
  deltas: readonly AgentMessageDeltaNotification[],
): readonly ConversationMessage[] {
  if (deltas.length === 0) return current;

  const next = [...current];
  const indexById = new Map(next.map((message, index) => [message.id, index]));

  for (const delta of deltas) {
    const id = `assistant-${delta.itemId}`;
    const index = indexById.get(id);
    if (index === undefined) {
      indexById.set(id, next.length);
      next.push({
        id,
        threadId: delta.threadId,
        turnId: delta.turnId,
        role: "assistant",
        text: delta.delta,
        streaming: true,
      });
      continue;
    }

    const existing = next[index];
    if (!existing) continue;
    next[index] = {
      ...existing,
      text: `${existing.text}${delta.delta}`,
      streaming: true,
    };
  }

  return trimConversation(next);
}

export const conversationStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): readonly ConversationMessage[] {
    return messages;
  },

  mergeThread(thread: ThreadSummary): void {
    publish(
      mergeThreadHistory(messages, messagesFromThread(thread), thread.id),
    );
  },

  addUserMessage(message: ConversationMessage): void {
    publish(trimConversation([...messages, message]));
  },

  applyAgentDeltas(deltas: readonly AgentMessageDeltaNotification[]): void {
    publish(applyAgentDeltasToMessages(messages, deltas));
  },

  markTurnComplete(threadId: string, turnId: string): void {
    let changed = false;
    const next = messages.map((message) => {
      if (
        message.threadId !== threadId ||
        message.turnId !== turnId ||
        !message.streaming
      ) {
        return message;
      }
      changed = true;
      return { ...message, streaming: false };
    });
    if (changed) publish(next);
  },
};
