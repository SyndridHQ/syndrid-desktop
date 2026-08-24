import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ThreadSummary } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./subagentsDock.css";

const PAGE_SIZE = 80;
const MAX_RETAINED_SUBAGENTS = 120;
const REMOVAL_METHODS = new Set(["thread/archived", "thread/deleted", "thread/closed"]);

export function SubagentsDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [subagents, setSubagents] = useState<ThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scannedThreads, setScannedThreads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (append = false) => {
      if (loading) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before inspecting subagents.");
        return;
      }
      const parentThreadId = workspace?.threadId;
      if (!parentThreadId) {
        setSubagents([]);
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
          appServerClient.getWorkspaceSnapshot()?.threadId !== parentThreadId
        ) {
          return;
        }

        const directChildren = result.data.filter(
          (thread) => thread.parentThreadId === parentThreadId,
        );
        setSubagents((current) =>
          dedupeThreads(append ? [...current, ...directChildren] : directChildren).slice(
            0,
            MAX_RETAINED_SUBAGENTS,
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

  useEffect(() => {
    generation.current += 1;
    setSubagents([]);
    setCursor(null);
    setScannedThreads(0);
    setError(null);
    if (open) void load(false);
    // The selected runtime thread is the only selection invalidation trigger. No polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.threadId]);

  useEffect(() => {
    const parentThreadId = workspace?.threadId;
    if (!open || !parentThreadId) return;

    return appServerClient.onNotification((notification) => {
      const params = toRecord(notification.params);
      if (!params) return;

      if (notification.method === "thread/started") {
        const thread = toThreadSummary(params.thread);
        if (thread?.parentThreadId !== parentThreadId) return;
        setSubagents((current) =>
          dedupeThreads([thread, ...current]).slice(0, MAX_RETAINED_SUBAGENTS),
        );
        return;
      }

      const threadId = params.threadId;
      if (typeof threadId !== "string") return;

      if (notification.method === "thread/status/changed") {
        setSubagents((current) =>
          current.map((thread) =>
            thread.id === threadId ? { ...thread, status: params.status } : thread,
          ),
        );
        return;
      }

      if (REMOVAL_METHODS.has(notification.method)) {
        setSubagents((current) => current.filter((thread) => thread.id !== threadId));
      }
    });
  }, [open, workspace?.threadId]);

  const sortedSubagents = useMemo(
    () => [...subagents].sort((a, b) => b.updatedAt - a.updatedAt),
    [subagents],
  );

  return (
    <aside className="subagents-dock" aria-label="Subagents">
      <button className="subagents-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">⌁</span>
        Subagents
        {subagents.length > 0 && <span>{subagents.length}</span>}
      </button>

      {open && (
        <section className="subagents-panel">
          <header>
            <span>
              <strong>Direct subagents</strong>
              <small title={workspace?.cwd}>{workspace?.cwd || "Selected session"}</small>
            </span>
            <button disabled={loading} onClick={() => void load(false)} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </header>

          <div className="subagents-summary">
            <span>{subagents.length} direct child{subagents.length === 1 ? "" : "ren"}</span>
            <span>{scannedThreads} runtime thread{scannedThreads === 1 ? "" : "s"} scanned</span>
            <strong>live lifecycle</strong>
          </div>

          {error ? (
            <div className="subagents-state error">{error}</div>
          ) : loading && subagents.length === 0 ? (
            <div className="subagents-state">Reading runtime thread graph…</div>
          ) : !workspace?.threadId ? (
            <div className="subagents-state">Select a loaded session first.</div>
          ) : subagents.length === 0 ? (
            <div className="subagents-state">
              No direct subagents found in the retained thread page.
              {cursor ? " Load more to continue the runtime scan." : ""}
            </div>
          ) : (
            <div className="subagents-list">
              {sortedSubagents.map((thread) => (
                <SubagentRow key={thread.id} thread={thread} />
              ))}
            </div>
          )}

          {cursor && subagents.length < MAX_RETAINED_SUBAGENTS && (
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
            Runtime thread graph · streamed lifecycle · explicit historical pagination · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function SubagentRow({ thread }: { thread: ThreadSummary }) {
  const role = thread.agentRole?.trim() || "subagent";
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
    typeof thread.updatedAt !== "number"
  ) {
    return null;
  }
  return value as ThreadSummary;
}
