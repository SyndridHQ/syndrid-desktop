import { useCallback, useRef, useState, type ComponentType } from "react";

type SurfaceId = "workspace" | "git" | "skills" | "settings";

type LoadedSurfaces = Partial<Record<SurfaceId, ComponentType>>;

type SurfaceDefinition = {
  id: SurfaceId;
  toggleClass: string;
  label: string;
  railTitles: readonly string[];
  load: () => Promise<ComponentType>;
};

const surfaces: readonly SurfaceDefinition[] = [
  {
    id: "workspace",
    toggleClass: "workspace-files-toggle",
    label: "Files",
    railTitles: ["Workspace"],
    load: () => import("./WorkspaceFilesDock").then((module) => module.WorkspaceFilesDock),
  },
  {
    id: "git",
    toggleClass: "git-toggle",
    label: "Git",
    railTitles: ["Changes", "Git"],
    load: () => import("./GitDock").then((module) => module.GitDock),
  },
  {
    id: "skills",
    toggleClass: "skills-toggle",
    label: "Skills",
    railTitles: ["Extensions"],
    load: () => import("./SkillsDock").then((module) => module.SkillsDock),
  },
  {
    id: "settings",
    toggleClass: "settings-toggle",
    label: "Settings",
    railTitles: ["Settings"],
    load: () => import("./SettingsDock").then((module) => module.SettingsDock),
  },
] as const;

/**
 * Keeps primary workbench entry points available to the existing navigation and
 * command-palette selectors without loading their implementation until first use.
 *
 * Runtime-request surfaces (approvals/input/elicitation) deliberately stay eager;
 * these four user-invoked surfaces are safe to defer and remain mounted after the
 * first load so local UI state is preserved across open/close cycles.
 */
export function DeferredPrimaryDocks() {
  const [loaded, setLoaded] = useState<LoadedSurfaces>({});
  const loadingRef = useRef<Partial<Record<SurfaceId, Promise<ComponentType>>>>({});
  const requestedSurfaceRef = useRef<SurfaceId | null>(null);

  const requestSurface = useCallback(
    (surface: SurfaceDefinition) => {
      requestedSurfaceRef.current = surface.id;

      const existing = loadingRef.current[surface.id];
      const pending = existing ?? surface.load();
      loadingRef.current[surface.id] = pending;

      void pending
        .then((Component) => {
          setLoaded((current) =>
            current[surface.id] ? current : { ...current, [surface.id]: Component },
          );

          // Wait until React has committed the newly loaded dock. Do not open a
          // stale request if the user navigated elsewhere while its chunk loaded.
          requestAnimationFrame(() => {
            if (requestedSurfaceRef.current !== surface.id) return;
            const activeRail = document.querySelector<HTMLButtonElement>(
              ".activity-rail .rail-button.active",
            );
            if (!activeRail || !surface.railTitles.includes(activeRail.title)) return;

            const toggle = document.querySelector<HTMLButtonElement>(`.${surface.toggleClass}`);
            if (!toggle || toggle.dataset.deferredPlaceholder === "true") return;
            if (!document.querySelector(surfacePanelSelector(surface.id))) toggle.click();
          });
        })
        .catch((error: unknown) => {
          delete loadingRef.current[surface.id];
          console.error(`Failed to load deferred ${surface.id} surface`, error);
        });
    },
    [],
  );

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

function surfacePanelSelector(surface: SurfaceId): string {
  switch (surface) {
    case "workspace":
      return ".workspace-files-panel";
    case "git":
      return ".git-panel";
    case "skills":
      return ".skills-panel";
    case "settings":
      return ".settings-panel";
  }
}
