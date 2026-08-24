import { useCallback, useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./reviewDock.css";

const MAX_RETAINED_REVIEWS = 8;

type ReviewLaunch = {
  threadId: string;
  turnId: string;
  status: unknown;
  createdAt: number;
};

export function ReviewDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [reviews, setReviews] = useState<ReviewLaunch[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReviews([]);
    setError(null);
    setStarting(false);
  }, [workspace?.threadId]);

  useEffect(() => {
    if (!open || reviews.length === 0) return;
    const reviewThreadIds = new Set(reviews.map((review) => review.threadId));
    return appServerClient.onNotification((notification) => {
      if (notification.method !== "thread/status/changed") return;
      const params = toRecord(notification.params);
      if (!params || typeof params.threadId !== "string" || !reviewThreadIds.has(params.threadId)) {
        return;
      }
      setReviews((current) =>
        current.map((review) =>
          review.threadId === params.threadId ? { ...review, status: params.status } : review,
        ),
      );
    });
  }, [open, reviews]);

  const startReview = useCallback(async () => {
    if (starting || appServerClient.getSnapshot().phase !== "ready") return;
    const sourceThreadId = workspace?.threadId;
    if (!sourceThreadId) {
      setError("Select a loaded Syndrid session before starting a review.");
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const result = await appServerClient.startReview({
        threadId: sourceThreadId,
        target: { type: "uncommittedChanges" },
        delivery: "detached",
      });
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== sourceThreadId) return;
      setReviews((current) => [
        {
          threadId: result.reviewThreadId,
          turnId: result.turn.id,
          status: result.turn.status,
          createdAt: Date.now(),
        },
        ...current.filter((review) => review.threadId !== result.reviewThreadId),
      ].slice(0, MAX_RETAINED_REVIEWS));
    } catch (cause) {
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== sourceThreadId) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [starting, workspace?.threadId]);

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
              disabled={starting || !workspace?.threadId}
              onClick={() => void startReview()}
              type="button"
            >
              {starting ? "Starting…" : "Review changes"}
            </button>
          </header>

          <div className="review-explainer">
            Starts SyndridCLI's uncommitted-changes review on a detached runtime thread. Your selected session stays in place.
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
                  <code title={review.threadId}>thread {shortId(review.threadId)}</code>
                  <code title={review.turnId}>turn {shortId(review.turnId)}</code>
                </article>
              ))}
            </div>
          )}

          <footer>Runtime-owned review · detached thread · streamed lifecycle · no polling</footer>
        </section>
      )}
    </aside>
  );
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
