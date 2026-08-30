import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApprovalDock } from "./components/ApprovalDock";
import { BackgroundProcessesDock } from "./components/BackgroundProcessesDock";
import { CommandPalette } from "./components/CommandPalette";
import { ContextDock } from "./components/ContextDock";
import { ConversationFollowBridge } from "./components/ConversationFollowBridge";
import { DeferredPrimaryDocks } from "./components/DeferredPrimaryDocks";
import { DeferredUtilityDocks } from "./components/DeferredUtilityDocks";
import { GoalDock } from "./components/GoalDock";
import { HooksDock } from "./components/HooksDock";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { McpElicitationDock } from "./components/McpElicitationDock";
import { McpServerDock } from "./components/McpServerDock";
import { ModelCatalogDock } from "./components/ModelCatalogDock";
import { PermissionsDock } from "./components/PermissionsDock";
import { PlanDock } from "./components/PlanDock";
import { PrimaryNavigationBridge } from "./components/PrimaryNavigationBridge";
import { ProviderDock } from "./components/ProviderDock";
import { RuntimeActivityDock } from "./components/RuntimeActivityDock";
import { RuntimeInputDock } from "./components/RuntimeInputDock";
import { SessionHistoryDock } from "./components/SessionHistoryDock";
import { SubagentsDock } from "./components/SubagentsDock";
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
      <McpServerDock />
      <ProviderDock />
      <ModelCatalogDock />
      <PermissionsDock />
      <BackgroundProcessesDock />
      <SubagentsDock />
      <SessionHistoryDock />
      <ContextDock />
      <PlanDock />
      <GoalDock />
      <HooksDock />
      <WarningsDock />
      <RuntimeActivityDock />
    </WorkbenchErrorBoundary>
  </StrictMode>,
);
