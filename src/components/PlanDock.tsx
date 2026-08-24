import { useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./planDock.css";

type PlanStepStatus = "pending" | "inProgress" | "completed";

interface PlanStep {
  step: string;
  status: PlanStepStatus;
}

interface PlanSnapshot {
  threadId: string;
  turnId: string;
  explanation: string | null;
  plan: PlanStep[];
  updatedAt: number;
}

const MAX_STEPS = 80;

export function PlanDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null);

  useEffect(() => {
    setSnapshot(null);
  }, [workspace?.threadId]);

  useEffect(() => {
    if (!open) return;
    return appServerClient.onNotification((notification) => {
      if (notification.method !== "turn/plan/updated") return;
      const params = toRecord(notification.params);
      if (!params) return;
      const threadId = params.threadId;
      const turnId = params.turnId;
      if (
        typeof threadId !== "string" ||
        typeof turnId !== "string" ||
        threadId !== workspace?.threadId
      ) {
        return;
      }

      const rawPlan = Array.isArray(params.plan) ? params.plan : [];
      const plan = rawPlan.flatMap((value) => {
        const record = toRecord(value);
        const step = record?.step;
        const status = record?.status;
        if (
          typeof step !== "string" ||
          !isPlanStepStatus(status)
        ) {
          return [];
        }
        return [{ step, status } satisfies PlanStep];
      });

      setSnapshot({
        threadId,
        turnId,
        explanation: typeof params.explanation === "string" ? params.explanation : null,
        plan: plan.slice(0, MAX_STEPS),
        updatedAt: Date.now(),
      });
    });
  }, [open, workspace?.threadId]);

  const counts = useMemo(() => summarize(snapshot?.plan ?? []), [snapshot]);

  return (
    <aside className="plan-dock" aria-label="Agent plan">
      <button className="plan-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">≋</span>
        Plan
        {snapshot && <span>{counts.completed}/{snapshot.plan.length}</span>}
      </button>

      {open && (
        <section className="plan-panel">
          <header>
            <span>
              <strong>Runtime plan</strong>
              <small title={workspace?.cwd}>{workspace?.cwd || "Selected session"}</small>
            </span>
            {snapshot && <code title={snapshot.turnId}>{shortId(snapshot.turnId)}</code>}
          </header>

          {!workspace?.threadId ? (
            <div className="plan-state">Select a loaded session first.</div>
          ) : !snapshot ? (
            <div className="plan-state">
              Waiting for Syndrid to publish a plan for this session.
            </div>
          ) : (
            <>
              <div className="plan-summary">
                <span>{counts.completed} completed</span>
                <span>{counts.inProgress} active</span>
                <span>{counts.pending} pending</span>
                <span>{formatRelativeTime(snapshot.updatedAt)}</span>
              </div>

              {snapshot.explanation && <p className="plan-explanation">{snapshot.explanation}</p>}

              <ol className="plan-list">
                {snapshot.plan.map((step, index) => (
                  <li className={`plan-step plan-${step.status}`} key={`${index}-${step.step}`}>
                    <span aria-hidden="true">{statusGlyph(step.status)}</span>
                    <span>{step.step}</span>
                    <small>{formatStatus(step.status)}</small>
                  </li>
                ))}
              </ol>
            </>
          )}

          <footer>
            Runtime-owned · event-driven · latest selected-thread plan · max {MAX_STEPS} steps
          </footer>
        </section>
      )}
    </aside>
  );
}

function summarize(plan: PlanStep[]): Record<PlanStepStatus, number> {
  const counts: Record<PlanStepStatus, number> = {
    pending: 0,
    inProgress: 0,
    completed: 0,
  };
  for (const step of plan) counts[step.status] += 1;
  return counts;
}

function isPlanStepStatus(value: unknown): value is PlanStepStatus {
  return value === "pending" || value === "inProgress" || value === "completed";
}

function formatStatus(status: PlanStepStatus): string {
  if (status === "inProgress") return "in progress";
  return status;
}

function statusGlyph(status: PlanStepStatus): string {
  if (status === "completed") return "✓";
  if (status === "inProgress") return "●";
  return "○";
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatRelativeTime(timestampMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (seconds < 10) return "updated now";
  if (seconds < 60) return `updated ${seconds}s ago`;
  return `updated ${Math.floor(seconds / 60)}m ago`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}