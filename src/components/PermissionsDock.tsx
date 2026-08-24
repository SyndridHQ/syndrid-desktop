import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { PermissionProfileSummary } from "../runtime/permissionProfileProtocol";
import type { ConfigReadResponse } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./permissionsDock.css";

const PROFILE_PAGE_SIZE = 40;
const MAX_RETAINED_PROFILES = 120;

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
  const [profileLoading, setProfileLoading] = useState(false);
  const [profiles, setProfiles] = useState<PermissionProfileSummary[]>([]);
  const [profileCursor, setProfileCursor] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const generation = useRef(0);
  const profileGeneration = useRef(0);

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
        (appServerClient.getWorkspaceSnapshot()?.cwd ?? null) !== cwd
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

  const loadProfiles = useCallback(
    async (append = false) => {
      if (appServerClient.getSnapshot().phase !== "ready") {
        setProfileError("Connect the Syndrid runtime before listing permission profiles.");
        return;
      }

      const requestGeneration = ++profileGeneration.current;
      const cwd = workspace?.cwd ?? null;
      setProfileLoading(true);
      setProfileError(null);
      try {
        const result = await appServerClient.listPermissionProfiles({
          cursor: append ? profileCursor : null,
          limit: PROFILE_PAGE_SIZE,
          cwd,
        });
        if (
          requestGeneration !== profileGeneration.current ||
          (appServerClient.getWorkspaceSnapshot()?.cwd ?? null) !== cwd
        ) {
          return;
        }
        setProfiles((current) =>
          dedupeProfiles(append ? [...current, ...result.data] : result.data).slice(
            0,
            MAX_RETAINED_PROFILES,
          ),
        );
        setProfileCursor(result.nextCursor);
      } catch (cause) {
        if (requestGeneration !== profileGeneration.current) return;
        setProfileError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (requestGeneration === profileGeneration.current) setProfileLoading(false);
      }
    },
    [profileCursor, workspace?.cwd],
  );

  useEffect(() => {
    generation.current += 1;
    profileGeneration.current += 1;
    setConfig(null);
    setSessionSettings(null);
    setError(null);
    setProfiles([]);
    setProfileCursor(null);
    setProfileError(null);
    setLoading(false);
    setProfileLoading(false);
    if (open) {
      void load();
      void loadProfiles(false);
    }
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
  const liveProfileId = extractPermissionProfileId(liveProfile);

  const writableRootCount = extractWritableRoots(liveSandbox).length;
  const writableRoots = useMemo(
    () => extractWritableRoots(liveSandbox).slice(0, 8),
    [liveSandbox],
  );
  const allowedProfileCount = useMemo(
    () => profiles.reduce((count, profile) => count + (profile.allowed ? 1 : 0), 0),
    [profiles],
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
                        {writableRootCount > writableRoots.length && (
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

              <section className="permissions-section">
                <header className="permissions-section-header-row">
                  <span>
                    <strong>Runtime permission profiles</strong>
                    <small>
                      {profiles.length > 0
                        ? `${allowedProfileCount} of ${profiles.length} retained profiles allowed by effective requirements`
                        : "Runtime-defined profiles for the selected workspace"}
                    </small>
                  </span>
                  <button
                    disabled={profileLoading}
                    onClick={() => void loadProfiles(false)}
                    type="button"
                  >
                    {profileLoading && profiles.length === 0 ? "Loading…" : "Refresh profiles"}
                  </button>
                </header>

                {profileError ? (
                  <div className="permissions-state compact error">{profileError}</div>
                ) : profileLoading && profiles.length === 0 ? (
                  <div className="permissions-state compact">Reading runtime permission profiles…</div>
                ) : profiles.length === 0 ? (
                  <div className="permissions-state compact">No runtime permission profiles were returned.</div>
                ) : (
                  <div className="permission-profile-list">
                    {profiles.map((profile) => (
                      <article
                        className={profile.id === liveProfileId ? "permission-profile-row current" : "permission-profile-row"}
                        key={profile.id}
                      >
                        <div>
                          <strong>{profile.id}</strong>
                          {profile.description && <small>{profile.description}</small>}
                        </div>
                        <span className={profile.allowed ? "allowed" : "blocked"}>
                          {profile.id === liveProfileId ? "active · " : ""}
                          {profile.allowed ? "allowed" : "blocked"}
                        </span>
                      </article>
                    ))}
                  </div>
                )}

                {profileCursor && profiles.length < MAX_RETAINED_PROFILES && (
                  <button
                    className="permission-profile-more"
                    disabled={profileLoading}
                    onClick={() => void loadProfiles(true)}
                    type="button"
                  >
                    {profileLoading ? "Loading…" : "Load more profiles"}
                  </button>
                )}
              </section>
            </>
          )}

          <footer>
            Runtime-owned · read-only · profiles paged {PROFILE_PAGE_SIZE} at a time · retains at most {MAX_RETAINED_PROFILES} · no polling
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

function dedupeProfiles(profiles: PermissionProfileSummary[]): PermissionProfileSummary[] {
  const byId = new Map<string, PermissionProfileSummary>();
  for (const profile of profiles) byId.set(profile.id, profile);
  return [...byId.values()];
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
  return extractPermissionProfileId(value) ?? "None reported";
}

function extractPermissionProfileId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  const record = toRecord(value);
  if (!record) return null;
  for (const key of ["name", "id", "profileName", "source"]) {
    if (typeof record[key] === "string" && record[key]) return String(record[key]);
  }
  return null;
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
