import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getRuntimeBinaryOverride } from "./runtimeBinaryPreference";

export const APP_SERVER_MESSAGE_EVENT = "syndrid://app-server/message";
export const APP_SERVER_STDERR_EVENT = "syndrid://app-server/stderr";

const MAX_APP_SERVER_LINE_BYTES = 32 * 1024 * 1024;
const textEncoder = new TextEncoder();

export type NativeAppServerStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number; binary: string }
  | { state: "exited"; code: number | null };

export async function startNativeAppServer(binary?: string): Promise<NativeAppServerStatus> {
  if (!isTauri()) {
    throw new Error("Syndrid app-server supervision is only available inside the Tauri desktop runtime.");
  }

  const configuredBinary = binary?.trim() || getRuntimeBinaryOverride();
  return invoke<NativeAppServerStatus>("start_app_server", {
    binary: configuredBinary ?? null,
  });
}

export async function stopNativeAppServer(): Promise<void> {
  if (!isTauri()) return;
  await invoke("stop_app_server");
}

export async function nativeAppServerStatus(): Promise<NativeAppServerStatus> {
  if (!isTauri()) return { state: "stopped" };
  return invoke<NativeAppServerStatus>("app_server_status");
}

export async function sendNativeAppServerLine(line: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Cannot send app-server messages outside the Tauri desktop runtime.");
  }
  if (exceedsUtf8ByteLimit(line, MAX_APP_SERVER_LINE_BYTES)) {
    throw new Error(
      `Syndrid app-server message exceeds the ${MAX_APP_SERVER_LINE_BYTES / (1024 * 1024)} MiB desktop transport limit.`,
    );
  }
  await invoke("app_server_send", { line });
}

export async function onNativeAppServerMessage(
  handler: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(APP_SERVER_MESSAGE_EVENT, (event) => handler(event.payload));
}

export async function onNativeAppServerStderr(
  handler: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<string>(APP_SERVER_STDERR_EVENT, (event) => handler(event.payload));
}

function exceedsUtf8ByteLimit(value: string, limit: number): boolean {
  // UTF-8 uses at least one byte and at most three bytes per UTF-16 code unit.
  // Ordinary JSON-RPC lines are far below this threshold, so avoid allocating an
  // encoded copy unless the string is actually large enough to need exact sizing.
  if (value.length > limit) return true;
  if (value.length <= Math.floor(limit / 3)) return false;
  return textEncoder.encode(value).byteLength > limit;
}
