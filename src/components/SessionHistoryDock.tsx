import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ThreadSummary } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./sessionHistoryDock.css";

const PAGE_SIZE = 40;
const MAX_RETAINED_THREADS = 160;
type HistoryKind = "active" | "archived";

export function SessionHistoryDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutatingThreadId, setMutatingThreadId] = useState<string | null>(null);
  const [inspectingThreadId, setInspectingThreadId] = useState<string | null>(null);
  const [inspectedThread, setInspectedThread] = useState<ThreadSummary | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [scopeWorkspace, setScopeWorkspace] = useState(true);
  const [historyKind, setHistoryKind] = useState<HistoryKind>("active");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inspectionGeneration = useRef(0);

  const load = useCallback(
    async (append = false) => {
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
          archived: historyKind === "archived",
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
    [cursor, historyKind, scopeWorkspace, submittedQuery, workspace?.cwd],
  );

  useEffect(() => {
    generation.current += 1;
    inspectionGeneration.current += 1;
    setThreads([]);
    setCursor(null);
    setError(null);
    setMutatingThreadId(null);
    setInspectedThread(null);
    setInspectingThreadId(null);
    if (open) void load(false);
    // Workspace/scope/history-kind changes invalidate and issue exactly one
    // fresh panel read. The callback from this render carries those values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKind, open, scopeWorkspace, workspace?.threadId, workspace?.cwd]);

  useEffect(() => {
    if (!open) return;
    generation.current += 1;
    inspectionGeneration.current += 1;
    setThreads([]);
    setCursor(null);
    setError(null);
    setMutatingThreadId(null);
    setInspectedThread(null);
    setInspectingThreadId(null);
    void load(false);
    // The submitted query is the trigger; the callback from this render carries
    // that exact query and avoids issuing requests for each input keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedQuery]);

  const visibleThreads = useMemo(() => dedupeThreads(threads), [threads]);
  const normalizedQuery = query.trim();

  const inspectThread = useCallback(async (thread: ThreadSummary) => {
    if (inspectingThreadId) return;
    const requestGeneration = ++inspectionGeneration.current;
    setInspectingThreadId(thread.id);
    setError(null);
    try {
      const result = await appServerClient.inspectThread({
        threadId: thread.id,
        includeTurns: false,
      });
      if (requestGeneration !== inspectionGeneration.current) return;
      setInspectedThread(result.thread);
    } catch (cause) {
      if (requestGeneration !== inspectionGeneration.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === inspectionGeneration.current) {
        setInspectingThreadId(null);
      }
    }
  }, [inspectingThreadId]);

  const mutateThread = useCallback(
    async (thread: ThreadSummary) => {
      if (mutatingThreadId) return;
      if (historyKind === "active" && thread.id === workspace?.threadId) {
        setError("The currently selected session cannot be archived from History.");
        return;
      }

      const requestGeneration = generation.current;
      inspectionGeneration.current += 1;
      setInspectingThreadId(null);
      if (inspectedThread?.id === thread.id) setInspectedThread(null);
      setMutatingThreadId(thread.id);
      setError(null);
      try {
        if (historyKind === "archived") {
          await appServerClient.unarchiveThread({ threadId: thread.id });
        } else {
          await appServerClient.archiveThread({ threadId: thread.id });
        }
        if (requestGeneration !== generation.current) return;
        setThreads((current) => current.filter((item) => item.id !== thread.id));
      } catch (cause) {
        if (requestGeneration !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (requestGeneration === generation.current) setMutatingThreadId(null);
      }
    },
    [historyKind, inspectedThread?.id, mutatingThreadId, workspace?.threadId],
  );

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized === submittedQuery) {
      void load(false);
      return;
    }
    setSubmittedQuery(normalized);
  };

  const clearSearch = () => {
    setQuery("");
    if (submittedQuery) setSubmittedQuery("");
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
                  : "All workspaces"}
              </small>
            </span>
            <button disabled={loading} onClick={() => void load(false)} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </header>

          <div className="session-history-kind" role="group" aria-label="Session history type">
            <button
              aria-pressed={historyKind === "active"}
              className={historyKind === "active" ? "selected" : ""}
              disabled={loading || Boolean(mutatingThreadId)}
              onClick={() => setHistoryKind("active")}
              type="button"
            >
              Active
            </button>
            <button
              aria-pressed={historyKind === "archived"}
              className={historyKind === "archived" ? "selected" : ""}
              disabled={loading || Boolean(mutatingThreadId)}
              onClick={() => setHistoryKind("archived")}
              type="button"
            >
              Archived
            </button>
          </div>

          <form className="session-history-search" onSubmit={submitSearch}>
            <input
              aria-label="Search sessions"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${historyKind} sessions…`}
              value={query}
            />
            {normalizedQuery && (
              <button onClick={clearSearch} type="button">Clear</button>
            )}
            <button disabled={loading || Boolean(mutatingThreadId)} type="submit">Search</button>
          </form>

          <label className="session-history-scope">
            <input
              checked={scopeWorkspace}
              disabled={!workspace?.cwd || Boolean(mutatingThreadId)}
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
            <div className="session-history-state">
              No matching {historyKind} sessions.
            </div>
          ) : (
            <div className="session-history-list">
              {visibleThreads.map((thread) => (
                <ThreadRow
                  action={historyKind === "archived" ? "Restore" : "Archive"}
                  actionDisabled={
                    Boolean(mutatingThreadId) ||
                    (historyKind === "active" && thread.id === workspace?.threadId)
                  }
                  actionPending={mutatingThreadId === thread.id}
                  current={historyKind === "active" && thread.id === workspace?.threadId}
                  inspectPending={inspectingThreadId === thread.id}
                  key={thread.id}
                  onAction={() => void mutateThread(thread)}
                  onInspect={() => void inspectThread(thread)}
                  thread={thread}
                />
              ))}
              {cursor && threads.length < MAX_RETAINED_THREADS && (
                <button
                  className="session-history-more"
                  disabled={loading || Boolean(mutatingThreadId)}
                  onClick={() => void load(true)}
                  type="button"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          )}

          {inspectedThread && (
            <section className="session-history-inspector" aria-label="Inspected session">
              <header>
                <span>
                  <strong>{inspectedThread.name?.trim() || inspectedThread.preview?.trim() || "Untitled session"}</strong>
                  <small>Runtime thread/read metadata · turns not hydrated</small>
                </span>
                <button onClick={() => setInspectedThread(null)} type="button">Close</button>
              </header>
              <dl>
                <div><dt>Thread</dt><dd title={inspectedThread.id}>{inspectedThread.id}</dd></div>
                <div><dt>Workspace</dt><dd title={inspectedThread.cwd}>{inspectedThread.cwd || "None"}</dd></div>
                <div><dt>Provider</dt><dd>{inspectedThread.modelProvider || "Unknown"}</dd></div>
                <div><dt>Updated</dt><dd>{formatRelativeTime(inspectedThread.updatedAt)}</dd></div>
              </dl>
            </section>
          )}

          <footer>
            Runtime-backed · {historyKind} · explicit pagination · retains at most {MAX_RETAINED_THREADS} sessions
          </footer>
        </section>
      )}
    </aside>
  );
}

function ThreadRow({
  action,
  actionDisabled,
  actionPending,
  current,
  inspectPending,
  onAction,
  onInspect,
  thread,
}: {
  action: "Archive" | "Restore";
  actionDisabled: boolean;
  actionPending: boolean;
  current: boolean;
  inspectPending: boolean;
  onAction: () => void;
  onInspect: () => void;
  thread: ThreadSummary;
}) {
  const title = thread.name?.trim() || thread.preview?.trim() || "Untitled session";
  return (
    <article className={`session-history-row${current ? " current" : ""}`}>
      <div>
        <strong title={title}>{title}</strong>
        {current && <span>Current</span>}
        <button
          className="session-history-row-action"
          disabled={inspectPending}
          onClick={onInspect}
          title="Inspect runtime session metadata without changing foreground selection"
          type="button"
        >
          {inspectPending ? "…" : "Inspect"}
        </button>
        <button
          className="session-history-row-action"
          disabled={actionDisabled}
          onClick={onAction}
          title={current ? "Current session cannot be archived here" : `${action} session`}
          type="button"
        >
          {actionPending ? "…" : action}
        </button>
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
