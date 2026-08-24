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
import { McpElicitationDock } from "./components/McpElicitationDock";
import { McpServerDock } from "./components/McpServerDock";
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
import { WorkspaceFilesDock } from "./components/WorkspaceFilesDock";
import "./styles.css";

const bootStartedAt = performance.now();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bootStartedAt={bootStartedAt} />
    <PrimaryNavigationBridge />
    <CommandPalette />
    <ApprovalDock />
    <RuntimeInputDock />
    <McpElicitationDock />
    <McpServerDock />
    <WorkspaceFilesDock />
    <SkillsDock />
    <ProviderDock />
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
  </StrictMode>,
);
