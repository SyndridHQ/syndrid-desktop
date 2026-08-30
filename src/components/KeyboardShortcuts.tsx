import { useEffect, useMemo, useRef } from "react";
import "./keyboardShortcuts.css";

type KeyboardShortcutsProps = {
  onClose: () => void;
};

type ShortcutDisplay = {
  id: string;
  label: string;
  detail: string;
  keys: string[];
};

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modLabel = useMemo(() => (isApplePlatform() ? "⌘" : "Ctrl"), []);
  const shortcuts = useMemo<ShortcutDisplay[]>(
    () => [
      {
        id: "agent",
        label: "Agent workspace",
        detail: "Close primary tool surfaces and return focus to the Syndrid composer",
        keys: [modLabel, "Shift", "A"],
      },
      {
        id: "files",
        label: "Workspace files",
        detail: "Toggle the runtime-backed workspace browser",
        keys: [modLabel, "Shift", "E"],
      },
      {
        id: "source-control",
        label: "Source control",
        detail: "Toggle the selected-session Git surface",
        keys: [modLabel, "Shift", "G"],
      },
      {
        id: "terminal",
        label: "Terminal",
        detail: "Toggle the Syndrid-owned native PTY console",
        keys: [modLabel, "`"],
      },
      {
        id: "settings",
        label: "Desktop settings",
        detail: "Toggle native runtime supervision settings",
        keys: [modLabel, ","],
      },
    ],
    [modLabel],
  );

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      aria-labelledby="keyboard-shortcuts-title"
      aria-modal="true"
      className="keyboard-shortcuts-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section className="keyboard-shortcuts-panel">
        <header>
          <span>
            <strong id="keyboard-shortcuts-title">Keyboard shortcuts</strong>
            <small>Workbench controls only · runtime behavior stays in SyndridCLI</small>
          </span>
          <button onClick={onClose} ref={closeButtonRef} type="button">
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

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}
