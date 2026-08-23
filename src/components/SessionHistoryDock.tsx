import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ThreadSummary } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./sessionHistoryDock.css";

const PAGE_SIZE = 40;
const MAX_RETAINED_THREADS = 160;

export function SessionHistoryDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [scopeWorkspace, setScopeWorkspace] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (append = false) => {
      if (loading) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before loading session history.");
        return;
      }

      const requestGeneration = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const result = await appServerClient.listThreads({
          cursor: append ? cursor : null,
          limit: PAGE_SIZE,
          archived: false,
          sortKey: "updated_at",
          sortDirection: "desc",
          cwd: scopeWorkspace && workspace?.cwd ? workspace.cwd : null,
          searchTerm: submittedQuery || null,
        });
        if (requestGeneration !== generation.current) return;
        setThreads((current) =>
          (append ? [...current, ...result.data] : result.data).slice(
            0,
            MAX_RETAINED_THREADS,
          ),
        );
        setCursor(result.nextCursor);
      } catch (cause) {
        if (requestGeneration !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (requestGeneration === generation.current) setLoading(false);
      }
    },
    [cursor, loading, scopeWorkspace, submittedQuery, workspace?.cwd],
  );

  useEffect(() => {
    generation.current += 1;
    setThreads([]);
    setCursor(null);
    setError(null);
    if (open) void load(false);
    // `load` intentionally stays out of this dependency list: workspace/scope
    // changes invalidate and issue exactly one fresh explicit panel read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeWorkspace, workspace?.threadId, workspace?.cwd]);

  const visibleThreads = useMemo(
    () => dedupeThreads(threads),
    [threads],
  );

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    generation.current += 1;
    setThreads([]);
    setCursor(null);
    setSubmittedQuery(query.trim());
    queueMicrotask(() => void load(false));
  };

  return (
    <aside className="session-history-dock" aria-label="Session history">
      <button
        className="session-history-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden="true">◷</span>
        History
        {visibleThreads.length > 0 && <span>{visibleThreads.length}</span>}
      </button>

      {open && (
        <section className="session-history-panel">
          <header>
            <span>
              <strong>Session history</strong>
              <small title={workspace?.cwd}>
                {scopeWorkspace
                  ? workspace?.cwd || "Selected workspace"
                  : "All active workspaces"}
              </small>
            </span>
            <button disabled={loading} onClick={() => void load(false)} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </header>

          <form className="session-history-search" onSubmit={submitSearch}>
            <input
              aria-label="Search sessions"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search session history…"
              value={query}
            />
            <button disabled={loading} type="submit">Search</button>
          </form>

          <label className="session-history-scope">
            <input
              checked={scopeWorkspace}
              disabled={!workspace?.cwd}
              onChange={(event) => setScopeWorkspace(event.target.checked)}
              type="checkbox"
            />
            Only this workspace
          </label>

          {error ? (
            <div className="session-history-state error">{error}</div>
          ) : loading && visibleThreads.length === 0 ? (
            <div className="session-history-state">Loading runtime sessions…</div>
          ) : visibleThreads.length === 0 ? (
            <div className="session-history-state">No matching active sessions.</div>
          ) : (
            <div className="session-history-list">
              {visibleThreads.map((thread) => (
                <ThreadRow
                  current={thread.id === workspace?.threadId}
                  key={thread.id}
                  thread={thread}
                />
              ))}
              {cursor && threads.length < MAX_RETAINED_THREADS && (
                <button
                  className="session-history-more"
                  disabled={loading}
                  onClick={() => void load(true)}
                  type="button"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          )}

          <footer>
            Runtime-backed · explicit pagination · retains at most {MAX_RETAINED_THREADS} sessions
          </footer>
        </section>
      )}
    </aside>
  );
}

function ThreadRow({
  current,
  thread,
}: {
  current: boolean;
  thread: ThreadSummary;
}) {
  const title = thread.name?.trim() || thread.preview?.trim() || "Untitled session";
  return (
    <article className={`session-history-row${current ? " current" : ""}`}>
      <div>
        <strong title={title}>{title}</strong>
        {current && <span>Current</span>}
      </div>
      <small title={thread.cwd}>{thread.cwd || "No workspace"}</small>
      <div className="session-history-meta">
        <code>{thread.id.slice(0, 10)}</code>
        <span>{thread.modelProvider || "provider unknown"}</span>
        <time dateTime={new Date(thread.updatedAt * 1000).toISOString()}>
          {formatRelativeTime(thread.updatedAt)}
        </time>
      </div>
    </article>
  );
}

function dedupeThreads(threads: ThreadSummary[]): ThreadSummary[] {
  const seen = new Set<string>();
  return threads.filter((thread) => {
    if (seen.has(thread.id)) return false;
    seen.add(thread.id);
    return true;
  });
}

function formatRelativeTime(timestampSeconds: number): string {
  const deltaSeconds = Math.max(0, Math.round(Date.now() / 1000 - timestampSeconds));
  if (deltaSeconds < 60) return "now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86_400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86_400)}d ago`;
}
