import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApprovalDock } from "./components/ApprovalDock";
import { CommandPalette } from "./components/CommandPalette";
import { McpElicitationDock } from "./components/McpElicitationDock";
import { McpServerDock } from "./components/McpServerDock";
import { RuntimeActivityDock } from "./components/RuntimeActivityDock";
import { RuntimeInputDock } from "./components/RuntimeInputDock";
import { SkillsDock } from "./components/SkillsDock";
import { WorkspaceFilesDock } from "./components/WorkspaceFilesDock";
import "./styles.css";

const bootStartedAt = performance.now();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bootStartedAt={bootStartedAt} />
    <CommandPalette />
    <ApprovalDock />
    <RuntimeInputDock />
    <McpElicitationDock />
    <McpServerDock />
    <WorkspaceFilesDock />
    <SkillsDock />
    <RuntimeActivityDock />
  </StrictMode>,
);
