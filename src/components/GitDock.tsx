import { useCallback, useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./gitDock.css";

const MAX_DIFF_CHARS = 250_000;

export function GitDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [baseSha, setBaseSha] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [diffTruncated, setDiffTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gitInfo = workspace?.git ?? null;

  useEffect(() => {
    setLoadingDiff(false);
    setDiffLoaded(false);
    setBaseSha(null);
    setDiff("");
    setDiffTruncated(false);
    setError(null);
  }, [workspace?.threadId, workspace?.cwd]);

  const loadDiff = useCallback(async () => {
    const cwd = workspace?.cwd;
    if (!cwd || loadingDiff) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before loading repository changes.");
      return;
    }

    setLoadingDiff(true);
    setError(null);
    try {
      const result = await appServerClient.gitDiffToRemote({ cwd });
      if (appServerClient.getWorkspaceSnapshot()?.cwd !== cwd) return;

      const isTruncated = result.diff.length > MAX_DIFF_CHARS;
      setBaseSha(result.sha);
      setDiff(isTruncated ? result.diff.slice(0, MAX_DIFF_CHARS) : result.diff);
      setDiffTruncated(isTruncated);
      setDiffLoaded(true);
    } catch (cause) {
      if (appServerClient.getWorkspaceSnapshot()?.cwd === cwd) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (appServerClient.getWorkspaceSnapshot()?.cwd === cwd) {
        setLoadingDiff(false);
      }
    }
  }, [loadingDiff, workspace?.cwd]);

  const diffStats = useMemo(() => summarizeDiff(diff), [diff]);

  return (
    <aside className="git-dock" aria-label="Git overview">
      <button
        className="git-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">⑂</span>
        Git
        {gitInfo?.branch && <span>{gitInfo.branch}</span>}
      </button>

      {open && (
        <section className="git-panel">
          <header>
            <span>
              <strong>Source Control</strong>
              <small title={workspace?.cwd}>{workspace?.cwd ?? "Selected session workspace"}</small>
            </span>
            {workspace && gitInfo && (
              <button disabled={loadingDiff} onClick={() => void loadDiff()} type="button">
                {loadingDiff ? "Loading…" : diffLoaded ? "Refresh diff" : "Load diff"}
              </button>
            )}
          </header>

          {!workspace ? (
            <div className="git-state">Select a session to inspect its repository.</div>
          ) : !gitInfo ? (
            <div className="git-state">No Git repository metadata reported for this session.</div>
          ) : (
            <>
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

              {error ? (
                <div className="git-state error">{error}</div>
              ) : loadingDiff && !diffLoaded ? (
                <div className="git-state">Computing remote-relative diff in SyndridCLI…</div>
              ) : diffLoaded ? (
                <section className="git-diff" aria-label="Remote-relative diff">
                  <div className="git-diff-heading">
                    <span>
                      <strong>Working tree → remote</strong>
                      <small title={baseSha ?? undefined}>
                        Merge base {baseSha ? baseSha.slice(0, 12) : "unknown"}
                      </small>
                    </span>
                    {diff && (
                      <em>
                        +{diffStats.added} −{diffStats.removed}
                      </em>
                    )}
                  </div>
                  {diff ? (
                    <>
                      <pre>{diff}</pre>
                      {diffTruncated && (
                        <div className="git-state compact">
                          Display limited to {MAX_DIFF_CHARS.toLocaleString()} characters.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="git-state compact">No remote-relative changes reported.</div>
                  )}
                </section>
              ) : (
                <div className="git-state compact">
                  Diff loading is explicit so opening Source Control performs no Git work.
                </div>
              )}
            </>
          )}

          <footer>
            Runtime-owned Git · diff loads on demand · no polling or desktop git subprocesses
          </footer>
        </section>
      )}
    </aside>
  );
}

function summarizeDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}
