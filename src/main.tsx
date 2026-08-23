import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApprovalDock } from "./components/ApprovalDock";
import { McpElicitationDock } from "./components/McpElicitationDock";
import { McpServerDock } from "./components/McpServerDock";
import { RuntimeActivityDock } from "./components/RuntimeActivityDock";
import { RuntimeInputDock } from "./components/RuntimeInputDock";
import { SkillsDock } from "./components/SkillsDock";
import { WorkspaceFilesDock } from "./components/WorkspaceFilesDock";
import "./styles.css";

const bootStartedAt = performance.now();

interface SelectedWorkspace {
  threadId: string;
  cwd: string;
}

function DesktopRoot() {
  const [workspace, setWorkspace] = useState<SelectedWorkspace | null>(null);
  const workspacePath = workspace?.cwd ?? null;

  return (
    <>
      <App bootStartedAt={bootStartedAt} onWorkspaceChange={setWorkspace} />
      <ApprovalDock />
      <RuntimeInputDock />
      <McpElicitationDock />
      <McpServerDock />
      <WorkspaceFilesDock workspacePath={workspacePath} />
      <SkillsDock workspacePath={workspacePath} />
      <RuntimeActivityDock />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopRoot />
  </StrictMode>,
);
