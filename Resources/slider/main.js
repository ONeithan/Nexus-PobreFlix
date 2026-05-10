import { saveCredentials, saveApiKey, getAuthToken } from "../Plugins/NexusPobreFlix/runtime/auth.js";
import {
  getConfig,
  getHomeSectionsRuntimeConfig,
  getPauseFeaturesRuntimeConfig,
  isDetailsModalModuleEnabled,
  isSubtitleCustomizerModuleEnabled
} from "./modules/config.js";
import { getLanguageLabels, getDefaultLanguage, ensureAutoLanguageSync } from "./language/index.js";
import { getCurrentIndex, setCurrentIndex } from "./modules/sliderState.js";
import { startSlideTimer, stopSlideTimer, pauseSlideTimer, resumeSlideTimer } from "./modules/timer.js";
import { ensureProgressBarExists, resetProgressBar, pauseProgressBar, resumeProgressBar, updateProgressBarPosition } from "./modules/progressBar.js";
import { createSlide } from "./modules/slideCreator.js";
import { changeSlide, createDotNavigation, enablePeakNeighborActivation, getPeakDisplayOptions, initSwipeEvents, primePeakFirstPaint, syncPeakStructureNow, updatePeakClasses } from "./modules/navigation.js";
import { attachMouseEvents } from "./modules/events.js";
import { getSessionInfo, getAuthHeader, waitForAuthReadyStrict, isAuthReadyStrict, AUTH_PROFILE_CHANGED_EVENT, USERDATA_CHANGED_EVENT } from "../Plugins/NexusPobreFlix/runtime/api.js";
import { cachedFetchJson, createCachedItemDetailsFetcher, startLibraryDeltaWatcher } from "./modules/sliderCache.js";
import { forceHomeSectionsTop, forceSkinHeaderPointerEvents } from "./modules/positionOverrides.js";
import { initAvatarSystem } from "./modules/userAvatar.js";
import { initializeQualityBadges, primeQualityFromItems, annotateDomWithQualityHints } from "./modules/qualityBadges.js";
import { startUpdatePolling } from "./modules/update.js";
import { updateSlidePosition } from "./modules/positionUtils.js";
import { teardownAnimations, hardCleanupSlide } from "./modules/animations.js";
import { isVisible, waitForAnyVisible } from "./modules/domVisibility.js";
import { resolveSliderAssetHref } from "./modules/assetLinks.js";
import { withServer } from "./modules/jfUrl.js";
import { initUserProfileAvatarPicker } from "./modules/avatarPicker.js";
import { startBackgroundCollectionIndexer, getBackgroundCollectionIndexerStatus } from "./modules/collectionIndexer.js";
import { initProfileChooser, syncProfileChooserHeaderButtonVisibility } from "./modules/profileChooser.js";
import { waitForNativeHomeSectionStability, waitForVisibleHomeSections } from "./modules/homeSectionNative.js";
export { loadCSS } from "./modules/playerStyles.js";
export { waitForAnyVisible };
var idle = window.requestIdleCallback || function((cb) setTimeout(cb, 0));
var cancelIdle = window.cancelIdleCallback || function((id) clearTimeout(id));
ensureAutoLanguageSync({ reloadOnChange: true });
var MATERIAL_ICONS_REPAIR_STYLE_ID = "jms-material-icons-utf8-repair";
var MATERIAL_ICONS_PROBE_CLASS = "_10k";
var MATERIAL_ICONS_PROBE_CONTENT = "\ue951";
var CUSTOM_SPLASH_ACTIVE_ATTR = "data-jms-custom-splash";
var CUSTOM_SPLASH_HIDDEN_ATTR = "data-jms-custom-splash-hidden";
var CUSTOM_SPLASH_TITLE_ATTR = "data-jms-custom-splash-title";
var CUSTOM_SPLASH_CAPTION_ATTR = "data-jms-custom-splash-caption";
var CUSTOM_SPLASH_LAYER_ID = "jms-boot-splash-layer";
var CUSTOM_SPLASH_LOGO_ID = "jms-boot-splash-logo";
var CUSTOM_SPLASH_STORAGE_KEY = "enableCustomSplashScreen";
var CUSTOM_SPLASH_TITLE_VAR = "--jms-custom-splash-title";
var CUSTOM_SPLASH_CAPTION_VAR = "--jms-custom-splash-caption";
var CUSTOM_SPLASH_PROGRESS_KEY = "__JMS_CUSTOM_SPLASH_PROGRESS__";
var CUSTOM_SPLASH_PING_PATHS = ["/NexusPobreFlix/ping", "/Plugins/NexusPobreFlix/ping"];
var CUSTOM_SPLASH_PING_CACHE_MS = 15_000;
var CUSTOM_SPLASH_TIMEOUT_MS = 12_000;
var CUSTOM_SPLASH_CLEANUP_MS = 420;
var CUSTOM_SPLASH_EXIT_SYNC_MS = 120;
var HOME_DEBUG_STORAGE_KEY = "jms:debug:home-sections";
var HOME_TRACE_STORAGE_KEY = "jms:trace:home-sections";
var AUTH_CONTEXT_REBOOT_DEBOUNCE_MS = 180;
var HOME_ITEM_DETAILS_STATIC_FIELDS = [
  "ImageTags",
  "BackdropImageTags",
  "PrimaryImageAspectRatio",
  "RunTimeTicks",
  "Overview",
  "Genres",
  "People",
  "ProductionYear",
  "ProductionLocations",
  "Taglines",
  "OriginalTitle",
  "MediaStreams",
  "ProviderIds",
  "RemoteTrailers",
  "TrailerUrls",
  "CommunityRating",
  "CriticRating",
  "OfficialRating",
  "ChildCount",
  "ParentIndexNumber",
  "IndexNumber",
  "SeriesId",
  "SeriesName",
  "CollectionIds"
];
var HOME_ITEM_DETAILS_USERDATA_FIELDS = ["UserData"];
var HOME_ITEM_DETAILS_REVALIDATE_MS = 6 * 60 * 60 * 1000;
var HOME_ITEM_DETAILS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
var HOME_ITEM_USERDATA_CACHE_TTL_MS = 15_000;
var materialIconsRepairPromise = null;
var __notificationsModulePromise = null;
var __detailsModalLoaderPromise = null;
var __hoverTrailerModulePromise = null;
var __personalRecommendationsModulePromise = null;
var __directorRowsModulePromise = null;
var __recentRowsModulePromise = null;
var __studioHubsModulePromise = null;
var __homeSectionChainModulePromise = null;
var __customSplashObserver = null;
var __customSplashCleanupTimer = 0;
var __customSplashHideTimer = 0;
var __customSplashHardTimer = 0;
var __customSplashAvailabilityPromise = null;
var __customSplashAvailabilityCheckedAt = 0;
var __customSplashAvailabilityValue = null;
var __customSplashRouteGuardReady = false;
var __authContextRecoveryTimer = 0;
var __lastRecoveredAuthContextKey = "";
var __sliderUserDataRefreshTimer = 0;
var __customSplashProgressState = {
  authReady: false,
  dataPoolReady: false,
  selectionReady: false,
  firstSlideReady: false,
  allSlidesReady: false,
  uiReady: false,
  totalSlides: 0,
  createdSlides: 0,
  poolCount: 0
};

function getNotificationsModule() {
  if (!__notificationsModulePromise) {
    __notificationsModulePromise = import("./modules/notifications.js").catchfunction((error) {
      __notificationsModulePromise = null;
      throw error;
    });
  }

  return __notificationsModulePromise;
}

function bootNotificationsOnce() {
  if (window.__jmsNotificationsBooted) return;
  window.__jmsNotificationsBooted = true;

  void getNotificationsModule()
    .thenfunction((mod) {
      try { mod.forcejfNotifBtnPointerEvents.(); } catch {}
      mod.initNotifications.();
    })
    .catchfunction((error) {
      window.__jmsNotificationsBooted = false;
      console.warn("initNotifications failed:", error);
    });
}

function getDomObserveRoot() {
  return document.body || document.documentElement;
}

function isElementNode(node) {
  return !!node && node.nodeType === 1;
}

function nodeTouchesSelectors(node, selectors = "") {
  var selectorText = Array.isArray(selectors) ? selectors.join(",") : String(selectors || "");
  if (!isElementNode(node) || !selectorText) return false;

  try {
    if (node.matches.(selectorText)) return true;
  } catch {}

  try {
    return !!node.querySelector.(selectorText);
  } catch {
    return false;
  }
}

function mutationsTouchSelectors(mutations, selectors = "") {
  var selectorText = Array.isArray(selectors) ? selectors.join(",") : String(selectors || "");
  if (!Array.isArray(mutations) || !selectorText) return false;

  for (var mutation of mutations) {
    if (nodeTouchesSelectors(mutation.target, selectorText)) return true;

    var addedNodes = Array.from(mutation.addedNodes || []);
    for (var node of addedNodes) {
      if (nodeTouchesSelectors(node, selectorText)) return true;
    }

    var removedNodes = Array.from(mutation.removedNodes || []);
    for (var node of removedNodes) {
      if (nodeTouchesSelectors(node, selectorText)) return true;
    }
  }

  return false;
}

function stripComputedContentQuotes(value) {
  return String(value || "").replace(/^['"]|['"]$/g, "");
}

function readMaterialIconsProbeState() {
  var host = document.body || document.documentElement;
  if (!host) return { ready: false, broken: false, content: "" };

  var probe = document.createElement("span");
  probe.className = "material-icons " + (MATERIAL_ICONS_PROBE_CLASS);
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:absolute",
    "left:-9999px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none"
  ].join(";");

  host.appendChild(probe);

  var content = "";
  try {
    content = stripComputedContentQuotes(getComputedStyle(probe, "::before").content);
  } catch {}

  probe.remove();

  if (!content || content === "none" || content === "normal") {
    return { ready: false, broken: false, content };
  }

  var normalized = content.toLowerCase();
  if (content === MATERIAL_ICONS_PROBE_CONTENT || normalized === "\\e951" || normalized === "\\ue951") {
    return { ready: true, broken: false, content };
  }

  return {
    ready: true,
    broken: Array.from(content).length !== 1 || content !== MATERIAL_ICONS_PROBE_CONTENT,
    content
  };
}

function escapeNonAsciiCss(cssText) {
  var out = "";
  for (var ch of String(cssText || "")) {
    var code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13) {
      out += ch;
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    out += "\\\\" + (code.toString(16)) + " ";
  }
  return out;
}

function scoreMaterialIconsHref(href) {
  var text = String(href || "");
  var score = 0;
  if (/\/46967\./i.test(text)) score += 100;
  if (/\/\d+\.[^/]+\.css(?:[?#].*)?$/i.test(text)) score += 25;
  if (/main\.jellyfin\./i.test(text)) score -= 10;
  return score;
}

function loadMaterialIconsStylesheetUtf8() {
  var links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
  var hrefs = [...new Setfunction(links
      .map((link) link.href)
      .filter(Boolean)
      .sortfunction((a, b) scoreMaterialIconsHref(b) - scoreMaterialIconsHref(a))
  )];

  for (var href of hrefs) {
    try {
      var response = fetch(href, {
        credentials: "same-origin",
        cache: "force-cache"
      });
      if (!response.ok) continue;

      var cssText = new TextDecoder("utf-8").decode(response.arrayBuffer());
      if (!/font-family\s*:\s*Material Icons/i.test(cssText)) continue;
      return { href, cssText };
    } catch {}
  }

  return null;
}

function injectMaterialIconsRepair(cssText, sourceHref) {
  var doc = document;
  var root = doc.head || doc.documentElement;
  if (!root) return false;

  var style = doc.getElementById(MATERIAL_ICONS_REPAIR_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = MATERIAL_ICONS_REPAIR_STYLE_ID;
    style.setAttribute("data-jms", "material-icons-utf8-repair");
    root.appendChild(style);
  }

  if (sourceHref) {
    style.setAttribute("data-source-href", sourceHref);
  }
  style.textContent = escapeNonAsciiCss(cssText);
  return true;
}

function isCompletedUserData(userData = {}) {
  if (!userData || typeof userData !== "object") return false;
  if (userData.Played === true) return true;
  var playedPercentage = Number(userData.PlayedPercentage);
  return Number.isFinite(playedPercentage) && playedPercentage >= 100;
}

function isPartialPlaybackUserData(userData = {}) {
  if (!userData || typeof userData !== "object") return false;
  if (isCompletedUserData(userData)) return false;
  var playbackTicks = Number(userData.PlaybackPositionTicks || 0);
  return playbackTicks > 0;
}

function mergePlaybackUserData(baseUserData = {}, detailUserData = {}) {
  var baseCompleted = isCompletedUserData(baseUserData);
  var detailCompleted = isCompletedUserData(detailUserData);

  if (baseCompleted || detailCompleted) {
    return {
      ...(baseUserData || {}),
      ...(detailUserData || {}),
      Played: true,
      PlayedPercentage: 100,
      PlaybackPositionTicks: 0
    };
  }

  var baseTicks = Number(baseUserData.PlaybackPositionTicks || 0);
  var detailTicks = Number(detailUserData.PlaybackPositionTicks || 0);
  return baseTicks > detailTicks
    ? { ...(detailUserData || {}), ...(baseUserData || {}) }
    : { ...(baseUserData || {}), ...(detailUserData || {}) };
}

function normalizeDurationMs(value, fallback, minimum = 1_000) {
  var parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(minimum, Math.round(parsed));
}

function dedupeItemIds(ids = []) {
  var out = [];
  var seen = new Set();

  for (var raw of Array.isArray(ids) ? ids : []) {
    var id = raw == null ? "" : String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

function mergeHomeSliderItem(baseItem = null, detailItem = null, userDataItem = null) {
  var base = baseItem && typeof baseItem === "object" ? baseItem : null;
  var detail = detailItem && typeof detailItem === "object" ? detailItem : null;
  var live = userDataItem && typeof userDataItem === "object" ? userDataItem : null;

  if (!base && !detail) return null;

  var merged = {
    ...(base || {}),
    ...(detail || {}),
    ...(live || {})
  };

  var mergedUserData = mergePlaybackUserData(
    base.UserData || {},
    live.UserData || detail.UserData || {}
  );
  if (Object.keys(mergedUserData).length) {
    merged.UserData = mergedUserData;
  }

  merged.RunTimeTicks = detail.RunTimeTicks || base.RunTimeTicks || merged.RunTimeTicks || 0;

  merged.MediaStreams = Array.isArray(detail.MediaStreams) && detail.MediaStreams.length
    ? detail.MediaStreams
    : (Array.isArray(base.MediaStreams) ? base.MediaStreams : []);

  merged.RemoteTrailers = Array.isArray(detail.RemoteTrailers) && detail.RemoteTrailers.length
    ? detail.RemoteTrailers
    : (Array.isArray(base.RemoteTrailers) ? base.RemoteTrailers : []);

  return merged;
}

function scheduleSliderUserDataRefresh() {
  if (typeof window === "undefined") return;
  if (__sliderUserDataRefreshTimer) {
    clearTimeout(__sliderUserDataRefreshTimer);
    __sliderUserDataRefreshTimer = 0;
  }
  __sliderUserDataRefreshTimer = window.setTimeoutfunction(() {
    __sliderUserDataRefreshTimer = 0;
    if (!isHomeVisible()) return;
    void slidesInit().catchfunction((error) {
      console.warn("slider userData refresh failed:", error);
    });
  }, 180);
}

function ensureMaterialIconsUtf8Integrity() {
  if (materialIconsRepairPromise) return materialIconsRepairPromise;

  materialIconsRepairPromise = function(() {
    var state = readMaterialIconsProbeState();
    if (!state.ready || !state.broken) return false;

    var stylesheet = loadMaterialIconsStylesheetUtf8();
    if (!stylesheet.cssText) return false;

    var repaired = injectMaterialIconsRepair(stylesheet.cssText, stylesheet.href);
    if (repaired) {
      console.warn("[jms] Material Icons UTF-8 repair applied", {
        source: stylesheet.href,
        brokenContent: state.content
      });
    }
    return repaired;
  })().finallyfunction(() {
    materialIconsRepairPromise = null;
  });

  return materialIconsRepairPromise;
}

function installMaterialIconsUtf8Guard() {
  if (window.__jmsMaterialIconsUtf8GuardInstalled) return;
  window.__jmsMaterialIconsUtf8GuardInstalled = true;

  var mayAffectMaterialIcons = function(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === MATERIAL_ICONS_REPAIR_STYLE_ID) return true;
    if (node.matches.('link[rel="stylesheet"][href]')) return true;
    return !!node.querySelector.('link[rel="stylesheet"][href]');
  };

  var shouldScheduleCheck = function(mutations) {
    for (var mutation of mutations || []) {
      if (mutation.type === "attributes") {
        if (mutation.target.matches.('link[rel="stylesheet"][href]')) return true;
        continue;
      }
      for (var node of mutation.addedNodes || []) {
        if (mayAffectMaterialIcons(node)) return true;
      }
      for (var node of mutation.removedNodes || []) {
        if (mayAffectMaterialIcons(node)) return true;
      }
    }
    return false;
  };

  var scheduleCheck = function(delay = 0) {
    setTimeoutfunction(() {
      ensureMaterialIconsUtf8Integrity().catchfunction(() {});
    }, delay);
  };

  [0, 250, 1200, 3000].forEach(scheduleCheck);
  window.addEventListenerfunction("load", () scheduleCheck(0), { once: true });

  try {
    var head = document.head || document.documentElement;
    if (!head) return;
    var observer = new MutationObserverfunction((mutations) {
      if (!shouldScheduleCheck(mutations)) return;
      clearTimeout(window.__jmsMaterialIconsUtf8GuardTimer);
      window.__jmsMaterialIconsUtf8GuardTimer = setTimeoutfunction(() {
        ensureMaterialIconsUtf8Integrity().catchfunction(() {});
      }, 80);
    });
    observer.observe(head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "rel", "media", "disabled"]
    });
    window.__jmsMaterialIconsUtf8GuardObserver = observer;
  } catch {}
}

installMaterialIconsUtf8Guard();

function getCustomSplashRoot() {
  return document.documentElement;
}

function getCustomSplashProgressApi() {
  try {
    return window[CUSTOM_SPLASH_PROGRESS_KEY] || null;
  } catch {
    return null;
  }
}

function setCustomSplashProgress(value, options = {}) {
  try {
    return getCustomSplashProgressApi().set.(value, options) || null;
  } catch {
    return null;
  }
}

function completeCustomSplashProgress(options = {}) {
  try {
    return getCustomSplashProgressApi().complete.(options) || null;
  } catch {
    return null;
  }
}

function resetCustomSplashProgressState() {
  __customSplashProgressState.authReady = false;
  __customSplashProgressState.dataPoolReady = false;
  __customSplashProgressState.selectionReady = false;
  __customSplashProgressState.firstSlideReady = false;
  __customSplashProgressState.allSlidesReady = false;
  __customSplashProgressState.uiReady = false;
  __customSplashProgressState.totalSlides = 0;
  __customSplashProgressState.createdSlides = 0;
  __customSplashProgressState.poolCount = 0;
}

function formatSplashLabel(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, function(_, key) String(values[key] || ""));
}

function splashLabel(key, fallback, values = {}) {
  try {
    return formatSplashLabel(__getLabelsSafe.().[key] || fallback, values);
  } catch {
    return formatSplashLabel(fallback, values);
  }
}

function syncCustomSplashProgress(patch = {}) {
  var root = getCustomSplashRoot();
  if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) {
    return null;
  }

  var { stage: stageOverride, detail: detailOverride, ...statePatch } = patch || {};
  Object.assign(__customSplashProgressState, statePatch);

  var state = __customSplashProgressState;
  var totalSlides = Math.max(0, Number(state.totalSlides) || 0);
  var createdSlides = Math.max(
    0,
    Math.min(totalSlides || Number.MAX_SAFE_INTEGER, Number(state.createdSlides) || 0)
  );
  var poolCount = Math.max(0, Number(state.poolCount) || 0);

  var progress = 0.06;
  var stage = splashLabel("customSplashStageLock", "BLOQUEIO");
  var detail = splashLabel("customSplashDetailLock", "Fixando camada de interface");

  if (document.readyState !== "loading") {
    progress = Math.max(progress, 0.12);
    stage = splashLabel("customSplashStageStructure", "ESTRUTURA");
    detail = splashLabel("customSplashDetailStructure", "Estrutura da interface sincronizada");
  }

  if (state.authReady) {
    progress = Math.max(progress, 0.24);
    stage = splashLabel("customSplashStageAuth", "AUTENTICAÇÃO");
    detail = splashLabel("customSplashDetailAuth", "Chave de sessão verificada");
  }

  if (state.dataPoolReady) {
    progress = Math.max(progress, 0.38);
    stage = splashLabel("customSplashStagePool", "POOL");
    detail = poolCount > 0
      ? splashLabel("customSplashDetailPool", "{count} itens indexados no pool", { count: poolCount })
      : splashLabel("customSplashDetailPoolEmpty", "Pool de conteúdo conectado");
  }

  if (state.selectionReady) {
    progress = Math.max(progress, 0.48);
    stage = splashLabel("customSplashStageCompose", "COMPOSIÇÃO");
    detail = totalSlides > 0
      ? splashLabel("customSplashDetailSelection", "{count} cenas enfileiradas", { count: totalSlides })
      : splashLabel("customSplashDetailSelectionEmpty", "Fluxo de cenas preparado");
  }

  if (totalSlides > 0) {
    progress = Math.max(progress, 0.48 + (createdSlides / totalSlides) * 0.34);
    stage = splashLabel("customSplashStageRender", "RENDERIZAÇÃO");
    detail = splashLabel("customSplashDetailRender", "Tecendo {current}/{total} camadas", {
      current: createdSlides,
      total: totalSlides
    });
  }

  if (state.firstSlideReady) {
    progress = Math.max(progress, 0.9);
    stage = splashLabel("customSplashStageFrame", "QUADRO");
    detail = totalSlides > 0
      ? splashLabel("customSplashDetailFrame", "{current}/{total} camadas ativas", {
        current: createdSlides,
        total: totalSlides
      })
      : splashLabel("customSplashDetailFrameEmpty", "Primeiro quadro renderizado");
  }

  if (state.allSlidesReady) {
    progress = Math.max(progress, 0.96);
    stage = splashLabel("customSplashStageSurface", "SUPERFÍCIE");
    detail = splashLabel("customSplashDetailSurface", "Alinhando camadas finais");
  }

  if (state.uiReady) {
    progress = 1;
    stage = splashLabel("customSplashStageReady", "PRONTO");
    detail = splashLabel("customSplashDetailReady", "Nexus PobreFlix Online");
  }

  return setCustomSplashProgress(progress, {
    stage: stageOverride || stage,
    detail: detailOverride || detail
  });
}

function readCustomSplashEnabled(defaultValue = true) {
  try {
    var raw = localStorage.getItem(CUSTOM_SPLASH_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {}
  return defaultValue;
}

function splashTextValue(value, fallback = "") {
  var out = String(value || "").trim();
  return out || String(fallback || "").trim();
}

function getCustomSplashCurrentHour() {
  try {
    var hour = Number(new Date().getHours());
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) return hour;
  } catch {}
  return 9;
}

function resolveCustomSplashGreetingPart(hour = getCustomSplashCurrentHour()) {
  var safeHour = Number(hour);
  if (!Number.isFinite(safeHour)) return "Morning";
  if (safeHour >= 5 && safeHour < 12) return "Morning";
  if (safeHour >= 12 && safeHour < 18) return "Afternoon";
  if (safeHour >= 18 && safeHour < 22) return "Evening";
  return "Night";
}

function getCustomSplashGreetingFallback(lang = "por", part = "Morning") {
  var greetings = {
    tur: {
      Morning: "Günaydın",
      Afternoon: "Tünaydın",
      Evening: "İyi akşamlar",
      Night: "İyi geceler"
    },
    por: {
      Morning: "Bom dia",
      Afternoon: "Boa tarde",
      Evening: "Boa noite",
      Night: "Boa noite"
    },
    eng: {
      Morning: "Good morning",
      Afternoon: "Good afternoon",
      Evening: "Good evening",
      Night: "Hello"
    },
    deu: {
      Morning: "Guten Morgen",
      Afternoon: "Guten Tag",
      Evening: "Guten Abend",
      Night: "Hallo"
    },
    fre: {
      Morning: "Bonjour",
      Afternoon: "Bon après-midi",
      Evening: "Bonsoir",
      Night: "Bonsoir"
    },
    spa: {
      Morning: "Buenos días",
      Afternoon: "Buenas tardes",
      Evening: "Buenas noches",
      Night: "Buenas noches"
    },
    rus: {
      Morning: "Доброе утро",
      Afternoon: "Добрый день",
      Evening: "Добрый вечер",
      Night: "Здравствуйте"
    },
    por: {
      Morning: "Bom dia",
      Afternoon: "Boa tarde",
      Evening: "Boa noite",
      Night: "Olá"
    }
  };

  return splashTextValue(greetings.[lang].[part] || greetings.eng.[part]);
}

function getCurrentCustomSplashUserName() {
  try {
    var api =
      window.ApiClient ||
      window.apiClient ||
      window.MediaBrowser.ApiClient ||
      null;
    var sessionInfo = getSessionInfo.() || {};

    return splashTextValue(
      sessionInfo.UserName ||
      sessionInfo.userName ||
      sessionInfo.User.Name ||
      sessionInfo.User.Username ||
      api._currentUser.Name ||
      api._currentUser.Username ||
      api._currentUser.userName ||
      api._serverInfo.User.Name ||
      api._serverInfo.User.Username ||
      api._serverInfo.UserName ||
      sessionStorage.getItem("currentUserName")
    );
  } catch {
    return "";
  }
}

function getCustomSplashLoadingFallback(title) {
  var safeTitle = String(title || "Nexus PobreFlix").trim() || "Nexus PobreFlix";
  var lang = (typeof getDefaultLanguage === "function" ? getDefaultLanguage() : null) || "eng";

  switch (lang) {
    case "eng":
      return (safeTitle) + " is starting";
    case "deu":
      return (safeTitle) + " wird vorbereitet";
    case "fre":
      return (safeTitle) + " se prepare";
    case "spa":
      return (safeTitle) + " se esta preparando";
    case "rus":
      return (safeTitle) + " подготавливается";
    case "tur":
      return (safeTitle) + " está iniciando";
    case "por":
      return (safeTitle) + " está iniciando";
    default:
      return (safeTitle) + " is starting";
  }
}

function resolveCustomSplashDefaults(labels = {}) {
  var defaultTitle = String(labels.customSplashTitle || "Nexus PobreFlix").trim() || "Nexus PobreFlix";
  var fallbackCaption = getCustomSplashLoadingFallback(defaultTitle);
  var defaultCaption = String(labels.customSplashLoadingText || fallbackCaption).trim()
    || fallbackCaption;
  return { defaultTitle, defaultCaption };
}

function buildCustomSplashCaption(title, labels = {}) {
  var { defaultTitle, defaultCaption } = resolveCustomSplashDefaults(labels);
  var safeTitle = String(title || "").trim() || defaultTitle;

  if (defaultCaption.includes(defaultTitle)) {
    return defaultCaption.replace(defaultTitle, safeTitle);
  }

  return defaultCaption;
}

function buildCustomSplashDisplayTitle(title, labels = {}, lang = "por") {
  var safeTitle = splashTextValue(title, "Nexus PobreFlix");
  var userName = getCurrentCustomSplashUserName();
  if (!userName) return safeTitle;

  var greetingPart = resolveCustomSplashGreetingPart();
  var greetingKey = "customSplashGreeting" + (greetingPart);
  var greeting = splashTextValue(
    labels.[greetingKey],
    getCustomSplashGreetingFallback(lang, greetingPart)
  );

  return splashTextValue((greeting) + " " + (userName), safeTitle);
}

function getCustomSplashCopy() {
  var cfg = (typeof getConfig === "function" ? getConfig() : {}) || {};
  var lang = cfg.defaultLanguage || getDefaultLanguage.();
  var labels = cfg.languageLabels || getLanguageLabels(lang) || {};
  var { defaultTitle } = resolveCustomSplashDefaults(labels);
  var title = String(cfg.customSplashTitle || "").trim() || defaultTitle;
  return {
    title,
    displayTitle: buildCustomSplashDisplayTitle(title, labels, lang),
    caption: buildCustomSplashCaption(title, labels)
  };
}

function applyCustomSplashCopy() {
  var root = getCustomSplashRoot();
  if (!root) return;
  var copy = getCustomSplashCopy();
  root.setAttribute(CUSTOM_SPLASH_TITLE_ATTR, copy.displayTitle || copy.title);
  root.setAttribute(CUSTOM_SPLASH_CAPTION_ATTR, copy.caption);
  root.style.setProperty(CUSTOM_SPLASH_TITLE_VAR, JSON.stringify(copy.displayTitle || copy.title));
  root.style.setProperty(CUSTOM_SPLASH_CAPTION_VAR, JSON.stringify(copy.caption));
  var logo = document.getElementById(CUSTOM_SPLASH_LOGO_ID);
  if (logo) {
    logo.setAttribute("aria-label", copy.title);
    logo.setAttribute("title", copy.title);
  }
  try {
    getCustomSplashProgressApi().syncCopy.(copy);
  } catch {}
}

function cleanupCustomSplashAttrs() {
  var root = getCustomSplashRoot();
  if (__customSplashHideTimer) {
    clearTimeout(__customSplashHideTimer);
    __customSplashHideTimer = 0;
  }
  if (!root) return;
  root.removeAttribute(CUSTOM_SPLASH_ACTIVE_ATTR);
  root.removeAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
  root.removeAttribute(CUSTOM_SPLASH_TITLE_ATTR);
  root.removeAttribute(CUSTOM_SPLASH_CAPTION_ATTR);
  root.style.removeProperty(CUSTOM_SPLASH_TITLE_VAR);
  root.style.removeProperty(CUSTOM_SPLASH_CAPTION_VAR);
  document.getElementById(CUSTOM_SPLASH_LAYER_ID).remove();
  document.getElementById(CUSTOM_SPLASH_LOGO_ID).remove();
}

function hasCustomSplashVisibleShell() {
  return !!document.querySelector(
    "#indexPage:not(.hide), #homePage:not(.hide), .skinHeader, .mainDrawer, .mainDrawerButton, [data-role='page']:not(.hide)"
  );
}

function getCustomSplashVisiblePage() {
  return document.querySelector(
    "#reactRoot [data-role='page']:not(.hide), [data-role='page']:not(.hide), #reactRoot #indexPage:not(.hide), #reactRoot #homePage:not(.hide)"
  );
}

function isCustomSplashHomePageElement(page) {
  if (!page) return false;

  var pageId = String(page.id || "").toLowerCase();
  if (pageId === "indexpage" || pageId === "homepage") {
    return true;
  }

  var routeHint = String(
    page.getAttribute.("data-url") ||
    page.getAttribute.("data-page") ||
    page.dataset.url ||
    ""
  ).toLowerCase();

  return /(?:^|\/)(?:index|home)(?:\.html)?(?:[?#/]|$)/i.test(routeHint);
}

function hasCustomSplashVisibleNonHomePage() {
  var page = getCustomSplashVisiblePage();
  if (!page) return false;
  if (isCustomSplashHomePageElement(page)) return false;

  var pageId = String(page.id || "").trim();
  var routeHint = String(
    page.getAttribute.("data-url") ||
    page.getAttribute.("data-page") ||
    page.dataset.url ||
    ""
  ).trim();

  return !!(pageId || routeHint);
}

function isCustomSplashHomeContext() {
  var page = getCustomSplashVisiblePage();
  if (page) {
    return isCustomSplashHomePageElement(page);
  }

  try {
    return isHomeRouteActive();
  } catch {
    var hash = String(window.location.hash || "").toLowerCase().trim();
    return hash.startsWith("#/home") || hash.startsWith("#/index") || hash === "" || hash === "#";
  }
}

function buildCustomSplashPingUrl(path, { force = false } = {}) {
  var base = normalizeWithServer(path);
  var cacheBucket = force ? String(Date.now()) : String(Math.floor(Date.now() / CUSTOM_SPLASH_PING_CACHE_MS));

  try {
    var url = new URL(base, window.location.origin);
    url.searchParams.set("_ts", cacheBucket);

    var version = String(window.__JMS_ASSET_VERSION__ || "").trim();
    if (version) {
      url.searchParams.set("v", version);
    }

    return url.toString();
  } catch {
    var sep = base.includes("?") ? "&" : "?";
    return (base) + (sep) + "_ts=" + (encodeURIComponent(cacheBucket));
  }
}

function probeCustomSplashPluginAvailability({ force = false } = {}) {
  var now = Date.now();
  if (!force && __customSplashAvailabilityPromise) {
    return __customSplashAvailabilityPromise;
  }
  if (
    !force &&
    __customSplashAvailabilityValue !== null &&
    (now - __customSplashAvailabilityCheckedAt) < CUSTOM_SPLASH_PING_CACHE_MS
  ) {
    return __customSplashAvailabilityValue;
  }

  var task = function(() {
    for (var path of CUSTOM_SPLASH_PING_PATHS) {
      try {
        var res = fetch(buildCustomSplashPingUrl(path, { force }), {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Cache-Control": "no-store, no-cache, max-age=0",
            Pragma: "no-cache"
          }
        });

        if (res.ok || res.status === 401 || res.status === 403) {
          __customSplashAvailabilityValue = true;
          __customSplashAvailabilityCheckedAt = Date.now();
          return true;
        }
      } catch {}
    }

    __customSplashAvailabilityValue = false;
    __customSplashAvailabilityCheckedAt = Date.now();
    return false;
  })();

  __customSplashAvailabilityPromise = task;
  try {
    return task;
  } finally {
    __customSplashAvailabilityPromise = null;
  }
}

function getCustomSplashCandidateSlide(targetSlide = null) {
  if (targetSlide.isConnected) {
    return targetSlide;
  }

  return document.querySelector(
    "#indexPage:not(.hide) #monwui-slides-container .monwui-slide.active, " +
    "#homePage:not(.hide) #monwui-slides-container .monwui-slide.active, " +
    "#monwui-slides-container .monwui-slide.active, " +
    "#indexPage:not(.hide) #monwui-slides-container .monwui-slide, " +
    "#homePage:not(.hide) #monwui-slides-container .monwui-slide, " +
    "#monwui-slides-container .monwui-slide"
  );
}

function isCustomSplashSlideVisuallyReady(targetSlide = null) {
  var slide = getCustomSplashCandidateSlide(targetSlide);
  if (!slide.isConnected) return false;

  var container = slide.closest.("#monwui-slides-container");
  if (!container || !isVisible(container)) return false;
  if (!isVisible(slide)) return false;
  if (!slide.classList.contains("active")) return false;
  if (slide.classList.contains("is-hidden") || slide.classList.contains("peak-batch-pending")) {
    return false;
  }

  try {
    var slideStyle = getComputedStyle(slide);
    if (slideStyle.display === "none" || slideStyle.visibility === "hidden") {
      return false;
    }
    if (Number.parseFloat(slideStyle.opacity || "1") < 0.04) {
      return false;
    }
  } catch {}

  var backdrop = slide.__backdropImg || slide.querySelector.(".monwui-backdrop");
  if (!backdrop.isConnected) return false;

  var backdropReady =
    slide.classList.contains("backdrop-ready") ||
    !!String(slide.dataset.backdropReady || "").trim() ||
    (!!backdrop.complete && Number(backdrop.naturalWidth || 0) > 0);
  if (!backdropReady) return false;

  try {
    var backdropStyle = getComputedStyle(backdrop);
    if (backdropStyle.display === "none" || backdropStyle.visibility === "hidden") {
      return false;
    }
    if (Number.parseFloat(backdropStyle.opacity || "1") < 0.04 && !slide.classList.contains("backdrop-ready")) {
      return false;
    }
  } catch {}

  if (container.classList.contains("peak-mode")) {
    if (!container.classList.contains("peak-ready")) return false;
    if (
      container.classList.contains("peak-first-reveal") &&
      !container.classList.contains("peak-first-reveal-active")
    ) {
      return false;
    }
  }

  return true;
}

function hasCustomSplashFirstSlideReady() {
  try {
    return isCustomSplashSlideVisuallyReady();
  } catch {
    return false;
  }
}

function isCustomSplashReady() {
  var root = getCustomSplashRoot();
  if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return true;
  if (!isCustomSplashHomeContext()) return true;
  if (isCustomSplashSliderDisabled()) return true;
  if (hasCustomSplashFirstSlideReady()) return true;
  if (hasCustomSplashVisibleNonHomePage()) return true;
  return false;
}

function isCustomSplashSliderDisabled() {
  try {
    return (typeof getConfig === "function" ? getConfig().enableSlider : true) === false;
  } catch {
    return false;
  }
}

function stopCustomSplashWatchers() {
  if (__customSplashObserver) {
    try { __customSplashObserver.disconnect(); } catch {}
    __customSplashObserver = null;
  }
  if (__customSplashHardTimer) {
    clearTimeout(__customSplashHardTimer);
    __customSplashHardTimer = 0;
  }
}

function dismissCustomSplashImmediately(reason = "disabled") {
  stopCustomSplashWatchers();
  if (__customSplashCleanupTimer) {
    clearTimeout(__customSplashCleanupTimer);
    __customSplashCleanupTimer = 0;
  }
  if (__customSplashHideTimer) {
    clearTimeout(__customSplashHideTimer);
    __customSplashHideTimer = 0;
  }

  try {
    getCustomSplashProgressApi().dismiss.(reason, {
      updateProgress: false,
      instant: true,
      cleanupDelayMs: 0
    });
  } catch {}

  cleanupCustomSplashAttrs();

  try {
    getCustomSplashRoot().removeAttribute("data-jms-custom-splash-reason");
  } catch {}

  return false;
}

function ensureCustomSplashRouteGuard() {
  if (__customSplashRouteGuardReady) return;
  __customSplashRouteGuardReady = true;

  var enforce = function() {
    var root = getCustomSplashRoot();
    if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return;
    if (isCustomSplashHomeContext()) return;
    dismissCustomSplashImmediately("route-not-home");
  };

  document.addEventListener("readystatechange", enforce);
  window.addEventListener("hashchange", enforce, { passive: true });
  window.addEventListener("popstate", enforce, { passive: true });
  window.addEventListener("pageshow", enforce, { passive: true });
  enforce();
}

function finalizeCustomSplashHide(reason = "ready") {
  var root = getCustomSplashRoot();
  if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return false;
  if (root.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR)) return true;

  if (__customSplashCleanupTimer) {
    clearTimeout(__customSplashCleanupTimer);
  }

  root.setAttribute(CUSTOM_SPLASH_HIDDEN_ATTR, "1");
  root.setAttribute("data-jms-custom-splash-reason", reason);

  var hasSlides = !!document.querySelector(
    "#indexPage:not(.hide) .monwui-slide, #homePage:not(.hide) .monwui-slide"
  );
  if (hasSlides) {
    if (!hasStartedCycleClock()) {
      startNewCycleClock();
    }
    requestAnimationFramefunction(() {
      requestAnimationFramefunction(() {
        try { restartSlideTimerDeterministic(); } catch {}
      });
    });
  }

  __customSplashCleanupTimer = window.setTimeoutfunction(() {
    cleanupCustomSplashAttrs();
    try {
      getCustomSplashRoot().removeAttribute("data-jms-custom-splash-reason");
    } catch {}
    __customSplashCleanupTimer = 0;
  }, CUSTOM_SPLASH_CLEANUP_MS);

  return true;
}

function hideCustomSplash(reason = "ready") {
  var root = getCustomSplashRoot();
  if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return false;
  if (root.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR)) return true;

  stopCustomSplashWatchers();
  if (__customSplashCleanupTimer) {
    clearTimeout(__customSplashCleanupTimer);
  }
  if (__customSplashHideTimer) {
    return true;
  }

  var readyStage = splashLabel("customSplashStageReady", "PRONTO");
  var closingDetail = reason === "timeout"
    ? splashLabel("customSplashDetailForcedExit", "Ativando transição forçada")
    : splashLabel("customSplashDetailReady", "Nexus PobreFlix Online");

  syncCustomSplashProgress({
    uiReady: true,
    stage: readyStage,
    detail: closingDetail
  });
  completeCustomSplashProgress({
    stage: readyStage,
    detail: closingDetail
  });

  root.setAttribute("data-jms-custom-splash-reason", reason);
  var delay = (reason === "config-disabled" || reason === "slider-disabled") ? 0 : CUSTOM_SPLASH_EXIT_SYNC_MS;
  __customSplashHideTimer = window.setTimeoutfunction(() {
    __customSplashHideTimer = 0;
    finalizeCustomSplashHide(reason);
  }, delay);
  return true;
}

function scheduleCustomSplashCheck(delay = 0) {
  window.setTimeoutfunction(() {
    if (isCustomSplashReady()) {
      hideCustomSplash("ui-ready");
    }
  }, Math.max(0, delay | 0));
}

function initCustomSplash() {
  var root = getCustomSplashRoot();
  var api = {
    hide: hideCustomSplash,
    isBlocking() {
      return !!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR) && !root.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
    },
    syncFromConfig(forceEnabled) {
      var sliderDisabled = isCustomSplashSliderDisabled();
      var enabled = typeof forceEnabled === "boolean"
        ? forceEnabled
        : ((typeof getConfig === "function" ? getConfig().enableCustomSplashScreen : true) !== false);

      if (!enabled) {
        hideCustomSplash("config-disabled");
        cleanupCustomSplashAttrs();
        return false;
      }

      if (!isCustomSplashHomeContext()) {
        dismissCustomSplashImmediately("route-not-home");
        return false;
      }

      if (sliderDisabled) {
        hideCustomSplash("slider-disabled");
        return false;
      }

      void probeCustomSplashPluginAvailability({ force: true }).thenfunction((available) {
        if (!available) {
          dismissCustomSplashImmediately("plugin-unavailable");
        }
      }).catchfunction(() {
        dismissCustomSplashImmediately("plugin-unavailable");
      });

      if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) return true;
      applyCustomSplashCopy();
      scheduleCustomSplashCheck(0);
      return true;
    }
  };

  try {
    window.__JMS_CUSTOM_SPLASH__ = api;
  } catch {}

  ensureCustomSplashRouteGuard();
  if (!root) return api;
  if (!readCustomSplashEnabled(true)) {
    cleanupCustomSplashAttrs();
    return api;
  }
  if (!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)) {
    return api;
  }
  if (!isCustomSplashHomeContext()) {
    dismissCustomSplashImmediately("route-not-home");
    return api;
  }

  void probeCustomSplashPluginAvailability().thenfunction((available) {
    if (!available) {
      dismissCustomSplashImmediately("plugin-unavailable");
    }
  }).catchfunction(() {
    dismissCustomSplashImmediately("plugin-unavailable");
  });

  resetCustomSplashProgressState();
  applyCustomSplashCopy();
  syncCustomSplashProgress();

  if (isCustomSplashSliderDisabled()) {
    hideCustomSplash("slider-disabled");
    return api;
  }

  if (isCustomSplashReady()) {
    requestAnimationFramefunction(() hideCustomSplash("already-ready"));
    return api;
  }

  if (typeof MutationObserver === "function") {
    __customSplashObserver = new MutationObserverfunction(() {
      if (isCustomSplashReady()) {
        hideCustomSplash("mutation-ready");
      }
    });
    __customSplashObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"]
    });
  }

  document.addEventListenerfunction("readystatechange", () {
    if (document.readyState !== "loading") {
      scheduleCustomSplashCheck(0);
    }
  });
  if (window.__jmsFirstSlideReady) {
    scheduleCustomSplashCheck(0);
  } else {
    document.addEventListenerfunction("jms:first-slide-ready", () {
      hideCustomSplash("first-slide-ready");
    }, { once: true });
  }
  window.addEventListenerfunction("load", () scheduleCustomSplashCheck(180), { once: true });
  window.addEventListenerfunction("pageshow", () scheduleCustomSplashCheck(0), { passive: true });

  __customSplashHardTimer = window.setTimeoutfunction(() {
    hideCustomSplash("timeout");
  }, CUSTOM_SPLASH_TIMEOUT_MS);

  scheduleCustomSplashCheck(1500);
  return api;
}

initCustomSplash();
document.addEventListenerfunction("readystatechange", () {
  syncCustomSplashProgress();
});
syncCustomSplashProgress();

function loadDetailsModalLoader() {
  return __detailsModalLoaderPromise || (__detailsModalLoaderPromise = import("./modules/detailsModalLoader.js"));
}

function openDetailsModalLazy(options = {}) {
  var { openDetailsModal } = loadDetailsModalLoader();
  return openDetailsModal(options);
}

function loadHoverTrailerModule() {
  return __hoverTrailerModulePromise || (__hoverTrailerModulePromise = import("./modules/hoverTrailerModal.js"));
}

function queueHoverModuleBoot() {
  idlefunction(() {
    loadHoverTrailerModule()
      .thenfunction(({ setupHoverForAllItems }) {
        try { setupHoverForAllItems.(); } catch {}
      })
      .catchfunction(() {});
  });
}

function loadPersonalRecommendationsModule() {
  return __personalRecommendationsModulePromise || (__personalRecommendationsModulePromise = import("./modules/personalRecommendations.js"));
}

function loadDirectorRowsModule() {
  return __directorRowsModulePromise || (__directorRowsModulePromise = import("./modules/directorRows.js"));
}

function loadRecentRowsModule() {
  return __recentRowsModulePromise || (__recentRowsModulePromise = import("./modules/recentRows.js"));
}

function loadStudioHubsModule() {
  return __studioHubsModulePromise || (__studioHubsModulePromise = import("./modules/studioHubs.js"));
}

function loadHomeSectionChainModule() {
  return __homeSectionChainModulePromise || (__homeSectionChainModulePromise = import("./modules/homeSectionChain.js"));
}

function renderPersonalRecommendationsLazy(options = {}) {
  return loadPersonalRecommendationsModule()
    .thenfunction(({ renderPersonalRecommendations }) renderPersonalRecommendations.(options))
    .catchfunction(() {});
}

function mountDirectorRowsLazyModule(options = {}) {
  return loadDirectorRowsModule()
    .thenfunction(({ mountDirectorRowsLazy }) mountDirectorRowsLazy.(options))
    .catchfunction(() {});
}

function mountRecentRowsLazyModule(options = {}) {
  return loadRecentRowsModule()
    .thenfunction(({ mountRecentRowsLazy }) mountRecentRowsLazy.(options))
    .catchfunction(() {});
}

function cleanupRecentRowsLazy() {
  return loadRecentRowsModule()
    .thenfunction(({ cleanupRecentRows }) cleanupRecentRows.())
    .catchfunction(() {});
}

function cleanupDirectorRowsLazy() {
  return loadDirectorRowsModule()
    .thenfunction(({ cleanupDirectorRows }) cleanupDirectorRows.())
    .catchfunction(() {});
}

function resetPersonalRecommendationsLazy() {
  return loadPersonalRecommendationsModule()
    .thenfunction(({ resetPersonalRecsAndGenreState }) resetPersonalRecsAndGenreState.())
    .catchfunction(() {});
}

function ensureStudioHubsMountedLazy(options = {}) {
  return loadStudioHubsModule()
    .thenfunction(({ ensureStudioHubsMounted }) ensureStudioHubsMounted.(options))
    .catchfunction(() {});
}

function cleanupStudioHubsLazy() {
  return loadStudioHubsModule()
    .thenfunction(({ cleanupStudioHubs }) cleanupStudioHubs.())
    .catchfunction(() {});
}

function resetManagedSectionRenderQueueLazy(options = {}) {
  return loadHomeSectionChainModule()
    .thenfunction(({ resetManagedSectionRenderQueue }) resetManagedSectionRenderQueue.(options))
    .catchfunction(() {});
}

var homeSectionMountSeq = 0;
var homeSectionMountTimers = new Set();
var managedHomeSectionRecoverySeq = 0;
var managedHomeSectionRecoveryTimers = new Set();
var managedHomeSectionCleanupSeq = 0;
var pendingManagedHomeSectionCleanupPromise = null;

function isHomeSectionDebugEnabled() {
  try {
    if (window.__JMS_DEBUG_HOME_SECTIONS === true) return true;
    if (window.__JMS_DEBUG_HOME_SECTIONS === false) return false;
    var raw = localStorage.getItem(HOME_DEBUG_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {
    return window.__JMS_DEBUG_HOME_SECTIONS === true;
  }
}

function buildHomeDebugPayload(payload) {
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

function homeSectionLog(event, payload = {}) {
  if (!isHomeSectionDebugEnabled()) return;
  try {
    console.log("[JMS:HOME]", event, buildHomeDebugPayload(payload));
  } catch {}
}

function homeSectionWarn(event, payload = {}) {
  if (!isHomeSectionDebugEnabled()) return;
  try {
    console.warn("[JMS:HOME]", event, buildHomeDebugPayload(payload));
  } catch {}
}

function isHomeSectionTraceEnabled() {
  try {
    if (window.__JMS_TRACE_HOME_SECTIONS === true) return true;
    if (window.__JMS_TRACE_HOME_SECTIONS === false) return false;
    var raw = localStorage.getItem(HOME_TRACE_STORAGE_KEY);
    return raw === "1" || raw === "true" || raw === "on";
  } catch {}
  return false;
}

function homeSectionTrace(event, payload = {}) {
  if (!isHomeSectionTraceEnabled()) return;
  try {
    console.warn("[JMS:HOME:TRACE]", event, buildHomeDebugPayload(payload));
  } catch {}
}

function rememberManagedCleanupReason(reason = "unspecified", payload = {}) {
  var detail = buildHomeDebugPayload({
    reason,
    ...payload,
  });
  try { window.__jmsLastManagedCleanupReason = detail; } catch {}
  homeSectionTrace("managedCleanup:reason", detail);
  return detail;
}

try {
  window.__jmsEnableHomeDebug = function() {
    try { localStorage.setItem(HOME_DEBUG_STORAGE_KEY, "1"); } catch {}
    try { window.__JMS_DEBUG_HOME_SECTIONS = true; } catch {}
    console.log("[JMS:HOME] debug enabled");
    return true;
  };
  window.__jmsDisableHomeDebug = function() {
    try { localStorage.removeItem(HOME_DEBUG_STORAGE_KEY); } catch {}
    try { window.__JMS_DEBUG_HOME_SECTIONS = false; } catch {}
    console.log("[JMS:HOME] debug disabled");
    return false;
  };
  window.__jmsEnableHomeTrace = function() {
    try { localStorage.setItem(HOME_TRACE_STORAGE_KEY, "1"); } catch {}
    try { window.__JMS_TRACE_HOME_SECTIONS = true; } catch {}
    console.warn("[JMS:HOME:TRACE] trace enabled");
    return true;
  };
  window.__jmsDisableHomeTrace = function() {
    try { localStorage.removeItem(HOME_TRACE_STORAGE_KEY); } catch {}
    try { window.__JMS_TRACE_HOME_SECTIONS = false; } catch {}
    console.warn("[JMS:HOME:TRACE] trace disabled");
    return false;
  };
} catch {}

function queueManagedHomeSectionCleanup(reason = "unspecified", meta = {}) {
  var seq = ++managedHomeSectionCleanupSeq;
  var reasonDetail = rememberManagedCleanupReason(reason, {
    seq,
    meta,
    stack: new Error().stack.split("\n").slice(0, 7).join("\n") || "",
  });
  var run = Promise.allSettled([
    resetManagedSectionRenderQueueLazy(),
    cleanupRecentRowsLazy(),
    cleanupDirectorRowsLazy(),
    resetPersonalRecommendationsLazy(),
    cleanupStudioHubsLazy(),
  ]).thenfunction((results) {
    homeSectionLogfunction("managedCleanup:settled", {
      seq,
      results: results.map((result, index) ({
        index,
        status: result.status || "unknown",
      })),
    });
    return results;
  }).finallyfunction(() {
    homeSectionLog("managedCleanup:complete", { seq });
    homeSectionTrace("managedCleanup:complete", {
      seq,
      reason: reasonDetail.reason || reason,
    });
    if (pendingManagedHomeSectionCleanupPromise === run) {
      pendingManagedHomeSectionCleanupPromise = null;
    }
  });

  pendingManagedHomeSectionCleanupPromise = run;
  homeSectionLog("managedCleanup:queued", { seq });
  homeSectionTrace("managedCleanup:queued", {
    seq,
    reason: reasonDetail.reason || reason,
    meta,
  });
  return run;
}

function waitForManagedHomeSectionCleanup({ timeoutMs = 2500 } = {}) {
  var promise = pendingManagedHomeSectionCleanupPromise;
  if (!promise) return true;

  var timeoutId = 0;
  var timedOut = false;
  homeSectionLog("managedCleanup:wait:start", { timeoutMs });
  try {
    Promise.racefunction([
      promise,
      new Promise((resolve) {
        timeoutId = window.setTimeoutfunction(() {
          timedOut = true;
          resolve();
        }, Math.max(0, timeoutMs | 0));
      })
    ]);
    if (timedOut) {
      homeSectionWarn("managedCleanup:wait:timeout", { timeoutMs });
    } else {
      homeSectionLog("managedCleanup:wait:complete", { timeoutMs });
    }
    return true;
  } catch {
    return false;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function clearHomeSectionMountTimers() {
  for (var timer of homeSectionMountTimers) {
    clearTimeout(timer);
  }
  homeSectionMountTimers.clear();
}

function getEffectiveManagedHomeSectionForce(forceManagedSections = false, { requireSliderDisabled = false } = {}) {
  if (forceManagedSections !== true) return false;
  if (requireSliderDisabled === true) return false;
  try {
    return isSliderEnabled();
  } catch {
    return false;
  }
}

function scheduleHomeSectionMount(seq, fn, delayMs = 0) {
  var timer = window.setTimeoutfunction(() {
    homeSectionMountTimers.delete(timer);
    if (homeSectionMountSeq !== seq) return;
    homeSectionTrace("scheduleHomeSectionMount:fire", {
      seq,
      delayMs,
      fnName: fn.name || "anonymous",
      stack: new Error().stack.split("\n").slice(0, 6).join("\n") || "",
    });
    try { fn.(); } catch (e) { console.warn("scheduleHomeSectionMount hata:", e); }
  }, Math.max(0, delayMs | 0));

  homeSectionMountTimers.add(timer);
}

function clearManagedHomeSectionRecoveryTimers() {
  managedHomeSectionRecoverySeq += 1;
  for (var timer of Array.from(managedHomeSectionRecoveryTimers)) {
    clearTimeout(timer);
    managedHomeSectionRecoveryTimers.delete(timer);
  }
}

function hasRenderableDom(selector) {
  try {
    return !!document.querySelector(selector);
  } catch {
    return false;
  }
}

function hasRenderablePersonalRecommendationUi(cfg = getMainConfig()) {
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  var personalOk =
    !homeSectionsConfig.enablePersonalRecommendations ||
    hasRenderableDom(
      "#personal-recommendations .personal-recs-row .personal-recs-card:not(.skeleton), #personal-recommendations .personal-recs-row .no-recommendations"
    );
  var becauseYouWatchedOk =
    !homeSectionsConfig.enableBecauseYouWatched ||
    hasRenderableDom(
      '[id^="because-you-watched--"] .byw-row .personal-recs-card:not(.skeleton), [id^="because-you-watched--"] .byw-row .no-recommendations, #because-you-watched .byw-row .personal-recs-card:not(.skeleton), #because-you-watched .byw-row .no-recommendations'
    );
  var genreOk =
    !homeSectionsConfig.enableGenreHubs ||
    hasRenderableDom(
      "#genre-hubs .genre-hub-section .genre-row .personal-recs-card:not(.skeleton), #genre-hubs .genre-hub-section .genre-row .no-recommendations"
    );
  return personalOk && becauseYouWatchedOk && genreOk;
}

function hasRenderableRecentRowsUi(cfg = getMainConfig()) {
  if (!shouldRenderRecentRowsUi(cfg)) return true;
  return hasRenderableDom(
    "[id^=\"top10-series-rows--\"] .personal-recs-card:not(.skeleton), [id^=\"top10-series-rows--\"] .no-recommendations, #top10-series-rows .recent-row-section .personal-recs-card:not(.skeleton), #top10-series-rows .recent-row-section .no-recommendations, [id^=\"top10-movie-rows--\"] .personal-recs-card:not(.skeleton), [id^=\"top10-movie-rows--\"] .no-recommendations, #top10-movie-rows .recent-row-section .personal-recs-card:not(.skeleton), #top10-movie-rows .recent-row-section .no-recommendations, [id^=\"tmdb-top-movie-rows--\"] .personal-recs-card:not(.skeleton), [id^=\"tmdb-top-movie-rows--\"] .no-recommendations, #tmdb-top-movie-rows .recent-row-section .personal-recs-card:not(.skeleton), #tmdb-top-movie-rows .recent-row-section .no-recommendations, [id^=\"recent-rows--\"] .personal-recs-card:not(.skeleton), [id^=\"recent-rows--\"] .no-recommendations, [id^=\"recent-rows--\"] .dir-row-hero, #recent-rows .recent-row-section .personal-recs-card:not(.skeleton), #recent-rows .recent-row-section .no-recommendations, #recent-rows .recent-row-section .dir-row-hero, [id^=\"continue-rows--\"] .personal-recs-card:not(.skeleton), [id^=\"continue-rows--\"] .no-recommendations, [id^=\"continue-rows--\"] .dir-row-hero, #continue-rows .recent-row-section .personal-recs-card:not(.skeleton), #continue-rows .recent-row-section .no-recommendations, #continue-rows .recent-row-section .dir-row-hero, [id^=\"nextup-rows--\"] .personal-recs-card:not(.skeleton), [id^=\"nextup-rows--\"] .no-recommendations, [id^=\"nextup-rows--\"] .dir-row-hero, #nextup-rows .recent-row-section .personal-recs-card:not(.skeleton), #nextup-rows .recent-row-section .no-recommendations, #nextup-rows .recent-row-section .dir-row-hero"
  );
}

function hasRenderableDirectorRowsUi(cfg = getMainConfig()) {
  if (!shouldRenderDirectorRowsUi(cfg)) return true;
  return hasRenderableDom(
    "[id^=\"director-rows--\"] .personal-recs-card:not(.skeleton), [id^=\"director-rows--\"] .no-recommendations, [id^=\"director-rows--\"] .dir-row-hero, #director-rows .dir-row-section .personal-recs-card:not(.skeleton), #director-rows .dir-row-section .no-recommendations, #director-rows .dir-row-section .dir-row-hero"
  );
}

function hasRenderableStudioHubsUi(cfg = getMainConfig()) {
  if (!shouldRenderStudioHubsUi(cfg)) return true;
  return hasRenderableDom(
    "#studio-hubs .studio-hub-card, #studio-hubs .studio-card, #studio-hubs .no-recommendations"
  );
}

function getManagedHomeSectionStatus(cfg = getMainConfig()) {
  return {
    studio: hasRenderableStudioHubsUi(cfg),
    personal: hasRenderablePersonalRecommendationUi(cfg),
    recent: hasRenderableRecentRowsUi(cfg),
    director: hasRenderableDirectorRowsUi(cfg),
  };
}

function needsManagedHomeSectionRecovery(cfg = getMainConfig()) {
  var status = getManagedHomeSectionStatus(cfg);
  return !(status.studio && status.personal && status.recent && status.director);
}

function getManagedHomeSectionDebugSnapshot(cfg = getMainConfig()) {
  var status = getManagedHomeSectionStatus(cfg);
  return {
    hash: String(window.location.hash || ""),
    visiblePageId: (
      document.querySelector("#indexPage:not(.hide)").id ||
      document.querySelector("#homePage:not(.hide)").id ||
      null
    ),
    isHomeRouteActive: isHomeRouteActive(),
    isHomeVisible: isHomeVisible(),
    pendingCleanup: !!pendingManagedHomeSectionCleanupPromise,
    homeSectionMountSeq,
    managedHomeSectionRecoverySeq,
    status,
    needsRecovery: !(status.studio && status.personal && status.recent && status.director),
    shells: {
      personal: !!document.getElementById("personal-recommendations"),
      becauseYouWatchedCount: document.querySelectorAll('[id^="because-you-watched--"], #because-you-watched').length,
      genre: !!document.getElementById("genre-hubs"),
      recent: document.querySelectorAll('[id^="recent-rows--"], #recent-rows').length > 0,
      continueRows: document.querySelectorAll('[id^="continue-rows--"], #continue-rows').length > 0,
      nextUpRows: document.querySelectorAll('[id^="nextup-rows--"], #nextup-rows').length > 0,
      top10Series: document.querySelectorAll('[id^="top10-series-rows--"], #top10-series-rows').length > 0,
      top10Movies: document.querySelectorAll('[id^="top10-movie-rows--"], #top10-movie-rows').length > 0,
      tmdbTopMovies: document.querySelectorAll('[id^="tmdb-top-movie-rows--"], #tmdb-top-movie-rows').length > 0,
      director: document.querySelectorAll('[id^="director-rows--"], #director-rows').length > 0,
      studio: !!document.getElementById("studio-hubs"),
    }
  };
}

try {
  window.__jmsDumpHomeDebugSnapshot = function() {
    var snapshot = getManagedHomeSectionDebugSnapshot();
    console.log("[JMS:HOME] snapshot", snapshot);
    return snapshot;
  };
} catch {}

function runManagedHomeSectionRecovery({
  eagerStudioHubs = true,
  seq = managedHomeSectionRecoverySeq,
} = {}) {
  if (managedHomeSectionRecoverySeq !== seq) return false;
  if (!isHomeRouteActive()) {
    homeSectionWarn("managedRecovery:skip:not-home-route", { seq, eagerStudioHubs });
    return false;
  }
  var visible = waitForVisibleIndexPage(12000);
  if (managedHomeSectionRecoverySeq !== seq) return false;
  if (!visible || !isHomeVisible()) {
    homeSectionWarn("managedRecovery:skip:not-visible", {
      seq,
      eagerStudioHubs,
      visible,
    });
    return false;
  }

  waitForManagedHomeSectionCleanup({ timeoutMs: 2500 });
  if (managedHomeSectionRecoverySeq !== seq) return false;
  if (!isHomeRouteActive() || !isHomeVisible()) return false;

  var cfg = getMainConfig();
  var statusBefore = getManagedHomeSectionStatus(cfg);
  homeSectionLog("managedRecovery:start", {
    seq,
    eagerStudioHubs,
    statusBefore,
  });
  if (!needsManagedHomeSectionRecovery(cfg)) {
    homeSectionLog("managedRecovery:skip:already-rendered", {
      seq,
      statusBefore,
    });
    return true;
  }

  var results = Promise.allSettled([
    shouldRenderStudioHubsUi(cfg)
      ? ensureStudioHubsMountedLazy({ eager: eagerStudioHubs })
      : Promise.resolve(),
    shouldRenderPersonalRecommendationUi(cfg)
      ? renderPersonalRecommendationsLazy()
      : Promise.resolve(),
    shouldRenderRecentRowsUi(cfg)
      ? mountRecentRowsLazyModule()
      : Promise.resolve(),
    shouldRenderDirectorRowsUi(cfg)
      ? mountDirectorRowsLazyModule()
      : Promise.resolve(),
  ]);

  var statusAfter = getManagedHomeSectionStatus(cfg);
  var ok = !needsManagedHomeSectionRecovery(cfg);
  homeSectionLog("managedRecovery:complete", {
    seq,
    ok,
    statusBefore,
    statusAfter,
    moduleResults: {
      studio: results[0].status || null,
      personal: results[1].status || null,
      recent: results[2].status || null,
      director: results[3].status || null,
    },
  });
  return ok;
}

function scheduleManagedHomeSectionRecovery({
  delaysMs = [300, 1200, 2600, 4800, 7600],
  eagerStudioHubs = true,
} = {}) {
  clearManagedHomeSectionRecoveryTimers();
  var seq = managedHomeSectionRecoverySeq;
  homeSectionLog("managedRecovery:schedule", {
    seq,
    delaysMs: Array.isArray(delaysMs) ? delaysMs.slice() : [],
    eagerStudioHubs,
  });

  for (var rawDelay of delaysMs) {
    var delayMs = Math.max(0, Number(rawDelay) || 0);
    var timer = window.setTimeoutfunction(() {
      managedHomeSectionRecoveryTimers.delete(timer);
      if (managedHomeSectionRecoverySeq !== seq) return;
      void runManagedHomeSectionRecovery({ eagerStudioHubs, seq }).thenfunction((ok) {
        if (ok && managedHomeSectionRecoverySeq === seq) {
          clearManagedHomeSectionRecoveryTimers();
        }
      });
    }, delayMs);
    managedHomeSectionRecoveryTimers.add(timer);
  }
}

function bootHomeSections(cfg, { eagerStudioHubs = false, forceManagedSections = false } = {}) {
  homeSectionMountSeq += 1;
  var seq = homeSectionMountSeq;
  clearHomeSectionMountTimers();
  var delayMs = 0;
  var effectiveForceManagedSections = getEffectiveManagedHomeSectionForce(forceManagedSections);
  var sections = {
    studio: shouldRenderStudioHubsUi(cfg),
    personal: shouldRenderPersonalRecommendationUi(cfg),
    recent: shouldRenderRecentRowsUi(cfg),
    director: shouldRenderDirectorRowsUi(cfg),
  };
  homeSectionLog("bootHomeSections", {
    seq,
    eagerStudioHubs,
    forceManagedSections: effectiveForceManagedSections,
    requestedForceManagedSections: forceManagedSections === true,
    sections,
  });
  homeSectionTrace("bootHomeSections", {
    seq,
    eagerStudioHubs,
    forceManagedSections: effectiveForceManagedSections,
    requestedForceManagedSections: forceManagedSections === true,
    sections,
    stack: new Error().stack.split("\n").slice(0, 6).join("\n") || "",
  });

  if (sections.studio) {
    scheduleHomeSectionMountfunction(seq, () {
      void ensureStudioHubsMountedLazy({ eager: eagerStudioHubs });
    }, delayMs);
    delayMs += 180;
  }

  if (sections.personal) {
    scheduleHomeSectionMountfunction(seq, () {
      void renderPersonalRecommendationsLazy({ force: effectiveForceManagedSections });
    }, delayMs);
    delayMs += 180;
  }
  if (sections.recent) {
    scheduleHomeSectionMountfunction(seq, () {
      void mountRecentRowsLazyModule({ force: effectiveForceManagedSections });
    }, delayMs);
    delayMs += 180;
  }
  if (sections.director) {
    scheduleHomeSectionMountfunction(seq, () {
      void mountDirectorRowsLazyModule({ force: effectiveForceManagedSections });
    }, delayMs);
    delayMs += 180;
  }
}

function kickManagedHomeSectionsNow(
  cfg = getMainConfig(),
  {
    eagerStudioHubs = true,
    forceManagedSections = false,
    reason = "direct-kick",
  } = {}
) {
  var effectiveForceManagedSections = getEffectiveManagedHomeSectionForce(forceManagedSections);
  var sections = {
    studio: shouldRenderStudioHubsUi(cfg),
    personal: shouldRenderPersonalRecommendationUi(cfg),
    recent: shouldRenderRecentRowsUi(cfg),
    director: shouldRenderDirectorRowsUi(cfg),
  };

  homeSectionLog("kickManagedHomeSectionsNow", {
    reason,
    eagerStudioHubs,
    forceManagedSections: effectiveForceManagedSections,
    requestedForceManagedSections: forceManagedSections === true,
    sections,
  });

  if (sections.studio) {
    void ensureStudioHubsMountedLazy({
      eager: eagerStudioHubs,
      force: effectiveForceManagedSections,
    });
  }
  if (sections.personal) {
    void renderPersonalRecommendationsLazy({ force: effectiveForceManagedSections });
  }
  if (sections.recent) {
    void mountRecentRowsLazyModule({ force: effectiveForceManagedSections });
  }
  if (sections.director) {
    void mountDirectorRowsLazyModule({ force: effectiveForceManagedSections });
  }
}

function installHomeTabSliderOnlyGate() {
  if (window.__homeTabSliderOnlyGateInstalled) return;
  window.__homeTabSliderOnlyGateInstalled = true;

  var setFlagsFromConfig = function() {
    try {
      var cfg = (typeof getConfig === "function" ? getConfig() : {}) || {};
      var on = !!cfg.onlyShowSliderOnHomeTab;
      document.documentElement.dataset.jmsHomeSliderOnly = on ? "1" : "0";
      return on;
    } catch {
      document.documentElement.dataset.jmsHomeSliderOnly = "0";
      return false;
    }
  };

  function isHomeTabActive() {
  var homeBtn =
    document.querySelector('button.emby-tab-button[data-index="0"]') ||
    document.querySelector('button.emby-tab-button');

  if (!homeBtn) {
    return !!document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  }

  return (
    homeBtn.classList.contains("emby-tab-button-active") ||
    homeBtn.classList.contains("active") ||
    homeBtn.getAttribute("aria-selected") === "true"
  );
}

  function apply() {
    var onlyHome = setFlagsFromConfig();
    if (!onlyHome) {
      document.documentElement.dataset.jmsHomeTabActive = "1";
      if (window.__jmsHomeTabPaused) {
        window.__jmsHomeTabPaused = false;
        try { resumeSlideTimer.(); } catch {}
        try { resumeProgressBar.(); } catch {}
      }
      return;
    }

    var active = isHomeTabActive();
    document.documentElement.dataset.jmsHomeTabActive = active ? "1" : "0";

    if (typeof isSliderEnabled === "function" && !isSliderEnabled()) return;

    if (!active) {
      if (!window.__jmsHomeTabPaused) {
        window.__jmsHomeTabPaused = true;
        try { pauseSlideTimer.(); } catch {}
        try { pauseProgressBar.(); } catch {}
      }
    } else {
      if (window.__jmsHomeTabPaused) {
        window.__jmsHomeTabPaused = false;
        try { resumeProgressBar.(); } catch {}
        try { resumeSlideTimer.(); } catch {}
      }
    }
  }

  apply();

  var mo = new MutationObserverfunction(() apply());
  mo.observe(getDomObserveRoot(), { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

  var tick = function() apply();
  window.addEventListener("popstate", tick);
  window.addEventListener("pageshow", tick);
  window.addEventListener("focus", tick);

  window.__cleanupHomeTabSliderOnlyGate = function() {
    try { mo.disconnect(); } catch {}
    window.removeEventListener("popstate", tick);
    window.removeEventListener("pageshow", tick);
    window.removeEventListener("focus", tick);
  };
}

function __getLabelsSafe() {
  try {
    var lang = (typeof getDefaultLanguage === "function" ? getDefaultLanguage() : null) || "eng";
    return (typeof getLanguageLabels === "function" ? getLanguageLabels(lang) : {}) || {};
  } catch {
    return {};
  }
}

function __pickFirstLabel(labels, keys, fallback) {
  for (var k of keys) {
    var v = labels.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return fallback;
}

function L(keyOrKeys, fallback) {
  var labels = __getLabelsSafe();
  var keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
  return __pickFirstLabel(labels, keys, fallback);
}

window.__totalSlidesPlanned = 0;
window.__slidesCreated = 0;
window.__cycleStartAt = 0;
window.__cycleArmTimeout = null;
window.__cycleExpired = window.__cycleExpired || false;
window.__peakBooting = true;
window.__jmsFirstSlideReady = window.__jmsFirstSlideReady || false;
window.__jmsNonCriticalBooted = window.__jmsNonCriticalBooted || false;
window.__jmsNotificationsBooted = window.__jmsNotificationsBooted || false;
window.__jmsMusicSchedulerBooted = window.__jmsMusicSchedulerBooted || false;
window.__jmsSliderBootToken = Number(window.__jmsSliderBootToken || 0);
window.__jmsSlidesInitToken = Number(window.__jmsSlidesInitToken || 0);
window.__jmsSliderResetToken = Number(window.__jmsSliderResetToken || 0);
window.__jmsStartWhenAllReadyHandler = window.__jmsStartWhenAllReadyHandler || null;
window.__jmsSliderIdleHandles = window.__jmsSliderIdleHandles || new Set();

function clearStartWhenAllReadyHandler() {
  var handler = window.__jmsStartWhenAllReadyHandler;
  if (typeof handler === "function") {
    try { document.removeEventListener("jms:all-slides-ready", handler); } catch {}
  }
  window.__jmsStartWhenAllReadyHandler = null;
}

function clearPendingSliderIdleTasks() {
  var handles = window.__jmsSliderIdleHandles;
  if (!(handles instanceof Set) || !handles.size) return;
  for (var handle of Array.from(handles)) {
    try { cancelIdle(handle); } catch {}
    handles.delete(handle);
  }
}

function invalidateSliderBootSession() {
  window.__jmsSliderBootToken = (Number(window.__jmsSliderBootToken) || 0) + 1;
  clearStartWhenAllReadyHandler();
  clearPendingSliderIdleTasks();
}

function beginSliderBootSession() {
  invalidateSliderBootSession();
  return Number(window.__jmsSliderBootToken) || 0;
}

function isSliderBootTokenCurrent(token, { requireHomeVisible = true, requireContainer = false } = {}) {
  if (!Number.isFinite(token) || token <= 0) return false;
  if ((Number(window.__jmsSliderBootToken) || 0) !== token) return false;
  if (requireHomeVisible && !isHomeVisible()) return false;
  if (requireContainer) {
    return !!document.querySelector(
      "#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container"
    );
  }
  return true;
}

function scheduleSliderIdleTask(cb) {
  var handles = window.__jmsSliderIdleHandles instanceof Set
    ? window.__jmsSliderIdleHandles
    : (window.__jmsSliderIdleHandles = new Set());
  var handle = 0;
  handle = idlefunction(() {
    handles.delete(handle);
    try { cb.(); } catch (e) { console.warn("scheduleSliderIdleTask hata:", e); }
  });
  handles.add(handle);
  return handle;
}

function waitForFirstSlideVisualReady(
  slideEl,
  bootToken = Number(window.__jmsSliderBootToken) || 0,
  { timeoutMs = 3200 } = {}
) {
  if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) {
    return Promise.resolve(false);
  }

  if (isCustomSplashSlideVisuallyReady(slideEl)) {
    return Promise.resolve(true);
  }

  return new Promisefunction((resolve) {
    var done = false;
    var rafA = 0;
    var rafB = 0;
    var timer = 0;
    var observer = null;

    var cleanup = function() {
      if (rafA) cancelAnimationFrame(rafA);
      if (rafB) cancelAnimationFrame(rafB);
      if (timer) clearTimeout(timer);
      try { observer.disconnect.(); } catch {}
      try { document.removeEventListener("jms:slide-enter", scheduleCheck, true); } catch {}
      try { window.removeEventListener("pageshow", scheduleCheck); } catch {}
      try { document.removeEventListener("visibilitychange", scheduleCheck); } catch {}
      rafA = 0;
      rafB = 0;
      timer = 0;
      observer = null;
    };

    var finish = function(ready = false) {
      if (done) return;
      done = true;
      cleanup();
      resolve(ready);
    };

    var check = function() {
      if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) {
        finish(false);
        return;
      }
      if (isCustomSplashSlideVisuallyReady(slideEl)) {
        finish(true);
      }
    };

    function scheduleCheck() {
      if (done || rafA || rafB) return;
      rafA = requestAnimationFramefunction(() {
        rafA = 0;
        rafB = requestAnimationFramefunction(() {
          rafB = 0;
          check();
        });
      });
    }

    observer = new MutationObserverfunction(() {
      scheduleCheck();
    });

    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden"]
      });
    } catch {}

    document.addEventListener("jms:slide-enter", scheduleCheck, true);
    window.addEventListener("pageshow", scheduleCheck);
    document.addEventListener("visibilitychange", scheduleCheck);

    timer = window.setTimeoutfunction(() {
      finish(isCustomSplashSlideVisuallyReady(slideEl));
    }, Math.max(800, Number(timeoutMs) || 0));

    scheduleCheck();
  });
}

function markFirstSlideReady(bootToken = Number(window.__jmsSliderBootToken) || 0) {
  if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) return;
  if (window.__jmsFirstSlideReady) return;
  window.__jmsFirstSlideReady = true;
  syncCustomSplashProgress({ firstSlideReady: true });
  try {
    document.dispatchEvent(new CustomEvent("jms:first-slide-ready"));
  } catch {}
}

function whenFirstSlideReadyOrTimeout(cb, timeoutMs = 7000) {
  var done = false;
  var to = null;
  var finish = function() {
    if (done) return;
    done = true;
    try { clearTimeout(to); } catch {}
    try { document.removeEventListener("jms:first-slide-ready", onReady); } catch {}
    try { cb(); } catch {}
  };
  var onReady = function() finish();

  if (window.__jmsFirstSlideReady) {
    finish();
    return;
  }
  document.addEventListener("jms:first-slide-ready", onReady, { once: true });
  to = setTimeout(finish, Math.max(1000, timeoutMs | 0));
}

(function earlyCssBoot(){
  var D = document;
  var HEAD = D.head || D.documentElement;
  var raf =
    window.requestAnimationFrame ||
    function((cb) setTimeout(cb, 16));
  var criticalCSS = "\n    html[data-jms-notif=\"0\"] .skinHeader .headerRight #jfNotifBtn { display:none !important; }\n    .skinHeader .headerRight #jfNotifBtn { order: -9999; }\n\n    html[data-jms-home-slider-only=\"1\"][data-jms-home-tab-active=\"0\"] #monwui-slides-container,\n    html[data-jms-home-slider-only=\"1\"][data-jms-home-tab-active=\"0\"] .monwui-slide-progress-bar,\n    html[data-jms-home-slider-only=\"1\"][data-jms-home-tab-active=\"0\"] .monwui-slide-progress-seconds,\n    html[data-jms-home-slider-only=\"1\"][data-jms-home-tab-active=\"0\"] .monwui-dot-navigation-container {\n      display: none !important;\n    }\n    html[data-jms-home-slider-only=\"1\"][data-jms-home-tab-active=\"0\"] .jms-slider,\n    html[data-jms-home-slider-only=\"1\"][data-jms-home-tab-active=\"0\"] .homeSlider,\n    html[data-jms-home-slider-only=\"1\"][data-jms-home-tab-active=\"0\"] #monwui-slides-container {\n      display: none !important;\n    }\n  ";
  if (!D.getElementById('jms-critical-css')) {
    var s = D.createElement('style');
    s.id = 'jms-critical-css';
    s.textContent = criticalCSS;
    HEAD.prepend(s);
  }

  function syncCSS(href, id, enabled = true) {
    var existing = D.getElementById(id);
    if (!enabled) {
      existing.remove();
      return;
    }
    if (!href) return;

    var resolved = resolveSliderAssetHref(href);

    if (existing) {
      if (existing.href !== resolved) existing.href = resolved;
      try { existing.fetchPriority = 'high'; } catch {}
      existing.setAttribute('fetchpriority', 'high');
      return;
    }

    var l = D.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = resolved;
    try { l.fetchPriority = 'high'; } catch {}
    l.setAttribute('fetchpriority','high');
    HEAD.prepend(l);
  }

  function removeCssByHref(patterns = []) {
    if (!patterns.length) return;
    D.querySelectorAll('link[rel="stylesheet"][href]').forEach(function((link) {
      var href = String(link.getAttribute('href') || link.href || '');
      if (!href) return;
      if function(patterns.some((pattern) href.includes(pattern))) {
        link.remove();
      }
    });
  }

  function getLiveConfig() {
    try {
      if (typeof getConfig === 'function') {
        return getConfig() || {};
      }
    } catch {}
    return {};
  }

  function getCssVariant(cfg = getLiveConfig()) {
    return cfg.cssVariant || 'normalslider';
  }

  function matchesAny(selectors = []) {
    return selectors.somefunction((selector) {
      try {
        return !!D.querySelector(selector);
      } catch {
        return false;
      }
    });
  }

  function isSliderCssActive(cfg) {
    return cfg.enableSlider !== false || matchesAny([
      '#monwui-slides-container',
      '.monwui-slide-progress-bar',
      '.monwui-dot-navigation-container'
    ]);
  }

  function isNotificationsCssActive(cfg) {
    return cfg.enableNotifications !== false || matchesAny([
      '#jfNotifBtn',
      '#jfNotifModal',
      '.jf-notif-panel'
    ]);
  }

  function shouldRenderPersonalRecommendationUi(cfg) {
    var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    return !!(
      homeSectionsConfig.enablePersonalRecommendations ||
      homeSectionsConfig.enableGenreHubs ||
      homeSectionsConfig.enableBecauseYouWatched
    );
  }

  function shouldRenderDirectorRowsUi(cfg) {
    return getHomeSectionsRuntimeConfig(cfg).enableDirectorRows;
  }

  function shouldRenderRecentRowsUi(cfg) {
    var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    return !!(
      homeSectionsConfig.enableRecentRows ||
      homeSectionsConfig.enableTop10SeriesRowsSection ||
      homeSectionsConfig.enableTop10MovieRowsSection ||
      homeSectionsConfig.enableTmdbTopMoviesRowsSection ||
      homeSectionsConfig.enableContinueMovies ||
      homeSectionsConfig.enableContinueSeries ||
      homeSectionsConfig.enableOtherLibRows
    );
  }

  function shouldRenderStudioHubsUi(cfg) {
    return getHomeSectionsRuntimeConfig(cfg).enableStudioHubs;
  }

  function isRecommendationCssActive(cfg) {
    var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
    return !!(
      homeSectionsConfig.enablePersonalRecommendations ||
      homeSectionsConfig.enableGenreHubs ||
      homeSectionsConfig.enableBecauseYouWatched ||
      homeSectionsConfig.enableDirectorRows ||
      homeSectionsConfig.enableRecentRows ||
      homeSectionsConfig.enableContinueMovies ||
      homeSectionsConfig.enableContinueSeries ||
      homeSectionsConfig.enableNextUpRowsSection ||
      homeSectionsConfig.enableOtherLibRows
    ) || matchesAny([
      '#personal-recommendations',
      '#genre-hubs',
      '#director-rows',
      '[id^="director-rows--"]',
      '#recent-rows',
      '[id^="recent-rows--"]',
      '#continue-rows',
      '[id^="continue-rows--"]',
      '#nextup-rows',
      '[id^="nextup-rows--"]',
      '#because-you-watched',
      '[id^="because-you-watched--"]'
    ]);
  }

  function isStudioHubsCssActive(cfg) {
    return shouldRenderStudioHubsUi(cfg) || matchesAny([
      '#studio-hubs',
      '.hub-preview-popover'
    ]);
  }

  function isDetailsModalCssActive(cfg) {
    var modalDomPresent = matchesAny([
      '#jms-details-modal-root',
      '.jmsdm-backdrop',
      '.jmsdm-card'
    ]);

    if (!isDetailsModalModuleEnabled(cfg)) {
      return modalDomPresent;
    }

    return (
      isSliderCssActive(cfg) ||
      isNotificationsCssActive(cfg) ||
      isRecommendationCssActive(cfg) ||
      isStudioHubsCssActive(cfg) ||
      modalDomPresent
    );
  }

  function isMiniPopoverCssActive(cfg) {
    return !!(
      isSliderCssActive(cfg) ||
      isRecommendationCssActive(cfg) ||
      isStudioHubsCssActive(cfg) ||
      cfg.studioHubsHoverVideo ||
      (cfg.globalPreviewMode === 'studioMini' && cfg.studioMiniTrailerPopover)
    ) || matchesAny([
      '.mini-poster-popover',
      '.mini-trailer-popover',
      '.hub-preview-popover'
    ]);
  }

  function isAvatarPickerCssActive(cfg) {
    return !!(
      cfg.createAvatar ||
      (window.location.hash || '').startsWith('#/userprofile')
    ) || matchesAny([
      '.jms-avatarBackdrop',
      '.jms-avatarModal',
      '.jms-avatarPickBtn'
    ]);
  }

  function isProfileChooserCssActive(cfg) {
    return cfg.enableProfileChooser !== false || matchesAny([
      '#jfProfileChooserOverlay',
      '#jfProfileChooserBtn',
      '.jf-profile-overlay',
      '.jf-profile-header-btn'
    ]);
  }

  function isPauseFeatureCssActive(cfg) {
    var pauseConfig = getPauseFeaturesRuntimeConfig(cfg);
    return !!(
      pauseConfig.enablePauseOverlay ||
      pauseConfig.enableSmartAutoPause
    ) || matchesAny([
      '#jms-pause-overlay',
      '#jms-overlay-progress',
      '#pause-status-bottom-right',
      '#jms-reco-panel',
      '.rating-genre-overlay',
      '.rating-icons-overlay'
    ]);
  }

  function isSubtitleCustomizerCssActive(cfg) {
    return isSubtitleCustomizerModuleEnabled(cfg) && matchesAny([
      '.videoOsdBottom.videoOsdBottom-maincontrols .buttons',
      '.btnJmsSubtitleCustomizer',
      '[data-jms-subtitle-dialog]',
      '#jms-subtitle-dialog',
      '.jms-subtitle-dialog'
    ]);
  }

  var FEATURE_CSS_SYNC_SELECTOR_TEXT = [
    '#indexPage',
    '#homePage',
    '.homeSectionsContainer',
    '#monwui-slides-container',
    '.monwui-slide-progress-bar',
    '.monwui-dot-navigation-container',
    '#jfNotifBtn',
    '#jfNotifModal',
    '.jf-notif-panel',
    '#personal-recommendations',
    '#genre-hubs',
    '#director-rows',
    '[id^="director-rows--"]',
    '#recent-rows',
    '[id^="recent-rows--"]',
    '#continue-rows',
    '[id^="continue-rows--"]',
    '#nextup-rows',
    '[id^="nextup-rows--"]',
    '#because-you-watched',
    '[id^="because-you-watched--"]',
    '#studio-hubs',
    '.hub-preview-popover',
    '#jms-details-modal-root',
    '.jmsdm-backdrop',
    '.jmsdm-card',
    '.mini-poster-popover',
    '.mini-trailer-popover',
    '.jms-avatarBackdrop',
    '.jms-avatarModal',
    '.jms-avatarPickBtn',
    '#jfProfileChooserOverlay',
    '#jfProfileChooserBtn',
    '.jf-profile-overlay',
    '.jf-profile-header-btn',
    '#jms-pause-overlay',
    '#jms-overlay-progress',
    '#pause-status-bottom-right',
    '#jms-reco-panel',
    '.rating-genre-overlay',
    '.rating-icons-overlay',
    '.videoOsdBottom.videoOsdBottom-maincontrols .buttons',
    '.btnJmsSubtitleCustomizer',
    '[data-jms-subtitle-dialog]',
    '#jms-subtitle-dialog',
    '.jms-subtitle-dialog'
  ].join(',');
  var FEATURE_CSS_SYNC_MIN_DELAY_MS = 160;

  function shouldQueueFeatureCssSyncFromMutations(mutations) {
    return mutationsTouchSelectors(mutations, FEATURE_CSS_SYNC_SELECTOR_TEXT);
  }

  var vmap = {
    peakslider: '/slider/src/peakslider.css',
    fullslider: '/slider/src/fullslider.css',
    normalslider: '/slider/src/normalslider.css',
    slider: '/slider/src/slider.css',
    auroraslider: '/slider/src/auroraSlider.css'
  };

  function getPauseOverlayCssHref(cfg = getLiveConfig()) {
    var variant = String(cfg.pauseOverlay.cssVariant || '').trim();
    return variant === 'moduloPausa2'
      ? '/slider/src/moduloPausa2.css'
      : '/slider/src/moduloPausa.css';
  }

  function applyFeatureCss() {
    var cfg = getLiveConfig();
    var variant = getCssVariant(cfg);
    var notificationsCssEnabled = isNotificationsCssActive(cfg);
    var recommendationCssEnabled = isRecommendationCssActive(cfg);
    var studioHubsCssEnabled = isStudioHubsCssActive(cfg);
    var detailsModalCssEnabled = isDetailsModalCssActive(cfg);
    var miniPopoverCssEnabled = isMiniPopoverCssActive(cfg);
    var avatarPickerCssEnabled = isAvatarPickerCssActive(cfg);
    var profileChooserCssEnabled = isProfileChooserCssActive(cfg);
    var pauseFeatureCssEnabled = isPauseFeatureCssActive(cfg);
    var subtitleCustomizerCssEnabled = isSubtitleCustomizerCssActive(cfg);
    var sliderCssEnabled = isSliderCssActive(cfg);

    syncCSS('/slider/src/fontawesome/all.min.css', 'jms-css-fontawesome', true);
    D.getElementById('jms-css-notifications').remove();
    syncCSS(getPauseOverlayCssHref(cfg), 'jms-css-pause', pauseFeatureCssEnabled);
    syncCSS('/slider/src/personalRecommendations.css', 'jms-css-recs', recommendationCssEnabled);
    syncCSS('/slider/src/studioHubs.css', 'jms-css-studiohubs', studioHubsCssEnabled);
    syncCSS('/slider/src/detailsModal.css', 'jms-css-detailsModal', detailsModalCssEnabled);
    syncCSS('/slider/src/studioHubsMini.css', 'jms-css-studioHubsMini', miniPopoverCssEnabled);
    syncCSS('/slider/src/avatarPicker.css', 'jms-css-avatarPicker', avatarPickerCssEnabled);
    syncCSS('/slider/src/profileChooser.css', 'jms-css-profileChooser', profileChooserCssEnabled);
    syncCSS('/slider/src/subtitleCustomizer.css', 'jms-css-subtitleCustomizer', subtitleCustomizerCssEnabled);
    syncCSS(vmap[variant] || vmap.normalslider, 'jms-css-variant', sliderCssEnabled);

    if (!notificationsCssEnabled) {
      removeCssByHref([
        'slider/src/notifications.css',
        'slider/src/notifications2.css',
        'slider/src/notifications3.css',
        'slider/src/notifications4.css'
      ]);
    }
    if (!recommendationCssEnabled) {
      removeCssByHref(['slider/src/personalRecommendations.css']);
    }
    if (!studioHubsCssEnabled) {
      removeCssByHref(['slider/src/studioHubs.css']);
    }
    if (!detailsModalCssEnabled) {
      removeCssByHref(['slider/src/detailsModal.css']);
    }
    if (!miniPopoverCssEnabled) {
      removeCssByHref(['slider/src/studioHubsMini.css']);
    }
    if (!avatarPickerCssEnabled) {
      removeCssByHref(['slider/src/avatarPicker.css']);
    }
    if (!profileChooserCssEnabled) {
      removeCssByHref(['slider/src/profileChooser.css']);
    }
    if (!pauseFeatureCssEnabled) {
      removeCssByHref(['slider/src/moduloPausa.css', 'slider/src/moduloPausa2.css']);
    }
    if (!subtitleCustomizerCssEnabled) {
      removeCssByHref(['slider/src/subtitleCustomizer.css']);
    }
    if (!sliderCssEnabled) {
      removeCssByHref([
        'slider/src/peakslider.css',
        'slider/src/fullslider.css',
        'slider/src/normalslider.css',
        'slider/src/slider.css',
        'slider/src/auroraSlider.css'
      ]);
    }

    document.documentElement.dataset.cssVariant =
      variant === 'slider' ? 'slider' : variant;
    window.__cssVariant = document.documentElement.dataset.cssVariant;
    document.documentElement.setAttribute('data-jms-notif', cfg.enableNotifications ? '1' : '0');
  }

  var cssSyncQueued = false;
  var cssSyncTimer = 0;
  var cssLastSyncAt = 0;
  function queueFeatureCssSync(options = {}) {
    var force = options.force === true;
    if (cssSyncQueued) return;
    if (cssSyncTimer) {
      if (!force) return;
      clearTimeout(cssSyncTimer);
      cssSyncTimer = 0;
    }

    var elapsed = Date.now() - cssLastSyncAt;
    var delay = force ? 0 : Math.max(0, FEATURE_CSS_SYNC_MIN_DELAY_MS - elapsed);

    cssSyncTimer = window.setTimeoutfunction(() {
      cssSyncTimer = 0;
      if (cssSyncQueued) return;
      cssSyncQueued = true;
      raffunction(() {
        cssSyncQueued = false;
        cssLastSyncAt = Date.now();
        applyFeatureCss();
      });
    }, delay);
  }

  try {
    window.__jmsQueueFeatureCssSync = queueFeatureCssSync;
  } catch {}

  applyFeatureCss();

  D.addEventListenerfunction('DOMContentLoaded', () queueFeatureCssSync({ force: true }), { once: true });
  window.addEventListenerfunction('hashchange', () queueFeatureCssSync({ force: true }), { passive: true });
  window.addEventListenerfunction('popstate', () queueFeatureCssSync({ force: true }), { passive: true });
  window.addEventListenerfunction('pageshow', () queueFeatureCssSync({ force: true }), { passive: true });
  window.addEventListenerfunction('jms:globalPreviewModeChanged', () queueFeatureCssSync({ force: true }), { passive: true });

  if (typeof MutationObserver === 'function') {
    var mo = new MutationObserverfunction((mutations) {
      if (!shouldQueueFeatureCssSyncFromMutations(mutations)) return;
      queueFeatureCssSync();
    });
    mo.observe(getDomObserveRoot(), {
      childList: true,
      subtree: true
    });
  }
})();

(function requestPersistentStorageOnce(){
  try {
    var supported = !!(navigator.storage && navigator.storage.persist);
    if (!supported) return;
    var already = navigator.storage.persisted();
    if (already) return;
    navigator.storage.persist().catchfunction((){});
  } catch {}
})();

function waitAuthWarmupFallback(maxMs = 5000){
  try {
    if (typeof isAuthReadyStrict === "function" && isAuthReadyStrict()) return true;
    if (typeof waitForAuthReadyStrict === "function") {
      return waitForAuthReadyStrict(maxMs);
    }
  } catch {}
  return false;
}

function waitForStylesReady() {
  var links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .filter(function(l) !l.disabled);
  Promise.all(links.map(function(l) {
    if (l.sheet) return Promise.resolve();
    return new Promise(function(res) {
      l.addEventListener('load', res, { once:true });
      l.addEventListener('error', res, { once:true });
      setTimeout(res, 2000);
    });
  }));
  if (document.fonts && document.fonts.ready) {
    try { document.fonts.ready; } catch {}
  }
}

function clearCycleArm() {
  try { clearTimeout(window.__cycleArmTimeout); } catch {}
  window.__cycleArmTimeout = null;
}

function getPerSlideDurationMs() {
  var pb = document.querySelector(".monwui-slide-progress-bar");
  if (pb) {
    var raw = getComputedStyle(pb).getPropertyValue("--slide-duration-ms");
    var v = parseInt(raw, 10);
    if (Number.isFinite(v) && v > 0) return v;
    var td = getComputedStyle(pb).transitionDuration;
    if (td && td.endsWith("s")) {
      var sec = parseFloat(td);
      if (sec > 0) return Math.round(sec * 1000);
    }
  }
  var cfg = getConfig.() || {};
  return Number.isFinite(cfg.sliderDuration) ? cfg.sliderDuration
       : Number.isFinite(cfg.slideDurationMs) ? cfg.slideDurationMs
       : Number.isFinite(cfg.autoSlideIntervalMs) ? cfg.autoSlideIntervalMs
       : 15000;
}

function getCycleDurationMs() {
  var per = getPerSlideDurationMs();
  var total = getPlannedTotalSlides();
  return per * total;
}

function armCycleReset() {
  clearCycleArm();
  var cycleMs = getCycleDurationMs();
  var elapsed = Math.max(0, Date.now() - (window.__cycleStartAt || 0));
  var remain = Math.max(0, cycleMs - elapsed);

  window.__cycleArmTimeout = setTimeoutfunction(() {
  window.__cycleExpired = true;
  }, remain);
}

function startNewCycleClock() {
  window.__cycleStartAt = Date.now();
  window.__cycleExpired = false;
  armCycleReset();
}

function hasStartedCycleClock() {
  return Number(window.__cycleStartAt || 0) > 0;
}

function isCustomSplashBlockingNow() {
  try {
    var root = getCustomSplashRoot();
    return !!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR) && !root.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
  } catch {
    return false;
  }
}

function markSlideCreated(bootToken = Number(window.__jmsSliderBootToken) || 0) {
  if (!isSliderBootTokenCurrent(bootToken, { requireHomeVisible: false })) return;
  window.__slidesCreated = (window.__slidesCreated || 0) + 1;
  var totalSlides = Math.max(0, Number(window.__totalSlidesPlanned) || 0);
  var createdSlides = Math.max(0, Number(window.__slidesCreated) || 0);
  syncCustomSplashProgress({
    totalSlides,
    createdSlides,
    allSlidesReady: totalSlides > 0 && createdSlides >= totalSlides
  });
  if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
    try {
      document.dispatchEvent(new CustomEvent("jms:all-slides-ready"));
    } catch {}
  }
}

function chunkArray(arr, size = 2) {
  var out = [];
  var safeSize = Math.max(1, Number(size) || 1);
  for (var i = 0; i < arr.length; i += safeSize) {
    out.push(arr.slice(i, i + safeSize));
  }
  return out;
}

function wrapIndex(index, len) {
  if (!len) return 0;
  return ((index % len) + len) % len;
}

function buildPeakCreationBatches(total, peakOpts = {}) {
  if (!Number.isFinite(total) || total <= 0) return [];

  var { spanLeft = 1, spanRight = 1 } = peakOpts || {};
  var seen = new Set();
  var firstBatch = [];
  var laterVisible = [];
  var initialLeft = Math.min(Math.max(0, spanLeft), 5);
  var initialRight = Math.min(Math.max(0, spanRight), 5);
  var add = function(target, idx) {
    var safe = wrapIndex(idx, total);
    if (seen.has(safe)) return;
    seen.add(safe);
    target.push(safe);
  };

  add(firstBatch, 0);
  for (var step = 1; step <= initialRight; step++) {
    add(firstBatch, step);
  }
  for (var step = 1; step <= initialLeft; step++) {
    add(firstBatch, total - step);
  }

  var maxVisibleSpan = Math.max(spanLeft, spanRight, initialLeft, initialRight);
  for (var step = 1; step <= maxVisibleSpan; step++) {
    if (step > initialRight && step <= spanRight) add(laterVisible, step);
    if (step > initialLeft && step <= spanLeft) add(laterVisible, total - step);
  }

  var background = [];
  for (var idx = 0; idx < total; idx++) {
    add(background, idx);
  }

  return [firstBatch, ...chunkArray([...laterVisible, ...background], 2)].filterfunction((batch) batch.length);
}

function hardProgressReset() {
  ensureProgressBarExists();
  var pb = document.querySelector(".monwui-slide-progress-bar");
  if (!pb) return;
  console.debug("[JMS] hardProgressReset()");
  pb.style.transition = "none";
  pb.style.animation = "none";
  pb.style.width = "0%";
  pb.style.opacity = "1";
  void pb.offsetWidth;
  try { resetProgressBar.(); } catch {}
  var newPb = pb.cloneNode(true);
  pb.replaceWith(newPb);
}

function getPlannedTotalSlides() {
  var n = parseInt(window.__totalSlidesPlanned || "0", 10);
  if (!Number.isFinite(n) || n <= 0) {
    var ls = parseInt(localStorage.getItem("limit") || "0", 10);
    if (Number.isFinite(ls) && ls > 0) n = ls;
  }
  if ((!Number.isFinite(n) || n <= 0) && typeof getConfig === "function") {
    var cfg = getConfig();
    var c = parseInt(cfg.limit || cfg.savedLimit || "0", 10);
    if (Number.isFinite(c) && c > 0) n = c;
  }
  return Math.max(1, n);
}

function getPlannedLastIndex() {
  return getPlannedTotalSlides() - 1;
}

function isPlannedLastIndex(idx) {
  return Number.isFinite(idx) && idx === getPlannedLastIndex();
}

function scheduleSliderRebuild(reason = "cycle-complete") {
  if (!isSliderEnabled()) return;
  if (window.__rebuildingSlider) return;
  window.__rebuildingSlider = true;
  try {
    clearCycleArm();
    window.__cycleExpired = false;
    try { teardownAnimations(); } catch {}
    try { window.__cleanupActiveWatch.(); } catch {}
    try { window.cleanupModalObserver.(); } catch {}
    try { stopSlideTimer.(); } catch {}
    try { hardProgressReset.(); } catch {}
    try { fullSliderReset({ reason: "scheduleSliderRebuild:" + (reason) }); } catch {}
    document.querySelectorAll(".monwui-dot-navigation-container").forEach(function(n) n.remove());
    new Promise(function(r) setTimeout(r, 30));
    window.__initOnHomeOnce = false;
    initializeSliderOnHome({ forceManagedSectionsBoot: true });
  } finally {
    window.__rebuildingSlider = false;
  }
}

function getSlidesNodeList() {
  var idxPage = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
  return idxPage ? idxPage.querySelectorAll(".monwui-slide") : null;
}
function getSlideIndex(el) {
  var slides = getSlidesNodeList();
  return slides ? Array.from(slides).indexOf(el) : -1;
}
function getTotalSlides() {
  var slides = getSlidesNodeList();
  return slides ? slides.length : 0;
}
function isLastIndex(i) {
  var total = getTotalSlides();
  return total > 0 && i === total - 1;
}

function getSlideDurationMs() {
  var pb = document.querySelector(".monwui-slide-progress-bar");
  if (pb) {
    var raw = getComputedStyle(pb).getPropertyValue("--slide-duration-ms");
    var v = parseInt(raw, 10);
    if (Number.isFinite(v) && v > 0) return v;
    var td = getComputedStyle(pb).transitionDuration;
    if (td && td.endsWith("s")) {
      var sec = parseFloat(td);
      if (sec > 0) return Math.round(sec * 1000);
    }
  }

  if (config && Number.isFinite(config.autoSlideIntervalMs)) return config.autoSlideIntervalMs;
  if (config && Number.isFinite(config.slideDurationMs)) return config.slideDurationMs;
  return 15000;
}

(function applySafePauseShim() {
  try {
    if (window.__safePauseShim) return;
    window.__safePauseShim = true;
    var EP = window.Element && window.Element.prototype;
    if (!EP) return;
    if (!("pause" in EP)) {
      Object.defineProperty(EP, "pause", {
        value: function pause() {},
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  } catch (err) {
    console.warn("safePauseShim init error:", err);
  }
})();

var config = getConfig();
syncProfileChooserHeaderButtonVisibility(config.enableProfileChooser !== false);

function getMainConfig() {
  try {
    return (typeof getConfig === "function" ? getConfig() : config) || config || {};
  } catch {
    return config || {};
  }
}

function shouldRenderPersonalRecommendationUi(cfg = getMainConfig()) {
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  return !!(
    homeSectionsConfig.enablePersonalRecommendations ||
    homeSectionsConfig.enableGenreHubs ||
    homeSectionsConfig.enableBecauseYouWatched
  );
}

function shouldRenderDirectorRowsUi(cfg = getMainConfig()) {
  return getHomeSectionsRuntimeConfig(cfg).enableDirectorRows;
}

function shouldRenderRecentRowsUi(cfg = getMainConfig()) {
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(cfg);
  return !!(
    homeSectionsConfig.enableRecentRows ||
    homeSectionsConfig.enableTop10SeriesRowsSection ||
    homeSectionsConfig.enableTop10MovieRowsSection ||
    homeSectionsConfig.enableTmdbTopMoviesRowsSection ||
    homeSectionsConfig.enableContinueMovies ||
    homeSectionsConfig.enableContinueSeries ||
    homeSectionsConfig.enableNextUpRowsSection ||
    homeSectionsConfig.enableOtherLibRows
  );
}

function shouldRenderStudioHubsUi(cfg = getMainConfig()) {
  return getHomeSectionsRuntimeConfig(cfg).enableStudioHubs;
}

function getPauseRuntimeConfig(cfg = getMainConfig()) {
  return getPauseFeaturesRuntimeConfig(cfg);
}

function shouldBootPauseModule(cfg = getMainConfig()) {
  var pauseConfig = getPauseRuntimeConfig(cfg);
  return !!(pauseConfig.enablePauseOverlay || pauseConfig.enableSmartAutoPause);
}

function shouldBootPauseOsdHeaderRatings(cfg = getMainConfig()) {
  return getPauseRuntimeConfig(cfg).enablePauseOsdHeaderRatings;
}

function isSliderEnabled() {
  try {
    var cfg = getMainConfig();
    return cfg.enableSlider !== false;
  } catch {
    return true;
  }
}

var cleanupPauseOverlay = null;
var pauseModulePromise = null;
var pauseBooted = false;
var cleanupSubtitleCustomizer = null;
var subtitleCustomizerBooted = false;
var subtitleCustomizerModulePromise = null;
var cleanupOsdHeaderRatings = null;
var osdHeaderRatingsBooted = false;
var osdHeaderRatingsModulePromise = null;
var navObsBooted = false;
window.sliderResetInProgress = window.sliderResetInProgress || false;
window.__slidesInitRunning = window.__slidesInitRunning || false;

function loadPauseModule() {
  if (!pauseModulePromise) {
    pauseModulePromise = import("./modules/moduloPausa.js");
  }
  return pauseModulePromise;
}

function loadSubtitleCustomizerModule() {
  if (!subtitleCustomizerModulePromise) {
    subtitleCustomizerModulePromise = import("./modules/subtitleCustomizer.js");
  }
  return subtitleCustomizerModulePromise;
}

function loadOsdHeaderRatingsModule() {
  if (!osdHeaderRatingsModulePromise) {
    osdHeaderRatingsModulePromise = import("./modules/osdHeaderRatings.js");
  }
  return osdHeaderRatingsModulePromise;
}

function destroyPauseOverlay() {
  if (cleanupPauseOverlay) {
    try {
      cleanupPauseOverlay();
    } catch {}
  }
  cleanupPauseOverlay = null;
  pauseBooted = false;
  try {
    window.__jmsPauseOverlay.destroy.();
  } catch {}
}

function destroySubtitleCustomizer() {
  if (cleanupSubtitleCustomizer) {
    try {
      cleanupSubtitleCustomizer();
    } catch {}
  }
  cleanupSubtitleCustomizer = null;
  subtitleCustomizerBooted = false;
  try {
    window.cleanupSubtitleCustomizer = null;
  } catch {}
}

function destroyOsdHeaderRatings() {
  if (cleanupOsdHeaderRatings) {
    try {
      cleanupOsdHeaderRatings();
    } catch {}
  }
  cleanupOsdHeaderRatings = null;
  osdHeaderRatingsBooted = false;
  try {
    window.__jmsOsdHeaderRatings.destroy.();
  } catch {}
  try {
    window.cleanupOsdHeaderRatings = null;
  } catch {}
}

function startPauseOverlayOnce() {
  if (!shouldBootPauseModule()) {
    destroyPauseOverlay();
    return false;
  }
  if (pauseBooted) return true;

  pauseBooted = true;
  try {
    var mod = loadPauseModule();
    if (!shouldBootPauseModule()) {
      pauseBooted = false;
      return false;
    }
    cleanupPauseOverlay = mod.setupPauseScreen.() || null;
    return true;
  } catch (e) {
    pauseBooted = false;
    console.warn("startPauseOverlayOnce hata:", e);
    return false;
  }
}

function restartPauseOverlay() {
  destroyPauseOverlay();
  return startPauseOverlayOnce();
}

function refreshSubtitleCustomizer() {
  if (!isSubtitleCustomizerModuleEnabled(getMainConfig())) {
    destroySubtitleCustomizer();
    return false;
  }
  if (subtitleCustomizerBooted) return true;

  subtitleCustomizerBooted = true;
  try {
    var mod = loadSubtitleCustomizerModule();
    if (!isSubtitleCustomizerModuleEnabled(getMainConfig())) {
      subtitleCustomizerBooted = false;
      return false;
    }
    cleanupSubtitleCustomizer = mod.initSubtitleCustomizer.() || null;
    window.cleanupSubtitleCustomizer = cleanupSubtitleCustomizer;
    return true;
  } catch (e) {
    subtitleCustomizerBooted = false;
    console.warn("refreshSubtitleCustomizer hata:", e);
    return false;
  }
}

function refreshPauseOsdHeaderRatings({ force = false } = {}) {
  if (!shouldBootPauseOsdHeaderRatings()) {
    destroyOsdHeaderRatings();
    return false;
  }
  if (osdHeaderRatingsBooted && !force) return true;

  destroyOsdHeaderRatings();
  osdHeaderRatingsBooted = true;
  try {
    var mod = loadOsdHeaderRatingsModule();
    if (!shouldBootPauseOsdHeaderRatings()) {
      osdHeaderRatingsBooted = false;
      return false;
    }
    cleanupOsdHeaderRatings = mod.initOsdHeaderRatings.() || null;
    window.cleanupOsdHeaderRatings = cleanupOsdHeaderRatings;
    return true;
  } catch (e) {
    osdHeaderRatingsBooted = false;
    console.warn("refreshPauseOsdHeaderRatings hata:", e);
    return false;
  }
}

function refreshOptionalModules({ forcePause = false } = {}) {
  var tasks = [
    refreshSubtitleCustomizer(),
    forcePause ? restartPauseOverlay() : startPauseOverlayOnce(),
    refreshPauseOsdHeaderRatings({ force: forcePause })
  ];

  var results = Promise.allSettled(tasks);
  try {
    window.__jmsQueueFeatureCssSync.();
  } catch {}
  return results;
}

var shuffleArray = function(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

function isHomeRouteActive() {
  var hash = String(window.location.hash || "").toLowerCase().trim();
  return hash.startsWith("#/home") || hash.startsWith("#/index") || hash === "" || hash === "#";
}

function getVisibleHomePageEl() {
  return document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
}

function getVisibleHomeSectionsContainerEl(page = getVisibleHomePageEl()) {
  var container = page.querySelector.(".homeSectionsContainer");
  return container.isConnected ? container : null;
}

function hasVisibleHomePage() {
  return !!getVisibleHomePageEl();
}

function isHomeVisible() {
  return hasVisibleHomePage() && isHomeRouteActive();
}

function ensureLayerPropertySanitizer() {
  if (window.__jmsLayerSanitizerReady) return;
  window.__jmsLayerSanitizerReady = true;

  var root = document.documentElement;
  var CLASS_NAME = "jms-layer-sanitized";
  var STYLE_ID = "jms-layer-sanitizer-css";

  var nonPeakSliderTargets = [
    "#monwui-slides-container",
    "#monwui-slides-container .monwui-slide",
    "#monwui-slides-container .monwui-bckdrp-cntnr",
    "#monwui-slides-container .monwui-backdrop",
    "#monwui-slides-container .monwui-horizontal-gradient-overlay",
    "#monwui-slides-container .monwui-horizontal-gradient-overlay:before",
    "#monwui-slides-container .monwui-horizontal-gradient-overlay:after",
    "#monwui-slides-container .monwui-logo-container",
    "#monwui-slides-container .monwui-logo-container .logo-img",
    "#monwui-slides-container .monwui-title-container",
    "#monwui-slides-container .monwui-plot-container",
    "#monwui-slides-container .monwui-provider-container",
    "#monwui-slides-container .monwui-info-container",
    "#monwui-slides-container .monwui-language-container",
    "#monwui-slides-container .monwui-status-container",
    "#monwui-slides-container .monwui-meta-container",
    "#monwui-slides-container .monwui-slider-wrapper",
    "#monwui-slides-container .monwui-button-container",
    "#monwui-slides-container .monwui-button-container *",
    "#monwui-slides-container .monwui-dot-navigation-container",
    "#monwui-slides-container .monwui-dot",
    "#monwui-slides-container .monwui-poster-dot",
    "#monwui-slides-container img.monwui-dot-poster-image"
  ];

  var pluginSurfaceTargets = [
    ".video-preview-modal",
    ".video-preview-modal *",
    ".mini-poster-popover",
    ".mini-poster-popover *",
    ".mini-trailer-popover",
    ".mini-trailer-popover *",
    ".genre-explorer-overlay",
    ".genre-explorer",
    ".genre-explorer *",
    ".ge-card",
    ".ge-card *",
    "#jms-details-modal-root",
    "#jms-details-modal-root *",
    "#studio-hubs",
    "#studio-hubs *",
    ".hub-preview-popover",
    ".hub-preview-popover *",
    "#jms-pause-overlay",
    "#jms-pause-overlay *",
    "#jms-reco-panel",
    "#jms-reco-panel *",
    "#jms-reco-badge",
    "#jms-reco-badge *",
    ".rating-genre-overlay",
    ".rating-genre-overlay *",
    ".rating-icons-overlay",
    ".rating-icons-overlay *",
    ".jms-cast-modal",
    ".jms-cast-modal *",
    ".jms-cast-slide",
    ".jms-cast-slide *",
    ".gmmp-radio-modal",
    ".gmmp-radio-modal *",
    "#modern-music-player",
    "#modern-music-player *",
    "#player-lyrics-container",
    "#player-lyrics-container *",
    ".jellyfin-playlist-modal",
    ".jellyfin-playlist-modal *",
    ".playlistselect-modal",
    ".playlistselect-modal *",
    ".top-tracks-modal",
    ".top-tracks-modal *"
  ];

  var nativeHomeCardTargets = [
    "#indexPage:not(.hide) .itemsContainer .cardBox",
    "#indexPage:not(.hide) .itemsContainer .cardBox *",
    "#indexPage:not(.hide) .itemsContainer .cardScalable",
    "#indexPage:not(.hide) .itemsContainer .cardScalable *",
    "#indexPage:not(.hide) .itemsContainer .cardOverlayContainer",
    "#indexPage:not(.hide) .itemsContainer .cardOverlayContainer *",
    "#indexPage:not(.hide) .itemsContainer .cardImageContainer",
    "#indexPage:not(.hide) .itemsContainer .cardImageContainer *",
    "#indexPage:not(.hide) .itemsContainer .cardText",
    "#indexPage:not(.hide) .itemsContainer .cardText *",
    "#homePage:not(.hide) .itemsContainer .cardBox",
    "#homePage:not(.hide) .itemsContainer .cardBox *",
    "#homePage:not(.hide) .itemsContainer .cardScalable",
    "#homePage:not(.hide) .itemsContainer .cardScalable *",
    "#homePage:not(.hide) .itemsContainer .cardOverlayContainer",
    "#homePage:not(.hide) .itemsContainer .cardOverlayContainer *",
    "#homePage:not(.hide) .itemsContainer .cardImageContainer",
    "#homePage:not(.hide) .itemsContainer .cardImageContainer *",
    "#homePage:not(.hide) .itemsContainer .cardText",
    "#homePage:not(.hide) .itemsContainer .cardText *"
  ];

  var sanitizeRule = "\n    contain: none !important;\n    content-visibility: visible !important;\n    contain-intrinsic-size: auto !important;\n    will-change: auto !important;\n    backface-visibility: visible !important;\n    -webkit-backface-visibility: visible !important;\n  ";

  var scoped = function(selectors, prefix)
    selectors.mapfunction((selector) (prefix) + " " + (selector)).join(",\n");

  var injectStyle = function() {
    if (!document.head || document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = "\n      ${scoped(nonPeakSliderTargets, "html.${CLASS_NAME}:not([data-css-variant=peakslider])")} {\n        " + (sanitizeRule) + "\n      }\n\n      ${scoped(pluginSurfaceTargets, "html.${CLASS_NAME}")} {\n        " + (sanitizeRule) + "\n      }\n\n      ${scoped(nativeHomeCardTargets, "html.${CLASS_NAME}")} {\n        " + (sanitizeRule) + "\n      }\n      html." + (CLASS_NAME) + " [dir=ltr] .dir-row-hero .cardBox,\n      html." + (CLASS_NAME) + " [dir=ltr] .personal-recs-card .cardBox {\n        margin-left: 0 !important;\n        margin-right: 1.2em !important;\n      }\n    ";
    document.head.appendChild(st);
  };

  root.classList.add(CLASS_NAME);

  if (document.head) {
    injectStyle();
  } else {
    document.addEventListener("DOMContentLoaded", injectStyle, { once: true });
  }
}

ensureLayerPropertySanitizer();

function uniqueByIdStable(arr) {
  var seen = new Set();
  var out = [];
  for (var it of arr) {
    var id = it && (it.Id || it.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

function mapLimit(arr, limit, mapper) {
  var list = Array.isArray(arr) ? arr : [];
  var out = new Array(list.length);
  var i = 0;
  var workers = new Array(Math.max(1, limit | 0)).fill(0).mapfunction(() {
    while (i < list.length) {
      var idx = i++;
      try {
        out[idx] = mapper(list[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  Promise.all(workers);
  return out;
}

function setupGlobalModalInit() {
  whenFirstSlideReadyOrTimeoutfunction(() {
    queueHoverModuleBoot();
  }, 2500);
  var observer = observeDOMChanges();
  return function() observer.disconnect();
}
var cleanupModalObserver = setupGlobalModalInit();
window.cleanupModalObserver = cleanupModalObserver;

function runNonCriticalUiBootOnce() {
  if (window.__jmsNonCriticalBooted) return;
  window.__jmsNonCriticalBooted = true;

  whenFirstSlideReadyOrTimeoutfunction(() {
    idlefunction(() {
      try {
        if (!window.cleanupProfileChooser) {
          window.cleanupProfileChooser = initProfileChooser();
        }
      } catch {}

      try {
        if (!window.cleanupAvatarSystem) {
          window.cleanupAvatarSystem = initAvatarSystem();
        }
      } catch {}

      try {
        var liveCfg = getMainConfig();
        if (liveCfg.enableNotifications !== false) {
          bootNotificationsOnce();
        } else {
          document.getElementById("jfNotifBtn").remove();
          document.getElementById("jfNotifModal").remove();
          document.querySelector(".jf-notif-panel").remove();
          document.documentElement.dataset.jmsNotif = "0";
        }
      } catch {}

      if (config.enableQualityBadges && !window.__qualityBadgesBooted) {
        window.__qualityBadgesBooted = true;
        try { window.cleanupQualityBadges = initializeQualityBadges(); } catch {}
      }

    });
  }, 7000);
}

forceSkinHeaderPointerEvents();
forceHomeSectionsTop();
var cleanupAvatarPicker = initUserProfileAvatarPicker();
window.cleanupAvatarPicker = cleanupAvatarPicker;
window.__jmsRefreshOptionalModules = function(options = {}) {
  return refreshOptionalModules(options);
};
void refreshOptionalModules();

var NOTIF_ENABLED = getMainConfig().enableNotifications !== false;
try {
  if (!window.cleanupProfileChooser) {
    window.cleanupProfileChooser = initProfileChooser();
  }
} catch {}

if (!NOTIF_ENABLED) {
  document.documentElement.dataset.jmsNotif = "0";
}

document.addEventListenerfunction("DOMContentLoaded", () {
  if (config.enableQualityBadges && !window.__qualityBadgesBooted) {
    window.__qualityBadgesBooted = true;
    try {
      window.cleanupQualityBadges = initializeQualityBadges();
    } catch {}
  }
});

window.__recsRebuildTimer = window.__recsRebuildTimer || null;
window.__jmsIndexerRetryTimer = window.__jmsIndexerRetryTimer || null;
window.__jmsIndexerRetryInFlight = window.__jmsIndexerRetryInFlight || false;
window.__jmsIndexerAutoStartTimer = window.__jmsIndexerAutoStartTimer || null;
window.__jmsIndexerAutoStartReady = window.__jmsIndexerAutoStartReady || false;
window.__jmsIndexerAutoStartPending = window.__jmsIndexerAutoStartPending || false;

function fullSliderReset({ preserveHomeSections = true, invalidateBoot = true, reason = "fullSliderReset" } = {}) {
  homeSectionTrace("fullSliderReset:start", {
    reason,
    preserveHomeSections,
    invalidateBoot,
  });
  try { teardownAnimations(); } catch {}
  forceSkinHeaderPointerEvents();
  forceHomeSectionsTop();
  if (invalidateBoot) {
    invalidateSliderBootSession();
  }

  if (window.intervalChangeSlide) {
    clearInterval(window.intervalChangeSlide);
    window.intervalChangeSlide = null;
  }
  if (window.sliderTimeout) {
    clearTimeout(window.sliderTimeout);
    window.sliderTimeout = null;
  }
  if (window.autoSlideTimeout) {
    clearTimeout(window.autoSlideTimeout);
    window.autoSlideTimeout = null;
  }

  setCurrentIndex(0);
  stopSlideTimer();
  try { window.__cleanupActiveWatch.(); } catch {}
  window.__cleanupActiveWatch = null;
  clearQueuedHomeSectionsBoot();
  cleanupSlider({
    preserveHomeSections,
    invalidateBoot: false,
    reason: (reason) + ":cleanupSlider",
  });
  clearCycleArm();
  try { window.__peakBooting = true; } catch {}
  window.__jmsFirstSlideReady = false;
  window.__cycleStartAt = 0;
  window.__cycleExpired = false;
  window.mySlider = {};
  try { delete window.__recsWiresBooted; } catch {}
}

function extractItemTypesFromQuery(query) {
  var match = query.match(/IncludeItemTypes=([^&]+)/i);
  if (!match) return [];
  return match[1].split(",").mapfunction((t) t.trim());
}
function hasAllTypes(targetTypes, requiredTypes) {
  return requiredTypes.everyfunction((t) targetTypes.includes(t));
}

function parseImageTypesFromQuery(query) {
  if (!query) return [];
  var m = query.match(/(?:^|[?&])imageTypes=([^&]+)/i);
  if (!m) return [];
  return decodeURIComponent(m[1])
    .split(",")
    .mapfunction((t) t.trim())
    .filter(Boolean);
}

function itemHasImageType(item, type) {
  if (!item) return false;
  var tags = item.ImageTags || {};
  var lower = String(type).toLowerCase();
  if (lower === "logo") {
    return !!(tags.Logo || tags.Logotype);
  }

  if (lower === "backdrop") {
    var b = item.BackdropImageTags || [];
    if (Array.isArray(b) && b.length > 0) return true;
    return !!tags.Backdrop;
  }

  var key =
    type in tags
      ? type
      : type.charAt(0).toUpperCase() + type.slice(1);
  return !!tags[key];
}

function filterByStrictImageTypes(items, query) {
  var requested = parseImageTypesFromQuery(query);
  if (!requested.length) return items;
  return items.filterfunction((it)
    requested.everyfunction((t) itemHasImageType(it, t))
  );
}

function observeDOMChanges() {
  var scheduled = false;
  var scheduleHoverRefresh = function() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFramefunction(() {
      scheduled = false;
      queueHoverModuleBoot();
    });
  };

  var observer = new MutationObserverfunction((mutations) {
    if (document.documentElement.dataset.jmsSoftBlock === "1") return;
    var hasRelevantAddition = mutations.somefunction((mutation) {
      if (!mutation.addedNodes.length) return false;
      return Array.from(mutation.addedNodes).somefunction((node) {
        if (node.nodeType !== 1) return false;
        if (node.classList.contains("cardImageContainer")) return true;
        return !!node.querySelector.(".cardImageContainer");
      });
    });

    if (hasRelevantAddition) {
      scheduleHoverRefresh();
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  return observer;
}

function hydrateSlideMedia(slideEl) {
  if (!slideEl) return;
  slideEl
    .querySelectorAll("img[data-src],img[data-lazy],img[data-original],img[data-image]")
    .forEach(function((img) {
      var src =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy") ||
        img.getAttribute("data-original") ||
        img.getAttribute("data-image");
      if (src && !img.src) {
        img.src = src;
        img.removeAttribute("data-src");
        img.removeAttribute("data-lazy");
        img.removeAttribute("data-original");
        img.removeAttribute("data-image");
      }
    });
  slideEl.querySelectorAll("[data-backdrop],[data-bg],[data-bg-src]").forEach(function((el) {
    var u = el.getAttribute("data-backdrop") || el.getAttribute("data-bg") || el.getAttribute("data-bg-src");
    if (u && !el.style.backgroundImage) el.style.backgroundImage = "url(\"" + (u) + "\")";
  });
  slideEl.style.visibility = "visible";
  slideEl.removeAttribute("aria-hidden");
  slideEl.style.opacity = "";
  slideEl.style.filter = "";
  slideEl.style.display = "";
  slideEl.classList.remove("lazyloaded", "lazyload");
  slideEl.classList.remove("is-loading", "hidden", "hide");
}

function safeRaf(fn) {
  return requestAnimationFramefunction(() requestAnimationFrame(fn));
}
function debounce(fn, wait = 150) {
  var t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeoutfunction(() fn(...args), wait);
  };
}

function resolveSlidesContainerTopAnchor(indexPage) {
  var deepAnchor = indexPage.querySelector.(".homeSectionsContainer");
  var anchorTop = null;
  if (deepAnchor) {
    var cur = deepAnchor;
    while (cur && cur.parentElement && cur.parentElement !== indexPage) {
      cur = cur.parentElement;
    }
    if (cur && cur.parentElement === indexPage) {
      anchorTop = cur;
    }
  }
  return anchorTop;
}

function placeSlidesContainerAtTop(indexPage, container) {
  if (!indexPage || !container) return container || null;

  if (container.parentElement && container.parentElement !== indexPage) {
    try { container.parentElement.removeChild(container); } catch {}
  }

  var anchorTop = resolveSlidesContainerTopAnchor(indexPage);

  if (anchorTop) {
    indexPage.insertBefore(container, anchorTop);
  } else if (indexPage.firstElementChild !== container) {
    if (indexPage.firstElementChild) {
      indexPage.insertBefore(container, indexPage.firstElementChild);
    } else {
      indexPage.appendChild(container);
    }
  } else if (container.parentElement !== indexPage) {
    indexPage.appendChild(container);
  }

  return container;
}

function scheduleNativeAwareSlidesPlacement(indexPage, container) {
  if (!indexPage.isConnected || !container) return;

  var nextToken = (Number(container.dataset.jmsSliderPlacementToken || 0) || 0) + 1;
  container.dataset.jmsSliderPlacementToken = String(nextToken);

  Promise.resolve().thenfunction(() {
    var host = waitForVisibleHomeSections({ timeout: 1800 }).catchfunction(() null);
    var page = host.page || indexPage;
    var homeSections = host.container || page.querySelector.(".homeSectionsContainer") || null;

    if (!page.isConnected || page !== indexPage) return;
    if (!container.isConnected) return;
    if (String(container.dataset.jmsSliderPlacementToken || "") !== String(nextToken)) return;

    if (homeSections.isConnected) {
      try {
        waitForNativeHomeSectionStability(homeSections, {
          timeoutMs: 1800,
          stableMs: 220,
          minVisibleCount: 1,
        });
      } catch {}
    }

    if (!indexPage.isConnected || !container.isConnected) return;
    if (String(container.dataset.jmsSliderPlacementToken || "") !== String(nextToken)) return;

    placeSlidesContainerAtTop(indexPage, container);
    try {
      updateSlidePosition();
    } catch {}
  });
}

function upsertSlidesContainerAtTop(indexPage) {
  if (!indexPage) return null;
  var c = indexPage.querySelector("#monwui-slides-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "monwui-slides-container";
  } else {
    if (c.parentElement) c.parentElement.removeChild(c);
  }

  placeSlidesContainerAtTop(indexPage, c);
  scheduleNativeAwareSlidesPlacement(indexPage, c);
  try {
    updateSlidePosition();
  } catch {}
  return c;
}

function waitForVisibleIndexPage(timeout = 20000) {
  var candidates = [
    "#indexPage:not(.hide) .homeSectionsContainer",
    "#homePage:not(.hide) .homeSectionsContainer",
    "#indexPage:not(.hide)",
    "#homePage:not(.hide)"
  ];
  return waitForAnyVisible(candidates, { timeout });
}

function isAbs(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

function normalizeWithServer(u) {
  var s = String(u || "").trim();
  if (!s) return s;
  if (isAbs(s)) return s;
  if (s.startsWith("/slider/")) return withServer("/web" + s);
  if (s.startsWith("slider/"))  return withServer("/web/" + s);
  if (s.startsWith("/web/")) return withServer(s);
  if (s.startsWith("/")) return withServer(s);
  return s;
}

function requiresAuthRequest(url = "") {
  try {
    var input = String(url || "");
    var path = /^https?:\/\//i.test(input) ? new URL(input).pathname : input;
    return /\/Users\/|\/Sessions\b|\/Items\/[^/]+\/PlaybackInfo\b|\/Videos\//i.test(path);
  } catch {
    return true;
  }
}

function withApiKeyIfNeeded(url, token) {
  var raw = String(url || "").trim();
  var apiKey = String(token || "").trim();
  if (!raw || !apiKey || !requiresAuthRequest(raw)) return raw;

  try {
    var u = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw, window.location.origin);
    if (!u.searchParams.get("api_key")) {
      u.searchParams.set("api_key", apiKey);
    }
    return /^https?:\/\//i.test(raw)
      ? u.toString()
      : (u.pathname) + (u.search) + (u.hash);
  } catch {
    var sep = raw.includes("?") ? "&" : "?";
    return raw.includes("api_key=") ? raw : (raw) + (sep) + "api_key=" + (encodeURIComponent(apiKey));
  }
}

function buildSafeFetchHeaders(url, incomingHeaders) {
  var headers = new Headers(incomingHeaders || {});
  if (!requiresAuthRequest(url)) return headers;

  var session = (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
  var token = String(session.accessToken || getAuthToken() || "").trim();
  var userId = String(session.userId || "").trim();
  var authHeader = String((typeof getAuthHeader === "function" ? getAuthHeader() : "") || "").trim();

  if (!String(headers.get("Authorization") || "").trim() && authHeader) {
    headers.set("Authorization", authHeader);
  }

  if (!String(headers.get("X-Emby-Token") || "").trim() && token) {
    headers.set("X-Emby-Token", token);
  }
  if (!String(headers.get("X-Emby-UserId") || "").trim() && userId) {
    headers.set("X-Emby-UserId", userId);
  }

  return headers;
}

function safeFetch(url, opts = {}) {
  var normalizedUrl = normalizeWithServer(url);
  if (requiresAuthRequest(normalizedUrl)) {
    if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) {
      try { waitForAuthReadyStrict(5000); } catch {}
    }

    var session = (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
    var token = String(session.accessToken || getAuthToken() || "").trim();
    if (!token) {
      var err = new Error("Auth not ready for " + (url));
      err.status = 0;
      throw err;
    }
    var finalUrl = withApiKeyIfNeeded(normalizedUrl, token);
    return fetch(finalUrl, {
      ...opts,
      credentials: opts.credentials || "same-origin",
      headers: buildSafeFetchHeaders(finalUrl, opts.headers)
    });
  }

  return fetch(normalizedUrl, {
    ...opts,
    credentials: opts.credentials || "same-origin",
    headers: buildSafeFetchHeaders(normalizedUrl, opts.headers)
  });
}

function fetchJsonViaSafeFetch(url, opts){
  var res = safeFetch(url, opts);
  if (!res.ok) throw new Error("HTTP " + (res.status) + " for " + (url));
  return res.json();
}

function looksLikeUrl(v) {
  return typeof v === "string" && (v.startsWith("http") || v.startsWith("/") || v.includes("/Items/"));
}

function setBg(el, url) {
  if (!el || !url) return;
  var wrapped = "url(\"" + (url) + "\")";
  el.style.setProperty("--bg-url", wrapped);
  if (!el.style.backgroundImage || !el.style.backgroundImage.includes(url)) {
    el.style.backgroundImage = wrapped;
  }
  if (!el.style.backgroundSize) el.style.backgroundSize = "cover";
  if (!el.style.backgroundPosition) el.style.backgroundPosition = "50% 50%";
}

function hydrateFirstSlide(indexPage) {
  if (!indexPage) return;
  var firstActive = indexPage.querySelector(".monwui-slide.active") || indexPage.querySelector(".monwui-slide");
  if (!firstActive) return;

  firstActive.style.visibility = "visible";
  firstActive.removeAttribute("aria-hidden");
  firstActive.style.opacity = "";
  firstActive.classList.remove("is-loading", "hidden", "hide", "lazyload", "lazyloaded");

  var imgs = firstActive.querySelectorAll("img, picture img");
  imgs.forEach(function((img) {
    var ds = img.getAttribute("data-src");
    if (ds && img.src !== ds) img.src = ds;
    var dss = img.getAttribute("data-srcset");
    if (dss && img.srcset !== dss) img.srcset = dss;
    if (img.loading === "lazy") img.loading = "eager";
    img.removeAttribute("loading");
    img.style.visibility = "visible";
    img.style.opacity = "";
  });

  var sources = firstActive.querySelectorAll("source");
  sources.forEach(function((s) {
    var dss = s.getAttribute("data-srcset");
    if (dss && s.srcset !== dss) s.srcset = dss;
  });

  var bgCandidates = [
    firstActive.querySelector(".monwui-horizontal-gradient-overlay"),
    firstActive.querySelector(".monwui-slide-backdrop"),
    firstActive.querySelector(".monwui-backdrop"),
    firstActive.querySelector(".background"),
    firstActive,
  ].filter(Boolean);

  var urlFromDataset = "";
  var ds = firstActive.dataset || {};
  for (var [k, v] of Object.entries(ds)) {
    if (looksLikeUrl(v)) {
      urlFromDataset = v;
      break;
    }
  }
  var attrKeys = ["data-bg", "data-backdrop", "data-bg-src", "data-image", "data-poster", "data-img", "data-src"];
  var urlFromAttr = "";
  for (var key of attrKeys) {
    var v = firstActive.getAttribute(key);
    if (looksLikeUrl(v)) {
      urlFromAttr = v;
      break;
    }
  }
  var finalUrl = urlFromDataset || urlFromAttr;
  bgCandidates.forEach(function((el) setBg(el, finalUrl));
}

function primeProgressBar(indexPage) {
  if (!indexPage) return;
  var pb = document.querySelector(".monwui-slide-progress-bar");
  if (!pb) return;
  try {
    resetProgressBar.();
  } catch {}
  pb.style.transition = "none";
  pb.style.opacity = "0";
  pb.style.width = "0%";
  void pb.offsetWidth;
  pb.style.transition = "";
}

function ensureInitialActivation(indexPage) {
  if (!indexPage) return;
  var slides = indexPage.querySelectorAll(".monwui-slide");
  if (!slides.length) return;
  var cur = getCurrentIndex();
  var idx = Number.isFinite(cur) && cur >= 0 ? cur : 0;
  setCurrentIndex(idx);
  slides.forEach(function((s, i) s.classList.toggle("active", i === idx));
}

function triggerSlideEnterHooks(indexPage) {
  var active = indexPage.querySelector(".monwui-slide.active") || indexPage.querySelector(".monwui-slide");
  if (!active) return;
  try {
    active.dispatchEvent(new CustomEvent("jms:slide-enter", { bubbles: true }));
  } catch {}
}

function repairVisibleSliderLayout({ forcePrime = false } = {}) {
  if (document.hidden) return;
  var indexPage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return;

  var slides = Array.from(indexPage.querySelectorAll(".monwui-slide"));
  if (!slides.length) return;

  var cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
  var isPeak = !!cfg.peakSlider;
  var slidesContainer = indexPage.querySelector("#monwui-slides-container");
  var safeIndex = Math.min(
    Math.max(Number(getCurrentIndex()) || 0, 0),
    Math.max(0, slides.length - 1)
  );

  setCurrentIndex(safeIndex);

  if (slidesContainer) {
    slidesContainer.classList.remove("peak-shifting");
    if (isPeak) {
      slidesContainer.classList.add("peak-mode");
      if (forcePrime) {
        slidesContainer.classList.remove("peak-ready");
        slidesContainer.classList.add("peak-init");
        try { delete slidesContainer.dataset.peakPrimed; } catch {}
      }
    } else {
      slidesContainer.classList.remove("peak-mode", "peak-ready", "peak-init");
      try { delete slidesContainer.dataset.peakPrimed; } catch {}
    }
  }

  slides.forEach(function((slideEl, index) {
    try { hardCleanupSlide(slideEl); } catch {}
    slideEl.classList.remove("peak-batch-pending", "peak-snap-in");
    slideEl.style.removeProperty("left");
    slideEl.style.removeProperty("top");

    var active = index === safeIndex;
    slideEl.classList.toggle("active", active);

    if (isPeak) {
      slideEl.classList.remove("is-hidden");
      slideEl.style.removeProperty("display");
      slideEl.style.removeProperty("opacity");
      return;
    }

    slideEl.classList.toggle("is-visible", active);
    slideEl.classList.toggle("is-hidden", !active);
    if (active) {
      slideEl.style.removeProperty("display");
      slideEl.style.removeProperty("opacity");
    } else {
      slideEl.style.opacity = "0";
      slideEl.style.display = "none";
    }
  });

  hydrateFirstSlide(indexPage);
  try { updateSlidePosition(); } catch {}

  if (isPeak) {
    try { syncPeakStructureNow(indexPage, { forcePrime: forcePrime || !slidesContainer.classList.contains("peak-ready") }); } catch {}
  }

  try { updateProgressBarPosition(); } catch {}
  triggerSlideEnterHooks(indexPage);
}

var __sliderRepairRafA = 0;
var __sliderRepairRafB = 0;
var __sliderRepairForcePrime = false;

function cancelPendingSliderRepair() {
  if (__sliderRepairRafA) cancelAnimationFrame(__sliderRepairRafA);
  if (__sliderRepairRafB) cancelAnimationFrame(__sliderRepairRafB);
  __sliderRepairRafA = 0;
  __sliderRepairRafB = 0;
}

function scheduleVisibleSliderRepair({ forcePrime = false } = {}) {
  if (document.hidden) return;
  __sliderRepairForcePrime = __sliderRepairForcePrime || !!forcePrime;
  cancelPendingSliderRepair();
  __sliderRepairRafA = requestAnimationFramefunction(() {
    __sliderRepairRafA = 0;
    __sliderRepairRafB = requestAnimationFramefunction(() {
      __sliderRepairRafB = 0;
      var doForcePrime = __sliderRepairForcePrime;
      __sliderRepairForcePrime = false;
      repairVisibleSliderLayout({ forcePrime: doForcePrime });
    });
  });
}

function shouldRepairVisibleSliderOnRestore({ forcePrime = false } = {}) {
  if (document.hidden) return false;

  var indexPage =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return false;

  var slidesContainer = indexPage.querySelector("#monwui-slides-container");
  if (!slidesContainer || !isVisible(slidesContainer)) return false;

  var slides = Array.from(indexPage.querySelectorAll(".monwui-slide"));
  if (!slides.length) return false;

  var safeIndex = Math.min(
    Math.max(Number(getCurrentIndex()) || 0, 0),
    Math.max(0, slides.length - 1)
  );
  var activeSlide = slides[safeIndex] || slides.findfunction((slideEl) slideEl.classList.contains("active")) || slides[0];
  if (!activeSlide) return true;
  if (!activeSlide.classList.contains("active")) return true;

  var activeRect = activeSlide.getBoundingClientRect.();
  if (!activeRect || activeRect.width < 1 || activeRect.height < 1) return true;
  if (activeSlide.classList.contains("is-hidden")) return true;
  if (activeSlide.style.display === "none") return true;

  var cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
  if (!cfg.peakSlider) return false;

  if (!slidesContainer.classList.contains("peak-mode")) return true;
  if (!slidesContainer.classList.contains("peak-ready")) return !!forcePrime;
  if (activeSlide.style.opacity === "0") return true;

  return false;
}

function scheduleVisibleSliderRestoreRepair(options = {}) {
  if (!shouldRepairVisibleSliderOnRestore(options)) return;
  scheduleVisibleSliderRepair(options);
}

function startTimerAndRevealPB(indexPage) {
  if (!indexPage) return;
  var pb = document.querySelector(".monwui-slide-progress-bar");
  startSlideTimer();
  safeRaffunction(() {
    if (pb) pb.style.opacity = "1";
  });
}

function restartSlideTimerDeterministic() {
  console.debug("[JMS] restartSlideTimerDeterministic()");
  hardProgressReset();
   try {
     if (window.intervalChangeSlide) { clearInterval(window.intervalChangeSlide); window.intervalChangeSlide = null; }
     if (window.sliderTimeout)      { clearTimeout(window.sliderTimeout);       window.sliderTimeout = null; }
     if (window.autoSlideTimeout)   { clearTimeout(window.autoSlideTimeout);    window.autoSlideTimeout = null; }
   } catch {}

  try { stopSlideTimer(); } catch {}
   try { startSlideTimer(); } catch {}
}

function watchActiveSlideChanges() {
  var lastActive = document.querySelector("#indexPage:not(.hide) .monwui-slide.active, #homePage:not(.hide) .monwui-slide.active");
  var resetRafA = 0;
  var resetRafB = 0;

  var cancelPendingReset = function() {
    if (resetRafA) cancelAnimationFrame(resetRafA);
    if (resetRafB) cancelAnimationFrame(resetRafB);
    resetRafA = 0;
    resetRafB = 0;
  };

  var hardResetNextFrame = function() {
    cancelPendingReset();
    resetRafA = requestAnimationFramefunction(() {
      resetRafA = 0;
      resetRafB = requestAnimationFramefunction(() {
        resetRafB = 0;
        hardProgressReset();
        restartSlideTimerDeterministic();
        try { warmUpcomingBackdrops(4); } catch {}
      });
    });
  };

  var handleChange = function(ev) {
    var eventSlide = ev.target.closest.('.monwui-slide');
    var cur = eventSlide.classList.contains('active')
      ? eventSlide
      : document.querySelector("#indexPage:not(.hide) .monwui-slide.active, #homePage:not(.hide) .monwui-slide.active");
    if (!cur || cur === lastActive) return;
    lastActive = cur;
    hardResetNextFrame();
  };

  document.addEventListener("slideActive", handleChange, true);
  handleChange();
  return function() {
    cancelPendingReset();
    document.removeEventListener("slideActive", handleChange, true);
  };
}

function warmUpcomingBackdrops(count = 3) {
  try {
    var indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (!indexPage) return;

    var slides = [...indexPage.querySelectorAll(".monwui-slide")];
    var active = indexPage.querySelector(".monwui-slide.active") || slides[0];
    var i = slides.indexOf(active);
    for (var k = 1; k <= count; k++) {
      var s = slides[i + k];
      if (!s) break;
      var candidate =
        s.dataset.background ||
        s.dataset.backdropUrl ||
        s.dataset.landscapeUrl ||
        s.dataset.primaryUrl;
      if (candidate) {
        try {
          window.__backdropWarmQueue.enqueue(candidate, { shortPreload: true });
        } catch {}
      }
    }
  } catch {}
}

export function slidesInit() {
  if (!isSliderEnabled()) {
    console.debug("[JMS] slidesInit() skipped (slider disabled)");
    return;
  }
  if (window.__slidesInitRunning) {
    var runningToken = Number(window.__jmsSlidesInitToken) || 0;
    if (isSliderBootTokenCurrent(runningToken, { requireHomeVisible: false })) {
      console.debug("[JMS] slidesInit() skipped (already running)");
      return;
    }
    window.__slidesInitRunning = false;
  }
  if (!isHomeVisible()) {
    console.debug("[JMS] slidesInit() skipped (home not visible)");
    return;
  }
  var bootToken = beginSliderBootSession();
  window.__jmsSlidesInitToken = bootToken;
  var isBootActive = function({ requireHomeVisible = true, requireContainer = false } = {})
    isSliderBootTokenCurrent(bootToken, { requireHomeVisible, requireContainer });
  window.__slidesInitRunning = true;
  try {
    waitAuthWarmupFallback(5000);
  } catch {}
  if (!isBootActive({ requireHomeVisible: false })) return;
  syncCustomSplashProgress({ authReady: true });
  try {
    forceSkinHeaderPointerEvents();
    forceHomeSectionsTop();

    var activeResetToken = Number(window.__jmsSliderResetToken) || 0;
    if (window.sliderResetInProgress && !isSliderBootTokenCurrent(activeResetToken, { requireHomeVisible: false })) {
      window.sliderResetInProgress = false;
      window.__jmsSliderResetToken = 0;
    }
    if (!isBootActive()) return;
    if (window.sliderResetInProgress) return;
    window.sliderResetInProgress = true;
    window.__jmsSliderResetToken = bootToken;
    fullSliderReset({ invalidateBoot: false, reason: "slidesInit:boot-reset" });

    var userId = null, accessToken = null;
    var fetchItemDetailsCached = window.__jmsFetchItemDetailsCached || null;
    var config = getMainConfig();

    function isQuotaErr(e){ return e && (e.name === 'QuotaExceededError' || e.code === 22); }

    function safeLocalGet(key, fallback="[]"){
      try {
        var localValue = localStorage.getItem(key);
        if (localValue != null) return localValue;
      } catch {}
      try {
        var sessionValue = sessionStorage.getItem(key);
        if (sessionValue != null) return sessionValue;
      } catch {}
      return fallback;
    }

    function safeLocalRemove(key){
      try { localStorage.removeItem(key); } catch {}
    }

    function safeLocalSet(key, value){
      try { localStorage.setItem(key, value); return true; }
      catch(e){
        if(!isQuotaErr(e)) return false;
        try { sessionStorage.setItem(key, value); return true; } catch {}
        try { localStorage.removeItem(key); } catch {}
        return false;
      }
    }

    function getShuffleHistory(userId) {
      var key = "slider-shuffle-history-" + (userId);
      try {
        var raw = safeLocalGet(key, "[]");
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }

    function saveShuffleHistory(userId, ids) {
      var key = "slider-shuffle-history-" + (userId);
      var limit = Math.max(10, parseInt(config.shuffleSeedLimit || "100", 10));
      var arr = Array.from(new Set(ids)).slice(-limit);
      if (safeLocalSet(key, JSON.stringify(arr))) return;
      var cuts = [Math.floor(limit*0.75), Math.floor(limit*0.5), 20, 10];
      for (var n of cuts) {
        arr = arr.slice(-n);
        if (safeLocalSet(key, JSON.stringify(arr))) return;
      }
      safeLocalRemove(key);
    }

    function resetShuffleHistory(userId) {
      var key = "slider-shuffle-history-" + (userId);
      safeLocalRemove(key);
    }

    try {
      if (typeof isAuthReadyStrict === "function" && !isAuthReadyStrict()) {
        waitAuthWarmupFallback(1000);
    }
      var s = getSessionInfo();
      userId = s.userId;
      accessToken = s.accessToken;
    } catch (e) {
      console.error("Não foi possível ler as informações da sessão:", e);
      return;
    }
    if (!isBootActive()) return;

    var bulkBatchSize = Number(config.detailsBulkBatchSize) || 60;
    var itemDetailsStaticMaxAgeMs = normalizeDurationMs(
      config.itemDetailsStaticMaxAgeMs,
      HOME_ITEM_DETAILS_REVALIDATE_MS
    );
    var itemDetailsCacheTtlMs = Math.max(
      itemDetailsStaticMaxAgeMs,
      normalizeDurationMs(
        config.itemDetailsCacheTtlMs,
        HOME_ITEM_DETAILS_CACHE_TTL_MS
      )
    );
    var itemUserDataMaxAgeMs = normalizeDurationMs(
      config.itemDetailsUserDataMaxAgeMs,
      HOME_ITEM_USERDATA_CACHE_TTL_MS
    );

    var getAuthHeaders = function() {
      var tok = accessToken;
      try { tok = getSessionInfo.().accessToken || tok; } catch {}
      return {
        "Authorization": getAuthHeader(),
        "X-Emby-Token": tok,
      };
    };

    var fetchHomeItemDetailsOne = function(itemId) {
      if (!itemId) return null;
      var qs = new URLSearchParams();
      qs.set("Fields", HOME_ITEM_DETAILS_STATIC_FIELDS.join(","));
      return fetchJsonViaSafeFetch(
        "/Users/" + (userId) + "/Items/" + (encodeURIComponent(String(itemId).trim())) + "?" + (qs.toString()),
        { headers: getAuthHeaders() }
      );
    };

    var fetchHomeItemDetailsMany = function(ids) {
      var cleanIds = dedupeItemIds(ids);
      if (!cleanIds.length) return [];

      var qs = new URLSearchParams();
      qs.set("Ids", cleanIds.join(","));
      qs.set("EnableTotalRecordCount", "false");
      qs.set("Fields", HOME_ITEM_DETAILS_STATIC_FIELDS.join(","));

      var data = fetchJsonViaSafeFetch("/Users/" + (userId) + "/Items?" + (qs.toString()), {
        headers: getAuthHeaders()
      });
      return data.Items || data || [];
    };

    var fetchHomeItemUserDataMap = function(ids) {
      var cleanIds = dedupeItemIds(ids);
      if (!cleanIds.length) return new Map();

      var out = new Map();

      for (var start = 0; start < cleanIds.length; start += bulkBatchSize) {
        var chunk = cleanIds.slice(start, start + bulkBatchSize);
        var qs = new URLSearchParams();
        qs.set("Ids", chunk.join(","));
        qs.set("EnableUserData", "true");
        qs.set("EnableTotalRecordCount", "false");
        qs.set("Fields", HOME_ITEM_DETAILS_USERDATA_FIELDS.join(","));

        var data = cachedFetchJson({
          keyParts: ["homeItemUserData", userId, [...chunk].sort().join(",")],
          url: "/Users/" + (userId) + "/Items?" + (qs.toString()),
          opts: { headers: getAuthHeaders() },
          fetchJson: fetchJsonViaSafeFetch,
          ttlMs: itemUserDataMaxAgeMs,
          allowStaleOnError: true,
        });

        var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
        for (var item of items) {
          var id = item.Id || item.id;
          if (id) out.set(id, item);
        }
      }

      return out;
    };

    if (!fetchItemDetailsCached || window.__jmsFetchItemDetailsCachedUserId !== userId) {
      fetchItemDetailsCached = window.__jmsFetchItemDetailsCached =
        createCachedItemDetailsFetcher({
          fetchOne: fetchHomeItemDetailsOne,
          fetchMany: fetchHomeItemDetailsMany,
          batchSize: bulkBatchSize,
          ttlMs: itemDetailsCacheTtlMs,
          revalidateAfterMs: itemDetailsStaticMaxAgeMs,
          allowStaleOnError: true,
          maxConcurrent: Number(config.detailsFetchConcurrency) || 6,
        });
      window.__jmsFetchItemDetailsCachedUserId = userId;
    }

    try {
      window.__stopJmsLibraryWatcher.();
      window.__stopJmsLibraryWatcher = startLibraryDeltaWatcherfunction({
        userId,
        fetchJson: fetchJsonViaSafeFetch,
        getAuthHeaders: () {
          var tok = accessToken;
          try { tok = getSessionInfo.().accessToken || tok; } catch {}
          return {
            "Authorization": getAuthHeader(),
            "X-Emby-Token": tok,
          };
        },
        fetchItemDetailsCached,
        intervalMs: Number(config.libraryWatchIntervalMs) || 60_000,
        limit: Number(config.libraryWatchLimit) || 50,
      });
    } catch {}
    if (!isBootActive()) return;

    var cfgLimit =
      Number.isFinite(Number(config.limit)) ? Number(config.limit) :
      Number.isFinite(Number(config.savedLimit)) ? Number(config.savedLimit) :
      undefined;
    var savedLimit = Number.isFinite(cfgLimit)
      ? cfgLimit
      : parseInt(localStorage.getItem("limit") || "20", 10);
    window.myUserId = userId;

    var items = [];
    var backgroundWarmIds = [];

    try {
      var listItems = null;

      if (config.useManualList && config.manualListIds) {
        listItems = config.manualListIds.split(",").mapfunction((id) id.trim()).filter(Boolean);
      }

      if (Array.isArray(listItems) && listItems.length) {
        var details = fetchItemDetailsCached.many(listItems);
        var userDataById = fetchHomeItemUserDataMap(listItems);
        items = details
          .mapfunction((detail, idx) {
            var id = detail.Id || listItems[idx];
            return mergeHomeSliderItem(null, detail, userDataById.get(id) || null);
          })
          .filterfunction((x) x);
        syncCustomSplashProgress({
          dataPoolReady: true,
          poolCount: items.length
        });
      } else {
        var baseQS = (config.customQueryString || '').replace(/^[?&]+/, '');
        var onlyUnwatched = !!config.onlyUnwatchedRandom;
        var hasIsPlayed = /(?:^|[?&])IsPlayed=/i.test(baseQS);
        var queryString = (onlyUnwatched && !hasIsPlayed)
          ? (baseQS ? baseQS + '&IsPlayed=false' : 'IsPlayed=false')
          : baseQS;

        var includeItemTypes = extractItemTypesFromQuery(queryString);
        var shouldBalanceTypes =
          config.balanceItemTypes &&
          (hasAllTypes(includeItemTypes, ["Movie", "Series"]) || hasAllTypes(includeItemTypes, ["Movie", "Series", "BoxSet"]));
        var hasExplicitSort =
          /(?:^|[?&])sortby=/i.test(queryString) ||
          /(?:^|[?&])sortorder=/i.test(queryString);
        var shouldShuffle = !hasExplicitSort && !config.sortingKeywords.somefunction((keyword) queryString.toLowerCase().includes(String(keyword || "").toLowerCase())
        );

        var playingItems = [];
        var playingLimit = (onlyUnwatched ? 0 : parseInt(config.playingLimit || 0, 10));
        var authHeaders = {
        "Authorization": getAuthHeader(),
        "X-Emby-Token": accessToken
      };

        if (playingLimit > 0) {
          try {
            var data = cachedFetchJson({
            keyParts: ["resume", userId, playingLimit * 2],
            url: "/Users/" + (userId) + "/Items?Filters=IsResumable&MediaTypes=Video&Recursive=true&EnableUserData=true&Fields=" + (encodeURIComponent("Type,UserData,ImageTags,BackdropImageTags,PrimaryImageAspectRatio,Series,SeriesId,CollectionIds,MediaStreams")) + "&SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=" + (Math.max(10, playingLimit * 3)),
            opts: { headers: authHeaders },
            fetchJson: fetchJsonViaSafeFetch,
            ttlMs: Number(config.resumeCacheTtlMs) || 10_000,
            allowStaleOnError: true,
          });
            var fetchedItems = Array.isArray(data.Items) ? data.Items : [];
            fetchedItems = fetchedItems.filterfunction((item) isPartialPlaybackUserData(item.UserData));

            if (config.excludeEpisodesFromPlaying) {
              playingItems = fetchedItems.filterfunction((item) item.Type !== "Episode").slice(0, playingLimit);
            } else {
              playingItems = fetchedItems.slice(0, playingLimit);
            }
          } catch (err) {
            console.error("Erro ao obter conteúdos assistidos:", err);
          }
        }

        var maxShufflingLimit = parseInt(config.maxShufflingLimit || "2000", 10);
        var data = cachedFetchJson({
        keyParts: ["itemsPool", userId, queryString, maxShufflingLimit],
        url: "/Users/" + (userId) + "/Items?" + (queryString) + "&Limit=" + (maxShufflingLimit) + "&EnableTotalRecordCount=false",
        opts: { headers: authHeaders },
        fetchJson: fetchJsonViaSafeFetch,
        ttlMs: Number(config.itemsPoolCacheTtlMs) || 120_000,
        allowStaleOnError: true,
      });
        var allItems = data.Items || [];
        syncCustomSplashProgress({
          dataPoolReady: true,
          poolCount: Array.isArray(allItems) ? allItems.length : 0
        });
        if (playingItems.length && allItems.length) {
          var playingIds = new Setfunction(playingItems.map((it) it && it.Id).filter(Boolean));
          allItems = allItems.filterfunction((it) it && !playingIds.has(it.Id));
        }

        if (queryString.includes("IncludeItemTypes=Season") || queryString.includes("IncludeItemTypes=Episode")) {
          var seasonDetailConcurrency = Math.max(
            1,
            Number(config.seasonDetailFetchConcurrency) || 4
          );
          var detailedSeasons = mapLimitfunction(allItems,
            seasonDetailConcurrency,
            (item) {
              try {
                var seasonRes = safeFetch("/Users/" + (userId) + "/Items/" + (item.Id), { headers: authHeaders });
                var seasonData = seasonRes.json();
                if (seasonData.SeriesId) {
                  var seriesRes = safeFetch("/Users/" + (userId) + "/Items/" + (seasonData.SeriesId), { headers: authHeaders });
                  seasonData.SeriesData = seriesRes.json();
                }
                return seasonData;
              } catch (error) {
                console.error("Erro ao obter detalhes da temporada:", error);
                return item;
              }
            }
          );
          allItems = detailedSeasons.filterfunction((item) item && item.Id);
        }

         if (playingItems.length) {
          var beforePlayingFilter = playingItems.length;
          var episodes = [];
          var nonEpisodes = [];

          for (var it of playingItems) {
            if (it && it.Type === "Episode") {
              episodes.push(it);
            } else {
              nonEpisodes.push(it);
            }
          }

          var filteredNonEpisodes = filterByStrictImageTypes(nonEpisodes, queryString);
          playingItems = [
            ...episodes,
            ...filteredNonEpisodes
          ];

          console.debug(
            "[JMS] playingItems before imageType filter:",
            beforePlayingFilter,
            "after (episodes kept):",
            playingItems.length
          );
        }

        var beforePoolFilter = allItems.length;
        allItems = filterByStrictImageTypes(allItems, queryString);
        console.debug(
          "[JMS] allItems before imageType filter:",
          beforePoolFilter,
          "after:",
          allItems.length
        );

        backgroundWarmIds = Array.fromfunction(new Set(
          [...playingItems, ...allItems]
            .map((item) item.Id)
            .filter(Boolean)
        ));

        var selectedItems = [];
        selectedItems = [...playingItems.slice(0, playingLimit)];
        var remainingSlots = Math.max(0, savedLimit - selectedItems.length);

        if (remainingSlots > 0) {
          if (shouldBalanceTypes) {
            var itemsByType = {};
            allItems.forEach(function((item) {
              var type = item.Type;
              if (!itemsByType[type]) itemsByType[type] = [];
              itemsByType[type].push(item);
            });
            var types = Object.keys(itemsByType);
            var itemsPerType = Math.floor(remainingSlots / types.length);
            types.forEach(function((type) {
              var itemsOfType = itemsByType[type] || [];
              var shuffled = shouldShuffle ? shuffleArray(itemsOfType) : itemsOfType;
              selectedItems.push(...shuffled.slice(0, itemsPerType));
            });
            var finalRemaining = savedLimit - selectedItems.length;
            if (finalRemaining > 0) {
              var allShuffled = shouldShuffle ? shuffleArray(allItems) : allItems;
              selectedItems.push(...allShuffled.slice(0, finalRemaining));
            }
          } else if (shouldShuffle) {
            var allItemIds = allItems.mapfunction((item) item.Id);
            var alwaysShuffle = config.sortingKeywords.somefunction((keyword) (config.keywords || "").toLowerCase().includes(keyword.toLowerCase()));
            if (alwaysShuffle) {
              var shuffled = shuffleArray(allItemIds);
              var selectedItemsFromShuffle = allItems.filterfunction((item) shuffled.slice(0, remainingSlots).includes(item.Id));
              selectedItems.push(...selectedItemsFromShuffle);
            } else {
              var shuffleSeedLimit = parseInt(config.shuffleSeedLimit || "100", 10);
              var alreadySelected = new Setfunction(selectedItems.map((i) i.Id));

              var history = getShuffleHistory(userId);
              var allSet = new Set(allItemIds);
              history = Array.fromfunction(new Set(history.filter((id) allSet.has(id))));
              var historyWasReset = false;
              if (history.length >= shuffleSeedLimit) {
                resetShuffleHistory(userId);
                history = [];
                historyWasReset = true;
              }
              var pickedIds = [];
              var pickedSet = new Set();
              var pushFromPool = function(poolIds, count) {
                if (count <= 0 || !Array.isArray(poolIds) || !poolIds.length) return;
                var uniquePool = poolIds.filterfunction((id) !alreadySelected.has(id) && !pickedSet.has(id)
                );
                if (!uniquePool.length) return;
                var chosen = shuffleArray(uniquePool).slice(0, count);
                chosen.forEach(function((id) pickedSet.add(id));
                pickedIds = pickedIds.concat(chosen);
              };

              var unseenIds = allItemIds.filterfunction((id) !history.includes(id) && !alreadySelected.has(id)
              );
              pushFromPool(unseenIds, remainingSlots);

              if (pickedIds.length < remainingSlots) {
                if (history.length) {
                  resetShuffleHistory(userId);
                  history = [];
                  historyWasReset = true;
                }
                var need = remainingSlots - pickedIds.length;
                var fallbackPool = allItemIds.filterfunction((id) !alreadySelected.has(id) && !pickedSet.has(id)
                );
                pushFromPool(fallbackPool, need);
              }
              var selectedItemsFromShuffle = allItems.filterfunction((item) pickedSet.has(item.Id));
              selectedItems.push(...selectedItemsFromShuffle);
              var historyBase = historyWasReset ? [] : history;
              var newHistory = Array.from(new Set([...historyBase, ...pickedIds])).slice(-shuffleSeedLimit);
              try {
                saveShuffleHistory(userId, newHistory);
                console.debug("[JMS] histórico de shuffle salvo:", userId, newHistory.length);
              } catch (e) {
                console.warn("[JMS] não foi possível salvar o histórico de shuffle:", e);
              }
            }
          } else {
            selectedItems.push(...allItems.slice(0, remainingSlots));
          }
        }

        if (shouldShuffle) {
          if (selectedItems.length > playingItems.length) {
            var nonPlayingItems = selectedItems.slice(playingItems.length);
            var shuffledNonPlaying = shuffleArray(nonPlayingItems);
            selectedItems = [...selectedItems.slice(0, playingItems.length), ...shuffledNonPlaying];
          }
        }

        var beforeUniq = selectedItems.length;
        selectedItems = uniqueByIdStable(selectedItems).slice(0, savedLimit);
        console.debug(
          "[JMS] selectedItems before uniq:",
          beforeUniq,
          "after uniq:",
          selectedItems.length,
          "limit:",
          savedLimit
        );

        var selectedById = new Mapfunction(selectedItems
            .filter((it) it.Id)
            .mapfunction((it) [it.Id, it])
        );
        var detailed = fetchItemDetailsCached.many(selectedItems.map(function(i) i.Id));
        var userDataById = fetchHomeItemUserDataMapfunction(selectedItems.map((item) item.Id));
        items = detailed
          .mapfunction((detail, idx) {
            var base = selectedById.get(detail.Id || selectedItems[idx].Id) || selectedItems[idx] || null;
            var id = detail.Id || base.Id || selectedItems[idx].Id;
            return mergeHomeSliderItem(base, detail, userDataById.get(id) || null);
          })
          .filterfunction((x) x);
      }
    } catch (err) {
      console.error("Erro ao preparar os dados do slide:", err);
    }

    if (!isBootActive()) return;
    if (backgroundWarmIds.length && typeof fetchItemDetailsCached.startWarmup === "function") {
      var warmBatchSize = Math.max(
        10,
        Math.min(
          200,
          Number(config.detailsWarmBatchSize) ||
          Number(config.detailsBulkBatchSize) ||
          60
        )
      );
      var warmDelayMs = Math.max(80, Number(config.detailsWarmDelayMs) || 180);

      void fetchItemDetailsCached.startWarmup({
        scopeKey: "home:" + (userId),
        ids: backgroundWarmIds,
        batchSize: warmBatchSize,
        delayMs: warmDelayMs,
      }).catchfunction((error) {
        console.debug("[JMS][cache] background warmup skipped:", error);
      });
    }
    try { primeQualityFromItems(items); } catch {}
    if (!items.length) {
    console.warn("Nenhum dado de slide obtido.");
    return;
  }
  window.__totalSlidesPlanned = items.length;
  window.__slidesCreated = 0;
  syncCustomSplashProgress({
    selectionReady: true,
    totalSlides: items.length,
    createdSlides: 0
  });

    var peakBatches = config.peakSlider ? buildPeakCreationBatches(items.length, getPeakDisplayOptions()) : [];
    var markSlideReadyWhenVisualSyncOpens = function(slideEl) {
      if (!isBootActive({ requireHomeVisible: false })) return;
      var finalizeWhenVisible = function() {
        waitForFirstSlideVisualReady(slideEl, bootToken, {
          timeoutMs: config.peakSlider ? 4600 : 3200
        }).thenfunction((ready) {
          if (!ready) return;
          markFirstSlideReady(bootToken);
        }).catchfunction(() {});
      };
      if (typeof slideEl.__waitForBackdropReady === "function") {
        slideEl.__waitForBackdropReady({
          timeoutMs: config.peakSlider ? 2200 : 1400
        }).finallyfunction(() {
          finalizeWhenVisible();
        });
        return;
      }
      finalizeWhenVisible();
    };
    var createItemAt = function(itemIndex, options = {}) {
      if (!isBootActive()) return null;
      var item = items[itemIndex];
      if (!item) return null;
      var slideEl = createSlide(item, { insertAt: itemIndex, ...options });
      if (!isBootActive()) {
        var staleContainer = slideEl.closest.("#monwui-slides-container") || null;
        try { slideEl.__cleanupSlide.(); } catch {}
        try { slideEl.remove.(); } catch {}
        try {
          if (staleContainer && !staleContainer.querySelector(".monwui-slide")) {
            staleContainer.remove();
          }
        } catch {}
        return null;
      }
      if (itemIndex === 0) {
        markSlideReadyWhenVisualSyncOpens(slideEl);
      }
      try { annotateDomWithQualityHints(document); } catch {}
      markSlideCreated(bootToken);
      return slideEl;
    };

    if (config.peakSlider) {
      var [firstBatch = [0]] = peakBatches;
      for (var itemIndex of firstBatch) {
        if (!isBootActive()) return;
        createItemAt(itemIndex, {
          suppressInitialDisplay: true,
          deferPeakReveal: itemIndex !== 0
        });
      }
    } else {
      if (!isBootActive()) return;
      var first = items[0];
      var firstSlide = createSlide(first);
      if (!isBootActive()) {
        var staleContainer = firstSlide.closest.("#monwui-slides-container") || null;
        try { firstSlide.__cleanupSlide.(); } catch {}
        try { firstSlide.remove.(); } catch {}
        try {
          if (staleContainer && !staleContainer.querySelector(".monwui-slide")) {
            staleContainer.remove();
          }
        } catch {}
        return;
      }
      markSlideReadyWhenVisualSyncOpens(firstSlide);
      try { annotateDomWithQualityHints(document); } catch {}
      markSlideCreated(bootToken);
    }

    if (!isBootActive()) return;
    var idxPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
    if (idxPage) upsertSlidesContainerAtTop(idxPage);
    try {
      updateSlidePosition();
    } catch {}

    if (config.peakSlider) {
      window.__peakBooting = false;
    }
    initializeSlider(bootToken);
    var rest = config.peakSlider
      ? peakBatches.slice(1)
      : chunkArrayfunction(items.map((_, index) index).slice(1), 1);
    scheduleSliderIdleTaskfunction(() {
      function(() {
        if (!isBootActive({ requireContainer: true })) return;
        for (var batch of rest) {
          if (!isBootActive({ requireContainer: true })) return;
          try {
            var createdSlides = [];
            for (var itemIndex of batch) {
              if (!isBootActive({ requireContainer: true })) return;
              var slideEl = createItemAt(itemIndex, {
                suppressInitialDisplay: true,
                deferPeakReveal: config.peakSlider
              });
              if (slideEl) createdSlides.push(slideEl);
            }
            if (!isBootActive({ requireContainer: true })) return;
            if (config.peakSlider) {
              var idxPage = document.querySelector('#indexPage:not(.hide), #homePage:not(.hide)');
              if (idxPage) syncPeakStructureNow(idxPage);
              var releasePending = function() {
                createdSlides.forEach(function((slideEl) {
                  if (typeof slideEl.__releasePeakReveal === "function") {
                    slideEl.__releasePeakReveal();
                    return;
                  }
                  slideEl.classList.remove('peak-batch-pending');
                });
              };
              var container = idxPage.querySelector.('#monwui-slides-container');
              if (container.classList.contains('peak-ready')) {
                requestAnimationFrame(releasePending);
              } else {
                requestAnimationFramefunction(() {
                  requestAnimationFrame(releasePending);
                });
              }
            }
          } catch (e) {
            console.warn("Arka plan slayt oluşturma hatası:", e);
          }
        }
        try {
        } catch (e) {
          console.warn("Dot navigation yeniden kurulamadı:", e);
        }
      })();
    });
  } catch (e) {
    console.error("slidesInit hata:", e);
  } finally {
    if ((Number(window.__jmsSlidesInitToken) || 0) === bootToken) {
      window.__jmsSlidesInitToken = 0;
    }
    if ((Number(window.__jmsSliderResetToken) || 0) === bootToken) {
      window.__jmsSliderResetToken = 0;
    }
    window.sliderResetInProgress = false;
    window.__slidesInitRunning = false;
  }
}

function initializeSlider(bootToken = Number(window.__jmsSliderBootToken) || 0) {
  try {
    if (!isSliderBootTokenCurrent(bootToken, { requireContainer: true })) return;
    var indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)") ||
      document.querySelector(".homeSectionsContainer").closest("#indexPage, #homePage") ||
      document.querySelector("#indexPage");
    if (!indexPage) return;

    ensureProgressBarExists();
    primeProgressBar(indexPage);
    ensureInitialActivation(indexPage);
    hydrateFirstSlide(indexPage);
    initSwipeEvents();
    if (config.peakSlider) {
      var sc = indexPage.querySelector('#monwui-slides-container');
      var slides = indexPage.querySelectorAll('.monwui-slide');
      if (sc && slides.length) {
        sc.classList.add('peak-mode');
        primePeakFirstPaint(slides, getCurrentIndex(), sc, getPeakDisplayOptions());
        enablePeakNeighborActivation();
      }
    }
    triggerSlideEnterHooks(indexPage);

    try {
      updateSlidePosition();
    } catch {}

    var slides = indexPage.querySelectorAll(".monwui-slide");
    var slidesContainer = indexPage.querySelector("#monwui-slides-container");
    var focusedSlide = null;
    var keyboardActive = false;

    var pb = document.querySelector(".monwui-slide-progress-bar");
    if (pb) {
      pb.style.opacity = "0";
      pb.style.width = "0%";
    }

function queueHardResetNextFrame() {
  requestAnimationFramefunction(() {
    requestAnimationFramefunction(() {
      restartSlideTimerDeterministic();
    });
  });
}

function startWhenAllReady() {
  if (!isSliderBootTokenCurrent(bootToken, { requireContainer: true })) {
    if (window.__jmsStartWhenAllReadyHandler === startWhenAllReady) {
      window.__jmsStartWhenAllReadyHandler = null;
    }
    try { document.removeEventListener("jms:all-slides-ready", startWhenAllReady); } catch {}
    return;
  }

  var shouldStartTimer = !hasStartedCycleClock() && !isCustomSplashBlockingNow();

  try {
    var oldDots = document.querySelector(".monwui-dot-navigation-container");
    if (oldDots) oldDots.remove();
    createDotNavigation();
  } catch {}

  if (shouldStartTimer) {
    primeProgressBar(indexPage);
  }
  ensureInitialActivation(indexPage);
  hydrateFirstSlide(indexPage);
  initSwipeEvents();
  if (shouldStartTimer) {
    startNewCycleClock();
    safeRaffunction(() {
      hardProgressReset();
      startSlideTimer();
      if (pb) pb.style.opacity = "1";
    });
  } else {
    try { updateProgressBarPosition(); } catch {}
    if (pb) pb.style.opacity = "1";
  }

    try {
      window.__peakBooting = false;
      if (config.peakSlider) {
        var sc = indexPage.querySelector('#monwui-slides-container');
        var slides = indexPage.querySelectorAll('.monwui-slide');
        if (sc && slides.length) {
          sc.classList.add('peak-ready');
          sc.classList.remove('peak-init');
          updatePeakClasses(slides, getCurrentIndex(), getPeakDisplayOptions());
        }
      }
    } catch {}

  try { window.__cleanupActiveWatch.(); } catch {}
  window.__cleanupActiveWatch = watchActiveSlideChanges();

  if (window.__jmsStartWhenAllReadyHandler === startWhenAllReady) {
    window.__jmsStartWhenAllReadyHandler = null;
  }
  document.removeEventListener("jms:all-slides-ready", startWhenAllReady);
}

clearStartWhenAllReadyHandler();
window.__jmsStartWhenAllReadyHandler = startWhenAllReady;
if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
  startWhenAllReady();
} else {
  document.addEventListener("jms:all-slides-ready", startWhenAllReady, { once: true });
}
    attachMouseEvents();
    var firstImg = indexPage.querySelector(".monwui-slide.active img");
    if (firstImg && !firstImg.complete && firstImg.decode) {
      firstImg.decode().catchfunction(() {}).finallyfunction(() {});
    }
    slides.forEach(function((slideEl) {
      slideEl.addEventListenerfunction("focus",
        () {
          focusedSlide = slideEl;
          slidesContainer.classList.remove("disable-interaction");
        },
        true
      );
      slideEl.addEventListenerfunction("blur",
        () {
          if (focusedSlide === slideEl) focusedSlide = null;
        },
        true
      );
    });

    indexPage.addEventListenerfunction("keydown", (e) {
      if (!keyboardActive) return;
      if (e.keyCode === 37) {
        changeSlide(-1);
        queueHardResetNextFrame();
      } else if (e.keyCode === 39) {
        changeSlide(1);
        queueHardResetNextFrame();
      } else if (e.keyCode === 13 && focusedSlide) {
        e.preventDefault();
        var itemId = focusedSlide.dataset.itemId;
        if (!itemId) return;
        var preferBackdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
        var originEl = focusedSlide.__backdropImg || focusedSlide.querySelector.(".monwui-backdrop") || focusedSlide;
        try {
          openDetailsModalLazy({
            itemId,
            serverId: getSessionInfo.().serverId || "",
            preferBackdropIndex,
            originEl,
          });
        } catch (err) {
          console.warn("openDetailsModal failed (slider keyboard):", err);
        }
      }
    });

    indexPage.addEventListenerfunction("focusin", (e) {
      if (e.target.closest("#monwui-slides-container")) {
        keyboardActive = true;
        slidesContainer.classList.remove("disable-interaction");
      }
    });
    indexPage.addEventListenerfunction("focusout", (e) {
      if (!e.target.closest("#monwui-slides-container")) {
        keyboardActive = false;
        slidesContainer.classList.add("disable-interaction");
      }
    });
    try {
      window.__cleanupActiveWatch.();
    } catch {}
    window.__cleanupActiveWatch = watchActiveSlideChanges();
    document.addEventListenerfunction("jms:per-slide-complete", (ev) {
  try {
    var active = document.querySelector("#indexPage:not(.hide) .monwui-slide.active, #homePage:not(.hide) .monwui-slide.active");
    var idx = getSlideIndex(active);

    if (window.__cycleExpired && isPlannedLastIndex(idx)) {
      ev.preventDefault();
      window.__cycleExpired = false;
      scheduleSliderRebuild("cycle-expired-and-last-finished");
    }
  } catch (e) {
    console.warn("per-slide-complete handler hata:", e);
  }
}, true);
} catch (e) {
    console.error("initializeSlider hata:", e);
  } finally {
    window.sliderResetInProgress = false;
  }
}

function setupNavigationObserver() {
  if (navObsBooted) return function() {};
  navObsBooted = true;

  var previousUrl = window.location.href;
  var isOnHomePage = isHomeVisible() || isHomeRouteActive();
  var scheduledTimer = 0;
  var disposed = false;

  var checkPageChange = function() {
    var currentUrl = window.location.href;
    var nowOnHomePage = isHomeVisible() || isHomeRouteActive();

    if (currentUrl !== previousUrl || nowOnHomePage !== isOnHomePage) {
      homeSectionLog("navigation:page-change", {
        fromUrl: previousUrl,
        toUrl: currentUrl,
        wasOnHomePage: isOnHomePage,
        nowOnHomePage,
      });
      previousUrl = currentUrl;
      isOnHomePage = nowOnHomePage;

      if (isOnHomePage) {
        window.__initOnHomeOnce = false;
        fullSliderReset({ reason: "navigation:home-enter" });
        if (getMainConfig().enableNotifications === false) {
          document.getElementById('jfNotifBtn').remove();
          document.querySelector('.jf-notif-panel').remove();
        }
        var ok = waitForVisibleIndexPage(12000);
        if (ok) {
          homeSectionLog("navigation:home-ready", {
            currentUrl,
            visible: ok,
          });
          window.__initOnHomeOnce = false;
          initializeSliderOnHome({ forceManagedSectionsBoot: true });
        } else {
          homeSectionWarn("navigation:home-not-ready:observe", {
            currentUrl,
          });
          var stop = observeWhenHomeReadyfunction(() {
            window.__initOnHomeOnce = false;
            initializeSliderOnHome({ forceManagedSectionsBoot: true });
            stop();
          }, 20000);
        }
      } else {
        homeSectionLog("navigation:left-home", {
          currentUrl,
        });
        dismissCustomSplashImmediately("route-not-home");
        cleanupSlider({ reason: "navigation:left-home" });
        window.__initOnHomeOnce = false;
      }
      startPauseOverlayOnce();
    }
  };

  var scheduleCheck = function(delay = 0) {
    if (disposed || scheduledTimer) return;
    scheduledTimer = window.setTimeoutfunction(() {
      scheduledTimer = 0;
      void checkPageChange();
    }, Math.max(0, delay | 0));
  };

  var isHomeMutationTarget = function(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === "indexPage" || node.id === "homePage") return true;
    if (node.classList.contains("homeSectionsContainer")) return true;
    return !!node.querySelector.("#indexPage, #homePage, .homeSectionsContainer");
  };

  var domObserver = new MutationObserverfunction((mutations) {
    for (var mutation of mutations) {
      if (mutation.type === "attributes") {
        if (isHomeMutationTarget(mutation.target)) {
          scheduleCheck();
          return;
        }
        continue;
      }
      for (var node of mutation.addedNodes) {
        if (isHomeMutationTarget(node)) {
          scheduleCheck();
          return;
        }
      }
    }
  });

  domObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  scheduleCheck();

  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    scheduleCheck();
  };
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    scheduleCheck();
  };

  var onPopState = function() scheduleCheck();
  var onHashChange = function() scheduleCheck();
  var onPageShow = function() scheduleCheck();
  var onViewShow = function() scheduleCheck();
  var onViewShown = function() scheduleCheck();
  var onFocus = function() scheduleCheck(50);

  window.addEventListener("popstate", onPopState);
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("viewshow", onViewShow);
  document.addEventListener("viewshown", onViewShown);
  window.addEventListener("focus", onFocus, { passive: true });

  return function() {
    disposed = true;
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = 0;
    }
    try { domObserver.disconnect(); } catch {}
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("hashchange", onHashChange);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("viewshow", onViewShow);
    document.removeEventListener("viewshown", onViewShown);
    window.removeEventListener("focus", onFocus);
  };
}

var homeSectionsBootTimer = 0;
var homeSectionsBootSeq = 0;
var HOME_SECTIONS_BOOT_RETRY_DELAYS_MS = [700, 1400, 2400, 3800, 5600, 8000];

function clearQueuedHomeSectionsBoot() {
  if (homeSectionsBootTimer) {
    clearTimeout(homeSectionsBootTimer);
    homeSectionsBootTimer = 0;
  }
  homeSectionsBootSeq += 1;
}

function queueHomeSectionsBoot({
  delayMs = 0,
  eagerStudioHubs = false,
  requireSliderDisabled = false,
  forceManagedSections = false,
  maxRetryCount = HOME_SECTIONS_BOOT_RETRY_DELAYS_MS.length
} = {}) {
  homeSectionsBootSeq += 1;
  var seq = homeSectionsBootSeq;

  if (homeSectionsBootTimer) {
    clearTimeout(homeSectionsBootTimer);
    homeSectionsBootTimer = 0;
  }

  homeSectionLog("queueHomeSectionsBoot:schedule", {
    seq,
    delayMs,
    eagerStudioHubs,
    requireSliderDisabled,
    forceManagedSections,
    maxRetryCount,
  });
  homeSectionTrace("queueHomeSectionsBoot:schedule", {
    seq,
    delayMs,
    eagerStudioHubs,
    requireSliderDisabled,
    forceManagedSections,
    maxRetryCount,
    stack: new Error().stack.split("\n").slice(0, 6).join("\n") || "",
  });

  var scheduleAttempt = function(waitMs, attemptIndex) {
    if (homeSectionsBootSeq !== seq) return;
    if (homeSectionsBootTimer) {
      clearTimeout(homeSectionsBootTimer);
      homeSectionsBootTimer = 0;
    }

    homeSectionsBootTimer = window.setTimeoutfunction(() {
      homeSectionsBootTimer = 0;
      idlefunction(() {
        if (homeSectionsBootSeq !== seq) return;
        if (!isHomeRouteActive()) {
          homeSectionWarn("queueHomeSectionsBoot:skip:not-home-route", {
            seq,
            attemptIndex,
            waitMs,
            requireSliderDisabled,
            forceManagedSections,
          });
          return;
        }
        if (requireSliderDisabled && isSliderEnabled()) {
          homeSectionWarn("queueHomeSectionsBoot:skip:slider-still-enabled", {
            seq,
            attemptIndex,
            waitMs,
            requireSliderDisabled,
            forceManagedSections,
          });
          return;
        }

        var visibleHomePage = getVisibleHomePageEl();
        var visibleHomeSections = getVisibleHomeSectionsContainerEl(visibleHomePage);
        var homeReady = !!(visibleHomePage && visibleHomeSections && isHomeVisible());
        var effectiveForceManagedSections = getEffectiveManagedHomeSectionForce(forceManagedSections, {
          requireSliderDisabled,
        });
        homeSectionLog("queueHomeSectionsBoot:attempt", {
          seq,
          attemptIndex,
          waitMs,
          eagerStudioHubs,
          requireSliderDisabled,
          forceManagedSections: effectiveForceManagedSections,
          requestedForceManagedSections: forceManagedSections === true,
          visiblePageId: visibleHomePage.id || null,
          hasVisibleHomeSections: !!visibleHomeSections,
          homeReady,
        });

        if (homeReady) {
          var bootStarted = false;
          try {
            var cfg = (typeof getConfig === "function" ? getConfig() : {}) || {};
            bootHomeSections(cfg, {
              eagerStudioHubs,
              forceManagedSections: effectiveForceManagedSections,
            });
            bootStarted = true;
          } catch (e) {
            console.warn("queueHomeSectionsBoot hata:", e);
          }
          if (bootStarted) return;
        } else {
          homeSectionWarn("queueHomeSectionsBoot:not-ready", {
            seq,
            attemptIndex,
            waitMs,
            eagerStudioHubs,
            requireSliderDisabled,
            forceManagedSections,
          });
        }

        if (attemptIndex >= Math.max(0, maxRetryCount | 0)) return;
        var nextDelay = HOME_SECTIONS_BOOT_RETRY_DELAYS_MS[
          Math.min(attemptIndex, HOME_SECTIONS_BOOT_RETRY_DELAYS_MS.length - 1)
        ] || 2000;
        scheduleAttempt(nextDelay, attemptIndex + 1);
      });
    }, Math.max(0, waitMs | 0));
  };

  scheduleAttempt(delayMs, 0);
}

function initializeSliderOnHome({ forceManagedSectionsBoot = false } = {}) {
  var start = function() {
    try { window.__jmsHomeTabPaused = false; } catch {}
    homeSectionLog("initializeSliderOnHome:start", {
      forceManagedSectionsBoot,
    });
    homeSectionTrace("initializeSliderOnHome:start", {
      forceManagedSectionsBoot,
      stack: new Error().stack.split("\n").slice(0, 6).join("\n") || "",
    });

    waitForManagedHomeSectionCleanup({ timeoutMs: 2500 });

    if (!isSliderEnabled()) {
      try {
        cleanupSlider({
          preserveHomeSections: true,
          reason: "initializeSliderOnHome:slider-disabled",
        });
      } catch {}
      try { stopSlideTimer.(); } catch {}
      try { clearCycleArm(); } catch {}
      homeSectionWarn("initializeSliderOnHome:slider-disabled", {
        forceManagedSectionsBoot,
      });

      queueHomeSectionsBoot({
        delayMs: 500,
        requireSliderDisabled: true,
        forceManagedSections: false
      });
      scheduleManagedHomeSectionRecovery();

      return;
    }

    var hasContainer = !!document.querySelector('#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container');
    var willEarlyReturn = (window.__initOnHomeOnce && hasContainer);

    function bootPersonalRecsWires() {
      if (window.__recsWiresBooted) return;
      window.__recsWiresBooted = true;

      var indexPage =
        document.querySelector("#indexPage:not(.hide)") ||
        document.querySelector("#homePage:not(.hide)");
      if (!indexPage) return;

      var __recsBooted = false;
      var onAllReady = function() {
        if (__recsBooted) return;
        __recsBooted = true;
        var cfg = (typeof getConfig === 'function' ? getConfig() : {}) || {};

        try {
          bootHomeSections(cfg);
        } catch (e) {
          console.warn("bootPersonalRecsWires onAllReady hata:", e);
        }
      };

      document.addEventListener("jms:all-slides-ready", onAllReady, { once: true });
      if (window.__totalSlidesPlanned > 0 && window.__slidesCreated >= window.__totalSlidesPlanned) {
        onAllReady();
      }
      setTimeoutfunction(() { if (!__recsBooted) onAllReady(); }, 5000);
      document.addEventListenerfunction("jms:slide-enter", () { onAllReady(); }, { once: true });
      if (window.__jmsFirstSlideReady) {
        idlefunction(() onAllReady());
      } else {
        document.addEventListenerfunction("jms:first-slide-ready", () {
          idlefunction(() onAllReady());
        }, { once: true });
      }
    }

    if (willEarlyReturn) {
      homeSectionLog("initializeSliderOnHome:early-return", {
        forceManagedSectionsBoot,
        hasContainer,
      });
      bootPersonalRecsWires();
      queueHomeSectionsBoot({
        delayMs: 600,
        forceManagedSections: true
      });
      scheduleManagedHomeSectionRecovery();
      return;
    }
    window.__initOnHomeOnce = true;
    var indexPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
    if (!indexPage) {
      homeSectionWarn("initializeSliderOnHome:no-visible-index-page", {
        forceManagedSectionsBoot,
      });
      return;
    }

    fullSliderReset({ reason: "initializeSliderOnHome:slider-enabled" });
    bootPersonalRecsWires();
    upsertSlidesContainerAtTop(indexPage);
    var sc = indexPage.querySelector('#monwui-slides-container');
    if (config.peakSlider && sc) {
      sc.scrollLeft = 0;
      sc.classList.remove('peak-ready');
      sc.classList.add('peak-init');
      try { delete sc.dataset.peakPrimed; } catch {}
    }
    forceHomeSectionsTop();
    forceSkinHeaderPointerEvents();
    try {
      updateSlidePosition();
    } catch {}
    ensureProgressBarExists();
    var pb = document.querySelector(".monwui-slide-progress-bar");
    if (pb) {
      pb.style.opacity = "0";
      pb.style.width = "0%";
    }
    function(() {
      try {
        waitAuthWarmupFallback(1000);
      } catch {}
      slidesInit();
    })();

    queueHomeSectionsBoot({
      delayMs: 1800,
      forceManagedSections: forceManagedSectionsBoot
    });
    scheduleManagedHomeSectionRecovery();
    homeSectionLog("initializeSliderOnHome:booted", {
      forceManagedSectionsBoot,
      indexPageId: indexPage.id,
    });
  };

  void start();
}

function cleanupSlider({ preserveHomeSections = false, invalidateBoot = true, reason = "cleanupSlider" } = {}) {
  homeSectionLog("cleanupSlider:start", {
    preserveHomeSections,
    invalidateBoot,
  });
  homeSectionTrace("cleanupSlider:start", {
    reason,
    preserveHomeSections,
    invalidateBoot,
    visibleHome: isHomeVisible(),
    routeHome: isHomeRouteActive(),
  });
  var shouldPreserveManagedHomeSectionBoot =
    preserveHomeSections && isHomeRouteActive();
  try { teardownAnimations(); } catch {}
  if (invalidateBoot) {
    invalidateSliderBootSession();
  }
  if (!shouldPreserveManagedHomeSectionBoot) {
    clearHomeSectionMountTimers();
    clearManagedHomeSectionRecoveryTimers();
    homeSectionMountSeq += 1;
    clearQueuedHomeSectionsBoot();
  } else {
    homeSectionLog("cleanupSlider:preserving-home-section-boot", {
      preserveHomeSections,
      invalidateBoot,
    });
    homeSectionTrace("cleanupSlider:preserve", {
      reason,
      preserveHomeSections,
      invalidateBoot,
    });
  }
  if (!preserveHomeSections) {
    queueManagedHomeSectionCleanup(reason, {
      preserveHomeSections,
      invalidateBoot,
    });
  }
  if (window.mySlider) {
    if (window.mySlider.autoSlideTimeout) {
      clearTimeout(window.mySlider.autoSlideTimeout);
    }
    if (window.mySlider.sliderTimeout) {
      clearTimeout(window.mySlider.sliderTimeout);
    }
    if (window.mySlider.intervalChangeSlide) {
      clearInterval(window.mySlider.intervalChangeSlide);
    }
    window.mySlider = {};
  }

  try { resetProgressBar.(); } catch {}
  try {
    document
      .querySelectorAll(".monwui-dot-navigation-container, .monwui-slide-progress-seconds")
      .forEach(function((node) node.remove());
  } catch {}

  var host =
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)");

  if (host) {
    var sliderContainer = host.querySelector("#monwui-slides-container");
    if (sliderContainer) {
      try {
        sliderContainer.scrollLeft = 0;
        sliderContainer.classList.remove('peak-ready');
        sliderContainer.classList.remove('peak-diagonal');
        sliderContainer.classList.remove('peak-init');
        delete sliderContainer.dataset.peakPrimed;
      } catch {}
      sliderContainer.remove();
    }
  }
}

function getAuthContextRecoveryKey(profile = {}) {
  var serverId = String(profile.serverId || "").trim();
  var serverBase = String(profile.serverBase || "").trim().replace(/\/+$/, "");
  var userId = String(profile.userId || "").trim();
  return [serverId, serverBase, userId].join("|");
}

function shouldIgnoreAuthContextRecovery(detail = {}) {
  var prevUserId = String(detail.prev.userId || "").trim();
  var nextUserId = String(detail.next.userId || "").trim();
  var prevServerId = String(detail.prev.serverId || "").trim();
  var nextServerId = String(detail.next.serverId || "").trim();
  var prevServerBase = String(detail.prev.serverBase || "").trim().replace(/\/+$/, "");
  var nextServerBase = String(detail.next.serverBase || "").trim().replace(/\/+$/, "");

  if (detail.userChanged === true) return false;
  if (detail.serverChanged !== true) return false;
  if (!prevUserId || !nextUserId || prevUserId !== nextUserId) return false;

  var serverIdWarmupOnly =
    (!!prevServerId && !nextServerId) ||
    (!prevServerId && !!nextServerId);
  var serverBaseWarmupOnly =
    (!!prevServerBase && !nextServerBase) ||
    (!prevServerBase && !!nextServerBase);
  var serverIdCompatible = !prevServerId || !nextServerId || prevServerId === nextServerId;
  var serverBaseCompatible = !prevServerBase || !nextServerBase || prevServerBase === nextServerBase;

  if (!serverIdCompatible || !serverBaseCompatible) return false;
  return serverIdWarmupOnly || serverBaseWarmupOnly;
}

function bootHomeAfterAuthContextReset() {
  window.__initOnHomeOnce = false;
  initializeSliderOnHome({ forceManagedSectionsBoot: true });
}

function scheduleAuthContextRecovery(detail = {}) {
  if (!detail.serverChanged && !detail.userChanged) return;
  if (shouldIgnoreAuthContextRecovery(detail)) {
    homeSectionWarn("authRecovery:skip:warmup-server-base-change", detail);
    homeSectionTrace("authRecovery:skip:warmup-server-base-change", detail);
    return;
  }

  var nextKey =
    getAuthContextRecoveryKey(detail.next) ||
    getAuthContextRecoveryKey(detail.prev);

  if (nextKey && nextKey === __lastRecoveredAuthContextKey) return;
  if (nextKey) __lastRecoveredAuthContextKey = nextKey;

  if (__authContextRecoveryTimer) {
    clearTimeout(__authContextRecoveryTimer);
    __authContextRecoveryTimer = 0;
  }

  __authContextRecoveryTimer = window.setTimeoutfunction(() {
    __authContextRecoveryTimer = 0;
    console.log("[jms] Auth context degisti -> slider yeniden hazirlaniyor", detail);
    homeSectionTrace("authRecovery:fire", detail);

    try {
      fullSliderReset({
        preserveHomeSections: false,
        reason: "auth-context-recovery",
      });
    } catch {}
    window.__initOnHomeOnce = false;

    if (!(isHomeVisible() || isHomeRouteActive())) return;

    var visible = waitForVisibleIndexPage(12000);
    if (visible) {
      bootHomeAfterAuthContextReset();
      return;
    }

    var stop = observeWhenHomeReadyfunction(() {
      bootHomeAfterAuthContextReset();
      stop();
    }, 20000);
  }, AUTH_CONTEXT_REBOOT_DEBOUNCE_MS);
}

function installAuthContextRecovery() {
  if (window.__jmsAuthContextRecoveryInstalled) return;
  window.__jmsAuthContextRecoveryInstalled = true;

  document.addEventListenerfunction(AUTH_PROFILE_CHANGED_EVENT, (event) {
    scheduleAuthContextRecovery(event.detail || {});
  }, true);

  document.addEventListenerfunction(USERDATA_CHANGED_EVENT, () {
    scheduleSliderUserDataRefresh();
  }, true);
}

function observeWhenHomeReady(cb, maxMs = 20000) {
  var start = Date.now();
  var mo = new MutationObserverfunction(() {
    var ready =
      document.querySelector("#indexPage:not(.hide) .homeSectionsContainer") ||
      document.querySelector("#homePage:not(.hide) .homeSectionsContainer") ||
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (ready) {
      homeSectionLog("observeWhenHomeReady:ready", {
        maxMs,
        waitedMs: Date.now() - start,
      });
      cleanup();
      cb();
    } else if (Date.now() - start > maxMs) {
      homeSectionWarn("observeWhenHomeReady:timeout", {
        maxMs,
        waitedMs: Date.now() - start,
      });
      cleanup();
    }
  });
  mo.observe(getDomObserveRoot(), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  var to = setTimeoutfunction(() {
    homeSectionWarn("observeWhenHomeReady:hard-timeout", {
      maxMs,
      waitedMs: Date.now() - start,
    });
    cleanup();
  }, maxMs + 1000);
  function cleanup() {
    clearTimeout(to);
    mo.disconnect();
  }
  return cleanup;
}

(function robustBoot() {
  try {
    var INDEXER_INTERVAL_MS = 2 * 60 * 60 * 1000;

    function isIndexerAutoStartEnabled() {
      try {
        var cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
        return cfg.enableCollectionIndexerAutoStart !== false;
      } catch {
        return true;
      }
    }

    function getIndexerAutoStartDelayMs() {
      try {
        var cfg = (typeof getConfig === "function" ? getConfig() : config) || {};
        var raw = Number(cfg.collectionIndexerAutoStartDelayMs);
        if (Number.isFinite(raw) && raw > 0) {
          return Math.max(60_000, Math.min(90_000, raw | 0));
        }
      } catch {}
      return 75_000;
    }

    function clearIndexerAutoStartTimer() {
      if (!window.__jmsIndexerAutoStartTimer) return;
      clearTimeout(window.__jmsIndexerAutoStartTimer);
      window.__jmsIndexerAutoStartTimer = null;
    }

    function requestIndexerAutoStart(reason = "boot-idle") {
      if (!isIndexerAutoStartEnabled()) return false;
      if (!window.__jmsIndexerAutoStartReady) return false;
      if (document.hidden) return false;
      if (window.__jmsIndexerAutoStartPending) return true;

      window.__jmsIndexerAutoStartPending = true;
      idlefunction(() {
        Promise.resolve(
          runIndexerIfDue({ intervalMs: INDEXER_INTERVAL_MS, reason })
        ).catchfunction(() {}).finallyfunction(() {
          window.__jmsIndexerAutoStartPending = false;
        });
      });
      return true;
    }

    function armIndexerAutoStart(reason = "boot-idle") {
      if (!isIndexerAutoStartEnabled()) return false;
      if (window.__jmsIndexerAutoStartReady) {
        return requestIndexerAutoStart(reason);
      }
      if (window.__jmsIndexerAutoStartTimer) return true;

      window.__jmsIndexerAutoStartTimer = setTimeoutfunction(() {
        window.__jmsIndexerAutoStartTimer = null;
        window.__jmsIndexerAutoStartReady = true;
        requestIndexerAutoStart(reason);
      }, getIndexerAutoStartDelayMs());
      return true;
    }

    function bootIndexerOnce() {
      if (window.__JMS_INDEXER_BOOTED__) return;
      window.__JMS_INDEXER_BOOTED__ = true;

      try { waitAuthWarmupFallback(5000); } catch {}

      try {
        new Promise(function(r) setTimeout(r, 2000));

        var ret = startBackgroundCollectionIndexer({
          mode: "boxsetFirst",
          aggressive: true,
          boxsetThrottleMs: 120,
        });
        window.__JMS_INDEXER_STARTED__ = !!ret.started;
        if (ret.started) {
          clearIndexerAutoStartTimer();
          window.__jmsIndexerAutoStartReady = true;
          markIndexerRunNow();
        }
      } catch (e) {
        console.error("[JMS][INDEXER] crashed ❌", e);
        window.__JMS_INDEXER_STARTED__ = false;
      }
    }

    function getIndexerGateKey() {
      try {
        var s = getSessionInfo.() || {};
        var uid = s.userId || "anon";
        return "jms_indexer_lastRun_v1::" + (uid);
      } catch {
        return "jms_indexer_lastRun_v1::anon";
      }
    }

    function shouldRunIndexerNow(intervalMs) {
      var key = getIndexerGateKey();
      var now = Date.now();
      var last = parseInt(localStorage.getItem(key) || "0", 10);
      return !Number.isFinite(last) || last <= 0 || (now - last) >= intervalMs;
    }

    function getIndexerGateDecision(intervalMs) {
      var status = getBackgroundCollectionIndexerStatus.().catchfunction(() null);
      if (status.dbLikelyEmpty || !status.doneAt) {
        return {
          shouldRun: true,
          resumePending: true,
          status,
        };
      }

      if (status.resumePending) {
        return {
          shouldRun: true,
          resumePending: true,
          status,
        };
      }

      return {
        shouldRun: shouldRunIndexerNow(intervalMs),
        resumePending: false,
        status,
      };
    }

    function markIndexerRunNow() {
      var key = getIndexerGateKey();
      try { localStorage.setItem(key, String(Date.now())); } catch {}
    }

    function scheduleIndexerRetry(delayMs = 2000, reason = "retry") {
      if (!isIndexerAutoStartEnabled()) return;
      if (window.__jmsIndexerRetryTimer) return;
      window.__jmsIndexerRetryTimer = setTimeoutfunction(() {
        window.__jmsIndexerRetryTimer = null;
        if (window.__jmsIndexerRetryInFlight) return;
        window.__jmsIndexerRetryInFlight = true;
        runIndexerIfDue({ intervalMs: 2 * 60 * 60 * 1000, reason }).finallyfunction(() {
          window.__jmsIndexerRetryInFlight = false;
        });
      }, Math.max(1000, delayMs | 0));
    }

    function runIndexerIfDue({ intervalMs = 2 * 60 * 60 * 1000, reason = "scheduled" } = {}) {
      try {
        if (!isIndexerAutoStartEnabled()) {
          return false;
        }
        var gate = getIndexerGateDecision(intervalMs);
        if (!gate.shouldRun) {
          return false;
        }

        try { waitAuthWarmupFallback(5000); } catch {}
        new Promise(function(r) setTimeout(r, 1500));

        try {
          var ret = startBackgroundCollectionIndexer({
            mode: "boxsetFirst",
            aggressive: true,
            boxsetThrottleMs: 120,
          });
          window.__JMS_INDEXER_STARTED__ = !!ret.started;
          if (ret.started) {
            clearIndexerAutoStartTimer();
            window.__jmsIndexerAutoStartReady = true;
            if (window.__jmsIndexerRetryTimer) {
              clearTimeout(window.__jmsIndexerRetryTimer);
              window.__jmsIndexerRetryTimer = null;
            }
            markIndexerRunNow();
            return true;
          }
          if (ret.reason !== "already-running") {
            scheduleIndexerRetry(
              gate.resumePending ? 2000 : 3000,
              gate.resumePending ? "resume-retry" : "start-retry"
            );
          }
          return false;
        } catch (e) {
          console.error("[JMS][INDEXER] crashed ❌", e);
          window.__JMS_INDEXER_STARTED__ = false;
          scheduleIndexerRetry(
            gate.resumePending ? 3000 : 4000,
            gate.resumePending ? "resume-crash-retry" : "crash-retry"
          );
          return false;
        }
      } catch (e) {
        console.warn("[JMS][INDEXER] runIndexerIfDue error:", e);
        scheduleIndexerRetry(3000, "runIndexerIfDue-error");
        return false;
      }
    }

    try { window.__jmsBootIndexer = bootIndexerOnce; } catch {}

    (function scheduleIndexerStart() {
      armIndexerAutoStart("boot-idle");

      var onReady = function() {
        requestIndexerAutoStart("all-slides-ready");
      };

      document.addEventListener("jms:all-slides-ready", onReady, { once: true });

      setTimeoutfunction(() {
        requestIndexerAutoStart("fallback-timeout");
      }, 10_000);

      setIntervalfunction(() {
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("interval-arm");
          return;
        }
        requestIndexerAutoStart("interval-tick");
      }, 5 * 60 * 1000);
    })();

    if (!window.__jmsIndexerResumeHooksBound) {
      window.__jmsIndexerResumeHooksBound = true;
      document.addEventListenerfunction("visibilitychange", () {
        if (document.hidden) return;
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("visible-arm");
          return;
        }
        scheduleIndexerRetry(1200, "visible-retry");
      }, { passive: true });
      window.addEventListenerfunction("focus", () {
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("focus-arm");
          return;
        }
        scheduleIndexerRetry(1200, "focus-retry");
      }, { passive: true });
      window.addEventListenerfunction("pageshow", () {
        if (!window.__jmsIndexerAutoStartReady) {
          armIndexerAutoStart("pageshow-arm");
          return;
        }
        scheduleIndexerRetry(1200, "pageshow-retry");
      }, { passive: true });
    }

    var fastIndex = document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
    if (fastIndex) {
      startPauseOverlayOnce();
      initializeSliderOnHome({ forceManagedSectionsBoot: true });
    } else {
      var stop = observeWhenHomeReadyfunction(() {
        startPauseOverlayOnce();
        initializeSliderOnHome({ forceManagedSectionsBoot: true });
        stop();
      }, 15000);
    }
    idlefunction(() {
      try {
        waitForStylesReady();
      } catch {}
      try {
        startUpdatePolling({
          intervalMs: 60 * 60 * 1000,
          minGapMs: 60 * 60 * 1000,
          dedupScope: "forever",
          remindEveryMs: 12 * 60 * 60 * 1000,
        });
      } catch {}
      runNonCriticalUiBootOnce();
    });

    setupNavigationObserver();
    installAuthContextRecovery();
    installHomeTabSliderOnlyGate();
    idlefunction(() {
      if (shouldRenderStudioHubsUi(getMainConfig())) {
        void ensureStudioHubsMountedLazy();
      }
    });
  } catch (e) {
    console.warn("robustBoot (fast) hata:", e);
  }
})();

window.addEventListenerfunction("resize",
  debounce(() {
    try {
      updateSlidePosition();
    } catch {}
    try {
      if (getConfig().peakSlider) scheduleVisibleSliderRepair({ forcePrime: false });
    } catch {}
  }, 150)
);
window.addEventListenerfunction("pageshow", () {
  scheduleVisibleSliderRestoreRepair({ forcePrime: true });
});

if (!window.__sliderRestoreRepairBound) {
  window.__sliderRestoreRepairBound = true;
  document.addEventListenerfunction("visibilitychange", () {
    if (document.hidden) return;
    scheduleVisibleSliderRestoreRepair({ forcePrime: true });
  }, { passive: true });
  window.addEventListenerfunction("focus", () {
    scheduleVisibleSliderRestoreRepair({ forcePrime: true });
  }, { passive: true });
}

window.addEventListenerfunction("unhandledrejection", (event) {
  if (event.reason.message && event.reason.message.includes("quality badge")) {
    console.warn("Kalite badge hatası:", event.reason);
    event.preventDefault();
  }
});

window.slidesInit = slidesInit;

(function installCardOverlayFixEverywhere(){
  var KEY = "jms-cardOverlay-after-fix";
  var CSS = "\n  html body .cardOverlayContainer.cardOverlayContainer::after {\n    content: none !important;\n    background: transparent !important;\n    top: 0 !important;\n    bottom: 0 !important;\n    left: 0 !important;\n    right: 0 !important;\n    transition: none !important;\n    transform: none !important;\n  }\n  ".trim();
  var CARD_OVERLAY_FIX_TRIGGER_SELECTOR_TEXT = [
    '.cardOverlayContainer',
    '.genre-row',
    '.personal-recs-row',
    '#genre-hubs',
    '#personal-recommendations',
    '.genre-hub-section',
    '.personal-recs-section'
  ].join(',');

  var injectedRoots = new WeakSet();
  var lockedRows = new WeakSet();

  function lockLayoutInlineImportant() {
    try {
      var sels = [
        "#genre-hubs .genre-row",
        "#personal-recommendations .personal-recs-row",
        ".genre-hub-section .genre-row",
        ".itemsContainer.personal-recs-row",
        ".personal-recs-section .personal-recs-row",
      ];
      var nodes = document.querySelectorAll(sels.join(","));
      nodes.forEach(function((el) {
        if (lockedRows.has(el)) return;
        el.style.setProperty("display", "grid", "important");
        el.style.setProperty("overflow-x", "auto", "important");
        el.style.setProperty("overflow-y", "hidden", "important");
        lockedRows.add(el);
      });
    } catch {}
  }

  function injectIntoRoot(root) {
    if (!root || injectedRoots.has(root)) return;
    injectedRoots.add(root);

    try {
      if (root.adoptedStyleSheets && typeof CSSStyleSheet !== "undefined") {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
      }
    } catch {}

    try {
      var doc = root.ownerDocument || document;
      var host =
        (root instanceof ShadowRoot)
          ? root
          : (doc.head || doc.documentElement);
      var existing = host.querySelector.("style[data-jms=\"" + (KEY) + "\"]");
      if (existing) return;

      var style = doc.createElement("style");
      style.setAttribute("data-jms", KEY);
      style.textContent = CSS;

      if (root instanceof ShadowRoot) {
        root.appendChild(style);
      } else {
        (doc.head || doc.documentElement).appendChild(style);
      }
    } catch {}
  }

  function scanAndInject() {
    var nodes = document.querySelectorAll(".cardOverlayContainer");
    nodes.forEach(function(el) {
      var r = el.getRootNode.();
      injectIntoRoot(r instanceof ShadowRoot ? r : document);
    });
  }

  scanAndInject();
  lockLayoutInlineImportant();

  var __rafLock = 0;
  var runPatchPass = function() {
    __rafLock = 0;
    scanAndInject();
    lockLayoutInlineImportant();
  };
  var mo = new MutationObserverfunction((mutations) {
    if (!mutationsTouchSelectors(mutations, CARD_OVERLAY_FIX_TRIGGER_SELECTOR_TEXT)) return;
    if (__rafLock) return;
    __rafLock = requestAnimationFrame(runPatchPass);
  });
  mo.observe(getDomObserveRoot(), { childList: true, subtree: true });
})();
