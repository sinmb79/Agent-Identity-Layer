import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.resolve("web-page", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

assert.match(
  html,
  /<html class="dark" lang="en">/,
  "landing page should declare English as the default document language"
);

assert.match(
  html,
  /let currentLang = "en";/,
  "landing page should initialize in English"
);

assert.match(
  html,
  /document\.getElementById\("lang-btn"\)\.textContent = currentLang === "ko" \? "EN" : "KO";/,
  "language toggle button should start as KO when English is active"
);

assert.match(
  html,
  /applyLanguage\(currentLang\);/,
  "landing page should apply the initial language on first render"
);

assert.doesNotMatch(
  html,
  /href="\/register"/,
  "landing page should not use a relative /register link from the marketing site"
);

assert.match(
  html,
  /href="https:\/\/api\.agentidcard\.org\/register"/,
  "landing page should send registration CTAs to the API-hosted register page"
);

assert.match(
  html,
  /href="mailto:koinara\.xyz@gmail\.com"/,
  "landing page should expose the support email link"
);

assert.match(
  html,
  /href="https:\/\/discord\.gg\/zahjZPnjea"/,
  "landing page should expose the Discord invite link"
);

console.log("Landing page default language test passed");
