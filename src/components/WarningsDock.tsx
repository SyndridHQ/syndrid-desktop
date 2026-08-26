import { useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { JsonRpcNotification } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./warningsDock.css";

const MAX_RETAINED_WARNINGS = 80;
const MAX_RENDERED_WARNINGS = 24;
const MAX_WARNING_TITLE_CHARS = 8_192;
const MAX_WARNING_DETAILS_CHARS = 32_768;
const MAX_WARNING_PATH_CHARS = 4_096;
const WARNING_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type WarningKind = "error" | "guardian" | "warning" | "config" | "deprecation";
type WarningScope = "selected" | "all";

interface RuntimeWarningEntry {
  id: number;
  kind: WarningKind;
  title: string;
  details: string | null;
  threadId: string | null;
  path: string | null;
  willRetry: boolean | null;
  receivedAt: number;
}

export function WarningsDock() {
  const workspace = useRuntimeWorkspace();
  const nextId = useRef(1);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<WarningScope>("selected");
  const [entries, setEntries] = useState<RuntimeWarningEntry[]>([]);

  useEffect(() => {
    return appServerClient.onNotification((notification) => {
      const parsed = parseWarningNotification(notification, nextId.current++);
      if (!parsed) return;
      setEntries((current) => [parsed, ...current].slice(0, MAX_RETAINED_WARNINGS));
    });
  }, []);

  const visible = useMemo(() => {
    const selectedThreadId = workspace?.threadId ?? null;
    const filtered = scope === "all"
      ? entries
      : entries.filter((entry) => entry.threadId === null || entry.threadId === selectedThreadId);
    return filtered.slice(0, MAX_RENDERED_WARNINGS);
  }, [entries, scope, workspace?.threadId]);

  const selectedCount = useMemo(() => {
    const selectedThreadId = workspace?.threadId ?? null;
    return entries.filter((entry) => entry.threadId === null || entry.threadId === selectedThreadId).length;
  }, [entries, workspace?.threadId]);

  const errorCount = visible.filter((entry) => entry.kind === "error").length;

  return (
    <aside className="warnings-dock" aria-label="Runtime warnings">
      <button className="warnings-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">!</span>
        Warnings
        {selectedCount > 0 && <span>{selectedCount}</span>}
      </button>

      {open && (
        <section className="warnings-panel">
          <header>
            <span>
              <strong>Runtime warnings</strong>
              <small>Errors, safety warnings, configuration notices, and deprecations from SyndridCLI</small>
            </span>
            <button disabled={entries.length === 0} onClick={() => setEntries([])} type="button">
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
            <small>{visible.length} shown{errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? "" : "s"}` : ""}</small>
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
                    {entry.threadId && <code title={entry.threadId}>{shortId(entry.threadId)}</code>}
                    {entry.path && <code title={entry.path}>{entry.path}</code>}
                    {entry.willRetry !== null && <span>{entry.willRetry ? "runtime will retry" : "no retry reported"}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}

          {entries.length > MAX_RENDERED_WARNINGS && (
            <footer>
              Retains at most {MAX_RETAINED_WARNINGS} notices · renders latest {MAX_RENDERED_WARNINGS} in scope · event-driven, no polling
            </footer>
          )}
          {entries.length <= MAX_RENDERED_WARNINGS && (
            <footer>Runtime notifications only · bounded retention · no polling</footer>
          )}
        </section>
      )}
    </aside>
  );
}

function parseWarningNotification(
  notification: JsonRpcNotification,
  id: number,
): RuntimeWarningEntry | null {
  const params = toRecord(notification.params);
  if (!params) return null;
  const receivedAt = Date.now();

  if (notification.method === "warning") {
    const message = boundedString(params.message, MAX_WARNING_TITLE_CHARS);
    if (!message) return null;
    return {
      id,
      kind: "warning",
      title: message,
      details: null,
      threadId: nullableString(params.threadId),
      path: null,
      willRetry: null,
      receivedAt,
    };
  }

  if (notification.method === "guardianWarning") {
    const message = boundedString(params.message, MAX_WARNING_TITLE_CHARS);
    const threadId = stringValue(params.threadId);
    if (!message || !threadId) return null;
    return {
      id,
      kind: "guardian",
      title: message,
      details: null,
      threadId,
      path: null,
      willRetry: null,
      receivedAt,
    };
  }

  if (notification.method === "configWarning") {
    const summary = boundedString(params.summary, MAX_WARNING_TITLE_CHARS);
    if (!summary) return null;
    return {
      id,
      kind: "config",
      title: summary,
      details: boundedString(params.details, MAX_WARNING_DETAILS_CHARS),
      threadId: null,
      path: boundedString(params.path, MAX_WARNING_PATH_CHARS),
      willRetry: null,
      receivedAt,
    };
  }

  if (notification.method === "deprecationNotice") {
    const summary = boundedString(params.summary, MAX_WARNING_TITLE_CHARS);
    if (!summary) return null;
    return {
      id,
      kind: "deprecation",
      title: summary,
      details: boundedString(params.details, MAX_WARNING_DETAILS_CHARS),
      threadId: null,
      path: null,
      willRetry: null,
      receivedAt,
    };
  }

  if (notification.method === "error") {
    const error = toRecord(params.error);
    const message = error ? boundedString(error.message, MAX_WARNING_TITLE_CHARS) : null;
    const threadId = stringValue(params.threadId);
    if (!message || !threadId) return null;
    const additionalDetails = error
      ? boundedString(error.additionalDetails, MAX_WARNING_DETAILS_CHARS)
      : null;
    return {
      id,
      kind: "error",
      title: message,
      details: additionalDetails,
      threadId,
      path: null,
      willRetry: typeof params.willRetry === "boolean" ? params.willRetry : null,
      receivedAt,
    };
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function boundedString(value: unknown, maxChars: number): string | null {
  const text = stringValue(value);
  if (!text) return null;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

function formatKind(kind: WarningKind): string {
  if (kind === "guardian") return "safety";
  return kind;
}
