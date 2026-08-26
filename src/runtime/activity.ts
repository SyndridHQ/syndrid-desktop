export type RuntimeActivityKind =
  | "command"
  | "file-change"
  | "mcp-tool"
  | "dynamic-tool"
  | "subagent"
  | "web-search"
  | "image-generation"
  | "other";

export type RuntimeActivityPhase = "running" | "completed";

export interface RuntimeActivity {
  id: string;
  threadId: string;
  turnId: string;
  kind: RuntimeActivityKind;
  phase: RuntimeActivityPhase;
  title: string;
  detail: string | null;
  status: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
}

export interface RuntimeItemLifecycleEnvelope {
  threadId: string;
  turnId: string;
  item: Record<string, unknown>;
  startedAtMs?: number;
  completedAtMs?: number;
}

const MAX_ACTIVITY_TEXT_CHARS = 8_192;

export function isRuntimeItemLifecycleEnvelope(
  value: unknown,
): value is RuntimeItemLifecycleEnvelope {
  return (
    isRecord(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    isRecord(value.item) &&
    typeof value.item.id === "string" &&
    typeof value.item.type === "string"
  );
}

export function activityFromLifecycle(
  envelope: RuntimeItemLifecycleEnvelope,
  phase: RuntimeActivityPhase,
): RuntimeActivity | null {
  const item = envelope.item;
  const id = item.id as string;
  const type = item.type as string;
  const base = {
    id,
    threadId: envelope.threadId,
    turnId: envelope.turnId,
    phase,
    startedAtMs:
      typeof envelope.startedAtMs === "number" ? envelope.startedAtMs : null,
    completedAtMs:
      typeof envelope.completedAtMs === "number" ? envelope.completedAtMs : null,
  };

  switch (type) {
    case "commandExecution":
      return {
        ...base,
        kind: "command",
        title: stringValue(item.command) ?? "Command",
        detail: stringValue(item.cwd),
        status: statusValue(item.status, item.exitCode),
      };
    case "fileChange":
      return {
        ...base,
        kind: "file-change",
        title: `${arrayLength(item.changes)} file change${arrayLength(item.changes) === 1 ? "" : "s"}`,
        detail: summarizeFileChanges(item.changes),
        status: stringValue(item.status),
      };
    case "mcpToolCall":
      return {
        ...base,
        kind: "mcp-tool",
        title:
          boundedText(
            [stringValue(item.server), stringValue(item.tool)]
              .filter(Boolean)
              .join(" · "),
          ) || "MCP tool",
        detail: stringValue(item.pluginId),
        status: stringValue(item.status),
      };
    case "dynamicToolCall":
      return {
        ...base,
        kind: "dynamic-tool",
        title:
          boundedText(
            [stringValue(item.namespace), stringValue(item.tool)]
              .filter(Boolean)
              .join(" · "),
          ) || "Dynamic tool",
        detail:
          typeof item.success === "boolean"
            ? item.success
              ? "Succeeded"
              : "Failed"
            : null,
        status: stringValue(item.status),
      };
    case "collabAgentToolCall":
      return {
        ...base,
        kind: "subagent",
        title: boundedText(`Agent ${stringValue(item.tool) ?? "operation"}`),
        detail: summarizeAgents(item.receiverThreadIds),
        status: stringValue(item.status),
      };
    case "subAgentActivity":
      return {
        ...base,
        kind: "subagent",
        title: boundedText(`Subagent ${stringValue(item.kind) ?? "activity"}`),
        detail: stringValue(item.agentPath) ?? stringValue(item.agentThreadId),
        status: phase,
      };
    case "webSearch":
      return {
        ...base,
        kind: "web-search",
        title: "Web search",
        detail: null,
        status: phase,
      };
    case "imageGeneration":
      return {
        ...base,
        kind: "image-generation",
        title: "Image generation",
        detail: null,
        status: phase,
      };
    case "userMessage":
    case "agentMessage":
    case "reasoning":
    case "plan":
    case "hookPrompt":
    case "contextCompaction":
      return null;
    default:
      return {
        ...base,
        kind: "other",
        title: boundedText(humanize(type)),
        detail: null,
        status: phase,
      };
  }
}

export function upsertRuntimeActivity(
  current: RuntimeActivity[],
  next: RuntimeActivity,
  limit = 120,
): RuntimeActivity[] {
  const index = current.findIndex(
    (activity) => activity.threadId === next.threadId && activity.id === next.id,
  );
  const updated = [...current];

  if (index === -1) {
    updated.push(next);
  } else {
    const previous = updated[index];
    if (!previous) return updated;
    updated[index] = {
      ...previous,
      ...next,
      startedAtMs: next.startedAtMs ?? previous.startedAtMs,
    };
  }

  return updated.length > limit ? updated.slice(-limit) : updated;
}

function summarizeFileChanges(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const paths = value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      return (
        stringValue(entry.path) ??
        stringValue(entry.filePath) ??
        stringValue(entry.file_path)
      );
    })
    .filter((path): path is string => Boolean(path));
  if (paths.length === 0) return null;
  if (paths.length <= 2) return boundedText(paths.join(", "));
  return boundedText(`${paths.slice(0, 2).join(", ")} +${paths.length - 2}`);
}

function summarizeAgents(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((entry): entry is string => typeof entry === "string");
  if (ids.length === 0) return null;
  return ids.length === 1 ? boundedText(ids[0] ?? "") || null : `${ids.length} agents`;
}

function statusValue(status: unknown, exitCode: unknown): string | null {
  const statusText = stringValue(status);
  if (typeof exitCode === "number") {
    return boundedText(statusText ? `${statusText} · exit ${exitCode}` : `exit ${exitCode}`);
  }
  return statusText;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? boundedText(value) : null;
}

function boundedText(value: string): string {
  if (value.length <= MAX_ACTIVITY_TEXT_CHARS) return value;
  return `${value.slice(0, MAX_ACTIVITY_TEXT_CHARS - 1)}…`;
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
