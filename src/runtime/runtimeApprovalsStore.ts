import { appServerClient, type RuntimeServerRequest } from "./appServerClient";

const COMMAND_APPROVAL = "item/commandExecution/requestApproval";
const FILE_APPROVAL = "item/fileChange/requestApproval";
const PERMISSIONS_APPROVAL = "item/permissions/requestApproval";
const SERVER_REQUEST_RESOLVED = "serverRequest/resolved";

export interface RuntimeApprovalEntry {
  request: RuntimeServerRequest;
  threadId: string;
}

type Listener = () => void;

let entries: RuntimeApprovalEntry[] = [];
const listeners = new Set<Listener>();

export function getRuntimeApprovalsSnapshot(): RuntimeApprovalEntry[] {
  return entries;
}

export function subscribeRuntimeApprovals(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function removeRuntimeApproval(requestId: RuntimeServerRequest["id"]): void {
  const next = entries.filter((entry) => entry.request.id !== requestId);
  if (next.length === entries.length) return;
  entries = next;
  emitChange();
}

appServerClient.onServerRequest((request) => {
  const entry = captureApproval(request);
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
  removeRuntimeApproval(requestId);
});

function captureApproval(request: RuntimeServerRequest): RuntimeApprovalEntry | null {
  if (
    request.method !== COMMAND_APPROVAL
    && request.method !== FILE_APPROVAL
    && request.method !== PERMISSIONS_APPROVAL
  ) {
    return null;
  }
  if (!isRecord(request.params)) return null;

  const threadId = stringValue(request.params.threadId);
  const turnId = stringValue(request.params.turnId);
  const itemId = stringValue(request.params.itemId);
  if (!threadId || !turnId || !itemId) return null;

  return { request, threadId };
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
