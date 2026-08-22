export interface WorkspaceSelection {
  threadId: string;
  cwd: string;
}

let current: WorkspaceSelection | null = null;

export function setWorkspaceSelection(selection: WorkspaceSelection | null): void {
  current = selection;
}

export function getWorkspaceSelection(): WorkspaceSelection | null {
  return current;
}
