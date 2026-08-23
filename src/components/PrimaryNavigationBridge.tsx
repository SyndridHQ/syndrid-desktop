import { useEffect } from "react";

type RailAction = {
  title: string;
  run: () => void;
};

const actions: RailAction[] = [
  { title: "Workspace", run: () => click(".workspace-files-toggle") },
  { title: "Agent", run: () => focus(".composer-input") },
  { title: "Changes", run: () => click(".git-toggle") },
  { title: "Git", run: () => click(".git-toggle") },
  { title: "Extensions", run: () => click(".skills-toggle") },
  { title: "Settings", run: () => click(".settings-toggle") },
];

export function PrimaryNavigationBridge() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    for (const action of actions) {
      const button = document.querySelector<HTMLButtonElement>(
        `.activity-rail .rail-button[title="${action.title}"]`,
      );
      if (!button) continue;
      const onClick = () => {
        document.querySelectorAll(".activity-rail .rail-button.active").forEach((element) => {
          element.classList.remove("active");
        });
        button.classList.add("active");
        action.run();
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

function click(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element && !element.hasAttribute("disabled")) element.click();
}

function focus(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element && !element.hasAttribute("disabled")) element.focus();
}
