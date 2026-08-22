import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const APP_SERVER_MESSAGE_EVENT = "syndrid://app-server/message";
export const APP_SERVER_STDERR_EVENT = "syndrid://app-server/stderr";

export type NativeAppServerStatus =
  | { state: "stopped" }
  | { state: "running"; pid: number; binary: string }
  | { state: "exited"; code: number | null };

export async function startNativeAppServer(binary?: string): Promise<NativeAppServerStatus> {
  if (!isTauri()) {
    throw new Error("Syndrid app-server supervision is only available inside the Tauri desktop runtime.");
  }

  return invoke<NativeAppServerStatus>("start_app_server", {
    binary: binary ?? null,
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
