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
const EMPTY_MESSAGES: readonly ConversationMessage[] = [];
const threadListeners = new Map<string, Set<Listener>>();
const threadSnapshots = new Map<string, readonly ConversationMessage[]>();
let messages: readonly ConversationMessage[] = [];

function sameMessages(
  left: readonly ConversationMessage[],
  right: readonly ConversationMessage[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((message, index) => message === right[index]);
}

function publish(next: readonly ConversationMessage[]): void {
  if (next === messages) return;
  messages = next;

  const grouped = new Map<string, ConversationMessage[]>();
  for (const message of next) {
    const bucket = grouped.get(message.threadId);
    if (bucket) {
      bucket.push(message);
    } else {
      grouped.set(message.threadId, [message]);
    }
  }

  const threadIds = new Set([...threadSnapshots.keys(), ...grouped.keys()]);
  for (const threadId of threadIds) {
    const previous = threadSnapshots.get(threadId) ?? EMPTY_MESSAGES;
    const candidate = grouped.get(threadId) ?? EMPTY_MESSAGES;
    if (sameMessages(previous, candidate)) continue;

    if (candidate.length === 0) {
      threadSnapshots.delete(threadId);
    } else {
      threadSnapshots.set(threadId, candidate);
    }
    for (const listener of threadListeners.get(threadId) ?? []) listener();
  }
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
  subscribeThread(threadId: string | null, listener: Listener): () => void {
    if (!threadId) return () => undefined;
    const listeners = threadListeners.get(threadId) ?? new Set<Listener>();
    listeners.add(listener);
    threadListeners.set(threadId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) threadListeners.delete(threadId);
    };
  },

  getThreadSnapshot(threadId: string | null): readonly ConversationMessage[] {
    return threadId ? threadSnapshots.get(threadId) ?? EMPTY_MESSAGES : EMPTY_MESSAGES;
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
