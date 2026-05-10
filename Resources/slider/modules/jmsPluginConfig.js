const CONFIG_URL = "/NexusPobreFlix/config";
const CONFIG_CACHE_MS = 30_000;

let __pluginConfigCache = null;
let __pluginConfigLoadedAt = 0;
let __pluginConfigPromise = null;

function getTokenSafe() {
  try {
    const apiClient = window.ApiClient;
    if (!apiClient) return "";
    const token = (typeof apiClient.accessToken === "function")
      ? apiClient.accessToken()
      : (apiClient._accessToken || "");
    return token || "";
  } catch (e) {
    return "";
  }
}

async function getUserIdSafe() {
  try {
    const apiClient = window.ApiClient;
    if (!apiClient || typeof apiClient.getCurrentUser !== "function") return "";
    const user = await apiClient.getCurrentUser();
    return (user && user.Id) || "";
  } catch (e) {
    return "";
  }
}

async function getAuthHeaders() {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const token = getTokenSafe();
  const userId = await getUserIdSafe();
  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;
  return headers;
}

function normalizePluginConfigResponse(payload) {
  if (!payload || typeof payload !== "object") return {};

  const raw = (payload.cfg && typeof payload.cfg === "object")
    ? payload.cfg
    : payload;

  if (!raw || typeof raw !== "object") return {};

  const out = {};
  for (const k in raw) {
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
  const key = String(value || "").trim();
  if (!key || /^CHANGE_ME$/i.test(key)) return "";
  return key;
}

export async function fetchJmsPluginConfig(options) {
  const force = (options && options.force === true);
  const now = Date.now();
  if (!force && __pluginConfigCache && (now - __pluginConfigLoadedAt) < CONFIG_CACHE_MS) {
    return __pluginConfigCache;
  }
  if (!force && __pluginConfigPromise) return __pluginConfigPromise;

  __pluginConfigPromise = (async function() {
    const headers = await getAuthHeaders();
    const res = await fetch(CONFIG_URL, {
      method: "GET",
      cache: "no-store",
      headers: headers,
    });
    if (!res.ok) {
      throw new Error("JMS config HTTP " + res.status);
    }
    const data = await res.json();
    __pluginConfigCache = normalizePluginConfigResponse(data);
    __pluginConfigLoadedAt = Date.now();
    return __pluginConfigCache;
  })();

  try {
    return await __pluginConfigPromise;
  } finally {
    __pluginConfigPromise = null;
  }
}

export async function updateJmsPluginConfig(patch) {
  const patchData = patch || {};
  const headers = await getAuthHeaders();
  const res = await fetch(CONFIG_URL, {
    method: "POST",
    cache: "no-store",
    headers: headers,
    body: JSON.stringify(patchData),
  });
  if (!res.ok) {
    let msg = "JMS config HTTP " + res.status;
    try {
      const raw = await res.text();
      if (raw) msg = raw;
    } catch (e) {}
    throw new Error(msg);
  }

  const data = await res.json().catch(function() { return {}; });
  __pluginConfigCache = normalizePluginConfigResponse(data);
  __pluginConfigLoadedAt = Date.now();
  return __pluginConfigCache;
}

export async function getGlobalTmdbApiKey(options) {
  const force = (options && options.force === true);
  const cfg = await fetchJmsPluginConfig({ force: force });
  const key = (cfg && (cfg.TmdbApiKey !== undefined ? cfg.TmdbApiKey : cfg.tmdbApiKey));
  return sanitizeTmdbApiKey(key);
}
