import { getSessionInfo, fetchItemDetails, makeApiRequest, isAuthReadyStrict } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig, getPauseFeaturesRuntimeConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { withServer } from "./jfUrl.js";
import { GENERATED_BUCKET_APPENDS, GENERATED_NEW_BUCKETS } from "./generatedTagBuckets.js";

function _numFinite(v, fallback) {
  var n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _msFromConfig(pathValue, fallbackMs) {
  var n = _numFinite(pathValue, fallbackMs);
  return Math.max(0, n);
}

function getCommunityRatingValue(communityRating) {
  var raw = Array.isArray(communityRating)
    ? communityRating.reducefunction((sum, value) sum + Number(value || 0), 0) /
      Math.max(1, communityRating.length)
    : Number(communityRating);

  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 10) / 10;
}

var DEBUG_PO = !!(getConfig().pauseOverlay.debug);
function dlog(...args) { if (DEBUG_PO) console.log(...args); }
function ddbg(...args) { if (DEBUG_PO) console.debug(...args); }

var config = getConfig();
var currentLang = config.defaultLanguage || getDefaultLanguage();
var labels = getLanguageLabels(currentLang) || {};
var imageBlobCache = new Map();
var TAG_MEM_TTL_MS = Math.max(
  0,
  Number(getConfig().pauseOverlay.tagsCacheTtlMs || 6 * 60 * 60 * 1000)
);

var SHOW_AGE_BADGE  = getConfig().pauseOverlay.showAgeBadge !== false;
var BADGE_DELAY_MS = Math.max(0, Number(getConfig().pauseOverlay.badgeDelayMs || 4500));
var BADGE_DELAY_RESUME_MS = Math.max(
  0,
  Number(getConfig().pauseOverlay.badgeDelayResumeMs || BADGE_DELAY_MS)
);

var AGE_BADGE_DEFAULT_MS = _msFromConfig(
  getConfig().pauseOverlay.ageBadgeDurationMs,
  15000
);

var AGE_BADGE_RESUME_MS = _msFromConfig(
  getConfig().pauseOverlay.ageBadgeDurationResumeMs,
  AGE_BADGE_DEFAULT_MS
);

var BADGE_LOCK_MS = Math.max(0, Number(getConfig().pauseOverlay.ageBadgeLockMs || 4000));
var _detailsLRU = new Map();
var DETAILS_TTL = 90_000;
var DETAILS_MAX = 120;

var _maturityLRU = new Map();
var MAT_TTL = _msFromConfig(getConfig().pauseOverlay.maturityCacheTtlMs, 10 * 60 * 1000);
var MAT_MAX = 200;

function _maturitySig(d){
  var id = d.Id || "";
  var r  = String(d.OfficialRating || "");
  var g  = Array.isArray(d.Genres) ? d.Genres.join("|") : "";
  var t  = Array.isArray(d.Tags) ? d.Tags.join("|")
           : Array.isArray(d.Keywords) ? d.Keywords.join("|") : "";
  return (id) + "::" + (r) + "::" + (g) + "::" + (t);
}

function _computeMaturityUi(data){
  var age = normalizeAgeChip(data.OfficialRating);

  var locGenres = localizedGenres(data.Genres || []).filter(Boolean);
  locGenres.sortfunction((a,b)String(a).localeCompare(String(b), undefined, { sensitivity:"base" }));

  var descFromTags = deriveTagDescriptors(data);
  var descFromHeur = (!descFromTags.length && !locGenres.length) ? deriveKeywordDescriptors(data) : [];

  var line2Arr = descFromTags.length
    ? descFromTags.slice(0,2)
    : locGenres.length
      ? locGenres.slice(0,2)
      : descFromHeur.slice(0,2);

  var icons = buildIconListForItem(data);
  return { age, line2Arr, icons };
}

function getMaturityUiCached(data){
  var sig = _maturitySig(data);
  var now = Date.now();
  var rec = _maturityLRU.get(sig);
  if (rec && (now - rec.t) < MAT_TTL) return rec.v;
  var v = _computeMaturityUi(data);
  _maturityLRU.set(sig, { v, t: now });
  if (_maturityLRU.size > MAT_MAX) {
    var first = _maturityLRU.keys().next().value;
    _maturityLRU.delete(first);
  }
  return v;
}

function _badgeDelayFor(ctx){
  return (ctx === "resume") ? BADGE_DELAY_RESUME_MS : BADGE_DELAY_MS;
}

function _badgeDurationFor(ctx){
  return (ctx === "resume") ? AGE_BADGE_RESUME_MS : AGE_BADGE_DEFAULT_MS;
}

function fetchItemDetailsCached(id, { signal } = {}) {
  if (!id) return null;
  var rec = _detailsLRU.get(id);
  var now = Date.now();
  if (rec && now - rec.t < DETAILS_TTL) return rec.v;
  var v = fetchItemDetails(id, signal ? { signal } : undefined);
  _detailsLRU.set(id, { v, t: now });
  if (_detailsLRU.size > DETAILS_MAX) {
    var first = _detailsLRU.keys().next().value;
    _detailsLRU.delete(first);
  }
  return v;
}

var _tagsMemCache = { stamp: null, savedAt: 0, tags: null };
var ratingGenreTimeout = null;
var _badgeShownAt = 0;
var ratingGenreElement = null;
var currentMediaData = null;
var activeVideo = null;
var currentMediaId = null;
var removeHandlers = null;
var removeHandlersToken = null;
var overlayVisible = false;
var pauseTimeout = null;
var lastActivityAt = Date.now();
var blurAt = null;
var hiddenAt = null;
var lastPauseReason = null;
var lastPauseAt = 0;
var _cpiLastRawId = null;
var _cpiChangeAt = 0;
var _playStartAt = 0;
var _scanDepth = 8;
var _recoItemsCache = [];
var _recoBadgeEl = null;
var _recoPanelEl = null;
var _recoListEl = null;
var _recoToggleEl = null;
var _recoPanelOpen = false;
var _overlayIdleTimer = null;
var _mouseIdleTimer = null;
var _iconEl = null;
var _iconTimeout = null;
var _playEventAt = 0;
var _sessRawLast = null;
var _sessChangeAt = 0;
var SESSION_FETCH_TTL_MS = 500;
var SESSION_FETCH_EMPTY_TTL_MS = 150;
var _sessSnapshotCache = {
  at: 0,
  value: { itemId: null, isPaused: null, sessionId: null, deviceId: null },
  promise: null,
};

function _cacheSessionSnapshot(value) {
  _sessSnapshotCache.at = Date.now();
  _sessSnapshotCache.value = value;
  return value;
}

function normalizeSessionIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function addSessionIdentity(set, value) {
  var normalized = normalizeSessionIdentity(value);
  if (!normalized) return;
  set.add(normalized);
}

function buildPauseOverlaySessionIdentity() {
  var info = getSessionInfo.() || {};
  var userIds = new Set();
  var sessionIds = new Set();
  var deviceIds = new Set();
  var deviceNames = new Set();
  var itemIds = new Set();
  var clientHints = [];

  addSessionIdentity(userIds, info.userId);
  addSessionIdentity(userIds, getUserIdSafe.());

  addSessionIdentity(sessionIds, info.sessionId);
  try { addSessionIdentity(sessionIds, window.ApiClient._sessionId); } catch {}

  addSessionIdentity(deviceIds, info.deviceId);
  try {
    var api = window.ApiClient || null;
    var apiDeviceId =
      typeof api.deviceId === "function"
        ? api.deviceId()
        : (api.getDeviceId.() || api.deviceId || api._deviceId || null);
    addSessionIdentity(deviceIds, apiDeviceId);
  } catch {}

  addSessionIdentity(deviceNames, info.deviceName);
  try { addSessionIdentity(deviceNames, window.ApiClient._deviceName); } catch {}

  addSessionIdentity(itemIds, activeVideo ? parsePlayableIdFromVideo(activeVideo) : null);
  addSessionIdentity(itemIds, getItemIdFromDom());
  addSessionIdentity(itemIds, getRecentPlayNowTargetId());

  [
    info.clientName,
    "Jellyfin Web Client",
  ]
    .mapfunction((value) String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .forEach(function((value) clientHints.push(value));

  return {
    userIds,
    sessionIds,
    deviceIds,
    deviceNames,
    itemIds,
    clientHints,
  };
}

function scorePauseOverlaySessionCandidate(session, identity) {
  var score = 0;
  var sessionId = normalizeSessionIdentity(session.Id);
  var deviceId = normalizeSessionIdentity(session.DeviceId);
  var deviceName = normalizeSessionIdentity(session.DeviceName);
  var userId = normalizeSessionIdentity(session.UserId);
  var itemId = normalizeSessionIdentity(session.NowPlayingItem.Id);
  var clientName = String(session.Client || "").trim().toLowerCase();

  if (sessionId && identity.sessionIds.has(sessionId)) score += 1200;
  if (deviceId && identity.deviceIds.has(deviceId)) score += 1000;
  if (deviceName && identity.deviceNames.has(deviceName)) score += 600;
  if (userId && identity.userIds.has(userId)) score += 220;
  if (itemId && identity.itemIds.has(itemId)) score += 180;
  if function(clientName && identity.clientHints.some((hint) clientName.includes(hint))) score += 20;
  if (session.NowPlayingItem.Id) score += 8;

  var last = session.LastActivityDate ? new Date(session.LastActivityDate).getTime() : 0;
  if (last && Date.now() - last < 2 * 60 * 1000) score += 10;

  return score;
}

function selectPauseOverlaySession(sessions) {
  var identity = buildPauseOverlaySessionIdentity();
  var all = Array.isArray(sessions) ? sessions : [];
  var mine = all.filterfunction((session) {
    var userId = normalizeSessionIdentity(session.UserId);
    return !!userId && identity.userIds.has(userId);
  });

  if (!mine.length) return null;

  var ranked = mine
    .mapfunction((session) ({
      session,
      score: scorePauseOverlaySessionCandidate(session, identity),
    }))
    .sortfunction((a, b) b.score - a.score);

  var hardMatch = ranked.findfunction(({ session }) {
    var sessionId = normalizeSessionIdentity(session.Id);
    var deviceId = normalizeSessionIdentity(session.DeviceId);
    var deviceName = normalizeSessionIdentity(session.DeviceName);
    return (
      (sessionId && identity.sessionIds.has(sessionId)) ||
      (deviceId && identity.deviceIds.has(deviceId)) ||
      (deviceName && identity.deviceNames.has(deviceName))
    );
  });
  if (hardMatch) return hardMatch.session;

  var hintedItemMatch = ranked.findfunction(({ session }) {
    var itemId = normalizeSessionIdentity(session.NowPlayingItem.Id);
    return !!itemId && identity.itemIds.has(itemId);
  });
  if (hintedItemMatch) return hintedItemMatch.session;

  var nowPlayingMine = mine.filterfunction((session) session.NowPlayingItem.Id);
  if (nowPlayingMine.length === 1) return nowPlayingMine[0];
  if (mine.length === 1) return mine[0];

  return null;
}

function fetchNowPlayingFromSessions({ force = false } = {}){
  if (!force && _sessSnapshotCache.promise) {
    return _sessSnapshotCache.promise;
  }
  var cacheTtl = _sessSnapshotCache.value.itemId
    ? SESSION_FETCH_TTL_MS
    : SESSION_FETCH_EMPTY_TTL_MS;
  if (!force && (Date.now() - _sessSnapshotCache.at) < cacheTtl) {
    return _sessSnapshotCache.value;
  }

  var request = function(() {
    try {
      var uid = getUserIdSafe();
      if (!uid) return _cacheSessionSnapshot({ itemId:null,isPaused:null, sessionId:null, deviceId:null });

      var sessions = makeApiRequest(withServer("/Sessions?ActiveWithinSeconds=30"));
      var list = Array.isArray(sessions)?sessions:[];
      var active = selectPauseOverlaySession(list);
      if (!active) return _cacheSessionSnapshot({ itemId:null,isPaused:null, sessionId:null, deviceId:null });

      var r = {
        itemId: active.NowPlayingItem.Id || null,
        isPaused: active.PlayState.IsPaused || null,
        sessionId: active.Id || null,
        deviceId: active.DeviceId || null,
      };

      return _cacheSessionSnapshot(r);
    } catch {
      return _cacheSessionSnapshot({ itemId:null,isPaused:null, sessionId:null, deviceId:null });
    } finally {
      _sessSnapshotCache.promise = null;
    }
  })();

  _sessSnapshotCache.promise = request;
  return request;
}

function getItemIdFromDom() {
  var selectors = [
    '.videoOsdBottom-hidden > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    'div.page:nth-child(3) > div:nth-child(3) > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    '.btnUserRating',
    '[data-id][is="paper-icon-button-light"].btnUserRating',
    '.btnUserRating[data-id]',
  ];

  for (var sel of selectors) {
    var el = document.querySelector(sel);
    var id = el.getAttribute.('data-id');
    if (id) return id;
  }
  return null;
}

function getRecentPlayNowTargetId(maxAgeMs = 30_000) {
  try {
    var dbg = window.__jmsLastPlayNowTargetDebug || null;
    var id = String(dbg.itemId || "").trim();
    var stage = String(dbg.stage || "").trim().toLowerCase();
    var at = Number(dbg.at || 0);
    if (!id || stage === "error" || !Number.isFinite(at) || at <= 0) return null;
    if ((Date.now() - at) > maxAgeMs) return null;
    return id;
  } catch {
    return null;
  }
}

function getStableItemIdDomFirst() {
  var domId = getItemIdFromDom();
  if (domId) return domId;

  if (activeVideo) {
    var srcId = parsePlayableIdFromVideo(activeVideo);
    if (srcId) return srcId;
  }

  return null;
}

function getStableItemIdViaSessions(minStableMs=350){
  var r = fetchNowPlayingFromSessions();
  var now = Date.now();
  var raw = r.itemId;

  if (raw !== _sessRawLast){
    _sessRawLast = raw;
    _sessChangeAt = now;
    return null;
  }
  if (!raw) return null;
  if (now - _sessChangeAt < minStableMs) return null;
  return raw;
}

function getMinVideoDurationSec() {
   var po = config.pauseOverlay || {};
   if (po.minVideoDurationSec != null) return Math.max(0, Number(po.minVideoDurationSec));
   if (po.minVideoMinutes != null)    return Math.max(0, Number(po.minVideoMinutes)) * 60;
   var raw = localStorage.getItem('pauseOverlayMinVideoMinutes');
   var mins = Number(raw);
   return (Number.isFinite(mins) && mins > 0) ? mins * 60 : 300;
 }

function relaxScanDepth() { _scanDepth = 4; }

function parsePlayableIdFromVideo(videoEl) {
  try {
    var rawSrc = String(videoEl.currentSrc || videoEl.src || "").trim();
    if (!rawSrc) return null;

    var u = new URL(rawSrc, location.href);
    var itemId = u.searchParams.get("ItemId") || u.searchParams.get("itemId");
    if (itemId) return itemId;

    var pathId = u.pathname.match(/\/(?:Videos|Audio)\/([^/?#]+)/i).[1];
    if (pathId) return decodeURIComponent(pathId);

    return null;
  } catch {
    return null;
  }
}

function parseMediaSourceIdFromVideo(videoEl) {
  try {
    var rawSrc = String(videoEl.currentSrc || videoEl.src || "").trim();
    if (!rawSrc) return null;

    var u = new URL(rawSrc, location.href);
    return (
      u.searchParams.get("MediaSourceId") ||
      u.searchParams.get("mediaSourceId") ||
      null
    );
  } catch {
    return null;
  }
}

function hardResetBadgeOverlay() {
  hideRatingGenre('finished');
  currentMediaData = null;
  currentMediaId = null;
}

if (!window.__jmsPauseOverlay) {
  window.__jmsPauseOverlay = { destroy: null, active: false };
}

function _mkLifecycle() {
  var lc = {
    abort: new AbortController(),
    timers: new Set(),
    rafId: null,
    observers: new Set(),
    cleans: new Set(),
    cleanTokens: new Map(),
    lastToken: 0,
  };
  var { signal } = lc.abort;
  lc.addTimeout = function(fn, ms) {
    var id = setTimeout(fn, ms);
    lc.timers.add({ id, t: "t" });
    return id;
  };
  lc.addInterval = function(fn, ms) {
    var id = setInterval(fn, ms);
    lc.timers.add({ id, t: "i" });
    return id;
  };
  lc.addRaf = function(fn) {
    if (lc.rafId != null) cancelAnimationFrame(lc.rafId);
    lc.rafId = requestAnimationFrame(fn);
    return lc.rafId;
  };
  lc.trackMo = function(mo) {
    lc.observers.add(mo);
    return mo;
  };
  lc.trackClean = function(fn) {
    if (typeof fn !== "function") return null;
    var token = ++lc.lastToken;
    lc.cleans.add(fn);
    lc.cleanTokens.set(token, fn);
    return token;
  };
  lc.untrackClean = function(token) {
    var fn = lc.cleanTokens.get(token);
    if (!fn) return;
    lc.cleans.delete(fn);
    lc.cleanTokens.delete(token);
  };
  lc.cleanupAll = function() {
    try {
      lc.abort.abort();
    } catch {}
    for (var x of lc.timers) (x.t === "i" ? clearInterval : clearTimeout)(x.id);
    lc.timers.clear();
    if (lc.rafId != null) {
      cancelAnimationFrame(lc.rafId);
      lc.rafId = null;
    }
    for (var mo of lc.observers) {
      try {
        mo.disconnect();
      } catch {}
    }
    lc.observers.clear();
    for (var fn of lc.cleans) {
      try {
        fn();
      } catch {}
    }
    lc.cleans.clear();
    lc.cleanTokens.clear();
  };
  lc.signal = signal;
  return lc;
}

function wipeBadgeStateAndDom() {
  try {
    if (ratingGenreTimeout) clearTimeout(ratingGenreTimeout);
  } catch {}
  ratingGenreTimeout = null;
  currentMediaData = null;
  if (ratingGenreElement && ratingGenreElement.parentNode) {
    ratingGenreElement.parentNode.removeChild(ratingGenreElement);
  }
  ratingGenreElement = null;
  try { wipeIconBadges(); } catch {}
}

function hideRatingGenre(reason) {
  if (DEBUG_PO) console.log("[badge] hideRatingGenre", reason, new Error().stack.split("\n")[2]);
  if (!ratingGenreElement) return;
  ratingGenreElement.classList.remove("visible");
  if (reason === "auto" || reason === "finished") {
    try { if (ratingGenreTimeout) clearTimeout(ratingGenreTimeout); } catch {}
    ratingGenreTimeout = setTimeoutfunction(() {
      wipeBadgeStateAndDom();
    }, 360);
  }
  try { hideIconBadges(reason); } catch {}
}

function srcLooksLikeThemeVideo(videoEl) {
  try {
    var s = String(videoEl.currentSrc || videoEl.src || "");
    if (!s) return false;
    return /(?:^|[\/_\-\?&=])theme(?:[\/_\-\.=&]|$)/i.test(s);
  } catch {
    return false;
  }
}
function isThemeItemName(item) {
  if (!item) return false;
  var name = String(item.Name || item.OriginalTitle || "").toLowerCase();
  return name.includes("theme");
}
function shouldIgnoreTheme({ video = null, item = null } = {}) {
  if (video && srcLooksLikeThemeVideo(video)) return true;
  if (item && isThemeItemName(item)) return true;
  return false;
}

function getApiClientSafe() {
  return (window.ApiClient && typeof window.ApiClient.serverAddress === 'function')
    ? window.ApiClient
    : null;
}

function getApiBase() {
  var api = getApiClientSafe();
  return withServer('');
}

function getUserIdSafe() {
  var api = getApiClientSafe();
  return (api && typeof api.getCurrentUserId === 'function' && api.getCurrentUserId())
    || getConfig().userId
    || null;
}

function getStableItemIdFromSessionsStable(minStableMs = 350){
  return getStableItemIdViaSessions(minStableMs);
}

function resolvePlaybackItemId({ minStableMs = 350 } = {}) {
  var domId = getItemIdFromDom();
  var videoId = activeVideo ? parsePlayableIdFromVideo(activeVideo) : null;
  if (videoId) return videoId;

  var playNowId = getRecentPlayNowTargetId();
  var stableSessionId = null;
  var rawSessionId = null;

  try {
    stableSessionId = getStableItemIdFromSessionsStable(minStableMs);
  } catch {}

  try {
    var snap = fetchNowPlayingFromSessions();
    rawSessionId = snap.itemId || null;
  } catch {}

  var effectiveSessionId = stableSessionId || rawSessionId || null;

  if (playNowId && playNowId !== domId) {
    if (effectiveSessionId && effectiveSessionId !== domId && effectiveSessionId !== playNowId) {
      return effectiveSessionId;
    }
    return playNowId;
  }

  if (stableSessionId && stableSessionId !== domId) return stableSessionId;
  if (rawSessionId && rawSessionId !== domId) return rawSessionId;
  if (playNowId) return playNowId;
  if (stableSessionId) return stableSessionId;
  if (rawSessionId) return rawSessionId;

  var domFirstId = getStableItemIdDomFirst();
  if (domFirstId) return domFirstId;

  if (activeVideo) return parseMediaSourceIdFromVideo(activeVideo);
  return null;
}

function fetchFiltersFor(type) {
  var qs = new URLSearchParams({
    IncludeItemTypes: type,
    Recursive: "true",
  });
  try {
    if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) return {};
    var res = makeApiRequest(withServer("/Items/Filters?" + (qs.toString())));
    return res || {};
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 0 || e.isAbort) return {};
    throw e;
  }
}
function _computeStamp() {
  return [withServer(''), getUserIdSafe() || ''].join('|');
}

function loadCatalogTagsWithCache() {
  var stamp = _computeStamp();
  var now = Date.now();
  if (
    _tagsMemCache.tags &&
    _tagsMemCache.stamp === stamp &&
    now - _tagsMemCache.savedAt < TAG_MEM_TTL_MS
  ) {
    return _tagsMemCache.tags;
  }
  if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) {
    return new Set();
  }
  var [movie, series] = Promise.all([
    fetchFiltersFor("Movie"),
    fetchFiltersFor("Series"),
  ]);
  var allTagsArr = [
    ...(movie.Tags || []),
    ...(series.Tags || []),
  ];
  var allTags = new Set(allTagsArr);
  if (allTags.size > 0) {
    _tagsMemCache = { stamp, savedAt: now, tags: allTags };
  }
  return allTags;
}

function normalizeAgeChip(rating) {
  if (!rating) return labels.noRating || "Sem classificação";
  var r = String(rating).toUpperCase().trim().replace(/\s+/g, "").replace(/-/g, "");
  if (/(18\+|R18|ADULT|NC17|NC\-?17|XRATED|XXX|ADULTSONLY|AO|TR18|DE18|FSK18)/.test(r)) return "18+";
  if (/(17\+|^R$|TVMA|TR17)/.test(r)) return "17+";
  if (/(16\+|R16|^M$|MATURE|TR16|DE16|FSK16)/.test(r)) return "16+";
  if (/(15\+|TV15|TR15)/.test(r)) return "15+";
  if (/(13\+|TV14|PG13|PG\-?13|TEEN|TR13|DE12A?)/.test(r)) return "13+";
  if (/(12\+|TV12|TR12|DE12|FSK12)/.test(r)) return "12+";
  if (/(11\+|TR11)/.test(r)) return "11+";
  if (/(10\+|TVY10|TR10)/.test(r)) return "10+";
  if (/(9\+|TR9)/.test(r)) return "9+";
  if (/(7\+|TVY7|E10\+?|TR7|DE6|FSK6)/.test(r)) return "7+";
  if (/(G|^PG$|TVG|TVPG|E$|EVERYONE|U$|UC|UNIVERSAL|TR6|DE0|FSK0)/.test(r)) return "7+";
  if (/(ALLYEARS|ALLAGES|ALL|TVY|KIDS|^Y$|0\+|TR0)/.test(r)) return "0+";
  var m = r.match(/^(\d{1,2})\+?$/);
  if (m) return (m[1]) + "+";
  return r;
}

function normalizeAgeRating(raw) {
  if (!raw) return labels.noRating || "Sem classificação";
  var s = String(raw).toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  if (/^TVMA$/.test(s)) return "18+";
  if (/^TV14$/.test(s)) return "14+";
  if (/^TVPG$/.test(s)) return "7+";
  if (/^TVG$/.test(s)) return labels.livre;
  if (s === "NC17") return "18+";
  if (s === "R") return "18+";
  if (s === "PG13") return "13+";
  if (s === "PG") return "7+";
  if (s === "G") return labels.livre;
  if (s === "18") return "18+";
  if (s === "15") return "15+";
  if (s === "12" || s === "12A") return "12+";
  if (s === "FSK18") return "18+";
  if (s === "FSK16") return "16+";
  if (s === "FSK12") return "12+";
  if (s === "FSK6") return "6+";
  if (s === "FSK0") return labels.livre;
  var m = s.match(/^(\d{1,2})\+?$/);
  if (m) return (m[1]) + "+";
  return s;
}

function localizedMaturityHeader() {
  var lang = String(currentLang || "").toLowerCase();
  if (labels.maturityHeader) return labels.maturityHeader;
  if (lang.startsWith("pt")  || lang.startsWith("por")) return "CLASSIFICAÇÃO INDICATIVA:";
  return "CLASSIFICAÇÃO:";
}
function localizedGenres(genres = []) {
  if (!Array.isArray(genres) || !genres.length) return [];
  var dict = labels.generos || {};
  var lc = Object.fromEntries(Object.entries(dict).mapfunction(([k, v]) [k.toLowerCase(), v]));
  return genres.mapfunction((g) dict[g] || lc[String(g).toLowerCase()] || g);
}
function descriptorLabel(code) {
  var dict = labels.descriptors || {};
  var fallback = {
    violence: "violence",
    sex: "sexual content",
    nudity: "nudity",
    horror: "horror/thriller",
    drugs: "drug use",
    profanity: "strong language",
    crime: "crime",
    war: "war",
    discrimination: "discrimination",
    mature: "mature themes",
  };
  return dict[code] || fallback[code] || code;
}
function _escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var _WORD_RX_CACHE = new Map();
function _getWordRxCached(words) {
  if (!Array.isArray(words) || !words.length) return null;
  var key = words.join('|');
  var rx = _WORD_RX_CACHE.get(key);
  if (!rx) {
    var pat = words.mapfunction((w) _escapeRe(String(w.trim()))).join("|");
    rx = new RegExp("(?:^|[^\\\\p{L}\\\\p{N}_])(?:" + (pat) + ")(?=$|[^\\\\p{L}\\\\p{N}_])", "iu");
    if (_WORD_RX_CACHE.size > 64) _WORD_RX_CACHE.clear();
    _WORD_RX_CACHE.set(key, rx);
  }
  return rx;
}

function _buildWordRx(words) {
  return _getWordRxCached(words);
}
function tokenIncludes(text, needles) {
  if (!text) return false;
  var rx = _getWordRxCached(needles);
  return !!(rx && rx.test(String(text)));
}
function countMatches(text, words) {
  if (!text || !words.length) return 0;
  var rx = _buildWordRx(words);
  if (!rx) return 0;
  var s = String(text),
    c = 0,
    m;
  while ((m = rx.exec(s))) {
    c++;
    s = s.slice(m.index + m[0].length);
  }
  return c;
}

var BASE_BUCKETS = [
  {
    key: "superhero",
    needles: [
      "superhero",
      "super hero",
      "superheroes",
      "comic book superhero",
      "comic book hero",
      "superhuman",
      "super powers",
      "superpower",
      "super strength",
      "cape",
      "masked vigilante",
      "vigilante",
      "secret identity",
      "alter ego",
      "supervillain",
      "super villain",
      "anti hero",
      "antihero",
      "marvel",
      "marvel comics",
      "dc",
      "dc comics",
      "marvel cinematic universe",
      "mcu",
      "dc extended universe",
      "dceu",
      "justice league",
      "avengers",
      "x men",
      "x-men",
      "spider man",
      "spider-man",
      "batman",
      "superman",
      "wonder woman",
      "iron man",
      "captain america",
      "thor",
      "hulk",
      "deadpool",
      "venom",
    ],
  },

  {
    key: "sci_fi_tech",
    needles: [
      "science fiction",
      "sci fi",
      "sci-fi",
      "science-fiction",
      "ficção científica",
      "naçnaya fantastika",
      "научная фантастика",
      "science-fiction",
      "ciencia ficcion",
      "space travel",
      "space mission",
      "space exploration",
      "space station",
      "spaceship",
      "spacecraft",
      "rocket",
      "astronaut",
      "interstellar",
      "outer space",
      "cosmic voyage",
      "first contact",
      "alien",
      "aliens",
      "alien invasion",
      "extraterrestrial",
      "ufo",
      "martian",
      "space opera",
      "space colony",
      "cyberpunk",
      "dystopia",
      "dystopian future",
      "post apocalyptic",
      "post-apocalyptic",
      "apocalyptic future",
      "time travel",
      "time loop",
      "time machine",
      "alternate timeline",
      "parallel universe",
      "alternate universe",
      "multiverse",
      "wormhole",
      "simulation",
      "simulated reality",
      "virtual reality",
      "vr",
      "artificial intelligence",
      "machine intelligence",
      "android",
      "robot",
      "robots",
      "cyborg",
      "mecha",
      "droid",
      "humanoid robot",
      "genetic engineering",
      "clone",
      "cloning",
      "mutation",
      "mutant",
      "mutants",
      "nanotechnology",
    ],
  },

  {
    key: "horror",
    needles: [
      "horror",
      "horreur",
      "ужасы",
      "terror",
      "korku",
      "slasher",
      "splatter",
      "found footage",
      "haunted house",
      "haunted",
      "haunting",
      "possession",
      "demonic possession",
      "demon",
      "demons",
      "exorcism",
      "occult",
      "satanic",
      "curse",
      "cursed",
      "nightmare",
      "gore",
      "gruesome",
      "bloodshed",
      "ghost",
      "ghosts",
      "spirit",
      "spirits",
      "poltergeist",
      "zombie",
      "zombies",
      "zombie apocalypse",
      "vampire",
      "vampires",
      "werewolf",
      "werewolves",
    ],
  },

  {
    key: "monster",
    needles: [
      "monster",
      "monsters",
      "creature feature",
      "giant monster",
      "kaiju",
      "godzilla",
      "mothra",
      "rodan",
      "giant creature",
      "giant animal",
      "giant spider",
      "giant snake",
      "dinosaur",
      "dinosaurs",
      "tyrannosaurus rex",
      "t-rex",
      "loch ness",
      "sea monster",
      "mutant creature",
    ],
  },

  {
    key: "war",
    needles: [
      "war",
      "warfare",
      "battle",
      "battlefield",
      "frontline",
      "trenches",
      "soldier",
      "army",
      "military",
      "navy",
      "air force",
      "marines",
      "combat mission",
      "world war",
      "world war i",
      "world war ii",
      "ww1",
      "ww2",
      "wwii",
      "vietnam war",
      "korean war",
      "gulf war",
      "civil war",
    ],
  },

  {
    key: "crime",
    needles: [
      "crime",
      "criminal",
      "organized crime",
      "underworld",
      "mafia",
      "mob",
      "gang",
      "gangster",
      "cartel",
      "drug cartel",
      "yakuza",
      "triad",
      "heist",
      "bank heist",
      "bank robbery",
      "robbery",
      "kidnapping",
      "abduction",
      "murder",
      "homicide",
      "serial killer",
      "hitman",
      "assassin",
      "money laundering",
      "police corruption",
    ],
  },

  {
    key: "violence",
    needles: [
      "violence",
      "violent",
      "brutal",
      "brutality",
      "blood",
      "bloody",
      "gore",
      "torture",
      "massacre",
      "gunfight",
      "shootout",
      "shooting",
      "sniper",
      "assault rifle",
      "knife fight",
      "stabbing",
      "explosion",
      "bombing",
      "grenade",
      "martial arts",
      "hand to hand combat",
    ],
  },

  {
    key: "sex",
    needles: [
      "sexual content",
      "sex",
      "sexual",
      "erotic",
      "erotica",
      "pornography",
      "pornographic",
      "sex scene",
      "orgy",
    ],
  },

  {
    key: "nudity",
    needles: [
      "nudity",
      "nude",
      "full frontal",
      "topless",
      "naked",
      "striptease",
    ],
  },

  {
    key: "profanity",
    needles: [
      "strong language",
      "explicit language",
      "profanity",
      "swearing",
      "vulgar",
      "obscene",
    ],
  },

  {
    key: "drugs",
    needles: [
      "drug use",
      "drugs",
      "drug abuse",
      "drug addiction",
      "narcotics",
      "drug dealer",
      "drug trafficking",
      "cocaine",
      "heroin",
      "meth",
      "opioid",
      "overdose",
    ],
  },

  {
    key: "discrimination",
    needles: [
      "racism",
      "sexism",
      "homophobia",
      "hate speech",
      "slur",
      "discrimination",
      "antisemitism",
      "islamophobia",
      "xenophobia",
    ],
  },

  {
    key: "mature",
    needles: [
      "adult themes",
      "mature themes",
      "psychological trauma",
      "trauma",
      "abuse",
      "domestic violence",
      "sexual assault",
      "rape",
      "incest",
      "suicide",
      "self harm",
      "self-harm",
      "child abuse",
      "child molestation",
    ],
  },

  {
    key: "supernatural",
    needles: [
      "supernatural",
      "paranormal",
      "paranormal activity",
      "spirit",
      "spirits",
      "curse",
      "cursed",
      "witch",
      "witchcraft",
      "sorcery",
      "magic ritual",
      "djinn",
      "demonic",
      "possession",
    ],
  },

  {
    key: "historical",
    needles: [
      "historical",
      "historical drama",
      "period drama",
      "based on history",
      "victorian era",
      "renaissance",
      "medieval",
      "ancient rome",
      "ancient greece",
      "ancient egypt",
      "ottoman empire",
      "byzantium",
    ],
  },

  {
    key: "fairytale",
    needles: [
      "fairy tale",
      "fairytale",
      "folk tale",
      "fable",
      "storybook",
      "princess",
      "prince",
      "kingdom",
      "enchanted forest",
    ],
  },

  {
    key: "fantasy_magic",
    needles: [
      "fantasy",
      "high fantasy",
      "dark fantasy",
      "magic",
      "wizard",
      "sorcerer",
      "witch",
      "spell",
      "dragon",
      "dragons",
      "myth",
      "mythology",
      "legend",
      "sword and sorcery",
      "enchanted",
    ],
  },

  {
    key: "thriller_suspense",
    needles: [
      "thriller",
      "suspense",
      "psychological thriller",
      "conspiracy",
      "manhunt",
      "hostage",
      "home invasion",
      "stalker",
      "kidnapping",
      "espionage",
      "spy thriller",
    ],
  },

  {
    key: "mystery_detective",
    needles: [
      "mystery",
      "detective",
      "whodunit",
      "crime investigation",
      "investigation",
      "private detective",
      "noir",
      "neo noir",
      "cold case",
      "clues",
    ],
  },

  {
    key: "romance_love",
    needles: [
      "romance",
      "romantic",
      "romantic drama",
      "love story",
      "love affair",
      "falling in love",
      "forbidden love",
      "romcom",
      "relationship",
    ],
  },

  {
    key: "comedy_humor",
    needles: [
      "comedy",
      "humor",
      "funny",
      "satire",
      "parody",
      "spoof",
      "slapstick",
      "dark comedy",
    ],
  },

  {
    key: "drama_family",
    needles: [
      "drama",
      "family drama",
      "family",
      "family conflict",
      "coming of age",
      "teenage life",
      "friendship",
      "grief",
      "loss",
      "parenting",
      "siblings",
    ],
  },

  {
    key: "action_adventure",
    needles: [
      "action",
      "action adventure",
      "adventure",
      "quest",
      "expedition",
      "treasure hunt",
      "chase",
      "car chase",
      "escape",
      "survival mission",
    ],
  },

  {
    key: "animation_kids",
    needles: [
      "animation",
      "animated",
      "cartoon",
      "family friendly",
      "kids",
      "children",
      "pixar",
      "disney",
      "stop motion",
      "stop-motion",
    ],
  },

  {
    key: "documentary_biopic",
    needles: [
      "documentary",
      "docudrama",
      "biography",
      "biographical",
      "biopic",
      "based on true story",
      "true story",
      "real events",
      "historical documentary",
      "nature documentary",
    ],
  },

  {
    key: "music_dance",
    needles: [
      "music",
      "musical",
      "concert",
      "band",
      "singer",
      "songwriter",
      "dance",
      "ballet",
      "hip hop",
      "hip-hop",
      "jazz",
    ],
  },

  {
    key: "sports",
    needles: [
      "sports",
      "boxing",
      "mma",
      "ufc",
      "football",
      "soccer",
      "basketball",
      "baseball",
      "tennis",
      "racing",
      "grand prix",
    ],
  },

  {
    key: "western",
    needles: [
      "western",
      "cowboy",
      "gunslinger",
      "outlaw",
      "wild west",
      "frontier",
      "spaghetti western",
    ],
  },

  {
    key: "political",
    needles: [
      "political",
      "politics",
      "political thriller",
      "election",
      "campaign",
      "white house",
      "government conspiracy",
      "coup",
      "authoritarianism",
      "totalitarian",
    ],
  },

  {
    key: "religion_myth",
    needles: [
      "religion",
      "religious",
      "faith",
      "religious cult",
      "cult",
      "biblical",
      "bible",
      "christianity",
      "islam",
      "judaism",
      "hinduism",
      "buddhism",
      "mythology",
      "norse mythology",
      "greek mythology",
    ],
  },

  {
    key: "survival_disaster",
    needles: [
      "disaster",
      "disaster movie",
      "earthquake",
      "tsunami",
      "flood",
      "hurricane",
      "tornado",
      "volcano",
      "pandemic",
      "outbreak",
      "apocalypse",
      "doomsday",
      "survival",
      "trapped",
    ],
  },

  {
    key: "period_era",
    needles: [
      "period piece",
      "period drama",
      "18th century",
      "19th century",
      "20th century",
      "1920s",
      "1930s",
      "1940s",
      "1950s",
      "1960s",
      "1970s",
      "1980s",
      "1990s",
    ],
  },

  {
    key: "travel_road",
    needles: [
      "road movie",
      "road trip",
      "journey",
      "travel",
      "travelling",
      "tour",
      "expedition",
      "backpacking",
    ],
  },

  {
    key: "animals_nature",
    needles: [
      "animals",
      "animal",
      "wildlife",
      "nature",
      "nature documentary",
      "animal attack",
      "shark attack",
      "bear",
      "wolf",
      "tiger",
      "lion",
      "dolphin",
      "whale",
    ],
  },
];

var BUCKETS = function(() {
  var mergeNeedles = function(base, extra) {
    var set = new Set();
    for (var n of base || []) {
      var v = String(n || "").trim().toLowerCase();
      if (v) set.add(v);
    }
    for (var n of extra || []) {
      var v = String(n || "").trim().toLowerCase();
      if (v) set.add(v);
    }
    return [...set];
  };

  var merged = BASE_BUCKETS.mapfunction((b) ({
    ...b,
    needles: mergeNeedles(b.needles, GENERATED_BUCKET_APPENDS.[b.key] || []),
  }));

  for (var extra of GENERATED_NEW_BUCKETS || []) {
    var key = String(extra.key || "").trim();
    if (!key) continue;
    merged.push({
      key,
      needles: mergeNeedles([], extra.needles || []),
    });
  }
  return merged;
})();

var _NEEDLE_INDEX = function(() {
  var idx = new Map();
  var add = function(k, bucket) {
    if (!k) return;
    var set = idx.get(k);
    if (!set) idx.set(k, (set = new Set()));
    set.add(bucket);
    };

   for (var b of BUCKETS) {
     for (var raw of b.needles) {
      var full = String(raw).toLowerCase().trim();
      if (!full) continue;
      add(full, b.key);
      var toks = full.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      for (var tk of toks) add(tk, b.key);
     }
   }
   return idx;
 })();

var _BUCKET_META = BUCKETS.mapfunction((b) {
  var fullNeedles = new Set();
  var tokenNeedles = new Set();
  var singleNeedles = new Set();
  var phraseNeedles = [];
  for (var raw of b.needles || []) {
    var norm = String(raw || "").toLowerCase().trim();
    if (!norm) continue;
    fullNeedles.add(norm);
    var toks = norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (var tk of toks) tokenNeedles.add(tk);
    if (toks.length === 1) singleNeedles.add(toks[0]);
    if (toks.length > 1 && norm.length >= 5) phraseNeedles.push(norm);
  }
  return {
    key: b.key,
    fullNeedles,
    tokenNeedles,
    singleNeedles,
    phraseNeedles,
  };
});
var _BUCKET_META_BY_KEY = new Mapfunction(_BUCKET_META.map((m) [m.key, m]));

function _tokenizeTag(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function _bucketScoresForTag(tag) {
  var norm = _normTag(tag);
  if (!norm) return new Map();
  var tokens = _tokenizeTag(norm);
  if (!tokens.length) return new Map();

  var scored = new Map();
  var candidates = new Set();
  var addScore = function(k, v) {
    if (!k || !Number.isFinite(v) || v <= 0) return;
    scored.set(k, (scored.get(k) || 0) + v);
    candidates.add(k);
  };

  var direct = _NEEDLE_INDEX.get(norm);
  if (direct) for (var k of direct) addScore(k, 2.8);

  for (var tk of tokens) {
    var set = _NEEDLE_INDEX.get(tk);
    if (!set) continue;
    for (var k of set) {
      candidates.add(k);
      var meta = _BUCKET_META_BY_KEY.get(k);
      if (meta.singleNeedles.has(tk)) addScore(k, 0.95);
    }
  }

  for (var key of candidates) {
    var meta = _BUCKET_META_BY_KEY.get(key);
    if (!meta) continue;
    var s = scored.get(meta.key) || 0;

    var singleHits = 0;
    var phraseHits = 0;
    for (var tk of tokens) {
      if (meta.singleNeedles.has(tk)) {
        singleHits++;
      } else if (meta.tokenNeedles.has(tk)) {
        phraseHits++;
      }
    }
    if (singleHits > 0) {
      var density = singleHits / Math.max(1, tokens.length);
      s += singleHits * 0.55 + density * 0.9;
    } else if (phraseHits >= 2) {
      var density = phraseHits / Math.max(1, tokens.length);
      s += phraseHits * 0.55 + density * 0.75;
    }

    if (!meta.fullNeedles.has(norm) && norm.length >= 6) {
      for (var phrase of meta.phraseNeedles) {
        if (norm.includes(phrase) || phrase.includes(norm)) {
          s += 1.2;
          break;
        }
      }
    }

    var neg = NEGATIVE_WORDS[meta.key] || [];
    if (neg.length) s -= 0.8 * countMatches(norm, neg);

    if (s > 0) scored.set(meta.key, s);
  }

  var threshold = tokens.length <= 1 ? 2.45 : 1.6;
  var filtered = [...scored.entries()]
    .filterfunction(([, s]) s >= threshold)
    .sortfunction((a, b) {
      if (b[1] !== a[1]) return b[1] - a[1];
      return _bucketPriorityRank(a[0]) - _bucketPriorityRank(b[0]);
    });

  if (!filtered.length) return new Map();
  var top = filtered[0][1];
  var out = new Map();
  for (var [k, s] of filtered) {
    if (s >= Math.max(threshold, top * 0.62)) out.set(k, s);
  }
  return out;
}

function _bucketsForTag(tag) {
  return new Set(_bucketScoresForTag(tag).keys());
}

var NEGATIVE_WORDS = {
  fairytale: ['war','battle','soldier','army','frontline','sniper','bomb','grenade','blood','gore','massacre'],
  romance_love: ['battlefield','massacre','genocide'],
  animation_kids: ['explicit','gore','slasher','torture'],
  music_dance: ['massacre','battlefield'],
  documentary_biopic: ['space battle','wizard','dragon'],
};

var BUCKET_PRIORITY = [
  'war','crime','violence','horror','thriller_suspense','mystery_detective',
  'sci_fi_tech','fantasy_magic','supernatural',
  'historical','political','survival_disaster',
  'action_adventure','drama_family','romance_love','comedy_humor',
  'documentary_biopic','sports','music_dance','western',
  'animation_kids','animals_nature','travel_road','period_era','monster',
  'superhero','fairytale'
];

function _bucketPriorityRank(code) {
  var idx = BUCKET_PRIORITY.indexOf(code);
  return idx === -1 ? 999 : idx;
}

function buildAutoDescriptorTagMap(catalogTags) {
   var map = {};
   for (var b of BUCKETS) map[b.key] = [];
   for (var t of catalogTags) {
     var scored = _bucketScoresForTag(t);
     if (!scored.size) continue;
     for (var [k] of scored) map[k].push(t);
   }
   return map;
 }
function getDescriptorTagMap() {
  if (labels.descriptorTagMap && typeof labels.descriptorTagMap === "object") {
    return labels.descriptorTagMap;
  }

  var map = {};
  for (var b of BUCKETS) {
    map[b.key] = Array.isArray(b.needles) ? b.needles.slice() : [];
  }
  return map;
}

function hasAny(tag, needles) {
  return tokenIncludes(tag || "", needles || []);
}

function _normTag(s) {
  return String(s || "").toLowerCase().trim();
}

function deriveTagDescriptors(item = {}) {
  var raw = (item.Tags || item.Keywords || []).filter(Boolean);
  if (!raw.length) return [];
  var tags = raw.map(_normTag);
  var map = getDescriptorTagMap();
  var validCodes = new Set(Object.keys(map));
  var scoreMap = new Mapfunction([...validCodes].map((k) [k, 0]));

  for (var tg of tags) {
    var scored = _bucketScoresForTag(tg);
    for (var [code, s] of scored) {
      if (!validCodes.has(code)) continue;
      scoreMap.set(code, (scoreMap.get(code) || 0) + s);
    }
    for (var code of validCodes) {
      var neg = NEGATIVE_WORDS[code] || [];
      if (!neg.length) continue;
      scoreMap.set(code, (scoreMap.get(code) || 0) - (0.65 * countMatches(tg, neg)));
    }
  }

  var scores = [...scoreMap.entries()]
    .filterfunction(([, s]) s > 1.2)
    .mapfunction(([code, s]) ({ code, s }));
  if (!scores.length) return [];
  scores.sortfunction((a, b) {
    if (b.s !== a.s) return b.s - a.s;
    return _bucketPriorityRank(a.code) - _bucketPriorityRank(b.code);
  });
  return scores.slice(0, 2).mapfunction((x) descriptorLabel(x.code));
}
function getDescriptorKeywordMap() {
  var k = labels.descriptorKeywords;
  if (k && typeof k === "object") return k;
  return {
    violence: ["violence", "violent", "fight", "combat", "assault", "brutal", "blood", "briga", "violência", "guerra", "arma", "luta", "gewalt", "kampf", "brutal"],
    sex: ["sexual", "sex", "erotic", "intimate", "explicit sex", "sexual", "erótico", "sexuell"],
    nudity: ["nudity", "nude", "nu", "nacktheit"],
    horror: ["horror", "thriller", "slasher", "gore", "supernatural", "paranormal", "terror", "suspense", "pavor", "übernatürlich"],
    drugs: ["drug", "narcotic", "cocaine", "heroin", "meth", "substance abuse", "droga", "maconha", "heroína", "cocaína", "drogen", "rauschgift", "álcool"],
    profanity: ["strong language", "explicit language", "profanity", "swear", "vulgar", "palavrão", "chulo", "schimpf", "vulgär"],
    crime: ["crime", "criminal", "mafia", "gang", "heist", "robbery", "crime", "máfia", "assalto", "krimi", "verbrechen"],
    war: ["war", "battle", "army", "military", "conflict", "front", "guerra", "exército", "soldado", "krieg", "schlacht"],
    discrimination: ["racism", "sexism", "homophobia", "discrimination", "discriminação", "racismo", "sexismo", "diskriminierung"],
    mature: ["adult themes", "abuse", "suicide", "self harm", "trauma", "domestic violence", "abuso", "suicídio", "trauma", "missbrauch", "suizid"],
  };
}
function deriveKeywordDescriptors(item = {}) {
  var overview = item.Overview || "";
  var taglines = (item.Taglines || []).join(" ") || "";
  var keysTags = (item.Keywords || item.Tags || []).join(" ") || "";
  var studios = (item.Studios || []).mapfunction((s) s.Name || s).join(" ");
  var WEIGHTS = { overview: 1.0, taglines: 0.6, keystags: 1.0, studios: 0.3 };
  var dict = getDescriptorKeywordMap();

  var scores = [];
  for (var [code, words] of Object.entries(dict)) {
    var s = 0;
    s += WEIGHTS.overview * countMatches(overview, words);
    s += WEIGHTS.taglines * countMatches(taglines, words);
    s += WEIGHTS.keystags * countMatches(keysTags, words);
    s += WEIGHTS.studios * countMatches(studios, words);
    var neg = NEGATIVE_WORDS[code] || [];
    s -= 1.2 * countMatches(overview + " " + keysTags, neg);
    if (s > 0.9) scores.push({ code, s });
  }
  if (!scores.length) return [];
  scores.sortfunction((a, b) {
    if (b.s !== a.s) return b.s - a.s;
    return _bucketPriorityRank(a.code) - _bucketPriorityRank(b.code);
  });
  return scores.slice(0, 2).mapfunction((x) descriptorLabel(x.code));
}

export function setupPauseScreen() {
  var pauseRuntime = getPauseFeaturesRuntimeConfig();
  if (!pauseRuntime.enablePauseOverlay && !pauseRuntime.enableSmartAutoPause) {
    try {
      window.__jmsPauseOverlay.destroy.();
    } catch {}
    try {
      if (window.__jmsPauseOverlay) {
        window.__jmsPauseOverlay.active = false;
        window.__jmsPauseOverlay.destroy = null;
      }
    } catch {}
    return function() {};
  }

  dlog("[PO] setupPauseScreen called", { active: window.__jmsPauseOverlay.active });
  var _badgeCtx = "first";

  var config = getConfig();
  var overlayConfig = config.pauseOverlay || { enabled: true };

  try {
    window.__jmsPauseOverlay.destroy.();
  } catch {}

  if (window.__jmsPauseOverlay.active) {
    window.__jmsPauseOverlay.active = false;
  }

  window.__jmsPauseOverlay.active = true;

  var LC = _mkLifecycle();
  var { signal } = LC;
  var lazyTagMapReady = false;

  function _shouldIgnoreEarlyMetaResets() {
  var now = Date.now();
  if ((now - (_playEventAt || 0)) < 2500) return true;
  if (_badgeShownAt && (now - _badgeShownAt) < 2000) return true;

  return false;
}

  function wipeOverlayState() {
    resetContent();
    currentMediaId = null;
    currentMediaData = null;
  }

function tryBindOnce(reason = 'kick') {
  var v = findBestPlayableVideoAnywhere(12);
  if (v) {
    try {
      if (v === activeVideo || v.__jmsPOBound === true) return true;
    } catch {}

    _playStartAt = Date.now();
    return !!bindVideo(v, reason);
  }
  return false;
}

function kickBindRetries(schedule = [50,150,350,800,1500,2500,4000,6000,8000,12000]) {
    schedule.forEach(function((ms) {
      LC.addTimeoutfunction(() {
        try {
          if (activeVideo && activeVideo.__jmsPOBound === true) return;
        } catch {}
        tryBindOnce('kick@'+ms);
      }, ms);
    });
  }
  var _onRouteHint = function() {
    kickBindRetries();
  };

  window.addEventListener('hashchange', _onRouteHint, { signal });
  window.addEventListener('popstate', _onRouteHint, { signal });

  document.addEventListenerfunction('play', (e) {
    var v = e.target;
    if (v instanceof HTMLVideoElement) {
      try { bindVideo(v, 'doc-capture-play'); } catch {}
    }
  }, { capture: true, passive: true, signal });

  function initDescriptorTagsOnce() {
    try {
      if (labels && labels.descriptorTagMap && typeof labels.descriptorTagMap === "object") return;
      var catalogTags = loadCatalogTagsWithCache();
      var autoMap = buildAutoDescriptorTagMap(catalogTags);
      labels.descriptorTagMap = autoMap;
    } catch (e) {
      if (!(e.status === 0 || e.status === 401 || e.status === 403 || e.isAbort)) {
        console.warn("descriptor tag map init hata:", e);
      }
    }
  }

  function isShortActiveVideo() {
    var v = activeVideo;
    if (!v) return false;
    var d = Number(v.duration || 0);
    return Number.isFinite(d) && d > 0 && d < getMinVideoDurationSec();
  }

  if (!document.getElementById("jms-pause-overlay")) {
    var overlay = document.createElement("div");
    overlay.id = "jms-pause-overlay";
    overlay.innerHTML = "\n  <div class=\"pause-overlay-content\">\n    <div class=\"pause-left\">\n      <div id=\"jms-overlay-title\" class=\"pause-title\"></div>\n      <div id=\"jms-overlay-metadata\" class=\"pause-metadata\"></div>\n      <div id=\"jms-overlay-plot\" class=\"pause-plot\"></div>\n    </div>\n    <div class=\"pause-right\">\n      <div class=\"pause-right-backdrop\"></div>\n      <div id=\"jms-overlay-logo\" class=\"pause-logo-container\"></div>\n    </div>\n  </div>\n  <div id=\"jms-overlay-progress\" class=\"pause-progress-wrap\" aria-hidden=\"true\">\n    <div class=\"pause-progress-top\">\n      <span id=\"jms-progress-remaining\"></span>\n      <span id=\"jms-progress-percent\"></span>\n    </div>\n    <div class=\"pause-progress-bar\">\n      <div id=\"jms-progress-elapsed\" class=\"pause-progress-elapsed\"></div>\n      <div id=\"jms-progress-remainingFill\" class=\"pause-progress-remainingFill\"></div>\n      <div id=\"jms-progress-sep\" class=\"pause-progress-sep\">/</div>\n    </div>\n  </div>\n  <div class=\"pause-status-bottom-right\" id=\"pause-status-bottom-right\" style=\"display:none;\">\n    <span><i class=\"fa-solid fa-pause\"></i> " + (labels.paused || "Pausado") + "</span>\n  </div>";
    document.body.appendChild(overlay);

    if (!document.getElementById("jms-pause-extra-css")) {
      var style = document.createElement("style");
      style.id = "jms-pause-extra-css";
     }
    _recoBadgeEl = document.createElement("div");
    _recoBadgeEl.id = "jms-reco-badge";
    _recoBadgeEl.className = "jms-reco-badge";
    _recoBadgeEl.innerHTML = "<button id=\"jms-reco-toggle\"><i class=\"fa-solid fa-thumbs-up\"></i><span id=\"jms-reco-badge-text\"></span></button>";
    document.body.appendChild(_recoBadgeEl);

    _recoPanelEl = document.createElement("div");
    _recoPanelEl.id = "jms-reco-panel";
    _recoPanelEl.className = "jms-reco-panel";
    _recoPanelEl.innerHTML = "<div class=\"pause-recos-header\" id=\"jms-reco-header\"></div><div class=\"jms-reco-row\" id=\"jms-reco-list\"></div>";
    document.body.appendChild(_recoPanelEl);

    _recoToggleEl = _recoBadgeEl.querySelector('#jms-reco-toggle');
    _recoListEl   = _recoPanelEl.querySelector('#jms-reco-list');
  }

  ddbg("[PO] overlay DOM created?", !!document.getElementById("jms-pause-overlay"));

  function createRatingGenreElement() {
    if (!document.getElementById("jms-rating-genre-overlay")) {
      ratingGenreElement = document.createElement("div");
      ratingGenreElement.id = "jms-rating-genre-overlay";
      ratingGenreElement.className = "rating-genre-overlay";
      document.body.appendChild(ratingGenreElement);
      if (!document.getElementById("jms-rating-genre-css")) {
        var style = document.createElement("style");
        style.id = "jms-rating-genre-css";
        style.textContent = "\n        .rating-genre-overlay{\n          position:fixed;\n          top:65px;\n          left:50px;\n          z-index:9999;\n          pointer-events:none;\n          opacity:0;\n          transform:translateY(-14px);\n          transition:transform .35s cubic-bezier(.2,.8,.4,1), opacity .35s ease;\n        }\n        .rating-genre-overlay.visible{\n          opacity:1;\n          transform:translateY(0)\n        }\n        .rating-genre-card{\n          display:flex;\n          align-items:flex-start;\n          gap:12px;\n          color:#fff;\n          text-shadow:\n            0 1px 3px rgba(0,0,0,.8),\n            0 2px 6px rgba(0,0,0,.6),\n            0 0 10px rgba(0,0,0,.4);\n        }\n        .rating-genre-card .bar{\n          width:3px;\n          height:44px;\n          background:#e10600;\n          border-radius:2px;\n          flex:0 0 3px;\n          margin-top:2px\n        }\n        .rating-genre-card .texts{\n          line-height:1.15\n        }\n        .rating-genre-card .line1{\n          font-size:22px;\n          font-weight:800;\n          letter-spacing:.3px;\n          text-transform:uppercase;\n          opacity:.98;\n          filter: drop-shadow(0 1px 2px rgba(0,0,0,.4));\n        }\n        .rating-genre-card .line2{\n          margin-top:4px;\n          font-size:16px;\n          font-weight:600;\n          opacity:.95;\n          text-transform:none;\n          filter: drop-shadow(0 1px 2px rgba(0,0,0,.4));\n        }\n        ";
        document.head.appendChild(style);
      }
    } else {
      ratingGenreElement = document.getElementById("jms-rating-genre-overlay");
    }
  }

  function showRatingGenre(itemData, duration = AGE_BADGE_DEFAULT_MS) {
    var po = getConfig().pauseOverlay || {};
    if (po.showAgeBadge === false) return false
    if (!lazyTagMapReady) {
      try {
        initDescriptorTagsOnce();
      } catch {}
      lazyTagMapReady = true;
    }
    if (!ratingGenreElement) createRatingGenreElement();
    if (ratingGenreTimeout) {
      clearTimeout(ratingGenreTimeout);
      ratingGenreTimeout = null;
    }
    var data = itemData;

    try {
      var isEpisode = data.Type === "Episode";
      var noTags = !Array.isArray(data.Tags) || data.Tags.length === 0;
      var maybeSeriesId = data.SeriesId || data._episodeData.SeriesId || null;

      var genresMissing = !Array.isArray(data.Genres) || data.Genres.length === 0;
      var ratingMissing = !data.OfficialRating;
      if (isEpisode && maybeSeriesId && (noTags || genresMissing || ratingMissing)) {
        var series = fetchItemDetailsCached(maybeSeriesId);
        var mergedTags = [
          ...(series.Tags || []),
          ...(data.Tags || []),
          ...(data.Keywords || []),
        ].filter(Boolean);
        data = {
          ...series,
          ...data,
          Tags: Array.from(new Set(mergedTags)),
          Genres: genresMissing ? series.Genres || [] : data.Genres,
          OfficialRating: ratingMissing ? series.OfficialRating || data.OfficialRating : data.OfficialRating,
        };
      }
    } catch {}

    var mui = getMaturityUiCached(data);
    var age = mui.age;
    var line2Arr = mui.line2Arr;
    try { data.__jmsMaturityIcons = mui.icons; } catch {}

    if (!age && (!line2Arr || line2Arr.length === 0)) {
      hideRatingGenre();
      return;
    }
    var line1 = age ? [localizedMaturityHeader(), age].join(" ") : "";
    var line2 = line2Arr.join(", ");

    if (line1 || line2) {
      ratingGenreElement.innerHTML = "\n        <div class=\"rating-genre-card\">\n          <div class=\"bar\"></div>\n          <div class=\"texts\">\n            ${line1 ? "<div class="line1">${line1}</div>" : \"\"}\n            ${line2 ? "<div class="line2">${line2}</div>" : \"\"}\n          </div>\n        </div>";
      ratingGenreElement.classList.add("visible");
      _badgeShownAt = Date.now();
      ratingGenreTimeout = setTimeoutfunction(() {
        hideRatingGenre("auto");
        setTimeoutfunction(() {
          try {
            showIconBadges(mui.icons, duration);
          } catch {}
        }, 380);
      }, duration);
    }
  }

  var overlayEl = document.getElementById("jms-pause-overlay");
  var titleEl = document.getElementById("jms-overlay-title");
  var metaEl = document.getElementById("jms-overlay-metadata");
  var plotEl = document.getElementById("jms-overlay-plot");
  var backdropEl = document.querySelector(".pause-right-backdrop");
  var logoEl = document.getElementById("jms-overlay-logo");
  var pausedLabel = document.getElementById("pause-status-bottom-right");
  var progressWrapEl   = document.getElementById("jms-overlay-progress");
  var progressElapsedEl = document.getElementById("jms-progress-elapsed");
  var progressRemainFillEl = document.getElementById("jms-progress-remainingFill");
  var progressSepEl = document.getElementById("jms-progress-sep");
  var progressRemainEl = document.getElementById("jms-progress-remaining");
  var progressPctEl    = document.getElementById("jms-progress-percent");

  var _progressTimer = null;
  var _clamp01 = function(x) (x < 0 ? 0 : x > 1 ? 1 : x);
  function updateProgressUI() {
    if (!progressWrapEl) return;
    if (!overlayVisible || !activeVideo) {
      try { if (progressElapsedEl) progressElapsedEl.style.width = "0%"; } catch {}
      try { if (progressRemainFillEl) progressRemainFillEl.style.width = "100%"; } catch {}
      try { if (progressSepEl) progressSepEl.style.opacity = "0"; } catch {}
      if (progressRemainEl) progressRemainEl.textContent = "";
      if (progressPctEl) progressPctEl.textContent = "";
      return;
    }

    var ct = Number(activeVideo.currentTime || 0);
    var dur = Number(activeVideo.duration || 0);
    var hasDur = Number.isFinite(dur) && dur > 0;

    var pct = hasDur ? _clamp01(ct / dur) : 0;
    var pctText = hasDur ? (Math.round(pct * 100)) + "%" : "";
    var remLbl = (labels.remainingTime || "Restante");
    var remText = hasDur ? formatTime(rem) : (labels.sonucyok || "Indisponível");

    var pct10 = Math.round(pct * 1000) / 10;
    var rem10 = Math.max(0, 100 - pct10);

    try { if (progressElapsedEl) progressElapsedEl.style.width = (pct10) + "%"; } catch {}
    try { if (progressRemainFillEl) progressRemainFillEl.style.width = (rem10) + "%"; } catch {}
    try {
      if (progressSepEl) {
        if (hasDur) {
          progressSepEl.style.left = (pct10) + "%";
          progressSepEl.style.opacity = "0.95";
        } else {
          progressSepEl.style.opacity = "0";
        }
      }
    } catch {}
    if (progressRemainEl) progressRemainEl.textContent = "⏳ " + (remLbl) + ": " + (remText);
    if (progressPctEl) progressPctEl.textContent = pctText;
  }

  function startProgressLoop() {
    stopProgressLoop();
    updateProgressUI();
    _progressTimer = LC.addInterval(updateProgressUI, 250);
  }

  function stopProgressLoop() {
    try { if (_progressTimer) clearInterval(_progressTimer); } catch {}
    _progressTimer = null;
  }

  overlayEl.addEventListenerfunction("click", (e) {
    if (!overlayVisible || !activeVideo) return;
    if (overlayEl.__jmsSwipeConsumed) { overlayEl.__jmsSwipeConsumed = false; return; }
    var inRecos = e.target.closest("#jms-recos-row, .pause-reco-card");
    if (inRecos) return;
    try {
      var content = overlayEl.querySelector(".pause-overlay-content");
      content && (content.style.willChange = "transform, opacity");
    } catch {}
    activeVideo.play();
    hideOverlay();
  }, { signal });

  (function setupSwipeToDismiss(){
    var content = overlayEl.querySelector(".pause-overlay-content");
    if (!content) return;
    var startY = 0, startX = 0, lastY = 0, moved = false, dragging = false, startT = 0;
    var THRESHOLD_PX = 60;
    var MAX_ANGLE_TAN = Math.tan(35 * Math.PI/180);
    var CANCEL_CLICK_LOCK_MS = 300;
    var MAX_PULL_PX = 220;

    function setTransform(y){
      var dy = Math.max(0, Math.min(y, MAX_PULL_PX));
      var op = Math.max(0, 1 - dy/180);
      content.style.transform = "translateY(" + (dy) + "px)";
      content.style.opacity = String(op);
    }
    function clearTransform(){
      content.style.transition = "";
      content.style.transform = "";
      content.style.opacity = "";
      content.style.willChange = "";
    }
    function onStart(ev){
      if (!overlayVisible) return;
      var t = ev.touches.[0];
      if (!t) return;
      startY = lastY = t.clientY;
      startX = t.clientX;
      startT = performance.now();
      moved = false; dragging = true;
      content.style.willChange = "transform, opacity";
    }
    function onMove(ev){
      if (!dragging) return;
      var t = ev.touches.[0]; if (!t) return;
      var dy = t.clientY - startY;
      var dx = Math.abs(t.clientX - startX);
      if (!moved) {
        if (dy < 6 && dx < 6) return;
        var tan = dx / Math.max(1, Math.abs(dy));
        if (tan > MAX_ANGLE_TAN) { dragging = false; clearTransform(); return; }
        moved = true;
      }
      if (dy > 0) {
        ev.preventDefault();
        setTransform(dy);
      }
      lastY = t.clientY;
    }
    function onEnd(){
      if (!dragging) return;
      dragging = false;
      var totalDy = Math.max(0, lastY - startY);
      var dt = Math.max(1, performance.now() - startT);
      var v = totalDy / dt;
      var shouldDismiss = totalDy > THRESHOLD_PX || v > 0.9;
      if (shouldDismiss) {
        content.style.transition = "transform 0.22s ease, opacity 0.22s ease";
        content.style.transform = "translateY(" + (Math.max(totalDy, 160)) + "px)";
        content.style.opacity = "0";
        overlayEl.__jmsSwipeConsumed = true;
        setTimeoutfunction(() {
          overlayEl.__jmsSwipeClosing = true;
          hideOverlay({ fromSwipe: true });
          setTimeoutfunction(() { overlayEl.__jmsSwipeConsumed = false; }, CANCEL_CLICK_LOCK_MS);
        }, 200);
      } else {
        content.style.transition = "transform 0.25s cubic-bezier(.2,.8,.4,1), opacity 0.25s ease";
        content.style.transform = "translateY(0)";
        content.style.opacity = "1";
        setTimeout(clearTransform, 260);
      }
    }
    content.addEventListener("touchstart", onStart, { passive: true,  signal });
    content.addEventListener("touchmove",  onMove,  { passive: false, signal });
    content.addEventListener("touchend",   onEnd,   { passive: true,  signal });
    content.addEventListener("touchcancel",onEnd,   { passive: true,  signal });
  })();

  function renderIconOrEmoji(iconValue) {
    if (!iconValue) return "";
    if (iconValue.startsWith("fa-") || iconValue.includes("fa ")) {
      return "<i class=\"" + (iconValue) + "\"></i>";
    }
    return iconValue;
  }

  function _setRecoHeaderAndBadge(isEpisodeContext) {
  var headerEl = document.getElementById('jms-reco-header');
  var badgeTextEl = document.getElementById('jms-reco-badge-text');
  var badgeIconEl = _recoToggleEl.querySelector('i');

  var isEp = !!isEpisodeContext;
  var iconClass = isEp ? "fa-solid fa-tv" : "fa-solid fa-thumbs-up";
  var text = isEp ? (labels.unwatchedEpisodes || "Episódios não assistidos") : (labels.youMayAlsoLike || "Você também pode gostar");

  if (headerEl) headerEl.innerHTML = "<i class=\"" + (iconClass) + "\"></i> " + (text);
  if (badgeTextEl) badgeTextEl.textContent = text;
  if (badgeIconEl) badgeIconEl.className = iconClass;
}

  function _hideRecoBadgeAndPanel(){
    _recoBadgeEl.classList.remove('visible');
    _recoPanelEl.classList.remove('open');
    _recoPanelOpen = false;
  }

  function isVideoActivelyPlaying() {
    try {
      return !!(activeVideo && !activeVideo.paused && !activeVideo.ended);
    } catch {
      return false;
    }
  }

  function _maybeShowBadge(){
    if (!_recoItemsCache.length) return;
    if (overlayVisible) return;
    if (isVideoActivelyPlaying()) return;
    _recoBadgeEl.classList.add('visible');
  }

  function _toggleRecoPanel(){
    if (!_recoItemsCache.length) return;
    _recoPanelOpen = !_recoPanelOpen;
    if (_recoPanelOpen){
      _recoPanelEl.classList.add('open');
    } else {
      _recoPanelEl.classList.remove('open');
    }
  }
  var onToggleTap = function(e) {
    if (e && e.cancelable) e.preventDefault();
    e.stopPropagation.();
    _toggleRecoPanel();
  };
  _recoToggleEl.addEventListener('click', onToggleTap, { passive:false, capture:true });
  _recoToggleEl.addEventListener('pointerup', onToggleTap, { passive:false, capture:true });
  _recoToggleEl.addEventListener('touchstart', onToggleTap, { passive:false, capture:true });

  var _recoJustOpenedAt = 0;

  function openRecoPanel(){
    if (!_recoItemsCache.length) return;
    if (_recoPanelOpen) return;
    _recoPanelEl.classList.add('open');
    _recoPanelOpen = true;
    _recoJustOpenedAt = performance.now();
  }
  function closeRecoPanel(){
    _recoPanelEl.classList.remove('open');
    _recoPanelOpen = false;
  }

  var IS_TOUCH = navigator.maxTouchPoints > 0;
  if (!IS_TOUCH) {
    _recoBadgeEl.addEventListenerfunction('mouseenter', () { openRecoPanel(); }, { passive:true });
  } else {
    _recoBadgeEl.addEventListenerfunction('pointerup', (e) { if (e.cancelable) e.preventDefault(); e.stopPropagation(); openRecoPanel(); }, { passive:false, capture:true });
    _recoBadgeEl.addEventListenerfunction('touchstart', (e) { if (e.cancelable) e.preventDefault(); e.stopPropagation(); openRecoPanel(); }, { passive:false, capture:true });
  }

  if (!IS_TOUCH) _recoBadgeEl.addEventListenerfunction('mouseleave', () {
    setTimeoutfunction(() {
      var overPanel = _recoPanelEl.matches(':hover');
      var overBadge = _recoBadgeEl.matches(':hover');
      if (!overPanel && !overBadge) closeRecoPanel();
    }, 120);
  }, { passive:true });

  if (!IS_TOUCH) _recoPanelEl.addEventListenerfunction('mouseleave', () {
    setTimeoutfunction(() {
      var overPanel = _recoPanelEl.matches(':hover');
      var overBadge = _recoBadgeEl.matches(':hover');
      if (!overPanel && !overBadge) closeRecoPanel();
    }, 120);
  }, { passive:true });
  document.addEventListenerfunction('pointerdown', (e) {
    if (performance.now() - _recoJustOpenedAt < 300) return;
    if (_recoPanelOpen && !e.target.closest('#jms-reco-panel, #jms-reco-badge, #jms-reco-toggle')) {
      closeRecoPanel();
    }
  }, { passive:true });

  function showOverlay() {
    ddbg("[PO] showOverlay()");
  if (!overlayConfig.enabled) return;

  overlayEl.classList.add("visible");
  overlayVisible = true;
  _hideRecoBadgeAndPanel();
  startProgressLoop();

  if (pausedLabel) {
    pausedLabel.style.display = "flex";
    pausedLabel.style.opacity = "0";
    LC.addTimeoutfunction(() {
      pausedLabel.style.opacity = "0.92";
    }, 10);
  }

  var content = overlayEl.querySelector(".pause-overlay-content");
  var progressWrap = progressWrapEl;
  if (content) {
    content.style.willChange = "transform, opacity";
    content.style.transform = "translateY(10px)";
    content.style.opacity = "0";
    setTimeoutfunction(() {
      content.style.transition =
        "transform 0.4s cubic-bezier(0.2, 0.8, 0.4, 1), opacity 0.4s ease";
      content.style.transform = "translateY(0)";
      content.style.opacity = "1";
    }, 10);

    content.addEventListenerfunction("transitionend",
      () {
        content.style.willChange = "";
      },
      { once: true, signal }
    );
  }

  if (progressWrap) {
    progressWrap.style.willChange = "transform, opacity";
    progressWrap.style.transform = "translateY(10px)";
    progressWrap.style.opacity = "0";
    setTimeoutfunction(() {
      progressWrap.style.transition =
        "transform 0.4s cubic-bezier(0.2, 0.8, 0.4, 1), opacity 0.4s ease";
      progressWrap.style.transform = "translateY(0)";
      progressWrap.style.opacity = "1";
    }, 10);
  }
if (_mouseIdleTimer) { clearTimeout(_mouseIdleTimer); _mouseIdleTimer = null; }
  var enableMouseClose = (getConfig().pauseOverlay.closeOnMouseMove !== false);
  if (enableMouseClose) {
    var onMouseMoveClose = function() {
      hideOverlay({ preserve: true });
      if (_mouseIdleTimer) { clearTimeout(_mouseIdleTimer); }
      _mouseIdleTimer = LC.addTimeoutfunction(() {
        try {
          if (activeVideo && activeVideo.paused && isVideoVisible(activeVideo) && !overlayVisible) {
            showOverlay();
          }
        } catch {}
      }, 5000);
    };
    document.addEventListener('mousemove', onMouseMoveClose, { signal, passive: true });
  }
}

function hideOverlay(opts = {}) {
  var fromSwipe = !!opts.fromSwipe || !!overlayEl.__jmsSwipeClosing;
  var preserve = fromSwipe || !!opts.preserve;
  var HIDE_MS = 300;
  stopProgressLoop();

  var content = overlayEl.querySelector(".pause-overlay-content");
  var progressWrap = progressWrapEl;
  if (content) {
    content.style.willChange = "transform, opacity";
    if (!fromSwipe) {
      content.style.transition =
        "transform 0.3s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.3s ease";
      content.style.transform = "translateY(10px)";
      content.style.opacity = "0";
    }
  }

  if (progressWrap) {
    progressWrap.style.willChange = "transform, opacity";
    if (!fromSwipe) {
      progressWrap.style.transition =
        "transform 0.3s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.3s ease";
      progressWrap.style.transform = "translateY(10px)";
      progressWrap.style.opacity = "0";
    }
  }

  if (pausedLabel) {
    pausedLabel.style.opacity = "0";
    LC.addTimeoutfunction(() {
      overlayEl.classList.remove("visible");
      pausedLabel.style.display = "none";
    }, HIDE_MS);
  }

  LC.addTimeoutfunction(() {
    overlayEl.classList.remove("visible");
    overlayVisible = false;
    if (content) {
      var doReset = function() {
        content.style.transition = "";
        content.style.transform = "";
        content.style.opacity = "";
      };
      if (fromSwipe) requestAnimationFrame(doReset); else doReset();
    }
    if (progressWrap) {
      var doResetProgress = function() {
        progressWrap.style.transition = "";
        progressWrap.style.transform = "";
        progressWrap.style.opacity = "";
        progressWrap.style.willChange = "";
      };
      if (fromSwipe) requestAnimationFrame(doResetProgress); else doResetProgress();
    }
    if (!preserve) {
      wipeOverlayState();
    }
    overlayEl.__jmsSwipeClosing = false;
  }, HIDE_MS);

  if (pauseTimeout && !preserve) {
    clearTimeout(pauseTimeout);
    pauseTimeout = null;
  }
  LC.addTimeoutfunction(() { _maybeShowBadge(); }, HIDE_MS + 20);
}

  function _clearRecos() {
  _recoItemsCache = [];
  if (_recoListEl) _recoListEl.innerHTML = "";
  _hideRecoBadgeAndPanel();
}

  function resetContent() {
    if (config.pauseOverlay.showBackdrop) {
      backdropEl.style.backgroundImage = "none";
      backdropEl.style.opacity = "0";
    }
    if (config.pauseOverlay.showLogo) {
      logoEl.innerHTML = "";
    }
    titleEl.innerHTML = "";
    metaEl.innerHTML = "";
    plotEl.textContent = "";
    _clearRecos();
    try { if (progressElapsedEl) progressElapsedEl.style.width = "0%"; } catch {}
    try { if (progressRemainFillEl) progressRemainFillEl.style.width = "100%"; } catch {}
    try { if (progressSepEl) progressSepEl.style.opacity = "0"; } catch {}
    if (progressRemainEl) progressRemainEl.textContent = "";
    if (progressPctEl) progressPctEl.textContent = "";
  }

  function convertTicks(ticks) {
    if (!ticks || isNaN(ticks)) return labels.sonucyok || "Indisponível";
    var totalSeconds = ticks / 10000000;
    return formatTime(totalSeconds);
  }
  function formatTime(sec) {
    if (!sec || isNaN(sec)) return labels.sonucyok || "Indisponível";
    var t = Math.floor(sec);
    var m = Math.floor(t / 60);
    var h = Math.floor(m / 60);
    var rm = m % 60;
    var rs = t % 60;
    return h > 0 ? (h) + (labels.sa || "h") + " " + (rm) + (labels.dk || "m") + " " + (rs) + (labels.sn || "s") : (rm) + (labels.dk || "m") + " " + (rs) + (labels.sn || "s");
  }
  function genRow(label, value) {
    if (!value) return "";
    return "<div class=\"info-row\"><span>" + (label) + "</span><span>" + (value) + "</span></div>";
  }

  function refreshData(data) {
    currentMediaData = data;
    resetContent();
    var communityRatingValue = getCommunityRatingValue(data.CommunityRating);

    var ep = data._episodeData || null;
    if (config.pauseOverlay.showBackdrop) {
      setBackdrop(data);
    } else {
      backdropEl.style.backgroundImage = "none";
      backdropEl.style.opacity = "0";
    }
    if (config.pauseOverlay.showLogo) {
      setLogo(data);
    } else {
      logoEl.innerHTML = "";
    }

    if (ep) {
      var seriesTitle = data.Name || data.OriginalTitle || "";
      var line = formatSeasonEpisodeLine(ep);
      titleEl.innerHTML = "\n        <h1 class=\"pause-series-title\">" + (seriesTitle) + "</h1>\n        <h2 class=\"pause-episode-title\">" + (line) + "</h2>";
    } else {
      titleEl.innerHTML = "<h1 class=\"pause-movie-title\">" + (data.Name || data.OriginalTitle || "") + "</h1>";
    }

    if (config.pauseOverlay.showMetadata) {
      var rows = [
        genRow("📅 " + labels.showYearInfo, data.ProductionYear),
        genRow("⭐ " + labels.showCommunityRating, communityRatingValue != null ? (communityRatingValue) + "/10" : ""),
        genRow("👨‍⚖️ " + labels.showCriticRating, data.CriticRating ? Math.round(data.CriticRating) + "%" : ""),
        genRow("👥 " + labels.voteCount, data.VoteCount),
        genRow("🔞 " + labels.showOfficialRating, data.OfficialRating || labels.derecelendirmeyok || "Sem classificação"),
        genRow("🎭 " + labels.showGenresInfo, data.Genres.slice(0, 3).join(", ") || labels.noGenresFound || "Sem gêneros"),
        genRow("⏱️ " + labels.showRuntimeInfo, convertTicks(ep.RunTimeTicks || data.RunTimeTicks)),
        genRow("▶ " + labels.currentTime, formatTime(activeVideo.currentTime || 0)),
        genRow("⏳ " + labels.remainingTime, formatTime((activeVideo.duration || 0) - (activeVideo.currentTime || 0))),
      ];
      metaEl.innerHTML = rows.join("");
    } else {
      metaEl.innerHTML = "";
    }

    plotEl.textContent = config.pauseOverlay.showPlot ? (ep.Overview || data.Overview || (labels.konu || "Sobre: ") + (labels.noData || "Sem dados")) : "";

    _setRecoHeaderAndBadge(Boolean(ep));
    try {
      var recs = [];
      if (ep) {
        recs = fetchUnplayedEpisodesInSameSeason(ep, { limit: 5 });
      } else {
        recs = fetchSimilarUnplayed(data, { limit: 5 });
      }
      renderRecommendations(recs);
    } catch (e) {
      console.warn("pause overlay recommendation error:", e);
      _setRecoHeaderAndBadge(Boolean(ep));
      renderRecommendations([]);
    }
  }

  if (!window.__jmsPauseOverlay._boundBeforeUnload) {
    window.addEventListenerfunction("beforeunload",
      () {
        try {
          destroy();
        } catch {}
      },
      { once: true }
    );
    window.__jmsPauseOverlay._boundBeforeUnload = true;
  }

  function setBackdrop(item) {
  var tags = item.BackdropImageTags || [];
  var base = withServer('');
  var { accessToken } = getSessionInfo();
  var tokenQ = accessToken ? "&api_key=" + (encodeURIComponent(accessToken)) : "";
  if (tags.length > 0) {
    var url = (base) + "/Items/" + (item.Id) + "/Images/Backdrop/0?tag=" + (encodeURIComponent(tags[0])) + "&maxWidth=1920&quality=90" + (tokenQ);
    backdropEl.style.backgroundImage = "url('" + (url) + "')";
    backdropEl.style.opacity = "0.7";
  } else {
    backdropEl.style.backgroundImage = "none";
    backdropEl.style.opacity = "0";
  }
}
  function setLogo(item) {
  if (!item) return;
  var base = withServer('');
  var { accessToken } = getSessionInfo();
  var tokenQ = accessToken ? "&api_key=" + (encodeURIComponent(accessToken)) : "";
  var imagePref = config.pauseOverlay.imagePreference || "auto";
  var hasLogoTag = item.ImageTags.Logo || item.SeriesLogoImageTag || null;
  var hasDiscTag = item.ImageTags.Disc || null;

  var logoUrl = hasLogoTag ? (base) + "/Items/" + (item.Id) + "/Images/Logo?tag=" + (encodeURIComponent(hasLogoTag)) + (tokenQ) : null;
  var discUrl = hasDiscTag ? (base) + "/Items/" + (item.Id) + "/Images/Disc?tag=" + (encodeURIComponent(hasDiscTag)) + (tokenQ) : null;

    var sequence = function(() {
      switch (imagePref) {
        case "logo":
          return ["logo"];
        case "disc":
          return ["disc"];
        case "title":
          return ["title"];
        case "logo-title":
          return ["logo", "title"];
        case "disc-logo-title":
          return ["disc", "logo", "title"];
        case "disc-title":
          return ["disc", "title"];
        case "auto":
        default:
          return ["logo", "disc", "title"];
      }
    })();

    logoEl.innerHTML = "";
    for (var pref of sequence) {
      if (pref === "logo" && logoUrl) {
        logoEl.innerHTML = "<div class=\"pause-logo-container\"><img class=\"pause-logo\" src=\"" + (logoUrl) + "\" alt=\"\"/></div>";
        return;
      }
      if (pref === "disc" && discUrl) {
        logoEl.innerHTML = "<div class=\"pause-disk-container\"><img class=\"pause-disk\" src=\"" + (discUrl) + "\" alt=\"\"/></div>";
        return;
      }
      if (pref === "title") {
        logoEl.innerHTML = "<div class=\"pause-text-logo\">" + (item.Name || item.OriginalTitle || "") + "</div>";
        return;
      }
    }
    logoEl.innerHTML = "<div class=\"pause-text-logo\">" + (item.Name || item.OriginalTitle || "") + "</div>";
  }

  function showBadgeForCurrentIfFresh() {
    if (Date.now() - _badgeShownAt < BADGE_LOCK_MS) return false;
    if (ratingGenreElement.classList.contains("visible")) return false;
    if (_iconEl.classList.contains("visible")) return false;
    if (!SHOW_AGE_BADGE) return false;
    if (!activeVideo) return false;
    var BADGE_MIN_CT_SEC = 2.0;
    var MIN_DUR = getMinVideoDurationSec();

    var ct = Number(activeVideo.currentTime || 0);
    var dur = Number(activeVideo.duration || 0);
    if (!(isFinite(ct) && ct >= BADGE_MIN_CT_SEC)) return false;
    var durationOk = (isFinite(dur) && dur >= MIN_DUR) || (!isFinite(dur) && ct >= BADGE_MIN_CT_SEC);
    if (!durationOk) return false;

    var itemId = resolvePlaybackItemId({ minStableMs: 350 }).catchfunction(() null);
    if (!itemId) return false;

    var data = fetchItemDetailsCached(itemId).catchfunction(() null);
    if (!data) { console.debug('[badge] no item data'); return false; }
    if (shouldIgnoreTheme({ video: activeVideo, item: data })) return false;
    var durMs = _badgeDurationFor(_badgeCtx);

    if (data.Type === "Episode" && data.SeriesId) {
      try {
        var series = fetchItemDetailsCached(data.SeriesId);
        showRatingGenre({ ...series, _episodeData: data }, durMs);
      } catch {
        showRatingGenre(data, durMs);
      }
    } else {
      showRatingGenre(data, durMs);
    }
    return true;
  }

  function clearOverlayUi() {
    hideOverlay();
    resetContent();
    currentMediaId = null;
    try {
      hideRatingGenre("finished");
    } catch {}
    try { hideIconBadges("finished"); } catch {}
    _hideRecoBadgeAndPanel();
  }

  function isPreviewPlaybackElement(el) {
    if (!el) return false;
    try {
      if (el.dataset.jmsIgnorePauseOverlay === "1") return true;
      if (el.dataset.jmsPreview === "1") return true;

      var p = el.closest.(".intro-video-container");
      if (p) return true;

      var g = (typeof window !== "undefined") ? window.__JMS_PREVIEW_PLAYBACK : null;
      if (g.active) return true;
    } catch {}
    return false;
  }

  function bindVideo(video, why = '') {
    if (isPreviewPlaybackElement(video)) return false;
    ddbg("[PO] bindVideo", why, "paused?", video.paused, "src?", video.currentSrc || video.src);
    if (!video) return false;
    try {
      if (video.__jmsPOBound === true && typeof video.__jmsPOUnbind === "function") {
        return true;
      }
    } catch {}
    if (isPreviewInHub(video) || isStudioTrailerPopoverVideo(video) || shouldIgnoreTheme({ video })) {
      return false;
    }
    try { video.__jmsPOBound = true; } catch {}

    if (removeHandlers) removeHandlers();
    if (removeHandlersToken) {
      try {
        LC.untrackClean(removeHandlersToken);
      } catch {}
      removeHandlersToken = null;
    }
    if (video.closest(".video-preview-modal")) return;
    activeVideo = video;
    try { window.__jmsActiveVideo = video; } catch {}
    relaxScanDepth();

    var cleanupSmart = null;
    var armSmart = function() {
      if (cleanupSmart) { try { cleanupSmart(); } catch {} }
      try { cleanupSmart = createSmartAutoPause(video); } catch {}
    };
    var badgeStartAt = 0;
    var badgeChecks = 0;
    var _badgeSeq = 0;
    var _playCount = 0;
    var _badgeArmTimeoutId = null;
    var _badgeInFlight = false;
    var _badgeShownThisPlay = false;
    var BADGE_WINDOW_MS = 45000;
    var BADGE_MIN_CT_SEC = 2.0;

    function armBadgeAttempt(reason = "arm") {
      badgeStartAt = 0;
      badgeChecks = 0;

      _badgeSeq++;
      _badgeShownThisPlay = false;
      _badgeInFlight = false;

      cancelBadgeTimer();
      video.addEventListener("timeupdate", onTimeUpdateArm, { passive: true });

      var delayMs = _badgeDelayFor(_badgeCtx);
    _badgeArmTimeoutId = LC.addTimeoutfunction(() onTimeUpdateArm(_badgeSeq),
      Math.max(50, delayMs)
    );

      if (DEBUG_PO) dlog("[badge] armed:", reason, { seq: _badgeSeq, delay: BADGE_DELAY_MS });
    }

    function cancelBadgeTimer() {
      try { video.removeEventListener("timeupdate", onTimeUpdateArm); } catch {}
      try { if (_badgeArmTimeoutId) clearTimeout(_badgeArmTimeoutId); } catch {}
      _badgeArmTimeoutId = null;
      _badgeInFlight = false;
    }

    function onTimeUpdateArm(evOrSeq = _badgeSeq) {
      var seq = (typeof evOrSeq === "number") ? evOrSeq : _badgeSeq;

      if (seq !== _badgeSeq) return;
      if (_badgeShownThisPlay) return;

      var now = Date.now();
      var delayMs = _badgeDelayFor(_badgeCtx);
      if (delayMs > 0 && (now - (_playEventAt || _playStartAt)) < delayMs) return;
      if ((video.currentTime || 0) < BADGE_MIN_CT_SEC) return;
      if (_badgeInFlight) return;
      _badgeInFlight = true;

      try {
        if (!badgeStartAt) badgeStartAt = now;
        badgeChecks++;

        var shown = showBadgeForCurrentIfFresh();
        if (seq !== _badgeSeq) return;

        if (shown) {
          _badgeShownThisPlay = true;
          cancelBadgeTimer();
          return;
        }
        if (now - badgeStartAt > BADGE_WINDOW_MS) cancelBadgeTimer();
      } finally {
        _badgeInFlight = false;
      }
    }
    var onPause = function() {
      cancelBadgeTimer();
      ddbg("[PO] onPause fired", { ct: video.currentTime, dur: video.duration, paused: video.paused });
      hideRatingGenre();
      try { hideIconBadges(); } catch {}
      if (video.ended) {
        hideOverlay();
        if (pausedLabel) {
          pausedLabel.style.opacity = "0";
          pausedLabel.style.display = "none";
        }
        return;
      }
      if (pauseTimeout) clearTimeout(pauseTimeout);
      pauseTimeout = LC.addTimeoutfunction(() {
        if (!video.paused || video.ended) return;
        var dur = Number(video.duration || 0);
        var ok = (isFinite(dur) && dur >= getMinVideoDurationSec()) || (!isFinite(dur) && (video.currentTime || 0) >= 2);
        if (!ok) return;

        ddbg('[pause] paused', {
          domId: getItemIdFromDom(),
          stable: getStableItemIdDomFirst(),
          playNowId: getRecentPlayNowTargetId(),
          videoId: parsePlayableIdFromVideo(activeVideo),
          cpiLast: _cpiLastRawId
        });

        new Promise(function(r) setTimeout(r, 220));
        var itemId = resolvePlaybackItemId({ minStableMs: 350 }).catchfunction(() null);
        if (!itemId) return;
        ddbg('[pause] resolved itemId=', itemId);

        var baseInfo = fetchItemDetailsCached(itemId).catch(function(e) (console.warn('[pause] fetchItemDetails err', e), null));
        ddbg('[pause] baseInfo', baseInfo ? { Id: baseInfo.Id, Type: baseInfo.Type, SeriesId: baseInfo.SeriesId } : null);
        if (shouldIgnoreTheme({ video, item: baseInfo })) return;

        var seriesId =
          (baseInfo.Type === "Episode" && baseInfo.SeriesId) || baseInfo.SeriesId || baseInfo.Id || null;
        if (!seriesId) { console.debug('[overlay] no seriesId/baseId'); return; }

        currentMediaId = seriesId;
        var series = fetchItemDetailsCached(seriesId);
        if (!video.paused || video.ended) return;
        if (shouldIgnoreTheme({ video, item: series })) return;
        if (baseInfo.Type === "Episode") {
          refreshData({ ...series, _episodeData: baseInfo });
        } else {
          refreshData({ ...series, _episodeData: null });
        }
        showOverlay();
      }, 1200);
    };

    _playStartAt = Date.now();
    hardResetBadgeOverlay();

    var onPlay = function() {
      _badgeCtx = (_playCount === 0) ? "first" : "resume";
      _playCount++;
      _playEventAt = Date.now();
      if (overlayVisible) clearOverlayUi();
      if (pauseTimeout) clearTimeout(pauseTimeout);
      if (Date.now() - _badgeShownAt > BADGE_LOCK_MS) {
        hideRatingGenre("finished");
      }
      try { hideIconBadges("finished"); } catch {}
      armSmart();
      badgeStartAt = 0;
      badgeChecks = 0;
      _badgeSeq++;
      _badgeShownThisPlay = false;
      _badgeInFlight = false;
      cancelBadgeTimer();
      video.addEventListener("timeupdate", onTimeUpdateArm, { passive: true });
      _badgeArmTimeoutId = LC.addTimeoutfunction(() onTimeUpdateArm(_badgeSeq),
        Math.max(2000, BADGE_DELAY_MS)
      );
      _hideRecoBadgeAndPanel();
      armBadgeAttempt("play");
    };

    var onLoadedMetadata = function() {
      if (_shouldIgnoreEarlyMetaResets()) return;
      if (ratingGenreTimeout) {
        if (DEBUG_PO) dlog("[badge] loadedmetadata ignored (ratingGenreTimeout active)");
        return;
      }

      if (ratingGenreElement.classList.contains("visible") && Date.now() - _badgeShownAt < 2000) {
        if (DEBUG_PO) dlog("[badge] loadedmetadata ignored (badge protected)");
        return;
      }

      _playCount = 0;
      _badgeCtx = "first";

      var now = Date.now();
      var killedRecent = (now - (_badgeShownAt || 0)) < 2500;

      hideRatingGenre("finished");
      try { hideIconBadges("finished"); } catch {}

      if (killedRecent) {
        _badgeShownAt = 0;
        _badgeShownThisPlay = false;
        if (DEBUG_PO) dlog("[badge] killed by loadedmetadata → retry");
      }

      if (video.paused) return;
      if (overlayVisible) clearOverlayUi();
      armSmart();
      hardResetBadgeOverlay();
      armBadgeAttempt("loadedmetadata");
    };

    var onLoadStartSafe = function() {
      if (_shouldIgnoreEarlyMetaResets()) return;
      try {
        if ((video.currentTime || 0) > 1.0) return;
      } catch {}
      onLoadedMetadata();
    };

    var onEnded = function() {
      cancelBadgeTimer();
      hideRatingGenre("finished");
      try { hideIconBadges("finished"); } catch {}
      hideOverlay();
      if (pausedLabel) {
        pausedLabel.style.opacity = "0";
        pausedLabel.style.display = "none";
      }
    };
    var onEmptiedLike = function() {
      cancelBadgeTimer();
      hideRatingGenre("finished");
      try { hideIconBadges("finished"); } catch {}
      badgeStartAt = 0;
      badgeChecks = 0;
      clearOverlayUi();
    };
    var onSeekingHide = function() {
      if ((video.currentTime || 0) > 3 && Date.now() - _badgeShownAt > BADGE_LOCK_MS) {
        hideRatingGenre();
        try { hideIconBadges(); } catch {}
      }
    };

    video.addEventListener("pause", onPause, { signal });
    video.addEventListener("play", onPlay, { signal });
    video.addEventListener("loadedmetadata", onLoadedMetadata, { signal });
    video.addEventListener("loadstart", onLoadStartSafe, { signal });
    var onDurationChange = function() {
      if (_shouldIgnoreEarlyMetaResets()) return;
      if (Date.now() - _badgeShownAt > BADGE_LOCK_MS) {
        hideRatingGenre();
      }
    };
    video.addEventListener("durationchange", onDurationChange, { signal });
    var onPlaying = function() {
      try { hideIconBadges(); } catch {}
      badgeStartAt = 0;
      badgeChecks = 0;
    };
    video.addEventListener("playing", onPlaying, { signal });
    video.addEventListener("ended", onEnded, { signal });
    video.addEventListener("emptied", onEmptiedLike, { signal });
    video.addEventListener("abort", onEmptiedLike, { signal });
    video.addEventListener("stalled", onEmptiedLike, { signal });
    video.addEventListener("seeking", onSeekingHide, { signal });

    armSmart();

    if (!video.paused && !video.ended) {
      onPlay();
      LC.addTimeoutfunction(() {
        try { onTimeUpdateArm(); } catch {}
      }, 300);
    }

    removeHandlers = function() {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadstart", onLoadStartSafe);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("emptied", onEmptiedLike);
      video.removeEventListener("abort", onEmptiedLike);
      video.removeEventListener("stalled", onEmptiedLike);
      video.removeEventListener("seeking", onSeekingHide);
      cancelBadgeTimer();
      if (cleanupSmart) {
        try {
          cleanupSmart();
        } catch {}
        cleanupSmart = null;
      }
      try { video.__jmsPOBound = false; } catch {}
      try { video.__jmsPOUnbind = null; } catch {}
    };
    try { video.__jmsPOUnbind = removeHandlers; } catch {}
    removeHandlersToken = LC.trackClean(removeHandlers);
    return true;
  }

  function isPreviewInHub(video) {
   var inHub = video.closest("#studio-hubs, .hub-card, .hub-row, .hub-video") !== null;
   if (!inHub) return false;
   var probablyPreview =
     video.muted === true &&
     video.controls !== true &&
    (video.autoplay === true || video.loop === true);
   return probablyPreview;
 }

  function findAnyVideoDeep(root = document, maxDepth = 8) {
    var seen = new Set();
    function walk(node, d) {
      if (!node || d > maxDepth) return null;
      if (node instanceof HTMLVideoElement) return node;
      if (node.querySelector) {
        var v = node.querySelector('video');
        if (v) return v;
      }
      var sr = node.shadowRoot;
      if (sr && !seen.has(sr)) {
        seen.add(sr);
        var v2 = sr.querySelector.('video') || [...sr.childNodes].map(function(n) walk(n, d+1)).find(Boolean);
        if (v2) return v2;
      }
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) {
        var v3 = walk(kids[i], d+1);
        if (v3) return v3;
      }
      return null;
    }
    return walk(root, 0);
  }

  function* iterDocRoots(startDoc = document, maxIframes = 12) {
    yield startDoc;
    try {
      var iframes = startDoc.querySelectorAll.("iframe") || [];
      for (var i = 0; i < iframes.length && i < maxIframes; i++) {
        var fr = iframes[i];
        try {
          var idoc = fr.contentDocument || fr.contentWindow.document;
          if (idoc) yield idoc;
        } catch {}
      }
    } catch {}
  }

  function _scoreVideoCandidate(v){
    try {
      if (!(v instanceof HTMLVideoElement)) return -1e9;
      if (isStudioTrailerPopoverVideo(v)) return -1e9;
      if (shouldIgnoreTheme({ video: v })) return -1e9;
      if (isPreviewInHub(v)) return -1e6;

      var s = 0;
      var cls = String(v.className || '');
      var src = String(v.currentSrc || v.src || '');
      if (cls.includes('htmlvideoplayer')) s += 1000;
      if (v.controls) s += 120;
      if (!v.muted) s += 60;
      if (!v.loop) s += 40;
      if (src.startsWith('blob:')) s += 200;
      if (src && !src.includes('/slider/src/images/')) s += 80;
      try { if (isVideoVisible(v)) s += 50; } catch {}
      return s;
    } catch {
      return -1e9;
    }
  }

  function findBestPlayableVideoAnywhere(maxIframes = 12){
    var best = null;
    var bestS = -1e9;
    for (var doc of iterDocRoots(document, maxIframes)) {
      var vids = doc.querySelectorAll.('video') || [];
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        var sc = _scoreVideoCandidate(v);
        if (sc > bestS) { bestS = sc; best = v; }
      }
    }
    return (bestS > 0) ? best : null;
  }

  function scheduleMaybeDetachActive() {
    var v = activeVideo;
    if (!v) return;
    requestAnimationFramefunction(() {
      try {
        if (v.isConnected || document.contains(v)) return;
      } catch {}

      if (removeHandlers) removeHandlers();
      if (removeHandlersToken) {
        try { LC.untrackClean(removeHandlersToken); } catch {}
        removeHandlersToken = null;
      }
      try { unobserveVideo(v); } catch {}
      activeVideo = null;
      try {
        if (window.__jmsActiveVideo === v) window.__jmsActiveVideo = null;
      } catch {}
      clearOverlayUi();
    });
  }

  function isStudioTrailerPopoverVideo(video) {
    return (
      video.closest(".mini-trailer-popover") !== null ||
      video.parentElement.classList.contains("mtp-player") ||
      video.closest(".mtp-inner") !== null ||
      video.classList.contains("studio-trailer-video") ||
      (video.tagName === "IFRAME" && video.classList.contains("studio-trailer-iframe"))
    );
  }

  function createSmartAutoPause(video) {
    var scopeDoc = (video && video.ownerDocument) || document;
    var scopeWin = (scopeDoc.defaultView) || window;
    var topDoc = document;
    var topWin = window;
    var base = getConfig();
    var def = {
      enabled: true,
      blurMinutes: 0.5,
      hiddenMinutes: 0.2,
      idleMinutes: 45,
      useIdleDetection: true,
      respectPiP: true,
      ignoreShortUnderSec: getMinVideoDurationSec(),
      beginAfterMs: 4000,
      postPlayGuardMs: 2500
    };
    var sap = Object.assign({}, def, base.smartAutoPause || {});
    if (sap.idleThresholdMs != null && sap.idleMinutes == null) sap.idleMinutes = Number(sap.idleThresholdMs) / 60000;
    if (sap.unfocusedThresholdMs != null && sap.blurMinutes == null) sap.blurMinutes = Number(sap.unfocusedThresholdMs) / 60000;
    if (sap.offscreenThresholdMs != null && sap.hiddenMinutes == null) sap.hiddenMinutes = Number(sap.offscreenThresholdMs) / 60000;

    function minToMs(x) {
      var n = Number(x || 0);
      return isFinite(n) && n > 0 ? n * 60000 : 0;
    }
    var blurMs = minToMs(sap.blurMinutes);
    var hidMs = minToMs(sap.hiddenMinutes);
    var idleMs = minToMs(sap.idleMinutes);
    var useIdle = !!sap.useIdleDetection;
    var respectP = !!sap.respectPiP;

    if (!sap.enabled) return function() {};
    if (!video) return function() {};
    var dur = Number(video.duration || 0);
    if (sap.ignoreShortUnderSec && dur > 0 && dur < Number(sap.ignoreShortUnderSec)) {
      return function() {};
    }

    function inPiP() {
      try {
        return !!(document.pictureInPictureElement && document.pictureInPictureElement === video);
      } catch {
        return false;
      }
    }

    var actEvts = ["pointermove","pointerdown","mousedown","mouseup","keydown","wheel","touchstart","touchmove"];
    var onActivity = function() {
      lastActivityAt = Date.now();
    };
    actEvts.forEach(function((ev) scopeDoc.addEventListener(ev, onActivity, { passive: true }));
    actEvts.forEach(function((ev) video.addEventListener(ev, onActivity, { passive: true }));
    actEvts.forEach(function((ev) topDoc.addEventListener(ev, onActivity, { passive: true }));

    function onFocus() {
      blurAt = null;
      if (lastPauseReason === "blur") {
        tryAutoResume("focus");
        lastPauseReason = null;
      }
    }
    function onBlur() { blurAt = Date.now(); }
    scopeWin.addEventListener("focus", onFocus);
    scopeWin.addEventListener("blur", onBlur);
    topWin.addEventListener("focus", onFocus);
    topWin.addEventListener("blur", onBlur);

    function onVis() {
      if (scopeDoc.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else {
        hiddenAt = null;
        if (lastPauseReason === "hidden") {
          tryAutoResume("vis");
          lastPauseReason = null;
        }
      }
    }
    scopeDoc.addEventListener("visibilitychange", onVis);
    topDoc.addEventListener("visibilitychange", onVis);

    function tryAutoResume(kind) {
      try {
        if (!video) return;
        if (!video.paused || video.ended) return;
        if (!isVideoVisible(video)) return;
        if (sap.ignoreShortUnderSec && video.duration > 0 && video.duration < Number(sap.ignoreShortUnderSec)) {
          return;
        }
        if (sap.beginAfterMs > 0 && (Date.now() - startedAt) < sap.beginAfterMs) {
          return;
        }
        if (sap.postPlayGuardMs > 0 && lastPauseAt && (Date.now() - lastPauseAt) < sap.postPlayGuardMs) {
          return;
        }
        if (respectP && inPiP()) return;
        var reason = lastPauseReason;
        if (!reason) return;
        if (kind === "focus" && reason !== "blur") return;
        if (kind === "vis"   && reason !== "hidden") return;

        video.play();
      } catch (e) {
        console.warn("smartAutoPause auto-resume hata:", e);
      }
    }

    var startedAt = Date.now();
    var lastPlayAtMs = 0;
    var timer = setIntervalfunction(() {
      try {
        if (!video || video.ended) return;
        var now = Date.now();
       if (respectP && inPiP()) return;
       if (video.paused) return;
       if (sap.beginAfterMs > 0 && (now - startedAt) < sap.beginAfterMs) return;
       if (sap.postPlayGuardMs > 0 && lastPlayAtMs && (now - lastPlayAtMs) < sap.postPlayGuardMs) return;
        if ((video.currentTime || 0) < 1.5) return;
        if (hiddenAt && hidMs > 0 && now - hiddenAt >= hidMs) {
          if (lastPauseReason !== "hidden" || now - lastPauseAt > 3000) {
            video.pause();
            lastPauseReason = "hidden";
            lastPauseAt = now;
            return;
          }
        }
        if (blurAt && blurMs > 0 && now - blurAt >= blurMs) {
          if (lastPauseReason !== "blur" || now - lastPauseAt > 3000) {
            video.pause();
            lastPauseReason = "blur";
            lastPauseAt = now;
            return;
          }
        }
        if (useIdle && idleMs > 0 && now - lastActivityAt >= idleMs) {
          if (lastPauseReason !== "idle" || now - lastPauseAt > 3000) {
            video.pause();
            lastPauseReason = "idle";
            lastPauseAt = now;
            return;
          }
        }
      } catch {}
    }, 1000);

    var onPlayReset = function() {
      lastPauseReason = null;
      lastPlayAtMs = Date.now();
    };
    video.addEventListener("play", onPlayReset);

    return function() {
      clearInterval(timer);
      video.removeEventListener("play", onPlayReset);
      actEvts.forEach(function((ev) scopeDoc.removeEventListener(ev, onActivity));
      actEvts.forEach(function((ev) video.removeEventListener(ev, onActivity));
      actEvts.forEach(function((ev) topDoc.removeEventListener(ev, onActivity));
      scopeWin.removeEventListener("focus", onFocus);
      scopeWin.removeEventListener("blur", onBlur);
      topWin.removeEventListener("focus", onFocus);
      topWin.removeEventListener("blur", onBlur);
      scopeDoc.removeEventListener("visibilitychange", onVis);
      topDoc.removeEventListener("visibilitychange", onVis);
    };
  }

  var _visIO = null,
      _visMap = new WeakMap(),
      _visObserved = new WeakSet();
  function ensureVisIO() {
    if (_visIO) return _visIO;
    var thr = Number(config.pauseOverlay.visThreshold || 0.1);
    _visIO = LC.trackMofunction(new IntersectionObserver((ents) {
      ents.forEach(function((e) {
        var ratio = e.intersectionRatio || 0;
        _visMap.set(e.target, ratio >= thr);
      });
    }, { root: null, threshold: [0, thr] }));
    return _visIO;
  }
  function unobserveVideo(vid) {
    if (!vid || !_visIO) return;
    try {
      _visIO.unobserve(vid);
    } catch {}
    _visObserved.delete(vid);
    _visMap.delete(vid);
  }
  function legacyDomVisible(vid) {
    if (!vid) return false;
    var rect = vid.getBoundingClientRect.();
    var shown =
      vid.offsetParent !== null && !vid.hidden && vid.style.display !== "none" && vid.style.visibility !== "hidden" && rect && rect.width > 0 && rect.height > 0;
    return !!shown;
  }
  function isVideoVisible(vid = activeVideo || document.querySelector("video")) {
    if (!vid) return false;
    var io = ensureVisIO();
    if (!_visObserved.has(vid)) {
      io.observe(vid);
      _visObserved.add(vid);
    }
    var seen = _visMap.get(vid);
    if (seen === undefined) return legacyDomVisible(vid);
    return !!seen;
  }

  function convertDurationFromSeconds(sec) {
    var t = Math.floor(sec || 0);
    var m = Math.floor(t / 60),
      h = Math.floor(m / 60),
      rm = m % 60,
      rs = t % 60;
    return h > 0 ? (h) + (labels.sa) + " " + (rm) + (labels.dk) + " " + (rs) + (labels.sn) : (rm) + (labels.dk) + " " + (rs) + (labels.sn);
  }
  function formatSeasonEpisodeLine(ep) {
    var sWord = labels.season || "Temporada";
    var eWord = labels.episode || "Episódio";
    var sNum = ep.ParentIndexNumber;
    var eNum = ep.IndexNumber;
    var eTitle = ep.Name ? " – " + (ep.Name) : "";
    var numberFirst = new Set([]);

    var left = "",
      right = "";
    if (numberFirst.has(currentLang)) {
      if (sNum != null) left = (sNum) + ". " + (sWord);
      if (eNum != null) right = (eNum) + ". " + (eWord);
    } else {
      if (sNum != null) left = (sWord) + " " + (sNum);
      if (eNum != null) right = (eWord) + " " + (eNum);
    }
    var mid = left && right ? " • " : "";
    return (left) + (mid) + (right) + (eTitle).trim();
  }
  function formatEpisodeLineShort(ep) {
    var eNum = ep.IndexNumber;
    var titlePart = ep.Name ? " - " + (ep.Name) : "";
    var lang = String(currentLang || "").toLowerCase();
    var fallbackWords = { por: "episódio", pt: "episódio", eng: "Episode", en: "Episode", fra: "Épisode", fr: "Épisode", deu: "Folge", de: "Folge", rus: "серия", ru: "серия" };
    var rawWord = (labels && typeof labels.episode === "string" && labels.episode.trim()) || fallbackWords[lang] || "Episódio";
    var numberFirstOverride = typeof labels.numberFirstEpisode === "boolean" ? labels.numberFirstEpisode : null;
    var numberFirst = numberFirstOverride !== null ? numberFirstOverride : lang === "ru" || lang === "rus";
    if (eNum == null) return (rawWord) + (titlePart).trim();
    if (lang === "ru" || lang === "rus") {
      var w = rawWord.toLocaleLowerCase("ru");
      return (eNum) + " " + (w) + (titlePart);
    }
    return (rawWord) + " " + (eNum) + (titlePart);
  }

  function buildImgUrl(item, kind = "Primary", w = 300, h = 169) {
    if (!item.Id) return "";
    var tag = (item.ImageTags && (item.ImageTags[kind] || item.ImageTags["Primary"])) || item.PrimaryImageTag || item.SeriesPrimaryImageTag || "";
    var base = withServer('');
    var q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90", tag });
    return (base) + "/Items/" + (item.Id) + "/Images/" + (kind) + "?" + (q.toString());
  }
  function buildBackdropUrl(item, w = 360, h = 202) {
    var base = withServer('');
    if (!item) return "";
    var directTag =
      (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0]) ||
      (Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags[0]) ||
      null;
    if (directTag) {
      var q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90", tag: directTag });
      return (base) + "/Items/" + (item.Id) + "/Images/Backdrop?" + (q.toString());
    }
    if (item.ParentId) {
      var q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90" });
      if (Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags[0]) q.set("tag", item.ParentBackdropImageTags[0]);
      return (base) + "/Items/" + (item.ParentId) + "/Images/Backdrop?" + (q.toString());
    }
    var seriesId = item.SeriesId || null;
    var seriesBackdropTag = item.SeriesBackdropImageTag || (Array.isArray(item.SeriesBackdropImageTags) && item.SeriesBackdropImageTags[0]) || null;
    if (seriesId) {
      var q = new URLSearchParams({ fillWidth: String(w), fillHeight: String(h), quality: "90" });
      if (seriesBackdropTag) q.set("tag", seriesBackdropTag);
      return (base) + "/Items/" + (seriesId) + "/Images/Backdrop?" + (q.toString());
    }
    return buildImgUrl(item, "Primary", w, h);
  }
  function goToItem(item) {
    var { serverId } = getSessionInfo();
    if (!item.Id) return;
    var type = item.Type;
    try { _hideRecoBadgeAndPanel(); } catch {}
    if (type === "Episode" || type === "Season" || true) {
      location.href = "#/details?id=" + (encodeURIComponent(item.Id)) + "&serverId=" + (encodeURIComponent(serverId));
    }
  }
  function fetchUnplayedEpisodesInSameSeason(currentEp, { limit = 5 } = {}) {
    if (!currentEp.SeasonId) return [];
    var { userId } = getSessionInfo();
    var qs = new URLSearchParams({
      ParentId: currentEp.SeasonId,
      IncludeItemTypes: "Episode",
      Recursive: "false",
      UserId: userId || "",
      Filters: "IsUnplayed",
      Limit: String(limit + 1),
      Fields: [
        "UserData",
        "PrimaryImageAspectRatio",
        "RunTimeTicks",
        "ProductionYear",
        "SeriesId",
        "ParentId",
        "ImageTags",
        "PrimaryImageTag",
        "BackdropImageTags",
        "ParentBackdropImageTags",
        "SeriesBackdropImageTag",
        "SeriesPrimaryImageTag",
        "SeriesLogoImageTag"
      ].join(","),
      SortBy: "IndexNumber",
      SortOrder: "Ascending",
    });
    var data = makeApiRequest(withServer("/Items?" + (qs.toString())));
    var items = data.Items || [];
    return items.filterfunction((i) i.Id !== currentEp.Id).slice(0, limit);
  }
  function fetchSimilarUnplayed(item, { limit = 5 } = {}) {
  if (!item.Id) return [];
  var { userId } = getSessionInfo();
  var qs = new URLSearchParams({
    UserId: userId || "",
    Limit: String(limit * 3),
    EnableUserData: "true",
    Fields: "UserData,PrimaryImageAspectRatio,RunTimeTicks,ProductionYear,Genres,SeriesId,ParentId,ImageTags,PrimaryImageTag,BackdropImageTags,ParentBackdropImageTags,SeriesBackdropImageTag,SeriesPrimaryImageTag,SeriesLogoImageTag"
  });
  var items = makeApiRequest(withServer("/Items/" + (encodeURIComponent(item.Id)) + "/Similar?" + (qs.toString())));
  var list = Array.isArray(items) ? items : items.Items || [];
  var unplayed = list.filterfunction((x) {
    var ud = x.UserData || {};
    if (typeof ud.Played === "boolean") return !ud.Played;
    if (typeof ud.PlayCount === "number") return ud.PlayCount === 0;
    return true;
  });
  var chosen = unplayed.slice(0, limit);
  return chosen.length ? chosen : list.slice(0, limit);
}

  function renderRecommendations(items) {
    _recoItemsCache = Array.isArray(items) ? items.slice() : [];
    if (!_recoListEl) return;
    _recoListEl.innerHTML = "";
    if (!_recoItemsCache.length) { _clearRecos(); return; }
    _recoItemsCache.forEach(function((it) {
      var card = document.createElement("button");
      card.className = "jms-reco-card";
      card.type = "button";
      var imgUrl = buildBackdropUrl(it, 360, 202);
      var primaryFallback = buildImgUrl(it, "Primary", 360, 202);
      var img = document.createElement("img");
      img.className = "jms-reco-thumb";
      img.loading = "lazy";
      img.alt = "";
      img.src = imgUrl || primaryFallback;
      img.onerror = function() { img.onerror = null; img.src = primaryFallback; };
      var titleWrap = document.createElement("div");
      titleWrap.className = "jms-reco-title";

      var logoUrl = function((){
        if (it.Type === "Episode" && it.SeriesId) {
          var tag = it.SeriesLogoImageTag || null;
          if (tag) {
            var base = withServer('');
            var { accessToken } = getSessionInfo();
            var tokenQ = accessToken ? "&api_key=" + (encodeURIComponent(accessToken)) : "";
            return (base) + "/Items/" + (encodeURIComponent(it.SeriesId)) + "/Images/Logo?tag=" + (encodeURIComponent(tag)) + (tokenQ);
          }
          return null;
        }
        var tag = (it.ImageTags && it.ImageTags.Logo) || it.SeriesLogoImageTag || null;
        if (tag) {
          var base = withServer('');
          var { accessToken } = getSessionInfo();
          var tokenQ = accessToken ? "&api_key=" + (encodeURIComponent(accessToken)) : "";
          var id = (it.ImageTags && it.ImageTags.Logo) ? it.Id : (it.SeriesId || it.Id);
          return (base) + "/Items/" + (encodeURIComponent(id)) + "/Images/Logo?tag=" + (encodeURIComponent(tag)) + (tokenQ);
        }
        return null;
      })();

      if (logoUrl) {
        var logoImg = document.createElement("img");
        logoImg.className = "jms-reco-title-logo";
        logoImg.alt = "";
        logoImg.loading = "lazy";
        logoImg.src = logoUrl;
        titleWrap.innerHTML = "";
        titleWrap.appendChild(logoImg);
      } else {
        titleWrap.textContent = it.Type === "Episode"
          ? formatEpisodeLineShort(it)
          : (it.Name || it.OriginalTitle || "");
      }

      card.appendChild(img);
      card.appendChild(titleWrap);
      card.addEventListenerfunction("click", (e) { e.stopPropagation(); goToItem(it); });
      _recoListEl.appendChild(card);
    });
    _maybeShowBadge();
  }

  if (!window.__jmsPauseOverlay._boundUnload2) {
    window.addEventListenerfunction("beforeunload", () {
      for (var v of imageBlobCache.values()) {
        if (v) URL.revokeObjectURL(v);
      }
      imageBlobCache.clear();
    });
    window.__jmsPauseOverlay._boundUnload2 = true;
  }

  var _moQueued = false;
  function shouldSkipDeepNode(n) {
    try {
      var ch = n.childElementCount || 0;
      return ch > 500;
    } catch {
      return false;
    }
  }
  var mo = LC.trackMofunction(new MutationObserver((muts) {
      if (_moQueued) return;
      _moQueued = true;

      var queue = new Set();
      for (var m of muts) {
        m.addedNodes.forEach(function((n) {
          if (n.nodeType !== 1) return;
          if (shouldSkipDeepNode(n)) return;
          if (n.tagName === "VIDEO") queue.add(n);
          else if (n.tagName === "SOURCE" && n.parentElement.tagName === "VIDEO") queue.add(n.parentElement);
          else if (n.tagName === "IFRAME") {
          var onFrameLoad = function() {
             try {
               var idoc = n.contentDocument || n.contentWindow.document;
               if (!idoc) return;
               var vInFrame = findAnyVideoDeep(idoc);
               if (vInFrame) bindVideo(vInFrame);
             } catch {}
           };
           onFrameLoad();
           try { n.addEventListener("load", onFrameLoad, { once: true }); } catch {}
         }
          var vids = n.querySelectorAll.("video");
          if (vids) {
            for (var i = 0; i < vids.length && i < 8; i++) queue.add(vids[i]);
          }
        });
        m.removedNodes.forEach(function((n) {
          var containsActive =
            !!activeVideo &&
            n.nodeType === 1 &&
            typeof n.contains === "function" &&
            n.contains(activeVideo);
          if (n === activeVideo || containsActive) {
            scheduleMaybeDetachActive();
          }
        });
      }
      LC.addRaffunction(() {
        _moQueued = false;
        queue.forEach(function((v) { try { bindVideo(v, 'mo'); } catch {} });
      });
    })
  );
  mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

  var initVid = findAnyVideoDeep(document);
  if (initVid) bindVideo(initVid);
  var _fallbackTries = 0;
  var _fallbackScan = setIntervalfunction(() {
    if (!activeVideo) {
      var v = findBestPlayableVideoAnywhere(10);
      if (v) bindVideo(v);
    }
    _fallbackTries++;
    if (_fallbackTries > 10) { clearInterval(_fallbackScan); return; }
  }, 300);
 LC.trackCleanfunction(() clearInterval(_fallbackScan));

  function startOverlayLogic() {
    var tick = function() {
      var onValidPage = isVideoVisible(activeVideo);
      if (!onValidPage && overlayVisible) hideOverlay();
    };
    var timer = LC.addInterval(tick, 400);
    var stop = function() {
      clearInterval(timer);
    };
    LC.trackClean(stop);
    return stop;
  }

  var _onPop = function() {
    hideOverlay();
    try { _clearRecos(); } catch {}
  };
  var _onHash = function() {
    hideOverlay();
    try { _clearRecos(); } catch {}
  };
  var _onVis = function() {
    if (document.visibilityState === "visible" && !isVideoVisible()) {
      hideOverlay();
    }
  };
  window.addEventListenerfunction("hashchange", () { blurAt = null; hiddenAt = null; lastPauseReason = null; }, { signal });
  window.addEventListenerfunction("popstate",   () { blurAt = null; hiddenAt = null; lastPauseReason = null; }, { signal });
  function isFullscreenNow() {
  return !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement);
}

var _onKey = function(e) {
  if (e.key === "Escape" && overlayVisible && !isFullscreenNow()) {
    e.preventDefault();
    hideOverlay();
    return;
  }

  var altClose =
    (e.key === "Backspace")

  if (altClose && overlayVisible) {
    e.preventDefault();
    hideOverlay();
    return;
  }

  if (e.key.toLowerCase() === "f" && activeVideo) {
    if (isFullscreenNow()) {
      document.exitFullscreen.();
    } else {
      activeVideo.requestFullscreen.();
    }
  }
};
  document.addEventListener("keydown", _onKey, { signal });
  window.addEventListener("popstate", _onPop, { signal });
  window.addEventListener("hashchange", _onHash, { signal });
  document.addEventListener("visibilitychange", _onVis, { signal });

  var stopLoop = startOverlayLogic();
  requestIdleCallback.function(() {
    if (!window.__jmsPauseOverlay.active) return;
    initDescriptorTagsOnce();
  }, { timeout: 3000 });

  function destroy() {
    try {
      if (removeHandlers) removeHandlers();
    } catch {}
    try {
      mo.disconnect();
    } catch {}
    try {
      if (activeVideo) unobserveVideo(activeVideo);
    } catch {}
    try { if (ratingGenreTimeout) clearTimeout(ratingGenreTimeout); } catch {}
    ratingGenreTimeout = null;
    try { wipeBadgeStateAndDom(); } catch {}
    try { wipeIconBadges(); } catch {}
    try { overlayEl.classList.remove("visible"); } catch {}
    activeVideo = null;
    try { window.__jmsActiveVideo = null; } catch {}
    currentMediaId = null;
    if (pauseTimeout) clearTimeout(pauseTimeout);
    pauseTimeout = null;
    try {
      stopLoop.();
    } catch {}
    try {
      LC.cleanupAll();
    } catch {}
    try { _visIO.disconnect(); } catch {}
    _visIO = null;
    _visObserved = new WeakSet();
    _visMap = new WeakMap();
    try {
      for (var v of imageBlobCache.values()) { if (v) URL.revokeObjectURL(v); }
      imageBlobCache.clear();
    } catch {}
    window.__jmsPauseOverlay.active = false;
    window.__jmsPauseOverlay.destroy = null;
  }
  window.__jmsPauseOverlay.destroy = destroy;

  return function() {
    destroy();
  };
}

function createIconEl() {
  if (!document.getElementById("jms-rating-icons")) {
    var el = document.createElement("div");
    el.id = "jms-rating-icons";
    el.className = "rating-icons-overlay";
    el.innerHTML = "<div class=\"rating-icons-row\"></div>";
    document.body.appendChild(el);

    if (!document.getElementById("jms-rating-icons-css")) {
      var style = document.createElement("style");
      style.id = "jms-rating-icons-css";
      style.textContent = "\n      .rating-icons-overlay{\n        position:fixed;\n        top:65px;\n        left:60px;\n        z-index:9998;\n        pointer-events:none;\n        opacity:0;\n        transform:translateY(-10px);\n        transition:transform .30s cubic-bezier(.2,.8,.4,1), opacity .30s ease;\n      }\n      .rating-icons-overlay.visible{ opacity:1; transform:translateY(0) }\n      .rating-icons-row{\n        display:flex; align-items:center; gap:10px;\n        filter: drop-shadow(0 1px 2px rgba(0,0,0,.5)) drop-shadow(0 3px 8px rgba(0,0,0,.35));\n      }\n      .rating-icons-row img{\n        width:42px; height:42px; display:block; border-radius:6px; background:transparent;\n      }";
      document.head.appendChild(style);
    }
  }
  _iconEl = document.getElementById("jms-rating-icons");
  return _iconEl;
}

function hideIconBadges(reason) {
  if (!_iconEl) return;
  _iconEl.classList.remove("visible");
  try { if (_iconTimeout) clearTimeout(_iconTimeout); } catch {}
  _iconTimeout = null;
  if (reason === "auto" || reason === "finished") {
    setTimeoutfunction(() {
      if (_iconEl && _iconEl.parentNode) {
        var row = _iconEl.querySelector(".rating-icons-row");
        if (row) row.innerHTML = "";
      }
    }, 260);
  }
}

function wipeIconBadges() {
  try { if (_iconTimeout) clearTimeout(_iconTimeout); } catch {}
  _iconTimeout = null;
  if (_iconEl) {
    _iconEl.classList.remove("visible");
    var row = _iconEl.querySelector(".rating-icons-row");
    if (row) row.innerHTML = "";
  }
}

function _hasAnyWords(text, words){
  if (!text) return false;
  var rx = _getWordRxCached(words);
  return !!(rx && rx.test(String(text)));
}

function _descCodesFromItem(item){
  var dict = getDescriptorKeywordMap();
  var overview = item.Overview || "";
  var tags = (item.Tags || item.Keywords || []).join(" ");
  var joined = (overview) + " " + (tags).trim();

  var codes = new Set();
  if (_hasAnyWords(joined, dict.sex)) codes.add("sexo");
  if (_hasAnyWords(joined, dict.violence) || _hasAnyWords(joined, dict.war) || _hasAnyWords(joined, dict.crime)) {
    codes.add("violencia");
  }
  if (_hasAnyWords(joined, dict.mature)) codes.add("adulto");

  for (var t of (item.Tags || [])) {
    var hit = _bucketsForTag(t);
    if (hit.has("sex")) codes.add("sexo");
    if (hit.has("violence")) codes.add("violencia");
    if (hit.has("mature")) codes.add("adulto");
  }

  return Array.from(codes);
}

var BUCKET_ICON_MAP = {
  sex: "sexo",
  nudity: "sexo",
  romance_love: "livre",
  violence: "violencia",
  war: "violencia",
  crime: "violencia",
  action_adventure: "livre",
  superhero: "violencia",
  sports: "violencia",
  mature: "adulto",
  horror: "adulto",
  drugs: "adulto",
  profanity: "adulto",
  discrimination: "adulto",
  political: "adulto",
  religion_myth: "adulto",
  thriller_suspense: "adulto",
  mystery_detective: "adulto",
  documentary_biopic: "livre",
  music_dance: "livre",
  animation_kids: "livre",
  animals_nature: "livre",
  historical: "livre",
  fantasy_magic: "livre",
  supernatural: "livre",
  fairytale: "livre",
  travel_road: "livre",
  period_era: "livre",
  western: "livre",
  sci_fi_tech: "livre"
};

var BUCKET_ICON_WEIGHT = {
  sex: 0.95,
  nudity: 1.1,
  romance_love: 0.2,
  violence: 0.95,
  war: 0.85,
  crime: 0.72,
  action_adventure: 0.45,
  superhero: 0.3,
  sports: 0.18,
  mature: 1.12,
  horror: 1.0,
  drugs: 0.95,
  profanity: 0.55,
  discrimination: 0.72,
  political: 0.38,
  religion_myth: 0.2,
  thriller_suspense: 0.5,
  mystery_detective: 0.25,
  documentary_biopic: 0.2,
  music_dance: 0.2,
  animation_kids: 0.26,
  animals_nature: 0.24,
  historical: 0.2,
  fantasy_magic: 0.2,
  supernatural: 0.2,
  fairytale: 0.22,
  travel_road: 0.16,
  period_era: 0.18,
  western: 0.18,
  sci_fi_tech: 0.22,
};

var ICON_THRESHOLD = {
  sexo: 2.0,
  violencia: 2.2,
  adulto: 3.1,
};

function _bucketScoresFromItem(item) {
  var scores = new Map();
  var add = function(k, v) {
    if (!k || !Number.isFinite(v) || v <= 0) return;
    scores.set(k, (scores.get(k) || 0) + v);
  };

  var tags = Array.from(new Set([
    ...(item.Tags || []),
    ...(item.Keywords || []),
  ].mapfunction((t) String(t || "").trim()).filter(Boolean)));

  for (var t of tags) {
    var taggedScores = _bucketScoresForTag(t);
    for (var [k, s] of taggedScores) add(k, s);
  }

  var asText = function(v) String(v || "").toLowerCase();
  var hay = asText([
    item.Overview,
    (item.Taglines || []).join(" "),
    (item.Studios || []).mapfunction((s) s.Name || s).join(" "),
  ].join(" "));

  var textBoosts = [
    ["horror", /horror|slasher|gore|supernatural|paranormal/g, 1.25],
    ["war", /\bwar|battle|army|military\b/g, 0.95],
    ["crime", /\bcrime|mafia|gang|heist|robbery\b/g, 0.9],
    ["violence", /\bviolence|violent|fight|combat|torture\b/g, 1.0],
    ["sex", /\bsex|sexual|erotic|intimate\b/g, 1.0],
    ["nudity", /\bnudity|nude|topless\b/g, 1.15],
    ["drugs", /\bdrug|narcotic|cocaine|heroin|meth\b/g, 0.95],
    ["profanity", /\bprofanity|explicit language|vulgar|swear\b/g, 0.9],
    ["thriller_suspense", /\bthriller|suspense|stalker|espionage|kidnapping\b/g, 0.7],
    ["mystery_detective", /\bmystery|detective|whodunit|noir\b/g, 0.65],
    ["romance_love", /\bromance|romantic|love\b/g, 0.6],
    ["mature", /\baddiction|trauma|suicide|abuse|domestic violence\b/g, 1.2],
  ];
  for (var [bucket, rx, w] of textBoosts) {
    var count = (hay.match(rx) || []).length;
    if (count > 0) add(bucket, count * w);
  }

  return scores;
}

function _bucketKeysFromItem(item) {
  var keys = new Set();
  for (var [k, s] of _bucketScoresFromItem(item)) {
    if (s >= 1.4) keys.add(k);
  }
  return keys;
}

function buildIconListForItem(item) {
  var ALLOWED = new Set(["livre", "sexo", "violencia", "adulto"]);
  var iconScores = {
    livre: 0,
    sexo: 0,
    violencia: 0,
    adulto: 0,
  };

  var bucketScores = _bucketScoresFromItem(item);
  for (var [bucketKey, score] of bucketScores) {
    var icon = BUCKET_ICON_MAP[bucketKey];
    if (!icon) continue;
    iconScores[icon] += score * (BUCKET_ICON_WEIGHT[bucketKey] || 0.35);
  }

  var codes = _descCodesFromItem(item);
  for (var c of codes) {
    if (ALLOWED.has(c) && c !== "livre") iconScores[c] += 1.15;
  }

  var dict = getDescriptorKeywordMap();
  var joined = [
    item.Overview || "",
    (item.Taglines || []).join(" "),
    (item.Tags || item.Keywords || []).join(" "),
  ].join(" ");
  iconScores.sexo += 0.8 * (
    countMatches(joined, dict.sex || []) +
    countMatches(joined, dict.nudity || [])
  );
  iconScores.violencia += 0.72 * (
    countMatches(joined, dict.violence || []) +
    countMatches(joined, dict.war || []) +
    countMatches(joined, dict.crime || [])
  );
  iconScores.adulto += 0.85 * (
    countMatches(joined, dict.mature || []) +
    countMatches(joined, dict.drugs || []) +
    countMatches(joined, dict.profanity || []) +
    countMatches(joined, dict.discrimination || [])
  );

  var raw = item.OfficialRating || "";
  var norm = String(normalizeAgeRating(raw) || "").toLowerCase();
  var ageNum = parseInt(norm, 10);
  if (Number.isFinite(ageNum)) {
    if (ageNum >= 18) iconScores.adulto += 4.3;
    else if (ageNum >= 16) iconScores.adulto += 2.4;
    else if (ageNum >= 13) iconScores.violencia += 1.15;
    else if (ageNum <= 7) iconScores.livre += 1.8;
  }

  var isAdult =
    (Number.isFinite(ageNum) && ageNum >= 18) ||
    /(^|\b)(r|nc-?17|tvma|18\+)/i.test(raw);
  if (isAdult) iconScores.adulto += 3.4;

  var genelLbl = String(labels.livre || "livre").toLowerCase();
  var isGeneral =
    norm.includes("livre") ||
    norm === "7+" ||
    norm === "0+" ||
    norm.includes(genelLbl) ||
    /^g$|^tvg$/i.test(raw);
  if (isGeneral) iconScores.livre += 1.35;

  var hasHardRiskSignal =
    (bucketScores.get("violence") || 0) >= 1.4 ||
    (bucketScores.get("war") || 0) >= 1.2 ||
    (bucketScores.get("crime") || 0) >= 1.35 ||
    (bucketScores.get("mature") || 0) >= 1.15 ||
    (bucketScores.get("drugs") || 0) >= 1.1 ||
    (bucketScores.get("sex") || 0) >= 1.1 ||
    (bucketScores.get("nudity") || 0) >= 1.0;

  if (Number.isFinite(ageNum) && ageNum <= 7 && !hasHardRiskSignal) {
    return ["livre"];
  }

  var out = [];
  if (iconScores.adulto >= ICON_THRESHOLD.adulto) out.push("adulto");
  if (iconScores.violencia >= ICON_THRESHOLD.violencia) out.push("violencia");
  if (iconScores.sexo >= ICON_THRESHOLD.sexo) out.push("sexo");

  var shouldIncludeGenel =
    (iconScores.livre >= 1.2 || isGeneral || (Number.isFinite(ageNum) && ageNum <= 7)) &&
    iconScores.adulto < ICON_THRESHOLD.adulto;
  if (shouldIncludeGenel) out.unshift("livre");

  var uniq = Array.from(new Set(out)).filterfunction((n) ALLOWED.has(n));
  if (!uniq.length) uniq = ["livre"];
  return uniq;
}

function showIconBadges(itemOrIcons, durationMs) {
  var po = getConfig().pauseOverlay || {};
  if (po.showAgeBadge === false) return;

  var el = createIconEl();
  var row = el.querySelector(".rating-icons-row");
  var icons = Array.isArray(itemOrIcons)
    ? itemOrIcons
    : (itemOrIcons.__jmsMaturityIcons || buildIconListForItem(itemOrIcons));

  if (!icons.length) { hideIconBadges(); return; }

  row.innerHTML = icons.map(function(n) "<img src=\"./slider/src/images/ages/" + (n) + ".svg\" alt=\"\">").join("");
  el.classList.add("visible");

  try { if (_iconTimeout) clearTimeout(_iconTimeout); } catch {}
  _iconTimeout = setTimeoutfunction(() {
    hideIconBadges("auto");
  }, _msFromConfig((durationMs || AGE_BADGE_DEFAULT_MS), 10000));
}
