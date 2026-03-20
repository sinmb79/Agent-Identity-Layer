import { SCORE_DIMENSIONS } from "./scoring.mjs";
import { canonicalJson } from "./crypto.mjs";
import { listAgentBadges } from "./achievements.mjs";

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function average(values, fallback = 0) {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundNumber(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function normalizePercentValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 1 ? value : value * 100;
}

function specializationLabel(dimension) {
  switch (dimension) {
    case "strategic_reasoning":
      return "Strategic Reasoning";
    case "adaptability":
      return "Adaptability";
    case "cooperation":
      return "Cooperation";
    case "consistency":
      return "Consistency";
    default:
      return "Generalist";
  }
}

function inferSpecialization(entries) {
  const dimensions = SCORE_DIMENSIONS.filter((dimension) => dimension !== "overall");
  const scores = new Map(dimensions.map((dimension) => [dimension, []]));

  for (const entry of entries) {
    const parsedScores = parseJson(entry.scores_json, {});
    for (const dimension of dimensions) {
      const value = parsedScores?.[dimension];
      if (typeof value === "number" && Number.isFinite(value)) {
        scores.get(dimension).push(value);
      }
    }
  }

  const ranked = [...scores.entries()]
    .map(([dimension, values]) => [dimension, average(values, 0)])
    .sort((left, right) => right[1] - left[1]);

  return specializationLabel(ranked[0]?.[0] ?? null);
}

function summarizeSeason(entries, badgeIds) {
  const parsedEntries = entries.map((entry) => ({
    ...entry,
    metrics: parseJson(entry.metrics_json, {}),
    scores: parseJson(entry.scores_json, {}),
  }));

  const scoreProgression = parsedEntries
    .map((entry) => entry.scores?.overall)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  const bestScore = Math.max(...scoreProgression);
  const worstScore = Math.min(...scoreProgression);
  const bestEpoch = parsedEntries.find((entry) => entry.scores?.overall === bestScore);
  const worstEpoch = parsedEntries.find((entry) => entry.scores?.overall === worstScore);

  const finalMetrics = parsedEntries.at(-1)?.metrics ?? {};
  const totalXp = parsedEntries.reduce((sum, entry) => {
    const xp = typeof entry.metrics?.xp_earned === "number" ? entry.metrics.xp_earned : 0;
    return sum + xp;
  }, 0);

  const winRateValues = parsedEntries
    .map((entry) => normalizePercentValue(entry.metrics?.action_success_rate ?? entry.metrics?.attack_success_rate))
    .filter((value) => value !== null);

  return {
    total_epochs: parsedEntries.length,
    final_rank: finalMetrics.final_rank ?? finalMetrics.season_rank ?? finalMetrics.faction_rank ?? null,
    total_xp: roundNumber(totalXp, 0),
    win_rate: roundNumber(average(winRateValues, 0), 2),
    badges_earned: badgeIds,
    score_progression: scoreProgression,
    best_epoch: bestEpoch ? { epoch: bestEpoch.epoch, score: bestEpoch.scores.overall } : null,
    worst_epoch: worstEpoch ? { epoch: worstEpoch.epoch, score: worstEpoch.scores.overall } : null,
    specialization: inferSpecialization(entries),
  };
}

async function upsertSeasonReport(db, { agentId, sourceId, season, summary }) {
  const generatedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO season_reports (
      id, agent_id, source_id, season, summary_json, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, source_id, season) DO UPDATE SET
      summary_json = excluded.summary_json,
      generated_at = excluded.generated_at
  `).bind(
    crypto.randomUUID(),
    agentId,
    sourceId,
    season,
    canonicalJson(summary),
    generatedAt
  ).run();

  return generatedAt;
}

export async function generateSeasonReport(db, ailId, source, season) {
  const { results } = await db.prepare(`
    SELECT ph.epoch, ph.metrics_json, ph.scores_json
    FROM performance_history ph
    WHERE ph.agent_id = ? AND ph.source_id = ? AND ph.season = ?
    ORDER BY ph.epoch ASC, ph.recorded_at ASC
  `).bind(ailId, source.id, season).all();

  const entries = results || [];
  if (!entries.length) return null;

  const badges = await listAgentBadges(db, ailId, { sourceName: source.name });
  const summary = summarizeSeason(entries, badges.map((badge) => badge.badge_id));
  const generatedAt = await upsertSeasonReport(db, {
    agentId: ailId,
    sourceId: source.id,
    season,
    summary,
  });

  return {
    ail_id: ailId,
    season,
    source: source.name,
    summary,
    generated_at: generatedAt,
  };
}

export async function getSeasonReport(db, ailId, season, sourceName = null) {
  const binds = [ailId, season];
  const sourceFilter = sourceName ? "AND rs.name = ?" : "";
  if (sourceName) binds.push(sourceName);

  const existing = await db.prepare(`
    SELECT sr.summary_json, sr.generated_at, rs.id AS source_id, rs.name AS source
    FROM season_reports sr
    JOIN registered_sources rs ON rs.id = sr.source_id
    WHERE sr.agent_id = ? AND sr.season = ? ${sourceFilter}
    ORDER BY sr.generated_at DESC
    LIMIT 1
  `).bind(...binds).first();

  if (existing) {
    return {
      ail_id: ailId,
      season,
      source: existing.source,
      summary: parseJson(existing.summary_json, {}),
      generated_at: existing.generated_at,
    };
  }

  const sourceBindings = [ailId, season];
  const sourceWhere = ["ph.agent_id = ?", "ph.season = ?"];
  if (sourceName) {
    sourceWhere.push("rs.name = ?");
    sourceBindings.push(sourceName);
  }

  const source = await db.prepare(`
    SELECT rs.id, rs.name
    FROM performance_history ph
    JOIN registered_sources rs ON rs.id = ph.source_id
    WHERE ${sourceWhere.join(" AND ")}
    ORDER BY ph.recorded_at DESC
    LIMIT 1
  `).bind(...sourceBindings).first();

  if (!source) return null;
  return generateSeasonReport(db, ailId, source, season);
}
