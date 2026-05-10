var SERVER_ADDR_KEY = "jf_serverAddress";
var SERVER_BASE_MICRO_CACHE_MS = 1500;
var MISSING_IMAGE_TTL_MS = 30 * 60 * 1000;
var MISSING_IMAGE_CACHE_LIMIT = 500;

var __serverBaseCache = "";
var __serverBaseCacheAt = 0;
var __missingImageCache =
  (typeof window !== "undefined" && window.__jmsMissingImageCache instanceof Map)
    ? window.__jmsMissingImageCache
    : new Map();

if (typeof window !== "undefined" && !(window.__jmsMissingImageCache instanceof Map)) {
  window.__jmsMissingImageCache = __missingImageCache;
}

function normalizeServerBase(s) {
  if (!s || typeof s !== "string") return "";
  return s.trim().replace(/\/+$/, "");
}

function isAbsoluteUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function isOriginOnly(base) {
  try {
    if (!base) return true;
    return /^https?:\/\/[^/]+\/?$/i.test(String(base).trim());
  } catch {
    return false;
  }
}

function getBaseFromBaseTag() {
  try {
    if (typeof document === "undefined") return "";
    var baseEl = document.querySelector("base[href]");
    var href = baseEl.getAttribute("href");
    if (!href) return "";

    var u = new URL(href, window.location.href);
    var basePath = String(u.pathname || "").replace(/\/web\/?$/i, "");
    return normalizeServerBase(u.origin + basePath);
  } catch {
    return "";
  }
}

function getBaseFromLocation() {
  try {
    if (typeof window === "undefined" || !window.location) return "";
    var { origin, pathname } = window.location;
    if (!origin) return "";

    var fromBase = getBaseFromBaseTag();
    if (fromBase) return fromBase;

    var p = String(pathname || "");
    var m = p.match(/^(.*?)(?:\/web(?:\/|$).*)$/i);
    var basePath = (m && m[1]) ? m[1] : "";
    return normalizeServerBase(origin + basePath);
  } catch {
    return "";
  }
}

function readStoredServerBase() {
  try {
    return normalizeServerBase(
      localStorage.getItem(SERVER_ADDR_KEY) || sessionStorage.getItem(SERVER_ADDR_KEY) || ""
    );
  } catch {
    return "";
  }
}

function persistServerBase(base) {
  var b = normalizeServerBase(base);
  if (!b) return;
  try { localStorage.setItem(SERVER_ADDR_KEY, b); } catch {}
  try { sessionStorage.setItem(SERVER_ADDR_KEY, b); } catch {}
}


export function resolveServerBase({ getServerAddress } = {}) {
  try {
    var loc = getBaseFromLocation();
    if (loc) { persistServerBase(loc); return loc; }
  } catch {}

  try {
    var api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;
    var apiBase =
      (api && typeof api.serverAddress === "function" ? api.serverAddress()
      : (api && typeof api.serverAddress === "string" ? api.serverAddress : "")) || "";
    var fromApi = normalizeServerBase(apiBase);
    if (fromApi && !isOriginOnly(fromApi)) { persistServerBase(fromApi); return fromApi; }
  } catch {}

  try {
    var cfg = normalizeServerBase(getServerAddress.() || "");
    if (cfg) { persistServerBase(cfg); return cfg; }
  } catch {}

  return readStoredServerBase();
}

function normalizeImageCacheKey(url) {
  if (!url || typeof url !== "string") return "";
  try {
    var u = new URL(url, (typeof window !== "undefined" && window.location.origin) || "http://localhost");
    return (u.origin) + (u.pathname);
  } catch {
    return String(url).split("?")[0].trim() || "";
  }
}

function pruneMissingImageCache(now = Date.now()) {
  if (!__missingImageCache.size) return;

  for (var [key, expiresAt] of __missingImageCache.entries()) {
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      __missingImageCache.delete(key);
    }
  }

  if (__missingImageCache.size <= MISSING_IMAGE_CACHE_LIMIT) return;

  var overflow = __missingImageCache.size - MISSING_IMAGE_CACHE_LIMIT;
  var removed = 0;
  for (var key of __missingImageCache.keys()) {
    __missingImageCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function isKnownMissingImage(url) {
  var key = normalizeImageCacheKey(url);
  if (!key) return false;

  var now = Date.now();
  var expiresAt = Number(__missingImageCache.get(key) || 0);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    __missingImageCache.delete(key);
    return false;
  }
  return true;
}

export function markImageMissing(url, ttlMs = MISSING_IMAGE_TTL_MS) {
  if (!url) return "";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "";

  var key = normalizeImageCacheKey(url);
  if (!key) return "";

  pruneMissingImageCache();
  var ttl = Number.isFinite(ttlMs) ? Math.max(60_000, ttlMs | 0) : MISSING_IMAGE_TTL_MS;
  __missingImageCache.set(key, Date.now() + ttl);
  return key;
}

export function clearMissingImage(url) {
  var key = normalizeImageCacheKey(url);
  if (!key) return false;
  return __missingImageCache.delete(key);
}

export function getServerBaseCached(opts) {
  var now = Date.now();
  if (__serverBaseCache && (now - __serverBaseCacheAt) < SERVER_BASE_MICRO_CACHE_MS) {
    return __serverBaseCache;
  }
  __serverBaseCache = resolveServerBase(opts);
  __serverBaseCacheAt = now;
  return __serverBaseCache;
}

export function invalidateServerBaseCache() {
  __serverBaseCache = "";
  __serverBaseCacheAt = 0;
}

export function joinServerUrl(base, pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  if (isAbsoluteUrl(pathOrUrl)) return pathOrUrl;

  var baseNorm = normalizeServerBase(base);
  if (!baseNorm) return pathOrUrl;

  var p = String(pathOrUrl).trim();
  if (!p) return baseNorm;

  if (p.startsWith("//")) {
    var proto = (typeof window !== "undefined" && window.location && window.location.protocol)
      ? window.location.protocol : "https:";
    return (proto) + (p);
  }

  if (p.startsWith("/")) return (baseNorm) + (p);

  return (baseNorm) + "/" + (p);
}

export function withServer(pathOrUrl, opts) {
  return joinServerUrl(getServerBaseCached(opts), pathOrUrl);
}

export function withServerSrcset(srcset = "", opts) {
  if (!srcset || typeof srcset !== "string") return "";
  return srcset
    .split(",")
    .map(function(part) {
      var p = part.trim();
      if (!p) return "";
      var m = p.match(/^(\S+)(\s+.+)?$/);
      if (!m) return p;
      var url = m[1];
      var desc = m[2] || "";
      return (withServer(url, opts)) + (desc);
    })
    .filter(Boolean)
    .join(", ");
}

export function buildJfUrl(pathOrUrl, opts) {
  return withServer(pathOrUrl, opts);
}

export function withParams(pathOrUrl, params = {}, opts) {
  var baseUrl = withServer(pathOrUrl, opts);

  try {
    var u = new URL(baseUrl);
    for (var [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch {
    var qs = Object.entries(params || {})
      .filterfunction(([, v]) v !== undefined && v !== null && v !== "")
      .mapfunction(([k, v]) (encodeURIComponent(k)) + "=" + (encodeURIComponent(String(v))))
      .join("&");
    if (!qs) return baseUrl;
    return baseUrl.includes("?") ? (baseUrl) + "&" + (qs) : (baseUrl) + "?" + (qs);
  }
}
