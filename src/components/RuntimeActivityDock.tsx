import { useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import {
  activityFromLifecycle,
  isRuntimeItemLifecycleEnvelope,
  upsertRuntimeActivity,
  type RuntimeActivity,
} from "../runtime/activity";
import "./runtimeActivityDock.css";

const ITEM_STARTED = "item/started";
const ITEM_COMPLETED = "item/completed";

export function RuntimeActivityDock() {
  const [activities, setActivities] = useState<RuntimeActivity[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    return appServerClient.onNotification((notification) => {
      if (
        notification.method !== ITEM_STARTED &&
        notification.method !== ITEM_COMPLETED
      ) {
        return;
      }
      if (!isRuntimeItemLifecycleEnvelope(notification.params)) return;

      const activity = activityFromLifecycle(
        notification.params,
        notification.method === ITEM_STARTED ? "running" : "completed",
      );
      if (!activity) return;

      setActivities((current) => upsertRuntimeActivity(current, activity));
    });
  }, [open]);

  const runningCount = useMemo(
    () => activities.filter((activity) => activity.phase === "running").length,
    [activities],
  );
  const recent = useMemo(() => activities.slice(-12).reverse(), [activities]);

  const toggleOpen = () => {
    if (open) setActivities([]);
    setOpen((current) => !current);
  };

  return (
    <section className={`runtime-activity-dock ${open ? "open" : ""}`}>
      <button
        aria-expanded={open}
        className="runtime-activity-toggle"
        onClick={toggleOpen}
        type="button"
      >
        <span className={`runtime-activity-dot ${runningCount > 0 ? "busy" : ""}`} />
        <span>Runtime activity</span>
        <span className="runtime-activity-count">
          {runningCount > 0 ? `${runningCount} running` : activities.length}
        </span>
      </button>

      {open && (
        <div className="runtime-activity-panel">
          <header>
            <div>
              <strong>Authoritative runtime events</strong>
              <small>Commands, files, tools and subagents from app-server</small>
            </div>
            <button
              disabled={activities.length === 0}
              onClick={() => setActivities([])}
              type="button"
            >
              Clear
            </button>
          </header>

          <div className="runtime-activity-list">
            {recent.length === 0 ? (
              <div className="runtime-activity-empty">
                Activity appears here when Syndrid executes work.
              </div>
            ) : (
              recent.map((activity) => (
                <article
                  className={`runtime-activity-card phase-${activity.phase}`}
                  key={`${activity.threadId}-${activity.id}`}
                >
                  <div className="runtime-activity-card-head">
                    <span>{kindLabel(activity.kind)}</span>
                    <em>{activity.phase === "running" ? "Running" : activity.status ?? "Done"}</em>
                  </div>
                  <strong title={activity.title}>{activity.title}</strong>
                  {activity.detail && <small title={activity.detail}>{activity.detail}</small>}
                  <footer>
                    <span>{activity.turnId.slice(0, 8)}</span>
                    {activity.completedAtMs !== null && activity.startedAtMs !== null && (
                      <span>{formatDuration(activity.completedAtMs - activity.startedAtMs)}</span>
                    )}
                  </footer>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function kindLabel(kind: RuntimeActivity["kind"]): string {
  switch (kind) {
    case "command": return "Command";
    case "file-change": return "Files";
    case "mcp-tool": return "MCP";
    case "dynamic-tool": return "Tool";
    case "subagent": return "Subagent";
    case "web-search": return "Web";
    case "image-generation": return "Image";
    default: return "Runtime";
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;
}
