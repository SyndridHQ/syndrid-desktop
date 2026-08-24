import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ThreadSummary } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./subagentsDock.css";

const PAGE_SIZE = 80;
const MAX_RETAINED_SUBAGENTS = 120;
const MAX_RETAINED_FORKS = 60;
const REMOVAL_METHODS = new Set(["thread/archived", "thread/deleted", "thread/closed"]);
type RelationshipView = "all" | "agents" | "forks";

export function SubagentsDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forking, setForking] = useState(false);
  const [subagents, setSubagents] = useState<ThreadSummary[]>([]);
  const [forks, setForks] = useState<ThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scannedThreads, setScannedThreads] = useState(0);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<RelationshipView>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (append = false) => {
      if (loading) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before inspecting the thread graph.");
        return;
      }
      const selectedThreadId = workspace?.threadId;
      if (!selectedThreadId) {
        setSubagents([]);
        setForks([]);
        setCursor(null);
        setScannedThreads(0);
        setError("Select a loaded Syndrid session first.");
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
        });
        if (
          requestGeneration !== generation.current ||
          appServerClient.getWorkspaceSnapshot()?.threadId !== selectedThreadId
        ) {
          return;
        }

        const directChildren = result.data.filter(
          (thread) => thread.parentThreadId === selectedThreadId,
        );
        const directForks = result.data.filter(
          (thread) => thread.forkedFromId === selectedThreadId,
        );
        setSubagents((current) =>
          dedupeThreads(append ? [...current, ...directChildren] : directChildren).slice(
            0,
            MAX_RETAINED_SUBAGENTS,
          ),
        );
        setForks((current) =>
          dedupeThreads(append ? [...current, ...directForks] : directForks).slice(
            0,
            MAX_RETAINED_FORKS,
          ),
        );
        setScannedThreads((current) => (append ? current + result.data.length : result.data.length));
        setCursor(result.nextCursor);
      } catch (cause) {
        if (requestGeneration !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (requestGeneration === generation.current) setLoading(false);
      }
    },
    [cursor, loading, workspace?.threadId],
  );

  const forkSelected = useCallback(async () => {
    if (forking || appServerClient.getSnapshot().phase !== "ready") return;
    const selectedThreadId = workspace?.threadId;
    if (!selectedThreadId) {
      setError("Select a loaded Syndrid session before creating a fork.");
      return;
    }

    setForking(true);
    setNotice(null);
    setError(null);
    try {
      const result = await appServerClient.forkThread({ threadId: selectedThreadId });
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== selectedThreadId) return;
      setForks((current) =>
        dedupeThreads([result.thread, ...current]).slice(0, MAX_RETAINED_FORKS),
      );
      setNotice(`Fork created · ${shortId(result.thread.id)} · selection unchanged`);
    } catch (cause) {
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== selectedThreadId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setForking(false);
    }
  }, [forking, workspace?.threadId]);

  useEffect(() => {
    generation.current += 1;
    setSubagents([]);
    setForks([]);
    setCursor(null);
    setScannedThreads(0);
    setQuery("");
    setView("all");
    setNotice(null);
    setError(null);
    if (open) void load(false);
    // The selected runtime thread is the only selection invalidation trigger. No polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.threadId]);

  useEffect(() => {
    const selectedThreadId = workspace?.threadId;
    if (!open || !selectedThreadId) return;

    return appServerClient.onNotification((notification) => {
      const params = toRecord(notification.params);
      if (!params) return;

      if (notification.method === "thread/started") {
        const thread = toThreadSummary(params.thread);
        if (!thread) return;
        if (thread.parentThreadId === selectedThreadId) {
          setSubagents((current) =>
            dedupeThreads([thread, ...current]).slice(0, MAX_RETAINED_SUBAGENTS),
          );
        }
        if (thread.forkedFromId === selectedThreadId) {
          setForks((current) =>
            dedupeThreads([thread, ...current]).slice(0, MAX_RETAINED_FORKS),
          );
        }
        return;
      }

      const threadId = params.threadId;
      if (typeof threadId !== "string") return;

      if (notification.method === "thread/status/changed") {
        const updateStatus = (current: ThreadSummary[]) =>
          current.map((thread) =>
            thread.id === threadId ? { ...thread, status: params.status } : thread,
          );
        setSubagents(updateStatus);
        setForks(updateStatus);
        return;
      }

      if (REMOVAL_METHODS.has(notification.method)) {
        const removeThread = (current: ThreadSummary[]) =>
          current.filter((thread) => thread.id !== threadId);
        setSubagents(removeThread);
        setForks(removeThread);
      }
    });
  }, [open, workspace?.threadId]);

  const sortedSubagents = useMemo(
    () => [...subagents].sort((a, b) => b.updatedAt - a.updatedAt),
    [subagents],
  );
  const sortedForks = useMemo(
    () => [...forks].sort((a, b) => b.updatedAt - a.updatedAt),
    [forks],
  );
  const filteredSubagents = useMemo(
    () => (view === "forks" ? [] : filterThreads(sortedSubagents, query)),
    [query, sortedSubagents, view],
  );
  const filteredForks = useMemo(
    () => (view === "agents" ? [] : filterThreads(sortedForks, query)),
    [query, sortedForks, view],
  );
  const hasRelationships = subagents.length > 0 || forks.length > 0;
  const visibleCount = filteredSubagents.length + filteredForks.length;
  const normalizedQuery = query.trim();

  return (
    <aside className="subagents-dock" aria-label="Session graph">
      <button className="subagents-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">⌁</span>
        Agents
        {hasRelationships && <span>{subagents.length + forks.length}</span>}
      </button>

      {open && (
        <section className="subagents-panel">
          <header>
            <span>
              <strong>Runtime thread graph</strong>
              <small title={workspace?.cwd}>{workspace?.cwd || "Selected session"}</small>
            </span>
            <div className="subagents-actions">
              <button disabled={forking || !workspace?.threadId} onClick={() => void forkSelected()} type="button">
                {forking ? "Forking…" : "Fork session"}
              </button>
              <button disabled={loading} onClick={() => void load(false)} type="button">
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </header>

          <div className="subagents-summary">
            <span>{subagents.length} direct subagent{subagents.length === 1 ? "" : "s"}</span>
            <span>{forks.length} direct fork{forks.length === 1 ? "" : "s"}</span>
            <span>{scannedThreads} thread{scannedThreads === 1 ? "" : "s"} scanned</span>
            <strong>live lifecycle</strong>
          </div>

          {notice && <div className="subagents-notice">{notice}</div>}

          {hasRelationships && (
            <div className="thread-graph-filter">
              <input
                aria-label="Filter thread graph"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter name, role, preview, provider, or ID…"
                value={query}
              />
              <select
                aria-label="Thread relationship type"
                onChange={(event) => setView(event.target.value as RelationshipView)}
                value={view}
              >
                <option value="all">All relationships</option>
                <option value="agents">Subagents</option>
                <option value="forks">Forks</option>
              </select>
              {normalizedQuery && (
                <button onClick={() => setQuery("")} type="button">
                  Clear
                </button>
              )}
              {(normalizedQuery || view !== "all") && (
                <small>{visibleCount} of {subagents.length + forks.length}</small>
              )}
            </div>
          )}

          {error ? (
            <div className="subagents-state error">{error}</div>
          ) : loading && !hasRelationships ? (
            <div className="subagents-state">Reading runtime thread graph…</div>
          ) : !workspace?.threadId ? (
            <div className="subagents-state">Select a loaded session first.</div>
          ) : !hasRelationships ? (
            <div className="subagents-state">
              No direct subagents or forks found in the retained thread page.
              {cursor ? " Load more to continue the runtime scan." : ""}
            </div>
          ) : visibleCount === 0 ? (
            <div className="subagents-state">No retained relationships match this filter.</div>
          ) : (
            <div className="subagents-list">
              {filteredSubagents.length > 0 && (
                <section className="thread-graph-group" aria-label="Direct subagents">
                  <h3>Subagents</h3>
                  {filteredSubagents.map((thread) => (
                    <ThreadGraphRow key={thread.id} kind="agent" thread={thread} />
                  ))}
                </section>
              )}
              {filteredForks.length > 0 && (
                <section className="thread-graph-group" aria-label="Direct forks">
                  <h3>Forks</h3>
                  {filteredForks.map((thread) => (
                    <ThreadGraphRow key={thread.id} kind="fork" thread={thread} />
                  ))}
                </section>
              )}
            </div>
          )}

          {cursor &&
            (subagents.length < MAX_RETAINED_SUBAGENTS || forks.length < MAX_RETAINED_FORKS) && (
              <button
                className="subagents-more"
                disabled={loading}
                onClick={() => void load(true)}
                type="button"
              >
                {loading ? "Loading…" : "Load more runtime threads"}
              </button>
            )}

          <footer>
            Runtime relationships · explicit fork · streamed lifecycle · in-memory filtering · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function ThreadGraphRow({
  thread,
  kind,
}: {
  thread: ThreadSummary;
  kind: "agent" | "fork";
}) {
  const role = kind === "agent" ? thread.agentRole?.trim() || "subagent" : "fork";
  const nickname = thread.agentNickname?.trim();
  const title = nickname || thread.name || thread.preview || role;
  return (
    <article className="subagent-row">
      <div>
        <strong>{title}</strong>
        <small>{role}</small>
      </div>
      <div className="subagent-meta">
        <code title={thread.id}>{shortId(thread.id)}</code>
        <span>{formatStatus(thread.status)}</span>
        <span>{formatRelativeTime(thread.updatedAt)}</span>
        {thread.modelProvider && <span>{thread.modelProvider}</span>}
      </div>
      {thread.preview && thread.preview !== title && <p>{thread.preview}</p>}
    </article>
  );
}

function dedupeThreads(threads: ThreadSummary[]): ThreadSummary[] {
  const byId = new Map<string, ThreadSummary>();
  for (const thread of threads) byId.set(thread.id, thread);
  return [...byId.values()];
}

function filterThreads(threads: ThreadSummary[], query: string): ThreadSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return threads;
  return threads.filter((thread) => {
    const fields = [
      thread.id,
      thread.name ?? "",
      thread.preview,
      thread.agentNickname ?? "",
      thread.agentRole ?? "",
      thread.modelProvider,
      formatStatus(thread.status),
    ];
    return fields.some((field) => field.toLocaleLowerCase().includes(normalized));
  });
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatStatus(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object") {
    const record = status as Record<string, unknown>;
    for (const key of ["type", "status", "state"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return "runtime state";
}

function formatRelativeTime(timestampSeconds: number): string {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000 - timestampSeconds));
  if (ageSeconds < 60) return "now";
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function toThreadSummary(value: unknown): ThreadSummary | null {
  const thread = toRecord(value);
  if (
    !thread ||
    typeof thread.id !== "string" ||
    (thread.parentThreadId !== null && typeof thread.parentThreadId !== "string") ||
    (thread.forkedFromId !== null && typeof thread.forkedFromId !== "string") ||
    typeof thread.updatedAt !== "number"
  ) {
    return null;
  }
  return value as ThreadSummary;
}