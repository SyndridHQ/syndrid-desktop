import { useEffect, useMemo, useState } from "react";
import {
  appServerClient,
  type RuntimeServerRequest,
} from "../runtime/appServerClient";
import "./approvalDock.css";

const COMMAND_APPROVAL = "item/commandExecution/requestApproval";
const FILE_APPROVAL = "item/fileChange/requestApproval";
const PERMISSIONS_APPROVAL = "item/permissions/requestApproval";
const SERVER_REQUEST_RESOLVED = "serverRequest/resolved";

type ApprovalDecision = "accept" | "acceptForSession" | "decline";
type PermissionScope = "turn" | "session";
type ApprovalKind = "command" | "file" | "permissions";

interface PendingApproval {
  request: RuntimeServerRequest;
  kind: ApprovalKind;
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  detail: string | null;
  reason: string | null;
  startedAtMs: number | null;
  requestedPermissions: Record<string, unknown> | null;
  permissionSummary: string[];
}

export function ApprovalDock() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offRequest = appServerClient.onServerRequest((request) => {
      const approval = normalizeApproval(request);
      if (!approval) return false;

      setApprovals((current) => {
        if (current.some((entry) => entry.request.id === request.id)) return current;
        return [...current, approval];
      });
      return true;
    });
    const offNotification = appServerClient.onNotification((notification) => {
      if (notification.method !== SERVER_REQUEST_RESOLVED || !isRecord(notification.params)) {
        return;
      }
      const requestId = notification.params.requestId;
      if (!isRequestId(requestId)) return;
      setApprovals((current) =>
        current.filter((entry) => entry.request.id !== requestId),
      );
    });

    return () => {
      offRequest();
      offNotification();
    };
  }, []);

  const current = approvals[0] ?? null;
  const queueLabel = useMemo(
    () => approvals.length > 1 ? `${approvals.length} pending` : "Approval required",
    [approvals.length],
  );

  const finishCurrent = (requestId: RuntimeServerRequest["id"]) => {
    setApprovals((entries) =>
      entries.filter((entry) => entry.request.id !== requestId),
    );
  };

  const respondDecision = async (decision: ApprovalDecision) => {
    if (!current || current.kind === "permissions" || respondingId !== null) return;
    const responseKey = String(current.request.id);
    setRespondingId(responseKey);
    setError(null);

    try {
      await appServerClient.respondToServerRequest(current.request.id, { decision });
      finishCurrent(current.request.id);
    } catch (responseError) {
      setError(errorMessage(responseError));
    } finally {
      setRespondingId(null);
    }
  };

  const respondPermissions = async (
    scope: PermissionScope,
    grantRequested: boolean,
  ) => {
    if (!current || current.kind !== "permissions" || respondingId !== null) return;
    const responseKey = String(current.request.id);
    setRespondingId(responseKey);
    setError(null);

    try {
      await appServerClient.respondToServerRequest(current.request.id, {
        permissions: grantRequested ? current.requestedPermissions ?? {} : {},
        scope,
      });
      finishCurrent(current.request.id);
    } catch (responseError) {
      setError(errorMessage(responseError));
    } finally {
      setRespondingId(null);
    }
  };

  if (!current) return null;

  const busy = respondingId === String(current.request.id);
  const heading = approvalHeading(current.kind);

  return (
    <section className="approval-dock" role="alertdialog" aria-live="assertive">
      <header>
        <div>
          <span className="approval-eyebrow">{queueLabel}</span>
          <strong>{heading}</strong>
        </div>
        <span className="approval-kind">{current.kind}</span>
      </header>

      <div className="approval-body">
        <code title={current.title}>{current.title}</code>
        {current.detail && <small title={current.detail}>{current.detail}</small>}
        {current.reason && <p>{current.reason}</p>}
        {current.permissionSummary.length > 0 && (
          <ul className="permission-summary" aria-label="Requested permissions">
            {current.permissionSummary.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        )}
        <div className="approval-meta">
          <span>thread {current.threadId.slice(0, 8)}</span>
          <span>turn {current.turnId.slice(0, 8)}</span>
        </div>
        {error && <p className="approval-error">{error}</p>}
      </div>

      {current.kind === "permissions" ? (
        <footer>
          <button
            className="approval-decline"
            disabled={busy}
            onClick={() => void respondPermissions("turn", false)}
            type="button"
          >
            Deny
          </button>
          <span />
          <button
            disabled={busy}
            onClick={() => void respondPermissions("session", true)}
            type="button"
          >
            Allow session
          </button>
          <button
            className="approval-accept"
            disabled={busy}
            onClick={() => void respondPermissions("turn", true)}
            type="button"
          >
            {busy ? "Responding…" : "Allow turn"}
          </button>
        </footer>
      ) : (
        <footer>
          <button
            className="approval-decline"
            disabled={busy}
            onClick={() => void respondDecision("decline")}
            type="button"
          >
            Deny
          </button>
          <span />
          <button
            disabled={busy}
            onClick={() => void respondDecision("acceptForSession")}
            type="button"
          >
            Allow session
          </button>
          <button
            className="approval-accept"
            disabled={busy}
            onClick={() => void respondDecision("accept")}
            type="button"
          >
            {busy ? "Responding…" : "Allow once"}
          </button>
        </footer>
      )}
    </section>
  );
}

function normalizeApproval(request: RuntimeServerRequest): PendingApproval | null {
  if (
    request.method !== COMMAND_APPROVAL &&
    request.method !== FILE_APPROVAL &&
    request.method !== PERMISSIONS_APPROVAL
  ) {
    return null;
  }
  if (!isRecord(request.params)) return null;

  const threadId = stringValue(request.params.threadId);
  const turnId = stringValue(request.params.turnId);
  const itemId = stringValue(request.params.itemId);
  if (!threadId || !turnId || !itemId) return null;

  if (request.method === COMMAND_APPROVAL) {
    const command = stringValue(request.params.command) ?? "Command requested by Syndrid";
    return {
      request,
      kind: "command",
      threadId,
      turnId,
      itemId,
      title: command,
      detail: stringValue(request.params.cwd),
      reason: stringValue(request.params.reason),
      startedAtMs: numberValue(request.params.startedAtMs),
      requestedPermissions: null,
      permissionSummary: [],
    };
  }

  if (request.method === FILE_APPROVAL) {
    const grantRoot = stringValue(request.params.grantRoot);
    return {
      request,
      kind: "file",
      threadId,
      turnId,
      itemId,
      title: grantRoot ? `Write under ${grantRoot}` : "Workspace file changes",
      detail: grantRoot,
      reason: stringValue(request.params.reason),
      startedAtMs: numberValue(request.params.startedAtMs),
      requestedPermissions: null,
      permissionSummary: [],
    };
  }

  const requestedPermissions = isRecord(request.params.permissions)
    ? request.params.permissions
    : {};
  const cwd = stringValue(request.params.cwd);
  return {
    request,
    kind: "permissions",
    threadId,
    turnId,
    itemId,
    title: "Additional sandbox permissions",
    detail: cwd,
    reason: stringValue(request.params.reason),
    startedAtMs: numberValue(request.params.startedAtMs),
    requestedPermissions,
    permissionSummary: summarizePermissions(requestedPermissions),
  };
}

function approvalHeading(kind: ApprovalKind): string {
  if (kind === "command") return "Run command?";
  if (kind === "file") return "Allow file changes?";
  return "Grant additional access?";
}

function summarizePermissions(permissions: Record<string, unknown>): string[] {
  const summary: string[] = [];
  const network = permissions.network;
  if (isRecord(network) && network.enabled === true) {
    summary.push("Network access");
  }

  const fileSystem = permissions.fileSystem;
  if (isRecord(fileSystem)) {
    const reads = stringArray(fileSystem.read);
    const writes = stringArray(fileSystem.write);
    for (const path of reads) summary.push(`Read: ${path}`);
    for (const path of writes) summary.push(`Write: ${path}`);

    if (Array.isArray(fileSystem.entries) && fileSystem.entries.length > 0) {
      summary.push(`${fileSystem.entries.length} filesystem rule${fileSystem.entries.length === 1 ? "" : "s"}`);
    }
  }

  return summary.length > 0 ? summary : ["Runtime-requested sandbox access"];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is RuntimeServerRequest["id"] {
  return typeof value === "string" || typeof value === "number";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
