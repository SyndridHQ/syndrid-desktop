import { useSyncExternalStore } from "react";

export interface WorkspaceSelection {
  threadId: string;
  cwd: string;
}

let current: WorkspaceSelection | null = null;
const listeners = new Set<() => void>();

export function setWorkspaceSelection(selection: WorkspaceSelection | null): void {
  if (current?.threadId === selection?.threadId && current?.cwd === selection?.cwd) return;
  current = selection;
  for (const listener of listeners) listener();
}

export function useWorkspaceSelection(): WorkspaceSelection | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WorkspaceSelection | null {
  return current;
}

function getServerSnapshot(): WorkspaceSelection | null {
  return null;
}
