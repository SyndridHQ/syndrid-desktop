import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ModelSummary } from "../runtime/protocol";
import "./modelCatalogDock.css";

const PAGE_SIZE = 80;
const MAX_RETAINED_MODELS = 400;
const MAX_RENDERED_MODELS = 160;
const OPEN_EVENT = "syndrid:open-model-catalog";

export function ModelCatalogDock() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (append = false) => {
      if (loading) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before browsing models.");
        return;
      }

      const requestGeneration = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const result = await appServerClient.listModels({
          cursor: append ? cursor : null,
          limit: PAGE_SIZE,
          includeHidden: false,
        });
        if (requestGeneration !== generation.current) return;
        setModels((current) =>
          dedupeModels(append ? [...current, ...result.data] : result.data).slice(
            0,
            MAX_RETAINED_MODELS,
          ),
        );
        setCursor(result.nextCursor);
      } catch (cause) {
        if (requestGeneration !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (requestGeneration === generation.current) setLoading(false);
      }
    },
    [cursor, loading],
  );

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) {
      generation.current += 1;
      setLoading(false);
      return;
    }
    setModels([]);
    setCursor(null);
    setQuery("");
    setError(null);
    void load(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    // Opening the explorer is the only automatic inventory read. Additional
    // catalog pages remain explicit and there is no background model polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const sorted = [...models].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    if (!needle) return sorted;
    return sorted.filter((model) =>
      `${model.displayName} ${model.model} ${model.description}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [models, query]);

  const visible = filtered.slice(0, MAX_RENDERED_MODELS);

  if (!open) return null;

  return (
    <div
      aria-label="Runtime model catalog"
      aria-modal="true"
      className="model-catalog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      role="dialog"
    >
      <section className="model-catalog-panel">
        <header>
          <span>
            <strong>Runtime model catalog</strong>
            <small>
              {models.length} retained{cursor ? " · more available" : " · end of catalog"}
            </small>
          </span>
          <button onClick={() => setOpen(false)} type="button">
            Close
          </button>
        </header>

        <div className="model-catalog-search">
          <input
            aria-label="Filter runtime models"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter model name, ID, or description…"
            ref={inputRef}
            value={query}
          />
          {query && (
            <button onClick={() => setQuery("")} type="button">
              Clear
            </button>
          )}
        </div>

        {error ? (
          <div className="model-catalog-state error">{error}</div>
        ) : loading && models.length === 0 ? (
          <div className="model-catalog-state">Reading runtime model catalog…</div>
        ) : models.length === 0 ? (
          <div className="model-catalog-state">No runtime models reported.</div>
        ) : filtered.length === 0 ? (
          <div className="model-catalog-state">No retained models match this filter.</div>
        ) : (
          <div className="model-catalog-list">
            {visible.map((model) => (
              <article key={model.id}>
                <div>
                  <strong>{model.displayName}</strong>
                  <code title={model.model}>{model.model}</code>
                  {model.description && <small>{model.description}</small>}
                </div>
                <span>
                  {model.isDefault && <em>Default</em>}
                  {model.supportsPersonality && <small>Personality</small>}
                  {model.inputModalities.length > 0 && (
                    <small>{model.inputModalities.join(" · ")}</small>
                  )}
                </span>
              </article>
            ))}
          </div>
        )}

        <div className="model-catalog-actions">
          <small>
            {filtered.length > MAX_RENDERED_MODELS
              ? `Showing ${MAX_RENDERED_MODELS} of ${filtered.length} matching retained models`
              : `${filtered.length} matching retained model${filtered.length === 1 ? "" : "s"}`}
          </small>
          {cursor && models.length < MAX_RETAINED_MODELS && (
            <button disabled={loading} onClick={() => void load(true)} type="button">
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>

        <footer>
          Runtime-discovered · 80 models/page · retains 400 · mounts 160 · explicit pagination · no polling
        </footer>
      </section>
    </div>
  );
}

function dedupeModels(models: ModelSummary[]): ModelSummary[] {
  const byId = new Map<string, ModelSummary>();
  for (const model of models) byId.set(model.id, model);
  return [...byId.values()];
}
