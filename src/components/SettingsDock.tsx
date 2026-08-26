import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import {
  nativeAppServerStatus,
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
  const statusGeneration = useRef(0);

  const refreshStatus = useCallback(async () => {
    if (!isTauri() || loadingStatus) return;
    const requestGeneration = ++statusGeneration.current;
    setLoadingStatus(true);
    setError(null);
    try {
      const nextStatus = await nativeAppServerStatus();
      if (requestGeneration !== statusGeneration.current) return;
      setStatus(nextStatus);
    } catch (cause) {
      if (requestGeneration !== statusGeneration.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestGeneration === statusGeneration.current) setLoadingStatus(false);
    }
  }, [loadingStatus]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      void refreshStatus();
      return;
    }

    // Settings is an on-demand supervisor surface. Closing it invalidates any
    // in-flight native status read and releases process/path details while idle.
    statusGeneration.current += 1;
    setStatus(null);
    setLoadingStatus(false);
    setError(null);
  };

  const save = (): boolean => {
    const normalized = binary.trim();
    if (!setRuntimeBinaryOverride(normalized || null)) {
      setError("Desktop could not persist the runtime executable preference in local storage.");
      return false;
    }
    setSavedBinary(normalized);
    setBinary(normalized);
    setError(null);
    return true;
  };

  const reset = () => {
    if (!setRuntimeBinaryOverride(null)) {
      setError("Desktop could not clear the runtime executable preference from local storage.");
      return;
    }
    setBinary("");
    setSavedBinary("");
    setError(null);
  };

  const saveAndRestart = async () => {
    if (!isTauri() || restarting) return;
    if (!save()) return;
    setRestarting(true);
    try {
      // Restart through the app-server client rather than stopping the native
      // child directly. This rejects pending RPCs and clears the selected
      // workspace projection before the new runtime process is started.
      await appServerClient.disconnect();
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
