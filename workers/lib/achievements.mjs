import { canonicalJson } from "./crypto.mjs";
import { isAchievementChainEnabled, mintAchievementBadge } from "./chain.mjs";

export const BADGE_DEFINITIONS = {
  pioneer: {
    title: "Pioneer",
    rarity: "Common",
    criteria: "Participated in Season 1",
    automated: true,
  },
  centurion: {
    title: "Centurion",
    rarity: "Uncommon",
    criteria: "Captured 100 or more tiles cumulatively",
    automated: true,
  },
  iron_wall: {
    title: "Iron Wall",
    rarity: "Rare",
    criteria: "Reached 90%+ defense rate in an epoch",
    automated: true,
  },
  epoch_mvp: {
    title: "Epoch MVP",
    rarity: "Rare",
    criteria: "Finished an epoch as the MVP",
    automated: true,
  },
  season_top10: {
    title: "Season Top 10",
    rarity: "Epic",
    criteria: "Finished the season in the overall top 10",
    automated: false,
  },
  season_champion: {
    title: "Season Champion",
    rarity: "Epic",
    criteria: "Won the season with the leading faction",
    automated: false,
  },
  perfect_epoch: {
    title: "Perfect Epoch",
    rarity: "Legendary",
    criteria: "Completed an epoch with 100% action success",
    automated: true,
  },
  underdog_hero: {
    title: "Underdog Hero",
    rarity: "Legendary",
    criteria: "Became MVP while fighting for the smallest faction",
    automated: true,
  },
};

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function badgeTitleFromId(badgeId) {
  return badgeId
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function metricRatio(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value > 1) return value / 100;
  return value;
}

function definitionForBadge(badgeId) {
  const definition = BADGE_DEFINITIONS[badgeId];
  if (definition) return definition;

  return {
    title: badgeTitleFromId(badgeId),
    rarity: "Special",
    criteria: "Issued by an approved data source",
    automated: false,
  };
}

function metadataUriForBadge(badgeId) {
  return `https://agentidcard.org/badges/${badgeId}.json`;
}

function buildStoredMetadata({ badgeId, sourceName, extra = {}, chain = null }) {
  const definition = definitionForBadge(badgeId);
  return {
    badge_id: badgeId,
    title: definition.title,
    rarity: definition.rarity,
    criteria: definition.criteria,
    source: sourceName,
    metadata_uri: metadataUriForBadge(badgeId),
    nft_status: chain?.tokenId ? "minted" : chain ? "pending" : "disabled",
    ...(chain?.tokenId && { nft_token_id: chain.tokenId }),
    ...(chain?.txHash && { nft_tx_hash: chain.txHash }),
    ...extra,
  };
}

async function getAgentRow(db, ailId) {
  return db.prepare(`
    SELECT ail_id, display_name, nft_token_id
    FROM agents
    WHERE ail_id = ?
  `).bind(ailId).first();
}

async function getAchievementRow(db, ailId, badgeId) {
  return db.prepare(`
    SELECT id, nft_token_id, metadata_json, earned_at
    FROM achievements
    WHERE agent_id = ? AND badge_id = ?
  `).bind(ailId, badgeId).first();
}

function buildAchievementResponse(row, sourceName) {
  const metadata = parseJson(row.metadata_json, {}) ?? {};
  const definition = definitionForBadge(row.badge_id);

  return {
    achievement_id: row.id,
    badge_id: row.badge_id,
    title: metadata.title ?? definition.title,
    source: sourceName,
    earned_at: row.earned_at,
    rarity: metadata.rarity ?? definition.rarity,
    criteria: metadata.criteria ?? definition.criteria,
    ...(row.nft_token_id && { nft_token_id: row.nft_token_id }),
  };
}

export async function listAgentBadges(db, ailId, { sourceName = null } = {}) {
  const where = ["a.agent_id = ?"];
  const binds = [ailId];

  if (sourceName) {
    where.push("rs.name = ?");
    binds.push(sourceName);
  }

  const { results } = await db.prepare(`
    SELECT a.id, a.badge_id, a.earned_at, a.nft_token_id, a.metadata_json, rs.name AS source
    FROM achievements a
    JOIN registered_sources rs ON rs.id = a.source_id
    WHERE ${where.join(" AND ")}
    ORDER BY a.earned_at DESC, a.badge_id ASC
  `).bind(...binds).all();

  return (results || []).map((row) => buildAchievementResponse(row, row.source));
}

export async function awardBadge({
  db,
  env,
  agentId,
  source,
  badgeId,
  earnedAt = new Date().toISOString(),
  merkleProof = null,
  metadata = {},
}) {
  const agent = await getAgentRow(db, agentId);
  if (!agent) {
    throw new Error("agent_not_found");
  }

  const existing = await getAchievementRow(db, agentId, badgeId);
  if (existing) {
    return {
      achievement_id: existing.id,
      badge_id: badgeId,
      agent_id: agentId,
      duplicate: true,
      ...(existing.nft_token_id && { nft_token_id: existing.nft_token_id }),
    };
  }

  let chain = null;
  if (isAchievementChainEnabled(env)) {
    chain = await mintAchievementBadge(env, {
      ailId: agent.ail_id,
      ailTokenId: agent.nft_token_id ?? null,
      badgeId,
      source: source.name,
      metadataUri: metadataUriForBadge(badgeId),
    });
  }

  const achievementId = crypto.randomUUID();
  const storedMetadata = buildStoredMetadata({
    badgeId,
    sourceName: source.name,
    extra: metadata,
    chain,
  });

  await db.prepare(`
    INSERT INTO achievements (
      id, agent_id, badge_id, source_id, earned_at,
      nft_token_id, merkle_proof, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    achievementId,
    agentId,
    badgeId,
    source.id,
    earnedAt,
    chain?.tokenId ?? null,
    merkleProof,
    canonicalJson(storedMetadata)
  ).run();

  return {
    achievement_id: achievementId,
    badge_id: badgeId,
    agent_id: agentId,
    message: "Badge awarded.",
    ...(chain?.tokenId && { nft_token_id: chain.tokenId }),
  };
}

export async function checkAchievements(db, env, agentId, source, newRecord) {
  const { results } = await db.prepare(`
    SELECT metrics_json
    FROM reputation_records
    WHERE agent_id = ? AND source_id = ?
    ORDER BY submitted_at ASC
  `).bind(agentId, source.id).all();

  const records = (results || []).map((row) => parseJson(row.metrics_json, {}));
  if (!records.length) return [];

  const latestMetrics = parseJson(newRecord.metrics_json, {}) ?? {};
  const badgeIds = new Set();

  badgeIds.add("pioneer");

  const totalTiles = records.reduce((sum, metrics) => {
    const tiles = typeof metrics.tiles_captured === "number" ? metrics.tiles_captured : 0;
    return sum + tiles;
  }, 0);
  if (totalTiles >= 100) {
    badgeIds.add("centurion");
  }

  const defenseRate = metricRatio(latestMetrics.defense_rate);
  if (defenseRate !== null && defenseRate >= 0.9) {
    badgeIds.add("iron_wall");
  }

  if (latestMetrics.epoch_mvp === true) {
    badgeIds.add("epoch_mvp");
  }

  const actionSuccessRate = metricRatio(latestMetrics.action_success_rate);
  if (actionSuccessRate !== null && actionSuccessRate >= 1) {
    badgeIds.add("perfect_epoch");
  }

  if (
    latestMetrics.underdog_hero === true ||
    (
      latestMetrics.epoch_mvp === true &&
      (
        latestMetrics.smallest_faction === true ||
        latestMetrics.faction_size_rank === 1
      )
    )
  ) {
    badgeIds.add("underdog_hero");
  }

  const awarded = [];
  for (const badgeId of badgeIds) {
    const result = await awardBadge({
      db,
      env,
      agentId,
      source,
      badgeId,
      earnedAt: newRecord.submitted_at,
      metadata: {
        trigger: "automatic",
        epoch: newRecord.epoch,
        ...(newRecord.season !== null && { season: newRecord.season }),
      },
    });

    if (!result.duplicate) {
      awarded.push({
        badge_id: result.badge_id,
        title: definitionForBadge(result.badge_id).title,
        ...(result.nft_token_id && { nft_token_id: result.nft_token_id }),
      });
    }
  }

  return awarded;
}
