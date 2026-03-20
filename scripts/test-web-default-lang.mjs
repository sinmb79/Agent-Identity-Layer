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

console.log("Landing page default language test passed");
