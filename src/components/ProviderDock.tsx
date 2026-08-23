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
    setError(null);
    void load();
  }, [load, open]);

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
            Runtime-discovered · effective config · read-only · no hardcoded model inventory
          </footer>
        </section>
      )}
    </aside>
  );
}
