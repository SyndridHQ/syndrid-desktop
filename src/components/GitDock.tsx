import { useState } from "react";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./gitDock.css";

export function GitDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const gitInfo = workspace?.git ?? null;

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
          </header>

          {!workspace ? (
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
            Runtime thread metadata · zero extra RPCs · status, diffs and worktrees stay runtime-owned
          </footer>
        </section>
      )}
    </aside>
  );
}
