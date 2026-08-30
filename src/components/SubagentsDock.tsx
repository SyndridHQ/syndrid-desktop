import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ThreadSummary } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./subagentsDock.css";

const PAGE_SIZE = 80;
const MAX_RETAINED_SUBAGENTS = 120;
const MAX_RETAINED_FORKS = 60;
const MAX_LABEL_CHARS = 8 * 1024;
const MAX_PREVIEW_CHARS = 32 * 1024;
const MAX_PATH_CHARS = 16 * 1024;
const REMOVAL_METHODS = new Set(["thread/archived", "thread/deleted", "thread/closed"]);
type RelationshipView = "all" | "agents" | "forks";
type GraphThreadSummary = {
  id: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  preview: string;
  modelProvider: string;
  updatedAt: number;
  statusLabel: string;
  agentNickname: string | null;
  agentRole: string | null;
  name: string | null;
};
type ThreadDetail = {
  id: string;
  sessionId: string;
  statusLabel: string;
  modelProvider: string;
  cliVersion: string;
  cwd: string;
  source: string;
  threadSource: string | null;
  parentThreadId: string | null;
  forkedFromId: string | null;
  gitInfo: InspectedGitInfo | null;
};
type InspectionState = {
  threadId: string;
  loading: boolean;
  thread: ThreadDetail | null;
  error: string | null;
};
type InspectedGitInfo = { branch: string | null; sha: string | null };

export function SubagentsDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forking, setForking] = useState(false);
  const [subagents, setSubagents] = useState<GraphThreadSummary[]>([]);
  const [forks, setForks] = useState<GraphThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scannedThreads, setScannedThreads] = useState(0);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<RelationshipView>("all");
  const [inspection, setInspection] = useState<InspectionState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inspectionGeneration = useRef(0);
  const forkGeneration = useRef(0);

  const load = useCallback(async (append = false) => {
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
      ) return;

      const directChildren = result.data
        .filter((thread) => thread.parentThreadId === selectedThreadId)
        .map(projectGraphThread);
      const directForks = result.data
        .filter((thread) => thread.forkedFromId === selectedThreadId)
        .map(projectGraphThread);
      setSubagents((current) =>
        dedupeThreads(append ? [...current, ...directChildren] : directChildren).slice(0, MAX_RETAINED_SUBAGENTS),
      );
      setForks((current) =>
        dedupeThreads(append ? [...current, ...directForks] : directForks).slice(0, MAX_RETAINED_FORKS),
      );
      setScannedThreads((current) => (append ? current + result.data.length : result.data.length));
      setCursor(result.nextCursor);
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [cursor, loading, workspace?.threadId]);

  const inspectThread = useCallback(async (thread: GraphThreadSummary) => {
    if (appServerClient.getSnapshot().phase !== "ready") {
      setInspection({
        threadId: thread.id,
        loading: false,
        thread: null,
        error: "Connect the Syndrid runtime before inspecting this thread.",
      });
      return;
    }
    const selectedThreadId = workspace?.threadId;
    if (!selectedThreadId) return;

    const requestGeneration = ++inspectionGeneration.current;
    setInspection({ threadId: thread.id, loading: true, thread: null, error: null });
    try {
      // Metadata-only read: omit rollout turns/items so inspection does not become
      // a second conversation store or hydrate potentially unbounded history.
      const result = await appServerClient.inspectThread({ threadId: thread.id });
      if (
        requestGeneration !== inspectionGeneration.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== selectedThreadId
      ) return;
      setInspection({
        threadId: thread.id,
        loading: false,
        thread: projectThreadDetail(result.thread),
        error: null,
      });
    } catch (cause) {
      if (requestGeneration !== inspectionGeneration.current) return;
      setInspection({
        threadId: thread.id,
        loading: false,
        thread: null,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [workspace?.threadId]);

  const forkSelected = useCallback(async () => {
    if (forking || appServerClient.getSnapshot().phase !== "ready") return;
    const selectedThreadId = workspace?.threadId;
    if (!selectedThreadId) {
      setError("Select a loaded Syndrid session before creating a fork.");
      return;
    }

    const requestGeneration = ++forkGeneration.current;
    setForking(true);
    setNotice(null);
    setError(null);
    try {
      const result = await appServerClient.forkThread({ threadId: selectedThreadId });
      if (
        requestGeneration !== forkGeneration.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== selectedThreadId
      ) return;
      const fork = projectGraphThread(result.thread);
      setForks((current) => dedupeThreads([fork, ...current]).slice(0, MAX_RETAINED_FORKS));
      setNotice(`Fork created · ${shortId(fork.id)} · selection unchanged`);
    } catch (cause) {
      if (
        requestGeneration !== forkGeneration.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== selectedThreadId
      ) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === forkGeneration.current) setForking(false);
    }
  }, [forking, workspace?.threadId]);

  useEffect(() => {
    generation.current += 1;
    inspectionGeneration.current += 1;
    forkGeneration.current += 1;
    setForking(false);
    setSubagents([]);
    setForks([]);
    setCursor(null);
    setScannedThreads(0);
    setQuery("");
    setView("all");
    setInspection(null);
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
        const thread = toGraphThreadSummary(params.thread);
        if (!thread) return;
        if (thread.parentThreadId === selectedThreadId) {
          setSubagents((current) => dedupeThreads([thread, ...current]).slice(0, MAX_RETAINED_SUBAGENTS));
        }
        if (thread.forkedFromId === selectedThreadId) {
          setForks((current) => dedupeThreads([thread, ...current]).slice(0, MAX_RETAINED_FORKS));
        }
        return;
      }

      const threadId = params.threadId;
      if (typeof threadId !== "string") return;

      if (notification.method === "thread/status/changed") {
        const statusLabel = formatStatus(params.status);
        const updateStatus = (current: GraphThreadSummary[]) =>
          current.map((thread) => thread.id === threadId ? { ...thread, statusLabel } : thread);
        setSubagents(updateStatus);
        setForks(updateStatus);
        setInspection((current) =>
          current?.thread?.id === threadId
            ? { ...current, thread: { ...current.thread, statusLabel } }
            : current,
        );
        return;
      }

      if (REMOVAL_METHODS.has(notification.method)) {
        const removeThread = (current: GraphThreadSummary[]) => current.filter((thread) => thread.id !== threadId);
        setSubagents(removeThread);
        setForks(removeThread);
        setInspection((current) => (current?.threadId === threadId ? null : current));
      }
    });
  }, [open, workspace?.threadId]);

  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => b.updatedAt - a.updatedAt), [subagents]);
  const sortedForks = useMemo(() => [...forks].sort((a, b) => b.updatedAt - a.updatedAt), [forks]);
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
          {inspection && (
            <ThreadInspector
              inspection={inspection}
              close={() => {
                inspectionGeneration.current += 1;
                setInspection(null);
              }}
            />
          )}

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
              {normalizedQuery && <button onClick={() => setQuery("")} type="button">Clear</button>}
              {(normalizedQuery || view !== "all") && <small>{visibleCount} of {subagents.length + forks.length}</small>}
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
                    <ThreadGraphRow
                      inspecting={inspection?.loading === true && inspection.threadId === thread.id}
                      key={thread.id}
                      kind="agent"
                      onInspect={inspectThread}
                      selected={inspection?.threadId === thread.id}
                      thread={thread}
                    />
                  ))}
                </section>
              )}
              {filteredForks.length > 0 && (
                <section className="thread-graph-group" aria-label="Direct forks">
                  <h3>Forks</h3>
                  {filteredForks.map((thread) => (
                    <ThreadGraphRow
                      inspecting={inspection?.loading === true && inspection.threadId === thread.id}
                      key={thread.id}
                      kind="fork"
                      onInspect={inspectThread}
                      selected={inspection?.threadId === thread.id}
                      thread={thread}
                    />
                  ))}
                </section>
              )}
            </div>
          )}

          {cursor && (subagents.length < MAX_RETAINED_SUBAGENTS || forks.length < MAX_RETAINED_FORKS) && (
            <button className="subagents-more" disabled={loading} onClick={() => void load(true)} type="button">
              {loading ? "Loading…" : "Load more runtime threads"}
            </button>
          )}

          <footer>Runtime relationships · metadata-only inspection · streamed lifecycle · no polling</footer>
        </section>
      )}
    </aside>
  );
}

function ThreadGraphRow({
  thread,
  kind,
  selected,
  inspecting,
  onInspect,
}: {
  thread: GraphThreadSummary;
  kind: "agent" | "fork";
  selected: boolean;
  inspecting: boolean;
  onInspect: (thread: GraphThreadSummary) => Promise<void>;
}) {
  const role = kind === "agent" ? thread.agentRole?.trim() || "subagent" : "fork";
  const nickname = thread.agentNickname?.trim();
  const title = nickname || thread.name || thread.preview || role;
  return (
    <article className={`subagent-row${selected ? " selected" : ""}`}>
      <div>
        <strong>{title}</strong>
        <small>{role}</small>
        <button disabled={inspecting} onClick={() => void onInspect(thread)} type="button">
          {inspecting ? "Reading…" : selected ? "Refresh details" : "Inspect"}
        </button>
      </div>
      <div className="subagent-meta">
        <code title={thread.id}>{shortId(thread.id)}</code>
        <span>{thread.statusLabel}</span>
        <span>{formatRelativeTime(thread.updatedAt)}</span>
        {thread.modelProvider && <span>{thread.modelProvider}</span>}
      </div>
      {thread.preview && thread.preview !== title && <p>{thread.preview}</p>}
    </article>
  );
}

function ThreadInspector({ inspection, close }: { inspection: InspectionState; close: () => void }) {
  const thread = inspection.thread;
  const gitInfo = thread?.gitInfo ?? null;
  return (
    <section className="thread-inspector" aria-label="Thread details">
      <header>
        <strong>Thread details</strong>
        <button onClick={close} type="button">Close</button>
      </header>
      {inspection.loading ? (
        <div className="thread-inspector-state">Reading runtime metadata…</div>
      ) : inspection.error ? (
        <div className="thread-inspector-state error">{inspection.error}</div>
      ) : thread ? (
        <dl>
          <ThreadDetailRow label="Thread" title={thread.id} value={shortId(thread.id)} />
          <ThreadDetailRow label="Session" title={thread.sessionId} value={shortId(thread.sessionId)} />
          <ThreadDetailRow label="Status" value={thread.statusLabel} />
          <ThreadDetailRow label="Provider" value={thread.modelProvider || "—"} />
          <ThreadDetailRow label="CLI" value={thread.cliVersion || "—"} />
          <ThreadDetailRow label="Workspace" title={thread.cwd} value={thread.cwd || "—"} />
          <ThreadDetailRow label="Source" value={thread.source} />
          <ThreadDetailRow label="Thread source" value={thread.threadSource ?? "—"} />
          {thread.parentThreadId && <ThreadDetailRow label="Parent" title={thread.parentThreadId} value={shortId(thread.parentThreadId)} />}
          {thread.forkedFromId && <ThreadDetailRow label="Forked from" title={thread.forkedFromId} value={shortId(thread.forkedFromId)} />}
          {gitInfo?.branch && <ThreadDetailRow label="Branch" value={gitInfo.branch} />}
          {gitInfo?.sha && <ThreadDetailRow label="Commit" title={gitInfo.sha} value={shortId(gitInfo.sha)} />}
        </dl>
      ) : null}
      <footer>Metadata-only `thread/read` · foreground selection unchanged</footer>
    </section>
  );
}

function ThreadDetailRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div><dt>{label}</dt><dd title={title}>{value}</dd></div>;
}

function dedupeThreads(threads: GraphThreadSummary[]): GraphThreadSummary[] {
  const byId = new Map<string, GraphThreadSummary>();
  for (const thread of threads) byId.set(thread.id, thread);
  return [...byId.values()];
}

function filterThreads(threads: GraphThreadSummary[], query: string): GraphThreadSummary[] {
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
      thread.statusLabel,
    ];
    return fields.some((field) => field.toLocaleLowerCase().includes(normalized));
  });
}

function projectGraphThread(thread: ThreadSummary): GraphThreadSummary {
  return {
    id: thread.id,
    forkedFromId: thread.forkedFromId,
    parentThreadId: thread.parentThreadId,
    preview: boundedText(thread.preview, MAX_PREVIEW_CHARS),
    modelProvider: boundedText(thread.modelProvider, MAX_LABEL_CHARS),
    updatedAt: thread.updatedAt,
    statusLabel: formatStatus(thread.status),
    agentNickname: boundedNullableText(thread.agentNickname, MAX_LABEL_CHARS),
    agentRole: boundedNullableText(thread.agentRole, MAX_LABEL_CHARS),
    name: boundedNullableText(thread.name, MAX_LABEL_CHARS),
  };
}

function projectThreadDetail(thread: ThreadSummary): ThreadDetail {
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    statusLabel: formatStatus(thread.status),
    modelProvider: boundedText(thread.modelProvider, MAX_LABEL_CHARS),
    cliVersion: boundedText(thread.cliVersion, MAX_LABEL_CHARS),
    cwd: boundedText(thread.cwd, MAX_PATH_CHARS),
    source: summarizeStructuredValue(thread.source),
    threadSource: thread.threadSource === null ? null : summarizeStructuredValue(thread.threadSource),
    parentThreadId: thread.parentThreadId,
    forkedFromId: thread.forkedFromId,
    gitInfo: projectGitInfo(thread.gitInfo),
  };
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function boundedText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

function boundedNullableText(value: string | null, maxChars: number): string | null {
  return value === null ? null : boundedText(value, maxChars);
}

function formatStatus(status: unknown): string {
  if (typeof status === "string") return boundedText(status, MAX_LABEL_CHARS);
  if (status && typeof status === "object") {
    const record = status as Record<string, unknown>;
    for (const key of ["type", "status", "state"]) {
      if (typeof record[key] === "string") return boundedText(record[key] as string, MAX_LABEL_CHARS);
    }
  }
  return "runtime state";
}

function summarizeStructuredValue(value: unknown): string {
  return boundedText(formatStructuredValue(value), MAX_LABEL_CHARS);
}

function formatStructuredValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const key = Object.keys(value as Record<string, unknown>)[0];
    return key ?? "runtime value";
  }
  return "runtime value";
}

function projectGitInfo(value: unknown): InspectedGitInfo | null {
  const gitInfo = parseGitInfo(value);
  if (!gitInfo) return null;
  return {
    branch: gitInfo.branch === null ? null : boundedText(gitInfo.branch, MAX_LABEL_CHARS),
    sha: gitInfo.sha,
  };
}

function parseGitInfo(value: unknown): InspectedGitInfo | null {
  const record = toRecord(value);
  if (!record) return null;
  const branch = nullableString(record.branch);
  const sha = nullableString(record.sha);
  if (branch === undefined || sha === undefined) return null;
  return { branch, sha };
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function formatRelativeTime(timestampSeconds: number): string {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000 - timestampSeconds));
  if (ageSeconds < 60) return "now";
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function toGraphThreadSummary(value: unknown): GraphThreadSummary | null {
  const thread = toRecord(value);
  if (
    !thread ||
    typeof thread.id !== "string" ||
    typeof thread.preview !== "string" ||
    typeof thread.modelProvider !== "string" ||
    (thread.parentThreadId !== null && typeof thread.parentThreadId !== "string") ||
    (thread.forkedFromId !== null && typeof thread.forkedFromId !== "string") ||
    (thread.agentNickname !== null && typeof thread.agentNickname !== "string") ||
    (thread.agentRole !== null && typeof thread.agentRole !== "string") ||
    (thread.name !== null && typeof thread.name !== "string") ||
    typeof thread.updatedAt !== "number"
  ) return null;
  return {
    id: thread.id,
    forkedFromId: thread.forkedFromId,
    parentThreadId: thread.parentThreadId,
    preview: boundedText(thread.preview, MAX_PREVIEW_CHARS),
    modelProvider: boundedText(thread.modelProvider, MAX_LABEL_CHARS),
    updatedAt: thread.updatedAt,
    statusLabel: formatStatus(thread.status),
    agentNickname: boundedNullableText(thread.agentNickname, MAX_LABEL_CHARS),
    agentRole: boundedNullableText(thread.agentRole, MAX_LABEL_CHARS),
    name: boundedNullableText(thread.name, MAX_LABEL_CHARS),
  };
}
