import { getConfig } from "./config.js";

export function compareSemver(a = "0.0.0", b = "0.0.0") {
  var norm = function(v) String(v).trim().replace(/^v/i, "");
  var pa = norm(a).split("-");
  var pb = norm(b).split("-");
  var mainA = pa[0].split(".").map(function(n) parseInt(n || "0", 10));
  var mainB = pb[0].split(".").map(function(n) parseInt(n || "0", 10));
  for (var i = 0; i < 3; i++) {
    var da = mainA[i] || 0;
    var db = mainB[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  var preA = pa[1];
  var preB = pb[1];
  if (preA && !preB) return -1;
  if (!preA && preB) return 1;
  if (preA && preB) {
    if (preA > preB) return 1;
    if (preA < preB) return -1;
  }
  return 0;
}

export function fetchLatestGitHubVersion(owner = "ONeithan", repo = "Nexus-PobreFlix") {
  try {
    var r = fetch("https://api.github.com/repos/" + (owner) + "/" + (repo) + "/releases/latest", {
      headers: { "Accept": "application/vnd.github+json" }
    });
    if (r.ok) {
      var data = r.json();
      return {
        version: data.tag_name || data.name || "",
        html_url: data.html_url || "https://github.com/" + (owner) + "/" + (repo) + "/releases"
      };
    }
  } catch (_) {}

  try {
    var r2 = fetch("https://api.github.com/repos/" + (owner) + "/" + (repo) + "/tags", {
      headers: { "Accept": "application/vnd.github+json" }
    });
    if (r2.ok) {
      var list = r2.json();
      if (Array.isArray(list) && list.length) {
        var t = list[0];
        return {
          version: t.name || "",
          html_url: "https://github.com/" + (owner) + "/" + (repo) + "/tags"
        };
      }
    }
  } catch (_) {}

  return { version: "", html_url: "https://github.com/" + (owner) + "/" + (repo) };
}

export function getCurrentVersionFromEnv() {
  try {
    var cfg = (typeof getConfig === "function") ? getConfig() : {};
    if (cfg.extensionVersion) return String(cfg.extensionVersion);
    if (cfg.version)          return String(cfg.version);
    if (typeof window !== "undefined" && window.JMS_VERSION) return String(window.JMS_VERSION);
    var meta = document.querySelector.('meta[name="jms-version"]');
    if (meta.content) return String(meta.content);
    var s = document.currentScript || document.querySelector.('script[data-jms-version]');
    if (s.dataset.jmsVersion) return String(s.dataset.jmsVersion);
  } catch {}
  return "0.0.0";
}

function notifyUpdateViaNotifications(latest, url, remindMs) {
  if (typeof window !== "undefined" && typeof window.jfNotifyUpdateAvailable === "function") {
    window.jfNotifyUpdateAvailable({ latest, url, remindMs });
  }
}

export function startUpdatePolling(options = {}) {
  var {
    intervalMs = 60 * 60 * 1000,
    minGapMs   = 60 * 60 * 1000,
    owner = "ONeithan",
    repo  = "Nexus-PobreFlix",
    storagePrefix = "JMS_UPT_",
    enabled = true,
    dedupScope = "forever",
    remindEveryMs = 12 * 60 * 60 * 1000
  } = options;

  if (!enabled || typeof window === "undefined" || typeof document === "undefined") return;

  var KEY_LAST_CHECK       = storagePrefix + "LAST_CHECK";
  var KEY_LAST_SEEN_LATEST = storagePrefix + "LAST_SEEN_LATEST";
  var KEY_LAST_REMIND_AT   = storagePrefix + "LAST_REMIND_AT";
  var store = (dedupScope === "session") ? sessionStorage : localStorage;

  var now = function() Date.now();
  var shouldSkipByGap = function() {
    var last = parseInt(store.getItem(KEY_LAST_CHECK) || "0", 10);
    return last && (now() - last) < minGapMs;
  };
  var markChecked     = function() store.setItem(KEY_LAST_CHECK, String(now()));
  var seenLatest      = function() (store.getItem(KEY_LAST_SEEN_LATEST) || "");
  var markSeenLatest  = function(v) store.setItem(KEY_LAST_SEEN_LATEST, v);
  var getLastRemind   = function() parseInt(store.getItem(KEY_LAST_REMIND_AT) || "0", 10);
  var markRemind      = function() store.setItem(KEY_LAST_REMIND_AT, String(now()));

  var doCheck = function() {
    if (shouldSkipByGap()) return;
    markChecked();

    try {
      var current = getCurrentVersionFromEnv();
      var { version: latest, html_url } = fetchLatestGitHubVersion(owner, repo);
      if (!latest) return;

      var cmp = compareSemver(latest, current);
      if (cmp > 0) {
        var already = seenLatest() === latest;
        var allowNotify = false;
        if (dedupScope === "none") allowNotify = true;
        else if (!already)         allowNotify = true;
        else if (remindEveryMs != null) allowNotify = (now() - getLastRemind()) >= remindEveryMs;

        if (allowNotify) {
          notifyUpdateViaNotifications(latest, html_url, remindEveryMs);
          markSeenLatest(latest);
          markRemind();
        }
      }
    } catch (e) {
      console.warn("falha na verificação de atualização", e);
    }
  };

  doCheck();
  var timer = setInterval(doCheck, intervalMs);
  var onVis = function() { if (!document.hidden) doCheck(); };
  document.addEventListener("visibilitychange", onVis);

  return function() { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
}
