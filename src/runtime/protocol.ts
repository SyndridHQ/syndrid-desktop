/**
 * Narrow desktop-side protocol facade for the current vertical slice.
 *
 * Method names and shapes are verified against SyndridHQ/syndridcli main at
 * 5a83a6b21e7f7e4287be9ef20a33f50262c771f2. The authoritative generated
 * TypeScript schema lives in codex-rs/app-server-protocol/schema/typescript.
 * Keep this facade deliberately small until generated schema sync is wired in.
 */

export const PROTOCOL_SOURCE_SHA = "5a83a6b21e7f7e4287be9ef20a33f50262c771f2";
export const PROTOCOL_SOURCE_SHORT_SHA = PROTOCOL_SOURCE_SHA.slice(0, 7);

export type RequestId = string | number;

export interface JsonRpcRequest<TParams = unknown> { method: string; id: RequestId; params: TParams; }
export interface JsonRpcNotification<TParams = unknown> { method: string; params?: TParams; }
export interface JsonRpcSuccess<TResult = unknown> { id: RequestId; result: TResult; }
export interface JsonRpcFailure { id: RequestId; error: { code: number; message: string; data?: unknown; }; }
export type JsonRpcResponse<TResult = unknown> = JsonRpcSuccess<TResult> | JsonRpcFailure;

export interface InitializeCapabilities { experimentalApi: boolean; requestAttestation: boolean; mcpServerOpenaiFormElicitation?: boolean; optOutNotificationMethods?: string[] | null; }
export interface InitializeParams { clientInfo: { name: string; title: string; version: string; }; capabilities: InitializeCapabilities | null; }
export interface InitializeResponse { userAgent: string; codexHome: string; platformFamily: string; platformOs: string; }

export interface ThreadListParams { cursor?: string | null; limit?: number | null; sortKey?: string | null; sortDirection?: string | null; modelProviders?: string[] | null; sourceKinds?: string[] | null; archived?: boolean | null; cwd?: string | string[] | null; useStateDbOnly?: boolean; searchTerm?: string | null; }
export interface ThreadSummary { id: string; sessionId: string; forkedFromId: string | null; parentThreadId: string | null; preview: string; ephemeral: boolean; modelProvider: string; createdAt: number; updatedAt: number; recencyAt: number | null; status: unknown; path: string | null; cwd: string; cliVersion: string; source: unknown; threadSource: unknown | null; agentNickname: string | null; agentRole: string | null; gitInfo: unknown | null; name: string | null; turns: unknown[]; }
export interface ThreadListResponse { data: ThreadSummary[]; nextCursor: string | null; backwardsCursor: string | null; }
export interface ThreadStartParams { model?: string | null; modelProvider?: string | null; serviceTier?: string | null; cwd?: string | null; approvalPolicy?: unknown; approvalsReviewer?: unknown; sandbox?: unknown; config?: Record<string, unknown> | null; serviceName?: string | null; baseInstructions?: string | null; developerInstructions?: string | null; personality?: unknown; ephemeral?: boolean | null; sessionStartSource?: unknown; threadSource?: unknown; }
export interface ThreadStartResponse { thread: ThreadSummary; model: string; modelProvider: string; serviceTier: string | null; cwd: string; instructionSources: string[]; approvalPolicy: unknown; approvalsReviewer: unknown; sandbox: unknown; reasoningEffort: unknown | null; }
export interface ThreadReadParams { threadId: string; includeTurns?: boolean; }
export interface ThreadReadResponse { thread: ThreadSummary; }
export interface ThreadResumeResponse { thread: ThreadSummary; model: string; modelProvider: string; serviceTier: string | null; cwd: string; }

export interface UserTextInput { type: "text"; text: string; text_elements: unknown[]; }
export type UserInput = UserTextInput;
export interface TurnSummary { id: string; items: unknown[]; itemsView: unknown; status: unknown; error: unknown | null; startedAt: number | null; completedAt: number | null; durationMs: number | null; }
export interface TurnStartParams { threadId: string; clientUserMessageId?: string | null; input: UserInput[]; cwd?: string | null; approvalPolicy?: unknown; approvalsReviewer?: unknown; sandboxPolicy?: unknown; model?: string | null; serviceTier?: string | null; effort?: unknown; summary?: unknown; personality?: unknown; outputSchema?: unknown; }
export interface TurnStartResponse { turn: TurnSummary; }
export interface TurnInterruptParams { threadId: string; turnId: string; }
export type TurnInterruptResponse = Record<string, never>;

export interface ModelListParams { cursor?: string | null; limit?: number | null; includeHidden?: boolean | null; }
export interface ModelSummary { id: string; model: string; upgrade: string | null; upgradeInfo: unknown | null; availabilityNux: unknown | null; displayName: string; description: string; hidden: boolean; supportedReasoningEfforts: unknown[]; defaultReasoningEffort: unknown; inputModalities: unknown[]; supportsPersonality: boolean; additionalSpeedTiers: string[]; serviceTiers: unknown[]; defaultServiceTier: string | null; isDefault: boolean; }
export interface ModelListResponse { data: ModelSummary[]; nextCursor: string | null; }
export interface ModelProviderCapabilities { namespaceTools: boolean; imageGeneration: boolean; webSearch: boolean; }

export type McpServerStatusDetail = "full" | "toolsAndAuthOnly";
export type McpAuthStatus = "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";
export interface McpServerStatusListParams { cursor?: string | null; limit?: number | null; detail?: McpServerStatusDetail | null; threadId?: string | null; }
export interface McpToolSummary { name?: string; title?: string; description?: string; [key: string]: unknown; }
export interface McpServerStatus { name: string; serverInfo: unknown | null; tools: Record<string, McpToolSummary | undefined>; resources: unknown[]; resourceTemplates: unknown[]; authStatus: McpAuthStatus; }
export interface McpServerStatusListResponse { data: McpServerStatus[]; nextCursor: string | null; }
export interface McpServerOauthLoginParams { name: string; threadId?: string | null; scopes?: string[] | null; timeoutSecs?: bigint | null; }
export interface McpServerOauthLoginResponse { authorizationUrl: string; }

export interface FsReadDirectoryParams { path: string; }
export interface FsReadDirectoryEntry { fileName: string; path?: string; isDirectory: boolean; isFile: boolean; }
export interface FsReadDirectoryResponse { entries: FsReadDirectoryEntry[]; }
export interface FsGetMetadataParams { path: string; }
export interface FsGetMetadataResponse { isDirectory: boolean; isFile: boolean; isSymlink: boolean; sizeBytes?: number; createdAtMs: number; modifiedAtMs: number; }
export interface FsReadFileParams { path: string; }
export interface FsReadFileResponse { dataBase64: string; }

export interface FuzzyFileSearchParams { query: string; roots: string[]; cancellationToken: string | null; }
export interface FuzzyFileSearchResult { root: string; path: string; match_type: unknown; file_name: string; score: number; indices: number[] | null; }
export interface FuzzyFileSearchResponse { files: FuzzyFileSearchResult[]; }

export interface SkillsListParams { cwds?: string[]; forceReload?: boolean; }
export interface SkillMetadata { name: string; description: string; shortDescription?: string; interface?: unknown; dependencies?: unknown; path: string; scope: unknown; enabled: boolean; }
export interface SkillsListEntry { cwd: string; skills: SkillMetadata[]; errors: unknown[]; }
export interface SkillsListResponse { data: SkillsListEntry[]; }

export interface AgentMessageDeltaNotification { threadId: string; turnId: string; itemId: string; delta: string; }
export interface TurnLifecycleNotification { threadId: string; turn: TurnSummary; }

export const methods = {
  initialize: "initialize",
  threadList: "thread/list",
  threadStart: "thread/start",
  threadRead: "thread/read",
  threadResume: "thread/resume",
  turnStart: "turn/start",
  turnInterrupt: "turn/interrupt",
  modelList: "model/list",
  modelProviderCapabilitiesRead: "modelProvider/capabilities/read",
  mcpServerStatusList: "mcpServerStatus/list",
  mcpServerOauthLogin: "mcpServer/oauth/login",
  fsReadDirectory: "fs/readDirectory",
  fsGetMetadata: "fs/getMetadata",
  fsReadFile: "fs/readFile",
  fuzzyFileSearch: "fuzzyFileSearch",
  skillsList: "skills/list",
} as const;

export const notifications = {
  turnStarted: "turn/started",
  turnCompleted: "turn/completed",
  agentMessageDelta: "item/agentMessage/delta",
  serverRequestResolved: "serverRequest/resolved",
} as const;
