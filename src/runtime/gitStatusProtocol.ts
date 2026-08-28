// Mirrors the generated SyndridCLI v2 git/status and path-mutation contracts from PR #115.
// SyndridCLI remains authoritative for Git execution, validation, and status semantics.
export const gitStatusMethods = {
  status: "git/status",
  stage: "git/stage",
  unstage: "git/unstage",
} as const;

export type GitStatusMethod = (typeof gitStatusMethods)[keyof typeof gitStatusMethods];
export type GitPathMutationMethod =
  | typeof gitStatusMethods.stage
  | typeof gitStatusMethods.unstage;
export type GitPathMutationOperation = "stage" | "unstage";

/**
 * UX-side selection ceiling matching the focused runtime contract from PR #115.
 * SyndridCLI still validates every request authoritatively; Desktop uses this only
 * to keep explicit user actions bounded before they cross the protocol boundary.
 */
export const MAX_GIT_PATH_MUTATION_SELECTION = 256;

export const gitPathMutationOperations: Readonly<
  Record<GitPathMutationOperation, { method: GitPathMutationMethod; label: string }>
> = {
  stage: { method: gitStatusMethods.stage, label: "Stage" },
  unstage: { method: gitStatusMethods.unstage, label: "Unstage" },
};

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

/**
 * Builds the narrow Desktop mutation payload without trimming, resolving, sorting,
 * de-duplicating, or otherwise rewriting runtime-provided paths. SyndridCLI remains
 * authoritative for repository-relative path validation and Git behavior.
 */
export function makeGitPathMutationParams(
  cwd: string,
  paths: readonly string[],
): GitPathMutationParams {
  if (paths.length === 0) {
    throw new Error("Select at least one path before changing Git index state.");
  }
  if (paths.length > MAX_GIT_PATH_MUTATION_SELECTION) {
    throw new Error(
      `Select at most ${MAX_GIT_PATH_MUTATION_SELECTION.toLocaleString()} paths per Git action.`,
    );
  }
  return { cwd, paths: [...paths] };
}
