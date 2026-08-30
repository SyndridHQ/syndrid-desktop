import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApprovalDock } from "./components/ApprovalDock";
import { CommandPalette } from "./components/CommandPalette";
import { ConversationFollowBridge } from "./components/ConversationFollowBridge";
import { DeferredModelCatalog } from "./components/DeferredModelCatalog";
import { DeferredPrimaryDocks } from "./components/DeferredPrimaryDocks";
import { DeferredUtilityDocks } from "./components/DeferredUtilityDocks";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { McpElicitationDock } from "./components/McpElicitationDock";
import { PrimaryNavigationBridge } from "./components/PrimaryNavigationBridge";
import { RuntimeInputDock } from "./components/RuntimeInputDock";
import { WarningsDock } from "./components/WarningsDock";
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
      <CommandPalette />
      <KeyboardShortcuts />
      <ApprovalDock />
      <RuntimeInputDock />
      <McpElicitationDock />
      <WarningsDock />
    </WorkbenchErrorBoundary>
  </StrictMode>,
);
