//directorRows.js

import { getSessionInfo, makeApiRequest, getCachedUserTopGenres } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig, getHomeSectionsRuntimeConfig } from "./config.js";
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { openDirectorExplorer } from "./genreExplorer.js";
import { REOPEN_COOLDOWN_MS, getOpenHoverDelay } from "./hoverTrailerModal.js";
import { createTrailerIframe, formatOfficialRatingLabel } from "./utils.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import {
  withServer
} from "./jfUrl.js";
import { cleanupImageResourceRefs } from "./imageResourceCleanup.js";
import { faIconHtml } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import {
  cleanupManagedImage,
  progressivelyRenderCardRow,
  resolveManagedCardTitleRender,
  setManagedImageSource,
  setupScroller
} from "./personalRecommendations.js";
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
import {
  openDirRowsDB,
  makeScope,
  upsertDirector,
  upsertItem,
  linkDirectorItem,
  listDirectors,
  getItemsForDirector,
  deleteItemsAndRelationsByIds,
  getMeta,
  setMeta
} from "./dirRowsDb.js";

var config = getConfig();
var labels = getLanguageLabels.() || {};
var IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);
var UNIFIED_ROW_ITEM_LIMIT = 20;

var PLACEHOLDER_URL = resolveSliderAssetHref(
  config.placeholderImage || "/slider/src/images/placeholder.png"
);
var MIN_RATING = 0;
var SHOW_DIRECTOR_ROWS_HERO_CARDS = (config.showDirectorRowsHeroCards !== false);
var HOVER_MODE = (config.directorRowsHoverPreviewMode === 'studioMini' || config.directorRowsHoverPreviewMode === 'modal')
  ? config.directorRowsHoverPreviewMode
  : 'inherit';
var DIRECTOR_ROW_BATCH_SIZE = 1;
var DIRECTOR_ROW_FILL_YIELD_MS = IS_MOBILE ? 48 : 24;
var DIRECTOR_MOBILE_CARD_DELAY_MS = 90;
var HOME_DEBUG_STORAGE_KEY = "jms:debug:home-sections";
var HOME_TRACE_STORAGE_KEY = "jms:trace:home-sections";
var DIRECTOR_ROWS_RELEASE_ROOT_MARGIN = IS_MOBILE
  ? "0px 0px 60% 0px"
  : "0px 0px 22% 0px";
var DIRECTOR_ROWS_ARROW_OBSERVER_ROOT_MARGIN = IS_MOBILE
  ? "0px 0px 66% 0px"
  : "0px 0px 26% 0px";
var DIRECTOR_ROWS_ARROW_OBSERVER_THRESHOLD = IS_MOBILE ? 0.01 : 0.2;

function isDirectorRowsDebugEnabled() {
  try {
    if (window.__JMS_DEBUG_HOME_SECTIONS === true) return true;
    if (window.__JMS_DEBUG_HOME_SECTIONS === false) return false;
    var raw = localStorage.getItem(HOME_DEBUG_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return window.__JMS_DEBUG_HOME_SECTIONS === true;
  }
}

function buildDirectorRowsDebugPayload(payload) {
  var extra = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : { value: payload };
  return {
    at: new Date().toISOString(),
    hash: String(window.location.hash || ""),
    page: (
      document.querySelector("#indexPage:not(.hide)").id ||
      document.querySelector("#homePage:not(.hide)").id ||
      null
    ),
    ...extra,
  };
}

function dirRowsLog(event, payload = {}) {
  if (!isDirectorRowsDebugEnabled()) return;
  try { console.log("[JMS:DIRECTOR]", event, buildDirectorRowsDebugPayload(payload)); } catch {}
}

function dirRowsWarn(event, payload = {}) {
  if (!isDirectorRowsDebugEnabled()) return;
  try { console.warn("[JMS:DIRECTOR]", event, buildDirectorRowsDebugPayload(payload)); } catch {}
}

function isDirectorRowsTraceEnabled() {
  try {
    if (window.__JMS_TRACE_HOME_SECTIONS === true) return true;
    if (window.__JMS_TRACE_HOME_SECTIONS === false) return false;
    var raw = localStorage.getItem(HOME_TRACE_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return false;
  }
}

function dirRowsTrace(event, payload = {}) {
  if (!isDirectorRowsTraceEnabled()) return;
  try { console.warn("[JMS:DIRECTOR:TRACE]", event, buildDirectorRowsDebugPayload(payload)); } catch {}
}

function buildDirTraceStack(limit = 6) {
  try {
    return new Error().stack.split("\n").slice(0, Math.max(2, limit | 0)).join("\n") || "";
  } catch {
    return "";
  }
}

function setDirectorRowsDone(done) {
  var next = !!done;
  var prev = false;
  try { prev = window.__jmsDirectorRowsDone === true; } catch {}
  try { window.__jmsDirectorRowsDone = next; } catch {}
  if (next && !prev) {
    dirRowsTrace("done", {
      renderedCount: STATE.renderedCount,
      nextIndex: STATE.nextIndex,
      lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    });
    try { document.dispatchEvent(new Event("jms:director-rows-done")); } catch {}
  }
}

function clampConfiguredCount(value, fallback, max = UNIFIED_ROW_ITEM_LIMIT) {
  var n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, n | 0));
}

function getDirectorRowsCount(source = null) {
  var cfg = source || getConfig.() || config || {};
  return clampConfiguredCount(cfg.directorRowsCount, 5, 50);
}

function getDirectorRowCardCount(source = null) {
  var cfg = source || getConfig.() || config || {};
  return clampConfiguredCount(cfg.directorRowCardCount, 10);
}

var STATE = {
  directors: [],
  nextIndex: 0,
  batchSize: DIRECTOR_ROW_BATCH_SIZE,
  started: false,
  loading: false,
  batchObserver: null,
  wrapEl: null,
  hostEl: null,
  serverId: null,
  userId: null,
  renderedCount: 0,
  maxRenderCount: getDirectorRowsCount(),
  sectionIOs: new Set(),
  autoPumpScheduled: false,
  _db: null,
  _scope: null,
  _bgStarted: false,
  _backfillRunning: false,
  hadMountedSections: false,
};

var __dirScrollIdleTimer = null;
var __dirScrollIdleAttached = false;
var __dirArrowObserver = null;
var __dirSyncInterval = null;
var __dirBackfillInterval = null;
var __dirBackfillIdleHandle = null;
var __dirAutoPumpHandle = null;
var __dirDeferredWarmTimer = null;
var __dirInitSeq = 0;
var __dirWarmPromise = null;
var __dirWarmScope = "";
var __dirWarmCache = { scope: "", directors: [], fromCache: false, warmedAt: 0, minContents: 0 };
var __dirPrimePromise = null;
var __dirPrimeScope = "";
var __dirKickBackfillPromise = null;
var __dirKickBackfillScope = "";
var __dirEligibilityRefreshRunning = false;
var __dirEligibilityRefreshScope = "";
var __directorMountPromise = null;
var __directorDeferredStartPromise = null;
var __directorRowsRetryTo = null;
var __directorDeferredSeq = 0;
var __directorRowsSelfHealObserver = null;
var __directorRowsSelfHealTimer = null;
var __directorRowsSelfHealPending = false;

function makeManagedDirectorSectionId(index = 0) {
  return "director-rows--" + (Math.max(0, index | 0));
}

function getManagedDirectorSections(root = getHomeSectionsContainer() || document) {
  return Array.from(root.querySelectorAll.('[id^="director-rows--"]') || [])
    .filterfunction((el) el.isConnected)
    .sortfunction((left, right) {
      var li = Number(String(left.id || "").split("--")[1]) || 0;
      var ri = Number(String(right.id || "").split("--")[1]) || 0;
      return li - ri;
    });
}

function cleanupManagedDirectorSections(root = getHomeSectionsContainer() || document) {
  for (var section of getManagedDirectorSections(root)) {
    try {
      section.querySelectorAll(".personal-recs-card, .dir-row-hero").forEach(function((el) {
        try { el.dispatchEvent(new Event("jms:cleanup")); } catch {}
      });
      section.querySelectorAll(".personal-recs-row").forEach(function((row) {
        try { row.dispatchEvent(new Event("jms:cleanup")); } catch {}
      });
    } catch {}
    try { section.remove(); } catch {}
  }
}

function placeDirectorSection(section) {
  var parent = STATE.hostEl || getHomeSectionsContainer() || document.body;
  var siblings = getManagedDirectorSections(parent);
  var last = siblings[siblings.length - 1] || null;
  if (last.parentElement === parent) {
    last.insertAdjacentElement("afterend", section);
  } else {
    appendToParent(parent, section);
  }
  STATE.hadMountedSections = true;
  try { keepManagedSectionsBelowNative(parent); } catch {}
}

function cleanupDirectorSection(section) {
  if (!section) return;
  try { cleanupDirectorRowsMount(section); } catch {}
  try { section.remove(); } catch {}
}

function getMountedDirectorRowsPage() {
  var visiblePage =
    getActiveHomePageEl.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    null;
  if (visiblePage.isConnected) {
    var visibleHasManagedRows = !!visiblePage.querySelector.(
      '#director-rows, [id^="director-rows--"]'
    );
    if (visibleHasManagedRows) return visiblePage;
  }

  var wrap = document.getElementById("director-rows");
  var wrapPage = wrap.closest.("#indexPage, #homePage");
  if (wrapPage.isConnected) return wrapPage;

  var section = document.querySelector('[id^="director-rows--"]');
  var sectionPage = section.closest.("#indexPage, #homePage");
  if (sectionPage.isConnected) return sectionPage;

  return visiblePage.isConnected ? visiblePage : null;
}

function isDirectorRowsSelfHealDisabled() {
  try {
    var cfg = getConfig.() || config || {};
    return cfg.enableSlider === false;
  } catch {
    return false;
  }
}

function scheduleDirectorRowsSelfHeal(reason = "mutation", delayMs = 180) {
  if (isDirectorRowsSelfHealDisabled()) {
    __directorRowsSelfHealPending = false;
    if (__directorRowsSelfHealTimer) {
      clearTimeout(__directorRowsSelfHealTimer);
      __directorRowsSelfHealTimer = null;
    }
    if (reason !== "observer") {
      dirRowsTrace("self-heal:skip:slider-disabled", { reason });
    }
    return;
  }
  __directorRowsSelfHealPending = true;
  if (__directorRowsSelfHealTimer) return;
  __directorRowsSelfHealTimer = setTimeoutfunction(() {
    __directorRowsSelfHealTimer = null;
    if (!__directorRowsSelfHealPending) return;
    if (__directorMountPromise) {
      scheduleDirectorRowsSelfHeal("post-mount", Math.max(220, delayMs | 0));
      return;
    }
    __directorRowsSelfHealPending = false;
    if (!STATE.hadMountedSections) return;
    if (!isHomeRoute()) return;
    var cfg = getConfig();
    if (cfg.enableSlider === false) return;
    var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    if (!homeSectionsConfig.enableDirectorRows) return;
    if (getManagedDirectorSections().length > 0) return;

    dirRowsWarn("self-heal:remount", {
      reason,
    });
    void mountDirectorRowsLazy({ force: true });
  }, Math.max(120, delayMs | 0));
}

function bindDirectorRowsSelfHealObserver() {
  if (isDirectorRowsSelfHealDisabled()) return;
  if (__directorRowsSelfHealObserver || typeof MutationObserver !== "function") return;
  var target = document.body || document.documentElement || null;
  if (!target) return;

  __directorRowsSelfHealObserver = new MutationObserverfunction(() {
    scheduleDirectorRowsSelfHeal("observer");
  });

  try {
    __directorRowsSelfHealObserver.observe(target, {
      childList: true,
      subtree: true,
    });
  } catch {
    __directorRowsSelfHealObserver = null;
  }
}

function resolveDirectorRowsMountState(homeParent = null, targetPage = null) {
  var page =
    (targetPage.isConnected ? targetPage : null) ||
    getMountedDirectorRowsPage() ||
    getActiveHomePageEl.() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)") ||
    null;
  var container =
    (homeParent.isConnected ? homeParent : null) ||
    page.querySelector.(".homeSectionsContainer") ||
    getHomeSectionsContainer(page) ||
    null;
  return { page, container };
}

function isDirectorRowsMountStateValid(state) {
  return !!state.page.isConnected && !!state.container.isConnected && isHomeRoute();
}

function getDirectorRowsAnchor(root = null) {
  var sections = getManagedDirectorSections(root || STATE.hostEl || getHomeSectionsContainer() || document);
  return sections.length ? sections[sections.length - 1] : null;
}

function isDirectorRowsWorkerActive() {
  return !!(STATE.started || STATE._bgStarted);
}

function getDirectorMinContents() {
  var liveConfig = getConfig.() || config || {};
  var raw = Number(liveConfig.directorRowsMinItemsPerDirector);
  return Number.isFinite(raw) ? Math.max(1, raw | 0) : 10;
}

function getDirectorWarmCache(scope) {
  if (!scope || __dirWarmCache.scope !== scope) return null;
  if (__dirWarmCache.minContents !== getDirectorMinContents()) return null;
  var directors = Array.isArray(__dirWarmCache.directors) ? __dirWarmCache.directors : [];
  if (!directors.length) return null;
  return {
    directors: directors.slice(),
    fromCache: !!__dirWarmCache.fromCache,
  };
}

function getDirectorPrimeMinItems() {
  return getDirectorRowCardCount() + 1;
}

function setDirectorWarmCache(scope, result) {
  if (!scope) return;
  __dirWarmCache = {
    scope,
    directors: Array.isArray(result.directors) ? result.directors.filter(Boolean).slice() : [],
    fromCache: !!result.fromCache,
    warmedAt: Date.now(),
    minContents: getDirectorMinContents(),
  };
}

function ensureDirectorRowsSession({ userId, serverId }) {
  if (!userId) return { db: null, scope: null };
  var scope = makeScope({ serverId, userId });

  STATE.userId = userId;
  STATE.serverId = serverId;

  if (STATE._db && STATE._scope === scope) {
    return { db: STATE._db, scope };
  }

  var db = openDirRowsDB();
  STATE._db = db;
  STATE._scope = scope;
  return { db, scope };
}

function setDirectorArrowLoading(isLoading) {
  var arrow = STATE._loadMoreArrow;
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

function placeDirectorLoadMoreArrow() {
  var parent = STATE.hostEl || getHomeSectionsContainer() || document.body;
  var arrow = STATE._loadMoreArrow;
  if (!parent || !arrow) return;
  var siblings = getManagedDirectorSections(parent);
  var last = siblings[siblings.length - 1] || null;
  if (last.parentElement === parent) {
    last.insertAdjacentElement("afterend", arrow);
  } else {
    appendToParent(parent, arrow);
  }
}

function requestNextDirectorBatch({ force = false } = {}) {
  if (STATE.loading) return;
  if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) {
    detachDirectorScrollIdleLoader();
    return;
  }

  void renderNextDirectorBatch(force);
}

function attachDirectorScrollIdleLoader() {
  if (__dirScrollIdleAttached) return;
  __dirScrollIdleAttached = true;

  if (!STATE.hostEl) return;
  if (!STATE._loadMoreArrow) {
    var arrow = document.createElement('button');
    arrow.className = 'dir-load-more-arrow';
    arrow.type = 'button';
    arrow.innerHTML = faIconHtml("chevronDown");
    arrow.setAttribute(
      'aria-label',
      (labels.loadMoreDirectors ||
        config.languageLabels.loadMoreDirectors ||
        'Mostrar mais diretores')
    );
    STATE._loadMoreArrow = arrow;

    arrow.addEventListenerfunction('click', (e) {
      e.preventDefault();
      e.stopPropagation();
      if (
        !STATE.loading &&
        STATE.nextIndex < STATE.directors.length &&
        STATE.renderedCount < STATE.maxRenderCount
      ) {
        requestNextDirectorBatch({ force: true });
      }
    }, { passive: false });
  }

  placeDirectorLoadMoreArrow();

  if (__dirArrowObserver) {
    try { __dirArrowObserver.disconnect(); } catch {}
  }

  __dirArrowObserver = new IntersectionObserverfunction((entries) {
  for (var ent of entries) {
    if (!ent.isIntersecting) continue;
    if (STATE.loading) continue;
    if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) {
      detachDirectorScrollIdleLoader();
      return;
    }
    requestNextDirectorBatch({ force: false });
    break;
  }
}, {
  root: null,
  rootMargin: DIRECTOR_ROWS_ARROW_OBSERVER_ROOT_MARGIN,
  threshold: DIRECTOR_ROWS_ARROW_OBSERVER_THRESHOLD,
});

  if (STATE._loadMoreArrow) {
    placeDirectorLoadMoreArrow();
    __dirArrowObserver.observe(STATE._loadMoreArrow);
  }
}

function detachDirectorScrollIdleLoader() {
  if (!__dirScrollIdleAttached) return;
  __dirScrollIdleAttached = false;

  if (__dirArrowObserver) {
    try {
      if (STATE._loadMoreArrow) {
        __dirArrowObserver.unobserve(STATE._loadMoreArrow);
      }
      __dirArrowObserver.disconnect();
    } catch {}
    __dirArrowObserver = null;
  }

  if (STATE._loadMoreArrow && STATE._loadMoreArrow.parentElement) {
    try { STATE._loadMoreArrow.parentElement.removeChild(STATE._loadMoreArrow); } catch {}
  }
  STATE._loadMoreArrow = null;

  if (__dirScrollIdleTimer) {
    clearTimeout(__dirScrollIdleTimer);
    __dirScrollIdleTimer = null;
  }
}

function scheduleDirectorAutoPump(timeout = 120) {
  void timeout;
}

function yieldToMain(timeout = DIRECTOR_ROW_FILL_YIELD_MS) {
  return new Promisefunction((resolve) {
    __idlefunction(() resolve(), Math.max(16, timeout | 0));
  });
}

function registerSectionObserver(io) {
  if (!io) return io;
  STATE.sectionIOs.add(io);
  return io;
}

function unregisterSectionObserver(io) {
  if (!io) return;
  try { io.disconnect(); } catch {}
  STATE.sectionIOs.delete(io);
}

function scheduleLazyDirectorWork(target, init, {
  rootMargin = IS_MOBILE ? '120px 0px' : '280px 0px',
  timeout = IS_MOBILE ? 700 : 260,
  eager = false,
  observeVisibility = true,
} = {}) {
  if (!target || typeof init !== 'function') return function() {};

  var started = false;
  var idleHandle = null;
  var io = null;

  var clearIdleHandle = function() {
    if (!idleHandle) return;
    try { __cancelIdle(idleHandle); } catch {}
    idleHandle = null;
  };

  var cleanup = function() {
    clearIdleHandle();
    unregisterSectionObserver(io);
    io = null;
    try { target.removeEventListener('pointerenter', onIntent); } catch {}
    try { target.removeEventListener('pointerdown', onIntent); } catch {}
    try { target.removeEventListener('focusin', onIntent); } catch {}
  };

  var start = function() {
    if (started || !target.isConnected) return;
    started = true;
    cleanup();
    try { init(); } catch (e) {
      dirRowsWarn('directorRows: lazy init failed:', e);
    }
  };

  var scheduleIdleStart = function() {
    if (started || idleHandle) return;
    idleHandle = __idlefunction(() {
      idleHandle = null;
      start();
    }, Math.max(80, timeout | 0));
  };

  var onIntent = function() start();

  try { target.addEventListener('pointerenter', onIntent, { passive: true }); } catch {}
  try { target.addEventListener('pointerdown', onIntent, { passive: true }); } catch {}
  try { target.addEventListener('focusin', onIntent, { passive: true }); } catch {}

  if (eager) {
    scheduleIdleStart();
    return cleanup;
  }

  if (observeVisibility && typeof IntersectionObserver === 'function') {
    io = registerSectionObserverfunction(new IntersectionObserver((entries) {
      for (var entry of entries) {
        if (!entry.isIntersecting) continue;
        scheduleIdleStart();
        break;
      }
    }, {
      root: null,
      rootMargin,
      threshold: 0.01,
    }));

    try { io.observe(target); } catch {}
  } else {
    scheduleIdleStart();
  }

  return cleanup;
}

(function ensurePerfCssOnce(){
  if (document.getElementById('dir-rows-perf-css')) return;
  var st = document.createElement('style');
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
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
  "UserData",
  "People",
  "Overview",
  "RemoteTrailers"
].join(",");

function getDirectorRowCardTypeBadge(itemType) {
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
  var qs = [];

  if (!skipTag && candidate.tag) qs.push("tag=" + (encodeURIComponent(candidate.tag)));
  if (candidate.imageType === "Primary") {
    qs.push("maxHeight=" + (height));
  } else {
    var aspectRatio = Number(candidate.aspectRatio) || (16 / 9);
    qs.push("maxWidth=" + (Math.max(96, Math.round(height * aspectRatio))));
  }
  qs.push("quality=" + (quality));
  qs.push("EnableImageEnhancers=false");

  return withServer("/Items/" + (candidate.itemId) + "/Images/" + (candidate.imageType) + "?" + (qs.join("&")));
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

  if (!tag) return null;

  var omitTag = shouldPreferTaglessImages(item);
  var qs = [];
  if (!omitTag) qs.push("tag=" + (encodeURIComponent(tag)));
  qs.push("maxWidth=" + (width));
  qs.push("quality=" + (quality));
  qs.push("EnableImageEnhancers=false");
  return withServer("/Items/" + (item.Id) + "/Images/Logo?" + (qs.join("&")));
}

function buildBackdropUrl(item, width = 1920, quality = 80) {
  if (!item) return null;
  var candidate = getBackdropImageCandidate(item);
  if (!candidate) return null;

  var omitTag = shouldPreferTaglessImages(item);
  var qs = [];
  if (!omitTag && candidate.tag) qs.push("tag=" + (encodeURIComponent(candidate.tag)));
  qs.push("maxWidth=" + (width));
  qs.push("quality=" + (quality));
  qs.push("EnableImageEnhancers=false");
  return withServer("/Items/" + (candidate.itemId) + "/Images/Backdrop?" + (qs.join("&")));
}

function buildBackdropImageUrl(item) {
  return buildBackdropUrl(item, 1920, 80) || buildBackdropUrl(item, 480, 25) || buildPosterImageUrl(item) || null;
}

function formatRuntime(ticks) {
  if (!ticks) return null;
  var minutes = Math.floor(ticks / 600000000);
  if (minutes < 60) return (minutes) + "m";
  var hours = Math.floor(minutes / 60);
  var remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? (hours) + "h " + (remainingMinutes) + "m" : (hours) + "h";
}

function getRuntimeWithIcons(runtime) {
  if (!runtime) return '';
  return runtime.replace(/(\d+)h/g, "$1" + (config.languageLabels.sa || 'h'))
               .replace(/(\d+)m/g, "$1" + (config.languageLabels.dk || 'm'));
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

function clearDirectorHeroHost(heroHost) {
  if (!heroHost) return;
  try {
    heroHost.querySelectorAll('.dir-row-hero').forEach(function((el) {
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
    });
  } catch {}
  heroHost.innerHTML = '';
  try { heroHost.style.visibility = 'hidden'; } catch {}
}

function mountDirectorHero(heroHost, heroItem, serverId, directorName, { aboveFold = false } = {}) {
  var heroItemId = resolveItemId(heroItem);
  if (!heroHost || !heroItemId) return { hero: null, changed: false };

  var existing = heroHost.querySelector('.dir-row-hero');
  var same = existing && existing.dataset.itemId === String(heroItemId);

  if (same) {
    var label = existing.querySelector('.dir-row-hero-label');
    if (label) {
      label.textContent = ((config.languageLabels.yonetmen || "diretor")) + " " + (directorName || "").trim();
    }
    try { heroHost.style.visibility = 'visible'; } catch {}
    return { hero: existing, changed: false };
  }

  if (existing) {
    clearDirectorHeroHost(heroHost);
  }

  var hero = createDirectorHeroCard(heroItem, serverId, directorName, { aboveFold });
  hero.classList.add('is-entering');
  heroHost.appendChild(hero);
  try { heroHost.style.visibility = 'visible'; } catch {}
  requestAnimationFramefunction(() {
    try { hero.classList.remove('is-entering'); } catch {}
  });
  return { hero, changed: true };
}

function createRecommendationCard(item, serverId, aboveFold = false) {
  var { itemId, itemName } = primeItemIdentity(item);
  var card = document.createElement("div");
  card.className = "card personal-recs-card";
  queueEnterAnimation(card);
  if (itemId) card.dataset.itemId = itemId;

  var posterUrlStatic = buildPosterImageUrl(item);
  var year = item.ProductionYear || "";
  var ageChip = formatOfficialRatingLabel(item.OfficialRating || "");
  var runtimeTicks = item.Type === "Series" ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  var runtime = formatRuntime(runtimeTicks);
  var genres = Array.isArray(item.Genres) ? item.Genres.slice(0, 2).join(", ") : "";
  var { label: typeLabel, icon: typeIcon } = getDirectorRowCardTypeBadge(item.Type);
  var community = Number.isFinite(item.CommunityRating)
    ? "<div class=\"community-rating\" title=\"Community Rating\">⭐ " + (item.CommunityRating.toFixed(1)) + "</div>"
    : "";
  var progress = getPlaybackPercent(item);
  var logoUrl = buildLogoUrl(item);
  var titleRender = resolveManagedCardTitleRender({
    titleText: itemName,
    logoUrl,
    logoAltText: (itemName) + " logo",
    aboveFold,
    maxTitleLength: 42,
  });
  var progressHtml = (progress > 0.02 && progress < 0.999)
    ? "<div class=\"rr-progress-wrap\" aria-label=\"" + (escapeHtml(config.languageLabels.progress || "Progresso")) + "\">\n         <div class=\"rr-progress-bar\" style=\"width:" + (Math.round(progress * 100)) + "%\"></div>\n       </div>"
    : "";

  card.innerHTML = "\n    <div class=\"cardBox\">\n      <a class=\"cardLink\" href=\"" + (itemId ? getDetailsUrl(itemId, serverId) : '#') + "\">\n        <div class=\"cardImageContainer\">\n          <img class=\"cardImage\"\n            alt=\"" + (escapeHtml(itemName)) + "\"\n            loading=\"" + (aboveFold ? 'eager' : 'lazy') + "\"\n            decoding=\"async\"\n            " + (aboveFold ? 'fetchpriority="high"' : '') + ">\n          <div class=\"prc-top-badges\">\n            " + (community) + "\n            <div class=\"prc-type-badge\">\n              " + (faIconHtml(typeIcon, "prc-type-icon")) + "\n              " + (typeLabel) + "\n            </div>\n          </div>\n          <div class=\"prc-gradient\"></div>\n          <div class=\"prc-overlay\">\n            " + (titleRender.html) + "\n            <div class=\"prc-meta\">\n              ${ageChip ? "<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>" : \"\"}\n              ${year ? "<span class="prc-year">${year}</span><span class="prc-dot">•</span>" : \"\"}\n              ${runtime ? "<span class="prc-runtime">${getRuntimeWithIcons(runtime)}</span>" : \"\"}\n            </div>\n            ${genres ? "<div class="prc-genres">${genres}</div>" : \"\"}\n          </div>\n          " + (progressHtml) + "\n        </div>\n      </a>\n    </div>\n  ";

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
    var sizesMobile = '(max-width: 640px) 42vw, (max-width: 820px) 37vw, 252px';
    var sizesDesk   = '(max-width: 1200px) 21vw, 252px';
    img.setAttribute('sizes', IS_MOBILE ? sizesMobile : sizesDesk);
  } catch {}

  if (posterUrlStatic) {
    setManagedImageSource(img, posterUrlStatic, { fallback: PLACEHOLDER_URL });
  } else {
    try { img.style.display = 'none'; } catch {}
    var noImg = document.createElement('div');
    noImg.className = 'prc-noimg-label';
    noImg.textContent =
      (config.languageLabels && (config.languageLabels.noImage || config.languageLabels.loadingText))
      || (labels.noImage || 'Sem imagem');
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
        dirRowsWarn("openDetailsModal failed (director card):", err);
      }
    }, { passive: false });
  }

  var mode = (HOVER_MODE === 'inherit')
    ? (getConfig().globalPreviewMode === 'studioMini' ? 'studioMini' : 'modal')
    : HOVER_MODE;

  var cleanupLazyPreview = scheduleLazyDirectorWorkfunction(card, () {
    if (!card.isConnected) return;
    attachPreviewByMode(card, { ...item, Id: itemId, Name: itemName }, mode);
  }, {
    eager: aboveFold && !IS_MOBILE,
    timeout: aboveFold ? 220 : 480,
    observeVisibility: false,
  });

  card.addEventListenerfunction('jms:cleanup', () {
    try { cleanupLazyPreview(); } catch {}
    cleanupManagedImage(img);
    detachPreviewHandlers(card);
    try { cleanupImageResourceRefs(card, { revokeDetachedBlobs: true }); } catch {}
  }, { once:true });
  return card;
}

function isHomeRoute() {
  var h = String(window.location.hash || '').toLowerCase();
  return h.startsWith('#/home') || h.startsWith('#/index') || h === '' || h === '#';
}

function createDirectorHeroCard(item, serverId, directorName, { aboveFold = false } = {}) {
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
  var heroProgress = getPlaybackPercent(item);
  var heroProgressPct = Math.round(heroProgress * 100);
  var heroProgressHtml = (heroProgress > 0.02 && heroProgress < 0.999)
    ? "\n      <div class=\"dir-hero-progress-wrap\" aria-label=\"" + (escapeHtml(config.languageLabels.progress || "Progresso")) + "\">\n        <div class=\"dir-hero-progress-bar\" style=\"width:" + (heroProgressPct) + "%\"></div>\n      </div>\n      <div class=\"dir-hero-progress-pct\">" + (heroProgressPct) + "%</div>\n    "
    : "";

  hero.innerHTML = "\n    <div class=\"dir-row-hero-bg-wrap\">\n      <img class=\"dir-row-hero-bg\"\n           alt=\"" + (escapeHtml(itemName)) + "\"\n           decoding=\"async\"\n           loading=\"" + (aboveFold ? 'eager' : 'lazy') + "\"\n           " + (aboveFold ? 'fetchpriority="high"' : '') + ">\n    </div>\n\n    <div class=\"dir-row-hero-inner\">\n      <div class=\"dir-row-hero-meta-container\">\n        <div class=\"dir-row-hero-label\">\n          " + ((config.languageLabels.yonetmen || "diretor")) + " " + (escapeHtml(directorName || "")) + "\n        </div>\n\n        ${logo ? "
          <div class="dir-row-hero-logo">
            <img src="${logo}" alt="${escapeHtml(itemName)} logo">
          </div>
        " : ""}\n\n        <div class=\"dir-row-hero-title\">" + (escapeHtml(itemName)) + "</div>\n\n        ${metaHtml ? "<div class="dir-row-hero-submeta">${metaHtml}</div>" : \"\"}\n\n        ${plot ? "<div class="dir-row-hero-plot">${escapeHtml(plot)}</div>" : \"\"}\n\n      </div>\n    </div>\n    " + (heroProgressHtml) + "\n  ";

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
      dirRowsWarn("openDetailsModal failed (director hero):", err);
    }
  };

  hero.addEventListener('click', openDetails);
  hero.tabIndex = 0;
  hero.addEventListenerfunction("keydown", (e) {
    if (e.key === "Enter" || e.key === " ") openDetails(e);
  });

  hero.classList.add('active');

  try {
    var bgImg = hero.querySelector('.dir-row-hero-bg');
    if (bgImg) {
      setManagedImageSource(bgImg, bgSrc, { fallback: PLACEHOLDER_URL });
    }
  } catch (e) {
    dirRowsWarn("dir-row-hero-bg hydrate failed:", e);
  }

  hero.addEventListenerfunction('jms:cleanup', () {
    try {
      var bgImg = hero.querySelector('.dir-row-hero-bg');
      if (bgImg) cleanupManagedImage(bgImg);
    } catch {}
    detachPreviewHandlers(hero);
    try { cleanupImageResourceRefs(hero, { revokeDetachedBlobs: true }); } catch {}
  }, { once: true });

  return hero;
}

var __hoverIntent = new WeakMap();
var __enterTimers = new WeakMap();
var __enterSeq     = new WeakMap();
var __cooldownUntil= new WeakMap();
var __openTokenMap = new WeakMap();
var __boundPreview = new WeakMap();

var __lastMoveTS = 0;
var __pmLast = 0;
window.addEventListenerfunction('pointermove', () {
  var now = Date.now();
  if (now - __pmLast > 100) { __pmLast = now; __lastMoveTS = now; }
}, {passive:true});

var __touchStickyOpen = false;
var __touchLastOpenTS = 0;
var TOUCH_STICKY_GRACE_MS = 1200;

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
}

(function ensureGlobalTouchOutsideCloser(){
  if (window.__jmsTouchCloserBound_dir) return;
  window.__jmsTouchCloserBound_dir = true;
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

function isHoveringCardOrModal(cardEl) {
  try {
    var overCard  = cardEl.isConnected && cardEl.matches(':hover');
    var overModal = !!document.querySelector('.video-preview-modal:hover');
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
      try { window.dispatchEvent(new Event('closeAllMiniPopovers')); } catch {}

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
    var isTouch = e.pointerType === 'touch';
    __hoverIntent.set(cardEl, false);
    clearEnterTimer(cardEl);
    __enterSeq.set(cardEl, (__enterSeq.get(cardEl) || 0) + 1);
    if (isTouch && __touchStickyOpen) {
      if (Date.now() - __touchLastOpenTS <= TOUCH_STICKY_GRACE_MS) return;
      __touchStickyOpen = false;
    }

    var rt = e.relatedTarget || null;
    var goingToModal = !!(rt && (rt.closest ? rt.closest('.video-preview-modal') : null));
    if (goingToModal) return;

    try { safeCloseHoverModal(); } catch {}
    try { hardWipeHoverModalDom(); } catch {}
    __cooldownUntil.set(cardEl, Date.now() + REOPEN_COOLDOWN_MS);
    scheduleClosePollingGuard(cardEl, 4, 120);
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
  try { cardEl.removeEventListener('pointerenter', rec.onEnter); } catch {}
  try { cardEl.removeEventListener('pointerleave', rec.onLeave); } catch {}
  try { if (rec.onDown) cardEl.removeEventListener('pointerdown', rec.onDown); } catch {}
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

function filterAndTrimByRating(items, minRating, maxCount) {
  var seen = new Set();
  var out = [];
  for (var it of items || []) {
    if (!it || !it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
    if (out.length >= maxCount) break;
  }
  return out;
}

function getDirectorContentCount(userId, directorId) {
  var url =
    "/Users/" + (userId) + "/Items?IncludeItemTypes=Movie,Series&Recursive=true&" +
    "PersonIds=" + (encodeURIComponent(directorId)) + "&" +
    "Limit=1&SortBy=DateCreated&SortOrder=Descending";
  try {
    var data = makeApiRequest(url);
    return Number(data.TotalRecordCount) || 0;
  } catch (e) {
    dirRowsWarn('directorRows: count check failed for', directorId, e);
    return null;
  }
}

function pMapLimited(list, limit, mapper) {
  var ret = new Array(list.length);
  var i = 0;
  var workers = new Array(Math.min(limit, list.length)).fill(0).mapfunction(() {
    while (i < list.length) {
      var cur = i++;
      ret[cur] = mapper(list[cur], cur);
    }
  });
  Promise.all(workers);
  return ret;
}

function runDirectorBackgroundTask(task, label = "directorRows: background task failed:", timeout = 800) {
  var runner = function() {
    Promise.resolve()
      .then(task)
      .catchfunction((e) {
        dirRowsWarn(label, e);
      });
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(runner, { timeout: Math.max(200, timeout | 0) });
  } else {
    setTimeout(runner, Math.min(Math.max(0, timeout | 0), 250));
  }
}

function ensureDirectorSyncLoop({ forceImmediate = false } = {}) {
  if (__dirSyncInterval) return;

  if (forceImmediate) {
    runDirectorBackgroundTaskfunction(() checkAndSyncNewItems({ force: true }),
      "directorRows: startup sync failed:",
      2400
    );
  }

  __dirSyncInterval = setIntervalfunction(() {
    if (!isDirectorRowsWorkerActive()) return;
    checkAndSyncNewItems().catchfunction(() {});
  }, Number.isFinite(config.directorRowsNewCheckIntervalMs)
      ? Math.max(30_000, config.directorRowsNewCheckIntervalMs | 0)
      : 15 * 60 * 1000);
}

function scheduleDirectorDeferredWarmTasks() {
  if (__dirDeferredWarmTimer) {
    clearTimeout(__dirDeferredWarmTimer);
    __dirDeferredWarmTimer = null;
  }
}

function cleanupDirectorRowsMount(host) {
  if (!host) return;

  try {
    var targets = new Set();
    if (host.matches.(".personal-recs-card, .dir-row-hero")) {
      targets.add(host);
    }
    host.querySelectorAll.(".personal-recs-card, .dir-row-hero").forEach(function((node) targets.add(node));
    targets.forEach(function((node) {
      try { node.dispatchEvent(new CustomEvent("jms:cleanup")); } catch {}
    });
  } catch {}

  try { cleanupImageResourceRefs(host, { revokeDetachedBlobs: true }); } catch {}
}

function refreshCachedDirectorEligibility(userId, cachedRows, { db, scope, limit = 0 } = {}) {
  if (!userId || !db || !scope || !Array.isArray(cachedRows) || !cachedRows.length) return;
  if (__dirEligibilityRefreshRunning && __dirEligibilityRefreshScope === scope) return;
  var minContents = getDirectorMinContents();

  var head = cachedRows
    .filterfunction((d) d.directorId)
    .slice(0, Math.max(1, limit | 0))
    .mapfunction((d) ({
      Id: d.directorId,
      Name: d.name,
      Count: d.countHint || 0,
    }));

  if (!head.length) return;

  __dirEligibilityRefreshRunning = true;
  __dirEligibilityRefreshScope = scope;

  runDirectorBackgroundTaskfunction(() {
    try {
      var checks = pMapLimitedfunction(head, 3, (d) {
        var total = getDirectorContentCount(userId, d.Id);
        return {
          d,
          total,
          ok: Number.isFinite(total) && total >= minContents,
        };
      });

      for (var x of checks) {
        if (!Number.isFinite(x.total)) continue;
        upsertDirector(db, scope, {
          Id: x.d.Id,
          Name: x.d.Name,
          Count: x.d.Count || 0,
          eligible: x.ok,
          countActual: x.total,
          qualifiedMinItems: minContents,
        });
      }
    } finally {
      if (__dirEligibilityRefreshScope === scope) {
        __dirEligibilityRefreshRunning = false;
      }
    }
  }, "directorRows: cached eligibility refresh failed:", 1600);
}

function persistItemsToDbLater(items) {
  if (!STATE._db || !STATE._scope || !Array.isArray(items) || !items.length) return;
  var db = STATE._db;
  var scope = STATE._scope;
  var uniqItems = uniqById(items);
  if (!uniqItems.length) return;

  runDirectorBackgroundTaskfunction(() {
    for (var it of uniqItems) {
      upsertItem(db, scope, it);
    }
  }, "directorRows: cached item hydration persist failed:", 600);
}

function persistDirectorItemsToDbLater(dir, items) {
  if (!STATE._db || !STATE._scope || !dir.Id || !Array.isArray(items) || !items.length) return;
  var db = STATE._db;
  var scope = STATE._scope;
  var uniqItems = uniqById(items);
  if (!uniqItems.length) return;

  runDirectorBackgroundTaskfunction(() {
    for (var it of uniqItems) {
      upsertItem(db, scope, it);
      linkDirectorItem(db, scope, dir.Id, it.Id);
    }

    upsertDirector(db, scope, {
      Id: dir.Id,
      Name: dir.Name,
      Count: dir.Count || 0,
      eligible: true,
    });
  }, "directorRows: DB write-through failed:", 600);
}

function pruneDeletedDirectorItemsLater(itemIds) {
  if (!STATE._db || !STATE._scope) return;
  var clean = Array.isArray(itemIds) ? Array.from(new Set(itemIds.map(function(x) String(x || "").trim()).filter(Boolean))) : [];
  if (!clean.length) return;

  runDirectorBackgroundTaskfunction(() {
    deleteItemsAndRelationsByIds(STATE._db, STATE._scope, clean);
  }, "directorRows: prune deleted items failed:", 700);
}

function pickRandomDirectorsFromTopGenres(userId, targetCount = getDirectorRowsCount()) {
  var requestedPrimary = 300;
  var requestedFallback = 600;
  var fields = COMMON_FIELDS;
  var minContents = getDirectorMinContents();
  var topGenres = (config.directorRowsUseTopGenres !== false)
    ? (getCachedUserTopGenres(2).catchfunction(()[]))
    : [];
  var peopleMap = new Map();

  function scanItems(url, takeUntil) {
    try {
      var data = makeApiRequest(url);
      var items = Array.isArray(data.Items) ? data.Items : [];
      for (var it of items) {
        var ppl = Array.isArray(it.People) ? it.People : [];
        for (var p of ppl) {
          if (!p.Id || !p.Name) continue;
          if (String(p.Type || '').toLowerCase() !== 'director') continue;
          var entry = peopleMap.get(p.Id) || { Id: p.Id, Name: p.Name, Count: 0 };
          entry.Count++;
          peopleMap.set(p.Id, entry);
          if (peopleMap.size >= takeUntil) break;
        }
        if (peopleMap.size >= takeUntil) break;
      }
    } catch (e) {
      dirRowsWarn("directorRows: people scan error:", e);
    }
  }

  if (topGenres.length) {
    var g = encodeURIComponent(topGenres.join("|"));
    var url = "/Users/" + (userId) + "/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=" + (fields) + "&EnableUserData=true&SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=" + (requestedPrimary) + "&Genres=" + (g);
    scanItems(url, targetCount * 8);
  }
  if (peopleMap.size < targetCount * 2) {
    var url = "/Users/" + (userId) + "/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=" + (fields) + "&EnableUserData=true&SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&Limit=" + (requestedFallback);
    scanItems(url, targetCount * 12);
  }

  var directors = [...peopleMap.values()];
  if (!directors.length) return [];
  directors.sortfunction((a,b)b.Count-a.Count);
  var head = directors.slice(0, Math.min(60, directors.length));
  var checks = pMapLimitedfunction(head, 3, (d) {
    var total = getDirectorContentCount(userId, d.Id);
    return {
      d,
      total,
      ok: Number.isFinite(total) && total >= minContents,
    };
  });
  var eligible = checks
    .filter(function(x) x.ok)
    .map(function(x) ({ ...x.d, countActual: x.total, qualifiedMinItems: minContents }));

  if (!eligible.length) return [];

  shuffle(eligible);
  return eligible.slice(0, targetCount);
}

function shuffle(arr){
  for(var i=arr.length-1;i>0;i--){
    var j=(Math.random()*(i+1))|0;
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

function fetchItemsByDirector(userId, directorId, limit = getDirectorRowCardCount() * 2) {
  var rowCount = getDirectorRowsCount();
  var rowCardCount = getDirectorRowCardCount();
  var fields = COMMON_FIELDS;

  var url =
    "/Users/" + (userId) + "/Items?" +
    "IncludeItemTypes=Movie,Series&Recursive=true&Fields=" + (fields) + "&EnableUserData=true&" +
    "PersonIds=" + (encodeURIComponent(directorId)) + "&" +
    "SortBy=Random,CommunityRating,DateCreated&SortOrder=Descending&" +
    "Limit=" + (Math.max(rowCount, limit));

  try {
    var data = makeApiRequest(url);
    var items = Array.isArray(data.Items) ? data.Items : [];
    var NEED = rowCardCount + 1;
    return filterAndTrimByRating(items, MIN_RATING, NEED);
  } catch (e) {
    dirRowsWarn("directorRows: não foi possível carregar conteúdo do diretor:", e);
    return [];
  }
}

function loadDirectorsFromDbOrApi(userId) {
  var rowCount = getDirectorRowsCount();
  var wantFloor = Math.max(1, STATE.maxRenderCount || rowCount);
  var WANT = Math.max(rowCount * 3, wantFloor);
  var db = STATE._db;
  var scope = STATE._scope;
  var minContents = getDirectorMinContents();

  if (db && scope) {
    try {
      var cached = listDirectors(db, scope, { limit: Math.max(WANT * 4, rowCount * 20) });

      if (cached.length) {
        var cachedPool = cached
          .filter(function(d) d.directorId)
          .map(function(d) ({
            Id: d.directorId,
            Name: d.name,
            Count: d.countHint || 0,
            countActual: Number.isFinite(Number(d.countActual)) ? Number(d.countActual) : null,
            qualifiedMinItems: Number.isFinite(Number(d.qualifiedMinItems)) ? Number(d.qualifiedMinItems) : null,
          }));

        var knownEligible = cachedPool.filterfunction((d)
          Number.isFinite(d.countActual) && d.countActual >= minContents
        );
        var unknownPool = cachedPool.filterfunction((d) !Number.isFinite(d.countActual));
        var validated = [];
        var seen = new Set();

        shuffle(knownEligible);
        for (var d of knownEligible) {
          if (seen.has(d.Id)) continue;
          seen.add(d.Id);
          validated.push(d);
          if (validated.length >= WANT) break;
        }

        if (validated.length < WANT && unknownPool.length) {
          shuffle(unknownPool);
          var toCheck = unknownPool.slice(0, Math.min(unknownPool.length, Math.max(WANT * 3, rowCount * 8)));
          var checks = pMapLimitedfunction(toCheck, 3, (d) {
            var total = getDirectorContentCount(userId, d.Id);
            return {
              d,
              total,
              ok: Number.isFinite(total) && total >= minContents,
            };
          });

          for (var x of checks) {
            if (Number.isFinite(x.total)) {
              upsertDirector(db, scope, {
                Id: x.d.Id,
                Name: x.d.Name,
                Count: x.d.Count || 0,
                eligible: x.ok,
                countActual: x.total,
                qualifiedMinItems: minContents,
              });
            }
            if (!x.ok || seen.has(x.d.Id)) continue;
            seen.add(x.d.Id);
            validated.push({ ...x.d, countActual: x.total, qualifiedMinItems: minContents });
            if (validated.length >= WANT) break;
          }
        }

        if (validated.length) {
          refreshCachedDirectorEligibility(userId, cached, {
            db,
            scope,
            limit: Math.min(cached.length, Math.max(WANT * 2, rowCount * 6)),
          });
          return { directors: validated.slice(0, WANT), fromCache: true };
        }
      }
    } catch (e) {
      dirRowsWarn("directorRows: DB director load failed:", e);
    }
  }

  var seen = new Set();
  var directors = [];

  for (var attempt = 0; attempt < 6 && directors.length < WANT; attempt++) {
    var need = WANT - directors.length;
    var batch = pickRandomDirectorsFromTopGenres(userId, need);
    for (var d of batch) {
      if (!d.Id) continue;
      if (seen.has(d.Id)) continue;
      seen.add(d.Id);
      directors.push(d);
      if (directors.length >= WANT) break;
    }
  }

  if (db && scope) {
    try {
      for (var d of directors) {
        upsertDirector(db, scope, {
          Id: d.Id,
          Name: d.Name,
          Count: d.Count || 0,
          eligible: true,
          countActual: d.countActual,
          qualifiedMinItems: minContents,
        });
      }
    } catch {}
  }

  return { directors: directors.slice(0, WANT), fromCache: false };
}

export function warmDirectorRowsDb({ force = false } = {}) {
  var cfg = getConfig.() || config || {};
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  if (!homeSectionsConfig.enableDirectorRows) {
    return { directors: [], fromCache: false, skipped: true };
  }

  var { userId, serverId } = getSessionInfo.() || {};
  if (!userId) {
    return { directors: [], fromCache: false, skipped: true };
  }

  var scope = makeScope({ serverId, userId });
  if (!force && __dirWarmPromise && __dirWarmScope === scope) {
    return __dirWarmPromise;
  }

  __dirWarmScope = scope;
  __dirWarmPromise = function(() {
    STATE._bgStarted = true;

    try {
      ensureDirectorRowsSession({ userId, serverId });
    } catch (e) {
      dirRowsWarn("directorRows: background DB init failed:", e);
      STATE._db = null;
      STATE._scope = null;
      return { directors: [], fromCache: false, skipped: true };
    }

    var result = force ? null : getDirectorWarmCache(STATE._scope);
    if (!result) {
      result = loadDirectorsFromDbOrApi(userId);
      setDirectorWarmCache(STATE._scope, result);
    }

    return result;
  })().finallyfunction(() {
    if (__dirWarmScope === scope) {
      __dirWarmPromise = null;
    }
  });

  return __dirWarmPromise;
}

function ensureDirectorItemsCachedForWarmup(dir, minItems = getDirectorPrimeMinItems()) {
  var db = STATE._db;
  var scope = STATE._scope;
  var userId = STATE.userId;
  if (!db || !scope || !userId || !dir.Id) return;

  try {
    var existing = getItemsForDirector(db, scope, dir.Id, minItems);
    if ((existing.length || 0) >= minItems) return;
  } catch {}

  var apiItems = fetchItemsByDirector(
    userId,
    dir.Id,
    Math.max(minItems * 3, getDirectorRowCardCount() * 2)
  );

  var items = uniqById(apiItems || []);
  if (!items.length) return;

  for (var it of items) {
    upsertItem(db, scope, it);
    linkDirectorItem(db, scope, dir.Id, it.Id);
  }

  upsertDirector(db, scope, {
    Id: dir.Id,
    Name: dir.Name,
    Count: dir.Count || 0,
    eligible: true
  });
}

function startDirectorItemsPrime(directors, { force = false } = {}) {
  var db = STATE._db;
  var scope = STATE._scope;
  var userId = STATE.userId;
  var list = Array.isArray(directors) ? directors.filter(function(d) d.Id) : [];
  if (!db || !scope || !userId || !list.length) return null;

  if (!force && __dirPrimePromise && __dirPrimeScope === scope) {
    return __dirPrimePromise;
  }

  var primeList = list.slice(0, Math.max(getDirectorRowsCount(), 1));
  __dirPrimeScope = scope;
  __dirPrimePromise = function(() {
    try {
      pMapLimitedfunction(primeList, 2, (dir) {
        ensureDirectorItemsCachedForWarmup(dir);
      });
    } catch (e) {
      dirRowsWarn("directorRows: startup prime failed:", e);
    }
  })().finallyfunction(() {
    if (__dirPrimeScope === scope) {
      __dirPrimePromise = null;
    }
  });

  return __dirPrimePromise;
}

function kickDirectorBackfillNow({ force = false } = {}) {
  var scope = STATE._scope;
  if (!scope || !STATE._db || !STATE.userId) return null;

  if (!force && __dirKickBackfillPromise && __dirKickBackfillScope === scope) {
    return __dirKickBackfillPromise;
  }

  var cfg = getConfig.() || config || {};
  var pagesPerRun = Number.isFinite(cfg.directorRowsBackfillPagesPerRun)
    ? Math.max(1, Math.min(6, cfg.directorRowsBackfillPagesPerRun | 0))
    : 1;
  var perPage = Number.isFinite(cfg.directorRowsBackfillLimit)
    ? Math.max(50, Math.min(400, cfg.directorRowsBackfillLimit | 0))
    : 200;

  __dirKickBackfillScope = scope;
  __dirKickBackfillPromise = runDirectorBackfillOnce({ pagesPerRun, limit: perPage }).catchfunction((e) {
    dirRowsWarn("directorRows: immediate backfill failed:", e);
  }).finallyfunction(() {
    if (__dirKickBackfillScope === scope) {
      __dirKickBackfillPromise = null;
    }
  });

  return __dirKickBackfillPromise;
}

function getDateCreatedTicks(it) {
  var t = Number(it.DateCreatedTicks || it.dateCreatedTicks || 0);
  if (t) return t;

  var iso = it.DateCreated || it.dateCreated;
  if (!iso) return 0;

  var ms = Date.parse(iso);
  return Number.isFinite(ms) ? (ms * 10000) : 0;
}

function fetchItemsByIdsDetailed(userId, ids, fields = COMMON_FIELDS) {
  var clean = (ids || []).filter(Boolean);
  if (!clean.length) {
    return { items: [], foundIds: [], missingIds: [], failedIds: [] };
  }

  var out = [];
  var found = new Set();
  var failed = new Set();
  var chunkSize = 80;

  for (var i = 0; i < clean.length; i += chunkSize) {
    var chunk = clean.slice(i, i + chunkSize);
    var url =
      "/Users/" + (userId) + "/Items?" +
      "Ids=" + (encodeURIComponent(chunk.join(","))) +
      "&Fields=" + (encodeURIComponent(fields)) +
      "&EnableUserData=true";

    try {
      var data = makeApiRequest(url);
      var items = Array.isArray(data.Items) ? data.Items : [];
      out.push(...items);
      for (var it of items) {
        if (it.Id) found.add(String(it.Id));
      }
    } catch (e) {
      dirRowsWarn("directorRows: fetchItemsByIds failed:", e);
      for (var id of chunk) {
        failed.add(String(id));
      }
    }
  }
  var failedIds = Array.from(failed);
  var missingIds = clean
    .mapfunction((id) String(id || "").trim())
    .filterfunction((id) id && !found.has(id) && !failed.has(id));

  return {
    items: uniqById(out),
    foundIds: Array.from(found),
    missingIds,
    failedIds,
  };
}

function fetchItemsByIds(userId, ids, fields = COMMON_FIELDS) {
  var res = fetchItemsByIdsDetailed(userId, ids, fields);
  return res.items;
}

function extractDirectorPeople(it) {
  var ppl = Array.isArray(it.People) ? it.People : [];
  var out = [];
  for (var p of ppl) {
    if (!p.Id || !p.Name) continue;
    if (String(p.Type || "").toLowerCase() !== "director") continue;
    out.push({ Id: p.Id, Name: p.Name });
  }
  return out;
}

function startDirectorIncrementalSync() {
  var db = STATE._db;
  var scope = STATE._scope;
  if (!db || !scope || !STATE.userId) return;

  try {
    var metaKey = "dirRows:lastSync:" + (scope);
    var last = (getMeta(db, metaKey)) || 0;
    var fieldsMini = "People,DateCreated,DateCreatedTicks";
    var url =
      "/Users/" + (STATE.userId) + "/Items?IncludeItemTypes=Movie,Series&Recursive=true" +
      "&Fields=" + (fieldsMini) +
      "&SortBy=DateCreated&SortOrder=Descending&Limit=200";

    var data = makeApiRequest(url);
    var items = Array.isArray(data.Items) ? data.Items : [];

    var newestSeen = last;
    var newIds = [];
    var relPairs = [];

    for (var it of items) {
      var dct = getDateCreatedTicks(it);
      if (dct && dct > newestSeen) newestSeen = dct;
      if (last && dct && dct <= last) continue;

      if (it.Id) newIds.push(it.Id);
      var dirs = extractDirectorPeople(it);
      for (var d of dirs) {
        relPairs.push({ directorId: d.Id, directorName: d.Name, itemId: it.Id });
      }
     }

    if (!newIds.length) {
      if (newestSeen && newestSeen !== last) {
        setMeta(db, metaKey, newestSeen);
      }
      return;
    }

    var fullItems = fetchItemsByIds(STATE.userId, newIds, COMMON_FIELDS);
    for (var it of fullItems) {
      upsertItem(db, scope, it);
    }

    for (var r of relPairs) {
      if (!r.directorId || !r.itemId) continue;
      upsertDirector(db, scope, { Id: r.directorId, Name: r.directorName, Count: 0, eligible: true });
      linkDirectorItem(db, scope, r.directorId, r.itemId);
    }

    if (newestSeen && newestSeen !== last) {
      setMeta(db, metaKey, newestSeen);
    }
  } catch (e) {
    dirRowsWarn("directorRows: incremental sync failed:", e);
  }
}

function fetchLibraryHeadTick(userId) {
  var fields = "DateCreated,DateCreatedTicks";
  var url =
    "/Users/" + (userId) + "/Items?IncludeItemTypes=Movie,Series&Recursive=true" +
    "&Fields=" + (fields) +
    "&SortBy=DateCreated&SortOrder=Descending&Limit=1";

  try {
    var data = makeApiRequest(url);
    var it = (Array.isArray(data.Items) && data.Items[0]) ? data.Items[0] : null;
    return it ? getDateCreatedTicks(it) : 0;
  } catch (e) {
    dirRowsWarn("directorRows: head tick check failed:", e);
    return 0;
  }
}

function checkAndSyncNewItems({ force = false } = {}) {
  var db = STATE._db;
  var scope = STATE._scope;
  if (!db || !scope || !STATE.userId) return;
  if (!isDirectorRowsWorkerActive()) return;
  if (document.hidden && !force) return;
  if (STATE._backfillRunning) return;

  var headKey = "dirRows:lastHeadTick:" + (scope);
  var prev = Number(getMeta(db, headKey)) || 0;
  var now = fetchLibraryHeadTick(STATE.userId);
  if (!now) return;
  if (!force && prev && now <= prev) return;
  try { setMeta(db, headKey, now); } catch {}
  startDirectorIncrementalSync();
}

function __idle(cb, timeout = 1200) {
  if (typeof requestIdleCallback === "function") {
    var h = requestIdleCallbackfunction(() cb(), { timeout });
    return { type: "ric", h };
  }
  var h = setTimeoutfunction(() cb(), Math.max(0, timeout | 0));
  return { type: "to", h };
}

function __cancelIdle(handle) {
  if (!handle) return;
  try {
    if (handle.type === "ric" && typeof cancelIdleCallback === "function") cancelIdleCallback(handle.h);
    if (handle.type === "to") clearTimeout(handle.h);
  } catch {}
}

function runDirectorBackfillOnce({ pagesPerRun = 1, limit = 200 } = {}) {
  var db = STATE._db;
  var scope = STATE._scope;
  var userId = STATE.userId;
  if (!db || !scope || !userId) return;
  if (STATE._backfillRunning) return;

  STATE._backfillRunning = true;
  try {
    var cursorKey = "dirRows:backfillCursor:" + (scope);
    var doneKey   = "dirRows:backfillDoneAt:" + (scope);
    var startIndex  = Number(getMeta(db, cursorKey)) || 0;

    var fields = COMMON_FIELDS;
    var perPage = Math.max(50, Math.min(400, limit | 0));
    var pages   = Math.max(1, Math.min(6, pagesPerRun | 0));

    for (var p = 0; p < pages; p++) {
      if (!isDirectorRowsWorkerActive() || !STATE._db || !STATE._scope) break;

      var url =
        "/Users/" + (userId) + "/Items?IncludeItemTypes=Movie,Series&Recursive=true" +
        "&Fields=" + (fields) +
        "&EnableUserData=true" +
        "&SortBy=DateCreated&SortOrder=Descending" +
        "&StartIndex=" + (startIndex) +
        "&Limit=" + (perPage);

      var data = makeApiRequest(url);
      var items = Array.isArray(data.Items) ? data.Items : [];
      if (!items.length) {
        startIndex = 0;
        setMeta(db, cursorKey, startIndex);
        setMeta(db, doneKey, Date.now());
        break;
      }

      for (var it of items) {
        if (!it.Id) continue;
        upsertItem(db, scope, it);

        var ppl = Array.isArray(it.People) ? it.People : [];
        for (var person of ppl) {
          if (!person.Id || !person.Name) continue;
          if (String(person.Type || "").toLowerCase() !== "director") continue;
          upsertDirector(db, scope, { Id: person.Id, Name: person.Name, eligible: true });
          linkDirectorItem(db, scope, person.Id, it.Id);
        }
      }

      startIndex += items.length;
      setMeta(db, cursorKey, startIndex);

      if (items.length < perPage) {
        startIndex = 0;
        setMeta(db, cursorKey, startIndex);
        setMeta(db, doneKey, Date.now());
        break;
      }
    }
  } catch (e) {
    dirRowsWarn("directorRows: backfill failed:", e);
  } finally {
    STATE._backfillRunning = false;
  }
}

function startDirectorBackfillLoop() {
  var cfg = getConfig.() || config || {};
  var enabled = (cfg.directorRowsBackfillEnabled !== false);
  if (!enabled) return;

  if (__dirBackfillInterval) return;

  var intervalMs = Number.isFinite(cfg.directorRowsBackfillIntervalMs)
    ? Math.max(15_000, cfg.directorRowsBackfillIntervalMs | 0)
    : 45_000;

  var pagesPerRun = Number.isFinite(cfg.directorRowsBackfillPagesPerRun)
    ? Math.max(1, Math.min(6, cfg.directorRowsBackfillPagesPerRun | 0))
    : 1;

  var perPage = Number.isFinite(cfg.directorRowsBackfillLimit)
    ? Math.max(50, Math.min(400, cfg.directorRowsBackfillLimit | 0))
    : 200;
  var initialDelayMs = Number.isFinite(cfg.directorRowsBackfillInitialDelayMs)
    ? Math.max(30_000, cfg.directorRowsBackfillInitialDelayMs | 0)
    : Math.max(120_000, intervalMs);

  var schedule = function() {
    if (!isDirectorRowsWorkerActive()) return;
    if (!STATE._db || !STATE._scope || !STATE.userId) return;
    if (document.hidden) return;
    try {
      var doneKey = "dirRows:backfillDoneAt:" + (STATE._scope);
      var doneAt = getMeta(STATE._db, doneKey);
      if (doneAt) {
        try { clearInterval(__dirBackfillInterval); } catch {}
        __dirBackfillInterval = null;
       return;
      }
    } catch {}
    if (__dirBackfillIdleHandle) return;

    __dirBackfillIdleHandle = __idlefunction(() {
      __dirBackfillIdleHandle = null;
      runDirectorBackfillOnce({ pagesPerRun, limit: perPage });
    }, 1500);
  };

  __dirBackfillIdleHandle = __idlefunction(() {
    __dirBackfillIdleHandle = null;
    schedule();
  }, initialDelayMs);
  __dirBackfillInterval = setInterval(schedule, intervalMs);
}

function appendToParent(parent, node) {
  if (!parent || !node) return;
  if (node.parentElement === parent && node === parent.lastElementChild) return;
  parent.appendChild(node);
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
    return;
  }
  appendToParent(parent, node);
}

function hasRenderableDirectorRowsContent(root = STATE.hostEl || getHomeSectionsContainer() || document) {
  return getManagedDirectorSections(root).somefunction((section) !!section.querySelector(
    ".personal-recs-card, .no-recommendations, .dir-row-hero"
  ));
}

function clearDirectorRowsRetry() {
  if (__directorRowsRetryTo) {
    clearTimeout(__directorRowsRetryTo);
    __directorRowsRetryTo = null;
  }
}

function scheduleDirectorRowsRetry(ms = 1000, options = {}, reason = "retry") {
  clearDirectorRowsRetry();
  dirRowsWarn("retry:scheduled", {
    delayMs: Math.max(120, ms | 0),
    reason,
    force: options.force === true,
  });
  __directorRowsRetryTo = setTimeoutfunction(() {
    __directorRowsRetryTo = null;
    void mountDirectorRowsLazy(options);
  }, Math.max(120, ms | 0));
}

function scheduleDirectorInitWhenReady(mountState, { force = false } = {}) {
  if (force) {
    __directorDeferredSeq += 1;
    __directorDeferredStartPromise = null;
    dirRowsWarn("deferred:start:force-reset", {
      force,
      seq: __directorDeferredSeq,
    });
  }

  if (__directorDeferredStartPromise) {
    dirRowsLog("deferred:reuse-existing-promise", {
      force,
      seq: __directorDeferredSeq,
    });
    return __directorDeferredStartPromise;
  }

  var seq = __directorDeferredSeq;
  var initialMountState = mountState || resolveDirectorRowsMountState();
  try { window.__directorFirstRowReady = false; } catch {}
  setDirectorRowsDone(false);
  var run = enqueueManagedSectionRenderfunction("directorRows", () {
    try {
      var currentMountState = resolveDirectorRowsMountState(
        initialMountState.container,
        initialMountState.page
      );
      dirRowsLog("deferred:start", {
        force,
        seq,
        hasPage: !!currentMountState.page,
        hasContainer: !!currentMountState.container,
      });
      if (seq !== __directorDeferredSeq) return false;
      if (!isDirectorRowsMountStateValid(currentMountState)) {
        dirRowsWarn("deferred:abort:mount-invalid", {
          force,
          seq,
          hasPage: !!currentMountState.page,
          hasContainer: !!currentMountState.container,
        });
        return false;
      }
      STATE.hostEl = currentMountState.container;
      if (!force && hasRenderableDirectorRowsContent()) {
        dirRowsLog("deferred:skip:already-rendered", { seq });
        return true;
      }
      var mountKey = currentMountState.page || currentMountState.container;
      if (STATE.started && STATE.wrapEl === mountKey && mountKey.isConnected) {
        dirRowsLog("deferred:skip:state-started", { seq });
        return true;
      }
      dirRowsLog("render:start", {
        force,
        seq,
        sectionCount: getManagedDirectorSections().length,
      });
      initAndRenderFirstBatch(currentMountState);
      if (!hasRenderableDirectorRowsContent()) {
        dirRowsWarn("render:done-but-empty", {
          force,
          seq,
          sectionCount: getManagedDirectorSections().length,
        });
        scheduleDirectorRowsRetry(1400, { force: true }, "render-done-but-empty");
        return false;
      }
      dirRowsLog("render:success", {
        force,
        seq,
        sectionCount: getManagedDirectorSections().length,
      });
      clearDirectorRowsRetry();
      return true;
    } catch (e) {
      console.error(e);
      dirRowsWarn("render:error", {
        force,
        seq,
        error: e.message || String(e),
      });
      scheduleDirectorRowsRetry(1400, { force: true }, "render-error");
      try { cleanupDirectorRows(); } catch {}
      return false;
    }
  }, {
    timeoutMs: 25000,
    force,
    getAnchor: function() getDirectorRowsAnchor(initialMountState.container),
    isStillValid: function() (
      seq === __directorDeferredSeq &&
      isDirectorRowsMountStateValid(resolveDirectorRowsMountState(
        initialMountState.container,
        initialMountState.page
      ))
    ),
  });

  __directorDeferredStartPromise = run;
  run.finallyfunction(() {
    if (__directorDeferredStartPromise === run) {
      __directorDeferredStartPromise = null;
    }
  });
  return run;
}

export function mountDirectorRowsLazy(options = {}) {
  bindDirectorRowsSelfHealObserver();
  var force = options.force === true;
  if (__directorMountPromise) {
    if (!force) {
      dirRowsLog("mount:skip:existing-promise", { force });
      return __directorMountPromise;
    }
    dirRowsWarn("mount:force:await-existing-promise", { force });
    try { __directorMountPromise; } catch {}
  }
  var cfg = getConfig();
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  if (!homeSectionsConfig.enableDirectorRows) {
    dirRowsLog("mount:skip:disabled", { force });
    clearDirectorRowsRetry();
    try { cleanupDirectorRows(); } catch {}
    var existing = document.getElementById('director-rows');
    if (existing) { try { existing.remove(); } catch {} }
    return;
  }
  if (!isHomeRoute()) {
    dirRowsWarn("mount:skip:not-home", { force });
    return;
  }
  dirRowsLog("mount:start", {
    force,
    enableGenreHubs: homeSectionsConfig.enableGenreHubs,
  });
  dirRowsTrace("mount:start", {
    force,
    enableGenreHubs: homeSectionsConfig.enableGenreHubs,
    lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    stack: force ? buildDirTraceStack() : "",
  });

  var run = function(() {
    if (force) {
      dirRowsWarn("mount:force:cleanup-before-render", { force });
      cleanupDirectorRows();
    }

    var host = waitForVisibleHomeSections({
      timeout: 12000
    });
    if (!host.container || !isHomeRoute()) {
      dirRowsWarn("mount:retry:no-visible-home-sections", {
        force,
        hostPageId: host.page.id || null,
        hasContainer: !!host.container,
      });
      scheduleDirectorRowsRetry(1000, options, "no-visible-home-sections");
      return false;
    }
    var targetPage = getMountedDirectorRowsPage() || host.page || null;
    var homeParent = targetPage.querySelector.(".homeSectionsContainer");
    if (!homeParent) {
      dirRowsWarn("mount:retry:no-homeSectionsContainer", {
        force,
        hostPageId: targetPage.id || host.page.id || null,
      });
      scheduleDirectorRowsRetry(900, options, "no-homeSectionsContainer");
      return false;
    }
    bindManagedSectionsBelowNative(homeParent);
    STATE.hostEl = homeParent;
    dirRowsTrace("mount:host-ready", {
      force,
      hostPageId: host.page.id || null,
      targetPageId: targetPage.id || null,
      childCount: homeParent.children.length || 0,
    });
    if (!force && hasRenderableDirectorRowsContent()) {
      dirRowsLog("mount:skip:already-rendered", {
        force,
        sectionCount: getManagedDirectorSections().length,
      });
      clearDirectorRowsRetry();
      return true;
    }

    return scheduleDirectorInitWhenReady(
      resolveDirectorRowsMountState(homeParent, targetPage),
      { force }
    );
  })();

  __directorMountPromise = run;
  try {
    return run;
  } finally {
    if (__directorMountPromise === run) {
      __directorMountPromise = null;
    }
    if (STATE.hadMountedSections) {
      scheduleDirectorRowsSelfHeal("mount-finalize", 260);
    }
  }
}

function ensureIntoHomeSections(el, indexPage, { placeAfterId } = {}) {
  if (!el) return;
  var apply = function() {
    var page = indexPage ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
    if (!page) return;
    var container =
      page.querySelector(".homeSectionsContainer") ||
      document.querySelector(".homeSectionsContainer");
    if (!container) return false;

    appendToParent(container, el);
    try { container.__jmsManagedBelowNativeSchedule.(); } catch {}
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

function getHomeSectionsContainer(indexPage) {
  var page = indexPage ||
    getActiveHomePageEl.() ||
    getMountedDirectorRowsPage() ||
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!page) return;
  return page.querySelector(".homeSectionsContainer") ||
    document.querySelector(".homeSectionsContainer") ||
  page;
}

function initAndRenderFirstBatch(mountState) {
  if (!isDirectorRowsMountStateValid(mountState)) return;
  var mountKey = mountState.page || mountState.container;
  if (STATE.started) {
    var stale =
      !STATE.wrapEl ||
      !STATE.wrapEl.isConnected ||
      (mountKey && STATE.wrapEl !== mountKey);
    if (!stale) return;
    try { cleanupDirectorRows(); } catch {}
  }

  var initSeq = ++__dirInitSeq;
  var { userId, serverId } = getSessionInfo();
  if (!userId) return;

  STATE.started = true;
  STATE._bgStarted = true;
  STATE.wrapEl = mountKey;
  STATE.hostEl = mountState.container || STATE.hostEl || getHomeSectionsContainer();
  STATE.userId = userId;
  STATE.serverId = serverId;

  var warmResult = null;
  try {
    warmResult = warmDirectorRowsDb();
  } catch (e) {
    dirRowsWarn("directorRows: warmup failed during init:", e);
  }

  if (!STATE._db || !STATE._scope) {
    try {
      ensureDirectorRowsSession({ userId, serverId });
    } catch (e) {
      dirRowsWarn("directorRows: IndexedDB init failed:", e);
      STATE._db = null;
      STATE._scope = null;
    }
  }
  if (initSeq !== __dirInitSeq || !STATE.started || STATE.wrapEl !== mountKey || !mountKey.isConnected) return;

  var directorSource = warmResult || getDirectorWarmCache(STATE._scope);
  if (!directorSource) {
    directorSource = loadDirectorsFromDbOrApi(userId);
    setDirectorWarmCache(STATE._scope, directorSource);
  }

  var { directors, fromCache } = directorSource;
  if (initSeq !== __dirInitSeq || !STATE.started || STATE.wrapEl !== mountKey || !mountKey.isConnected) return;
  var rowCount = getDirectorRowsCount();
  STATE.directors = directors || [];
  STATE.maxRenderCount = rowCount;

  if (STATE.directors.length < rowCount) {
    dirRowsWarn("DirectorRows: apenas " + (STATE.directors.length) + "/" + (rowCount) + " diretores encontrados (a biblioteca pode estar limitada).");
  }

  STATE.nextIndex = 0;
  STATE.renderedCount = 0;
  setDirectorRowsDone(false);
  try { window.__directorFirstRowReady = false; } catch {}

  dirRowsLog("DirectorRows: " + (STATE.directors.length) + " yönetmen (" + (fromCache ? "DB cache" : "API") + ") , ilk row hemen render ediliyor...");

  var originalBatchSize = Math.max(1, Number(STATE.batchSize) || DIRECTOR_ROW_BATCH_SIZE);
  try {
    STATE.batchSize = DIRECTOR_ROW_BATCH_SIZE;
    while (
      initSeq === __dirInitSeq &&
      STATE.started &&
      STATE.wrapEl === mountKey &&
      mountKey.isConnected &&
      STATE.renderedCount < STATE.maxRenderCount &&
      STATE.nextIndex < STATE.directors.length
    ) {
      try {
        waitForManagedHomeRowRelease({
          anchor: getDirectorRowsAnchor(STATE.hostEl),
          timeoutMs: 25000,
          rootMargin: DIRECTOR_ROWS_RELEASE_ROOT_MARGIN,
        });
      } catch {}
      renderNextDirectorBatch();
      try {
        registerManagedHomeRowAnchor(getDirectorRowsAnchor(STATE.hostEl));
      } catch {}
      if (
        initSeq !== __dirInitSeq ||
        !STATE.started ||
        STATE.wrapEl !== mountKey ||
        !mountKey.isConnected
      ) {
        return;
      }
      if (STATE.renderedCount < STATE.maxRenderCount && STATE.nextIndex < STATE.directors.length) {
        yieldToMain(IS_MOBILE ? 104 : 42);
      }
    }
  } finally {
    STATE.batchSize = originalBatchSize;
    detachDirectorScrollIdleLoader();
  }

  if (initSeq !== __dirInitSeq || !STATE.started || STATE.wrapEl !== mountKey || !mountKey.isConnected) return;
  scheduleDirectorDeferredWarmTasks();
}

function renderNextDirectorBatch() {
  if (STATE.loading || STATE.renderedCount >= STATE.maxRenderCount) {
    if (STATE.renderedCount >= STATE.maxRenderCount) {
      setDirectorRowsDone(true);
    }
    return;
  }

  if (STATE.nextIndex >= STATE.directors.length) {
    dirRowsLog('Tüm yönetmenler render edildi.');
    setDirectorRowsDone(true);
    if (STATE.batchObserver) {
      STATE.batchObserver.disconnect();
    }
    return;
  }

  STATE.loading = true;
  setDirectorArrowLoading(true);
  var remainingCapacity = Math.max(0, STATE.maxRenderCount - STATE.renderedCount);
  var end = Math.min(
    STATE.nextIndex + Math.min(STATE.batchSize, remainingCapacity),
    STATE.directors.length
  );
  var slice = STATE.directors.slice(STATE.nextIndex, end);

  dirRowsLog("Render batch: " + (STATE.nextIndex) + "-" + (end) + " (" + (slice.length) + " yönetmen)");

  var prevCount = STATE.renderedCount;

  if (slice.length) {
    for (var i = 0; i < slice.length; i++) {
      var shell = renderDirectorSection(slice[i], {
        deferContent: true,
        sectionIndex: STATE.renderedCount
      });
      var mounted = false;
      try {
        mounted = fillRowWhenReady(shell.row, shell.dir, shell.heroHost);
      } catch (e) {
        dirRowsWarn('directorRows: section fill failed:', e);
      }
      if (mounted) {
        STATE.renderedCount++;
      } else {
        cleanupDirectorSection(shell.section);
      }

      if (i < slice.length - 1) {
        yieldToMain();
      }
    }
  }

  if (!window.__directorFirstRowReady && prevCount === 0 && STATE.renderedCount > 0) {
    window.__directorFirstRowReady = true;
    try {
      document.dispatchEvent(new Event("jms:director-first-ready"));
    } catch {}
  }

  STATE.nextIndex = end;
  STATE.loading = false;
  setDirectorArrowLoading(false);

  if (STATE.nextIndex >= STATE.directors.length || STATE.renderedCount >= STATE.maxRenderCount) {
    dirRowsLog('Tüm yönetmen rowları yüklendi.');
    setDirectorRowsDone(true);
    if (STATE.batchObserver) {
      STATE.batchObserver.disconnect();
      STATE.batchObserver = null;
    }
    detachDirectorScrollIdleLoader();
  }

  dirRowsLog("Render tamamlandı. Toplam: " + (STATE.renderedCount) + "/" + (STATE.directors.length) + " yönetmen");
}

function getDirectorUrl(directorId, directorName, serverId) {
  return "#/details?id=" + (directorId) + "&serverId=" + (encodeURIComponent(serverId));
}

function buildDirectorTitle(name) {
  var lbl = (getConfig().languageLabels || {}).showDirector || "Director {name}";
  var safeName = escapeHtml(name || "");
  if (lbl.includes("{name}")) {
    return lbl.replace("{name}", safeName);
  }
  return (escapeHtml(lbl)) + " " + (safeName);
}

function renderDirectorSection(dir, { deferContent = false, sectionIndex = 0 } = {}) {
  var section = document.createElement('section');
  section.id = makeManagedDirectorSectionId(sectionIndex);
  section.className = 'homeSection dir-row-section';

  var title = document.createElement('div');
  title.className = 'sectionTitleContainer sectionTitleContainer-cards';
  var dirTitleText = buildDirectorTitle(dir.Name);
  title.innerHTML = "\n    <h2 class=\"sectionTitle sectionTitle-cards dir-row-title\">\n      <span class=\"dir-row-title-text\" role=\"button\" tabindex=\"0\"\n        aria-label=\"" + ((labels.seeAll || config.languageLabels.seeAll || 'Ver tudo')) + ": " + (dirTitleText) + "\">\n        " + (dirTitleText) + "\n      </span>\n      <div class=\"dir-row-see-all\"\n           aria-label=\"" + ((labels.seeAll || config.languageLabels.seeAll || 'Ver tudo')) + "\"\n           title=\"" + ((labels.seeAll || config.languageLabels.seeAll || 'Ver tudo')) + "\">\n        " + (faIconHtml("chevronRight")) + "\n      </div>\n      <span class=\"dir-row-see-all-tip\">" + ((labels.seeAll || config.languageLabels.seeAll || 'Ver tudo')) + "</span>\n    </h2>\n  ";

  var titleBtn = title.querySelector('.dir-row-title-text');
  var seeAllBtn = title.querySelector('.dir-row-see-all');

  if (titleBtn) {
    var open = function(e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        openDirectorExplorer({ Id: dir.Id, Name: dir.Name });
      } catch (err) {
        console.error('Director explorer açılırken hata:', err);
      }
    };
    titleBtn.addEventListener('click', open, { passive: false });
    titleBtn.addEventListenerfunction('keydown', (e) {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  }

  if (seeAllBtn) {
    seeAllBtn.addEventListenerfunction('click', (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        openDirectorExplorer({ Id: dir.Id, Name: dir.Name });
      } catch (err) {
        console.error('Director explorer açılırken hata:', err);
      }
    }, { passive: false });
  }

  var scrollWrap = document.createElement('div');
  scrollWrap.className = 'personal-recs-scroll-wrap';

  var heroHost = document.createElement('div');
  heroHost.className = 'dir-row-hero-host';
  heroHost.style.display = SHOW_DIRECTOR_ROWS_HERO_CARDS ? '' : 'none';
  heroHost.style.visibility = 'hidden';

  var btnL = document.createElement('button');
  btnL.className = 'hub-scroll-btn hub-scroll-left';
  btnL.setAttribute('aria-label', (config.languageLabels.scrollLeft) || "Rolar para esquerda");
  btnL.setAttribute('aria-disabled', 'true');
  btnL.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z\"/></svg>";

  var row = document.createElement('div');
  row.className = 'itemsContainer personal-recs-row';
  row.setAttribute('role', 'list');

  var btnR = document.createElement('button');
  btnR.className = 'hub-scroll-btn hub-scroll-right';
  btnR.setAttribute('aria-label', (config.languageLabels.scrollRight) || "Rolar para direita");
  btnR.setAttribute('aria-disabled', 'true');
  btnR.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z\"/></svg>";

  scrollWrap.appendChild(btnL);
  scrollWrap.appendChild(row);
  scrollWrap.appendChild(btnR);

  section.appendChild(title);
  section.appendChild(heroHost);
  section.appendChild(scrollWrap);

  placeDirectorSection(section);
  placeDirectorLoadMoreArrow();
  if (deferContent) {
    return { section, row, heroHost, dir };
  }
  fillRowWhenReady(row, dir, heroHost).catchfunction((e) {
    dirRowsWarn('directorRows: deferred section fill failed:', e);
  });
  return { section, row, heroHost, dir };
}

function uniqById(list) {
  var seen = new Set();
  var out = [];
  for (var it of list || []) {
    if (!it.Id) continue;
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    out.push(it);
  }
  return out;
}

function scheduleDirectorCardPump(row, items, serverId, {
  startIndex = 0,
  limit = getDirectorRowCardCount(),
  chunkSize = getDirectorRowCardCount(),
  delay = DIRECTOR_MOBILE_CARD_DELAY_MS,
} = {}) {
  var currentIndex = Math.max(0, startIndex | 0);

  var pump = function() {
    if (!row.isConnected) return;
    if (currentIndex >= items.length || row.childElementCount >= limit) return;

    var frag = document.createDocumentFragment();
    var appended = 0;

    for (var i = 0; i < chunkSize && currentIndex < items.length; i++) {
      if (row.childElementCount + appended >= limit) break;
      frag.appendChild(createRecommendationCard(items[currentIndex], serverId, false));
      currentIndex++;
      appended++;
    }

    if (!appended) return;

    row.appendChild(frag);
    try { row.dispatchEvent(new Event('scroll')); } catch {}

    if (currentIndex < items.length && row.childElementCount < limit) {
      window.setTimeout(pump, Math.max(16, delay | 0));
    }
  };

  window.setTimeout(pump, Math.max(16, delay | 0));
}

function fillRowWhenReady(row, dir, heroHost){
  var section = row.closest.(".dir-row-section") || null;
  try {
    var rowCardCount = getDirectorRowCardCount();
    var NEED = rowCardCount + 1;
    if (!row.childElementCount) {
      setupScroller(row);
    }

    var items = [];

    if (STATE._db && STATE._scope) {
      try {
        items = getItemsForDirector(
          STATE._db,
          STATE._scope,
          dir.Id,
          NEED
        );
      } catch (e) {
        dirRowsWarn("directorRows: getItemsForDirector failed:", e);
      }
    }

    if ((items.length || 0) > 0 && STATE.userId) {
      try {
        var hydrateIds = (items || []).map(function(it) it.Id).filter(Boolean).slice(0, NEED);
        var cachedById = new Map((items || []).filter(function(it) it.Id).map(function(it) [it.Id, it]));
        var resolved = fetchItemsByIdsDetailed(STATE.userId, hydrateIds, COMMON_FIELDS);

        if (resolved.items.length) {
          persistItemsToDbLater(resolved.items);
        }
        if (resolved.missingIds.length) {
          pruneDeletedDirectorItemsLater(resolved.missingIds);
        }

        if (resolved.items.length || resolved.missingIds.length) {
          var liveById = new Map((resolved.items || []).filter(function(it) it.Id).map(function(it) [it.Id, it]));
          var failedSet = new Set((resolved.failedIds || []).filter(Boolean));
          var reconciled = [];
          var seen = new Set();

          for (var id of hydrateIds) {
            var it = liveById.get(id) || (failedSet.has(id) ? cachedById.get(id) : null);
            if (!it.Id || seen.has(it.Id)) continue;
            seen.add(it.Id);
            reconciled.push(it);
          }

          items = reconciled;
        }
      } catch (e) {
        dirRowsWarn("directorRows: cached items hydration failed:", e);
      }
    }

    if ((items.length || 0) < NEED) {
      var apiItems = fetchItemsByDirector(
        STATE.userId,
        dir.Id,
        Math.max(NEED * 3, rowCardCount * 2)
      );

      items = uniqById([...(items || []), ...(apiItems || [])]);

      if (items.length && STATE._db && STATE._scope) {
        persistDirectorItemsToDbLater(dir, items);
      }
    }

    if (!items.length) {
      if (heroHost) {
        heroHost.style.display = SHOW_DIRECTOR_ROWS_HERO_CARDS ? '' : 'none';
        clearDirectorHeroHost(heroHost);
      }
      cleanupDirectorSection(section);
      return false;
    }

    var pool = items.slice();
    var best = pickBestItemByRating(pool) || pool[0] || null;
    var remaining = best ? pool.filter(function(x) x.Id !== best.Id) : pool;

    if (heroHost) {
      var showHero = SHOW_DIRECTOR_ROWS_HERO_CARDS;
      heroHost.style.display = showHero ? '' : 'none';
      if (!showHero || !best) {
        clearDirectorHeroHost(heroHost);
      } else {
        var { hero: heroEl, changed } = mountDirectorHero(heroHost, best, STATE.serverId, dir.Name);
        try {
          var backdropImg = heroEl.querySelector.('.dir-row-hero-bg');
          var RemoteTrailers =
            best.RemoteTrailers ||
            best.RemoteTrailerItems ||
            best.RemoteTrailerUrls ||
            [];
          if (heroEl && (changed || !heroEl.querySelector('.intro-video-container'))) {
            createTrailerIframe({
              config,
              RemoteTrailers,
              slide: heroEl,
              backdropImg,
              itemId: best.Id,
              serverId: STATE.serverId,
              detailsUrl: getDetailsUrl(best.Id, STATE.serverId),
              detailsText: (config.languageLabels.details || labels.details || "Detalhes"),
              showDetailsOverlay: false,
            });
          }
        } catch {}
      }
    }

    cleanupDirectorRowsMount(row);
    row.innerHTML = "";

    if (!remaining.length) {
      cleanupDirectorSection(section);
      return false;
    }

    new Promisefunction((resolve) {
      var scrollerReady = false;
      progressivelyRenderCardRow({
        row,
        items: remaining,
        limit: rowCardCount,
        initialCount: Math.min(
          rowCardCount,
          IS_MOBILE ? Math.min(2, remaining.length) : Math.min(4, remaining.length)
        ),
        chunkSize: IS_MOBILE ? 2 : 3,
        delayMs: IS_MOBILE ? DIRECTOR_MOBILE_CARD_DELAY_MS : 34,
        appendCard: function(item, index) createRecommendationCard(
          item,
          STATE.serverId,
          index < (IS_MOBILE ? 2 : 4)
        ),
        onAppend: function() {
          if (!scrollerReady) {
            setupScroller(row);
            scrollerReady = true;
          }
          try { row.dispatchEvent(new Event('scroll')); } catch {}
        },
        onComplete: function() {
          if (!scrollerReady && row.isConnected) {
            setupScroller(row);
          }
          try { row.dispatchEvent(new Event('scroll')); } catch {}
          resolve();
        }
      });
    });

    return true;

  } catch (error) {
    console.error('Erro ao carregar conteúdo do diretor:', error);
    cleanupDirectorSection(section);
    return false;
  }
}

export function cleanupDirectorRows() {
  try {
    dirRowsLog("cleanup:start", {
      started: !!STATE.started,
      wrapConnected: !!STATE.wrapEl.isConnected,
    });
    dirRowsTrace("cleanup:start", {
      started: !!STATE.started,
      wrapConnected: !!STATE.wrapEl.isConnected,
      sectionCount: getManagedDirectorSections(document).length,
      lastCleanupReason: window.__jmsLastManagedCleanupReason || null,
    });
    clearDirectorRowsRetry();
    __dirInitSeq++;
    __directorDeferredSeq++;
    __directorMountPromise = null;
    __directorDeferredStartPromise = null;
    try { window.__directorFirstRowReady = false; } catch {}
    setDirectorRowsDone(false);
    if (__dirDeferredWarmTimer) {
      clearTimeout(__dirDeferredWarmTimer);
      __dirDeferredWarmTimer = null;
    }
    detachDirectorScrollIdleLoader();
    STATE.batchObserver.disconnect();
    STATE.sectionIOs.forEach(function(io) io.disconnect());
    STATE.sectionIOs.clear();

    if (__dirSyncInterval) {
      try { clearInterval(__dirSyncInterval); } catch {}
      __dirSyncInterval = null;
    }

    if (__dirBackfillInterval) {
      try { clearInterval(__dirBackfillInterval); } catch {}
      __dirBackfillInterval = null;
    }
    if (__dirBackfillIdleHandle) {
      try { __cancelIdle(__dirBackfillIdleHandle); } catch {}
      __dirBackfillIdleHandle = null;
    }
    if (__dirAutoPumpHandle) {
      try { __cancelIdle(__dirAutoPumpHandle); } catch {}
      __dirAutoPumpHandle = null;
    }

    var wrapEl = STATE.wrapEl;
    cleanupManagedDirectorSections(document);
    var legacyWrap = document.getElementById("director-rows");
    if (legacyWrap && legacyWrap !== wrapEl) {
      try { legacyWrap.replaceChildren(); } catch {}
      try { legacyWrap.remove(); } catch {}
    }
    if (wrapEl) {
      try { wrapEl.__pinMO.disconnect.(); } catch {}
      try {
        if (wrapEl.__pinHashChange) {
          window.removeEventListener('hashchange', wrapEl.__pinHashChange);
        }
      } catch {}
      try {
        if (wrapEl.__pinVisibilityChange) {
          document.removeEventListener('visibilitychange', wrapEl.__pinVisibilityChange);
        }
      } catch {}
      try { delete wrapEl.__pinMO; } catch {}
      try { delete wrapEl.__pinHashChange; } catch {}
      try { delete wrapEl.__pinVisibilityChange; } catch {}
      if (String(wrapEl.id || "") === "director-rows") {
        try { wrapEl.replaceChildren(); } catch {}
        try { wrapEl.remove(); } catch {}
      }
    }
    Object.keys(STATE).forEach(function(key) {
      if (key !== 'maxRenderCount') {
        STATE[key] = Array.isArray(STATE[key]) ? [] :
                    typeof STATE[key] === 'number' ? 0 :
                    typeof STATE[key] === 'boolean' ? false : null;
      }
    });
    STATE.batchSize = DIRECTOR_ROW_BATCH_SIZE;
    STATE.maxRenderCount = getDirectorRowsCount();
    STATE.sectionIOs = new Set();
    STATE.autoPumpScheduled = false;
    STATE.hadMountedSections = false;
    __directorRowsSelfHealPending = false;
    if (__directorRowsSelfHealTimer) {
      clearTimeout(__directorRowsSelfHealTimer);
      __directorRowsSelfHealTimer = null;
    }
    STATE.hostEl = null;
    STATE._db = null;
    STATE._scope = null;

  } catch (e) {
    dirRowsWarn('Director rows cleanup error:', e);
  }
}

export function releaseDirectorRowsDbConnection() {
  try { STATE._db.close.(); } catch {}
  STATE._db = null;
  STATE._scope = null;
}

(function bindDirectorRowsDbReleaseOnce() {
  if (window.__jmsDirectorRowsDbReleaseBound) return;
  window.__jmsDirectorRowsDbReleaseBound = true;

  window.addEventListenerfunction('jms:indexeddb:release', (event) {
    var dbName = event.detail.dbName;
    if (!dbName || dbName === 'jms_dirrows_db' || dbName === '*') {
      releaseDirectorRowsDbConnection();
    }
  });
})();

function clampText(s, max = 220) {
  var t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? (t.slice(0, max - 1) + "…") : t;
}

function escapeHtml(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
