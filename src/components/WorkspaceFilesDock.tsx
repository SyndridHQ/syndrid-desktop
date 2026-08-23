import { useCallback, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type {
  FsReadDirectoryEntry,
  FuzzyFileSearchResult,
} from "../runtime/protocol";
import "./workspaceFilesDock.css";

const MAX_DIRECTORY_ENTRIES = 250;
const MAX_SEARCH_RESULTS = 80;

export function WorkspaceFilesDock() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [entries, setEntries] = useState<FsReadDirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FuzzyFileSearchResult[]>([]);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPath = pathStack.at(-1) ?? rootPath;
  const supportsResolvedPaths = entries.some((entry) => Boolean(entry.path));

  const loadRoot = useCallback(async () => {
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
        setPathStack([]);
        setEntries([]);
        setLoaded(true);
        return;
      }

      const result = await appServerClient.readDirectory({ path: root });
      setRootPath(root);
      setPathStack([root]);
      setEntries(result.entries);
      setSearchResults([]);
      setSearchAttempted(false);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const navigateTo = useCallback(
    async (path: string, stack: string[]) => {
      if (loading) return;
      setLoading(true);
      setError(null);
      try {
        const result = await appServerClient.readDirectory({ path });
        setPathStack(stack);
        setEntries(result.entries);
        setSearchResults([]);
        setSearchAttempted(false);
        setQuery("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const openDirectory = useCallback(
    (entry: FsReadDirectoryEntry) => {
      if (!entry.isDirectory || !entry.path || loading) return;
      void navigateTo(entry.path, [...pathStack, entry.path]);
    },
    [loading, navigateTo, pathStack],
  );

  const goBack = useCallback(() => {
    if (pathStack.length <= 1 || loading) return;
    const nextStack = pathStack.slice(0, -1);
    const target = nextStack.at(-1);
    if (target) void navigateTo(target, nextStack);
  }, [loading, navigateTo, pathStack]);

  const refreshCurrent = useCallback(() => {
    if (currentPath && pathStack.length > 0) {
      void navigateTo(currentPath, pathStack);
    } else {
      void loadRoot();
    }
  }, [currentPath, loadRoot, navigateTo, pathStack]);

  const search = useCallback(async () => {
    const normalized = query.trim();
    if (!rootPath || searching || !normalized) return;

    setSearching(true);
    setError(null);
    setSearchAttempted(true);
    try {
      const result = await appServerClient.fuzzyFileSearch({
        query: normalized,
        roots: [rootPath],
        cancellationToken: null,
      });
      setSearchResults(result.files.slice(0, MAX_SEARCH_RESULTS));
    } catch (cause) {
      setSearchResults([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSearching(false);
    }
  }, [query, rootPath, searching]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setSearchResults([]);
    setSearchAttempted(false);
  }, []);

  const sortedEntries = useMemo(
    () => [...entries].sort(compareEntries),
    [entries],
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void loadRoot();
  };

  const showingSearch = searchAttempted || query.trim().length > 0;

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
              <small title={currentPath ?? undefined}>
                {currentPath ?? "Latest active session workspace"}
              </small>
            </span>
            <div className="workspace-files-actions">
              {pathStack.length > 1 && (
                <button disabled={loading} onClick={goBack} type="button">
                  Back
                </button>
              )}
              <button disabled={loading} onClick={refreshCurrent} type="button">
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </header>

          {rootPath && (
            <form
              className="workspace-file-search"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <input
                aria-label="Find workspace files"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find files in workspace…"
                value={query}
              />
              {showingSearch && (
                <button onClick={clearSearch} type="button">
                  Clear
                </button>
              )}
              <button disabled={searching || !query.trim()} type="submit">
                {searching ? "Finding…" : "Find"}
              </button>
            </form>
          )}

          {error ? (
            <div className="workspace-files-state error">{error}</div>
          ) : loading && !loaded ? (
            <div className="workspace-files-state">Reading workspace root…</div>
          ) : !rootPath ? (
            <div className="workspace-files-state">No session workspace reported.</div>
          ) : showingSearch ? (
            <SearchResults
              attempted={searchAttempted}
              results={searchResults}
              searching={searching}
            />
          ) : sortedEntries.length === 0 ? (
            <div className="workspace-files-state">This directory is empty.</div>
          ) : (
            <div className="workspace-files-list">
              {sortedEntries.slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => {
                const navigable = entry.isDirectory && Boolean(entry.path);
                return (
                  <button
                    className={`workspace-file-row ${navigable ? "navigable" : ""}`}
                    disabled={!navigable}
                    key={entry.path ?? entry.fileName}
                    onClick={() => openDirectory(entry)}
                    title={entry.path ?? entry.fileName}
                    type="button"
                  >
                    <span aria-hidden="true">{entry.isDirectory ? "▸" : "·"}</span>
                    <code>{entry.fileName}</code>
                    <small>{entry.isDirectory ? "folder" : entry.isFile ? "file" : "other"}</small>
                  </button>
                );
              })}
              {sortedEntries.length > MAX_DIRECTORY_ENTRIES && (
                <div className="workspace-files-state compact">
                  Showing {MAX_DIRECTORY_ENTRIES} of {sortedEntries.length} entries.
                </div>
              )}
            </div>
          )}
          <footer>
            Runtime-backed · explicit reads only · {supportsResolvedPaths ? "lazy folder navigation" : "root-only on this runtime"} · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

interface SearchResultsProps {
  attempted: boolean;
  results: FuzzyFileSearchResult[];
  searching: boolean;
}

function SearchResults({ attempted, results, searching }: SearchResultsProps) {
  if (searching && !attempted) {
    return <div className="workspace-files-state">Searching runtime index…</div>;
  }
  if (attempted && results.length === 0 && !searching) {
    return <div className="workspace-files-state">No matching files reported.</div>;
  }

  return (
    <div className="workspace-files-list search-results" aria-live="polite">
      {results.map((result, index) => (
        <div
          className="workspace-file-row search-result"
          key={`${result.root}:${result.path}:${index}`}
        >
          <span aria-hidden="true">·</span>
          <code title={result.path}>{result.path}</code>
          <small>{result.file_name}</small>
        </div>
      ))}
      {searching && (
        <div className="workspace-files-state compact">Refreshing search…</div>
      )}
    </div>
  );
}

function compareEntries(a: FsReadDirectoryEntry, b: FsReadDirectoryEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.fileName.localeCompare(b.fileName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
