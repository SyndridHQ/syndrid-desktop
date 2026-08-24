import { useEffect, useMemo, useRef, useState } from "react";
import "./commandPalette.css";

type Command = {
  id: string;
  label: string;
  detail: string;
  keywords: string;
  run: () => void;
};

const commands: Command[] = [
  {
    id: "focus-composer",
    label: "Focus agent composer",
    detail: "Jump to the selected session prompt",
    keywords: "agent prompt chat message composer",
    run: () => focusElement<HTMLTextAreaElement>(".composer-input"),
  },
  {
    id: "new-session",
    label: "New session",
    detail: "Use the existing runtime-backed session action",
    keywords: "thread create start new session",
    run: () => clickElement('button[title="New session"]'),
  },
  {
    id: "refresh-sessions",
    label: "Refresh sessions",
    detail: "Reload session summaries from Syndrid",
    keywords: "thread reload refresh sessions",
    run: () => clickElement('button[title="Refresh sessions"]'),
  },
  {
    id: "connect-runtime",
    label: "Connect runtime",
    detail: "Start or reconnect the local Syndrid app-server",
    keywords: "connect reconnect runtime app server",
    run: () => clickElement(".runtime-pill"),
  },
  {
    id: "files",
    label: "Open workspace files",
    detail: "Open the lazy runtime-backed file browser",
    keywords: "files workspace browser search preview",
    run: () => clickElement(".workspace-files-toggle"),
  },
  {
    id: "terminal",
    label: "Open terminal",
    detail: "Open the runtime-backed native PTY console",
    keywords: "terminal shell pty command powershell zsh bash",
    run: () => clickElement(".terminal-toggle"),
  },
  {
    id: "processes",
    label: "Open background processes",
    detail: "Inspect and terminate Syndrid-owned background terminals",
    keywords: "processes background terminals pid cpu memory rss long running",
    run: () => clickElement(".background-processes-toggle"),
  },
  {
    id: "thread-graph",
    label: "Open thread graph",
    detail: "Inspect direct subagents and forks around the selected runtime session",
    keywords: "subagents agents children orchestration delegation thread graph forks branching",
    run: () => clickElement(".subagents-toggle"),
  },
  {
    id: "plan",
    label: "Open agent plan",
    detail: "Inspect the latest plan published by the selected Syndrid turn",
    keywords: "plan steps progress pending completed agent execution",
    run: () => clickElement(".plan-toggle"),
  },
  {
    id: "objective",
    label: "Open session objective",
    detail: "Inspect or edit the selected thread goal owned by Syndrid",
    keywords: "objective goal status token budget runtime session thread",
    run: () => clickElement(".goal-toggle"),
  },
  {
    id: "context",
    label: "Open context usage",
    detail: "Inspect runtime token usage, context window, and compaction activity",
    keywords: "context tokens usage window compaction compact memory",
    run: () => clickElement(".context-toggle"),
  },
  {
    id: "git",
    label: "Open source control",
    detail: "Inspect Git metadata reported by the selected Syndrid session",
    keywords: "git source control branch commit origin repository",
    run: () => clickElement(".git-toggle"),
  },
  {
    id: "review",
    label: "Open code review",
    detail: "Launch a detached Syndrid review of uncommitted changes",
    keywords: "review code review uncommitted changes detached runtime",
    run: () => clickElement(".review-toggle"),
  },
  {
    id: "providers",
    label: "Open providers",
    detail: "Inspect the selected session provider and runtime model catalog",
    keywords: "providers models catalog capabilities routing",
    run: () => clickElement(".provider-toggle"),
  },
  {
    id: "model-catalog",
    label: "Browse runtime models",
    detail: "Explore the runtime-discovered model catalog with explicit pagination",
    keywords: "providers models catalog browse pagination dynamic runtime",
    run: () => window.dispatchEvent(new Event("syndrid:open-model-catalog")),
  },
  {
    id: "permissions",
    label: "Open permissions",
    detail: "Inspect runtime approval and sandbox policy without changing execution semantics",
    keywords: "permissions approval policy sandbox security network writable roots profile",
    run: () => clickElement(".permissions-toggle"),
  },
  {
    id: "skills",
    label: "Open skills",
    detail: "Open the selected-workspace skills inventory",
    keywords: "skills extensions",
    run: () => clickElement(".skills-toggle"),
  },
  {
    id: "hooks",
    label: "Open hook activity",
    detail: "Inspect hook lifecycle streamed by the Syndrid runtime",
    keywords: "hooks lifecycle pre tool post tool permission subagent runtime",
    run: () => clickElement(".hooks-toggle"),
  },
  {
    id: "mcp",
    label: "Open MCP servers",
    detail: "Inspect runtime MCP tools and authentication state",
    keywords: "mcp servers tools oauth extensions",
    run: () => clickElement(".mcp-server-toggle"),
  },
  {
    id: "settings",
    label: "Open desktop settings",
    detail: "Configure native Syndrid runtime supervision preferences",
    keywords: "settings preferences runtime binary path executable supervision",
    run: () => clickElement(".settings-toggle"),
  },
  {
    id: "shortcuts",
    label: "Show keyboard shortcuts",
    detail: "View native workbench shortcuts for Windows and macOS",
    keywords: "keyboard shortcuts hotkeys keybindings windows macos command control",
    run: () => window.dispatchEvent(new Event("syndrid:open-shortcuts")),
  },
  {
    id: "diagnostics",
    label: "Open runtime diagnostics",
    detail: "Inspect the on-demand app-server, platform, shell, workspace, and protocol snapshot",
    keywords: "diagnostics health runtime environment platform shell pid protocol troubleshooting",
    run: () => clickElement(".diagnostics-toggle"),
  },
  {
    id: "warnings",
    label: "Open runtime warnings",
    detail: "Inspect bounded runtime errors, safety warnings, config notices, and deprecations",
    keywords: "warnings errors guardian safety config deprecation diagnostics runtime",
    run: () => clickElement(".warnings-toggle"),
  },
  {
    id: "activity",
    label: "Open runtime activity",
    detail: "Inspect streamed commands, tools, changes, and subagents",
    keywords: "activity commands tools changes subagents diagnostics",
    run: () => clickElement(".runtime-activity-toggle"),
  },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.detail} ${command.keywords}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const toolbarButton = document.querySelector<HTMLButtonElement>(
      ".workspace-toolbar .ghost-button:last-child",
    );
    if (!toolbarButton || toolbarButton.textContent?.trim() !== "⌘ K") return;
    const onClick = () => setOpen(true);
    toolbarButton.addEventListener("click", onClick);
    return () => toolbarButton.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (activeIndex !== 0) setActiveIndex(0);
    } else if (activeIndex >= filtered.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, filtered.length]);

  const execute = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  };

  if (!open) return null;

  return (
    <div
      aria-label="Command palette"
      aria-modal="true"
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      role="dialog"
    >
      <section className="command-palette">
        <div className="command-palette-search">
          <span aria-hidden="true">⌘</span>
          <input
            aria-label="Search commands"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && filtered.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp" && filtered.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                execute(filtered[activeIndex]);
              }
            }}
            placeholder="Search Syndrid commands…"
            ref={inputRef}
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-results" role="listbox">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">No matching commands</div>
          ) : (
            filtered.map((command, index) => (
              <button
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : ""}
                key={command.id}
                onClick={() => execute(command)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                type="button"
              >
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.detail}</small>
                </span>
                {index === activeIndex && <kbd>↵</kbd>}
              </button>
            ))
          )}
        </div>
        <footer>↑↓ navigate · ↵ run · Ctrl/⌘ K toggle</footer>
      </section>
    </div>
  );
}

function clickElement(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element && !element.hasAttribute("disabled")) element.click();
}

function focusElement<T extends HTMLElement>(selector: string): void {
  const element = document.querySelector<T>(selector);
  if (element && !element.hasAttribute("disabled")) element.focus();
}
