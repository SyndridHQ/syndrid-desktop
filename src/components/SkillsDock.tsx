import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { SkillMetadata, SkillsListEntry } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./skillsDock.css";

const MAX_VISIBLE_SKILLS = 120;

export function SkillsDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [entries, setEntries] = useState<SkillsListEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (forceReload = false) => {
      if (loading) return;
      if (appServerClient.getSnapshot().phase !== "ready") {
        setError("Connect the Syndrid runtime before loading skills.");
        return;
      }

      const root = workspace?.cwd.trim();
      if (!root) {
        generation.current += 1;
        setEntries([]);
        setLoaded(true);
        setStale(false);
        setLoading(false);
        return;
      }

      const requestGeneration = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const result = await appServerClient.listSkills({
          cwds: [root],
          forceReload,
        });
        if (
          requestGeneration !== generation.current ||
          appServerClient.getWorkspaceSnapshot()?.cwd !== root
        ) {
          return;
        }
        setEntries(result.data);
        setLoaded(true);
        setStale(false);
      } catch (cause) {
        if (requestGeneration !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (requestGeneration === generation.current) setLoading(false);
      }
    },
    [loading, workspace?.cwd],
  );

  useEffect(() => {
    generation.current += 1;
    setLoading(false);
    setLoaded(false);
    setStale(false);
    setEntries([]);
    setError(null);
    if (open) void load(false);
    // The selected runtime workspace is the ownership boundary. No polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace?.threadId, workspace?.cwd]);

  useEffect(() => {
    if (!open) return;
    return appServerClient.onNotification((notification) => {
      if (notification.method === "skills/changed") setStale(true);
    });
  }, [open]);

  const skills = useMemo(
    () =>
      entries
        .flatMap((entry) => entry.skills)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [entries],
  );
  const errorCount = useMemo(
    () => entries.reduce((count, entry) => count + entry.errors.length, 0),
    [entries],
  );

  const toggle = () => setOpen((current) => !current);
  const cwd = workspace?.cwd ?? null;

  return (
    <aside className="skills-dock" aria-label="Skills manager">
      <button className="skills-toggle" onClick={toggle} type="button">
        <span aria-hidden="true">✦</span>
        Skills
        {loaded && <span>{skills.length}</span>}
      </button>
      {open && (
        <section className="skills-panel">
          <header>
            <span>
              <strong>Skills</strong>
              <small title={cwd ?? undefined}>{cwd ?? "Selected session workspace"}</small>
            </span>
            <div>
              <button disabled={loading} onClick={() => void load(false)} type="button">
                {loading ? "Loading…" : stale ? "Refresh · updated" : "Refresh"}
              </button>
              <button disabled={loading} onClick={() => void load(true)} type="button">
                Rescan
              </button>
            </div>
          </header>

          {stale && loaded && (
            <div className="skills-state compact">
              Skill files changed. Retained metadata stays visible until you refresh or explicitly rescan.
            </div>
          )}

          {error ? (
            <div className="skills-state error">{error}</div>
          ) : loading && !loaded ? (
            <div className="skills-state">Loading cached runtime skills…</div>
          ) : !cwd ? (
            <div className="skills-state">No selected session workspace reported.</div>
          ) : skills.length === 0 ? (
            <div className="skills-state">No skills reported for this workspace.</div>
          ) : (
            <div className="skills-list">
              {skills.slice(0, MAX_VISIBLE_SKILLS).map((skill) => (
                <SkillRow key={`${skill.path}:${skill.name}`} skill={skill} />
              ))}
              {skills.length > MAX_VISIBLE_SKILLS && (
                <div className="skills-state compact">
                  Showing {MAX_VISIBLE_SKILLS} of {skills.length} skills.
                </div>
              )}
            </div>
          )}

          <footer>
            <span>Selected session · runtime-invalidated · cached by default · refresh/rescan explicit</span>
            {errorCount > 0 && <em>{errorCount} discovery error{errorCount === 1 ? "" : "s"}</em>}
          </footer>
        </section>
      )}
    </aside>
  );
}

function SkillRow({ skill }: { skill: SkillMetadata }) {
  const summary = skill.shortDescription?.trim() || skill.description.trim();
  return (
    <article className="skill-row" title={skill.path}>
      <div className="skill-row-head">
        <strong>{skill.name}</strong>
        <span className={skill.enabled ? "enabled" : "disabled"}>
          {skill.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {summary && <small>{summary}</small>}
    </article>
  );
}