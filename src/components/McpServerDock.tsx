import { useCallback, useEffect, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { McpServerStatus } from "../runtime/protocol";
import "./mcpServerDock.css";

interface PendingOauth {
  serverName: string;
  authorizationUrl: string;
}

type McpStartupState = "starting" | "ready" | "failed" | "cancelled";
interface RuntimeStartupState {
  state: McpStartupState;
  error: string | null;
}

interface RetainedMcpServer {
  name: string;
  authStatus: McpServerStatus["authStatus"];
  toolNames: string[];
  toolCount: number;
  toolCountTruncated: boolean;
}

const PAGE_SIZE = 50;
const MAX_RETAINED_SERVERS = 200;
const MAX_TOOL_SCAN = 256;
const MAX_VISIBLE_TOOL_NAMES = 8;
const MAX_PRESENTATION_TEXT = 8_192;
const MAX_ERROR_TEXT = 32_768;

export function McpServerDock() {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<RetainedMcpServer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [startupStates, setStartupStates] = useState<Record<string, RuntimeStartupState>>({});
  const [error, setError] = useState<string | null>(null);
  const [oauthStarting, setOauthStarting] = useState<string | null>(null);
  const [pendingOauth, setPendingOauth] = useState<PendingOauth | null>(null);
  const generation = useRef(0);
  const oauthGeneration = useRef(0);

  const load = useCallback(
    async (append = false) => {
      if (loading) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before loading MCP servers.");
        return;
      }

      const requestGeneration = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const page = await appServerClient.listMcpServerStatus({
          cursor: append ? cursor : null,
          limit: PAGE_SIZE,
          detail: "toolsAndAuthOnly",
        });
        if (requestGeneration !== generation.current) return;

        const projected = page.data.map(projectServer);
        setServers((current) =>
          dedupeServers(append ? [...current, ...projected] : projected).slice(
            0,
            MAX_RETAINED_SERVERS,
          ),
        );
        setCursor(page.nextCursor);
        setLoaded(true);
        setStale(false);
      } catch (cause) {
        if (requestGeneration !== generation.current) return;
        setError(limitError(cause instanceof Error ? cause.message : String(cause)));
      } finally {
        if (requestGeneration === generation.current) setLoading(false);
      }
    },
    [cursor, loading],
  );

  const startOauth = useCallback(
    async (serverName: string) => {
      if (oauthStarting) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before signing in to an MCP server.");
        return;
      }

      const requestGeneration = ++oauthGeneration.current;
      setOauthStarting(serverName);
      setPendingOauth(null);
      setError(null);
      try {
        const result = await appServerClient.startMcpServerOauthLogin({
          name: serverName,
        });
        if (requestGeneration !== oauthGeneration.current) return;
        const authorizationUrl = safeAuthorizationUrl(result.authorizationUrl);
        setPendingOauth({ serverName, authorizationUrl });
      } catch (cause) {
        if (requestGeneration !== oauthGeneration.current) return;
        setError(limitError(cause instanceof Error ? cause.message : String(cause)));
      } finally {
        if (requestGeneration === oauthGeneration.current) setOauthStarting(null);
      }
    },
    [oauthStarting],
  );

  useEffect(() => {
    generation.current += 1;
    oauthGeneration.current += 1;
    setServers([]);
    setCursor(null);
    setLoaded(false);
    setStale(false);
    setStartupStates({});
    setLoading(false);
    setError(null);
    setPendingOauth(null);
    setOauthStarting(null);
    if (open) void load(false);
    // Opening the panel is the only automatic inventory read. No polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    return appServerClient.onNotification((notification) => {
      if (notification.method === "mcpServer/startupStatus/updated") {
        const startup = parseStartupState(notification.params);
        if (!startup) return;
        setStartupStates((current) => ({
          ...current,
          [startup.name]: { state: startup.state, error: startup.error },
        }));
        setStale(true);
        return;
      }
      if (notification.method !== "mcpServer/oauthLogin/completed") return;

      const completed = parseOauthCompletion(notification.params);
      if (!completed) return;
      setStale(true);
      setPendingOauth((current) =>
        current?.serverName === completed.name ? null : current,
      );
      if (!completed.success) {
        setError(
          completed.error ||
            limitError(`OAuth sign-in failed for ${completed.name}.`),
        );
      }
    });
  }, [open]);

  return (
    <aside className="mcp-server-dock" aria-label="MCP server manager">
      <button className="mcp-server-toggle" onClick={() => setOpen((value) => !value)} type="button">
        <span className="mcp-server-dot" />
        MCP
        {loaded && <span className="mcp-server-count">{servers.length}</span>}
      </button>
      {open && (
        <section className="mcp-server-panel">
          <header>
            <div>
              <strong>MCP servers</strong>
              <small>Runtime inventory · tools + auth only</small>
            </div>
            <button disabled={loading} onClick={() => void load(false)} type="button">
              {loading ? "Loading…" : stale ? "Refresh · updated" : "Refresh"}
            </button>
          </header>
          {pendingOauth && (
            <div className="mcp-oauth-banner">
              <span>
                <strong>Authorization ready</strong>
                <small title={pendingOauth.serverName}>
                  {limitPresentation(pendingOauth.serverName)} · credentials stay in SyndridCLI
                </small>
              </span>
              <a
                href={pendingOauth.authorizationUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Open sign-in
              </a>
              <button
                disabled={loading}
                onClick={() => {
                  setPendingOauth(null);
                  void load(false);
                }}
                type="button"
              >
                Check status
              </button>
            </div>
          )}
          {stale && loaded && (
            <div className="mcp-server-updated">
              Runtime MCP state changed. Live startup state is shown below; inventory/auth metadata remains retained until Refresh.
            </div>
          )}
          {error ? (
            <div className="mcp-server-state error">{error}</div>
          ) : loading && !loaded ? (
            <div className="mcp-server-state">Loading runtime inventory…</div>
          ) : servers.length === 0 ? (
            <div className="mcp-server-state">No MCP servers reported.</div>
          ) : (
            <div className="mcp-server-list">
              {servers.map((server) => {
                const canOauth = server.authStatus === "notLoggedIn";
                const startup = startupStates[server.name];
                return (
                  <article className="mcp-server-card" key={server.name}>
                    <div className="mcp-server-card-head">
                      <strong title={server.name}>{limitPresentation(server.name)}</strong>
                      <span>
                        {startup && (
                          <em
                            className={`startup startup-${startup.state}`}
                            title={startup.error ?? undefined}
                          >
                            {startup.state}
                          </em>
                        )}
                        <span className={`auth auth-${server.authStatus}`}>
                          {authLabel(server.authStatus)}
                        </span>
                      </span>
                    </div>
                    <div className="mcp-server-summary">
                      <small>
                        {server.toolCount}{server.toolCountTruncated ? "+" : ""} tool
                        {server.toolCount === 1 && !server.toolCountTruncated ? "" : "s"}
                      </small>
                      {canOauth && (
                        <button
                          disabled={oauthStarting !== null}
                          onClick={() => void startOauth(server.name)}
                          type="button"
                        >
                          {oauthStarting === server.name ? "Starting…" : "Sign in"}
                        </button>
                      )}
                    </div>
                    {startup?.error && <small className="mcp-startup-error">{startup.error}</small>}
                    {server.toolNames.length > 0 && (
                      <div className="mcp-tool-list">
                        {server.toolNames.map((tool) => <code key={tool}>{tool}</code>)}
                        {(server.toolCountTruncated || server.toolCount > server.toolNames.length) && (
                          <span>
                            +{server.toolCountTruncated
                              ? `${Math.max(0, server.toolCount - server.toolNames.length)}+`
                              : server.toolCount - server.toolNames.length} more
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {cursor && servers.length < MAX_RETAINED_SERVERS && (
                <button
                  className="mcp-server-more"
                  disabled={loading}
                  onClick={() => void load(true)}
                  type="button"
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          )}
          <footer>
            Runtime-owned · explicit pagination · retains at most {MAX_RETAINED_SERVERS} servers · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function projectServer(server: McpServerStatus): RetainedMcpServer {
  const toolNames: string[] = [];
  let toolCount = 0;
  let toolCountTruncated = false;
  const tools = server.tools ?? {};
  for (const tool in tools) {
    if (!Object.prototype.hasOwnProperty.call(tools, tool)) continue;
    if (toolCount >= MAX_TOOL_SCAN) {
      toolCountTruncated = true;
      break;
    }
    toolCount += 1;
    if (toolNames.length < MAX_VISIBLE_TOOL_NAMES) {
      toolNames.push(limitPresentation(tool));
    }
  }
  return {
    name: server.name,
    authStatus: server.authStatus,
    toolNames,
    toolCount,
    toolCountTruncated,
  };
}

function dedupeServers(servers: RetainedMcpServer[]): RetainedMcpServer[] {
  const byName = new Map<string, RetainedMcpServer>();
  for (const server of servers) byName.set(server.name, server);
  return [...byName.values()];
}

function parseStartupState(
  value: unknown,
): { name: string; state: McpStartupState; error: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !isStartupState(record.status)) return null;
  return {
    name: record.name,
    state: record.status,
    error: typeof record.error === "string" ? limitError(record.error) : null,
  };
}

function isStartupState(value: unknown): value is McpStartupState {
  return value === "starting" || value === "ready" || value === "failed" || value === "cancelled";
}

function parseOauthCompletion(value: unknown): { name: string; success: boolean; error: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.success !== "boolean") return null;
  return {
    name: record.name,
    success: record.success,
    error: typeof record.error === "string" ? limitError(record.error) : null,
  };
}

function safeAuthorizationUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported MCP authorization URL scheme: ${url.protocol}`);
  }
  return url.toString();
}

function authLabel(status: McpServerStatus["authStatus"]): string {
  switch (status) {
    case "oAuth": return "OAuth";
    case "bearerToken": return "Token";
    case "notLoggedIn": return "Sign in";
    default: return "No auth";
  }
}

function limitPresentation(value: string): string {
  return limitText(value, MAX_PRESENTATION_TEXT);
}

function limitError(value: string): string {
  return limitText(value, MAX_ERROR_TEXT);
}

function limitText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
