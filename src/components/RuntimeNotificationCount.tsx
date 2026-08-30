import { useSyncExternalStore } from "react";
import { runtimeMetricsStore } from "../runtime/runtimeMetricsStore";

export function RuntimeNotificationCount() {
  const count = useSyncExternalStore(
    runtimeMetricsStore.subscribe,
    runtimeMetricsStore.getNotificationCount,
    runtimeMetricsStore.getNotificationCount,
  );

  return <>{count}</>;
}
