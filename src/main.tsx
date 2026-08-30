import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConversationFollowBridge } from "./components/ConversationFollowBridge";
import { DeferredApprovalDock } from "./components/DeferredApprovalDock";
import { DeferredCommandPalette } from "./components/DeferredCommandPalette";
import { DeferredMcpElicitationDock } from "./components/DeferredMcpElicitationDock";
import { DeferredModelCatalog } from "./components/DeferredModelCatalog";
import { DeferredPrimaryDocks } from "./components/DeferredPrimaryDocks";
import { DeferredRuntimeInputDock } from "./components/DeferredRuntimeInputDock";
import { DeferredUtilityDocks } from "./components/DeferredUtilityDocks";
import { DeferredWarningsDock } from "./components/DeferredWarningsDock";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { PrimaryNavigationBridge } from "./components/PrimaryNavigationBridge";
import { WorkbenchErrorBoundary } from "./components/WorkbenchErrorBoundary";
import "./styles.css";
import "./connectedWorkflow.css";

const bootStartedAt = performance.now();
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Syndrid Desktop root mount element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <WorkbenchErrorBoundary>
      <App bootStartedAt={bootStartedAt} />
      <DeferredPrimaryDocks />
      <DeferredUtilityDocks />
      <DeferredModelCatalog />
      <PrimaryNavigationBridge />
      <ConversationFollowBridge />
      <DeferredCommandPalette />
      <KeyboardShortcuts />
      <DeferredApprovalDock />
      <DeferredRuntimeInputDock />
      <DeferredMcpElicitationDock />
      <DeferredWarningsDock />
    </WorkbenchErrorBoundary>
  </StrictMode>,
);
