import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ThreadBackgroundTerminal } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./backgroundProcessesDock.css";

const PAGE_SIZE = 50;
const MAX_RETAINED_PROCESSES = 200;
type ProcessSort = "runtime" | "cpu" | "memory" | "command";

export function BackgroundProcessesDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [confirmClean, setConfirmClean] = useState(false);
  const [processes, setProcesses] = useState<ThreadBackgroundTerminal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProcessSort>("runtime");
  const [terminating, setTerminating] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (append = false) => {
      if (loading) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before inspecting background processes.");
        return;
      }
      if (!workspace?.threadId) {
        setProcesses([]);
        setCursor(null);
        setError("Select a loaded Syndrid session first.");
        return;
      }

      const requestGeneration = ++generation.current;
      const threadId = workspace.threadId;
      setLoading(true);
      setNotice(null);
      setError(null);
      try {
        const result = await appServerClient.listBackgroundTerminals({
          threadId,
          cursor: append ? cursor : null,
          limit: PAGE_SIZE,
        });
        if (
          requestGeneration !== generation.current ||
          appServerClient.getWorkspaceSnapshot()?.threadId !== threadId
        ) {
          return;
        }
        setProcesses((current) =>
          dedupeProcesses(append ? [...current, ...result.data] : result.data).slice(
            0,
            MAX_RETAINED_PROCESSES,
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
    [cursor, loading, workspace?.threadId],
  );

  useEffect(() => {
    generation.current += 1;
    setProcesses([]);
    setCursor(null);
    setQuery("");
    setSort("runtime");
    setTerminating(new Set());
    setCleaning(false);
    setConfirmClean(false);
    setNotice(null);
    setError(null);
    if (open) void load(false);
    // Workspace selection is the invalidation trigger; the fresh callback from
    // this render targets that exact thread without background polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.threadId]);

  const totals = useMemo(() => summarize(processes), [processes]);
  const filteredProcesses = useMemo(
    () => filterProcesses(processes, query),
    [processes, query],
  );
  const visibleProcesses = useMemo(
    () => sortProcesses(filteredProcesses, sort),
    [filteredProcesses, sort],
  );
  const normalizedQuery = query.trim();

  const terminate = useCallback(
    async (process: ThreadBackgroundTerminal) => {
      const threadId = workspace?.threadId;
      if (!threadId || cleaning || terminating.has(process.processId)) return;

      setTerminating((current) => new Set(current).add(process.processId));
      setNotice(null);
      setError(null);
      try {
        const result = await appServerClient.terminateBackgroundTerminal({
          threadId,
          processId: process.processId,
        });
        if (appServerClient.getWorkspaceSnapshot()?.threadId !== threadId) return;
        if (result.terminated) {
          setProcesses((current) =>
            current.filter((entry) => entry.processId !== process.processId),
          );
        } else {
          setError(`Runtime did not terminate process ${process.processId}. Refresh to reconcile.`);
        }
      } catch (cause) {
        if (appServerClient.getWorkspaceSnapshot()?.threadId !== threadId) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setTerminating((current) => {
          const next = new Set(current);
          next.delete(process.processId);
          return next;
        });
      }
    },
    [cleaning, terminating, workspace?.threadId],
  );

  const cleanAll = useCallback(async () => {
    const threadId = workspace?.threadId;
    if (!threadId || cleaning || processes.length === 0) return;

    if (!confirmClean) {
      setConfirmClean(true);
      setNotice("Stop all will terminate every running background terminal for this session. Confirm to continue.");
      setError(null);
      return;
    }

    setCleaning(true);
    setNotice(null);
    setError(null);
    try {
      await appServerClient.cleanBackgroundTerminals({ threadId });
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== threadId) return;
      setConfirmClean(false);
      setNotice("Runtime accepted the stop-all request. Refresh to reconcile process exits.");
    } catch (cause) {
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== threadId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCleaning(false);
    }
  }, [cleaning, confirmClean, processes.length, workspace?.threadId]);

  return (
    <aside className="background-processes-dock" aria-label="Background processes">
      <button
        className="background-processes-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden="true">◉</span>
        Processes
        {processes.length > 0 && <span>{processes.length}</span>}
      </button>

      {open && (
        <section className="background-processes-panel">
          <header>
            <span>
              <strong>Background processes</strong>
              <small title={workspace?.cwd}>
                {workspace?.cwd || "Selected session runtime"}
              </small>
            </span>
            <div className="background-processes-header-actions">
              {processes.length > 0 && (
                <button
                  className={confirmClean ? "danger" : ""}
                  disabled={cleaning || loading || terminating.size > 0}
                  onClick={() => void cleanAll()}
                  type="button"
                >
                  {cleaning ? "Stopping all…" : confirmClean ? "Confirm stop all" : "Stop all"}
                </button>
              )}
              <button disabled={loading || cleaning} onClick={() => void load(false)} type="button">
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </header>

          <div className="background-processes-summary">
            <span>{processes.length} running</span>
            <span>{formatCpu(totals.cpuPercent)} CPU</span>
            <span>{formatMemory(totals.rssKb)} RSS</span>
          </div>

          {notice && <div className="background-processes-notice">{notice}</div>}

          {processes.length > 0 && (
            <div className="background-processes-filter">
              <input
                aria-label="Filter background processes"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter command, cwd, process ID, or PID…"
                value={query}
              />
              <select
                aria-label="Sort background processes"
                onChange={(event) => setSort(event.target.value as ProcessSort)}
                value={sort}
              >
                <option value="runtime">Runtime order</option>
                <option value="cpu">CPU high to low</option>
                <option value="memory">Memory high to low</option>
                <option value="command">Command A–Z</option>
              </select>
              {normalizedQuery && (
                <button onClick={() => setQuery("")} type="button">
                  Clear
                </button>
              )}
              {normalizedQuery && (
                <small>
                  {filteredProcesses.length} of {processes.length}
                </small>
              )}
            </div>
          )}

          {error ? (
            <div className="background-processes-state error">{error}</div>
          ) : loading && processes.length === 0 ? (
            <div className="background-processes-state">Reading runtime processes…</div>
          ) : !workspace?.threadId ? (
            <div className="background-processes-state">Select a loaded session first.</div>
          ) : processes.length === 0 ? (
            <div className="background-processes-state">No running background terminals.</div>
          ) : filteredProcesses.length === 0 ? (
            <div className="background-processes-state">No retained processes match this filter.</div>
          ) : (
            <div className="background-processes-list">
              {visibleProcesses.map((process) => (
                <ProcessRow
                  key={process.processId}
                  process={process}
                  stopping={cleaning || terminating.has(process.processId)}
                  terminate={terminate}
                />
              ))}
              {cursor && processes.length < MAX_RETAINED_PROCESSES && (
                <button
                  className="background-processes-more"
                  disabled={loading || cleaning}
                  onClick={() => void load(true)}
                  type="button"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          )}

          <footer>
            Runtime-owned · explicit refresh/termination · retains at most {MAX_RETAINED_PROCESSES} processes
          </footer>
        </section>
      )}
    </aside>
  );
}

function ProcessRow({
  process,
  stopping,
  terminate,
}: {
  process: ThreadBackgroundTerminal;
  stopping: boolean;
  terminate: (process: ThreadBackgroundTerminal) => Promise<void>;
}) {
  return (
    <article className="background-process-row">
      <div className="background-process-command">
        <strong title={process.command}>{process.command || "Background terminal"}</strong>
        <small title={process.cwd}>{process.cwd || "cwd unavailable"}</small>
      </div>
      <div className="background-process-meta">
        <code>#{process.processId}</code>
        <span>PID {process.osPid ?? "—"}</span>
        <span>{process.cpuPercent === null ? "CPU —" : `${process.cpuPercent.toFixed(1)}% CPU`}</span>
        <span>{process.rssKb === null ? "RSS —" : `${formatMemory(process.rssKb)} RSS`}</span>
      </div>
      <button
        disabled={stopping}
        onClick={() => void terminate(process)}
        type="button"
      >
        {stopping ? "Stopping…" : "Terminate"}
      </button>
    </article>
  );
}

function dedupeProcesses(processes: ThreadBackgroundTerminal[]): ThreadBackgroundTerminal[] {
  const seen = new Set<string>();
  return processes.filter((process) => {
    if (seen.has(process.processId)) return false;
    seen.add(process.processId);
    return true;
  });
}

function filterProcesses(
  processes: ThreadBackgroundTerminal[],
  query: string,
): ThreadBackgroundTerminal[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return processes;
  return processes.filter((process) => {
    const fields = [
      process.command,
      process.cwd,
      process.processId,
      process.osPid === null ? "" : String(process.osPid),
    ];
    return fields.some((field) => field.toLocaleLowerCase().includes(normalized));
  });
}

function sortProcesses(
  processes: ThreadBackgroundTerminal[],
  sort: ProcessSort,
): ThreadBackgroundTerminal[] {
  if (sort === "runtime") return processes;
  const sorted = [...processes];
  if (sort === "cpu") {
    sorted.sort((a, b) => compareNullableNumberDescending(a.cpuPercent, b.cpuPercent));
  } else if (sort === "memory") {
    sorted.sort((a, b) => compareNullableNumberDescending(a.rssKb, b.rssKb));
  } else {
    sorted.sort((a, b) =>
      a.command.localeCompare(b.command, undefined, { numeric: true, sensitivity: "base" }),
    );
  }
  return sorted;
}

function compareNullableNumberDescending(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function summarize(processes: ThreadBackgroundTerminal[]): { cpuPercent: number | null; rssKb: number | null } {
  let cpuPercent = 0;
  let cpuKnown = false;
  let rssKb = 0;
  let rssKnown = false;
  for (const process of processes) {
    if (process.cpuPercent !== null) {
      cpuPercent += process.cpuPercent;
      cpuKnown = true;
    }
    if (process.rssKb !== null) {
      rssKb += process.rssKb;
      rssKnown = true;
    }
  }
  return {
    cpuPercent: cpuKnown ? cpuPercent : null,
    rssKb: rssKnown ? rssKb : null,
  };
}

function formatCpu(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatMemory(kb: number | null): string {
  if (kb === null) return "—";
  if (kb < 1024) return `${Math.round(kb)} KiB`;
  const mib = kb / 1024;
  if (mib < 1024) return `${mib.toFixed(mib >= 100 ? 0 : 1)} MiB`;
  return `${(mib / 1024).toFixed(1)} GiB`;
}
