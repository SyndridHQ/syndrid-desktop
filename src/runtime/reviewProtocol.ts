import type { TurnSummary } from "./protocol";

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title: string | null }
  | { type: "custom"; instructions: string };

export type ReviewDelivery = "inline" | "detached";

export interface ReviewStartParams {
  threadId: string;
  target: ReviewTarget;
  delivery?: ReviewDelivery | null;
}

export interface ReviewStartResponse {
  turn: TurnSummary;
  reviewThreadId: string;
}
