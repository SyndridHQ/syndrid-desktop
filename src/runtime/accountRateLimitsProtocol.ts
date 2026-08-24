// Narrow mirror of the current SyndridCLI v2 account/rateLimits contract.
// SyndridCLI remains authoritative; keep this facade additive until generated
// protocol consumption replaces hand-maintained Desktop request shapes.

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface SpendControlLimitSnapshot {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt: number;
}

export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: CreditsSnapshot | null;
  individualLimit: SpendControlLimitSnapshot | null;
  planType: string | null;
  rateLimitReachedType: string | null;
}

export interface RateLimitResetCreditsSummary {
  availableCount: number;
}

export interface AccountRateLimitsReadResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
  rateLimitResetCredits: RateLimitResetCreditsSummary | null;
}

export interface AccountRateLimitsUpdatedNotification {
  rateLimits: RateLimitSnapshot;
}
