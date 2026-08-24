import { useCallback, useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ReviewTarget } from "../runtime/reviewProtocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./reviewDock.css";

const MAX_RETAINED_REVIEWS = 8;
const MAX_REVIEW_OUTPUT_CHARS = 40_000;
type ReviewTargetKind = ReviewTarget["type"];

type ReviewLaunch = {
  threadId: string;
  turnId: string;
  status: unknown;
  createdAt: number;
  targetLabel: string;
  output: string;
  outputTruncated: boolean;
};

export function ReviewDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [targetKind, setTargetKind] = useState<ReviewTargetKind>("uncommittedChanges");
  const [targetValue, setTargetValue] = useState("");
  const [reviews, setReviews] = useState<ReviewLaunch[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReviews([]);
    setError(null);
    setStarting(false);
  }, [workspace?.threadId]);

  useEffect(() => {
    if (!open) return;
    return appServerClient.onNotification((notification) => {
      const params = toRecord(notification.params);
      if (!params || typeof params.threadId !== "string") return;

      if (notification.method === "thread/status/changed") {
        setReviews((current) => {
          if (!current.some((review) => review.threadId === params.threadId)) return current;
          return current.map((review) =>
            review.threadId === params.threadId ? { ...review, status: params.status } : review,
          );
        });
        return;
      }

      if (notification.method !== "item/agentMessage/delta" || typeof params.delta !== "string") {
        return;
      }

      setReviews((current) => {
        if (!current.some((review) => review.threadId === params.threadId)) return current;
        return current.map((review) => {
          if (review.threadId !== params.threadId || review.outputTruncated) return review;
          const nextOutput = review.output + params.delta;
          if (nextOutput.length <= MAX_REVIEW_OUTPUT_CHARS) {
            return { ...review, output: nextOutput };
          }
          return {
            ...review,
            output: nextOutput.slice(0, MAX_REVIEW_OUTPUT_CHARS),
            outputTruncated: true,
          };
        });
      });
    });
  }, [open]);

  const reviewTarget = useMemo(() => buildReviewTarget(targetKind, targetValue), [targetKind, targetValue]);

  const startReview = useCallback(async () => {
    if (starting || appServerClient.getSnapshot().phase !== "ready") return;
    const sourceThreadId = workspace?.threadId;
    if (!sourceThreadId) {
      setError("Select a loaded Syndrid session before starting a review.");
      return;
    }
    if (!reviewTarget) {
      setError(targetValidationMessage(targetKind));
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const result = await appServerClient.startReview({
        threadId: sourceThreadId,
        target: reviewTarget,
        delivery: "detached",
      });
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== sourceThreadId) return;
      setReviews((current) => [
        {
          threadId: result.reviewThreadId,
          turnId: result.turn.id,
          status: result.turn.status,
          createdAt: Date.now(),
          targetLabel: formatTarget(reviewTarget),
          output: "",
          outputTruncated: false,
        },
        ...current.filter((review) => review.threadId !== result.reviewThreadId),
      ].slice(0, MAX_RETAINED_REVIEWS));
    } catch (cause) {
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== sourceThreadId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [reviewTarget, starting, targetKind, workspace?.threadId]);

  const activeCount = useMemo(
    () => reviews.filter((review) => isRunningStatus(review.status)).length,
    [reviews],
  );

  return (
    <aside className="review-dock" aria-label="Code review">
      <button className="review-toggle" onClick={() => setOpen((current) => !current)} type="button">
        <span aria-hidden="true">✓</span>
        Review
        {activeCount > 0 && <span>{activeCount}</span>}
      </button>

      {open && (
        <section className="review-panel">
          <header>
            <span>
              <strong>Runtime code review</strong>
              <small title={workspace?.cwd}>{workspace?.cwd ?? "Selected session workspace"}</small>
            </span>
            <button
              disabled={starting || !workspace?.threadId || !reviewTarget}
              onClick={() => void startReview()}
              type="button"
            >
              {starting ? "Starting…" : "Start review"}
            </button>
          </header>

          <div className="review-explainer">
            Runs SyndridCLI review on a detached runtime thread. Review target selection stays declarative; Git and review execution remain runtime-owned.
          </div>

          <div className="review-target-controls">
            <label>
              <span>Target</span>
              <select
                aria-label="Review target"
                disabled={starting}
                onChange={(event) => {
                  setTargetKind(event.target.value as ReviewTargetKind);
                  setTargetValue("");
                  setError(null);
                }}
                value={targetKind}
              >
                <option value="uncommittedChanges">Uncommitted changes</option>
                <option value="baseBranch">Changes from base branch</option>
                <option value="commit">Single commit</option>
                <option value="custom">Custom review instructions</option>
              </select>
            </label>
            {targetKind !== "uncommittedChanges" && (
              <label className="review-target-value">
                <span>{targetInputLabel(targetKind)}</span>
                {targetKind === "custom" ? (
                  <textarea
                    aria-label="Custom review instructions"
                    disabled={starting}
                    maxLength={2000}
                    onChange={(event) => {
                      setTargetValue(event.target.value);
                      setError(null);
                    }}
                    placeholder="Review this change for concurrency hazards and resource leaks…"
                    rows={3}
                    value={targetValue}
                  />
                ) : (
                  <input
                    aria-label={targetInputLabel(targetKind)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    disabled={starting}
                    onChange={(event) => {
                      setTargetValue(event.target.value);
                      setError(null);
                    }}
                    placeholder={targetKind === "baseBranch" ? "main" : "commit SHA"}
                    spellCheck={false}
                    value={targetValue}
                  />
                )}
              </label>
            )}
          </div>

          {error ? (
            <div className="review-state error">{error}</div>
          ) : !workspace?.threadId ? (
            <div className="review-state">Select a loaded session first.</div>
          ) : reviews.length === 0 ? (
            <div className="review-state">No detached reviews launched for this selection.</div>
          ) : (
            <div className="review-list">
              {reviews.map((review) => (
                <article key={review.threadId}>
                  <div>
                    <strong>{formatStatus(review.status)}</strong>
                    <small>{formatAge(review.createdAt)}</small>
                  </div>
                  <span className="review-target-label" title={review.targetLabel}>{review.targetLabel}</span>
                  <code title={review.threadId}>thread {shortId(review.threadId)}</code>
                  <code title={review.turnId}>turn {shortId(review.turnId)}</code>
                  {review.output && (
                    <pre className="review-output">
                      {review.output}
                      {review.outputTruncated ? "\n\n[output truncated by Desktop retention limit]" : ""}
                    </pre>
                  )}
                </article>
              ))}
            </div>
          )}

          <footer>
            Runtime-owned review · streamed output · max {MAX_REVIEW_OUTPUT_CHARS.toLocaleString()} chars/review · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function buildReviewTarget(kind: ReviewTargetKind, value: string): ReviewTarget | null {
  const trimmed = value.trim();
  if (kind === "uncommittedChanges") return { type: "uncommittedChanges" };
  if (!trimmed) return null;
  if (kind === "baseBranch") return { type: "baseBranch", branch: trimmed };
  if (kind === "commit") return { type: "commit", sha: trimmed, title: null };
  return { type: "custom", instructions: trimmed };
}

function targetValidationMessage(kind: ReviewTargetKind): string {
  if (kind === "baseBranch") return "Enter the base branch Syndrid should review against.";
  if (kind === "commit") return "Enter the commit SHA Syndrid should review.";
  if (kind === "custom") return "Enter review instructions for Syndrid.";
  return "Select a review target.";
}

function targetInputLabel(kind: Exclude<ReviewTargetKind, "uncommittedChanges">): string {
  if (kind === "baseBranch") return "Base branch";
  if (kind === "commit") return "Commit SHA";
  return "Instructions";
}

function formatTarget(target: ReviewTarget): string {
  if (target.type === "uncommittedChanges") return "Uncommitted changes";
  if (target.type === "baseBranch") return `From ${target.branch}`;
  if (target.type === "commit") return `Commit ${shortId(target.sha)}`;
  const compact = target.instructions.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `Custom · ${compact.slice(0, 69)}…` : `Custom · ${compact}`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function formatStatus(status: unknown): string {
  if (typeof status === "string") return status;
  const record = toRecord(status);
  if (record) {
    for (const key of ["type", "status", "state"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return "review running";
}

function isRunningStatus(status: unknown): boolean {
  const value = formatStatus(status).toLocaleLowerCase();
  return value.includes("running") || value.includes("active") || value.includes("progress");
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatAge(createdAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
