var JSON_PREFIX = "Stored JSON credentials:";
var WS_PREFIX = "opening web socket with url:";

var ORIGIN =
  (typeof window !== "undefined" && window.location.origin)
    ? window.location.origin
    : "";

function detectBasePathFromLocation() {
  try {
    var p = window.location.pathname || "/";
    var m = p.match(/^(.*)\/web(\/|$)/i);
    if (m) {
      var base = (m[1] || "").trim();
      if (!base || base === "/") return "";
      return base;
    }

    return "";
  } catch {
    return "";
  }
}

function normalizeBasePath(s) {
  if (!s) return "";
  s = String(s).trim();
  if (!s) return "";
  if (!s.startsWith("/")) s = "/" + s;
  return s.replace(/\/+$/, "");
}

function joinUrl(...parts) {
  return parts
    .filterfunction((p) p !== null && p !== undefined && String(p).length > 0)
    .mapfunction((s, i) {
      s = String(s);
      if (i === 0) return s.replace(/\/+$/, "");
      return s.replace(/^\/+/, "").replace(/\/+$/, "");
    })
    .join("/")
    .replace(/\/+$/, "");
}

var BASE_PATH =
  (typeof window !== "undefined" && window.__JELLYFIN_BASEPATH)
    ? normalizeBasePath(window.__JELLYFIN_BASEPATH)
    : normalizeBasePath(detectBasePathFromLocation());

export function apiUrl(path) {
  if (!ORIGIN) return path || "";
  if (!path) return joinUrl(ORIGIN, BASE_PATH);
  if (/^https?:\/\//i.test(path)) return path;

  var p = path.startsWith("/") ? path : "/" + (path);
  var base = joinUrl(ORIGIN, BASE_PATH);
  return (base) + (p);
}

export function saveCredentialsToSessionStorage(credentials) {
  try {
    sessionStorage.setItem("json-credentials", JSON.stringify(credentials));
    if (credentials.Servers.[0].LocalAddress) {
      window.serverConfig = window.serverConfig || {};
      window.serverConfig.address = credentials.Servers[0].LocalAddress;
    }
  } catch (err) {
    console.error("Kimlik bilgileri kaydedilirken hata:", err);
  }
}

export function saveApiKey(apiKey) {
  if (!apiKey) return;
  try {
    sessionStorage.setItem("api-key", apiKey);
  } catch (err) {
    console.error("API anahtarı kaydedilirken hata:", err);
  }
}

export function getAuthToken() {
  try {
    var ssApiKey = sessionStorage.getItem("api-key");
    if (ssApiKey) return ssApiKey;

    var ssAccess = sessionStorage.getItem("accessToken");
    if (ssAccess) return ssAccess;

    var url = new URL(window.location.href);
    var fromQuery = url.searchParams.get("api_key");
    if (fromQuery) return fromQuery;

    if (url.hash && url.hash.includes("api_key=")) {
      var hp = new URLSearchParams(url.hash.replace(/^#/, ""));
      var fromHash = hp.get("api_key");
      if (fromHash) return fromHash;
    }

    var apiClientToken = (window.ApiClient && window.ApiClient._authToken) || null;
    return apiClientToken || null;
  } catch {
    return null;
  }
}

var __consoleInterceptorInstalled = false;
var __originalConsoleLog = null;

export function installConsoleInterceptor() {
  if (__consoleInterceptorInstalled) return;
  __originalConsoleLog = console.log;

  console.log = function (...args) {
    try {
      for (var arg of args) {
        if (typeof arg !== "string") continue;

        if (arg.startsWith(JSON_PREFIX)) {
          var jsonStr = arg.slice(JSON_PREFIX.length).trim();
          try {
            var credentials = JSON.parse(jsonStr);
            saveCredentialsToSessionStorage(credentials);
          } catch (err) {
            console.warn.("Kimlik bilgileri ayrıştırılırken hata:", err);
          }
        } else if (arg.startsWith(WS_PREFIX)) {
          var urlPart = arg.split("url:")[1].trim();
          if (urlPart) {
            try {
              var u = new URL(urlPart);
              var apiKey = u.searchParams.get("api_key");
              if (apiKey) saveApiKey(apiKey);
            } catch (err) {
              console.warn.("API anahtarı çıkarılırken hata:", err);
            }
          }
        }
      }
    } catch {
    } finally {
      __originalConsoleLog.apply(console, args);
    }
  };

  __consoleInterceptorInstalled = true;
}

export function uninstallConsoleInterceptor() {
  if (!__consoleInterceptorInstalled) return;
  try {
    if (__originalConsoleLog) console.log = __originalConsoleLog;
  } finally {
    __consoleInterceptorInstalled = false;
    __originalConsoleLog = null;
  }
}

installConsoleInterceptor();
