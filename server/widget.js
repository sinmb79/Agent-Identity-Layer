export default String.raw`(() => {
  var DEFAULT_SCOPE = "identity";
  var DEFAULT_THEME = "dark";
  var DEFAULT_SIZE = "medium";
  var STYLE_ID = "ail-widget-style";

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
      ".ail-widget-button { appearance:none; border:0; border-radius:14px; padding:12px 18px; font:600 14px/1.1 Inter,system-ui,sans-serif; cursor:pointer; transition:transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease; display:inline-flex; align-items:center; gap:10px; }",
      ".ail-widget-button:hover { transform:translateY(-1px); }",
      ".ail-widget-button:disabled { opacity:0.55; cursor:not-allowed; transform:none; }",
      ".ail-widget-button.ail-theme-dark { background:linear-gradient(135deg,#4f8ef7,#3169cf); color:#fff; box-shadow:0 12px 28px rgba(79,142,247,0.28); }",
      ".ail-widget-button.ail-theme-light { background:#f8fbff; color:#102038; border:1px solid rgba(49,105,207,0.18); box-shadow:0 10px 24px rgba(16,32,56,0.08); }",
      ".ail-widget-button.ail-size-small { padding:10px 14px; font-size:12px; border-radius:12px; }",
      ".ail-widget-button.ail-size-large { padding:14px 22px; font-size:15px; border-radius:16px; }",
      ".ail-widget-mark { width:18px; height:18px; border-radius:999px; background:rgba(255,255,255,0.18); display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; }",
      ".ail-theme-light .ail-widget-mark { background:rgba(49,105,207,0.12); }"
    ].join("\n");
    document.head.appendChild(style);
  }

  function randomState() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
  }

  function resolveTarget(target) {
    if (typeof target === "string") return document.querySelector(target);
    return target;
  }

  function AgentIDCardWidget(options) {
    options = options || {};
    if (!options.clientId) throw new Error("clientId is required");
    if (!options.redirectUri) throw new Error("redirectUri is required");

    this.serverUrl = String(options.serverUrl || window.location.origin).replace(/\/$/, "");
    this.serverOrigin = new URL(this.serverUrl).origin;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret || "";
    this.redirectUri = options.redirectUri;
    this.scope = options.scope || DEFAULT_SCOPE;
    this.theme = options.theme || DEFAULT_THEME;
    this.size = options.size || DEFAULT_SIZE;
    this.onVerified = typeof options.onVerified === "function" ? options.onVerified : function () {};
    this.onError = typeof options.onError === "function" ? options.onError : function () {};
    this.buttonLabel = options.buttonLabel || "Verify with Agent ID Card";
    this.state = options.state || randomState();
    this._popup = null;
    this._button = null;
    this._handleMessage = this._handleMessage.bind(this);
    window.addEventListener("message", this._handleMessage);
  }

  AgentIDCardWidget.prototype.getAuthUrl = function () {
    var url = new URL(this.serverUrl + "/auth/verify");
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("scope", this.scope);
    url.searchParams.set("state", this.state);
    return url.toString();
  };

  AgentIDCardWidget.prototype.render = function (target) {
    injectStyles();
    var container = resolveTarget(target);
    if (!container) throw new Error("Widget target not found");

    var button = document.createElement("button");
    button.type = "button";
    button.className = "ail-widget-button ail-theme-" + this.theme + " ail-size-" + this.size;
    button.innerHTML = '<span class="ail-widget-mark">A</span><span>' + escapeHtml(this.buttonLabel) + "</span>";
    button.addEventListener("click", this.openPopup.bind(this));

    container.innerHTML = "";
    container.appendChild(button);
    this._button = button;
    return button;
  };

  AgentIDCardWidget.prototype.openPopup = function () {
    var width = 560;
    var height = 760;
    var left = Math.max(0, Math.round((window.screen.width - width) / 2));
    var top = Math.max(0, Math.round((window.screen.height - height) / 2));
    var features = "popup=yes,width=" + width + ",height=" + height + ",left=" + left + ",top=" + top;

    this._popup = window.open(this.getAuthUrl(), "ail-verify-popup", features);
    if (!this._popup) {
      this.onError(new Error("Popup blocked"));
    }
  };

  AgentIDCardWidget.prototype._handleMessage = async function (event) {
    if (event.origin !== this.serverOrigin || !event.data || event.data.state !== this.state) {
      return;
    }

    if (event.data.type === "ail-verify-error") {
      this.onError(new Error(event.data.error || "Verification denied"));
      return;
    }

    if (event.data.type !== "ail-verify-result" || !event.data.code) {
      return;
    }

    try {
      if (this.clientSecret) {
        var response = await fetch(this.serverUrl + "/auth/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: event.data.code,
            client_id: this.clientId,
            client_secret: this.clientSecret
          })
        });
        var result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || ("HTTP " + response.status));
        }

        if (result.valid && result.ail_id) {
          try {
            sessionStorage.setItem(
              "agentidcard:verified:" + result.ail_id,
              JSON.stringify({
                value: result,
                expires_at: Date.now() + (5 * 60 * 1000)
              })
            );
          } catch {}
        }

        this.onVerified(result);
        return;
      }

      this.onVerified({
        code: event.data.code,
        state: event.data.state,
        exchange_required: true,
        exchange_url: this.serverUrl + "/auth/exchange"
      });
    } catch (error) {
      this.onError(error);
    }
  };

  window.AgentIDCardWidget = AgentIDCardWidget;

  var script = document.currentScript;
  if (script && script.dataset && script.dataset.clientId && script.dataset.redirectUri) {
    var mount = document.createElement("span");
    script.insertAdjacentElement("afterend", mount);
    var widget = new AgentIDCardWidget({
      serverUrl: new URL(script.src, window.location.href).origin,
      clientId: script.dataset.clientId,
      clientSecret: script.dataset.clientSecret || "",
      redirectUri: script.dataset.redirectUri,
      scope: script.dataset.scope || DEFAULT_SCOPE,
      theme: script.dataset.theme || DEFAULT_THEME,
      size: script.dataset.size || DEFAULT_SIZE
    });
    widget.render(mount);
  }
})();`;
