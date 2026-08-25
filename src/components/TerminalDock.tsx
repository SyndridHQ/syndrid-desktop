import { useCallback, useEffect, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import {
  notifications,
  type CommandExecOutputDeltaNotification,
  type CommandExecTerminalSize,
} from "../runtime/protocol";
import "./terminalDock.css";

const LOCAL_ENVIRONMENT_ID = "local";
const MAX_TRANSCRIPT_CHARS = 200_000;
const OUTPUT_CAP_BYTES = 2 * 1024 * 1024;
const INPUT_MAX_CHARS = 4_096;
const DEFAULT_TERMINAL_SIZE: CommandExecTerminalSize = { rows: 26, cols: 100 };
const RESIZE_DEBOUNCE_MS = 120;
const MIN_TERMINAL_ROWS = 4;
const MAX_TERMINAL_ROWS = 200;
const MIN_TERMINAL_COLS = 20;
const MAX_TERMINAL_COLS = 400;

export function TerminalDock() {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [shellLabel, setShellLabel] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const processIdRef = useRef<string | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const decoderRef = useRef(new TextDecoder("utf-8", { fatal: false }));
  const outputRef = useRef<HTMLPreElement>(null);
  const lastTerminalSizeRef = useRef<CommandExecTerminalSize | null>(null);

  const appendTranscript = useCallback((text: string) => {
    if (!text) return;
    setTranscript((current) => {
      const next = current + sanitizeTerminalText(text);
      return next.length > MAX_TRANSCRIPT_CHARS
        ? `… older terminal output trimmed …\n${next.slice(-MAX_TRANSCRIPT_CHARS)}`
        : next;
    });
  }, []);

  useEffect(() => {
    return appServerClient.onNotification((notification) => {
      if (notification.method !== notifications.commandExecOutputDelta) return;
      if (!isCommandExecOutputDelta(notification.params)) return;
      if (notification.params.processId !== processIdRef.current) return;

      try {
        const bytes = decodeBase64(notification.params.deltaBase64);
        appendTranscript(decoderRef.current.decode(bytes, { stream: true }));
        if (notification.params.capReached) {
          appendTranscript("\n[terminal output cap reached]\n");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }, [appendTranscript]);

  useEffect(() => {
    if (!open) return;
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [open, transcript]);

  useEffect(() => {
    const element = outputRef.current;
    if (!open || !running || !element || !processIdRef.current) return;

    let resizeTimer: number | null = null;
    let disposed = false;

    const syncSize = () => {
      const processId = processIdRef.current;
      if (!processId || disposed) return;
      const size = measureTerminalSize(element);
      const previous = lastTerminalSizeRef.current;
      if (previous?.rows === size.rows && previous.cols === size.cols) return;
      lastTerminalSizeRef.current = size;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (disposed || processIdRef.current !== processId) return;
        void appServerClient.resizeCommand({ processId, size }).catch((cause) => {
          if (!disposed && processIdRef.current === processId) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
      }, RESIZE_DEBOUNCE_MS);
    };

    const observer = new ResizeObserver(syncSize);
    observer.observe(element);
    syncSize();

    return () => {
      disposed = true;
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    };
  }, [open, running]);

  const stop = useCallback(async () => {
    const processId = processIdRef.current;
    if (!processId || stopping) return;

    setStopping(true);
    setError(null);
    try {
      await appServerClient.terminateCommand({ processId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStopping(false);
    }
  }, [stopping]);

  const start = useCallback(async () => {
    if (starting || running) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before starting a terminal.");
      return;
    }

    const startGeneration = lifecycleGenerationRef.current;
    setStarting(true);
    setError(null);
    setTranscript("");
    try {
      const environment = await appServerClient.readEnvironmentInfo({
        environmentId: LOCAL_ENVIRONMENT_ID,
      });
      if (startGeneration !== lifecycleGenerationRef.current) return;

      const shellPath = environment.shell.path.trim();
      if (!shellPath) throw new Error("Syndrid reported no local shell executable.");

      const workspace = appServerClient.getWorkspaceSnapshot();
      const terminalCwd = workspace?.cwd ?? null;
      const processId = `desktop-terminal-${crypto.randomUUID()}`;
      const initialSize = outputRef.current
        ? measureTerminalSize(outputRef.current)
        : DEFAULT_TERMINAL_SIZE;
      processIdRef.current = processId;
      lastTerminalSizeRef.current = initialSize;
      decoderRef.current = new TextDecoder("utf-8", { fatal: false });
      setShellLabel(`${environment.shell.name} · ${shellPath}`);
      setCwd(terminalCwd ?? environment.cwd);
      setRunning(true);
      appendTranscript(`[Syndrid PTY · ${environment.shell.name}]\n`);

      void appServerClient
        .execCommand({
          command: [shellPath],
          processId,
          tty: true,
          streamStdin: true,
          streamStdoutStderr: true,
          outputBytesCap: OUTPUT_CAP_BYTES,
          disableTimeout: true,
          cwd: terminalCwd,
          size: initialSize,
        })
        .then((result) => {
          if (processIdRef.current !== processId) return;
          const tail = decoderRef.current.decode();
          if (tail) appendTranscript(tail);
          if (result.stdout) appendTranscript(result.stdout);
          if (result.stderr) appendTranscript(result.stderr);
          appendTranscript(`\n[process exited ${result.exitCode}]\n`);
          processIdRef.current = null;
          lastTerminalSizeRef.current = null;
          setRunning(false);
          setStopping(false);
        })
        .catch((cause) => {
          if (processIdRef.current !== processId) return;
          processIdRef.current = null;
          lastTerminalSizeRef.current = null;
          setRunning(false);
          setStopping(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    } catch (cause) {
      if (startGeneration !== lifecycleGenerationRef.current) return;
      processIdRef.current = null;
      lastTerminalSizeRef.current = null;
      setRunning(false);
      setError(
        cause instanceof Error
          ? `Local execution environment unavailable: ${cause.message}`
          : `Local execution environment unavailable: ${String(cause)}`,
      );
    } finally {
      if (startGeneration === lifecycleGenerationRef.current) setStarting(false);
    }
  }, [appendTranscript, running, starting]);

  const send = useCallback(async () => {
    const processId = processIdRef.current;
    const value = input;
    if (!processId || !running || !value) return;

    setInput("");
    setError(null);
    try {
      await appServerClient.writeCommand({
        processId,
        deltaBase64: encodeBase64(`${value}\r`),
        closeStdin: false,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [input, running]);

  const toggle = () => {
    if (!open) {
      lifecycleGenerationRef.current += 1;
      setOpen(true);
      return;
    }

    lifecycleGenerationRef.current += 1;
    if (processIdRef.current) {
      void stop().finally(() => setOpen(false));
    } else {
      setStarting(false);
      setOpen(false);
    }
  };

  return (
    <aside className="terminal-dock" aria-label="Terminal">
      <button className="terminal-toggle" onClick={toggle} type="button">
        <span aria-hidden="true">›_</span>
        Terminal
        {running && <span className="terminal-live">Live</span>}
      </button>
      {open && (
        <section className="terminal-panel">
          <header>
            <span>
              <strong>Runtime terminal</strong>
              <small title={cwd ?? undefined}>
                {shellLabel ?? "Syndrid local execution environment"}
                {cwd ? ` · ${cwd}` : ""}
              </small>
            </span>
            <div>
              {!running && (
                <button disabled={starting} onClick={() => void start()} type="button">
                  {starting ? "Starting…" : "Start"}
                </button>
              )}
              {running && (
                <button disabled={stopping} onClick={() => void stop()} type="button">
                  {stopping ? "Stopping…" : "Stop"}
                </button>
              )}
              <button onClick={toggle} type="button">Close</button>
            </div>
          </header>

          <pre className="terminal-output" ref={outputRef} tabIndex={0}>
            {transcript || "Terminal is dormant. Start it to open the runtime-reported native shell."}
          </pre>

          <form
            className="terminal-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <span aria-hidden="true">›</span>
            <input
              aria-label="Terminal input"
              autoComplete="off"
              disabled={!running || stopping}
              maxLength={INPUT_MAX_CHARS}
              onChange={(event) => setInput(event.target.value)}
              placeholder={running ? "Type a command…" : "Start terminal to send input"}
              spellCheck={false}
              value={input}
            />
            <button disabled={!running || stopping || !input} type="submit">Send</button>
          </form>

          {error && <div className="terminal-error">{error}</div>}
          <footer>
            Runtime-owned PTY · selected-workspace cwd · bounded output · panel-sized terminal · no hidden process after close
          </footer>
        </section>
      )}
    </aside>
  );
}

function isCommandExecOutputDelta(value: unknown): value is CommandExecOutputDeltaNotification {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.processId === "string" &&
    (record.stream === "stdout" || record.stream === "stderr") &&
    typeof record.deltaBase64 === "string" &&
    typeof record.capReached === "boolean"
  );
}

function measureTerminalSize(element: HTMLElement): CommandExecTerminalSize {
  const style = window.getComputedStyle(element);
  const fontSize = parseCssPixels(style.fontSize, 12);
  const lineHeight = parseCssPixels(style.lineHeight, fontSize * 1.4);
  const horizontalPadding =
    parseCssPixels(style.paddingLeft, 0) + parseCssPixels(style.paddingRight, 0);
  const verticalPadding =
    parseCssPixels(style.paddingTop, 0) + parseCssPixels(style.paddingBottom, 0);
  const availableWidth = Math.max(0, element.clientWidth - horizontalPadding);
  const availableHeight = Math.max(0, element.clientHeight - verticalPadding);
  const cellWidth = measureMonospaceCellWidth(style.font, fontSize);
  return {
    rows: clampInteger(
      Math.floor(availableHeight / Math.max(lineHeight, 1)),
      MIN_TERMINAL_ROWS,
      MAX_TERMINAL_ROWS,
    ),
    cols: clampInteger(
      Math.floor(availableWidth / Math.max(cellWidth, 1)),
      MIN_TERMINAL_COLS,
      MAX_TERMINAL_COLS,
    ),
  };
}

function measureMonospaceCellWidth(font: string, fallbackFontSize: number): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return fallbackFontSize * 0.62;
  context.font = font;
  const width = context.measureText("M").width;
  return Number.isFinite(width) && width > 0 ? width : fallbackFontSize * 0.62;
}

function parseCssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.floor(value) : min));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r(?!\n)/g, "\n");
}
