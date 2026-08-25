import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ThreadGoal, ThreadGoalStatus } from "../runtime/threadGoalProtocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./goalDock.css";

const MAX_OBJECTIVE_CHARS = 8_000;
const GOAL_STATUSES: ThreadGoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
];

export function GoalDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [goal, setGoal] = useState<ThreadGoal | null>(null);
  const [objective, setObjective] = useState("");
  const [status, setStatus] = useState<ThreadGoalStatus>("active");
  const [tokenBudget, setTokenBudget] = useState("");
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const dirtyRef = useRef(false);

  const dirty = useMemo(() => {
    const currentBudget = goal?.tokenBudget === null || goal?.tokenBudget === undefined
      ? ""
      : String(goal.tokenBudget);
    return (
      objective !== (goal?.objective ?? "") ||
      status !== (goal?.status ?? "active") ||
      tokenBudget.trim() !== currentBudget
    );
  }, [goal, objective, status, tokenBudget]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const applyGoal = useCallback((next: ThreadGoal | null) => {
    setGoal(next);
    setObjective(next?.objective ?? "");
    setStatus(next?.status ?? "active");
    setTokenBudget(next?.tokenBudget === null || next?.tokenBudget === undefined ? "" : String(next.tokenBudget));
    setExternalUpdate(false);
  }, []);

  const load = useCallback(async () => {
    const threadId = workspace?.threadId;
    if (!threadId) {
      applyGoal(null);
      setError("Select a loaded Syndrid session first.");
      return;
    }
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before editing the session objective.");
      return;
    }

    const requestGeneration = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const response = await appServerClient.getThreadGoal({ threadId });
      if (
        requestGeneration !== generation.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== threadId
      ) {
        return;
      }
      applyGoal(response.goal);
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [applyGoal, workspace?.threadId]);

  useEffect(() => {
    generation.current += 1;
    setLoading(false);
    setSaving(false);
    setClearing(false);
    setGoal(null);
    setObjective("");
    setStatus("active");
    setTokenBudget("");
    setExternalUpdate(false);
    setConfirmClear(false);
    setError(null);
    if (open) void load();
    // Selected runtime thread is the sole selection invalidation trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.threadId]);

  useEffect(() => {
    const threadId = workspace?.threadId;
    if (!open || !threadId) return;

    return appServerClient.onNotification((notification) => {
      const params = toRecord(notification.params);
      if (!params || params.threadId !== threadId) return;

      if (notification.method === "thread/goal/updated") {
        const nextGoal = parseThreadGoal(params.goal);
        if (!nextGoal) return;
        if (dirtyRef.current) {
          setGoal(nextGoal);
          setExternalUpdate(true);
        } else {
          applyGoal(nextGoal);
        }
      } else if (notification.method === "thread/goal/cleared") {
        if (dirtyRef.current) {
          setGoal(null);
          setExternalUpdate(true);
        } else {
          applyGoal(null);
        }
      }
    });
  }, [applyGoal, open, workspace?.threadId]);

  const save = useCallback(async () => {
    const threadId = workspace?.threadId;
    if (!threadId || saving) return;
    const trimmedObjective = objective.trim();
    if (!trimmedObjective) {
      setError("Objective cannot be empty. Use Clear objective to remove it.");
      return;
    }

    let parsedBudget: number | null = null;
    if (tokenBudget.trim()) {
      parsedBudget = Number(tokenBudget);
      if (!Number.isSafeInteger(parsedBudget) || parsedBudget <= 0) {
        setError("Token budget must be a positive whole number or left blank.");
        return;
      }
    }

    const requestGeneration = ++generation.current;
    setSaving(true);
    setError(null);
    try {
      const response = await appServerClient.setThreadGoal({
        threadId,
        objective: trimmedObjective,
        status,
        tokenBudget: parsedBudget,
      });
      if (
        requestGeneration !== generation.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== threadId
      ) {
        return;
      }
      applyGoal(response.goal);
    } catch (cause) {
      if (
        requestGeneration !== generation.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== threadId
      ) {
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === generation.current) setSaving(false);
    }
  }, [applyGoal, objective, saving, status, tokenBudget, workspace?.threadId]);

  const clear = useCallback(async () => {
    const threadId = workspace?.threadId;
    if (!threadId || clearing) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }

    const requestGeneration = ++generation.current;
    setClearing(true);
    setError(null);
    try {
      const response = await appServerClient.clearThreadGoal({ threadId });
      if (
        requestGeneration !== generation.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== threadId
      ) {
        return;
      }
      if (!response.cleared) {
        setError("Runtime did not clear the objective. Refresh to reconcile.");
        return;
      }
      applyGoal(null);
      setConfirmClear(false);
    } catch (cause) {
      if (
        requestGeneration !== generation.current ||
        appServerClient.getWorkspaceSnapshot()?.threadId !== threadId
      ) {
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === generation.current) setClearing(false);
    }
  }, [applyGoal, clearing, confirmClear, workspace?.threadId]);

  return (
    <aside className="goal-dock" aria-label="Session objective">
      <button className="goal-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span aria-hidden="true">◎</span>
        Objective
        {goal && <span>{formatStatus(goal.status)}</span>}
      </button>

      {open && (
        <section className="goal-panel">
          <header>
            <span>
              <strong>Session objective</strong>
              <small title={workspace?.cwd}>{workspace?.cwd || "Selected session"}</small>
            </span>
            <button disabled={loading || saving || clearing} onClick={() => void load()} type="button">
              {loading ? "Loading…" : externalUpdate ? "Reload · updated" : "Reload"}
            </button>
          </header>

          {!workspace?.threadId ? (
            <div className="goal-state">Select a loaded session first.</div>
          ) : loading && !goal ? (
            <div className="goal-state">Reading runtime objective…</div>
          ) : (
            <div className="goal-form">
              <label>
                <span>Objective</span>
                <textarea
                  maxLength={MAX_OBJECTIVE_CHARS}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder="Define the outcome Syndrid should optimize this session toward…"
                  rows={5}
                  value={objective}
                />
                <small>{objective.length.toLocaleString()} / {MAX_OBJECTIVE_CHARS.toLocaleString()}</small>
              </label>

              <div className="goal-fields">
                <label>
                  <span>Status</span>
                  <select onChange={(event) => setStatus(event.target.value as ThreadGoalStatus)} value={status}>
                    {GOAL_STATUSES.map((value) => (
                      <option key={value} value={value}>{formatStatus(value)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Token budget</span>
                  <input
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => setTokenBudget(event.target.value)}
                    placeholder="Runtime default"
                    type="number"
                    value={tokenBudget}
                  />
                </label>
              </div>

              {goal && (
                <div className="goal-usage">
                  <span>{goal.tokensUsed.toLocaleString()} tokens used</span>
                  <span>{formatDuration(goal.timeUsedSeconds)}</span>
                  {goal.tokenBudget !== null && (
                    <span>{formatPercent(goal.tokensUsed, goal.tokenBudget)} of budget</span>
                  )}
                </div>
              )}

              {externalUpdate && (
                <div className="goal-notice">
                  Runtime objective changed while you were editing. Reload before saving if you want the latest values.
                </div>
              )}
              {error && <div className="goal-state error">{error}</div>}

              <div className="goal-actions">
                <button disabled={!dirty || saving || clearing || externalUpdate} onClick={() => void save()} type="button">
                  {saving ? "Saving…" : "Save objective"}
                </button>
                {(goal || objective) && (
                  <button className={confirmClear ? "danger" : ""} disabled={saving || clearing} onClick={() => void clear()} type="button">
                    {clearing ? "Clearing…" : confirmClear ? "Confirm clear" : "Clear objective"}
                  </button>
                )}
                {confirmClear && !clearing && (
                  <button onClick={() => setConfirmClear(false)} type="button">Cancel</button>
                )}
              </div>
            </div>
          )}

          <footer>Runtime-owned goal · explicit writes · event-synchronized · no polling</footer>
        </section>
      )}
    </aside>
  );
}

function parseThreadGoal(value: unknown): ThreadGoal | null {
  const record = toRecord(value);
  if (!record) return null;
  if (
    typeof record.threadId !== "string" ||
    typeof record.objective !== "string" ||
    !isGoalStatus(record.status) ||
    (record.tokenBudget !== null && typeof record.tokenBudget !== "number") ||
    typeof record.tokensUsed !== "number" ||
    typeof record.timeUsedSeconds !== "number" ||
    typeof record.createdAt !== "number" ||
    typeof record.updatedAt !== "number"
  ) {
    return null;
  }
  return record as unknown as ThreadGoal;
}

function isGoalStatus(value: unknown): value is ThreadGoalStatus {
  return typeof value === "string" && GOAL_STATUSES.includes(value as ThreadGoalStatus);
}

function formatStatus(status: ThreadGoalStatus): string {
  if (status === "usageLimited") return "Usage limited";
  if (status === "budgetLimited") return "Budget limited";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s runtime`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m runtime`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m runtime`;
}

function formatPercent(used: number, budget: number): string {
  if (budget <= 0) return "—";
  return `${Math.min(999, Math.round((used / budget) * 100))}%`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
