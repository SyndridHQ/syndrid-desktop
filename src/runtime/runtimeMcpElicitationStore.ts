import { appServerClient, type RuntimeServerRequest } from "./appServerClient";

const MCP_ELICITATION = "mcpServer/elicitation/request";
const SERVER_REQUEST_RESOLVED = "serverRequest/resolved";
const MAX_MCP_FORM_FIELDS = 64;
const MAX_MCP_ENUM_OPTIONS = 256;

export type PrimitiveValue = string | number | boolean;
export type FieldKind = "string" | "number" | "integer" | "boolean" | "enum";

export interface McpFormField {
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

export interface McpFormRequest {
  request: RuntimeServerRequest;
  threadId: string;
  turnId: string | null;
  serverName: string;
  message: string;
  fields: McpFormField[];
}

type Listener = () => void;

let entries: McpFormRequest[] = [];
const listeners = new Set<Listener>();

export function getRuntimeMcpElicitationSnapshot(): McpFormRequest[] {
  return entries;
}

export function subscribeRuntimeMcpElicitation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function removeRuntimeMcpElicitation(requestId: RuntimeServerRequest["id"]): void {
  const next = entries.filter((entry) => entry.request.id !== requestId);
  if (next.length === entries.length) return;
  entries = next;
  emitChange();
}

appServerClient.onServerRequest((request) => {
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

  if (!entries.some((entry) => entry.request.id === request.id)) {
    entries = [...entries, form];
    emitChange();
  }
  return true;
});

appServerClient.onNotification((notification) => {
  if (notification.method !== SERVER_REQUEST_RESOLVED || !isRecord(notification.params)) {
    return;
  }
  const requestId = notification.params.requestId;
  if (!isRequestId(requestId)) return;
  removeRuntimeMcpElicitation(requestId);
});

function emitChange(): void {
  for (const listener of listeners) listener();
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

  const required = requiredFieldSet(schema.required);
  if (!required) return null;

  const fields: McpFormField[] = [];
  for (const key in schema.properties) {
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) continue;
    if (fields.length >= MAX_MCP_FORM_FIELDS) return null;
    const field = normalizeField(key, schema.properties[key], required.has(key));
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
    const options = boundedStringArray(rawField.enum, MAX_MCP_ENUM_OPTIONS);
    if (!options || options.length === 0) return null;
    const defaultValue = typeof rawField.default === "string" ? rawField.default : null;
    if (defaultValue !== null && !options.includes(defaultValue)) return null;
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

function requiredFieldSet(value: unknown): Set<string> | null {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > MAX_MCP_FORM_FIELDS) return null;
  const required = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    required.add(entry);
  }
  return required;
}

function boundedStringArray(value: unknown[], limit: number): string[] | null {
  if (value.length > limit) return null;
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    strings.push(entry);
  }
  return strings;
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

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
