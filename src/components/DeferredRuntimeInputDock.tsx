import { lazy, Suspense, useSyncExternalStore } from "react";
import {
  getRuntimeInputSnapshot,
  subscribeRuntimeInput,
} from "../runtime/runtimeInputStore";

const LazyRuntimeInputDock = lazy(async () => {
  const module = await import("./RuntimeInputDock");
  return { default: module.RuntimeInputDock };
});

export function DeferredRuntimeInputDock() {
  const requests = useSyncExternalStore(
    subscribeRuntimeInput,
    getRuntimeInputSnapshot,
    getRuntimeInputSnapshot,
  );

  if (requests.length === 0) return null;

  return (
    <Suspense fallback={null}>
      <LazyRuntimeInputDock />
    </Suspense>
  );
}
