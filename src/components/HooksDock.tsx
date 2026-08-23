import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { HookMetadata, HooksListEntry } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./hooksDock.css";

const HOOK_STARTED = "hook/started";
const HOOK_COMPLETED = "hook/completed";
const MAX_RETAINED_RUNS = 80;
const MAX_VISIBLE_RUNS = 16;
const MAX_VISIBLE_HOOKS = 120;

type HookOutputEntry = { kind: string; text: string };
type HookRun = {
  id: string;
  threadId: string;
  turnId: string | null;
  eventName: string;
  handlerType: string;
  executionMode: string;
  scope: string;
  sourcePath: string;
  source: string;
  status: string;
  statusMessage: string | null;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  entries: HookOutputEntry[];
};

type HooksView = "inventory" | "activity";

export function HooksDock() {
  const workspace = useRuntimeWorkspace();
  const inventoryRequestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<HooksView>("inventory");
  const [runs, setRuns] = useState<HookRun[]>([]);
  const [inventory, setInventory] = useState<HooksListEntry[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  useEffect(() =>
    appServerClient.onNotification((notification) => {
      if (notification.method !== HOOK_STARTED && notification.method !== HOOK_COMPLETED) return;
      const run = parseHookNotification(notification.params);
      if (!run) return;
      setRuns((current) => upsertHookRun(current, run));
    }), []);

  const loadInventory = useCallback(async () => {
    const requestGeneration = ++inventoryRequestRef.current;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setInventoryLoading(false);
      setInventoryError("Connect the Syndrid runtime before loading hooks.");
      return;
    }

    const cwd = workspace?.cwd.trim();
    if (!cwd) {
      setInventory([]);
      setInventoryLoaded(true);
      setInventoryLoading(false);
      setInventoryError(null);
      return;
    }

    const requestedThreadId = workspace?.threadId ?? null;
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const result = await appServerClient.listHooks({ cwds: [cwd] });
      if (inventoryRequestRef.current !== requestGeneration) return;
      const current = appServerClient.getWorkspaceSnapshot();
      if (current?.threadId !== requestedThreadId || current.cwd !== cwd) return;
      setInventory(result.data);
      setInventoryLoaded(true);
    } catch (cause) {
      if (inventoryRequestRef.current !== requestGeneration) return;
      setInventoryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (inventoryRequestRef.current === requestGeneration) {
        setInventoryLoading(false);
      }
    }
  }, [workspace?.cwd, workspace?.threadId]);

  useEffect(() => {
    setInventory([]);
    setInventoryLoaded(false);
    setInventoryError(null);
    if (open && view === "inventory") {
      void loadInventory();
    } else {
      inventoryRequestRef.current += 1;
      setInventoryLoading(false);
    }
  }, [loadInventory, open, view, workspace?.cwd, workspace?.threadId]);

  const runningCount = useMemo(
    () => runs.filter((run) => run.status === "running").length,
    [runs],
  );
  const recent = useMemo(() => runs.slice(-MAX_VISIBLE_RUNS).reverse(), [runs]);
  const hooks = useMemo(
    () => inventory.flatMap((entry) => entry.hooks).sort(compareHooks),
    [inventory],
  );
  const warningCount = useMemo(
    () => inventory.reduce((count, entry) => count + entry.warnings.length, 0),
    [inventory],
  );
  const discoveryErrorCount = useMemo(
    () => inventory.reduce((count, entry) => count + entry.errors.length, 0),
    [inventory],
  );
  const enabledCount = useMemo(() => hooks.filter((hook) => hook.enabled).length, [hooks]);
  const cwd = workspace?.cwd ?? null;

  return (
    <aside className="hooks-dock" aria-label="Hooks">
      <button className="hooks-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">↯</span>
        Hooks
        <span>{runningCount > 0 ? `${runningCount} running` : inventoryLoaded ? hooks.length : runs.length}</span>
      </button>
      {open && (
        <section className="hooks-panel">
          <header>
            <span>
              <strong>Hooks</strong>
              <small title={cwd ?? undefined}>{cwd ?? "Selected session workspace"}</small>
            </span>
            {view === "inventory" ? (
              <button disabled={inventoryLoading} onClick={() => void loadInventory()} type="button">
                {inventoryLoading ? "Loading…" : "Refresh"}
              </button>
            ) : (
              <button disabled={runs.length === 0} onClick={() => setRuns([])} type="button">
                Clear
              </button>
            )}
          </header>

          <nav className="hooks-tabs" aria-label="Hook views">
            <button
              aria-pressed={view === "inventory"}
              className={view === "inventory" ? "active" : ""}
              onClick={() => setView("inventory")}
              type="button"
            >
              Inventory {inventoryLoaded ? `· ${hooks.length}` : ""}
            </button>
            <button
              aria-pressed={view === "activity"}
              className={view === "activity" ? "active" : ""}
              onClick={() => setView("activity")}
              type="button"
            >
              Activity · {runs.length}
            </button>
          </nav>

          {view === "inventory" ? (
            <HookInventory
              cwd={cwd}
              error={inventoryError}
              hooks={hooks}
              loaded={inventoryLoaded}
              loading={inventoryLoading}
            />
          ) : (
            <HookActivity recent={recent} />
          )}

          <footer>
            {view === "inventory" ? (
              <>
                <span>{enabledCount} enabled · explicit runtime discovery · no polling</span>
                {(warningCount > 0 || discoveryErrorCount > 0) && (
                  <em>
                    {warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}
                    {warningCount > 0 && discoveryErrorCount > 0 ? " · " : ""}
                    {discoveryErrorCount > 0
                      ? `${discoveryErrorCount} error${discoveryErrorCount === 1 ? "" : "s"}`
                      : ""}
                  </em>
                )}
              </>
            ) : (
              <span>Event-driven · retains {MAX_RETAINED_RUNS} runs · no polling</span>
            )}
          </footer>
        </section>
      )}
    </aside>
  );
}

function HookInventory({
  cwd,
  error,
  hooks,
  loaded,
  loading,
}: {
  cwd: string | null;
  error: string | null;
  hooks: HookMetadata[];
  loaded: boolean;
  loading: boolean;
}) {
  if (error) return <div className="hooks-empty hooks-error">{error}</div>;
  if (loading && !loaded) return <div className="hooks-empty">Loading runtime hook inventory…</div>;
  if (!cwd) return <div className="hooks-empty">No selected session workspace reported.</div>;
  if (loaded && hooks.length === 0) return <div className="hooks-empty">No hooks reported for this workspace.</div>;

  return (
    <div className="hooks-list hook-inventory-list">
      {hooks.slice(0, MAX_VISIBLE_HOOKS).map((hook) => (
        <HookInventoryCard hook={hook} key={hook.key} />
      ))}
      {hooks.length > MAX_VISIBLE_HOOKS && (
        <div className="hooks-empty compact">
          Showing {MAX_VISIBLE_HOOKS} of {hooks.length} hooks.
        </div>
      )}
    </div>
  );
}

function HookInventoryCard({ hook }: { hook: HookMetadata }) {
  const trustLabel = formatToken(hook.trustStatus);
  return (
    <article className={`hook-card hook-inventory-card ${hook.enabled ? "hook-enabled" : "hook-disabled"}`}>
      <div className="hook-card-head">
        <strong>{formatToken(hook.eventName)}</strong>
        <em className={`hook-trust hook-trust-${hook.trustStatus}`}>{trustLabel}</em>
      </div>
      <div className="hook-meta">
        <span>{formatToken(hook.handlerType)}</span>
        <span>{formatToken(hook.source)}</span>
        <span>{hook.isManaged ? "Managed" : hook.enabled ? "Enabled" : "Disabled"}</span>
      </div>
      <code title={hook.sourcePath}>{hook.sourcePath}</code>
      {hook.matcher && <p className="hook-command"><b>Match</b> {hook.matcher}</p>}
      {hook.command && <p className="hook-command"><b>Command</b> {hook.command}</p>}
      <footer>
        {hook.pluginId && <span>{hook.pluginId}</span>}
        <span>{formatTimeout(hook.timeoutSec)}</span>
      </footer>
    </article>
  );
}

function HookActivity({ recent }: { recent: HookRun[] }) {
  return (
    <div className="hooks-list">
      {recent.length === 0 ? (
        <div className="hooks-empty">Hook runs appear here when the runtime emits them.</div>
      ) : recent.map((run) => (
        <article className={`hook-card hook-${run.status}`} key={run.id}>
          <div className="hook-card-head">
            <strong>{formatToken(run.eventName)}</strong>
            <em>{formatToken(run.status)}</em>
          </div>
          <div className="hook-meta">
            <span>{formatToken(run.handlerType)}</span>
            <span>{formatToken(run.executionMode)}</span>
            <span>{formatToken(run.source)}</span>
          </div>
          <code title={run.sourcePath}>{run.sourcePath}</code>
          {run.statusMessage && <p>{run.statusMessage}</p>}
          {run.entries.slice(0, 3).map((entry, index) => (
            <p className="hook-entry" key={`${run.id}:${index}`}>
              <b>{formatToken(entry.kind)}</b> {entry.text}
            </p>
          ))}
          <footer>
            <span title={run.threadId}>{run.threadId.slice(0, 8)}</span>
            {run.turnId && <span title={run.turnId}>{run.turnId.slice(0, 8)}</span>}
            {run.durationMs !== null && <span>{formatDuration(run.durationMs)}</span>}
          </footer>
        </article>
      ))}
    </div>
  );
}

function compareHooks(a: HookMetadata, b: HookMetadata): number {
  const eventOrder = a.eventName.localeCompare(b.eventName, undefined, { sensitivity: "base" });
  if (eventOrder !== 0) return eventOrder;
  return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: "base" });
}

function parseHookNotification(value: unknown): HookRun | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || !isRecord(value.run)) return null;
  const run = value.run;
  if (
    typeof run.id !== "string" ||
    typeof run.eventName !== "string" ||
    typeof run.handlerType !== "string" ||
    typeof run.executionMode !== "string" ||
    typeof run.scope !== "string" ||
    typeof run.sourcePath !== "string" ||
    typeof run.source !== "string" ||
    typeof run.status !== "string"
  ) return null;

  const entries = Array.isArray(run.entries)
    ? run.entries.flatMap((entry): HookOutputEntry[] =>
        isRecord(entry) && typeof entry.kind === "string" && typeof entry.text === "string"
          ? [{ kind: entry.kind, text: entry.text }]
          : [])
    : [];

  return {
    id: run.id,
    threadId: value.threadId,
    turnId: typeof value.turnId === "string" ? value.turnId : null,
    eventName: run.eventName,
    handlerType: run.handlerType,
    executionMode: run.executionMode,
    scope: run.scope,
    sourcePath: run.sourcePath,
    source: run.source,
    status: run.status,
    statusMessage: typeof run.statusMessage === "string" ? run.statusMessage : null,
    startedAt: finiteNumber(run.startedAt) ?? Date.now(),
    completedAt: finiteNumber(run.completedAt),
    durationMs: finiteNumber(run.durationMs),
    entries,
  };
}

function upsertHookRun(current: HookRun[], next: HookRun): HookRun[] {
  const index = current.findIndex((run) => run.id === next.id);
  const updated = index === -1
    ? [...current, next]
    : current.map((run, runIndex) => runIndex === index ? next : run);
  return updated.slice(-MAX_RETAINED_RUNS);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatToken(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatTimeout(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "No timeout";
  return `${seconds}s timeout`;
}
