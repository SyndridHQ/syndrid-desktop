import { useEffect } from "react";

type RailAction = {
  title: string;
  run: () => boolean;
};

const actions: RailAction[] = [
  { title: "Workspace", run: () => open(".workspace-files-toggle", ".workspace-files-panel") },
  { title: "Agent", run: () => focus(".composer-input") },
  { title: "Changes", run: () => open(".git-toggle", ".git-panel") },
  { title: "Git", run: () => open(".git-toggle", ".git-panel") },
  { title: "Extensions", run: () => open(".skills-toggle", ".skills-panel") },
  { title: "Settings", run: () => open(".settings-toggle", ".settings-panel") },
];

export function PrimaryNavigationBridge() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const initiallyActive = document.querySelector<HTMLButtonElement>(
      ".activity-rail .rail-button.active",
    );
    if (initiallyActive) initiallyActive.setAttribute("aria-current", "page");

    for (const action of actions) {
      const button = document.querySelector<HTMLButtonElement>(
        `.activity-rail .rail-button[title="${action.title}"]`,
      );
      if (!button) continue;
      const onClick = () => {
        if (!action.run()) return;
        document.querySelectorAll(".activity-rail .rail-button.active").forEach((element) => {
          element.classList.remove("active");
          element.removeAttribute("aria-current");
        });
        button.classList.add("active");
        button.setAttribute("aria-current", "page");
      };
      button.addEventListener("click", onClick);
      cleanups.push(() => button.removeEventListener("click", onClick));
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return null;
}

function open(toggleSelector: string, panelSelector: string): boolean {
  if (document.querySelector(panelSelector)) return true;
  return click(toggleSelector);
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
