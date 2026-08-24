import {
  type CommandExecParams,
  type CommandExecResizeParams,
  type CommandExecResizeResponse,
  type CommandExecResponse,
  type CommandExecTerminateParams,
  type CommandExecTerminateResponse,
  type CommandExecWriteParams,
  type CommandExecWriteResponse,
  type ConfigReadParams,
  type ConfigReadResponse,
  type EnvironmentInfoParams,
  type EnvironmentInfoResponse,
  type FsGetMetadataParams,
  type FsGetMetadataResponse,
  type FsReadDirectoryParams,
  type FsReadDirectoryResponse,
  type FsReadFileParams,
  type FsReadFileResponse,
  type FsWriteFileParams,
  type FsWriteFileResponse,
  type FuzzyFileSearchParams,
  type FuzzyFileSearchResponse,
  type GitDiffToRemoteParams,
  type GitDiffToRemoteResponse,
  type HooksListParams,
  type HooksListResponse,
  type InitializeParams,
  type InitializeResponse,
  type JsonRpcFailure,
  type JsonRpcNotification,
  type JsonRpcResponse,
  type McpServerOauthLoginParams,
  type McpServerOauthLoginResponse,
  type McpServerStatusListParams,
  type McpServerStatusListResponse,
  type ModelListParams,
  type ModelListResponse,
  type ModelProviderCapabilities,
  type RequestId,
  type SkillsListParams,
  type SkillsListResponse,
  type ThreadArchiveParams,
  type ThreadArchiveResponse,
  type ThreadBackgroundTerminalsCleanParams,
  type ThreadBackgroundTerminalsCleanResponse,
  type ThreadBackgroundTerminalsListParams,
  type ThreadBackgroundTerminalsListResponse,
  type ThreadBackgroundTerminalsTerminateParams,
  type ThreadBackgroundTerminalsTerminateResponse,
  type ThreadListParams,
  type ThreadListResponse,
  type ThreadReadParams,
  type ThreadReadResponse,
  type ThreadResumeResponse,
  type ThreadStartParams,
  type ThreadStartResponse,
  type ThreadUnarchiveParams,
  type ThreadUnarchiveResponse,
  type TurnInterruptParams,
  type TurnInterruptResponse,
  type TurnStartParams,
  type TurnStartResponse,
  methods,
} from "./protocol";
import type {
  FsUnwatchParams,
  FsUnwatchResponse,
  FsWatchParams,
  FsWatchResponse,
} from "./fsWatchProtocol";
import type { ReviewStartParams, ReviewStartResponse } from "./reviewProtocol";
import type { ThreadForkParams, ThreadForkResponse } from "./threadForkProtocol";
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
export type RuntimeWorkspaceHandler = () => void;

export interface RuntimeGitSnapshot {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
}

export interface RuntimeWorkspaceSnapshot {
  threadId: string;
  cwd: string;
  git: RuntimeGitSnapshot | null;
}

export interface RuntimeServerRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export type RuntimeServerRequestHandler = (request: RuntimeServerRequest) => boolean;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: number | null;
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
  private serverRequestHandlers = new Set<RuntimeServerRequestHandler>();
  private logHandlers = new Set<RuntimeLogHandler>();
  private workspaceHandlers = new Set<RuntimeWorkspaceHandler>();
  private unlistenMessage: (() => void) | null = null;
  private unlistenStderr: (() => void) | null = null;
  private workspaceSnapshot: RuntimeWorkspaceSnapshot | null = null;
  private snapshot: RuntimeConnectionSnapshot = {
    phase: "idle",
    native: null,
    server: null,
    error: null,
  };

  getSnapshot(): RuntimeConnectionSnapshot {
    return this.snapshot;
  }

  getWorkspaceSnapshot(): RuntimeWorkspaceSnapshot | null {
    return this.workspaceSnapshot;
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
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
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
      if (pending.timeout !== null) window.clearTimeout(pending.timeout);
      pending.reject(new Error("Syndrid app-server disconnected."));
    }
    this.pending.clear();
    await stopNativeAppServer();
    this.snapshot = { phase: "idle", native: null, server: null, error: null };
    this.setWorkspaceSnapshot(null);
  }

  async listThreads(params: ThreadListParams = {}): Promise<ThreadListResponse> {
    return this.request<ThreadListResponse>(methods.threadList, params);
  }

  async forkThread(params: ThreadForkParams): Promise<ThreadForkResponse> {
    // Forking is additive and deliberately does not change Desktop's selected
    // workspace projection. Selection remains an explicit user action.
    return this.request<ThreadForkResponse>("thread/fork", params);
  }

  async startReview(params: ReviewStartParams): Promise<ReviewStartResponse> {
    // Detached review execution is runtime-owned and must not implicitly change
    // the selected Desktop workspace/thread projection.
    return this.request<ReviewStartResponse>("review/start", params);
  }

  async startThread(params: ThreadStartParams = {}): Promise<ThreadStartResponse> {
    const result = await this.request<ThreadStartResponse>(methods.threadStart, params);
    this.setWorkspaceFromThread(result.thread);
    return result;
  }

  async readThread(params: ThreadReadParams): Promise<ThreadReadResponse> {
    const result = await this.request<ThreadReadResponse>(methods.threadRead, params);
    this.setWorkspaceFromThread(result.thread);
    return result;
  }

  async resumeThread(threadId: string): Promise<ThreadResumeResponse> {
    const result = await this.request<ThreadResumeResponse>(methods.threadResume, { threadId });
    this.setWorkspaceFromThread(result.thread);
    return result;
  }

  async archiveThread(params: ThreadArchiveParams): Promise<ThreadArchiveResponse> {
    return this.request<ThreadArchiveResponse>(methods.threadArchive, params);
  }

  async unarchiveThread(params: ThreadUnarchiveParams): Promise<ThreadUnarchiveResponse> {
    return this.request<ThreadUnarchiveResponse>(methods.threadUnarchive, params);
  }

  async listBackgroundTerminals(
    params: ThreadBackgroundTerminalsListParams,
  ): Promise<ThreadBackgroundTerminalsListResponse> {
    return this.request<ThreadBackgroundTerminalsListResponse>(
      methods.threadBackgroundTerminalsList,
      params,
    );
  }

  async terminateBackgroundTerminal(
    params: ThreadBackgroundTerminalsTerminateParams,
  ): Promise<ThreadBackgroundTerminalsTerminateResponse> {
    return this.request<ThreadBackgroundTerminalsTerminateResponse>(
      methods.threadBackgroundTerminalsTerminate,
      params,
    );
  }

  async cleanBackgroundTerminals(
    params: ThreadBackgroundTerminalsCleanParams,
  ): Promise<ThreadBackgroundTerminalsCleanResponse> {
    return this.request<ThreadBackgroundTerminalsCleanResponse>(
      methods.threadBackgroundTerminalsClean,
      params,
    );
  }

  async startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.request<TurnStartResponse>(methods.turnStart, params);
  }

  async interruptTurn(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return this.request<TurnInterruptResponse>(methods.turnInterrupt, params);
  }

  async listModels(params: ModelListParams = {}): Promise<ModelListResponse> {
    return this.request<ModelListResponse>(methods.modelList, params);
  }

  async readModelProviderCapabilities(): Promise<ModelProviderCapabilities> {
    return this.request<ModelProviderCapabilities>(methods.modelProviderCapabilitiesRead, {});
  }

  async readConfig(params: ConfigReadParams = {}): Promise<ConfigReadResponse> {
    return this.request<ConfigReadResponse>(methods.configRead, params);
  }

  async readEnvironmentInfo(params: EnvironmentInfoParams): Promise<EnvironmentInfoResponse> {
    return this.request<EnvironmentInfoResponse>(methods.environmentInfo, params);
  }

  async execCommand(params: CommandExecParams): Promise<CommandExecResponse> {
    return this.request<CommandExecResponse>(methods.commandExec, params, null);
  }

  async writeCommand(params: CommandExecWriteParams): Promise<CommandExecWriteResponse> {
    return this.request<CommandExecWriteResponse>(methods.commandExecWrite, params);
  }

  async resizeCommand(params: CommandExecResizeParams): Promise<CommandExecResizeResponse> {
    return this.request<CommandExecResizeResponse>(methods.commandExecResize, params);
  }

  async terminateCommand(
    params: CommandExecTerminateParams,
  ): Promise<CommandExecTerminateResponse> {
    return this.request<CommandExecTerminateResponse>(methods.commandExecTerminate, params);
  }

  async gitDiffToRemote(params: GitDiffToRemoteParams): Promise<GitDiffToRemoteResponse> {
    return this.request<GitDiffToRemoteResponse>(methods.gitDiffToRemote, params);
  }

  async listMcpServerStatus(
    params: McpServerStatusListParams = {},
  ): Promise<McpServerStatusListResponse> {
    return this.request<McpServerStatusListResponse>(methods.mcpServerStatusList, params);
  }

  async startMcpServerOauthLogin(
    params: McpServerOauthLoginParams,
  ): Promise<McpServerOauthLoginResponse> {
    return this.request<McpServerOauthLoginResponse>(methods.mcpServerOauthLogin, params);
  }

  async readDirectory(
    params: FsReadDirectoryParams,
  ): Promise<FsReadDirectoryResponse> {
    return this.request<FsReadDirectoryResponse>(methods.fsReadDirectory, params);
  }

  async getMetadata(params: FsGetMetadataParams): Promise<FsGetMetadataResponse> {
    return this.request<FsGetMetadataResponse>(methods.fsGetMetadata, params);
  }

  async readFile(params: FsReadFileParams): Promise<FsReadFileResponse> {
    return this.request<FsReadFileResponse>(methods.fsReadFile, params);
  }

  async writeFile(params: FsWriteFileParams): Promise<FsWriteFileResponse> {
    return this.request<FsWriteFileResponse>(methods.fsWriteFile, params);
  }

  async watchPath(params: FsWatchParams): Promise<FsWatchResponse> {
    return this.request<FsWatchResponse>("fs/watch", params);
  }

  async unwatchPath(params: FsUnwatchParams): Promise<FsUnwatchResponse> {
    return this.request<FsUnwatchResponse>("fs/unwatch", params);
  }

  async fuzzyFileSearch(
    params: FuzzyFileSearchParams,
  ): Promise<FuzzyFileSearchResponse> {
    return this.request<FuzzyFileSearchResponse>(methods.fuzzyFileSearch, params);
  }

  async listSkills(params: SkillsListParams = {}): Promise<SkillsListResponse> {
    return this.request<SkillsListResponse>(methods.skillsList, params);
  }

  async listHooks(params: HooksListParams = {}): Promise<HooksListResponse> {
    return this.request<HooksListResponse>(methods.hooksList, params);
  }

  onNotification(handler: RuntimeNotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: RuntimeServerRequestHandler): () => void {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  onLog(handler: RuntimeLogHandler): () => void {
    this.logHandlers.add(handler);
    return () => this.logHandlers.delete(handler);
  }

  onWorkspaceChange(handler: RuntimeWorkspaceHandler): () => void {
    this.workspaceHandlers.add(handler);
    return () => this.workspaceHandlers.delete(handler);
  }

  async respondToServerRequest(id: RequestId, result: unknown): Promise<void> {
    await sendNativeAppServerLine(JSON.stringify({ id, result }));
  }

  async rejectServerRequest(
    id: RequestId,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void> {
    await sendNativeAppServerLine(
      JSON.stringify({
        id,
        error: data === undefined ? { code, message } : { code, message, data },
      }),
    );
  }

  private setWorkspaceFromThread(thread: {
    id: string;
    cwd: string;
    gitInfo?: unknown | null;
  }): void {
    const cwd = thread.cwd.trim();
    this.setWorkspaceSnapshot(
      cwd
        ? {
            threadId: thread.id,
            cwd,
            git: parseRuntimeGitInfo(thread.gitInfo),
          }
        : null,
    );
  }

  private setWorkspaceSnapshot(next: RuntimeWorkspaceSnapshot | null): void {
    if (sameWorkspaceSnapshot(this.workspaceSnapshot, next)) return;
    this.workspaceSnapshot = next;
    for (const handler of this.workspaceHandlers) handler();
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
    timeoutMs: number | null = REQUEST_TIMEOUT_MS,
  ): Promise<TResult> {
    const id = this.nextId++;
    const payload = { method, id, params };

    const response = new Promise<TResult>((resolve, reject) => {
      const timeout =
        timeoutMs === null
          ? null
          : window.setTimeout(() => {
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
        if (pending.timeout !== null) window.clearTimeout(pending.timeout);
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

    if (isRequestId(message.id) && typeof message.method === "string") {
      const serverRequest: RuntimeServerRequest = {
        id: message.id,
        method: message.method,
        params: message.params,
      };
      let handled = false;
      for (const handler of this.serverRequestHandlers) {
        handled = handler(serverRequest) || handled;
      }
      if (!handled) {
        for (const handler of this.logHandlers) {
          handler(
            `unhandled app-server request: ${serverRequest.method} (${String(serverRequest.id)})`,
          );
        }
      }
      return;
    }

    if (isRequestId(message.id)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        for (const handler of this.logHandlers) {
          handler(`orphan app-server response id: ${String(message.id)}`);
        }
        return;
      }

      if (pending.timeout !== null) window.clearTimeout(pending.timeout);
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

function parseRuntimeGitInfo(value: unknown): RuntimeGitSnapshot | null {
  if (!isRecord(value)) return null;
  const sha = nullableString(value.sha);
  const branch = nullableString(value.branch);
  const originUrl = nullableString(value.originUrl);
  if (sha === undefined || branch === undefined || originUrl === undefined) return null;
  return { sha, branch, originUrl };
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function sameWorkspaceSnapshot(
  current: RuntimeWorkspaceSnapshot | null,
  next: RuntimeWorkspaceSnapshot | null,
): boolean {
  return (
    current?.threadId === next?.threadId &&
    current?.cwd === next?.cwd &&
    current?.git?.sha === next?.git?.sha &&
    current?.git?.branch === next?.git?.branch &&
    current?.git?.originUrl === next?.git?.originUrl
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "number" || typeof value === "string";
}

function toRpcError(response: JsonRpcFailure): Error {
  const error = new Error(`${response.error.message} (${response.error.code})`);
  error.name = "SyndridRpcError";
  return error;
}

export const appServerClient = new SyndridAppServerClient();