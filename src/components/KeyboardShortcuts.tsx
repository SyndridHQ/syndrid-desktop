import { useEffect, useMemo, useState } from "react";
import "./keyboardShortcuts.css";

type Shortcut = {
  id: string;
  label: string;
  detail: string;
  keys: string[];
  matches: (event: KeyboardEvent) => boolean;
  run: () => void;
};

const shortcutDefinitions: Omit<Shortcut, "keys">[] = [
  {
    id: "files",
    label: "Workspace files",
    detail: "Toggle the runtime-backed workspace browser",
    matches: (event) => isMod(event) && event.shiftKey && event.key.toLowerCase() === "e",
    run: () => clickElement(".workspace-files-toggle"),
  },
  {
    id: "source-control",
    label: "Source control",
    detail: "Toggle the selected-session Git surface",
    matches: (event) => isMod(event) && event.shiftKey && event.key.toLowerCase() === "g",
    run: () => clickElement(".git-toggle"),
  },
  {
    id: "terminal",
    label: "Terminal",
    detail: "Toggle the Syndrid-owned native PTY console",
    matches: (event) => isMod(event) && !event.shiftKey && event.key === "`",
    run: () => clickElement(".terminal-toggle"),
  },
  {
    id: "settings",
    label: "Desktop settings",
    detail: "Toggle native runtime supervision settings",
    matches: (event) => isMod(event) && !event.shiftKey && event.key === ",",
    run: () => clickElement(".settings-toggle"),
  },
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const modLabel = useMemo(() => (isApplePlatform() ? "⌘" : "Ctrl"), []);
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        ...shortcutDefinitions[0]!,
        keys: [modLabel, "Shift", "E"],
      },
      {
        ...shortcutDefinitions[1]!,
        keys: [modLabel, "Shift", "G"],
      },
      {
        ...shortcutDefinitions[2]!,
        keys: [modLabel, "`"],
      },
      {
        ...shortcutDefinitions[3]!,
        keys: [modLabel, ","],
      },
    ],
    [modLabel],
  );

  useEffect(() => {
    const openHelp = () => setOpen(true);
    window.addEventListener("syndrid:open-shortcuts", openHelp);
    return () => window.removeEventListener("syndrid:open-shortcuts", openHelp);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (isMod(event) && !event.shiftKey && event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      if (open || isEditableTarget(event.target)) return;
      const shortcut = shortcuts.find((entry) => entry.matches(event));
      if (!shortcut) return;
      event.preventDefault();
      shortcut.run();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, shortcuts]);

  if (!open) return null;

  return (
    <div
      aria-label="Keyboard shortcuts"
      aria-modal="true"
      className="keyboard-shortcuts-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      role="dialog"
    >
      <section className="keyboard-shortcuts-panel">
        <header>
          <span>
            <strong>Keyboard shortcuts</strong>
            <small>Workbench controls only · runtime behavior stays in SyndridCLI</small>
          </span>
          <button onClick={() => setOpen(false)} type="button">
            Close
          </button>
        </header>

        <div className="keyboard-shortcuts-list">
          <ShortcutRow
            detail="Search and run mounted Syndrid commands"
            keys={[modLabel, "K"]}
            label="Command palette"
          />
          {shortcuts.map((shortcut) => (
            <ShortcutRow
              detail={shortcut.detail}
              keys={shortcut.keys}
              key={shortcut.id}
              label={shortcut.label}
            />
          ))}
          <ShortcutRow
            detail="Toggle this shortcut reference"
            keys={[modLabel, "/"]}
            label="Shortcut reference"
          />
        </div>

        <footer>
          Workbench shortcuts are suppressed while typing in an input, editor, or content-editable surface.
        </footer>
      </section>
    </div>
  );
}

function ShortcutRow({ detail, keys, label }: { detail: string; keys: string[]; label: string }) {
  return (
    <article className="keyboard-shortcut-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <div aria-label={keys.join(" + ")} className="keyboard-shortcut-keys">
        {keys.map((key, index) => (
          <kbd key={`${key}-${index}`}>{key}</kbd>
        ))}
      </div>
    </article>
  );
}

function isMod(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
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
