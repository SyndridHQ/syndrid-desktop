import { appServerClient, type RuntimeServerRequest } from "./appServerClient";

const TOOL_USER_INPUT = "item/tool/requestUserInput";
const SERVER_REQUEST_RESOLVED = "serverRequest/resolved";

export interface RuntimeInputEntry {
  request: RuntimeServerRequest;
  threadId: string;
}

type Listener = () => void;

let entries: RuntimeInputEntry[] = [];
const listeners = new Set<Listener>();

export function getRuntimeInputSnapshot(): RuntimeInputEntry[] {
  return entries;
}

export function subscribeRuntimeInput(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function removeRuntimeInput(requestId: RuntimeServerRequest["id"]): void {
  const next = entries.filter((entry) => entry.request.id !== requestId);
  if (next.length === entries.length) return;
  entries = next;
  emitChange();
}

appServerClient.onServerRequest((request) => {
  const entry = captureRuntimeInput(request);
  if (!entry) return false;

  if (!entries.some((current) => current.request.id === request.id)) {
    entries = [...entries, entry];
    emitChange();
  }
  return true;
});

appServerClient.onNotification((notification) => {
  if (notification.method !== SERVER_REQUEST_RESOLVED || !isRecord(notification.params)) {
    return;
  }
  const requestId = notification.params.requestId;
  if (!isRequestId(requestId)) return;
  removeRuntimeInput(requestId);
});

function captureRuntimeInput(request: RuntimeServerRequest): RuntimeInputEntry | null {
  if (request.method !== TOOL_USER_INPUT || !isRecord(request.params)) return null;

  const threadId = stringValue(request.params.threadId);
  const turnId = stringValue(request.params.turnId);
  const itemId = stringValue(request.params.itemId);
  const questions = request.params.questions;
  if (!threadId || !turnId || !itemId || !Array.isArray(questions)) return null;
  if (!questions.some(isValidQuestion)) return null;

  return { request, threadId };
}

function isValidQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Boolean(
    stringValue(value.id)
    && stringValue(value.header)
    && stringValue(value.question),
  );
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is RuntimeServerRequest["id"] {
  return typeof value === "string" || typeof value === "number";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
