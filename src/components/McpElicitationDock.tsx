import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  appServerClient,
  type RuntimeServerRequest,
} from "../runtime/appServerClient";
import {
  getRuntimeMcpElicitationSnapshot,
  removeRuntimeMcpElicitation,
  subscribeRuntimeMcpElicitation,
  type McpFormField,
  type PrimitiveValue,
} from "../runtime/runtimeMcpElicitationStore";
import "./mcpElicitationDock.css";

interface RequestError {
  requestId: RuntimeServerRequest["id"];
  message: string;
}

export function McpElicitationDock() {
  const queue = useSyncExternalStore(
    subscribeRuntimeMcpElicitation,
    getRuntimeMcpElicitationSnapshot,
    getRuntimeMcpElicitationSnapshot,
  );
  const [values, setValues] = useState<Record<string, PrimitiveValue>>({});
  const [submittingRequestId, setSubmittingRequestId] = useState<
    RuntimeServerRequest["id"] | null
  >(null);
  const [error, setError] = useState<RequestError | null>(null);

  const current = queue[0] ?? null;
  const submitting = current !== null && submittingRequestId === current.request.id;
  const currentError =
    current !== null && error?.requestId === current.request.id ? error.message : null;

  useEffect(() => {
    if (!current) {
      setValues({});
      setError(null);
      return;
    }

    const defaults: Record<string, PrimitiveValue> = {};
    for (const field of current.fields) {
      if (field.defaultValue !== null) defaults[field.key] = field.defaultValue;
      else if (field.kind === "boolean" && field.required) defaults[field.key] = false;
    }
    setValues(defaults);
    setError(null);
  }, [current?.request.id]);

  const canSubmit = useMemo(() => {
    if (!current) return false;
    return current.fields.every((field) => fieldValueValid(field, values[field.key]));
  }, [current, values]);

  if (!current) return null;

  const respond = async (action: "accept" | "decline" | "cancel") => {
    const request = current;
    const requestId = request.request.id;
    if (submittingRequestId === requestId) return;
    setSubmittingRequestId(requestId);
    setError(null);

    const content: Record<string, PrimitiveValue> = {};
    if (action === "accept") {
      for (const field of request.fields) {
        const value = values[field.key];
        if (value === undefined || !fieldValueValid(field, value)) continue;
        if (typeof value === "string" && value.length === 0 && !field.required) continue;
        content[field.key] = value;
      }
    }

    try {
      await appServerClient.respondToServerRequest(requestId, {
        action,
        content: action === "accept" ? content : null,
        _meta: null,
      });
      removeRuntimeMcpElicitation(requestId);
    } catch (responseError) {
      setError({
        requestId,
        message: responseError instanceof Error ? responseError.message : String(responseError),
      });
    } finally {
      setSubmittingRequestId((activeRequestId) =>
        activeRequestId === requestId ? null : activeRequestId,
      );
    }
  };

  const updateField = (field: McpFormField, value: PrimitiveValue | undefined) => {
    setValues((currentValues) => {
      const next = { ...currentValues };
      if (value === undefined) delete next[field.key];
      else next[field.key] = value;
      return next;
    });
  };

  return (
    <section className="mcp-elicitation-dock" role="dialog" aria-live="polite">
      <header>
        <div>
          <span>MCP · {current.serverName}</span>
          <strong>Input requested</strong>
        </div>
        {queue.length > 1 && <em>{queue.length} pending</em>}
      </header>

      <div className="mcp-elicitation-body">
        <p>{current.message}</p>
        {current.fields.map((field) => (
          <label key={field.key}>
            <span>
              {field.title}
              {field.required && <b> required</b>}
            </span>
            {field.description && <small>{field.description}</small>}
            {renderField(field, values[field.key], (value) => updateField(field, value))}
          </label>
        ))}
        {currentError && <p className="mcp-elicitation-error">{currentError}</p>}
      </div>

      <footer>
        <button disabled={submitting} onClick={() => void respond("decline")} type="button">
          Decline
        </button>
        <span>
          {current.turnId ? `turn ${current.turnId.slice(0, 8)}` : "MCP request"}
        </span>
        <button
          className="mcp-accept"
          disabled={!canSubmit || submitting}
          onClick={() => void respond("accept")}
          type="button"
        >
          {submitting ? "Sending…" : "Submit"}
        </button>
      </footer>
    </section>
  );
}

function renderField(
  field: McpFormField,
  value: PrimitiveValue | undefined,
  onChange: (value: PrimitiveValue | undefined) => void,
) {
  if (field.kind === "boolean") {
    return (
      <input
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    );
  }

  if (field.kind === "enum") {
    return (
      <select
        onChange={(event) => onChange(event.target.value || undefined)}
        value={typeof value === "string" ? value : ""}
      >
        <option value="">Select…</option>
        {field.options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (field.kind === "number" || field.kind === "integer") {
    return (
      <input
        max={field.maximum ?? undefined}
        min={field.minimum ?? undefined}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(undefined);
            return;
          }
          const next = event.target.valueAsNumber;
          onChange(
            Number.isFinite(next)
              ? field.kind === "integer"
                ? Math.trunc(next)
                : next
              : undefined,
          );
        }}
        step={field.kind === "integer" ? 1 : "any"}
        type="number"
        value={typeof value === "number" ? value : ""}
      />
    );
  }

  return (
    <input
      maxLength={field.maxLength ?? undefined}
      minLength={field.minLength ?? undefined}
      onChange={(event) => onChange(event.target.value)}
      type="text"
      value={typeof value === "string" ? value : ""}
    />
  );
}

function fieldValueValid(field: McpFormField, value: PrimitiveValue | undefined): boolean {
  if (value === undefined) return !field.required;

  if (field.kind === "boolean") return typeof value === "boolean";

  if (field.kind === "enum") {
    return typeof value === "string" && field.options.includes(value);
  }

  if (field.kind === "number" || field.kind === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (field.kind === "integer" && !Number.isInteger(value)) return false;
    if (field.minimum !== null && value < field.minimum) return false;
    if (field.maximum !== null && value > field.maximum) return false;
    return true;
  }

  if (typeof value !== "string") return false;
  if (field.required && value.trim().length === 0) return false;
  if (field.minLength !== null && value.length < field.minLength) return false;
  if (field.maxLength !== null && value.length > field.maxLength) return false;
  return true;
}
