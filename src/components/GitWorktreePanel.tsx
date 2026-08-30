import { useMemo, useState } from "react";
import {
  MAX_GIT_WORKTREE_ENTRIES,
  type GitWorktreeEntry,
  type GitWorktreeListResponse,
} from "../runtime/gitWorktreeProtocol";
import "./gitWorktreePanel.css";

const MAX_RENDERED_WORKTREES = 128;

export interface GitWorktreePanelProps {
  cwd: string;
  inventory: GitWorktreeListResponse | null;
  loading: boolean;
  stale?: boolean;
  error?: string | null;
  onLoad: () => void;
}

/**
 * Pure presentation/control surface for SyndridCLI's authoritative linked-worktree
 * inventory. This component never discovers repositories, resolves paths, executes
 * Git, or polls. The parent owns the explicit runtime request and invalidation.
 */
export function GitWorktreePanel({
  cwd,
  inventory,
  loading,
  stale = false,
  error = null,
  onLoad,
}: GitWorktreePanelProps) {
  const [filter, setFilter] = useState("");
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const matchingEntries = useMemo(
    () =>
      inventory?.entries.filter((entry) => {
        if (!normalizedFilter) return true;
        return `${entry.path} ${entry.branch ?? ""} ${entry.head ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedFilter);
      }) ?? [],
    [inventory, normalizedFilter],
  );
  const visibleEntries = matchingEntries.slice(0, MAX_RENDERED_WORKTREES);

  return (
    <section className="git-worktrees" aria-label="Linked Git worktrees">
      <div className="git-worktrees-heading">
        <span>
          <strong>Worktrees</strong>
          <small>
            {inventory
              ? stale
                ? "Runtime state changed · refresh explicitly"
                : `${inventory.entries.length.toLocaleString()} linked ${inventory.entries.length === 1 ? "worktree" : "worktrees"}`
              : "Loads only when requested"}
          </small>
        </span>
        <button disabled={loading || !cwd} onClick={onLoad} type="button">
          {loading ? "Loading…" : inventory ? (stale ? "Refresh · updated" : "Refresh") : "Load"}
        </button>
      </div>

      {error ? (
        <div className="git-worktrees-state error">{error}</div>
      ) : !inventory ? (
        <div className="git-worktrees-state">
          Worktree discovery is explicit so opening Source Control performs no additional Git work.
        </div>
      ) : (
        <>
          {inventory.entries.length > 8 && (
            <div className="git-worktrees-filter">
              <input
                aria-label="Filter linked worktrees"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter paths, branches, commits…"
                spellCheck={false}
                value={filter}
              />
              <small>
                {normalizedFilter
                  ? `${matchingEntries.length.toLocaleString()} of ${inventory.entries.length.toLocaleString()}`
                  : `${inventory.entries.length.toLocaleString()} total`}
              </small>
              {filter && (
                <button onClick={() => setFilter("")} type="button">
                  Clear
                </button>
              )}
            </div>
          )}

          {visibleEntries.length > 0 ? (
            <div className="git-worktrees-list">
              {visibleEntries.map((entry) => (
                <WorktreeRow key={entry.path} entry={entry} />
              ))}
            </div>
          ) : (
            <div className="git-worktrees-state compact">
              {normalizedFilter ? "No linked worktrees match this filter." : "No linked worktrees reported."}
            </div>
          )}

          {matchingEntries.length > MAX_RENDERED_WORKTREES && (
            <div className="git-worktrees-state compact">
              Rendering capped at {MAX_RENDERED_WORKTREES.toLocaleString()} of {matchingEntries.length.toLocaleString()} matching worktrees.
            </div>
          )}
          {inventory.truncated && (
            <div className="git-worktrees-state compact">
              SyndridCLI capped this inventory at {MAX_GIT_WORKTREE_ENTRIES.toLocaleString()} entries.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function WorktreeRow({ entry }: { entry: GitWorktreeEntry }) {
  return (
    <article className={`git-worktree-row${entry.current ? " current" : ""}`}>
      <div className="git-worktree-primary">
        <span className="git-worktree-path" title={entry.path}>
          {entry.path}
        </span>
        <small title={entry.branch ?? entry.head ?? undefined}>
          {entry.branch ?? (entry.detached ? "Detached HEAD" : entry.bare ? "Bare worktree" : "Branch unavailable")}
          {entry.head ? ` · ${entry.head.slice(0, 12)}` : ""}
        </small>
      </div>
      <div className="git-worktree-badges" aria-label="Worktree state">
        {entry.current && <span>Current</span>}
        {entry.locked && <span title={entry.lockReason ?? undefined}>Locked</span>}
        {entry.prunable && <span title={entry.pruneReason ?? undefined}>Prunable</span>}
        {entry.bare && <span>Bare</span>}
      </div>
    </article>
  );
}
