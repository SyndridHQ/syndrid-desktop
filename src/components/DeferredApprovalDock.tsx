import { lazy, Suspense, useSyncExternalStore } from "react";
import {
  getRuntimeApprovalsSnapshot,
  subscribeRuntimeApprovals,
} from "../runtime/runtimeApprovalsStore";

const LazyApprovalDock = lazy(async () => {
  const module = await import("./ApprovalDock");
  return { default: module.ApprovalDock };
});

export function DeferredApprovalDock() {
  const approvals = useSyncExternalStore(
    subscribeRuntimeApprovals,
    getRuntimeApprovalsSnapshot,
    getRuntimeApprovalsSnapshot,
  );

  if (approvals.length === 0) return null;

  return (
    <Suspense fallback={null}>
      <LazyApprovalDock />
    </Suspense>
  );
}
