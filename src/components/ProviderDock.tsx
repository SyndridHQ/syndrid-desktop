import { useCallback, useEffect, useMemo, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type {
  AccountRateLimitsReadResponse,
  AccountRateLimitsUpdatedNotification,
  RateLimitSnapshot,
  RateLimitWindow,
} from "../runtime/accountRateLimitsProtocol";
import type {
  ConfigReadResponse,
  ModelProviderCapabilities,
  ModelSummary,
} from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./providerDock.css";

const MAX_VISIBLE_MODELS = 120;
const MAX_VISIBLE_RATE_LIMITS = 6;
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
  const [rateLimits, setRateLimits] = useState<AccountRateLimitsReadResponse | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
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
    setRateLimitError(null);
    try {
      const configParams = workspace?.cwd
        ? { cwd: workspace.cwd, includeLayers: false }
        : { includeLayers: false };
      const rateLimitRequest = appServerClient.readAccountRateLimits().then(
        (value) => ({ value, error: null as string | null }),
        (cause: unknown) => ({
          value: null,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      const [catalog, providerCapabilities, effectiveConfig, thread, limitResult] =
        await Promise.all([
          appServerClient.listModels({ limit: MAX_VISIBLE_MODELS, includeHidden: false }),
          appServerClient.readModelProviderCapabilities(),
          appServerClient.readConfig(configParams),
          workspace?.threadId
            ? appServerClient.readThread({
                threadId: workspace.threadId,
                includeTurns: false,
              })
            : Promise.resolve(null),
          rateLimitRequest,
        ]);

      setModels(catalog.data);
      setCapabilities(providerCapabilities);
      setConfig(effectiveConfig);
      setProvider(thread?.thread.modelProvider?.trim() || null);
      setRateLimits(limitResult.value);
      setRateLimitError(limitResult.error);
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
    setRateLimits(null);
    setRateLimitError(null);
    setReroutes([]);
    setError(null);
    void load();
  }, [load, open]);

  useEffect(() => {
    const threadId = workspace?.threadId;
    if (!open) return;

    return appServerClient.onNotification((notification) => {
      if (notification.method === "account/rateLimits/updated") {
        const update = parseRateLimitUpdate(notification.params);
        if (update) {
          setRateLimits((current) => current ? mergeRateLimitUpdate(current, update) : current);
        }
        return;
      }
      if (notification.method !== "model/rerouted" || !threadId) return;
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

  const visibleRateLimits = useMemo(() => collectRateLimits(rateLimits), [rateLimits]);
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

          <section className="provider-limits" aria-label="Runtime account rate limits">
            <header>
              <strong>Usage limits</strong>
              <small>
                {rateLimits?.rateLimitResetCredits
                  ? `${rateLimits.rateLimitResetCredits.availableCount} reset credit${rateLimits.rateLimitResetCredits.availableCount === 1 ? "" : "s"}`
                  : "runtime account snapshot"}
              </small>
            </header>
            {rateLimitError ? (
              <div className="provider-limit-state">
                Rate-limit telemetry unavailable for the current runtime account.
              </div>
            ) : !rateLimits && loading ? (
              <div className="provider-limit-state">Reading account limits…</div>
            ) : visibleRateLimits.length === 0 ? (
              <div className="provider-limit-state">No account limits reported.</div>
            ) : (
              <div className="provider-limit-list">
                {visibleRateLimits.map((limit, index) => (
                  <RateLimitCard key={limit.limitId ?? `${limit.limitName ?? "limit"}-${index}`} limit={limit} />
                ))}
              </div>
            )}
          </section>

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
            Runtime-discovered · live usage deltas · reroute-aware · read-only · no polling
          </footer>
        </section>
      )}
    </aside>
  );
}

function RateLimitCard({ limit }: { limit: RateLimitSnapshot }) {
  const label = limit.limitName?.trim() || limit.limitId?.trim() || "Account usage";
  return (
    <article className="provider-limit-card">
      <div className="provider-limit-title">
        <strong>{label}</strong>
        {limit.rateLimitReachedType && <em>Limit reached</em>}
      </div>
      {limit.primary && <RateLimitMeter label="Primary" window={limit.primary} />}
      {limit.secondary && <RateLimitMeter label="Secondary" window={limit.secondary} />}
      <div className="provider-limit-meta">
        {limit.planType && <span>{limit.planType}</span>}
        {limit.credits && (
          <span>
            {limit.credits.unlimited
              ? "Unlimited credits"
              : limit.credits.balance
                ? `${limit.credits.balance} credits`
                : limit.credits.hasCredits
                  ? "Credits available"
                  : "No credits"}
          </span>
        )}
        {limit.individualLimit && (
          <span>{limit.individualLimit.remainingPercent}% spend remaining</span>
        )}
      </div>
    </article>
  );
}

function RateLimitMeter({ label, window }: { label: string; window: RateLimitWindow }) {
  const usedPercent = Math.min(100, Math.max(0, window.usedPercent));
  return (
    <div className="provider-limit-meter-row">
      <div>
        <span>{label}</span>
        <small>
          {usedPercent}% used
          {window.resetsAt ? ` · resets ${formatResetTime(window.resetsAt)}` : ""}
        </small>
      </div>
      <div className="provider-limit-meter" aria-label={`${label} ${usedPercent}% used`}>
        <span style={{ width: `${usedPercent}%` }} />
      </div>
    </div>
  );
}

function collectRateLimits(response: AccountRateLimitsReadResponse | null): RateLimitSnapshot[] {
  if (!response) return [];
  const result: RateLimitSnapshot[] = [response.rateLimits];
  const primaryId = response.rateLimits.limitId;
  if (response.rateLimitsByLimitId) {
    for (const [id, limit] of Object.entries(response.rateLimitsByLimitId)) {
      if (id === primaryId || limit.limitId === primaryId) continue;
      result.push(limit);
      if (result.length >= MAX_VISIBLE_RATE_LIMITS) break;
    }
  }
  return result.filter(hasVisibleLimitData).slice(0, MAX_VISIBLE_RATE_LIMITS);
}

function hasVisibleLimitData(limit: RateLimitSnapshot): boolean {
  return Boolean(
    limit.limitId ||
    limit.limitName ||
    limit.primary ||
    limit.secondary ||
    limit.credits ||
    limit.individualLimit ||
    limit.rateLimitReachedType,
  );
}

function parseRateLimitUpdate(value: unknown): AccountRateLimitsUpdatedNotification | null {
  if (!isRecord(value) || !isRecord(value.rateLimits)) return null;
  const limit = parseRateLimitSnapshot(value.rateLimits);
  return limit ? { rateLimits: limit } : null;
}

function parseRateLimitSnapshot(value: Record<string, unknown>): RateLimitSnapshot | null {
  const limitId = nullableString(value.limitId);
  const limitName = nullableString(value.limitName);
  const planType = nullableString(value.planType);
  const rateLimitReachedType = nullableString(value.rateLimitReachedType);
  if (
    limitId === undefined ||
    limitName === undefined ||
    planType === undefined ||
    rateLimitReachedType === undefined
  ) return null;
  const primary = nullableRecord(value.primary);
  const secondary = nullableRecord(value.secondary);
  const credits = nullableRecord(value.credits);
  const individualLimit = nullableRecord(value.individualLimit);
  if (
    primary === undefined || secondary === undefined || credits === undefined ||
    individualLimit === undefined
  ) return null;

  const parsedPrimary = primary === null ? null : parseRateLimitWindow(primary);
  const parsedSecondary = secondary === null ? null : parseRateLimitWindow(secondary);
  const parsedCredits = credits === null ? null : parseCredits(credits);
  const parsedIndividual = individualLimit === null ? null : parseIndividualLimit(individualLimit);
  if (
    (primary !== null && !parsedPrimary) ||
    (secondary !== null && !parsedSecondary) ||
    (credits !== null && !parsedCredits) ||
    (individualLimit !== null && !parsedIndividual)
  ) return null;

  return {
    limitId,
    limitName,
    primary: parsedPrimary,
    secondary: parsedSecondary,
    credits: parsedCredits,
    individualLimit: parsedIndividual,
    planType,
    rateLimitReachedType,
  };
}

function parseRateLimitWindow(value: Record<string, unknown>): RateLimitWindow | null {
  const usedPercent = finiteNumber(value.usedPercent);
  const windowDurationMins = nullableNumber(value.windowDurationMins);
  const resetsAt = nullableNumber(value.resetsAt);
  if (usedPercent === null || windowDurationMins === undefined || resetsAt === undefined) return null;
  return { usedPercent, windowDurationMins, resetsAt };
}

function parseCredits(value: Record<string, unknown>): RateLimitSnapshot["credits"] {
  if (typeof value.hasCredits !== "boolean" || typeof value.unlimited !== "boolean") return null;
  const balance = nullableString(value.balance);
  if (balance === undefined) return null;
  return { hasCredits: value.hasCredits, unlimited: value.unlimited, balance };
}

function parseIndividualLimit(value: Record<string, unknown>): RateLimitSnapshot["individualLimit"] {
  if (typeof value.limit !== "string" || typeof value.used !== "string") return null;
  const remainingPercent = finiteNumber(value.remainingPercent);
  const resetsAt = finiteNumber(value.resetsAt);
  if (remainingPercent === null || resetsAt === null) return null;
  return { limit: value.limit, used: value.used, remainingPercent, resetsAt };
}

function mergeRateLimitUpdate(
  current: AccountRateLimitsReadResponse,
  update: AccountRateLimitsUpdatedNotification,
): AccountRateLimitsReadResponse {
  const patch = update.rateLimits;
  const primaryMatches =
    !patch.limitId || !current.rateLimits.limitId || patch.limitId === current.rateLimits.limitId;
  const nextPrimary = primaryMatches
    ? mergeRateLimitSnapshot(current.rateLimits, patch)
    : current.rateLimits;

  let nextById = current.rateLimitsByLimitId;
  if (patch.limitId && nextById?.[patch.limitId]) {
    nextById = {
      ...nextById,
      [patch.limitId]: mergeRateLimitSnapshot(nextById[patch.limitId], patch),
    };
  }
  return { ...current, rateLimits: nextPrimary, rateLimitsByLimitId: nextById };
}

function mergeRateLimitSnapshot(current: RateLimitSnapshot, patch: RateLimitSnapshot): RateLimitSnapshot {
  return {
    limitId: patch.limitId ?? current.limitId,
    limitName: patch.limitName ?? current.limitName,
    primary: patch.primary ?? current.primary,
    secondary: patch.secondary ?? current.secondary,
    credits: patch.credits ?? current.credits,
    individualLimit: patch.individualLimit ?? current.individualLimit,
    planType: patch.planType ?? current.planType,
    rateLimitReachedType: patch.rateLimitReachedType ?? current.rateLimitReachedType,
  };
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

function nullableRecord(value: unknown): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  return isRecord(value) ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = finiteNumber(value);
  return parsed === null ? undefined : parsed;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatRerouteReason(reason: string): string {
  if (reason === "highRiskCyberActivity") return "Runtime safety reroute";
  return reason.replace(/([a-z])([A-Z])/g, "$1 $2").toLocaleLowerCase();
}

function formatResetTime(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  return Number.isNaN(date.getTime())
    ? "later"
    : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
