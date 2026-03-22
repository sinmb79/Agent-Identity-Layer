import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.resolve(relativePath));
}

assert.ok(
  exists(path.join("server", "developers.html")),
  "developers page should exist at server/developers.html"
);

const developersHtml = read(path.join("server", "developers.html"));
const workersIndex = read(path.join("workers", "index.mjs"));
const landingHtml = read(path.join("web-page", "index.html"));

for (const sectionId of [
  "quick-start",
  "authentication-flow",
  "integration-methods",
  "exchange-auth-code",
  "scopes",
  "verified-badge",
  "sdk-integration",
  "server-side-examples",
  "offline-verification",
  "error-handling",
  "security-checklist",
  "api-reference",
  "support",
]) {
  assert.match(
    developersHtml,
    new RegExp(`id="${sectionId}"`),
    `developers page should include #${sectionId} section`
  );
}

assert.match(
  developersHtml,
  /Copy code/,
  "developers page should render copy buttons for code blocks"
);

assert.match(
  developersHtml,
  /data-tab-group="sdk"/,
  "developers page should include SDK language tabs"
);

assert.match(
  developersHtml,
  /data-tab-group="server"/,
  "developers page should include server example tabs"
);

assert.match(
  workersIndex,
  /import developersHtml from "..\/server\/developers\.html";/,
  "workers entry should import developersHtml"
);

assert.match(
  workersIndex,
  /app\.get\("\/developers", \(c\) => c\.html\(developersHtml\)\);/,
  "workers entry should register the /developers route"
);

const developersLinkMatches = landingHtml.match(/href="\/developers"/g) ?? [];
assert.ok(
  developersLinkMatches.length >= 2,
  "landing page should include /developers links in both nav and footer"
);

assert.match(
  landingHtml,
  /data-en="Developers"/,
  "landing page should include bilingual Developers labels"
);

console.log("Developer docs integration test passed");
