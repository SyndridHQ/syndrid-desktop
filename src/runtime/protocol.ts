/**
 * Narrow desktop-side protocol facade for the first vertical slice.
 *
 * Method names and initialization semantics are verified against
 * SyndridHQ/syndridcli main at f7c52d2332c2854d177c26e3e2edcd9e979d5602.
 * The authoritative generated TypeScript schema lives in
 * codex-rs/app-server-protocol/schema/typescript and will be vendored/generated
 * as the desktop protocol surface expands.
 */

export type RequestId = number;

export interface JsonRpcRequest<TParams = unknown> {
  method: string;
  id: RequestId;
  params: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  id: RequestId;
  result: TResult;
}

export interface JsonRpcFailure {
  id: RequestId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<TResult = unknown> = JsonRpcSuccess<TResult> | JsonRpcFailure;

export interface InitializeParams {
  clientInfo: {
    name: string;
    title: string;
    version: string;
  };
  capabilities: null;
}

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface ThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  archived?: boolean | null;
  cwd?: string | string[] | null;
  searchTerm?: string | null;
  useStateDbOnly?: boolean;
}

export interface ThreadSummary {
  id: string;
  sessionId: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  name: string | null;
  status: unknown;
}

export interface ThreadListResponse {
  data: ThreadSummary[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface ThreadReadParams {
  threadId: string;
  includeTurns?: boolean;
}

export interface ThreadReadResponse {
  thread: ThreadSummary;
}

export interface ThreadResumeParams {
  threadId: string;
}

export interface ThreadResumeResponse {
  thread: ThreadSummary;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: string;
}

export const methods = {
  initialize: "initialize",
  threadList: "thread/list",
  threadRead: "thread/read",
  threadResume: "thread/resume",
} as const;
