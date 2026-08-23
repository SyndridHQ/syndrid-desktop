import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  modifiedAtMs?: number;
  isSymlink?: boolean;
  workspaceThreadId?: string;
  text?: string;
  message?: string;
}

export function WorkspaceFilesDock() {
  const workspace = useRuntimeWorkspace();
  const previewRequestRef = useRef(0);
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

  const clearPreview = useCallback(() => {
    previewRequestRef.current += 1;
    setPreview(null);
  }, []);

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
      clearPreview();
      setLoaded(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    clearPreview();
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
  }, [clearPreview, workspace?.cwd]);

  useEffect(() => {
    setLoaded(false);
    setRootPath(null);
    setPathStack([]);
    setEntries([]);
    setQuery("");
    setSearchResults([]);
    setSearchAttempted(false);
    clearPreview();
    setError(null);
    if (open) void loadRoot();
  }, [clearPreview, loadRoot, open, workspace?.threadId]);

  const navigateTo = useCallback(
    async (path: string, stack: string[]) => {
      if (loading) return;
      setLoading(true);
      setError(null);
      clearPreview();
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
    [clearPreview, loading],
  );

  const openDirectory = useCallback(
    (entry: FsReadDirectoryEntry) => {
      if (!entry.isDirectory || !entry.path || loading) return;
      void navigateTo(entry.path, [...pathStack, entry.path]);
    },
    [loading, navigateTo, pathStack],
  );

  const previewPath = useCallback(async (path: string, name: string) => {
    const requestGeneration = ++previewRequestRef.current;
    const requestedThreadId = workspace?.threadId;
    if (!requestedThreadId) return;

    setPreview({ path, name, status: "loading", workspaceThreadId: requestedThreadId });
    const isCurrentRequest = () =>
      previewRequestRef.current === requestGeneration &&
      appServerClient.getWorkspaceSnapshot()?.threadId === requestedThreadId;

    try {
      const metadata = await appServerClient.getMetadata({ path });
      if (!isCurrentRequest()) return;
      if (!metadata.isFile) {
        setPreview({
          path,
          name,
          status: "unavailable",
          workspaceThreadId: requestedThreadId,
          message: "The selected path is no longer a regular file.",
        });
        return;
      }

      if (typeof metadata.sizeBytes !== "number") {
        setPreview({
          path,
          name,
          status: "unavailable",
          workspaceThreadId: requestedThreadId,
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
          workspaceThreadId: requestedThreadId,
          message: `Preview skipped because the file exceeds ${formatBytes(MAX_PREVIEW_BYTES)}.`,
        });
        return;
      }

      const result = await appServerClient.readFile({ path });
      if (!isCurrentRequest()) return;
      const bytes = decodeBase64(result.dataBase64);
      if (bytes.byteLength > MAX_PREVIEW_BYTES) {
        setPreview({
          path,
          name,
          status: "oversized",
          sizeBytes: bytes.byteLength,
          workspaceThreadId: requestedThreadId,
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
          workspaceThreadId: requestedThreadId,
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
          workspaceThreadId: requestedThreadId,
          message: "The file is not valid UTF-8 text, so the desktop did not render it.",
        });
        return;
      }

      setPreview({
        path,
        name,
        status: "ready",
        sizeBytes: bytes.byteLength,
        modifiedAtMs: metadata.modifiedAtMs,
        isSymlink: metadata.isSymlink,
        workspaceThreadId: requestedThreadId,
        text,
      });
    } catch (cause) {
      if (!isCurrentRequest()) return;
      setPreview({
        path,
        name,
        status: "error",
        workspaceThreadId: requestedThreadId,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [workspace?.threadId]);

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
            <FilePreviewPanel
              onClose={clearPreview}
              onSaved={(text, sizeBytes, modifiedAtMs) => {
                setPreview((current) =>
                  current && current.path === preview.path
                    ? { ...current, text, sizeBytes, modifiedAtMs, message: undefined }
                    : current,
                );
              }}
              preview={preview}
            />
          )}

          <footer>
            Runtime-backed · selected session · explicit reads/writes only · {supportsResolvedPaths ? "lazy navigation + bounded editor" : "root-only on this runtime"} · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function FilePreviewPanel({
  preview,
  onClose,
  onSaved,
}: {
  preview: FilePreview;
  onClose: () => void;
  onSaved: (text: string, sizeBytes: number, modifiedAtMs: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(preview.text ?? "");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraft(preview.text ?? "");
    setSaving(false);
    setSaveMessage(null);
    setSaveError(null);
  }, [preview.modifiedAtMs, preview.path, preview.text]);

  const editable =
    preview.status === "ready" &&
    preview.isSymlink === false &&
    typeof preview.modifiedAtMs === "number" &&
    preview.modifiedAtMs > 0 &&
    typeof preview.sizeBytes === "number" &&
    typeof preview.text === "string" &&
    typeof preview.workspaceThreadId === "string";
  const dirty = editing && draft !== (preview.text ?? "");

  const save = async () => {
    if (!editable || !dirty || saving || !preview.workspaceThreadId) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const currentWorkspace = appServerClient.getWorkspaceSnapshot();
      if (currentWorkspace?.threadId !== preview.workspaceThreadId) {
        throw new Error("The selected session changed. Reopen the file before saving.");
      }

      const encoded = new TextEncoder().encode(draft);
      if (encoded.byteLength > MAX_PREVIEW_BYTES) {
        throw new Error(`Save blocked because the edited file exceeds ${formatBytes(MAX_PREVIEW_BYTES)}.`);
      }

      const metadata = await appServerClient.getMetadata({ path: preview.path });
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== preview.workspaceThreadId) {
        throw new Error("The selected session changed. Reopen the file before saving.");
      }
      if (!metadata.isFile || metadata.isSymlink) {
        throw new Error("Save blocked because the path is no longer the same regular file.");
      }
      if (
        metadata.modifiedAtMs !== preview.modifiedAtMs ||
        metadata.sizeBytes !== preview.sizeBytes
      ) {
        throw new Error("The file changed on disk after it was opened. Reopen it before saving.");
      }

      const currentFile = await appServerClient.readFile({ path: preview.path });
      const currentBytes = decodeBase64(currentFile.dataBase64);
      if (currentBytes.byteLength > MAX_PREVIEW_BYTES || currentBytes.includes(0)) {
        throw new Error("The file changed to unsupported content. Reopen it before saving.");
      }
      let currentText: string;
      try {
        currentText = new TextDecoder("utf-8", { fatal: true }).decode(currentBytes);
      } catch {
        throw new Error("The file is no longer valid UTF-8 text. Reopen it before saving.");
      }
      if (currentText !== preview.text) {
        throw new Error("The file contents changed after it was opened. Reopen it before saving.");
      }
      if (appServerClient.getWorkspaceSnapshot()?.threadId !== preview.workspaceThreadId) {
        throw new Error("The selected session changed. Reopen the file before saving.");
      }

      await appServerClient.writeFile({
        path: preview.path,
        dataBase64: encodeBase64(encoded),
      });
      const after = await appServerClient.getMetadata({ path: preview.path });
      const nextModifiedAtMs = after.modifiedAtMs > 0 ? after.modifiedAtMs : Date.now();
      const nextSizeBytes = typeof after.sizeBytes === "number" ? after.sizeBytes : encoded.byteLength;
      onSaved(draft, nextSizeBytes, nextModifiedAtMs);
      setEditing(false);
      setSaveMessage("Saved through Syndrid runtime.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="workspace-file-preview" aria-live="polite">
      <header>
        <span>
          <strong>{preview.name}{dirty ? " · unsaved" : ""}</strong>
          <small title={preview.path}>{preview.path}</small>
        </span>
        <div className="workspace-file-preview-actions">
          {preview.status === "ready" && !editing && (
            <button disabled={!editable} onClick={() => setEditing(true)} type="button">
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                disabled={saving}
                onClick={() => {
                  setDraft(preview.text ?? "");
                  setEditing(false);
                  setSaveError(null);
                  setSaveMessage(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button disabled={!dirty || saving} onClick={() => void save()} type="button">
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
          <button disabled={saving} onClick={onClose} type="button">Close</button>
        </div>
      </header>
      {preview.status === "loading" ? (
        <div className="workspace-files-state compact">Checking metadata…</div>
      ) : preview.status === "ready" ? (
        <>
          <div className="workspace-file-preview-meta">
            UTF-8 · {formatBytes(preview.sizeBytes ?? 0)} · {editing ? "local draft; explicit save" : "read after metadata gate"}
            {preview.isSymlink && " · symlink editing disabled"}
            {!preview.isSymlink && (preview.modifiedAtMs ?? 0) <= 0 && " · edit conflict checks unavailable"}
          </div>
          {editing ? (
            <textarea
              aria-label={`Edit ${preview.name}`}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaveError(null);
                setSaveMessage(null);
              }}
              spellCheck={false}
              value={draft}
            />
          ) : (
            <pre>{preview.text}</pre>
          )}
          {saveError && <div className="workspace-file-save-message error">{saveError}</div>}
          {saveMessage && <div className="workspace-file-save-message success">{saveMessage}</div>}
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

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
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
