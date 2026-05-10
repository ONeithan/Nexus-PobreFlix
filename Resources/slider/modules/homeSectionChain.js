import {
  getConfig,
  getHomeSectionsRuntimeConfig,
  getManagedHomeSectionRuntimeOrder
} from "./config.js";
var HOME_SCROLL_INTENT_EVENT = "jms:home-scroll-intent";
var HOME_SCROLL_INTENT_TTL_MS = 30_000;
var HOME_SCROLL_INTENT_END_PROGRESS_RATIO = 0.82;
var HOME_SCROLL_INTENT_MIN_PROGRESS_RATIO = 0.06;
var HOME_SCROLL_INTENT_MIN_ADVANCE_RATIO = 0.003;
var HOME_SECTION_TAIL_PRELOAD_RATIO = 0.28;
var HOME_SECTION_QUEUE_ACTIVATE_ROOT_MARGIN = "0px 0px 18% 0px";
var HOME_SECTION_QUEUE_HANDOFF_TIMEOUT_MS = 1800;
var HOME_SECTION_QUEUE_DISCOVERY_WAIT_MS = 350;
var HOME_SECTION_QUEUE_DISCOVERY_MAX_WAITS = 12;
var HOME_INITIAL_EAGER_ROW_COUNT = 5;
var HOME_SCROLL_TRACKER = {
  installed: false,
  rafId: 0,
  mutationObserver: null,
  elementTargets: new Set(),
  lastIntentAt: 0,
  routeKey: "",
  pendingUserCheck: false,
  lastWindowScrollPx: 0,
  targetScrollPx: new WeakMap(),
  nextTokenId: 0,
  pendingTokenId: 0,
  consumedTokenId: 0,
};
var MANAGED_RENDER_QUEUE = {
  tasks: [],
  draining: false,
  drainScheduled: false,
  activeTask: null,
  nextTaskId: 0,
  liveByKey: new Map(),
  startedKeys: new Set(),
  routeKey: "",
  generation: 0,
};
var MANAGED_HOME_ROW_RELEASE = {
  routeKey: "",
  nextIndex: 0,
  lastAnchor: null,
};

function isHomeRouteHash(hash = window.location.hash || "") {
  var h = String(hash || "").toLowerCase();
  return h.startsWith("#/home") || h.startsWith("#/index") || h === "" || h === "#";
}

function getCurrentHomeRouteKey() {
  try {
    return String(window.location.hash || "").toLowerCase();
  } catch {
    return "";
  }
}

function getActiveHomeRoot() {
  var page =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!page) return null;
  return page.querySelector(".homeSectionsContainer") || page;
}

function isScrollableElement(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  try {
    var style = window.getComputedStyle.(el);
    var overflowY = (style.overflowY || "") + " " + (style.overflow || "").toLowerCase();
    return /(auto|scroll|overlay)/.test(overflowY) && el.scrollHeight > (el.clientHeight + 2);
  } catch {
    return false;
  }
}

function collectHomeScrollElementTargets() {
  var out = [];
  var seen = new Set();
  var node = getActiveHomeRoot();
  while (node) {
    if (isScrollableElement(node) && !seen.has(node)) {
      seen.add(node);
      out.push(node);
    }
    node = node.parentElement;
  }
  return out;
}

function getScrollTargetViewportSize(target) {
  if (target === window || target === document) {
    var docEl = document.scrollingElement || document.documentElement;
    return Math.max(window.innerHeight || 0, docEl.clientHeight || 0);
  }
  return Math.max(0, target.clientHeight || 0);
}

function clamp01(value) {
  var n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function ensureManagedHomeRowReleaseState() {
  var routeKey = getCurrentHomeRouteKey();
  if (MANAGED_HOME_ROW_RELEASE.routeKey !== routeKey) {
    MANAGED_HOME_ROW_RELEASE.routeKey = routeKey;
    MANAGED_HOME_ROW_RELEASE.nextIndex = 0;
    MANAGED_HOME_ROW_RELEASE.lastAnchor = null;
  }
  return MANAGED_HOME_ROW_RELEASE;
}

export function resetManagedHomeRowReleaseState() {
  MANAGED_HOME_ROW_RELEASE.routeKey = getCurrentHomeRouteKey();
  MANAGED_HOME_ROW_RELEASE.nextIndex = 0;
  MANAGED_HOME_ROW_RELEASE.lastAnchor = null;
}

function getRemainingScrollPx(target) {
  if (target === window || target === document) {
    var docEl = document.scrollingElement || document.documentElement;
    var top = Math.max(
      window.scrollY || 0,
      docEl.scrollTop || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );
    var viewport = getScrollTargetViewportSize(window);
    var scrollHeight = Math.max(
      docEl.scrollHeight || 0,
      document.documentElement.scrollHeight || 0,
      document.body.scrollHeight || 0
    );
    return scrollHeight - top - viewport;
  }

  return (target.scrollHeight || 0) - (target.scrollTop || 0) - (target.clientHeight || 0);
}

function getCurrentScrollPx(target) {
  if (target === window || target === document) {
    var docEl = document.scrollingElement || document.documentElement;
    return Math.max(
      window.scrollY || 0,
      docEl.scrollTop || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );
  }
  return Math.max(0, target.scrollTop || 0);
}

function getMaxScrollablePx(target) {
  var viewport = getScrollTargetViewportSize(target);
  if (target === window || target === document) {
    var docEl = document.scrollingElement || document.documentElement;
    var scrollHeight = Math.max(
      docEl.scrollHeight || 0,
      document.documentElement.scrollHeight || 0,
      document.body.scrollHeight || 0
    );
    return Math.max(0, scrollHeight - viewport);
  }
  return Math.max(0, (target.scrollHeight || 0) - viewport);
}

function getScrollProgressRatio(target) {
  var maxScrollable = getMaxScrollablePx(target);
  if (!Number.isFinite(maxScrollable) || maxScrollable <= 0) return 0;
  return clamp01(getCurrentScrollPx(target) / maxScrollable);
}

function hasMeaningfulScrollAdvance(target, currentScrollPx, previousScrollPx) {
  if (!Number.isFinite(currentScrollPx) || !Number.isFinite(previousScrollPx)) return false;
  if (currentScrollPx <= previousScrollPx) return false;
  var maxScrollable = getMaxScrollablePx(target);
  if (!Number.isFinite(maxScrollable) || maxScrollable <= 0) return true;
  var previousRatio = clamp01(previousScrollPx / maxScrollable);
  var currentRatio = clamp01(currentScrollPx / maxScrollable);
  return (currentRatio - previousRatio) >= HOME_SCROLL_INTENT_MIN_ADVANCE_RATIO;
}

function isNearScrollEnd(target) {
  var maxScrollable = getMaxScrollablePx(target);
  if (!Number.isFinite(maxScrollable) || maxScrollable <= 0) return false;
  var progress = getScrollProgressRatio(target);
  return progress >= HOME_SCROLL_INTENT_END_PROGRESS_RATIO &&
    progress > HOME_SCROLL_INTENT_MIN_PROGRESS_RATIO;
}

function markHomeScrollIntent() {
  if (!isHomeRouteHash()) return;
  var now = Date.now();
  var routeKey = getCurrentHomeRouteKey();
  var nextTokenId = HOME_SCROLL_TRACKER.nextTokenId + 1;

  HOME_SCROLL_TRACKER.routeKey = routeKey;
  HOME_SCROLL_TRACKER.lastIntentAt = now;
  HOME_SCROLL_TRACKER.nextTokenId = nextTokenId;
  HOME_SCROLL_TRACKER.pendingTokenId = nextTokenId;
  HOME_SCROLL_TRACKER.consumedTokenId = 0;

  try { document.dispatchEvent(new Event(HOME_SCROLL_INTENT_EVENT)); } catch {}
}

function hasFreshHomeScrollIntent({ maxAgeMs = HOME_SCROLL_INTENT_TTL_MS } = {}) {
  if (!isHomeRouteHash()) return false;
  if (HOME_SCROLL_TRACKER.routeKey !== getCurrentHomeRouteKey()) return false;
  if (!HOME_SCROLL_TRACKER.pendingTokenId) return false;
  if (HOME_SCROLL_TRACKER.pendingTokenId === HOME_SCROLL_TRACKER.consumedTokenId) return false;
  var age = Date.now() - (HOME_SCROLL_TRACKER.lastIntentAt || 0);
  return age >= 0 && age <= Math.max(0, maxAgeMs | 0);
}

function consumeHomeScrollIntent({ maxAgeMs = HOME_SCROLL_INTENT_TTL_MS } = {}) {
  if (!hasFreshHomeScrollIntent({ maxAgeMs })) return false;
  HOME_SCROLL_TRACKER.consumedTokenId = HOME_SCROLL_TRACKER.pendingTokenId;
  return true;
}

function refreshHomeScrollTrackerTargets() {
  var nextTargets = new Set(collectHomeScrollElementTargets());

  for (var target of Array.from(HOME_SCROLL_TRACKER.elementTargets)) {
    if (!nextTargets.has(target) || !target.isConnected) {
      try { target.removeEventListener("scroll", handleHomeUserActivity); } catch {}
      HOME_SCROLL_TRACKER.elementTargets.delete(target);
    }
  }

  for (var target of nextTargets) {
    if (HOME_SCROLL_TRACKER.elementTargets.has(target)) continue;
    try {
      target.addEventListener("scroll", handleHomeUserActivity, { passive: true });
      HOME_SCROLL_TRACKER.targetScrollPx.set(target, getCurrentScrollPx(target));
    } catch {}
    HOME_SCROLL_TRACKER.elementTargets.add(target);
  }
}

function checkHomeScrollIntentNow() {
  if (!isHomeRouteHash()) {
    HOME_SCROLL_TRACKER.lastIntentAt = 0;
    HOME_SCROLL_TRACKER.routeKey = "";
    HOME_SCROLL_TRACKER.pendingUserCheck = false;
    HOME_SCROLL_TRACKER.pendingTokenId = 0;
    HOME_SCROLL_TRACKER.consumedTokenId = 0;
    HOME_SCROLL_TRACKER.targetScrollPx = new WeakMap();
    return false;
  }

  var fromUser = HOME_SCROLL_TRACKER.pendingUserCheck === true;
  HOME_SCROLL_TRACKER.pendingUserCheck = false;

  var prevWindowScrollPx = HOME_SCROLL_TRACKER.lastWindowScrollPx || 0;
  if (!Number.isFinite(prevWindowScrollPx)) prevWindowScrollPx = 0;
  var currentWindowScrollPx = getCurrentScrollPx(window);
  var advancedWindow = hasMeaningfulScrollAdvance(window, currentWindowScrollPx, prevWindowScrollPx);
  HOME_SCROLL_TRACKER.lastWindowScrollPx = currentWindowScrollPx;

  for (var target of HOME_SCROLL_TRACKER.elementTargets) {
    if (!target.isConnected) continue;
    var prevTargetScrollPx = HOME_SCROLL_TRACKER.targetScrollPx.get(target) || 0;
    if (!Number.isFinite(prevTargetScrollPx)) prevTargetScrollPx = 0;
    var currentTargetScrollPx = getCurrentScrollPx(target);
    var advancedTarget = hasMeaningfulScrollAdvance(target, currentTargetScrollPx, prevTargetScrollPx);
    HOME_SCROLL_TRACKER.targetScrollPx.set(target, currentTargetScrollPx);

    if (fromUser && advancedTarget && isNearScrollEnd(target)) {
      markHomeScrollIntent();
      return true;
    }
  }

  if (fromUser && advancedWindow && (isNearScrollEnd(window) || isNearScrollEnd(document))) {
    markHomeScrollIntent();
    return true;
  }

  return false;
}

function scheduleHomeScrollIntentCheck({ fromUser = false } = {}) {
  if (fromUser) {
    HOME_SCROLL_TRACKER.pendingUserCheck = true;
  }
  if (HOME_SCROLL_TRACKER.rafId) return;
  HOME_SCROLL_TRACKER.rafId = requestAnimationFramefunction(() {
    HOME_SCROLL_TRACKER.rafId = 0;
    refreshHomeScrollTrackerTargets();
    checkHomeScrollIntentNow();
  });
}

function handleHomeUserActivity() {
  scheduleHomeScrollIntentCheck({ fromUser: true });
}

function handleHomePassiveActivity() {
  scheduleHomeScrollIntentCheck();
}

function ensureHomeScrollIntentTracking() {
  if (HOME_SCROLL_TRACKER.installed) {
    scheduleHomeScrollIntentCheck();
    return;
  }

  HOME_SCROLL_TRACKER.installed = true;
  HOME_SCROLL_TRACKER.lastWindowScrollPx = getCurrentScrollPx(window);
  window.addEventListener("scroll", handleHomeUserActivity, { passive: true, capture: true });
  document.addEventListener("scroll", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("resize", handleHomePassiveActivity, { passive: true });
  window.addEventListener("wheel", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("touchmove", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("touchend", handleHomeUserActivity, { passive: true, capture: true });
  window.addEventListener("hashchange", handleHomePassiveActivity, { passive: true });

  var observerTarget = document.body || document.documentElement || null;
  if (observerTarget && typeof MutationObserver === "function") {
    HOME_SCROLL_TRACKER.mutationObserver = new MutationObserverfunction(() {
      handleHomePassiveActivity();
    });
    try {
      HOME_SCROLL_TRACKER.mutationObserver.observe(observerTarget, {
        childList: true,
        subtree: true,
      });
    } catch {
      HOME_SCROLL_TRACKER.mutationObserver = null;
    }
  }

  scheduleHomeScrollIntentCheck();
}

function getSectionState(source = null) {
  var cfg = source || getConfig.() || {};
  var runtime = getHomeSectionsRuntimeConfig(cfg);
  return {
    cfg,
    runtime,
    top10SeriesRows: runtime.enableTop10SeriesRowsSection === true,
    top10MovieRows: runtime.enableTop10MovieRowsSection === true,
    tmdbTopMoviesRows: runtime.enableTmdbTopMoviesRowsSection === true,
    recentRows: runtime.enableRecentRowsSection === true,
    continueRows: runtime.enableContinueRowsSection === true,
    nextUpRows: runtime.enableNextUpRowsSection === true,
    personalRecommendations: runtime.enablePersonalRecommendations !== false,
    becauseYouWatched: runtime.enableBecauseYouWatched !== false,
    genreHubs: runtime.enableGenreHubs !== false,
    directorRows: runtime.enableDirectorRows !== false,
    studioHubs: runtime.enableStudioHubs !== false,
  };
}

function normalizeExcludedSectionKeys(excludeKeys = []) {
  return new Set(
    (Array.isArray(excludeKeys) ? excludeKeys : [])
      .mapfunction((key) String(key || "").trim())
      .filter(Boolean)
  );
}

function isSectionEnabled(key, state) {
  return !!state.[key];
}

function delay(ms = 0) {
  return new Promisefunction((resolve) {
    setTimeout(resolve, Math.max(0, ms | 0));
  });
}

export function getManagedSectionDependencyKeys(targetKey, source = null, { excludeKeys = [] } = {}) {
  var state = getSectionState(source);
  if (!isSectionEnabled(targetKey, state)) {
    return [];
  }

  var ordered = getManagedHomeSectionRuntimeOrder(source, { enabledOnly: true });
  var targetIndex = ordered.indexOf(targetKey);
  if (targetIndex <= 0) {
    return [];
  }

  var excluded = normalizeExcludedSectionKeys(excludeKeys);
  return ordered
    .slice(0, targetIndex)
    .filterfunction((key) !excluded.has(key))
    .reverse();
}

function hasSectionReady(key) {
  try {
    if (key === "studioHubs") return window.__jmsStudioHubsReady === true;
    if (key === "top10SeriesRows") return window.__jmsTop10SeriesRowsDone === true;
    if (key === "top10MovieRows") return window.__jmsTop10MovieRowsDone === true;
    if (key === "tmdbTopMoviesRows") return window.__jmsTmdbTopMoviesRowsDone === true;
    if (key === "recentRows") return window.__jmsRecentRowsDone === true;
    if (key === "continueRows") return window.__jmsContinueRowsDone === true;
    if (key === "nextUpRows") return window.__jmsNextUpRowsDone === true;
    if (key === "personalRecommendations") return window.__jmsPersonalRecsDone === true;
    if (key === "becauseYouWatched") return window.__jmsBywDone === true;
    if (key === "genreHubs") {
      return window.__jmsGenreFirstReady === true || window.__jmsGenreHubsDone === true;
    }
    if (key === "directorRows") return window.__directorFirstRowReady === true;
  } catch {}
  return false;
}

function getSectionReadyEvents(key) {
  if (key === "studioHubs") return ["jms:studio-hubs-ready"];
  if (key === "top10SeriesRows") return ["jms:top10-series-rows-done"];
  if (key === "top10MovieRows") return ["jms:top10-movie-rows-done"];
  if (key === "tmdbTopMoviesRows") return ["jms:tmdb-top-movie-rows-done"];
  if (key === "recentRows") return ["jms:recent-rows-done"];
  if (key === "continueRows") return ["jms:continue-rows-done"];
  if (key === "nextUpRows") return ["jms:nextup-rows-done"];
  if (key === "personalRecommendations") return ["jms:personal-recommendations-done"];
  if (key === "becauseYouWatched") return ["jms:because-you-watched-done"];
  if (key === "genreHubs") return ["jms:genre-first-ready", "jms:genre-hubs-done"];
  if (key === "directorRows") return ["jms:director-first-ready"];
  return [];
}

function hasRenderableCards(root, selector) {
  if (!root.isConnected) return false;
  try {
    return !!root.querySelector(selector);
  } catch {
    return false;
  }
}

function getManagedSectionsByPrefix(prefix = "") {
  if (!prefix) return [];
  return Array.from(document.querySelectorAll("[id^=\"" + (prefix) + "\"]"))
    .filterfunction((el) el.isConnected)
    .sortfunction((left, right) {
      var li = Number(String(left.id || "").slice(prefix.length)) || 0;
      var ri = Number(String(right.id || "").slice(prefix.length)) || 0;
      return li - ri;
    });
}

function getManagedSectionTail(prefix = "") {
  var sections = getManagedSectionsByPrefix(prefix);
  return sections.length ? sections[sections.length - 1] : null;
}

function hasRenderableManagedSections(prefix = "", selector = "") {
  return getManagedSectionsByPrefix(prefix).somefunction((section) hasRenderableCards(section, selector));
}

function hasSectionRenderableContent(key) {
  if (key === "studioHubs") {
    return hasRenderableCards(
      document.getElementById("studio-hubs"),
      ".studio-hub-card, .studio-card, .hub-card:not(.skeleton), .no-recommendations"
    );
  }

  if (key === "top10SeriesRows") {
    return hasRenderableManagedSections(
      "top10-series-rows--",
      ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations"
    );
  }

  if (key === "top10MovieRows") {
    return hasRenderableManagedSections(
      "top10-movie-rows--",
      ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations"
    );
  }

  if (key === "tmdbTopMoviesRows") {
    return hasRenderableManagedSections(
      "tmdb-top-movie-rows--",
      ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations"
    );
  }

  if (key === "recentRows") {
    return hasRenderableManagedSections(
      "recent-rows--",
      ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations, .recent-row-section .dir-row-hero"
    );
  }

  if (key === "continueRows") {
    return hasRenderableManagedSections(
      "continue-rows--",
      ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations, .recent-row-section .dir-row-hero"
    );
  }

  if (key === "nextUpRows") {
    return hasRenderableManagedSections(
      "nextup-rows--",
      ".recent-row-section .personal-recs-card:not(.skeleton), .recent-row-section .no-recommendations, .recent-row-section .dir-row-hero"
    );
  }

  if (key === "personalRecommendations") {
    return hasRenderableCards(
      document.getElementById("personal-recommendations"),
      ".personal-recs-row .personal-recs-card:not(.skeleton), .personal-recs-row .no-recommendations"
    );
  }

  if (key === "becauseYouWatched") {
    return getBecauseYouWatchedSections().somefunction((section) hasRenderableCards(
      section,
      ".byw-row .personal-recs-card:not(.skeleton), .byw-row .no-recommendations"
    ));
  }

  if (key === "genreHubs") {
    return hasRenderableCards(
      document.getElementById("genre-hubs"),
      ".genre-hub-section .genre-row .personal-recs-card:not(.skeleton), .genre-hub-section .genre-row .no-recommendations"
    );
  }

  if (key === "directorRows") {
    return hasRenderableManagedSections(
      "director-rows--",
      ".dir-row-section .personal-recs-card:not(.skeleton), .dir-row-section .no-recommendations, .dir-row-section .dir-row-hero"
    );
  }

  return false;
}

var COMPLETION_GATED_SECTION_KEYS = new Set([
  "top10SeriesRows",
  "top10MovieRows",
  "tmdbTopMoviesRows",
  "recentRows",
  "continueRows",
  "nextUpRows",
  "becauseYouWatched",
  "genreHubs",
  "directorRows",
]);

function isSectionReadyForGate(key) {
  if (COMPLETION_GATED_SECTION_KEYS.has(key)) {
    return hasSectionCompleted(key);
  }
  return hasSectionReady(key) || hasSectionRenderableContent(key);
}

function hasSectionCompleted(key) {
  try {
    if (key === "studioHubs") return window.__jmsStudioHubsReady === true;
    if (key === "top10SeriesRows") return window.__jmsTop10SeriesRowsDone === true;
    if (key === "top10MovieRows") return window.__jmsTop10MovieRowsDone === true;
    if (key === "tmdbTopMoviesRows") return window.__jmsTmdbTopMoviesRowsDone === true;
    if (key === "recentRows") return window.__jmsRecentRowsDone === true;
    if (key === "continueRows") return window.__jmsContinueRowsDone === true;
    if (key === "nextUpRows") return window.__jmsNextUpRowsDone === true;
    if (key === "personalRecommendations") return window.__jmsPersonalRecsDone === true;
    if (key === "becauseYouWatched") return window.__jmsBywDone === true;
    if (key === "genreHubs") return window.__jmsGenreHubsDone === true;
    if (key === "directorRows") return window.__jmsDirectorRowsDone === true;
  } catch {}
  return false;
}

function getSectionCompletionEvents(key) {
  if (key === "studioHubs") return ["jms:studio-hubs-ready"];
  if (key === "top10SeriesRows") return ["jms:top10-series-rows-done"];
  if (key === "top10MovieRows") return ["jms:top10-movie-rows-done"];
  if (key === "tmdbTopMoviesRows") return ["jms:tmdb-top-movie-rows-done"];
  if (key === "recentRows") return ["jms:recent-rows-done"];
  if (key === "continueRows") return ["jms:continue-rows-done"];
  if (key === "nextUpRows") return ["jms:nextup-rows-done"];
  if (key === "personalRecommendations") return ["jms:personal-recommendations-done"];
  if (key === "becauseYouWatched") return ["jms:because-you-watched-done"];
  if (key === "genreHubs") return ["jms:genre-hubs-done"];
  if (key === "directorRows") return ["jms:director-rows-done"];
  return [];
}

export function waitForManagedSectionReady(key, { timeoutMs = 20000 } = {}) {
  if (!key || isSectionReadyForGate(key)) {
    return Promise.resolve();
  }

  var events = getSectionReadyEvents(key);
  if (!events.length && typeof MutationObserver !== "function") {
    return Promise.resolve();
  }

  return new Promisefunction((resolve) {
    var done = false;
    var timeoutId = null;
    var observer = null;

    var finish = function() {
      if (done) return;
      done = true;
      for (var eventName of events) {
        try { document.removeEventListener(eventName, onReady); } catch {}
      }
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      resolve();
    };

    var onReady = function() {
      if (isSectionReadyForGate(key)) {
        finish();
      }
    };

    for (var eventName of events) {
      document.addEventListener(eventName, onReady);
    }

    var observerTarget = document.body || document.documentElement || null;
    if (observerTarget && typeof MutationObserver === "function") {
      observer = new MutationObserverfunction(() {
        onReady();
      });

      try {
        observer.observe(observerTarget, {
          childList: true,
          subtree: true,
        });
      } catch {
        observer = null;
      }
    }

    timeoutId = setTimeout(finish, Math.max(0, timeoutMs | 0));
    onReady();
  });
}

export function waitForManagedSectionCompletion(key, { timeoutMs = 20000 } = {}) {
  if (!key || hasSectionCompleted(key)) {
    return Promise.resolve();
  }

  var events = getSectionCompletionEvents(key);
  if (!events.length && typeof MutationObserver !== "function") {
    return Promise.resolve();
  }

  return new Promisefunction((resolve) {
    var done = false;
    var timeoutId = null;
    var observer = null;

    var finish = function() {
      if (done) return;
      done = true;
      for (var eventName of events) {
        try { document.removeEventListener(eventName, onReady); } catch {}
      }
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      resolve();
    };

    var onReady = function() {
      if (hasSectionCompleted(key)) {
        finish();
      }
    };

    for (var eventName of events) {
      document.addEventListener(eventName, onReady);
    }

    var observerTarget = document.body || document.documentElement || null;
    if (observerTarget && typeof MutationObserver === "function") {
      observer = new MutationObserverfunction(() {
        onReady();
      });

      try {
        observer.observe(observerTarget, {
          childList: true,
          subtree: true,
        });
      } catch {
        observer = null;
      }
    }

    timeoutId = setTimeout(finish, Math.max(0, timeoutMs | 0));
    onReady();
  });
}

function isElementNearViewport(anchor, rootMargin = HOME_SECTION_QUEUE_ACTIVATE_ROOT_MARGIN) {
  if (!anchor.isConnected) return true;
  var rect = anchor.getBoundingClientRect.();
  if (!rect) return true;
  var viewport = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 0);
  var preloadRatio = parseBottomRootMarginRatio(rootMargin);
  return rect.top <= (viewport * (1 + preloadRatio));
}

function getManagedRenderQueueOrderedKeys(source = null) {
  var ordered = getManagedHomeSectionRuntimeOrder(source, { enabledOnly: true });
  return Array.isArray(ordered) ? ordered : [];
}

function hasPendingManagedRenderTaskForKey(key) {
  return MANAGED_RENDER_QUEUE.tasks.somefunction((task) task.key === key);
}

function shouldDelayManagedRenderTask(task) {
  if (!task.key) return false;
  if ((task.discoveryWaits || 0) >= HOME_SECTION_QUEUE_DISCOVERY_MAX_WAITS) return false;

  var ordered = getManagedRenderQueueOrderedKeys(task.options.source);
  var targetIndex = ordered.indexOf(task.key);
  if (targetIndex <= 0) return false;

  var earlierKeys = ordered.slice(0, targetIndex);
  for (var earlierKey of earlierKeys) {
    if (MANAGED_RENDER_QUEUE.startedKeys.has(earlierKey)) continue;
    if (MANAGED_RENDER_QUEUE.activeTask.key === earlierKey) continue;
    if (hasPendingManagedRenderTaskForKey(earlierKey)) continue;
    if (isSectionReadyForGate(earlierKey) || hasSectionCompleted(earlierKey)) continue;
    return true;
  }

  return false;
}

function pickNextManagedRenderTask() {
  if (!MANAGED_RENDER_QUEUE.tasks.length) return null;

  var ordered = getManagedRenderQueueOrderedKeys();
  if (ordered.length) {
    for (var key of ordered) {
      var index = MANAGED_RENDER_QUEUE.tasks.findIndexfunction((task) task.key === key);
      if (index >= 0) {
        return MANAGED_RENDER_QUEUE.tasks.splice(index, 1)[0] || null;
      }
    }
  }

  return MANAGED_RENDER_QUEUE.tasks.shift() || null;
}

function finalizeManagedRenderTask(task) {
  if (!task.key) return;
  if (MANAGED_RENDER_QUEUE.liveByKey.get(task.key) === task) {
    MANAGED_RENDER_QUEUE.liveByKey.delete(task.key);
  }
}

function resolveManagedRenderTask(task, value = false) {
  if (!task) return;
  try { task.resolve.(value); } catch {}
}

function resetManagedRenderQueueState({ resolvePending = true } = {}) {
  MANAGED_RENDER_QUEUE.generation += 1;
  var nextGeneration = MANAGED_RENDER_QUEUE.generation;

  var pendingTasks = Array.isArray(MANAGED_RENDER_QUEUE.tasks)
    ? MANAGED_RENDER_QUEUE.tasks.slice()
    : [];
  MANAGED_RENDER_QUEUE.tasks = [];

  var activeTask = MANAGED_RENDER_QUEUE.activeTask || null;
  MANAGED_RENDER_QUEUE.activeTask = null;

  if (resolvePending) {
    for (var task of pendingTasks) {
      task.cancelled = true;
      resolveManagedRenderTask(task, false);
    }
    if (activeTask) {
      activeTask.cancelled = true;
      resolveManagedRenderTask(activeTask, false);
    }
  } else if (activeTask) {
    activeTask.cancelled = true;
  }

  MANAGED_RENDER_QUEUE.liveByKey.clear();
  MANAGED_RENDER_QUEUE.startedKeys.clear();
  MANAGED_RENDER_QUEUE.draining = false;
  MANAGED_RENDER_QUEUE.drainScheduled = false;
  if (getCurrentHomeRouteKey() !== MANAGED_HOME_ROW_RELEASE.routeKey) {
    MANAGED_HOME_ROW_RELEASE.routeKey = "";
    MANAGED_HOME_ROW_RELEASE.nextIndex = 0;
    MANAGED_HOME_ROW_RELEASE.lastAnchor = null;
  }
  return nextGeneration;
}

export function registerManagedHomeRowAnchor(anchor) {
  var state = ensureManagedHomeRowReleaseState();
  if (anchor.isConnected) {
    state.lastAnchor = anchor;
  }
  return state.nextIndex;
}

export function waitForManagedHomeRowRelease({
  anchor = null,
  eagerRows = HOME_INITIAL_EAGER_ROW_COUNT,
  timeoutMs = 25000,
  rootMargin = "0px 0px 0px 0px",
} = {}) {
  var state = ensureManagedHomeRowReleaseState();
  var releaseIndex = state.nextIndex++;
  if (releaseIndex < Math.max(1, eagerRows | 0)) {
    return Promise.resolve(releaseIndex);
  }

  var releaseAnchor = anchor.isConnected
    ? anchor
    : (state.lastAnchor.isConnected ? state.lastAnchor : null);
  if (!releaseAnchor) {
    return Promise.resolve(releaseIndex);
  }

  return Promise.resolve(
    waitForSectionTailAdvance(releaseAnchor, {
      timeoutMs,
      rootMargin,
    })
  ).thenfunction(() releaseIndex).catchfunction(() releaseIndex);
}

export function waitForManagedSectionViewportReveal(anchor, {
  timeoutMs = 20000,
  rootMargin = HOME_SECTION_QUEUE_ACTIVATE_ROOT_MARGIN,
} = {}) {
  if (!anchor.isConnected || isElementNearViewport(anchor, rootMargin)) {
    return Promise.resolve();
  }

  if (typeof IntersectionObserver !== "function") {
    return new Promisefunction((resolve) {
      var done = false;
      var timeoutId = null;

      var finish = function() {
        if (done) return;
        done = true;
        try { window.removeEventListener("scroll", onActivity, true); } catch {}
        try { document.removeEventListener("scroll", onActivity, true); } catch {}
        try { window.removeEventListener("resize", onActivity, true); } catch {}
        if (timeoutId) {
          try { clearTimeout(timeoutId); } catch {}
        }
        resolve();
      };

      var onActivity = function() {
        if (!anchor.isConnected || isElementNearViewport(anchor, rootMargin)) {
          finish();
        }
      };

      window.addEventListener("scroll", onActivity, { passive: true, capture: true });
      document.addEventListener("scroll", onActivity, { passive: true, capture: true });
      window.addEventListener("resize", onActivity, { passive: true, capture: true });
      timeoutId = setTimeout(finish, Math.max(0, timeoutMs | 0));
      onActivity();
    });
  }

  return new Promisefunction((resolve) {
    var done = false;
    var timeoutId = null;
    var observer = null;
    var resizeObserver = null;

    var finish = function() {
      if (done) return;
      done = true;
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      timeoutId = null;
      try { window.removeEventListener("scroll", onActivity, true); } catch {}
      try { document.removeEventListener("scroll", onActivity, true); } catch {}
      try { window.removeEventListener("resize", onActivity, true); } catch {}
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch {}
      }
      resolve();
    };

    var onActivity = function() {
      if (!anchor.isConnected || isElementNearViewport(anchor, rootMargin)) {
        finish();
      }
    };

    observer = new IntersectionObserverfunction((entries) {
      for (var entry of entries) {
        if (entry.target !== anchor) continue;
        if (entry.isIntersecting) {
          finish();
          break;
        }
      }
    }, {
      root: null,
      rootMargin,
      threshold: 0.01,
    });

    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("scroll", onActivity, { passive: true, capture: true });
    window.addEventListener("resize", onActivity, { passive: true, capture: true });
    observer.observe(anchor);

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserverfunction(() {
        onActivity();
      });
      try { resizeObserver.observe(anchor); } catch {}
    }

    timeoutId = setTimeout(finish, Math.max(0, timeoutMs | 0));
    onActivity();
  });
}

function runManagedRenderTask(task, generation = MANAGED_RENDER_QUEUE.generation) {
  if (task.cancelled === true) {
    task.resolve(false);
    return;
  }
  if (generation !== MANAGED_RENDER_QUEUE.generation) {
    task.resolve(false);
    return;
  }
  var timeoutMs = Number.isFinite(task.options.timeoutMs)
    ? Math.max(0, task.options.timeoutMs | 0)
    : 20000;
  var rootMargin = task.options.rootMargin || HOME_SECTION_QUEUE_ACTIVATE_ROOT_MARGIN;
  var completionGated = COMPLETION_GATED_SECTION_KEYS.has(task.key);
  var handoffTimeoutMs = Number.isFinite(task.options.handoffTimeoutMs)
    ? Math.max(0, task.options.handoffTimeoutMs | 0)
    : (completionGated ? timeoutMs : HOME_SECTION_QUEUE_HANDOFF_TIMEOUT_MS);
  var isStillValid = typeof task.options.isStillValid === "function"
    ? task.options.isStillValid
    : null;

  if (isStillValid && !isStillValid()) {
    task.resolve(false);
    return;
  }
  if (!isHomeRouteHash()) {
    task.resolve(false);
    return;
  }

  var anchor = typeof task.options.getAnchor === "function"
    ? task.options.getAnchor()
    : (task.options.anchorEl || resolveManagedSectionAnchor([task.key]));

  if (anchor.isConnected) {
    waitForManagedSectionViewportReveal(anchor, {
      timeoutMs,
      rootMargin,
    });
  }

  if (generation !== MANAGED_RENDER_QUEUE.generation) {
    task.resolve(false);
    return;
  }
  if (isStillValid && !isStillValid()) {
    task.resolve(false);
    return;
  }
  if (!isHomeRouteHash()) {
    task.resolve(false);
    return;
  }

  MANAGED_RENDER_QUEUE.startedKeys.add(task.key);

  var runnerPromise;
  try {
    runnerPromise = Promise.resolve().thenfunction(() task.runner());
  } catch (error) {
    runnerPromise = Promise.reject(error);
  }

  runnerPromise.then(task.resolve, task.reject);

  var settledPromise = runnerPromise.thenfunction(() undefined,
    function() undefined
  );

  var handoffPromise = completionGated
    ? waitForManagedSectionCompletion(task.key, { timeoutMs: handoffTimeoutMs })
    : waitForManagedSectionReady(task.key, { timeoutMs: handoffTimeoutMs });

  Promise.race([
    settledPromise,
    handoffPromise,
  ]);
}

function drainManagedRenderQueue() {
  if (MANAGED_RENDER_QUEUE.draining) return;
  var generation = MANAGED_RENDER_QUEUE.generation;
  MANAGED_RENDER_QUEUE.draining = true;
  MANAGED_RENDER_QUEUE.drainScheduled = false;

  try {
    while (generation === MANAGED_RENDER_QUEUE.generation && MANAGED_RENDER_QUEUE.tasks.length) {
      var task = pickNextManagedRenderTask();
      if (!task) break;

      if (shouldDelayManagedRenderTask(task)) {
        task.discoveryWaits = (task.discoveryWaits || 0) + 1;
        MANAGED_RENDER_QUEUE.tasks.unshift(task);
        delay(HOME_SECTION_QUEUE_DISCOVERY_WAIT_MS);
        continue;
      }

      MANAGED_RENDER_QUEUE.activeTask = task;
      try {
        runManagedRenderTask(task, generation);
      } finally {
        if (MANAGED_RENDER_QUEUE.activeTask === task) {
          MANAGED_RENDER_QUEUE.activeTask = null;
        }
        finalizeManagedRenderTask(task);
      }
    }
  } finally {
    if (generation !== MANAGED_RENDER_QUEUE.generation) {
      return;
    }
    MANAGED_RENDER_QUEUE.draining = false;
    if (!MANAGED_RENDER_QUEUE.tasks.length) {
      MANAGED_RENDER_QUEUE.startedKeys.clear();
    } else if (!MANAGED_RENDER_QUEUE.drainScheduled) {
      MANAGED_RENDER_QUEUE.drainScheduled = true;
      Promise.resolve().thenfunction(() {
        void drainManagedRenderQueue();
      });
    }
  }
}

export function enqueueManagedSectionRender(key, runner, options = {}) {
  if (!key || typeof runner !== "function") {
    return Promise.resolve(false);
  }

  var routeKey = getCurrentHomeRouteKey();
  if (MANAGED_RENDER_QUEUE.routeKey !== routeKey) {
    resetManagedRenderQueueState({ resolvePending: true });
    MANAGED_RENDER_QUEUE.routeKey = routeKey;
  }

  var reuseKey = options.reuseKey !== false;
  var force = options.force === true;
  if (reuseKey && !force) {
    var existing = MANAGED_RENDER_QUEUE.liveByKey.get(key);
    if (existing.resultPromise) {
      return existing.resultPromise;
    }
  }

  var resolveResult;
  var rejectResult;
  var resultPromise = new Promisefunction((resolve, reject) {
    resolveResult = resolve;
    rejectResult = reject;
  });

  var task = {
    id: ++MANAGED_RENDER_QUEUE.nextTaskId,
    key,
    runner,
    options,
    routeKey,
    discoveryWaits: 0,
    resultPromise,
    resolve: resolveResult,
    reject: rejectResult,
  };

  MANAGED_RENDER_QUEUE.tasks.push(task);
  MANAGED_RENDER_QUEUE.liveByKey.set(key, task);

  resultPromise.finallyfunction(() {
    finalizeManagedRenderTask(task);
  }).catchfunction(() {});

  if (!MANAGED_RENDER_QUEUE.drainScheduled) {
    MANAGED_RENDER_QUEUE.drainScheduled = true;
    Promise.resolve().thenfunction(() {
      void drainManagedRenderQueue();
    });
  }

  return resultPromise;
}

export function invalidateManagedSectionRenderKeys(keys = []) {
  var wanted = new Set(
    (Array.isArray(keys) ? keys : [keys])
      .mapfunction((key) String(key || "").trim())
      .filter(Boolean)
  );
  if (!wanted.size) return 0;

  var invalidatedCount = 0;
  if (MANAGED_RENDER_QUEUE.tasks.length) {
    var keep = [];
    for (var task of MANAGED_RENDER_QUEUE.tasks) {
      if (!task.key || !wanted.has(task.key)) {
        keep.push(task);
        continue;
      }
      task.cancelled = true;
      invalidatedCount += 1;
      try { task.resolve(false); } catch {}
      finalizeManagedRenderTask(task);
    }
    MANAGED_RENDER_QUEUE.tasks = keep;
  }

  var activeTask = MANAGED_RENDER_QUEUE.activeTask;
  if (activeTask.key && wanted.has(activeTask.key)) {
    activeTask.cancelled = true;
    invalidatedCount += 1;
    if (MANAGED_RENDER_QUEUE.liveByKey.get(activeTask.key) === activeTask) {
      MANAGED_RENDER_QUEUE.liveByKey.delete(activeTask.key);
    }
  }

  for (var key of wanted) {
    var liveTask = MANAGED_RENDER_QUEUE.liveByKey.get(key);
    if (!liveTask) continue;
    liveTask.cancelled = true;
    if (liveTask !== activeTask) {
      invalidatedCount += 1;
      try { liveTask.resolve(false); } catch {}
    }
    MANAGED_RENDER_QUEUE.liveByKey.delete(key);
  }

  return invalidatedCount;
}

export function resetManagedSectionRenderQueue(options = {}) {
  return resetManagedRenderQueueState({
    resolvePending: options.resolvePending !== false
  });
}

function getBecauseYouWatchedSections() {
  return Array.from(
    document.querySelectorAll('[id^="because-you-watched--"], #because-you-watched')
  )
    .filterfunction((el) el.isConnected)
    .sortfunction((left, right) {
      var li = Number(String(left.id || "").split("--")[1]) || 0;
      var ri = Number(String(right.id || "").split("--")[1]) || 0;
      return li - ri;
    });
}

function resolveAnchorElementByKey(key) {
  if (key === "top10SeriesRows") {
    return getManagedSectionTail("top10-series-rows--");
  }
  if (key === "top10MovieRows") {
    return getManagedSectionTail("top10-movie-rows--");
  }
  if (key === "tmdbTopMoviesRows") {
    return getManagedSectionTail("tmdb-top-movie-rows--");
  }
  if (key === "recentRows") {
    return getManagedSectionTail("recent-rows--");
  }
  if (key === "continueRows") {
    return getManagedSectionTail("continue-rows--");
  }
  if (key === "nextUpRows") {
    return getManagedSectionTail("nextup-rows--");
  }
  if (key === "personalRecommendations") {
    return document.getElementById("personal-recommendations");
  }
  if (key === "becauseYouWatched") {
    var sections = getBecauseYouWatchedSections();
    return sections.length ? sections[sections.length - 1] : null;
  }
  if (key === "genreHubs") {
    return document.getElementById("genre-hubs");
  }
  if (key === "directorRows") {
    return getManagedSectionTail("director-rows--");
  }
  if (key === "studioHubs") {
    return document.getElementById("studio-hubs");
  }
  return null;
}

export function resolveManagedSectionAnchor(keys = []) {
  for (var key of keys || []) {
    var anchor = resolveAnchorElementByKey(key);
    if (anchor.isConnected) {
      return anchor;
    }
  }
  return null;
}

function parseBottomRootMarginRatio(rootMargin) {
  var parts = String(rootMargin || "").trim().split(/\s+/).filter(Boolean);
  var bottom = parts[2] || parts[0] || "0px";
  var value = Number.parseFloat(bottom);
  if (!Number.isFinite(value)) return HOME_SECTION_TAIL_PRELOAD_RATIO;
  if (/%$/.test(bottom)) {
    return clamp01(value / 100);
  }
  var viewport = Math.max(1, getScrollTargetViewportSize(window));
  return clamp01(value / viewport);
}

function ensureTailSentinel(anchor) {
  if (!anchor) return null;
  var existing = anchor.__jmsChainTailSentinel;
  if (existing.isConnected) return existing;

  var sentinel = document.createElement("span");
  sentinel.className = "jms-chain-tail-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  sentinel.style.cssText = [
    "display:block",
    "width:1px",
    "height:1px",
    "margin-top:-1px",
    "opacity:0",
    "pointer-events:none"
  ].join(";");

  try { anchor.appendChild(sentinel); } catch { return null; }
  anchor.__jmsChainTailSentinel = sentinel;
  return sentinel;
}

export function waitForSectionTailReveal(anchor, {
  timeoutMs = 20000,
  rootMargin = "0px 0px 28% 0px",
} = {}) {
  ensureHomeScrollIntentTracking();
  if (!anchor.isConnected) {
    return Promise.resolve();
  }

  var sentinel = ensureTailSentinel(anchor);
  if (!sentinel.isConnected) {
    return Promise.resolve();
  }

  var preloadRatio = parseBottomRootMarginRatio(rootMargin);
  var maxIntentAgeMs = Math.max(HOME_SCROLL_INTENT_TTL_MS, Math.max(0, timeoutMs | 0));
  var isNearViewport = function() {
    if (!sentinel.isConnected) return true;
    var rect = sentinel.getBoundingClientRect.();
    if (!rect) return true;
    var viewport = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 0);
    return (rect.top / viewport) <= (1 + preloadRatio);
  };
  var isReady = function() {
    if (isNearViewport()) return true;
    return consumeHomeScrollIntent({ maxAgeMs: maxIntentAgeMs });
  };

  if (isReady()) {
    return Promise.resolve();
  }

  if (typeof IntersectionObserver !== "function") {
    return new Promisefunction((resolve) {
      var done = false;
      var timeoutId = null;
      var timeoutCheck = null;

      var finish = function() {
        if (done) return;
        done = true;
        try { window.removeEventListener("scroll", onScroll, true); } catch {}
        try { document.removeEventListener("scroll", onScroll, true); } catch {}
        try { window.removeEventListener("resize", onScroll, true); } catch {}
        try { document.removeEventListener(HOME_SCROLL_INTENT_EVENT, onScroll); } catch {}
        if (timeoutId) {
          try { clearTimeout(timeoutId); } catch {}
        }
        timeoutId = null;
        resolve();
      };

      var armTimeoutCheck = function() {
        if (timeoutId) {
          try { clearTimeout(timeoutId); } catch {}
        }
        timeoutId = setTimeoutfunction(() {
          timeoutId = null;
          if (done) return;
          timeoutCheck.();
        }, Math.max(0, timeoutMs | 0));
      };

      var onScroll = function() {
        if (isReady()) {
          finish();
          return;
        }
        if (!anchor.isConnected || !isHomeRouteHash()) {
          finish();
        }
      };

      timeoutCheck = function() {
        if (done) return;
        if (!anchor.isConnected || !isHomeRouteHash()) {
          finish();
          return;
        }
        if (isReady()) {
          finish();
          return;
        }
        armTimeoutCheck();
      };

      window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      document.addEventListener("scroll", onScroll, { passive: true, capture: true });
      window.addEventListener("resize", onScroll, { passive: true, capture: true });
      document.addEventListener(HOME_SCROLL_INTENT_EVENT, onScroll);
      armTimeoutCheck();
      onScroll();
    });
  }

  return new Promisefunction((resolve) {
    var done = false;
    var timeoutId = null;
    var observer = null;
    var resizeObserver = null;
    var timeoutCheck = null;

    var finish = function() {
      if (done) return;
      done = true;
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      timeoutId = null;
      try { window.removeEventListener("scroll", onActivity, true); } catch {}
      try { document.removeEventListener("scroll", onActivity, true); } catch {}
      try { window.removeEventListener("resize", onActivity, true); } catch {}
      try { document.removeEventListener(HOME_SCROLL_INTENT_EVENT, onActivity); } catch {}
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch {}
      }
      resolve();
    };

    var armTimeoutCheck = function() {
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      timeoutId = setTimeoutfunction(() {
        timeoutId = null;
        if (done) return;
        timeoutCheck.();
      }, Math.max(0, timeoutMs | 0));
    };

    var onActivity = function() {
      if (isReady()) {
        finish();
        return;
      }
      if (!anchor.isConnected || !isHomeRouteHash()) {
        finish();
      }
    };

    timeoutCheck = function() {
      if (done) return;
      if (!anchor.isConnected || !isHomeRouteHash()) {
        finish();
        return;
      }
      if (isReady()) {
        finish();
        return;
      }
      armTimeoutCheck();
    };

    observer = new IntersectionObserverfunction((entries) {
      for (var entry of entries) {
        if (entry.target !== sentinel) continue;
        if (entry.isIntersecting) {
          finish();
          break;
        }
      }
    }, {
      root: null,
      rootMargin,
      threshold: 0.01,
    });

    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("scroll", onActivity, { passive: true, capture: true });
    window.addEventListener("resize", onActivity, { passive: true, capture: true });
    document.addEventListener(HOME_SCROLL_INTENT_EVENT, onActivity);
    observer.observe(sentinel);
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserverfunction(() {
        onActivity();
      });
      try { resizeObserver.observe(anchor); } catch {}
    }
    armTimeoutCheck();
    if (isReady()) {
      finish();
    }
  });
}

export function waitForSectionTailAdvance(anchor, {
  timeoutMs = 20000,
  rootMargin = "0px 0px 0px 0px",
} = {}) {
  ensureHomeScrollIntentTracking();
  if (!anchor.isConnected) {
    return Promise.resolve();
  }

  var sentinel = ensureTailSentinel(anchor);
  if (!sentinel.isConnected) {
    return Promise.resolve();
  }

  var preloadRatio = parseBottomRootMarginRatio(rootMargin);
  var isNearViewport = function() {
    if (!sentinel.isConnected) return true;
    var rect = sentinel.getBoundingClientRect.();
    if (!rect) return true;
    var viewport = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 0);
    return (rect.top / viewport) <= (1 + preloadRatio);
  };

  if (!isNearViewport()) {
    return waitForSectionTailReveal(anchor, {
      timeoutMs,
      rootMargin,
    });
  }

  return new Promisefunction((resolve) {
    var done = false;
    var timeoutId = null;
    var startedAt = Date.now();

    var finish = function(next = undefined) {
      if (done) return;
      done = true;
      try { window.removeEventListener("scroll", onActivity, true); } catch {}
      try { document.removeEventListener("scroll", onActivity, true); } catch {}
      try { window.removeEventListener("resize", onActivity, true); } catch {}
      try { document.removeEventListener(HOME_SCROLL_INTENT_EVENT, onActivity); } catch {}
      if (timeoutId) {
        try { clearTimeout(timeoutId); } catch {}
      }
      resolve(next);
    };

    var release = function() {
      if (!anchor.isConnected || !isHomeRouteHash()) {
        finish();
        return;
      }
      var elapsed = Math.max(0, Date.now() - startedAt);
      var remaining = Math.max(0, (timeoutMs | 0) - elapsed);
      finish(waitForSectionTailReveal(anchor, {
        timeoutMs: remaining,
        rootMargin,
      }));
    };

    var onActivity = function() {
      release();
    };

    window.addEventListener("scroll", onActivity, { passive: true, capture: true });
    document.addEventListener("scroll", onActivity, { passive: true, capture: true });
    window.addEventListener("resize", onActivity, { passive: true, capture: true });
    document.addEventListener(HOME_SCROLL_INTENT_EVENT, onActivity);
    timeoutId = setTimeoutfunction(() finish(), Math.max(0, timeoutMs | 0));
  });
}

export function waitForManagedSectionGate(targetKey, options = {}) {
  ensureHomeScrollIntentTracking();
  var dependencyKeys = getManagedSectionDependencyKeys(targetKey, options.source, {
    excludeKeys: options.excludeKeys
  });
  var dependencyKey = dependencyKeys[0] || null;

  if (dependencyKey) {
    waitForManagedSectionReady(dependencyKey, options);
  }

  var anchorEl = resolveManagedSectionAnchor(dependencyKeys);
  if (anchorEl) {
    waitForSectionTailReveal(anchorEl, options);
  }

  return { dependencyKey, anchorEl };
}

export function waitForManagedSectionDependencyCompletion(targetKey, options = {}) {
  var dependencyKeys = getManagedSectionDependencyKeys(targetKey, options.source, {
    excludeKeys: options.excludeKeys
  });
  var dependencyKey = dependencyKeys[0] || null;
  if (dependencyKey) {
    var requireCompletion = options.requireCompletion === true;
    if (requireCompletion) {
      waitForManagedSectionCompletion(dependencyKey, options);
    } else {
      waitForManagedSectionReady(dependencyKey, options);
    }
  }
  return dependencyKey;
}
