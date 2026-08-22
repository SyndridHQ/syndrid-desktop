import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApprovalDock } from "./components/ApprovalDock";
import { McpElicitationDock } from "./components/McpElicitationDock";
import { McpServerDock } from "./components/McpServerDock";
import { RuntimeActivityDock } from "./components/RuntimeActivityDock";
import { RuntimeInputDock } from "./components/RuntimeInputDock";
import "./styles.css";

const bootStartedAt = performance.now();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bootStartedAt={bootStartedAt} />
    <ApprovalDock />
    <RuntimeInputDock />
    <McpElicitationDock />
    <McpServerDock />
    <RuntimeActivityDock />
  </StrictMode>,
);
