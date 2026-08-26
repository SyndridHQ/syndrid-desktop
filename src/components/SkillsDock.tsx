import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appServerClient } from "../runtime/appServerClient";
import type { SkillMetadata, SkillsListEntry } from "../runtime/protocol";
import { useRuntimeWorkspace } from "../runtime/useRuntimeWorkspace";
import "./skillsDock.css";

const MAX_VISIBLE_SKILLS = 120;
const MAX_RETAINED_SKILLS = 240;
const MAX_SKILL_DESCRIPTION_CHARS = 32 * 1024;
const MAX_SKILL_SHORT_DESCRIPTION_CHARS = 8 * 1024;

type RetainedSkills = {
  entries: SkillsListEntry[];
  totalSkills: number;
  errorCount: number;
};

export function SkillsDock() {
  const workspace = useRuntimeWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [entries, setEntries] = useState<SkillsListEntry[]>([]);
  const [totalSkills, setTotalSkills] = useState(0);
  const [discoveryErrorCount, setDiscoveryErrorCount] = useState(0);
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
        setTotalSkills(0);
        setDiscoveryErrorCount(0);
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
        const retained = retainSkills(result.data);
        setEntries(retained.entries);
        setTotalSkills(retained.totalSkills);
        setDiscoveryErrorCount(retained.errorCount);
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
    setTotalSkills(0);
    setDiscoveryErrorCount(0);
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

  const toggle = () => setOpen((current) => !current);
  const cwd = workspace?.cwd ?? null;

  return (
    <aside className="skills-dock" aria-label="Skills manager">
      <button className="skills-toggle" onClick={toggle} type="button">
        <span aria-hidden="true">✦</span>
        Skills
        {loaded && <span>{totalSkills}</span>}
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
          ) : totalSkills === 0 ? (
            <div className="skills-state">No skills reported for this workspace.</div>
          ) : (
            <div className="skills-list">
              {skills.slice(0, MAX_VISIBLE_SKILLS).map((skill) => (
                <SkillRow key={`${skill.path}:${skill.name}`} skill={skill} />
              ))}
              {totalSkills > MAX_VISIBLE_SKILLS && (
                <div className="skills-state compact">
                  Showing {Math.min(MAX_VISIBLE_SKILLS, skills.length)} of {totalSkills} skills.
                </div>
              )}
            </div>
          )}

          <footer>
            <span>Selected session · runtime-invalidated · cached by default · refresh/rescan explicit</span>
            {discoveryErrorCount > 0 && (
              <em>{discoveryErrorCount} discovery error{discoveryErrorCount === 1 ? "" : "s"}</em>
            )}
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

function retainSkills(data: SkillsListEntry[]): RetainedSkills {
  let remainingSkills = MAX_RETAINED_SKILLS;
  let totalSkills = 0;
  let errorCount = 0;
  const entries: SkillsListEntry[] = [];

  for (const entry of data) {
    totalSkills += entry.skills.length;
    errorCount += entry.errors.length;
    if (remainingSkills <= 0) continue;

    const skills = entry.skills.slice(0, remainingSkills).map(boundSkillMetadata);
    remainingSkills -= skills.length;
    if (skills.length === 0) continue;
    entries.push({
      cwd: entry.cwd,
      skills,
      // Discovery errors are currently surfaced only as a count. Avoid retaining
      // arbitrary runtime payloads solely to render that aggregate indicator.
      errors: [],
    });
  }

  return { entries, totalSkills, errorCount };
}

function boundSkillMetadata(skill: SkillMetadata): SkillMetadata {
  return {
    ...skill,
    description: boundText(skill.description, MAX_SKILL_DESCRIPTION_CHARS),
    shortDescription: skill.shortDescription === undefined
      ? undefined
      : boundText(skill.shortDescription, MAX_SKILL_SHORT_DESCRIPTION_CHARS),
    // These opaque discovery payloads are not rendered by the current Desktop
    // surface. Keep discovery/runtime ownership in SyndridCLI without retaining
    // potentially large unused structures in the visual client.
    interface: undefined,
    dependencies: undefined,
  };
}

function boundText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
