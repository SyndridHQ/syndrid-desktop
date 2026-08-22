import { useCallback, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { FsReadDirectoryEntry } from "../runtime/protocol";
import "./workspaceFilesDock.css";

export function WorkspaceFilesDock() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsReadDirectoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (loading) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before browsing workspace files.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const threads = await appServerClient.listThreads({
        limit: 1,
        archived: false,
        sortKey: "updated_at",
        sortDirection: "desc",
      });
      const root = threads.data[0]?.cwd?.trim();
      if (!root) {
        setRootPath(null);
        setEntries([]);
        setLoaded(true);
        return;
      }

      const result = await appServerClient.readDirectory({ path: root });
      setRootPath(root);
      setEntries(result.entries);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const sortedEntries = useMemo(
    () => [...entries].sort(compareEntries),
    [entries],
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void load();
  };

  return (
    <aside className="workspace-files-dock" aria-label="Workspace files">
      <button className="workspace-files-toggle" onClick={toggle} type="button">
        <span aria-hidden="true">▤</span>
        Files
        {loaded && <span>{entries.length}</span>}
      </button>
      {open && (
        <section className="workspace-files-panel">
          <header>
            <span>
              <strong>Workspace files</strong>
              <small title={rootPath ?? undefined}>
                {rootPath ?? "Latest active session workspace"}
              </small>
            </span>
            <button disabled={loading} onClick={() => void load()} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </header>
          {error ? (
            <div className="workspace-files-state error">{error}</div>
          ) : loading && !loaded ? (
            <div className="workspace-files-state">Reading workspace root…</div>
          ) : !rootPath ? (
            <div className="workspace-files-state">No session workspace reported.</div>
          ) : sortedEntries.length === 0 ? (
            <div className="workspace-files-state">Workspace root is empty.</div>
          ) : (
            <div className="workspace-files-list">
              {sortedEntries.slice(0, 250).map((entry) => (
                <div className="workspace-file-row" key={entry.fileName}>
                  <span aria-hidden="true">{entry.isDirectory ? "▸" : "·"}</span>
                  <code title={entry.fileName}>{entry.fileName}</code>
                  <small>{entry.isDirectory ? "folder" : entry.isFile ? "file" : "other"}</small>
                </div>
              ))}
              {sortedEntries.length > 250 && (
                <div className="workspace-files-state compact">
                  Showing 250 of {sortedEntries.length} root entries.
                </div>
              )}
            </div>
          )}
          <footer>
            Root-only by design · no recursive scan or filesystem polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function compareEntries(a: FsReadDirectoryEntry, b: FsReadDirectoryEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.fileName.localeCompare(b.fileName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
