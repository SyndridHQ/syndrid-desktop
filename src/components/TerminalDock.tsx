import { useCallback, useEffect, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import {
  notifications,
  type CommandExecOutputDeltaNotification,
} from "../runtime/protocol";
import "./terminalDock.css";

const LOCAL_ENVIRONMENT_ID = "local";
const MAX_TRANSCRIPT_CHARS = 200_000;
const OUTPUT_CAP_BYTES = 2 * 1024 * 1024;
const INPUT_MAX_CHARS = 4_096;

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
  const decoderRef = useRef(new TextDecoder("utf-8", { fatal: false }));
  const outputRef = useRef<HTMLPreElement>(null);

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

    setStarting(true);
    setError(null);
    setTranscript("");
    try {
      const environment = await appServerClient.readEnvironmentInfo({
        environmentId: LOCAL_ENVIRONMENT_ID,
      });
      const shellPath = environment.shell.path.trim();
      if (!shellPath) throw new Error("Syndrid reported no local shell executable.");

      const workspace = appServerClient.getWorkspaceSnapshot();
      const terminalCwd = workspace?.cwd ?? null;
      const processId = `desktop-terminal-${crypto.randomUUID()}`;
      processIdRef.current = processId;
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
          size: { rows: 26, cols: 100 },
        })
        .then((result) => {
          if (processIdRef.current !== processId) return;
          const tail = decoderRef.current.decode();
          if (tail) appendTranscript(tail);
          if (result.stdout) appendTranscript(result.stdout);
          if (result.stderr) appendTranscript(result.stderr);
          appendTranscript(`\n[process exited ${result.exitCode}]\n`);
          processIdRef.current = null;
          setRunning(false);
          setStopping(false);
        })
        .catch((cause) => {
          if (processIdRef.current !== processId) return;
          processIdRef.current = null;
          setRunning(false);
          setStopping(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    } catch (cause) {
      processIdRef.current = null;
      setRunning(false);
      setError(
        cause instanceof Error
          ? `Local execution environment unavailable: ${cause.message}`
          : `Local execution environment unavailable: ${String(cause)}`,
      );
    } finally {
      setStarting(false);
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
      setOpen(true);
      return;
    }
    if (processIdRef.current) {
      void stop().finally(() => setOpen(false));
    } else {
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
            Runtime-owned PTY · selected-workspace cwd · bounded output · no hidden process after close
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
