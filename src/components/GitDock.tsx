import { useCallback, useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./gitDock.css";

const MAX_DIFF_CHARS = 250_000;
const MAX_DIFF_FILES = 200;

interface DiffSection {
  key: string;
  path: string;
  text: string;
  added: number;
  removed: number;
}

export function GitDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [baseSha, setBaseSha] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [diffTruncated, setDiffTruncated] = useState(false);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gitInfo = workspace?.git ?? null;

  useEffect(() => {
    setLoadingDiff(false);
    setDiffLoaded(false);
    setBaseSha(null);
    setDiff("");
    setDiffTruncated(false);
    setSelectedSectionKey(null);
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
      const retainedDiff = isTruncated ? result.diff.slice(0, MAX_DIFF_CHARS) : result.diff;
      setBaseSha(result.sha);
      setDiff(retainedDiff);
      setDiffTruncated(isTruncated);
      setSelectedSectionKey(firstDiffSectionKey(retainedDiff));
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
  const allDiffSections = useMemo(() => splitUnifiedDiff(diff), [diff]);
  const diffSections = useMemo(
    () => allDiffSections.slice(0, MAX_DIFF_FILES),
    [allDiffSections],
  );
  const selectedSection = useMemo(
    () =>
      diffSections.find((section) => section.key === selectedSectionKey) ??
      diffSections[0] ??
      null,
    [diffSections, selectedSectionKey],
  );

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
                      <strong>Remote merge base → working tree</strong>
                      <small title={baseSha ?? undefined}>
                        Merge base {baseSha ? baseSha.slice(0, 12) : "unknown"}
                      </small>
                    </span>
                    {diff && (
                      <em>
                        {allDiffSections.length > 0 && `${allDiffSections.length} files · `}
                        +{diffStats.added} −{diffStats.removed}
                      </em>
                    )}
                  </div>
                  {diff ? (
                    <>
                      {diffSections.length > 0 ? (
                        <div className="git-diff-layout">
                          <nav className="git-diff-files" aria-label="Changed files">
                            {diffSections.map((section) => (
                              <button
                                className={section.key === selectedSection?.key ? "selected" : ""}
                                key={section.key}
                                onClick={() => setSelectedSectionKey(section.key)}
                                title={section.path}
                                type="button"
                              >
                                <span>{section.path}</span>
                                <small>+{section.added} −{section.removed}</small>
                              </button>
                            ))}
                            {allDiffSections.length > MAX_DIFF_FILES && (
                              <div className="git-diff-file-limit">
                                Showing {MAX_DIFF_FILES} of {allDiffSections.length} files.
                              </div>
                            )}
                          </nav>
                          <div className="git-diff-file-view">
                            <div className="git-diff-file-title" title={selectedSection?.path}>
                              {selectedSection?.path ?? "Diff"}
                            </div>
                            <pre>{selectedSection?.text ?? diff}</pre>
                          </div>
                        </div>
                      ) : (
                        <pre>{diff}</pre>
                      )}
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

function firstDiffSectionKey(diff: string): string | null {
  return splitUnifiedDiff(diff)[0]?.key ?? null;
}

function splitUnifiedDiff(diff: string): DiffSection[] {
  if (!diff) return [];

  const lines = diff.split("\n");
  const sections: DiffSection[] = [];
  let start = -1;

  const pushSection = (end: number) => {
    if (start < 0 || end <= start) return;
    const sectionLines = lines.slice(start, end);
    const text = sectionLines.join("\n");
    const path = inferDiffPath(sectionLines, sections.length);
    const stats = summarizeDiff(text);
    sections.push({
      key: `${sections.length}:${path}`,
      path,
      text,
      added: stats.added,
      removed: stats.removed,
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]?.startsWith("diff --git ")) continue;
    if (start >= 0) pushSection(index);
    start = index;
  }
  if (start >= 0) pushSection(lines.length);

  return sections;
}

function inferDiffPath(lines: string[], fallbackIndex: number): string {
  const addedPath = lines.find((line) => line.startsWith("+++ "))?.slice(4).trim();
  if (addedPath && addedPath !== "/dev/null") return cleanDiffPath(addedPath);

  const renameTo = lines.find((line) => line.startsWith("rename to "))?.slice(10).trim();
  if (renameTo) return cleanDiffPath(renameTo);

  const removedPath = lines.find((line) => line.startsWith("--- "))?.slice(4).trim();
  if (removedPath && removedPath !== "/dev/null") return cleanDiffPath(removedPath);

  return `Changed file ${fallbackIndex + 1}`;
}

function cleanDiffPath(path: string): string {
  const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  return unquoted.replace(/^[ab]\//, "");
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
