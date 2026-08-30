import { useMemo, useState, useSyncExternalStore } from "react";
import {
  clearRuntimeWarnings,
  getRuntimeWarningsSnapshot,
  MAX_RETAINED_WARNINGS,
  subscribeRuntimeWarnings,
  type WarningKind,
} from "../runtime/runtimeWarningsStore";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./warningsDock.css";

const MAX_RENDERED_WARNINGS = 24;
const WARNING_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
type WarningScope = "selected" | "all";

export function WarningsDock() {
  const workspace = useRuntimeWorkspace();
  const entries = useSyncExternalStore(
    subscribeRuntimeWarnings,
    getRuntimeWarningsSnapshot,
    getRuntimeWarningsSnapshot,
  );
  const [scope, setScope] = useState<WarningScope>("selected");

  const visible = useMemo(() => {
    const selectedThreadId = workspace?.threadId ?? null;
    const filtered = scope === "all"
      ? entries
      : entries.filter(
          (entry) => entry.threadId === null || entry.threadId === selectedThreadId,
        );
    return filtered.slice(0, MAX_RENDERED_WARNINGS);
  }, [entries, scope, workspace?.threadId]);

  const errorCount = visible.filter((entry) => entry.kind === "error").length;

  return (
    <section className="warnings-panel">
      <header>
        <span>
          <strong>Runtime warnings</strong>
          <small>Errors, safety warnings, configuration notices, and deprecations from SyndridCLI</small>
        </span>
        <button disabled={entries.length === 0} onClick={clearRuntimeWarnings} type="button">
          Clear
        </button>
      </header>

      <div className="warnings-toolbar">
        <div>
          <button
            aria-pressed={scope === "selected"}
            className={scope === "selected" ? "active" : ""}
            onClick={() => setScope("selected")}
            type="button"
          >
            Selected + global
          </button>
          <button
            aria-pressed={scope === "all"}
            className={scope === "all" ? "active" : ""}
            onClick={() => setScope("all")}
            type="button"
          >
            All runtime
          </button>
        </div>
        <small>
          {visible.length} shown
          {errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? "" : "s"}` : ""}
        </small>
      </div>

      {visible.length === 0 ? (
        <div className="warnings-state">No retained runtime warnings in this scope.</div>
      ) : (
        <div className="warnings-list">
          {visible.map((entry) => (
            <article className={`warning-row ${entry.kind}`} key={entry.id}>
              <div className="warning-row-title">
                <strong>{entry.title}</strong>
                <span>{formatKind(entry.kind)}</span>
              </div>
              {entry.details && <p>{entry.details}</p>}
              <div className="warning-row-meta">
                <time dateTime={new Date(entry.receivedAt).toISOString()}>
                  {WARNING_TIME_FORMAT.format(new Date(entry.receivedAt))}
                </time>
                {entry.occurrences > 1 && <span>{entry.occurrences.toLocaleString()} occurrences</span>}
                {entry.threadId && <code title={entry.threadId}>{shortId(entry.threadId)}</code>}
                {entry.path && <code title={entry.path}>{entry.path}</code>}
                {entry.willRetry !== null && (
                  <span>{entry.willRetry ? "runtime will retry" : "no retry reported"}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <footer>
        {entries.length > MAX_RENDERED_WARNINGS
          ? `Retains at most ${MAX_RETAINED_WARNINGS} notices · renders latest ${MAX_RENDERED_WARNINGS} in scope · event-driven, no polling`
          : "Runtime notifications only · bounded retention · no polling"}
      </footer>
    </section>
  );
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

function formatKind(kind: WarningKind): string {
  return kind === "guardian" ? "safety" : kind;
}
