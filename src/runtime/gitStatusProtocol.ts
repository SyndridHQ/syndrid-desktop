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
 * UX-side payload ceilings matching the focused runtime contract from PR #115.
 * SyndridCLI still validates every request authoritatively; Desktop uses these only
 * to keep explicit user actions bounded before they cross the protocol boundary.
 */
export const MAX_GIT_PATH_MUTATION_SELECTION = 256;
export const MAX_GIT_PATH_MUTATION_PATH_CHARS = 32_768;
export const MAX_GIT_PATH_MUTATION_TOTAL_CHARS = 1_048_576;

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

export interface GitPathMutationRequest {
  method: GitPathMutationMethod;
  params: GitPathMutationParams;
}

/**
 * Builds the narrow Desktop mutation payload without trimming, resolving, sorting,
 * de-duplicating, or otherwise rewriting runtime-provided paths. Exact duplicate
 * selections are rejected rather than rewritten so one UI action cannot spend
 * payload budget on redundant work before SyndridCLI applies its own authoritative
 * validation and Git semantics.
 */
export function makeGitPathMutationParams(
  cwd: string,
  paths: readonly string[],
): GitPathMutationParams {
  if (cwd.length === 0) {
    throw new Error("Select a workspace before changing Git index state.");
  }
  if (cwd.includes("\0") || hasUnpairedUtf16Surrogate(cwd)) {
    throw new Error("The selected workspace path cannot be represented by the Syndrid runtime protocol.");
  }
  if (paths.length === 0) {
    throw new Error("Select at least one path before changing Git index state.");
  }
  if (paths.length > MAX_GIT_PATH_MUTATION_SELECTION) {
    throw new Error(
      `Select at most ${MAX_GIT_PATH_MUTATION_SELECTION.toLocaleString()} paths per Git action.`,
    );
  }

  let totalChars = 0;
  const seenPaths = new Set<string>();
  for (const path of paths) {
    if (path.length === 0 || path.includes("\0")) {
      throw new Error("Git mutation paths must be non-empty and cannot contain NUL characters.");
    }
    if (hasUnpairedUtf16Surrogate(path)) {
      throw new Error("Git mutation paths must contain valid Unicode scalar values.");
    }
    if (seenPaths.has(path)) {
      throw new Error("Git mutation selections cannot contain duplicate exact paths.");
    }
    seenPaths.add(path);

    const charCount = countUnicodeScalarValues(path);
    if (charCount > MAX_GIT_PATH_MUTATION_PATH_CHARS) {
      throw new Error(
        `Git mutation paths must be at most ${MAX_GIT_PATH_MUTATION_PATH_CHARS.toLocaleString()} characters.`,
      );
    }
    totalChars += charCount;
    if (totalChars > MAX_GIT_PATH_MUTATION_TOTAL_CHARS) {
      throw new Error(
        `Git mutation paths must total at most ${MAX_GIT_PATH_MUTATION_TOTAL_CHARS.toLocaleString()} characters.`,
      );
    }
  }

  return { cwd, paths: [...paths] };
}

/**
 * Resolves an explicit user intent to the exact runtime wire method and bounded
 * payload. Keeping this in the protocol facade prevents UI surfaces from growing
 * their own Stage/Unstage wire-name or path-rewriting logic.
 */
export function makeGitPathMutationRequest(
  operation: GitPathMutationOperation,
  cwd: string,
  paths: readonly string[],
): GitPathMutationRequest {
  return {
    method: gitPathMutationOperations[operation].method,
    params: makeGitPathMutationParams(cwd, paths),
  };
}

/**
 * Fails closed on malformed mutation results. SyndridCLI's bounded path mutations
 * execute one Git command over the complete accepted path set and return the unique
 * accepted-path count only after that command succeeds. Desktop rejects a smaller
 * acknowledgement so it cannot treat an impossible partial-success shape as a
 * completed Stage/Unstage action and refresh away evidence of a protocol mismatch.
 */
export function parseGitPathMutationResponse(
  value: unknown,
  requestedPathCount: number,
): GitPathMutationResponse {
  if (
    !Number.isSafeInteger(requestedPathCount) ||
    requestedPathCount < 1 ||
    requestedPathCount > MAX_GIT_PATH_MUTATION_SELECTION
  ) {
    throw new Error("Syndrid Desktop supplied an invalid Git mutation request bound.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Syndrid runtime returned an invalid Git mutation response.");
  }
  const updated = (value as Partial<GitPathMutationResponse>).updated;
  if (
    typeof updated !== "number" ||
    !Number.isSafeInteger(updated) ||
    updated !== requestedPathCount
  ) {
    throw new Error("Syndrid runtime returned an incomplete Git mutation acknowledgement.");
  }
  return { updated };
}

/**
 * Rust strings contain only Unicode scalar values. JavaScript strings can also
 * contain isolated UTF-16 surrogate code units, which cannot round-trip as a Rust
 * path string. Reject them before JSON transport so malformed client state cannot
 * turn an explicit Stage/Unstage action into a generic runtime parse failure.
 */
function hasUnpairedUtf16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Rust `str::chars()` counts Unicode scalar values, whereas JavaScript `length`
 * counts UTF-16 code units. Iterate code points so Desktop's transport ceiling
 * matches SyndridCLI for filenames containing supplementary-plane characters.
 */
function countUnicodeScalarValues(value: string): number {
  let count = 0;
  for (const _codePoint of value) count += 1;
  return count;
}
