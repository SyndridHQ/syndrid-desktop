import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { GitStatusCode, GitStatusEntry } from "../runtime/gitStatusProtocol";
import { notifications, type TurnDiffUpdatedNotification } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./gitStatusPanel.css";

const MAX_STATUS_ENTRIES = 2_500;
const MAX_ROWS_PER_GROUP = 60;
const MAX_EXACT_STATUS_PATH_CHARS = 32_768;
const MAX_STATUS_PATH_CHARS = 4_096;
const MAX_FILTER_CHARS = 512;
const MAX_ERROR_CHARS = 8_192;

interface RetainedGitStatusEntry extends GitStatusEntry {
  displayPath: string;
  displayPreviousPath: string | null;
}

interface StatusGroups {
  conflicts: RetainedGitStatusEntry[];
  untracked: RetainedGitStatusEntry[];
  staged: RetainedGitStatusEntry[];
  unstaged: RetainedGitStatusEntry[];
}

export function GitStatusPanel() {
  const workspace = useRuntimeWorkspace();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [entries, setEntries] = useState<RetainedGitStatusEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidationVersion = useRef(0);

  useEffect(() => {
    generation.current += 1;
    invalidationVersion.current = 0;
    setLoading(false);
    setLoaded(false);
    setStale(false);
    setEntries([]);
    setFilter("");
    setTruncated(false);
    setError(null);
    return () => {
      generation.current += 1;
    };
  }, [workspace?.threadId, workspace?.cwd]);

  useEffect(() => {
    if (!loaded || !workspace?.threadId) return;
    return appServerClient.onNotification((notification) => {
      if (notification.method !== notifications.turnDiffUpdated) return;
      const event = notification.params as TurnDiffUpdatedNotification | undefined;
      if (event?.threadId === workspace.threadId) {
        invalidationVersion.current += 1;
        setStale(true);
      }
    });
  }, [loaded, workspace?.threadId]);

  const loadStatus = useCallback(async () => {
    const cwd = workspace?.cwd;
    const threadId = workspace?.threadId;
    if (!cwd || !threadId || loading) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before loading repository status.");
      return;
    }

    const requestGeneration = ++generation.current;
    const requestInvalidationVersion = invalidationVersion.current;
    setLoading(true);
    setError(null);
    try {
      const result = await appServerClient.gitStatus({ cwd, limit: MAX_STATUS_ENTRIES });
      const selected = appServerClient.getWorkspaceSnapshot();
      if (
        requestGeneration !== generation.current ||
        selected?.threadId !== threadId ||
        selected?.cwd !== cwd
      ) {
        return;
      }

      if (!Array.isArray(result.entries) || typeof result.truncated !== "boolean") {
        throw new Error("Syndrid runtime returned an invalid git/status response.");
      }
      const sourceEntries = result.entries;
      const projectedEntries = sourceEntries
        .slice(0, MAX_STATUS_ENTRIES)
        .map(projectGitStatusEntry);
      if (projectedEntries.some((entry) => entry === null)) {
        throw new Error("Syndrid runtime returned an invalid git/status entry.");
      }
      const retained = projectedEntries.filter(
        (entry): entry is RetainedGitStatusEntry => entry !== null,
      );
      setEntries(retained);
      setTruncated(result.truncated || sourceEntries.length > MAX_STATUS_ENTRIES);
      setStale(invalidationVersion.current !== requestInvalidationVersion);
      setLoaded(true);
    } catch (cause) {
      const selected = appServerClient.getWorkspaceSnapshot();
      if (
        requestGeneration === generation.current &&
        selected?.threadId === threadId &&
        selected?.cwd === cwd
      ) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(truncateText(message, MAX_ERROR_CHARS));
      }
    } finally {
      const selected = appServerClient.getWorkspaceSnapshot();
      if (
        requestGeneration === generation.current &&
        selected?.threadId === threadId &&
        selected?.cwd === cwd
      ) {
        setLoading(false);
      }
    }
  }, [loading, workspace?.cwd, workspace?.threadId]);

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredEntries = useMemo(
    () =>
      normalizedFilter
        ? entries.filter((entry) =>
            entry.displayPath.toLowerCase().includes(normalizedFilter) ||
            (entry.displayPreviousPath?.toLowerCase().includes(normalizedFilter) ?? false),
          )
        : entries,
    [entries, normalizedFilter],
  );
  const groups = useMemo(() => groupStatusEntries(filteredEntries), [filteredEntries]);
  const meaningfulCount =
    groups.conflicts.length +
    groups.untracked.length +
    groups.staged.length +
    groups.unstaged.length;
  const statusSummary = formatStatusSummary(groups, entries.length);

  return (
    <section className="git-status-panel" aria-label="Working tree status">
      <header>
        <span>
          <strong>Index & working tree</strong>
          <small>
            {stale
              ? "Runtime reports newer turn changes · refresh explicitly"
              : loaded
                ? normalizedFilter
                  ? `${filteredEntries.length.toLocaleString()} of ${entries.length.toLocaleString()} status records match`
                  : statusSummary
                : "Explicit runtime read · no polling"}
          </small>
        </span>
        <button disabled={loading} onClick={() => void loadStatus()} type="button">
          {loading ? "Loading…" : loaded ? (stale ? "Refresh · updated" : "Refresh") : "Load status"}
        </button>
      </header>

      {loaded && entries.length > 0 && (
        <div className="git-status-filter">
          <input
            aria-label="Filter working tree status by path"
            maxLength={MAX_FILTER_CHARS}
            onChange={(event) => setFilter(event.target.value.slice(0, MAX_FILTER_CHARS))}
            placeholder="Filter status paths…"
            spellCheck={false}
            value={filter}
          />
          {filter && (
            <button onClick={() => setFilter("")} type="button">
              Clear
            </button>
          )}
        </div>
      )}

      {error ? (
        <div className="git-status-state error">{error}</div>
      ) : loading && !loaded ? (
        <div className="git-status-state">Reading index and working tree in SyndridCLI…</div>
      ) : !loaded ? (
        <div className="git-status-state compact">
          Status loading is explicit so opening Source Control performs no repository scan.
        </div>
      ) : meaningfulCount === 0 ? (
        <div className="git-status-state compact">
          {normalizedFilter ? "No status records match this path filter." : "Working tree is clean."}
        </div>
      ) : (
        <div className="git-status-groups">
          <StatusGroup label="Conflicts" entries={groups.conflicts} side="conflict" />
          <StatusGroup label="Untracked" entries={groups.untracked} side="untracked" />
          <StatusGroup label="Staged" entries={groups.staged} side="index" />
          <StatusGroup label="Unstaged" entries={groups.unstaged} side="worktree" />
        </div>
      )}

      {loaded && truncated && (
        <div className="git-status-state compact">
          Runtime status is truncated at {MAX_STATUS_ENTRIES.toLocaleString()} records.
        </div>
      )}
    </section>
  );
}

function StatusGroup({
  label,
  entries,
  side,
}: {
  label: string;
  entries: RetainedGitStatusEntry[];
  side: "conflict" | "untracked" | "index" | "worktree";
}) {
  const [pageStart, setPageStart] = useState(0);

  useEffect(() => {
    setPageStart(0);
  }, [entries]);

  if (entries.length === 0) return null;
  const lastPageStart = Math.max(
    0,
    Math.floor((entries.length - 1) / MAX_ROWS_PER_GROUP) * MAX_ROWS_PER_GROUP,
  );
  const safePageStart = Math.min(pageStart, lastPageStart);
  const pageEnd = Math.min(entries.length, safePageStart + MAX_ROWS_PER_GROUP);
  const visible = entries.slice(safePageStart, pageEnd);
  const hasPrevious = safePageStart > 0;
  const hasNext = pageEnd < entries.length;
  const pageNumber = Math.floor(safePageStart / MAX_ROWS_PER_GROUP) + 1;
  const pageCount = Math.ceil(entries.length / MAX_ROWS_PER_GROUP);

  return (
    <section className="git-status-group" aria-label={`${label} files`}>
      <header>
        <strong>{label}</strong>
        <span>{entries.length.toLocaleString()}</span>
      </header>
      <div className="git-status-list">
        {visible.map((entry, index) => {
          const status = statusForSide(entry, side);
          const title = entry.displayPreviousPath
            ? `${entry.displayPreviousPath} → ${entry.displayPath}`
            : entry.displayPath;
          return (
            <div className="git-status-row" key={`${safePageStart + index}:${entry.path}`} title={title}>
              <b aria-label={statusLabel(status)}>{statusShortLabel(status)}</b>
              <span>
                {entry.displayPreviousPath
                  ? `${entry.displayPreviousPath} → ${entry.displayPath}`
                  : entry.displayPath}
              </span>
            </div>
          );
        })}
      </div>
      {entries.length > MAX_ROWS_PER_GROUP && (
        <div className="git-status-limit">
          <small aria-live="polite">
            Page {pageNumber.toLocaleString()} of {pageCount.toLocaleString()} · showing{" "}
            {(safePageStart + 1).toLocaleString()}–{pageEnd.toLocaleString()} of{" "}
            {entries.length.toLocaleString()}.
          </small>
          <span className="git-status-page-controls" aria-label={`${label} status pagination`} role="group">
            <button
              aria-label={`First ${label.toLowerCase()} page`}
              disabled={!hasPrevious}
              onClick={() => setPageStart(0)}
              type="button"
            >
              First
            </button>
            <button
              aria-label={`Previous ${label.toLowerCase()} page`}
              disabled={!hasPrevious}
              onClick={() => setPageStart(Math.max(0, safePageStart - MAX_ROWS_PER_GROUP))}
              type="button"
            >
              Previous
            </button>
            <button
              aria-label={`Next ${label.toLowerCase()} page`}
              disabled={!hasNext}
              onClick={() => setPageStart(Math.min(lastPageStart, safePageStart + MAX_ROWS_PER_GROUP))}
              type="button"
            >
              Next
            </button>
            <button
              aria-label={`Last ${label.toLowerCase()} page`}
              disabled={!hasNext}
              onClick={() => setPageStart(lastPageStart)}
              type="button"
            >
              Last
            </button>
          </span>
        </div>
      )}
    </section>
  );
}

function groupStatusEntries(entries: RetainedGitStatusEntry[]): StatusGroups {
  const groups: StatusGroups = { conflicts: [], untracked: [], staged: [], unstaged: [] };
  for (const entry of entries) {
    if (entry.indexStatus === "unmerged" || entry.worktreeStatus === "unmerged") {
      groups.conflicts.push(entry);
      continue;
    }
    if (entry.indexStatus === "untracked" || entry.worktreeStatus === "untracked") {
      groups.untracked.push(entry);
      continue;
    }
    if (isMeaningfulStatus(entry.indexStatus)) groups.staged.push(entry);
    if (isMeaningfulStatus(entry.worktreeStatus)) groups.unstaged.push(entry);
  }
  return groups;
}

function formatStatusSummary(groups: StatusGroups, recordCount: number): string {
  const parts = [`${recordCount.toLocaleString()} records`];
  if (groups.conflicts.length > 0) parts.push(`${groups.conflicts.length.toLocaleString()} conflicts`);
  if (groups.staged.length > 0) parts.push(`${groups.staged.length.toLocaleString()} staged`);
  if (groups.unstaged.length > 0) parts.push(`${groups.unstaged.length.toLocaleString()} unstaged`);
  if (groups.untracked.length > 0) parts.push(`${groups.untracked.length.toLocaleString()} untracked`);
  return parts.join(" · ");
}

function isMeaningfulStatus(status: GitStatusCode): boolean {
  return status !== "unmodified" && status !== "ignored";
}

function statusForSide(
  entry: GitStatusEntry,
  side: "conflict" | "untracked" | "index" | "worktree",
): GitStatusCode {
  if (side === "conflict") return "unmerged";
  if (side === "untracked") return "untracked";
  return side === "index" ? entry.indexStatus : entry.worktreeStatus;
}

function statusShortLabel(status: GitStatusCode): string {
  switch (status) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    case "unmerged": return "U";
    case "untracked": return "?";
    case "ignored": return "I";
    case "unmodified": return "·";
  }
}

function statusLabel(status: GitStatusCode): string {
  switch (status) {
    case "modified": return "Modified";
    case "added": return "Added";
    case "deleted": return "Deleted";
    case "renamed": return "Renamed";
    case "copied": return "Copied";
    case "unmerged": return "Conflict";
    case "untracked": return "Untracked";
    case "ignored": return "Ignored";
    case "unmodified": return "Unmodified";
  }
}

function projectGitStatusEntry(value: unknown): RetainedGitStatusEntry | null {
  if (!isGitStatusEntry(value)) return null;
  if (
    value.path.length > MAX_EXACT_STATUS_PATH_CHARS ||
    (value.previousPath?.length ?? 0) > MAX_EXACT_STATUS_PATH_CHARS
  ) {
    return null;
  }
  return {
    path: value.path,
    previousPath: value.previousPath,
    displayPath: truncateText(value.path, MAX_STATUS_PATH_CHARS),
    displayPreviousPath: value.previousPath === null
      ? null
      : truncateText(value.previousPath, MAX_STATUS_PATH_CHARS),
    indexStatus: value.indexStatus,
    worktreeStatus: value.worktreeStatus,
  };
}

function isGitStatusEntry(value: unknown): value is GitStatusEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<GitStatusEntry>;
  return (
    typeof entry.path === "string" &&
    (entry.previousPath === null || typeof entry.previousPath === "string") &&
    isGitStatusCode(entry.indexStatus) &&
    isGitStatusCode(entry.worktreeStatus)
  );
}

function isGitStatusCode(value: unknown): value is GitStatusCode {
  return (
    value === "unmodified" ||
    value === "modified" ||
    value === "added" ||
    value === "deleted" ||
    value === "renamed" ||
    value === "copied" ||
    value === "unmerged" ||
    value === "untracked" ||
    value === "ignored"
  );
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
