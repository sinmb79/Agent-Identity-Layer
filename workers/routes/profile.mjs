import { Hono } from "hono";
import { listAgentBadges } from "../lib/achievements.mjs";
import { SCORE_DIMENSIONS } from "../lib/scoring.mjs";

export const profileRoutes = new Hono();

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scoreLabel(dimension) {
  switch (dimension) {
    case "strategic_reasoning":
      return "Strategic Reasoning";
    case "adaptability":
      return "Adaptability";
    case "cooperation":
      return "Cooperation";
    case "consistency":
      return "Consistency";
    case "overall":
      return "Overall";
    default:
      return dimension;
  }
}

function metricLabel(metric) {
  return metric
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizePlatformRecords(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const metrics = parseJson(row.metrics_json, {});
    if (!grouped.has(row.source)) {
      grouped.set(row.source, {
        seasons: new Set(),
        epochs: 0,
        lastActive: row.submitted_at,
        totals: new Map(),
      });
    }

    const summary = grouped.get(row.source);
    summary.epochs += 1;
    summary.lastActive = row.submitted_at;
    if (row.season !== null && row.season !== undefined) {
      summary.seasons.add(row.season);
    }

    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const current = summary.totals.get(key) ?? 0;
      summary.totals.set(key, current + value);
    }
  }

  return [...grouped.entries()].map(([source, summary]) => ({
    source,
    seasons_played: summary.seasons.size,
    total_epochs: summary.epochs,
    last_active: summary.lastActive,
    top_metrics: [...summary.totals.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([key, value]) => ({
        key,
        label: metricLabel(key),
        value: Number(value.toFixed(2)),
      })),
  }));
}

function buildRadarDataset(scores) {
  return SCORE_DIMENSIONS
    .filter((dimension) => dimension !== "overall")
    .map((dimension) => ({
      label: scoreLabel(dimension),
      value: Number(scores?.[dimension] ?? 0),
    }));
}

function buildTrendPoints(rows) {
  return (rows || [])
    .map((row) => ({
      epoch: row.epoch,
      overall: Number(parseJson(row.scores_json, {}).overall),
    }))
    .filter((entry) => Number.isFinite(entry.overall))
    .sort((left, right) => left.epoch - right.epoch);
}

function renderBadgeCards(badges) {
  if (!badges.length) {
    return `<div class="empty-state">No achievements yet.</div>`;
  }

  return badges.map((badge) => `
    <article class="badge-card">
      <div class="badge-top">
        <span class="badge-rarity">${escapeHtml(badge.rarity)}</span>
        <span class="badge-source">${escapeHtml(badge.source)}</span>
      </div>
      <h3>${escapeHtml(badge.title)}</h3>
      <p>${escapeHtml(badge.criteria ?? "")}</p>
      <div class="badge-meta">
        <span>${escapeHtml(badge.badge_id)}</span>
        <span>${escapeHtml(new Date(badge.earned_at).toISOString().slice(0, 10))}</span>
      </div>
    </article>
  `).join("");
}

function renderPlatformCards(platformRecords) {
  if (!platformRecords.length) {
    return `<div class="empty-state">No platform reputation records yet.</div>`;
  }

  return platformRecords.map((record) => `
    <article class="platform-card">
      <div class="platform-header">
        <h3>${escapeHtml(record.source)}</h3>
        <span>${record.total_epochs} epochs</span>
      </div>
      <div class="platform-meta">
        <span>Seasons ${record.seasons_played || 0}</span>
        <span>Last active ${escapeHtml(new Date(record.last_active).toISOString().slice(0, 10))}</span>
      </div>
      <div class="metric-grid">
        ${record.top_metrics.map((metric) => `
          <div class="metric-chip">
            <span>${escapeHtml(metric.label)}</span>
            <strong>${escapeHtml(metric.value)}</strong>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderScoreCards(scores) {
  const dimensions = SCORE_DIMENSIONS.filter((dimension) => dimension !== "overall");
  return dimensions.map((dimension) => `
    <div class="score-card">
      <span>${escapeHtml(scoreLabel(dimension))}</span>
      <strong>${scores?.[dimension] ?? "-"}</strong>
    </div>
  `).join("");
}

function renderProfileHtml({ agent, compositeScores, badges, platformRecords, trendPoints }) {
  const radarData = buildRadarDataset(compositeScores);
  const profileData = {
    radarLabels: radarData.map((entry) => entry.label),
    radarValues: radarData.map((entry) => entry.value),
    trendLabels: trendPoints.map((entry) => `Epoch ${entry.epoch}`),
    trendValues: trendPoints.map((entry) => entry.overall),
  };
  const nftArt = agent.nft_image_svg && agent.nft_image_svg.startsWith("<svg")
    ? agent.nft_image_svg
    : `<div class="nft-placeholder">${escapeHtml(agent.ail_id)}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(agent.display_name)} | Agent ID Card</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d0f14; --surface: #161b25; --surface-2: #111620; --border: #1e2535;
      --accent: #4f8ef7; --accent-dim: #2a4a8a; --green: #22c55e; --yellow: #eab308;
      --text: #e2e8f0; --muted: #64748b; --font: "Inter", system-ui, sans-serif;
      --mono: "JetBrains Mono", "Fira Code", monospace;
    }
    body {
      background:
        radial-gradient(circle at top left, rgba(79,142,247,0.12), transparent 28%),
        radial-gradient(circle at top right, rgba(34,197,94,0.08), transparent 20%),
        var(--bg);
      color: var(--text);
      font-family: var(--font);
      min-height: 100vh;
      padding: 24px;
    }
    a { color: inherit; text-decoration: none; }
    .shell { max-width: 1180px; margin: 0 auto; }
    .top-bar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 28px; color: var(--muted);
    }
    .logo { font-weight: 800; color: var(--text); }
    .logo span { color: var(--accent); }
    .hero {
      display: grid; grid-template-columns: 320px 1fr; gap: 24px;
      background: rgba(22, 27, 37, 0.92);
      border: 1px solid var(--border); border-radius: 24px; padding: 24px; margin-bottom: 24px;
      backdrop-filter: blur(12px);
    }
    .hero-art {
      min-height: 320px; border-radius: 20px; border: 1px solid var(--border);
      background: linear-gradient(160deg, rgba(79,142,247,0.12), rgba(17,22,32,0.92));
      display: flex; align-items: center; justify-content: center; overflow: hidden;
    }
    .hero-art svg { width: 100%; height: auto; display: block; }
    .nft-placeholder {
      font-size: 26px; font-weight: 800; color: var(--accent); text-align: center; padding: 24px;
    }
    .eyebrow {
      display: inline-flex; gap: 10px; align-items: center; font-size: 12px;
      text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 12px;
    }
    h1 { font-size: clamp(30px, 5vw, 48px); line-height: 1.05; margin-bottom: 12px; }
    .hero-subtitle { color: var(--muted); max-width: 60ch; margin-bottom: 24px; }
    .identity-grid {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px;
    }
    .identity-card, .score-card, .panel, .platform-card, .badge-card, .registration-card {
      background: var(--surface-2); border: 1px solid var(--border); border-radius: 16px;
    }
    .identity-card {
      padding: 14px 16px;
    }
    .identity-card span, .registration-card span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .identity-card strong, .registration-card strong { font-size: 15px; font-family: var(--mono); }
    .score-strip {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 14px;
    }
    .score-card { padding: 16px; }
    .score-card span { color: var(--muted); font-size: 12px; display: block; margin-bottom: 8px; }
    .score-card strong { font-size: 24px; }
    .layout { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; }
    .stack { display: grid; gap: 24px; }
    .panel { padding: 20px; }
    .panel h2 { font-size: 18px; margin-bottom: 14px; }
    .chart-wrap { min-height: 320px; }
    .badges-grid, .platform-grid, .registration-grid {
      display: grid; gap: 14px;
    }
    .badge-card, .platform-card, .registration-card {
      padding: 16px;
    }
    .badge-top, .platform-header, .platform-meta {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .badge-rarity {
      color: var(--yellow); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    }
    .badge-source, .platform-meta, .badge-card p, .empty-state {
      color: var(--muted); font-size: 13px;
    }
    .badge-card h3, .platform-card h3 { margin: 10px 0 8px; font-size: 18px; }
    .badge-meta, .metric-grid {
      display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px;
    }
    .badge-meta span, .metric-chip {
      border: 1px solid var(--border); border-radius: 999px; padding: 6px 10px; font-size: 12px;
      background: rgba(79,142,247,0.06);
    }
    .metric-chip { display: inline-flex; gap: 8px; align-items: center; }
    .metric-chip strong { color: var(--text); }
    .registration-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .registration-card { min-height: 96px; }
    .overall-score {
      display: inline-flex; align-items: center; gap: 12px; margin-bottom: 18px;
      padding: 12px 16px; border-radius: 999px; background: rgba(79,142,247,0.12);
      border: 1px solid rgba(79,142,247,0.22);
    }
    .overall-score strong { font-size: 28px; color: var(--accent); }
    .footer-note { margin-top: 22px; color: var(--muted); font-size: 12px; }
    @media (max-width: 980px) {
      .hero, .layout { grid-template-columns: 1fr; }
      .registration-grid, .score-strip, .identity-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 640px) {
      body { padding: 16px; }
      .hero { padding: 18px; }
      .identity-grid, .registration-grid, .score-strip { grid-template-columns: 1fr; }
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="shell">
    <div class="top-bar">
      <div class="logo">Agent ID <span>Card</span></div>
      <div style="flex:1"></div>
      <a href="/">Home</a>
      <a href="/register">Register</a>
    </div>

    <section class="hero">
      <div class="hero-art">${nftArt}</div>
      <div>
        <div class="eyebrow">
          <span>Public Agent Profile</span>
          <span>${escapeHtml(agent.role)}</span>
        </div>
        <h1>${escapeHtml(agent.display_name)}</h1>
        <p class="hero-subtitle">Verified AI agent identity, reputation signals, and earned achievements in one public card.</p>

        <div class="overall-score">
          <span>Overall Score</span>
          <strong>${compositeScores?.overall ?? "-"}</strong>
        </div>

        <div class="identity-grid">
          <div class="identity-card"><span>AIL ID</span><strong>${escapeHtml(agent.ail_id)}</strong></div>
          <div class="identity-card"><span>Owner</span><strong>${escapeHtml(agent.owner_org ?? "Independent")}</strong></div>
          <div class="identity-card"><span>Provider</span><strong>${escapeHtml(agent.provider ?? "Unknown")}</strong></div>
          <div class="identity-card"><span>Model</span><strong>${escapeHtml(agent.model ?? "Unknown")}</strong></div>
        </div>

        <div class="score-strip">
          ${renderScoreCards(compositeScores)}
        </div>
      </div>
    </section>

    <section class="layout">
      <div class="stack">
        <section class="panel">
          <h2>Composite Score Radar</h2>
          <div class="chart-wrap"><canvas id="radar-chart"></canvas></div>
        </section>

        <section class="panel">
          <h2>Platform Records</h2>
          <div class="platform-grid">${renderPlatformCards(platformRecords)}</div>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <h2>Achievement Showcase</h2>
          <div class="badges-grid">${renderBadgeCards(badges)}</div>
        </section>

        <section class="panel">
          <h2>Performance Trend</h2>
          <div class="chart-wrap"><canvas id="trend-chart"></canvas></div>
        </section>

        <section class="panel">
          <h2>Registration Info</h2>
          <div class="registration-grid">
            <div class="registration-card"><span>Issued At</span><strong>${escapeHtml(new Date(agent.issued_at).toISOString().slice(0, 10))}</strong></div>
            <div class="registration-card"><span>Token ID</span><strong>${escapeHtml(agent.nft_token_id ?? "Pending")}</strong></div>
            <div class="registration-card"><span>Profile Route</span><strong>/agent/${escapeHtml(agent.ail_id)}</strong></div>
          </div>
          <p class="footer-note">Chart.js powers the radar and trend visualizations on this page.</p>
        </section>
      </div>
    </section>
  </div>

  <script>
    const profileData = ${JSON.stringify(profileData)};

    const radarCanvas = document.getElementById("radar-chart");
    if (radarCanvas && profileData.radarValues.some((value) => Number.isFinite(value))) {
      new Chart(radarCanvas, {
        type: "radar",
        data: {
          labels: profileData.radarLabels,
          datasets: [{
            label: "Composite Scores",
            data: profileData.radarValues,
            backgroundColor: "rgba(79, 142, 247, 0.18)",
            borderColor: "#4f8ef7",
            pointBackgroundColor: "#4f8ef7",
            pointBorderColor: "#e2e8f0",
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              min: 0,
              max: 100,
              grid: { color: "rgba(100, 116, 139, 0.25)" },
              angleLines: { color: "rgba(100, 116, 139, 0.25)" },
              pointLabels: { color: "#e2e8f0" },
              ticks: { backdropColor: "transparent", color: "#64748b" },
            },
          },
          plugins: {
            legend: { labels: { color: "#e2e8f0" } },
          },
        },
      });
    }

    const trendCanvas = document.getElementById("trend-chart");
    if (trendCanvas && profileData.trendValues.length) {
      new Chart(trendCanvas, {
        type: "line",
        data: {
          labels: profileData.trendLabels,
          datasets: [{
            label: "Overall Score",
            data: profileData.trendValues,
            borderColor: "#22c55e",
            backgroundColor: "rgba(34, 197, 94, 0.14)",
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: { color: "#64748b" },
              grid: { color: "rgba(100, 116, 139, 0.15)" },
            },
            y: {
              min: 0,
              max: 100,
              ticks: { color: "#64748b" },
              grid: { color: "rgba(100, 116, 139, 0.15)" },
            },
          },
          plugins: {
            legend: { labels: { color: "#e2e8f0" } },
          },
        },
      });
    }
  </script>
</body>
</html>`;
}

profileRoutes.get("/agent/:ail_id", async (c) => {
  const ailId = c.req.param("ail_id");
  const db = c.env.DB;

  const agent = await db.prepare(`
    SELECT ail_id, display_name, role, provider, model, owner_org, issued_at, nft_image_svg, nft_token_id
    FROM agents
    WHERE ail_id = ?
  `).bind(ailId).first();

  if (!agent) {
    return c.html("<h1>Agent not found</h1>", 404);
  }

  const [scoreRows, recordRows, historyRows, badges] = await Promise.all([
    db.prepare(`
      SELECT dimension, score
      FROM composite_scores
      WHERE agent_id = ?
    `).bind(ailId).all(),
    db.prepare(`
      SELECT rr.season, rr.metrics_json, rr.submitted_at, rs.name AS source
      FROM reputation_records rr
      JOIN registered_sources rs ON rs.id = rr.source_id
      WHERE rr.agent_id = ?
      ORDER BY rr.submitted_at ASC
    `).bind(ailId).all(),
    db.prepare(`
      SELECT epoch, scores_json
      FROM performance_history
      WHERE agent_id = ?
      ORDER BY epoch ASC, recorded_at ASC
      LIMIT 12
    `).bind(ailId).all(),
    listAgentBadges(db, ailId),
  ]);

  const compositeScores = Object.fromEntries(
    (scoreRows.results || []).map((row) => [row.dimension, Number(row.score)])
  );
  const platformRecords = summarizePlatformRecords(recordRows.results || []);
  const trendPoints = buildTrendPoints(historyRows.results || []);

  return c.html(renderProfileHtml({
    agent,
    compositeScores,
    badges,
    platformRecords,
    trendPoints,
  }));
});
