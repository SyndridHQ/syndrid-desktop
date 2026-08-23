import { useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./contextDock.css";

const TOKEN_USAGE_UPDATED = "thread/tokenUsage/updated";
const MAX_THREAD_SNAPSHOTS = 32;

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

export function ContextDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ContextSnapshot[]>([]);

  useEffect(() =>
    appServerClient.onNotification((notification) => {
      if (notification.method !== TOKEN_USAGE_UPDATED) return;
      const next = parseContextSnapshot(notification.params);
      if (!next) return;
      setSnapshots((current) => upsertSnapshot(current, next));
    }), []);

  const snapshot = useMemo(
    () => workspace ? snapshots.find((item) => item.threadId === workspace.threadId) ?? null : null,
    [snapshots, workspace],
  );
  const used = snapshot?.last.totalTokens ?? null;
  const windowSize = snapshot?.modelContextWindow ?? null;
  const utilization = used !== null && windowSize && windowSize > 0
    ? Math.min(100, Math.max(0, (used / windowSize) * 100))
    : null;

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
              Waiting for Syndrid to report token usage for this session.
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

          <footer>
            Runtime-reported · latest {MAX_THREAD_SNAPSHOTS} sessions · no local token estimator
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
