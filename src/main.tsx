import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApprovalDock } from "./components/ApprovalDock";
import { BackgroundProcessesDock } from "./components/BackgroundProcessesDock";
import { CommandPalette } from "./components/CommandPalette";
import { ContextDock } from "./components/ContextDock";
import { DiagnosticsDock } from "./components/DiagnosticsDock";
import { GitDock } from "./components/GitDock";
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
import { ReviewDock } from "./components/ReviewDock";
import { RuntimeActivityDock } from "./components/RuntimeActivityDock";
import { RuntimeInputDock } from "./components/RuntimeInputDock";
import { SessionHistoryDock } from "./components/SessionHistoryDock";
import { SettingsDock } from "./components/SettingsDock";
import { SkillsDock } from "./components/SkillsDock";
import { SubagentsDock } from "./components/SubagentsDock";
import { TerminalDock } from "./components/TerminalDock";
import { WarningsDock } from "./components/WarningsDock";
import { WorkbenchErrorBoundary } from "./components/WorkbenchErrorBoundary";
import { WorkspaceFilesDock } from "./components/WorkspaceFilesDock";
import "./styles.css";

const bootStartedAt = performance.now();
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Syndrid Desktop root mount element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <WorkbenchErrorBoundary>
      <App bootStartedAt={bootStartedAt} />
      <PrimaryNavigationBridge />
      <CommandPalette />
      <KeyboardShortcuts />
      <ApprovalDock />
      <RuntimeInputDock />
      <McpElicitationDock />
      <McpServerDock />
      <WorkspaceFilesDock />
      <SkillsDock />
      <ProviderDock />
      <ModelCatalogDock />
      <PermissionsDock />
      <GitDock />
      <ReviewDock />
      <TerminalDock />
      <BackgroundProcessesDock />
      <SubagentsDock />
      <SessionHistoryDock />
      <ContextDock />
      <PlanDock />
      <GoalDock />
      <HooksDock />
      <SettingsDock />
      <DiagnosticsDock />
      <WarningsDock />
      <RuntimeActivityDock />
    </WorkbenchErrorBoundary>
  </StrictMode>,
);
