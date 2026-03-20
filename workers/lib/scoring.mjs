export const SCORE_DIMENSIONS = [
  "strategic_reasoning",
  "adaptability",
  "cooperation",
  "consistency",
  "overall",
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value) {
  return clamp(Math.round(value), 0, 100);
}

function average(values, fallback = 50) {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numericValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentileScore(value, values, { inverse = false } = {}) {
  if (value === null || !values.length) return 50;

  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) {
    return inverse ? 0 : 100;
  }

  let below = 0;
  let equal = 0;
  for (const current of sorted) {
    if (current < value) below += 1;
    else if (current === value) equal += 1;
  }

  const rank = below + ((equal - 1) / 2);
  const percentile = (rank / (sorted.length - 1)) * 100;
  return inverse ? clamp(100 - percentile) : clamp(percentile);
}

function normalizeMetric(records, allRecords, field, options = {}) {
  const agentValues = records
    .map((record) => numericValue(record.metrics[field]))
    .filter((value) => value !== null);

  if (!agentValues.length) {
    return options.defaultValue ?? 50;
  }

  const allValues = allRecords
    .map((record) => numericValue(record.metrics[field]))
    .filter((value) => value !== null);

  if (!allValues.length) {
    return options.defaultValue ?? 50;
  }

  return average(
    agentValues.map((value) => percentileScore(value, allValues, options)),
    options.defaultValue ?? 50
  );
}

function weightedAverage(records, allRecords, specs) {
  const totalWeight = specs.reduce((sum, spec) => sum + spec.weight, 0);
  if (!totalWeight) return 50;

  const score = specs.reduce((sum, spec) => {
    const value = normalizeMetric(records, allRecords, spec.field, {
      inverse: spec.inverse ?? false,
      defaultValue: spec.defaultValue ?? 50,
    });
    return sum + (value * spec.weight);
  }, 0);

  return score / totalWeight;
}

function stabilityScore(values, fallback = 50) {
  if (values.length < 2) return fallback;

  const mean = average(values, fallback);
  if (mean <= 0) return fallback;

  const variance = average(values.map((value) => (value - mean) ** 2), 0);
  const coefficient = Math.sqrt(variance) / mean;
  return clamp(100 - (coefficient * 100));
}

function computeVarianceScore(records, field) {
  const values = records
    .map((record) => numericValue(record.metrics[field]))
    .filter((value) => value !== null);

  return stabilityScore(values);
}

function computeConsistencyScore(records) {
  const actionValues = records
    .map((record) => numericValue(record.metrics.actions_taken))
    .filter((value) => value !== null);
  const successValues = records
    .map((record) => numericValue(record.metrics.attack_success_rate))
    .filter((value) => value !== null);

  return average([
    stabilityScore(actionValues),
    stabilityScore(successValues),
  ]);
}

function computeFromAgentCraft(records, allSourceRecords) {
  const strategic = weightedAverage(records, allSourceRecords, [
    { field: "attack_success_rate", weight: 0.4 },
    { field: "tiles_captured", weight: 0.35 },
    { field: "faction_rank", weight: 0.25, inverse: true },
  ]);

  const adaptability = computeVarianceScore(records, "xp_earned");

  const cooperation = weightedAverage(records, allSourceRecords, [
    { field: "faction_directive_compliance", weight: 0.6, defaultValue: 50 },
    { field: "team_synergy_score", weight: 0.4, defaultValue: 50 },
  ]);

  const consistency = computeConsistencyScore(records);

  const overall = (
    (strategic * 0.35) +
    (adaptability * 0.25) +
    (cooperation * 0.20) +
    (consistency * 0.20)
  );

  return {
    scores: {
      strategic_reasoning: roundScore(strategic),
      adaptability: roundScore(adaptability),
      cooperation: roundScore(cooperation),
      consistency: roundScore(consistency),
      overall: roundScore(overall),
    },
    dataPoints: records.length,
  };
}

const SOURCE_SCORERS = {
  agentcraft: computeFromAgentCraft,
};

function parseRecord(row) {
  return {
    ...row,
    metrics: JSON.parse(row.metrics_json),
  };
}

export async function recalculateScores(db, agentId) {
  const { results } = await db.prepare(`
    SELECT rr.agent_id, rr.source_id, rr.metrics_json, rr.season, rr.epoch, rr.verified,
           rr.submitted_at, rs.name AS source_name
    FROM reputation_records rr
    JOIN registered_sources rs ON rs.id = rr.source_id
    WHERE rr.agent_id = ? AND rr.verified = 1
    ORDER BY rr.submitted_at ASC
  `).bind(agentId).all();

  const records = (results || []).map(parseRecord);
  if (!records.length) {
    await db.prepare("DELETE FROM composite_scores WHERE agent_id = ?").bind(agentId).run();
    return {
      scores: null,
      dataPoints: 0,
      provisional: true,
    };
  }

  const sourceGroups = new Map();
  for (const record of records) {
    if (!sourceGroups.has(record.source_name)) {
      sourceGroups.set(record.source_name, []);
    }
    sourceGroups.get(record.source_name).push(record);
  }

  const contributions = [];
  for (const [sourceName, agentRecords] of sourceGroups.entries()) {
    const scorer = SOURCE_SCORERS[sourceName];
    if (!scorer) continue;

    const allSourceRows = await db.prepare(`
      SELECT rr.agent_id, rr.source_id, rr.metrics_json, rr.season, rr.epoch, rr.verified,
             rr.submitted_at, rs.name AS source_name
      FROM reputation_records rr
      JOIN registered_sources rs ON rs.id = rr.source_id
      WHERE rs.name = ? AND rr.verified = 1
    `).bind(sourceName).all();

    contributions.push(scorer(agentRecords, (allSourceRows.results || []).map(parseRecord)));
  }

  if (!contributions.length) {
    await db.prepare("DELETE FROM composite_scores WHERE agent_id = ?").bind(agentId).run();
    return {
      scores: null,
      dataPoints: 0,
      provisional: true,
    };
  }

  const totalDataPoints = contributions.reduce((sum, contribution) => sum + contribution.dataPoints, 0);
  const combinedScores = Object.fromEntries(
    SCORE_DIMENSIONS.map((dimension) => {
      const weighted = contributions.reduce((sum, contribution) => {
        return sum + (contribution.scores[dimension] * contribution.dataPoints);
      }, 0);
      return [dimension, roundScore(weighted / totalDataPoints)];
    })
  );

  const updatedAt = new Date().toISOString();
  await db.batch(
    SCORE_DIMENSIONS.map((dimension) => db.prepare(`
      INSERT INTO composite_scores (agent_id, dimension, score, data_points, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, dimension) DO UPDATE SET
        score = excluded.score,
        data_points = excluded.data_points,
        updated_at = excluded.updated_at
    `).bind(agentId, dimension, combinedScores[dimension], totalDataPoints, updatedAt))
  );

  return {
    scores: combinedScores,
    dataPoints: totalDataPoints,
    provisional: totalDataPoints < 3,
  };
}
