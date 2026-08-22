import { useCallback, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { McpServerStatus } from "../runtime/protocol";
import "./mcpServerDock.css";

export function McpServerDock() {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (loading) return;
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before loading MCP servers.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const all: McpServerStatus[] = [];
      let cursor: string | null | undefined = null;
      do {
        const page = await appServerClient.listMcpServerStatus({
          cursor,
          limit: 50,
          detail: "toolsAndAuthOnly",
        });
        all.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor && all.length < 500);
      setServers(all);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void load();
  };

  return (
    <aside className="mcp-server-dock" aria-label="MCP server manager">
      <button className="mcp-server-toggle" onClick={toggle} type="button">
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
            <button disabled={loading} onClick={() => void load()} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </header>
          {error ? (
            <div className="mcp-server-state error">{error}</div>
          ) : loading && !loaded ? (
            <div className="mcp-server-state">Loading runtime inventory…</div>
          ) : servers.length === 0 ? (
            <div className="mcp-server-state">No MCP servers reported.</div>
          ) : (
            <div className="mcp-server-list">
              {servers.map((server) => {
                const tools = Object.keys(server.tools ?? {});
                return (
                  <article className="mcp-server-card" key={server.name}>
                    <div className="mcp-server-card-head">
                      <strong>{server.name}</strong>
                      <span className={`auth auth-${server.authStatus}`}>
                        {authLabel(server.authStatus)}
                      </span>
                    </div>
                    <small>{tools.length} tool{tools.length === 1 ? "" : "s"}</small>
                    {tools.length > 0 && (
                      <div className="mcp-tool-list">
                        {tools.slice(0, 8).map((tool) => <code key={tool}>{tool}</code>)}
                        {tools.length > 8 && <span>+{tools.length - 8} more</span>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </aside>
  );
}

function authLabel(status: McpServerStatus["authStatus"]): string {
  switch (status) {
    case "oAuth": return "OAuth";
    case "bearerToken": return "Token";
    case "notLoggedIn": return "Sign in";
    default: return "No auth";
  }
}
