export interface FsWatchParams {
  watchId: string;
  path: string;
}

export interface FsWatchResponse {
  path: string;
}

export interface FsUnwatchParams {
  watchId: string;
}

export type FsUnwatchResponse = Record<string, never>;

export interface FsChangedNotification {
  watchId: string;
  changedPaths: string[];
}
