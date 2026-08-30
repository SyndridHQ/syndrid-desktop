import { useEffect } from "react";

type RailAction = {
  title: string;
  run: () => boolean;
};

type SurfaceToggle = {
  toggleSelector: string;
  panelSelector: string;
  railTitles: readonly string[];
};

const surfaceToggles: SurfaceToggle[] = [
  {
    toggleSelector: ".workspace-files-toggle",
    panelSelector: ".workspace-files-panel",
    railTitles: ["Workspace"],
  },
  {
    toggleSelector: ".git-toggle",
    panelSelector: ".git-panel",
    railTitles: ["Changes", "Git"],
  },
  {
    toggleSelector: ".skills-toggle",
    panelSelector: ".skills-panel",
    railTitles: ["Extensions"],
  },
  {
    toggleSelector: ".settings-toggle",
    panelSelector: ".settings-panel",
    railTitles: ["Settings"],
  },
];

const actions: RailAction[] = [
  {
    title: "Workspace",
    run: () => selectSurface(".workspace-files-toggle", ".workspace-files-panel"),
  },
  {
    title: "Agent",
    run: () => {
      closePrimarySurfaces();
      return focus(".composer-input");
    },
  },
  {
    title: "Changes",
    run: () => selectSurface(".git-toggle", ".git-panel"),
  },
  {
    title: "Git",
    run: () => selectSurface(".git-toggle", ".git-panel"),
  },
  {
    title: "Extensions",
    run: () => selectSurface(".skills-toggle", ".skills-panel"),
  },
  {
    title: "Settings",
    run: () => selectSurface(".settings-toggle", ".settings-panel"),
  },
];

export function PrimaryNavigationBridge() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const initiallyActive = document.querySelector<HTMLButtonElement>(
      ".activity-rail .rail-button.active",
    );
    if (initiallyActive) initiallyActive.setAttribute("aria-current", "page");

    for (const action of actions) {
      const button = railButton(action.title);
      if (!button) continue;
      const onClick = () => {
        if (!action.run()) return;
        activateRailButton(button);
      };
      button.addEventListener("click", onClick);
      cleanups.push(() => button.removeEventListener("click", onClick));
    }

    for (const surface of surfaceToggles) {
      const toggle = document.querySelector<HTMLElement>(surface.toggleSelector);
      if (!toggle) continue;
      const onToggle = () => {
        // React handles the dock toggle later in the same click dispatch. Reconcile
        // after that state update without introducing a MutationObserver or polling.
        queueMicrotask(() => {
          if (document.querySelector(surface.panelSelector)) return;
          const active = document.querySelector<HTMLButtonElement>(
            ".activity-rail .rail-button.active",
          );
          if (!active || !surface.railTitles.includes(active.title)) return;
          const agent = railButton("Agent");
          if (agent) activateRailButton(agent);
        });
      };
      toggle.addEventListener("click", onToggle);
      cleanups.push(() => toggle.removeEventListener("click", onToggle));
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return null;
}

function railButton(title: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    `.activity-rail .rail-button[title="${title}"]`,
  );
}

function activateRailButton(button: HTMLButtonElement): void {
  document.querySelectorAll(".activity-rail .rail-button.active").forEach((element) => {
    element.classList.remove("active");
    element.removeAttribute("aria-current");
  });
  button.classList.add("active");
  button.setAttribute("aria-current", "page");
}

function selectSurface(toggleSelector: string, panelSelector: string): boolean {
  closePrimarySurfaces(panelSelector);
  if (document.querySelector(panelSelector)) return true;
  return click(toggleSelector);
}

function closePrimarySurfaces(exceptPanelSelector?: string): void {
  for (const surface of surfaceToggles) {
    if (surface.panelSelector === exceptPanelSelector) continue;
    if (!document.querySelector(surface.panelSelector)) continue;
    click(surface.toggleSelector);
  }
}

function click(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element || element.hasAttribute("disabled")) return false;
  element.click();
  return true;
}

function focus(selector: string): boolean {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element || element.hasAttribute("disabled")) return false;
  element.focus();
  return document.activeElement === element;
}
