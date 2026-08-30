import { useCallback, useRef, useState, type ComponentType } from "react";

type SurfaceId =
  | "terminal"
  | "review"
  | "diagnostics"
  | "providers"
  | "mcp"
  | "permissions"
  | "processes"
  | "history"
  | "subagents"
  | "context"
  | "goal"
  | "plan"
  | "hooks";

type LoadedSurfaces = Partial<Record<SurfaceId, ComponentType>>;

type SurfaceDefinition = {
  id: SurfaceId;
  toggleClass: string;
  panelSelector: string;
  label: string;
  load: () => Promise<ComponentType>;
};

const surfaces: readonly SurfaceDefinition[] = [
  {
    id: "terminal",
    toggleClass: "terminal-toggle",
    panelSelector: ".terminal-panel",
    label: "Terminal",
    load: () => import("./TerminalDock").then((module) => module.TerminalDock),
  },
  {
    id: "review",
    toggleClass: "review-toggle",
    panelSelector: ".review-panel",
    label: "Review",
    load: () => import("./ReviewDock").then((module) => module.ReviewDock),
  },
  {
    id: "diagnostics",
    toggleClass: "diagnostics-toggle",
    panelSelector: ".diagnostics-panel",
    label: "Diagnostics",
    load: () => import("./DiagnosticsDock").then((module) => module.DiagnosticsDock),
  },
  {
    id: "providers",
    toggleClass: "provider-toggle",
    panelSelector: ".provider-panel",
    label: "Providers",
    load: () => import("./ProviderDock").then((module) => module.ProviderDock),
  },
  {
    id: "mcp",
    toggleClass: "mcp-server-toggle",
    panelSelector: ".mcp-server-panel",
    label: "MCP",
    load: () => import("./McpServerDock").then((module) => module.McpServerDock),
  },
  {
    id: "permissions",
    toggleClass: "permissions-toggle",
    panelSelector: ".permissions-panel",
    label: "Permissions",
    load: () => import("./PermissionsDock").then((module) => module.PermissionsDock),
  },
  {
    id: "processes",
    toggleClass: "background-processes-toggle",
    panelSelector: ".background-processes-panel",
    label: "Processes",
    load: () =>
      import("./BackgroundProcessesDock").then((module) => module.BackgroundProcessesDock),
  },
  {
    id: "history",
    toggleClass: "session-history-toggle",
    panelSelector: ".session-history-panel",
    label: "History",
    load: () => import("./SessionHistoryDock").then((module) => module.SessionHistoryDock),
  },
  {
    id: "subagents",
    toggleClass: "subagents-toggle",
    panelSelector: ".subagents-panel",
    label: "Agents",
    load: () => import("./SubagentsDock").then((module) => module.SubagentsDock),
  },
  {
    id: "context",
    toggleClass: "context-toggle",
    panelSelector: ".context-panel",
    label: "Context",
    load: () => import("./ContextDock").then((module) => module.ContextDock),
  },
  {
    id: "goal",
    toggleClass: "goal-toggle",
    panelSelector: ".goal-panel",
    label: "Objective",
    load: () => import("./GoalDock").then((module) => module.GoalDock),
  },
  {
    id: "plan",
    toggleClass: "plan-toggle",
    panelSelector: ".plan-panel",
    label: "Plan",
    load: () => import("./PlanDock").then((module) => module.PlanDock),
  },
  {
    id: "hooks",
    toggleClass: "hooks-toggle",
    panelSelector: ".hooks-panel",
    label: "Hooks",
    load: () => import("./HooksDock").then((module) => module.HooksDock),
  },
] as const;

/**
 * Defers user-invoked utility surfaces whose runtime work begins only after the
 * user opens them. The hidden placeholders preserve existing command-palette and
 * keyboard selectors without pulling the implementation into the startup graph.
 *
 * Once loaded, a dock stays mounted so user-launched work and any explicit runtime
 * completion tracking can survive ordinary open/close cycles. Runtime-request
 * surfaces remain eager elsewhere because they must react immediately to server
 * requests.
 */
export function DeferredUtilityDocks() {
  const [loaded, setLoaded] = useState<LoadedSurfaces>({});
  const loadingRef = useRef<Partial<Record<SurfaceId, Promise<ComponentType>>>>({});
  const requestedSurfaceRef = useRef<SurfaceId | null>(null);

  const requestSurface = useCallback((surface: SurfaceDefinition) => {
    requestedSurfaceRef.current = surface.id;

    const existing = loadingRef.current[surface.id];
    const pending = existing ?? surface.load();
    loadingRef.current[surface.id] = pending;

    void pending
      .then((Component) => {
        setLoaded((current) =>
          current[surface.id] ? current : { ...current, [surface.id]: Component },
        );

        requestAnimationFrame(() => {
          if (requestedSurfaceRef.current !== surface.id) return;
          const toggle = document.querySelector<HTMLButtonElement>(`.${surface.toggleClass}`);
          if (!toggle || toggle.dataset.deferredPlaceholder === "true") return;
          if (!document.querySelector(surface.panelSelector)) toggle.click();
        });
      })
      .catch((error: unknown) => {
        delete loadingRef.current[surface.id];
        console.error(`Failed to load deferred ${surface.id} surface`, error);
      });
  }, []);

  return (
    <>
      {surfaces.map((surface) => {
        const Component = loaded[surface.id];
        if (Component) return <Component key={surface.id} />;

        return (
          <button
            aria-hidden="true"
            className={surface.toggleClass}
            data-deferred-placeholder="true"
            key={surface.id}
            onClick={() => requestSurface(surface)}
            style={{ display: "none" }}
            tabIndex={-1}
            type="button"
          >
            {surface.label}
          </button>
        );
      })}
    </>
  );
}
