import { useCallback, useEffect, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { GitWorktreeListResponse } from "../runtime/gitWorktreeProtocol";
import {
  notifications,
  type TurnDiffUpdatedNotification,
} from "../runtime/protocol";
import { GitWorktreePanel } from "./GitWorktreePanel";

interface GitWorktreeRuntimePanelProps {
  cwd: string;
  threadId: string;
}

/**
 * Explicit, runtime-backed controller for linked-worktree inventory.
 *
 * SyndridCLI owns Git discovery, path semantics, subprocess lifetime, and response
 * bounds. Desktop retains only the last explicitly requested presentation snapshot
 * and marks it stale when the selected runtime thread reports Git-affecting changes.
 */
export function GitWorktreeRuntimePanel({ cwd, threadId }: GitWorktreeRuntimePanelProps) {
  const [inventory, setInventory] = useState<GitWorktreeListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setInventory(null);
    setLoading(false);
    setStale(false);
    setError(null);
  }, [cwd, threadId]);

  useEffect(() => {
    if (!inventory) return;
    return appServerClient.onNotification((notification) => {
      if (notification.method !== notifications.turnDiffUpdated) return;
      const event = notification.params as TurnDiffUpdatedNotification | undefined;
      if (event?.threadId === threadId) setStale(true);
    });
  }, [inventory, threadId]);

  const load = useCallback(async () => {
    if (loading) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before loading linked worktrees.");
      return;
    }

    const requestGeneration = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await appServerClient.listGitWorktrees(cwd);
      const selectedWorkspace = appServerClient.getWorkspaceSnapshot();
      if (
        requestGeneration !== generation.current ||
        selectedWorkspace?.threadId !== threadId ||
        selectedWorkspace.cwd !== cwd
      ) {
        return;
      }
      setInventory(result);
      setStale(false);
    } catch (cause) {
      const selectedWorkspace = appServerClient.getWorkspaceSnapshot();
      if (
        requestGeneration === generation.current &&
        selectedWorkspace?.threadId === threadId &&
        selectedWorkspace.cwd === cwd
      ) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      const selectedWorkspace = appServerClient.getWorkspaceSnapshot();
      if (
        requestGeneration === generation.current &&
        selectedWorkspace?.threadId === threadId &&
        selectedWorkspace.cwd === cwd
      ) {
        setLoading(false);
      }
    }
  }, [cwd, loading, threadId]);

  return (
    <GitWorktreePanel
      cwd={cwd}
      error={error}
      inventory={inventory}
      loading={loading}
      onLoad={() => void load()}
      stale={stale}
    />
  );
}
