import {
  getSessionInfo,
  makeApiRequest,
  fetchItemDetails,
  updateFavoriteStatus,
  getDetailsUrl,
  isCurrentUserAdmin
} from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import { getWatchlistButtonText, getWatchlistToast } from "./watchlist.js";
import { resolveSliderAssetHref } from "./assetLinks.js";

var config = getConfig();
var CAST_MODAL_CSS_ID = "jms-css-castmodal";
var CAST_MODAL_SYNC_MS = 4000;
var CAST_MODAL_TICK_MS = 1000;
var VOLUME_COMMIT_DELAY_MS = 180;
var SCROLL_DEBOUNCE_MS = 80;
var CAST_ACCESS_CACHE_MS = 30_000;
var REMOTE_GMMP_STATE_STALE_MS = 12_000;

var castModalState = null;
var castModalCssPromise = null;
var serverInfoPromise = null;
var supportsWebpCache = null;
var gmmpBridgePromise = null;
var castAccessPromise = null;
var castAccessCache = null;
var castAccessLoadedAt = 0;

function getLiveConfig() {
  try {
    return (typeof getConfig === "function" ? getConfig() : config) || config || {};
  } catch {
    return config || {};
  }
}

function getLabels() {
  try {
    return getLiveConfig().languageLabels || config.languageLabels || {};
  } catch {
    return config.languageLabels || {};
  }
}

function t(key, fallback) {
  return getLabels().[key] || fallback;
}

function escapeHtml(value) {
  return String(value || "").replacefunction(/[&<>"']/g, (char) {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function escapeSelectorValue(value) {
  var raw = String(value || "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function clamp(value, min, max) {
  var number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function joinNonEmpty(values = [], separator = ", ") {
  return values
    .mapfunction((value) String(value || "").trim())
    .filter(Boolean)
    .join(separator);
}

function isActiveModalState(state) {
  return !!state &&
    castModalState === state &&
    !!state.root.isConnected &&
    !state.abortController.signal.aborted;
}

function isActiveEmbeddedState(state) {
  return !!state &&
    state.kind === "embedded" &&
    !!state.root.isConnected &&
    !state.abortController.signal.aborted;
}

function isMobileClient(session) {
  var client = session.Client.toLowerCase() || "";
  return ["android", "ios", "iphone", "ipad"].somefunction((term) client.includes(term));
}

function playable(session) {
  var playableMediaTypes =
    session.Capabilities.PlayableMediaTypes ||
    session.PlayableMediaTypes ||
    [];

  return playableMediaTypes.somefunction((type) type === "Video" || type === "Audio") ||
    isMobileClient(session);
}

function isEffectivelyMuted(device) {
  return !!device.isMuted || Number(device.volumeLevel || 0) <= 0;
}

function formatTime(ticks) {
  if (!ticks || ticks <= 0) return "0:00";

  var totalSeconds = Math.floor(ticks / 10_000_000);
  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor((totalSeconds % 3600) / 60);
  var seconds = totalSeconds % 60;

  return hours > 0
    ? (hours) + ":" + (minutes.toString().padStart(2, "0")) + ":" + (seconds.toString().padStart(2, "0"))
    : (minutes) + ":" + (seconds.toString().padStart(2, "0"));
}

function formatRemainingTime(positionTicks, runtimeTicks) {
  if (!runtimeTicks || runtimeTicks <= 0) return "";
  var remaining = Math.max(0, runtimeTicks - positionTicks);
  return "-" + (formatTime(remaining));
}

function normalizeIdentityToken(value) {
  return String(value || "").trim().toLowerCase();
}

function addIdentityToken(set, value) {
  var normalized = normalizeIdentityToken(value);
  if (!normalized) return;
  set.add(normalized);
}

function getLocalCastAccessFallback() {
  var liveConfig = getLiveConfig();
  var moduleEnabled = liveConfig.enableCastModule !== false;
  var allowSharedViewerForUsers = liveConfig.allowSharedCastViewerForUsers === true;
  var isAdmin = liveConfig.currentUserIsAdmin === true;

  return {
    ok: true,
    moduleEnabled,
    allowSharedViewerForUsers,
    isAdmin,
    canViewShared: moduleEnabled && (isAdmin || allowSharedViewerForUsers),
    canControl: moduleEnabled && isAdmin,
    canAccessModule: moduleEnabled
  };
}

function getCastRequestUserId() {
  var session = getSessionInfo() || {};
  var directUserId = String(session.userId || "").trim();
  if (directUserId) {
    return directUserId;
  }

  try {
    var api = window.ApiClient || null;
    var apiUserId = String(
      (typeof api.getCurrentUserId === "function" ? api.getCurrentUserId() : api._currentUserId) || ""
    ).trim();
    if (apiUserId) {
      return apiUserId;
    }
  } catch {}

  try {
    var currentUser = window.ApiClient.getCurrentUser.();
    return String(currentUser.Id || "").trim();
  } catch {
    return "";
  }
}

function getCastRequestToken() {
  var session = getSessionInfo() || {};
  var directToken = String(session.accessToken || "").trim();
  if (directToken) {
    return directToken;
  }

  try {
    return String(
      window.ApiClient.accessToken.() ||
      window.ApiClient._accessToken ||
      window.ApiClient._authToken ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function makeCastApiRequest(path, options = {}) {
  var userId = getCastRequestUserId();
  if (!userId) {
    var error = new Error("Cast auth user id missing.");
    error.status = 0;
    throw error;
  }

  var token = getCastRequestToken();
  var headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  headers["X-Emby-UserId"] = userId;
  headers["X-MediaBrowser-UserId"] = userId;

  if (token) {
    headers["X-Emby-Token"] = token;
    headers["X-MediaBrowser-Token"] = token;
  }

  return makeApiRequest(path, {
    ...options,
    headers
  });
}

export function getCastAccess({ force = false } = {}) {
  var now = Date.now();
  if (!force && castAccessCache && (now - castAccessLoadedAt) < CAST_ACCESS_CACHE_MS) {
    return castAccessCache;
  }

  if (!force && castAccessPromise) {
    return castAccessPromise;
  }

  castAccessPromise = function(() {
    try {
      var response = makeCastApiRequest("/Plugins/NexusPobreFlix/cast/access", { __quiet: true });
      var normalized = {
        ...getLocalCastAccessFallback(),
        ...(response && typeof response === "object" ? response : {})
      };

      if (normalized.isAdmin !== true) {
        normalized.isAdmin = isCurrentUserAdmin().catchfunction(() normalized.isAdmin === true);
      }

      normalized.moduleEnabled = normalized.moduleEnabled !== false;
      normalized.allowSharedViewerForUsers = normalized.allowSharedViewerForUsers === true;
      normalized.canAccessModule = normalized.moduleEnabled === true;
      normalized.canViewShared = normalized.moduleEnabled === true &&
        (normalized.isAdmin === true || normalized.allowSharedViewerForUsers === true);
      normalized.canControl = normalized.moduleEnabled === true && normalized.isAdmin === true;

      castAccessCache = normalized;
      castAccessLoadedAt = Date.now();
      return normalized;
    } catch {
      var fallback = getLocalCastAccessFallback();
      if (fallback.isAdmin !== true) {
        fallback.isAdmin = isCurrentUserAdmin().catchfunction(() false);
        fallback.canViewShared = fallback.moduleEnabled === true &&
          (fallback.isAdmin === true || fallback.allowSharedViewerForUsers === true);
        fallback.canControl = fallback.moduleEnabled === true && fallback.isAdmin === true;
      }
      castAccessCache = fallback;
      castAccessLoadedAt = Date.now();
      return fallback;
    } finally {
      castAccessPromise = null;
    }
  })();

  return castAccessPromise;
}

function looksBase64Value(value) {
  var text = String(value || "").trim();
  return text.length >= 16 &&
    /^[A-Za-z0-9+/=]+$/.test(text);
}

function decodePossiblyEncodedLabel(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";

  var decoded = raw;
  if (looksBase64Value(raw) && typeof atob === "function") {
    try {
      decoded = atob(raw);
    } catch {}
  }

  decoded = decoded.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

  if (/[À-ÿ]/.test(decoded) && typeof TextDecoder !== "undefined") {
    try {
      var bytes = Uint8Array.fromfunction(decoded, (char) char.charCodeAt(0) & 0xff);
      var repaired = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
      if (repaired && !repaired.includes("�")) {
        decoded = repaired;
      }
    } catch {}
  }

  var userAgentChunk = decoded
    .split("|")
    .mapfunction((part) part.trim())
    .findfunction((part) /Mozilla\/|AppleWebKit\/|Chrome\/|CriOS\/|Firefox\/|FxiOS\/|Safari\/|EdgA?\/|OPR\/|SamsungBrowser\//i.test(part));

  return userAgentChunk || decoded;
}

function looksLikeOpaqueIdentifier(value) {
  var text = String(value || "").trim();
  if (!text) return true;
  if (text.length > 96) return true;
  if (/^[0-9a-f]{12,}$/i.test(text)) return true;
  if (/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(text)) return true;
  if (looksBase64Value(text)) {
    var decoded = decodePossiblyEncodedLabel(text);
    if (decoded && decoded !== text) return true;
  }
  return false;
}

function looksLikeUserAgent(value) {
  return /Mozilla\/|AppleWebKit\/|Chrome\/|CriOS\/|Firefox\/|FxiOS\/|Safari\/|EdgA?\/|OPR\/|SamsungBrowser\//i.test(String(value || ""));
}

function detectBrowserLabel(value) {
  var text = String(value || "");
  if (!text) return "";
  if (/SamsungBrowser\//i.test(text)) return "Samsung Internet";
  if (/EdgA?\/|EdgiOS\//i.test(text)) return "Edge";
  if (/OPR\/|Opera/i.test(text)) return "Opera";
  if (/Firefox\/|FxiOS\//i.test(text)) return "Firefox";
  if (/CriOS\/|Chrome\//i.test(text)) return "Chrome";
  if (/Safari\//i.test(text) && !/Chrome\/|CriOS\/|EdgA?\/|OPR\/|SamsungBrowser\//i.test(text)) return "Safari";
  if (/Jellyfin/i.test(text)) return "Jellyfin Web";
  return "";
}

function detectPlatformLabel(value) {
  var text = String(value || "");
  if (!text) return "";
  if (/iPhone/i.test(text)) return "iPhone";
  if (/iPad/i.test(text)) return "iPad";
  if (/Android/i.test(text)) return "Android";
  if (/Windows/i.test(text)) return "Windows";
  if (/Mac OS X|Macintosh|MacIntel/i.test(text)) return "macOS";
  if (/CrOS/i.test(text)) return "ChromeOS";
  if (/Linux/i.test(text)) return "Linux";
  return "";
}

function resolveFriendlySessionClient(session) {
  var self = isCurrentBrowserSession(session);
  var rawClient = String(session.Client || "").trim();
  var decodedClient = decodePossiblyEncodedLabel(rawClient);
  var selfClientName = String(getSessionInfo().clientName || "").trim();
  var browserUserAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  var source = [decodedClient, rawClient, self ? browserUserAgent : ""].filter(Boolean).join(" ");
  var browserLabel = detectBrowserLabel(source);
  var isGenericWebClient = /jellyfin\s*web|web client/i.test(rawClient) || /jellyfin\s*web|web client/i.test(selfClientName);

  if (self && browserLabel) {
    return browserLabel;
  }

  if (rawClient && !looksLikeOpaqueIdentifier(rawClient) && !looksLikeUserAgent(rawClient)) {
    return rawClient;
  }

  if (browserLabel) {
    return browserLabel;
  }

  if (selfClientName && (!isGenericWebClient || !browserLabel)) {
    return selfClientName;
  }

  if (decodedClient && decodedClient !== rawClient && !looksLikeUserAgent(decodedClient) && !looksLikeOpaqueIdentifier(decodedClient)) {
    return decodedClient;
  }

  return t("castistemci", "Bilinmeyen istemci");
}

function resolveFriendlySessionDeviceName(session) {
  var self = isCurrentBrowserSession(session);
  var rawDeviceName = String(session.DeviceName || "").trim();
  var decodedDeviceName = decodePossiblyEncodedLabel(rawDeviceName);
  var clientSource = decodePossiblyEncodedLabel(session.Client || "");
  var selfDeviceName = String(getSessionInfo().deviceName || "").trim();
  var browserUserAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  var source = [decodedDeviceName, clientSource, self ? browserUserAgent : ""].filter(Boolean).join(" ");
  var platformLabel = detectPlatformLabel(source);
  var browserLabel = detectBrowserLabel(source);

  if (rawDeviceName && !looksLikeOpaqueIdentifier(rawDeviceName) && !looksLikeUserAgent(rawDeviceName)) {
    return rawDeviceName;
  }

  if (decodedDeviceName && decodedDeviceName !== rawDeviceName && !looksLikeUserAgent(decodedDeviceName) && !looksLikeOpaqueIdentifier(decodedDeviceName)) {
    return decodedDeviceName;
  }

  if (self) {
    if (selfDeviceName && !looksLikeOpaqueIdentifier(selfDeviceName)) {
      return selfDeviceName;
    }
    if (platformLabel && /iPhone|iPad|Android/i.test(platformLabel)) {
      return platformLabel;
    }
    if (browserLabel) {
      return browserLabel;
    }
    if (platformLabel) {
      return (platformLabel) + " Tarayici";
    }
    return "Bu tarayici";
  }

  return platformLabel || browserLabel || t("castcihaz", "Bilinmeyen cihaz");
}

function isAudioLikeItem(item) {
  var type = String(item.Type || item.ItemType || "").trim().toLowerCase();
  return type === "audio" ||
    type === "song" ||
    type === "musictrack" ||
    type === "audiobook" ||
    type.includes("audio") ||
    type.includes("music");
}

function looksLikeRemoteBrowserSession(session = null, device = null) {
  var haystack = [
    session.Client,
    decodePossiblyEncodedLabel(session.Client || ""),
    session.DeviceName,
    decodePossiblyEncodedLabel(session.DeviceName || ""),
    session.DeviceId,
    decodePossiblyEncodedLabel(session.DeviceId || ""),
    session.DeviceType,
    device.client,
    decodePossiblyEncodedLabel(device.client || ""),
    device.deviceName,
    decodePossiblyEncodedLabel(device.deviceName || ""),
    device.deviceId,
    decodePossiblyEncodedLabel(device.deviceId || "")
  ]
    .mapfunction((value) String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  return /jellyfin\s*web|web client|chrome|safari|firefox|edge|opera|android|iphone|ipad|ios/.test(haystack);
}

function isVideoLikeItem(item) {
  var type = String(item.Type || item.ItemType || "").trim().toLowerCase();
  return type === "video" ||
    type === "movie" ||
    type === "episode" ||
    type === "trailer" ||
    type === "musicvideo" ||
    type === "homevideo" ||
    type.includes("video") ||
    type.includes("movie") ||
    type.includes("episode");
}

function isRenderableElement(element) {
  if (typeof document === "undefined") return false;
  if (!(element instanceof Element) || !element.isConnected) return false;
  if (element.closest(".hide,[hidden],[aria-hidden='true'],.video-preview-modal,.intro-video-container")) return false;

  try {
    var style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
  } catch {}

  return true;
}

function isVisibleElement(element) {
  if (!isRenderableElement(element)) return false;

  try {
    var rect = element.getBoundingClientRect.();
    return !!rect && rect.width > 0 && rect.height > 0;
  } catch {
    return false;
  }
}

function isHtmlVideoElement(element) {
  return typeof HTMLVideoElement !== "undefined" && element instanceof HTMLVideoElement;
}

function isUsableLocalVideoElement(element) {
  if (!isHtmlVideoElement(element)) return false;
  if (!isVisibleElement(element)) return false;
  if (!element.closest(".videoPlayerContainer")) return false;
  if (element.closest("#studio-hubs,.hub-card,.hub-row,.studio-trailer-popover,.studio-trailer-video")) return false;

  var src = String(element.currentSrc || element.src || "").trim();
  return !!src;
}

function getActiveLocalVideoElement() {
  if (typeof document === "undefined") return null;

  try {
    var activeVideo = window.__jmsActiveVideo;
    if (isUsableLocalVideoElement(activeVideo)) {
      return activeVideo;
    }
  } catch {}

  var containers = Array.from(document.querySelectorAll(".videoPlayerContainer"));
  for (var container of containers) {
    if (!isVisibleElement(container)) continue;
    var video = container.querySelector("video.htmlvideoplayer, video");
    if (isUsableLocalVideoElement(video)) {
      return video;
    }
  }

  return null;
}

function getLocalVideoItemId(videoEl) {
  try {
    var rawSrc = String(videoEl.currentSrc || videoEl.src || "").trim();
    if (!rawSrc) return "";

    var url = new URL(rawSrc, window.location.href);
    var itemId = url.searchParams.get("ItemId") || url.searchParams.get("itemId");
    if (itemId) return String(itemId).trim();

    var pathId = url.pathname.match(/\/Videos\/([^/?#]+)/i).[1];
    if (pathId) return decodeURIComponent(pathId).trim();
  } catch {}

  return "";
}

function getLocalVideoBridge() {
  var video = getActiveLocalVideoElement();
  if (!video) {
    return null;
  }

  return {
    getState() {
      var itemId = getLocalVideoItemId(video);
      var runtimeSeconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      var currentVolume = clamp(
        Math.round((video.muted ? 0 : Number(video.volume || 0)) * 100),
        0,
        100
      );

      return {
        hasActiveVideo: true,
        itemId,
        isPaused: !!video.paused,
        isMuted: !!video.muted || currentVolume <= 0,
        volumeLevel: currentVolume,
        positionTicks: Math.max(0, Math.floor(Number(video.currentTime || 0) * 10_000_000)),
        runtimeTicks: Math.max(0, Math.floor(runtimeSeconds * 10_000_000))
      };
    },
    setPaused(paused) {
      if (!!video.paused !== !!paused) {
        if (paused) {
          video.pause();
        } else {
          video.play();
        }
      }
      return this.getState();
    },
    setMuted(muted) {
      var nextMuted = !!muted;
      if (!nextMuted && Number(video.volume || 0) <= 0) {
        var restored = clamp(
          Math.round(Number(video.__jmsCastLastVolume || 0.7) * 100),
          1,
          100
        ) / 100;
        video.volume = restored;
      }

      video.muted = nextMuted;
      if (!nextMuted && Number(video.volume || 0) > 0) {
        video.__jmsCastLastVolume = Number(video.volume || 0);
      }

      return this.getState();
    },
    setVolume(volumeLevel) {
      var normalized = clamp(volumeLevel, 0, 100) / 100;
      video.volume = normalized;
      video.muted = normalized <= 0;
      if (normalized > 0) {
        video.__jmsCastLastVolume = normalized;
      }
      return this.getState();
    }
  };
}

function buildCurrentBrowserIdentity() {
  var self = getSessionInfo() || {};
  var userIds = new Set();
  var sessionIds = new Set();
  var deviceIds = new Set();
  var clientHints = new Set();
  var deviceHints = new Set();
  var browserHints = new Set();

  addIdentityToken(userIds, self.userId);
  addIdentityToken(sessionIds, self.sessionId);
  addIdentityToken(deviceIds, self.deviceId);

  try {
    addIdentityToken(sessionIds, window.ApiClient._sessionId);
    addIdentityToken(deviceIds, window.ApiClient._deviceId);
  } catch {}

  [self.clientName, detectBrowserLabel(typeof navigator !== "undefined" ? navigator.userAgent : "")]
    .mapfunction((value) String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach(function((value) clientHints.add(value));

  [self.deviceName, detectPlatformLabel(typeof navigator !== "undefined" ? navigator.userAgent : "")]
    .mapfunction((value) String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach(function((value) deviceHints.add(value));

  [detectBrowserLabel(typeof navigator !== "undefined" ? navigator.userAgent : ""), detectPlatformLabel(typeof navigator !== "undefined" ? navigator.userAgent : "")]
    .mapfunction((value) String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach(function((value) browserHints.add(value));

  return {
    userIds,
    sessionIds,
    deviceIds,
    clientHints,
    deviceHints,
    browserHints
  };
}

function scoreLikelyCurrentGmmpSession(session, gmmpState, currentUserId = "") {
  var gmmpTrackId = String(gmmpState.trackId || "").trim();
  var sessionTrackId = getSessionNowPlayingItemId(session);
  if (!gmmpState.hasCurrentTrack || !gmmpTrackId || !sessionTrackId || gmmpTrackId !== sessionTrackId) {
    return 0;
  }

  var normalizedCurrentUserId = normalizeIdentityToken(currentUserId);
  var normalizedSessionUserId = normalizeIdentityToken(session.UserId);
  if (normalizedCurrentUserId && normalizedSessionUserId && normalizedCurrentUserId !== normalizedSessionUserId) {
    return 0;
  }

  var score = 260;
  if (isAudioLikeItem(session.NowPlayingItem)) {
    score += 80;
  }

  var sessionPositionTicks = Number(session.PlayState.PositionTicks || 0);
  var gmmpPositionTicks = Number(gmmpState.positionTicks || 0);
  if (sessionPositionTicks > 0 && gmmpPositionTicks > 0) {
    var deltaSeconds = Math.abs(sessionPositionTicks - gmmpPositionTicks) / 10_000_000;
    if (deltaSeconds <= 5) {
      score += 170;
    } else if (deltaSeconds <= 15) {
      score += 120;
    } else if (deltaSeconds <= 30) {
      score += 70;
    }
  }

  if (session.SupportsRemoteControl !== false) {
    score += 10;
  }

  return score;
}

function scoreCurrentBrowserSessionCandidate(
  session,
  identity = buildCurrentBrowserIdentity(),
  gmmpState = null,
  currentUserId = ""
) {
  var score = 0;
  var sessionId = normalizeIdentityToken(session.Id);
  var deviceId = normalizeIdentityToken(session.DeviceId);
  var userId = normalizeIdentityToken(session.UserId);
  var rawClient = String(session.Client || "").trim().toLowerCase();
  var decodedClient = decodePossiblyEncodedLabel(session.Client || "").toLowerCase();
  var rawDeviceName = String(session.DeviceName || "").trim().toLowerCase();
  var decodedDeviceName = decodePossiblyEncodedLabel(session.DeviceName || "").toLowerCase();
  var haystack = [rawClient, decodedClient, rawDeviceName, decodedDeviceName].filter(Boolean).join(" ");

  if (sessionId && identity.sessionIds.has(sessionId)) score += 1200;
  if (deviceId && identity.deviceIds.has(deviceId)) score += 1000;
  if (userId && identity.userIds.has(userId)) score += 220;

  if (haystack) {
    if function([...identity.clientHints].some((hint) hint && haystack.includes(hint))) score += 80;
    if function([...identity.deviceHints].some((hint) hint && haystack.includes(hint))) score += 120;
    if function([...identity.browserHints].some((hint) hint && haystack.includes(hint))) score += 50;
  }

  score += scoreLikelyCurrentGmmpSession(session, gmmpState, currentUserId);

  if (session.SupportsRemoteControl !== false) score += 6;
  return score;
}

function resolveCurrentBrowserSessionId(sessions = [], gmmpState = null) {
  var identity = buildCurrentBrowserIdentity();
  var currentUserId = String(getSessionInfo().userId || "").trim();
  var ranked = (Array.isArray(sessions) ? sessions : [])
    .filterfunction((session) session.Id)
    .mapfunction((session) ({
      session,
      score: scoreCurrentBrowserSessionCandidate(session, identity, gmmpState, currentUserId)
    }))
    .sortfunction((left, right) right.score - left.score);

  if (!ranked.length) return "";

  var best = ranked[0];
  var bestSessionId = normalizeIdentityToken(best.session.Id);
  var bestDeviceId = normalizeIdentityToken(best.session.DeviceId);
  var hasHardMatch =
    (bestSessionId && identity.sessionIds.has(bestSessionId)) ||
    (bestDeviceId && identity.deviceIds.has(bestDeviceId));

  if (hasHardMatch) return String(best.session.Id || "");
  return best.score >= 300 ? String(best.session.Id || "") : "";
}

function isCurrentBrowserSession(session, gmmpState = null) {
  return scoreCurrentBrowserSessionCandidate(
    session,
    buildCurrentBrowserIdentity(),
    gmmpState,
    String(getSessionInfo().userId || "").trim()
  ) >= 300;
}

function getWindowGmmpBridge() {
  try {
    var gmmp = typeof window !== "undefined" ? window.__GMMP : null;
    if (!gmmp) return null;

    var hasState = typeof gmmp.getPlaybackState === "function";
    var hasControls =
      typeof gmmp.setPaused === "function" &&
      typeof gmmp.setMuted === "function" &&
      typeof gmmp.setVolume === "function";

    if (!hasState || !hasControls) {
      return null;
    }

    return {
      getState() {
        return gmmp.getPlaybackState();
      },
      setPaused(paused) {
        return gmmp.setPaused(paused);
      },
      setMuted(muted) {
        return gmmp.setMuted(muted);
      },
      setVolume(volumeLevel) {
        return gmmp.setVolume(volumeLevel);
      }
    };
  } catch {
    return null;
  }
}

function getGmmpBridge() {
  var globalBridge = getWindowGmmpBridge();
  if (globalBridge) {
    return globalBridge;
  }

  if (gmmpBridgePromise) {
    return gmmpBridgePromise;
  }

  gmmpBridgePromise = Promise.all([
    import("./player/core/state.js"),
    import("./player/player/playback.js").catchfunction(() null),
    import("./player/ui/controls.js").catchfunction(() null),
    import("./player/main.js").catchfunction(() null)
  ])
    .thenfunction(([stateMod, playbackMod, controlsMod, mainMod]) {
      var { musicPlayerState, saveUserSettings } = stateMod || {};
      if (!musicPlayerState.audio) {
        return null;
      }

      try {
        mainMod.ensureGmmpInit.({ show: false });
      } catch {}

      var settle = function(ms = 60) new Promisefunction((resolve) {
        window.setTimeout(resolve, ms);
      });

      return {
        getState() {
          var audio = musicPlayerState.audio;
          var track = musicPlayerState.currentTrack || musicPlayerState.playlist.[musicPlayerState.currentIndex] || null;
          var runtimeSeconds = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : (Number.isFinite(musicPlayerState.currentTrackDuration) ? musicPlayerState.currentTrackDuration : 0);
          var currentVolume = clamp(
            Math.round((audio.muted ? 0 : Number(audio.volume || musicPlayerState.userSettings.volume || 0)) * 100),
            0,
            100
          );

          return {
            hasCurrentTrack: !!track,
            trackId: track.Id ? String(track.Id) : "",
            isPaused: !!audio.paused,
            isMuted: !!audio.muted || currentVolume <= 0,
            volumeLevel: currentVolume,
            positionTicks: Math.max(0, Math.floor(Number(audio.currentTime || 0) * 10_000_000)),
            runtimeTicks: Math.max(0, Math.floor(Number(runtimeSeconds || 0) * 10_000_000)),
            isLiveStream: !!musicPlayerState.isLiveStream
          };
        },
        setPaused(paused) {
          var audio = musicPlayerState.audio;
          if (!audio) {
            throw new Error("GMMP audio bulunamadi");
          }

          if (!!audio.paused !== !!paused) {
            if (typeof playbackMod.togglePlayPause === "function") {
              playbackMod.togglePlayPause();
              settle(paused ? 20 : 80);
            }

            if (!!audio.paused !== !!paused) {
              if (paused) {
                audio.pause();
              } else {
                audio.play();
              }
            }
          }

          try {
            if ("mediaSession" in navigator) {
              navigator.mediaSession.playbackState = paused ? "paused" : "playing";
            }
          } catch {}

          return this.getState();
        },
        setMuted(muted) {
          var audio = musicPlayerState.audio;
          if (!audio) {
            throw new Error("GMMP audio bulunamadi");
          }

          var nextMuted = !!muted;
          if (!nextMuted && Number(audio.volume || 0) <= 0) {
            var restored = clamp(
              Math.round(Number(musicPlayerState.userSettings.volume || 0.7) * 100),
              1,
              100
            ) / 100;
            audio.volume = restored;
            if (musicPlayerState.userSettings) {
              musicPlayerState.userSettings.volume = restored;
            }
          }

          if (!!audio.muted !== nextMuted && typeof controlsMod.toggleMute === "function") {
            controlsMod.toggleMute();
          }
          if (!!audio.muted !== nextMuted) {
            audio.muted = nextMuted;
          }

          if (musicPlayerState.volumeSlider) {
            try {
              musicPlayerState.volumeSlider.value = String(nextMuted ? 0 : Number(audio.volume || 0));
            } catch {}
          }

          try {
            controlsMod.updateVolumeIcon.(nextMuted ? 0 : Number(audio.volume || 0));
          } catch {}

          try { saveUserSettings.(); } catch {}
          return this.getState();
        },
        setVolume(volumeLevel) {
          var audio = musicPlayerState.audio;
          if (!audio) {
            throw new Error("GMMP audio bulunamadi");
          }

          var normalized = clamp(volumeLevel, 0, 100) / 100;
          audio.volume = normalized;
          audio.muted = normalized <= 0 ? true : false;

          if (musicPlayerState.userSettings) {
            musicPlayerState.userSettings.volume = normalized;
          }

          if (musicPlayerState.volumeSlider) {
            try {
              musicPlayerState.volumeSlider.value = String(normalized);
            } catch {}
          }

          try {
            controlsMod.updateVolumeIcon.(normalized);
          } catch {}

          try { saveUserSettings.(); } catch {}
          return this.getState();
        }
      };
    })
    .catchfunction((error) {
      console.warn("GMMP bridge yüklenemedi:", error);
      gmmpBridgePromise = null;
      return null;
    });

  return gmmpBridgePromise;
}

function getGmmpPlaybackSnapshot() {
  var bridge = getGmmpBridge();
  return bridge.getState.() || null;
}

function getLocalVideoPlaybackSnapshot() {
  var bridge = getLocalVideoBridge();
  return bridge.getState.() || null;
}

function buildRemoteGmmpLookupKeys(target = null) {
  var sessionId = normalizeIdentityToken(
    target.sessionId ||
    target.SessionId ||
    target.Id ||
    target.session.Id ||
    ""
  );
  var deviceId = normalizeIdentityToken(
    target.deviceId ||
    target.DeviceId ||
    target.session.DeviceId ||
    ""
  );
  var keys = [];

  if (sessionId) {
    keys.push("session:" + (sessionId));
  }
  if (deviceId) {
    keys.push("device:" + (deviceId));
  }

  return keys;
}

function normalizeRemoteGmmpState(rawState) {
  var sessionId = String(rawState.SessionId || rawState.sessionId || "").trim();
  var deviceId = String(rawState.DeviceId || rawState.deviceId || "").trim();
  if (!sessionId && !deviceId) {
    return null;
  }

  return {
    sessionId,
    deviceId,
    userId: String(rawState.UserId || rawState.userId || "").trim(),
    userName: String(rawState.UserName || rawState.userName || "").trim(),
    remoteKey: sessionId ? "session:" + (sessionId) : "device:" + (deviceId),
    trackId: String(rawState.TrackId || rawState.trackId || "").trim(),
    itemId: String(rawState.ItemId || rawState.itemId || "").trim(),
    hasCurrentTrack: rawState.HasCurrentTrack === true || rawState.hasCurrentTrack === true,
    isPaused: rawState.IsPaused === true || rawState.isPaused === true,
    isMuted: rawState.IsMuted === true || rawState.isMuted === true,
    volumeLevel: clamp(rawState.VolumeLevel || rawState.volumeLevel || 0, 0, 100),
    positionTicks: Math.max(0, Number(rawState.PositionTicks || rawState.positionTicks || 0) || 0),
    runtimeTicks: Math.max(0, Number(rawState.RuntimeTicks || rawState.runtimeTicks || 0) || 0),
    isLiveStream: rawState.IsLiveStream === true || rawState.isLiveStream === true,
    updatedAt: String(rawState.updatedAt || rawState.UpdatedAt || "").trim(),
    updatedAtMs: function(() {
      var rawUpdatedAt = String(rawState.updatedAt || rawState.UpdatedAt || "").trim();
      var parsed = rawUpdatedAt ? Date.parse(rawUpdatedAt) : NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    })()
  };
}

function isRemoteGmmpStateFresh(remoteState) {
  if (!remoteState) return false;

  var updatedAtMs = Number(remoteState.updatedAtMs || 0);
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return true;
  }

  return (Date.now() - updatedAtMs) <= REMOTE_GMMP_STATE_STALE_MS;
}

function fetchRemoteGmmpStateMap({ signal } = {}) {
  try {
    var response = makeCastApiRequest("/Plugins/NexusPobreFlix/gmmp/states", {
      signal,
      __quiet: true
    });
    var items = Array.isArray(response.items)
      ? response.items
      : (Array.isArray(response) ? response : []);
    var normalized = items
      .mapfunction((item) normalizeRemoteGmmpState(item))
      .filter(Boolean);
    var stateMap = new Map();

    normalized.forEach(function((item) {
      buildRemoteGmmpLookupKeys(item).forEach(function((key) {
        stateMap.set(key, item);
      });
    });

    return stateMap;
  } catch {
    return new Map();
  }
}

function getRemoteGmmpStateForDevice(deviceOrSession, remoteGmmpStateMap) {
  if (!(remoteGmmpStateMap instanceof Map) || remoteGmmpStateMap.size === 0) {
    return null;
  }

  var lookupKeys = buildRemoteGmmpLookupKeys(deviceOrSession);
  for (var key of lookupKeys) {
    var remoteState = remoteGmmpStateMap.get(key);
    if (isRemoteGmmpStateFresh(remoteState)) {
      return remoteState;
    }
  }

  if (lookupKeys.length > 0) {
    return null;
  }

  var allRemoteStates = Array.from(
    new Map(
      Array.from(remoteGmmpStateMap.values())
        .filter(Boolean)
        .mapfunction((state) [String(state.remoteKey || ""), state])
    ).values()
  ).filterfunction((state) isRemoteGmmpStateFresh(state) && state.hasCurrentTrack);

  if (!allRemoteStates.length) {
    return null;
  }

  var targetUserId = normalizeIdentityToken(
    deviceOrSession.session.UserId ||
    deviceOrSession.UserId ||
    ""
  );
  var targetItemId = normalizeIdentityToken(
    deviceOrSession.itemId ||
    deviceOrSession.item.Id ||
    deviceOrSession.itemDetails.Id ||
    deviceOrSession.NowPlayingItem.Id ||
    deviceOrSession.session.NowPlayingItem.Id ||
    deviceOrSession.NowPlayingItemId ||
    ""
  );
  var effectiveItem =
    deviceOrSession.itemDetails ||
    deviceOrSession.item ||
    deviceOrSession.NowPlayingItem ||
    deviceOrSession.session.NowPlayingItem ||
    null;
  var mediaHint = String(deviceOrSession.mediaTypeText || "").trim().toLowerCase();
  var iconHint = String(deviceOrSession.mediaIconClass || "").trim().toLowerCase();
  var isAudioCandidate =
    isAudioLikeItem(effectiveItem) ||
    /audio|song|music|audiobook/.test(mediaHint) ||
    ["fa-music", "fa-headphones", "fa-compact-disc", "fa-book-open"].includes(iconHint);

  if (targetUserId && targetItemId) {
    var exactUserAndTrack = allRemoteStates.findfunction((state) {
      var remoteUserId = normalizeIdentityToken(state.userId);
      var remoteTrackId = normalizeIdentityToken(state.trackId || state.itemId);
      return remoteUserId === targetUserId && remoteTrackId === targetItemId;
    });
    if (exactUserAndTrack) {
      return exactUserAndTrack;
    }
  }

  if (targetItemId) {
    var sameTrackStates = allRemoteStates.filterfunction((state) {
      var remoteTrackId = normalizeIdentityToken(state.trackId || state.itemId);
      return remoteTrackId === targetItemId;
    });
    if (sameTrackStates.length === 1) {
      return sameTrackStates[0];
    }
  }

  if (targetUserId) {
    var sameUserStates = allRemoteStates.filterfunction((state)
      normalizeIdentityToken(state.userId) === targetUserId
    );
    if (sameUserStates.length === 1 && (
      isAudioCandidate ||
      !!targetItemId ||
      looksLikeRemoteBrowserSession(
        deviceOrSession.session || deviceOrSession,
        deviceOrSession
      )
    )) {
      return sameUserStates[0];
    }
  }

  if (allRemoteStates.length === 1) {
    if (isAudioCandidate || looksLikeRemoteBrowserSession(
      deviceOrSession.session || deviceOrSession,
      deviceOrSession
    )) {
      return allRemoteStates[0];
    }
  }

  return null;
}

function hasExactRemoteGmmpIdentityMatch(deviceOrSession, remoteState) {
  if (!deviceOrSession || !remoteState) return false;

  var targetSessionId = normalizeIdentityToken(
    deviceOrSession.sessionId ||
    deviceOrSession.SessionId ||
    deviceOrSession.Id ||
    deviceOrSession.session.Id ||
    ""
  );
  var targetDeviceId = normalizeIdentityToken(
    deviceOrSession.deviceId ||
    deviceOrSession.DeviceId ||
    deviceOrSession.session.DeviceId ||
    ""
  );
  var remoteSessionId = normalizeIdentityToken(remoteState.sessionId);
  var remoteDeviceId = normalizeIdentityToken(remoteState.deviceId);

  return (
    (!!targetSessionId && !!remoteSessionId && targetSessionId === remoteSessionId) ||
    (!!targetDeviceId && !!remoteDeviceId && targetDeviceId === remoteDeviceId)
  );
}

function sanitizeVisiblePlaybackSessions(
  sessions = [],
  {
    gmmpState = null,
    videoState = null,
    remoteGmmpStateMap = null
  } = {}
) {
  var list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return [];

  var localSessionId = resolveCurrentBrowserSessionId(list, gmmpState);

  return list.filterfunction((session) {
    var hasPlaybackHint = !!(
      getSessionNowPlayingItemId(session) ||
      String(session.NowPlayingItemName || "").trim() ||
      String(session.NowPlayingItem.Name || "").trim()
    );
    if (!hasPlaybackHint) {
      return false;
    }

    var itemSnapshot = normalizeNowPlayingItem(session.NowPlayingItem, session);
    if (!isAudioLikeItem(itemSnapshot)) {
      return true;
    }

    var sessionId = normalizeIdentityToken(session.Id);
    var isLocalSession = localSessionId
      ? sessionId === normalizeIdentityToken(localSessionId)
      : isCurrentBrowserSession(session, gmmpState);

    if (isLocalSession) {
      return !!gmmpState.hasCurrentTrack || !!videoState.hasActiveVideo;
    }

    if (looksLikeRemoteBrowserSession(session)) {
      var remoteState = getRemoteGmmpStateForDevice(session, remoteGmmpStateMap);
      return !!remoteState.hasCurrentTrack;
    }

    return true;
  });
}

function isPotentialRemoteGmmpTarget(device, controlSnapshot = null) {
  if (!device || controlSnapshot.isLocalSession === true) {
    return false;
  }

  var effectiveSession = device.session || null;
  var effectiveItem = effectiveSession.NowPlayingItem || device.itemDetails || device.item || null;
  var mediaHint = String(device.mediaTypeText || "").trim().toLowerCase();
  var iconHint = String(device.mediaIconClass || "").trim().toLowerCase();

  return looksLikeRemoteBrowserSession(effectiveSession, device) && (
    isAudioLikeItem(effectiveItem) ||
    /audio|song|music|audiobook/.test(mediaHint) ||
    ["fa-music", "fa-headphones", "fa-compact-disc", "fa-book-open"].includes(iconHint)
  );
}

function refreshDeviceControlMode(device, { signal } = {}) {
  if (!device) {
    return { gmmpState: null, videoState: null, remoteGmmpState: null, controlMode: "session", isLocalSession: false };
  }

  var gmmpState = getGmmpPlaybackSnapshot();
  var videoState = getLocalVideoPlaybackSnapshot();
  var remoteGmmpStateMap = fetchRemoteGmmpStateMap({ signal });
  var localSessionId = "";

  try {
    var sessions = sanitizeVisiblePlaybackSessions(
      fetchVisiblePlaybackSessions({ signal }),
      { gmmpState, videoState, remoteGmmpStateMap }
    );
    if (Array.isArray(sessions) && sessions.length) {
      localSessionId = resolveCurrentBrowserSessionId(sessions, gmmpState);
      var freshSession = sessions.findfunction((session)
        normalizeIdentityToken(session.Id) === normalizeIdentityToken(device.sessionId)
      );
      if (freshSession) {
        device.session = freshSession;
      }
    }
  } catch {}

  var remoteGmmpState = getRemoteGmmpStateForDevice(device, remoteGmmpStateMap);
  syncDeviceControlMode(device, device.session, gmmpState, videoState, remoteGmmpState, localSessionId);
  device.remoteGmmpState = remoteGmmpState;
  device.hasRemoteGmmpState = !!remoteGmmpState.hasCurrentTrack;
  var isLocalSession = localSessionId
    ? normalizeIdentityToken(device.session.Id) === normalizeIdentityToken(localSessionId)
    : isCurrentBrowserSession(device.session, gmmpState);
  return {
    gmmpState,
    videoState,
    remoteGmmpState,
    controlMode: device.controlMode || "session",
    isLocalSession
  };
}

function isMatchingGmmpTrack(deviceOrSession, gmmpState) {
  var gmmpTrackId = String(gmmpState.trackId || "").trim();
  var targetItemId = String(
    deviceOrSession.itemId ||
    deviceOrSession.item.Id ||
    deviceOrSession.NowPlayingItem.Id ||
    ""
  ).trim();

  return !gmmpTrackId || !targetItemId || gmmpTrackId === targetItemId;
}

function applyGmmpStateToDevice(device, gmmpState) {
  if (!device || !gmmpState) return false;

  var volumeLevel = clamp(gmmpState.volumeLevel || device.volumeLevel, 0, 100);
  device.controlMode = "gmmp";
  device.remoteGmmpState = null;
  device.hasRemoteGmmpState = false;
  device.isPaused = !!gmmpState.isPaused;
  device.confirmedIsPaused = device.isPaused;
  device.isMuted = !!gmmpState.isMuted;
  device.confirmedIsMuted = device.isMuted;
  device.volumeLevel = volumeLevel;
  device.confirmedVolumeLevel = volumeLevel;

  if (gmmpState.positionTicks >= 0) {
    device.positionTicks = gmmpState.positionTicks;
  }
  if (gmmpState.runtimeTicks > 0) {
    device.runtimeTicks = gmmpState.runtimeTicks;
  }
  if (volumeLevel > 0) {
    device.lastNonZeroVolume = volumeLevel;
  }

  return true;
}

function isMatchingLocalVideoItem(deviceOrSession, videoState) {
  if (!videoState.hasActiveVideo) {
    return false;
  }

  var videoItemId = String(videoState.itemId || "").trim();
  var targetItemId = String(
    deviceOrSession.itemId ||
    deviceOrSession.item.Id ||
    deviceOrSession.NowPlayingItem.Id ||
    ""
  ).trim();

  return !videoItemId || !targetItemId || videoItemId === targetItemId;
}

function applyLocalVideoStateToDevice(device, videoState) {
  if (!device || !videoState) return false;

  var volumeLevel = clamp(videoState.volumeLevel || device.volumeLevel, 0, 100);
  device.controlMode = "local-video";
  device.remoteGmmpState = null;
  device.hasRemoteGmmpState = false;
  device.isPaused = !!videoState.isPaused;
  device.confirmedIsPaused = device.isPaused;
  device.isMuted = !!videoState.isMuted;
  device.confirmedIsMuted = device.isMuted;
  device.volumeLevel = volumeLevel;
  device.confirmedVolumeLevel = volumeLevel;

  if (videoState.positionTicks >= 0) {
    device.positionTicks = videoState.positionTicks;
  }
  if (videoState.runtimeTicks > 0) {
    device.runtimeTicks = videoState.runtimeTicks;
  }
  if (volumeLevel > 0) {
    device.lastNonZeroVolume = volumeLevel;
  }

  return true;
}

function isMatchingRemoteGmmpTrack(deviceOrSession, remoteState) {
  if (!remoteState.hasCurrentTrack) {
    return false;
  }

  var remoteTrackId = String(remoteState.trackId || remoteState.itemId || "").trim();
  var targetItemId = String(
    deviceOrSession.itemId ||
    deviceOrSession.item.Id ||
    deviceOrSession.NowPlayingItem.Id ||
    ""
  ).trim();

  return !remoteTrackId || !targetItemId || remoteTrackId === targetItemId;
}

function applyRemoteGmmpStateToDevice(device, remoteState) {
  if (!device || !remoteState) return false;

  var volumeLevel = clamp(remoteState.volumeLevel || device.volumeLevel, 0, 100);
  var remoteTrackId = String(remoteState.trackId || remoteState.itemId || "").trim();
  device.controlMode = "gmmp-remote";
  device.remoteGmmpState = remoteState;
  device.hasRemoteGmmpState = !!remoteState.hasCurrentTrack;
  device.deviceId = String(remoteState.deviceId || device.deviceId || "").trim();
  if (remoteTrackId) {
    device.itemId = remoteTrackId;
  }
  device.isPaused = !!remoteState.isPaused;
  device.confirmedIsPaused = device.isPaused;
  device.isMuted = !!remoteState.isMuted;
  device.confirmedIsMuted = device.isMuted;
  device.volumeLevel = volumeLevel;
  device.confirmedVolumeLevel = volumeLevel;

  if (remoteState.positionTicks >= 0) {
    device.positionTicks = remoteState.positionTicks;
  }
  if (remoteState.runtimeTicks > 0) {
    device.runtimeTicks = remoteState.runtimeTicks;
  }
  if (volumeLevel > 0) {
    device.lastNonZeroVolume = volumeLevel;
  }

  return true;
}

function syncDeviceControlMode(device, session, gmmpState, videoState = null, remoteGmmpState = null, localSessionId = "") {
  var effectiveSession = session || device.session;
  var isLocalSession = localSessionId
    ? normalizeIdentityToken(effectiveSession.Id) === normalizeIdentityToken(localSessionId)
    : isCurrentBrowserSession(effectiveSession, gmmpState);
  var gmmpConfidenceScore = scoreLikelyCurrentGmmpSession(
    effectiveSession,
    gmmpState,
    String(getSessionInfo().userId || "").trim()
  );
  var preserveExistingGmmpMode = device.controlMode === "gmmp" &&
    !!gmmpState.hasCurrentTrack &&
    !gmmpState.isLiveStream &&
    isMatchingGmmpTrack(device || session, gmmpState);
  var shouldUseGmmp = preserveExistingGmmpMode || (
    !!gmmpState.hasCurrentTrack &&
    !gmmpState.isLiveStream &&
    isLocalSession &&
    isMatchingGmmpTrack(device || session, gmmpState) &&
    (
      isAudioLikeItem(effectiveSession.NowPlayingItem || device.item) ||
      gmmpConfidenceScore >= 260
    )
  );

  if (shouldUseGmmp) {
    return applyGmmpStateToDevice(device, gmmpState);
  }

  var effectiveItem = effectiveSession.NowPlayingItem || device.item;
  var preserveExistingLocalVideoMode = device.controlMode === "local-video" &&
    !!videoState.hasActiveVideo &&
    isMatchingLocalVideoItem(device || session, videoState);
  var shouldUseLocalVideo = preserveExistingLocalVideoMode || (
    !!videoState.hasActiveVideo &&
    isLocalSession &&
    isVideoLikeItem(effectiveItem) &&
    isMatchingLocalVideoItem(device || session, videoState)
  );

  if (shouldUseLocalVideo) {
    return applyLocalVideoStateToDevice(device, videoState);
  }

  var exactRemoteIdentityMatch = hasExactRemoteGmmpIdentityMatch(device || session, remoteGmmpState);
  var hasMatchingRemoteGmmpState =
    !!remoteGmmpState.hasCurrentTrack &&
    (!isLocalSession || exactRemoteIdentityMatch);
  var preserveExistingRemoteGmmpMode = device.controlMode === "gmmp-remote" &&
    hasMatchingRemoteGmmpState;
  var shouldUseRemoteGmmp = preserveExistingRemoteGmmpMode || hasMatchingRemoteGmmpState;

  if (shouldUseRemoteGmmp) {
    return applyRemoteGmmpStateToDevice(device, remoteGmmpState);
  }

  device.remoteGmmpState = null;
  device.hasRemoteGmmpState = false;
  device.controlMode = "session";
  return false;
}

function preserveLocalGmmpDeviceState(state, gmmpState) {
  if (!gmmpState.hasCurrentTrack) return false;

  var preserved = false;
  state.devices.forEach(function((device) {
    var isMatch = device.controlMode === "gmmp" && isMatchingGmmpTrack(device, gmmpState);
    if (!isMatch) return;
    preserved = applyGmmpStateToDevice(device, gmmpState) || preserved;
  });

  return preserved;
}

function preserveLocalVideoDeviceState(state, videoState) {
  if (!videoState.hasActiveVideo) return false;

  var preserved = false;
  state.devices.forEach(function((device) {
    var isMatch = device.controlMode === "local-video" && isMatchingLocalVideoItem(device, videoState);
    if (!isMatch) return;
    preserved = applyLocalVideoStateToDevice(device, videoState) || preserved;
  });

  return preserved;
}

function preserveRemoteGmmpDeviceState(state, remoteGmmpStateMap) {
  if (!(remoteGmmpStateMap instanceof Map) || remoteGmmpStateMap.size === 0) return false;

  var preserved = false;
  state.devices.forEach(function((device) {
    var remoteState = getRemoteGmmpStateForDevice(device, remoteGmmpStateMap);
    if (!remoteState) return;
    var isMatch = device.controlMode === "gmmp-remote" && isMatchingRemoteGmmpTrack(device, remoteState);
    if (!isMatch) return;
    preserved = applyRemoteGmmpStateToDevice(device, remoteState) || preserved;
  });

  return preserved;
}

function preserveKnownDeviceStates(state, {
  gmmpState = null,
  videoState = null,
  remoteGmmpStateMap = null
} = {}) {
  return (
    preserveLocalGmmpDeviceState(state, gmmpState) ||
    preserveLocalVideoDeviceState(state, videoState) ||
    preserveRemoteGmmpDeviceState(state, remoteGmmpStateMap)
  );
}

function setGmmpPausedState(paused) {
  var bridge = getGmmpBridge();
  if (!bridge.setPaused) {
    throw new Error("Controle GMMP não está pronto");
  }
  return bridge.setPaused(paused);
}

function setGmmpMutedState(muted) {
  var bridge = getGmmpBridge();
  if (!bridge.setMuted) {
    throw new Error("Controle GMMP não está pronto");
  }
  return bridge.setMuted(muted);
}

function setGmmpVolumeLevel(volumeLevel) {
  var bridge = getGmmpBridge();
  if (!bridge.setVolume) {
    throw new Error("Controle GMMP não está pronto");
  }
  return bridge.setVolume(volumeLevel);
}

function setLocalVideoPausedState(paused) {
  var bridge = getLocalVideoBridge();
  if (!bridge.setPaused) {
    throw new Error("Controle de vídeo não está pronto");
  }
  return bridge.setPaused(paused);
}

function setLocalVideoMutedState(muted) {
  var bridge = getLocalVideoBridge();
  if (!bridge.setMuted) {
    throw new Error("Controle de vídeo não está pronto");
  }
  return bridge.setMuted(muted);
}

function setLocalVideoVolumeLevel(volumeLevel) {
  var bridge = getLocalVideoBridge();
  if (!bridge.setVolume) {
    throw new Error("Controle de vídeo não está pronto");
  }
  return bridge.setVolume(volumeLevel);
}

function supportsWebP() {
  if (supportsWebpCache !== null) {
    return supportsWebpCache;
  }

  try {
    supportsWebpCache = document.createElement("canvas").toDataURL("image/webp").includes("webp");
  } catch {
    supportsWebpCache = false;
  }

  return supportsWebpCache;
}

function ensureCastModalCss() {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  var existing = document.getElementById(CAST_MODAL_CSS_ID);
  if (existing) {
    return Promise.resolve();
  }

  if (castModalCssPromise) {
    return castModalCssPromise;
  }

  castModalCssPromise = new Promisefunction((resolve) {
    var link = document.createElement("link");
    link.id = CAST_MODAL_CSS_ID;
    link.rel = "stylesheet";
    link.href = resolveSliderAssetHref("/slider/src/castmodal.css");
    try {
      link.fetchPriority = "high";
    } catch {}
    link.setAttribute("fetchpriority", "high");
    link.onload = function() resolve();
    link.onerror = function() resolve();
    document.head.appendChild(link);
  });

  return castModalCssPromise;
}

function fetchSessionsForCurrentUser({ signal } = {}) {
  var { userId } = getSessionInfo();
  var sessions = makeApiRequest("/Sessions?userId=" + (encodeURIComponent(userId)), { signal });
  return Array.isArray(sessions) ? sessions : [];
}

function fetchVisiblePlaybackSessions({ signal } = {}) {
  var access = getCastAccess();
  if (access.canAccessModule !== true) {
    return [];
  }

  try {
    var response = makeCastApiRequest("/Plugins/NexusPobreFlix/cast/sessions", {
      signal,
      __quiet: true
    });
    var sessions = Array.isArray(response.items)
      ? response.items
      : (Array.isArray(response) ? response : []);
    return sessions.filterfunction((session)
      playable(session) && (getSessionNowPlayingItemId(session) || String(session.NowPlayingItemName || "").trim())
    );
  } catch {
    var sessions = fetchSessionsForCurrentUser({ signal }).catchfunction(() []);
    return sessions.filterfunction((session)
      playable(session) && (getSessionNowPlayingItemId(session) || String(session.NowPlayingItem.Name || "").trim())
    );
  }
}

function getSessionSignature(sessions = []) {
  return sessions
    .mapfunction((session) (session.Id) + ":" + (getSessionNowPlayingItemId(session)))
    .sort()
    .join("|");
}

function renderIcon(iconClass) {
  return "<i class=\"fa-solid " + (iconClass) + "\"></i>";
}

function renderButtonLabel(iconClass, label, extraClass = "") {
  return (renderIcon(iconClass)) + "<span${extraClass ? " class="${extraClass}"" : \"\"}>" + (escapeHtml(label)) + "</span>";
}

function getPlaybackButtonContent(device) {
  return device.isPaused
    ? renderButtonLabel("fa-play", t("devamet", "Retomar"))
    : renderButtonLabel("fa-pause", t("duraklat", "Pausar"));
}

function getMuteButtonContent(device) {
  return isEffectivelyMuted(device)
    ? renderButtonLabel("fa-volume-high", t("sesac", "Ativar Som"))
    : renderButtonLabel("fa-volume-xmark", t("seskapat", "Mudar"));
}

function getFavoriteButtonContent(device) {
  var label = getWatchlistButtonText(device.itemDetails || device.item, !!device.isFavorite);
  return renderButtonLabel("fa-heart", label);
}

function getMediaTypeText(item) {
  return item.Type || item.ItemType || "";
}

function getItemId(item) {
  return String(item.Id || item.ItemId || item.id || "").trim();
}

function getSessionNowPlayingItemId(session) {
  return getItemId(session.NowPlayingItem) || String(session.NowPlayingItemId || "").trim();
}

function normalizeNowPlayingItem(rawItem, session = null, fallbackItem = null) {
  var source = rawItem && typeof rawItem === "object" ? rawItem : {};
  var fallback = fallbackItem && typeof fallbackItem === "object" ? fallbackItem : {};
  var itemId = getItemId(source) || getItemId(fallback) || String(session.NowPlayingItemId || "").trim();
  var itemType = String(
    source.Type ||
    source.ItemType ||
    fallback.Type ||
    fallback.ItemType ||
    session.NowPlayingItemType ||
    ""
  ).trim();
  var itemName = String(
    source.Name ||
    source.Title ||
    fallback.Name ||
    fallback.Title ||
    session.NowPlayingItemName ||
    ""
  ).trim();

  return {
    ...fallback,
    ...source,
    Id: itemId,
    ItemId: itemId || String(source.ItemId || fallback.ItemId || "").trim(),
    Name: itemName,
    Type: itemType,
    ItemType: String(source.ItemType || fallback.ItemType || itemType).trim(),
    ImageTags: (source.ImageTags && typeof source.ImageTags === "object")
      ? source.ImageTags
      : ((fallback.ImageTags && typeof fallback.ImageTags === "object") ? fallback.ImageTags : {}),
    ProviderIds: (source.ProviderIds && typeof source.ProviderIds === "object")
      ? source.ProviderIds
      : ((fallback.ProviderIds && typeof fallback.ProviderIds === "object") ? fallback.ProviderIds : {})
  };
}

function getHighResImageUrls(item) {
  var itemId = getItemId(item);
  if (!itemId) {
    return {
      posterUrl: "",
      backdropUrl: "",
      placeholderUrl: ""
    };
  }
  var imageTag = item.ImageTags.Primary || item.PrimaryImageTag || "";
  var backdropTag =
    item.ImageTags.Backdrop.[0] ||
    item.BackdropImageTags.[0] ||
    item.ParentBackdropImageTags.[0] ||
    "";
  var backdropItemId = String(item.ParentBackdropItemId || itemId).trim() || itemId;
  var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  var posterHeight = Math.min(Math.round(420 * pixelRatio), 640);
  var backdropWidth = Math.min(Math.round((window.innerWidth || 1280) * pixelRatio), 1600);
  var formatParam = supportsWebP() ? "&format=webp" : "";

  var primaryPath = "/Items/" + (encodeURIComponent(itemId)) + "/Images/Primary?tag=" + (encodeURIComponent(imageTag)) + "&quality=85&maxHeight=" + (posterHeight) + (formatParam);
  var fallbackBackdropPath = "/Items/" + (encodeURIComponent(itemId)) + "/Images/Primary?tag=" + (encodeURIComponent(imageTag)) + "&quality=75&maxHeight=900" + (formatParam);
  var backdropPath = backdropTag
    ? "/Items/" + (encodeURIComponent(backdropItemId)) + "/Images/Backdrop/0?tag=" + (encodeURIComponent(backdropTag)) + "&quality=80&maxWidth=" + (backdropWidth) + (formatParam)
    : fallbackBackdropPath;

  return {
    posterUrl: withServer(primaryPath),
    backdropUrl: withServer(backdropPath),
    placeholderUrl: withServer("/Items/" + (encodeURIComponent(itemId)) + "/Images/Primary?tag=" + (encodeURIComponent(imageTag)) + "&maxHeight=80&blur=12")
  };
}

function buildInfoCards(device) {
  var cards = [
    { label: t("kullanici", "Usuário"), value: device.user },
    { label: t("cihaz", "Dispositivo"), value: device.deviceName },
    { label: t("istemci", "Cliente"), value: device.client },
    { label: t("year", "Ano"), value: device.year },
    { label: t("yonetmen", "Diretor"), value: device.directors },
    { label: t("sortArtist", "Artista"), value: device.artists },
    { label: t("sortAlbum", "Álbum"), value: device.album },
    { label: t("sortAlbumArtist", "Artista do Álbum"), value: device.albumArtist },
    { label: t("tracknumber", "Número da Faixa"), value: device.trackNumber }
  ];

  return cards.filterfunction((card) String(card.value || "").trim());
}

function buildTagGroups(device) {
  var groups = [
    { title: t("etiketler", "Gêneros"), value: device.genres },
    { title: t("ses", "Áudio"), value: device.audioLanguages },
    { title: t("altyazi", "Legenda"), value: device.subtitleLanguages }
  ];

  return groups.filterfunction((group) String(group.value || "").trim());
}

function buildLinkButtons(device) {
  var links = [];

  if (device.itemPageUrl) {
    links.push({
      href: device.itemPageUrl,
      label: t("yenisekme", "Abrir em nova aba"),
      icon: "fa-up-right-from-square"
    });
  }

  if (device.tmdbId) {
    links.push({
      href: "https://www.themoviedb.org/" + (device.item.Type === "Episode" || device.item.Type === "Series" ? "tv" : "movie") + "/" + (encodeURIComponent(device.tmdbId)),
      label: "TMDB",
      icon: "fa-film"
    });
  }

  if (device.imdbId) {
    links.push({
      href: "https://www.imdb.com/title/" + (encodeURIComponent(device.imdbId)),
      label: "IMDb",
      icon: "fa-star"
    });
  }

  return links;
}

function buildDeviceModel(session, itemDetails, access = null) {
  var item = normalizeNowPlayingItem(session.NowPlayingItem, session);
  var details = itemDetails
    ? normalizeNowPlayingItem(itemDetails, session, item)
    : item;
  var imageSource = getItemId(details) ? details : item;
  var { posterUrl, backdropUrl, placeholderUrl } = getHighResImageUrls(imageSource);
  var positionTicks = session.PlayState.PositionTicks || 0;
  var runtimeTicks = details.RunTimeTicks || item.RunTimeTicks || 0;
  var volumeLevel = clamp(session.PlayState.VolumeLevel || 50, 0, 100);
  var isMuted = !!session.PlayState.IsMuted;
  var clientLabel = resolveFriendlySessionClient(session);
  var deviceLabel = resolveFriendlySessionDeviceName(session);
  var itemId = getItemId(details) || getItemId(item);

  var device = {
    sessionId: session.Id,
    deviceId: String(session.DeviceId || "").trim(),
    itemId,
    session,
    item,
    itemDetails: details,
    title: details.Name || item.Name || t("castoynatiliyor", "Reproduzindo agora"),
    mediaIconClass: getMediaIconClass(details),
    mediaTypeText: getMediaTypeText(details),
    posterUrl,
    backdropUrl,
    placeholderUrl,
    user: session.UserName || t("belirsizkullanici", "Usuário desconhecido"),
    client: clientLabel,
    deviceName: deviceLabel,
    year: details.ProductionYear || "",
    directors: joinNonEmptyfunction(details.People.filter((person) person.Type.toLowerCase() === "director").mapfunction((person) person.Name) || []
    ),
    overview: details.Overview || "",
    genres: joinNonEmpty(details.Genres || []),
    audioLanguages: joinNonEmptyfunction(details.MediaStreams.filter((stream) stream.Type === "Audio").mapfunction((stream) stream.Language) || []
    ),
    subtitleLanguages: joinNonEmptyfunction(details.MediaStreams.filter((stream) stream.Type === "Subtitle").mapfunction((stream) stream.Language) || []
    ),
    artists: joinNonEmpty(details.Artists || []),
    album: details.Album || "",
    albumArtist: details.AlbumArtist || "",
    trackNumber: details.IndexNumber || "",
    communityRating: details.CommunityRating ? details.CommunityRating.toFixed(1) : "",
    officialRating: details.OfficialRating || "",
    tmdbId: details.ProviderIds.Tmdb || "",
    imdbId: details.ProviderIds.Imdb || "",
    itemPageUrl: itemId ? getDetailsUrl(itemId) : "",
    isPaused: !!session.PlayState.IsPaused,
    confirmedIsPaused: !!session.PlayState.IsPaused,
    isMuted,
    confirmedIsMuted: isMuted,
    volumeLevel,
    confirmedVolumeLevel: volumeLevel,
    lastNonZeroVolume: volumeLevel > 0 ? volumeLevel : 50,
    controlMode: "session",
    isFavorite: !!details.UserData.IsFavorite,
    positionTicks,
    runtimeTicks,
    lastSyncedAt: Date.now(),
    canControl: access.canControl === true
  };

  return device;
}

function buildDeviceModels(sessions = [], access = null) {
  var detailPromises = new Map();
  var gmmpState = getGmmpPlaybackSnapshot();
  var videoState = getLocalVideoPlaybackSnapshot();
  var remoteGmmpStateMap = fetchRemoteGmmpStateMap();
  var localSessionId = resolveCurrentBrowserSessionId(sessions, gmmpState);
  var getDetails = function(itemId) {
    if (!itemId) return Promise.resolve(null);
    if (!detailPromises.has(itemId)) {
      detailPromises.set(itemId, fetchItemDetails(itemId).catchfunction(() null));
    }
    return detailPromises.get(itemId);
  };

  return Promise.allfunction(sessions.map((session) {
      var details = getDetails(getSessionNowPlayingItemId(session));
      var device = buildDeviceModel(session, details, access);
      var remoteGmmpState = getRemoteGmmpStateForDevice(session, remoteGmmpStateMap);
      syncDeviceControlMode(device, session, gmmpState, videoState, remoteGmmpState, localSessionId);
      return device;
    })
  );
}

function renderMetricChips(device) {
  var chips = [];

  if (device.mediaTypeText) {
    chips.push("\n      <span class=\"jms-cast-chip jms-cast-chip--ghost\">\n        " + (renderIcon(device.mediaIconClass)) + "\n        <span>" + (escapeHtml(device.mediaTypeText)) + "</span>\n      </span>\n    ");
  }

  if (device.year) {
    chips.push("<span class=\"jms-cast-chip\">" + (escapeHtml(device.year)) + "</span>");
  }

  if (device.communityRating) {
    chips.push("\n      <span class=\"jms-cast-chip jms-cast-chip--rating\">\n        " + (renderIcon("fa-star")) + "\n        <span>" + (escapeHtml(device.communityRating)) + "</span>\n      </span>\n    ");
  }

  if (device.officialRating) {
    chips.push("\n      <span class=\"jms-cast-chip jms-cast-chip--ghost\">\n        " + (renderIcon("fa-certificate")) + "\n        <span>" + (escapeHtml(device.officialRating)) + "</span>\n      </span>\n    ");
  }

  return chips.join("");
}

function renderInfoCardsHtml(device) {
  return buildInfoCards(device)
    .mapfunction((card) "\n        <div class=\"jms-cast-info-card\">\n          <span class=\"jms-cast-info-card__label\">" + (escapeHtml(card.label)) + "</span>\n          <strong class=\"jms-cast-info-card__value\">" + (escapeHtml(card.value)) + "</strong>\n        </div>\n      "
    )
    .join("");
}

function renderTagGroupsHtml(device) {
  return buildTagGroups(device)
    .mapfunction((group) "\n        <div class=\"jms-cast-tag-group\">\n          <span class=\"jms-cast-tag-group__title\">" + (escapeHtml(group.title)) + "</span>\n          <div class=\"jms-cast-tag-group__body\">" + (escapeHtml(group.value)) + "</div>\n        </div>\n      "
    )
    .join("");
}

function renderLinkButtonsHtml(device) {
  return buildLinkButtons(device)
    .mapfunction((link) "\n        <a class=\"jms-cast-link-button\" href=\"" + (escapeHtml(link.href)) + "\" target=\"_blank\" rel=\"noopener noreferrer\">\n          " + (renderIcon(link.icon)) + "\n          <span>" + (escapeHtml(link.label)) + "</span>\n        </a>\n      "
    )
    .join("");
}

function isReadOnlyDevice(device) {
  return device.canControl !== true;
}

function renderDisabledAttr(disabled) {
  return disabled ? ' disabled aria-disabled="true"' : "";
}

function renderViewerBadge(userName) {
  if (!String(userName || "").trim()) return "";
  return "<span class=\"jms-cast-viewer-badge\">" + (escapeHtml(userName)) + "</span>";
}

function renderPosterMarkup(device) {
  if (device.posterUrl) {
    return "\n      <img\n        class=\"jms-cast-slide__poster\"\n        src=\"" + (escapeHtml(device.posterUrl)) + "\"\n        alt=\"" + (escapeHtml(device.title)) + "\"\n        loading=\"lazy\"\n        decoding=\"async\"\n      />\n    ";
  }

  return "\n    <div class=\"jms-cast-slide__poster jms-cast-slide__poster--placeholder\" aria-hidden=\"true\">\n      " + (renderIcon(device.mediaIconClass)) + "\n    </div>\n  ";
}

function renderVolumeControl(device) {
  var volume = clamp(device.volumeLevel, 0, 100);
  var disabled = isReadOnlyDevice(device);
  return "\n    <div class=\"jms-cast-volume\" data-session-id=\"" + (escapeHtml(device.sessionId)) + "\">\n      <div class=\"jms-cast-volume__row\">\n        <button\n          type=\"button\"\n          class=\"jms-cast-action jms-cast-action--secondary\"\n          data-action=\"mute\"\n          data-session-id=\"" + (escapeHtml(device.sessionId)) + "\"\n          " + (renderDisabledAttr(disabled)) + "\n        >\n          " + (getMuteButtonContent(device)) + "\n        </button>\n        <span class=\"jms-cast-volume__value\" data-role=\"volume-value\">" + (volume) + "%</span>\n      </div>\n      <input\n        class=\"jms-cast-volume__slider\"\n        type=\"range\"\n        min=\"0\"\n        max=\"100\"\n        value=\"" + (volume) + "\"\n        data-session-id=\"" + (escapeHtml(device.sessionId)) + "\"\n        aria-label=\"" + (escapeHtml(t("ses", "Ses"))) + "\"\n        " + (renderDisabledAttr(disabled)) + "\n      />\n    </div>\n  ";
}

function renderServerSection() {
  return "\n    <section class=\"jms-cast-server\">\n      <button\n        type=\"button\"\n        class=\"jms-cast-server__toggle\"\n        data-action=\"server-toggle\"\n        aria-expanded=\"false\"\n      >\n        <span class=\"jms-cast-server__toggle-label\">\n          " + (renderIcon("fa-server")) + "\n          <span>" + (escapeHtml(t("sunucubilgi", "Info do Servidor"))) + "</span>\n        </span>\n        " + (renderIcon("fa-chevron-down")) + "\n      </button>\n      <div class=\"jms-cast-server__panel\" data-role=\"server-panel\" hidden></div>\n    </section>\n  ";
}

function renderSlide(device, index, options = {}) {
  var compact = options.compact === true;
  var clickableHero = options.clickableHero === true;
  var progressPercent = device.runtimeTicks > 0
    ? clamp((device.positionTicks / device.runtimeTicks) * 100, 0, 100)
    : 0;
  var disabled = isReadOnlyDevice(device);
  var compactMeta = [device.mediaTypeText, device.client, device.deviceName].filter(Boolean).join(" • ");
  var heroAttrs = [
    "class=\"jms-cast-slide__hero" + (clickableHero ? " is-clickable" : "") + "\""
  ];

  if (clickableHero) {
    heroAttrs.push("data-action=\"open-modal\"");
    heroAttrs.push("role=\"button\"");
    heroAttrs.push("tabindex=\"0\"");
    heroAttrs.push("aria-label=\"${escapeHtml("${device.title} - ${device.user}")}\"");
  }

  return "\n    <section\n      class=\"jms-cast-slide\"\n      data-session-id=\"" + (escapeHtml(device.sessionId)) + "\"\n      data-item-id=\"" + (escapeHtml(device.itemId)) + "\"\n      data-index=\"" + (index) + "\"\n      data-read-only=\"" + (disabled ? "true" : "false") + "\"\n    >\n      <div class=\"jms-cast-slide__body\">\n        <div " + (heroAttrs.join(" ")) + ">\n          <div class=\"jms-cast-slide__poster-wrap\">\n            " + (renderPosterMarkup(device)) + "\n          </div>\n\n          <div class=\"jms-cast-slide__header\">\n            <div class=\"jms-cast-slide__eyebrow-row\">\n              <span class=\"jms-cast-slide__eyebrow\">" + (escapeHtml(t("castoynatiliyor", "Reproduzindo agora"))) + "</span>\n              " + (renderViewerBadge(device.user)) + "\n            </div>\n            <h2 class=\"jms-cast-slide__title\">\n              " + (renderIcon(device.mediaIconClass)) + "\n              <span>" + (escapeHtml(device.title)) + "</span>\n            </h2>\n            ${compact\n              ? "
                ${compactMeta ? "<p class=\"jms-cast-slide__summary\">" + (escapeHtml(compactMeta)) + "</p>" : ""}
                <div class="jms-cast-slide__chips">
                  ${renderMetricChips(device)}
                </div>
                ${device.overview ? "<p class=\"jms-cast-slide__overview\">" + (escapeHtml(device.overview)) + "</p>" : ""}
              "\n              : "
                <div class="jms-cast-slide__chips">
                  ${renderMetricChips(device)}
                </div>
                ${device.overview ? "<p class=\"jms-cast-slide__overview\">" + (escapeHtml(device.overview)) + "</p>" : ""}
              "\n            }\n          </div>\n        </div>\n\n        <div class=\"jms-cast-progress\">\n          <div class=\"jms-cast-progress__rail\">\n            <span class=\"jms-cast-progress__fill\" data-role=\"progress-fill\" style=\"width:" + (progressPercent) + "%\"></span>\n          </div>\n          <div class=\"jms-cast-progress__times\">\n            <span data-role=\"duration\">${escapeHtml("${formatTime(device.positionTicks)} / ${formatTime(device.runtimeTicks)}")}</span>\n            <span data-role=\"remaining\">" + (escapeHtml(formatRemainingTime(device.positionTicks, device.runtimeTicks))) + "</span>\n          </div>\n        </div>\n\n        ${compact ? \"\" : "
          <div class="jms-cast-controls">
            <button
              type="button"
              class="jms-cast-action"
              data-action="playback"
              data-session-id="${escapeHtml(device.sessionId)}"
              ${renderDisabledAttr(disabled)}
            >
              ${getPlaybackButtonContent(device)}
            </button>
            <button
              type="button"
              class="jms-cast-action ${device.isFavorite ? "is-active" : ""}"
              data-action="favorite"
              data-item-id="${escapeHtml(device.itemId)}"
              ${renderDisabledAttr(disabled)}
            >
              ${getFavoriteButtonContent(device)}
            </button>
            ${renderVolumeControl(device)}
          </div>

          <div class="jms-cast-links">
            ${renderLinkButtonsHtml(device)}
          </div>

          <div class="jms-cast-info-grid">
            ${renderInfoCardsHtml(device)}
          </div>

          <div class="jms-cast-tag-groups">
            ${renderTagGroupsHtml(device)}
          </div>

          ${renderServerSection()}
        "}\n      </div>\n    </section>\n  ";
}

function renderDots(devices, activeIndex) {
  return devices
    .mapfunction((device, index) "\n        <button\n          type=\"button\"\n          class=\"jms-cast-dot " + (index === activeIndex ? "is-active" : "") + "\"\n          data-action=\"jump\"\n          data-index=\"" + (index) + "\"\n          aria-label=\"${escapeHtml("${device.deviceName} - ${device.title}")}\"\n        ></button>\n      "
    )
    .join("");
}

function renderModalShell(content, { className = "", labelledBy = "" } = {}) {
  var shellClassName = ["jms-cast-modal__shell", className].filter(Boolean).join(" ");
  var shellAttributes = [
    "class=\"" + (shellClassName) + "\"",
    'data-role="shell"',
    'role="dialog"',
    'aria-modal="true"',
    labelledBy ? "aria-labelledby=\"" + (escapeHtml(labelledBy)) + "\"" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return "<section " + (shellAttributes) + ">" + (content) + "</section>";
}

function renderModalMarkup(devices, activeIndex) {
  var activeDevice = devices[activeIndex] || devices[0];
  var headerTitle = activeDevice.deviceName || t("castcihaz", "Dispositivo desconhecido");
  var subtitleParts = [activeDevice.title, activeDevice.client].filter(Boolean).join(" • ");

  return "\n    <div class=\"jms-cast-modal__scrim\" data-action=\"close\"></div>\n    ${renderModalShell("
      <header class="jms-cast-modal__header">
        <div class="jms-cast-modal__headline">
          <div class="jms-cast-modal__eyebrow-row">
            <span class="jms-cast-modal__eyebrow">${escapeHtml(t("castoynatiliyor", "Reproduzindo agora"))}</span>
            ${renderViewerBadge(activeDevice.user)}
          </div>
          <h2 id="jms-cast-modal-title" data-role="active-title">${escapeHtml(headerTitle)}</h2>
          <p data-role="active-subtitle">${escapeHtml(subtitleParts)}</p>
        </div>
        <div class="jms-cast-modal__toolbar">
          <button type="button" class="jms-cast-toolbar-btn" data-action="refresh">
            ${renderButtonLabel("fa-rotate-right", t("yenile", "Atualizar"), "jms-cast-toolbar-btn__label")}
          </button>
          <button type="button" class="jms-cast-toolbar-btn jms-cast-toolbar-btn--close" data-action="close" aria-label="${escapeHtml(t("kapat", "Fechar"))}">
            ${renderIcon("fa-xmark")}
          </button>
        </div>
      </header>

      <div class="jms-cast-modal__viewport" data-role="viewport">
        ${devices.mapfunction((device, index) renderSlide(device, index)).join("")}
      </div>

      <footer class="jms-cast-modal__footer">
        <div class="jms-cast-dots" data-role="dots">
          ${renderDots(devices, activeIndex)}
        </div>
      </footer>
    ", { labelledBy: \"jms-cast-modal-title\" })}\n  ";
}

function createLoadingMarkup() {
  return "\n    <div class=\"jms-cast-modal__scrim\" data-action=\"close\"></div>\n    ${renderModalShell("
      <div class="jms-cast-modal__loading">
        <div class="jms-cast-modal__spinner"></div>
        <p>${escapeHtml(t("castyukleniyor", "Procurando dispositivos..."))}</p>
      </div>
    ", { className: \"jms-cast-modal__shell--loading\" })}\n  ";
}

function cacheSlideRefs(state) {
  state.shell = state.root.querySelector('[data-role="shell"]');
  state.viewport = state.root.querySelector('[data-role="viewport"]');
  state.title = state.root.querySelector('[data-role="active-title"]');
  state.subtitle = state.root.querySelector('[data-role="active-subtitle"]');
  state.dotsHost = state.root.querySelector('[data-role="dots"]');
  state.slideRefs = new Map();

  state.root.querySelectorAll(".jms-cast-slide").forEach(function((slide) {
    var sessionId = slide.dataset.sessionId;
    if (!sessionId) return;

    state.slideRefs.set(sessionId, {
      slide,
      duration: slide.querySelector('[data-role="duration"]'),
      remaining: slide.querySelector('[data-role="remaining"]'),
      progressFill: slide.querySelector('[data-role="progress-fill"]'),
      playButton: slide.querySelector('[data-action="playback"]'),
      favoriteButton: slide.querySelector('[data-action="favorite"]'),
      muteButton: slide.querySelector('[data-action="mute"]'),
      volumeSlider: slide.querySelector(".jms-cast-volume__slider"),
      volumeValue: slide.querySelector('[data-role="volume-value"]'),
      serverPanel: slide.querySelector('[data-role="server-panel"]'),
      serverToggle: slide.querySelector('[data-action="server-toggle"]')
    });
  });
}

function updateHeaderForActiveDevice(state) {
  var activeDevice = state.devices[state.activeIndex];
  if (!activeDevice) return;

  if (state.title) {
    state.title.textContent = activeDevice.deviceName || t("castcihaz", "Bilinmeyen cihaz");
  }

  if (state.subtitle) {
    state.subtitle.textContent = [activeDevice.title, activeDevice.client].filter(Boolean).join(" • ");
  }

  var eyebrowRow = state.root.querySelector(".jms-cast-modal__eyebrow-row");
  if (eyebrowRow) {
    eyebrowRow.innerHTML = "\n      <span class=\"jms-cast-modal__eyebrow\">" + (escapeHtml(t("castoynatiliyor", "Şu an oynatılıyor"))) + "</span>\n      " + (renderViewerBadge(activeDevice.user)) + "\n    ";
  }

  state.root.querySelectorAll(".jms-cast-dot").forEach(function((dot, index) {
    dot.classList.toggle("is-active", index === state.activeIndex);
  });
}

function applyDeviceProgressToDom(state, device) {
  var refs = state.slideRefs.get(device.sessionId);
  if (!refs) return;

  var durationText = (formatTime(device.positionTicks)) + " / " + (formatTime(device.runtimeTicks));
  var remainingText = formatRemainingTime(device.positionTicks, device.runtimeTicks);
  var progressPercent = device.runtimeTicks > 0
    ? clamp((device.positionTicks / device.runtimeTicks) * 100, 0, 100)
    : 0;

  if (refs.duration) refs.duration.textContent = durationText;
  if (refs.remaining) refs.remaining.textContent = remainingText;
  if (refs.progressFill) refs.progressFill.style.width = (progressPercent) + "%";
}

function applyDeviceStateToDom(state, device) {
  var refs = state.slideRefs.get(device.sessionId);
  if (!refs) return;
  var volume = clamp(device.volumeLevel, 0, 100);

  if (refs.playButton) refs.playButton.innerHTML = getPlaybackButtonContent(device);
  if (refs.favoriteButton) {
    refs.favoriteButton.innerHTML = getFavoriteButtonContent(device);
    refs.favoriteButton.classList.toggle("is-active", !!device.isFavorite);
  }
  if (refs.muteButton) refs.muteButton.innerHTML = getMuteButtonContent(device);
  if (refs.volumeSlider) refs.volumeSlider.value = String(volume);
  if (refs.volumeValue) refs.volumeValue.textContent = (volume) + "%";

  refs.slide.dataset.paused = device.isPaused ? "true" : "false";
  refs.slide.dataset.muted = isEffectivelyMuted(device) ? "true" : "false";
  applyDeviceProgressToDom(state, device);
}

function applyAllDevicesToDom(state) {
  state.devices.forEach(function((device) applyDeviceStateToDom(state, device));
  updateHeaderForActiveDevice(state);
}

function getViewportWidth(state) {
  var viewportRectWidth = state.viewport.getBoundingClientRect.().width;
  if (viewportRectWidth) return viewportRectWidth;

  var shellRectWidth = state.shell.getBoundingClientRect.().width;
  if (shellRectWidth) return shellRectWidth;

  return state.viewport.clientWidth || state.shell.clientWidth || 0;
}

function bindViewport(state) {
  if (state.viewportCleanup) {
    state.viewportCleanup();
    state.viewportCleanup = null;
  }

  if (!state.viewport) return;

  var onScroll = function() {
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
    }

    state.scrollTimer = window.setTimeoutfunction(() {
      if (!isActiveModalState(state) || !state.viewport) return;
      var nextIndex = Math.round(state.viewport.scrollLeft / Math.max(1, getViewportWidth(state)));
      var boundedIndex = clamp(nextIndex, 0, Math.max(0, state.devices.length - 1));
      if (boundedIndex !== state.activeIndex) {
        state.activeIndex = boundedIndex;
        updateHeaderForActiveDevice(state);
      }
    }, SCROLL_DEBOUNCE_MS);
  };

  state.viewport.addEventListener("scroll", onScroll, { passive: true });
  state.viewportCleanup = function() {
    state.viewport.removeEventListener("scroll", onScroll);
    if (state.scrollTimer) {
      clearTimeout(state.scrollTimer);
      state.scrollTimer = 0;
    }
  };
}

function scrollToSlide(state, index, behavior = "smooth") {
  if (!state.viewport) return;

  var boundedIndex = clamp(index, 0, Math.max(0, state.devices.length - 1));
  var viewportWidth = getViewportWidth(state);
  state.activeIndex = boundedIndex;
  updateHeaderForActiveDevice(state);
  state.viewport.scrollTo({
    left: boundedIndex * viewportWidth,
    behavior
  });
}

function cleanupModalState(state) {
  if (!state) return;

  if (state.syncInterval) {
    clearInterval(state.syncInterval);
    state.syncInterval = 0;
  }

  if (state.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = 0;
  }

  if (state.pendingSyncTimer) {
    clearTimeout(state.pendingSyncTimer);
    state.pendingSyncTimer = 0;
  }

  if (state.scrollTimer) {
    clearTimeout(state.scrollTimer);
    state.scrollTimer = 0;
  }

  state.volumeTimers.forEach(function((timerId) clearTimeout(timerId));
  state.volumeTimers.clear();
  state.pendingVolumeValues.clear();
  state.pendingSessionActions.clear();
  state.pendingItemActions.clear();
  state.viewportCleanup.();
  state.rootCleanup.();
  state.abortController.abort();

  if (state.onKeyDown) {
    document.removeEventListener("keydown", state.onKeyDown);
  }
}

function closeCastModal() {
  var state = castModalState;
  if (!state) return;

  castModalState = null;
  cleanupModalState(state);
  state.root.remove();
}

function queueModalSync(state, delay = 0) {
  if (!isActiveModalState(state)) return;

  if (state.pendingSyncTimer) {
    clearTimeout(state.pendingSyncTimer);
  }

  state.pendingSyncTimer = window.setTimeoutfunction(() {
    state.pendingSyncTimer = 0;
    void syncCastModalState(state);
  }, Math.max(0, delay));
}

function updateDeviceFromSession(device, session, state, gmmpState = null, videoState = null, remoteGmmpState = null, localSessionId = "") {
  var volumePending = state.pendingVolumeValues.has(device.sessionId);
  var sessionActionPending = state.pendingSessionActions.has(device.sessionId);

  device.session = session;
  device.deviceId = String(session.DeviceId || device.deviceId || "").trim();
  device.item = session.NowPlayingItem || device.item;
  device.runtimeTicks = session.NowPlayingItem.RunTimeTicks || device.runtimeTicks;
  device.positionTicks = session.PlayState.PositionTicks || device.positionTicks;
  device.lastSyncedAt = Date.now();

  if (!sessionActionPending) {
    device.isPaused = !!session.PlayState.IsPaused;
    device.confirmedIsPaused = !!session.PlayState.IsPaused;
    device.isMuted = !!session.PlayState.IsMuted;
    device.confirmedIsMuted = !!session.PlayState.IsMuted;
  }

  if (!volumePending) {
    device.volumeLevel = clamp(session.PlayState.VolumeLevel || device.volumeLevel, 0, 100);
    device.confirmedVolumeLevel = device.volumeLevel;
    if (device.volumeLevel > 0) {
      device.lastNonZeroVolume = device.volumeLevel;
    }
  }

  syncDeviceControlMode(device, session, gmmpState, videoState, remoteGmmpState, localSessionId);
}

function hydrateCastModal(state, { preferredSessionId = "" } = {}) {
  var gmmpState = getGmmpPlaybackSnapshot();
  var videoState = getLocalVideoPlaybackSnapshot();
  var remoteGmmpStateMap = fetchRemoteGmmpStateMap({ signal: state.abortController.signal });
  var sessions = sanitizeVisiblePlaybackSessions(
    fetchVisiblePlaybackSessions({ signal: state.abortController.signal }),
    { gmmpState, videoState, remoteGmmpStateMap }
  );
  if (!isActiveModalState(state)) return;

  if (!sessions.length && state.devices.length) {
    if (preserveKnownDeviceStates(state, { gmmpState, videoState, remoteGmmpStateMap })) {
      applyAllDevicesToDom(state);
      return;
    }
  }

  if (sessions.length === 0) {
    closeCastModal();
    showNotification(t("castbulunamadi", "Nenhum dispositivo encontrado"), "error");
    return;
  }

  var devices = buildDeviceModels(sessions, state.access);
  if (!isActiveModalState(state)) return;

  state.signature = getSessionSignature(sessions);
  state.devices = devices;
  state.deviceMap = new Mapfunction(devices.map((device) [device.sessionId, device]));
  state.root.innerHTML = renderModalMarkup(devices, 0);
  cacheSlideRefs(state);

  var targetIndex = Math.maxfunction(0,
    devices.findIndex((device) device.sessionId === preferredSessionId)
  );

  state.activeIndex = targetIndex >= 0 ? targetIndex : 0;
  bindViewport(state);
  applyAllDevicesToDom(state);

  if (state.activeIndex > 0) {
    scrollToSlide(state, state.activeIndex, "auto");
  }

  if (!state.syncInterval) {
    state.syncInterval = window.setIntervalfunction(() {
      void syncCastModalState(state);
    }, CAST_MODAL_SYNC_MS);
  }

  if (!state.tickInterval) {
    state.tickInterval = window.setIntervalfunction(() {
      tickCastModalState(state);
    }, CAST_MODAL_TICK_MS);
  }
}

function syncCastModalState(state) {
  if (!isActiveModalState(state) || state.isSyncing) return;

  state.isSyncing = true;
  try {
    var gmmpState = getGmmpPlaybackSnapshot();
    var videoState = getLocalVideoPlaybackSnapshot();
    var remoteGmmpStateMap = fetchRemoteGmmpStateMap({ signal: state.abortController.signal });
    var sessions = sanitizeVisiblePlaybackSessions(
      fetchVisiblePlaybackSessions({ signal: state.abortController.signal }),
      { gmmpState, videoState, remoteGmmpStateMap }
    );
    var localSessionId = resolveCurrentBrowserSessionId(sessions, gmmpState);
    if (!isActiveModalState(state)) return;

    if (sessions.length === 0) {
      if (preserveKnownDeviceStates(state, { gmmpState, videoState, remoteGmmpStateMap })) {
        applyAllDevicesToDom(state);
        return;
      }
      closeCastModal();
      return;
    }

    var signature = getSessionSignature(sessions);
    if (signature !== state.signature) {
      var activeSessionId = state.devices[state.activeIndex].sessionId || "";
      hydrateCastModal(state, { preferredSessionId: activeSessionId });
      return;
    }

    var sessionsById = new Mapfunction(sessions.map((session) [session.Id, session]));
    state.devices.forEach(function((device) {
      var freshSession = sessionsById.get(device.sessionId);
      if (!freshSession) return;
      var remoteGmmpState = getRemoteGmmpStateForDevice(device, remoteGmmpStateMap);
      updateDeviceFromSession(device, freshSession, state, gmmpState, videoState, remoteGmmpState, localSessionId);
    });

    applyAllDevicesToDom(state);
  } catch (error) {
    if (!error.isAbort) {
      console.error("Erro de sincronização do modal de transmissão:", error);
    }
  } finally {
    state.isSyncing = false;
  }
}

function tickCastModalState(state) {
  if (!isActiveModalState(state)) return;

  var videoState = getLocalVideoPlaybackSnapshot();
  state.devices.forEach(function((device) {
    if (device.controlMode === "local-video" && isMatchingLocalVideoItem(device, videoState)) {
      applyLocalVideoStateToDevice(device, videoState);
      applyDeviceStateToDom(state, device);
      return;
    }

    if (device.isPaused || !device.runtimeTicks) return;

    var nextTicks = Math.min(device.runtimeTicks, device.positionTicks + 10_000_000);
    if (nextTicks !== device.positionTicks) {
      device.positionTicks = nextTicks;
      applyDeviceProgressToDom(state, device);
    }
  });

  state.root.querySelectorAll(".jms-cast-server__local-time").forEach(function((element) {
    element.textContent = new Date().toLocaleString();
  });
}

function sendSessionCommand(sessionId, name, args = undefined, { signal } = {}) {
  var body = {
    Name: name,
    ControllingUserId: getSessionInfo().userId
  };

  if (args) {
    body.Arguments = args;
  }

  return makeApiRequest("/Sessions/" + (encodeURIComponent(sessionId)) + "/Command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
}

function sendRemoteGmmpCommand(target, name, args = undefined, { signal, bindToCurrentTrack = true } = {}) {
  var sessionId = String(
    target.sessionId ||
    target.SessionId ||
    target.Id ||
    ""
  ).trim();
  var deviceId = String(
    target.deviceId ||
    target.DeviceId ||
    target.session.DeviceId ||
    ""
  ).trim();
  var payload = {
    sessionId,
    deviceId,
    name,
    arguments: Object.entries(args || {}).reducefunction((acc, [key, value]) {
      acc[key] = value == null ? "" : String(value);
      return acc;
    }, {})
  };
  var itemId = String(
    target.remoteGmmpState.trackId ||
    target.remoteGmmpState.itemId ||
    target.itemId ||
    target.item.Id ||
    target.itemDetails.Id ||
    target.NowPlayingItem.Id ||
    ""
  ).trim();

  if (bindToCurrentTrack && itemId) {
    if (!payload.arguments.ItemId) payload.arguments.ItemId = itemId;
    if (!payload.arguments.TrackId) payload.arguments.TrackId = itemId;
  }

  try {
    console.warn("[GMMP remote] enqueue command", {
      ...payload,
      bindToCurrentTrack,
      resolvedItemId: itemId
    });
  } catch {}

  return makeCastApiRequest("/Plugins/NexusPobreFlix/gmmp/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
    __quiet: true
  });
}

function setSessionPending(state, sessionId, pending) {
  var refs = state.slideRefs.get(sessionId);
  if (!refs) return;

  [refs.playButton, refs.muteButton, refs.volumeSlider].forEach(function((button) {
    if (!button) return;
    button.disabled = pending;
    button.classList.toggle("is-busy", pending);
  });
}

function setItemPending(state, itemId, pending) {
  state.root.querySelectorAll("[data-item-id=\"" + (escapeSelectorValue(itemId)) + "\"]").forEach(function((button) {
    button.disabled = pending;
    button.classList.toggle("is-busy", pending);
  });
}

function handlePlaybackToggle(state, sessionId) {
  if (!isActiveModalState(state) || state.pendingSessionActions.has(sessionId)) return;

  var device = state.deviceMap.get(sessionId);
  if (!device) return;

  var controlSnapshot = refreshDeviceControlMode(device, { signal: state.abortController.signal });
  var shouldSendRemoteGmmp =
    device.controlMode === "gmmp-remote" ||
    (!!controlSnapshot.remoteGmmpState.hasCurrentTrack && controlSnapshot.isLocalSession !== true);
  var shouldAttemptRemoteGmmp = shouldSendRemoteGmmp || isPotentialRemoteGmmpTarget(device, controlSnapshot);
  try {
    console.warn("[GMMP remote] route", {
      action: "playback",
      sessionId,
      controlMode: device.controlMode,
      shouldSendRemoteGmmp,
      shouldAttemptRemoteGmmp
    });
  } catch {}

  var nextPaused = !device.isPaused;
  var previousPaused = device.isPaused;
  device.isPaused = nextPaused;
  state.pendingSessionActions.add(sessionId);
  setSessionPending(state, sessionId, true);
  applyDeviceStateToDom(state, device);

  try {
    if (device.controlMode === "gmmp") {
      var gmmpState = setGmmpPausedState(nextPaused);
      applyGmmpStateToDevice(device, gmmpState);
    } else if (shouldAttemptRemoteGmmp || device.controlMode === "gmmp-remote") {
      sendRemoteGmmpCommand(
        device,
        nextPaused ? "Pause" : "Unpause",
        undefined,
        {
          signal: state.abortController.signal,
          bindToCurrentTrack: shouldSendRemoteGmmp || device.controlMode === "gmmp-remote"
        }
      );
      device.confirmedIsPaused = nextPaused;
    } else if (device.controlMode === "local-video") {
      var videoState = setLocalVideoPausedState(nextPaused);
      applyLocalVideoStateToDevice(device, videoState);
    } else {
      makeApiRequest(
        "/Sessions/" + (encodeURIComponent(sessionId)) + "/Playing/" + (nextPaused ? "Pause" : "Unpause"),
        {
          method: "POST",
          signal: state.abortController.signal
        }
      );

      device.confirmedIsPaused = nextPaused;
    }

    showNotification(
      nextPaused ? t("duraklatildi", "Pausado") : t("devamettirildi", "Retomado"),
      "success"
    );
    queueModalSync(state, 350);
  } catch (error) {
    device.isPaused = previousPaused;
    showNotification((t("islemhatasi", "Erro de operação")) + ": " + (error.message), "error");
  } finally {
    state.pendingSessionActions.delete(sessionId);
    setSessionPending(state, sessionId, false);
    applyDeviceStateToDom(state, device);
  }
}

function handleMuteToggle(state, sessionId) {
  if (!isActiveModalState(state) || state.pendingSessionActions.has(sessionId)) return;

  var device = state.deviceMap.get(sessionId);
  if (!device) return;

  var controlSnapshot = refreshDeviceControlMode(device, { signal: state.abortController.signal });
  var shouldSendRemoteGmmp =
    device.controlMode === "gmmp-remote" ||
    (!!controlSnapshot.remoteGmmpState.hasCurrentTrack && controlSnapshot.isLocalSession !== true);
  var shouldAttemptRemoteGmmp = shouldSendRemoteGmmp || isPotentialRemoteGmmpTarget(device, controlSnapshot);
  try {
    console.warn("[GMMP remote] route", {
      action: "mute",
      sessionId,
      controlMode: device.controlMode,
      shouldSendRemoteGmmp,
      shouldAttemptRemoteGmmp
    });
  } catch {}

  var previousMuted = device.isMuted;
  var previousVolume = device.volumeLevel;
  var nextMuted = !device.isMuted;

  if (!nextMuted && device.lastNonZeroVolume > 0) {
    device.volumeLevel = device.lastNonZeroVolume;
  }
  if (nextMuted) {
    if (device.volumeLevel > 0) {
      device.lastNonZeroVolume = device.volumeLevel;
    }
    device.volumeLevel = 0;
  }
  device.isMuted = nextMuted;

  state.pendingSessionActions.add(sessionId);
  setSessionPending(state, sessionId, true);
  applyDeviceStateToDom(state, device);

  try {
    if (device.controlMode === "gmmp") {
      var gmmpState = nextMuted
        ? setGmmpMutedState(true)
        : setGmmpVolumeLevel(device.lastNonZeroVolume > 0 ? device.lastNonZeroVolume : Math.max(previousVolume, 1));
      applyGmmpStateToDevice(device, gmmpState);
    } else if (shouldAttemptRemoteGmmp || device.controlMode === "gmmp-remote") {
      sendRemoteGmmpCommand(
        device,
        nextMuted ? "Mute" : "Unmute",
        undefined,
        {
          signal: state.abortController.signal,
          bindToCurrentTrack: shouldSendRemoteGmmp || device.controlMode === "gmmp-remote"
        }
      );
      device.confirmedIsMuted = nextMuted;
      if (!nextMuted && device.volumeLevel > 0) {
        device.confirmedVolumeLevel = device.volumeLevel;
      }
    } else if (device.controlMode === "local-video") {
      var videoState = nextMuted
        ? setLocalVideoMutedState(true)
        : setLocalVideoVolumeLevel(device.lastNonZeroVolume > 0 ? device.lastNonZeroVolume : Math.max(previousVolume, 1));
      applyLocalVideoStateToDevice(device, videoState);
    } else {
      sendSessionCommand(
        sessionId,
        nextMuted ? "Mute" : "Unmute",
        undefined,
        { signal: state.abortController.signal }
      );

      device.confirmedIsMuted = nextMuted;
      if (!nextMuted && device.volumeLevel > 0) {
        device.confirmedVolumeLevel = device.volumeLevel;
      }
    }

    showNotification(
      nextMuted ? t("volOff", "Mudo ativado") : t("volOn", "Mudo desativado"),
      "success"
    );
    queueModalSync(state, 350);
  } catch (error) {
    device.isMuted = previousMuted;
    device.volumeLevel = previousVolume;
    showNotification((t("seshata", "Erro de volume")) + ": " + (error.message), "error");
  } finally {
    state.pendingSessionActions.delete(sessionId);
    setSessionPending(state, sessionId, false);
    applyDeviceStateToDom(state, device);
  }
}

function scheduleVolumeCommit(state, sessionId, volume, immediate = false) {
  if (!isActiveModalState(state)) return;

  if (state.volumeTimers.has(sessionId)) {
    clearTimeout(state.volumeTimers.get(sessionId));
    state.volumeTimers.delete(sessionId);
  }

  state.pendingVolumeValues.set(sessionId, volume);

  if (immediate) {
    void commitVolume(state, sessionId);
    return;
  }

  var timerId = window.setTimeoutfunction(() {
    state.volumeTimers.delete(sessionId);
    void commitVolume(state, sessionId);
  }, VOLUME_COMMIT_DELAY_MS);

  state.volumeTimers.set(sessionId, timerId);
}

function commitVolume(state, sessionId) {
  if (!isActiveModalState(state)) return;

  var device = state.deviceMap.get(sessionId);
  if (!device) return;

  var controlSnapshot = refreshDeviceControlMode(device, { signal: state.abortController.signal });
  var shouldSendRemoteGmmp =
    device.controlMode === "gmmp-remote" ||
    (!!controlSnapshot.remoteGmmpState.hasCurrentTrack && controlSnapshot.isLocalSession !== true);
  var shouldAttemptRemoteGmmp = shouldSendRemoteGmmp || isPotentialRemoteGmmpTarget(device, controlSnapshot);
  try {
    console.warn("[GMMP remote] route", {
      action: "volume",
      sessionId,
      controlMode: device.controlMode,
      shouldSendRemoteGmmp,
      shouldAttemptRemoteGmmp,
      targetVolume: clamp(state.pendingVolumeValues.get(sessionId) || device.volumeLevel, 0, 100)
    });
  } catch {}

  var targetVolume = clamp(state.pendingVolumeValues.get(sessionId) || device.volumeLevel, 0, 100);
  state.pendingVolumeValues.delete(sessionId);

  try {
    if (device.controlMode === "gmmp") {
      var gmmpState = setGmmpVolumeLevel(targetVolume);
      applyGmmpStateToDevice(device, gmmpState);
    } else if (shouldAttemptRemoteGmmp || device.controlMode === "gmmp-remote") {
      sendRemoteGmmpCommand(
        device,
        "SetVolume",
        { Volume: targetVolume },
        {
          signal: state.abortController.signal,
          bindToCurrentTrack: shouldSendRemoteGmmp || device.controlMode === "gmmp-remote"
        }
      );
      device.volumeLevel = targetVolume;
      device.confirmedVolumeLevel = targetVolume;
      if (targetVolume > 0) {
        device.lastNonZeroVolume = targetVolume;
        device.isMuted = false;
        device.confirmedIsMuted = false;
      } else {
        device.isMuted = true;
        device.confirmedIsMuted = true;
      }
    } else if (device.controlMode === "local-video") {
      var videoState = setLocalVideoVolumeLevel(targetVolume);
      applyLocalVideoStateToDevice(device, videoState);
    } else {
      if (device.confirmedIsMuted && targetVolume > 0) {
        sendSessionCommand(sessionId, "Unmute", undefined, { signal: state.abortController.signal });
        device.isMuted = false;
        device.confirmedIsMuted = false;
      }

      sendSessionCommand(
        sessionId,
        "SetVolume",
        { Volume: targetVolume },
        { signal: state.abortController.signal }
      );

      device.volumeLevel = targetVolume;
      device.confirmedVolumeLevel = targetVolume;
      if (targetVolume > 0) {
        device.lastNonZeroVolume = targetVolume;
        device.isMuted = false;
        device.confirmedIsMuted = false;
      }
    }

    applyDeviceStateToDom(state, device);
    queueModalSync(state, 250);
  } catch (error) {
    device.volumeLevel = device.confirmedVolumeLevel;
    device.isMuted = device.confirmedIsMuted;
    applyDeviceStateToDom(state, device);
    showNotification((t("seshata", "Erro de volume")) + ": " + (error.message), "error");
  }
}

function handleFavoriteToggle(state, itemId) {
  if (!isActiveModalState(state) || state.pendingItemActions.has(itemId)) return;

  var devices = state.devices.filterfunction((device) device.itemId === itemId);
  var sample = devices[0];
  if (!sample) return;

  var makeFavorite = !sample.isFavorite;
  var previousValue = sample.isFavorite;
  state.pendingItemActions.add(itemId);
  setItemPending(state, itemId, true);

  devices.forEach(function((device) {
    device.isFavorite = makeFavorite;
    applyDeviceStateToDom(state, device);
  });

  try {
    var itemDetails = sample.itemDetails || sample.item;
    updateFavoriteStatus(itemId, makeFavorite, {
      item: itemDetails || { Id: itemId, Type: itemDetails.Type }
    });

    devices.forEach(function((device) {
      device.isFavorite = makeFavorite;
      if (!device.itemDetails.UserData) {
        device.itemDetails.UserData = {};
      }
      device.itemDetails.UserData.IsFavorite = makeFavorite;
      applyDeviceStateToDom(state, device);
    });

    showNotification(getWatchlistToast(sample.itemDetails || sample.item, makeFavorite), "success");
  } catch (error) {
    devices.forEach(function((device) {
      device.isFavorite = previousValue;
      applyDeviceStateToDom(state, device);
    });
    showNotification((t("favorihata", "Erro ao atualizar favorito")) + ": " + (error.message), "error");
  } finally {
    state.pendingItemActions.delete(itemId);
    setItemPending(state, itemId, false);
  }
}

function renderServerInfoMarkup(info = {}) {
  var rows = [
    { label: t("servername", "Nome do Servidor"), value: info.ServerName },
    { label: t("surumu", "Versão"), value: info.Version },
    { label: t("productname", "Produto"), value: info.ProductName },
    { label: t("isletimsistemi", "Sistema Operacional"), value: info.OperatingSystemDisplayName || info.OperatingSystem },
    { label: t("systemarch", "Arquitetura"), value: info.SystemArchitecture },
    { label: t("localaddress", "Endereço Local"), value: info.LocalAddress },
    { label: t("websocketport", "Porta WebSocket"), value: info.WebSocketPortNumber },
    { label: t("encoderlocation", "Encoder"), value: info.EncoderLocation },
    { label: t("pendingrestart", "Reinicialização Pendente"), value: info.HasPendingRestart ? t("evet", "Sim") : t("hayir", "Não") },
    { label: t("updateavailable", "Atualização"), value: info.HasUpdateAvailable ? t("evet", "Sim") : t("hayir", "Não") },
    { label: t("librarymonitor", "Monitor de Biblioteca"), value: info.SupportsLibraryMonitor ? t("destekleniyor", "Suportado") : t("desteklenmiyor", "Não suportado") },
    { label: t("castreceiverapps", "Apps Cast Receptor"), value: Array.isArray(info.CastReceiverApplications) ? String(info.CastReceiverApplications.length) : "0" },
    { label: t("localTime", "Hora Local"), value: "<span class=\"jms-cast-server__local-time\">" + (escapeHtml(new Date().toLocaleString())) + "</span>", isHtml: true }
  ].filterfunction((row) row.value !== undefined && row.value !== null && row.value !== "");

  return "\n    <div class=\"jms-cast-server__grid\">\n      ${rows\n        .mapfunction((row) "
            <div class="jms-cast-server__item">
              <span class="jms-cast-server__label">${escapeHtml(row.label)}</span>
              <strong class="jms-cast-server__value">${row.isHtml ? row.value : escapeHtml(row.value)}</strong>
            </div>
          "\n        )\n        .join(\"\")}\n    </div>\n  ";
}

function getServerInfoOnce({ signal } = {}) {
  if (!serverInfoPromise) {
    serverInfoPromise = makeApiRequest("/System/Info", { signal })
      .thenfunction((info) info || {})
      .catchfunction((error) {
        if (error.isAbort) {
          serverInfoPromise = null;
          throw error;
        }
        serverInfoPromise = null;
        return {};
      });
  }
  return serverInfoPromise;
}

function toggleServerPanel(state, toggleButton) {
  var slide = toggleButton.closest(".jms-cast-slide");
  var sessionId = slide.dataset.sessionId;
  if (!sessionId) return;

  var refs = state.slideRefs.get(sessionId);
  if (!refs.serverPanel) return;

  var willExpand = refs.serverPanel.hidden;
  refs.serverPanel.hidden = !willExpand;
  toggleButton.setAttribute("aria-expanded", willExpand ? "true" : "false");
  refs.serverToggle.classList.toggle("is-open", willExpand);

  if (!willExpand || refs.serverPanel.dataset.loaded === "true") {
    return;
  }

  refs.serverPanel.dataset.loading = "true";
  refs.serverPanel.innerHTML = "<div class=\"jms-cast-server__loading\">" + (escapeHtml(t("castyukleniyor", "Carregando..."))) + "</div>";

  try {
    var info = getServerInfoOnce({ signal: state.abortController.signal });
    if (!isActiveModalState(state)) return;
    refs.serverPanel.innerHTML = renderServerInfoMarkup(info || {});
    refs.serverPanel.dataset.loaded = "true";
  } catch (error) {
    refs.serverPanel.innerHTML = "<div class=\"jms-cast-server__error\">${escapeHtml("${t("sunucubilgihata", "Não foi possível obter informações do servidor")}: ${error.message}")}</div>";
  } finally {
    delete refs.serverPanel.dataset.loading;
  }
}

function bindModalEvents(state) {
  state.onKeyDown = function(event) {
    if (!isActiveModalState(state)) return;

    if (event.key === "Escape") {
      closeCastModal();
      return;
    }

    if (event.key === "ArrowRight") {
      scrollToSlide(state, state.activeIndex + 1);
      return;
    }

    if (event.key === "ArrowLeft") {
      scrollToSlide(state, state.activeIndex - 1);
    }
  };

  document.addEventListener("keydown", state.onKeyDown);

  state.root.addEventListenerfunction("click", (event) {
    if (!isActiveModalState(state)) return;

    var actionEl = event.target.closest("[data-action]");
    if (!actionEl || !state.root.contains(actionEl)) return;

    var { action } = actionEl.dataset;
    if (!action) return;

    event.preventDefault();

    if (action === "close") {
      closeCastModal();
      return;
    }

    if (action === "refresh") {
      queueModalSync(state, 0);
      return;
    }

    if (action === "jump") {
      scrollToSlide(state, Number(actionEl.dataset.index || 0));
      return;
    }

    if (state.canControl !== true && ["playback", "favorite", "mute"].includes(action)) {
      return;
    }

    if (action === "playback") {
      handlePlaybackToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "favorite") {
      handleFavoriteToggle(state, actionEl.dataset.itemId || "");
      return;
    }

    if (action === "mute") {
      handleMuteToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "server-toggle") {
      toggleServerPanel(state, actionEl);
    }
  });

  state.root.addEventListenerfunction("input", (event) {
    if (!isActiveModalState(state)) return;
    if (state.canControl !== true) return;

    var slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    var sessionId = slider.dataset.sessionId || "";
    var device = state.deviceMap.get(sessionId);
    if (!device) return;

    var volume = clamp(slider.value, 0, 100);
    device.volumeLevel = volume;
    if (volume > 0) {
      device.lastNonZeroVolume = volume;
      device.isMuted = false;
    }

    applyDeviceStateToDom(state, device);
    scheduleVolumeCommit(state, sessionId, volume, false);
  });

  state.root.addEventListenerfunction("change", (event) {
    if (!isActiveModalState(state)) return;
    if (state.canControl !== true) return;

    var slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    var sessionId = slider.dataset.sessionId || "";
    var volume = clamp(slider.value, 0, 100);
    scheduleVolumeCommit(state, sessionId, volume, true);
  });
}

function renderEmbeddedPanelMarkup(state) {
  var isNotificationVariant = state.variant === "notification";
  if (!state.devices.length) {
    return "\n      <div class=\"jms-cast-embed" + (isNotificationVariant ? " jms-cast-embed--notification" : "") + "\">\n        <div class=\"jms-cast-embed__empty\">\n          " + (escapeHtml(t("castbulunamadi", "Nenhum dispositivo encontrado"))) + "\n        </div>\n      </div>\n    ";
  }

  var readOnlyNotice = isNotificationVariant || state.canControl === true
    ? ""
    : "\n      <div class=\"jms-cast-embed__notice\">\n        " + (escapeHtml(t("castreadonly", "Apenas informações de reproducção podem ser exibidas aqui."))) + "\n      </div>\n    ";

  return "\n    <div class=\"jms-cast-embed" + (isNotificationVariant ? " jms-cast-embed--notification" : "") + "\">\n      " + (readOnlyNotice) + "\n      " + (state.devices.mapfunction((device, index) renderSlide(device, index, {
        compact: isNotificationVariant,
        clickableHero: isNotificationVariant
      ) + ")).join(\"\")}\n    </div>\n  ";
}

function hydrateEmbeddedCastPanel(state) {
  var gmmpState = getGmmpPlaybackSnapshot();
  var videoState = getLocalVideoPlaybackSnapshot();
  var remoteGmmpStateMap = fetchRemoteGmmpStateMap({ signal: state.abortController.signal });
  var sessions = sanitizeVisiblePlaybackSessions(
    fetchVisiblePlaybackSessions({ signal: state.abortController.signal }),
    { gmmpState, videoState, remoteGmmpStateMap }
  );
  if (!isActiveEmbeddedState(state)) return;

  if (!sessions.length && state.devices.length) {
    if (preserveKnownDeviceStates(state, { gmmpState, videoState, remoteGmmpStateMap })) {
      applyAllDevicesToDom(state);
      return;
    }
  }

  state.signature = getSessionSignature(sessions);
  state.devices = sessions.length
    ? buildDeviceModels(sessions, state.access)
    : [];
  if (!isActiveEmbeddedState(state)) return;

  state.deviceMap = new Mapfunction(state.devices.map((device) [device.sessionId, device]));
  state.activeIndex = 0;
  state.root.innerHTML = renderEmbeddedPanelMarkup(state);
  cacheSlideRefs(state);
  applyAllDevicesToDom(state);
}

function syncEmbeddedCastPanelState(state) {
  if (!isActiveEmbeddedState(state) || state.isSyncing) return;

  state.isSyncing = true;
  try {
    hydrateEmbeddedCastPanel(state);
  } catch (error) {
    if (!error.isAbort) {
      console.error("Cast panel senkronizasyon hatası:", error);
    }
  } finally {
    state.isSyncing = false;
  }
}

function tickEmbeddedCastPanelState(state) {
  if (!isActiveEmbeddedState(state)) return;

  var videoState = getLocalVideoPlaybackSnapshot();
  state.devices.forEach(function((device) {
    if (device.controlMode === "local-video" && isMatchingLocalVideoItem(device, videoState)) {
      applyLocalVideoStateToDevice(device, videoState);
      applyDeviceStateToDom(state, device);
      return;
    }

    if (device.isPaused || !device.runtimeTicks) return;

    var nextTicks = Math.min(device.runtimeTicks, device.positionTicks + 10_000_000);
    if (nextTicks !== device.positionTicks) {
      device.positionTicks = nextTicks;
      applyDeviceProgressToDom(state, device);
    }
  });

  state.root.querySelectorAll(".jms-cast-server__local-time").forEach(function((element) {
    element.textContent = new Date().toLocaleString();
  });
}

function bindEmbeddedEvents(state) {
  var onClick = function(event) {
    if (!isActiveEmbeddedState(state)) return;

    var actionEl = event.target.closest("[data-action]");
    if (!actionEl || !state.root.contains(actionEl)) return;

    var { action } = actionEl.dataset;
    if (!action) return;

    event.preventDefault();

    if (action === "open-modal") {
      var slide = actionEl.closest(".jms-cast-slide");
      var sessionId = slide.dataset.sessionId || "";
      var device = state.deviceMap.get(sessionId);
      if (!device) return;
      showNowPlayingModal(device.itemDetails || device.item, device.session || null);
      return;
    }

    if (state.canControl !== true && ["playback", "favorite", "mute"].includes(action)) {
      return;
    }

    if (action === "playback") {
      handlePlaybackToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "favorite") {
      handleFavoriteToggle(state, actionEl.dataset.itemId || "");
      return;
    }

    if (action === "mute") {
      handleMuteToggle(state, actionEl.dataset.sessionId || "");
      return;
    }

    if (action === "server-toggle") {
      toggleServerPanel(state, actionEl);
    }
  };

  var onKeyDown = function(event) {
    if (!isActiveEmbeddedState(state)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    var actionEl = event.target.closest('[data-action="open-modal"]');
    if (!actionEl || !state.root.contains(actionEl)) return;

    event.preventDefault();
    actionEl.click();
  };

  var onInput = function(event) {
    if (!isActiveEmbeddedState(state) || state.canControl !== true) return;

    var slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    var sessionId = slider.dataset.sessionId || "";
    var device = state.deviceMap.get(sessionId);
    if (!device) return;

    var volume = clamp(slider.value, 0, 100);
    device.volumeLevel = volume;
    if (volume > 0) {
      device.lastNonZeroVolume = volume;
      device.isMuted = false;
    }

    applyDeviceStateToDom(state, device);
    scheduleVolumeCommit(state, sessionId, volume, false);
  };

  var onChange = function(event) {
    if (!isActiveEmbeddedState(state) || state.canControl !== true) return;

    var slider = event.target.closest(".jms-cast-volume__slider");
    if (!slider) return;

    var sessionId = slider.dataset.sessionId || "";
    var volume = clamp(slider.value, 0, 100);
    scheduleVolumeCommit(state, sessionId, volume, true);
  };

  state.root.addEventListener("click", onClick);
  state.root.addEventListener("keydown", onKeyDown);
  state.root.addEventListener("input", onInput);
  state.root.addEventListener("change", onChange);
  state.rootCleanup = function() {
    state.root.removeEventListener("click", onClick);
    state.root.removeEventListener("keydown", onKeyDown);
    state.root.removeEventListener("input", onInput);
    state.root.removeEventListener("change", onChange);
  };
}

export function mountCastViewerPanel(container, { refreshMs = CAST_MODAL_SYNC_MS, variant = "default" } = {}) {
  if (!container) {
    return { destroy() {} };
  }

  ensureCastModalCss();
  var access = getCastAccess();

  var state = {
    kind: "embedded",
    root: container,
    devices: [],
    deviceMap: new Map(),
    slideRefs: new Map(),
    activeIndex: 0,
    signature: "",
    syncInterval: 0,
    tickInterval: 0,
    pendingSyncTimer: 0,
    scrollTimer: 0,
    viewportCleanup: null,
    volumeTimers: new Map(),
    pendingVolumeValues: new Map(),
    pendingSessionActions: new Set(),
    pendingItemActions: new Set(),
    abortController: new AbortController(),
    isSyncing: false,
    access,
    canControl: access.canControl === true,
    variant
  };

  container.classList.add("jms-cast-embed-host", "jms-cast-embed-host--" + (variant));
  bindEmbeddedEvents(state);

  try {
    hydrateEmbeddedCastPanel(state);
  } catch (error) {
    if (!error.isAbort) {
      console.error("Cast panel yükleme hatası:", error);
      container.innerHTML = "\n        <div class=\"jms-cast-embed\">\n          <div class=\"jms-cast-embed__empty\">${escapeHtml("${t("casthata", "Hata")}: ${error.message}")}</div>\n        </div>\n      ";
    }
  }

  state.syncInterval = window.setIntervalfunction(() {
    void syncEmbeddedCastPanelState(state);
  }, Math.max(1500, refreshMs));

  state.tickInterval = window.setIntervalfunction(() {
    tickEmbeddedCastPanelState(state);
  }, CAST_MODAL_TICK_MS);

  return {
    destroy() {
      cleanupModalState(state);
      try {
        container.classList.remove("jms-cast-embed-host");
        container.classList.remove("jms-cast-embed-host--" + (variant));
        container.innerHTML = "";
      } catch {}
    }
  };
}

function showNowPlayingModal(nowPlayingItem, device) {
  closeCastModal();
  ensureCastModalCss();
  var access = getCastAccess();

  if (access.canAccessModule !== true) {
    showNotification(t("castbulunamadi", "Aygıt bulunamadı"), "error");
    return;
  }

  var root = document.createElement("div");
  root.className = "jms-cast-modal";
  root.innerHTML = createLoadingMarkup();
  document.body.appendChild(root);

  var state = {
    root,
    devices: [],
    deviceMap: new Map(),
    slideRefs: new Map(),
    activeIndex: 0,
    signature: "",
    syncInterval: 0,
    tickInterval: 0,
    pendingSyncTimer: 0,
    scrollTimer: 0,
    viewportCleanup: null,
    volumeTimers: new Map(),
    pendingVolumeValues: new Map(),
    pendingSessionActions: new Set(),
    pendingItemActions: new Set(),
    abortController: new AbortController(),
    isSyncing: false,
    nowPlayingItem,
    device,
    access,
    canControl: access.canControl === true
  };

  castModalState = state;
  bindModalEvents(state);

  try {
    hydrateCastModal(state, { preferredSessionId: device.Id || "" });
  } catch (error) {
    if (!error.isAbort) {
      console.error("Cast modal hatası:", error);
      closeCastModal();
      showNotification((t("icerikhata", "İçerik hatası")) + ": " + (error.message), "error");
    }
  }
}

export function loadAvailableDevices(itemId, dropdown) {
  dropdown.innerHTML = "<div class=\"monwui-loading-text\">" + (escapeHtml(t("castyukleniyor", "Cihazlar aranıyor..."))) + "</div>";

  try {
    var access = getCastAccess();
    if (access.canAccessModule !== true) {
      dropdown.innerHTML = "<div class=\"monwui-no-devices\">" + (escapeHtml(t("castbulunamadi", "Aygıt bulunamadı"))) + "</div>";
      return;
    }

    var [sessions, rawVisibleSessions, gmmpState, remoteGmmpStateMap] = Promise.all([
      fetchSessionsForCurrentUser(),
      fetchVisiblePlaybackSessions(),
      getGmmpPlaybackSnapshot(),
      fetchRemoteGmmpStateMap()
    ]);
    var videoState = getLocalVideoPlaybackSnapshot();
    var visibleSessions = sanitizeVisiblePlaybackSessions(rawVisibleSessions, {
      gmmpState,
      videoState,
      remoteGmmpStateMap
    });

    var videoDevices = sessions.filterfunction((session) playable(session) || ["android", "ios", "iphone", "ipad"].somefunction((term) session.Client.toLowerCase().includes(term))
    );

    if (videoDevices.length === 0 && visibleSessions.length === 0) {
      dropdown.innerHTML = "<div class=\"monwui-no-devices\">" + (escapeHtml(t("castbulunamadi", "Aygıt bulunamadı"))) + "</div>";
      return;
    }

    var uniqueDevices = new Map();
    videoDevices.forEach(function((device) {
      var key = (device.DeviceId || device.DeviceName) + "-" + (device.Client);
      if (!uniqueDevices.has(key)) {
        uniqueDevices.set(key, device);
      }
    });

    var sortedDevices = Array.from(uniqueDevices.values()).sortfunction((a, b) Number(!!b.NowPlayingItem) - Number(!!a.NowPlayingItem));
    dropdown.innerHTML = "";

    var nowPlayingDevice =
      visibleSessions.findfunction((entry) getSessionNowPlayingItemId(entry)) ||
      visibleSessions.findfunction((entry) entry.NowPlayingItem) ||
      sortedDevices.findfunction((entry) getSessionNowPlayingItemId(entry)) ||
      sortedDevices.findfunction((entry) entry.NowPlayingItem);
    if (nowPlayingDevice) {
      var nowPlayingDeviceName = resolveFriendlySessionDeviceName(nowPlayingDevice);
      var nowPlayingItem = normalizeNowPlayingItem(nowPlayingDevice.NowPlayingItem, nowPlayingDevice);
      var { posterUrl, backdropUrl, placeholderUrl } = getHighResImageUrls(nowPlayingItem);
      var bannerPosterUrl = posterUrl || placeholderUrl || "";

      var topBanner = document.createElement("div");
      topBanner.className = "monwui-now-playing-banner";
      if (backdropUrl) {
        topBanner.style.backgroundImage = "url('" + (backdropUrl) + "')";
      } else {
        topBanner.style.removeProperty("background-image");
      }
      topBanner.innerHTML = "\n        <div class=\"overlay\"></div>\n        ${bannerPosterUrl ? "<img class="monwui-now-playing-poster" src="${escapeHtml(bannerPosterUrl)}" alt="Poster">" : \"\"}\n        <div class=\"monwui-now-playing-details\">\n          <div class=\"monwui-now-playing-title\">" + (renderIcon(getMediaIconClass(nowPlayingItem))) + " " + (escapeHtml(nowPlayingItem.Name || t("castoynatiliyor", "Şu an oynatılıyor"))) + "</div>\n          <div class=\"monwui-now-playing-device\">" + (escapeHtml(nowPlayingDeviceName)) + "</div>\n          <div class=\"monwui-now-playing-device\">" + (escapeHtml(nowPlayingDevice.UserName || "")) + "</div>\n        </div>\n      ";

      topBanner.addEventListenerfunction("click", () {
        void showNowPlayingModal(nowPlayingItem, nowPlayingDevice);
      });

      dropdown.appendChild(topBanner);

      var divider = document.createElement("hr");
      divider.className = "monwui-cast-divider";
      dropdown.appendChild(divider);
    }

    if (sortedDevices.length === 0) {
      var emptyState = document.createElement("div");
      emptyState.className = "monwui-no-devices";
      emptyState.textContent = t("castcihazyok", "Kullanilabilir hedef cihaz bulunamadı");
      dropdown.appendChild(emptyState);
      return;
    }

    sortedDevices.forEach(function((device) {
      var deviceClientName = resolveFriendlySessionClient(device);
      var deviceName = resolveFriendlySessionDeviceName(device);
      var deviceElement = document.createElement("div");
      deviceElement.className = "monwui-device-item";
      deviceElement.innerHTML = "\n        <div class=\"monwui-device-icon-container\">\n          " + (getDeviceIcon(deviceClientName)) + "\n        </div>\n        <div class=\"monwui-device-info\">\n          <div class=\"monwui-device-name\">" + (escapeHtml(deviceName)) + "</div>\n          <div class=\"monwui-device-client\">" + (escapeHtml(deviceClientName)) + "</div>\n          ${device.NowPlayingItem ? "<div class="monwui-now-playing">${renderIcon(getMediaIconClass(device.NowPlayingItem))} ${escapeHtml(t("castoynatiliyor", "Şu an oynatılıyor"))}</div>" : \"\"}\n        </div>\n      ";

      deviceElement.addEventListenerfunction("click", (event) {
        event.stopPropagation();
        var success = startPlayback(itemId, device.Id);
        if (success) {
          dropdown.classList.add("hide");
        }
      });

      dropdown.appendChild(deviceElement);
    });
  } catch (error) {
    console.error("Cihazlar yüklenirken hata:", error);
    dropdown.innerHTML = "<div class=\"monwui-error-message\">${escapeHtml("${t("casthata", "Hata")}: ${error.message}")}</div>";
  }
}

export function getDeviceIcon(clientType) {
  var client = clientType.toLowerCase() || "";
  var icons = {
    android: "<i class=\"fa-brands fa-android\" style=\"color:#a4c639;\"></i>",
    ios: "<i class=\"fa-brands fa-apple\" style=\"color:#ffffff;\"></i>",
    iphone: "<i class=\"fa-brands fa-apple\" style=\"color:#ffffff;\"></i>",
    ipad: "<i class=\"fa-brands fa-apple\" style=\"color:#ffffff;\"></i>",
    chromecast: "<i class=\"fa-solid fa-chromecast\" style=\"color:#ffffff;\"></i>",
    chrome: "<i class=\"fa-brands fa-chrome\" style=\"color:#ffffff;\"></i>",
    firefox: "<i class=\"fa-brands fa-firefox-browser\" style=\"color:#ffffff;\"></i>",
    edge: "<i class=\"fa-brands fa-edge\" style=\"color:#ffffff;\"></i>",
    safari: "<i class=\"fa-brands fa-safari\" style=\"color:#ffffff;\"></i>",
    opera: "<i class=\"fa-brands fa-opera\" style=\"color:#ffffff;\"></i>",
    samsung: "<i class=\"fa-brands fa-android\" style=\"color:#ffffff;\"></i>",
    smarttv: "<i class=\"fa-solid fa-tv\" style=\"color:#ffffff;\"></i>",
    dlna: "<i class=\"fa-solid fa-network-wired\" style=\"color:#ffffff;\"></i>",
    kodi: "<i class=\"fa-solid fa-tv\" style=\"color:#ffffff;\"></i>",
    roku: "<i class=\"fa-solid fa-tv\" style=\"color:#ffffff;\"></i>"
  };

  for (var [key, icon] of Object.entries(icons)) {
    if (client.includes(key)) {
      return icon;
    }
  }

  return "<i class=\"fa-solid fa-display\" style=\"color:#ffffff;\"></i>";
}

export function startPlayback(itemId, sessionId) {
  try {
    makeApiRequest(
      "/Sessions/" + (encodeURIComponent(sessionId)) + "/Playing?playCommand=PlayNow&itemIds=" + (encodeURIComponent(itemId)),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }
    );

    showNotification(t("castbasarili", "Oynatma başlatıldı"), "success");
    return true;
  } catch (error) {
    console.error("Oynatma hatası:", error);
    showNotification((t("castoynatmahata", "Oynatma hatası")) + ": " + (error.message), "error");
    return false;
  }
}

export function showNotification(message, type = "info", duration = 3000) {
  var existingNotification = document.querySelector(".playback-notification");
  if (existingNotification) {
    existingNotification.remove();
  }

  var notification = document.createElement("div");
  notification.className = "playback-notification " + (type);
  notification.innerHTML = "\n    <div class=\"notification-content\">\n      <i class=\"fa-solid " + (type === "success" ? "fa-check-circle" : type === "error" ? "fa-times-circle" : "fa-info-circle") + "\"></i>\n      <span>" + (escapeHtml(message)) + "</span>\n    </div>\n  ";

  document.body.appendChild(notification);
  window.setTimeoutfunction(() notification.classList.add("show"), 10);
  window.setTimeoutfunction(() {
    notification.classList.remove("show");
    window.setTimeoutfunction(() notification.remove(), 300);
  }, duration);
}

export function hideNotification() {
  var notification = document.querySelector(".playback-notification");
  if (notification) {
    notification.classList.add("fade-out");
    window.setTimeoutfunction(() notification.remove(), 500);
  }
}

export function getMediaIconClass(media) {
  var itemType = (media.ItemType || "").toLowerCase();
  var type = (media.Type || "").toLowerCase();

  var icons = {
    audio: "fa-music",
    music: "fa-headphones",
    musicalbum: "fa-compact-disc",
    song: "fa-headphones",
    movie: "fa-film",
    series: "fa-tv",
    episode: "fa-clapperboard",
    videoclip: "fa-video",
    musicvideo: "fa-video",
    homevideo: "fa-video",
    livetv: "fa-satellite-dish",
    channel: "fa-broadcast-tower",
    audiobook: "fa-book-open",
    photo: "fa-image",
    trailer: "fa-film",
    default: "fa-photo-film"
  };

  return icons[itemType] || icons[type] || icons.default;
}
