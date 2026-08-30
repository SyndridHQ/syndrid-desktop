import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import {
  getRuntimeWarningsSnapshot,
  subscribeRuntimeWarnings,
} from "../runtime/runtimeWarningsStore";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./warningsBridge.css";

const LazyWarningsDock = lazy(async () => {
  const module = await import("./WarningsDock");
  return { default: module.WarningsDock };
});

export function DeferredWarningsDock() {
  const workspace = useRuntimeWorkspace();
  const entries = useSyncExternalStore(
    subscribeRuntimeWarnings,
    getRuntimeWarningsSnapshot,
    getRuntimeWarningsSnapshot,
  );
  const [open, setOpen] = useState(false);

  const selectedCount = useMemo(() => {
    const selectedThreadId = workspace?.threadId ?? null;
    return entries.filter(
      (entry) => entry.threadId === null || entry.threadId === selectedThreadId,
    ).length;
  }, [entries, workspace?.threadId]);

  return (
    <aside className="warnings-dock" aria-label="Runtime warnings">
      <button
        aria-expanded={open}
        className="warnings-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden="true">!</span>
        Warnings
        {selectedCount > 0 && <span>{selectedCount}</span>}
      </button>
      {open && (
        <Suspense fallback={null}>
          <LazyWarningsDock />
        </Suspense>
      )}
    </aside>
  );
}
