import { getSessionInfo, makeApiRequest, getCachedUserTopGenres } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig, getHomeSectionsRuntimeConfig, normalizeManagedCardTitleDisplayMode } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { openGenreExplorer, openPersonalExplorer } from "./genreExplorer.js";
import { REOPEN_COOLDOWN_MS, getOpenHoverDelay } from "./hoverTrailerModal.js";
import { createTrailerIframe, formatOfficialRatingLabel } from "./utils.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import {
  withServer,
  isKnownMissingImage
} from "./jfUrl.js";
import { faIconHtml, findFaIcon } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import {
  openPrcDB,
  makeScope,
  putItems,
  getMeta,
  setMeta,
  purgePrcDb
} from "./prcDb.js";
import {
  keepManagedSectionsBelowNative,
  bindManagedSectionsBelowNative,
  waitForNativeHomeSectionStability,
  waitForVisibleHomeSections
} from "./homeSectionNative.js";
import {
  enqueueManagedSectionRender,
  invalidateManagedSectionRenderKeys,
  registerManagedHomeRowAnchor,
  waitForManagedHomeRowRelease,
  waitForSectionTailAdvance
} from "./homeSectionChain.js";

var config = getConfig();
var labels = getLanguageLabels.() || {};
var IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
var UNIFIED_ROW_ITEM_LIMIT = 20;
var MIN_RATING = Number.isFinite(config.studioHubsMinRating)
  ? Math.max(0, Number(config.studioHubsMinRating))
  : 0;
var PLACEHOLDER_URL = resolveSliderAssetHref(
  config.placeholderImage || "/slider/src/images/placeholder.png"
);
var ENABLE_GENRE_HUBS = !!config.enableGenreHubs;
var HOME_DEBUG_STORAGE_KEY = "jms:debug:home-sections";
var __hoverIntent = new WeakMap();
var __enterTimers = new WeakMap();
var __enterSeq     = new WeakMap();
var __cooldownUntil= new WeakMap();
var __openTokenMap = new WeakMap();
var __boundPreview = new WeakMap();
var GENRE_LAZY = true;
var MOBILE_ROW_BATCH_SIZE = 1;
var DESKTOP_INITIAL_GENRE_LOADS = 1;
var GENRE_BATCH_SIZE = 1;
var GENRE_ROOT_MARGIN = '500px 0px';
var MANAGED_ROW_RELEASE_ROOT_MARGIN = IS_MOBILE
  ? "0px 0px 60% 0px"
  : "0px 0px 22% 0px";
var GENRE_FIRST_SCROLL_PX = Number(getConfig().genreRowsFirstBatchScrollPx) || 200;
var MIN_GENRE_VISIBLE_CARD_COUNT = 3;
var PRC_LOCK_DOWN_SCROLL = (getConfig().prcLockDownScrollDuringLoad === true);

function clampConfiguredCount(value, fallback, max = UNIFIED_ROW_ITEM_LIMIT) {
  var n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, n | 0));
}

function getPersonalRecsCardCount(source = null) {
  var cfg = source || getConfig.() || config || {};
  return clampConfiguredCount(cfg.personalRecsCardCount, 9);
}

function getBywRowCount(source = null) {
  var cfg = source || getConfig.() || config || {};
  return clampConfiguredCount(cfg.becauseYouWatchedRowCount, 1, 50);
}

function getBywCardCount(source = null) {
  var cfg = source || getConfig.() || config || {};
  return clampConfiguredCount(cfg.becauseYouWatchedCardCount, 10);
}

function getGenreRowsCount(source = null) {
  var cfg = source || getConfig.() || config || {};
  return clampConfiguredCount(cfg.studioHubsGenreRowsCount, 4, 50);
}

function getGenreRowCardCount(source = null) {
  var cfg = source || getConfig.() || config || {};
  return clampConfiguredCount(cfg.studioHubsGenreCardCount, 10);
}

function getGenreRenderableMin(source = null) {
  return Math.max(getGenreRowCardCount(source) + 1, 6);
}

function isPlaybackCompletedUserData(userData) {
  if (!userData || typeof userData !== "object") return false;
  if (userData.Played === true) return true;

  var playedPercentage = Number(userData.PlayedPercentage);
  return Number.isFinite(playedPercentage) && playedPercentage >= 100;
}

function hasPartialPlaybackUserData(userData) {
  if (!userData || typeof userData !== "object") return false;
  if (isPlaybackCompletedUserData(userData)) return false;

  var playedPercentage = Number(userData.PlayedPercentage);
  if (Number.isFinite(playedPercentage) && playedPercentage > 0 && playedPercentage < 100) {
    return true;
  }

  var positionTicks = Number(userData.PlaybackPositionTicks || 0);
  return positionTicks > 0;
}

function isPartialPlaybackItem(item) {
  var userData = item.UserData || item.UserDataDto || null;
  if (!hasPartialPlaybackUserData(userData)) return false;

  var positionTicks = Number(userData.PlaybackPositionTicks || 0);
  var runtimeTicks = Number(item.RunTimeTicks || item.CumulativeRunTimeTicks || 0);
  return runtimeTicks > 0 ? positionTicks < runtimeTicks : positionTicks > 0;
}

function getHomeRecommendationRuntimeConfig(source = null) {
  return getHomeSectionsRuntimeConfig(source || (getConfig.() || config || {}));
}

function isPersonalRecsHeroEnabled() {
  return getConfig().showPersonalRecsHeroCards !== false;
}

function isGenreHubsHeroEnabled() {
  return getConfig().showGenreHubsHeroCards !== false;
}

function isPrcDebugEnabled() {
  try {
    if (window.__JMS_DEBUG_HOME_SECTIONS === true) return true;
    if (window.__JMS_DEBUG_HOME_SECTIONS === false) return false;
    var raw = localStorage.getItem(HOME_DEBUG_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return window.__JMS_DEBUG_HOME_SECTIONS === true;
  }
}

function buildPrcDebugPayload(payload) {
  var extra = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : { value: payload };
  return {
    at: new Date().toISOString(),
    hash: String(window.location.hash || ""),
    page: currentIndexPage.().id || null,
    ...extra,
  };
}

function prcLog(event, payload = {}) {
  if (!isPrcDebugEnabled()) return;
  try { console.log("[JMS:PRC]", event, buildPrcDebugPayload(payload)); } catch {}
}

function prcWarn(event, payload = {}) {
  if (!isPrcDebugEnabled()) return;
  try { console.warn("[JMS:PRC]", event, buildPrcDebugPayload(payload)); } catch {}
}

var PRC_DB_STATE = {
  db: null,
  scope: null,
  userId: null,
  serverId: null,
  failed: false,
};

var PRC_SESSION_PERSONAL_CACHE = new Map();
var PRC_SESSION_BYW_SEEDS_CACHE = new Map();
var PRC_SESSION_BYW_ITEMS_CACHE = new Map();

function getPrcSessionScope(userId, serverId) {
  return makeScope({ userId, serverId });
}

function __appendCb(url, cb) {
  if (!url) return url;
  var u = String(url);
  var sep = u.includes('?') ? '&' : '?';
  return (u) + (sep) + "cb=" + (encodeURIComponent(String(cb)));
}

function __appendCbToSrcset(srcset, cb) {
  if (!srcset || typeof srcset !== 'string') return '';
  return srcset
    .split(',')
    .map(function(s) s.trim())
    .filter(Boolean)
    .map(function(part) {
      var m = part.match(/^(\S+)(\s+.+)?$/);
      if (!m) return part;
      return (__appendCb(m[1], cb)) + (m[2] || '');
    })
    .join(', ');
}

function __preloadOk(src) {
  return new Promisefunction((resolve) {
    var im = new Image();
    im.decoding = 'async';
    im.onload = function() resolve(true);
    im.onerror = function() resolve(false);
    im.src = src;
  });
}

function __preloadDecode(src) {
  if (!src) return false;
  try {
    var im = new Image();
    im.decoding = 'async';
    im.src = src;
    if (typeof im.decode === 'function') {
      im.decode();
    } else {
      new Promisefunction((res, rej) { im.onload = res; im.onerror = rej; });
    }
    return true;
  } catch {
    return false;
  }
}

function __prcCfg() {
  var cfg = getConfig.() || config || {};
  return {
    enabled: (cfg.prcUseDirRowsDb !== false),
    personalTtlMs: Number.isFinite(cfg.prcDbPersonalTtlMs) ? Math.max(60_000, cfg.prcDbPersonalTtlMs|0) : 6 * 60 * 60 * 1000,
    genreTtlMs:    Number.isFinite(cfg.prcDbGenreTtlMs)    ? Math.max(60_000, cfg.prcDbGenreTtlMs|0)    : 12 * 60 * 60 * 1000,
    bywTtlMs:      Number.isFinite(cfg.prcDbBywTtlMs)      ? Math.max(60_000, cfg.prcDbBywTtlMs|0)      : 4 * 60 * 60 * 1000,
    validateUserData: (cfg.prcDbValidateUserData !== false),
    maxCacheIds: Number.isFinite(cfg.prcDbMaxIds) ? Math.max(20, cfg.prcDbMaxIds|0) : 140,
  };
}

function __metaKeyGenresList(scope){ return "prc:genresList:" + (scope); }

function __isoWeekKey(d = new Date()) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  var y = date.getUTCFullYear();
  return (y) + "-W" + (String(weekNo).padStart(2, '0'));
}

function __metaKeyPersonal(scope){ return "prc:personal:" + (scope); }
function __metaKeyPersonalLast(scope){ return "prc:personal:lastShown:" + (scope); }
function __metaKeyGenre(scope, genre){
  return "prc:genre:" + (scope) + ":" + (String(genre||"").trim().toLowerCase());
}
function __metaKeyByw(scope){ return "prc:byw:" + (scope); }
function __metaKeyBywSeed(scope){ return "prc:byw:seed:" + (scope); }
function __metaKeyBywLast(scope){ return "prc:byw:lastShown:" + (scope); }
function __metaKeyBywScoped(scope, seedKey){ return "prc:byw:" + (seedKey) + ":" + (scope); }
function __metaKeyBywLastScoped(scope, seedKey){ return "prc:byw:lastShown:" + (seedKey) + ":" + (scope); }

var PRC_PURGE_KEY = function(scope) "prc:purge:last:" + (scope);

function getPrcTypeToken(itemType) {
  if (itemType === "Series") return "series";
  if (itemType === "BoxSet") return "boxset";
  return "movie";
}

function getPrcCardTypeBadge(itemType) {
  var ll = config.languageLabels || {};
  if (itemType === "Series") {
    return { label: ll.dizi || labels.dizi || "Série", icon: "tv" };
  }
  if (itemType === "BoxSet") {
    return {
      label: ll.collectionTitle || ll.boxset || labels.collectionTitle || labels.boxset || "Coleção",
      icon: "layerGroup"
    };
  }
  return { label: ll.film || labels.film || "Filme", icon: "film" };
}

function maybePurgePrcDb(st) {
  try {
    var cfg = __prcCfg();
    if (!st.db || !st.scope) return;

    var last = getMeta(st.db, PRC_PURGE_KEY(st.scope));
    var lastTs = Number(last.ts || 0);
    if (lastTs && (Date.now() - lastTs) < 24 * 60 * 60 * 1000) return;

    purgePrcDb(st.db, st.scope, {
      items: {
        ttlMs: Math.max(cfg.genreTtlMs, cfg.personalTtlMs, cfg.bywTtlMs) * 6,
        maxItems: Math.max(600, cfg.maxCacheIds * 20),
        maxScan: 9000,
      },
      meta: {
        ttlMs: 45 * 24 * 60 * 60 * 1000,
        prefix: 'prc:',
        maxScan: 4000,
      }
    });

    setMeta(st.db, PRC_PURGE_KEY(st.scope), { ts: Date.now() });
  } catch {}
}

function ensurePrcDb(userId, serverId) {
  var cfg = __prcCfg();
  if (!cfg.enabled) return null;
  if (PRC_DB_STATE.failed) return null;

  var scope = makeScope({ userId, serverId });
  if (PRC_DB_STATE.db && PRC_DB_STATE.scope === scope) return PRC_DB_STATE;

  try {
    PRC_DB_STATE.db = openPrcDB();
    PRC_DB_STATE.scope = scope;
    PRC_DB_STATE.userId = userId;
    PRC_DB_STATE.serverId = serverId;
    PRC_DB_STATE.failed = false;
    try { maybePurgePrcDb(PRC_DB_STATE); } catch {}
    return PRC_DB_STATE;
  } catch (e) {
    console.warn("PRC DB init failed:", e);
    PRC_DB_STATE.failed = true;
    PRC_DB_STATE.db = null;
    PRC_DB_STATE.scope = null;
    return null;
  }
}

function normalizeCachedItemLocal(rec) {
  if (!rec) return null;
  var Id = rec.Id || rec.itemId || null;
  if (!Id) return null;
  return {
    Id,
    Name: rec.Name || rec.name || "",
    Type: rec.Type || rec.type || "",
    ProductionYear: rec.ProductionYear || rec.productionYear || null,
    OfficialRating: rec.OfficialRating || rec.officialRating || "",
    CommunityRating: (rec.CommunityRating || rec.communityRating || null),
    ImageTags: rec.ImageTags || rec.imageTags || null,
    BackdropImageTags: rec.BackdropImageTags || rec.backdropImageTags || null,
    PrimaryImageAspectRatio: rec.PrimaryImageAspectRatio || rec.primaryImageAspectRatio || null,
    Overview: rec.Overview || rec.overview || "",
    Genres: rec.Genres || rec.genres || [],
    RunTimeTicks: rec.RunTimeTicks || rec.runTimeTicks || null,
    CumulativeRunTimeTicks: rec.CumulativeRunTimeTicks || rec.cumulativeRunTimeTicks || null,
    RemoteTrailers: rec.RemoteTrailers || rec.remoteTrailers || [],
    DateCreatedTicks: rec.DateCreatedTicks || rec.dateCreatedTicks || 0,
    People: rec.People || rec.people || [],
    PrimaryImageTag: rec.PrimaryImageTag || rec.primaryImageTag || null,
    __preferTaglessImages: true,
  };
}

function dbGetItemsByIds(db, scope, ids) {
  var clean = (ids || []).filter(Boolean);
  if (!db || !scope || !clean.length) return [];

  return new Promisefunction((resolve) {
    var out = [];
    var pending = 0;
    var aborted = false;

    var tx = null;
    try {
      tx = db.transaction(["items"], "readonly");
    } catch {
      resolve([]);
      return;
    }
    var store = tx.objectStore("items");

    tx.onabort = function() { aborted = true; resolve(out); };
    tx.onerror = function() { aborted = true; resolve(out); };
    tx.oncomplete = function() resolve(out);

    for (var id of clean) {
      pending++;
      var req;
      try {
        req = store.get((scope) + "|" + (id));
      } catch {
        pending--;
        continue;
      }
      req.onsuccess = function() {
        if (aborted) return;
        var norm = normalizeCachedItemLocal(req.result);
        if (norm) out.push(norm);
        pending--;
      };
      req.onerror = function() { pending--; };
    }
  });
}

function dbWriteThroughItems(db, scope, items) {
  if (!db || !scope || !items.length) return;
  try {
    putItems(db, scope, items);
  } catch (e) {
    console.warn("PRC DB write-through failed:", e);
  }
}

function filterOutPlayedIds(userId, ids) {
  var cfg = __prcCfg();
  var clean = Array.isArray(ids) ? Array.from(new Set(ids.filter(Boolean))) : [];
  if (!cfg.validateUserData || !clean.length) return clean;

  var played = new Set();
  var alive = new Set();
  var failed = new Set();
  var CHUNK = 60;
  var PAR = 2;
  var hadSuccess = false;

  try {
    for (var i = 0; i < clean.length; i += CHUNK * PAR) {
      var ps = [];
      for (var j = i; j < Math.min(clean.length, i + CHUNK * PAR); j += CHUNK) {
        var chunk = clean.slice(j, j + CHUNK);
        var url =
          "/Users/" + (encodeURIComponent(userId)) + "/Items?" +
          "Ids=" + (encodeURIComponent(chunk.join(","))) + "&Fields=UserData";

        ps.push(
          makeApiRequest(url)
            .thenfunction((r) {
              hadSuccess = true;
              var items = Array.isArray(r.Items) ? r.Items : (Array.isArray(r) ? r : []);
              for (var it of items) {
                if (!it.Id) continue;
                alive.add(it.Id);
                if (it.UserData.Played === true) played.add(it.Id);
              }
            })
            .catchfunction(() {
              for (var id of chunk) failed.add(id);
            })
        );
      }
      Promise.all(ps);
    }
    if (!hadSuccess) return clean;
    return clean.filter(function(id) (alive.has(id) && !played.has(id)) || failed.has(id));
  } catch {
    return clean;
  }
}

var GENRE_STATE = {
  genres: [],
  sections: [],
  nextIndex: 0,
  loading: false,
  awaitingAdvance: false,
  advancePromise: null,
  renderSeq: 0,
  wrap: null,
  hostEl: null,
  batchObserver: null,
  serverId: null,
  _loadMoreArrow: null,
};

function makeManagedGenreHubSectionId(index = 0) {
  return "genre-hubs--" + (Math.max(0, index | 0));
}

function getManagedGenreHubSections(root = getHomeSectionsContainer(currentIndexPage()) || document) {
  return Array.from(root.querySelectorAll.('[id^="genre-hubs--"]') || [])
    .filterfunction((el) el.isConnected)
    .sortfunction((left, right) {
      var li = Number(String(left.id || "").split("--")[1]) || 0;
      var ri = Number(String(right.id || "").split("--")[1]) || 0;
      return li - ri;
    });
}

function cleanupManagedGenreHubSections(root = getHomeSectionsContainer(currentIndexPage()) || document) {
  for (var section of getManagedGenreHubSections(root)) {
    try {
      section.querySelectorAll('.personal-recs-card, .dir-row-hero').forEach(function((el) {
        try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
      });
    } catch {}
    try { section.remove(); } catch {}
  }
}

function placeGenreHubSection(section) {
  var parent = GENRE_STATE.hostEl || getHomeSectionsContainer(currentIndexPage()) || document.body;
  var siblings = getManagedGenreHubSections(parent);
  var last = siblings[siblings.length - 1] || null;
  if (last.parentElement === parent) {
    last.insertAdjacentElement("afterend", section);
  } else {
    appendToParent(parent, section);
  }
  try { keepManagedSectionsBelowNative(parent); } catch {}
}

function __resetGenreHubsDoneSignal() {
  try { window.__jmsGenreHubsDone = false; } catch {}
}

function __signalGenreHubsDone() {
  try {
    if (window.__jmsGenreHubsDone) return;
    window.__jmsGenreHubsDone = true;
  } catch {}
  try { document.dispatchEvent(new Event("jms:genre-hubs-done")); } catch {}
}

function __maybeSignalGenreHubsDone() {
  try {
    var total = (GENRE_STATE.genres && GENRE_STATE.genres.length) || 0;
    if (!total) return;
    if (GENRE_STATE.nextIndex >= total) __signalGenreHubsDone();
  } catch {}
}

function setGenreArrowLoading(isLoading) {
  var arrow = GENRE_STATE._loadMoreArrow;
  if (!arrow) return;

  if (isLoading) {
    arrow.classList.add('is-loading');
    arrow.disabled = true;
    arrow.innerHTML = "<span class=\"gh-spinner\" aria-hidden=\"true\"></span>";
    arrow.setAttribute('aria-busy', 'true');
  } else {
    arrow.classList.remove('is-loading');
    arrow.disabled = false;
    arrow.innerHTML = faIconHtml("chevronDown");
    arrow.removeAttribute('aria-busy');
  }
}

function placeGenreLoadMoreArrow() {
  var parent = GENRE_STATE.hostEl || getHomeSectionsContainer(currentIndexPage()) || document.body;
  var arrow = GENRE_STATE._loadMoreArrow;
  if (!parent || !arrow) return;
  var siblings = getManagedGenreHubSections(parent);
  var last = siblings[siblings.length - 1] || null;
  if (last.parentElement === parent) {
    last.insertAdjacentElement("afterend", arrow);
  } else {
    appendToParent(parent, arrow);
  }
}

var __genreScrollIdleTimer = null;
var __genreScrollIdleAttached = false;
var __genreArrowObserver = null;
var __genreScrollHandler = null;
var __genreAutoPumpTimer = null;
var __personalRecsInitDone = false;
var __genreHubsBusy = false;
var __deferredHomeSectionSeq = 0;
var __bywDeferredPromise = null;
var __genreDeferredPromise = null;
var __personalRecsRetryTo = null;
var __personalRecsMountPromise = null;

function isPersonalRecsHomeRoute() {
  var h = String(window.location.hash || "").toLowerCase();
  return h.startsWith("#/home") || h.startsWith("#/index") || h === "" || h === "#";
}

function setDoneFlag(flagName, eventName, done) {
  var next = !!done;
  var prev = false;
  try { prev = window[flagName] === true; } catch {}
  try { window[flagName] = next; } catch {}
  if (next && !prev && eventName) {
    try { document.dispatchEvent(new Event(eventName)); } catch {}
  }
}

function setPersonalRecsDone(done) {
  setDoneFlag("__jmsPersonalRecsDone", "jms:personal-recommendations-done", done);
}

function getPersonalRecsDone() {
  try { return window.__jmsPersonalRecsDone === true; } catch {}
  return false;
}

function setBywDone(done) {
  setDoneFlag("__jmsBywDone", "jms:because-you-watched-done", done);
}

function getBywDone() {
  try { return window.__jmsBywDone === true; } catch {}
  return false;
}

function hasActivePersonalRecsHomeSections() {
  if (!isPersonalRecsHomeRoute()) return false;
  var page = currentIndexPage();
  return !!page.querySelector.(".homeSectionsContainer");
}

function clearPersonalRecsRetry() {
  if (__personalRecsRetryTo) {
    clearTimeout(__personalRecsRetryTo);
    __personalRecsRetryTo = null;
  }
}

function schedulePersonalRecsRetry(ms = 1000, options = {}, reason = "retry") {
  clearPersonalRecsRetry();
  prcWarn("retry:scheduled", {
    delayMs: Math.max(120, ms | 0),
    reason,
    force: options.force === true,
  });
  __personalRecsRetryTo = setTimeoutfunction(() {
    __personalRecsRetryTo = null;
    void renderPersonalRecommendations(options);
  }, Math.max(120, ms | 0));
}

function invalidatePersonalManagedQueue() {
  try {
    invalidateManagedSectionRenderKeys([
      "personalRecommendations",
      "becauseYouWatched",
      "genreHubs"
    ]);
  } catch {}
}

function clearPersonalDeferredPromises() {
  __bywDeferredPromise = null;
  __genreDeferredPromise = null;
}

function scheduleDeferredBecauseYouWatchedRender({
  force = false,
  seq = __deferredHomeSectionSeq,
  indexPage = null,
} = {}) {
  if (force) {
    clearPersonalDeferredPromises();
    invalidatePersonalManagedQueue();
    prcWarn("BYW:force-reset", { force, seq });
  }
  if (__bywDeferredPromise) {
    prcLog("BYW:reuse-existing-promise", { force, seq });
    return __bywDeferredPromise;
  }

  var resolvePage = function() (
    (indexPage.isConnected ? indexPage : null) ||
    currentIndexPage()
  );

  var run = enqueueManagedSectionRenderfunction("becauseYouWatched", () {
    try {
      prcLog("BYW:start", { force, seq });
      if (seq !== __deferredHomeSectionSeq) return false;
      if (!hasActivePersonalRecsHomeSections()) {
        prcWarn("BYW:abort:no-home-sections", { force, seq });
        return false;
      }
      renderBecauseYouWatchedAuto(resolvePage(), { force });
      prcLog("BYW:success", { force, seq });
      return true;
    } catch (e) {
      console.warn("BYW deferred render failed:", e);
      prcWarn("BYW:error", {
        force,
        seq,
        error: e.message || String(e),
      });
      setBywDone(true);
      return false;
    }
  }, {
    timeoutMs: 25000,
    force,
    reuseKey: false,
    getAnchor: function() {
      var page = resolvePage();
      var section = getScopedSection("because-you-watched--0", page);
      return section.isConnected ? section : null;
    },
    isStillValid: function() (
      seq === __deferredHomeSectionSeq &&
      hasActivePersonalRecsHomeSections()
    ),
  });

  __bywDeferredPromise = run;
  run.finallyfunction(() {
    if (__bywDeferredPromise === run) {
      __bywDeferredPromise = null;
    }
  });
  return run;
}

function scheduleDeferredGenreHubsRender({ force = false, seq = __deferredHomeSectionSeq } = {}) {
  if (force) {
    clearPersonalDeferredPromises();
    invalidatePersonalManagedQueue();
    prcWarn("GENRE:force-reset", { force, seq });
  }
  if (__genreDeferredPromise) {
    prcLog("GENRE:reuse-existing-promise", { force, seq });
    return __genreDeferredPromise;
  }

  var anchorWrap = hasActivePersonalRecsHomeSections()
    ? ensureGenreHubsShell(currentIndexPage())
    : null;

  var run = enqueueManagedSectionRenderfunction("genreHubs", () {
    try {
      prcLog("GENRE:start", { force, seq });
      if (seq !== __deferredHomeSectionSeq) return false;
      if (!hasActivePersonalRecsHomeSections()) {
        prcWarn("GENRE:abort:no-home-sections", { force, seq });
        return false;
      }
      renderGenreHubs(currentIndexPage());
      prcLog("GENRE:success", { force, seq });
      return true;
    } catch (e) {
      console.error("Genre hubs deferred render hatası:", e);
      prcWarn("GENRE:error", {
        force,
        seq,
        error: e.message || String(e),
      });
      try { __signalGenreHubsDone(); } catch {}
      return false;
    }
  }, {
    timeoutMs: 25000,
    force,
    reuseKey: false,
    getAnchor: function() {
      var wrap = anchorWrap.isConnected
        ? anchorWrap
        : ensureGenreHubsShell(currentIndexPage());
      return wrap.isConnected ? wrap : null;
    },
    isStillValid: function() (
      seq === __deferredHomeSectionSeq &&
      hasActivePersonalRecsHomeSections()
    ),
  });

  __genreDeferredPromise = run;
  run.finallyfunction(() {
    if (__genreDeferredPromise === run) {
      __genreDeferredPromise = null;
    }
  });
  return run;
}

export function lockDownScroll() {
  if (!PRC_LOCK_DOWN_SCROLL) return;
  try { document.documentElement.dataset.jmsSoftBlock = "1"; } catch {}
}

export function unlockDownScroll() {
  try { delete document.documentElement.dataset.jmsSoftBlock; } catch {}
}

function getInitialGenreLoadCount() {
  return Math.max(
    1,
    Math.max(GENRE_BATCH_SIZE, IS_MOBILE ? MOBILE_ROW_BATCH_SIZE : DESKTOP_INITIAL_GENRE_LOADS)
  );
}

function isGenreLoadTriggerNearViewport() {
  var viewportH = window.innerHeight || document.documentElement.clientHeight || 800;
  var preloadPx = Math.max(120, Number(GENRE_FIRST_SCROLL_PX) || 0);
  var arrow = GENRE_STATE._loadMoreArrow;

  if (arrow.isConnected) {
    var rect = arrow.getBoundingClientRect();
    if (rect.top <= (viewportH + preloadPx) && rect.bottom >= -preloadPx) {
      return true;
    }
  }

  var anchor = GENRE_STATE._loadMoreArrow || getManagedGenreHubSections(GENRE_STATE.hostEl || getHomeSectionsContainer(currentIndexPage()) || document).slice(-1)[0] || null;
  if (!anchor.isConnected) return false;

  var rect = anchor.getBoundingClientRect();
  return rect.bottom <= (viewportH + preloadPx);
}

function queueGenreViewportLoad(delayMs = 220) {
  if (!__genreScrollIdleAttached) return;
  if (GENRE_STATE.loading) return;
  if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres.length || 0)) {
    detachGenreScrollIdleLoader();
    return;
  }
  if (__genreScrollIdleTimer) return;
  if (!isGenreLoadTriggerNearViewport()) return;

  __genreScrollIdleTimer = setTimeoutfunction(() {
    __genreScrollIdleTimer = null;

    if (!__genreScrollIdleAttached) return;
    if (GENRE_STATE.loading) return;
    if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres.length || 0)) {
      detachGenreScrollIdleLoader();
      return;
    }
    if (!isGenreLoadTriggerNearViewport()) return;

    requestNextGenreLoad({ force: false });
  }, Math.max(60, delayMs | 0));
}

function requestNextGenreLoad({ force = false } = {}) {
  if (GENRE_STATE.loading) return;
  if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres.length || 0)) {
    detachGenreScrollIdleLoader();
    return;
  }

  var start = function() {
    if (GENRE_STATE.loading) return;
    if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres.length || 0)) {
      detachGenreScrollIdleLoader();
      return;
    }
    loadNextGenreViaArrow();
  };

  if (force) {
    GENRE_STATE.awaitingAdvance = false;
    start();
    return;
  }

  if (!GENRE_STATE.awaitingAdvance) {
    start();
    return;
  }

  if (GENRE_STATE.advancePromise) return;

  var anchor = getManagedGenreHubSections(
    GENRE_STATE.hostEl || getHomeSectionsContainer(currentIndexPage()) || document
  ).slice(-1)[0] || null;
  if (!anchor.isConnected) {
    GENRE_STATE.awaitingAdvance = false;
    start();
    return;
  }

  var gateSeq = GENRE_STATE.renderSeq;
  GENRE_STATE.advancePromise = Promise.resolve(
    waitForSectionTailAdvance(anchor, {
      timeoutMs: 25000,
      rootMargin: MANAGED_ROW_RELEASE_ROOT_MARGIN,
    })
  ).catchfunction(() {
  }).thenfunction(() {
    if (gateSeq !== GENRE_STATE.renderSeq) return;
    GENRE_STATE.awaitingAdvance = false;
    start();
  }).finallyfunction(() {
    if (gateSeq === GENRE_STATE.renderSeq) {
      GENRE_STATE.advancePromise = null;
    }
  });
}

function attachGenreScrollIdleLoader() {
  if (__genreScrollIdleAttached) return;
  if (!GENRE_STATE.hostEl || !GENRE_STATE.genres || !GENRE_STATE.genres.length) return;
  if (GENRE_STATE.nextIndex >= GENRE_STATE.genres.length) return;
  __genreScrollIdleAttached = true;

  if (!GENRE_STATE._loadMoreArrow) {
    var arrow = document.createElement('button');
    arrow.className = 'genre-load-more-arrow';
    arrow.type = 'button';
    arrow.innerHTML = faIconHtml("chevronDown");
    arrow.setAttribute(
      'aria-label',
      (labels.loadMoreGenres ||
        config.languageLabels.loadMoreGenres ||
        'Daha fazla tür göster')
    );

    GENRE_STATE._loadMoreArrow = arrow;

    arrow.addEventListenerfunction('click', (e) {
      e.preventDefault();
      e.stopPropagation();
      requestNextGenreLoad({ force: true });
    }, { passive: false });
  }

  placeGenreLoadMoreArrow();

  if (__genreArrowObserver) {
    try { __genreArrowObserver.disconnect(); } catch {}
    __genreArrowObserver = null;
  }

  if (typeof IntersectionObserver === "function") {
    __genreArrowObserver = new IntersectionObserverfunction((entries) {
      for (var ent of entries) {
        if (!ent.isIntersecting) continue;
        requestNextGenreLoad({ force: false });
        break;
      }
    }, {
      root: null,
      rootMargin: GENRE_ROOT_MARGIN,
      threshold: 0.01,
    });

    try {
      placeGenreLoadMoreArrow();
      __genreArrowObserver.observe(GENRE_STATE._loadMoreArrow);
    } catch {}
  }

  var onScroll = function() {
    queueGenreViewportLoad(220);
    scheduleGenreAutoPump(110, 0);
  };

  __genreScrollHandler = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  requestAnimationFrame(onScroll);
  setTimeout(onScroll, 180);

  setGenreArrowLoading(!!GENRE_STATE.loading);
  scheduleGenreAutoPump(80, 0);
}

function isGenreArrowNearViewport() {
  return isGenreLoadTriggerNearViewport();
}

function scheduleGenreAutoPump(delayMs = 90, retryCount = 0) {
  if (__genreAutoPumpTimer) return;
  if (!__genreScrollIdleAttached) return;
  if (GENRE_STATE.loading) return;
  if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres.length || 0)) return;

  __genreAutoPumpTimer = window.setTimeoutfunction(() {
    __genreAutoPumpTimer = null;

    if (!__genreScrollIdleAttached) return;
    if (GENRE_STATE.loading) return;
    if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres.length || 0)) {
      detachGenreScrollIdleLoader();
      return;
    }
    if (!isGenreArrowNearViewport()) {
      if (retryCount < 4) {
        scheduleGenreAutoPump(Math.min(420, Math.max(90, delayMs + 70)), retryCount + 1);
      }
      return;
    }

    requestNextGenreLoad({ force: false });
  }, Math.max(32, delayMs | 0));
}

function loadNextGenreViaArrow() {
  if (GENRE_STATE.loading) return;
  if (GENRE_STATE.nextIndex >= (GENRE_STATE.genres.length || 0)) {
    detachGenreScrollIdleLoader();
    return;
  }

  GENRE_STATE.loading = true;
  setGenreArrowLoading(true);
  lockDownScroll();

  var start = GENRE_STATE.nextIndex;
  var end = Math.min(start + GENRE_BATCH_SIZE, GENRE_STATE.genres.length);

  GENRE_STATE.nextIndex = end;

  function(() {
    for (var i = start; i < end; i++) {
      ensureGenreLoaded(i);
    }
  })().finallyfunction(() {
    GENRE_STATE.loading = false;
    setGenreArrowLoading(false);
    unlockDownScroll();

    if (GENRE_STATE.nextIndex >= GENRE_STATE.genres.length) {
      detachGenreScrollIdleLoader();
      GENRE_STATE.awaitingAdvance = false;
      __maybeSignalGenreHubsDone();
    } else {
      GENRE_STATE.awaitingAdvance = true;
      scheduleGenreAutoPump(70);
    }
  });
}

function detachGenreScrollIdleLoader() {
  if (!__genreScrollIdleAttached) return;
  __genreScrollIdleAttached = false;

  if (__genreArrowObserver) {
    try { __genreArrowObserver.disconnect(); } catch {}
    __genreArrowObserver = null;
  }

  if (GENRE_STATE._loadMoreArrow && GENRE_STATE._loadMoreArrow.parentElement) {
    try { GENRE_STATE._loadMoreArrow.parentElement.removeChild(GENRE_STATE._loadMoreArrow); } catch {}
  }
  GENRE_STATE._loadMoreArrow = null;

  if (__genreScrollIdleTimer) {
    clearTimeout(__genreScrollIdleTimer);
    __genreScrollIdleTimer = null;
  }

  if (__genreAutoPumpTimer) {
    clearTimeout(__genreAutoPumpTimer);
    __genreAutoPumpTimer = null;
  }

  if (__genreScrollHandler) {
    try {
      window.removeEventListener('scroll', __genreScrollHandler);
      window.removeEventListener('resize', __genreScrollHandler);
    } catch {}
    __genreScrollHandler = null;
  }
}

function setPrimaryCtaText(cardEl, text, isResume = false) {
  var btn =
    cardEl.querySelector('.dir-row-hero-play') ||
    cardEl.querySelector('.preview-play-button') ||
    cardEl.querySelector('.cardImageContainer .play') ||
    null;

  if (btn) {
    if (btn.classList.contains('dir-row-hero-play')) {
      var icon = findFaIcon(btn);
      btn.innerHTML = (icon ? icon.outerHTML : '') + " " + (escapeHtml(text));
    } else {
      btn.textContent = text;
    }
  }

  try { cardEl.dataset.prcResume = isResume ? '1' : '0'; } catch {}
}

function __idle(fn, timeout = 800) {
  var ric = window.requestIdleCallback;
  if (typeof ric === "function") return ric(fn, { timeout });
  return setTimeout(fn, 0);
}

function yieldManagedHomeSectionStep(timeout = IS_MOBILE ? 96 : 44) {
  return new Promisefunction((resolve) {
    __idlefunction(() resolve(), Math.max(24, timeout | 0));
  });
}

function prunePlayedCardsInRow(rowEl, userId) {
  try {
    var cards = Array.from(rowEl.querySelectorAll.('.personal-recs-card') || []);
    if (!cards.length) return;

    var ids = cards.map(function(el) el.dataset.itemId).filter(Boolean);
    if (!ids.length) return;

    var alive = filterOutPlayedIds(userId, ids);
    var aliveSet = new Set((alive || []).filter(Boolean));

    if (aliveSet.size === ids.length) return;

    for (var el of cards) {
      var id = el.dataset.itemId;
      if (id && !aliveSet.has(id)) {
        try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        try { el.remove(); } catch { try { el.parentElement.removeChild(el); } catch {} }
      }
    }

    try { triggerScrollerUpdate(rowEl); } catch {}
  } catch {}
}

function schedulePrunePlayedAfterPaint(rowEl, userId, delayMs = 380) {
  try {
    setTimeoutfunction(() {
      __idlefunction(() { prunePlayedCardsInRow(rowEl, userId); }, 1200);
    }, Math.max(0, delayMs|0));
  } catch {}
}

function applyResumeLabelsToCards(cardEls, userId) {
  var ids = cardEls
    .map(function(el) el.dataset.itemId)
    .filter(Boolean);

  if (!ids.length) return;
  var url =
    "/Users/" + (encodeURIComponent(userId)) + "/Items?" +
    "Ids=" + (encodeURIComponent(ids.join(','))) + "&Fields=UserData";

  var items = [];
  try {
    var r = makeApiRequest(url);
    items = Array.isArray(r.Items) ? r.Items : (Array.isArray(r) ? r : []);
  } catch {
    return;
  }

  var byId = new Map(items.map(function(it) [it.Id, it]));
  for (var el of cardEls) {
    var id = el.dataset.itemId;
    var it = byId.get(id);
    var isResume = hasPartialPlaybackUserData(it.UserData);
    var resumeText = (config.languageLabels.devamet || 'Sürdür');
    var playText   = (config.languageLabels.izle    || 'Oynat');
    setPrimaryCtaText(el, isResume ? resumeText : playText, isResume);
  }
}

function scheduleResumeLabels(cardEls, userId) {
  try {
    setTimeoutfunction(() __idlefunction(() applyResumeLabelsToCards(cardEls, userId), 900), 420);
  } catch {}
}

var __personalRecsBusy = false;
var   __lastMoveTS   = 0;
var __pmLast = 0;
window.addEventListenerfunction('pointermove', () {
  var now = Date.now();
  if (now - __pmLast > 80) { __pmLast = now; __lastMoveTS = now; }
}, {passive:true});
var __touchStickyOpen = false;
var __touchLastOpenTS = 0;
var __activeGenre = null;
var __currentGenreCtrl = null;
var __genreCache = new Map();
var __globalGenreHeroLoose = new Set();
var __globalGenreHeroStrict = new Set();
var TOUCH_STICKY_GRACE_MS = 1500;
var SCROLLER_BUSY_ATTR = "data-jms-scroll-active";
var SCROLLER_BUSY_IDLE_MS = 140;
var SCROLLER_BUSY_COOLDOWN_MS = 220;
var SCROLLER_BUSY_MAX_MS = 700;
function clearHeroHost(heroHost) {
  if (!heroHost) return;
  try {
    heroHost.querySelectorAll('.dir-row-hero').forEach(function(el) {
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  heroHost.innerHTML = '';
}

function mountHero(heroHost, heroItem, serverId, heroLabel, { aboveFold=false } = {}) {
  var heroItemId = resolveItemId(heroItem);
  if (!heroHost || !heroItemId) return { hero: null, changed: false };

  var existing = heroHost.querySelector('.dir-row-hero');
  var same = existing && (existing.dataset.itemId === String(heroItemId));

  if (same) {
    var lbl = existing.querySelector('.dir-row-hero-label');
    if (lbl && heroLabel) lbl.textContent = heroLabel;
    return { hero: existing, changed: false };
  }

  if (existing) {
    clearHeroHost(heroHost);
  }

  var hero = createGenreHeroCard(heroItem, serverId, heroLabel, { aboveFold });
  hero.classList.add('is-entering');
  heroHost.appendChild(hero);
  requestAnimationFramefunction(() hero.classList.remove('is-entering'));
  return { hero, changed: true };
}

function finalizeManagedImage(img) {
  if (!img) return;
  img.classList.remove("is-lqip");
  img.classList.add("__hydrated");
  img.__hydrated = true;
}

function resolveManagedImageUrl(src, fallback = "") {
  if (src && !isKnownMissingImage(src)) return src;
  if (fallback && !isKnownMissingImage(fallback)) return fallback;
  return "";
}

export function cleanupManagedImage(img) {
  if (!img) return;
  try { if (img.__jmsManagedOnLoad) img.removeEventListener("load", img.__jmsManagedOnLoad); } catch {}
  try { if (img.__jmsManagedOnError) img.removeEventListener("error", img.__jmsManagedOnError); } catch {}
  delete img.__jmsManagedOnLoad;
  delete img.__jmsManagedOnError;
}

export function setManagedImageSource(img, src, { fallback = PLACEHOLDER_URL } = {}) {
  if (!img) return;

  cleanupManagedImage(img);

  var primarySrc = resolveManagedImageUrl(src, "");
  var fallbackSrc = resolveManagedImageUrl(fallback, "");
  var nextSrc = primarySrc || fallbackSrc;

  try { img.removeAttribute("srcset"); } catch {}
  try {
    img.classList.remove("is-lqip");
    img.classList.remove("__hydrated");
  } catch {}
  img.__hydrated = false;

  if (!nextSrc) {
    finalizeManagedImage(img);
    return;
  }

  var onLoad = function() {
    cleanupManagedImage(img);
    finalizeManagedImage(img);
  };

  var onError = function() {
    cleanupManagedImage(img);
    var currentSrc = img.currentSrc || img.src || "";
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setManagedImageSource(img, fallbackSrc, { fallback: "" });
      return;
    }
    finalizeManagedImage(img);
  };

  img.__jmsManagedOnLoad = onLoad;
  img.__jmsManagedOnError = onError;
  img.addEventListener("load", onLoad, { once: true });
  img.addEventListener("error", onError, { once: true });

  if (img.src !== nextSrc) {
    img.src = nextSrc;
  } else if (img.complete) {
    if (img.naturalWidth > 0) onLoad();
    else onError();
  }
}

function makePRCKey(it) {
  var nm = String(it.Name || "")
    .normalize.('NFKD')
    .replace(/[^\p{Letter}\p{Number} ]+/gu, ' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
  var yr = it.ProductionYear
    ? String(it.ProductionYear)
    : (it.PremiereDate ? String(new Date(it.PremiereDate).getUTCFullYear() || '') : '');
   var tp = getPrcTypeToken(it.Type);
   return (tp) + "::" + (nm) + "|" + (yr);
 }

function makePRCLooseKey(it) {
  var nm = String(it.Name || "")
    .normalize.('NFKD')
    .replace(/[^\p{Letter}\p{Number} ]+/gu, ' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();

  var tp = getPrcTypeToken(it.Type);
  return (tp) + "::" + (nm);
}

function buildPosterImageUrl(item) {
  return buildPosterUrl(item, 540, 72) || buildPosterUrl(item, 120, 25) || null;
}

function shouldPreferTaglessImages(item) {
  return item.__preferTaglessImages === true;
}

function sanitizeResolvedId(value) {
  if (value == null) return null;
  var out = String(value).trim();
  if (!out || out === "undefined" || out === "null") return null;
  return out;
}

function resolveItemId(item) {
  return (
    sanitizeResolvedId(item.Id) ||
    sanitizeResolvedId(item.itemId) ||
    sanitizeResolvedId(item.id) ||
    sanitizeResolvedId(item.__posterSource.Id) ||
    sanitizeResolvedId(item.__posterSource.itemId) ||
    sanitizeResolvedId(item.__posterSource.id) ||
    sanitizeResolvedId(item.AlbumId) ||
    sanitizeResolvedId(item.ParentBackdropItemId) ||
    sanitizeResolvedId(item.ParentId) ||
    sanitizeResolvedId(item.SeriesId) ||
    null
  );
}

function resolveItemName(item) {
  return String(
    item.Name ||
    item.SeriesName ||
    item.__posterSource.Name ||
    item.__posterSource.SeriesName ||
    ""
  ).trim();
}

function primeItemIdentity(item) {
  if (!item || typeof item !== "object") return { item, itemId: null, itemName: "" };
  var itemId = resolveItemId(item);
  var itemName = resolveItemName(item);
  if (itemId && !sanitizeResolvedId(item.Id)) {
    try { item.Id = itemId; } catch {}
  }
  if (itemName && !item.Name) {
    try { item.Name = itemName; } catch {}
  }
  if (item.__posterSource && typeof item.__posterSource === "object") {
    var posterId = resolveItemId(item.__posterSource);
    if (posterId && !sanitizeResolvedId(item.__posterSource.Id)) {
      try { item.__posterSource.Id = posterId; } catch {}
    }
  }
  return { item, itemId, itemName };
}

function isRenderableGenreCardItem(item) {
  if (!item || typeof item !== "object") return false;
  var { itemId, itemName } = primeItemIdentity(item);
  if (!itemId || !itemName) return false;

  var mediaType = String(item.Type || "").trim();
  if (mediaType && !["Movie", "Series", "BoxSet"].includes(mediaType)) {
    return false;
  }

  return true;
}

function getPrimaryImageCandidate(item) {
  var itemId = item.Id || item.AlbumId || null;
  var tag =
    item.ImageTags.Primary ||
    item.PrimaryImageTag ||
    item.AlbumPrimaryImageTag ||
    null;
  if (!itemId || !tag) return null;
  return { itemId, imageType: "Primary", tag };
}

function getThumbImageCandidate(item) {
  var itemId = item.Id || null;
  var tag = item.ImageTags.Thumb || item.ThumbImageTag || null;
  if (!itemId || !tag) return null;
  return { itemId, imageType: "Thumb", tag, aspectRatio: 16 / 9 };
}

function getBackdropImageCandidate(item) {
  var itemId = item.ParentBackdropItemId || item.Id || null;
  var tag =
    (Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags[0]) ||
    (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0]) ||
    item.BackdropImageTag ||
    item.ImageTags.Backdrop ||
    null;
  if (!itemId || !tag) return null;
  return { itemId, imageType: "Backdrop", tag, aspectRatio: 16 / 9 };
}

function getPosterLikeImageCandidate(item) {
  return (
    getPrimaryImageCandidate(item) ||
    getThumbImageCandidate(item) ||
    getBackdropImageCandidate(item) ||
    null
  );
}

function buildCandidateImageUrl(item, candidate, height = 540, quality = 72, { omitTag = false } = {}) {
  if (!candidate.itemId || !candidate.imageType) return null;
  var skipTag = omitTag || shouldPreferTaglessImages(item);
  var parts = [];

  if (!skipTag && candidate.tag) parts.push("tag=" + (encodeURIComponent(candidate.tag)));
  if (candidate.imageType === "Primary") {
    parts.push("maxHeight=" + (height));
  } else {
    var aspectRatio = Number(candidate.aspectRatio) || (16 / 9);
    parts.push("maxWidth=" + (Math.max(96, Math.round(height * aspectRatio))));
  }
  parts.push("quality=" + (quality));
  parts.push("EnableImageEnhancers=false");

  return withServer("/Items/" + (candidate.itemId) + "/Images/" + (candidate.imageType) + "?" + (parts.join("&")));
}

function buildLogoUrl(item, width = 220, quality = 80) {
  if (!item) return null;

  var tag =
    (item.ImageTags && (item.ImageTags.Logo || item.ImageTags.logo || item.ImageTags.LogoImageTag)) ||
    item.LogoImageTag ||
    null;

  if (!tag) return null;

  var omitTag = shouldPreferTaglessImages(item);
  var parts = [];
  if (!omitTag) parts.push("tag=" + (encodeURIComponent(tag)));
  parts.push("maxWidth=" + (width));
  parts.push("quality=" + (quality));
  parts.push("EnableImageEnhancers=false");
  var url = "/Items/" + (item.Id) + "/Images/Logo?" + (parts.join("&"));
  return withServer(url);
}

function buildBackdropUrl(item, width = "auto", quality = 90) {
  if (!item) return null;
  var candidate = getBackdropImageCandidate(item);
  if (!candidate) return null;

  var omitTag = shouldPreferTaglessImages(item);
  var parts = [];
  if (!omitTag && candidate.tag) parts.push("tag=" + (encodeURIComponent(candidate.tag)));
  parts.push("maxWidth=" + (width));
  parts.push("quality=" + (quality));
  parts.push("EnableImageEnhancers=false");
  var url = "/Items/" + (candidate.itemId) + "/Images/Backdrop?" + (parts.join("&"));
  return withServer(url);
}

function buildBackdropImageUrl(item) {
  return buildBackdropUrl(item, 1920, 80) || buildBackdropUrl(item, 420, 25) || buildPosterImageUrl(item) || null;
}

function hardWipeHoverModalDom() {
  var modal = document.querySelector('.video-preview-modal');
  if (!modal) return;
  try { modal.dataset.itemId = ""; } catch {}
  modal.querySelectorAll('img').forEach(function(img) {
    try { img.removeAttribute('src'); img.removeAttribute('srcset'); } catch {}
  });
  modal.querySelectorAll('[data-field="title"],[data-field="subtitle"],[data-field="meta"],[data-field="genres"]').forEach(function(el) {
    el.textContent = '';
  });
  try {
    var matchBtn = modal.querySelector('.preview-match-button');
    if (matchBtn) {
      matchBtn.textContent = '';
      matchBtn.style.display = 'none';
    }
  } catch {}
  try {
    var btns = modal.querySelector('.preview-buttons');
    if (btns) {
      btns.style.opacity = '0';
      btns.style.pointerEvents = 'none';
    }
    var playBtn = modal.querySelector('.preview-play-button');
    if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    var favBtn = modal.querySelector('.preview-favorite-button');
    if (favBtn) {
      favBtn.classList.remove('favorited');
      favBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    }
    var volBtn = modal.querySelector('.preview-volume-button');
    if (volBtn) volBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
  } catch {}

}

function currentIndexPage() {
  return document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)") || document.body;
}

function getHomeSectionsContainer(indexPage) {
  var scopedContainer = indexPage.querySelector.(".homeSectionsContainer");
  if (scopedContainer) return scopedContainer;
  if (indexPage && indexPage !== document.body) return indexPage;

  return (
    document.querySelector("#indexPage:not(.hide) .homeSectionsContainer, #homePage:not(.hide) .homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
    indexPage
  );
}

function getScopedSection(id, indexPage = currentIndexPage()) {
  if (!id) return null;
  var selector = "#" + (id);
  return indexPage.querySelector.(selector) || document.getElementById(id);
}

function getParentSection(parent, id, indexPage = currentIndexPage()) {
  if (!parent || !id) return null;
  var selector = "#" + (id);
  var localMatch =
    indexPage.querySelector.(selector) ||
    parent.querySelector.(selector) ||
    document.getElementById(id);
  return localMatch.parentElement === parent ? localMatch : null;
}

function ensureIntoHomeSections(el, indexPage, { placeAfterId } = {}) {
  if (!el) return;
  var apply = function() {
    var container = indexPage.querySelector.(".homeSectionsContainer") || (
      (!indexPage || indexPage === document.body)
        ? (
            document.querySelector("#indexPage:not(.hide) .homeSectionsContainer, #homePage:not(.hide) .homeSectionsContainer") ||
            document.querySelector(".homeSectionsContainer")
          )
        : null
    );
    if (!container) return false;

    var ref = placeAfterId ? getScopedSection(placeAfterId, indexPage) : null;
    if (ref && ref.parentElement === container) {
      insertAfter(container, el, ref);
    } else {
      appendToParent(container, el);
    }
    return true;
  };

  if (apply()) return;

  var tries = 0;
  var maxTries = 100;
  var mo = new MutationObserverfunction(() {
    tries++;
    if (apply() || tries >= maxTries) { try { mo.disconnect(); } catch {} }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  setTimeout(apply, 3000);
}

function appendToParent(parent, node) {
  if (!parent || !node) return;
  if (node.parentElement === parent && node === parent.lastElementChild) return;
  parent.appendChild(node);
}

function insertBefore(parent, node, ref) {
  if (!parent || !node) return;
  if (!ref || ref.parentElement !== parent) {
    appendToParent(parent, node);
    return;
  }
  if (node === ref) return;
  if (node.parentElement === parent && node.nextElementSibling === ref) return;
  parent.insertBefore(node, ref);
}

function insertAfter(parent, node, ref) {
  if (!parent || !node) return;
  if (ref && ref.parentElement === parent) {
    if (node === ref) return;
    if (node.parentElement === parent && node.previousElementSibling === ref) return;
    var next = ref.nextElementSibling;
    if (next) {
      if (next === node) return;
      parent.insertBefore(node, next);
    } else {
      appendToParent(parent, node);
    }
  } else {
    appendToParent(parent, node);
  }
}

function enforceOrder(homeSectionsHint) {
  var indexPage = homeSectionsHint.closest.("#indexPage, #homePage") || currentIndexPage();
  var parent = homeSectionsHint || getHomeSectionsContainer(indexPage);
  if (!parent) return;
  bindManagedSectionsBelowNative(parent);
  try { keepManagedSectionsBelowNative(parent); } catch {}
  try { parent.__jmsManagedBelowNativeSchedule.(); } catch {}
}

function placeSection(sectionEl, homeSections) {
  if (!sectionEl) return;
  var targetParent = homeSections || getHomeSectionsContainer(currentIndexPage());
  appendToParent(targetParent || document.body, sectionEl);
  enforceOrder(targetParent);
  try { ensureIntoHomeSections(sectionEl, currentIndexPage()); } catch {}
}

(function ensureGlobalTouchOutsideCloser(){
  if (window.__jmsTouchCloserBound) return;
  window.__jmsTouchCloserBound = true;
  document.addEventListenerfunction('pointerdown', (e) {
    if (!__touchStickyOpen) return;
    var inModal = e.target.closest.('.video-preview-modal');
    if (!inModal) {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  }, { passive: true });
  document.addEventListenerfunction('keydown', (e) {
    if (!__touchStickyOpen) return;
    if (e.key === 'Escape') {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  });
})();

window.addEventListenerfunction('jms:hoverTrailer:close', () {
  __touchStickyOpen = false;
  __touchLastOpenTS = 0;
}, { passive: true });
window.addEventListenerfunction('jms:hoverTrailer:closed', () {
  __touchStickyOpen = false;
  __touchLastOpenTS = 0;
}, { passive: true });

function clearEnterTimer(cardEl) {
  var t = __enterTimers.get(cardEl);
  if (t) { clearTimeout(t); __enterTimers.delete(cardEl); }
}

function isHoveringCardOrModal(cardEl) {
  try {
    var overCard  = cardEl.isConnected && cardEl.matches(':hover');
    var overModal = !!document.querySelector('.video-preview-modal:hover');
    return !!(overCard || overModal);
  } catch { return false; }
}

function schedulePostOpenGuard(cardEl, token, delay=340) {
  setTimeoutfunction(() {
    if (__openTokenMap.get(cardEl) !== token) return;
    if (!isHoveringCardOrModal(cardEl)) {
      try { safeCloseHoverModal(); } catch {}
    }
  }, delay);
}

function scheduleClosePollingGuard(cardEl, tries=6, interval=90) {
  var count = 0;
  var iid = setIntervalfunction(() {
    count++;
    if (isHoveringCardOrModal(cardEl)) { clearInterval(iid); return; }
    if (Date.now() - __lastMoveTS > 240 || count >= tries) {
      try { safeCloseHoverModal(); } catch {}
      clearInterval(iid);
    }
  }, interval);
}

function hasActiveHomePage() {
  return !!(document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)"));
}

function hasRenderablePersonalRecsContent(indexPage) {
  var section = getScopedSection("personal-recommendations", indexPage);
  if (!section) return false;
  return !!section.querySelector(
    ".personal-recs-row .personal-recs-card, .personal-recs-row .no-recommendations"
  );
}

function getBecauseYouWatchedSections(indexPage) {
  return Array.from(
    indexPage.querySelectorAll.('[id^="because-you-watched--"], #because-you-watched') || []
  ).filterfunction((section) !!section.isConnected);
}

function hasRenderableBecauseYouWatchedContent(indexPage) {
  var sections = getBecauseYouWatchedSections(indexPage);
  if (!sections.length) return false;
  return sections.somefunction((section) !!section.querySelector(
    ".byw-row .personal-recs-card, .byw-row .no-recommendations"
  ));
}

function hasReadyBecauseYouWatchedState(indexPage) {
  if (hasRenderableBecauseYouWatchedContent(indexPage)) return true;
  var sections = getBecauseYouWatchedSections(indexPage);
  return sections.length === 0 && getBywDone();
}

function hasMountedRecommendationUi(runtimeConfig, indexPage) {
  if (!indexPage) return false;

  var personalOk =
    !runtimeConfig.enablePersonalRecommendations ||
    hasRenderablePersonalRecsContent(indexPage);
  var genreOk =
    !runtimeConfig.enableGenreHubs ||
    hasRenderableGenreHubContent(getScopedSection("genre-hubs", indexPage));
  var bywOk =
    !runtimeConfig.enableBecauseYouWatched ||
    hasReadyBecauseYouWatchedState(indexPage);

  return personalOk && genreOk && bywOk;
}

function renderPersonalRecommendationsInternal(options = {}) {
  var force = options.force === true;
  if (force) {
    __deferredHomeSectionSeq += 1;
    __bywDeferredPromise = null;
    __genreDeferredPromise = null;
    prcWarn("render:force-reset-deferred", {
      force,
      seq: __deferredHomeSectionSeq,
    });
  }
  var deferredSeq = __deferredHomeSectionSeq;
  var runtimeConfig = getHomeRecommendationRuntimeConfig();
  prcLog("render:start", {
    force,
    deferredSeq,
    enablePersonalRecommendations: runtimeConfig.enablePersonalRecommendations,
    enableGenreHubs: runtimeConfig.enableGenreHubs,
    enableBecauseYouWatched: runtimeConfig.enableBecauseYouWatched,
  });
  var activeIndexPage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (
    !runtimeConfig.enablePersonalRecommendations &&
    !runtimeConfig.enableGenreHubs &&
    !runtimeConfig.enableBecauseYouWatched
  ) {
    prcLog("render:skip:disabled", { force, deferredSeq });
    clearPersonalRecsRetry();
    resetPersonalRecsAndGenreState();
    return;
  }

  if (!activeIndexPage) {
    if (!isPersonalRecsHomeRoute()) {
      prcWarn("render:skip:not-home-route", { force, deferredSeq });
      return;
    }
    var host = waitForVisibleHomeSections({
      timeout: 12000
    });
    activeIndexPage = host.page || null;
    if (!activeIndexPage) {
      prcWarn("render:retry:no-active-page-after-wait", {
        force,
        deferredSeq,
        hostPageId: host.page.id || null,
        hasContainer: !!host.container,
      });
      schedulePersonalRecsRetry(1000, options, "no-active-page-after-wait");
      return false;
    }
  }

  if (!activeIndexPage.querySelector(".homeSectionsContainer")) {
    var host = waitForVisibleHomeSections({
      timeout: 12000
    });
    activeIndexPage = host.page || activeIndexPage;
  }

  if (!activeIndexPage.querySelector(".homeSectionsContainer")) {
    __personalRecsInitDone = false;
    prcWarn("render:retry:no-homeSectionsContainer", {
      force,
      deferredSeq,
      activePageId: activeIndexPage.id || null,
    });
    schedulePersonalRecsRetry(900, options, "no-homeSectionsContainer");
    return false;
  }

  var homeSections = getHomeSectionsContainer(activeIndexPage);
  if (
    homeSections.isConnected &&
    runtimeConfig.enablePersonalRecommendations &&
    !getScopedSection("personal-recommendations", activeIndexPage)
  ) {
    try {
      waitForNativeHomeSectionStability(homeSections, {
        timeoutMs: 1800,
        stableMs: 220,
        minVisibleCount: 1,
      });
    } catch {}
  }

  if (!force && hasMountedRecommendationUi(runtimeConfig, activeIndexPage)) {
    prcLog("render:skip:already-rendered", {
      force,
      deferredSeq,
      activePageId: activeIndexPage.id || null,
    });
    clearPersonalRecsRetry();
    __personalRecsInitDone = true;
    if (runtimeConfig.enablePersonalRecommendations) {
      setPersonalRecsDone(true);
    }
    if (runtimeConfig.enableBecauseYouWatched) {
      setBywDone(true);
    }
    if (runtimeConfig.enableGenreHubs) {
      try { __signalGenreHubsDone(); } catch {}
    }
    scheduleHomeScrollerRefresh(0);
    return;
  }

  if (__personalRecsInitDone) {
    var personalOk =
      !runtimeConfig.enablePersonalRecommendations ||
      (getPersonalRecsDone() && hasRenderablePersonalRecsContent(activeIndexPage));
    var genreOk =
      !runtimeConfig.enableGenreHubs ||
      (!!window.__jmsGenreHubsDone && hasRenderableGenreHubContent(getScopedSection("genre-hubs", activeIndexPage)));
    var bywOk =
      !runtimeConfig.enableBecauseYouWatched ||
      hasReadyBecauseYouWatchedState(activeIndexPage);
    if (personalOk && genreOk && bywOk) {
      prcLog("render:skip:init-already-complete", {
        force,
        deferredSeq,
      });
      scheduleHomeScrollerRefresh(0);
      return;
    }
  }
  if (!force) {
    var hasPersonalShell = !!getScopedSection("personal-recommendations", activeIndexPage);
    var hasBywShell = getBecauseYouWatchedSections(activeIndexPage).length > 0;
    var hasGenreShell = !!getScopedSection("genre-hubs", activeIndexPage);
    var hasPartialShellOnly =
      (runtimeConfig.enablePersonalRecommendations && hasPersonalShell && !hasRenderablePersonalRecsContent(activeIndexPage)) ||
      (runtimeConfig.enableBecauseYouWatched && hasBywShell && !hasRenderableBecauseYouWatchedContent(activeIndexPage)) ||
      (runtimeConfig.enableGenreHubs && hasGenreShell && !hasRenderableGenreHubContent(getScopedSection("genre-hubs", activeIndexPage)));
    if (hasPartialShellOnly) {
      prcWarn("render:invalidate:stale-shell-only-state", {
        force,
        deferredSeq,
        hasPersonalShell,
        hasBywShell,
        hasGenreShell,
      });
      clearPersonalDeferredPromises();
      invalidatePersonalManagedQueue();
    }
  }
  __personalRecsInitDone = true;

  if (__personalRecsBusy) {
    prcWarn("render:retry:busy", {
      force,
      deferredSeq,
    });
    schedulePersonalRecsRetry(1200, options, "busy");
    return false;
  }
  __personalRecsBusy = true;

  try {
    lockDownScroll();
    try {
      var { userId, serverId } = getSessionInfo();
      ensurePrcDb(userId, serverId);
    } catch {}
    var indexPage = activeIndexPage;
    if (!indexPage) {
      __personalRecsInitDone = false;
      prcWarn("render:retry:no-index-page-inside-run", {
        force,
        deferredSeq,
      });
      schedulePersonalRecsRetry(1000, options, "no-index-page-inside-run");
      return false;
    }
    var hasHomeSections = !!(
      indexPage.querySelector(".homeSectionsContainer")
    );
    if (!hasHomeSections) {
      __personalRecsInitDone = false;
      prcWarn("render:retry:no-homeSections-inside-run", {
        force,
        deferredSeq,
        indexPageId: indexPage.id || null,
      });
      schedulePersonalRecsRetry(900, options, "no-homeSections-inside-run");
      return false;
    }

    var tasks = [];

    if (runtimeConfig.enablePersonalRecommendations) {
      var personalAlreadyReady =
        !force &&
        getPersonalRecsDone() &&
        hasRenderablePersonalRecsContent(indexPage);

      if (!personalAlreadyReady) {
        setPersonalRecsDone(false);
      }
      var personalCardCount = getPersonalRecsCardCount();
      if (!personalAlreadyReady) {
        try {
          waitForManagedHomeRowRelease({
            timeoutMs: 25000,
            rootMargin: MANAGED_ROW_RELEASE_ROOT_MARGIN,
          });
        } catch {}
      }
      var section = ensurePersonalRecsContainer(indexPage);
      try { registerManagedHomeRowAnchor(section); } catch {}
      var row = section.querySelector.(".personal-recs-row") || null;
      if (row && !personalAlreadyReady) {
        tasks.pushfunction(enqueueManagedSectionRender("personalRecommendations", () {
          try {
            prcLog("PERSONAL:queue:start", {
              force,
              seq: deferredSeq,
            });
            if (deferredSeq !== __deferredHomeSectionSeq) return;
            if (!row.isConnected || !hasActivePersonalRecsHomeSections()) {
              prcWarn("PERSONAL:abort:gate-invalidated", {
                force,
                seq: deferredSeq,
              });
              return;
            }
            if (!row.dataset.mounted || row.childElementCount === 0) {
              row.dataset.mounted = "1";
              setupScroller(row);
            }
            var { userId, serverId } = getSessionInfo();
            var recommendations = fetchPersonalRecommendations(
              userId,
              personalCardCount,
              MIN_RATING,
              { force }
            );
            renderRecommendationCards(row, recommendations, serverId);
            setPersonalRecsDone(true);
            schedulePrunePlayedAfterPaint(row, userId, 360);
          } catch (e) {
            console.error("Kişisel öneriler alınırken hata:", e);
            setPersonalRecsDone(true);
          }
        }, {
          timeoutMs: 25000,
          force,
          reuseKey: false,
          getAnchor: function() section.isConnected ? section : null,
          isStillValid: function() (
            deferredSeq === __deferredHomeSectionSeq &&
            row.isConnected &&
            hasActivePersonalRecsHomeSections()
          ),
        }));
      } else if (personalAlreadyReady) {
        setPersonalRecsDone(true);
      }
    }

    if (runtimeConfig.enableBecauseYouWatched) {
      var bywAlreadyReady =
        !force &&
        getBywDone() &&
        hasReadyBecauseYouWatchedState(indexPage);
      if (!bywAlreadyReady) {
        setBywDone(false);
        tasks.push(scheduleDeferredBecauseYouWatchedRender({
          force,
          seq: deferredSeq,
          indexPage,
        }));
      } else {
        setBywDone(true);
      }
    }

    if (runtimeConfig.enableGenreHubs) {
      var genreAlreadyReady =
        !force &&
        window.__jmsGenreHubsDone === true &&
        hasRenderableGenreHubContent(getScopedSection("genre-hubs", indexPage));
      if (!genreAlreadyReady) {
        __resetGenreHubsDoneSignal();
        try { window.__jmsGenreFirstReady = false; } catch {}
        tasks.push(scheduleDeferredGenreHubsRender({ force, seq: deferredSeq }));
      } else {
        try { __signalGenreHubsDone(); } catch {}
      }
    }

    prcLog("render:deferred-sections-scheduled", {
      force,
      deferredSeq,
      personalTaskCount: tasks.length,
      enableBecauseYouWatched: runtimeConfig.enableBecauseYouWatched,
      enableGenreHubs: runtimeConfig.enableGenreHubs,
    });

    if (tasks.length) {
      Promise.allSettled(tasks);
    }

    try {
      var hsc = getHomeSectionsContainer(indexPage);
      enforceOrder(hsc);
    } catch {}

    var personalMounted =
      !runtimeConfig.enablePersonalRecommendations ||
      hasRenderablePersonalRecsContent(indexPage);
    var bywMounted =
      !runtimeConfig.enableBecauseYouWatched ||
      hasReadyBecauseYouWatchedState(indexPage);
    var genreMounted =
      !runtimeConfig.enableGenreHubs ||
      hasRenderableGenreHubContent(getScopedSection("genre-hubs", indexPage));
    if (personalMounted && bywMounted && genreMounted) {
      prcLog("render:success:managed-blocks-ready", {
        force,
        deferredSeq,
        indexPageId: indexPage.id || null,
        personalMounted,
        bywMounted,
        genreMounted,
      });
      clearPersonalRecsRetry();
    } else {
      prcWarn("render:retry:managed-blocks-incomplete", {
        force,
        deferredSeq,
        indexPageId: indexPage.id || null,
        personalMounted,
        bywMounted,
        genreMounted,
      });
      schedulePersonalRecsRetry(1400, options, "managed-blocks-incomplete");
    }

  } catch (error) {
    console.error("Kişisel öneriler / tür hub render hatası:", error);
    prcWarn("render:error", {
      force,
      deferredSeq,
      error: error.message || String(error),
    });
    schedulePersonalRecsRetry(1400, options, "render-error");
  } finally {
    unlockDownScroll();
    __personalRecsBusy = false;
  }
}

export function renderPersonalRecommendations(options = {}) {
  if (__personalRecsMountPromise) {
    return __personalRecsMountPromise;
  }

  var run = renderPersonalRecommendationsInternal(options);
  __personalRecsMountPromise = run;
  try {
    return run;
  } finally {
    if (__personalRecsMountPromise === run) {
      __personalRecsMountPromise = null;
    }
  }
}

function ensureBecauseContainer(indexPage, key = "0") {
  var homeSections = getHomeSectionsContainer(indexPage);
  var id = "because-you-watched--" + (key);
  var existing = getScopedSection(id, indexPage);
  if (existing) {
    var parent = homeSections || getHomeSectionsContainer(indexPage) || getHomeSectionsContainer(currentIndexPage());
    placeSection(existing, homeSections, false);
    var heroHost = existing.querySelector('.dir-row-hero-host');
    if (heroHost) {
      var showHero = isPersonalRecsHeroEnabled();
      heroHost.style.display = showHero ? '' : 'none';
      if (!showHero) clearHeroHost(heroHost);
    }
    try { enforceOrder(parent); } catch {}
    return existing;
  }

  var section = document.createElement("div");
  section.id = id;
  section.classList.add("homeSection", "personal-recs-section", "byw-section");
  section.innerHTML = "\n    <div class=\"sectionTitleContainer sectionTitleContainer-cards\">\n      <h2 class=\"sectionTitle sectionTitle-cards\">\n        <span class=\"byw-title-text\">" + ((config.languageLabels.becauseYouWatched) || (labels.becauseYouWatched) || "İzlediğin için") + "</span>\n      </h2>\n    </div>\n    <div class=\"personal-recs-scroll-wrap\">\n      <button class=\"hub-scroll-btn hub-scroll-left\" aria-label=\"" + ((config.languageLabels.scrollLeft) || "Sola kaydır") + "\" aria-disabled=\"true\">\n        <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z\"/></svg>\n      </button>\n      <div class=\"itemsContainer personal-recs-row byw-row\" role=\"list\"></div>\n      <button class=\"hub-scroll-btn hub-scroll-right\" aria-label=\"" + ((config.languageLabels.scrollRight) || "Sağa kaydır") + "\" aria-disabled=\"true\">\n        <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z\"/></svg>\n      </button>\n    </div>\n  ";
  var scrollWrap = section.querySelector('.personal-recs-scroll-wrap');
  var heroHost = document.createElement('div');
  heroHost.className = 'dir-row-hero-host';
  heroHost.style.display = isPersonalRecsHeroEnabled() ? '' : 'none';
  section.insertBefore(heroHost, scrollWrap);
  section.__heroHost = heroHost;

  var parent = homeSections || getHomeSectionsContainer(indexPage) || getHomeSectionsContainer(currentIndexPage());
  placeSection(section, homeSections, false);
  try { enforceOrder(parent); } catch {}
  return section;
}

function cleanupBecauseYouWatchedSection(section) {
  if (!section) return;
  try {
    section.querySelectorAll('.personal-recs-card, .dir-row-hero').forEach(function((el) {
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  try {
    section.querySelectorAll('.byw-row').forEach(function((row) {
      try { row.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  try {
    var heroHost = section.__heroHost || section.querySelector('.dir-row-hero-host');
    if (heroHost) clearHeroHost(heroHost);
  } catch {}
  try { section.remove(); } catch {}
}

function getEffectiveLang3() {
  var l = '';
  try { l = String(getDefaultLanguage.() || '').toLowerCase().trim(); } catch {}

  var base = l.split('-')[0];

  var map2to3 = {
    tr: 'tur',
    en: 'eng',
    de: 'deu',
    fr: 'fre',
    ru: 'rus',
    es: 'spa',
  };
  if (['tur','eng','deu','fre','rus','spa'].includes(base)) return base;
  if (map2to3[base]) return map2to3[base];
  return 'eng';
}

function getLangKeyCandidates() {
  var raw = '';
  try { raw = String(getDefaultLanguage.() || '').trim(); } catch {}

  var lower = raw.toLowerCase();
  var base = lower.split('-')[0];
  var map2to3 = { tr:'tur', en:'eng', de:'deu', fr:'fre', ru:'rus', es:'spa' };
  var three = map2to3[base] || base;
  var out = [];
  if (lower) out.push(lower);
  if (base)  out.push(base);
  if (three) out.push(three);
  out.push('eng', 'tur');

  return Array.from(new Set(out.filter(Boolean)));
}

function pickTpl(raw) {
  if (!raw) return null;

  if (typeof raw === 'string') return raw;

  if (raw && typeof raw === 'object') {
    var cand = getLangKeyCandidates();
    for (var k of cand) {
      if (raw[k]) return raw[k];
    }
  }
  return null;
}

function formatBecauseYouWatchedTitle(seedName) {
  var title = String(seedName || "").trim();
  if (!title) return "";

  var raw =
    config.languageLabels.becauseYouWatched ||
    labels.becauseYouWatched ||
    null;

  var tpl = pickTpl(raw);
  if (!tpl) {
    var cand = getLangKeyCandidates();
    if (cand.includes('de') || cand.includes('deu')) tpl = "Weil du {title} angesehen hast";
    else if (cand.includes('eng') || cand.includes('en')) tpl = "Because you watched {title}";
    else tpl = "{title} izlediğiniz için";
  }

  return String(tpl).replace("{title}", title);
}

function setBywTitle(section, seedName) {
  var el = section.querySelector.(".byw-title-text");
  if (!el) return;
  el.textContent = formatBecauseYouWatchedTitle(seedName);
}

function fetchLastPlayedSeedItems(userId, count = 1) {
  var fields = COMMON_FIELDS + ",UserData";
  try {
    var url =
      "/Users/" + (encodeURIComponent(userId)) + "/Items?" +
      "Recursive=true&IncludeItemTypes=Movie,Series&Filters=IsPlayed&" +
      "SortBy=DatePlayed,LastPlayedDate&SortOrder=Descending&Limit=" + (Math.max(1, count)) + "&Fields=" + (encodeURIComponent(fields));
    var r = makeApiRequest(url);
    var items = Array.isArray(r.Items) ? r.Items : [];
    return items.filter(function(x) x.Id);
  } catch {}

  try {
    var url =
      "/Users/" + (encodeURIComponent(userId)) + "/Items?" +
      "Recursive=true&Filters=IsResumable&MediaTypes=Video&EnableUserData=true&" +
      "SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=" + (Math.max(1, count)) + "&Fields=" + (encodeURIComponent(fields));
    var r = makeApiRequest(url);
    var items = Array.isArray(r.Items) ? r.Items : [];
    return items.filter(function(x) x.Id && isPartialPlaybackItem(x));
  } catch {}

  return [];
}

function fetchBecauseYouWatchedPool(userId, seedId, limit = 60, minRating = 0) {
  var url =
    "/Items/" + (encodeURIComponent(seedId)) + "/Similar?" +
    "UserId=" + (encodeURIComponent(userId)) + "&Limit=" + (Math.max(60, limit)) + "&Fields=" + (encodeURIComponent(COMMON_FIELDS));
  try {
    var r = makeApiRequest(url);
    var items = Array.isArray(r.Items) ? r.Items : (Array.isArray(r) ? r : []);
    return filterAndTrimByRating(items, minRating, limit);
  } catch {
    return [];
  }
}

function fetchBecauseYouWatched(userId, targetCount, minRating, seedKey, options = {}) {
  var force = options.force === true;
  var cfg = __prcCfg();
  var { serverId } = getSessionInfo();
  var st = ensurePrcDb(userId, serverId);
  var sessionScope = getPrcSessionScope(userId, serverId);

  var seedId = String(seedKey || "").trim();
  if (!seedId) return { seedId: null, items: [] };
  try {
    if (!seedId && st.db && st.scope) {
      var seed = getMeta(st.db, __metaKeyBywSeed(st.scope));
      if (seed.id) seedId = seed.id;
    }
  } catch {}

  if (!seedId) {
    var seedItem = fetchLastPlayedSeedItem(userId);
    seedId = seedItem.Id || null;
    if (seedId && st.db && st.scope) {
      try { setMeta(st.db, __metaKeyBywSeed(st.scope), { id: seedId, ts: Date.now() }); } catch {}
    }
  }
  if (!seedId) return { seedId: null, items: [] };

  var bywSessionKey = (sessionScope) + "|" + (seedId);
  if (!force) {
    var sessionItems = PRC_SESSION_BYW_ITEMS_CACHE.get(bywSessionKey);
    if (Array.isArray(sessionItems) && sessionItems.length >= targetCount) {
      return { seedId, items: sessionItems.slice(0, targetCount) };
    }
  }

  try {
    if (st.db && st.scope) {
      var cache = getMeta(st.db, __metaKeyBywScoped(st.scope, seedId));
      var ts = Number(cache.ts || 0);
      var ids = Array.isArray(cache.ids) ? cache.ids : [];
      var cacheSeed = String(cache.seedId || "");
      var fresh = ts && (Date.now() - ts) <= cfg.bywTtlMs;

      if (fresh && ids.length && cacheSeed === String(seedId)) {
        var lastShownIds = [];
        try {
          var last = getMeta(st.db, __metaKeyBywLastScoped(st.scope, seedId));
          lastShownIds = Array.isArray(last.ids) ? last.ids : [];
        } catch {}
        var lastSet = new Set(lastShownIds);

        var candidates = ids.filter(function(id) id && !lastSet.has(id));
        if (candidates.length < Math.max(6, targetCount * 2)) candidates = ids.slice();
        shuffle(candidates);

        var alive = filterOutPlayedIds(userId, candidates.slice(0, Math.min(candidates.length, cfg.maxCacheIds)));
        var itemsFromDb = dbGetItemsByIds(st.db, st.scope, alive);
        shuffle(itemsFromDb);

        var picked = filterAndTrimByRating(itemsFromDb, minRating, targetCount);
        if (picked.length >= targetCount) {
          PRC_SESSION_BYW_ITEMS_CACHE.set(bywSessionKey, picked.slice(0, targetCount));
          try { setMeta(st.db, __metaKeyBywLastScoped(st.scope, seedId), { ids: picked.map(function(x)x.Id).filter(Boolean), ts: Date.now() }); } catch {}
          return { seedId, items: picked.slice(0, targetCount) };
        }
      }
    }
  } catch {}

  var pool = fetchBecauseYouWatchedPool(
    userId,
    seedId,
    Math.max(60, targetCount * 4),
    minRating
  );

  shuffle(pool);
  var uniq = dedupeStrong(pool).slice(0, cfg.maxCacheIds);
  shuffle(uniq);

  try {
    if (st.db && st.scope && uniq.length) {
      dbWriteThroughItems(st.db, st.scope, uniq);
      setMeta(st.db, __metaKeyBywScoped(st.scope, seedId), { seedId, ids: uniq.map(function(x)x.Id).filter(Boolean), ts: Date.now() });
      setMeta(st.db, __metaKeyBywLastScoped(st.scope, seedId), {
        ids: uniq.slice(0, targetCount).map(function(x)x.Id).filter(Boolean),
        ts: Date.now()
      });
    }
  } catch {}

  PRC_SESSION_BYW_ITEMS_CACHE.set(bywSessionKey, uniq.slice(0, targetCount));

  return { seedId, items: uniq.slice(0, targetCount) };
}

function runWithConcurrency(fns, limit = 1) {
  var queue = (fns || []).slice();
  var n = Math.max(1, Math.min(limit | 0, queue.length || 1));
  var workers = new Array(n).fill(0).mapfunction(() {
    while (queue.length) {
      var fn = queue.shift();
      if (!fn) continue;
      try { fn(); } catch {}
    }
  });
  return Promise.all(workers);
}

function waitForBywSectionAdvance(section, {
  timeoutMs = IS_MOBILE ? 110 : 56,
} = {}) {
  void section;
  return yieldManagedHomeSectionStep(timeoutMs);
}

function renderBecauseYouWatchedAuto(indexPage, options = {}) {
  var force = options.force === true;
  var bywRowCount = getBywRowCount();
  var bywCardCount = getBywCardCount();
  var { userId, serverId } = getSessionInfo();
  var sessionScope = getPrcSessionScope(userId, serverId);
  var seeds = (!force ? PRC_SESSION_BYW_SEEDS_CACHE.get(sessionScope) : null) || null;

  if (!Array.isArray(seeds) || seeds.length < bywRowCount) {
    var seedsRaw = fetchLastPlayedSeedItems(userId, Math.max(1, bywRowCount * 2));
    shuffleCrypto(seedsRaw);
    var seen = new Set();
    seeds = [];
    for (var it of seedsRaw) {
      var id = it.Id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      seeds.push(it);
      if (seeds.length >= bywRowCount) break;
    }
    PRC_SESSION_BYW_SEEDS_CACHE.set(sessionScope, seeds.slice());
  }

  if (!seeds.length) {
    for (var section of getBecauseYouWatchedSections(indexPage)) {
      cleanupBecauseYouWatchedSection(section);
    }
    scheduleHomeScrollerRefresh(0);
    setBywDone(true);
    return;
  }

  var activeSectionIds = new Setfunction(seeds.map((_, index) "because-you-watched--" + (index))
  );
  for (var section of getBecauseYouWatchedSections(indexPage)) {
    var sectionId = String(section.id || "").trim();
    if (!activeSectionIds.has(sectionId)) {
      cleanupBecauseYouWatchedSection(section);
    }
  }

  var lastRenderedSection = null;
  for (var i = 0; i < seeds.length; i++) {
    try {
      waitForManagedHomeRowRelease({
        anchor: lastRenderedSection.isConnected ? lastRenderedSection : null,
        timeoutMs: 25000,
        rootMargin: MANAGED_ROW_RELEASE_ROOT_MARGIN,
      });
    } catch {}

    var seed = seeds[i];
    var seedId = seed.Id;
    var seedName = seed.Name || "";
    var section = ensureBecauseContainer(indexPage, String(i));
    try { registerManagedHomeRowAnchor(section); } catch {}
    setBywTitle(section, seedName);
    var row = section.querySelector(".byw-row");
    if (!row) continue;
    if (!row.dataset.mounted || row.childElementCount === 0) {
      row.dataset.mounted = "1";
      setupScroller(row);
    }
    var showHero = isPersonalRecsHeroEnabled();
    var fetchCount = showHero
      ? Math.min(UNIFIED_ROW_ITEM_LIMIT, bywCardCount + 1)
      : bywCardCount;
    var { items } = fetchBecauseYouWatched(userId, fetchCount, MIN_RATING, seedId, { force });
    clearRowWithCleanup(row);
    if (!items || !items.length) {
      cleanupBecauseYouWatchedSection(section);
      continue;
    }

    var heroItem = showHero ? (items[0] || null) : null;
    var rowItems = showHero
      ? items.slice(1, 1 + bywCardCount)
      : items.slice(0, bywCardCount);
    if (!rowItems.length) rowItems = items.slice(0, bywCardCount);

    try {
      var heroHost = section.__heroHost || section.querySelector('.dir-row-hero-host');
      if (heroHost) {
        heroHost.style.display = showHero ? '' : 'none';
        if (!showHero) {
          clearHeroHost(heroHost);
        } else {
          if (resolveItemId(heroItem)) {
            var heroLabel = formatBecauseYouWatchedTitle(seedName);
            var { hero: heroEl, changed } = mountHero(heroHost, heroItem, serverId, heroLabel, { aboveFold: i === 0 });
            try {
              var backdropImg = heroEl.querySelector.('.dir-row-hero-bg');
              var RemoteTrailers =
                heroItem.RemoteTrailers ||
                heroItem.RemoteTrailerItems ||
                heroItem.RemoteTrailerUrls ||
                [];
              if (heroEl && (changed || !heroEl.querySelector('.intro-video-container'))) {
                createTrailerIframe({
                  config,
                  RemoteTrailers,
                  slide: heroEl,
                  backdropImg,
                  itemId: heroItem.Id,
                  serverId,
                  detailsUrl: getDetailsUrl(heroItem.Id, serverId),
                  detailsText: (config.languageLabels.details || labels.details || "Ayrıntılar"),
                  showDetailsOverlay: false,
                });
              }
            } catch {}
          } else {
            clearHeroHost(heroHost);
          }
        }
      }
    } catch {}

    new Promisefunction((resolve) {
      var allCards = [];
      var scrollerReady = false;
      progressivelyRenderCardRow({
        row,
        items: rowItems,
        limit: bywCardCount,
        initialCount: getProgressiveRowInitialCount(
          Math.min(rowItems.length, bywCardCount),
          { mobileCount: 2, desktopCount: 3 }
        ),
        chunkSize: getProgressiveRowChunkSize({ mobileCount: 2, desktopCount: 3 }),
        delayMs: IS_MOBILE ? 82 : 38,
        appendCard: function(item, index) {
          var card = createRecommendationCard(item, serverId, {
            aboveFold: index < (IS_MOBILE ? 2 : 3),
            sizeHint: "byw"
          });
          allCards.push(card);
          return card;
        },
        onAppend: function() {
          if (!scrollerReady) {
            setupScroller(row);
            scrollerReady = true;
          }
          triggerScrollerUpdate(row);
        },
        onComplete: function() {
          if (!scrollerReady) {
            setupScroller(row);
          }
          try { applyResumeLabelsToCards(allCards, userId); } catch {}
          triggerScrollerUpdate(row);
          resolve();
        }
      });
    });

    if (section.isConnected) {
      lastRenderedSection = section;
    }
  }
  try { enforceOrder(getHomeSectionsContainer(indexPage)); } catch {}
  scheduleHomeScrollerRefresh(0);
  setBywDone(true);
}

function ensurePersonalRecsContainer(indexPage) {
  var homeSections = getHomeSectionsContainer(indexPage);
  var existing = getScopedSection("personal-recommendations", indexPage);
  if (existing) {
    placeSection(existing, homeSections);
    return existing;
  }
  var section = document.createElement("div");
  section.id = "personal-recommendations";
  section.classList.add("homeSection", "personal-recs-section");
  section.innerHTML = "\n  <div class=\"sectionTitleContainer sectionTitleContainer-cards\">\n    <h2 class=\"sectionTitle sectionTitle-cards prc-title\">\n      <span class=\"prc-title-text\" role=\"button\" tabindex=\"0\"\n        aria-label=\"" + ((config.languageLabels.seeAll || 'Tümünü gör')) + ": " + ((config.languageLabels.personalRecommendations) || labels.personalRecommendations || "Sana Özel Öneriler") + "\">\n        " + ((config.languageLabels.personalRecommendations) || labels.personalRecommendations || "Sana Özel Öneriler") + "\n      </span>\n      <div class=\"prc-see-all\"\n           aria-label=\"" + ((config.languageLabels.seeAll) || "Tümünü gör") + "\"\n           title=\"" + ((config.languageLabels.seeAll) || "Tümünü gör") + "\">\n        " + (faIconHtml("chevronRight")) + "\n      </div>\n      <span class=\"prc-see-all-tip\">" + ((config.languageLabels.seeAll) || "Tümünü gör") + "</span>\n    </h2>\n  </div>\n\n  <div class=\"personal-recs-scroll-wrap\">\n    <button class=\"hub-scroll-btn hub-scroll-left\" aria-label=\"" + ((config.languageLabels && config.languageLabels.scrollLeft) || "Sola kaydır") + "\" aria-disabled=\"true\">\n      <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z\"/></svg>\n    </button>\n    <div class=\"itemsContainer personal-recs-row\" role=\"list\"></div>\n    <button class=\"hub-scroll-btn hub-scroll-right\" aria-label=\"" + ((config.languageLabels && config.languageLabels.scrollRight) || "Sağa kaydır") + "\" aria-disabled=\"true\">\n      <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z\"/></svg>\n    </button>\n  </div>\n";

  var t = section.querySelector('.prc-title-text');
    if (t) {
      var open = function(e) { e.preventDefault(); e.stopPropagation(); openPersonalExplorer(); };
      t.addEventListener('click', open, { passive:false });
      t.addEventListenerfunction('keydown', (e) { if (e.key === 'Enter' || e.key === ' ') open(e); });
    }
    var seeAll = section.querySelector('.prc-see-all');
    if (seeAll) {
      seeAll.addEventListenerfunction('click', (e) { e.preventDefault(); e.stopPropagation(); openPersonalExplorer(); }, { passive:false });
    }

      placeSection(section, homeSections);
      return section;
    }

function ensureGenreHubsShell(indexPage) {
  var page = indexPage || currentIndexPage();
  if (!page) return null;

  var wrap = getScopedSection("genre-hubs", page);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "genre-hubs";
    wrap.className = "jms-managed-state-wrap genre-hubs-state-wrap";
    wrap.hidden = true;
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.display = "none";
  }

  if (wrap.parentElement !== page) {
    page.appendChild(wrap);
  }
  return wrap;
}

function fetchPersonalRecommendations(userId, targetCount = null, minRating = 0, options = {}) {
  var force = options.force === true;
  var effectiveTargetCount = clampConfiguredCount(targetCount, getPersonalRecsCardCount());
  var cfg = __prcCfg();
  var cacheGoal = Math.min(
    cfg.maxCacheIds,
    Math.max(effectiveTargetCount * 12, 40)
  );
  var { serverId } = getSessionInfo();
  var sessionScope = getPrcSessionScope(userId, serverId);

  if (!force) {
    var sessionItems = PRC_SESSION_PERSONAL_CACHE.get(sessionScope);
    if (Array.isArray(sessionItems) && sessionItems.length >= effectiveTargetCount) {
      return sessionItems.slice(0, effectiveTargetCount);
    }
  }

  try {
    var st = ensurePrcDb(userId, serverId);

    if (st.db && st.scope) {
      var cache = getMeta(st.db, __metaKeyPersonal(st.scope));
      var ts = Number(cache.ts || 0);
      var ids = Array.isArray(cache.ids) ? cache.ids : [];
      var fresh = ts && (Date.now() - ts) <= cfg.personalTtlMs;

      if (fresh && ids.length) {
        var lastShownIds = [];
        try {
          var last = getMeta(st.db, __metaKeyPersonalLast(st.scope));
          lastShownIds = Array.isArray(last.ids) ? last.ids : [];
        } catch {}

        var lastSet = new Set(lastShownIds);

        var candidates = ids.filter(function(id) id && !lastSet.has(id));

        if (candidates.length < Math.max(6, effectiveTargetCount * 2)) {
          candidates = ids.slice();
        }
        shuffle(candidates);

        var sampleIds = candidates.slice(0, Math.min(candidates.length, cacheGoal));
        var aliveIds = filterOutPlayedIds(userId, sampleIds);
        var itemsFromDb = dbGetItemsByIds(st.db, st.scope, aliveIds);

        shuffle(itemsFromDb);

        var picked = filterAndTrimByRating(itemsFromDb, minRating, effectiveTargetCount);
        if (picked.length >= effectiveTargetCount) {
          PRC_SESSION_PERSONAL_CACHE.set(sessionScope, picked.slice(0, effectiveTargetCount));
          try {
            setMeta(st.db, __metaKeyPersonalLast(st.scope), {
              ids: picked.map(function(x) x.Id).filter(Boolean),
              ts: Date.now()
            });
          } catch {}
          return picked.slice(0, effectiveTargetCount);
        }
      }
    }
  } catch {}

  var requested = Math.max(effectiveTargetCount * 4, 80);
  var fallbackP = getFallbackRecommendations(userId, requested).catchfunction(()[]);
  var topGenres = getCachedUserTopGenres(3).catchfunction(()[]);
  var pool = [];

  if (topGenres && topGenres.length) {
    var byGenre = fetchUnwatchedByGenres(userId, topGenres, requested, minRating).catchfunction(()[]);
    pool = pool.concat(byGenre);
  }
  var fallback = fallbackP;
  pool = pool.concat(fallback);

  shuffle(pool);

  var seen = new Set();
  var uniq = [];

  for (var item of pool) {
    if (!item.Id) continue;

    var key = makePRCKey(item);
    if (!key || seen.has(key)) continue;

    var score = Number(item.CommunityRating);
    if (minRating > 0 && !(Number.isFinite(score) && score >= minRating)) continue;

    seen.add(key);
    uniq.push(item);

    if (uniq.length >= cacheGoal) break;
  }

  if (uniq.length < cacheGoal) {
    for (var item of pool) {
      if (!item.Id) continue;

      var key = makePRCKey(item);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      uniq.push(item);

      if (uniq.length >= cacheGoal) break;
    }
  }

  shuffle(uniq);
  var final = uniq.slice(0, effectiveTargetCount);

  try {
    var st = ensurePrcDb(userId, serverId);
    if (st.db && st.scope && final.length) {
      setMeta(st.db, __metaKeyPersonalLast(st.scope), {
        ids: final.map(function(x) x.Id).filter(Boolean),
        ts: Date.now()
      });
    }
  } catch {}

  PRC_SESSION_PERSONAL_CACHE.set(sessionScope, final.slice(0, effectiveTargetCount));

  return final;
}

function dedupeStrong(items = []) {
  var seen = new Set();
  var out = [];
  for (var it of items) {
    var k = makePRCKey(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function fetchUnwatchedByGenres(userId, genres, targetCount = 20, minRating = 0) {
  if (!genres || !genres.length) {
    var fb = getFallbackRecommendations(userId, targetCount * 3);
    return filterAndTrimByRating(fb, minRating, targetCount);
  }

  var genresParam = encodeURIComponent(genres.join("|"));
  var fields = LIGHT_FIELDS;
  var requested = Math.max(targetCount * 2, 20);
  var sort = "Random,CommunityRating,DateCreated";

  var url =
    "/Users/" + (userId) + "/Items?" +
    "IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&" +
    "Genres=" + (genresParam) + "&Fields=" + (fields) + "&" +
    "SortBy=" + (sort) + "&SortOrder=Descending&Limit=" + (requested);

  try {
    var data = makeApiRequest(url);
    var items = Array.isArray(data.Items) ? data.Items : [];
    return filterAndTrimByRating(items, minRating, targetCount);
  } catch (err) {
    console.error("Türe göre içerik alınırken hata:", err);
    var fb = getFallbackRecommendations(userId, requested);
    return filterAndTrimByRating(fb, minRating, targetCount);
  }
}

function getFallbackRecommendations(userId, limit = 20) {
  var fields = LIGHT_FIELDS;
  var url =
    "/Users/" + (userId) + "/Items?" +
    "IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&" +
    "Fields=" + (fields) + "&" +
    "SortBy=Random,CommunityRating&SortOrder=Descending&Limit=" + (limit);

  try {
    var data = makeApiRequest(url);
    return Array.isArray(data.Items) ? data.Items : [];
  } catch (err) {
    console.error("Fallback öneriler alınırken hata:", err);
    return [];
  }
}

function pickBestItemByRating(items) {
  if (!items || !items.length) return null;
  var best = null;
  var bestScore = -Infinity;
  for (var it of items) {
    if (!it) continue;
    var score = Number(it.CommunityRating);
    var s = Number.isFinite(score) ? score : 0;
    if (!best || s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return best || items[0] || null;
}

function filterAndTrimByRating(items, minRating, maxCount) {
  var seen = new Set();
  var out = [];
  for (var it of items || []) {
    if (!it || !it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    var score = Number(it.CommunityRating);
    if (minRating > 0 && !(Number.isFinite(score) && score >= minRating)) continue;
    out.push(it);
    if (out.length >= maxCount) break;
  }
  return out;
}

function clearRowWithCleanup(row) {
  if (!row) return;
  try {
    row.querySelectorAll('.personal-recs-card').forEach(function(el) {
      el.dispatchEvent(new Event('jms:cleanup'));
    });
  } catch {}
  row.innerHTML = '';
}

function cleanupRow(row) {
  if (!row) return;
  try {
    row.querySelectorAll('.personal-recs-card').forEach(function(el) {
      el.dispatchEvent(new Event('jms:cleanup'));
    });
  } catch {}
  row.innerHTML = '';
}

function getProgressiveRowInitialCount(limit, { mobileCount = 2, desktopCount = 4 } = {}) {
  var max = Math.max(0, Number(limit) || 0);
  if (!max) return 0;
  var configured = IS_MOBILE ? mobileCount : desktopCount;
  return Math.max(1, Math.min(max, configured | 0));
}

function getProgressiveRowChunkSize({ mobileCount = 2, desktopCount = 3 } = {}) {
  var configured = IS_MOBILE ? mobileCount : desktopCount;
  return Math.max(1, configured | 0);
}

export function progressivelyRenderCardRow({
  row,
  items,
  appendCard,
  limit = null,
  initialCount = null,
  chunkSize = null,
  delayMs = null,
  isCurrent = null,
  onAppend = null,
  onComplete = null,
} = {}) {
  if (!row.isConnected || !Array.isArray(items) || !items.length || typeof appendCard !== "function") {
    try { onComplete.({ rendered: 0, total: 0, aborted: false }); } catch {}
    return { cancel() {} };
  }

  var total = Math.max(0, Math.min(
    Number.isFinite(Number(limit)) ? Number(limit) : items.length,
    items.length
  ));
  if (!total) {
    try { onComplete.({ rendered: 0, total: 0, aborted: false }); } catch {}
    return { cancel() {} };
  }

  var rendered = 0;
  var cancelled = false;
  var timerId = 0;
  var idleId = 0;
  var usedIdle = false;

  var clearScheduled = function() {
    if (timerId) {
      try { clearTimeout(timerId); } catch {}
      timerId = 0;
    }
    if (idleId) {
      try {
        var cancelIdle = window.cancelIdleCallback;
        if (typeof cancelIdle === "function") {
          cancelIdle(idleId);
        }
      } catch {}
      idleId = 0;
    }
    usedIdle = false;
  };

  var isAlive = function() (
    !cancelled &&
    !!row.isConnected &&
    (typeof isCurrent !== "function" || isCurrent() === true)
  );

  var finish = function({ aborted = false } = {}) {
    clearScheduled();
    if (cancelled) return;
    cancelled = true;
    try { onComplete.({ rendered, total, aborted }); } catch {}
  };

  var appendNext = function(count) {
    if (!isAlive()) return false;
    var frag = document.createDocumentFragment();
    var appended = 0;

    while (rendered < total && appended < count) {
      var card = appendCard(items[rendered], rendered);
      rendered += 1;
      if (!card) continue;
      frag.appendChild(card);
      appended += 1;
    }

    if (!appended) return false;
    row.appendChild(frag);
    try { onAppend.({ rendered, total, appended }); } catch {}
    return true;
  };

  var pump = function() {
    clearScheduled();
    if (!isAlive()) {
      finish({ aborted: true });
      return;
    }
    if (rendered >= total) {
      finish();
      return;
    }
    var nextChunkSize = Math.max(1, chunkSize | 0);
    var appended = appendNext(nextChunkSize);
    if (!appended || rendered >= total) {
      finish({ aborted: !appended });
      return;
    }
    schedule();
  };

  var schedule = function() {
    if (!isAlive()) {
      finish({ aborted: true });
      return;
    }
    if (rendered >= total) {
      finish();
      return;
    }

    var waitMs = Math.max(16, Number(delayMs) || (IS_MOBILE ? 80 : 32));
    if (typeof window.requestIdleCallback === "function") {
      usedIdle = true;
      idleId = window.requestIdleCallbackfunction(() {
        idleId = 0;
        usedIdle = false;
        pump();
      }, { timeout: Math.max(80, waitMs) });
      return;
    }

    timerId = window.setTimeoutfunction(() {
      timerId = 0;
      pump();
    }, waitMs);
  };

  var head = Math.max(
    1,
    Math.min(total, Number.isFinite(Number(initialCount)) ? Number(initialCount) : total)
  );

  var appended = appendNext(head);
  if (!appended || rendered >= total) {
    finish({ aborted: !appended });
    return { cancel: function() finish({ aborted: true }) };
  }

  schedule();
  return {
    cancel: function() finish({ aborted: true })
  };
}

function renderRecommendationCards(row, items, serverId) {
  var personalCardCount = getPersonalRecsCardCount();
  clearRowWithCleanup(row);
  if (!items || !items.length) {
    row.innerHTML = "<div class=\"no-recommendations\">" + ((config.languageLabels.noRecommendations) || labels.noRecommendations || "Öneri bulunamadı") + "</div>";
    return;
  }

  var unique = items;
  var slice = unique;
  var allCards = [];
  var domSeen = new Set();
  var scrollerReady = false;

  progressivelyRenderCardRow({
    row,
    items: slice,
    limit: personalCardCount,
    initialCount: getProgressiveRowInitialCount(
      Math.min(slice.length, personalCardCount),
      { mobileCount: 2, desktopCount: 4 }
    ),
    chunkSize: getProgressiveRowChunkSize({ mobileCount: 2, desktopCount: 3 }),
    delayMs: IS_MOBILE ? 76 : 34,
    appendCard: function(it, index) {
      var key = makePRCKey(it);
      if (key && domSeen.has(key)) return null;
      if (key) domSeen.add(key);
      var card = createRecommendationCard(it, serverId, {
        aboveFold: index < (IS_MOBILE ? 2 : 4),
        sizeHint: "personal"
      });
      allCards.push(card);
      return card;
    },
    onAppend: function() {
      if (!scrollerReady) {
        setupScroller(row);
        scrollerReady = true;
      }
      triggerScrollerUpdate(row);
    },
    onComplete: function() {
      if (!scrollerReady) {
        setupScroller(row);
      }
      triggerScrollerUpdate(row);
      try {
        var { userId } = getSessionInfo();
        scheduleResumeLabels(allCards, userId);
      } catch {}
    }
  });
}

var LIGHT_FIELDS = [
  "Type",
  "PrimaryImageAspectRatio",
  "ImageTags",
  "PrimaryImageTag",
  "ThumbImageTag",
  "BackdropImageTags",
  "BackdropImageTag",
  "LogoImageTag",
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks"
].join(",");

var COMMON_FIELDS = [
  "Type",
  "PrimaryImageAspectRatio",
  "ImageTags",
  "PrimaryImageTag",
  "ThumbImageTag",
  "BackdropImageTags",
  "BackdropImageTag",
  "LogoImageTag",
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
  "Overview",
  "RemoteTrailers"
].join(",");

function clampText(s, max = 220) {
  var t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? (t.slice(0, max - 1) + "…") : t;
}

function formatRuntime(ticks) {
  if (!ticks) return null;
  var minutes = Math.floor(ticks / 600000000);
  if (minutes < 60) return (minutes) + "d";
  var hours = Math.floor(minutes / 60);
  var remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? (hours) + "s " + (remainingMinutes) + "d" : (hours) + "s";
}

function getRuntimeWithIcons(runtime) {
  if (!runtime) return '';
  return runtime.replace(/(\d+)s/g, "$1" + (config.languageLabels.sa || 'sa'))
  .replace(/(\d+)d/g, "$1" + (config.languageLabels.dk || 'dk'));
}

function getDetailsUrl(itemId, serverId) {
  return "#/details?id=" + (itemId) + "&serverId=" + (encodeURIComponent(serverId));
}

function buildPosterUrl(item, height = 540, quality = 72, { omitTag = false } = {}) {
  var candidate = getPosterLikeImageCandidate(item);
  return buildCandidateImageUrl(item, candidate, height, quality, { omitTag });
}

function createGenreHeroCard(item, serverId, genreName, { aboveFold = false } = {}) {
  var { itemId, itemName } = primeItemIdentity(item);
  var hero = document.createElement('div');
  hero.className = 'dir-row-hero';
  if (itemId) hero.dataset.itemId = itemId;

  var bgSrc = buildBackdropImageUrl(item);

  var logo = buildLogoUrl(item);
  var year = item.ProductionYear || '';
  var plot = clampText(item.Overview, 1200);
  var ageChip = formatOfficialRatingLabel(item.OfficialRating || '');
  var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";

  var heroMetaItems = [];
  if (ageChip) heroMetaItems.push({ text: ageChip, variant: "age" });
  if (year) heroMetaItems.push({ text: year, variant: "year" });
  if (genres) heroMetaItems.push({ text: genres, variant: "genres" });
  var metaHtml = heroMetaItems.length
    ? heroMetaItems
        .mapfunction(({ text, variant })
          "<span class=\"dir-row-hero-meta dir-row-hero-meta--" + (variant) + "\">" + (escapeHtml(text)) + "</span>"
        )
        .join("")
    : "";

  hero.innerHTML = "\n    <div class=\"dir-row-hero-bg-wrap\">\n      <img class=\"dir-row-hero-bg\"\n           alt=\"" + (escapeHtml(itemName)) + "\"\n           decoding=\"async\"\n           loading=\"" + (aboveFold ? 'eager' : 'lazy') + "\"\n           " + (aboveFold ? 'fetchpriority="high"' : '') + ">\n    </div>\n\n    <div class=\"dir-row-hero-inner\">\n      <div class=\"dir-row-hero-meta-container\">\n\n        <div class=\"dir-row-hero-label\">\n          " + (escapeHtml(genreName || "")) + "\n        </div>\n\n        ${logo ? "
          <div class="dir-row-hero-logo">
            <img src="${logo}"
                 alt="${escapeHtml(itemName)} logo"
                 decoding="async"
                 loading="lazy">
          </div>
        " : ""}\n\n        <div class=\"dir-row-hero-title\">" + (escapeHtml(itemName)) + "</div>\n\n        ${metaHtml ? "<div class="dir-row-hero-submeta">${metaHtml}</div>" : \"\"}\n\n        ${plot ? "<div class="dir-row-hero-plot">${escapeHtml(plot)}</div>" : \"\"}\n\n      </div>\n    </div>\n  ";

  try {
    var img = hero.querySelector('.dir-row-hero-bg');
    if (img) {
      setManagedImageSource(img, bgSrc, { fallback: PLACEHOLDER_URL });
    }
  } catch {}

  var openDetails = function(e) {
    try { e.preventDefault.(); e.stopPropagation.(); } catch {}
    var backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
    var originEl = hero.querySelector('.dir-row-hero-bg') || hero;
    try {
      if (!itemId) return;
      openDetailsModal({
        itemId,
        serverId,
        preferBackdropIndex: backdropIndex,
        originEl,
      });
    } catch (err) {
      console.warn("openDetailsModal failed (personal hero):", err);
    }
  };

  hero.addEventListener('click', openDetails);
  hero.tabIndex = 0;
  hero.addEventListenerfunction('keydown', (e) {
    if (e.key === 'Enter' || e.key === ' ') openDetails(e);
  });

  hero.classList.add('active');

  hero.addEventListenerfunction('jms:cleanup', () {
    detachPreviewHandlers(hero);
    try {
      var img = hero.querySelector('.dir-row-hero-bg');
      if (img) cleanupManagedImage(img);
    } catch {}
  }, { once: true });

  return hero;
}

function queueEnterAnimation(el) {
  if (!el) return el;
  el.classList.add('is-entering');
  var clear = function() {
    try { el.classList.remove('is-entering'); } catch {}
  };
  try {
    requestAnimationFramefunction(() {
      requestAnimationFrame(clear);
    });
  } catch {
    setTimeout(clear, 34);
  }
  return el;
}

export function getManagedCardTitleDisplayMode(source = null) {
  var cfg = source || getConfig.() || config || {};
  return normalizeManagedCardTitleDisplayMode(cfg.managedCardTitleDisplayMode);
}

function buildManagedCardTitleLineHtml(titleText, subtitleText = "", { maxTitleLength = 42 } = {}) {
  var safeTitle = escapeHtml(clampText(titleText, maxTitleLength));
  var safeSubtitle = escapeHtml(String(subtitleText || "").trim());
  if (!safeTitle && !safeSubtitle) return "";
  return "\n    <div class=\"prc-titleline\">\n      " + (safeTitle) + "\n      ${safeSubtitle ? "<div class="prc-subtitleline">${safeSubtitle}</div>" : \"\"}\n    </div>\n  ";
}

export function resolveManagedCardTitleRender({
  titleText = "",
  subtitleText = "",
  logoUrl = "",
  logoAltText = "",
  aboveFold = false,
  maxTitleLength = 42,
  mode = null,
} = {}) {
  var resolvedMode = normalizeManagedCardTitleDisplayMode(
    mode || getManagedCardTitleDisplayMode()
  );
  var titleHtml = buildManagedCardTitleLineHtml(titleText, subtitleText, {
    maxTitleLength,
  });
  var canRenderLogo = !!logoUrl && (
    resolvedMode === "logo" ||
    resolvedMode === "logoTitle"
  );
  var safeSubtitle = escapeHtml(String(subtitleText || "").trim());
  var safeLogoAlt = escapeHtml(String(logoAltText || titleText || "").trim());
  var logoHtml = canRenderLogo
    ? "\n      <div class=\"prc-card-logo\">\n        <img src=\"" + (escapeHtml(logoUrl)) + "\"\n          alt=\"" + (safeLogoAlt) + "\"\n          loading=\"" + (aboveFold ? "eager" : "lazy") + "\"\n          decoding=\"async\"\n          " + (aboveFold ? 'fetchpriority="high"' : "") + ">\n      </div>\n    "
    : "";

  switch (resolvedMode) {
    case "title":
      return {
        html: titleHtml,
        hasLogo: false,
      };
    case "logoTitle":
      return {
        html: canRenderLogo
          ? (logoHtml) + "${safeSubtitle ? "<div class="prc-subtitleline prc-logo-subtitle">${safeSubtitle}</div>" : \"\"}"
          : titleHtml,
        hasLogo: canRenderLogo,
      };
    case "none":
      return {
        html: "",
        hasLogo: false,
      };
    case "logo":
    default:
      return {
        html: logoHtml,
        hasLogo: canRenderLogo,
      };
  }
}

function createRecommendationCard(item, serverId, renderOptions = false) {
  var normalizedOptions = (typeof renderOptions === "object" && renderOptions !== null)
    ? renderOptions
    : { aboveFold: !!renderOptions };
  var {
    aboveFold = false,
    sizeHint = "personal"
  } = normalizedOptions;
  var { itemId, itemName } = primeItemIdentity(item);
  var card = document.createElement("div");
  card.className = "card personal-recs-card";
  queueEnterAnimation(card);
  if (itemId) card.dataset.itemId = itemId;
  card.setAttribute('data-key', makePRCKey(item));

  var posterUrlStatic = buildPosterImageUrl(item);
  var year = item.ProductionYear || "";
  var ageChip = formatOfficialRatingLabel(item.OfficialRating || "");
  var runtimeTicks = item.Type === "Series" ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  var runtime = formatRuntime(runtimeTicks);
  var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";
  var { label: typeLabel, icon: typeIcon } = getPrcCardTypeBadge(item.Type);
  var community = Number.isFinite(item.CommunityRating)
    ? "<div class=\"community-rating\" title=\"Community Rating\">⭐ " + (item.CommunityRating.toFixed(1)) + "</div>"
    : "";
  var logoUrl = buildLogoUrl(item);
  var titleRender = resolveManagedCardTitleRender({
    titleText: itemName,
    logoUrl,
    logoAltText: (itemName) + " logo",
    aboveFold,
    maxTitleLength: 42,
  });

  card.innerHTML = "\n    <div class=\"cardBox\">\n      <a class=\"cardLink\" href=\"" + (itemId ? getDetailsUrl(itemId, serverId) : '#') + "\">\n        <div class=\"cardImageContainer\">\n          <img class=\"cardImage\"\n            alt=\"" + (escapeHtml(itemName)) + "\"\n            loading=\"" + (aboveFold ? 'eager' : 'lazy') + "\"\n            decoding=\"async\"\n            " + (aboveFold ? 'fetchpriority="high"' : '') + ">\n          <div class=\"prc-top-badges\">\n            " + (community) + "\n            <div class=\"prc-type-badge\">\n              " + (faIconHtml(typeIcon, "prc-type-icon")) + "\n              " + (typeLabel) + "\n            </div>\n          </div>\n          <div class=\"prc-gradient\"></div>\n          <div class=\"prc-overlay\">\n            " + (titleRender.html) + "\n            <div class=\"prc-meta\">\n              ${ageChip ? "<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>" : \"\"}\n              ${year ? "<span class="prc-year">${year}</span><span class="prc-dot">•</span>" : \"\"}\n              ${runtime ? "<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>" : \"\"}\n            </div>\n            ${genres ? "<div class="prc-genres">${genres}</div>" : \"\"}\n          </div>\n        </div>\n      </a>\n    </div>\n  ";

  var logoImg = card.querySelector('.prc-card-logo img');
  if (logoImg) {
    logoImg.addEventListenerfunction('error', () {
      try {
        logoImg.closest('.prc-card-logo').remove();
      } catch {}
    }, { once: true });
  }

  var img = card.querySelector('.cardImage');
  try {
    var sizePreset = sizeHint === "byw"
      ? {
          mobile: '(max-width: 640px) 42vw, (max-width: 820px) 37vw, 252px',
          desktop: '(max-width: 1200px) 21vw, 252px'
        }
      : sizeHint === "genre"
        ? {
            mobile: '(max-width: 640px) 44vw, (max-width: 820px) 39vw, 276px',
            desktop: '(max-width: 1200px) 23vw, 276px'
          }
        : {
            mobile: '(max-width: 640px) 48vw, (max-width: 820px) 42vw, 300px',
            desktop: '(max-width: 1200px) 27vw, 300px'
          };
    img.setAttribute('sizes', IS_MOBILE ? sizePreset.mobile : sizePreset.desktop);
  } catch {}
  if (posterUrlStatic) {
    setManagedImageSource(img, posterUrlStatic, { fallback: PLACEHOLDER_URL });
  } else {
    try { img.style.display = 'none'; } catch {}
    var noImg = document.createElement('div');
    noImg.className = 'prc-noimg-label';
    noImg.textContent =
      (config.languageLabels && (config.languageLabels.noImage || config.languageLabels.loadingText))
      || (labels.noImage || 'Görsel yok');
    noImg.style.minHeight = '100%';
    noImg.style.height = '100%';
    noImg.style.display = 'flex';
    noImg.style.alignItems = 'center';
    noImg.style.justifyContent = 'center';
    noImg.style.textAlign = 'center';
    noImg.style.padding = '12px';
    noImg.style.fontWeight = '600';
    card.querySelector('.cardImageContainer').prepend(noImg);
  }

  var cardLink = card.querySelector(".cardLink");
  if (cardLink) {
    cardLink.addEventListenerfunction("click", (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!itemId) return;
      var hostEl = card.querySelector(".cardImageContainer");
      var backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
      try {
        openDetailsModal({
          itemId,
          serverId,
          preferBackdropIndex: backdropIndex,
          originEl: hostEl.querySelector.("img.cardImage") || hostEl || card,
          originEvent: e,
        });
      } catch (err) {
        console.warn("openDetailsModal failed (personal card):", err);
      }
    }, { passive: false });
  }

  var mode = (getConfig().globalPreviewMode === 'studioMini') ? 'studioMini' : 'modal';
  var defer = window.requestIdleCallback || function((fn)setTimeout(fn, 0));
  deferfunction(() attachPreviewByMode(card, { ...item, Id: itemId, Name: itemName }, mode));
  card.addEventListenerfunction('jms:cleanup', () {
    cleanupManagedImage(img);
    detachPreviewHandlers(card);
  }, { once: true });
  return card;
}

function cleanupScroller(row) {
  var s = row && row.__scroller;
  if (!s) {
    try { row.classList.remove("is-animating"); } catch {}
    try { row.removeAttribute(SCROLLER_BUSY_ATTR); } catch {}
    try { delete row.__jmsScrollerBusyUntil; } catch {}
    try { row.dataset.scrollerMounted = "0"; } catch {}
    return;
  }

  try { s.clearAnimCleanupTimer.(); } catch {}
  try { s.mo.disconnect.(); } catch {}
  try { s.ro.disconnect.(); } catch {}

  try { row.removeEventListener("wheel", s.onWheel); } catch {}
  try { row.removeEventListener("scroll", s.onScroll); } catch {}
  try { row.removeEventListener("scrollend", s.onScrollEnd); } catch {}
  try { row.removeEventListener("touchstart", s.onTouchStartStop); } catch {}
  try { row.removeEventListener("touchmove", s.onTouchMoveStop); } catch {}
  try { row.removeEventListener("load", s.onLoadCapture, true); } catch {}

  try { s.btnL.removeEventListener.("click", s.onClickL); } catch {}
  try { s.btnR.removeEventListener.("click", s.onClickR); } catch {}
  try { row.classList.remove("is-animating"); } catch {}
  try { row.removeAttribute(SCROLLER_BUSY_ATTR); } catch {}
  try { delete row.__jmsScrollerBusyUntil; } catch {}

  try { delete row.__scroller; } catch { row.__scroller = null; }
  try { delete row.__ro; } catch {}
  try { row.dataset.scrollerMounted = "0"; } catch {}
}

export function setupScroller(row) {
  if (row.dataset.scrollerMounted === "1") {
    var s = row.__scroller;
    var btnOk =
      !!(s && (s.btnL.isConnected || s.btnR.isConnected));
    if (btnOk) {
      requestAnimationFramefunction(() row.dispatchEvent(new Event("scroll")));
      return;
    }
    try { cleanupScroller(row); } catch {}
  }

  row.dataset.scrollerMounted = "1";

  var wrap = row.closest(".personal-recs-scroll-wrap") || row.parentElement;
  var btnL = wrap.querySelector.(".hub-scroll-left") || null;
  var btnR = wrap.querySelector.(".hub-scroll-right") || null;
  var canScroll = function() row.scrollWidth > row.clientWidth + 2;
  var prefersReducedMotion = window.matchMedia.("(prefers-reduced-motion: reduce)").matches === true;
  var supportsNativeSmoothScroll =
    typeof row.scrollTo === "function" &&
    "scrollBehavior" in document.documentElement.style;
  var scrollIdleMs = prefersReducedMotion || !supportsNativeSmoothScroll ? 40 : SCROLLER_BUSY_IDLE_MS;
  var scrollMaxMs = prefersReducedMotion || !supportsNativeSmoothScroll ? 140 : SCROLLER_BUSY_MAX_MS;
  var stepPx = function() Math.max(240, Math.floor(row.clientWidth * 0.9));
  var SNAP_EPSILON = 2;
  var maxScrollLeft = function() Math.max(0, row.scrollWidth - row.clientWidth);

  var _rafToken = null;
  var _animCleanupTimer = 0;
  var _animHardStopTimer = 0;

  var clearAnimCleanupTimer = function() {
    if (_animCleanupTimer) {
      clearTimeout(_animCleanupTimer);
      _animCleanupTimer = 0;
    }
    if (_animHardStopTimer) {
      clearTimeout(_animHardStopTimer);
      _animHardStopTimer = 0;
    }
  };

  var endProgrammaticScroll = function() {
    clearAnimCleanupTimer();
    try { row.classList.remove("is-animating"); } catch {}
    try { row.removeAttribute(SCROLLER_BUSY_ATTR); } catch {}
    row.__jmsScrollerBusyUntil = Date.now() + SCROLLER_BUSY_COOLDOWN_MS;
  };

  var armProgrammaticScroll = function() {
    clearAnimCleanupTimer();
    try { row.setAttribute(SCROLLER_BUSY_ATTR, "1"); } catch {}
    row.__jmsScrollerBusyUntil = Date.now() + scrollMaxMs + SCROLLER_BUSY_COOLDOWN_MS;
    _animCleanupTimer = window.setTimeout(endProgrammaticScroll, scrollIdleMs);
    _animHardStopTimer = window.setTimeout(endProgrammaticScroll, scrollMaxMs);
  };

  var updateButtonsNow = function() {
    var scrollable = canScroll();
    var max = maxScrollLeft();
    var atStart = row.scrollLeft <= SNAP_EPSILON;
    var atEnd = row.scrollLeft >= max - SNAP_EPSILON;
    if (btnL) {
      btnL.setAttribute("aria-disabled", scrollable ? "false" : "true");
      btnL.disabled = !scrollable;
      if (scrollable && atStart) {
        btnL.dataset.wrapTarget = "end";
      } else {
        delete btnL.dataset.wrapTarget;
      }
    }
    if (btnR) {
      btnR.setAttribute("aria-disabled", scrollable ? "false" : "true");
      btnR.disabled = !scrollable;
      if (scrollable && atEnd) {
        btnR.dataset.wrapTarget = "start";
      } else {
        delete btnR.dataset.wrapTarget;
      }
    }
  };

  var scheduleUpdate = function() {
    if (_rafToken) return;
    _rafToken = requestAnimationFramefunction(() {
      _rafToken = null;
      updateButtonsNow();
    });
  };

  var mo = new MutationObserverfunction(() scheduleUpdate());
  mo.observe(row, { childList: true });

  var onLoadCapture = function() scheduleUpdate();
  row.addEventListener("load", onLoadCapture, true);

  var scrollToPosition = function(left) {
    if (!canScroll()) return;
    armProgrammaticScroll();
    var target = Math.max(0, Math.min(maxScrollLeft(), Number(left) || 0));
    if (prefersReducedMotion || !supportsNativeSmoothScroll) {
      row.scrollLeft = target;
      scheduleUpdate();
      return;
    }
    try {
      row.scrollTo({ left: target, behavior: "smooth" });
    } catch {
      row.scrollLeft = target;
    }
    scheduleUpdate();
  };

  var scrollByStep = function(dir, evt) {
    if (!canScroll()) return;
    var fast = evt.shiftKey ? 1.35 : 1;
    var delta = stepPx() * fast * dir;
    scrollToPosition(row.scrollLeft + delta);
  };

  function doScroll(dir, evt) {
    if (!canScroll()) return;
    var max = maxScrollLeft();
    if (dir > 0 && row.scrollLeft >= max - SNAP_EPSILON) {
      scrollToPosition(0);
      return;
    }
    if (dir < 0 && row.scrollLeft <= SNAP_EPSILON) {
      scrollToPosition(max);
      return;
    }
    scrollByStep(dir, evt);
  }

  var onClickL = function(e) { e.preventDefault(); e.stopPropagation(); doScroll(-1, e); };
  var onClickR = function(e) { e.preventDefault(); e.stopPropagation(); doScroll( 1, e); };
  var blurAfterPointerClick = function(btn, e) {
    if (!btn) return;
    if ((e.detail || 0) <= 0) return;
    requestAnimationFramefunction(() { try { btn.blur(); } catch {} });
  };
  var onClickL2 = function(e) { onClickL(e); blurAfterPointerClick(btnL, e); };
  var onClickR2 = function(e) { onClickR(e); blurAfterPointerClick(btnR, e); };
  if (btnL) btnL.addEventListener("click", onClickL2);
  if (btnR) btnR.addEventListener("click", onClickR2);

  var onWheel = function(e) {
    var horizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    if (!horizontalIntent) return;
    var delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
    row.scrollLeft += delta;
    e.preventDefault();
    scheduleUpdate();
  };
  row.addEventListener("wheel", onWheel, { passive: false });

  var onTouchStartStop = function(e) { e.stopPropagation(); };
  var onTouchMoveStop = function(e) { e.stopPropagation(); };
  row.addEventListener("touchstart", onTouchStartStop, { passive: true });
  row.addEventListener("touchmove", onTouchMoveStop, { passive: true });

  var onScroll = function() {
    if (row.getAttribute.(SCROLLER_BUSY_ATTR) === "1") {
      if (_animCleanupTimer) clearTimeout(_animCleanupTimer);
      _animCleanupTimer = window.setTimeout(endProgrammaticScroll, scrollIdleMs);
      row.__jmsScrollerBusyUntil = Date.now() + scrollIdleMs + SCROLLER_BUSY_COOLDOWN_MS;
    }
    scheduleUpdate();
  };
  row.addEventListener("scroll", onScroll, { passive: true });
  var onScrollEnd = function() endProgrammaticScroll();
  if ("onscrollend" in row) {
    row.addEventListener("scrollend", onScrollEnd, { passive: true });
  }

  var ro = new ResizeObserverfunction(() scheduleUpdate());
  ro.observe(row);
  row.__scroller = {
    btnL,
    btnR,
    onClickL: onClickL2,
    onClickR: onClickR2,
    onWheel,
    onScroll,
    onScrollEnd,
    onTouchStartStop,
    onTouchMoveStop,
    ro,
    mo,
    onLoadCapture,
    clearAnimCleanupTimer
  };
  row.addEventListenerfunction("jms:cleanup", () {
    try { cleanupScroller(row); } catch {}
  }, { once: true });

  requestAnimationFramefunction(() updateButtonsNow());
  setTimeoutfunction(() updateButtonsNow(), 400);
}

function normalizeGenreKey(genre) {
  return String(genre || "").trim().toLowerCase();
}

function makeGenreHubsRenderKey(userId, serverId, genres) {
  return [
    String(serverId || ""),
    String(userId || ""),
    (genres || []).map(normalizeGenreKey).join("|"),
  ].join("::");
}

function hasRenderableGenreHubContent(wrap) {
  return getManagedGenreHubSections(GENRE_STATE.hostEl || getHomeSectionsContainer(currentIndexPage()) || document)
    .somefunction((section) !!section.querySelector(
      ".genre-row .personal-recs-card, .genre-row .no-recommendations"
    ));
}

function renderGenreHubs(indexPage) {
  try { window.__jmsGenreHubsStarted = true; } catch {}
  var homeSections = getHomeSectionsContainer(indexPage);

  var wrap = ensureGenreHubsShell(indexPage);
  var parent = homeSections || getHomeSectionsContainer(indexPage) || document.body;
  GENRE_STATE.hostEl = parent;
  enforceOrder(homeSections);

  var { userId, serverId } = getSessionInfo();
  var allGenres = getCachedGenresWeekly(userId);
  if (!allGenres || !allGenres.length) { __signalGenreHubsDone(); return; }

  var picked = pickOrderedFirstK(allGenres, getGenreRowsCount());
  if (!picked.length) { __signalGenreHubsDone(); return; }
  var renderKey = makeGenreHubsRenderKey(userId, serverId, picked);
  var sameRender =
    wrap.dataset.genreRenderKey === renderKey &&
    GENRE_STATE.wrap === wrap &&
    Array.isArray(GENRE_STATE.sections) &&
    GENRE_STATE.sections.length === picked.length &&
    GENRE_STATE.sections.some(Boolean);

  if (sameRender && hasRenderableGenreHubContent(wrap)) {
    GENRE_STATE.wrap = wrap;
    GENRE_STATE.genres = picked;
    GENRE_STATE.serverId = serverId;
    GENRE_STATE.renderSeq += 1;
    GENRE_STATE.advancePromise = null;
    GENRE_STATE.nextIndex = Math.max(
      Number(GENRE_STATE.nextIndex) || 0,
      Math.min(getManagedGenreHubSections(parent).length, picked.length)
    );
    GENRE_STATE.awaitingAdvance = GENRE_STATE.nextIndex < picked.length;

    if (GENRE_STATE.nextIndex < GENRE_STATE.genres.length) {
      drainGenreHubsSequentially(GENRE_STATE.renderSeq);
    } else {
      detachGenreScrollIdleLoader();
      __signalGenreHubsDone();
    }
    return;
  }

  if (__genreHubsBusy && wrap.dataset.genreRenderKey === renderKey) {
    return;
  }

  __genreHubsBusy = true;
  try {
    __resetGenreHubsDoneSignal();
    detachGenreScrollIdleLoader();
    try { window.__jmsGenreFirstReady = false; } catch {}
    wrap.dataset.genreRenderKey = renderKey;

    if (getManagedGenreHubSections(parent).length > 0) {
      try { abortAllGenreFetches(); } catch {}
      cleanupManagedGenreHubSections(parent);
    }
    __globalGenreHeroLoose.clear();
    __globalGenreHeroStrict.clear();

    GENRE_STATE.wrap     = wrap;
    GENRE_STATE.hostEl   = parent;
    GENRE_STATE.genres   = picked;
    GENRE_STATE.sections = new Array(picked.length);
    GENRE_STATE.nextIndex = 0;
    GENRE_STATE.loading   = false;
    GENRE_STATE.awaitingAdvance = false;
    GENRE_STATE.advancePromise = null;
    GENRE_STATE.renderSeq += 1;
    GENRE_STATE.serverId  = serverId;

    var initialLoads = Math.min(getInitialGenreLoadCount(), picked.length);
    var initialJobs = [];
    for (var i = 0; i < initialLoads; i++) {
      initialJobs.pushfunction((() {
        try {
          waitForManagedHomeRowRelease({
            timeoutMs: 25000,
            rootMargin: MANAGED_ROW_RELEASE_ROOT_MARGIN,
          });
        } catch {}
        ensureGenreLoaded(i);
        try {
          registerManagedHomeRowAnchor(GENRE_STATE.sections[i].section || null);
        } catch {}
      })());
    }
    Promise.allSettled(initialJobs);
    GENRE_STATE.nextIndex = initialLoads;

    __maybeSignalGenreHubsDone();

    if (GENRE_STATE.nextIndex < GENRE_STATE.genres.length) {
      GENRE_STATE.awaitingAdvance = false;
      drainGenreHubsSequentially(GENRE_STATE.renderSeq);
    } else {
      detachGenreScrollIdleLoader();
      __signalGenreHubsDone();
    }
  } finally {
    __genreHubsBusy = false;
  }
}

function drainGenreHubsSequentially(renderSeq = GENRE_STATE.renderSeq) {
  detachGenreScrollIdleLoader();
  try {
    GENRE_STATE.loading = true;
    while (
      renderSeq === GENRE_STATE.renderSeq &&
      GENRE_STATE.wrap.isConnected &&
      GENRE_STATE.hostEl.isConnected &&
      GENRE_STATE.nextIndex < (GENRE_STATE.genres.length || 0)
    ) {
      var index = GENRE_STATE.nextIndex;
      GENRE_STATE.nextIndex = index + 1;
      var previousSection =
        GENRE_STATE.sections[index - 1].section ||
        getManagedGenreHubSections(GENRE_STATE.hostEl || getHomeSectionsContainer(currentIndexPage()) || document).slice(-1)[0] ||
        null;
      try {
        waitForManagedHomeRowRelease({
          anchor: previousSection.isConnected ? previousSection : null,
          timeoutMs: 25000,
          rootMargin: MANAGED_ROW_RELEASE_ROOT_MARGIN,
        });
      } catch {}
      ensureGenreLoaded(index);
      try {
        registerManagedHomeRowAnchor(GENRE_STATE.sections[index].section || null);
      } catch {}

      if (
        renderSeq !== GENRE_STATE.renderSeq ||
        !GENRE_STATE.wrap.isConnected ||
        !GENRE_STATE.hostEl.isConnected
      ) {
        break;
      }

      if (GENRE_STATE.nextIndex < (GENRE_STATE.genres.length || 0)) {
        yieldManagedHomeSectionStep();
      }
    }
  } finally {
    if (renderSeq === GENRE_STATE.renderSeq) {
      GENRE_STATE.loading = false;
      GENRE_STATE.awaitingAdvance = false;
      GENRE_STATE.advancePromise = null;
      detachGenreScrollIdleLoader();
      __maybeSignalGenreHubsDone();
    }
  }
}

function ensureGenreSectionElement(idx) {
  var genres = GENRE_STATE.genres || [];
  var wrap   = GENRE_STATE.wrap;
  var serverId = GENRE_STATE.serverId;

  if (!wrap || !genres[idx]) return null;

  var rec = GENRE_STATE.sections[idx];
  if (rec && rec.section && rec.row) return rec;

  var genre = genres[idx];

  var section = document.createElement("div");
  section.id = makeManagedGenreHubSectionId(idx);
  section.className = "homeSection genre-hub-section";
  section.dataset.genreKey = normalizeGenreKey(genre);
  section.innerHTML = "\n    <div class=\"sectionTitleContainer sectionTitleContainer-cards\">\n      <h2 class=\"sectionTitle sectionTitle-cards gh-title\">\n        <span class=\"gh-title-text\" role=\"button\" tabindex=\"0\"\n          aria-label=\"" + ((config.languageLabels.seeAll || 'Tümünü gör')) + ": " + (escapeHtml(genre)) + "\">\n          " + (escapeHtml(genre)) + "\n        </span>\n        <div class=\"gh-see-all\" data-genre=\"" + (escapeHtml(genre)) + "\"\n             aria-label=\"" + ((config.languageLabels.seeAll) || "Tümünü gör") + "\"\n             title=\"" + ((config.languageLabels.seeAll) || "Tümünü gör") + "\">\n          " + (faIconHtml("chevronRight")) + "\n        </div>\n        <span class=\"gh-see-all-tip\">" + ((config.languageLabels.seeAll) || "Tümünü gör") + "</span>\n      </h2>\n    </div>\n    <div class=\"personal-recs-scroll-wrap\">\n      <button class=\"hub-scroll-btn hub-scroll-left\" aria-label=\"" + ((config.languageLabels && config.languageLabels.scrollLeft) || "Sola kaydır") + "\" aria-disabled=\"true\">\n        <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z\"/></svg>\n      </button>\n      <div class=\"itemsContainer genre-row\" role=\"list\"></div>\n      <button class=\"hub-scroll-btn hub-scroll-right\" aria-label=\"" + ((config.languageLabels && config.languageLabels.scrollRight) || "Sağa kaydır") + "\" aria-disabled=\"true\">\n        <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z\"/></svg>\n      </button>\n    </div>\n  ";

  var scrollWrap = section.querySelector('.personal-recs-scroll-wrap');
  var heroHost = document.createElement('div');
  heroHost.className = 'dir-row-hero-host';
  heroHost.style.display = isPersonalRecsHeroEnabled() ? '' : 'none';
  section.insertBefore(heroHost, scrollWrap);
  var titleBtn  = section.querySelector('.gh-title-text');
  var seeAllBtn = section.querySelector('.gh-see-all');
  if (titleBtn) {
    var open = function(e) { e.preventDefault(); e.stopPropagation(); openGenreExplorer(genre); };
    titleBtn.addEventListener('click', open, { passive: false });
    titleBtn.addEventListenerfunction('keydown', (e) { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }
  if (seeAllBtn) {
    seeAllBtn.addEventListenerfunction('click', (e) { e.preventDefault(); e.stopPropagation(); openGenreExplorer(genre); }, { passive: false });
  }

  var row = section.querySelector(".genre-row");

  placeGenreHubSection(section);
  placeGenreLoadMoreArrow();

  rec = {
  genre, section, row,
  loaded: false,
  loading: false,
  loadingPromise: null,
  seq: 0,
  serverId,
  heroHost
};
  GENRE_STATE.sections[idx] = rec;
  return rec;
}

function skipGenreSection(rec) {
  if (!rec) return;
  try {
    rec.section.querySelectorAll.('.personal-recs-card, .dir-row-hero').forEach(function((el) {
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  try {
    if (rec.heroHost) clearHeroHost(rec.heroHost);
  } catch {}
  try { rec.section.remove.(); } catch {}

  rec.section = null;
  rec.row = null;
  rec.heroHost = null;
  rec.loaded = true;
  rec.loading = false;
  rec.loadingPromise = null;
}

function ensureGenreLoaded(idx) {
  var rec = GENRE_STATE.sections[idx];
  if (!rec) rec = ensureGenreSectionElement(idx);
  if (!rec) return;

  if (rec.loaded) return;
  if (rec.loadingPromise) return rec.loadingPromise;

  rec.loading = true;
  var mySeq = ++rec.seq;

  rec.loadingPromise = function(() {
    var { genre, row, serverId, heroHost } = rec;
    var { userId } = getSessionInfo();

    try {
      var genreRowCardCount = getGenreRowCardCount();
      if (!row.dataset.mounted || row.childElementCount === 0) {
        row.dataset.mounted = "1";
        setupScroller(row);
      }
      var items = fetchItemsBySingleGenre(userId, genre, genreRowCardCount * 3, MIN_RATING);
      if (rec.seq !== mySeq) return;

      row.innerHTML = '';
      setupScroller(row);

      if (!items || !items.length) {
        skipGenreSection(rec);
        return;
      }

      var pool = dedupeStrong(items).filter(isRenderableGenreCardItem).slice();
      shuffle(pool);
      var showHero = isGenreHubsHeroEnabled();

      var best = null;
      var bestIndex = -1;
      if (showHero) {
        for (var i = 0; i < pool.length; i++) {
          var it = pool[i];
          var kLoose  = makePRCLooseKey(it);
          var kStrict = makePRCKey(it);
          if ((kLoose && __globalGenreHeroLoose.has(kLoose)) || (kStrict && __globalGenreHeroStrict.has(kStrict))) continue;
          best = it; bestIndex = i;
          if (kLoose)  __globalGenreHeroLoose.add(kLoose);
          if (kStrict) __globalGenreHeroStrict.add(kStrict);
          break;
        }
        if (!best && pool.length) {
          best = pool[0]; bestIndex = 0;
          var kLoose  = makePRCLooseKey(best);
          var kStrict = makePRCKey(best);
          if (kLoose)  __globalGenreHeroLoose.add(kLoose);
          if (kStrict) __globalGenreHeroStrict.add(kStrict);
        }
      }

      var remaining = (showHero && bestIndex >= 0)
        ? pool.filterfunction((_, i) i !== bestIndex)
        : pool.slice();

      if (heroHost) {
        heroHost.style.display = showHero ? '' : 'none';
        if (!showHero || !best) {
          clearHeroHost(heroHost);
        } else {
          var { hero: heroEl, changed } = mountHero(heroHost, best, serverId, genre, { aboveFold: idx === 0 });
          try {
            var backdropImg = heroEl.querySelector.('.dir-row-hero-bg');
            var RemoteTrailers = best.RemoteTrailers || best.RemoteTrailerItems || best.RemoteTrailerUrls || [];
            if (heroEl && (changed || !heroEl.querySelector('.intro-video-container'))) {
              createTrailerIframe({
                config,
                RemoteTrailers,
                slide: heroEl,
                backdropImg,
                itemId: best.Id,
                serverId,
                detailsUrl: getDetailsUrl(best.Id, serverId),
                detailsText: (config.languageLabels.details || labels.details || "Ayrıntılar"),
                showDetailsOverlay: false,
              });
            }
          } catch {}
        }
      }

      if (remaining.length < MIN_GENRE_VISIBLE_CARD_COUNT) {
        skipGenreSection(rec);
        return;
      }

      var unique = remaining.slice(0, genreRowCardCount);
      var scrollerReady = false;

      new Promisefunction((resolve) {
        progressivelyRenderCardRow({
          row,
          items: unique,
          limit: genreRowCardCount,
          initialCount: getProgressiveRowInitialCount(
            Math.min(unique.length, genreRowCardCount),
            { mobileCount: 2, desktopCount: 4 }
          ),
          chunkSize: getProgressiveRowChunkSize({ mobileCount: 2, desktopCount: 3 }),
          delayMs: IS_MOBILE ? 78 : 34,
          isCurrent: function() rec.seq === mySeq,
          appendCard: function(item, index) createRecommendationCard(item, serverId, {
            aboveFold: index < (IS_MOBILE ? 2 : 4),
            sizeHint: "genre"
          }),
          onAppend: function() {
            if (!scrollerReady) {
              setupScroller(row);
              scrollerReady = true;
            }
            triggerScrollerUpdate(row);
          },
          onComplete: function({ aborted = false } = {}) {
            if (rec.seq === mySeq && !aborted) {
              if (!scrollerReady) {
                setupScroller(row);
              }
              rec.loaded = true;
              if (idx === 0 && !window.__jmsGenreFirstReady) {
                window.__jmsGenreFirstReady = true;
                try { document.dispatchEvent(new Event("jms:genre-first-ready")); } catch {}
              }
              triggerScrollerUpdate(row);
            }
            resolve();
          }
        });
      });

    } catch (err) {
      if (rec.seq !== mySeq) return;
      console.warn('Genre hub load failed:', rec.genre, err);
      skipGenreSection(rec);
    } finally {
      if (rec.seq === mySeq) {
        rec.loading = false;
        rec.loadingPromise = null;
      }
    }
  })();

  return rec.loadingPromise;
}

function triggerScrollerUpdate(row) {
  if (!row) return;
  try { row.dispatchEvent(new Event('scroll')); } catch {}
  if (row.__tsuRaf) return;
  row.__tsuRaf = requestAnimationFramefunction(() {
    row.__tsuRaf = 0;
    try { row.dispatchEvent(new Event('scroll')); } catch {}
  });
}

function fetchItemsBySingleGenre(userId, genre, limit = 30, minRating = 0) {
  var genreRenderableMin = getGenreRenderableMin();
  try {
    var { serverId } = getSessionInfo();
    var st = ensurePrcDb(userId, serverId);
    var cfg = __prcCfg();
    var scope = st.scope || makeScope({ userId, serverId });
    var memKey = (scope) + "|" + (normalizeGenreKey(genre));
    var mem = __genreCache.get(memKey);
    if (mem.ts && Array.isArray(mem.items) && (Date.now() - mem.ts) <= cfg.genreTtlMs) {
      var pickedFromMem = filterAndTrimByRating(mem.items, minRating, limit);
      if (pickedFromMem.length >= Math.min(limit, genreRenderableMin)) {
        return pickedFromMem.slice(0, limit);
      }
    }

    if (st.db && st.scope) {
      var key = __metaKeyGenre(st.scope, genre);
      var cache = getMeta(st.db, key);
      var ts = Number(cache.ts || 0);
      var ids = Array.isArray(cache.ids) ? cache.ids : [];
      var fresh = ts && (Date.now() - ts) <= cfg.genreTtlMs;
      if (fresh && ids.length) {
        var aliveIds = filterOutPlayedIds(userId, ids);
        var itemsFromDb = dbGetItemsByIds(st.db, st.scope, aliveIds);
        if (itemsFromDb.length) {
          __genreCache.set(memKey, { ts: Date.now(), items: itemsFromDb.slice() });
        }
        var picked = filterAndTrimByRating(itemsFromDb, minRating, limit);
        if (picked.length >= Math.min(limit, genreRenderableMin)) {
          return picked.slice(0, limit);
        }
      }
    }
  } catch {}
  var fields = COMMON_FIELDS;
  var g = encodeURIComponent(genre);
  var url =
    "/Users/" + (userId) + "/Items?" +
    "IncludeItemTypes=Movie,Series&Recursive=true&Filters=IsUnplayed&" +
    "Genres=" + (g) + "&Fields=" + (fields) + "&" +
    "SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=" + (Math.max(60, limit * 3));

  var ctrl = new AbortController();
  __genreFetchCtrls.add(ctrl);
  try {
    var data = makeApiRequest(url, { signal: ctrl.signal });
    var items = Array.isArray(data.Items) ? data.Items : [];
    var picked = filterAndTrimByRating(items, minRating, limit);

    try {
      var { serverId } = getSessionInfo();
      var st = ensurePrcDb(userId, serverId);
      var cfg = __prcCfg();
      var scope = st.scope || makeScope({ userId, serverId });
      var memKey = (scope) + "|" + (normalizeGenreKey(genre));
      if (items.length) {
        __genreCache.set(memKey, { ts: Date.now(), items: items.slice() });
      }
      if (st.db && st.scope && items.length) {
        dbWriteThroughItems(st.db, st.scope, items);
        var ids = items.map(function(x) x.Id).filter(Boolean).slice(0, cfg.maxCacheIds);
        setMeta(st.db, __metaKeyGenre(st.scope, genre), { ids, ts: Date.now() });
      }
    } catch {}

    return picked;
  } catch (e) {
    if (e.name !== 'AbortError') console.error("fetchItemsBySingleGenre hata:", e);
    return [];
  } finally {
    __genreFetchCtrls.delete(ctrl);
  }
}

var __genreFetchCtrls = new Set();
function abortAllGenreFetches(){
  for (var c of __genreFetchCtrls) { try { c.abort(); } catch {} }
  __genreFetchCtrls.clear();
}

function pickOrderedFirstK(allGenres, k) {
  var order = Array.isArray(config.genreHubsOrder) && config.genreHubsOrder.length
    ? config.genreHubsOrder
    : allGenres;
  var setAvail = new Set(allGenres.map(function(g) String(g).toLowerCase()));
  var picked = [];
  for (var g of order) {
    if (!g) continue;
    if (setAvail.has(String(g).toLowerCase())) {
      picked.push(g);
      if (picked.length >= k) break;
    }
  }
  if (picked.length < k) {
    for (var g of allGenres) {
      if (picked.includes(g)) continue;
      picked.push(g);
      if (picked.length >= k) break;
    }
  }
  return picked;
}

function shuffleCrypto(arr) {
  if (!Array.isArray(arr)) return arr;
  var a = arr;
  var rnd = new Uint32Array(1);

  for (var i = a.length - 1; i > 0; i--) {
    var j;
    if (window.crypto.getRandomValues) {
      window.crypto.getRandomValues(rnd);
      j = rnd[0] % (i + 1);
    } else {
      j = (Math.random() * (i + 1)) | 0;
    }
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getCachedGenresWeekly(userId) {
  var weekKey = __isoWeekKey();

  try {
    var { serverId } = getSessionInfo();
    var st = ensurePrcDb(userId, serverId);
    var scope = st.scope || makeScope({ userId, serverId });

    if (st.db && scope) {
      var cache = getMeta(st.db, __metaKeyGenresList(scope));
      var cachedWeek = String(cache.weekKey || "");
      var cachedList = Array.isArray(cache.genres) ? cache.genres : [];
      if (cachedWeek === weekKey && cachedList.length) {
        return cachedList;
      }
    }

    var lsKey = "prc:genresListLS:" + (scope);
    try {
      var raw = localStorage.getItem(lsKey);
      if (raw) {
        var obj = JSON.parse(raw);
        var cachedWeek = String(obj.weekKey || "");
        var cachedList = Array.isArray(obj.genres) ? obj.genres : [];
        if (cachedWeek === weekKey && cachedList.length) {
          return cachedList;
        }
      }
    } catch {}

    var list = fetchAllGenres(userId);
    var genres = uniqueNormalizedGenres(list).slice(0, 400);
    var payload = { weekKey, genres, ts: Date.now() };

    if (st.db && scope) {
      try { setMeta(st.db, __metaKeyGenresList(scope), payload); } catch {}
    }
    try { localStorage.setItem(lsKey, JSON.stringify(payload)); } catch {}

    return genres;
  } catch (e) {
    console.warn("Weekly genre cache failed, falling back to live fetch:", e);
    try {
      var list = fetchAllGenres(userId);
      return uniqueNormalizedGenres(list);
    } catch {
      return [];
    }
  }
}

function fetchAllGenres(userId) {
  var url =
    "/Items/Filters?UserId=" + (encodeURIComponent(userId)) +
    "&IncludeItemTypes=Movie,Series&Recursive=true";

  var r = makeApiRequest(url);
  var genres = Array.isArray(r.Genres) ? r.Genres : [];
  return genres.map(function(g) String(g || "").trim()).filter(Boolean);
}

function uniqueNormalizedGenres(list) {
  var seen = new Set();
  var out = [];
  for (var g of list) {
    var k = g.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(g); }
  }
  return out;
}

function safeOpenHoverModal(itemId, anchorEl) {
  if (typeof window.tryOpenHoverModal === 'function') {
    try { window.tryOpenHoverModal(itemId, anchorEl, { bypass: true }); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.open === 'function') {
    try { window.__hoverTrailer.open({ itemId, anchor: anchorEl, bypass: true }); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent('jms:hoverTrailer:open', { detail: { itemId, anchor: anchorEl, bypass: true }}));
}

function safeCloseHoverModal() {
  if (typeof window.closeHoverPreview === 'function') {
    try { window.closeHoverPreview(); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.close === 'function') {
    try { window.__hoverTrailer.close(); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent('jms:hoverTrailer:close'));
  try { hardWipeHoverModalDom(); } catch {}
}

var CACHE_ITEM_FIELDS = [
  "Id","Name","Type","ImageTags","PrimaryImageTag",
  "CommunityRating","OfficialRating","ProductionYear","RunTimeTicks","CumulativeRunTimeTicks",
  "Genres",
  "RemoteTrailers"
];

function toSlimItem(it){
  if (!it) return null;
  var slim = {};
  for (var k of CACHE_ITEM_FIELDS) slim[k] = it[k];
  if (!slim.Type) {
    if (it.Type) {
      slim.Type = it.Type;
    } else if (it.Series || it.SeriesId || it.SeriesName) {
      slim.Type = "Series";
    } else {
      slim.Type = "Movie";
    }
  }
  if (!slim.Name) {
    slim.Name = it.SeriesName || it.Name || "";
    if (!slim.ProductionYear && it.PremiereDate) {
  var y = new Date(it.PremiereDate).getUTCFullYear();
  if (y) slim.ProductionYear = y;
}
  }
  return slim;
}
function toSlimList(list){ return (list||[]).map(toSlimItem).filter(Boolean); }

function attachHoverTrailer(cardEl, itemLike) {
  var itemId = resolveItemId(itemLike) || sanitizeResolvedId(cardEl.dataset.itemId);
  if (!cardEl || !itemId) return;
  if (!__enterSeq.has(cardEl)) __enterSeq.set(cardEl, 0);

  var onEnter = function(e) {
    var isTouch = e.pointerType === 'touch';
    var until = __cooldownUntil.get(cardEl) || 0;
    if (Date.now() < until) return;

    __hoverIntent.set(cardEl, true);
    clearEnterTimer(cardEl);

    var seq = (__enterSeq.get(cardEl) || 0) + 1;
    __enterSeq.set(cardEl, seq);

    var timer = setTimeoutfunction(() {
      if ((__enterSeq.get(cardEl) || 0) !== seq) return;
      if (!__hoverIntent.get(cardEl)) return;
      if (!isTouch) {
        if (!cardEl.isConnected || !cardEl.matches(':hover')) return;
      }
      try { document.dispatchEvent(new Event('closeAllMiniPopovers')); } catch {}

      var token = (Date.now() ^ Math.random()*1e9) | 0;
      __openTokenMap.set(cardEl, token);

      try { hardWipeHoverModalDom(); } catch {}
      safeOpenHoverModal(itemId, cardEl);

      if (isTouch) {
        __touchStickyOpen = true;
        __touchLastOpenTS = Date.now();
      }
      if (!isTouch) schedulePostOpenGuard(cardEl, token, 340);
    }, getOpenHoverDelay());

    __enterTimers.set(cardEl, timer);
  };

  var onLeave = function(e) {
    var isTouch = e.pointerType === 'touch';
    __hoverIntent.set(cardEl, false);
    clearEnterTimer(cardEl);
    __enterSeq.set(cardEl, (__enterSeq.get(cardEl) || 0) + 1);
    if (isTouch && __touchStickyOpen) {
      if (Date.now() - __touchLastOpenTS <= TOUCH_STICKY_GRACE_MS) {
        return;
      } else {
        __touchStickyOpen = false;
      }
    }

    var rt = e.relatedTarget || null;
    var goingToModal = !!(rt && (rt.closest ? rt.closest('.video-preview-modal') : null));
    if (goingToModal) return;

    try { safeCloseHoverModal(); } catch {}
    try { hardWipeHoverModalDom(); } catch {}
    __cooldownUntil.set(cardEl, Date.now() + REOPEN_COOLDOWN_MS);
    scheduleClosePollingGuard(cardEl, 6, 90);
  };
  cardEl.addEventListener('pointerenter', onEnter, { passive: true });
  var onDown = function(e) { if (e.pointerType === 'touch') onEnter(e); };
  cardEl.addEventListener('pointerdown', onDown, { passive: true });

  cardEl.addEventListener('pointerleave', onLeave,  { passive: true });
  __boundPreview.set(cardEl, { mode: 'modal', onEnter, onLeave, onDown });
}


function detachPreviewHandlers(cardEl) {
  var rec = __boundPreview.get(cardEl);
  if (!rec) return;
  cardEl.removeEventListener('pointerenter', rec.onEnter);
  cardEl.removeEventListener('pointerleave', rec.onLeave);
  if (rec.onDown) cardEl.removeEventListener('pointerdown', rec.onDown);
  clearEnterTimer(cardEl);
  __hoverIntent.delete(cardEl);
  __openTokenMap.delete(cardEl);
  __boundPreview.delete(cardEl);
}

function attachPreviewByMode(cardEl, itemLike, mode) {
  detachPreviewHandlers(cardEl);
  var itemId = resolveItemId(itemLike) || sanitizeResolvedId(cardEl.dataset.itemId);
  if (!itemId) return;
  var normalizedItem = { ...(itemLike || {}), Id: itemId, Name: resolveItemName(itemLike) };
  if (mode === 'studioMini') {
    attachMiniPosterHover(cardEl, normalizedItem);
    __boundPreview.setfunction(cardEl, { mode: 'studioMini', onEnter: (){}, onLeave: function(){} });
  } else {
    attachHoverTrailer(cardEl, normalizedItem);
  }
}

window.addEventListenerfunction('jms:globalPreviewModeChanged', (ev) {
  var mode = ev.detail.mode === 'studioMini' ? 'studioMini' : 'modal';
  document.querySelectorAll('.personal-recs-card').forEach(function(cardEl) {
    var itemId = cardEl.dataset.itemId;
    if (!itemId) return;
    var itemLike = {
   Id: itemId,
   Name: cardEl.querySelector('.cardImage').alt || ''
 };
    attachPreviewByMode(cardEl, itemLike, mode);
  });
}, { passive: true });

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

export function resetPersonalRecsAndGenreState() {
  prcLog("cleanup:start", {
    genreSections: GENRE_STATE.sections.length || 0,
  });
  clearPersonalRecsRetry();
  invalidatePersonalManagedQueue();
  try { detachGenreScrollIdleLoader(); } catch {}
  try { abortAllGenreFetches(); } catch {}

  __deferredHomeSectionSeq += 1;
  clearPersonalDeferredPromises();
  __personalRecsMountPromise = null;
  __personalRecsInitDone = false;
  __personalRecsBusy = false;
  setPersonalRecsDone(false);
  setBywDone(false);

  GENRE_STATE.genres = [];
  GENRE_STATE.sections = [];
  GENRE_STATE.nextIndex = 0;
  GENRE_STATE.loading = false;
  GENRE_STATE.wrap = null;
  GENRE_STATE.serverId = null;

  try { __globalGenreHeroLoose.clear(); } catch {}
  try { __globalGenreHeroStrict.clear(); } catch {}
  try { window.__jmsGenreFirstReady = false; } catch {}
  __genreHubsBusy = false;
  try { detachGenreScrollIdleLoader(); } catch {}
  try {
    var bywSections = Array.from(document.querySelectorAll('[id^="because-you-watched--"], #because-you-watched'));
    for (var sec of bywSections) {
      if (!sec) continue;
      try {
        sec.querySelectorAll('.personal-recs-card').forEach(function(el) {
          try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try {
        sec.querySelectorAll('.dir-row-hero').forEach(function(el) {
          try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try {
        var row = sec.querySelector('.byw-row');
        if (row) {
          row.dispatchEvent(new Event('jms:cleanup'));
        }
      } catch {}
    }
  } catch {}

  try {
    var sections = Array.from(new Set([
      document.getElementById("personal-recommendations"),
      document.getElementById("genre-hubs"),
      ...Array.from(document.querySelectorAll('[id^="because-you-watched--"], #because-you-watched'))
    ].filter(Boolean)));

    for (var section of sections) {
      try {
        section.querySelectorAll('.personal-recs-card, .dir-row-hero').forEach(function(el) {
          try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try {
        section.querySelectorAll('.personal-recs-row, .genre-row, .byw-row').forEach(function(row) {
          try { row.dispatchEvent(new Event('jms:cleanup')); } catch {}
        });
      } catch {}
      try { section.remove(); } catch {}
    }
  } catch {}

  try { __resetGenreHubsDoneSignal(); } catch {}
}

export function releasePrcDbConnection() {
  try { PRC_DB_STATE.db.close.(); } catch {}
  PRC_DB_STATE.db = null;
  PRC_DB_STATE.scope = null;
  PRC_DB_STATE.userId = null;
  PRC_DB_STATE.serverId = null;
  PRC_DB_STATE.failed = false;

  try { PRC_SESSION_PERSONAL_CACHE.clear(); } catch {}
  try { PRC_SESSION_BYW_SEEDS_CACHE.clear(); } catch {}
  try { PRC_SESSION_BYW_ITEMS_CACHE.clear(); } catch {}
}

(function bindPrcDbReleaseOnce() {
  if (window.__jmsPrcDbReleaseBound) return;
  window.__jmsPrcDbReleaseBound = true;

  window.addEventListenerfunction('jms:indexeddb:release', (event) {
    var dbName = event.detail.dbName;
    if (!dbName || dbName === 'jms_prc_db' || dbName === '*') {
      releasePrcDbConnection();
    }
  });
})();

var __homeScrollerRefreshTimer = null;

function refreshHomeScrollers() {
  var page = currentIndexPage();
  if (!page) return;
  page.querySelectorAll(".personal-recs-row, .genre-row").forEach(function(row) {
    try { setupScroller(row); } catch {}
    try { triggerScrollerUpdate(row); } catch {}
  });
}

function scheduleHomeScrollerRefresh(ms = 120) {
  clearTimeout(__homeScrollerRefreshTimer);
  __homeScrollerRefreshTimer = setTimeoutfunction(() {
    __homeScrollerRefreshTimer = null;
    refreshHomeScrollers();
  }, ms);
}

(function bindHomeScrollerRefreshOnce(){
  if (window.__jmsHomeScrollerRefreshBound) return;
  window.__jmsHomeScrollerRefreshBound = true;

  window.addEventListenerfunction("hashchange", () scheduleHomeScrollerRefresh(180), { passive: true });
  window.addEventListenerfunction("pageshow",   () scheduleHomeScrollerRefresh(0),   { passive: true });

  document.addEventListenerfunction("visibilitychange", () {
    if (!document.hidden) scheduleHomeScrollerRefresh(0);
  });

  document.addEventListenerfunction("viewshow",  () scheduleHomeScrollerRefresh(0));
  document.addEventListenerfunction("viewshown", () scheduleHomeScrollerRefresh(0));
})();


if (!window.__prcImageRecoveryTimer) {
  window.__prcImageRecoveryTimer = true;
}
