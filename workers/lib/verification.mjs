import { verifyCredentialJWT } from "./crypto.mjs";
import { listAgentBadges } from "./achievements.mjs";

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export async function buildVerificationResult({ db, masterKey, token }) {
  let payload;
  try {
    const result = await verifyCredentialJWT(token, masterKey);
    payload = result.payload;
  } catch (error) {
    return {
      valid: false,
      reason: "jwt_verification_failed",
      detail: error.message,
    };
  }

  const agent = await db.prepare(
    "SELECT ail_id, revoked, revoked_at FROM agents WHERE ail_id = ?"
  ).bind(payload.ail_id).first();

  if (!agent) {
    return {
      valid: false,
      reason: "agent_not_found",
      ail_id: payload.ail_id,
    };
  }

  if (agent.revoked) {
    return {
      valid: false,
      reason: "credential_revoked",
      ail_id: agent.ail_id,
      revoked_at: agent.revoked_at,
    };
  }

  const [scoreRows, recordRows, achievementCount, recentBadges] = await Promise.all([
    db.prepare(`
      SELECT dimension, score
      FROM composite_scores
      WHERE agent_id = ?
    `).bind(agent.ail_id).all(),
    db.prepare(`
      SELECT source_id, metrics_json, submitted_at
      FROM reputation_records
      WHERE agent_id = ?
      ORDER BY submitted_at ASC
    `).bind(agent.ail_id).all(),
    db.prepare(`
      SELECT COUNT(*) AS total
      FROM achievements
      WHERE agent_id = ?
    `).bind(agent.ail_id).first(),
    listAgentBadges(db, agent.ail_id),
  ]);

  const reputationRecords = recordRows.results || [];
  let reputation = null;

  if (reputationRecords.length > 0) {
    const scores = Object.fromEntries(
      (scoreRows.results || []).map((row) => [row.dimension, Number(row.score)])
    );

    let totalActions = 0;
    for (const record of reputationRecords) {
      const metrics = parseJson(record.metrics_json, {});
      const actions = typeof metrics.actions_taken === "number" ? metrics.actions_taken : 0;
      totalActions += actions;
    }

    const topSkillEntry = Object.entries(scores)
      .filter(([dimension]) => dimension !== "overall")
      .sort((left, right) => right[1] - left[1])[0];

    reputation = {
      overall_score: scores.overall ?? null,
      data_sources: new Set(reputationRecords.map((record) => record.source_id)).size,
      total_actions: totalActions,
      achievements: achievementCount?.total ?? 0,
      top_skill: topSkillEntry?.[0] ?? null,
      active_since: reputationRecords[0]?.submitted_at ?? null,
      detail_url: `https://agentidcard.org/agent/${agent.ail_id}/reputation`,
      profile_url: `https://agentidcard.org/agent/${agent.ail_id}`,
      badges_preview: recentBadges.slice(0, 3).map((badge) => ({
        badge_id: badge.badge_id,
        title: badge.title,
        rarity: badge.rarity,
      })),
    };
  }

  return {
    valid: true,
    ail_id: payload.ail_id,
    display_name: payload.display_name,
    role: payload.role,
    owner_org: payload.owner_org,
    issued: new Date(payload.iat * 1000).toISOString(),
    expires: new Date(payload.exp * 1000).toISOString(),
    revoked: false,
    reputation,
  };
}

export function filterVerificationResult(result, scope = "identity") {
  const scoped = {
    valid: result.valid,
    ail_id: result.ail_id,
    display_name: result.display_name,
    role: result.role,
    owner_org: result.owner_org,
    issued: result.issued,
    expires: result.expires,
    scope,
  };

  if (scope === "identity") {
    return scoped;
  }

  if (scope === "identity+reputation") {
    return {
      ...scoped,
      reputation: result.reputation,
    };
  }

  return {
    ...scoped,
    reputation: result.reputation,
    revoked: result.revoked,
  };
}
