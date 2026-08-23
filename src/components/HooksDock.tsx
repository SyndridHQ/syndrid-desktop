import { useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import "./hooksDock.css";

const HOOK_STARTED = "hook/started";
const HOOK_COMPLETED = "hook/completed";
const MAX_RETAINED_RUNS = 80;
const MAX_VISIBLE_RUNS = 16;

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

export function HooksDock() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<HookRun[]>([]);

  useEffect(() =>
    appServerClient.onNotification((notification) => {
      if (notification.method !== HOOK_STARTED && notification.method !== HOOK_COMPLETED) return;
      const run = parseHookNotification(notification.params);
      if (!run) return;
      setRuns((current) => upsertHookRun(current, run));
    }), []);

  const runningCount = useMemo(
    () => runs.filter((run) => run.status === "running").length,
    [runs],
  );
  const recent = useMemo(() => runs.slice(-MAX_VISIBLE_RUNS).reverse(), [runs]);

  return (
    <aside className="hooks-dock" aria-label="Hook activity">
      <button className="hooks-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">↯</span>
        Hooks
        <span>{runningCount > 0 ? `${runningCount} running` : runs.length}</span>
      </button>
      {open && (
        <section className="hooks-panel">
          <header>
            <span>
              <strong>Hook activity</strong>
              <small>Authoritative hook lifecycle streamed by SyndridCLI</small>
            </span>
            <button disabled={runs.length === 0} onClick={() => setRuns([])} type="button">
              Clear
            </button>
          </header>

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

          <footer>Event-driven · retains {MAX_RETAINED_RUNS} runs · no polling</footer>
        </section>
      )}
    </aside>
  );
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
