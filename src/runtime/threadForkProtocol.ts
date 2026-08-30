import type { ThreadSummary } from "./protocol";

/**
 * Narrow Desktop projection of SyndridCLI's generated v2 thread/fork contract.
 * Desktop intentionally exposes only the non-destructive source selection used
 * by the current control surface; runtime configuration remains inherited.
 */
export interface ThreadForkParams {
  threadId: string;
  /** Optional inclusive turn boundary for future checkpoint-style UI. */
  lastTurnId?: string | null;
}

export interface ThreadForkResponse {
  thread: ThreadSummary;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: string;
  instructionSources: string[];
  approvalPolicy: unknown;
  approvalsReviewer: unknown;
  sandbox: unknown;
  reasoningEffort: unknown | null;
}
