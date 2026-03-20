import { Hono } from "hono";
import { canonicalJson, verifyOwnerSignature } from "../lib/crypto.mjs";
import { SCORE_DIMENSIONS, recalculateScores } from "../lib/scoring.mjs";

export const reputationRoutes = new Hono();

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function buildScoresMap(rows) {
  if (!rows.length) return null;

  const mapped = Object.fromEntries(rows.map((row) => [row.dimension, Number(row.score)]));
  for (const dimension of SCORE_DIMENSIONS) {
    if (!(dimension in mapped)) mapped[dimension] = null;
  }

  return mapped;
}

function computeTrend(values) {
  if (values.length < 2) return "stable";

  const delta = values[values.length - 1] - values[0];
  if (delta >= 5) return "improving";
  if (delta <= -5) return "declining";
  return "stable";
}

function summarizeMetrics(records) {
  const numeric = new Map();
  const booleans = new Map();

  for (const record of records) {
    for (const [key, value] of Object.entries(record.metrics)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        const current = numeric.get(key) ?? { sum: 0, count: 0 };
        current.sum += value;
        current.count += 1;
        numeric.set(key, current);
      } else if (typeof value === "boolean") {
        booleans.set(key, (booleans.get(key) ?? 0) + (value ? 1 : 0));
      }
    }
  }

  const summary = {};
  for (const [key, current] of numeric.entries()) {
    const useAverage =
      key.endsWith("_rate") ||
      key.endsWith("_score") ||
      key.endsWith("_rank");

    summary[key] = useAverage
      ? Number((current.sum / current.count).toFixed(2))
      : Number(current.sum.toFixed(2));
  }

  for (const [key, count] of booleans.entries()) {
    summary[`${key}_count`] = count;
  }

  return summary;
}

async function getAgent(db, ailId) {
  return db.prepare(`
    SELECT ail_id, display_name, role, owner_org, issued_at
    FROM agents
    WHERE ail_id = ?
  `).bind(ailId).first();
}

async function getApprovedSourceByName(db, sourceName) {
  return db.prepare(`
    SELECT id, name, verification_method, public_key_jwk, status
    FROM registered_sources
    WHERE name = ?
  `).bind(sourceName).first();
}

async function loadCompositeScores(db, ailId) {
  const { results } = await db.prepare(`
    SELECT dimension, score, data_points
    FROM composite_scores
    WHERE agent_id = ?
  `).bind(ailId).all();

  return {
    scores: buildScoresMap(results || []),
    dataPoints: results?.[0]?.data_points ?? 0,
  };
}

async function loadAchievements(db, ailId) {
  const { results } = await db.prepare(`
    SELECT a.badge_id, a.earned_at, a.nft_token_id, rs.name AS source
    FROM achievements a
    JOIN registered_sources rs ON rs.id = a.source_id
    WHERE a.agent_id = ?
    ORDER BY a.earned_at DESC
  `).bind(ailId).all();

  return (results || []).map((achievement) => ({
    badge_id: achievement.badge_id,
    title: achievement.badge_id,
    source: achievement.source,
    earned: achievement.earned_at,
    ...(achievement.nft_token_id && { nft_token_id: achievement.nft_token_id }),
  }));
}

async function loadPerformanceTrend(db, ailId) {
  const { results } = await db.prepare(`
    SELECT epoch, scores_json
    FROM performance_history
    WHERE agent_id = ?
    ORDER BY recorded_at DESC
    LIMIT 5
  `).bind(ailId).all();

  const lastFive = (results || [])
    .map((entry) => parseJson(entry.scores_json, {}))
    .map((scores) => Number(scores.overall))
    .filter((score) => Number.isFinite(score))
    .reverse();

  return {
    last_5_epochs: lastFive,
    trend: computeTrend(lastFive),
  };
}

async function loadPlatformRecords(db, ailId) {
  const { results } = await db.prepare(`
    SELECT rr.source_id, rr.season, rr.epoch, rr.metrics_json, rr.submitted_at, rs.name AS source
    FROM reputation_records rr
    JOIN registered_sources rs ON rs.id = rr.source_id
    WHERE rr.agent_id = ?
    ORDER BY rr.submitted_at ASC
  `).bind(ailId).all();

  const grouped = new Map();
  for (const row of results || []) {
    const record = {
      ...row,
      metrics: parseJson(row.metrics_json, {}),
    };

    if (!grouped.has(record.source)) {
      grouped.set(record.source, []);
    }
    grouped.get(record.source).push(record);
  }

  return [...grouped.entries()].map(([source, records]) => ({
    source,
    seasons_played: new Set(records.map((record) => record.season).filter((season) => season !== null)).size,
    total_epochs: records.length,
    last_active: records[records.length - 1]?.submitted_at ?? null,
    summary_metrics: summarizeMetrics(records),
  }));
}

async function loadCompareEntry(db, ailId) {
  const agent = await getAgent(db, ailId);
  if (!agent) return null;

  const { scores, dataPoints } = await loadCompositeScores(db, ailId);
  return {
    ail_id: agent.ail_id,
    display_name: agent.display_name,
    composite_scores: scores,
    total_epochs: dataPoints,
  };
}

/**
 * POST /reputation/submit
 */
reputationRoutes.post("/reputation/submit", async (c) => {
  const body = await c.req.json();
  const {
    source_name,
    agent_id,
    season = null,
    epoch,
    metrics,
    merkle_proof = null,
    signature,
  } = body;

  if (!source_name || !agent_id || epoch === undefined || !metrics || !signature) {
    return c.json({ error: "missing_fields" }, 400);
  }

  if (!Number.isInteger(epoch) || epoch < 0) {
    return c.json({ error: "invalid_epoch" }, 400);
  }

  if (season !== null && (!Number.isInteger(season) || season < 0)) {
    return c.json({ error: "invalid_season" }, 400);
  }

  if (!isPlainObject(metrics)) {
    return c.json({ error: "invalid_metrics" }, 400);
  }

  const db = c.env.DB;
  const source = await getApprovedSourceByName(db, source_name);
  if (!source) {
    return c.json({ error: "source_not_found" }, 404);
  }

  if (source.status !== "approved") {
    return c.json({ error: "source_not_approved" }, 403);
  }

  if (source.verification_method === "merkle_proof" && !merkle_proof) {
    return c.json({ error: "missing_merkle_proof" }, 400);
  }

  const agent = await getAgent(db, agent_id);
  if (!agent) {
    return c.json({ error: "agent_not_found" }, 404);
  }

  const payload = { agent_id, season, epoch, metrics };
  const publicKeyJwk = parseJson(source.public_key_jwk);
  const signatureValid = await verifyOwnerSignature(payload, signature, publicKeyJwk);
  if (!signatureValid) {
    return c.json({ error: "invalid_source_signature" }, 401);
  }

  const duplicate = season === null
    ? await db.prepare(`
        SELECT id FROM reputation_records
        WHERE agent_id = ? AND source_id = ? AND epoch = ? AND season IS NULL
      `).bind(agent_id, source.id, epoch).first()
    : await db.prepare(`
        SELECT id FROM reputation_records
        WHERE agent_id = ? AND source_id = ? AND epoch = ? AND season = ?
      `).bind(agent_id, source.id, epoch, season).first();

  if (duplicate) {
    return c.json({ error: "duplicate_reputation_record" }, 409);
  }

  const recordId = crypto.randomUUID();
  const submittedAt = new Date().toISOString();
  const verified = source.verification_method === "signature" ? 1 : 0;

  await db.prepare(`
    INSERT INTO reputation_records (
      id, agent_id, source_id, season, epoch,
      metrics_json, merkle_proof, source_signature, verified, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    recordId,
    agent_id,
    source.id,
    season,
    epoch,
    canonicalJson(metrics),
    merkle_proof,
    signature,
    verified,
    submittedAt
  ).run();

  let scoresUpdated = false;
  let recalculated = { scores: null, dataPoints: 0, provisional: true };

  if (verified) {
    recalculated = await recalculateScores(db, agent_id);
    scoresUpdated = true;
  }

  await db.prepare(`
    INSERT INTO performance_history (
      id, agent_id, source_id, season, epoch,
      metrics_json, scores_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    agent_id,
    source.id,
    season,
    epoch,
    canonicalJson(metrics),
    canonicalJson(recalculated.scores ?? {}),
    submittedAt
  ).run();

  return c.json({
    record_id: recordId,
    agent_id,
    verified: Boolean(verified),
    scores_updated: scoresUpdated,
    message: "Reputation data recorded.",
  }, 201);
});

/**
 * GET /reputation/leaderboard
 */
reputationRoutes.get("/reputation/leaderboard", async (c) => {
  const dimension = c.req.query("dimension") ?? "overall";
  const source = c.req.query("source") ?? null;
  const limit = Math.max(1, Math.min(100, Number.parseInt(c.req.query("limit") ?? "20", 10) || 20));

  if (!SCORE_DIMENSIONS.includes(dimension)) {
    return c.json({ error: "invalid_dimension" }, 400);
  }

  const db = c.env.DB;
  const query = source
    ? `
        SELECT cs.agent_id AS ail_id, a.display_name, cs.score, cs.data_points
        FROM composite_scores cs
        JOIN agents a ON a.ail_id = cs.agent_id
        JOIN (
          SELECT DISTINCT rr.agent_id
          FROM reputation_records rr
          JOIN registered_sources rs ON rs.id = rr.source_id
          WHERE rs.name = ?
        ) scoped ON scoped.agent_id = cs.agent_id
        WHERE cs.dimension = ?
        ORDER BY cs.score DESC, a.display_name ASC
        LIMIT ?
      `
    : `
        SELECT cs.agent_id AS ail_id, a.display_name, cs.score, cs.data_points
        FROM composite_scores cs
        JOIN agents a ON a.ail_id = cs.agent_id
        WHERE cs.dimension = ?
        ORDER BY cs.score DESC, a.display_name ASC
        LIMIT ?
      `;

  const statement = db.prepare(query);
  const leaderboard = source
    ? await statement.bind(source, dimension, limit).all()
    : await statement.bind(dimension, limit).all();

  return c.json({
    dimension,
    entries: (leaderboard.results || []).map((entry, index) => ({
      rank: index + 1,
      ail_id: entry.ail_id,
      display_name: entry.display_name,
      score: Number(entry.score),
      data_points: entry.data_points,
    })),
  });
});

/**
 * GET /reputation/:ail_id/history
 */
reputationRoutes.get("/reputation/:ail_id/history", async (c) => {
  const ailId = c.req.param("ail_id");
  const source = c.req.query("source") ?? null;
  const season = c.req.query("season");
  const limit = Math.max(1, Math.min(200, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const db = c.env.DB;

  const agent = await getAgent(db, ailId);
  if (!agent) {
    return c.json({ error: "agent_not_found" }, 404);
  }

  const whereClauses = ["ph.agent_id = ?"];
  const bindings = [ailId];

  if (source) {
    whereClauses.push("rs.name = ?");
    bindings.push(source);
  }

  if (season !== undefined) {
    whereClauses.push("ph.season = ?");
    bindings.push(Number.parseInt(season, 10));
  }

  bindings.push(limit);

  const { results } = await db.prepare(`
    SELECT ph.epoch, ph.season, ph.metrics_json, ph.scores_json, ph.recorded_at, rs.name AS source
    FROM performance_history ph
    JOIN registered_sources rs ON rs.id = ph.source_id
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY ph.recorded_at DESC
    LIMIT ?
  `).bind(...bindings).all();

  return c.json({
    ail_id: ailId,
    history: (results || []).map((entry) => ({
      epoch: entry.epoch,
      season: entry.season,
      source: entry.source,
      metrics: parseJson(entry.metrics_json, {}),
      scores: parseJson(entry.scores_json, {}),
      recorded_at: entry.recorded_at,
    })),
  });
});

/**
 * GET /reputation/:ail_id/compare
 */
reputationRoutes.get("/reputation/:ail_id/compare", async (c) => {
  const ailId = c.req.param("ail_id");
  const otherId = c.req.query("with");

  if (!otherId) {
    return c.json({ error: "comparison_target_required" }, 400);
  }

  const db = c.env.DB;
  const [left, right] = await Promise.all([
    loadCompareEntry(db, ailId),
    loadCompareEntry(db, otherId),
  ]);

  if (!left || !right) {
    return c.json({ error: "agent_not_found" }, 404);
  }

  const strongerIn = {
    [left.ail_id]: [],
    [right.ail_id]: [],
  };

  for (const dimension of SCORE_DIMENSIONS.filter((value) => value !== "overall")) {
    const leftScore = left.composite_scores?.[dimension];
    const rightScore = right.composite_scores?.[dimension];
    if (leftScore === null || rightScore === null) continue;

    if (leftScore > rightScore) strongerIn[left.ail_id].push(dimension);
    if (rightScore > leftScore) strongerIn[right.ail_id].push(dimension);
  }

  const leftOverall = left.composite_scores?.overall ?? -1;
  const rightOverall = right.composite_scores?.overall ?? -1;
  const overallLeader = leftOverall >= rightOverall ? left.ail_id : right.ail_id;

  return c.json({
    agents: [left, right],
    comparison: {
      stronger_in: strongerIn,
      overall_leader: overallLeader,
    },
  });
});

/**
 * GET /reputation/:ail_id
 */
reputationRoutes.get("/reputation/:ail_id", async (c) => {
  const ailId = c.req.param("ail_id");
  const db = c.env.DB;

  const agent = await getAgent(db, ailId);
  if (!agent) {
    return c.json({ error: "agent_not_found" }, 404);
  }

  const [scoresResult, platformRecords, achievements, performanceTrend] = await Promise.all([
    loadCompositeScores(db, ailId),
    loadPlatformRecords(db, ailId),
    loadAchievements(db, ailId),
    loadPerformanceTrend(db, ailId),
  ]);

  return c.json({
    ail_id: agent.ail_id,
    display_name: agent.display_name,
    owner_org: agent.owner_org,
    registered: agent.issued_at,
    composite_scores: scoresResult.scores,
    platform_records: platformRecords,
    achievements,
    performance_trend: performanceTrend,
    provisional: scoresResult.dataPoints > 0 ? scoresResult.dataPoints < 3 : false,
  });
});
