import { useCallback, useEffect, useMemo, useState } from "react";
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

  const refresh = useCallback(async () => {
    if (loading) return;
    const connection = appServerClient.getSnapshot();
    setLoading(true);
    setError(null);
    try {
      const environment = connection.phase === "ready"
        ? await appServerClient.readEnvironmentInfo({ environmentId: "local" })
        : null;
      setSnapshot({
        connection: appServerClient.getSnapshot(),
        environment,
        capturedAt: Date.now(),
      });
    } catch (cause) {
      setSnapshot({
        connection: appServerClient.getSnapshot(),
        environment: null,
        capturedAt: Date.now(),
      });
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    if (open) void refresh();
    // Opening is the only automatic diagnostic read. No interval sampling.
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
            <button disabled={loading} onClick={() => void refresh()} type="button">
              {loading ? "Reading…" : "Refresh"}
            </button>
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
            Explicit environment read only · no CPU sampling · no process polling · SyndridCLI remains authoritative
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

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
