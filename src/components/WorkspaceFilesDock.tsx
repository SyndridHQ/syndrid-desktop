import { useCallback, useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type {
  FsReadDirectoryEntry,
  FuzzyFileSearchResult,
} from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./workspaceFilesDock.css";

const MAX_DIRECTORY_ENTRIES = 250;
const MAX_SEARCH_RESULTS = 80;
const MAX_PREVIEW_BYTES = 256 * 1024;

interface FilePreview {
  path: string;
  name: string;
  status: "loading" | "ready" | "unavailable" | "oversized" | "binary" | "error";
  sizeBytes?: number;
  text?: string;
  message?: string;
}

export function WorkspaceFilesDock() {
  const workspace = useRuntimeWorkspace();
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
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentPath = pathStack.at(-1) ?? rootPath;
  const supportsResolvedPaths = entries.some((entry) => Boolean(entry.path));

  const loadRoot = useCallback(async () => {
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before browsing workspace files.");
      return;
    }

    const root = workspace?.cwd.trim();
    if (!root) {
      setRootPath(null);
      setPathStack([]);
      setEntries([]);
      setSearchResults([]);
      setSearchAttempted(false);
      setPreview(null);
      setLoaded(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await appServerClient.readDirectory({ path: root });
      setRootPath(root);
      setPathStack([root]);
      setEntries(result.entries);
      setQuery("");
      setSearchResults([]);
      setSearchAttempted(false);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [workspace?.cwd]);

  useEffect(() => {
    setLoaded(false);
    setRootPath(null);
    setPathStack([]);
    setEntries([]);
    setQuery("");
    setSearchResults([]);
    setSearchAttempted(false);
    setPreview(null);
    setError(null);
    if (open) void loadRoot();
  }, [loadRoot, open, workspace?.threadId]);

  const navigateTo = useCallback(
    async (path: string, stack: string[]) => {
      if (loading) return;
      setLoading(true);
      setError(null);
      setPreview(null);
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

  const previewPath = useCallback(async (path: string, name: string) => {
    setPreview({ path, name, status: "loading" });
    try {
      const metadata = await appServerClient.getMetadata({ path });
      if (!metadata.isFile) {
        setPreview({
          path,
          name,
          status: "unavailable",
          message: "The selected path is no longer a regular file.",
        });
        return;
      }

      if (typeof metadata.sizeBytes !== "number") {
        setPreview({
          path,
          name,
          status: "unavailable",
          message: "This runtime cannot size-gate file previews yet.",
        });
        return;
      }

      if (metadata.sizeBytes > MAX_PREVIEW_BYTES) {
        setPreview({
          path,
          name,
          status: "oversized",
          sizeBytes: metadata.sizeBytes,
          message: `Preview skipped because the file exceeds ${formatBytes(MAX_PREVIEW_BYTES)}.`,
        });
        return;
      }

      const result = await appServerClient.readFile({ path });
      const bytes = decodeBase64(result.dataBase64);
      if (bytes.byteLength > MAX_PREVIEW_BYTES) {
        setPreview({
          path,
          name,
          status: "oversized",
          sizeBytes: bytes.byteLength,
          message: "Preview stopped because the returned content exceeded the preview limit.",
        });
        return;
      }

      if (bytes.includes(0)) {
        setPreview({
          path,
          name,
          status: "binary",
          sizeBytes: bytes.byteLength,
          message: "Binary content is not rendered as text.",
        });
        return;
      }

      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        setPreview({
          path,
          name,
          status: "binary",
          sizeBytes: bytes.byteLength,
          message: "The file is not valid UTF-8 text, so the desktop did not render it.",
        });
        return;
      }

      setPreview({
        path,
        name,
        status: "ready",
        sizeBytes: bytes.byteLength,
        text,
      });
    } catch (cause) {
      setPreview({
        path,
        name,
        status: "error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  const previewFile = useCallback(
    (entry: FsReadDirectoryEntry) => {
      if (!entry.isFile || !entry.path) return;
      void previewPath(entry.path, entry.fileName);
    },
    [previewPath],
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

  const toggle = () => setOpen((current) => !current);
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
              <small title={currentPath ?? workspace?.cwd}>
                {currentPath ?? workspace?.cwd ?? "Selected session workspace"}
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
            <div className="workspace-files-state">Reading selected workspace…</div>
          ) : !rootPath ? (
            <div className="workspace-files-state">No selected session workspace reported.</div>
          ) : showingSearch ? (
            <SearchResults
              attempted={searchAttempted}
              onPreview={(result) => void previewPath(result.path, result.file_name)}
              results={searchResults}
              searching={searching}
            />
          ) : sortedEntries.length === 0 ? (
            <div className="workspace-files-state">This directory is empty.</div>
          ) : (
            <div className="workspace-files-list">
              {sortedEntries.slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => {
                const navigable = entry.isDirectory && Boolean(entry.path);
                const previewable = entry.isFile && Boolean(entry.path);
                const interactive = navigable || previewable;
                return (
                  <button
                    className={`workspace-file-row ${interactive ? "navigable" : ""}`}
                    disabled={!interactive}
                    key={entry.path ?? entry.fileName}
                    onClick={() => {
                      if (entry.isDirectory) openDirectory(entry);
                      else if (entry.isFile) previewFile(entry);
                    }}
                    title={entry.path ?? entry.fileName}
                    type="button"
                  >
                    <span aria-hidden="true">{entry.isDirectory ? "▸" : entry.isFile ? "·" : "?"}</span>
                    <code>{entry.fileName}</code>
                    <small>{entry.isDirectory ? "folder" : entry.isFile ? "preview" : "other"}</small>
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

          {preview && (
            <FilePreviewPanel preview={preview} onClose={() => setPreview(null)} />
          )}

          <footer>
            Runtime-backed · selected session · explicit reads only · {supportsResolvedPaths ? "lazy navigation + bounded preview" : "root-only on this runtime"} · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function FilePreviewPanel({
  preview,
  onClose,
}: {
  preview: FilePreview;
  onClose: () => void;
}) {
  return (
    <section className="workspace-file-preview" aria-live="polite">
      <header>
        <span>
          <strong>{preview.name}</strong>
          <small title={preview.path}>{preview.path}</small>
        </span>
        <button onClick={onClose} type="button">Close</button>
      </header>
      {preview.status === "loading" ? (
        <div className="workspace-files-state compact">Checking metadata…</div>
      ) : preview.status === "ready" ? (
        <>
          <div className="workspace-file-preview-meta">
            UTF-8 · {formatBytes(preview.sizeBytes ?? 0)} · read after metadata gate
          </div>
          <pre>{preview.text}</pre>
        </>
      ) : (
        <div className={`workspace-files-state compact ${preview.status === "error" ? "error" : ""}`}>
          {preview.message ?? "Preview unavailable."}
          {preview.sizeBytes !== undefined && ` · ${formatBytes(preview.sizeBytes)}`}
        </div>
      )}
    </section>
  );
}

interface SearchResultsProps {
  attempted: boolean;
  onPreview: (result: FuzzyFileSearchResult) => void;
  results: FuzzyFileSearchResult[];
  searching: boolean;
}

function SearchResults({ attempted, onPreview, results, searching }: SearchResultsProps) {
  if (searching && !attempted) {
    return <div className="workspace-files-state">Searching runtime index…</div>;
  }
  if (attempted && results.length === 0 && !searching) {
    return <div className="workspace-files-state">No matching files reported.</div>;
  }

  return (
    <div className="workspace-files-list search-results" aria-live="polite">
      {results.map((result, index) => (
        <button
          className="workspace-file-row search-result navigable"
          key={`${result.root}:${result.path}:${index}`}
          onClick={() => onPreview(result)}
          title={`Preview ${result.path}`}
          type="button"
        >
          <span aria-hidden="true">·</span>
          <code>{result.path}</code>
          <small>{result.file_name}</small>
        </button>
      ))}
      {searching && (
        <div className="workspace-files-state compact">Refreshing search…</div>
      )}
    </div>
  );
}

function decodeBase64(value: string): Uint8Array {
  const decoded = window.atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function compareEntries(a: FsReadDirectoryEntry, b: FsReadDirectoryEntry): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.fileName.localeCompare(b.fileName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
