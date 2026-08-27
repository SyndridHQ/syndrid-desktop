// Mirrors the generated SyndridCLI v2 git/status contract from PR #115.
// SyndridCLI remains authoritative for Git execution and status semantics.
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
