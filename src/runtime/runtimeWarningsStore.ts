import { appServerClient } from "./appServerClient";
import type { JsonRpcNotification } from "./protocol";

export const MAX_RETAINED_WARNINGS = 80;
const MAX_WARNING_TITLE_CHARS = 8_192;
const MAX_WARNING_DETAILS_CHARS = 32_768;
const MAX_WARNING_PATH_CHARS = 4_096;

export type WarningKind = "error" | "guardian" | "warning" | "config" | "deprecation";

export interface RuntimeWarningEntry {
  id: number;
  kind: WarningKind;
  title: string;
  details: string | null;
  threadId: string | null;
  path: string | null;
  willRetry: boolean | null;
  receivedAt: number;
  occurrences: number;
}

type Listener = () => void;

let nextId = 1;
let entries: RuntimeWarningEntry[] = [];
const listeners = new Set<Listener>();

export function getRuntimeWarningsSnapshot(): RuntimeWarningEntry[] {
  return entries;
}

export function subscribeRuntimeWarnings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearRuntimeWarnings(): void {
  if (entries.length === 0) return;
  entries = [];
  emitChange();
}

appServerClient.onNotification((notification) => {
  const parsed = parseWarningNotification(notification, nextId++);
  if (!parsed) return;

  const latest = entries[0];
  entries = latest && sameWarning(latest, parsed)
    ? [
        {
          ...latest,
          receivedAt: parsed.receivedAt,
          occurrences: latest.occurrences + 1,
        },
        ...entries.slice(1),
      ]
    : [parsed, ...entries].slice(0, MAX_RETAINED_WARNINGS);
  emitChange();
});

function emitChange(): void {
  for (const listener of listeners) listener();
}

function parseWarningNotification(
  notification: JsonRpcNotification,
  id: number,
): RuntimeWarningEntry | null {
  const params = recordValue(notification.params);
  if (!params) return null;

  const base = {
    id,
    receivedAt: Date.now(),
    occurrences: 1,
  };

  if (notification.method === "warning") {
    const title = boundedString(params.message, MAX_WARNING_TITLE_CHARS);
    return title ? {
      ...base,
      kind: "warning",
      title,
      details: null,
      threadId: nullableString(params.threadId),
      path: null,
      willRetry: null,
    } : null;
  }

  if (notification.method === "guardianWarning") {
    const title = boundedString(params.message, MAX_WARNING_TITLE_CHARS);
    const threadId = stringValue(params.threadId);
    return title && threadId ? {
      ...base,
      kind: "guardian",
      title,
      details: null,
      threadId,
      path: null,
      willRetry: null,
    } : null;
  }

  if (notification.method === "configWarning" || notification.method === "deprecationNotice") {
    const title = boundedString(params.summary, MAX_WARNING_TITLE_CHARS);
    if (!title) return null;
    const isConfig = notification.method === "configWarning";
    return {
      ...base,
      kind: isConfig ? "config" : "deprecation",
      title,
      details: boundedString(params.details, MAX_WARNING_DETAILS_CHARS),
      threadId: null,
      path: isConfig ? boundedString(params.path, MAX_WARNING_PATH_CHARS) : null,
      willRetry: null,
    };
  }

  if (notification.method !== "error") return null;
  const error = recordValue(params.error);
  const title = error ? boundedString(error.message, MAX_WARNING_TITLE_CHARS) : null;
  const threadId = stringValue(params.threadId);
  if (!title || !threadId) return null;
  return {
    ...base,
    kind: "error",
    title,
    details: error ? boundedString(error.additionalDetails, MAX_WARNING_DETAILS_CHARS) : null,
    threadId,
    path: null,
    willRetry: typeof params.willRetry === "boolean" ? params.willRetry : null,
  };
}

function sameWarning(left: RuntimeWarningEntry, right: RuntimeWarningEntry): boolean {
  return left.kind === right.kind
    && left.title === right.title
    && left.details === right.details
    && left.threadId === right.threadId
    && left.path === right.path
    && left.willRetry === right.willRetry;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableString(value: unknown): string | null {
  return stringValue(value);
}

function boundedString(value: unknown, maxChars: number): string | null {
  const text = stringValue(value);
  if (!text) return null;
  return text.length <= maxChars
    ? text
    : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}
