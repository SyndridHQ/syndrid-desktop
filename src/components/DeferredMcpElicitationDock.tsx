import { lazy, Suspense, useSyncExternalStore } from "react";
import {
  getRuntimeMcpElicitationSnapshot,
  subscribeRuntimeMcpElicitation,
} from "../runtime/runtimeMcpElicitationStore";

const LazyMcpElicitationDock = lazy(async () => {
  const module = await import("./McpElicitationDock");
  return { default: module.McpElicitationDock };
});

export function DeferredMcpElicitationDock() {
  const requests = useSyncExternalStore(
    subscribeRuntimeMcpElicitation,
    getRuntimeMcpElicitationSnapshot,
    getRuntimeMcpElicitationSnapshot,
  );

  if (requests.length === 0) return null;

  return (
    <Suspense fallback={null}>
      <LazyMcpElicitationDock />
    </Suspense>
  );
}
