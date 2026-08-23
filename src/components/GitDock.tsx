import { useCallback, useEffect, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./gitDock.css";

interface GitInfo {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
}

export function GitDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before inspecting Git state.");
      return;
    }
    if (!workspace?.threadId) {
      setGitInfo(null);
      setLoaded(true);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await appServerClient.readThread({
        threadId: workspace.threadId,
        includeTurns: false,
      });
      setGitInfo(parseGitInfo(result.thread.gitInfo));
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [workspace?.threadId]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setGitInfo(null);
    setError(null);
    void load();
  }, [load, open]);

  return (
    <aside className="git-dock" aria-label="Git overview">
      <button
        className="git-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">⑂</span>
        Git
        {loaded && gitInfo?.branch && <span>{gitInfo.branch}</span>}
      </button>

      {open && (
        <section className="git-panel">
          <header>
            <span>
              <strong>Source Control</strong>
              <small title={workspace?.cwd}>{workspace?.cwd ?? "Selected session workspace"}</small>
            </span>
            <button disabled={loading} onClick={() => void load()} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </header>

          {error ? (
            <div className="git-state error">{error}</div>
          ) : loading && !loaded ? (
            <div className="git-state">Reading session Git metadata…</div>
          ) : !workspace ? (
            <div className="git-state">Select a session to inspect its repository.</div>
          ) : !gitInfo ? (
            <div className="git-state">No Git repository metadata reported for this session.</div>
          ) : (
            <dl className="git-summary">
              <div>
                <dt>Branch</dt>
                <dd title={gitInfo.branch ?? undefined}>{gitInfo.branch ?? "Detached / unknown"}</dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd title={gitInfo.sha ?? undefined}>{gitInfo.sha ? gitInfo.sha.slice(0, 12) : "Unknown"}</dd>
              </div>
              <div className="git-summary-wide">
                <dt>Origin</dt>
                <dd title={gitInfo.originUrl ?? undefined}>{gitInfo.originUrl ?? "No origin reported"}</dd>
              </div>
            </dl>
          )}

          <footer>
            Runtime thread metadata · read-only · status, diffs and worktrees stay runtime-owned
          </footer>
        </section>
      )}
    </aside>
  );
}

function parseGitInfo(value: unknown): GitInfo | null {
  if (!isRecord(value)) return null;
  const sha = nullableString(value.sha);
  const branch = nullableString(value.branch);
  const originUrl = nullableString(value.originUrl);
  if (sha === undefined || branch === undefined || originUrl === undefined) return null;
  return { sha, branch, originUrl };
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
