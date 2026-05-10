var CONFIG_URL = "/NexusPobreFlix/config";
var CONFIG_CACHE_MS = 30_000;

var __pluginConfigCache = null;
var __pluginConfigLoadedAt = 0;
var __pluginConfigPromise = null;

function getTokenSafe() {
  try {
    var apiClient = window.ApiClient;
    if (!apiClient) return "";
    var token = (typeof apiClient.accessToken === "function")
      ? apiClient.accessToken()
      : (apiClient._accessToken || "");
    return token || "";
  } catch (e) {
    return "";
  }
}

function getUserIdSafe() {
  try {
    var apiClient = window.ApiClient;
    if (!apiClient || typeof apiClient.getCurrentUser !== "function") return "";
    var user = apiClient.getCurrentUser();
    return (user && user.Id) || "";
  } catch (e) {
    return "";
  }
}

function getAuthHeaders() {
  var headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  var token = getTokenSafe();
  var userId = getUserIdSafe();
  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;
  return headers;
}

function normalizePluginConfigResponse(payload) {
  if (!payload || typeof payload !== "object") return {};

  var raw = (payload.cfg && typeof payload.cfg === "object")
    ? payload.cfg
    : payload;

  if (!raw || typeof raw !== "object") return {};

  var out = {};
  for (var k in raw) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) {
      out[k] = raw[k];
    }
  }

  out.enableCastModule = (raw.enableCastModule !== undefined) ? raw.enableCastModule : raw.EnableCastModule;
  out.allowSharedCastViewerForUsers = (raw.allowSharedCastViewerForUsers !== undefined) ? raw.allowSharedCastViewerForUsers : raw.AllowSharedCastViewerForUsers;
  out.tmdbApiKey = (raw.tmdbApiKey !== undefined) ? raw.tmdbApiKey : raw.TmdbApiKey;

  return out;
}

export function sanitizeTmdbApiKey(value) {
  var key = String(value || "").trim();
  if (!key || /^CHANGE_ME$/i.test(key)) return "";
  return key;
}

export function fetchJmsPluginConfig(options) {
  var force = (options && options.force === true);
  var now = Date.now();
  if (!force && __pluginConfigCache && (now - __pluginConfigLoadedAt) < CONFIG_CACHE_MS) {
    return __pluginConfigCache;
  }
  if (!force && __pluginConfigPromise) return __pluginConfigPromise;

  __pluginConfigPromise = (function() {
    var headers = getAuthHeaders();
    var res = fetch(CONFIG_URL, {
      method: "GET",
      cache: "no-store",
      headers: headers,
    });
    if (!res.ok) {
      throw new Error("JMS config HTTP " + res.status);
    }
    var data = res.json();
    __pluginConfigCache = normalizePluginConfigResponse(data);
    __pluginConfigLoadedAt = Date.now();
    return __pluginConfigCache;
  })();

  try {
    return __pluginConfigPromise;
  } finally {
    __pluginConfigPromise = null;
  }
}

export function updateJmsPluginConfig(patch) {
  var patchData = patch || {};
  var headers = getAuthHeaders();
  var res = fetch(CONFIG_URL, {
    method: "POST",
    cache: "no-store",
    headers: headers,
    body: JSON.stringify(patchData),
  });
  if (!res.ok) {
    var msg = "JMS config HTTP " + res.status;
    try {
      var raw = res.text();
      if (raw) msg = raw;
    } catch (e) {}
    throw new Error(msg);
  }

  var data = res.json().catch(function() { return {}; });
  __pluginConfigCache = normalizePluginConfigResponse(data);
  __pluginConfigLoadedAt = Date.now();
  return __pluginConfigCache;
}

export function getGlobalTmdbApiKey(options) {
  var force = (options && options.force === true);
  var cfg = fetchJmsPluginConfig({ force: force });
  var key = (cfg && (cfg.TmdbApiKey !== undefined ? cfg.TmdbApiKey : cfg.tmdbApiKey));
  return sanitizeTmdbApiKey(key);
}
