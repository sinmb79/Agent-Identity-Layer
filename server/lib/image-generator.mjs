/**
 * AIL NFT Image Generator
 *
 * Generates a 600×600 SVG identity card for an AI agent.
 * The card contains three unique signal glyphs (Face, Fingerprint, Palmline)
 * derived deterministically from the agent's credential data.
 *
 * Output is a self-contained SVG string — no external dependencies,
 * no canvas, no file I/O. Suitable for on-chain storage or IPFS.
 */

// ---------------------------------------------------------------------------
// Metric computation (ported from demo/index.html)
// ---------------------------------------------------------------------------

const ROLE_MAP = {
  ceo: 88, cto: 78, cmo: 68, researcher: 52,
  implementation_engineer: 66, engineer: 64,
  operations_assistant: 58, review_engineer: 46,
  data_analyst: 54, assistant: 50,
};

const VERIFICATION_MAP = {
  self_asserted: 28,
  local_runtime_asserted: 54,
  platform_asserted: 78,
  cryptographically_signed: 96,
};

function computeMetrics(agentData) {
  const { agent, scope, delegation, verification } = agentData;

  const personality = ROLE_MAP[agent.role] ?? 55;

  let authority = 25;
  if (scope?.write_access) authority += 20;
  if ((scope?.repos ?? []).length) authority += 15;
  if (agent.owner?.type === "company" || agent.owner?.org) authority += 10;
  if (delegation?.approved_by) authority += 10;
  authority = Math.min(100, authority);

  let risk = 15;
  if (scope?.write_access) risk += 25;
  if (scope?.network === "restricted") risk += 18;
  if (scope?.network === "allowed") risk += 35;
  if (scope?.secrets === "indirect") risk += 15;
  if (scope?.secrets === "direct") risk += 30;
  if ((delegation?.chain_depth ?? 0) > 1) risk += 10;
  risk = Math.min(100, risk);

  let provenance = VERIFICATION_MAP[verification?.strength] ?? 40;
  if (delegation?.delegated_by?.agent_id) provenance += 6;
  provenance = Math.min(100, provenance);

  return { personality, authority, risk, provenance };
}

function metricColor(v) {
  if (v >= 80) return "#34d399";
  if (v >= 55) return "#60a5fa";
  if (v >= 35) return "#fbbf24";
  return "#f87171";
}

function riskLabel(v) {
  if (v < 30) return "LOW";
  if (v < 60) return "MEDIUM";
  return "HIGH";
}

// ---------------------------------------------------------------------------
// Glyph drawers — each returns an SVG <g> element string
// cx, cy = center; size = bounding box half-width
// ---------------------------------------------------------------------------

function drawFace(m, cx, cy, size) {
  const s = size / 130; // scale factor relative to demo's 260-wide viewBox
  const eyeTilt = (m.personality - 50) / 12;
  const mouthCurve = (50 - m.risk) / 8;
  const jaw = 72 + m.authority / 8;
  const aura = metricColor(m.provenance);

  // Map original coords (130,110 center) to (cx, cy)
  const tx = (x) => cx + (x - 130) * s;
  const ty = (y) => cy + (y - 110) * s;
  const sc = (v) => v * s;

  return `
    <circle cx="${cx}" cy="${cy}" r="${sc(74)}" fill="${aura}" fill-opacity="0.12"/>
    <path d="M ${tx(70)} ${ty(80)}
             Q ${tx(130)} ${ty(20)} ${tx(190)} ${ty(80)}
             L ${tx(170 + jaw/5)} ${ty(165)}
             Q ${tx(130)} ${ty(205)} ${tx(90 - jaw/5)} ${ty(165)} Z"
          fill="#132346" stroke="#5b7fc7" stroke-width="${sc(2)}"/>
    <path d="M ${tx(92)} ${ty(95)} Q ${tx(108)} ${ty(95-eyeTilt)} ${tx(124)} ${ty(95)}"
          stroke="#eef2ff" stroke-width="${sc(5)}" stroke-linecap="round" fill="none"/>
    <path d="M ${tx(136)} ${ty(95)} Q ${tx(152)} ${ty(95+eyeTilt)} ${tx(168)} ${ty(95)}"
          stroke="#eef2ff" stroke-width="${sc(5)}" stroke-linecap="round" fill="none"/>
    <circle cx="${tx(108)}" cy="${ty(110)}" r="${sc(5)}" fill="#60a5fa"/>
    <circle cx="${tx(152)}" cy="${ty(110)}" r="${sc(5)}" fill="#60a5fa"/>
    <path d="M ${tx(130)} ${ty(115)} L ${tx(126)} ${ty(138)} L ${tx(136)} ${ty(138)}"
          stroke="#9fb0d9" stroke-width="${sc(3)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M ${tx(98)} ${ty(158)} Q ${tx(130)} ${ty(158+mouthCurve)} ${tx(162)} ${ty(158)}"
          stroke="${metricColor(100-m.risk)}" stroke-width="${sc(4)}" fill="none" stroke-linecap="round"/>
  `;
}

function drawFingerprint(m, delegation, cx, cy, size) {
  const depth = delegation?.chain_depth ?? 0;
  const stroke = metricColor(m.provenance);
  const s = size / 78;
  let out = "";

  for (let i = 0; i < 6; i++) {
    const rx = (78 - i * 8 + depth * 4) * s;
    const ry = (60 - i * 6 + (m.authority - 50) / 12) * s;
    const wobble = (4 + i * 1.5 + (100 - m.provenance) / 30) * s;
    let d = "";
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.11) {
      const w = Math.sin(a * (2.2 + depth) + i) * wobble;
      const x = cx + Math.cos(a) * (rx + w);
      const y = cy + Math.sin(a) * (ry + w * 0.8);
      d += (a === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    }
    out += `<path d="${d}Z" fill="none" stroke="${stroke}" stroke-opacity="${(0.25 + i*0.1).toFixed(2)}" stroke-width="${(1.4 + i*0.15).toFixed(2)}"/>`;
  }
  const r = 18 * s;
  out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${stroke}" fill-opacity="0.12" stroke="${stroke}" stroke-width="2"/>`;
  return out;
}

function drawPalm(m, delegation, cx, cy, size) {
  const chain = delegation?.chain_depth ?? 0;
  const main = metricColor(m.authority);
  const aux = metricColor(m.provenance);
  const riskColor = metricColor(100 - m.risk);
  const s = size / 85;

  const tx = (x) => cx + (x - 130) * s;
  const ty = (y) => cy + (y - 110) * s;
  const sc = (v) => v * s;

  return `
    <path d="M ${tx(54)} ${ty(175)} Q ${tx(42)} ${ty(120)} ${tx(62)} ${ty(78)}
             Q ${tx(78)} ${ty(44)} ${tx(110)} ${ty(46)} Q ${tx(128)} ${ty(24)} ${tx(154)} ${ty(34)}
             Q ${tx(176)} ${ty(28)} ${tx(196)} ${ty(46)} Q ${tx(214)} ${ty(64)} ${tx(208)} ${ty(92)}
             Q ${tx(220)} ${ty(118)} ${tx(212)} ${ty(144)} Q ${tx(200)} ${ty(182)} ${tx(166)} ${ty(188)}
             L ${tx(92)} ${ty(188)} Q ${tx(64)} ${ty(188)} ${tx(54)} ${ty(175)} Z"
          fill="#132346" stroke="#5b7fc7" stroke-width="${sc(2)}"/>
    <path d="M ${tx(84)} ${ty(86)} Q ${tx(128)} ${ty(78-chain*8)} ${tx(180)} ${ty(98)}"
          stroke="${main}" stroke-width="${sc(4)}" fill="none" stroke-linecap="round"/>
    <path d="M ${tx(72)} ${ty(116)} Q ${tx(126)} ${ty(112 + m.risk/12)} ${tx(190)} ${ty(124)}"
          stroke="${aux}" stroke-width="${sc(4)}" fill="none" stroke-linecap="round"/>
    <path d="M ${tx(90)} ${ty(150)} Q ${tx(126)} ${ty(140 - m.authority/18)} ${tx(170)} ${ty(144)}"
          stroke="${riskColor}" stroke-width="${sc(4)}" fill="none" stroke-linecap="round"/>
    <path d="M ${tx(120)} ${ty(58)} Q ${tx(122 + chain*10)} ${ty(92)} ${tx(118 + chain*8)} ${ty(126)}"
          stroke="#eef2ff" stroke-opacity="0.65" stroke-width="${sc(3)}" fill="none" stroke-linecap="round"/>
  `;
}

// ---------------------------------------------------------------------------
// Barcode-like strip (deterministic from ail_id seed)
// ---------------------------------------------------------------------------
function drawBarcode(ailId, x, y, w, h) {
  const seed = ailId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  let bars = "";
  let dx = 0;
  const count = 42;
  for (let i = 0; i < count; i++) {
    const width = 1 + ((seed * (i + 7) * 13) % 3);
    const filled = ((seed + i * 17) % 5) !== 0;
    if (filled) {
      bars += `<rect x="${x + dx}" y="${y}" width="${width}" height="${h}" fill="#4f8ef7" fill-opacity="0.7"/>`;
    }
    dx += width + 1;
    if (dx > w) break;
  }
  return bars;
}

// ---------------------------------------------------------------------------
// Holographic border gradient
// ---------------------------------------------------------------------------
function holoGradient(id) {
  return `
    <defs>
      <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#4f8ef7" stop-opacity="0.9"/>
        <stop offset="25%"  stop-color="#a78bfa" stop-opacity="0.9"/>
        <stop offset="50%"  stop-color="#34d399" stop-opacity="0.9"/>
        <stop offset="75%"  stop-color="#fbbf24" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#4f8ef7" stop-opacity="0.9"/>
      </linearGradient>
      <linearGradient id="${id}_bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#0d0f14"/>
        <stop offset="100%" stop-color="#0f1b2d"/>
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
  `;
}

// ---------------------------------------------------------------------------
// Main: generateIdCardSvg
// ---------------------------------------------------------------------------

/**
 * Generate a 600×600 SVG identity card for an AI agent.
 *
 * @param {object} agentData  - v1 envelope (or partial: { agent, scope, delegation, verification, ail_id })
 * @returns {string}          - complete SVG string
 */
export function generateIdCardSvg(agentData) {
  const { agent, scope, delegation, verification, ail_id } = agentData;
  const m = computeMetrics(agentData);

  const displayName = agent?.display_name ?? "Unknown Agent";
  const role        = agent?.role ?? "unknown";
  const provider    = agent?.provider ?? "—";
  const model       = agent?.model ?? "";
  const ownerOrg    = agent?.owner?.org ?? agentData.owner?.org ?? "—";
  const ailId       = ail_id ?? "AIL-0000-00000";
  const issuedAt    = agentData.credential?.issued_at
    ? agentData.credential.issued_at.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const isSigned    = verification?.signed === true;
  const riskLvl     = riskLabel(m.risk);
  const riskColor   = metricColor(100 - m.risk);

  // Layout constants
  const W = 600, H = 600;
  const HEADER_H = 72;
  const MAIN_TOP = HEADER_H + 8;
  const GLYPH_ROW_TOP = 360;
  const FOOTER_TOP = 510;
  const GLYPH_SIZE = 70;

  // Face glyph: center of left main area
  const FACE_CX = 150, FACE_CY = MAIN_TOP + 120;
  // Fingerprint: bottom left
  const FP_CX = 110, FP_CY = GLYPH_ROW_TOP + 70;
  // Palmline: bottom center
  const PALM_CX = 310, PALM_CY = GLYPH_ROW_TOP + 70;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${holoGradient("holo")}

  <!-- Card background -->
  <rect width="${W}" height="${H}" rx="28" fill="url(#holo_bg)"/>

  <!-- Holographic border -->
  <rect width="${W}" height="${H}" rx="28" fill="none" stroke="url(#holo)" stroke-width="3"/>

  <!-- Inner border -->
  <rect x="6" y="6" width="${W-12}" height="${H-12}" rx="24" fill="none" stroke="#1e2535" stroke-width="1"/>

  <!-- ── HEADER ─────────────────────────────────────────── -->
  <rect x="0" y="0" width="${W}" height="${HEADER_H}" rx="28" fill="#0a1220"/>
  <rect x="0" y="44" width="${W}" height="${HEADER_H - 44}" fill="#0a1220"/>
  <rect x="0" y="${HEADER_H}" width="${W}" height="1" fill="#1e2535"/>

  <!-- 22B Labs logo text -->
  <text x="24" y="28" font-family="Inter, Arial, sans-serif" font-size="11"
        font-weight="700" letter-spacing="3" fill="#64748b">22B LABS</text>
  <text x="24" y="52" font-family="Inter, Arial, sans-serif" font-size="16"
        font-weight="700" letter-spacing="1" fill="#e2e8f0">AGENT IDENTITY LAYER</text>

  <!-- Verified badge -->
  ${isSigned ? `
  <rect x="${W-120}" y="18" width="96" height="36" rx="8" fill="#052e16" stroke="#22c55e" stroke-width="1"/>
  <text x="${W-97}" y="33" font-family="Inter, Arial, sans-serif" font-size="9"
        font-weight="600" fill="#22c55e" letter-spacing="1">◈ VERIFIED</text>
  <text x="${W-97}" y="46" font-family="Inter, Arial, sans-serif" font-size="8"
        fill="#22c55e" fill-opacity="0.7">CRYPTOGRAPHICALLY</text>
  ` : `
  <rect x="${W-108}" y="18" width="84" height="36" rx="8" fill="#1c1005" stroke="#eab308" stroke-width="1"/>
  <text x="${W-97}" y="39" font-family="Inter, Arial, sans-serif" font-size="9"
        font-weight="600" fill="#eab308" letter-spacing="1">⚠ UNVERIFIED</text>
  `}

  <!-- ── FACE GLYPH (left column) ──────────────────────── -->
  <rect x="20" y="${MAIN_TOP}" width="250" height="260" rx="16" fill="#081121" stroke="#1e2535"/>
  <text x="145" y="${MAIN_TOP + 20}" font-family="Inter, Arial, sans-serif" font-size="10"
        fill="#64748b" text-anchor="middle" letter-spacing="2">FACE</text>
  <g filter="url(#glow)">
    ${drawFace(m, FACE_CX, FACE_CY, 90)}
  </g>
  <!-- Metric badge under face -->
  <rect x="20" y="${MAIN_TOP + 230}" width="250" height="30" rx="0" fill="#0d1826"/>
  <rect x="20" y="${MAIN_TOP + 230}" width="${250 * m.personality / 100}" height="30" rx="0"
        fill="${metricColor(m.personality)}" fill-opacity="0.15"/>
  <text x="35" y="${MAIN_TOP + 250}" font-family="Inter, Arial, sans-serif" font-size="9"
        fill="#64748b" letter-spacing="1">PERSONALITY</text>
  <text x="255" y="${MAIN_TOP + 250}" font-family="Inter, Arial, sans-serif" font-size="9"
        font-weight="700" fill="${metricColor(m.personality)}" text-anchor="end">${m.personality}</text>

  <!-- ── INFO (right column) ───────────────────────────── -->
  <!-- AIL ID -->
  <text x="290" y="${MAIN_TOP + 24}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="22" font-weight="700" fill="#4f8ef7" letter-spacing="1">${ailId}</text>

  <!-- Name -->
  <text x="290" y="${MAIN_TOP + 70}" font-family="Inter, Arial, sans-serif"
        font-size="26" font-weight="700" fill="#e2e8f0">${escSvg(displayName)}</text>

  <!-- Divider -->
  <rect x="290" y="${MAIN_TOP + 82}" width="280" height="1" fill="#1e2535"/>

  <!-- Role -->
  <text x="290" y="${MAIN_TOP + 104}" font-family="Inter, Arial, sans-serif"
        font-size="10" fill="#64748b" letter-spacing="2">ROLE</text>
  <text x="290" y="${MAIN_TOP + 122}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="14" fill="#a5c3ff">${escSvg(role)}</text>

  <!-- Provider -->
  <text x="290" y="${MAIN_TOP + 148}" font-family="Inter, Arial, sans-serif"
        font-size="10" fill="#64748b" letter-spacing="2">PROVIDER</text>
  <text x="290" y="${MAIN_TOP + 166}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="14" fill="#a5c3ff">${escSvg(provider)}${model ? ` · ${escSvg(model)}` : ""}</text>

  <!-- Owner -->
  <text x="290" y="${MAIN_TOP + 192}" font-family="Inter, Arial, sans-serif"
        font-size="10" fill="#64748b" letter-spacing="2">OWNER</text>
  <text x="290" y="${MAIN_TOP + 210}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="14" fill="#a5c3ff">${escSvg(ownerOrg)}</text>

  <!-- Risk badge -->
  <rect x="290" y="${MAIN_TOP + 228}" width="90" height="26" rx="6"
        fill="${riskColor}" fill-opacity="0.12" stroke="${riskColor}" stroke-width="1"/>
  <text x="335" y="${MAIN_TOP + 245}" font-family="Inter, Arial, sans-serif"
        font-size="10" font-weight="700" fill="${riskColor}" text-anchor="middle"
        letter-spacing="1">RISK · ${riskLvl}</text>

  <!-- Auth score -->
  <rect x="392" y="${MAIN_TOP + 228}" width="90" height="26" rx="6"
        fill="${metricColor(m.authority)}" fill-opacity="0.12" stroke="${metricColor(m.authority)}" stroke-width="1"/>
  <text x="437" y="${MAIN_TOP + 245}" font-family="Inter, Arial, sans-serif"
        font-size="10" font-weight="700" fill="${metricColor(m.authority)}" text-anchor="middle"
        letter-spacing="1">AUTH · ${m.authority}</text>

  <!-- ── GLYPH ROW ──────────────────────────────────────── -->
  <rect x="0" y="${GLYPH_ROW_TOP - 8}" width="${W}" height="1" fill="#1e2535"/>

  <!-- Fingerprint -->
  <rect x="20" y="${GLYPH_ROW_TOP}" width="180" height="150" rx="14" fill="#081121" stroke="#1e2535"/>
  <text x="110" y="${GLYPH_ROW_TOP + 18}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle" letter-spacing="2">FINGERPRINT</text>
  <g filter="url(#glow)">
    ${drawFingerprint(m, delegation, FP_CX, FP_CY, GLYPH_SIZE)}
  </g>
  <text x="110" y="${GLYPH_ROW_TOP + 140}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle">PROV · ${m.provenance}</text>

  <!-- Palmline -->
  <rect x="210" y="${GLYPH_ROW_TOP}" width="180" height="150" rx="14" fill="#081121" stroke="#1e2535"/>
  <text x="300" y="${GLYPH_ROW_TOP + 18}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle" letter-spacing="2">PALMLINE</text>
  <g filter="url(#glow)">
    ${drawPalm(m, delegation, PALM_CX, PALM_CY, GLYPH_SIZE)}
  </g>
  <text x="300" y="${GLYPH_ROW_TOP + 140}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle">AUTH · ${m.authority}</text>

  <!-- Metrics mini-bars (right of glyph row) -->
  <rect x="400" y="${GLYPH_ROW_TOP}" width="180" height="150" rx="14" fill="#081121" stroke="#1e2535"/>
  ${renderMiniMetrics(m, 410, GLYPH_ROW_TOP + 16)}

  <!-- ── FOOTER ─────────────────────────────────────────── -->
  <rect x="0" y="${FOOTER_TOP - 1}" width="${W}" height="1" fill="#1e2535"/>
  <rect x="0" y="${FOOTER_TOP}" width="${W}" height="${H - FOOTER_TOP}" rx="0" fill="#0a1220"/>
  <rect x="0" y="${H - 28}" width="${W}" height="28" rx="28" fill="#0a1220"/>

  <!-- Barcode strip -->
  ${drawBarcode(ailId, 24, FOOTER_TOP + 12, 320, 28)}

  <!-- Issued / network -->
  <text x="360" y="${FOOTER_TOP + 20}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" letter-spacing="1">ISSUED</text>
  <text x="360" y="${FOOTER_TOP + 34}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="11" fill="#a5c3ff">${issuedAt}</text>

  <text x="460" y="${FOOTER_TOP + 20}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" letter-spacing="1">ISSUER</text>
  <text x="460" y="${FOOTER_TOP + 34}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="11" fill="#a5c3ff">22blabs.ai</text>

  <!-- Bottom tagline -->
  <text x="${W/2}" y="${H - 10}" font-family="Inter, Arial, sans-serif" font-size="9"
        fill="#1e2535" text-anchor="middle" letter-spacing="2">22B LABS · AGENT IDENTITY LAYER · ${ailId}</text>

</svg>`;
}

// ---------------------------------------------------------------------------
// Mini metrics bar chart (inside glyph row right panel)
// ---------------------------------------------------------------------------
function renderMiniMetrics(m, x, y) {
  const items = [
    ["PERSONALITY", m.personality],
    ["AUTHORITY",   m.authority],
    ["RISK",        m.risk],
    ["PROVENANCE",  m.provenance],
  ];
  const BAR_W = 156, BAR_H = 10, GAP = 28;

  return items.map(([label, value], i) => {
    const vy = y + i * GAP;
    const color = label === "RISK" ? metricColor(100 - value) : metricColor(value);
    const fillW = Math.max(2, (value / 100) * BAR_W);
    return `
      <text x="${x}" y="${vy + 9}" font-family="Inter, Arial, sans-serif"
            font-size="8" fill="#64748b" letter-spacing="1">${label}</text>
      <text x="${x + BAR_W}" y="${vy + 9}" font-family="Inter, Arial, sans-serif"
            font-size="8" font-weight="700" fill="${color}" text-anchor="end">${value}</text>
      <rect x="${x}" y="${vy + 12}" width="${BAR_W}" height="${BAR_H}" rx="5" fill="#0d1826"/>
      <rect x="${x}" y="${vy + 12}" width="${fillW}" height="${BAR_H}" rx="5"
            fill="${color}" fill-opacity="0.8"/>
    `;
  }).join("");
}

// ---------------------------------------------------------------------------
// ERC-721 metadata JSON
// ---------------------------------------------------------------------------

/**
 * Generate ERC-721 compatible metadata for the NFT.
 * The image is embedded as a base64-encoded SVG data URI.
 */
export function generateNftMetadata(agentData) {
  const { agent, scope, delegation, verification, ail_id } = agentData;
  const m = computeMetrics(agentData);

  const svg = generateIdCardSvg(agentData);
  const svgB64 = Buffer.from(svg).toString("base64");
  const imageUri = `data:image/svg+xml;base64,${svgB64}`;

  return {
    name: `${agent?.display_name ?? "Agent"} · ${ail_id ?? "AIL"}`,
    description:
      `22B Labs Agent Identity Credential. ` +
      `Role: ${agent?.role ?? "unknown"}. ` +
      `Issued by 22blabs.ai.`,
    image: imageUri,
    external_url: `https://22blabs.ai/agents/${ail_id}`,
    attributes: [
      { trait_type: "AIL ID",       value: ail_id ?? "unregistered" },
      { trait_type: "Role",         value: agent?.role ?? "unknown" },
      { trait_type: "Provider",     value: agent?.provider ?? "unknown" },
      { trait_type: "Network",      value: scope?.network ?? "unknown" },
      { trait_type: "Write Access", value: scope?.write_access ? "Yes" : "No" },
      { trait_type: "Secrets",      value: scope?.secrets ?? "none" },
      { trait_type: "Verification", value: verification?.strength ?? "self_asserted" },
      { trait_type: "Risk Level",   value: riskLabel(m.risk) },
      { trait_type: "Authority",    value: m.authority },
      { trait_type: "Provenance",   value: m.provenance },
      { trait_type: "Chain Depth",  value: delegation?.chain_depth ?? 0 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function escSvg(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
