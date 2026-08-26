import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { ModelSummary } from "../runtime/protocol";
import "./modelCatalogDock.css";

const PAGE_SIZE = 80;
const MAX_RETAINED_MODELS = 400;
const MAX_RENDERED_MODELS = 160;
const MAX_LABEL_CHARS = 8 * 1024;
const MAX_DESCRIPTION_CHARS = 32 * 1024;
const MAX_MODALITIES = 16;
const MAX_MODALITY_CHARS = 512;
const OPEN_EVENT = "syndrid:open-model-catalog";
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

type RetainedModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  inputModalities: string[];
  supportsPersonality: boolean;
  isDefault: boolean;
};

export function ModelCatalogDock() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<RetainedModel[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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
        const projected = result.data.map(retainModel);
        setModels((current) =>
          dedupeModels(append ? [...current, ...projected] : projected).slice(
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
    const onOpen = () => {
      const active = document.activeElement;
      previousFocusRef.current = active instanceof HTMLElement ? active : null;
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) {
      generation.current += 1;
      setLoading(false);
      setModels([]);
      setCursor(null);
      setQuery("");
      setError(null);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
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
    // Closed explorers release retained catalog state immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
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
      aria-labelledby="runtime-model-catalog-title"
      aria-modal="true"
      className="model-catalog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      ref={dialogRef}
      role="dialog"
    >
      <section className="model-catalog-panel">
        <header>
          <span>
            <strong id="runtime-model-catalog-title">Runtime model catalog</strong>
            <small>
              {models.length} retained{cursor ? " · more available" : " · end of catalog"}
            </small>
          </span>
          <div className="model-catalog-header-actions">
            <button disabled={loading} onClick={() => void load(false)} type="button">
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button onClick={() => setOpen(false)} type="button">
              Close
            </button>
          </div>
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
          Runtime-discovered · 80 models/page · retains 400 bounded summaries while open · releases on close · mounts 160 · explicit pagination · no polling
        </footer>
      </section>
    </div>
  );
}

function retainModel(model: ModelSummary): RetainedModel {
  return {
    id: model.id,
    model: model.model,
    displayName: boundText(model.displayName, MAX_LABEL_CHARS),
    description: boundText(model.description, MAX_DESCRIPTION_CHARS),
    inputModalities: model.inputModalities
      .slice(0, MAX_MODALITIES)
      .map((value) => boundText(String(value), MAX_MODALITY_CHARS)),
    supportsPersonality: model.supportsPersonality,
    isDefault: model.isDefault,
  };
}

function boundText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function dedupeModels(models: RetainedModel[]): RetainedModel[] {
  const byId = new Map<string, RetainedModel>();
  for (const model of models) byId.set(model.id, model);
  return [...byId.values()];
}
