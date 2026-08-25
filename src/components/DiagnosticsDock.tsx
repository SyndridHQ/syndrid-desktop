import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient, type RuntimeConnectionSnapshot } from "../runtime/appServerClient";
import { PROTOCOL_SOURCE_SHORT_SHA, type EnvironmentInfoResponse } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./diagnosticsDock.css";

type DiagnosticsSnapshot = {
  connection: RuntimeConnectionSnapshot;
  environment: EnvironmentInfoResponse | null;
  capturedAt: number;
};

export function DiagnosticsDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const diagnosticGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (loading) return;
    const requestGeneration = ++diagnosticGeneration.current;
    const connection = appServerClient.getSnapshot();
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const environment = connection.phase === "ready"
        ? await appServerClient.readEnvironmentInfo({ environmentId: "local" })
        : null;
      if (requestGeneration !== diagnosticGeneration.current) return;
      setSnapshot({
        connection: appServerClient.getSnapshot(),
        environment,
        capturedAt: Date.now(),
      });
    } catch (cause) {
      if (requestGeneration !== diagnosticGeneration.current) return;
      setSnapshot({
        connection: appServerClient.getSnapshot(),
        environment: null,
        capturedAt: Date.now(),
      });
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === diagnosticGeneration.current) setLoading(false);
    }
  }, [loading]);

  const copySnapshot = useCallback(async () => {
    if (!snapshot || loading) return;
    setError(null);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this environment.");
      await navigator.clipboard.writeText(formatSnapshotForClipboard(snapshot, workspace));
      setCopied(true);
    } catch (cause) {
      setCopied(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [loading, snapshot, workspace]);

  useEffect(() => {
    if (open) {
      void refresh();
      return;
    }
    diagnosticGeneration.current += 1;
    setLoading(false);
    setSnapshot(null);
    setError(null);
    setCopied(false);
    // Opening is the only automatic diagnostic read. Closing invalidates any
    // in-flight read and releases path-rich snapshot data retained by the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const connection = snapshot?.connection ?? appServerClient.getSnapshot();
  const native = connection.native;
  const server = connection.server;
  const environment = snapshot?.environment;
  const gitLabel = useMemo(() => {
    if (!workspace?.git) return "Unavailable";
    return workspace.git.branch || workspace.git.sha?.slice(0, 8) || "Repository detected";
  }, [workspace?.git]);

  return (
    <aside className="diagnostics-dock" aria-label="Runtime diagnostics">
      <button className="diagnostics-toggle" onClick={() => setOpen((current) => !current)} type="button">
        <span aria-hidden="true">◫</span>
        Diagnostics
        <span>{connection.phase}</span>
      </button>

      {open && (
        <section className="diagnostics-panel">
          <header>
            <span>
              <strong>Runtime diagnostics</strong>
              <small>On-demand snapshot · protocol {PROTOCOL_SOURCE_SHORT_SHA}</small>
            </span>
            <div>
              <button disabled={!snapshot || loading} onClick={() => void copySnapshot()} type="button">
                {copied ? "Copied" : "Copy snapshot"}
              </button>{" "}
              <button disabled={loading} onClick={() => void refresh()} type="button">
                {loading ? "Reading…" : "Refresh"}
              </button>
            </div>
          </header>

          {error && <div className="diagnostics-error">{error}</div>}

          <dl className="diagnostics-grid">
            <Diagnostic label="Connection" value={connection.phase} />
            <Diagnostic label="Platform" value={server ? `${server.platformFamily} · ${server.platformOs}` : "Unavailable"} />
            <Diagnostic label="Runtime" value={server?.userAgent || "Unavailable"} title={server?.userAgent} />
            <Diagnostic label="Codex home" value={server?.codexHome || "Unavailable"} title={server?.codexHome} />
            <Diagnostic label="Native process" value={formatNative(native)} title={native?.state === "running" ? native.binary : undefined} />
            <Diagnostic label="Native PID" value={native?.state === "running" ? String(native.pid) : "—"} />
            <Diagnostic label="Shell" value={environment ? `${environment.shell.name} · ${environment.shell.path}` : "Unavailable"} title={environment?.shell.path} />
            <Diagnostic label="Environment cwd" value={environment?.cwd || "Unavailable"} title={environment?.cwd ?? undefined} />
            <Diagnostic label="Selected thread" value={workspace?.threadId ? shortId(workspace.threadId) : "None"} title={workspace?.threadId} />
            <Diagnostic label="Workspace" value={workspace?.cwd || "None"} title={workspace?.cwd} />
            <Diagnostic label="Git" value={gitLabel} />
            <Diagnostic label="Captured" value={snapshot ? formatAge(snapshot.capturedAt) : "Not yet"} />
          </dl>

          <footer>
            Explicit environment read only · no CPU sampling · no process polling · copied snapshots omit Git remote URLs
          </footer>
        </section>
      )}
    </aside>
  );
}

function Diagnostic({ label, value, title }: { label: string; value: string; title?: string | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}

function formatNative(native: RuntimeConnectionSnapshot["native"]): string {
  if (!native) return "Unavailable";
  if (native.state === "running") return native.binary;
  if (native.state === "exited") return `Exited${native.code === null ? "" : ` · ${native.code}`}`;
  return "Stopped";
}

function formatSnapshotForClipboard(
  snapshot: DiagnosticsSnapshot,
  workspace: ReturnType<typeof useRuntimeWorkspace>,
): string {
  const { connection, environment, capturedAt } = snapshot;
  const native = connection.native;
  const server = connection.server;
  return JSON.stringify(
    {
      capturedAt: new Date(capturedAt).toISOString(),
      protocolSource: PROTOCOL_SOURCE_SHORT_SHA,
      connection: {
        phase: connection.phase,
        error: connection.error,
      },
      runtime: server
        ? {
            userAgent: server.userAgent,
            platformFamily: server.platformFamily,
            platformOs: server.platformOs,
            codexHome: server.codexHome,
          }
        : null,
      native: native?.state === "running"
        ? { state: native.state, binary: native.binary, pid: native.pid }
        : native,
      environment: environment
        ? {
            cwd: environment.cwd,
            shell: {
              name: environment.shell.name,
              path: environment.shell.path,
            },
          }
        : null,
      workspace: workspace
        ? {
            threadId: workspace.threadId,
            cwd: workspace.cwd,
            git: workspace.git
              ? {
                  branch: workspace.git.branch,
                  sha: workspace.git.sha,
                }
              : null,
          }
        : null,
    },
    null,
    2,
  );
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
