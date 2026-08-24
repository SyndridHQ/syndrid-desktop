// Narrow mirror of SyndridCLI's current v2 account rate-limit contract.
// The runtime remains authoritative for account/provider limits; Desktop only
// retains and presents the snapshot/deltas it receives.

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
