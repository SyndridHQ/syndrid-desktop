import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import {
  nativeAppServerStatus,
  stopNativeAppServer,
  type NativeAppServerStatus,
} from "../runtime/native";
import {
  getRuntimeBinaryOverride,
  setRuntimeBinaryOverride,
} from "../runtime/runtimeBinaryPreference";
import "./settingsDock.css";

export function SettingsDock() {
  const [open, setOpen] = useState(false);
  const [binary, setBinary] = useState(() => getRuntimeBinaryOverride() ?? "");
  const [savedBinary, setSavedBinary] = useState(() => getRuntimeBinaryOverride() ?? "");
  const [status, setStatus] = useState<NativeAppServerStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isTauri() || loadingStatus) return;
    setLoadingStatus(true);
    setError(null);
    try {
      setStatus(await nativeAppServerStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingStatus(false);
    }
  }, [loadingStatus]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void refreshStatus();
  };

  const save = () => {
    const normalized = binary.trim();
    setRuntimeBinaryOverride(normalized || null);
    setSavedBinary(normalized);
    setBinary(normalized);
    setError(null);
  };

  const reset = () => {
    setRuntimeBinaryOverride(null);
    setBinary("");
    setSavedBinary("");
    setError(null);
  };

  const saveAndRestart = async () => {
    if (!isTauri() || restarting) return;
    save();
    setRestarting(true);
    setError(null);
    try {
      await stopNativeAppServer();
      window.location.reload();
    } catch (cause) {
      setRestarting(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const normalized = binary.trim();
  const dirty = normalized !== savedBinary;
  const runningBinary = status?.state === "running" ? status.binary : null;

  return (
    <aside className="settings-dock" aria-label="Desktop settings">
      <button className="settings-toggle" onClick={toggle} type="button">
        <span aria-hidden="true">⚙</span>
        Settings
      </button>
      {open && (
        <section className="settings-panel">
          <header>
            <span>
              <strong>Desktop settings</strong>
              <small>Native supervision · local-only preferences</small>
            </span>
            <button disabled={loadingStatus} onClick={() => void refreshStatus()} type="button">
              {loadingStatus ? "Checking…" : "Refresh"}
            </button>
          </header>

          <div className="settings-section">
            <label htmlFor="runtime-binary">Syndrid CLI executable</label>
            <input
              autoComplete="off"
              id="runtime-binary"
              onChange={(event) => setBinary(event.target.value)}
              placeholder="syndrid (use PATH / environment default)"
              spellCheck={false}
              value={binary}
            />
            <p>
              Optional explicit executable or absolute path. Desktop still launches only the
              configured Syndrid CLI with the <code>app-server --listen stdio://</code> contract;
              provider credentials and agent configuration remain runtime-owned.
            </p>
          </div>

          <dl className="settings-runtime-state">
            <div>
              <dt>Running binary</dt>
              <dd title={runningBinary ?? undefined}>{runningBinary ?? statusLabel(status)}</dd>
            </div>
            <div>
              <dt>Saved override</dt>
              <dd title={savedBinary || undefined}>{savedBinary || "PATH / SYNDRID_APP_SERVER_BINARY"}</dd>
            </div>
          </dl>

          {error && <div className="settings-error">{error}</div>}

          <div className="settings-actions">
            <button disabled={!dirty} onClick={save} type="button">
              Save
            </button>
            <button disabled={!savedBinary && !normalized} onClick={reset} type="button">
              Reset default
            </button>
            <button
              className="primary"
              disabled={!isTauri() || restarting}
              onClick={() => void saveAndRestart()}
              type="button"
            >
              {restarting ? "Restarting…" : "Save & restart runtime"}
            </button>
          </div>

          <footer>
            No polling · no credentials stored · changes apply to the next supervised runtime start
          </footer>
        </section>
      )}
    </aside>
  );
}

function statusLabel(status: NativeAppServerStatus | null): string {
  if (!status) return isTauri() ? "Not checked" : "Browser preview";
  if (status.state === "running") return status.binary;
  if (status.state === "exited") return `Exited${status.code === null ? "" : ` (${status.code})`}`;
  return "Stopped";
}
