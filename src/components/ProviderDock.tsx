import { useCallback, useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type {
  ConfigReadResponse,
  ModelProviderCapabilities,
  ModelSummary,
} from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./providerDock.css";

const MAX_VISIBLE_MODELS = 120;
const MAX_RETAINED_REROUTES = 12;

interface RuntimeReroute {
  turnId: string;
  fromModel: string;
  toModel: string;
  reason: string;
}

export function ProviderDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigReadResponse | null>(null);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [capabilities, setCapabilities] =
    useState<ModelProviderCapabilities | null>(null);
  const [reroutes, setReroutes] = useState<RuntimeReroute[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (appServerClient.getSnapshot().phase !== "ready") {
      setError("Connect the Syndrid runtime before loading providers.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const configParams = workspace?.cwd
        ? { cwd: workspace.cwd, includeLayers: false }
        : { includeLayers: false };
      const [catalog, providerCapabilities, effectiveConfig, thread] = await Promise.all([
        appServerClient.listModels({ limit: MAX_VISIBLE_MODELS, includeHidden: false }),
        appServerClient.readModelProviderCapabilities(),
        appServerClient.readConfig(configParams),
        workspace?.threadId
          ? appServerClient.readThread({
              threadId: workspace.threadId,
              includeTurns: false,
            })
          : Promise.resolve(null),
      ]);

      setModels(catalog.data);
      setCapabilities(providerCapabilities);
      setConfig(effectiveConfig);
      setProvider(thread?.thread.modelProvider?.trim() || null);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [workspace?.cwd, workspace?.threadId]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setProvider(null);
    setConfig(null);
    setReroutes([]);
    setError(null);
    void load();
  }, [load, open]);

  useEffect(() => {
    const threadId = workspace?.threadId;
    if (!open || !threadId) return;

    return appServerClient.onNotification((notification) => {
      if (notification.method !== "model/rerouted") return;
      const reroute = parseReroute(notification.params);
      if (!reroute || reroute.threadId !== threadId) return;
      setReroutes((current) =>
        [
          {
            turnId: reroute.turnId,
            fromModel: reroute.fromModel,
            toModel: reroute.toModel,
            reason: reroute.reason,
          },
          ...current.filter((entry) => entry.turnId !== reroute.turnId),
        ].slice(0, MAX_RETAINED_REROUTES),
      );
    });
  }, [open, workspace?.threadId]);

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [...models]
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.displayName.localeCompare(b.displayName, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      })
      .filter((model) =>
        normalized
          ? `${model.displayName} ${model.model} ${model.description}`
              .toLocaleLowerCase()
              .includes(normalized)
          : true,
      )
      .slice(0, MAX_VISIBLE_MODELS);
  }, [models, query]);

  const effectiveProvider = config?.config.model_provider?.trim() || null;
  const effectiveModel = config?.config.model?.trim() || null;
  const serviceTier = config?.config.service_tier?.trim() || null;

  return (
    <aside className="provider-dock" aria-label="Provider manager">
      <button
        className="provider-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="provider-dot" aria-hidden="true" />
        Providers
        {loaded && <span className="provider-count">{models.length}</span>}
      </button>

      {open && (
        <section className="provider-panel">
          <header>
            <span>
              <strong>Provider Manager</strong>
              <small title={workspace?.cwd}>
                {provider
                  ? `${provider} · ${workspace?.cwd ?? "selected workspace"}`
                  : workspace?.cwd ?? "Selected session runtime"}
              </small>
            </span>
            <button disabled={loading} onClick={() => void load()} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </header>

          {config && (
            <dl className="provider-effective">
              <div>
                <dt>Session provider</dt>
                <dd>{provider ?? "Runtime default"}</dd>
              </div>
              <div>
                <dt>Workspace default</dt>
                <dd>{effectiveProvider ?? "Runtime default"}</dd>
              </div>
              <div>
                <dt>Default model</dt>
                <dd>{effectiveModel ?? "Runtime-selected"}</dd>
              </div>
              <div>
                <dt>Service tier</dt>
                <dd>{serviceTier ?? "Default"}</dd>
              </div>
            </dl>
          )}

          {capabilities && (
            <div className="provider-capabilities" aria-label="Provider capabilities">
              <span className={capabilities.namespaceTools ? "enabled" : "disabled"}>
                Tools
              </span>
              <span className={capabilities.webSearch ? "enabled" : "disabled"}>
                Web
              </span>
              <span className={capabilities.imageGeneration ? "enabled" : "disabled"}>
                Images
              </span>
            </div>
          )}

          {reroutes.length > 0 && (
            <section className="provider-reroutes" aria-label="Runtime model reroutes">
              <header>
                <strong>Runtime reroutes</strong>
                <small>{reroutes.length} observed while open</small>
              </header>
              {reroutes.map((reroute) => (
                <article key={reroute.turnId}>
                  <div>
                    <code title={reroute.fromModel}>{reroute.fromModel}</code>
                    <span aria-hidden="true">→</span>
                    <code title={reroute.toModel}>{reroute.toModel}</code>
                  </div>
                  <small>
                    {formatRerouteReason(reroute.reason)} · turn {shortId(reroute.turnId)}
                  </small>
                </article>
              ))}
            </section>
          )}

          <div className="provider-search">
            <input
              aria-label="Filter models"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter runtime models…"
              value={query}
            />
            {query && (
              <button onClick={() => setQuery("")} type="button">
                Clear
              </button>
            )}
          </div>

          {error ? (
            <div className="provider-state error">{error}</div>
          ) : loading && !loaded ? (
            <div className="provider-state">Discovering runtime providers and models…</div>
          ) : models.length === 0 ? (
            <div className="provider-state">No runtime models reported.</div>
          ) : visibleModels.length === 0 ? (
            <div className="provider-state">No models match this filter.</div>
          ) : (
            <div className="provider-model-list">
              {visibleModels.map((model) => (
                <article className="provider-model-row" key={model.id}>
                  <div>
                    <strong>{model.displayName}</strong>
                    <code>{model.model}</code>
                    {model.description && <small>{model.description}</small>}
                  </div>
                  <span>
                    {model.isDefault && <em>Default</em>}
                    {model.supportsPersonality && <small>Personality</small>}
                    {model.inputModalities.length > 0 && (
                      <small>
                        {model.inputModalities.length} input mode
                        {model.inputModalities.length === 1 ? "" : "s"}
                      </small>
                    )}
                  </span>
                </article>
              ))}
            </div>
          )}

          <footer>
            Runtime-discovered · reroute-aware · read-only · no hardcoded model inventory
          </footer>
        </section>
      )}
    </aside>
  );
}

function parseReroute(value: unknown): (RuntimeReroute & { threadId: string }) | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.fromModel !== "string" ||
    typeof record.toModel !== "string" ||
    typeof record.reason !== "string"
  ) {
    return null;
  }
  return {
    threadId: record.threadId,
    turnId: record.turnId,
    fromModel: record.fromModel,
    toModel: record.toModel,
    reason: record.reason,
  };
}

function formatRerouteReason(reason: string): string {
  if (reason === "highRiskCyberActivity") return "Runtime safety reroute";
  return reason.replace(/([a-z])([A-Z])/g, "$1 $2").toLocaleLowerCase();
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
