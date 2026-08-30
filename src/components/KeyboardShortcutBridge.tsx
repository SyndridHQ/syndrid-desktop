import { lazy, Suspense, useEffect, useRef, useState } from "react";

const KeyboardShortcuts = lazy(async () => {
  const module = await import("./KeyboardShortcuts");
  return { default: module.KeyboardShortcuts };
});

type Shortcut = {
  matches: (event: KeyboardEvent) => boolean;
  run: () => void;
};

const shortcuts: Shortcut[] = [
  {
    matches: (event) => isPrimaryMod(event) && event.shiftKey && event.key.toLowerCase() === "a",
    run: () => clickRailButton("Agent"),
  },
  {
    matches: (event) => isPrimaryMod(event) && event.shiftKey && event.key.toLowerCase() === "e",
    run: () => clickElement(".workspace-files-toggle"),
  },
  {
    matches: (event) => isPrimaryMod(event) && event.shiftKey && event.key.toLowerCase() === "g",
    run: () => clickElement(".git-toggle"),
  },
  {
    matches: (event) => isPrimaryMod(event) && !event.shiftKey && event.key === "`",
    run: () => clickElement(".terminal-toggle"),
  },
  {
    matches: (event) => isPrimaryMod(event) && !event.shiftKey && event.key === ",",
    run: () => clickElement(".settings-toggle"),
  },
];

export function KeyboardShortcutBridge() {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(false);

  useEffect(() => {
    const openHelp = () => {
      helpOpenRef.current = true;
      setHelpOpen(true);
    };
    window.addEventListener("syndrid:open-shortcuts", openHelp);
    return () => window.removeEventListener("syndrid:open-shortcuts", openHelp);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && helpOpenRef.current) {
        event.preventDefault();
        helpOpenRef.current = false;
        setHelpOpen(false);
        return;
      }

      if (
        helpOpenRef.current &&
        isPrimaryMod(event) &&
        event.key.toLowerCase() === "k"
      ) {
        helpOpenRef.current = false;
        setHelpOpen(false);
        return;
      }

      if (
        isPrimaryMod(event) &&
        !event.shiftKey &&
        event.key === "/" &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        const nextOpen = !helpOpenRef.current;
        helpOpenRef.current = nextOpen;
        setHelpOpen(nextOpen);
        return;
      }

      if (helpOpenRef.current || isEditableTarget(event.target)) return;
      const shortcut = shortcuts.find((entry) => entry.matches(event));
      if (!shortcut) return;
      event.preventDefault();
      shortcut.run();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!helpOpen) return null;

  return (
    <Suspense fallback={null}>
      <KeyboardShortcuts
        onClose={() => {
          helpOpenRef.current = false;
          setHelpOpen(false);
        }}
      />
    </Suspense>
  );
}

function isPrimaryMod(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function clickElement(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element && !element.hasAttribute("disabled")) element.click();
}

function clickRailButton(title: string): void {
  const button = document.querySelector<HTMLButtonElement>(
    `.activity-rail .rail-button[title="${title}"]`,
  );
  if (button && !button.disabled) button.click();
}
