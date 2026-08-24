import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ConfigReadResponse } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./permissionsDock.css";

type RuntimeThreadSettings = {
  approvalPolicy: unknown;
  approvalsReviewer: unknown;
  sandboxPolicy: unknown;
  activePermissionProfile: unknown | null;
};

export function PermissionsDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ConfigReadResponse | null>(null);
  const [sessionSettings, setSessionSettings] = useState<RuntimeThreadSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before inspecting permissions.");
      return;
    }

    const requestGeneration = ++generation.current;
    const cwd = workspace?.cwd ?? null;
    setLoading(true);
    setError(null);
    try {
      const result = await appServerClient.readConfig(
        cwd ? { cwd, includeLayers: false } : { includeLayers: false },
      );
      if (
        requestGeneration !== generation.current ||
        appServerClient.getWorkspaceSnapshot()?.cwd !== cwd
      ) {
        return;
      }
      setConfig(result);
    } catch (cause) {
      if (requestGeneration !== generation.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [workspace?.cwd]);

  useEffect(() => {
    generation.current += 1;
    setConfig(null);
    setSessionSettings(null);
    setError(null);
    if (open) void load();
    // Workspace selection is the authoritative invalidation trigger. No polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.threadId, workspace?.cwd]);

  useEffect(() => {
    const threadId = workspace?.threadId;
    if (!open || !threadId) return;

    return appServerClient.onNotification((notification) => {
      if (notification.method !== "thread/settings/updated") return;
      const parsed = parseThreadSettingsUpdated(notification.params);
      if (!parsed || parsed.threadId !== threadId) return;
      setSessionSettings(parsed.settings);
    });
  }, [open, workspace?.threadId]);

  const workspaceApproval = config?.config.approval_policy;
  const workspaceSandbox = config?.config.sandbox_mode;
  const liveApproval = sessionSettings?.approvalPolicy;
  const liveSandbox = sessionSettings?.sandboxPolicy;
  const liveProfile = sessionSettings?.activePermissionProfile;

  const writableRoots = useMemo(
    () => extractWritableRoots(liveSandbox).slice(0, 8),
    [liveSandbox],
  );

  return (
    <aside className="permissions-dock" aria-label="Permissions and sandbox">
      <button
        className="permissions-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">◇</span>
        Permissions
        {sessionSettings && <span>live</span>}
      </button>

      {open && (
        <section className="permissions-panel">
          <header>
            <span>
              <strong>Permissions & sandbox</strong>
              <small title={workspace?.cwd}>
                {workspace?.cwd || "Runtime defaults"}
              </small>
            </span>
            <button disabled={loading} onClick={() => void load()} type="button">
              {loading ? "Loading…" : "Refresh defaults"}
            </button>
          </header>

          {error ? (
            <div className="permissions-state error">{error}</div>
          ) : loading && !config ? (
            <div className="permissions-state">Reading effective runtime configuration…</div>
          ) : (
            <>
              <section className="permissions-section">
                <header>
                  <strong>Workspace defaults</strong>
                  <small>Effective `config/read` values for this workspace</small>
                </header>
                <dl className="permissions-grid">
                  <PermissionValue label="Approval policy" value={formatPolicy(workspaceApproval)} />
                  <PermissionValue label="Sandbox mode" value={formatPolicy(workspaceSandbox)} />
                </dl>
              </section>

              <section className="permissions-section">
                <header>
                  <strong>Selected session</strong>
                  <small>
                    {sessionSettings
                      ? "Live settings observed from Syndrid runtime events"
                      : "Waiting for a runtime settings event; defaults are not assumed to be overrides"}
                  </small>
                </header>
                {sessionSettings ? (
                  <>
                    <dl className="permissions-grid">
                      <PermissionValue label="Approval policy" value={formatPolicy(liveApproval)} />
                      <PermissionValue label="Approvals reviewer" value={formatPolicy(sessionSettings.approvalsReviewer)} />
                      <PermissionValue label="Sandbox" value={formatSandbox(liveSandbox)} />
                      <PermissionValue label="Permission profile" value={formatPermissionProfile(liveProfile)} />
                    </dl>
                    {writableRoots.length > 0 && (
                      <div className="permissions-roots">
                        <strong>Writable roots</strong>
                        {writableRoots.map((root) => (
                          <code key={root} title={root}>{root}</code>
                        ))}
                        {extractWritableRoots(liveSandbox).length > writableRoots.length && (
                          <small>Additional roots omitted from this bounded view.</small>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="permissions-state compact">
                    Syndrid has not emitted `thread/settings/updated` for this selected session while the panel is open.
                  </div>
                )}
              </section>
            </>
          )}

          <footer>
            Runtime-owned · read-only · event-aware · no permission inference or polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function PermissionValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function parseThreadSettingsUpdated(value: unknown): {
  threadId: string;
  settings: RuntimeThreadSettings;
} | null {
  const record = toRecord(value);
  const threadSettings = toRecord(record?.threadSettings);
  if (!record || typeof record.threadId !== "string" || !threadSettings) return null;
  return {
    threadId: record.threadId,
    settings: {
      approvalPolicy: threadSettings.approvalPolicy,
      approvalsReviewer: threadSettings.approvalsReviewer,
      sandboxPolicy: threadSettings.sandboxPolicy,
      activePermissionProfile: threadSettings.activePermissionProfile ?? null,
    },
  };
}

function formatPolicy(value: unknown): string {
  if (value === null || value === undefined) return "Runtime default";
  if (typeof value === "string") return humanize(value);
  const record = toRecord(value);
  if (!record) return "Runtime-defined";
  if (typeof record.type === "string") return humanize(record.type);
  if ("granular" in record) {
    const granular = toRecord(record.granular);
    if (!granular) return "Granular";
    const enabled = Object.entries(granular)
      .filter(([, flag]) => flag === true)
      .map(([key]) => humanize(key));
    return enabled.length > 0 ? `Granular · ${enabled.join(", ")}` : "Granular · no approval gates";
  }
  return summarizeObject(record);
}

function formatSandbox(value: unknown): string {
  const record = toRecord(value);
  if (!record) return formatPolicy(value);
  const type = typeof record.type === "string" ? humanize(record.type) : "Runtime-defined";
  const network = formatNetworkAccess(record.networkAccess);
  return network ? `${type} · network ${network}` : type;
}

function formatPermissionProfile(value: unknown): string {
  if (value === null || value === undefined) return "None reported";
  if (typeof value === "string") return value;
  const record = toRecord(value);
  if (!record) return "Runtime-defined";
  for (const key of ["name", "id", "profileName", "source"]) {
    if (typeof record[key] === "string" && record[key]) return String(record[key]);
  }
  return summarizeObject(record);
}

function extractWritableRoots(value: unknown): string[] {
  const record = toRecord(value);
  if (!record || !Array.isArray(record.writableRoots)) return [];
  return record.writableRoots.filter((root): root is string => typeof root === "string");
}

function formatNetworkAccess(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "enabled" : "disabled";
  if (typeof value === "string") return humanize(value);
  const record = toRecord(value);
  if (!record) return null;
  if (typeof record.type === "string") return humanize(record.type);
  return summarizeObject(record);
}

function summarizeObject(record: Record<string, unknown>): string {
  const keys = Object.keys(record).slice(0, 4).map(humanize);
  return keys.length > 0 ? keys.join(" · ") : "Runtime-defined";
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
