import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApprovalDock } from "./components/ApprovalDock";
import { CommandPalette } from "./components/CommandPalette";
import { ConversationFollowBridge } from "./components/ConversationFollowBridge";
import { DeferredPrimaryDocks } from "./components/DeferredPrimaryDocks";
import { DeferredUtilityDocks } from "./components/DeferredUtilityDocks";
import { GoalDock } from "./components/GoalDock";
import { HooksDock } from "./components/HooksDock";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { McpElicitationDock } from "./components/McpElicitationDock";
import { ModelCatalogDock } from "./components/ModelCatalogDock";
import { PlanDock } from "./components/PlanDock";
import { PrimaryNavigationBridge } from "./components/PrimaryNavigationBridge";
import { RuntimeActivityDock } from "./components/RuntimeActivityDock";
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
      <PrimaryNavigationBridge />
      <ConversationFollowBridge />
      <CommandPalette />
      <KeyboardShortcuts />
      <ApprovalDock />
      <RuntimeInputDock />
      <McpElicitationDock />
      <ModelCatalogDock />
      <PlanDock />
      <GoalDock />
      <HooksDock />
      <WarningsDock />
      <RuntimeActivityDock />
    </WorkbenchErrorBoundary>
  </StrictMode>,
);
