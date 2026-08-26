import { useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./contextDock.css";

const TOKEN_USAGE_UPDATED = "thread/tokenUsage/updated";
const ITEM_COMPLETED = "item/completed";
const MAX_THREAD_SNAPSHOTS = 32;
const MAX_COMPACTION_THREADS = 32;

type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

type ContextSnapshot = {
  threadId: string;
  turnId: string;
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
  receivedAt: number;
};

type CompactionSnapshot = {
  threadId: string;
  turnId: string;
  count: number;
  lastCompletedAtMs: number;
};

export function ContextDock() {
  const workspace = useRuntimeWorkspace();
  const compactUiGeneration = useRef(0);
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ContextSnapshot[]>([]);
  const [compactions, setCompactions] = useState<CompactionSnapshot[]>([]);
  const [compactConfirm, setCompactConfirm] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactRequestedThreadId, setCompactRequestedThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (!open && compactRequestedThreadId === null) return;

    return appServerClient.onNotification((notification) => {
      if (notification.method === TOKEN_USAGE_UPDATED) {
        if (!open) return;
        const next = parseContextSnapshot(notification.params);
        if (next) setSnapshots((current) => upsertSnapshot(current, next));
        return;
      }
      if (notification.method !== ITEM_COMPLETED) return;
      const next = parseCompaction(notification.params);
      if (!next) return;
      if (open) setCompactions((current) => upsertCompaction(current, next));
      setCompactRequestedThreadId((current) => current === next.threadId ? null : current);
    });
  }, [compactRequestedThreadId, open]);

  useEffect(() => {
    if (open) return;
    compactUiGeneration.current += 1;
    setSnapshots([]);
    setCompactions([]);
    setCompactConfirm(false);
    setCompacting(false);
    setCompactError(null);
  }, [open]);

  useEffect(() => {
    compactUiGeneration.current += 1;
    setCompactConfirm(false);
    setCompacting(false);
    setCompactError(null);
    setCompactRequestedThreadId(null);
  }, [workspace?.threadId]);

  const snapshot = useMemo(
    () => workspace ? snapshots.find((item) => item.threadId === workspace.threadId) ?? null : null,
    [snapshots, workspace],
  );
  const compaction = useMemo(
    () => workspace ? compactions.find((item) => item.threadId === workspace.threadId) ?? null : null,
    [compactions, workspace],
  );
  const used = snapshot?.last.totalTokens ?? null;
  const windowSize = snapshot?.modelContextWindow ?? null;
  const utilization = used !== null && windowSize && windowSize > 0
    ? Math.min(100, Math.max(0, (used / windowSize) * 100))
    : null;
  const compactRequested = workspace?.threadId === compactRequestedThreadId;

  const requestCompaction = async () => {
    const threadId = workspace?.threadId;
    if (!threadId || compacting) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setCompactError("Connect the Syndrid runtime before compacting context.");
      return;
    }

    const uiGeneration = compactUiGeneration.current;
    setCompacting(true);
    setCompactError(null);
    try {
      await appServerClient.compactThread({ threadId });
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== threadId) return;
      // Runtime completion tracking intentionally survives a closed panel. This
      // keeps the listener alive until SyndridCLI reports ContextCompaction while
      // preventing the old request from mutating a newly opened UI generation.
      setCompactRequestedThreadId(threadId);
      if (compactUiGeneration.current === uiGeneration) setCompactConfirm(false);
    } catch (cause) {
      if (
        appServerClient.getWorkspaceSnapshot()?.threadId !== threadId ||
        compactUiGeneration.current !== uiGeneration
      ) return;
      setCompactError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (
        appServerClient.getWorkspaceSnapshot()?.threadId === threadId &&
        compactUiGeneration.current === uiGeneration
      ) setCompacting(false);
    }
  };

  return (
    <aside className="context-dock" aria-label="Context usage">
      <button className="context-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">◔</span>
        Context
        {utilization !== null && <span>{Math.round(utilization)}%</span>}
      </button>
      {open && (
        <section className="context-panel">
          <header>
            <span>
              <strong>Context usage</strong>
              <small>{workspace?.cwd ?? "Select a Syndrid session"}</small>
            </span>
            {snapshot && <em title={snapshot.turnId}>turn {snapshot.turnId.slice(0, 8)}</em>}
          </header>

          {!workspace ? (
            <div className="context-empty">Select a session to inspect its runtime context.</div>
          ) : !snapshot ? (
            <div className="context-empty">
              Waiting for Syndrid to report token usage while Context is open.
            </div>
          ) : (
            <>
              <div className="context-meter" aria-label="Last request context utilization">
                <span style={{ width: `${utilization ?? 0}%` }} />
              </div>
              <dl className="context-grid">
                <Metric label="Last total" value={snapshot.last.totalTokens} />
                <Metric label="Context window" value={snapshot.modelContextWindow} />
                <Metric label="Input" value={snapshot.last.inputTokens} />
                <Metric label="Cached input" value={snapshot.last.cachedInputTokens} />
                <Metric label="Output" value={snapshot.last.outputTokens} />
                <Metric label="Reasoning" value={snapshot.last.reasoningOutputTokens} />
              </dl>
              <div className="context-cumulative">
                <strong>Session cumulative</strong>
                <span>{formatTokens(snapshot.total.totalTokens)} total</span>
                <span>{formatTokens(snapshot.total.inputTokens)} input</span>
                <span>{formatTokens(snapshot.total.outputTokens)} output</span>
              </div>
            </>
          )}

          {workspace && (
            <div className="context-compaction">
              <div className="context-compaction-copy">
                <strong>Compaction</strong>
                {compaction ? (
                  <span title={`Last compacted on turn ${compaction.turnId}`}>
                    {compaction.count} observed · last {formatRelativeTime(compaction.lastCompletedAtMs)}
                  </span>
                ) : (
                  <span>No compaction observed while Context has been open.</span>
                )}
                {compactRequested && <small>Runtime compaction requested; waiting for completion.</small>}
                {compactError && <small className="context-compaction-error">{compactError}</small>}
              </div>
              <div className="context-compaction-actions">
                {compactConfirm ? (
                  <>
                    <button disabled={compacting} onClick={() => void requestCompaction()} type="button">
                      {compacting ? "Compacting…" : "Confirm compact"}
                    </button>
                    <button disabled={compacting} onClick={() => setCompactConfirm(false)} type="button">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    disabled={compacting || compactRequested}
                    onClick={() => {
                      setCompactError(null);
                      setCompactConfirm(true);
                    }}
                    type="button"
                  >
                    {compactRequested ? "Compaction requested" : "Compact context"}
                  </button>
                )}
              </div>
            </div>
          )}

          <footer>
            Visible-only token stream · up to {MAX_THREAD_SNAPSHOTS} sessions · no local token estimator
          </footer>
        </section>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null ? "—" : formatTokens(value)}</dd>
    </div>
  );
}

function parseContextSnapshot(value: unknown): ContextSnapshot | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || typeof value.turnId !== "string") return null;
  if (!isRecord(value.tokenUsage)) return null;
  const total = parseBreakdown(value.tokenUsage.total);
  const last = parseBreakdown(value.tokenUsage.last);
  if (!total || !last) return null;
  const rawWindow = value.tokenUsage.modelContextWindow;
  const modelContextWindow = rawWindow === null ? null : finiteNumber(rawWindow);
  if (rawWindow !== null && modelContextWindow === null) return null;
  return {
    threadId: value.threadId,
    turnId: value.turnId,
    total,
    last,
    modelContextWindow,
    receivedAt: Date.now(),
  };
}

function parseCompaction(value: unknown): Omit<CompactionSnapshot, "count"> | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || typeof value.turnId !== "string") return null;
  if (!isRecord(value.item) || value.item.type !== "contextCompaction") return null;
  const completedAtMs = finiteNumber(value.completedAtMs);
  if (completedAtMs === null) return null;
  return {
    threadId: value.threadId,
    turnId: value.turnId,
    lastCompletedAtMs: completedAtMs,
  };
}

function parseBreakdown(value: unknown): TokenUsageBreakdown | null {
  if (!isRecord(value)) return null;
  const totalTokens = finiteNumber(value.totalTokens);
  const inputTokens = finiteNumber(value.inputTokens);
  const cachedInputTokens = finiteNumber(value.cachedInputTokens);
  const outputTokens = finiteNumber(value.outputTokens);
  const reasoningOutputTokens = finiteNumber(value.reasoningOutputTokens);
  if (
    totalTokens === null || inputTokens === null || cachedInputTokens === null ||
    outputTokens === null || reasoningOutputTokens === null
  ) return null;
  return { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
}

function upsertSnapshot(current: ContextSnapshot[], next: ContextSnapshot): ContextSnapshot[] {
  const withoutThread = current.filter((item) => item.threadId !== next.threadId);
  return [...withoutThread, next].slice(-MAX_THREAD_SNAPSHOTS);
}

function upsertCompaction(
  current: CompactionSnapshot[],
  next: Omit<CompactionSnapshot, "count">,
): CompactionSnapshot[] {
  const previous = current.find((item) => item.threadId === next.threadId);
  const withoutThread = current.filter((item) => item.threadId !== next.threadId);
  return [
    ...withoutThread,
    { ...next, count: (previous?.count ?? 0) + 1 },
  ].slice(-MAX_COMPACTION_THREADS);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatRelativeTime(timestampMs: number): string {
  const ageMs = Math.max(0, Date.now() - timestampMs);
  if (ageMs < 60_000) return "now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
}
