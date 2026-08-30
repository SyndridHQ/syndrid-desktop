import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import {
  notifications,
  type GitDiffChange,
  type GitDiffChangeKind,
  type TurnDiffUpdatedNotification,
} from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import { GitStatusPanel } from "./GitStatusPanel";
import { GitWorktreeRuntimePanel } from "./GitWorktreeRuntimePanel";
import "./gitDock.css";

const MAX_DIFF_CHARS = 250_000;
const MAX_DIFF_FILES = 200;
const MAX_TYPED_DIFF_CHANGES = 2_500;
const MAX_RENDERED_DIFF_LINES = 2_000;

interface DiffSection {
  key: string;
  path: string;
  previousPath: string | null;
  kind: GitDiffChangeKind;
  text: string;
  added: number;
  removed: number;
}

interface RuntimeChangeSummary {
  files: number;
  added: number;
  removed: number;
  truncated: boolean;
}

type DiffLineKind = "metadata" | "hunk" | "added" | "removed" | "context";

interface RenderedDiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export function GitDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [diffStale, setDiffStale] = useState(false);
  const [baseSha, setBaseSha] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [runtimeChanges, setRuntimeChanges] = useState<GitDiffChange[]>([]);
  const [runtimeChangeSummary, setRuntimeChangeSummary] = useState<RuntimeChangeSummary | null>(null);
  const [diffTruncated, setDiffTruncated] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const gitInfo = workspace?.git ?? null;

  useEffect(() => {
    generation.current += 1;
    setLoadingDiff(false);
    setDiffLoaded(false);
    setDiffStale(false);
    setBaseSha(null);
    setDiff("");
    setRuntimeChanges([]);
    setRuntimeChangeSummary(null);
    setDiffTruncated(false);
    setFileFilter("");
    setSelectedSectionKey(null);
    setError(null);
  }, [open, workspace?.threadId, workspace?.cwd]);

  useEffect(() => {
    if (!open || !diffLoaded || !workspace?.threadId) return;
    return appServerClient.onNotification((notification) => {
      if (notification.method !== notifications.turnDiffUpdated) return;
      const event = notification.params as TurnDiffUpdatedNotification | undefined;
      if (event?.threadId === workspace.threadId) setDiffStale(true);
    });
  }, [diffLoaded, open, workspace?.threadId]);

  const loadDiff = useCallback(async () => {
    const cwd = workspace?.cwd;
    if (!open || !cwd || loadingDiff) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before loading repository changes.");
      return;
    }

    const requestGeneration = ++generation.current;
    setLoadingDiff(true);
    setError(null);
    try {
      const result = await appServerClient.gitDiffToRemote({ cwd });
      if (
        requestGeneration !== generation.current ||
        appServerClient.getWorkspaceSnapshot()?.cwd !== cwd
      ) {
        return;
      }
      if (!Array.isArray(result.changes)) {
        throw new Error("The connected Syndrid runtime does not expose typed Git change metadata. Update SyndridCLI before loading diffs.");
      }

      const isTruncated = result.diff.length > MAX_DIFF_CHARS;
      const retainedDiff = isTruncated ? result.diff.slice(0, MAX_DIFF_CHARS) : result.diff;
      const retainedTypedChanges = result.changes.slice(0, MAX_TYPED_DIFF_CHANGES);
      setBaseSha(result.sha);
      setDiff(retainedDiff);
      setRuntimeChanges(retainedTypedChanges);
      setRuntimeChangeSummary(summarizeRuntimeChanges(retainedTypedChanges, result.changes.length));
      setDiffTruncated(isTruncated);
      setDiffStale(false);
      setFileFilter("");
      setSelectedSectionKey(firstDiffSectionKey(retainedDiff, retainedTypedChanges));
      setDiffLoaded(true);
    } catch (cause) {
      if (
        requestGeneration === generation.current &&
        appServerClient.getWorkspaceSnapshot()?.cwd === cwd
      ) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (
        requestGeneration === generation.current &&
        appServerClient.getWorkspaceSnapshot()?.cwd === cwd
      ) {
        setLoadingDiff(false);
      }
    }
  }, [loadingDiff, open, workspace?.cwd]);

  const diffStats = runtimeChangeSummary ?? { added: 0, removed: 0 };
  const allDiffSections = useMemo(
    () => splitUnifiedDiff(diff, runtimeChanges),
    [diff, runtimeChanges],
  );
  const totalChangedFiles = runtimeChangeSummary?.files ?? 0;
  const normalizedFileFilter = fileFilter.trim().toLocaleLowerCase();
  const matchingDiffSections = useMemo(
    () =>
      normalizedFileFilter
        ? allDiffSections.filter((section) => {
            const searchText = `${section.path} ${section.previousPath ?? ""}`.toLocaleLowerCase();
            return searchText.includes(normalizedFileFilter);
          })
        : allDiffSections,
    [allDiffSections, normalizedFileFilter],
  );
  const diffSections = useMemo(
    () => matchingDiffSections.slice(0, MAX_DIFF_FILES),
    [matchingDiffSections],
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
                {loadingDiff
                  ? "Loading…"
                  : diffLoaded
                    ? diffStale
                      ? "Refresh diff · updated"
                      : "Refresh diff"
                    : "Load diff"}
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

              <GitStatusPanel />
              <GitWorktreeRuntimePanel cwd={workspace.cwd} threadId={workspace.threadId} />

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
                        {diffStale
                          ? "Runtime reports newer turn changes · refresh explicitly"
                          : `Merge base ${baseSha ? baseSha.slice(0, 12) : "unknown"}`}
                      </small>
                    </span>
                    {diff && (
                      <em>
                        {totalChangedFiles > 0 && `${totalChangedFiles} files · `}
                        +{diffStats.added} −{diffStats.removed}
                        {runtimeChangeSummary?.truncated && " · stats capped"}
                      </em>
                    )}
                  </div>
                  {diff ? (
                    <>
                      {allDiffSections.length > 0 && (
                        <div className="git-diff-filter">
                          <input
                            aria-label="Filter changed files"
                            onChange={(event) => setFileFilter(event.target.value)}
                            placeholder="Filter changed files…"
                            spellCheck={false}
                            value={fileFilter}
                          />
                          <small>
                            {normalizedFileFilter
                              ? `${matchingDiffSections.length} of ${allDiffSections.length} visible`
                              : `${allDiffSections.length} visible`}
                          </small>
                          {fileFilter && (
                            <button onClick={() => setFileFilter("")} type="button">
                              Clear
                            </button>
                          )}
                        </div>
                      )}
                      {diffSections.length > 0 ? (
                        <div className="git-diff-layout">
                          <nav className="git-diff-files" aria-label="Changed files">
                            {diffSections.map((section) => (
                              <button
                                className={section.key === selectedSection?.key ? "selected" : ""}
                                key={section.key}
                                onClick={() => setSelectedSectionKey(section.key)}
                                title={diffSectionTitle(section)}
                                type="button"
                              >
                                <span>
                                  <b aria-label={changeKindLabel(section.kind)}>
                                    {changeKindShortLabel(section.kind)}
                                  </b>
                                  {section.path}
                                </span>
                                <small>+{section.added} −{section.removed}</small>
                              </button>
                            ))}
                            {matchingDiffSections.length > MAX_DIFF_FILES && (
                              <div className="git-diff-file-limit">
                                Showing {MAX_DIFF_FILES} of {matchingDiffSections.length} matching files.
                              </div>
                            )}
                          </nav>
                          <div className="git-diff-file-view">
                            <div className="git-diff-file-title" title={selectedSection ? diffSectionTitle(selectedSection) : undefined}>
                              {selectedSection?.previousPath && selectedSection.kind === "renamed"
                                ? `${selectedSection.previousPath} → ${selectedSection.path}`
                                : selectedSection?.path ?? "Diff"}
                            </div>
                            <DiffText text={selectedSection?.text ?? diff} />
                          </div>
                        </div>
                      ) : normalizedFileFilter ? (
                        <div className="git-state compact">No changed files match this filter.</div>
                      ) : (
                        <DiffText text={diff} />
                      )}
                      {runtimeChangeSummary?.truncated && (
                        <div className="git-state compact">
                          Typed line statistics are capped at the first {MAX_TYPED_DIFF_CHANGES.toLocaleString()} files.
                        </div>
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
            Runtime-owned Git · typed file metadata · event-invalidated · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function DiffText({ text }: { text: string }) {
  const lines = useMemo(() => parseRenderedDiffLines(text), [text]);
  const visibleLines = lines.slice(0, MAX_RENDERED_DIFF_LINES);
  const hiddenLineCount = lines.length - visibleLines.length;

  return (
    <div className="git-diff-text" role="region" aria-label="Unified diff contents">
      {visibleLines.map((line, index) => (
        <div className={`git-diff-line ${line.kind}`} key={`${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}>
          <span className="git-diff-line-number" aria-hidden="true">{line.oldLine ?? ""}</span>
          <span className="git-diff-line-number" aria-hidden="true">{line.newLine ?? ""}</span>
          <code>{line.text || " "}</code>
        </div>
      ))}
      {hiddenLineCount > 0 && (
        <div className="git-diff-line-limit">
          Rendering capped at {MAX_RENDERED_DIFF_LINES.toLocaleString()} lines · {hiddenLineCount.toLocaleString()} additional lines retained but not mounted.
        </div>
      )}
    </div>
  );
}

function parseRenderedDiffLines(text: string): RenderedDiffLine[] {
  const lines = text.split("\n");
  const rendered: RenderedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const textLine of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(textLine);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rendered.push({ kind: "hunk", text: textLine, oldLine: null, newLine: null });
      continue;
    }

    if (!inHunk) {
      rendered.push({ kind: "metadata", text: textLine, oldLine: null, newLine: null });
      continue;
    }

    if (textLine.startsWith("+")) {
      rendered.push({ kind: "added", text: textLine, oldLine: null, newLine });
      newLine += 1;
      continue;
    }
    if (textLine.startsWith("-")) {
      rendered.push({ kind: "removed", text: textLine, oldLine, newLine: null });
      oldLine += 1;
      continue;
    }
    if (textLine.startsWith(" ")) {
      rendered.push({ kind: "context", text: textLine, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    rendered.push({ kind: "metadata", text: textLine, oldLine: null, newLine: null });
  }

  return rendered;
}

function firstDiffSectionKey(diff: string, runtimeChanges: GitDiffChange[]): string | null {
  return splitUnifiedDiff(diff, runtimeChanges)[0]?.key ?? null;
}

function splitUnifiedDiff(diff: string, runtimeChanges: GitDiffChange[]): DiffSection[] {
  if (!diff || runtimeChanges.length === 0) return [];

  const lines = diff.split("\n");
  const sections: DiffSection[] = [];
  let start = -1;

  const pushSection = (end: number) => {
    if (start < 0 || end <= start) return;
    const runtimeChange = runtimeChanges[sections.length];
    if (!runtimeChange) return;
    const text = lines.slice(start, end).join("\n");
    sections.push({
      key: `${sections.length}:${runtimeChange.path}`,
      path: runtimeChange.path,
      previousPath: runtimeChange.previousPath,
      kind: runtimeChange.kind,
      text,
      added: runtimeChange.addedLines,
      removed: runtimeChange.removedLines,
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

function summarizeRuntimeChanges(
  changes: GitDiffChange[],
  totalFiles: number,
): RuntimeChangeSummary {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    added += change.addedLines;
    removed += change.removedLines;
  }
  return {
    files: totalFiles,
    added,
    removed,
    truncated: totalFiles > changes.length,
  };
}

function changeKindShortLabel(kind: GitDiffChangeKind): string {
  switch (kind) {
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "modified": return "M";
  }
}

function changeKindLabel(kind: GitDiffChangeKind): string {
  switch (kind) {
    case "added": return "Added";
    case "deleted": return "Deleted";
    case "renamed": return "Renamed";
    case "modified": return "Modified";
  }
}

function diffSectionTitle(section: DiffSection): string {
  if (section.kind === "renamed" && section.previousPath) {
    return `${changeKindLabel(section.kind)} · ${section.previousPath} → ${section.path}`;
  }
  return `${changeKindLabel(section.kind)} · ${section.path}`;
}