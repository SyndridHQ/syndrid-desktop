import { useEffect, useMemo, useState } from "react";
import {
  appServerClient,
  type RuntimeServerRequest,
} from "../runtime/appServerClient";
import "./mcpElicitationDock.css";

const MCP_ELICITATION = "mcpServer/elicitation/request";
const SERVER_REQUEST_RESOLVED = "serverRequest/resolved";

type PrimitiveValue = string | number | boolean;
type FieldKind = "string" | "number" | "integer" | "boolean" | "enum";

interface McpFormField {
  key: string;
  kind: FieldKind;
  title: string;
  description: string | null;
  required: boolean;
  options: string[];
  minimum: number | null;
  maximum: number | null;
  minLength: number | null;
  maxLength: number | null;
  defaultValue: PrimitiveValue | null;
}

interface McpFormRequest {
  request: RuntimeServerRequest;
  threadId: string;
  turnId: string | null;
  serverName: string;
  message: string;
  fields: McpFormField[];
}

export function McpElicitationDock() {
  const [queue, setQueue] = useState<McpFormRequest[]>([]);
  const [values, setValues] = useState<Record<string, PrimitiveValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offRequest = appServerClient.onServerRequest((request) => {
      if (request.method !== MCP_ELICITATION) return false;

      const form = normalizeMcpForm(request);
      if (!form) {
        void appServerClient
          .respondToServerRequest(request.id, {
            action: "decline",
            content: null,
            _meta: null,
          })
          .catch(() => undefined);
        return true;
      }

      setQueue((current) => {
        if (current.some((entry) => entry.request.id === request.id)) return current;
        return [...current, form];
      });
      return true;
    });

    const offNotification = appServerClient.onNotification((notification) => {
      if (notification.method !== SERVER_REQUEST_RESOLVED || !isRecord(notification.params)) {
        return;
      }
      const requestId = notification.params.requestId;
      if (!isRequestId(requestId)) return;
      setQueue((current) =>
        current.filter((entry) => entry.request.id !== requestId),
      );
    });

    return () => {
      offRequest();
      offNotification();
    };
  }, []);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (!current) {
      setValues({});
      setError(null);
      return;
    }

    const defaults: Record<string, PrimitiveValue> = {};
    for (const field of current.fields) {
      if (field.defaultValue !== null) defaults[field.key] = field.defaultValue;
      else if (field.kind === "boolean") defaults[field.key] = false;
    }
    setValues(defaults);
    setError(null);
  }, [current?.request.id]);

  const canSubmit = useMemo(() => {
    if (!current) return false;
    return current.fields.every((field) => {
      if (!field.required) return true;
      const value = values[field.key];
      if (field.kind === "boolean") return typeof value === "boolean";
      if (field.kind === "number" || field.kind === "integer") return typeof value === "number";
      return typeof value === "string" && value.trim().length > 0;
    });
  }, [current, values]);

  if (!current) return null;

  const respond = async (action: "accept" | "decline" | "cancel") => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const content: Record<string, PrimitiveValue> = {};
    if (action === "accept") {
      for (const field of current.fields) {
        const value = values[field.key];
        if (value === undefined) continue;
        if (typeof value === "string" && value.length === 0 && !field.required) continue;
        content[field.key] = value;
      }
    }

    try {
      await appServerClient.respondToServerRequest(current.request.id, {
        action,
        content: action === "accept" ? content : null,
        _meta: null,
      });
      setQueue((entries) =>
        entries.filter((entry) => entry.request.id !== current.request.id),
      );
    } catch (responseError) {
      setError(responseError instanceof Error ? responseError.message : String(responseError));
    } finally {
      setSubmitting(false);
    }
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
            {renderField(field, values[field.key], (value) =>
              setValues((currentValues) => ({
                ...currentValues,
                [field.key]: value,
              })),
            )}
          </label>
        ))}
        {error && <p className="mcp-elicitation-error">{error}</p>}
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
  onChange: (value: PrimitiveValue) => void,
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
        onChange={(event) => onChange(event.target.value)}
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
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) onChange(field.kind === "integer" ? Math.trunc(next) : next);
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

function normalizeMcpForm(request: RuntimeServerRequest): McpFormRequest | null {
  if (!isRecord(request.params)) return null;
  if (request.params.mode !== "form") return null;

  const threadId = stringValue(request.params.threadId);
  const turnId = nullableString(request.params.turnId);
  const serverName = stringValue(request.params.serverName);
  const message = stringValue(request.params.message);
  const schema = request.params.requestedSchema;
  if (!threadId || !serverName || !message || !isRecord(schema)) return null;
  if (schema.type !== "object" || !isRecord(schema.properties)) return null;

  const required = new Set(stringArray(schema.required));
  const fields: McpFormField[] = [];
  for (const [key, rawField] of Object.entries(schema.properties)) {
    const field = normalizeField(key, rawField, required.has(key));
    if (!field) return null;
    fields.push(field);
  }

  return {
    request,
    threadId,
    turnId,
    serverName,
    message,
    fields,
  };
}

function normalizeField(
  key: string,
  rawField: unknown,
  required: boolean,
): McpFormField | null {
  if (!isRecord(rawField)) return null;
  const title = stringValue(rawField.title) ?? key;
  const description = stringValue(rawField.description);
  const type = rawField.type;

  if (type === "string" && Array.isArray(rawField.enum)) {
    const options = stringArray(rawField.enum);
    if (options.length === 0) return null;
    const defaultValue = typeof rawField.default === "string" ? rawField.default : null;
    return baseField(key, "enum", title, description, required, {
      options,
      defaultValue,
    });
  }

  if (type === "string") {
    return baseField(key, "string", title, description, required, {
      minLength: numberValue(rawField.minLength),
      maxLength: numberValue(rawField.maxLength),
      defaultValue: typeof rawField.default === "string" ? rawField.default : null,
    });
  }

  if (type === "number" || type === "integer") {
    return baseField(key, type, title, description, required, {
      minimum: numberValue(rawField.minimum),
      maximum: numberValue(rawField.maximum),
      defaultValue: typeof rawField.default === "number" ? rawField.default : null,
    });
  }

  if (type === "boolean") {
    return baseField(key, "boolean", title, description, required, {
      defaultValue: typeof rawField.default === "boolean" ? rawField.default : null,
    });
  }

  return null;
}

function baseField(
  key: string,
  kind: FieldKind,
  title: string,
  description: string | null,
  required: boolean,
  overrides: Partial<McpFormField>,
): McpFormField {
  return {
    key,
    kind,
    title,
    description,
    required,
    options: [],
    minimum: null,
    maximum: null,
    minLength: null,
    maxLength: null,
    defaultValue: null,
    ...overrides,
  };
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

function nullableString(value: unknown): string | null {
  return value === null ? null : stringValue(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
