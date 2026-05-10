import { getSessionInfo, makeApiRequest, playNow, waitForAuthReadyStrict, getCachedUserTopGenres } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig, getHomeSectionsRuntimeConfig, getManagedHomeSectionRuntimeOrder } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { REOPEN_COOLDOWN_MS, getOpenHoverDelay } from "./hoverTrailerModal.js";
import { createTrailerIframe, formatOfficialRatingLabel } from "./utils.js";
import {
  cleanupManagedImage,
  progressivelyRenderCardRow,
  resolveManagedCardTitleRender,
  setManagedImageSource,
  setupScroller
} from "./personalRecommendations.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { openDirRowsDB, makeScope, upsertItemsBatchIdle, getMeta, setMeta, getItemsByIds, } from "./recentRowsDb.js";
import { getGlobalTmdbApiKey } from "./jmsPluginConfig.js";
import {
  withServer
} from "./jfUrl.js";
import { faIconHtml } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import {
  getActiveHomePageEl,
  keepManagedSectionsBelowNative,
  bindManagedSectionsBelowNative,
  waitForVisibleHomeSections
} from "./homeSectionNative.js";
import {
  enqueueManagedSectionRender,
  registerManagedHomeRowAnchor,
  waitForManagedHomeRowRelease
} from "./homeSectionChain.js";

var config = getConfig();
var labels = getLanguageLabels.() || {};
var IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
var UNIFIED_ROW_ITEM_LIMIT = 20;
var PLACEHOLDER_URL = resolveSliderAssetHref(
  config.placeholderImage || "/slider/src/images/placeholder.png"
);
var ENABLE_RECENT_MASTER = (config.enableRecentRows !== false);
var SHOW_RECENT_ROWS_HERO_CARDS = (config.showRecentRowsHeroCards !== false);
var ENABLE_RECENT_MOVIES   = ENABLE_RECENT_MASTER && (config.enableRecentMoviesRow !== false);
var ENABLE_RECENT_SERIES   = ENABLE_RECENT_MASTER && (config.enableRecentSeriesRow !== false);
var ENABLE_RECENT_EPISODES = ENABLE_RECENT_MASTER && (config.enableRecentEpisodesRow !== false);
var ENABLE_RECENT_MUSIC    = ENABLE_RECENT_MASTER && (config.enableRecentMusicRow !== false);
var ENABLE_RECENT_TRACKS   = ENABLE_RECENT_MASTER && (config.enableRecentMusicTracksRow !== false);
var DEFAULT_RECENT_ROWS_COUNT = 15;
var TOP10_ROW_CARD_COUNT = 10;
var ENABLE_OTHER_LIB_ROWS = !!config.enableOtherLibRows;
var OTHER_RECENT_CARD_COUNT   = UNIFIED_ROW_ITEM_LIMIT;
var OTHER_CONTINUE_CARD_COUNT = UNIFIED_ROW_ITEM_LIMIT;
var OTHER_EP_CARD_COUNT       = UNIFIED_ROW_ITEM_LIMIT;
var RECENT_MOVIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
var RECENT_SERIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
var RECENT_EP_CARD_COUNT      = UNIFIED_ROW_ITEM_LIMIT;
var RECENT_MUSIC_CARD_COUNT   = UNIFIED_ROW_ITEM_LIMIT;
var RECENT_TRACKS_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;

var ENABLE_CONTINUE_MOVIES  = (config.enableContinueMovies !== false);
var CONT_MOVIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
var ENABLE_CONTINUE_SERIES  = (config.enableContinueSeries !== false);
var CONT_SERIES_CARD_COUNT  = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_RECENT_MOVIES_COUNT = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_RECENT_SERIES_COUNT = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_CONT_MOV_CNT  = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_CONT_SER_CNT  = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_RECENT_EP_CNT = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_RECENT_MUSIC_COUNT = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_RECENT_TRACKS_COUNT = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_OTHER_RECENT_CNT   = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_OTHER_CONTINUE_CNT = UNIFIED_ROW_ITEM_LIMIT;
var EFFECTIVE_OTHER_EP_CNT       = UNIFIED_ROW_ITEM_LIMIT;

var HOVER_MODE = (config.recentRowsHoverPreviewMode === "studioMini" || config.recentRowsHoverPreviewMode === "modal")
  ? config.recentRowsHoverPreviewMode
  : "inherit";
var HOME_DEBUG_STORAGE_KEY = "jms:debug:home-sections";
var HOME_TRACE_STORAGE_KEY = "jms:trace:home-sections";
// Recent rows can expand into many sub-sections. The generic release gate is
// useful for very long home pages, but on this module it can stall lower rows
// behind the first visible ones and make them appear nondeterministic.
var RECENT_ROWS_EAGER_RELEASE_COUNT = 1024;
var RECENT_ROWS_RELEASE_ROOT_MARGIN = IS_MOBILE
  ? "0px 0px 60% 0px"
  : "0px 0px 22% 0px";

function getLiveConfig() {
  try {
    return (typeof getConfig === "function" ? getConfig() : config) || config || {};
  } catch {
    return config || {};
  }
}

function clampPositiveCount(value, fallback) {
  return Number.isFinite(value) ? Math.max(1, value | 0) : fallback;
}

function getEffectiveRowCount(value) {
  return clampPositiveCount(value, UNIFIED_ROW_ITEM_LIMIT);
}

function getRecentRowsRuntimeConfig(source = getLiveConfig()) {
  var cfg = source || {};
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  var enableRecentMaster = homeSectionsConfig.enableRecentRows;

  return {
    showHeroCards: cfg.showRecentRowsHeroCards !== false,
    showRecentMoviesHeroCards: cfg.showRecentMoviesHeroCards !== false,
    showRecentSeriesHeroCards: cfg.showRecentSeriesHeroCards !== false,
    showRecentMusicHeroCards: cfg.showRecentMusicHeroCards !== false,
    showRecentTracksHeroCards: cfg.showRecentTracksHeroCards !== false,
    showRecentEpisodesHeroCards: cfg.showRecentEpisodesHeroCards !== false,
    showNextUpHeroCards: cfg.showNextUpHeroCards !== false,
    enableTop10Movies: enableRecentMaster && (cfg.enableTop10MoviesRow !== false),
    enableTop10Series: enableRecentMaster && (cfg.enableTop10SeriesRow !== false),
    enableTmdbTopMovies: enableRecentMaster && (cfg.enableTmdbTopMoviesRow !== false),
    enableRecentMovies: enableRecentMaster && (cfg.enableRecentMoviesRow !== false),
    enableRecentSeries: enableRecentMaster && (cfg.enableRecentSeriesRow !== false),
    enableRecentEpisodes: enableRecentMaster && (cfg.enableRecentEpisodesRow !== false),
    enableRecentMusic: enableRecentMaster && (cfg.enableRecentMusicRow !== false),
    enableRecentTracks: enableRecentMaster && (cfg.enableRecentMusicTracksRow !== false),
    enableContinueMovies: homeSectionsConfig.enableContinueMovies,
    enableContinueSeries: homeSectionsConfig.enableContinueSeries,
    enableNextUp: homeSectionsConfig.enableNextUpRowsSection,
    showContinueMoviesHeroCards: cfg.showContinueMoviesHeroCards !== false,
    showContinueSeriesHeroCards: cfg.showContinueSeriesHeroCards !== false,
    enableOtherLibRows: homeSectionsConfig.enableOtherLibRows,
    showOtherLibrariesHeroCards: cfg.showOtherLibrariesHeroCards !== false,
    effectiveRecentMoviesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentMoviesCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentSeriesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentSeriesCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentEpisodesCount: getEffectiveRowCount(clampPositiveCount(cfg.recentEpisodesCardCount, 10)),
    effectiveRecentMusicCount: getEffectiveRowCount(clampPositiveCount(cfg.recentMusicCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveRecentTracksCount: getEffectiveRowCount(clampPositiveCount(cfg.recentTracksCardCount, DEFAULT_RECENT_ROWS_COUNT)),
    effectiveContinueMoviesCount: getEffectiveRowCount(clampPositiveCount(cfg.continueMoviesCardCount, 10)),
    effectiveContinueSeriesCount: getEffectiveRowCount(clampPositiveCount(cfg.continueSeriesCardCount, 10)),
    effectiveNextUpCount: getEffectiveRowCount(clampPositiveCount(cfg.nextUpCardCount, 10)),
    effectiveOtherRecentCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesRecentCardCount, 10)),
    effectiveOtherContinueCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesContinueCardCount, 10)),
    effectiveOtherEpisodesCount: getEffectiveRowCount(clampPositiveCount(cfg.otherLibrariesEpisodesCardCount, 10)),
  };
}

function isRecentRowsDebugEnabled() {
  try {
    if (window.__JMS_DEBUG_HOME_SECTIONS === true) return true;
    if (window.__JMS_DEBUG_HOME_SECTIONS === false) return false;
    var raw = localStorage.getItem(HOME_DEBUG_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return window.__JMS_DEBUG_HOME_SECTIONS === true;
  }
}

function buildRecentRowsDebugPayload(payload) {
  var extra = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : { value: payload };
  return {
    at: new Date().toISOString(),
    hash: String(window.location.hash || ""),
    page: getActiveHomePage.().id || null,
    ...extra,
  };
}

function recentRowsLog(event, payload = {}) {
  if (!isRecentRowsDebugEnabled()) return;
  try { console.log("[JMS:RECENT]", event, buildRecentRowsDebugPayload(payload)); } catch {}
}

function recentRowsWarn(event, payload = {}) {
  if (!isRecentRowsDebugEnabled()) return;
  try { console.warn("[JMS:RECENT]", event, buildRecentRowsDebugPayload(payload)); } catch {}
}

function isRecentRowsTraceEnabled() {
  try {
    if (window.__JMS_TRACE_HOME_SECTIONS === true) return true;
    if (window.__JMS_TRACE_HOME_SECTIONS === false) return false;
    var raw = localStorage.getItem(HOME_TRACE_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return false;
  }
}

function recentRowsTrace(event, payload = {}) {
  if (!isRecentRowsTraceEnabled()) return;
  try { console.warn("[JMS:RECENT:TRACE]", event, buildRecentRowsDebugPayload(payload)); } catch {}
}

function buildTraceStack(limit = 6) {
  try {
    return new Error().stack.split("\n").slice(0, Math.max(2, limit | 0)).join("\n") || "";
  } catch {
    return "";
  }
}

var STATE = {
    started: false,
    wrapEl: null,
    hostEl: null,
    serverId: null,
    userId: null,
    defaultTvHash: null,
    defaultMoviesHash: null,
    defaultMusicHash: null,
    movieLibs: [],
    tvLibs: [],
    otherLibs: [],
    db: null,
    scope: null,
    hadMountedSections: false,
};

var __albumPreviewTrackCache = new Map();

var __recentMountPromise = null;
var __recentRowsRetryTo = null;
var __recentRowsSelfHealObserver = null;
var __recentRowsSelfHealTimer = null;
var __recentRowsSelfHealPending = false;

var RECENT_ROW_SECTION_META = Object.freeze({
  top10SeriesRows: {
    id: "top10-series-rows",
    flag: "__jmsTop10SeriesRowsDone",
    event: "jms:top10-series-rows-done"
  },
  top10MovieRows: {
    id: "top10-movie-rows",
    flag: "__jmsTop10MovieRowsDone",
    event: "jms:top10-movie-rows-done"
  },
  tmdbTopMoviesRows: {
    id: "tmdb-top-movie-rows",
    flag: "__jmsTmdbTopMoviesRowsDone",
    event: "jms:tmdb-top-movie-rows-done"
  },
  recentRows: {
    id: "recent-rows",
    flag: "__jmsRecentRowsDone",
    event: "jms:recent-rows-done"
  },
  continueRows: {
    id: "continue-rows",
    flag: "__jmsContinueRowsDone",
    event: "jms:continue-rows-done"
  },
  nextUpRows: {
    id: "nextup-rows",
    flag: "__jmsNextUpRowsDone",
    event: "jms:nextup-rows-done"
  }
});

var TTL_RECENT_MS   = Number.isFinite(config.recentRowsCacheTTLms) ? Math.max(5_000, config.recentRowsCacheTTLms|0) : 90_000;
var TTL_CONTINUE_MS = Number.isFinite(config.continueRowsCacheTTLms) ? Math.max(5_000, config.continueRowsCacheTTLms|0) : 45_000;
var TTL_TOP10_MS    = 2 * 60 * 60 * 1000;
var TOP10_CACHE_POOL_SIZE = 20;
var TOP_RANK_QUERY_POOL_MULTIPLIER = 4;
var TMDB_TOP_MOVIE_POOL_SIZE = 240;
var TMDB_TOP_RATED_PAGE_LIMIT = 8;
var TOP_RANK_PROFILE_TTL_MS = 10 * 60 * 1000;
var TOP_RANK_GENRE_WEIGHTS = Object.freeze([1, 0.86, 0.74, 0.62, 0.5]);
var FAMILY_FRIENDLY_RATINGS = new Set(["G", "PG", "TV-G", "TV-PG"]);

var __topRankProfileCache = new Map();

function metaKey(kind, type){ return "rr:" + (kind) + ":" + (type); }
function movieLibMetaSuffix(movieLibId){ return movieLibId ? "@movie:" + (movieLibId) : ""; }
function tvLibMetaSuffix(tvLibId){ return tvLibId ? "@tv:" + (tvLibId) : ""; }

function isRecentRowsHomeRoute() {
  var h = String(window.location.hash || "").toLowerCase();
  return h.startsWith("#/home") || h.startsWith("#/index") || h === "" || h === "#";
}

function getRecentRowSectionMeta(sectionKey = "recentRows") {
  return RECENT_ROW_SECTION_META[sectionKey] || RECENT_ROW_SECTION_META.recentRows;
}

function getManagedRecentRowsSectionPrefix(sectionKey = "recentRows") {
  return (getRecentRowSectionMeta(sectionKey).id) + "--";
}

function makeManagedRecentRowsSectionId(sectionKey = "recentRows", index = 0) {
  return (getManagedRecentRowsSectionPrefix(sectionKey)) + (Math.max(0, index | 0));
}

function getManagedRecentRowsSections(sectionKey = "recentRows", root = getActiveHomePage() || document) {
  var prefix = getManagedRecentRowsSectionPrefix(sectionKey);
  return Array.from(root.querySelectorAll.("[id^=\"" + (prefix) + "\"]") || [])
    .filterfunction((el) el.isConnected)
    .sortfunction((left, right) {
      var li = Number(String(left.id || "").slice(prefix.length)) || 0;
      var ri = Number(String(right.id || "").slice(prefix.length)) || 0;
      return li - ri;
    });
}

function cleanupManagedRecentRowsSections(sectionKey = "recentRows", root = getActiveHomePage() || document) {
  for (var section of getManagedRecentRowsSections(sectionKey, root)) {
    try {
      section.querySelectorAll(".personal-recs-card, .dir-row-hero").forEach(function((el) {
        try { el.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
      });
      section.querySelectorAll(".personal-recs-row").forEach(function((row) {
        try { row.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
      });
    } catch {}
    try { section.remove(); } catch {}
  }
}

function getMountedRecentRowsPage() {
  var visiblePage =
    getActiveHomePageEl.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    null;
  if (visiblePage.isConnected) {
    var visibleHasManagedRows = Object.values(RECENT_ROW_SECTION_META).somefunction((meta) (
      !!visiblePage.querySelector.("#" + (meta.id) + ", [id^=\"" + (meta.id) + "--\"]")
    ));
    if (visibleHasManagedRows) return visiblePage;
  }

  for (var meta of Object.values(RECENT_ROW_SECTION_META)) {
    var wrap = document.getElementById(meta.id);
    var wrapPage = wrap.closest.("#indexPage, #homePage");
    if (wrapPage.isConnected) return wrapPage;

    var section = document.querySelector("[id^=\"" + (meta.id) + "--\"]");
    var sectionPage = section.closest.("#indexPage, #homePage");
    if (sectionPage.isConnected) return sectionPage;
  }
  return visiblePage.isConnected ? visiblePage : null;
}

function setManagedRecentRowsDone(sectionKey, done) {
  var meta = getRecentRowSectionMeta(sectionKey);
  var next = !!done;
  var prev = false;
  try { prev = window[meta.flag] === true; } catch {}
  try { window[meta.flag] = next; } catch {}
  if (next && !prev) {
    recentRowsTrace("section:done", {
      sectionKey,
      lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    });
    try { document.dispatchEvent(new Event(meta.event)); } catch {}
  }
}

function setRecentRowsDone(done) {
  setManagedRecentRowsDone("recentRows", done);
}

function setContinueRowsDone(done) {
  setManagedRecentRowsDone("continueRows", done);
}

function setNextUpRowsDone(done) {
  setManagedRecentRowsDone("nextUpRows", done);
}

function hasTop10SeriesRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableTop10Series === true;
}

function hasTop10MovieRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableTop10Movies === true;
}

function hasTmdbTopMoviesRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableTmdbTopMovies === true;
}

function hasRecentRowsSectionEnabled(runtimeCfg) {
  return !!(
    runtimeCfg.enableRecentMovies ||
    runtimeCfg.enableRecentSeries ||
    runtimeCfg.enableRecentEpisodes ||
    runtimeCfg.enableRecentMusic ||
    runtimeCfg.enableOtherLibRows
  );
}

function hasContinueRowsSectionEnabled(runtimeCfg) {
  return !!(
    runtimeCfg.enableRecentTracks ||
    runtimeCfg.enableContinueMovies ||
    runtimeCfg.enableContinueSeries ||
    runtimeCfg.enableOtherLibRows
  );
}

function hasNextUpRowsSectionEnabled(runtimeCfg) {
  return runtimeCfg.enableNextUp === true;
}

function getOrderedRecentRowSectionKeys(cfg, runtimeCfg) {
  var enabled = new Set();
  if (hasTop10SeriesRowsSectionEnabled(runtimeCfg)) enabled.add("top10SeriesRows");
  if (hasTop10MovieRowsSectionEnabled(runtimeCfg)) enabled.add("top10MovieRows");
  if (hasTmdbTopMoviesRowsSectionEnabled(runtimeCfg)) enabled.add("tmdbTopMoviesRows");
  if (hasRecentRowsSectionEnabled(runtimeCfg)) enabled.add("recentRows");
  if (hasContinueRowsSectionEnabled(runtimeCfg)) enabled.add("continueRows");
  if (hasNextUpRowsSectionEnabled(runtimeCfg)) enabled.add("nextUpRows");
  if (!enabled.size) return [];

  var ordered = getManagedHomeSectionRuntimeOrder(cfg, { enabledOnly: true })
    .filterfunction((key) enabled.has(key));
  return ordered.length ? ordered : Array.from(enabled);
}

function ensureRecentDb() {
  if (STATE.db && STATE.scope) return;
  try {
    var db = openDirRowsDB();
    STATE.db = db;
    STATE.scope = makeScope({ serverId: STATE.serverId, userId: STATE.userId });
  } catch (e) {
    console.warn("recentRows: DB open error:", e);
    STATE.db = null;
    STATE.scope = null;
  }
}

function readCachedList(kind, type, ttlMs, {
  validateIds = true
} = {}) {
  if (!STATE.db || !STATE.scope) return { ids: [], fresh: false };
  try {
    var rec = getMeta(STATE.db, metaKey(kind, type) + "|" + STATE.scope);
    var ids = Array.isArray(rec.ids) ? Array.from(new Set(rec.ids.filter(Boolean))) : [];
    var updatedAt = Number(rec.updatedAt) || 0;
    var fresh = (Date.now() - updatedAt) <= ttlMs;

    var liveIds = ids;
    if (validateIds) {
      try {
        var reconciled = filterExistingCachedIds(ids);
        liveIds = reconciled.ids;
        if (reconciled.validated && !sameIdList(ids, liveIds)) {
          writeCachedList(kind, type, liveIds);
        }
      } catch {}
    }

    return { ids: liveIds, fresh };
  } catch { return { ids: [], fresh: false }; }
}

function writeCachedList(kind, type, ids) {
  if (!STATE.db || !STATE.scope) return;
  try {
    setMeta(STATE.db, metaKey(kind, type) + "|" + STATE.scope, {
      ids: (ids || []).filter(Boolean),
      updatedAt: Date.now(),
    });
  } catch {}
}

function loadCachedRowItems(kind, type, ttlMs, {
  limit = 0,
  afterLoad = null,
  refreshUserData = false,
  validateIds = true,
  transformItems = null
} = {}) {
  var { ids, fresh } = readCachedList(kind, type, ttlMs, { validateIds });
  if (!ids.length) return { items: [], fresh: false };

  var take = limit > 0 ? Math.max(1, limit | 0) : ids.length;
  var items = fetchItemsByIds(ids.slice(0, take), { refreshUserData });
  if (typeof afterLoad === "function") {
    afterLoad(items);
  }
  if (typeof transformItems === "function") {
    try {
      var nextItems = transformItems(items);
      if (Array.isArray(nextItems)) {
        items = nextItems;
      }
    } catch {}
  }

  return {
    items: items.slice(0, take),
    fresh,
  };
}

function filterCachedTop10PlayableItems(items = []) {
  return uniqById(
    (Array.isArray(items) ? items : [])
      .filterfunction((item) item.Id && !hasPlaybackActivity(item))
  );
}

function loadCachedLocalTop10Items(kind, type, ttlMs) {
  var cached = loadCachedRowItems(kind, type, ttlMs, {
    limit: TOP10_CACHE_POOL_SIZE,
    refreshUserData: true,
    validateIds: false,
    transformItems: filterCachedTop10PlayableItems
  });

  return {
    items: (Array.isArray(cached.items) ? cached.items : []).slice(0, TOP10_ROW_CARD_COUNT),
    fresh: !!cached.fresh && ((Array.isArray(cached.items) ? cached.items.length : 0) > 0),
  };
}

function filterExistingCachedIds(ids) {
  var clean = Array.isArray(ids)
    ? Array.fromfunction(new Set(ids.map((x) String(x || "").trim()).filter(Boolean)))
    : [];
  if (!clean.length || !STATE.userId) return { ids: clean, validated: false };

  var out = new Set();
  var failed = new Set();
  var validated = false;
  var chunkSize = 80;

  for (var i = 0; i < clean.length; i += chunkSize) {
    var chunk = clean.slice(i, i + chunkSize);
    var url =
      "/Users/" + (encodeURIComponent(STATE.userId)) + "/Items?" +
      "Ids=" + (encodeURIComponent(chunk.join(","))) + "&Fields=Id";
    try {
      var data = makeApiRequest(url);
      var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
      validated = true;
      for (var it of items) {
        if (it.Id) out.add(String(it.Id));
      }
    } catch {
      for (var id of chunk) failed.add(id);
    }
  }

  if (!validated) return { ids: clean, validated: false };
  return {
    ids: clean.filterfunction((id) out.has(id) || failed.has(id)),
    validated: true,
  };
}

function sameIdList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (var i=0;i<a.length;i++) if (a[i] !== b[i]) return false;
  return true;
}

(function ensurePerfCssOnce(){
  if (document.getElementById("recent-rows-perf-css")) return;
  var st = document.createElement("style");
})();

var COMMON_FIELDS = [
  "Type",
  "PrimaryImageAspectRatio",
  "ImageTags",
  "PrimaryImageTag",
  "ThumbImageTag",
  "BackdropImageTags",
  "BackdropImageTag",
  "LogoImageTag",
  "AlbumId",
  "AlbumPrimaryImageTag",
  "ParentBackdropItemId",
  "ParentBackdropImageTags",
  "SeriesBackdropImageTag",
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
  "Overview",
  "UserData",
  "RemoteTrailers",
  "SeriesId",
  "SeriesName",
  "ParentId",
  "IndexNumber",
  "ParentIndexNumber"
].join(",");

function getRecentRowsCardTypeBadge(itemType) {
  var ll = config.languageLabels || {};
  switch (itemType) {
    case "Photo":
      return { label: ll.photo || labels.photo || "Foto", icon: "image" };
    case "PhotoAlbum":
      return { label: ll.photoAlbum || labels.photoAlbum || "Álbum", icon: "images" };
    case "Video":
      return { label: ll.video || labels.video || "Vídeo", icon: "video" };
    case "Folder":
      return { label: ll.folder || labels.folder || "Pasta", icon: "folder" };
    case "Episode":
      return { label: ll.episode || labels.episode || "Episódio", icon: "tv" };
    case "Season":
      return { label: ll.season || labels.season || "Temporada", icon: "layerGroup" };
    case "Series":
      return { label: ll.dizi || labels.dizi || "Série", icon: "tv" };
    case "MusicAlbum":
      return { label: ll.album || labels.album || "Álbum", icon: "compactDisc" };
    case "Audio":
      return { label: ll.track || labels.track || "Faixa", icon: "music" };
    case "BoxSet":
      return {
        label: ll.collectionTitle || ll.boxset || labels.collectionTitle || labels.boxset || "Coleção",
        icon: "layerGroup"
      };
    default:
      return { label: ll.film || labels.film || "Filme", icon: "film" };
  }
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
    item.SeriesBackdropImageTag ||
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

function buildPosterUrl(item, height = 540, quality = 72, { omitTag = false } = {}) {
  var candidate = getPosterLikeImageCandidate(item);
  return buildCandidateImageUrl(item, candidate, height, quality, { omitTag });
}

function buildPosterImageUrl(item) {
  return buildPosterUrl(item, 540, 72) || buildPosterUrl(item, 80, 20) || null;
}

function buildLogoUrl(item, width = 220, quality = 80) {
  if (!item) return null;

  var tag =
    (item.ImageTags && (item.ImageTags.Logo || item.ImageTags.logo || item.ImageTags.LogoImageTag)) ||
    item.LogoImageTag ||
    null;

  if (!item.Id) return null;
  if (!tag) return null;
  var omitTag = shouldPreferTaglessImages(item);

  var base = "/Items/" + (item.Id) + "/Images/Logo";
  var parts = [];
  if (!omitTag) parts.push("tag=" + (encodeURIComponent(tag)));
  parts.push("maxWidth=" + (width));
  parts.push("quality=" + (quality));
  parts.push("EnableImageEnhancers=false");
  var qs = "?" + (parts.join("&"));
  var path = base + qs;

  return withServer(path);
}

function buildBackdropUrl(item, width = 1920, quality = 80) {
  if (!item) return null;
  var candidate = getBackdropImageCandidate(item);
  if (!candidate) return null;
  var omitTag = shouldPreferTaglessImages(item);
  var base = "/Items/" + (candidate.itemId) + "/Images/Backdrop";
  var parts = [];
  if (!omitTag && candidate.tag) parts.push("tag=" + (encodeURIComponent(candidate.tag)));
  parts.push("maxWidth=" + (width));
  parts.push("quality=" + (quality));
  parts.push("EnableImageEnhancers=false");
  var qs = "?" + (parts.join("&"));
  var path = base + qs;

  return withServer(path);
}

function buildBackdropImageUrl(item) {
  return buildBackdropUrl(item, 1920, 80) || buildBackdropUrl(item, 420, 25) || buildPosterImageUrl(item) || null;
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
  if (!runtime) return "";
  return runtime
    .replace(/(\d+)s/g, "$1" + ((config.languageLabels && config.languageLabels.sa) || "sa"))
    .replace(/(\d+)d/g, "$1" + ((config.languageLabels && config.languageLabels.dk) || "dk"));
}

function clampText(s, max = 220) {
  var t0 = String(s || "").replace(/\s+/g, " ").trim();
  if (!t0) return "";
  return t0.length > max ? (t0.slice(0, max - 1) + "…") : t0;
}

function escapeHtml(s){
  return String(s||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function getDetailsUrl(itemId, serverId) {
  return "#/details?id=" + (itemId) + "&serverId=" + (encodeURIComponent(serverId));
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function getPlaybackRuntimeTicks(item) {
  return (
    (item.Type === "Series" ? Number(item.CumulativeRunTimeTicks) : Number(item.RunTimeTicks)) ||
    Number(item.RunTimeTicks) ||
    Number(item.CumulativeRunTimeTicks) ||
    0
  );
}

function isPlaybackCompleted(item, runtimeOverride = 0) {
  var ud = item.UserData || item.UserDataDto || null;
  if (!ud) return false;
  if (ud.Played === true) return true;

  var playedPercentage = Number(ud.PlayedPercentage);
  if (Number.isFinite(playedPercentage) && playedPercentage >= 100) return true;

  var positionTicks = Number(ud.PlaybackPositionTicks || 0);
  var runtimeTicks = Number(runtimeOverride || getPlaybackRuntimeTicks(item) || 0);
  return positionTicks > 0 && runtimeTicks > 0 && positionTicks >= runtimeTicks;
}

function isPartialPlaybackItem(item, runtimeOverride = 0) {
  var ud = item.UserData || item.UserDataDto || null;
  if (!ud || isPlaybackCompleted(item, runtimeOverride)) return false;

  var positionTicks = Number(ud.PlaybackPositionTicks || 0);
  if (!(positionTicks > 0)) return false;

  var runtimeTicks = Number(runtimeOverride || getPlaybackRuntimeTicks(item) || 0);
  return runtimeTicks > 0 ? positionTicks < runtimeTicks : true;
}

function getPlaybackPercent(item) {
  var ud = item.UserData || item.UserDataDto || null;
  if (!ud) return 0;
  var durTicks = getPlaybackRuntimeTicks(item);
  if (isPlaybackCompleted(item, durTicks)) return 0;

  var p = Number(ud.PlayedPercentage);
  if (Number.isFinite(p) && p > 0) return clamp01(p / 100);

  var pos = Number(ud.PlaybackPositionTicks);
  if (!Number.isFinite(pos) || pos <= 0) return 0;

  if (!Number.isFinite(durTicks) || durTicks <= 0) return 0;
  return clamp01(pos / durTicks);
}

function hasPlaybackActivity(item) {
  var ud = item.UserData || item.UserDataDto || null;
  if (!ud) return false;
  if (ud.Played === true) return true;

  var playedPct = Number(ud.PlayedPercentage);
  if (Number.isFinite(playedPct) && playedPct > 0) return true;

  var pos = Number(ud.PlaybackPositionTicks);
  if (Number.isFinite(pos) && pos > 0) return true;

  var lastPlayedTs = getLastPlayedTs(item);
  return lastPlayedTs > 0;
}

function samePlaybackProgressByOrder(a, b, limit) {
  var left = Array.isArray(a) ? a : [];
  var right = Array.isArray(b) ? b : [];
  var cap = Number.isFinite(limit) ? Math.max(0, limit | 0) : Math.max(left.length, right.length);
  var n = Math.min(cap, left.length, right.length);
  for (var i = 0; i < n; i++) {
    var pa = Math.round(getPlaybackPercent(left[i]) * 1000);
    var pb = Math.round(getPlaybackPercent(right[i]) * 1000);
    if (pa !== pb) return false;
  }
  return true;
}

var __hoverIntent = new WeakMap();
var __enterTimers = new WeakMap();
var __enterSeq     = new WeakMap();
var __cooldownUntil= new WeakMap();
var __openTokenMap = new WeakMap();
var __boundPreview = new WeakMap();

var __lastMoveTS = 0;
var __pmLast = 0;
window.addEventListenerfunction("pointermove", () {
  var now = Date.now();
  if (now - __pmLast > 100) { __pmLast = now; __lastMoveTS = now; }
}, {passive:true});

var __touchStickyOpen = false;
var __touchLastOpenTS = 0;
var TOUCH_STICKY_GRACE_MS = 1200;

function hardWipeHoverModalDom() {
  var modal = document.querySelector(".video-preview-modal");
  if (!modal) return;
  try { modal.dataset.itemId = ""; } catch {}
  modal.querySelectorAll("img").forEach(function(img) {
    try { img.removeAttribute("src"); img.removeAttribute("srcset"); } catch {}
  });
  modal.querySelectorAll('[data-field="title"],[data-field="subtitle"],[data-field="meta"],[data-field="genres"]').forEach(function(el) {
    el.textContent = "";
  });
}

(function ensureGlobalTouchOutsideCloser(){
  if (window.__jmsTouchCloserBound_recent) return;
  window.__jmsTouchCloserBound_recent = true;
  document.addEventListenerfunction("pointerdown", (e) {
    if (!__touchStickyOpen) return;
    var inModal = e.target.closest.(".video-preview-modal");
    if (!inModal) {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  }, { passive: true });
  document.addEventListenerfunction("keydown", (e) {
    if (!__touchStickyOpen) return;
    if (e.key === "Escape") {
      try { safeCloseHoverModal(); } catch {}
      __touchStickyOpen = false;
    }
  });
})();

function isHoveringCardOrModal(cardEl) {
  try {
    var overCard  = cardEl.isConnected && cardEl.matches(":hover");
    var overModal = !!document.querySelector(".video-preview-modal:hover");
    return !!(overCard || overModal);
  } catch { return false; }
}

function schedulePostOpenGuard(cardEl, token, delay=300) {
  setTimeoutfunction(() {
    if (__openTokenMap.get(cardEl) !== token) return;
    if (!isHoveringCardOrModal(cardEl)) {
      try { safeCloseHoverModal(); } catch {}
    }
  }, delay);
}

function scheduleClosePollingGuard(cardEl, tries=4, interval=120) {
  var count = 0;
  var iid = setIntervalfunction(() {
    count++;
    if (isHoveringCardOrModal(cardEl)) { clearInterval(iid); return; }
    if (Date.now() - __lastMoveTS > 120 || count >= tries) {
      try { safeCloseHoverModal(); } catch {}
      clearInterval(iid);
    }
  }, interval);
}

function clearEnterTimer(cardEl) {
  var t = __enterTimers.get(cardEl);
  if (t) { clearTimeout(t); __enterTimers.delete(cardEl); }
}

function safeOpenHoverModal(itemId, anchorEl) {
  if (typeof window.tryOpenHoverModal === "function") {
    try { window.tryOpenHoverModal(itemId, anchorEl, { bypass: true }); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.open === "function") {
    try { window.__hoverTrailer.open({ itemId, anchor: anchorEl, bypass: true }); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent("jms:hoverTrailer:open", { detail: { itemId, anchor: anchorEl, bypass: true }}));
}

function safeCloseHoverModal() {
  if (typeof window.closeHoverPreview === "function") {
    try { window.closeHoverPreview(); return; } catch {}
  }
  if (window.__hoverTrailer && typeof window.__hoverTrailer.close === "function") {
    try { window.__hoverTrailer.close(); return; } catch {}
  }
  window.dispatchEvent(new CustomEvent("jms:hoverTrailer:close"));
  try { hardWipeHoverModalDom(); } catch {}
}

function attachHoverTrailer(cardEl, itemLike) {
  var itemId = resolveItemId(itemLike) || sanitizeResolvedId(cardEl.dataset.itemId);
  if (!cardEl || !itemId) return;
  if (!__enterSeq.has(cardEl)) __enterSeq.set(cardEl, 0);

  var onEnter = function(e) {
    var isTouch = e.pointerType === "touch";
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
        if (!cardEl.isConnected || !cardEl.matches(":hover")) return;
      }
      try { window.dispatchEvent(new Event("closeAllMiniPopovers")); } catch {}

      var token = (Date.now() ^ Math.random()*1e9) | 0;
      __openTokenMap.set(cardEl, token);

      try { hardWipeHoverModalDom(); } catch {}
      safeOpenHoverModal(itemId, cardEl);

      if (isTouch) {
        __touchStickyOpen = true;
        __touchLastOpenTS = Date.now();
      }
      if (!isTouch) schedulePostOpenGuard(cardEl, token, 300);
    }, getOpenHoverDelay());

    __enterTimers.set(cardEl, timer);
  };

  var onLeave = function(e) {
    var isTouch = e.pointerType === "touch";
    __hoverIntent.set(cardEl, false);
    clearEnterTimer(cardEl);
    __enterSeq.set(cardEl, (__enterSeq.get(cardEl) || 0) + 1);

    if (isTouch && __touchStickyOpen) {
      if (Date.now() - __touchLastOpenTS <= TOUCH_STICKY_GRACE_MS) return;
      return;
    }

    var rt = e.relatedTarget || null;
    var goingToModal = !!(rt && (rt.closest ? rt.closest(".video-preview-modal") : null));
    if (goingToModal) return;

    try { safeCloseHoverModal(); } catch {}
    try { hardWipeHoverModalDom(); } catch {}
    __cooldownUntil.set(cardEl, Date.now() + REOPEN_COOLDOWN_MS);
    scheduleClosePollingGuard(cardEl, 4, 120);
  };

  cardEl.addEventListener("pointerenter", onEnter, { passive: true });
  cardEl.addEventListenerfunction("pointerdown", (e) { if (e.pointerType === "touch") onEnter(e); }, { passive: true });
  cardEl.addEventListener("pointerleave", onLeave,  { passive: true });
  __boundPreview.set(cardEl, { mode: "modal", onEnter, onLeave });
}

function detachPreviewHandlers(cardEl) {
  var rec = __boundPreview.get(cardEl);
  if (!rec) return;
  try { cardEl.removeEventListener("pointerenter", rec.onEnter); } catch {}
  try { cardEl.removeEventListener("pointerleave", rec.onLeave); } catch {}
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
  if (mode === "studioMini") {
    attachMiniPosterHover(cardEl, normalizedItem);
    __boundPreview.setfunction(cardEl, { mode: "studioMini", onEnter: (){}, onLeave: function(){} });
  } else {
    attachHoverTrailer(cardEl, normalizedItem);
  }
}

function gotoHash(hash) {
  var sid = (STATE.serverId || getSessionInfo().serverId || "").toString();
  var fixed = ensureServerIdInHash(hash, sid);
  try { window.location.hash = fixed; }
  catch { try { window.location.href = fixed; } catch {} }
}

function ensureServerIdInHash(hash, serverId) {
  if (!hash) return hash;
  if (!serverId) return hash;
  if (/\bserverId=/.test(hash)) return hash;
  if (!hash.startsWith("#/")) return hash;
  var sep = hash.includes("?") ? "&" : "?";
  return (hash) + (sep) + "serverId=" + (encodeURIComponent(serverId));
}

var DEFAULT_TV_PAGE = "#/tv";
var DEFAULT_MOVIES_PAGE = "#/movies";
var DEFAULT_MUSIC_PAGE = "#/music";

function resolveDefaultPages(userId) {
  try {
    var data = makeApiRequest("/Users/" + (userId) + "/Views");
    var items = Array.isArray(data.Items) ? data.Items : [];

    var movieLibs = items.filter(function(x) (x.CollectionType === "movies")).map(function(x) ({
      Id: x.Id,
      Name: x.Name || "",
      CollectionType: x.CollectionType
    })).filter(function(x) x.Id);
    STATE.movieLibs = movieLibs;

    var tvLibs = items.filter(function(x) (x.CollectionType === "tvshows")).map(function(x) ({
      Id: x.Id,
      Name: x.Name || "",
      CollectionType: x.CollectionType
    })).filter(function(x) x.Id);
    STATE.tvLibs = tvLibs;

    var other = items
      .filter(function(x) x.Id)
      .map(function(x) ({
        Id: x.Id,
        Name: x.Name || "",
        CollectionType: (x.CollectionType || "").toString()
      }))
      .filter(function(x) {
        var ct = (x.CollectionType || "").toLowerCase();
        return ct !== "movies" && ct !== "tvshows" && ct !== "music";
      });
    STATE.otherLibs = other;

    var tvLib = tvLibs[0] || null;
    var movLib = movieLibs[0] || null;
    var musicLib = items.find(function(x) (x.CollectionType === "music")) || null;

    if (tvLib.Id) {
      STATE.defaultTvHash = "#/tv?topParentId=" + (encodeURIComponent(tvLib.Id)) + "&collectionType=tvshows&tab=1";
    }
    if (movLib.Id) {
      STATE.defaultMoviesHash = "#/movies?topParentId=" + (encodeURIComponent(movLib.Id)) + "&collectionType=movies&tab=1";
    }
    if (musicLib.Id) {
      STATE.defaultMusicHash = "#/music?topParentId=" + (encodeURIComponent(musicLib.Id)) + "&collectionType=music&tab=1";
    }
  } catch (e) {
    console.warn("recentRows: resolveDefaultPages error:", e);
  }
}

function readJsonArrayLs(key) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw || raw === "[object Object]") return null;
    var arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map(function(x) String(x || "").trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function getSelectedTvLibIds(kind) {
  var k =
    kind === "recentSeries"   ? "recentSeriesTvLibIds" :
    kind === "recentEpisodes" ? "recentEpisodesTvLibIds" :
    kind === "continueSeries" ? "continueSeriesTvLibIds" :
    "";
  if (!k) return [];

  var fromLs = readJsonArrayLs(k);
  if (fromLs && fromLs.length) return fromLs;

  var cfg = getConfig.() || {};
  var fromCfg =
    kind === "recentSeries"   ? cfg.recentSeriesTvLibIds :
    kind === "recentEpisodes" ? cfg.recentEpisodesTvLibIds :
    kind === "continueSeries" ? cfg.continueSeriesTvLibIds :
    null;
  return Array.isArray(fromCfg) ? fromCfg.map(function(x) String(x||"").trim()).filter(Boolean) : [];
}

function getSelectedMovieLibIds() {
  var fromLs = readJsonArrayLs("recentMoviesLibIds");
  if (fromLs && fromLs.length) return fromLs;

  var cfg = getConfig.() || {};
  var fromCfg = cfg.recentMoviesLibIds;
  return Array.isArray(fromCfg) ? fromCfg.map(function(x) String(x || "").trim()).filter(Boolean) : [];
}

function resolveMovieLibSelection() {
  var all = (STATE.movieLibs || []).map(function(x) x.Id).filter(Boolean);
  if (!all.length) return [];
  var sel = getSelectedMovieLibIds();
  var filtered = sel.filter(function(id) all.includes(id));
  return filtered.length ? filtered : all;
}

function resolveTvLibSelection(kind) {
  var all = (STATE.tvLibs || []).map(function(x) x.Id).filter(Boolean);
  if (!all.length) return [];
  var sel = getSelectedTvLibIds(kind);
  var filtered = sel.filter(function(id) all.includes(id));
  return filtered.length ? filtered : all;
}

function getSelectedOtherLibIds() {
  var fromLs = readJsonArrayLs("otherLibrariesIds");
  if (fromLs && fromLs.length) return fromLs;
  var cfg = getConfig.() || {};
  var fromCfg = cfg.otherLibrariesIds || cfg.otherLibIds || null;
  return Array.isArray(fromCfg) ? fromCfg.map(function(x) String(x||"").trim()).filter(Boolean) : [];
}

function resolveOtherLibSelection() {
  var all = (STATE.otherLibs || []).map(function(x) x.Id).filter(Boolean);
  if (!all.length) return [];
  var sel = getSelectedOtherLibIds();
  var filtered = sel.filter(function(id) all.includes(id));
  return filtered.length ? filtered : all;
}

function normalizeIdList(ids) {
  return Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .mapfunction((id) String(id || "").trim())
        .filter(Boolean)
    )
  );
}

function resolveScopedParentIds(allIds, selectedIds) {
  var all = normalizeIdList(allIds);
  if (!all.length) return [];

  var selected = normalizeIdList(selectedIds).filterfunction((id) all.includes(id));
  if (!selected.length || selected.length >= all.length) {
    return [];
  }
  return selected;
}

function buildTopRowMetaType(type, parentIds = []) {
  var scoped = normalizeIdList(parentIds).sort();
  return scoped.length ? (type) + "@top:" + (scoped.join(",")) : type;
}

function clampNumber(value, min, max) {
  var num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function toTimestamp(value) {
  if (!value) return 0;
  var ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function getProviderIdValue(item, key) {
  var bag = item.ProviderIds || item.Providerids || item.providerIds || null;
  if (!bag || !key) return "";
  var candidates = [
    bag[key],
    bag[String(key).toLowerCase()],
    bag[String(key).toUpperCase()],
    key === "Tmdb" ? bag.TMDb : null,
    key === "Imdb" ? bag.IMDb : null,
    key === "Tmdb" ? bag.MovieDb : null,
  ].filter(Boolean);
  return String(candidates[0] || "").trim();
}

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function getItemYear(item) {
  var year = Number(item.ProductionYear);
  if (Number.isFinite(year) && year > 0) return year | 0;
  var premiereTs = toTimestamp(item.PremiereDate);
  if (!premiereTs) return 0;
  return new Date(premiereTs).getUTCFullYear();
}

function buildTitleYearKey(title, year) {
  var normalizedTitle = normalizeComparableText(title);
  var normalizedYear = Number(year);
  if (!normalizedTitle || !Number.isFinite(normalizedYear) || normalizedYear <= 0) return "";
  return (normalizedTitle) + "|" + (normalizedYear | 0);
}

function getTmdbResultYear(result) {
  return getItemYear({
    ProductionYear: result.release_date ? new Date(result.release_date).getUTCFullYear() : null,
    PremiereDate: result.release_date || null
  });
}

function getTopRankUserProfile(userId) {
  var cacheKey = String(userId || STATE.userId || "").trim() || "default";
  var now = Date.now();
  var cached = __topRankProfileCache.get(cacheKey);
  if (cached.value && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached.pending) {
    return cached.pending;
  }

  var pending = function(() {
    var rawTopGenres = getCachedUserTopGenres(5).catchfunction(() []);
    var topGenres = Array.isArray(rawTopGenres) ? rawTopGenres : [];
    var normalizedGenres = [];
    var queryGenres = [];
    var seen = new Set();
    for (var genre of topGenres) {
      var key = normalizeComparableText(genre);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      normalizedGenres.push(key);
      queryGenres.push(String(genre || "").trim());
      if (normalizedGenres.length >= TOP_RANK_GENRE_WEIGHTS.length) break;
    }

    var genreWeights = new Map();
    normalizedGenres.forEach(function((genre, index) {
      genreWeights.set(genre, TOP_RANK_GENRE_WEIGHTS[index] || 0.4);
    });

    return {
      currentYear: new Date().getFullYear(),
      topGenres: normalizedGenres,
      queryGenres,
      genreWeights,
    };
  })()
    .thenfunction((value) {
      __topRankProfileCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + TOP_RANK_PROFILE_TTL_MS,
        pending: null
      });
      return value;
    })
    .catchfunction((error) {
      __topRankProfileCache.delete(cacheKey);
      throw error;
    });

  __topRankProfileCache.set(cacheKey, {
    value: cached.value || null,
    expiresAt: cached.expiresAt || 0,
    pending
  });
  return pending;
}

function getTopRankGenreMatch(item, profile) {
  var itemGenres = Array.isArray(item.Genres) ? item.Genres : [];
  if (!itemGenres.length || !(profile.genreWeights instanceof Map) || !profile.genreWeights.size) {
    return { score: 0, matches: 0 };
  }

  var score = 0;
  var matches = 0;
  var matched = new Set();

  for (var genre of itemGenres) {
    var key = normalizeComparableText(genre);
    if (!key || matched.has(key)) continue;
    var weight = profile.genreWeights.get(key);
    if (!Number.isFinite(weight)) continue;
    matched.add(key);
    matches++;
    score += 14 * weight;
  }

  if (matches >= 2) score += 5;
  if (matches >= 3) score += 4;
  return { score, matches };
}

function scoreTopRankCommunityRating(rating) {
  var value = clampNumber(rating, 0, 10);
  if (value >= 9.2) return 18;
  if (value >= 8.7) return 15;
  if (value >= 8.2) return 11;
  if (value >= 7.6) return 7;
  if (value >= 6.9) return 4;
  return 0;
}

function scoreTopRankCriticRating(critic) {
  var value = clampNumber(critic, 0, 100);
  if (value >= 95) return 16;
  if (value >= 90) return 13;
  if (value >= 82) return 10;
  if (value >= 74) return 6;
  if (value >= 65) return 3;
  return 0;
}

function getTopRankMatchPercentage(item, profile, sourceCount = 1) {
  var playedPct = clampNumber(item.UserData.PlayedPercentage, 0, 100);
  var rating = clampNumber(item.CommunityRating, 0, 10);
  var critic = clampNumber(item.CriticRating, 0, 100);
  var year = getItemYear(item);
  var age = year > 0 && profile.currentYear ? Math.max(0, profile.currentYear - year) : null;
  var genreMatch = getTopRankGenreMatch(item, profile);

  var score = 38;
  score += genreMatch.score;
  score += scoreTopRankCommunityRating(rating);
  score += scoreTopRankCriticRating(critic);

  if (age != null) {
    if (age <= 3) score += 6;
    else if (age <= 8) score += 4;
    else if (age <= 15) score += 2;
  }

  if (item.UserData.IsFavorite === true) score += 6;
  if (playedPct > 0 && playedPct < 85) score += 4;
  if (FAMILY_FRIENDLY_RATINGS.has(String(item.OfficialRating || "").trim())) score += 2;
  if (sourceCount >= 4) score += 8;
  else if (sourceCount === 3) score += 6;
  else if (sourceCount === 2) score += 3;

  if (hasPlaybackActivity(item)) score -= 8;
  if (!String(item.Overview || "").trim()) score -= 2;

  if (rating >= 9 && critic < 70 && genreMatch.matches === 0 && sourceCount < 2) {
    score -= 16;
  } else if (rating >= 8.6 && critic <= 0 && genreMatch.matches === 0 && sourceCount < 2) {
    score -= 10;
  }

  return clampNumber(Math.round(score), 0, 100);
}

function getTopRankCompositeBoost(entry, profile) {
  var sourceCount = entry.sources instanceof Set ? entry.sources.size : 1;
  var matchPercentage = getTopRankMatchPercentage(entry.item, profile, sourceCount);
  var critic = clampNumber(entry.item.CriticRating, 0, 100);
  var community = clampNumber(entry.item.CommunityRating, 0, 10);

  var boost = matchPercentage * 6.2;
  if (critic >= 85 && community >= 7.8) boost += 22;
  if (sourceCount >= 3) boost += 10;
  if (sourceCount === 1 && community >= 8.8 && critic <= 0) boost -= 18;
  return boost;
}

function getTopRankSignals(item, index = 0, modeKey = "rating", queryWeight = 1) {
  var playedPct = clampNumber(item.UserData.PlayedPercentage, 0, 100);
  var year = getItemYear(item);
  var now = Date.now();
  var premiereAgeDays = function(() {
    var ts = toTimestamp(item.PremiereDate);
    if (!ts) return null;
    return Math.max(0, (now - ts) / 86400000);
  })();
  var createdAgeDays = function(() {
    var ts = toTimestamp(item.DateCreated);
    if (!ts) return null;
    return Math.max(0, (now - ts) / 86400000);
  })();

  var orderBias =
    modeKey === "playCount" ? 1.08 :
    modeKey === "profile" ? 0.98 :
    modeKey === "premiere" ? 0.96 :
    modeKey === "created" ? 0.9 :
    0.72;
  var orderScore = Math.max(0, 64 - index) * 4.15 * queryWeight * orderBias;
  var ratingScore = scoreTopRankCommunityRating(item.CommunityRating) * 1.3;
  var criticScore = scoreTopRankCriticRating(item.CriticRating) * 1.15;
  var yearScore = year > 0 ? Math.max(0, year - 1998) * 0.18 : 0;
  var freshnessScore = hasPlaybackActivity(item) ? 0 : 12;
  var favoriteScore = item.UserData.IsFavorite === true ? 10 : 0;
  var progressScore = (
    Number.isFinite(playedPct) && playedPct > 0 && playedPct < 95
      ? Math.max(0, 10 - Math.abs(50 - playedPct) * 0.14)
      : 0
  );
  var premiereScore = premiereAgeDays == null ? 0 : Math.max(0, 2400 - premiereAgeDays) * 0.0065;
  var createdScore = createdAgeDays == null ? 0 : Math.max(0, 540 - createdAgeDays) * 0.014;
  var modeBonus =
    modeKey === "playCount" ? 24 :
    modeKey === "profile" ? 16 :
    modeKey === "rating" ? 5 :
    modeKey === "premiere" ? 13 :
    8;

  return orderScore + ratingScore + criticScore + yearScore + freshnessScore + favoriteScore + progressScore + premiereScore + createdScore + modeBonus;
}

var TOP_RANK_SORT_MODES = Object.freeze([
  { key: "playCount", sortBy: "PlayCount,CommunityRating,PremiereDate,DateCreated", weight: 1.0 },
  { key: "rating", sortBy: "CommunityRating,PremiereDate,DateCreated", weight: 0.56 },
  { key: "premiere", sortBy: "PremiereDate,CommunityRating,DateCreated", weight: 0.76 },
  { key: "created", sortBy: "DateCreated,CommunityRating,PremiereDate", weight: 0.62 }
]);

var TOP_RANK_FIELDS = [
  COMMON_FIELDS,
  "CriticRating",
  "DateCreated",
  "PremiereDate",
  "ProviderIds",
  "OriginalTitle"
].join(",");

function mergeRankedEntry(map, item, score, sourceKey) {
  if (!item.Id || !Number.isFinite(score)) return;
  var prev = map.get(item.Id);
  if (!prev) {
    map.set(item.Id, { item, score, sources: new Set([sourceKey]) });
    return;
  }

  if (!prev.sources.has(sourceKey)) {
    var previousScore = prev.score;
    prev.score = Math.max(previousScore, score) + (Math.min(previousScore, score) * 0.35);
    prev.sources.add(sourceKey);
    if (score >= previousScore) prev.item = item;
    return;
  }

  if (score > prev.score) {
    prev.score = score;
    prev.item = item;
  }
}

function fetchTopRankedEntryPool(userId, type, poolSize, parentId, { filters = "" } = {}) {
  var want = Math.max(24, poolSize | 0);
  var merged = new Map();
  var lastError = null;
  var profile = getTopRankUserProfile(userId).catchfunction(() null);

  for (var mode of TOP_RANK_SORT_MODES) {
    var url =
      "/Users/" + (userId) + "/Items?" +
      "IncludeItemTypes=" + (encodeURIComponent(type)) + "&Recursive=true&Fields=" + (encodeURIComponent(TOP_RANK_FIELDS)) + "&" +
      "EnableUserData=true&" +
      (filters ? "Filters=" + (encodeURIComponent(filters)) + "&" : "") +
      (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
      "SortBy=" + (encodeURIComponent(mode.sortBy)) + "&SortOrder=Descending&Limit=" + (want) + "&" +
      "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
    try {
      var data = makeApiRequest(url);
      var items = uniqById(Array.isArray(data.Items) ? data.Items : [])
        .filterfunction((it) it.Type === type)
        .slice(0, want);
      if (!items.length) continue;

      try {
        if (STATE.db && STATE.scope) {
          upsertItemsBatchIdle(STATE.db, STATE.scope, items, { timeout: 1500 });
        }
      } catch {}

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var score = getTopRankSignals(item, i, mode.key, mode.weight);
        mergeRankedEntry(merged, item, score, mode.key);
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (profile.queryGenres.length) {
    var url =
      "/Users/" + (userId) + "/Items?" +
      "IncludeItemTypes=" + (encodeURIComponent(type)) + "&Recursive=true&Fields=" + (encodeURIComponent(TOP_RANK_FIELDS)) + "&" +
      "EnableUserData=true&" +
      (filters ? "Filters=" + (encodeURIComponent(filters)) + "&" : "") +
      (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
      "Genres=" + (encodeURIComponent(profile.queryGenres.join("|"))) + "&" +
      "SortBy=" + (encodeURIComponent("CommunityRating,PremiereDate,DateCreated")) + "&SortOrder=Descending&Limit=" + (want) + "&" +
      "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
    try {
      var data = makeApiRequest(url);
      var items = uniqById(Array.isArray(data.Items) ? data.Items : [])
        .filterfunction((it) it.Type === type)
        .slice(0, want);
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var score = getTopRankSignals(item, i, "profile", 0.88);
        mergeRankedEntry(merged, item, score, "profile");
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (merged.size) {
    return Array.from(merged.values())
      .mapfunction((entry) ({
        ...entry,
        score: entry.score + getTopRankCompositeBoost(entry, profile)
      }))
      .sortfunction((a, b) b.score - a.score);
  }

  if (lastError) {
    console.warn("recentRows: top ranked fetch error:", type, parentId || "all", lastError);
  }
  return [];
}

function fetchTopRankedEntryPoolAcrossParents(userId, type, poolSize, parentIds = [], { filters = "" } = {}) {
  var scopedParents = normalizeIdList(parentIds);
  if (!scopedParents.length) {
    return fetchTopRankedEntryPool(userId, type, poolSize, null, { filters });
  }
  if (scopedParents.length === 1) {
    return fetchTopRankedEntryPool(userId, type, poolSize, scopedParents[0], { filters });
  }

  var candidateLists = Promise.allfunction(scopedParents.map((parentId) ({
      parentId,
      entries: fetchTopRankedEntryPool(userId, type, poolSize, parentId, { filters })
    }))
  );

  var merged = new Map();
  for (var entry of candidateLists) {
    for (var i = 0; i < entry.entries.length; i++) {
      var ranked = entry.entries[i];
      if (!ranked.item.Id) continue;
      var libraryScore = ranked.score + Math.max(0, 36 - i) * 2.6;
      mergeRankedEntry(merged, ranked.item, libraryScore, "lib:" + (entry.parentId));
    }
  }

  var out = Array.from(merged.values()).sortfunction((a, b) b.score - a.score);
  if (out.length) return out;
  return fetchTopRankedEntryPool(userId, type, poolSize, null, { filters });
}

function fetchTopRankedAcrossParents(userId, type, limit, parentIds = [], { poolSize = null } = {}) {
  var resolvedPoolSize = Math.max(limit, poolSize || (limit * TOP_RANK_QUERY_POOL_MULTIPLIER));
  var entries = fetchTopRankedEntryPoolAcrossParents(userId, type, resolvedPoolSize, parentIds);
  var items = entries.mapfunction((entry) entry.item);
  return items.slice(0, limit);
}

function fetchTopRankedUnplayedFirstAcrossParents(userId, type, limit, parentIds = [], { poolSize = null } = {}) {
  var resolvedPoolSize = Math.max(limit, poolSize || (limit * TOP_RANK_QUERY_POOL_MULTIPLIER));
  var unseenEntries = fetchTopRankedEntryPoolAcrossParents(
    userId,
    type,
    resolvedPoolSize,
    parentIds,
    { filters: "IsUnplayed" }
  );
  var unseenItems = unseenEntries
    .mapfunction((entry) entry.item)
    .filterfunction((item) item && !hasPlaybackActivity(item));
  if (unseenItems.length >= limit) {
    return unseenItems.slice(0, limit);
  }

  var fallbackEntries = fetchTopRankedEntryPoolAcrossParents(userId, type, resolvedPoolSize, parentIds);
  var seenIds = new Setfunction(unseenItems.map((item) item.Id).filter(Boolean));
  var fallbackItems = fallbackEntries
    .mapfunction((entry) entry.item)
    .filterfunction((item) item.Id && !seenIds.has(item.Id));

  return [...unseenItems, ...fallbackItems].slice(0, limit);
}

function buildTmdbMovieLookup(items = []) {
  var byTmdbId = new Map();
  var byTitleYear = new Map();

  for (var item of items) {
    if (!item.Id) continue;
    var tmdbId =
      getProviderIdValue(item, "Tmdb") ||
      getProviderIdValue(item, "TMDb") ||
      getProviderIdValue(item, "MovieDb");
    if (tmdbId && !byTmdbId.has(tmdbId)) {
      byTmdbId.set(tmdbId, item);
    }

    var year = getItemYear(item);
    for (var title of [item.Name, item.OriginalTitle]) {
      var key = buildTitleYearKey(title, year);
      if (key && !byTitleYear.has(key)) {
        byTitleYear.set(key, item);
      }
    }
  }

  return { byTmdbId, byTitleYear };
}

function resolveTmdbResultToLocalMovie(result, lookup) {
  var tmdbId = String(result.id || "").trim();
  if (tmdbId && lookup.byTmdbId.has(tmdbId)) {
    return lookup.byTmdbId.get(tmdbId) || null;
  }

  var releaseYear = getTmdbResultYear(result);
  var years = releaseYear > 0 ? [releaseYear, releaseYear - 1, releaseYear + 1] : [];
  var titles = [result.title, result.original_title];

  for (var title of titles) {
    for (var year of years) {
      var key = buildTitleYearKey(title, year);
      if (key && lookup.byTitleYear.has(key)) {
        return lookup.byTitleYear.get(key) || null;
      }
    }
  }

  return null;
}

function tmdbFetchJson(path, { signal } = {}) {
  var apiKey = getGlobalTmdbApiKey().catchfunction(() "");
  if (!apiKey) throw new Error("TMDb API key missing");

  var url = new URL("https://api.themoviedb.org/3" + (path));
  url.searchParams.set("api_key", apiKey);

  var res = fetch(url.toString(), {
    method: "GET",
    signal
  });
  if (!res.ok) {
    var text = res.text().catchfunction(() "");
    throw new Error("TMDb HTTP " + (res.status) + ": " + (text));
  }
  return res.json();
}

function fetchTmdbTopRatedMoviesInLibraries(userId, limit, parentIds = []) {
  var apiKey = getGlobalTmdbApiKey().catchfunction(() "");
  if (!apiKey) {
    return {
      items: [],
      reason: "missingKey"
    };
  }

  var rankedPool = fetchTopRankedEntryPoolAcrossParents(
    userId,
    "Movie",
    TMDB_TOP_MOVIE_POOL_SIZE,
    parentIds
  );
  var lookup = buildTmdbMovieLookupfunction(rankedPool.map((entry) entry.item));
  if (!lookup.byTmdbId.size && !lookup.byTitleYear.size) {
    return {
      items: [],
      reason: "noLocalCandidates"
    };
  }

  var matched = [];
  var seenIds = new Set();
  var language = String(navigator.language || "en-US").trim() || "en-US";

  for (var page = 1; page <= TMDB_TOP_RATED_PAGE_LIMIT && matched.length < limit; page++) {
    var data = null;
    try {
      data = tmdbFetchJson("/movie/top_rated?language=" + (encodeURIComponent(language)) + "&page=" + (page));
    } catch (e) {
      console.warn("recentRows: tmdb top rated fetch error:", e);
      return {
        items: matched.slice(0, limit),
        reason: matched.length ? "partial" : "fetchError"
      };
    }

    var results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) break;

    for (var result of results) {
      var localItem = resolveTmdbResultToLocalMovie(result, lookup);
      if (!localItem.Id || seenIds.has(localItem.Id)) continue;
      seenIds.add(localItem.Id);
      matched.push(localItem);
      if (matched.length >= limit) break;
    }
  }

  return {
    items: matched.slice(0, limit),
    reason: matched.length ? "ok" : "noMatches"
  };
}

function getTopMovieParentIds() {
  return resolveScopedParentIds(
    (STATE.movieLibs || []).mapfunction((lib) lib.Id),
    resolveMovieLibSelection()
  );
}

function getTopSeriesParentIds() {
  return resolveScopedParentIds(
    (STATE.tvLibs || []).mapfunction((lib) lib.Id),
    resolveTvLibSelection("recentSeries")
  );
}

function getTvHashFallback() {
  return (
    config.latestSeriesHash ||
    config.resumeSeriesHash ||
    STATE.defaultTvHash ||
    DEFAULT_TV_PAGE
  );
}

function getMoviesHashFallback() {
  return (
    config.latestMoviesHash ||
    config.resumeMoviesHash ||
    STATE.defaultMoviesHash ||
    DEFAULT_MOVIES_PAGE
  );
}

function getMoviesLibraryHash(libId) {
  return "#/movies?topParentId=" + (encodeURIComponent(libId)) + "&collectionType=movies&tab=1";
}

function getMusicHashFallback() {
  return (
    config.latestMusicHash ||
    STATE.defaultMusicHash ||
    DEFAULT_MUSIC_PAGE
  );
}

function openLatestPage(type) {
  if (type === "Series" || type === "Episode") {
    gotoHash(getTvHashFallback());
    return;
  }
  if (type === "MusicAlbum" || type === "Audio") {
    gotoHash(getMusicHashFallback());
    return;
  }
  gotoHash(getMoviesHashFallback());
}

function openResumePage(type) {
  if (type === "Series" || type === "Episode") {
    gotoHash(getTvHashFallback());
    return;
  }
  gotoHash(getMoviesHashFallback());
}

function queueEnterAnimation(el) {
  if (!el) return el;
  el.classList.add("is-entering");
  var clear = function() {
    try { el.classList.remove("is-entering"); } catch {}
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

function createRecommendationCard(item, serverId, {
  aboveFold = false,
  showProgress = false,
  variant = "default",
  rank = null
} = {}) {
  var { itemId, itemName } = primeItemIdentity(item);
  var card = document.createElement("div");
  card.className = "card personal-recs-card";
  var isTop10 = variant === "top10";
  if (isTop10) card.classList.add("top10-card");
  queueEnterAnimation(card);
  if (itemId) card.dataset.itemId = itemId;
  if (isTop10 && Number.isFinite(rank)) card.dataset.rank = String(rank);

  var posterSource = item.__posterSource || item;

  var posterUrlStatic = buildPosterImageUrl(posterSource);

  var year = item.ProductionYear || posterSource.ProductionYear || "";
  var ageChip = formatOfficialRatingLabel(item.OfficialRating || posterSource.OfficialRating || "");

  var runtimeTicks =
    item.Type === "Series" ? item.CumulativeRunTimeTicks :
    item.Type === "Episode" ? item.RunTimeTicks :
    item.RunTimeTicks;

  var runtime = formatRuntime(runtimeTicks);

  var genres = Array.isArray(posterSource.Genres) ? posterSource.Genres.slice(0, 2).join(", ") : "";
  var isEpisode = item.Type === "Episode";
  var isSeason  = item.Type === "Season";
  var { label: typeLabel, icon: typeIcon } = getRecentRowsCardTypeBadge(item.Type);
  var top10IsFresh = isTop10 && !hasPlaybackActivity(item);

  var community = Number.isFinite(posterSource.CommunityRating)
    ? "<div class=\"community-rating\" title=\"" + (escapeHtml(config.languageLabels.communityRating || "Community Rating")) + "\">⭐ " + (posterSource.CommunityRating.toFixed(1)) + "</div>"
    : "";
  var top10RankHtml = (isTop10 && Number.isFinite(rank))
    ? "<div class=\"top10-rank\" aria-hidden=\"true\">" + (Math.max(1, rank | 0)) + "</div>"
    : "";
  var top10FreshBadgeHtml = top10IsFresh
    ? "<div class=\"top10-fresh-badge\">" + (escapeHtml(getBadgeText("new"))) + "</div>"
    : "";
  var topBadgesHtml = isTop10
    ? "\n      <div class=\"prc-top-badges top10-top-badges\">\n        <div class=\"prc-type-badge top10-type-badge\">\n          " + (faIconHtml(typeIcon, "prc-type-icon")) + "\n          " + (typeLabel) + "\n        </div>\n      </div>\n    "
    : "\n      <div class=\"prc-top-badges\">\n        " + (community) + "\n        <div class=\"prc-type-badge\">\n          " + (faIconHtml(typeIcon, "prc-type-icon")) + "\n          " + (typeLabel) + "\n        </div>\n      </div>\n    ";

  var progress = showProgress ? getPlaybackPercent(item) : 0;
  var progressHtml = (showProgress && progress > 0.02 && progress < 0.999)
    ? "<div class=\"rr-progress-wrap\" aria-label=\"" + (escapeHtml(config.languageLabels.progress || "Progresso")) + "\">\n         <div class=\"rr-progress-bar\" style=\"width:" + (Math.round(progress*100)) + "%\"></div>\n       </div>"
    : "";

  var mainTitle =
    (isEpisode || isSeason)
      ? (item.Name || posterSource.Name || item.SeriesName || "")
      : (item.Name || "");

  var subTitle =
    isEpisode ? formatEpisodeSubline(item) :
    isSeason  ? formatSeasonSubline(item) :
    "";
  var logoUrl =
    buildLogoUrl(item) ||
    (posterSource !== item ? buildLogoUrl(posterSource) : null);
  var escapedTitleHtml = escapeHtml(clampText(mainTitle, isTop10 ? 38 : 42));
  var escapedSubTitle = isEpisode && subTitle ? escapeHtml(subTitle) : "";
  var logoAltSuffix = (config.languageLabels && config.languageLabels.logoAltSuffix) || "logo";
  var fallbackTitleHtml = isTop10
    ? "\n      <div class=\"prc-titleline\">\n        " + (escapedTitleHtml) + "\n        ${escapedSubTitle ? "<div class="prc-subtitleline">${escapedSubTitle}</div>" : ""}\n      </div>\n    "
    : "";
  var managedTitleRender = isTop10
    ? null
    : resolveManagedCardTitleRender({
        titleText: mainTitle,
        subtitleText: subTitle,
        logoUrl,
        logoAltText: (mainTitle) + " " + (logoAltSuffix).trim(),
        aboveFold,
        maxTitleLength: 42,
      });
  var titleBlockHtml = isTop10
    ? (logoUrl
      ? "\n        <div class=\"prc-card-logo\">\n          <img src=\"" + (escapeHtml(logoUrl)) + "\"\n            alt=\"${escapeHtml("${mainTitle} ${logoAltSuffix}".trim())}\"\n            loading=\"" + (aboveFold ? "eager" : "lazy") + "\"\n            decoding=\"async\"\n            " + (aboveFold ? 'fetchpriority="high"' : "") + ">\n        </div>\n        ${escapedSubTitle ? "<div class="prc-subtitleline prc-logo-subtitle">${escapedSubTitle}</div>" : ""}\n      "
      : fallbackTitleHtml)
    : managedTitleRender.html;

  var metaHtml = isTop10
    ? "\n      <div class=\"prc-meta\">\n        ${ageChip ? "<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>" : \"\"}\n        ${year ? "<span class="prc-year">${year}</span>" : \"\"}\n      </div>\n    "
    : "\n      <div class=\"prc-meta\">\n        ${ageChip ? "<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>" : \"\"}\n        ${year ? "<span class="prc-year">${year}</span><span class="prc-dot">•</span>" : \"\"}\n        ${runtime ? "<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>" : \"\"}\n      </div>\n    ";

  card.innerHTML = "\n    <div class=\"cardBox\">\n      <a class=\"cardLink\" href=\"" + (itemId ? getDetailsUrl(itemId, serverId) : '#') + "\">\n        <div class=\"cardImageContainer\" style=\"position:relative;\">\n          " + (top10RankHtml) + "\n          <img class=\"cardImage\"\n            alt=\"" + (escapeHtml(mainTitle)) + "\"\n            loading=\"" + (aboveFold ? "eager" : "lazy") + "\"\n            decoding=\"async\"\n            " + (aboveFold ? 'fetchpriority="high"' : "") + ">\n          " + (topBadgesHtml) + "\n          " + (top10FreshBadgeHtml) + "\n          <div class=\"prc-gradient" + (isTop10 ? " top10-gradient" : "") + "\"></div>\n          <div class=\"prc-overlay" + (isTop10 ? " top10-overlay" : "") + "\">\n            " + (titleBlockHtml) + "\n\n            " + (metaHtml) + "\n\n            <div class=\"prc-genres\">\n              " + ((!isEpisode && genres) ? escapeHtml(genres) : "") + "\n            </div>\n          </div>\n          " + (progressHtml) + "\n        </div>\n      </a>\n    </div>\n  ";

  var logoImg = card.querySelector(".prc-card-logo img");
  if (logoImg) {
    logoImg.addEventListenerfunction("error", () {
      try {
        var logoWrap = logoImg.closest(".prc-card-logo");
        if (!logoWrap.isConnected) return;
        if (isTop10) {
          logoWrap.outerHTML = fallbackTitleHtml;
          var logoSubtitle = card.querySelector(".prc-logo-subtitle");
          if (logoSubtitle) logoSubtitle.remove();
          return;
        }
        logoWrap.remove();
      } catch {}
    }, { once: true });
  }

  var img = card.querySelector(".cardImage");
  try {
    var sizesMobile = isTop10
      ? "(max-width: 640px) 48vw, (max-width: 820px) 42vw, 300px"
      : showProgress
        ? "(max-width: 640px) 78vw, (max-width: 820px) 72vw, 320px"
        : "(max-width: 640px) 44vw, (max-width: 820px) 38vw, 262px";
    var sizesDesk = isTop10
      ? "(max-width: 1200px) 27vw, 300px"
      : showProgress
        ? "(max-width: 1200px) 34vw, 390px"
        : "(max-width: 1200px) 22vw, 262px";
    img.setAttribute("sizes", IS_MOBILE ? sizesMobile : sizesDesk);
  } catch {}

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
        console.warn("openDetailsModal failed (recent card):", err);
      }
    }, { passive: false });
  }

  if (posterUrlStatic) {
    setManagedImageSource(img, posterUrlStatic, { fallback: PLACEHOLDER_URL });
  } else {
    try { img.style.display = "none"; } catch {}
    var noImg = document.createElement("div");
    noImg.className = "prc-noimg-label";
    noImg.textContent = config.languageLabels.noImage || "Sem imagem";
    noImg.style.minHeight = "100%";
    noImg.style.height = "100%";
    noImg.style.display = "flex";
    noImg.style.alignItems = "center";
    noImg.style.justifyContent = "center";
    noImg.style.textAlign = "center";
    noImg.style.padding = "12px";
    noImg.style.fontWeight = "600";
    card.querySelector(".cardImageContainer").prepend(noImg);
  }

  var mode = (HOVER_MODE === "inherit")
    ? (getConfig().globalPreviewMode === "studioMini" ? "studioMini" : "modal")
    : HOVER_MODE;

  setTimeoutfunction(() {
    if (card.isConnected) attachPreviewByMode(card, { ...item, Id: itemId, Name: itemName }, mode);
  }, 500);

  card.addEventListenerfunction("dblclick", (e) {
    try {
      e.preventDefault();
      e.stopPropagation();
      if (itemId && typeof playNow === "function") playNow(itemId);
    } catch {}
  });

  card.addEventListenerfunction("jms:cleanup", () { cleanupManagedImage(img); }, { once:true });
  return card;
}

function formatEpisodeLabel(ep) {
  if (!ep) return "";
  var s = Number(ep.ParentIndexNumber);
  var e = Number(ep.IndexNumber);
  var sTxt = Number.isFinite(s) && s > 0 ? "S" + (String(s).padStart(2,"0")) : "";
  var eTxt = Number.isFinite(e) && e > 0 ? "E" + (String(e).padStart(2,"0")) : "";
  var se = (sTxt || eTxt) ? (sTxt) + "${eTxt ? " • ${eTxt}" : \"\"}" : "";
  var name = ep.Name ? clampText(ep.Name, 38) : "";
  return se && name ? (se) + " • " + (name) : (se || name || "");
}

function formatSeasonLabel(season) {
  if (!season) return "";
  var s = Number(season.IndexNumber);
  var sTxt = Number.isFinite(s) && s > 0 ? "T" + (String(s).padStart(2,"0")) : "";
  var name = season.Name ? clampText(season.Name, 38) : "";
  return sTxt && name ? (sTxt) + " • " + (name) : (sTxt || name || "");
}

function formatEpisodeSubline(ep) {
  if (!ep) return "";

  var s = Number(ep.ParentIndexNumber);
  var e = Number(ep.IndexNumber);

  var sTxt = Number.isFinite(s) && s > 0 ? "S" + (String(s).padStart(2,"0")) : "";
  var eTxt = Number.isFinite(e) && e > 0 ? "E" + (String(e).padStart(2,"0")) : "";

  var se = (sTxt || eTxt) ? (sTxt) + "${eTxt ? " • ${eTxt}" : \"\"}" : "";
  var series = (ep.SeriesName || "").trim();

  if (series && se) return (series) + " • " + (se);
  return series || se || "";
}

function formatSeasonSubline(season) {
  if (!season) return "";

  var s = Number(season.IndexNumber);
  var sTxt = Number.isFinite(s) && s > 0 ? "S" + (String(s).padStart(2,"0")) : "";
  var series = (season.SeriesName || "").trim();

  if (series && sTxt) return (series) + " • " + (sTxt);
  return series || sTxt || "";
}

function getSeriesIdFromItem(it) {
  if (!it) return null;
  if (it.Type === "Episode") return it.SeriesId || null;
  if (it.Type === "Season") return it.SeriesId || it.ParentId || null;

  return null;
}

function isAudioPreviewItem(item) {
  if (!item) return false;
  var type = String(item.Type || "");
  return type === "Audio" || type === "MusicVideo";
}

function getMusicAlbumId(item) {
  if (!item) return null;
  if (item.Type === "MusicAlbum") return item.Id || null;
  if (isAudioPreviewItem(item)) return item.AlbumId || item.ParentId || null;
  return null;
}

function attachMusicPosterSources(items) {
  var list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return list;

  var albumIds = [];
  for (var it of list) {
    if (!it.Id) continue;
    if (it.Type === "MusicAlbum") {
      it.__posterSource = it;
      continue;
    }
    if (!isAudioPreviewItem(it)) continue;
    var albumId = getMusicAlbumId(it);
    if (albumId) albumIds.push(albumId);
  }

  var uniqAlbumIds = Array.from(new Set(albumIds.filter(Boolean)));
  if (!uniqAlbumIds.length) return list;

  var albums = [];
  try {
    albums = fetchItemsByIds(uniqAlbumIds);
  } catch (e) {
    console.warn("recentRows: music poster source resolve error:", e);
    return list;
  }

  var albumById = new Map((albums || []).filter(function(x) x.Id).map(function(x) [x.Id, x]));
  for (var it of list) {
    if (!it.Id || !isAudioPreviewItem(it) || it.__posterSource) continue;
    var albumId = getMusicAlbumId(it);
    var album = albumId ? albumById.get(albumId) : null;
    if (album) it.__posterSource = album;
  }
  return list;
}

function fetchAlbumPreviewTrackId(albumId) {
  var key = String(albumId || "").trim();
  if (!key || !STATE.userId) return null;
  if (__albumPreviewTrackCache.has(key)) {
    return __albumPreviewTrackCache.get(key);
  }

  var task = function(() {
    var url =
      "/Users/" + (STATE.userId) + "/Items?" +
      "ParentId=" + (encodeURIComponent(key)) + "&" +
      "IncludeItemTypes=Audio&Recursive=true&" +
      "Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
      "EnableUserData=true&" +
      "SortBy=ParentIndexNumber,IndexNumber,SortName,DateCreated&SortOrder=Ascending&Limit=1&" +
      "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
    try {
      var data = makeApiRequest(url);
      var best = Array.isArray(data.Items) ? data.Items.find(function(x) x.Id) : null;
      try {
        if (best.Id && STATE.db && STATE.scope) {
          upsertItemsBatchIdle(STATE.db, STATE.scope, [best], { timeout: 1500 });
        }
      } catch {}
      return best.Id || null;
    } catch (e) {
      console.warn("recentRows: album preview track resolve error:", e);
      return null;
    }
  })();

  __albumPreviewTrackCache.set(key, task);
  var resolved = task;
  __albumPreviewTrackCache.set(key, resolved);
  return resolved;
}

function resolveHeroPreviewItemId(item) {
  var itemId = resolveItemId(item);
  if (!itemId) return null;
  if (isAudioPreviewItem(item)) return itemId;
  if (item.Type === "MusicAlbum") {
    return fetchAlbumPreviewTrackId(itemId);
  }
  return itemId;
}

function createRowHeroCard(item, serverId, labelText, { showProgress = false } = {}) {
  var { itemId } = primeItemIdentity(item);
  var hero = document.createElement("div");
  hero.className = "dir-row-hero";
  if (itemId) hero.dataset.itemId = itemId;

  try {
    attachMusicPosterSources([item]);
  } catch {}

  var posterSource = item.__posterSource || item;
  var bgSrc = buildBackdropImageUrl(posterSource);
  var logo = buildLogoUrl(posterSource);
  var year = posterSource.ProductionYear || "";
  var plot = clampText(item.Overview || posterSource.Overview, 1200);
  var ageChip = formatOfficialRatingLabel(posterSource.OfficialRating || "");
  var isSeries = posterSource.Type === "Series";
  var isEpisode = item.Type === "Episode";
  var isSeason  = item.Type === "Season";
  var isMusicAlbum = item.Type === "MusicAlbum";
  var isAudio = isAudioPreviewItem(item);
  var isPhoto = item.Type === "Photo";
  var isPhotoAlbum = item.Type === "PhotoAlbum";
  var isVideo = item.Type === "Video";
  var isFolder = item.Type === "Folder";

  var runtimeTicks =
    item.Type === "Series" ? (item.CumulativeRunTimeTicks || posterSource.CumulativeRunTimeTicks) :
    item.Type === "Episode" ? (item.RunTimeTicks || posterSource.RunTimeTicks) :
    (item.RunTimeTicks || posterSource.RunTimeTicks);

  var runtime = formatRuntime(runtimeTicks);
  var heroProgress = showProgress ? getPlaybackPercent(item) : 0;
  var heroProgressPct = Math.round(heroProgress * 100);
  var heroProgressHtml = (showProgress && heroProgress > 0.02 && heroProgress < 0.999)
    ? "\n      <div class=\"dir-hero-progress-wrap\" aria-label=\"" + (escapeHtml(config.languageLabels.progress || "İlerleme")) + "\">\n        <div class=\"dir-hero-progress-bar\" style=\"width:" + (heroProgressPct) + "%\"></div>\n      </div>\n      <div class=\"dir-hero-progress-pct\">" + (heroProgressPct) + "%</div>\n    "
    : "";

  var typeLabel =
    isPhoto ? (config.languageLabels.photo || "Foto") :
    isPhotoAlbum ? (config.languageLabels.photoAlbum || "Álbum") :
    isMusicAlbum ? (config.languageLabels.album || "Álbum") :
    isAudio ? (config.languageLabels.track || "Faixa") :
    isVideo ? (config.languageLabels.video || "Vídeo") :
    isFolder ? (config.languageLabels.folder || "Pasta") :
    isEpisode ? (config.languageLabels.episode || "Episódio") :
    isSeries ? (config.languageLabels.dizi || "Série") :
    (config.languageLabels.film || "Filme");

  var heroSub = isEpisode ? formatEpisodeLabel(item) : (isSeason ? formatSeasonLabel(item) : "");
  var genres = Array.isArray(posterSource.Genres) ? posterSource.Genres.slice(0, 3).join(", ") : "";
  var runtimeWithIcons = runtime ? getRuntimeWithIcons(runtime) : "";
  var heroMetaItems = [];
  if (heroSub) {
    heroMetaItems.push({ text: heroSub, variant: "subline" });
  } else {
    if (ageChip) heroMetaItems.push({ text: ageChip, variant: "age" });
    if (year) heroMetaItems.push({ text: year, variant: "year" });
    if (runtimeWithIcons) heroMetaItems.push({ text: runtimeWithIcons, variant: "runtime" });
    if (genres) heroMetaItems.push({ text: genres, variant: "genres" });
  }
  var metaHtml = heroMetaItems.length
    ? heroMetaItems
        .mapfunction(({ text, variant })
          "<span class=\"dir-row-hero-meta dir-row-hero-meta--" + (variant) + "\">" + (escapeHtml(text)) + "</span>"
        )
        .join("")
    : "";
  var heroTitle =
    (isEpisode || isSeason)
      ? (item.SeriesName || posterSource.Name || item.Name)
      : (isAudio ? (item.Name || posterSource.Name || "") : (posterSource.Name || item.Name || ""));
  var heroLogoAltSuffix = (config.languageLabels && config.languageLabels.logoAltSuffix) || "logo";

  hero.innerHTML = "\n    <div class=\"dir-row-hero-bg-wrap\">\n      <img class=\"dir-row-hero-bg\"\n           alt=\"" + (escapeHtml(heroTitle)) + "\"\n           decoding=\"async\"\n           loading=\"" + (IS_MOBILE ? "eager" : "lazy") + "\"\n           " + (IS_MOBILE ? 'fetchpriority="high"' : "") + ">\n    </div>\n\n    <div class=\"dir-row-hero-inner\">\n      <div class=\"dir-row-hero-meta-container\">\n        <div class=\"dir-row-hero-label\">" + (escapeHtml(labelText || "")) + "</div>\n\n        ${logo ? "
          <div class="dir-row-hero-logo">
            <img src="${logo}" alt="${escapeHtml((heroTitle) + " " + (heroLogoAltSuffix).trim())}">
          </div>
        " : ""}\n\n        <div class=\"dir-row-hero-title\">" + (escapeHtml(heroTitle)) + "</div>\n\n        ${metaHtml ? "<div class="dir-row-hero-submeta">${metaHtml}</div>" : \"\"}\n\n        ${plot ? "<div class="dir-row-hero-plot">${escapeHtml(plot)}</div>" : \"\"}\n\n      </div>\n    </div>\n    " + (heroProgressHtml) + "\n  ";

  var openDetails = function(e) {
    try { e.preventDefault.(); e.stopPropagation.(); } catch {}
    var backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
    var originEl = hero.querySelector(".dir-row-hero-bg") || hero;
    try {
      if (!itemId) return;
      openDetailsModal({
        itemId,
        serverId,
        preferBackdropIndex: backdropIndex,
        originEl,
      });
    } catch (err) {
      console.warn("openDetailsModal failed (recent hero):", err);
    }
  };

  hero.addEventListener("click", openDetails);
  hero.tabIndex = 0;
  hero.addEventListenerfunction("keydown", (e) {
    if (e.key === "Enter" || e.key === " ") openDetails(e);
  });
    hero.classList.add("active");
  try {
    var backdropImg = hero.querySelector(".dir-row-hero-bg");
    if (backdropImg) {
      setManagedImageSource(backdropImg, bgSrc, { fallback: PLACEHOLDER_URL });
    }
  } catch (e) {
    console.warn("recentRows hero bg hydrate failed:", e);
  }

  try {
    var backdropImg = hero.querySelector(".dir-row-hero-bg");
    var RemoteTrailers =
      posterSource.RemoteTrailers ||
      posterSource.RemoteTrailerItems ||
      posterSource.RemoteTrailerUrls ||
      [];
    var previewItemId = resolveHeroPreviewItemId(item);

    createTrailerIframe({
      config,
      RemoteTrailers,
      slide: hero,
      backdropImg,
      itemId,
      previewItemId: previewItemId || itemId,
      serverId,
      detailsUrl: itemId ? getDetailsUrl(itemId, serverId) : "#",
      detailsText: config.languageLabels.details || "Detalhes",
      showDetailsOverlay: false,
    });
  } catch (err) {
    console.error("RecentRows hero createTrailerIframe hata:", err);
  }

  hero.addEventListenerfunction("jms:cleanup", () {
    try {
      var backdropImg = hero.querySelector(".dir-row-hero-bg");
      if (backdropImg) cleanupManagedImage(backdropImg);
    } catch {}
    detachPreviewHandlers(hero);
  }, { once: true });

  return hero;
}

function uniqById(items) {
  var seen = new Set();
  var out = [];
  for (var it of items || []) {
    if (!it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
  }
  return out;
}

function pickRandomIndex(n) {
  if (!Number.isFinite(n) || n <= 0) return -1;
  return Math.floor(Math.random() * n);
}

function fetchRecent(userId, type, limit, parentId) {
  var url =
    "/Users/" + (userId) + "/Items?" +
    "IncludeItemTypes=" + (encodeURIComponent(type)) + "&Recursive=true&Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
    "SortBy=DateCreated&SortOrder=Descending&Limit=" + (Math.max(10, limit * 2)) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
  try {
    var data = makeApiRequest(url);
    var items = Array.isArray(data.Items) ? data.Items : [];
    var out = uniqById(items).slice(0, limit);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: recent fetch error:", type, e);
    return [];
  }
}

function fetchContinue(userId, type, limit, parentId) {
  var url =
    "/Users/" + (userId) + "/Items?" +
    "Filters=IsResumable&MediaTypes=Video&IncludeItemTypes=" + (encodeURIComponent(type)) + "&Recursive=true&Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
    "SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=" + (Math.max(10, limit * 3)) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
  try {
    var data = makeApiRequest(url);
    var items = Array.isArray(data.Items) ? data.Items : [];
    var out = uniqByIdfunction(items
        .filter((it) isPartialPlaybackItem(it))
        .sortfunction((a, b) getLastPlayedTs(b) - getLastPlayedTs(a))
    ).slice(0, limit);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: continue fetch error:", type, e);
    return [];
  }
}

function getLastPlayedTs(it) {
  var ud = it.UserData || it.UserDataDto || null;
  var s = ud.LastPlayedDate || ud.LastPlayedDateUtc || it.DatePlayed || null;
  var t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function fetchRecentlyPlayedTracks(userId, limit, parentId) {
  var want = Math.max(30, limit * 6);
  var base =
    "/Users/" + (userId) + "/Items?" +
    "IncludeItemTypes=Audio&Recursive=true&Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
    "SortBy=DatePlayed&SortOrder=Descending&Limit=" + (want) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";

  var urlPlayed = base + "&Filters=IsPlayed";
  var normalize = function(data) {
    var items = Array.isArray(data.Items) ? data.Items : [];
    var played = items
      .filter(function(it) getLastPlayedTs(it) > 0)
      .sortfunction((a, b) getLastPlayedTs(b) - getLastPlayedTs(a));

    return uniqById(played).slice(0, limit);
  };

  try {
    var data = makeApiRequest(urlPlayed);
    var out = normalize(data);

    if (out.length < Math.min(limit, 6)) {
      data = makeApiRequest(base);
      out = normalize(data);
    }

    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}

    return out;
  } catch (e) {
    console.warn("recentRows: recently played tracks fetch error:", e);
    return [];
  }
}

function fetchItemsByIds(ids, { refreshUserData = false } = {}) {
  var clean = Array.isArray(ids) ? ids.map(function(x) String(x||"").trim()).filter(Boolean) : [];
  if (!clean.length) return [];

  var hydrated = [];
  try {
    if (!STATE.db || !STATE.scope) ensureRecentDb();
    if (STATE.db && STATE.scope) {
      hydrated = getItemsByIds(STATE.db, STATE.scope, clean);
    }
  } catch {}

  var hydratedById = new Map((hydrated || []).filter(function(x)x.Id).map(function(x) [x.Id, x]));
  var missing = clean.filter(function(id) !hydratedById.has(id));
  var networkIds = refreshUserData ? clean.slice() : missing;

  var fetched = [];
  if (networkIds.length) {
    var chunkSize = 100;
    var out = [];
    for (var i = 0; i < networkIds.length; i += chunkSize) {
      var chunk = networkIds.slice(i, i + chunkSize);
      var userScoped = !!STATE.userId;
      var basePath = userScoped ? "/Users/" + (STATE.userId) + "/Items" : "/Items";
      var url =
        (basePath) + "?Ids=" + (encodeURIComponent(chunk.join(","))) +
        "&Fields=" + (encodeURIComponent(COMMON_FIELDS)) +
        (userScoped ? "&EnableUserData=true" : "") +
        "&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
      try {
        var data = makeApiRequest(url);
        var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
        out.push(...items);
      } catch (e) {
        console.warn("recentRows: fetchItemsByIds missing fetch error:", e);
      }
    }
    fetched = uniqById(out);

    try {
      if (fetched.length && STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, fetched, { timeout: 1500 });
      }
    } catch {}
  }

  var fetchedById = new Map((fetched || []).filter(function(x)x.Id).map(function(x) [x.Id, x]));
  var final = [];
  var seen = new Set();
  for (var id of clean) {
    var it = fetchedById.get(id) || hydratedById.get(id) || null;
    if (!it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    final.push(it);
  }

  for (var it of fetched || []) {
    if (!it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    final.push(it);
  }
  return final;
}

function isRealTvEpisode(it) {
  if (!it) return false;
  if (it.Type !== "Episode") return false;
  var hasSeries = !!(it.SeriesId || (it.SeriesName && String(it.SeriesName).trim()));
  if (!hasSeries) return false;

  var epNo = Number(it.IndexNumber);
  if (!Number.isFinite(epNo) || epNo <= 0) return false;

  return true;
}

function fetchRecentEpisodes(userId, limit, parentId) {
  var url =
    "/Users/" + (userId) + "/Items?" +
    "IncludeItemTypes=Episode&Recursive=true&Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
    "ExcludeItemTypes=Playlist&" +
    "SortBy=DateCreated&SortOrder=Descending&Limit=" + (Math.max(20, limit * 3)) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";

  try {
    var data = makeApiRequest(url);
    var eps = Array.isArray(data.Items) ? data.Items : [];
    var uniqEps = uniqById(eps).filter(isRealTvEpisode);

    attachSeriesPosterSourceToEpsAndSeasons(uniqEps);

    return uniqEps.slice(0, limit);
  } catch (e) {
    console.warn("recentRows: recent episodes fetch error:", e);
    return [];
  }
}

function fetchContinueEpisodes(userId, limit, parentId) {
  var url =
    "/Users/" + (userId) + "/Items?" +
    "Filters=IsResumable&MediaTypes=Video&IncludeItemTypes=Episode&Recursive=true&Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
    "ExcludeItemTypes=Playlist&" +
    "SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=" + (Math.max(20, limit * 4)) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";

  try {
    var data = makeApiRequest(url);
    var eps = Array.isArray(data.Items) ? data.Items : [];
    var uniqEps = uniqByIdfunction(eps
        .filter((it) isPartialPlaybackItem(it))
        .sortfunction((a, b) getLastPlayedTs(b) - getLastPlayedTs(a))
    ).filter(isRealTvEpisode);

    attachSeriesPosterSourceToEpsAndSeasons(uniqEps);

    return uniqEps.slice(0, limit);
  } catch (e) {
    console.warn("recentRows: continue episodes fetch error:", e);
    return [];
  }
}

function fetchNextUpEpisodes(userId, limit) {
  var url =
    "/Shows/NextUp?" +
    "UserId=" + (encodeURIComponent(userId)) + "&" +
    "Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    "Limit=" + (Math.max(20, limit * 3)) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";

  try {
    var data = makeApiRequest(url);
    var eps = Array.isArray(data.Items) ? data.Items : [];
    var uniqEps = uniqById(eps).filter(isRealTvEpisode);

    attachSeriesPosterSourceToEpsAndSeasons(uniqEps);

    return uniqEps.slice(0, limit);
  } catch (e) {
    console.warn("recentRows: next up episodes fetch error:", e);
    return [];
  }
}

function attachSeriesPosterSourceToEpsAndSeasons(items) {
  var list = Array.isArray(items) ? items : [];
  if (!list.length) return list;

  var directSeriesIds = [];
  var needParentResolve = [];

  for (var it of list) {
    if (!it.Id) continue;
    var sid = getSeriesIdFromItem(it);
    if (sid) directSeriesIds.push(sid);
    else if (it.ParentId) needParentResolve.push(it.ParentId);
  }

  var seasonToSeries = new Map();
  var resolvedSeriesIds = [];
  if (needParentResolve.length) {
    var uniqParentIds = Array.from(new Set(needParentResolve.filter(Boolean)));
    var parents = fetchItemsByIds(uniqParentIds);
    for (var p of parents) {
      if (!p.Id) continue;
      var sid =
        (p.Type === "Season") ? (p.SeriesId || p.ParentId || null) :
        (p.Type === "Series") ? p.Id :
        null;
      if (sid) {
        seasonToSeries.set(p.Id, sid);
        resolvedSeriesIds.push(sid);
      }
    }
  }

  var allSeriesIds = Array.from(new Set([...directSeriesIds, ...resolvedSeriesIds].filter(Boolean)));
  if (!allSeriesIds.length) return list;

  var series = fetchItemsByIds(allSeriesIds);
  var seriesById = new Map((series || []).filter(function(s)s.Id).map(function(s) [s.Id, s]));

  for (var it of list) {
    if (!it) continue;

    var sid = getSeriesIdFromItem(it);
    if (!sid && it.ParentId) sid = seasonToSeries.get(it.ParentId) || null;
    var s = sid ? seriesById.get(sid) : null;
    if (s) it.__posterSource = s;
  }

  return list;
}

function fetchRecentGeneric(userId, limit, parentId) {
  var url =
    "/Users/" + (userId) + "/Items?" +
    "Recursive=true&Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
    "SortBy=DateCreated&SortOrder=Descending&Limit=" + (Math.max(10, limit * 2)) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
  try {
    var data = makeApiRequest(url);
    var items = Array.isArray(data.Items) ? data.Items : [];
    var out = uniqById(items).slice(0, limit);
    attachSeriesPosterSourceToEpsAndSeasons(out);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: other recent fetch error:", e);
    return [];
  }
}

function fetchContinueGeneric(userId, limit, parentId) {
  var url =
    "/Users/" + (userId) + "/Items?" +
    "Filters=IsResumable&MediaTypes=Video&Recursive=true&Fields=" + (encodeURIComponent(COMMON_FIELDS)) + "&" +
    "EnableUserData=true&" +
    (parentId ? "ParentId=" + (encodeURIComponent(parentId)) + "&" : "") +
    "SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=" + (Math.max(10, limit * 3)) + "&" +
    "ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo";
  try {
    var data = makeApiRequest(url);
    var items = Array.isArray(data.Items) ? data.Items : [];
    var out = uniqByIdfunction(items
        .filter((it) isPartialPlaybackItem(it))
        .sortfunction((a, b) getLastPlayedTs(b) - getLastPlayedTs(a))
    ).slice(0, limit);
    attachSeriesPosterSourceToEpsAndSeasons(out);
    try {
      if (STATE.db && STATE.scope) {
        upsertItemsBatchIdle(STATE.db, STATE.scope, out, { timeout: 1500 });
      }
    } catch {}
    return out;
  } catch (e) {
    console.warn("recentRows: other continue fetch error:", e);
    return [];
  }
}

function buildSectionSkeleton({ titleText, badgeType, onSeeAll }) {
  var section = document.createElement("section");
  section.className = "homeSection recent-row-section dir-row-section";

  var title = document.createElement("div");
  title.className = "sectionTitleContainer sectionTitleContainer-cards";

  var seeAllText = config.languageLabels.seeAll || "Tümünü gör";

  title.innerHTML = "\n    <h2 class=\"sectionTitle sectionTitle-cards dir-row-title\">\n      <span class=\"dir-row-title-text\" role=\"button\" tabindex=\"0\"\n        aria-label=\"" + (escapeHtml(seeAllText)) + ": " + (escapeHtml(titleText)) + "\">\n        " + (escapeHtml(titleText)) + "\n      </span>\n\n      <div class=\"dir-row-see-all\"\n          aria-label=\"" + (escapeHtml(seeAllText)) + "\"\n          title=\"" + (escapeHtml(seeAllText)) + "\">\n        " + (faIconHtml("chevronRight")) + "\n      </div>\n      <span class=\"dir-row-see-all-tip\">" + (escapeHtml(seeAllText)) + "</span>\n    </h2>\n  ";

  var titleBtn = title.querySelector(".dir-row-title-text");
  var seeAllBtn = title.querySelector(".dir-row-see-all");

  var doSeeAll = function(e) {
    try { e.preventDefault.(); e.stopPropagation.(); } catch {}
    if (typeof onSeeAll === "function") {
      try { onSeeAll(); } catch (err) { console.error("RecentRows seeAll error:", err); }
    }
  };

  if (titleBtn) {
    titleBtn.addEventListener("click", doSeeAll, { passive: false });
    titleBtn.addEventListenerfunction("keydown", (e) {
      if (e.key === "Enter" || e.key === " ") doSeeAll(e);
    });
  }
  if (seeAllBtn) seeAllBtn.addEventListener("click", doSeeAll, { passive: false });

  var heroHost = document.createElement("div");
  heroHost.className = "dir-row-hero-host";
  heroHost.style.display = getRecentRowsRuntimeConfig().showHeroCards ? "" : "none";

  var scrollWrap = document.createElement("div");
  scrollWrap.className = "personal-recs-scroll-wrap";
  try { scrollWrap.style.position = "relative"; } catch {}
  scrollWrap.classList.add("rr-scroll-pending");

  var btnL = document.createElement("button");
  btnL.className = "hub-scroll-btn hub-scroll-left";
  btnL.setAttribute("aria-label", config.languageLabels.scrollLeft || "Sola kaydır");
  btnL.setAttribute("aria-disabled", "true");
  btnL.disabled = true;
  btnL.style.visibility = "hidden";
  btnL.style.pointerEvents = "none";
  btnL.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z\"/></svg>";

  var row = document.createElement("div");
  row.className = "itemsContainer personal-recs-row";
  row.setAttribute("role", "list");

  var btnR = document.createElement("button");
  btnR.className = "hub-scroll-btn hub-scroll-right";
  btnR.setAttribute("aria-label", config.languageLabels.scrollRight || "Sağa kaydır");
  btnR.setAttribute("aria-disabled", "true");
  btnR.disabled = true;
  btnR.style.visibility = "hidden";
  btnR.style.pointerEvents = "none";
  btnR.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z\"/></svg>";

  scrollWrap.appendChild(btnL);
  scrollWrap.appendChild(row);
  scrollWrap.appendChild(btnR);

  section.appendChild(title);
  section.appendChild(heroHost);
  section.appendChild(scrollWrap);

  return { section, row, heroHost, scrollWrap, btnL, btnR };
}

function getBadgeText(type) {
  switch(type) {
    case 'new': return config.languageLabels.badgeNew || "Yeni";
    case 'continue': return config.languageLabels.badgeContinue || "Devam";
    case 'episode': return config.languageLabels.badgeEpisode || "Bölüm";
    case 'series': return config.languageLabels.badgeSeries || "Dizi";
    case 'movie': return config.languageLabels.badgeMovie || "Film";
    default: return config.languageLabels.badgeNew || "Yeni";
  }
}

function appendSection(sectionKey, sectionEl) {
  var scopedHost =
    STATE.hostEl.classList.contains.("homeSectionsContainer")
      ? STATE.hostEl
      : (STATE.hostEl.querySelector.(".homeSectionsContainer") || null);
  var parent = scopedHost || findRealHomeSectionsContainer() || getActiveHomePage() || document.body;
  if (!parent || !sectionEl) return;

  var owned = getManagedRecentRowsSections(sectionKey, parent);
  var lastOwned = owned[owned.length - 1] || null;
  if (lastOwned.parentElement === parent) {
    lastOwned.insertAdjacentElement("afterend", sectionEl);
  } else {
    appendToParent(parent, sectionEl);
  }
  STATE.hadMountedSections = true;
  try { keepManagedSectionsBelowNative(parent); } catch {}
}

function hasAnyManagedRecentRowsSections(sectionKeys = []) {
  return (sectionKeys || []).somefunction((sectionKey) getManagedRecentRowsSections(sectionKey).length > 0);
}

function isRecentRowsSelfHealDisabled() {
  try {
    var cfg = getConfig.() || config || {};
    return cfg.enableSlider === false;
  } catch {
    return false;
  }
}

function scheduleRecentRowsSelfHeal(reason = "mutation", delayMs = 180) {
  if (isRecentRowsSelfHealDisabled()) {
    __recentRowsSelfHealPending = false;
    if (__recentRowsSelfHealTimer) {
      clearTimeout(__recentRowsSelfHealTimer);
      __recentRowsSelfHealTimer = null;
    }
    if (reason !== "observer") {
      recentRowsTrace("self-heal:skip:slider-disabled", { reason });
    }
    return;
  }
  __recentRowsSelfHealPending = true;
  if (__recentRowsSelfHealTimer) return;
  __recentRowsSelfHealTimer = setTimeoutfunction(() {
    __recentRowsSelfHealTimer = null;
    if (!__recentRowsSelfHealPending) return;
    if (__recentMountPromise) {
      scheduleRecentRowsSelfHeal("post-mount", Math.max(220, delayMs | 0));
      return;
    }
    __recentRowsSelfHealPending = false;
    if (!STATE.hadMountedSections) return;
    if (!isRecentRowsHomeRoute() || !getActiveHomePage()) return;

    var cfg = getConfig();
    if (cfg.enableSlider === false) return;
    var runtimeCfg = getRecentRowsRuntimeConfig(cfg);
    var sectionKeys = getOrderedRecentRowSectionKeys(cfg, runtimeCfg);
    if (!sectionKeys.length) return;
    if (hasAnyManagedRecentRowsSections(sectionKeys)) return;

    recentRowsWarn("self-heal:remount", {
      reason,
      sectionKeys,
    });
    void mountRecentRowsLazy({ force: true });
  }, Math.max(120, delayMs | 0));
}

function bindRecentRowsSelfHealObserver() {
  if (isRecentRowsSelfHealDisabled()) return;
  if (__recentRowsSelfHealObserver || typeof MutationObserver !== "function") return;
  var target = document.body || document.documentElement || null;
  if (!target) return;

  __recentRowsSelfHealObserver = new MutationObserverfunction(() {
    scheduleRecentRowsSelfHeal("observer");
  });

  try {
    __recentRowsSelfHealObserver.observe(target, {
      childList: true,
      subtree: true,
    });
  } catch {
    __recentRowsSelfHealObserver = null;
  }
}

function isDeferredRecentRowsSection(sectionKey) {
  return (
    sectionKey === "top10SeriesRows" ||
    sectionKey === "top10MovieRows" ||
    sectionKey === "tmdbTopMoviesRows"
  );
}

function hasMountedRecentRowsShell(sectionKey) {
  return getManagedRecentRowsSections(sectionKey).length > 0;
}

function hasAcceptedRecentRowsMountState(sectionKey) {
  if (hasRenderableRecentRowsContent(sectionKey)) return true;
  if (!isDeferredRecentRowsSection(sectionKey)) return false;
  return hasMountedRecentRowsShell(sectionKey);
}

function fillSectionWithItems({
  sectionKey = "recentRows",
  sectionId = "",
  titleText,
  badgeType = 'new',
  heroLabel,
  fetcher,
  cardCount,
  showProgress,
  onSeeAll,
  randomHero = false,
  hideHero = false,
  sectionClassName = "",
  rowClassName = "",
  cardVariant = "default",
  allowEmptyRow = false,
  emptyMessage = "",
  deferNetworkRender = false,
}) {
  var { section, row, heroHost, scrollWrap, btnL, btnR } = buildSectionSkeleton({
    titleText,
    badgeType,
    onSeeAll
  });
  var resolveEmptyMessage = function() {
    var raw = typeof emptyMessage === "function" ? emptyMessage() : emptyMessage;
    return String(raw || config.languageLabels.noRecommendations || "Uygun içerik yok").trim();
  };
  var runtimeCfg = getRecentRowsRuntimeConfig();
  var useHero = runtimeCfg.showHeroCards && !hideHero;
  if (sectionClassName) section.classList.add(...String(sectionClassName).split(/\s+/).filter(Boolean));
  if (rowClassName) row.classList.add(...String(rowClassName).split(/\s+/).filter(Boolean));
  if (!useHero) heroHost.style.display = "none";
  if (sectionId) section.id = sectionId;
  section.dataset.managedSectionKey = sectionKey;

  try {
    waitForManagedHomeRowRelease({
      anchor: getRecentRowsSectionAnchor(sectionKey, STATE.hostEl || getActiveHomePage() || document),
      eagerRows: RECENT_ROWS_EAGER_RELEASE_COUNT,
      timeoutMs: 25000,
      rootMargin: RECENT_ROWS_RELEASE_ROOT_MARGIN,
    });
  } catch {}
  appendSection(sectionKey, section);
  try { registerManagedHomeRowAnchor(section); } catch {}

  var __renderToken = (Date.now() ^ (Math.random()*1e9)) | 0;
  section.__renderToken = __renderToken;
  var __renderPass = 0;
  var progressiveHandle = null;

  var isRenderCurrent = function() (
    section.__renderToken === __renderToken &&
    !!section.isConnected &&
    isRecentRowsHomeRoute() &&
    !!section.closest.("#indexPage, #homePage").isConnected
  );

  var stopProgressiveRender = function() {
    try { progressiveHandle.cancel.(); } catch {}
    progressiveHandle = null;
  };

  var finalizeScroller = function() {
    setupScroller(row);
    try { scrollWrap.classList.remove("rr-scroll-pending"); } catch {}
    try {
      if (btnL) { btnL.style.visibility = ""; btnL.style.pointerEvents = ""; btnL.disabled = false; }
      if (btnR) { btnR.style.visibility = ""; btnR.style.pointerEvents = ""; btnR.disabled = false; }
    } catch {}
  };

  var renderEmptyState = function(message) {
    stopProgressiveRender();
    if (!isRenderCurrent()) return false;
    row.innerHTML = "<div class=\"no-recommendations\">" + (escapeHtml(message)) + "</div>";
    finalizeScroller();
    return true;
  };

  var removeSection = function() {
    stopProgressiveRender();
    try { section.parentElement.removeChild(section); } catch {}
    return false;
  };

  var renderResolvedItems = function(sourceItems, { aboveFoldLimit = 2 } = {}) {
    stopProgressiveRender();
    var renderPass = ++__renderPass;
    var isPassCurrent = function() isRenderCurrent() && __renderPass === renderPass;
    if (!Array.isArray(sourceItems) || !sourceItems.length || !isRenderCurrent()) {
      return false;
    }

    var pool = sourceItems.slice();
    attachMusicPosterSources(pool);
    if (!isPassCurrent()) return false;

    var best = null;
    if (useHero && pool.length) {
      if (randomHero) {
        var idx = pickRandomIndex(pool.length);
        best = idx >= 0 ? pool[idx] : pool[0];
      } else {
        best = pool[0];
      }
    }

    var remaining = useHero && best
      ? pool.filterfunction((x) x.Id && x.Id !== best.Id)
      : pool.slice();

    heroHost.innerHTML = "";
    if (useHero && best) {
      var hero = createRowHeroCard(best, STATE.serverId, heroLabel, { showProgress });
      if (!isPassCurrent()) return false;
      heroHost.appendChild(hero);
      queueEnterAnimation(hero);
    }

    row.innerHTML = "";
    if (!remaining.length) {
      return renderEmptyState(config.languageLabels.noRecommendations || "Uygun içerik yok");
    }
    var targetCount = Math.min(cardCount, remaining.length);
    var scrollerReady = false;
    var requestScrollSync = function() {
      try {
        if (!row.__rrScrollRaf) {
          row.__rrScrollRaf = requestAnimationFramefunction(() {
            row.__rrScrollRaf = 0;
            try { row.dispatchEvent(new Event("scroll")); } catch {}
          });
        }
      } catch {}
    };

    return new Promisefunction((resolve) {
      progressiveHandle = progressivelyRenderCardRow({
        row,
        items: remaining,
        limit: targetCount,
        initialCount: Math.min(
          targetCount,
          IS_MOBILE
            ? Math.max(2, Math.min(targetCount, aboveFoldLimit))
            : Math.max(3, Math.min(5, targetCount))
        ),
        chunkSize: IS_MOBILE ? 2 : 3,
        delayMs: IS_MOBILE ? 78 : 32,
        isCurrent: isPassCurrent,
        appendCard: function(item, index) createRecommendationCard(item, STATE.serverId, {
          aboveFold: index < Math.max(1, Math.min(aboveFoldLimit, IS_MOBILE ? 2 : 4)),
          showProgress,
          variant: cardVariant,
          rank: cardVariant === "top10" ? (index + 1) : null
        }),
        onAppend: function() {
          if (!scrollerReady) {
            finalizeScroller();
            scrollerReady = true;
          } else {
            requestScrollSync();
          }
        },
        onComplete: function({ aborted = false } = {}) {
          progressiveHandle = null;
          if (isPassCurrent()) {
            if (!scrollerReady) {
              finalizeScroller();
            } else {
              requestScrollSync();
            }
          }
          resolve(!aborted && isPassCurrent());
        }
      });
    });
  };

  var cachedItems = [];
  var cachedFresh = false;
  try {
    if (typeof fetcher.cachedItems === "function") {
      var cached = fetcher.cachedItems();
      if (Array.isArray(cached)) {
        cachedItems = cached;
      } else {
        cachedItems = Array.isArray(cached.items) ? cached.items : [];
        cachedFresh = !!cached.fresh;
      }
    }
  } catch {}

  if (cachedItems.length) {
    try {
      renderResolvedItems(cachedItems, { aboveFoldLimit: 2 });
    } catch {}
  }

  if (cachedFresh) {
    return true;
  }

  var fetchAndRender = function() {
    var items = [];
    try {
      items = fetcher();
    } catch (e) {
      console.warn("recentRows: fillSection fetcher error:", e);
      items = [];
    }

    if (!isRenderCurrent()) {
      return false;
    }

    if (!items.length) {
      if (!cachedItems.length) {
        if (allowEmptyRow) {
          return renderEmptyState(resolveEmptyMessage());
        }
        return removeSection();
      }
      return true;
    }

    if (cachedItems.length) {
      var compareCount = cardCount + (useHero ? 1 : 0);
      var a = cachedItems.mapfunction((x) x.Id).filter(Boolean).slice(0, compareCount);
      var b = items.mapfunction((x) x.Id).filter(Boolean).slice(0, compareCount);
      if (sameIdList(a, b)) {
        var progressUnchanged =
          !showProgress ||
          samePlaybackProgressByOrder(cachedItems, items, compareCount);
        if (progressUnchanged) return true;
      }
    }

    return renderResolvedItems(items, {
      aboveFoldLimit: IS_MOBILE ? 4 : 6
    });
  };

  if (deferNetworkRender) {
    void fetchAndRender();
    return true;
  }

  return fetchAndRender();
}

function getActiveHomePage() {
  var visiblePage =
    getActiveHomePageEl.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    null;
  if (visiblePage.isConnected) {
    return visiblePage;
  }
  var mountedPage = getMountedRecentRowsPage();
  if (mountedPage.isConnected) {
    return mountedPage;
  }
  return null;
}

function findRealHomeSectionsContainer() {
  var page = getActiveHomePage();
  if (!page) return null;
  var hsc = page.querySelector(".homeSectionsContainer");
  return (hsc && hsc.isConnected) ? hsc : null;
}

function pickRecentRowsParentAndAnchor() {
  var hsc = findRealHomeSectionsContainer();
  if (hsc) {
    return { parent: hsc, anchor: null, prepend: false };
  }

  var homeSectionsConfig = getHomeSectionsRuntimeConfig(getLiveConfig());
  var pr = document.getElementById("personal-recommendations");
  if (homeSectionsConfig.enablePersonalRecommendations && pr) {
    var titleEl =
      pr.querySelector("h2.sectionTitle.sectionTitle-cards.prc-title") ||
      pr.querySelector(".sectionTitleContainer.sectionTitleContainer-cards") ||
      pr.querySelector(".prc-title") ||
      null;

    if (titleEl) {
      return { parent: titleEl.parentElement || pr, anchor: titleEl };
    }
    if (pr.parentElement) {
      return { parent: pr.parentElement, anchor: pr, prepend: false };
    }
  }
  return { parent: document.body, anchor: null, prepend: false };
}

function appendToParent(parent, node) {
  if (!parent || !node) return;
  if (node.parentElement === parent && node === parent.lastElementChild) return;
  parent.appendChild(node);
}

function insertAfter(parent, node, ref) {
  if (!parent || !node) return;
  if (ref && ref.parentElement === parent) {
    ref.insertAdjacentElement("afterend", node);
  } else {
    appendToParent(parent, node);
  }
}

function insertFirst(parent, node) {
  if (!parent || !node) return;
  if (parent.firstElementChild) parent.insertBefore(node, parent.firstElementChild);
  else appendToParent(parent, node);
}

function ensureRecentRowsPlacement(wrap) {
  var { parent, anchor, prepend } = pickRecentRowsParentAndAnchor();

  if (wrap.parentElement !== parent) {
    if (prepend) insertFirst(parent, wrap);
    else insertAfter(parent, wrap, anchor);
    return true;
  }

  if (anchor && wrap.previousElementSibling !== anchor) {
    insertAfter(parent, wrap, anchor);
    return true;
  }

  if (prepend && wrap !== parent.firstElementChild) {
    insertFirst(parent, wrap);
    return true;
  }
  return false;
}

function cleanupLegacyRecentRowsWrap(sectionKey) {
  var meta = getRecentRowSectionMeta(sectionKey);
  var wrap = document.getElementById(meta.id);
  if (!wrap) return;
  try {
    wrap.replaceChildren();
  } catch {}
  try { wrap.remove(); } catch {}
}

function hasRenderableRecentRowsContent(sectionKey) {
  return getManagedRecentRowsSections(sectionKey).somefunction((section) !!section.querySelector(
    ".personal-recs-card, .no-recommendations, .dir-row-hero"
  ));
}

function resolveRecentRowsMountState(homeParent = null, targetPage = null) {
  var page =
    (targetPage.isConnected ? targetPage : null) ||
    getMountedRecentRowsPage() ||
    getActiveHomePage() ||
    null;
  var container =
    (homeParent.isConnected ? homeParent : null) ||
    page.querySelector.(".homeSectionsContainer") ||
    findRealHomeSectionsContainer() ||
    null;
  return { page, container };
}

function isRecentRowsMountStateValid(state) {
  return !!state.page.isConnected && !!state.container.isConnected && isRecentRowsHomeRoute();
}

function getRecentRowsSectionAnchor(sectionKey, root = null) {
  var sections = getManagedRecentRowsSections(sectionKey, root || getActiveHomePage() || document);
  return sections.length ? sections[sections.length - 1] : null;
}

function clearRecentRowsRetry() {
  if (__recentRowsRetryTo) {
    clearTimeout(__recentRowsRetryTo);
    __recentRowsRetryTo = null;
  }
}

function scheduleRecentRowsRetry(ms = 1000, options = {}, reason = "retry") {
  clearRecentRowsRetry();
  recentRowsWarn("retry:scheduled", {
    delayMs: Math.max(120, ms | 0),
    reason,
    force: options.force === true,
  });
  __recentRowsRetryTo = setTimeoutfunction(() {
    __recentRowsRetryTo = null;
    void mountRecentRowsLazy(options);
  }, Math.max(120, ms | 0));
}

function mountRecentRowsSection(sectionKey, { force = false, options = {}, homeParent = null } = {}) {
  var mountState = resolveRecentRowsMountState(homeParent);
  if (mountState.container.isConnected) {
    STATE.hostEl = mountState.container;
  }

  if (!force && hasAcceptedRecentRowsMountState(sectionKey)) {
    recentRowsLog("mount:skip:already-rendered", {
      force,
      sectionKey,
      sectionCount: getManagedRecentRowsSections(sectionKey).length,
    });
    clearRecentRowsRetry();
    setManagedRecentRowsDone(sectionKey, true);
    try { mountState.container.__jmsManagedBelowNativeSchedule.(); } catch {}
    return true;
  }

  try {
    setManagedRecentRowsDone(sectionKey, false);
    return enqueueManagedSectionRenderfunction(sectionKey, () {
      var currentMountState = resolveRecentRowsMountState(homeParent, mountState.page);
      if (!isRecentRowsMountStateValid(currentMountState)) {
        recentRowsWarn("mount:retry:container-invalid", {
          force,
          sectionKey,
          hasPage: !!currentMountState.page,
          hasContainer: !!currentMountState.container,
        });
        scheduleRecentRowsRetry(800, options, "container-invalid:" + (sectionKey));
        return false;
      }
      STATE.hostEl = currentMountState.container;
      recentRowsLog("render:start", {
        force,
        sectionKey,
        sectionCount: getManagedRecentRowsSections(sectionKey).length,
      });
      cleanupManagedRecentRowsSections(sectionKey, currentMountState.container);
      cleanupLegacyRecentRowsWrap(sectionKey);
      initAndRender({
        sectionKey,
        mountState: currentMountState,
      });
      if (!hasAcceptedRecentRowsMountState(sectionKey)) {
        recentRowsWarn("render:done-but-empty", {
          force,
          sectionKey,
          sectionCount: getManagedRecentRowsSections(sectionKey).length,
        });
        scheduleRecentRowsRetry(1400, options, "render-done-but-empty:" + (sectionKey));
        return false;
      }
      recentRowsLog("render:success", {
        force,
        sectionKey,
        sectionCount: getManagedRecentRowsSections(sectionKey).length,
      });
      clearRecentRowsRetry();
      try { currentMountState.container.__jmsManagedBelowNativeSchedule.(); } catch {}
      return true;
    }, {
      timeoutMs: 25000,
      force,
      getAnchor: function() getRecentRowsSectionAnchor(sectionKey, mountState.container),
      isStillValid: function() isRecentRowsMountStateValid(
        resolveRecentRowsMountState(homeParent, mountState.page)
      ),
    });
  } catch (e) {
    console.error(e);
    recentRowsWarn("render:error", {
      force,
      sectionKey,
      error: e.message || String(e),
    });
    scheduleRecentRowsRetry(1400, options, "render-error:" + (sectionKey));
    return false;
  }
}

export function mountRecentRowsLazy(options = {}) {
  bindRecentRowsSelfHealObserver();
  var force = options.force === true;
  if (__recentMountPromise) {
    if (!force) {
      recentRowsLog("mount:skip:existing-promise", { force });
      return __recentMountPromise;
    }
    recentRowsWarn("mount:force:await-existing-promise", { force });
    try { __recentMountPromise; } catch {}
  }
  if (!getActiveHomePage() && !isRecentRowsHomeRoute()) {
    recentRowsWarn("mount:skip:not-home", { force });
    return false;
  }
  var cfg = getConfig();
  var runtimeCfg = getRecentRowsRuntimeConfig(cfg);
  var sectionKeys = getOrderedRecentRowSectionKeys(cfg, runtimeCfg);
  var anyEnabled = sectionKeys.length > 0;

  if (!anyEnabled) {
    recentRowsLog("mount:skip:disabled", { force });
    clearRecentRowsRetry();
    cleanupRecentRows();
    return;
  }
  recentRowsLog("mount:start", {
    force,
    sectionKeys,
    anyEnabled,
  });
  recentRowsTrace("mount:start", {
    force,
    sectionKeys,
    anyEnabled,
    tmdbEnabled: runtimeCfg.enableTmdbTopMovies === true,
    top10SeriesEnabled: runtimeCfg.enableTop10Series === true,
    top10MovieEnabled: runtimeCfg.enableTop10Movies === true,
    lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    stack: force ? buildTraceStack() : "",
  });

  var run = function(() {
    if (force) {
      recentRowsWarn("mount:force:cleanup-before-render", { force });
      cleanupRecentRows();
    }

    var host = waitForVisibleHomeSections({
      timeout: 12000
    });
    if (!host.container || !getActiveHomePage()) {
      recentRowsWarn("mount:retry:no-visible-home-sections", {
        force,
        hostPageId: host.page.id || null,
        hasContainer: !!host.container,
      });
      scheduleRecentRowsRetry(1000, options, "no-visible-home-sections");
      return false;
    }
    var homeParent = findRealHomeSectionsContainer();
    if (!homeParent) {
      recentRowsWarn("mount:retry:no-homeSectionsContainer", {
        force,
        hostPageId: host.page.id || null,
      });
      scheduleRecentRowsRetry(900, options, "no-homeSectionsContainer");
      return false;
    }
    bindManagedSectionsBelowNative(homeParent);
    recentRowsTrace("mount:host-ready", {
      force,
      sectionKeys,
      hostPageId: host.page.id || null,
      activePageId: getActiveHomePage().id || null,
      homeParentChildCount: homeParent.children.length || 0,
    });
    for (var key of Object.keys(RECENT_ROW_SECTION_META)) {
      if (sectionKeys.includes(key)) continue;
      recentRowsTrace("mount:cleanup-disabled-section", {
        activeSectionKey: key,
        requestedSectionKeys: sectionKeys.slice(),
      });
      cleanupManagedRecentRowsSections(key, document);
      cleanupLegacyRecentRowsWrap(key);
      setManagedRecentRowsDone(key, false);
    }

    // Queue every managed recent-row section up front so the global managed
    // render queue can see the full dependency chain before lower-priority
    // modules like directorRows are allowed to advance.
    var scheduledSectionRuns = sectionKeys.mapfunction((sectionKey) {
      recentRowsTrace("mount:section:start", {
        sectionKey,
        force,
        stack: force ? buildTraceStack() : "",
      });
      return {
        sectionKey,
        promise: mountRecentRowsSection(sectionKey, { force, options, homeParent }),
      };
    });

    var allOk = true;
    for (var { sectionKey, promise } of scheduledSectionRuns) {
      var ok = promise;
      recentRowsTrace("mount:section:done", {
        sectionKey,
        force,
        ok,
      });
      if (ok === false) {
        allOk = false;
      }
    }
    return allOk;
  })();

  __recentMountPromise = run;
  try {
    return run;
  } finally {
    if (__recentMountPromise === run) {
      __recentMountPromise = null;
    }
    if (STATE.hadMountedSections) {
      scheduleRecentRowsSelfHeal("mount-finalize", 260);
    }
  }
}

function getPinnedHomeContainer() {
  var root = getActiveHomePage();
  if (!root) return null;
  var scroller = root.querySelector(
    ".padded-top-focusscale.padded-bottom-focusscale.emby-scroller"
  );
  if (scroller) return { parent: scroller.parentElement || document.body, anchor: scroller };
  var vertical = root.querySelector(
    ".verticalSection.verticalSection-extrabottompadding"
  );
  if (vertical) return { parent: vertical, anchor: null };
  return null;
}

function yieldRecentRowsSectionStep(timeout = IS_MOBILE ? 96 : 40) {
  return new Promisefunction((resolve) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallbackfunction(() resolve(), {
        timeout: Math.max(24, timeout | 0)
      });
      return;
    }
    setTimeout(resolve, Math.max(16, timeout | 0));
  });
}

function initAndRender({ sectionKey = "recentRows", mountState = null } = {}) {
  if (!isRecentRowsMountStateValid(mountState)) return;
  var mountKey = mountState.page || mountState.container;
  if (STATE.started) {
    var stale =
      !STATE.wrapEl ||
      !STATE.wrapEl.isConnected ||
      (mountKey && STATE.wrapEl !== mountKey);
    if (stale) {
      STATE.started = false;
      STATE.wrapEl = null;
      STATE.hostEl = null;
      STATE.serverId = null;
      STATE.userId = null;
      STATE.defaultTvHash = null;
      STATE.defaultMoviesHash = null;
      STATE.defaultMusicHash = null;
      STATE.movieLibs = [];
      STATE.tvLibs = [];
      STATE.otherLibs = [];
    }
  }
  try {
    if (typeof waitForAuthReadyStrict === "function") {
      waitForAuthReadyStrict(5000);
    }
  } catch {}
  var { userId, serverId } = getSessionInfo();
  if (!userId) return;

  STATE.started = true;
  STATE.wrapEl = mountKey;
  STATE.hostEl = mountState.container || findRealHomeSectionsContainer() || STATE.hostEl || getActiveHomePage() || mountKey;
  STATE.userId = userId;
  STATE.serverId = serverId;
  setManagedRecentRowsDone(sectionKey, false);

  try {
    ensureRecentDb();
    resolveDefaultPages(userId);
    var runtimeCfg = getRecentRowsRuntimeConfig();
    recentRowsTrace("init:runtime", {
      sectionKey,
      userId,
      serverId,
      tmdbEnabled: runtimeCfg.enableTmdbTopMovies === true,
      top10SeriesEnabled: runtimeCfg.enableTop10Series === true,
      top10MovieEnabled: runtimeCfg.enableTop10Movies === true,
    });

    var top10SeriesPlans = [];
    var top10MoviePlans  = [];
    var tmdbTopMoviePlans = [];
    var recentPlans      = [];
    var continuePlans    = [];
    var nextUpPlans      = [];
    var episodePlans     = [];
    var pushPlan = function(bucket, fn) { if (typeof fn === "function") bucket.push(fn); };
    var plannedSectionIndex = 0;
    var buildManagedSection = function(options) fillSectionWithItems({
      sectionKey,
      sectionId: makeManagedRecentRowsSectionId(sectionKey, plannedSectionIndex++),
      ...options,
    });

  if (runtimeCfg.enableTop10Series) {
    var topSeriesParentIds = getTopSeriesParentIds();
    var topSeriesMetaType = buildTopRowMetaType("Series", topSeriesParentIds);
    pushPlanfunction(top10SeriesPlans, () buildManagedSectionfunction({
      titleText: config.languageLabels.top10Series || "Top 10 Séries",
      badgeType: "series",
      heroLabel: "",
      cardCount: TOP10_ROW_CARD_COUNT,
      showProgress: false,
      hideHero: true,
      sectionClassName: "top10-section",
      rowClassName: "top10-row",
      cardVariant: "top10",
      deferNetworkRender: false,
      fetcher: Object.assign(
        () fetchTopRankedUnplayedFirstAcrossParents(userId, "Series", TOP10_CACHE_POOL_SIZE, topSeriesParentIds).thenfunction((items) {
          writeCachedListfunction("top", topSeriesMetaType, items.map((x) x.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: function() loadCachedLocalTop10Items("top", topSeriesMetaType, TTL_TOP10_MS)
        }
      ),
      onSeeAll: function() openLatestPage("Series")
    }));
  }

  if (runtimeCfg.enableTop10Movies) {
    var topMovieParentIds = getTopMovieParentIds();
    var topMovieMetaType = buildTopRowMetaType("Movie", topMovieParentIds);
    pushPlanfunction(top10MoviePlans, () buildManagedSectionfunction({
      titleText: config.languageLabels.top10Movies || "Top 10 Filmes",
      badgeType: "movie",
      heroLabel: "",
      cardCount: TOP10_ROW_CARD_COUNT,
      showProgress: false,
      hideHero: true,
      sectionClassName: "top10-section",
      rowClassName: "top10-row",
      cardVariant: "top10",
      deferNetworkRender: false,
      fetcher: Object.assign(
        () fetchTopRankedUnplayedFirstAcrossParents(userId, "Movie", TOP10_CACHE_POOL_SIZE, topMovieParentIds).thenfunction((items) {
          writeCachedListfunction("top", topMovieMetaType, items.map((x) x.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: function() loadCachedLocalTop10Items("top", topMovieMetaType, TTL_TOP10_MS)
        }
      ),
      onSeeAll: function() openLatestPage("Movie")
    }));
  }

  if (runtimeCfg.enableTmdbTopMovies) {
    var tmdbMovieParentIds = getTopMovieParentIds();
    var tmdbMovieMetaType = buildTopRowMetaType("TmdbMovie", tmdbMovieParentIds);
    var tmdbEmptyMessage = "";
    recentRowsTrace("tmdb:plan", {
      sectionKey,
      tmdbMovieParentIds,
      tmdbMovieMetaType,
    });
    pushPlanfunction(tmdbTopMoviePlans, () buildManagedSection({
      titleText: config.languageLabels.tmdbTopMovies || "Melhores Filmes (TMDb)",
      badgeType: "movie",
      heroLabel: "",
      cardCount: TOP10_ROW_CARD_COUNT,
      showProgress: false,
      hideHero: true,
      allowEmptyRow: true,
      emptyMessage: function() tmdbEmptyMessage,
      sectionClassName: "top10-section tmdb-top10-section",
      rowClassName: "top10-row tmdb-top10-row",
      cardVariant: "top10",
      deferNetworkRender: false,
      fetcher: Object.assignfunction(() {
          recentRowsTrace("tmdb:fetch:start", {
            sectionKey,
            tmdbMovieParentIds,
            limit: TOP10_ROW_CARD_COUNT,
          });
          var result = fetchTmdbTopRatedMoviesInLibraries(
            userId,
            TOP10_ROW_CARD_COUNT,
            tmdbMovieParentIds
          );
          tmdbEmptyMessage =
            result.reason === "missingKey"
              ? (config.languageLabels.tmdbKeyMissing || "Chave de API TMDb não configurada. Adicione nas configurações.")
              : (config.languageLabels.tmdbTopMoviesEmpty || "Nenhuma correspondência encontrada nas bibliotecas selecionadas.");
          var items = Array.isArray(result.items) ? result.items : [];
          recentRowsTrace("tmdb:fetch:done", {
            sectionKey,
            reason: result.reason || "",
            itemCount: items.length,
            emptyMessage: tmdbEmptyMessage,
          });
          writeCachedListfunction("tmdb_top", tmdbMovieMetaType, items.map((x) x.Id).filter(Boolean));
          return items;
        },
        {
          cachedItems: function() loadCachedRowItems("tmdb_top", tmdbMovieMetaType, TTL_TOP10_MS, {
            limit: TOP10_ROW_CARD_COUNT,
            refreshUserData: false,
            validateIds: false
          })
        }
      ),
      onSeeAll: function() openLatestPage("Movie")
    }));
  }

  if (runtimeCfg.enableRecentMovies) {
    var split = getConfig().recentRowsSplitMovieLibs === true;
    var movieLibIds = resolveMovieLibSelection();

    if (!split || !movieLibIds.length) {
      pushPlanfunction(recentPlans, () buildManagedSectionfunction({
        titleText: config.languageLabels.recentMovies || "Filmes adicionados recentemente",
        badgeType: "new",
        heroLabel: config.languageLabels.recentMoviesHero || "Filme adicionado recentemente",
        cardCount: runtimeCfg.effectiveRecentMoviesCount,
        showProgress: false,
        hideHero: runtimeCfg.showRecentMoviesHeroCards === false,
        fetcher: Object.assign(
            () fetchRecent(userId, "Movie", runtimeCfg.effectiveRecentMoviesCount + 1).thenfunction((items) {
            writeCachedList("recent", "Movie", items.map(function(x)x.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: function() loadCachedRowItems("recent", "Movie", TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveRecentMoviesCount + 1
            })
          }
        ),
        onSeeAll: function() openLatestPage("Movie")
      }));
    } else {
      for (var movieLibId of movieLibIds) {
        var libName = (STATE.movieLibs || []).find(function(x) x.Id === movieLibId).Name || "";
        pushPlanfunction(recentPlans, () buildManagedSection({
          titleText: (config.languageLabels.recentMovies || "Filmes adicionados recentemente") + (libName ? " • " + (libName) : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentMoviesHero || "Filme adicionado recentemente") + (libName ? " • " + (libName) : ""),
          cardCount: runtimeCfg.effectiveRecentMoviesCount,
          showProgress: false,
          hideHero: runtimeCfg.showRecentMoviesHeroCards === false,
          fetcher: Object.assignfunction(() fetchRecent(userId, "Movie", runtimeCfg.effectiveRecentMoviesCount + 1, movieLibId).thenfunction((items) {
              writeCachedList("recent", "Movie" + movieLibMetaSuffix(movieLibId), items.map(function(x)x.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: function() loadCachedRowItems("recent", "Movie" + movieLibMetaSuffix(movieLibId), TTL_RECENT_MS, {
                limit: runtimeCfg.effectiveRecentMoviesCount + 1
              })
            }
          ),
          onSeeAll: function() gotoHash(getMoviesLibraryHash(movieLibId))
        }));
      }
    }
  }

  if (runtimeCfg.enableRecentSeries) {
    var split = (getConfig().recentRowsSplitTvLibs !== false);
    var tvIds = resolveTvLibSelection("recentSeries");

    if (!split) {
      pushPlanfunction(recentPlans, () buildManagedSectionfunction({
        titleText: config.languageLabels.recentSeries || "Séries adicionadas recentemente",
        badgeType: "new",
        heroLabel: config.languageLabels.recentSeriesHero || "Série adicionada recentemente",
        cardCount: runtimeCfg.effectiveRecentSeriesCount,
        showProgress: false,
        hideHero: runtimeCfg.showRecentSeriesHeroCards === false,
        fetcher: Object.assign(
          () fetchRecent(userId, "Series", runtimeCfg.effectiveRecentSeriesCount + 1).thenfunction((items) {
            writeCachedList("recent", "Series", items.map(function(x)x.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: function() loadCachedRowItems("recent", "Series", TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveRecentSeriesCount + 1
            })
          }
        ),
        onSeeAll: function() openLatestPage("Series")
      }));
    } else {
      for (var tvLibId of tvIds) {
        var libName = (STATE.tvLibs || []).find(function(x) x.Id === tvLibId).Name || "";
        pushPlanfunction(recentPlans, () buildManagedSection({
          titleText: (config.languageLabels.recentSeries || "Séries adicionadas recentemente") + (libName ? " • " + (libName) : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentSeriesHero || "Série adicionada recentemente") + (libName ? " • " + (libName) : ""),
          cardCount: runtimeCfg.effectiveRecentSeriesCount,
          showProgress: false,
          hideHero: runtimeCfg.showRecentSeriesHeroCards === false,
          fetcher: Object.assignfunction(() fetchRecent(userId, "Series", runtimeCfg.effectiveRecentSeriesCount + 1, tvLibId).thenfunction((items) {
              writeCachedList("recent", "Series" + tvLibMetaSuffix(tvLibId), items.map(function(x)x.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: function() loadCachedRowItems("recent", "Series" + tvLibMetaSuffix(tvLibId), TTL_RECENT_MS, {
                limit: runtimeCfg.effectiveRecentSeriesCount + 1
              })
            }
          ),
          onSeeAll: function() gotoHash("#/tv?topParentId=" + (encodeURIComponent(tvLibId)) + "&collectionType=tvshows&tab=1")
        }));
      }
    }
  }

  if (runtimeCfg.enableRecentEpisodes) {
    var split = (getConfig().recentRowsSplitTvLibs !== false);
    var tvIds = resolveTvLibSelection("recentEpisodes");

    if (!split) {
      pushPlanfunction(recentPlans, () buildManagedSectionfunction({
        titleText: config.languageLabels.recentEpisodes || "Episódios Recentes",
        badgeType: "new",
        heroLabel: config.languageLabels.recentEpisodesHero || "Novo Episódio",
        cardCount: runtimeCfg.effectiveRecentEpisodesCount,
        showProgress: false,
        hideHero: runtimeCfg.showRecentEpisodesHeroCards === false,
        fetcher: Object.assign(
          () fetchRecentEpisodes(userId, runtimeCfg.effectiveRecentEpisodesCount + 1).thenfunction((items) {
            writeCachedList("recent", "Episode", items.map(function(x)x.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: function() loadCachedRowItems("recent", "Episode", TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveRecentEpisodesCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: function() openLatestPage("Episode")
      }));
    } else {
      for (var tvLibId of tvIds) {
        var libName = (STATE.tvLibs || []).find(function(x) x.Id === tvLibId).Name || "";
        pushPlanfunction(recentPlans, () buildManagedSection({
          titleText: (config.languageLabels.recentEpisodes || "Episódios Recentes") + (libName ? " • " + (libName) : ""),
          badgeType: "new",
          heroLabel: (config.languageLabels.recentEpisodesHero || "Novo Episódio") + (libName ? " • " + (libName) : ""),
          cardCount: runtimeCfg.effectiveRecentEpisodesCount,
          showProgress: false,
          hideHero: runtimeCfg.showRecentEpisodesHeroCards === false,
          fetcher: Object.assignfunction(() fetchRecentEpisodes(userId, runtimeCfg.effectiveRecentEpisodesCount + 1, tvLibId).thenfunction((items) {
              writeCachedList("recent", "Episode" + tvLibMetaSuffix(tvLibId), items.map(function(x)x.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: function() loadCachedRowItems("recent", "Episode" + tvLibMetaSuffix(tvLibId), TTL_RECENT_MS, {
                limit: runtimeCfg.effectiveRecentEpisodesCount + 1,
                afterLoad: attachSeriesPosterSourceToEpsAndSeasons
              })
            }
          ),
          onSeeAll: function() gotoHash("#/tv?topParentId=" + (encodeURIComponent(tvLibId)) + "&collectionType=tvshows&tab=1")
        }));
      }
    }
  }

  if (runtimeCfg.enableRecentMusic) {
    pushPlanfunction(recentPlans, () buildManagedSectionfunction({
      titleText: config.languageLabels.recentMusic || "Álbuns Recentes",
      badgeType: "new",
      heroLabel: config.languageLabels.recentMusicHero || "Novo Álbum",
      cardCount: runtimeCfg.effectiveRecentMusicCount,
      showProgress: false,
      hideHero: runtimeCfg.showRecentMusicHeroCards === false,
      fetcher: Object.assign(
        () fetchRecent(userId, "MusicAlbum", runtimeCfg.effectiveRecentMusicCount + 1).thenfunction((items) {
          writeCachedList("recent", "MusicAlbum", items.map(function(x)x.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: function() loadCachedRowItems("recent", "MusicAlbum", TTL_RECENT_MS, {
            limit: runtimeCfg.effectiveRecentMusicCount + 1
          })
        }
      ),
      onSeeAll: function() openLatestPage("MusicAlbum"),
      randomHero: false
    }));
  }

  if (runtimeCfg.enableContinueMovies) {
    pushPlanfunction(continuePlans, () buildManagedSection({
      titleText: config.languageLabels.continueMovies || "Continuar Assistindo (Filmes)",
      badgeType: "continue",
      heroLabel: config.languageLabels.continueMoviesHero || "Continuar: Filmes",
      cardCount: runtimeCfg.effectiveContinueMoviesCount,
      showProgress: true,
      hideHero: runtimeCfg.showContinueMoviesHeroCards === false,
      fetcher: Object.assignfunction(() fetchContinue(userId, "Movie", runtimeCfg.effectiveContinueMoviesCount + 1).thenfunction((items) {
          writeCachedList("resume", "Movie", items.map(function(x)x.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: function() loadCachedRowItems("resume", "Movie", TTL_CONTINUE_MS, {
            limit: runtimeCfg.effectiveContinueMoviesCount + 1
          })
        }
      ),
      onSeeAll: function() openResumePage("Movie"),
      randomHero: true
    }));
  }

  if (runtimeCfg.enableContinueSeries) {
    var split = (getConfig().recentRowsSplitTvLibs !== false);
    var tvIds = resolveTvLibSelection("continueSeries");

    if (!split) {
      pushPlanfunction(continuePlans, () buildManagedSection({
        titleText: config.languageLabels.continueSeries || "Continuar Assistindo (Séries)",
        badgeType: "continue",
        heroLabel: config.languageLabels.continueSeriesHero || "Continuar: Séries",
        cardCount: runtimeCfg.effectiveContinueSeriesCount,
        showProgress: true,
        hideHero: runtimeCfg.showContinueSeriesHeroCards === false,
        fetcher: Object.assignfunction(() fetchContinueEpisodes(userId, runtimeCfg.effectiveContinueSeriesCount + 1).thenfunction((items) {
            writeCachedList("resume", "Episode", items.map(function(x)x.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: function() loadCachedRowItems("resume", "Episode", TTL_CONTINUE_MS, {
              limit: runtimeCfg.effectiveContinueSeriesCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: function() openResumePage("Episode"),
        randomHero: true
      }));
    } else {
      for (var tvLibId of tvIds) {
        var libName = (STATE.tvLibs || []).find(function(x) x.Id === tvLibId).Name || "";
        pushPlanfunction(continuePlans, () buildManagedSection({
          titleText: (config.languageLabels.continueSeries || "Continuar Assistindo (Séries)") + (libName ? " • " + (libName) : ""),
          badgeType: "continue",
          heroLabel: (config.languageLabels.continueSeriesHero || "Continuar: Séries") + (libName ? " • " + (libName) : ""),
          cardCount: runtimeCfg.effectiveContinueSeriesCount,
          showProgress: true,
          hideHero: runtimeCfg.showContinueSeriesHeroCards === false,
          fetcher: Object.assignfunction(() fetchContinueEpisodes(userId, runtimeCfg.effectiveContinueSeriesCount + 1, tvLibId).thenfunction((items) {
              writeCachedList("resume", "Episode" + tvLibMetaSuffix(tvLibId), items.map(function(x)x.Id).filter(Boolean));
              return items;
            }),
            {
              cachedItems: function() loadCachedRowItems("resume", "Episode" + tvLibMetaSuffix(tvLibId), TTL_CONTINUE_MS, {
                limit: runtimeCfg.effectiveContinueSeriesCount + 1,
                afterLoad: attachSeriesPosterSourceToEpsAndSeasons
              })
            }
          ),
          onSeeAll: function() gotoHash("#/tv?topParentId=" + (encodeURIComponent(tvLibId)) + "&collectionType=tvshows&tab=1"),
          randomHero: true
        }));
      }
    }
  }

  if (runtimeCfg.enableNextUp) {
    pushPlanfunction(nextUpPlans, () buildManagedSectionfunction({
      titleText: config.languageLabels.nextUpEpisodes || "Próximos Episódios",
      badgeType: "episode",
      heroLabel: config.languageLabels.nextUpEpisodesHero || "Próximo Episódio",
      cardCount: runtimeCfg.effectiveNextUpCount,
      showProgress: true,
      hideHero: runtimeCfg.showNextUpHeroCards === false,
      fetcher: Object.assign(
        () fetchNextUpEpisodes(userId, runtimeCfg.effectiveNextUpCount + 1).thenfunction((items) {
          writeCachedListfunction("nextup", "Episode", items.map((x) x.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: function() loadCachedRowItems("nextup", "Episode", TTL_CONTINUE_MS, {
            limit: runtimeCfg.effectiveNextUpCount + 1,
            afterLoad: attachSeriesPosterSourceToEpsAndSeasons
          })
        }
      ),
      onSeeAll: function() gotoHash(STATE.defaultTvHash || DEFAULT_TV_PAGE),
      randomHero: true
    }));
  }

  if (runtimeCfg.enableOtherLibRows) {
    var otherIds = resolveOtherLibSelection();
    var otherDefs = otherIds.mapfunction((libId) {
      var lib = (STATE.otherLibs || []).find(function(x) x.Id === libId) || null;
      return {
        libId,
        libName: lib.Name || config.languageLabels.studioHubLibraryFallbackName || "Library"
      };
    });

    for (var { libId, libName } of otherDefs) {
      pushPlanfunction(recentPlans, () buildManagedSectionfunction({
        titleText: (config.languageLabels.otherLibRecent || "Novidades") + " • " + (libName),
        badgeType: "new",
        heroLabel: (config.languageLabels.otherLibRecentHero || "Novo") + " • " + (libName),
        cardCount: runtimeCfg.effectiveOtherRecentCount,
        showProgress: false,
        hideHero: runtimeCfg.showOtherLibrariesHeroCards === false,
        fetcher: Object.assign(
          () fetchRecentGeneric(userId, runtimeCfg.effectiveOtherRecentCount + 1, libId).thenfunction((items) {
            writeCachedList("other_recent", "lib:" + (libId), items.map(function(x)x.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: function() loadCachedRowItems("other_recent", "lib:" + (libId), TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveOtherRecentCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: function() gotoHash("#/list.html?parentId=" + (encodeURIComponent(libId)))
      }));
    }

    for (var { libId, libName } of otherDefs) {
      pushPlanfunction(continuePlans, () buildManagedSectionfunction({
        titleText: (config.languageLabels.otherLibContinue || "Continuar Assistindo") + " • " + (libName),
        badgeType: "continue",
        heroLabel: (config.languageLabels.otherLibContinueHero || "Continuar") + " • " + (libName),
        cardCount: runtimeCfg.effectiveOtherContinueCount,
        showProgress: true,
        hideHero: runtimeCfg.showOtherLibrariesHeroCards === false,
        fetcher: Object.assign(
          () fetchContinueGeneric(userId, runtimeCfg.effectiveOtherContinueCount + 1, libId).thenfunction((items) {
            writeCachedList("other_resume", "lib:" + (libId), items.map(function(x)x.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: function() loadCachedRowItems("other_resume", "lib:" + (libId), TTL_CONTINUE_MS, {
              limit: runtimeCfg.effectiveOtherContinueCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: function() gotoHash("#/list.html?parentId=" + (encodeURIComponent(libId)) + "&tab=resume"),
        randomHero: true
      }));
    }

    for (var { libId, libName } of otherDefs) {
      pushPlanfunction(episodePlans, () buildManagedSectionfunction({
        titleText: (config.languageLabels.recentEpisodes || "Episódios Recentes") + " • " + (libName),
        badgeType: "episode",
        heroLabel: (config.languageLabels.recentEpisodesHero || "Bölum") + " • " + (libName),
        cardCount: runtimeCfg.effectiveOtherEpisodesCount,
        showProgress: false,
        hideHero: runtimeCfg.showOtherLibrariesHeroCards === false,
        fetcher: Object.assign(
          () fetchRecentEpisodes(userId, runtimeCfg.effectiveOtherEpisodesCount + 1, libId).thenfunction((items) {
            writeCachedList("other_recent", "ep:" + (libId), items.map(function(x)x.Id).filter(Boolean));
            return items;
          }),
          {
            cachedItems: function() loadCachedRowItems("other_recent", "ep:" + (libId), TTL_RECENT_MS, {
              limit: runtimeCfg.effectiveOtherEpisodesCount + 1,
              afterLoad: attachSeriesPosterSourceToEpsAndSeasons
            })
          }
        ),
        onSeeAll: function() gotoHash("#/list.html?parentId=" + (encodeURIComponent(libId)) + "&includeItemTypes=Episode")
      }));
    }
  }

  if (runtimeCfg.enableRecentTracks) {
    pushPlanfunction(continuePlans, () buildManagedSection({
      titleText: (config.languageLabels.recentlyPlayedTracks || config.languageLabels.recRecentTracks) || "Músicas Recentes",
      badgeType: "continue",
      heroLabel: (config.languageLabels.recentlyPlayedTracksHero || config.languageLabels.recentTracksHero) || "Música Recente",
      cardCount: runtimeCfg.effectiveRecentTracksCount,
      showProgress: false,
      hideHero: runtimeCfg.showRecentTracksHeroCards === false,
      fetcher: Object.assignfunction(() fetchRecentlyPlayedTracks(userId, runtimeCfg.effectiveRecentTracksCount + 1).thenfunction((items) {
          writeCachedList("played", "Audio", items.map(function(x)x.Id).filter(Boolean));
          return items;
        }),
        {
          cachedItems: function() loadCachedRowItems("played", "Audio", TTL_CONTINUE_MS, {
            limit: runtimeCfg.effectiveRecentTracksCount + 1
          })
        }
      ),
      onSeeAll: function() openLatestPage("Audio"),
      randomHero: false
    }));
  }

    var runners = (
      sectionKey === "top10SeriesRows" ? [...top10SeriesPlans] :
      sectionKey === "top10MovieRows" ? [...top10MoviePlans] :
      sectionKey === "tmdbTopMoviesRows" ? [...tmdbTopMoviePlans] :
      sectionKey === "continueRows" ? [...continuePlans] :
      sectionKey === "nextUpRows" ? [...nextUpPlans] :
      [...recentPlans, ...episodePlans]
    );

    if (runners.length) {
      recentRowsTrace("init:runners", {
        sectionKey,
        runnerCount: runners.length,
      });
      for (var i = 0; i < runners.length; i++) {
        var run = runners[i];
        if (!isRecentRowsMountStateValid(mountState)) break;
        try {
          run();
        } catch (e) {
          console.warn("recentRows: runner error:", e);
        }
        if (i < runners.length - 1 && isRecentRowsMountStateValid(mountState)) {
          yieldRecentRowsSectionStep();
        }
      }
    }
  } finally {
    setManagedRecentRowsDone(sectionKey, true);
  }
}

export function cleanupRecentRows() {
  try {
    recentRowsLog("cleanup:start", {
      started: !!STATE.started,
      wrapConnected: !!STATE.wrapEl.isConnected,
    });
    recentRowsTrace("cleanup:start", {
      started: !!STATE.started,
      wrapConnected: !!STATE.wrapEl.isConnected,
      sectionShellCounts: Object.fromEntries(
        Object.keys(RECENT_ROW_SECTION_META).mapfunction((sectionKey) [
          sectionKey,
          getManagedRecentRowsSections(sectionKey, document).length,
        ])
      ),
      lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    });
    clearRecentRowsRetry();
    __recentMountPromise = null;
    Object.keys(RECENT_ROW_SECTION_META).forEach(function((sectionKey) {
      setManagedRecentRowsDone(sectionKey, false);
      cleanupManagedRecentRowsSections(sectionKey, document);
      cleanupLegacyRecentRowsWrap(sectionKey);
    });

    STATE.started = false;
    STATE.wrapEl = null;
    STATE.hostEl = null;
    STATE.serverId = null;
    STATE.userId = null;
    STATE.defaultTvHash = null;
    STATE.defaultMoviesHash = null;
    STATE.defaultMusicHash = null;
    STATE.movieLibs = [];
    STATE.tvLibs = [];
    STATE.otherLibs = [];
    STATE.hadMountedSections = false;
    __recentRowsSelfHealPending = false;
    if (__recentRowsSelfHealTimer) {
      clearTimeout(__recentRowsSelfHealTimer);
      __recentRowsSelfHealTimer = null;
    }
  } catch (e) {
    console.warn("recent rows cleanup error:", e);
  }
}

export function releaseRecentRowsDbConnection() {
  try { STATE.db.close.(); } catch {}
  STATE.db = null;
  STATE.scope = null;
}

(function bindRecentRowsDbReleaseOnce() {
  if (window.__jmsRecentRowsDbReleaseBound) return;
  window.__jmsRecentRowsDbReleaseBound = true;

  window.addEventListenerfunction('jms:indexeddb:release', (event) {
    var dbName = event.detail.dbName;
    if (!dbName || dbName === 'monwui_recent_db' || dbName === '*') {
      releaseRecentRowsDbConnection();
    }
  });
})();

function getHomeSectionsContainer(indexPage) {
  var page = indexPage ||
    getMountedRecentRowsPage() ||
    getActiveHomePageEl.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    document.body;

  return page.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
    page;
}
