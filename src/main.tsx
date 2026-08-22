import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RuntimeActivityDock } from "./components/RuntimeActivityDock";
import "./styles.css";

const bootStartedAt = performance.now();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bootStartedAt={bootStartedAt} />
    <RuntimeActivityDock />
  </StrictMode>,
);
