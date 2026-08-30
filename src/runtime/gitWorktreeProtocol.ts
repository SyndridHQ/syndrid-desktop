// Mirrors the generated SyndridCLI v2 git/worktree/list contract from runtime PR #135.
// SyndridCLI remains authoritative for worktree discovery, Git semantics, and bounds.

export const gitWorktreeMethod = "git/worktree/list" as const;

export const MAX_GIT_WORKTREE_ENTRIES = 256;
const MAX_GIT_WORKTREE_PATH_CHARS = 32_768;
const MAX_GIT_WORKTREE_TEXT_CHARS = 32_768;

export interface GitWorktreeListParams {
  cwd: string;
  limit?: number | null;
}

export interface GitWorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  pruneReason: string | null;
  current: boolean;
}

export interface GitWorktreeListResponse {
  entries: GitWorktreeEntry[];
  truncated: boolean;
}

/**
 * Build the explicit worktree inventory request without normalizing the selected
 * native workspace path. SyndridCLI owns repository/path validation and applies
 * the authoritative response bound; Desktop only rejects values that cannot cross
 * the JSON -> Rust string boundary safely.
 */
export function makeGitWorktreeListParams(
  cwd: string,
  limit = MAX_GIT_WORKTREE_ENTRIES,
): GitWorktreeListParams {
  if (cwd.length === 0) {
    throw new Error("Select a workspace before loading Git worktrees.");
  }
  if (cwd.includes("\0") || hasUnpairedUtf16Surrogate(cwd)) {
    throw new Error("The selected workspace path cannot be represented by the Syndrid runtime protocol.");
  }
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_GIT_WORKTREE_ENTRIES) {
    throw new Error(
      `Git worktree inventory limit must be between 0 and ${MAX_GIT_WORKTREE_ENTRIES.toLocaleString()}.`,
    );
  }
  return { cwd, limit };
}

/**
 * Fail closed on malformed runtime inventory data. This validates wire shape only;
 * it deliberately does not infer branch state, resolve paths, inspect .git files,
 * or reproduce any Git semantics owned by SyndridCLI.
 */
export function parseGitWorktreeListResponse(value: unknown): GitWorktreeListResponse {
  if (!isRecord(value) || !Array.isArray(value.entries) || typeof value.truncated !== "boolean") {
    throw new Error("Syndrid runtime returned an invalid git/worktree/list response.");
  }
  if (value.entries.length > MAX_GIT_WORKTREE_ENTRIES) {
    throw new Error("Syndrid runtime returned an unbounded Git worktree inventory.");
  }

  const entries = value.entries.map(parseGitWorktreeEntry);
  return { entries, truncated: value.truncated };
}

function parseGitWorktreeEntry(value: unknown): GitWorktreeEntry {
  if (!isRecord(value)) throw new Error("Syndrid runtime returned an invalid Git worktree entry.");

  const path = boundedString(value.path, MAX_GIT_WORKTREE_PATH_CHARS);
  const head = boundedNullableString(value.head, MAX_GIT_WORKTREE_TEXT_CHARS);
  const branch = boundedNullableString(value.branch, MAX_GIT_WORKTREE_TEXT_CHARS);
  const lockReason = boundedNullableString(value.lockReason, MAX_GIT_WORKTREE_TEXT_CHARS);
  const pruneReason = boundedNullableString(value.pruneReason, MAX_GIT_WORKTREE_TEXT_CHARS);
  const detached = booleanValue(value.detached);
  const bare = booleanValue(value.bare);
  const locked = booleanValue(value.locked);
  const prunable = booleanValue(value.prunable);
  const current = booleanValue(value.current);

  if (
    path === null ||
    head === undefined ||
    branch === undefined ||
    lockReason === undefined ||
    pruneReason === undefined ||
    detached === null ||
    bare === null ||
    locked === null ||
    prunable === null ||
    current === null
  ) {
    throw new Error("Syndrid runtime returned an invalid Git worktree entry.");
  }

  return {
    path,
    head,
    branch,
    detached,
    bare,
    locked,
    lockReason,
    prunable,
    pruneReason,
    current,
  };
}

function boundedString(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  if (hasUnpairedUtf16Surrogate(value) || countUnicodeScalarValues(value) > maxChars) return null;
  return value;
}

function boundedNullableString(value: unknown, maxChars: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.includes("\0")) return undefined;
  if (hasUnpairedUtf16Surrogate(value) || countUnicodeScalarValues(value) > maxChars) return undefined;
  return value;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

function countUnicodeScalarValues(value: string): number {
  let count = 0;
  for (const _codePoint of value) count += 1;
  return count;
}
