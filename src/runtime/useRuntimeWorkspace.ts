import { useSyncExternalStore } from "react";
import { appServerClient, type RuntimeWorkspaceSnapshot } from "./appServerClient";

const subscribe = (listener: () => void) => appServerClient.onWorkspaceChange(listener);
const getSnapshot = (): RuntimeWorkspaceSnapshot | null =>
  appServerClient.getWorkspaceSnapshot();
const getServerSnapshot = (): RuntimeWorkspaceSnapshot | null => null;

/**
 * Read-only projection of the workspace selected through app-server thread
 * operations. The protocol client remains the source of truth; this hook adds
 * no polling and owns no independent session state.
 */
export function useRuntimeWorkspace(): RuntimeWorkspaceSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
