// Mirrors the generated SyndridCLI v2 git/status and path-mutation contracts from PR #115.
// SyndridCLI remains authoritative for Git execution, validation, and status semantics.
export type GitStatusCode =
  | "unmodified"
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "unmerged"
  | "untracked"
  | "ignored";

export interface GitStatusEntry {
  path: string;
  previousPath: string | null;
  indexStatus: GitStatusCode;
  worktreeStatus: GitStatusCode;
}

export interface GitStatusParams {
  cwd: string;
  limit?: number | null;
}

export interface GitStatusResponse {
  entries: GitStatusEntry[];
  truncated: boolean;
}

/**
 * Exact repository-relative paths supplied back to SyndridCLI for an explicit
 * stage/unstage operation. The runtime owns all validation and Git semantics;
 * Desktop must preserve these strings rather than normalizing them locally.
 */
export interface GitPathMutationParams {
  cwd: string;
  paths: string[];
}

export interface GitPathMutationResponse {
  updated: number;
}
