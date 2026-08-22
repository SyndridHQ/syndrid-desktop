import { useEffect, useMemo, useState } from "react";
import {
  appServerClient,
  type RuntimeServerRequest,
} from "../runtime/appServerClient";
import "./approvalDock.css";

const COMMAND_APPROVAL = "item/commandExecution/requestApproval";
const FILE_APPROVAL = "item/fileChange/requestApproval";

type ApprovalDecision = "accept" | "acceptForSession" | "decline";

interface PendingApproval {
  request: RuntimeServerRequest;
  kind: "command" | "file";
  threadId: string;
  turnId: string;
  itemId: string;
  title: string;
  detail: string | null;
  reason: string | null;
  startedAtMs: number | null;
}

export function ApprovalDock() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return appServerClient.onServerRequest((request) => {
      const approval = normalizeApproval(request);
      if (!approval) return;

      setApprovals((current) => {
        if (current.some((entry) => entry.request.id === request.id)) return current;
        return [...current, approval];
      });
    });
  }, []);

  const current = approvals[0] ?? null;
  const queueLabel = useMemo(
    () => approvals.length > 1 ? `${approvals.length} pending` : "Approval required",
    [approvals.length],
  );

  const respond = async (decision: ApprovalDecision) => {
    if (!current || respondingId !== null) return;
    const responseKey = String(current.request.id);
    setRespondingId(responseKey);
    setError(null);

    try {
      await appServerClient.respondToServerRequest(current.request.id, { decision });
      setApprovals((entries) =>
        entries.filter((entry) => entry.request.id !== current.request.id),
      );
    } catch (responseError) {
      setError(
        responseError instanceof Error ? responseError.message : String(responseError),
      );
    } finally {
      setRespondingId(null);
    }
  };

  if (!current) return null;

  const busy = respondingId === String(current.request.id);

  return (
    <section className="approval-dock" role="alertdialog" aria-live="assertive">
      <header>
        <div>
          <span className="approval-eyebrow">{queueLabel}</span>
          <strong>{current.kind === "command" ? "Run command?" : "Allow file changes?"}</strong>
        </div>
        <span className="approval-kind">{current.kind}</span>
      </header>

      <div className="approval-body">
        <code title={current.title}>{current.title}</code>
        {current.detail && <small title={current.detail}>{current.detail}</small>}
        {current.reason && <p>{current.reason}</p>}
        <div className="approval-meta">
          <span>thread {current.threadId.slice(0, 8)}</span>
          <span>turn {current.turnId.slice(0, 8)}</span>
        </div>
        {error && <p className="approval-error">{error}</p>}
      </div>

      <footer>
        <button
          className="approval-decline"
          disabled={busy}
          onClick={() => void respond("decline")}
          type="button"
        >
          Deny
        </button>
        <span />
        <button
          disabled={busy}
          onClick={() => void respond("acceptForSession")}
          type="button"
        >
          Allow session
        </button>
        <button
          className="approval-accept"
          disabled={busy}
          onClick={() => void respond("accept")}
          type="button"
        >
          {busy ? "Responding…" : "Allow once"}
        </button>
      </footer>
    </section>
  );
}

function normalizeApproval(request: RuntimeServerRequest): PendingApproval | null {
  if (request.method !== COMMAND_APPROVAL && request.method !== FILE_APPROVAL) {
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
    };
  }

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
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
