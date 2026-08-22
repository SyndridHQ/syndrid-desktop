import {
  type InitializeParams,
  type InitializeResponse,
  type JsonRpcFailure,
  type JsonRpcNotification,
  type JsonRpcResponse,
  type RequestId,
  type ThreadListParams,
  type ThreadListResponse,
  type ThreadReadParams,
  type ThreadReadResponse,
  type ThreadResumeResponse,
  type ThreadStartParams,
  type ThreadStartResponse,
  methods,
} from "./protocol";
import {
  onNativeAppServerMessage,
  onNativeAppServerStderr,
  sendNativeAppServerLine,
  startNativeAppServer,
  stopNativeAppServer,
  type NativeAppServerStatus,
} from "./native";

export type RuntimeNotificationHandler = (notification: JsonRpcNotification) => void;
export type RuntimeLogHandler = (line: string) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: number;
}

export interface RuntimeConnectionSnapshot {
  phase: "idle" | "starting" | "initializing" | "ready" | "error";
  native: NativeAppServerStatus | null;
  server: InitializeResponse | null;
  error: string | null;
}

const INITIALIZE_TIMEOUT_MS = 12_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class SyndridAppServerClient {
  private nextId = 1;
  private pending = new Map<RequestId, PendingRequest>();
  private notificationHandlers = new Set<RuntimeNotificationHandler>();
  private logHandlers = new Set<RuntimeLogHandler>();
  private unlistenMessage: (() => void) | null = null;
  private unlistenStderr: (() => void) | null = null;
  private snapshot: RuntimeConnectionSnapshot = {
    phase: "idle",
    native: null,
    server: null,
    error: null,
  };

  getSnapshot(): RuntimeConnectionSnapshot {
    return this.snapshot;
  }

  async connect(binary?: string): Promise<RuntimeConnectionSnapshot> {
    if (this.snapshot.phase === "ready") return this.snapshot;

    this.snapshot = { ...this.snapshot, phase: "starting", error: null };
    await this.ensureListeners();

    try {
      const native = await startNativeAppServer(binary);
      this.snapshot = { ...this.snapshot, phase: "initializing", native };

      const params: InitializeParams = {
        clientInfo: {
          name: "syndrid_desktop",
          title: "Syndrid Desktop",
          version: "0.1.0",
        },
        capabilities: null,
      };

      const server = await this.request<InitializeResponse>(
        methods.initialize,
        params,
        INITIALIZE_TIMEOUT_MS,
      );
      await this.notify({ method: "initialized" });

      this.snapshot = {
        phase: "ready",
        native,
        server,
        error: null,
      };
      return this.snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = { ...this.snapshot, phase: "error", error: message };
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("Syndrid app-server disconnected."));
    }
    this.pending.clear();
    await stopNativeAppServer();
    this.snapshot = { phase: "idle", native: null, server: null, error: null };
  }

  async listThreads(params: ThreadListParams = {}): Promise<ThreadListResponse> {
    return this.request<ThreadListResponse>(methods.threadList, params);
  }

  async startThread(params: ThreadStartParams = {}): Promise<ThreadStartResponse> {
    return this.request<ThreadStartResponse>(methods.threadStart, params);
  }

  async readThread(params: ThreadReadParams): Promise<ThreadReadResponse> {
    return this.request<ThreadReadResponse>(methods.threadRead, params);
  }

  async resumeThread(threadId: string): Promise<ThreadResumeResponse> {
    return this.request<ThreadResumeResponse>(methods.threadResume, { threadId });
  }

  onNotification(handler: RuntimeNotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onLog(handler: RuntimeLogHandler): () => void {
    this.logHandlers.add(handler);
    return () => this.logHandlers.delete(handler);
  }

  private async ensureListeners(): Promise<void> {
    if (!this.unlistenMessage) {
      this.unlistenMessage = await onNativeAppServerMessage((line) => this.handleLine(line));
    }
    if (!this.unlistenStderr) {
      this.unlistenStderr = await onNativeAppServerStderr((line) => {
        for (const handler of this.logHandlers) handler(line);
      });
    }
  }

  private async request<TResult>(
    method: string,
    params: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<TResult> {
    const id = this.nextId++;
    const payload = { method, id, params };

    const response = new Promise<TResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeout,
      });
    });

    try {
      await sendNativeAppServerLine(JSON.stringify(payload));
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pending.delete(id);
      }
      throw error;
    }

    return response;
  }

  private async notify(notification: JsonRpcNotification): Promise<void> {
    await sendNativeAppServerLine(JSON.stringify(notification));
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      for (const handler of this.logHandlers) handler(`unparsed stdout: ${line}`);
      return;
    }

    if (!isRecord(message)) return;

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;

      window.clearTimeout(pending.timeout);
      this.pending.delete(message.id);

      const response = message as unknown as JsonRpcResponse;
      if ("error" in response) {
        pending.reject(toRpcError(response));
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      const notification = message as unknown as JsonRpcNotification;
      for (const handler of this.notificationHandlers) handler(notification);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRpcError(response: JsonRpcFailure): Error {
  const error = new Error(`${response.error.message} (${response.error.code})`);
  error.name = "SyndridRpcError";
  return error;
}

export const appServerClient = new SyndridAppServerClient();
