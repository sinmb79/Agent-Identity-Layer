export default String.raw`(() => {
  var STYLE_ID = "ail-badge-style";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".ail-badge-link { position:relative; display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; background:#0f1726; border:1px solid rgba(79,142,247,0.24); color:#e2e8f0; text-decoration:none; font:600 12px/1.2 Inter,system-ui,sans-serif; }",
      '.ail-badge-link[data-size="medium"] { border-radius:16px; padding:12px 14px; }',
      '.ail-badge-link[data-size="large"] { border-radius:18px; padding:14px 16px; min-width:220px; }',
      ".ail-badge-mark { width:18px; height:18px; border-radius:999px; background:linear-gradient(135deg,#22c55e,#4f8ef7); display:inline-flex; align-items:center; justify-content:center; color:white; font-size:11px; font-weight:800; }",
      ".ail-badge-tooltip { position:absolute; left:0; top:calc(100% + 10px); min-width:220px; padding:12px; border-radius:14px; background:rgba(13,15,20,0.98); border:1px solid rgba(79,142,247,0.16); box-shadow:0 16px 48px rgba(0,0,0,0.34); opacity:0; transform:translateY(6px); pointer-events:none; transition:opacity 0.18s ease, transform 0.18s ease; z-index:50; }",
      ".ail-badge-link:hover .ail-badge-tooltip, .ail-badge-link:focus-visible .ail-badge-tooltip { opacity:1; transform:translateY(0); }",
      ".ail-badge-tooltip strong { display:block; margin-bottom:6px; font-size:14px; color:#f8fafc; }",
      ".ail-badge-tooltip span { display:block; color:#94a3b8; font-size:12px; }",
      ".ail-badge-tooltip span + span { margin-top:4px; }"
    ].join("\n");
    document.head.appendChild(style);
  }

  async function fetchPublicProfile(serverUrl, ailId) {
    try {
      var response = await fetch(serverUrl + "/reputation/" + encodeURIComponent(ailId));
      if (!response.ok) return null;
      var result = await response.json();
      return {
        ail_id: result.ail_id,
        display_name: result.display_name,
        role: "Verified agent",
        overall_score: result.composite_scores && result.composite_scores.overall != null
          ? result.composite_scores.overall
          : null
      };
    } catch {
      return null;
    }
  }

  function readCache(ailId) {
    try {
      var raw = sessionStorage.getItem("agentidcard:verified:" + ailId);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.expires_at || parsed.expires_at < Date.now()) return null;
      return parsed.value;
    } catch {
      return null;
    }
  }

  function writeCache(ailId, value) {
    try {
      sessionStorage.setItem(
        "agentidcard:verified:" + ailId,
        JSON.stringify({
          value: value,
          expires_at: Date.now() + (5 * 60 * 1000)
        })
      );
    } catch {}
  }

  function AgentIDCardBadge(options) {
    options = options || {};
    if (!options.ailId) throw new Error("ailId is required");
    this.ailId = options.ailId;
    this.serverUrl = String(options.serverUrl || window.location.origin).replace(/\/$/, "");
    this.size = options.size || "small";
    this.label = options.label || "Verified Agent";
    this.role = options.role || "Verified agent";
    this.token = options.token || "";
    this.clientId = options.clientId || "";
    this.clientSecret = options.clientSecret || "";
  }

  AgentIDCardBadge.prototype.load = async function () {
    var cached = readCache(this.ailId);
    if (cached) {
      return {
        ail_id: cached.ail_id,
        display_name: cached.display_name,
        role: cached.role || this.role,
        overall_score: cached.reputation && cached.reputation.overall_score != null
          ? cached.reputation.overall_score
          : null
      };
    }

    if (this.token && this.clientId && this.clientSecret) {
      try {
        var url = new URL(this.serverUrl + "/auth/verify-quick");
        url.searchParams.set("client_id", this.clientId);
        url.searchParams.set("token", this.token);
        var response = await fetch(url.toString(), {
          headers: {
            Authorization: "Bearer " + this.clientSecret
          }
        });
        if (response.ok) {
          var result = await response.json();
          if (result && result.ail_id) {
            writeCache(result.ail_id, result);
            return {
              ail_id: result.ail_id,
              display_name: result.display_name,
              role: result.role || this.role,
              overall_score: result.reputation && result.reputation.overall_score != null
                ? result.reputation.overall_score
                : null
            };
          }
        }
      } catch {}
    }

    return fetchPublicProfile(this.serverUrl, this.ailId);
  };

  AgentIDCardBadge.prototype.render = async function (target) {
    injectStyles();
    var mount = typeof target === "string" ? document.querySelector(target) : target;
    if (!mount) throw new Error("Badge target not found");

    var result = await this.load();
    var link = document.createElement("a");
    var scoreLine = result && result.overall_score != null
      ? "Overall score: " + result.overall_score
      : "Overall score: pending";

    link.className = "ail-badge-link";
    link.dataset.size = this.size;
    link.href = this.serverUrl + "/agent/" + encodeURIComponent(this.ailId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.innerHTML =
      '<span class="ail-badge-mark">&#10003;</span>' +
      "<span>" + escapeHtml(this.label) + "</span>" +
      '<span style="opacity:0.78">' + escapeHtml(this.ailId) + "</span>" +
      '<span class="ail-badge-tooltip">' +
      "<strong>" + escapeHtml((result && result.display_name) || this.ailId) + "</strong>" +
      "<span>" + escapeHtml((result && result.role) || this.role) + "</span>" +
      "<span>" + escapeHtml(scoreLine) + "</span>" +
      "</span>";

    mount.innerHTML = "";
    mount.appendChild(link);
    return link;
  };

  window.AgentIDCardBadge = AgentIDCardBadge;
  var currentScript = document.currentScript;
  var serverOrigin = currentScript
    ? new URL(currentScript.src, window.location.href).origin
    : window.location.origin;

  function boot() {
    document.querySelectorAll("[data-ail-id]").forEach(function (node) {
      var badge = new AgentIDCardBadge({
        ailId: node.dataset.ailId,
        serverUrl: serverOrigin,
        size: node.dataset.size || "small",
        label: node.dataset.label || "Verified Agent",
        role: node.dataset.role || "Verified agent",
        token: node.dataset.token || "",
        clientId: node.dataset.clientId || "",
        clientSecret: node.dataset.clientSecret || ""
      });
      badge.render(node).catch(function () {});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();`;
