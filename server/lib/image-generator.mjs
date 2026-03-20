/**
 * AIL NFT Image Generator
 *
 * Generates a 600×600 SVG identity card for an AI agent.
 *
 * Each card contains three unique signal glyphs derived deterministically
 * from the agent's AIL ID + display name + owner org via a seeded PRNG.
 *
 * Fingerprint diversity: ~4 billion unique patterns (2^32 seed space),
 * driven by ail_id so every registered agent gets a distinct glyph even
 * when role/scope are identical.
 *
 * Fingerprint types (seeded):
 *   35% whorl   — concentric oval ridges with seeded rotation and aspect ratio
 *   37% loop    — U-shaped ridges with seeded direction, spread, and curvature
 *   28% arch    — plain or tented arches with seeded height and control points
 */

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32 + FNV-1a string hash
// Every call to rng() is deterministic and unique per seed string.
// ---------------------------------------------------------------------------

function fnv32a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function makeRng(seedStr) {
  let s = fnv32a(String(seedStr));
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Metric computation — role/scope → 4 visual scores (0-100)
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

  const personality = ROLE_MAP[agent?.role] ?? 55;

  let authority = 25;
  if (scope?.write_access) authority += 20;
  if ((scope?.repos ?? []).length) authority += 15;
  if (agent?.owner?.type === "company" || agent?.owner?.org) authority += 10;
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
// Glyph seed — derived from ail_id + display_name + owner_org
// This ensures every registered agent has a unique visual identity
// even when role/scope are identical.
// ---------------------------------------------------------------------------

function buildGlyphSeed(agentData) {
  const ailId   = agentData.ail_id ?? "AIL-0000-00000";
  const name    = agentData.agent?.display_name ?? "unknown";
  const org     = agentData.owner?.org ?? agentData.agent?.owner?.org ?? "none";
  return `${ailId}:${name}:${org}`;
}

// ---------------------------------------------------------------------------
// Face glyph — seeded head geometry, eye shape, nose, mouth
// ---------------------------------------------------------------------------

function drawFace(glyphSeed, m, cx, cy, size) {
  const rng = makeRng(glyphSeed + ":face");
  const r   = () => rng();
  const aura = metricColor(m.provenance);

  // Head geometry (seeded)
  const headW   = size * (0.52 + r() * 0.2);
  const headH   = size * (0.65 + r() * 0.2);
  const jawW    = headW * (0.62 + r() * 0.24);
  const chinH   = headH * (0.82 + r() * 0.16);

  const hPath = [
    `M ${f(cx - headW * 0.48)} ${f(cy - headH * 0.28)}`,
    `Q ${f(cx - headW * (0.62 + r()*0.14))} ${f(cy - headH * (0.68 + r()*0.16))},`,
    `  ${f(cx)} ${f(cy - headH * (0.84 + r()*0.12))}`,
    `Q ${f(cx + headW * (0.62 + r()*0.14))} ${f(cy - headH * (0.68 + r()*0.16))},`,
    `  ${f(cx + headW * 0.48)} ${f(cy - headH * 0.28)}`,
    `Q ${f(cx + jawW * (0.52 + r()*0.14))} ${f(cy + headH * 0.1)},`,
    `  ${f(cx + jawW * (0.28 + r()*0.1))} ${f(cy + chinH * (0.52 + r()*0.14))}`,
    `Q ${f(cx + jawW * 0.08)} ${f(cy + chinH * (0.80 + r()*0.12))},`,
    `  ${f(cx)} ${f(cy + chinH * (0.86 + r()*0.1))}`,
    `Q ${f(cx - jawW * 0.08)} ${f(cy + chinH * (0.80 + r()*0.12))},`,
    `  ${f(cx - jawW * (0.28 + r()*0.1))} ${f(cy + chinH * (0.52 + r()*0.14))}`,
    `Q ${f(cx - jawW * (0.52 + r()*0.14))} ${f(cy + headH * 0.1)},`,
    `  ${f(cx - headW * 0.48)} ${f(cy - headH * 0.28)} Z`,
  ].join(" ");

  // Eyes
  const eyeY   = cy - headH * (0.04 + r() * 0.08);
  const eyeGap = headW * (0.24 + r() * 0.12);
  const eyeW   = size * (0.13 + r() * 0.08);
  const eyeH   = eyeW * (0.32 + r() * 0.36);
  const eyeTlt = (r() - 0.5) * 7;
  const lx = cx - eyeGap;
  const rx = cx + eyeGap;
  const pupilR = eyeH * (0.5 + r() * 0.28);
  const pupilC = metricColor(m.personality);

  // Nose
  const noseY = cy + headH * (0.04 + r() * 0.08);
  const noseW = size * (0.055 + r() * 0.055);
  const noseH = size * (0.11 + r() * 0.08);

  // Mouth
  const mouthY = cy + headH * (0.30 + r() * 0.12);
  const mouthW = jawW * (0.28 + r() * 0.2);
  const mouthC = (r() - 0.5) * size * 0.11;
  const mouthColor = metricColor(100 - m.risk);

  return `
    <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(size * 0.88)}" fill="${aura}" fill-opacity="0.10"/>
    <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(size * 0.97)}" fill="none" stroke="${aura}" stroke-opacity="0.18" stroke-width="1"/>
    <path d="${hPath}" fill="#081a30" stroke="#5b7fc7" stroke-width="1.6"/>
    <path d="M ${f(lx-eyeW*0.92)} ${f(eyeY-eyeH*2.2+eyeTlt*0.5)}
             Q ${f(lx)} ${f(eyeY-eyeH*2.75-eyeTlt)},
               ${f(lx+eyeW*0.92)} ${f(eyeY-eyeH*2.2-eyeTlt*0.3)}"
          stroke="#9fb0d9" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M ${f(rx-eyeW*0.92)} ${f(eyeY-eyeH*2.2+eyeTlt*0.3)}
             Q ${f(rx)} ${f(eyeY-eyeH*2.75+eyeTlt)},
               ${f(rx+eyeW*0.92)} ${f(eyeY-eyeH*2.2-eyeTlt*0.5)}"
          stroke="#9fb0d9" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <ellipse cx="${f(lx)}" cy="${f(eyeY)}" rx="${f(eyeW)}" ry="${f(eyeH)}" fill="#0a1a30" stroke="#7fa8d8" stroke-width="1.2"/>
    <ellipse cx="${f(rx)}" cy="${f(eyeY)}" rx="${f(eyeW)}" ry="${f(eyeH)}" fill="#0a1a30" stroke="#7fa8d8" stroke-width="1.2"/>
    <circle cx="${f(lx)}" cy="${f(eyeY)}" r="${f(pupilR)}" fill="${pupilC}" fill-opacity="0.85"/>
    <circle cx="${f(rx)}" cy="${f(eyeY)}" r="${f(pupilR)}" fill="${pupilC}" fill-opacity="0.85"/>
    <circle cx="${f(lx+eyeW*0.22)}" cy="${f(eyeY-eyeH*0.22)}" r="${f(pupilR*0.22)}" fill="white" fill-opacity="0.55"/>
    <circle cx="${f(rx+eyeW*0.22)}" cy="${f(eyeY-eyeH*0.22)}" r="${f(pupilR*0.22)}" fill="white" fill-opacity="0.55"/>
    <path d="M ${f(cx-noseW*0.28)} ${f(eyeY+eyeH)}
             L ${f(cx-noseW)} ${f(noseY+noseH*0.48)}
             Q ${f(cx-noseW*1.08)} ${f(noseY+noseH)}, ${f(cx)} ${f(noseY+noseH)}
             Q ${f(cx+noseW*1.08)} ${f(noseY+noseH)}, ${f(cx+noseW)} ${f(noseY+noseH*0.48)}
             L ${f(cx+noseW*0.28)} ${f(eyeY+eyeH)}"
          stroke="#9fb0d9" stroke-opacity="0.45" stroke-width="1.1" fill="none" stroke-linecap="round"/>
    <path d="M ${f(cx-mouthW)} ${f(mouthY)}
             Q ${f(cx)} ${f(mouthY+mouthC)}, ${f(cx+mouthW)} ${f(mouthY)}"
          stroke="${mouthColor}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  `;
}

// ---------------------------------------------------------------------------
// Fingerprint glyph — seeded whorl / loop / arch
//
// Diversity source: glyphSeed (contains ail_id) → fnv32a → mulberry32 PRNG
// Each ridge's geometry is individually randomised → near-infinite unique patterns.
// ---------------------------------------------------------------------------

function drawFingerprint(glyphSeed, m, cx, cy, size) {
  const rng   = makeRng(glyphSeed + ":fingerprint");
  const r     = () => rng();
  const w     = (scale) => (r() - 0.5) * scale;

  const stroke     = metricColor(m.provenance);
  const strokeAlt  = metricColor(m.authority);

  // ── Type selection (seeded) ─────────────────────────────────────────────
  const typeRoll = r();
  const fpType   = typeRoll < 0.35 ? "whorl" : typeRoll < 0.72 ? "loop" : "arch";

  // Core position: slightly off-centre (seeded)
  const coreX  = cx + w(size * 0.26);
  const coreY  = cy + w(size * 0.20);
  const nRidge = 11 + Math.floor(r() * 6);   // 11–16 ridges

  let out = `<!-- ${fpType} -->`;

  // ── WHORL ───────────────────────────────────────────────────────────────
  if (fpType === "whorl") {
    const axisAngle   = r() * Math.PI;          // overall rotation of the whorl
    const aspectRatio = 0.48 + r() * 0.42;      // how oval (1.0 = circle)
    const startAngle  = r() * Math.PI * 2;
    const rotRate     = (0.06 + r() * 0.20) * (r() < 0.5 ? 1 : -1); // CW or CCW drift

    for (let i = 0; i < nRidge; i++) {
      const t   = i / (nRidge - 1);
      const Rx  = size * (0.07 + t * 0.83);
      const Ry  = Rx * aspectRatio;
      const ang = axisAngle + rotRate * i;

      // Per-ridge pre-sampled wobble array (uses RNG in deterministic order)
      const nPts = 60;
      const wobs = Array.from({ length: nPts + 1 }, () => w(size * (0.026 + t * 0.030)));

      let d = "";
      for (let j = 0; j <= nPts; j++) {
        const a  = (j / nPts) * Math.PI * 2 + startAngle;
        const wb = wobs[j];
        const lx = Math.cos(a) * (Rx + wb);
        const ly = Math.sin(a) * (Ry + wb * 0.72);
        const px = coreX + lx * Math.cos(ang) - ly * Math.sin(ang);
        const py = coreY + lx * Math.sin(ang) + ly * Math.cos(ang);
        d += j === 0 ? `M ${f(px)} ${f(py)}` : ` L ${f(px)} ${f(py)}`;
      }
      out += `<path d="${d} Z" fill="none" stroke="${stroke}"
                    stroke-opacity="${(0.14 + t * 0.58).toFixed(2)}"
                    stroke-width="${(0.55 + t * 1.15).toFixed(2)}"/>`;
    }
    out += `<circle cx="${f(coreX)}" cy="${f(coreY)}" r="2.8"
                    fill="${stroke}" fill-opacity="0.75"/>`;

  // ── LOOP ────────────────────────────────────────────────────────────────
  } else if (fpType === "loop") {
    const loopDir = r() < 0.5 ? 1 : -1;   // +1 = right loop, -1 = left loop

    for (let i = 0; i < nRidge; i++) {
      const t      = i / (nRidge - 1);
      const spread = size * (0.10 + t * 0.73) * (0.80 + r() * 0.38);
      const height = size * (0.76 + r() * 0.14) * (0.52 + t * 0.48);

      const sy = coreY + height * (0.84 + r() * 0.14);
      const ey = coreY - height * (0.84 + r() * 0.14);
      const sx = coreX - loopDir * spread * 0.86 + w(size * 0.055);
      const ex = coreX - loopDir * spread * 0.86 + w(size * 0.055);

      const bulge = loopDir * spread * (1.52 + r() * 0.92);
      const cp1x  = sx + bulge + w(size * 0.075);
      const cp1y  = sy - height * (0.26 + r() * 0.26);
      const cp2x  = ex + bulge + w(size * 0.075);
      const cp2y  = ey + height * (0.26 + r() * 0.26);

      out += `<path d="M ${f(sx)} ${f(sy)} C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(ex)} ${f(ey)}"
                    fill="none" stroke="${stroke}"
                    stroke-opacity="${(0.14 + t * 0.58).toFixed(2)}"
                    stroke-width="${(0.55 + t * 1.15).toFixed(2)}"
                    stroke-linecap="round"/>`;
    }
    out += `<circle cx="${f(coreX)}" cy="${f(coreY)}" r="2.8"
                    fill="${strokeAlt}" fill-opacity="0.80"/>`;

  // ── ARCH (plain or tented) ───────────────────────────────────────────────
  } else {
    const tented = r() < 0.48;

    for (let i = 0; i < nRidge; i++) {
      const t     = i / (nRidge - 1);
      const archW = size * (0.68 + r() * 0.24);
      const archH = size * (0.04 + t * 0.76) * (0.76 + r() * 0.46);
      const yBase = coreY + size * 0.38 - t * size * 0.70;

      const sx = coreX - archW + w(size * 0.04);
      const ex = coreX + archW + w(size * 0.04);

      let d;
      if (tented && t > 0.27) {
        // Tented arch: sharp central peak
        const peakX = coreX + w(size * 0.065);
        const peakY = yBase - archH * (1.04 + r() * 0.22);
        d = `M ${f(sx)} ${f(yBase)}
             Q ${f(coreX - archW*0.28)} ${f(yBase - archH*0.62)},
               ${f(peakX)} ${f(peakY)}
             Q ${f(coreX + archW*0.28)} ${f(yBase - archH*0.62)},
               ${f(ex)} ${f(yBase)}`;
      } else {
        const cp1x = coreX - archW * (0.28 + r() * 0.26) + w(size * 0.055);
        const cp1y = yBase - archH * (0.86 + r() * 0.26);
        const cp2x = coreX + archW * (0.28 + r() * 0.26) + w(size * 0.055);
        const cp2y = yBase - archH * (0.86 + r() * 0.26);
        d = `M ${f(sx)} ${f(yBase)} C ${f(cp1x)} ${f(cp1y)}, ${f(cp2x)} ${f(cp2y)}, ${f(ex)} ${f(yBase)}`;
      }

      out += `<path d="${d.replace(/\n\s+/g, " ")}"
                    fill="none" stroke="${stroke}"
                    stroke-opacity="${(0.14 + t * 0.58).toFixed(2)}"
                    stroke-width="${(0.55 + t * 1.15).toFixed(2)}"
                    stroke-linecap="round"/>`;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Palm glyph — seeded hand outline + 3-5 palm lines
// ---------------------------------------------------------------------------

function drawPalm(glyphSeed, m, cx, cy, size) {
  const rng = makeRng(glyphSeed + ":palm");
  const r   = () => rng();
  const w   = (scale) => (r() - 0.5) * scale;

  const main      = metricColor(m.authority);
  const aux       = metricColor(m.provenance);
  const riskColor = metricColor(100 - m.risk);
  const s         = size / 85;

  const tx = (x) => cx + (x - 130) * s;
  const ty = (y) => cy + (y - 110) * s;
  const sc = (v) => v * s;

  // Seeded palm outline (each control point perturbed)
  const palmPath = [
    `M ${f(tx(54 + w(8)))} ${f(ty(175 + w(10)))}`,
    `Q ${f(tx(42 + w(8)))} ${f(ty(120 + w(10)))} ${f(tx(62 + w(8)))} ${f(ty(78 + w(8)))}`,
    `Q ${f(tx(78 + w(6)))} ${f(ty(44 + w(10)))} ${f(tx(110 + w(8)))} ${f(ty(46 + w(8)))}`,
    `Q ${f(tx(128 + w(6)))} ${f(ty(24 + w(8)))} ${f(tx(154 + w(8)))} ${f(ty(34 + w(8)))}`,
    `Q ${f(tx(176 + w(6)))} ${f(ty(28 + w(8)))} ${f(tx(196 + w(6)))} ${f(ty(46 + w(8)))}`,
    `Q ${f(tx(214 + w(8)))} ${f(ty(64 + w(8)))} ${f(tx(208 + w(8)))} ${f(ty(92 + w(10)))}`,
    `Q ${f(tx(220 + w(8)))} ${f(ty(118 + w(10)))} ${f(tx(212 + w(6)))} ${f(ty(144 + w(10)))}`,
    `Q ${f(tx(200 + w(8)))} ${f(ty(182 + w(8)))} ${f(tx(166 + w(6)))} ${f(ty(188 + w(10)))}`,
    `L ${f(tx(92 + w(6)))} ${f(ty(188 + w(6)))}`,
    `Q ${f(tx(64 + w(8)))} ${f(ty(188 + w(8)))} ${f(tx(54 + w(8)))} ${f(ty(175 + w(10)))} Z`,
  ].join(" ");

  // 3-5 seeded palm lines with distinct colors and curves
  const numLines  = 3 + Math.floor(r() * 3);
  const lineColors = [main, aux, riskColor, metricColor(m.personality), "#9fb0d9"];
  let lines = "";

  for (let i = 0; i < numLines; i++) {
    const t    = i / Math.max(numLines - 1, 1);
    const yOff = -30 + t * 88; // vertical spread through the palm
    const color = lineColors[i % lineColors.length];
    const sw   = (2.4 + r() * 1.5).toFixed(1);

    const lx1  = tx(68  + w(16)); const ly1  = ty(90  + yOff + w(12));
    const cpx1 = tx(108 + w(18)); const cpy1 = ty(80  + yOff + w(20) - 14);
    const cpx2 = tx(152 + w(18)); const cpy2 = ty(88  + yOff + w(20));
    const lx2  = tx(192 + w(14)); const ly2  = ty(98  + yOff + w(12));

    lines += `<path d="M ${f(lx1)} ${f(ly1)} C ${f(cpx1)} ${f(cpy1)}, ${f(cpx2)} ${f(cpy2)}, ${f(lx2)} ${f(ly2)}"
                    stroke="${color}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
  }

  return `
    <path d="${palmPath}" fill="#0d1a2e" stroke="#5b7fc7" stroke-width="${f(sc(1.8))}"/>
    ${lines}
  `;
}

// ---------------------------------------------------------------------------
// Barcode strip — deterministic from ail_id
// ---------------------------------------------------------------------------

function drawBarcode(ailId, x, y, w, h) {
  const seed = ailId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  let bars = "";
  let dx = 0;
  const count = 48;
  for (let i = 0; i < count; i++) {
    const bw     = 1 + ((seed * (i + 7) * 13) % 3);
    const filled = ((seed + i * 17) % 5) !== 0;
    if (filled) {
      bars += `<rect x="${x + dx}" y="${y}" width="${bw}" height="${h}" fill="#4f8ef7" fill-opacity="0.70"/>`;
    }
    dx += bw + 1;
    if (dx > w) break;
  }
  return bars;
}

// ---------------------------------------------------------------------------
// Holographic border gradient + shared defs
// ---------------------------------------------------------------------------

function cardDefs(id, accentHue) {
  // accentHue shifts the holo gradient slightly per agent (seeded)
  return `
    <defs>
      <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="hsl(${accentHue},     85%, 65%)" stop-opacity="0.9"/>
        <stop offset="25%"  stop-color="hsl(${accentHue+70},  75%, 70%)" stop-opacity="0.9"/>
        <stop offset="50%"  stop-color="hsl(${accentHue+150}, 80%, 58%)" stop-opacity="0.9"/>
        <stop offset="75%"  stop-color="hsl(${accentHue+210}, 80%, 65%)" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="hsl(${accentHue},     85%, 65%)" stop-opacity="0.9"/>
      </linearGradient>
      <linearGradient id="${id}_bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#0d0f14"/>
        <stop offset="100%" stop-color="#0a1520"/>
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
  `;
}

// ---------------------------------------------------------------------------
// Mini metrics bar chart
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
    const vy    = y + i * GAP;
    const color = label === "RISK" ? metricColor(100 - value) : metricColor(value);
    const fillW = Math.max(2, (value / 100) * BAR_W);
    return `
      <text x="${x}" y="${vy + 9}" font-family="Inter, Arial, sans-serif"
            font-size="8" fill="#64748b" letter-spacing="1">${label}</text>
      <text x="${x + BAR_W}" y="${vy + 9}" font-family="Inter, Arial, sans-serif"
            font-size="8" font-weight="700" fill="${color}" text-anchor="end">${value}</text>
      <rect x="${x}" y="${vy + 12}" width="${BAR_W}" height="${BAR_H}" rx="5" fill="#0d1826"/>
      <rect x="${x}" y="${vy + 12}" width="${f(fillW)}" height="${BAR_H}" rx="5"
            fill="${color}" fill-opacity="0.8"/>
    `;
  }).join("");
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

function f(n) {
  return Number(n).toFixed(1);
}

// ---------------------------------------------------------------------------
// Main: generateIdCardSvg
// ---------------------------------------------------------------------------

/**
 * Generate a 600×600 SVG identity card for an AI agent.
 *
 * @param {object} agentData  - v1 envelope (or partial)
 * @returns {string}          - complete SVG string
 */
export function generateIdCardSvg(agentData) {
  const { agent, scope, delegation, verification, ail_id } = agentData;
  const m = computeMetrics(agentData);

  const glyphSeed   = buildGlyphSeed(agentData);
  const cardRng     = makeRng(glyphSeed + ":card");

  // Unique accent hue per card (shifts the holographic gradient)
  const accentHue   = Math.floor(cardRng() * 360);

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

  // Layout
  const W = 600, H = 600;
  const HEADER_H    = 72;
  const MAIN_TOP    = HEADER_H + 8;
  const GLYPH_ROW_TOP = 360;
  const FOOTER_TOP  = 510;

  // Glyph centers
  const FACE_CX  = 150, FACE_CY  = MAIN_TOP + 120;
  const FP_CX    = 110, FP_CY    = GLYPH_ROW_TOP + 70;
  const PALM_CX  = 310, PALM_CY  = GLYPH_ROW_TOP + 70;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${cardDefs("holo", accentHue)}

  <!-- Card background -->
  <rect width="${W}" height="${H}" rx="28" fill="url(#holo_bg)"/>

  <!-- Holographic border -->
  <rect width="${W}" height="${H}" rx="28" fill="none" stroke="url(#holo)" stroke-width="3"/>

  <!-- Inner border -->
  <rect x="6" y="6" width="${W-12}" height="${H-12}" rx="24" fill="none" stroke="#1e2535" stroke-width="1"/>

  <!-- ── HEADER ──────────────────────────────────── -->
  <rect x="0" y="0" width="${W}" height="${HEADER_H}" rx="28" fill="#0a1220"/>
  <rect x="0" y="44" width="${W}" height="${HEADER_H-44}" fill="#0a1220"/>
  <rect x="0" y="${HEADER_H}" width="${W}" height="1" fill="#1e2535"/>

  <text x="24" y="28" font-family="Inter, Arial, sans-serif" font-size="11"
        font-weight="700" letter-spacing="3" fill="#64748b">22B LABS</text>
  <text x="24" y="52" font-family="Inter, Arial, sans-serif" font-size="16"
        font-weight="700" letter-spacing="1" fill="#e2e8f0">AGENT IDENTITY LAYER</text>

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

  <!-- ── FACE GLYPH (left column) ────────────────── -->
  <rect x="20" y="${MAIN_TOP}" width="250" height="260" rx="16" fill="#081121" stroke="#1e2535"/>
  <text x="145" y="${MAIN_TOP+20}" font-family="Inter, Arial, sans-serif" font-size="10"
        fill="#64748b" text-anchor="middle" letter-spacing="2">FACE</text>
  <g filter="url(#glow)">
    ${drawFace(glyphSeed, m, FACE_CX, FACE_CY, 90)}
  </g>
  <rect x="20" y="${MAIN_TOP+230}" width="250" height="30" rx="0" fill="#0d1826"/>
  <rect x="20" y="${MAIN_TOP+230}" width="${f(250*m.personality/100)}" height="30" rx="0"
        fill="${metricColor(m.personality)}" fill-opacity="0.15"/>
  <text x="35" y="${MAIN_TOP+250}" font-family="Inter, Arial, sans-serif" font-size="9"
        fill="#64748b" letter-spacing="1">PERSONALITY</text>
  <text x="255" y="${MAIN_TOP+250}" font-family="Inter, Arial, sans-serif" font-size="9"
        font-weight="700" fill="${metricColor(m.personality)}" text-anchor="end">${m.personality}</text>

  <!-- ── INFO (right column) ──────────────────────── -->
  <text x="290" y="${MAIN_TOP+24}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="22" font-weight="700" fill="#4f8ef7" letter-spacing="1">${ailId}</text>
  <text x="290" y="${MAIN_TOP+70}" font-family="Inter, Arial, sans-serif"
        font-size="26" font-weight="700" fill="#e2e8f0">${escSvg(displayName)}</text>
  <rect x="290" y="${MAIN_TOP+82}" width="280" height="1" fill="#1e2535"/>

  <text x="290" y="${MAIN_TOP+104}" font-family="Inter, Arial, sans-serif"
        font-size="10" fill="#64748b" letter-spacing="2">ROLE</text>
  <text x="290" y="${MAIN_TOP+122}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="14" fill="#a5c3ff">${escSvg(role)}</text>

  <text x="290" y="${MAIN_TOP+148}" font-family="Inter, Arial, sans-serif"
        font-size="10" fill="#64748b" letter-spacing="2">PROVIDER</text>
  <text x="290" y="${MAIN_TOP+166}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="14" fill="#a5c3ff">${escSvg(provider)}${model ? ` · ${escSvg(model)}` : ""}</text>

  <text x="290" y="${MAIN_TOP+192}" font-family="Inter, Arial, sans-serif"
        font-size="10" fill="#64748b" letter-spacing="2">OWNER</text>
  <text x="290" y="${MAIN_TOP+210}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="14" fill="#a5c3ff">${escSvg(ownerOrg)}</text>

  <rect x="290" y="${MAIN_TOP+228}" width="90" height="26" rx="6"
        fill="${riskColor}" fill-opacity="0.12" stroke="${riskColor}" stroke-width="1"/>
  <text x="335" y="${MAIN_TOP+245}" font-family="Inter, Arial, sans-serif"
        font-size="10" font-weight="700" fill="${riskColor}" text-anchor="middle"
        letter-spacing="1">RISK · ${riskLvl}</text>

  <rect x="392" y="${MAIN_TOP+228}" width="90" height="26" rx="6"
        fill="${metricColor(m.authority)}" fill-opacity="0.12" stroke="${metricColor(m.authority)}" stroke-width="1"/>
  <text x="437" y="${MAIN_TOP+245}" font-family="Inter, Arial, sans-serif"
        font-size="10" font-weight="700" fill="${metricColor(m.authority)}" text-anchor="middle"
        letter-spacing="1">AUTH · ${m.authority}</text>

  <!-- ── GLYPH ROW ────────────────────────────────── -->
  <rect x="0" y="${GLYPH_ROW_TOP-8}" width="${W}" height="1" fill="#1e2535"/>

  <!-- Fingerprint -->
  <rect x="20" y="${GLYPH_ROW_TOP}" width="180" height="150" rx="14" fill="#081121" stroke="#1e2535"/>
  <text x="110" y="${GLYPH_ROW_TOP+18}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle" letter-spacing="2">FINGERPRINT</text>
  <g filter="url(#glow)">
    ${drawFingerprint(glyphSeed, m, FP_CX, FP_CY, 66)}
  </g>
  <text x="110" y="${GLYPH_ROW_TOP+140}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle">PROV · ${m.provenance}</text>

  <!-- Palmline -->
  <rect x="210" y="${GLYPH_ROW_TOP}" width="180" height="150" rx="14" fill="#081121" stroke="#1e2535"/>
  <text x="300" y="${GLYPH_ROW_TOP+18}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle" letter-spacing="2">PALMLINE</text>
  <g filter="url(#glow)">
    ${drawPalm(glyphSeed, m, PALM_CX, PALM_CY, 66)}
  </g>
  <text x="300" y="${GLYPH_ROW_TOP+140}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" text-anchor="middle">AUTH · ${m.authority}</text>

  <!-- Metrics panel -->
  <rect x="400" y="${GLYPH_ROW_TOP}" width="180" height="150" rx="14" fill="#081121" stroke="#1e2535"/>
  ${renderMiniMetrics(m, 410, GLYPH_ROW_TOP+16)}

  <!-- ── FOOTER ───────────────────────────────────── -->
  <rect x="0" y="${FOOTER_TOP-1}" width="${W}" height="1" fill="#1e2535"/>
  <rect x="0" y="${FOOTER_TOP}" width="${W}" height="${H-FOOTER_TOP}" fill="#0a1220"/>
  <rect x="0" y="${H-28}" width="${W}" height="28" rx="28" fill="#0a1220"/>

  ${drawBarcode(ailId, 24, FOOTER_TOP+12, 320, 28)}

  <text x="360" y="${FOOTER_TOP+20}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" letter-spacing="1">ISSUED</text>
  <text x="360" y="${FOOTER_TOP+34}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="11" fill="#a5c3ff">${issuedAt}</text>

  <text x="460" y="${FOOTER_TOP+20}" font-family="Inter, Arial, sans-serif"
        font-size="9" fill="#64748b" letter-spacing="1">ISSUER</text>
  <text x="460" y="${FOOTER_TOP+34}" font-family="'JetBrains Mono', 'Courier New', monospace"
        font-size="11" fill="#a5c3ff">agentidcard.org</text>

  <text x="${W/2}" y="${H-10}" font-family="Inter, Arial, sans-serif" font-size="9"
        fill="#1e2535" text-anchor="middle" letter-spacing="2">22B LABS · AGENT IDENTITY LAYER · ${ailId}</text>

</svg>`;
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

  const svg      = agentData._cached_svg ?? generateIdCardSvg(agentData);
  const svgB64   = Buffer.from(svg).toString("base64");
  const imageUri = `data:image/svg+xml;base64,${svgB64}`;

  return {
    name: `${agent?.display_name ?? "Agent"} · ${ail_id ?? "AIL"}`,
    description:
      `22B Labs Agent Identity Credential. ` +
      `Role: ${agent?.role ?? "unknown"}. ` +
      `Issued by agentidcard.org.`,
    image: imageUri,
    external_url: `https://agentidcard.org/agents/${ail_id}`,
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
