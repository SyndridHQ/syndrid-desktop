import { isTauri } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ConversationTimeline } from "./components/ConversationTimeline";
import { RuntimeNotificationCount } from "./components/RuntimeNotificationCount";
import {
  appServerClient,
  type RuntimeConnectionSnapshot,
} from "./runtime/appServerClient";
import { conversationStore } from "./runtime/conversationStore";
import {
  PROTOCOL_SOURCE_SHORT_SHA,
  notifications,
  type AgentMessageDeltaNotification,
  type JsonRpcNotification,
  type ModelProviderCapabilities,
  type ModelSummary,
  type ThreadSummary,
  type TurnLifecycleNotification,
} from "./runtime/protocol";
import { runtimeMetricsStore } from "./runtime/runtimeMetricsStore";

interface AppProps {
  bootStartedAt: number;
}

const initialRuntime: RuntimeConnectionSnapshot = {
  phase: "idle",
  native: null,
  server: null,
  error: null,
};

export function App({ bootStartedAt }: AppProps) {
  const [runtime, setRuntime] = useState(initialRuntime);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [providerCapabilities, setProviderCapabilities] =
    useState<ModelProviderCapabilities | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);
  const [shellReadyMs, setShellReadyMs] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<ThreadSummary | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [creatingThread, setCreatingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sendingTurn, setSendingTurn] = useState(false);
  const [interruptingTurn, setInterruptingTurn] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    const shellFrame = requestAnimationFrame(() =>
      setShellReadyMs(performance.now() - bootStartedAt),
    );
    let runtimeFrame: number | null = null;
    let pendingDeltas: AgentMessageDeltaNotification[] = [];

    const flushRuntimeProjection = () => {
      runtimeFrame = null;
      const deltas = pendingDeltas;
      pendingDeltas = [];

      if (deltas.length > 0) {
        conversationStore.applyAgentDeltas(deltas);
      }
    };

    const scheduleRuntimeProjection = () => {
      if (runtimeFrame !== null || document.visibilityState === "hidden") return;
      runtimeFrame = requestAnimationFrame(flushRuntimeProjection);
    };

    const flushBeforeTurnCompletion = (event: TurnLifecycleNotification) => {
      if (runtimeFrame !== null) {
        cancelAnimationFrame(runtimeFrame);
        runtimeFrame = null;
      }
      const deltas = pendingDeltas;
      pendingDeltas = [];

      if (deltas.length > 0) {
        conversationStore.applyAgentDeltas(deltas);
      }
      conversationStore.markTurnComplete(event.threadId, event.turn.id);
    };

    const offNotification = appServerClient.onNotification((notification) => {
      runtimeMetricsStore.addNotifications();
      handleRuntimeNotification(notification, {
        onAgentDelta: (delta) => {
          pendingDeltas.push(delta);
        },
        onTurnStarted: (event) => {
          if (event.threadId === activeThreadIdRef.current) {
            setActiveTurnId(event.turn.id);
          }
        },
        onTurnCompleted: (event) => {
          if (event.threadId === activeThreadIdRef.current) {
            setSendingTurn(false);
            setInterruptingTurn(false);
            setActiveTurnId((current) =>
              current === event.turn.id ? null : current,
            );
            flushBeforeTurnCompletion(event);
          }
        },
      });
      scheduleRuntimeProjection();
    });
    const offLog = appServerClient.onLog((line) => {
      setRuntimeLogs((logs) => [...logs.slice(-39), line]);
    });
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        pendingDeltas.length > 0
      ) {
        scheduleRuntimeProjection();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelAnimationFrame(shellFrame);
      if (runtimeFrame !== null) cancelAnimationFrame(runtimeFrame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      offNotification();
      offLog();
    };
  }, [bootStartedAt]);

  const loadRuntimeCatalogs = useCallback(async () => {
    try {
      const [modelResult, capabilities] = await Promise.all([
        appServerClient.listModels({ limit: 100, includeHidden: false }),
        appServerClient.readModelProviderCapabilities(),
      ]);
      setModels(modelResult.data);
      setProviderCapabilities(capabilities);
    } catch (error) {
      appendRuntimeError(error, setRuntimeLogs);
    }
  }, []);

  const hydrateThread = useCallback(async (threadId: string) => {
    const result = await appServerClient.readThread({
      threadId,
      includeTurns: true,
    });
    setSelectedThread(result.thread);
    conversationStore.mergeThread(result.thread);
    return result.thread;
  }, []);

  const connect = useCallback(async () => {
    setRuntime((current) => ({ ...current, phase: "starting", error: null }));
    try {
      const connected = await appServerClient.connect();
      setRuntime(connected);

      const result = await appServerClient.listThreads({
        limit: 30,
        archived: false,
      });
      setThreads(result.data);

      const firstThread = result.data[0] ?? null;
      if (firstThread) {
        try {
          await hydrateThread(firstThread.id);
        } catch (error) {
          setSelectedThread(firstThread);
          appendRuntimeError(error, setRuntimeLogs);
        }
      } else {
        setSelectedThread(null);
      }
    } catch (error) {
      setRuntime(appServerClient.getSnapshot());
      appendRuntimeError(error, setRuntimeLogs);
    }
  }, [hydrateThread]);

  const refreshThreads = useCallback(async () => {
    if (runtime.phase !== "ready") return;

    try {
      const result = await appServerClient.listThreads({
        limit: 30,
        archived: false,
      });
      setThreads(result.data);
      setSelectedThread((current) =>
        current
          ? result.data.find((thread) => thread.id === current.id) ??
            result.data[0] ??
            null
          : result.data[0] ?? null,
      );
    } catch (error) {
      appendRuntimeError(error, setRuntimeLogs);
    }
  }, [runtime.phase]);

  const createThread = useCallback(async () => {
    if (runtime.phase !== "ready" || creatingThread) return;

    setCreatingThread(true);
    try {
      const result = await appServerClient.startThread();
      setSelectedThread(result.thread);
      activeThreadIdRef.current = result.thread.id;
      setActiveThreadId(result.thread.id);
      setActiveModel(`${result.modelProvider} / ${result.model}`);
      setThreads((current) => [
        result.thread,
        ...current.filter((thread) => thread.id !== result.thread.id),
      ]);
    } catch (error) {
      appendRuntimeError(error, setRuntimeLogs);
    } finally {
      setCreatingThread(false);
    }
  }, [creatingThread, runtime.phase]);

  const selectThread = useCallback(
    async (thread: ThreadSummary) => {
      setSelectedThread(thread);
      if (activeThreadId !== thread.id) {
        setActiveModel(null);
      }
      if (runtime.phase !== "ready") return;

      try {
        await hydrateThread(thread.id);
      } catch (error) {
        appendRuntimeError(error, setRuntimeLogs);
      }
    },
    [activeThreadId, hydrateThread, runtime.phase],
  );

  const resumeSelectedThread = useCallback(async () => {
    if (runtime.phase !== "ready" || !selectedThread) return;

    try {
      const result = await appServerClient.resumeThread(selectedThread.id);
      setSelectedThread(result.thread);
      activeThreadIdRef.current = result.thread.id;
      setActiveThreadId(result.thread.id);
      setActiveModel(`${result.modelProvider} / ${result.model}`);
      conversationStore.mergeThread(result.thread);
    } catch (error) {
      appendRuntimeError(error, setRuntimeLogs);
    }
  }, [runtime.phase, selectedThread]);

  const sendTurn = useCallback(async () => {
    const text = draft.trim();
    if (
      runtime.phase !== "ready" ||
      !selectedThread ||
      activeThreadId !== selectedThread.id ||
      !text ||
      sendingTurn
    ) {
      return;
    }

    const clientMessageId = `desktop-${Date.now()}`;
    setSendingTurn(true);
    setDraft("");
    conversationStore.addUserMessage({
      id: clientMessageId,
      threadId: selectedThread.id,
      turnId: null,
      role: "user",
      text,
      streaming: false,
    });

    try {
      const result = await appServerClient.startTurn({
        threadId: selectedThread.id,
        clientUserMessageId: clientMessageId,
        input: [{ type: "text", text, text_elements: [] }],
      });
      setActiveTurnId(result.turn.id);
    } catch (error) {
      setSendingTurn(false);
      setActiveTurnId(null);
      appendRuntimeError(error, setRuntimeLogs);
    }
  }, [activeThreadId, draft, runtime.phase, selectedThread, sendingTurn]);

  const stopTurn = useCallback(async () => {
    if (!selectedThread || !activeTurnId || interruptingTurn) return;

    setInterruptingTurn(true);
    try {
      await appServerClient.interruptTurn({
        threadId: selectedThread.id,
        turnId: activeTurnId,
      });
    } catch (error) {
      setInterruptingTurn(false);
      appendRuntimeError(error, setRuntimeLogs);
    }
  }, [activeTurnId, interruptingTurn, selectedThread]);

  const canSend = Boolean(
    runtime.phase === "ready" &&
      selectedThread &&
      activeThreadId === selectedThread.id &&
      draft.trim() &&
      !sendingTurn,
  );

  const runtimeLabel = useMemo(() => {
    if (runtime.phase === "ready") return "Connected";
    if (runtime.phase === "starting" || runtime.phase === "initializing") {
      return "Connecting";
    }
    if (runtime.phase === "error") return "Needs attention";
    return "Offline";
  }, [runtime.phase]);

  const composerHint = !selectedThread
    ? "Create or select a session to begin."
    : activeThreadId !== selectedThread.id
      ? "Resume this session before sending a message."
      : sendingTurn
        ? interruptingTurn
          ? "Stopping the active Syndrid turn…"
          : `Syndrid is working${activeTurnId ? ` · ${activeTurnId.slice(0, 8)}` : ""}`
        : "Ask Syndrid about this workspace…";

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand-lockup">
          <span className="brand-mark">S</span>
          <span className="brand-name">Syndrid</span>
          <span className="product-tag">Desktop</span>
        </div>
        <div className="titlebar-center">Agentic engineering workbench</div>
        <button
          className={`runtime-pill runtime-${runtime.phase}`}
          onClick={connect}
          type="button"
        >
          <span className="status-dot" />
          {runtimeLabel}
        </button>
      </header>

      <aside className="activity-rail" aria-label="Primary navigation">
        {[
          ["⌂", "Workspace"],
          ["⌘", "Agent"],
          ["◇", "Changes"],
          ["⑂", "Git"],
          ["⬡", "Extensions"],
          ["⚙", "Settings"],
        ].map(([icon, label], index) => (
          <button
            className={`rail-button ${index === 1 ? "active" : ""}`}
            key={label}
            title={label}
            type="button"
          >
            <span aria-hidden="true">{icon}</span>
            <span className="sr-only">{label}</span>
          </button>
        ))}
      </aside>

      <aside className="left-panel panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2>Sessions</h2>
          </div>
          <span>
            <button
              className="icon-button"
              disabled={runtime.phase !== "ready" || creatingThread}
              onClick={() => void createThread()}
              title="New session"
              type="button"
            >
              {creatingThread ? "…" : "+"}
            </button>
            <button
              className="icon-button"
              onClick={() => void refreshThreads()}
              title="Refresh sessions"
              type="button"
            >
              ↻
            </button>
          </span>
        </div>

        {runtime.phase !== "ready" ? (
          <div className="empty-state compact">
            <span className="empty-icon">◎</span>
            <strong>Runtime not connected</strong>
            <p>Connect to the local Syndrid app-server to load real sessions.</p>
            <button className="primary-button" onClick={connect} type="button">
              Connect runtime
            </button>
          </div>
        ) : threads.length === 0 ? (
          <div className="empty-state compact">
            <span className="empty-icon">◌</span>
            <strong>No active sessions</strong>
            <p>The runtime is connected. Start a real Syndrid thread to begin.</p>
            <button
              className="primary-button"
              disabled={creatingThread}
              onClick={() => void createThread()}
              type="button"
            >
              {creatingThread ? "Starting…" : "New session"}
            </button>
          </div>
        ) : (
          <div className="session-list">
            {threads.map((thread) => (
              <button
                className={`session-card ${selectedThread?.id === thread.id ? "selected" : ""}`}
                key={thread.id}
                onClick={() => void selectThread(thread)}
                type="button"
              >
                <span className="session-status" />
                <span className="session-copy">
                  <strong>{thread.name || thread.preview || "Untitled session"}</strong>
                  <small>{thread.cwd || thread.modelProvider || thread.id}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="workspace panel">
        <div className="workspace-toolbar">
          <div className="tab active-tab">
            <span className="tab-dot" /> Agent Workspace
          </div>
          <div className="toolbar-spacer" />
          <button className="ghost-button" type="button">
            Code mode
          </button>
          <button className="ghost-button" type="button">
            ⌘ K
          </button>
        </div>

        <div className="conversation">
          <section className="hero-card">
            <span className="eyebrow">Syndrid runtime</span>
            <h1>One runtime. A better control surface.</h1>
            <p>
              The desktop does not contain a second agent harness. It connects
              to the authoritative Syndrid app-server, renders real runtime
              state, and keeps native OS responsibilities isolated in Tauri.
            </p>
            <div className="hero-actions">
              <button className="primary-button" onClick={connect} type="button">
                {runtime.phase === "ready" ? "Runtime connected" : "Connect Syndrid"}
              </button>
              <span className="secondary-copy">
                {isTauri()
                  ? "Native desktop runtime"
                  : "Browser preview — native supervision disabled"}
              </span>
            </div>
          </section>

          {selectedThread ? (
            <section className="thread-preview">
              <div className="thread-header">
                <span className="eyebrow">Selected session</span>
                <span className="live-badge">LIVE DATA</span>
              </div>
              <h3>
                {selectedThread.name ||
                  selectedThread.preview ||
                  "Untitled session"}
              </h3>
              <p>{selectedThread.cwd || "No working directory reported"}</p>
              <div className="thread-actions">
                <span>{activeModel ?? selectedThread.modelProvider}</span>
                {activeThreadId === selectedThread.id ? (
                  <span className="healthy">Active runtime session</span>
                ) : (
                  <button
                    className="ghost-button"
                    onClick={() => void resumeSelectedThread()}
                    type="button"
                  >
                    Resume session
                  </button>
                )}
              </div>
            </section>
          ) : (
            <section className="working-card">
              <div className="working-line complete">
                <span>✓</span>
                <div>
                  <strong>Desktop shell</strong>
                  <small>Tauri + React foundation</small>
                </div>
              </div>
              <div className="working-line active">
                <span>●</span>
                <div>
                  <strong>Runtime bridge</strong>
                  <small>stdio JSONL app-server supervision</small>
                </div>
              </div>
              <div className="working-line">
                <span>○</span>
                <div>
                  <strong>Agent workspace</strong>
                  <small>Create a real session to begin</small>
                </div>
              </div>
            </section>
          )}

          <ConversationTimeline threadId={selectedThread?.id ?? null} />
        </div>

        <form
          className="composer-shell"
          onSubmit={(event) => {
            event.preventDefault();
            void sendTurn();
          }}
        >
          <textarea
            className="composer-input"
            disabled={
              runtime.phase !== "ready" ||
              !selectedThread ||
              activeThreadId !== selectedThread.id ||
              sendingTurn
            }
            onChange={(event) => setDraft(event.target.value)}
            placeholder={composerHint}
            rows={3}
            value={draft}
          />
          <div className="composer-meta">
            <span>Adaptive routing</span>
            <span>Ask first</span>
            <span className="composer-hint">{composerHint}</span>
            {sendingTurn ? (
              <button
                className="stop-button"
                disabled={!activeTurnId || interruptingTurn}
                onClick={() => void stopTurn()}
                type="button"
              >
                {interruptingTurn ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button disabled={!canSend} type="submit">
                Send
              </button>
            )}
          </div>
        </form>
      </section>

      <aside className="right-panel panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Control plane</span>
            <h2>Runtime</h2>
          </div>
        </div>
        <dl className="diagnostic-grid">
          <div><dt>Status</dt><dd>{runtimeLabel}</dd></div>
          <div><dt>Transport</dt><dd>stdio · JSONL</dd></div>
          <div>
            <dt>Process</dt>
            <dd>
              {runtime.native?.state === "running"
                ? `${runtime.native.binary} · ${runtime.native.pid}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>
              {runtime.server
                ? `${runtime.server.platformOs} / ${runtime.server.platformFamily}`
                : "—"}
            </dd>
          </div>
          <div><dt>Sessions</dt><dd>{threads.length}</dd></div>
          <div><dt>Models</dt><dd>{models.length || "—"}</dd></div>
          <div><dt>Notifications</dt><dd><RuntimeNotificationCount /></dd></div>
          <div><dt>Active turn</dt><dd>{activeTurnId ? activeTurnId.slice(0, 8) : "—"}</dd></div>
          <div>
            <dt>Shell first frame</dt>
            <dd>
              {shellReadyMs === null
                ? "measuring…"
                : `${shellReadyMs.toFixed(1)} ms`}
            </dd>
          </div>
        </dl>

        <section className="mini-section">
          <div className="mini-heading">
            <span>Model catalog</span>
            <button
              className="mini-action"
              disabled={runtime.phase !== "ready"}
              onClick={() => void loadRuntimeCatalogs()}
              type="button"
            >
              Refresh
            </button>
          </div>
          <div className="model-list">
            {models.length === 0 ? (
              <span className="muted">No model catalog loaded.</span>
            ) : (
              models.slice(0, 6).map((model) => (
                <div className="model-row" key={model.id}>
                  <span>
                    <strong>{model.displayName}</strong>
                    <small>{model.model}</small>
                  </span>
                  {model.isDefault && <em>Default</em>}
                </div>
              ))
            )}
          </div>
          {providerCapabilities && (
            <div className="capability-row">
              <span className={providerCapabilities.namespaceTools ? "enabled" : "disabled"}>Tools</span>
              <span className={providerCapabilities.webSearch ? "enabled" : "disabled"}>Web</span>
              <span className={providerCapabilities.imageGeneration ? "enabled" : "disabled"}>Images</span>
            </div>
          )}
        </section>

        <section className="mini-section">
          <div className="mini-heading">
            <span>Architecture</span>
            <span className="healthy">authoritative</span>
          </div>
          <div className="architecture-stack">
            <span>Syndrid Desktop</span><i>↓</i><span>App-server protocol</span><i>↓</i><span>SyndridCLI runtime</span>
          </div>
        </section>

        <section className="mini-section log-section">
          <div className="mini-heading">
            <span>Runtime log</span>
            <span>{runtimeLogs.length}</span>
          </div>
          <div className="runtime-log">
            {runtimeLogs.length === 0 ? (
              <span className="muted">No stderr output.</span>
            ) : (
              runtimeLogs.slice(-8).map((line, index) => (
                <code key={`${index}-${line}`}>{line}</code>
              ))
            )}
          </div>
        </section>
      </aside>

      <footer className="statusbar">
        <span>main</span>
        <span>0 problems</span>
        <span className="status-spacer" />
        <span>Protocol source: syndridcli@{PROTOCOL_SOURCE_SHORT_SHA}</span>
      </footer>
    </main>
  );
}

interface RuntimeNotificationCallbacks {
  onAgentDelta: (notification: AgentMessageDeltaNotification) => void;
  onTurnStarted: (notification: TurnLifecycleNotification) => void;
  onTurnCompleted: (notification: TurnLifecycleNotification) => void;
}

function handleRuntimeNotification(
  notification: JsonRpcNotification,
  callbacks: RuntimeNotificationCallbacks,
): void {
  if (
    notification.method === notifications.agentMessageDelta &&
    isAgentMessageDelta(notification.params)
  ) {
    callbacks.onAgentDelta(notification.params);
    return;
  }

  if (
    notification.method === notifications.turnStarted &&
    isTurnLifecycle(notification.params)
  ) {
    callbacks.onTurnStarted(notification.params);
    return;
  }

  if (
    notification.method === notifications.turnCompleted &&
    isTurnLifecycle(notification.params)
  ) {
    callbacks.onTurnCompleted(notification.params);
  }
}

function isAgentMessageDelta(value: unknown): value is AgentMessageDeltaNotification {
  return (
    isRecord(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    typeof value.itemId === "string" &&
    typeof value.delta === "string"
  );
}

function isTurnLifecycle(value: unknown): value is TurnLifecycleNotification {
  return (
    isRecord(value) &&
    typeof value.threadId === "string" &&
    isRecord(value.turn) &&
    typeof value.turn.id === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function appendRuntimeError(
  error: unknown,
  setter: Dispatch<SetStateAction<string[]>>,
): void {
  const message = error instanceof Error ? error.message : String(error);
  setter((logs) => [...logs.slice(-39), message]);
}
