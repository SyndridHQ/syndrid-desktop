export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadGoalGetParams {
  threadId: string;
}

export interface ThreadGoalGetResponse {
  goal: ThreadGoal | null;
}

export interface ThreadGoalSetParams {
  threadId: string;
  objective?: string | null;
  status?: ThreadGoalStatus | null;
  tokenBudget?: number | null;
}

export interface ThreadGoalSetResponse {
  goal: ThreadGoal;
}

export interface ThreadGoalClearParams {
  threadId: string;
}

export interface ThreadGoalClearResponse {
  cleared: boolean;
}
