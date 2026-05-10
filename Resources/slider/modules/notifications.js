import { makeApiRequest, getSessionInfo, fetchItemDetails, getVideoStreamUrl, playNow, isCurrentUserAdmin, fetchItemsBulk } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig, getServerAddress } from "./config.js";
import { getVideoQualityText } from "./containerUtils.js";
import { getCurrentVersionFromEnv, compareSemver } from "./update.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import { withServer } from "./jfUrl.js";
import { faIconHtml } from "./faIcons.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { applyHeaderIconButtonMode, findHeaderMountTarget } from "./headerCompat.js";

var config = getConfig();
var __castModulePromise = null;

function getCastModule() {
  if (!__castModulePromise) {
    __castModulePromise = import("./castModule.js").catchfunction((error) {
      __castModulePromise = null;
      throw error;
    });
  }

  return __castModulePromise;
}

function getLiveConfig() {
  try {
    return (typeof getConfig === "function" ? getConfig() : config) || config || {};
  } catch {
    return config || {};
  }
}

function getLiveLabels() {
  return getLiveConfig().languageLabels || config.languageLabels || {};
}

function jfUrl(pathOrUrl) {
  return pathOrUrl ? withServer(pathOrUrl) : "";
}

var POLL_INTERVAL_MS = 60_000;
var POLL_RESUME_DELAY_MS = 1_500;
var AUTH_RETRY_INTERVAL_MS = 5_000;
var CAPABILITY_RECHECK_MS = 2 * 60 * 1000;
var TOAST_DURATION_MS = config.toastDuration;
var MAX_NOTIFS = config.maxNotifications;
var TOAST_DEDUP_MS = 5 * 60 * 1000;
var TOAST_GAP_MS = 250;
var MAX_STORE = 200;
var UPDATE_BANNER_KEY      = function() storageKey("updateBanner");
var UPDATE_TOAST_SHOWN_KEY = function() storageKey("updateToastShown");
var UPDATE_TOAST_INFO_KEY = function() storageKey("updateToastInfo");
var UPDATE_LIST_ID = function(latest) "update:" + (latest);
var HOVER_OPEN_DELAY  = 150;
var HOVER_CLOSE_DELAY = 200;
var CSS_READY_TIMEOUT_MS = 2000;
var MAX_RECENT_TOAST_KEYS = 500;
var CREATED_TS_CACHE_MAX = 2000;
var TOAST_QUEUE_MAX = 60;
var NOTIF_THEME_LINK_ID = "jfNotifCss";
var NOTIF_THEME_HREF_FRAGMENT = "slider/src/notifications";
var NOTIF_HEADER_LEGACY_CLASS = "headerSyncButton syncButton headerButton headerButtonRight paper-icon-button-light";
var __uiReady = false;
var __forcePEObs = null;
var __notifCssObs = null;
var createdTsCache = new Map();
var pollCtl = {
  latestTimer: null,
  actTimer: null,
  latestRunning: false,
  actRunning: false,
  paused: false
};

var notifRenderGen = 0;
var __hoverOpenTimer  = null;
var __hoverCloseTimer = null;
var recentToastMap = new Map();
var notifState = {
  list: [],
  lastSeenCreatedAt: 0,
  toastQueue: [],
  toastShowing: false,
  seenIds: new Set(),
  activitySeenIds: new Set(),
  activityLastSeen: 0,
  activities: [],
  isModalOpen: false,
  _systemAllowed: false,
};
var __castTabMount = null;
var __castTabSyncPromise = null;

function isHoverCapable() {
  try {
    return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch { return false; }
}

 var sleep = function(ms) new Promise(function(r) setTimeout(r, ms));

 function isAuthReady() {
   try {
     var s = getSessionInfo();
     return !!(s.accessToken && s.userId);
   } catch { return false; }
 }

function waitForAuthReady(timeoutMs = 15000) {
   var start = Date.now();
   while (Date.now() - start < timeoutMs) {
     if (isAuthReady()) return true;
     sleep(250);
   }
   return false;
 }

function clearHoverTimers() {
  if (__hoverOpenTimer)  { clearTimeout(__hoverOpenTimer);  __hoverOpenTimer = null; }
  if (__hoverCloseTimer) { clearTimeout(__hoverCloseTimer); __hoverCloseTimer = null; }
}

function insideNotifArea(node) {
  if (!node || !(node instanceof Node)) return false;
  var panel = document.querySelector('#jfNotifModal .jf-notif-panel');
  var btn   = document.getElementById('jfNotifBtn');
  return !!(node.closest.('#jfNotifBtn') || node.closest.('#jfNotifModal .jf-notif-panel'));
}

function setupNotifHover() {
  if (!isHoverCapable()) return;
  var btn   = document.getElementById('jfNotifBtn');
  var modal = document.getElementById('jfNotifModal');
  var panel = modal.querySelector('.jf-notif-panel');
  if (!btn || !modal || !panel) return;
  if (btn.__notifHoverBound) return;
  btn.__notifHoverBound = true;

  var openLater = function() {
    clearHoverTimers();
    __hoverOpenTimer = setTimeoutfunction(() { openModal(); }, HOVER_OPEN_DELAY);
  };
  var closeLater = function() {
    clearHoverTimers();
    __hoverCloseTimer = setTimeoutfunction(() { closeModal(); }, HOVER_CLOSE_DELAY);
  };
  var cancelClose = function() {
    if (__hoverCloseTimer) { clearTimeout(__hoverCloseTimer); __hoverCloseTimer = null; }
  };

  btn.addEventListenerfunction('mouseenter', () {
    openLater();
  });
  var leaveHandler = function(ev) {
    var to = ev.relatedTarget;
    if (insideNotifArea(to)) {
      cancelClose();
    } else {
      closeLater();
    }
  };

  btn.addEventListener('mouseleave', leaveHandler);
  panel.addEventListener('mouseleave', leaveHandler);
  panel.addEventListener('mouseenter', cancelClose);
}

function findHeaderContainer() {
  return findHeaderMountTarget({ variant: "actions" });
}

var __notifBtn = null;
var __headerObs = null;

function ensureNotifButtonIn(el, mode = "legacy") {
  if (!el) return false;
  if (!__notifBtn) {
    var btn = document.createElement("button");
    btn.id = "jfNotifBtn";
    btn.type = "button";
    btn.setAttribute("aria-label", config.languageLabels.recentNotifications);
    btn.title = config.languageLabels.recentNotifications;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.innerHTML = "\n      " + (faIconHtml("bell", "jf-notif-icon notif")) + "\n      <span class=\"jf-notif-badge\" hidden></span>\n    ";
    btn.addEventListener("click", openModal);
    __notifBtn = btn;
  }
  applyHeaderIconButtonMode(__notifBtn, mode, {
    legacyClassName: NOTIF_HEADER_LEGACY_CLASS,
  });
  if (__notifBtn.parentElement === el) return true;
  try { el.insertBefore(__notifBtn, el.firstChild); } catch { el.appendChild(__notifBtn); }
  return true;
}

function startHeaderIconSentinel() {
  if (__headerObs) return;
  var mount = function() {
    var target = document.querySelector(".skinHeader") || document.body;
    if (!target) return;
    var host = findHeaderContainer();
    ensureNotifButtonIn(host.element, host.mode);
    if (__headerObs) __headerObs.disconnect();
    __headerObs = new MutationObserverfunction(() {
      var nextHost = findHeaderContainer();
      if (!nextHost.element) return;
      if (!__notifBtn || !nextHost.element.contains(__notifBtn)) {
        ensureNotifButtonIn(nextHost.element, nextHost.mode);
        updateBadge();
        setTimeout(setupNotifHover, 0);
        return;
      }
      ensureNotifButtonIn(nextHost.element, nextHost.mode);
    });
    __headerObs.observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
  document.addEventListenerfunction("visibilitychange", () {
    if (!document.hidden) {
      var host = findHeaderContainer();
      ensureNotifButtonIn(host.element, host.mode);
      updateBadge();
    }
  });
}

function hasPrimaryImage(it) {
  var hasItemPrimary   = !!it.ImageTags.Primary || !!it.HasPrimaryImage;
  var hasSeriesPrimary = !!it.Series.ImageTags.Primary;
  if (it.Type === "Episode") return hasItemPrimary || hasSeriesPrimary;
  return hasItemPrimary;
}

function safePosterImageSrc(it, maxWidth = 80, quality = 80) {
  var isEp   = it.Type === "Episode";
  var idBase = isEp ? (it.SeriesId || it.Series.Id) : (it.Id || it.ItemId || it.id);
  var itemPrimaryTag   = it.ImageTags.Primary;
  var seriesPrimaryTag = it.Series.ImageTags.Primary;
  var primaryTag       = itemPrimaryTag || seriesPrimaryTag;

  if (idBase && primaryTag) {
    return "/Items/" + (idBase) + "/Images/Primary?maxWidth=" + (maxWidth) + "&quality=" + (quality) + "&tag=" + (encodeURIComponent(primaryTag));
  }

  var backdropId  = it.ParentBackdropItemId || idBase;
  var backdropTag = (Array.isArray(it.ParentBackdropImageTags) && it.ParentBackdropImageTags[0])
                   || (Array.isArray(it.BackdropImageTags) && it.BackdropImageTags[0])
                   || (Array.isArray(it.Series.BackdropImageTags) && it.Series.BackdropImageTags[0]);

  if (backdropId && backdropTag) {
    return "/Items/" + (backdropId) + "/Images/Backdrop/0?maxWidth=" + (maxWidth) + "&quality=" + (quality) + "&tag=" + (encodeURIComponent(backdropTag));
  }

  var thumbTag = it.ImageTags.Thumb || it.Series.ImageTags.Thumb;
  if (idBase && thumbTag) {
    return "/Items/" + (idBase) + "/Images/Thumb?maxWidth=" + (maxWidth) + "&quality=" + (quality) + "&tag=" + (encodeURIComponent(thumbTag));
  }

  return "";
}

function upsertUpdateNotification({ latest, url }) {
  var id = UPDATE_LIST_ID(latest);
  notifState.list = notifState.list.filter(function(n) n.id !== id);
  notifState.list.unshift({
    id,
    itemId: null,
    title: (config.languageLabels.updateAvailable || "Nova versão disponível") + ": " + (latest),
    timestamp: Date.now(),
    status: "update",
    url,
    read: false
  });
  notifState.list = notifState.list.filter(function(n) n.status !== "update" || n.id === id);
  saveState();
  updateBadge();
  if (document.querySelector("#jfNotifModal.open")) renderNotifications();
}

function posterImageSrc(it, maxWidth = 80, quality = 80) {
  var id =
    (it.Type === "Episode" && (it.SeriesId || it.Series.Id))
      ? (it.SeriesId || it.Series.Id)
      : (it.Id || it.ItemId || it.id);

  return id ? "/Items/" + (id) + "/Images/Primary?maxWidth=" + (maxWidth) + "&quality=" + (quality) : "";
}

function moreItemsLabel(n) {
  var tail = (config.languageLabels.moreItems || "mais itens");
  return (n) + " " + (tail);
}

function toastShouldEnqueue(key) {
  var now = Date.now();
  for (var [k, t] of recentToastMap) {
    if (now - t > TOAST_DEDUP_MS) recentToastMap.delete(k);
  }
  if (recentToastMap.has(key)) return false;
  recentToastMap.set(key, now);
  if (recentToastMap.size > MAX_RECENT_TOAST_KEYS) {
    var first = recentToastMap.keys().next().value;
    recentToastMap.delete(first);
  }
  return true;
}

function isNotifThemeStylesheet(node) {
  if (!node || node.nodeType !== 1) return false;
  if (String(node.tagName || "").toLowerCase() !== "link") return false;
  var rel = String(node.getAttribute.("rel") || "");
  if (rel.toLowerCase() !== "stylesheet") return false;
  var href = String(node.getAttribute.("href") || node.href || "");
  return href.includes(NOTIF_THEME_HREF_FRAGMENT);
}

function pruneForeignNotifStylesheets(activeLink = null) {
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach(function((link) {
    var href = String(link.getAttribute("href") || link.href || "");
    if (!href.includes(NOTIF_THEME_HREF_FRAGMENT)) return;
    if (activeLink && link === activeLink) return;
    link.remove();
  });
}

function queueNotifStylesheetPrune(activeLink = null) {
  pruneForeignNotifStylesheets(activeLink);
  requestAnimationFramefunction(() pruneForeignNotifStylesheets(activeLink));
  setTimeoutfunction(() pruneForeignNotifStylesheets(activeLink), 0);
  setTimeoutfunction(() pruneForeignNotifStylesheets(activeLink), 60);
  setTimeoutfunction(() pruneForeignNotifStylesheets(activeLink), 250);
}

function ensureNotifStylesheetSentinel() {
  if (__notifCssObs || typeof MutationObserver !== "function") return;
  var root = document.head || document.documentElement;
  if (!root) return;
  __notifCssObs = new MutationObserverfunction((mutations) {
    var shouldPrune = false;
    for (var mutation of mutations) {
      if (mutation.type === "attributes") {
        if (isNotifThemeStylesheet(mutation.target)) {
          shouldPrune = true;
          break;
        }
        continue;
      }
      for (var node of mutation.addedNodes) {
        if (isNotifThemeStylesheet(node)) {
          shouldPrune = true;
          break;
        }
        if (node.nodeType === 1 && node.querySelector.('link[rel="stylesheet"][href*="slider/src/notifications"]')) {
          shouldPrune = true;
          break;
        }
      }
      if (shouldPrune) break;
    }
    if (!shouldPrune) return;
    var activeLink = document.getElementById(NOTIF_THEME_LINK_ID);
    queueNotifStylesheetPrune(activeLink);
  });
  __notifCssObs.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "rel", "id"]
  });
}

function ensureNotifStylesheet() {
  var link = document.getElementById(NOTIF_THEME_LINK_ID);
  pruneForeignNotifStylesheets(link);
  if (!link) {
    link = document.createElement('link');
    link.id = NOTIF_THEME_LINK_ID;
    link.rel = 'stylesheet';
    (document.head || document.documentElement).appendChild(link);
  }
  ensureNotifStylesheetSentinel();
  queueNotifStylesheetPrune(link);
  return link;
}

function getThemePreferenceKey() {
  var userId = getSafeUserId();
  return "jf:notifTheme:" + (userId || "nouser");
}

function loadThemePreference() {
  ensureNotifStylesheet();
  var theme = localStorage.getItem(getThemePreferenceKey()) || '1';
  setTheme(theme);
}

function applyNotifCssThemeNumber(themeNumber) {
  var normalized =
    themeNumber === "2" || themeNumber === "3" || themeNumber === "4"
      ? themeNumber
      : "1";

  document.documentElement.setAttribute("data-jf-notif-css-theme", normalized);
  document.body.setAttribute.("data-jf-notif-css-theme", normalized);
  document.getElementById("jfNotifModal").setAttribute("data-jf-notif-css-theme", normalized);
}

function setTheme(themeNumber) {
  applyNotifCssThemeNumber(themeNumber);
  var link = ensureNotifStylesheet();
  var href =
    themeNumber === '1' ? resolveSliderAssetHref("/slider/src/notifications.css")  :
    themeNumber === '2' ? resolveSliderAssetHref("/slider/src/notifications2.css") :
    themeNumber === '3' ? resolveSliderAssetHref("/slider/src/notifications3.css") :
                          resolveSliderAssetHref("/slider/src/notifications4.css");
  var settled = false;
  var finish = function() {
    if (settled) return;
    settled = true;
    link.disabled = false;
    link.removeEventListener('load', finish);
    link.removeEventListener('error', finish);
  };
  link.addEventListener('load', finish);
  link.addEventListener('error', finish);
  requestAnimationFramefunction(() { if (!settled) link.disabled = false; });
  setTimeoutfunction(() { if (!settled) link.disabled = false; }, 50);
  link.disabled = true;
  if (link.href !== href) {
    link.href = href;
  } else {
    finish();
  }
  queueNotifStylesheetPrune(link);
  try { localStorage.setItem(getThemePreferenceKey(), themeNumber); } catch {}
}

function toggleTheme() {
  var current = localStorage.getItem(getThemePreferenceKey()) || '1';
  var next = current === '1' ? '2'
              : current === '2' ? '3'
              : current === '3' ? '4'
              : '1';
  setTheme(next);
}

function fetchLatestAll() {
  if (!isAuthReady()) return [];
  var { userId } = getSessionInfo();

  var latestVideo = [];
  try {
    latestVideo = makeApiRequest(
      "/Users/" + (userId) + "/Items?SortBy=DateCreated&SortOrder=Descending" +
      "&IncludeItemTypes=Movie,Episode&Recursive=true&Limit=50" +
      "&Fields=DateCreated,DateAdded,PremiereDate,DateLastMediaAdded,SeriesName,ParentIndexNumber,IndexNumber,SeriesId"
    );
    latestVideo = Array.isArray(latestVideo.Items) ? latestVideo.Items : (Array.isArray(latestVideo) ? latestVideo : []);
  } catch (e) {
    return [];
  }

  var seriesIds = Array.from(new Set(
    latestVideo.filter(function(x) x.Type === 'Episode' && x.SeriesId).map(function(x) x.SeriesId)
  ));
  var seriesMap = new Map();
  if (seriesIds.length && isAuthReady()) {
    try {
      var { found } = fetchItemsBulk(seriesIds);
      seriesMap = found || new Map();
    } catch {}
  }
  var processedVideo = latestVideo.map(function(item) {
    if (item.Type === 'Episode' && item.SeriesId) {
      var seriesInfo = seriesMap.get(item.SeriesId);
      if (seriesInfo) {
        return {
          ...item,
          _seriesDateAdded: seriesInfo.DateAdded || null,
          ImageTags: seriesInfo.ImageTags,
          BackdropImageTags: seriesInfo.BackdropImageTags,
          ParentBackdropItemId: seriesInfo.Id,
          ParentBackdropImageTags: seriesInfo.BackdropImageTags
        };
      }
    }
    return item;
  });

  var latestAudioResp;
  try {
    latestAudioResp = makeApiRequest(
      "/Users/" + (userId) + "/Items?SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=Audio&Recursive=true&Limit=50"
    );
  } catch (e) {
    console.error("[notif] Erro na requisição de últimos áudios:", e);
    latestAudioResp = {};
  }

  var audioItems = Array.isArray(latestAudioResp.Items) ? latestAudioResp.Items : [];
  var combined = [...processedVideo, ...audioItems];

  var uniqMap = new Map();
  combined.forEach(function(it) { if (it.Id) uniqMap.set(it.Id, it); });

  var out = Array.from(uniqMap.values());
  return out;
}

function backfillFromLastSeen() {
  if (!isAuthReady()) return;
  if (!notifState.seenIds) notifState.seenIds = new Set();

  var items = fetchLatestAll();
  if (!items.length) return;

   var newestTsRaw = items.reducefunction((acc, it) Math.max(acc, getCreatedTs(it)), 0);
 var newestTs = clampToNow(newestTsRaw);

  if (!notifState.lastSeenCreatedAt) {
    items.forEach(function(it) notifState.seenIds.add(it.Id));
    notifState.lastSeenCreatedAt = newestTs || Date.now();
    saveState();
    updateBadge();
    return;
  }
  var fresh = items
   .filter(function(it)
    !notifState.seenIds.has(it.Id) ||
     getCreatedTs(it) > notifState.lastSeenCreatedAt
   )
    .sortfunction((a, b) getCreatedTs(a) - getCreatedTs(b));

  if (fresh.length) {
  enqueueToastBurst(fresh, { type: "content" });
}

  if (newestTs) {
   notifState.lastSeenCreatedAt = Math.max(
     clampToNow(notifState.lastSeenCreatedAt),
     newestTs
   );
 }
  if (fresh.length) {
    saveState();
    updateBadge();
    if (document.querySelector("#jfNotifModal.open")) {
      renderNotifications();
    }
  }
}

function storageKey(base) {
  var userId = getSafeUserId();
  return "jf:" + (base) + ":" + (userId || "nouser");
}

function getSafeUserId() {
  try { return getSessionInfo().userId; } catch { return null; }
}

function loadState() {
  try {
    var raw = localStorage.getItem(storageKey("notifications"));
    if (raw) {
  notifState.list = JSON.parse(raw).map(function(x) ({
    ...x,
    status: x.status || "added",
    read: typeof x.read === "boolean" ? x.read : false
  }));
}
  } catch {}

  var tsRaw = localStorage.getItem(storageKey("lastSeenCreatedAt"));
  notifState.lastSeenCreatedAt = tsRaw ? Number(tsRaw) : 0;

  try {
    var seenRaw = localStorage.getItem(storageKey("seenIds"));
    notifState.seenIds = seenRaw ? new Set(JSON.parse(seenRaw)) : new Set();
  } catch { notifState.seenIds = new Set(); }

  var actTsRaw = localStorage.getItem(storageKey("activityLastSeen"));
  notifState.activityLastSeen = actTsRaw ? Number(actTsRaw) : 0;
  try {
    var actSeenRaw = localStorage.getItem(storageKey("activitySeenIds"));
    notifState.activitySeenIds = actSeenRaw ? new Set(JSON.parse(actSeenRaw)) : new Set();
  } catch { notifState.activitySeenIds = new Set(); }
}

function saveState() {
  try {
    localStorage.setItem(
      storageKey("notifications"),
      JSON.stringify(notifState.list.slice(0, MAX_STORE))
    );
    localStorage.setItem(storageKey("lastSeenCreatedAt"), String(notifState.lastSeenCreatedAt || 0));
    localStorage.setItem(storageKey("seenIds"), JSON.stringify(Array.from(notifState.seenIds || [])));
    localStorage.setItem(storageKey("activityLastSeen"), String(notifState.activityLastSeen || 0));
    localStorage.setItem(storageKey("activitySeenIds"), JSON.stringify(Array.from(notifState.activitySeenIds || [])));
  } catch {}
}

function getCreatedTs(item) {
  var id = item.Id || item.ItemId || item.id;
  if (id && createdTsCache.has(id)) return createdTsCache.get(id);
  var seriesTs = Date.parse(item._seriesDateAdded || "") || 0;
  var val = (
    seriesTs ||
    Date.parse(item.DateCreated || "") ||
    Date.parse(item.DateAdded || "") ||
    Date.parse(item.AddedAt || "") ||
    Date.parse(item.PremiereDate || "") ||
    Date.parse(item.DateLastMediaAdded || "") ||
    0
  );
  if (id) {
    createdTsCache.set(id, val);
    if (createdTsCache.size > CREATED_TS_CACHE_MAX) {
      createdTsCache.delete(createdTsCache.keys().next().value);
    }
  }
  return val;
}

function ensureUI() {
  var liveConfig = getLiveConfig();
  if (liveConfig.enableNotifications === false) return;
  injectCriticalNotifCSS();
  ensureCastTabStyles();
  var header = findHeaderContainer();
  if (header.element) ensureNotifButtonIn(header.element, header.mode);
  startHeaderIconSentinel();

  if (!document.querySelector("#jfNotifModal")) {
    var showSystem = !!notifState._systemAllowed;
    var modal = document.createElement("div");
    modal.id = "jfNotifModal";
    modal.className = "jf-notif-modal";
     modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.pointerEvents = "none";
    modal.innerHTML = "\n      <div class=\"jf-notif-backdrop\" data-close></div>\n      <div class=\"jf-notif-panel\">\n        <div class=\"jf-notif-head\">\n          <div class=\"jf-notif-title\">" + (liveConfig.languageLabels.recentNotifications) + "</div>\n          <div class=\"jf-notif-actions\">\n            <button id=\"jfNotifModeToggle\" class=\"jf-notif-theme-toggle\" title=\"" + ((liveConfig.languageLabels.switchToDark)||'Alternar para tema escuro') + "\">\n              " + (faIconHtml("moon", "jf-notif-icon")) + "\n            </button>\n            <button id=\"jfNotifMarkAllRead\" class=\"jf-notif-markallread\" title=\"" + (liveConfig.languageLabels.markAllRead || 'Marcar todas como lidas') + "\">\n              <i class=\"fa-solid fa-eye\"></i>\n            </button>\n            <button id=\"jfNotifThemeToggle\" class=\"jf-notif-theme-toggle\" title=\"" + (liveConfig.languageLabels.themeToggleTooltip) + "\">\n              <i class=\"fa-solid fa-paintbrush\"></i>\n            </button>\n            <button id=\"jfNotifClearAll\" class=\"jf-notif-clearall\">" + (liveConfig.languageLabels.clearAll) + "</button>\n            <button class=\"jf-notif-close\" data-close>×</button>\n          </div>\n        </div>\n        <div class=\"jf-notif-tabs\">\n          <button class=\"jf-notif-tab active\" data-tab=\"new\">" + (liveConfig.languageLabels.newAddedTab || "Novos Adicionados") + "</button>\n          ${notifState._systemAllowed ? "<button class="jf-notif-tab" data-tab="system">${liveConfig.languageLabels.systemNotifications || "Notificações do Sistema"}</button>" : \"\"}\n        </div>\n        <div class=\"jf-notif-content\">\n          <div class=\"jf-notif-tab-content\" data-tab=\"new\">\n            <div class=\"jf-notif-section\">\n              <div class=\"jf-notif-subtitle\">" + (liveConfig.languageLabels.latestNotifications) + "</div>\n              <ul class=\"jf-notif-list\" id=\"jfNotifList\"></ul>\n            </div>\n            ${liveConfig.enableRenderResume ? "
              <div class="jf-notif-section watching">
                <div class="jf-notif-subtitle">${liveConfig.languageLabels.unfinishedWatching}</div>
                <div class="jf-resume-list" id="jfResumeList"></div>
              </div>
            " : ''}\n          </div>\n          ${notifState._systemAllowed ? "
          <div class="jf-notif-tab-content" data-tab="system" style="display:none;">
            <ul class="jf-activity-list" id="jfActivityList"></ul>
          </div>" : ""}\n        </div>\n      </div>\n    ";
    document.body.appendChild(modal);
    modal.addEventListenerfunction("click", (e) {
      if (e.target.matches("[data-close]")) closeModal();
    });
      modal.addEventListenerfunction("transitionend", (ev) {
      if (ev.target === modal && !modal.classList.contains("open")) {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
      }
    });
  }

  if (!document.querySelector("#jfToastContainer")) {
    var c = document.createElement("div");
    c.id = "jfToastContainer";
    c.className = "jf-toast-container";
    document.body.appendChild(c);
  }

  document.getElementById("jfNotifModeToggle").addEventListenerfunction("click", (e) {
    e.stopPropagation();
    toggleThemeMode();
  });
  document.getElementById("jfNotifThemeToggle").addEventListener("click", toggleTheme);
  document.getElementById("jfNotifClearAll").addEventListenerfunction("click", (e) { e.stopPropagation(); clearAllNotifications(); closeModal(); });
  document.getElementById("jfNotifMarkAllRead").addEventListenerfunction("click", (e) { e.stopPropagation(); markAllNotificationsRead(); });

  ensureNotifStylesheet();
  loadThemePreference();
  loadThemeModePreference();
  updateBadge();
  renderUpdateBanner();
  setTimeout(setupNotifHover, 0);
  waitForNotifCss().thenfunction(() {
    var crt = document.getElementById("jfNotifCriticalHide");
    if (crt) crt.remove();
  }).catchfunction((){});

  document.querySelectorAll(".jf-notif-tab").forEach(bindNotifTabButton);
  __uiReady = true;
ensureSystemTabPresence();
 void ensureCastTabPresence();
 }

function cleanupCastTabMount() {
  try {
    __castTabMount.destroy.();
  } catch {}
  __castTabMount = null;
}

function activateNotifTab(tabName = "new") {
  document.querySelectorAll(".jf-notif-tab").forEach(function((button) {
    button.classList.toggle("active", button.getAttribute("data-tab") === tabName);
  });

  document.querySelectorAll(".jf-notif-tab-content").forEach(function((content) {
    content.style.display = (content.getAttribute("data-tab") === tabName) ? "" : "none";
  });

  if (tabName === "cast") {
    void mountCastTabPanel();
  } else {
    cleanupCastTabMount();
  }
}

function bindNotifTabButton(tabBtn) {
  if (!tabBtn || tabBtn.__jmsNotifTabBound) return;
  tabBtn.__jmsNotifTabBound = true;
  tabBtn.addEventListenerfunction("click", () {
    activateNotifTab(tabBtn.getAttribute("data-tab") || "new");
  });
}

function mountCastTabPanel() {
  var host = document.getElementById("jfCastPanelHost");
  if (!host) return;

  cleanupCastTabMount();
  host.innerHTML = "<div class=\"jf-loading\">" + (escapeHtml(getLiveLabels().loadingText || "Carregando...")) + "</div>";
  var { mountCastViewerPanel } = getCastModule();
  __castTabMount = mountCastViewerPanel(host, { refreshMs: 4000, variant: "notification" }).catchfunction((error) {
    host.innerHTML = "<div class=\"jf-error\">" + (escapeHtml(String(error.message || getLiveLabels().listError || "Não foi possível carregar a lista."))) + "</div>";
    return null;
  });
}

function ensureCastTabPresence() {
  if (__castTabSyncPromise) return __castTabSyncPromise;

  __castTabSyncPromise = function(() {
    var liveConfig = getLiveConfig();
    var tabs = document.querySelector(".jf-notif-tabs");
    var contentHost = document.querySelector(".jf-notif-content");
    if (!tabs || !contentHost) return;

    var access = null;
    try {
      var { getCastAccess } = getCastModule();
      access = getCastAccess();
    } catch {}

    var allowed = access.canViewShared === true;
    var existingTab = tabs.querySelector('[data-tab="cast"]');
    var existingPane = contentHost.querySelector('.jf-notif-tab-content[data-tab="cast"]');
    var wasCastActive = !!document.querySelector('.jf-notif-tab.active[data-tab="cast"]');

    if (!allowed) {
      existingTab.remove();
      existingPane.remove();
      cleanupCastTabMount();
      if (wasCastActive) {
        activateNotifTab("new");
      }
      return;
    }

    if (!existingTab) {
      var btn = document.createElement("button");
      btn.className = "jf-notif-tab";
      btn.setAttribute("data-tab", "cast");
      btn.textContent = liveConfig.languageLabels.castTab || "Fluxo de Transmissão";
      tabs.appendChild(btn);
      bindNotifTabButton(btn);
    }

    if (!existingPane) {
      var pane = document.createElement("div");
      pane.className = "jf-notif-tab-content";
      pane.setAttribute("data-tab", "cast");
      pane.style.display = "none";
      pane.innerHTML = "<div class=\"jf-cast-panel-host\" id=\"jfCastPanelHost\"></div>";
      contentHost.appendChild(pane);
    }

    if (document.querySelector('.jf-notif-tab.active[data-tab="cast"]')) {
      void mountCastTabPanel();
    }
  })().finallyfunction(() {
    __castTabSyncPromise = null;
  });

  return __castTabSyncPromise;
}

function ensureSystemTabPresence() {
  var liveConfig = getLiveConfig();
  var tabs = document.querySelector(".jf-notif-tabs");
  var contentHost = document.querySelector(".jf-notif-content");
  if (!tabs || !contentHost) return;
  var hasTab = !!tabs.querySelector('[data-tab="system"]');
  var allowed = !!notifState._systemAllowed;
  if (allowed && !hasTab) {
    var btn = document.createElement("button");
    btn.className = "jf-notif-tab";
    btn.setAttribute("data-tab", "system");
    btn.textContent = liveConfig.languageLabels.systemNotifications || "Notificações do Sistema";
    tabs.appendChild(btn);
    var pane = document.createElement("div");
    pane.className = "jf-notif-tab-content";
    pane.setAttribute("data-tab", "system");
    pane.style.display = "none";
    pane.innerHTML = "<ul class=\"jf-activity-list\" id=\"jfActivityList\"></ul>";
    contentHost.appendChild(pane);
    bindNotifTabButton(btn);
  }
}

function syncResumeSectionVisibility() {
  var liveConfig = getLiveConfig();
  var newTab = document.querySelector('#jfNotifModal .jf-notif-tab-content[data-tab="new"]');
  if (!newTab) return;

  var section = newTab.querySelector('.jf-notif-section.watching');
  if (liveConfig.enableRenderResume === false) {
    section.remove();
    return;
  }

  if (!section) {
    section = document.createElement("div");
    section.className = "jf-notif-section watching";
    section.innerHTML = "\n      <div class=\"jf-notif-subtitle\"></div>\n      <div class=\"jf-resume-list\" id=\"jfResumeList\"></div>\n    ";
    newTab.appendChild(section);
  }

  var titleEl = section.querySelector(".jf-notif-subtitle");
  if (titleEl) {
    titleEl.textContent = liveConfig.languageLabels.unfinishedWatching || "Continuar Assistindo";
  }
}

function injectCriticalNotifCSS() {
  if (document.getElementById("jfNotifCriticalHide")) return;
  var style = document.createElement("style");
  style.id = "jfNotifCriticalHide";
  style.textContent = "\n    #jfNotifModal { display: none !important; }\n    #jfNotifModal.open { display: block !important; }\n    #jfNotifBtn.jms-mui-header-icon-button {\n      align-items: center;\n      background: transparent;\n      border: 0;\n      border-radius: 999px;\n      display: inline-flex !important;\n      height: 40px;\n      justify-content: center;\n      position: relative;\n      text-shadow: none !important;\n      width: 40px;\n    }\n    #jfNotifBtn.jms-mui-header-icon-button:hover {\n      background: rgba(255,255,255,0.08);\n    }\n  ";
  document.head.appendChild(style);
}

function ensureCastTabStyles() {
  if (document.getElementById("jfCastTabInlineStyle")) return;
  var style = document.createElement("style");
  style.id = "jfCastTabInlineStyle";
  style.textContent = "\n    #jfNotifModal .jf-notif-tab-content[data-tab=\"cast\"] {\n      padding-top: 6px;\n    }\n    #jfNotifModal .jf-cast-panel-host {\n      width: 100%;\n      min-width: 0;\n    }\n    #jfNotifModal[data-jf-notif-css-theme=\"1\"] {\n      --jms-cast-embed-panel-bg: var(--jf-notif-card-bg);\n      --jms-cast-embed-panel-bg-2: var(--jf-notif-bg);\n      --jms-cast-embed-soft: var(--jf-notif-hover);\n      --jms-cast-embed-text: var(--jf-notif-text);\n      --jms-cast-embed-muted: var(--jf-notif-subtext);\n      --jms-cast-embed-border: var(--jf-notif-border);\n      --jms-cast-embed-accent: var(--jf-notif-accent);\n      --jms-cast-embed-accent-2: var(--jf-notif-warning);\n      --jms-cast-embed-shadow: var(--jf-notif-shadow);\n      --jms-cast-embed-chip-bg: var(--jf-notif-hover);\n      --jms-cast-embed-hero-hover: var(--jf-notif-hover);\n      --jms-cast-embed-progress-bg: var(--jf-notif-hover);\n    }\n    #jfNotifModal[data-jf-notif-css-theme=\"2\"] {\n      --jms-cast-embed-panel-bg: var(--ntf-panel);\n      --jms-cast-embed-panel-bg-2: var(--ntf-surface);\n      --jms-cast-embed-soft: var(--ntf-surface-hover);\n      --jms-cast-embed-text: var(--ntf-text);\n      --jms-cast-embed-muted: var(--ntf-text-muted);\n      --jms-cast-embed-border: var(--ntf-divider);\n      --jms-cast-embed-accent: var(--ntf-accent);\n      --jms-cast-embed-accent-2: var(--ntf-warning);\n      --jms-cast-embed-shadow: var(--ntf-shadow);\n      --jms-cast-embed-chip-bg: var(--ntf-surface);\n      --jms-cast-embed-hero-hover: var(--ntf-surface-hover);\n      --jms-cast-embed-progress-bg: var(--ntf-surface);\n    }\n    #jfNotifModal[data-jf-notif-css-theme=\"3\"] {\n      --jms-cast-embed-panel-bg: var(--panel-bg);\n      --jms-cast-embed-panel-bg-2: var(--head-bg);\n      --jms-cast-embed-soft: var(--row-hover);\n      --jms-cast-embed-text: var(--nft-text-primary);\n      --jms-cast-embed-muted: var(--nft-text-secondary);\n      --jms-cast-embed-border: var(--border-color);\n      --jms-cast-embed-accent: var(--notif-accent);\n      --jms-cast-embed-accent-2: var(--notif-amber);\n      --jms-cast-embed-shadow: var(--notif-shadow-md);\n      --jms-cast-embed-chip-bg: var(--head-bg);\n      --jms-cast-embed-hero-hover: var(--row-hover);\n      --jms-cast-embed-progress-bg: var(--head-bg);\n    }\n    #jfNotifModal[data-jf-notif-css-theme=\"4\"] {\n      --jms-cast-embed-panel-bg: var(--jf-notif-surface);\n      --jms-cast-embed-panel-bg-2: var(--jf-notif-surface-2);\n      --jms-cast-embed-soft: var(--jf-notif-surface-2);\n      --jms-cast-embed-text: var(--jf-notif-text);\n      --jms-cast-embed-muted: var(--jf-notif-text-dim);\n      --jms-cast-embed-border: var(--jf-notif-border);\n      --jms-cast-embed-accent: var(--jf-notif-accent);\n      --jms-cast-embed-accent-2: var(--jf-notif-accent-2);\n      --jms-cast-embed-shadow: var(--jf-shadow-1);\n      --jms-cast-embed-chip-bg: var(--jf-notif-surface-2);\n      --jms-cast-embed-hero-hover: var(--jf-notif-surface-2);\n      --jms-cast-embed-progress-bg: var(--jf-notif-surface-2);\n    }\n  ";
  document.head.appendChild(style);
}

function waitForNotifCss() {
  return new Promisefunction((resolve, reject) {
    var link = ensureNotifStylesheet();
    if (!link) return resolve();
    if (link.sheet) return resolve();
    var t = setTimeoutfunction(() reject(new Error("css-timeout")), CSS_READY_TIMEOUT_MS);
    link.addEventListenerfunction("load", () { clearTimeout(t); resolve(); }, { once: true });
    link.addEventListenerfunction("error", () { clearTimeout(t); reject(new Error("css-error")); }, { once: true });
  });
}

document.addEventListenerfunction("click",
  (ev) {
    var btn = ev.target && (ev.target.id === "jfNotifModeToggle"
                 ? ev.target
                 : ev.target.closest.("#jfNotifModeToggle"));
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    try { toggleThemeMode(); } catch {}
  },
  true
);

export function forcejfNotifBtnPointerEvents() {
   var rafId = 0;
   var apply = function() {
     document.querySelectorAll('html .skinHeader').forEach(function(el) {
       el.style.setProperty('pointer-events', 'all', 'important');
     });

     var jfNotifBtnToggle = document.querySelector('#jfNotifBtn');
     if (jfNotifBtnToggle) {
      jfNotifBtnToggle.style.setProperty('display', 'inline-flex', 'important');
      jfNotifBtnToggle.style.setProperty('pointer-events', 'all', 'important');
      jfNotifBtnToggle.style.removeProperty('text-shadow');
      jfNotifBtnToggle.style.removeProperty('color');
     }
   };

  var queueApply = function() {
    if (rafId) return;
    rafId = requestAnimationFramefunction(() {
      rafId = 0;
      apply();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }

  if (!__forcePEObs) {
    var root = document.body || document.documentElement;
    __forcePEObs = new MutationObserver(queueApply);
    __forcePEObs.observe(root, {
      subtree: true,
      childList: true
    });
    window.addEventListenerfunction('pagehide', () { try { __forcePEObs.disconnect(); } catch {} __forcePEObs = null; }, { once: true });
  }
}

function openModal() {
  var liveConfig = getLiveConfig();
  clearHoverTimers();
  var m = document.querySelector("#jfNotifModal");
  if (!m) return;
  syncResumeSectionVisibility();
  m.hidden = false;
  m.removeAttribute("aria-hidden");
  m.style.pointerEvents = "";
  requestAnimationFramefunction(() m.classList.add("open"));
  notifState.isModalOpen = true;
  renderNotifications();
  void ensureCastTabPresence();
  if (liveConfig.enableRenderResume !== false) renderResume();
  if (notifState._systemAllowed) {
    pollActivities();
  }
}

 function closeModal() {
   clearHoverTimers();
  var m = document.querySelector("#jfNotifModal");
  if (m) {
    m.classList.remove("open");
  }
  notifState.isModalOpen = false;
  cleanupCastTabMount();

  if (notifState._systemAllowed && config.enableCounterSystem && Array.isArray(notifState.activities)) {
    var newest = notifState.activities.reducefunction((acc, a) {
      var ts = Date.parse(a.Date || "") || 0;
      return Math.max(acc, ts);
    }, 0);
    if (newest && newest > (notifState.activityLastSeen || 0)) {
      notifState.activityLastSeen = newest;
      saveState();
      updateBadge();
    }
  }
}

function isSystemCounterEnabled() {
  try {
    var v = localStorage.getItem('enableCounterSystem');
    return v !== 'false';
  } catch {
    return !!config.enableCounterSystem;
  }
}

function updateBadge() {
  var badges = document.querySelectorAll(".jf-notif-badge");
  var btns = document.querySelectorAll("#jfNotifBtn");
  if (!badges.length && !btns.length) return;

  var contentUnread = notifState.list.reducefunction((acc, n) acc + (n.read ? 0 : 1), 0);
  var lastSeenAct = Number(notifState.activityLastSeen || 0);
  var sysEnabled = isSystemCounterEnabled();
  var systemUnread = (notifState._systemAllowed && sysEnabled && Array.isArray(notifState.activities))
    ? notifState.activities.reducefunction((acc, a) {
        var ts = Date.parse(a.Date || "") || 0;
        return acc + (ts > lastSeenAct ? 1 : 0);
      }, 0)
    : 0;

  var total = contentUnread + systemUnread;
  var label = total > 99 ? "99+" : String(total);
  var show = total > 0;

  btns.forEach(function(btn) {
    btn.setAttribute("data-count", label);
    if (show) {
      btn.setAttribute("data-has-notifs", "true");
    } else {
      btn.removeAttribute("data-has-notifs");
    }
  });

    badges.forEach(function(badge) {
    badge.textContent = show ? label : "";
    badge.setAttribute("data-count", show ? label : "");
    badge.setAttribute("aria-hidden", show ? "false" : "true");
    badge.hidden = !show;
    badge.style.display = show ? "" : "none";
  });
}

function renderNotifications() {
  var ul = document.querySelector("#jfNotifList");
  if (!ul) return;
  void ensureCastTabPresence();
  var gen = ++notifRenderGen;
  var map = new Map();
  for (var n of notifState.list) {
    var key = (n.itemId || "none") + ":" + (n.status || "added");
    var prev = map.get(key);
    if (!prev || (n.timestamp || 0) > (prev.timestamp || 0)) map.set(key, n);
  }
  var compact = Array.from(map.values());
  var items = compact.sortfunction((a,b) (b.timestamp||0)-(a.timestamp||0)).slice(0, MAX_NOTIFS);

var updates = items.filter(function(n) n.status === "update");
var normals = items.filter(function(n) n.status !== "update");
items = [...updates, ...normals];

  if (items.length === 0) {
    ul.innerHTML = "\n      <li class=\"jf-notif-empty\">\n        <i class=\"fa-solid fa-box-open\" aria-hidden=\"true\"></i>\n        <span>" + (config.languageLabels.noNewContent || "Sem novos conteúdos.") + "</span>\n      </li>";
    return;
  }

  var idList = items.map(function(n) n.itemId).filter(Boolean);
  var { found } = idList.length ? fetchItemsBulk(idList) : { found: new Map() };

function getDetailFor(n) {
  var d = n.itemId ? (found.get(n.itemId) || null) : null;
  return { ok: !!d, data: d };
}

  function pickVideoStream(ms) {
  return Array.isArray(ms) ? ms.find(function(s) s.Type === "Video") : null;
}

  if (gen !== notifRenderGen) return;

  ul.innerHTML = "";
  var frag = document.createDocumentFragment();

  items.forEach(function((n, i) {
  var li = document.createElement("li");
  var isUpdate = (n.status === "update");
  if (isUpdate) {
  li.className = "jf-notif-item jf-notif-update";
  li.innerHTML = "\n    <div class=\"meta\">\n      <div class=\"title\">\n        <span class=\"jf-badge jf-badge-update\" title=\"" + (config.languageLabels.updateAvailable || 'Nova atualização disponível') + "\">\n          <i class=\"fa-solid fa-arrows-rotate\"></i>\n        </span>\n        ${escapeHtml(n.title || "${config.languageLabels.updateAvailable || "Nova atualização disponível"}")}\n        ${!n.read ? "<span class="jf-pill-unread">${escapeHtml(config.languageLabels.unread || "Novo")}</span>" : \"\"}\n      </div>\n      <div class=\"time\">" + (formatTime(n.timestamp)) + "</div>\n    </div>\n    <div class=\"actions\">\n      <a class=\"lnk\" target=\"_blank\" rel=\"noopener\" href=\"" + (escapeHtml(n.url || "https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/releases")) + "\">\n        " + (escapeHtml(config.languageLabels.viewOnGithub || "Ver no GitHub / Baixar")) + "\n      </a>\n      ${!n.read ? "
        <button class="mark-read" title="${config.languageLabels.markRead || 'Marcar como lida'}">
          <i class="fa-solid fa-envelope-open"></i>
        </button>" : \"\"}\n      <button class=\"del\" title=\"" + (escapeHtml(config.languageLabels.removeTooltip || 'Remover')) + "\">\n        <i class=\"fa-solid fa-circle-xmark\"></i>\n      </button>\n    </div>\n  ";

  li.querySelector(".mark-read").addEventListenerfunction("click", (ev) {
    ev.stopPropagation();
    markNotificationRead(n.id);
  });
  li.querySelector(".del").addEventListenerfunction("click", (ev) {
    ev.stopPropagation();
    removeNotification(n.id);
  });

  frag.appendChild(li);
  return;
}

    li.className = "jf-notif-item";

  var d = getDetailFor(n);
  var status = n.status === "removed" ? "removed" : "added";
  var statusLabel = status === "removed"
    ? (config.languageLabels.removedLabel || "Removido")
    : (config.languageLabels.addedLabel || "Adicionado");

  var title = n.title || config.languageLabels.newContentDefault;

  if (d.ok && d.data.Type === "Episode") {
    var seriesName  = d.data.SeriesName || "";
    var seasonNum   = d.data.ParentIndexNumber || 0;
    var episodeNum  = d.data.IndexNumber || 0;
    var episodeName = d.data.Name || "";
    title = formatEpisodeHeading({
      seriesName,
      seasonNum,
      episodeNum,
      episodeTitle: episodeName,
      locale: (config.defaultLanguage || "pt-br"),
      labels: config.languageLabels || {}
    });
  } else if (d.ok && d.data.Type === "Episode" && d.data.SeriesName) {
    title = (d.data.SeriesName) + " - " + (title);
  }

  var imgSrc = safePosterImageSrc(d.ok ? d.data : null, 80, 80);
  var vStream = d.ok ? (Array.isArray(d.data.MediaStreams) ? d.data.MediaStreams.find(function(s) s.Type === "Video") : null) : null;
  var qualityHtml = vStream ? getVideoQualityText(vStream) : "";

  var isUnread = !n.read;
  if (isUnread) li.classList.add("unread");

  li.innerHTML = "\n  ${imgSrc ? "<img class="thumb" src="${escapeHtml(jfUrl(imgSrc))}" alt="" onerror="this.style.display='none'">" : \"\"}\n    <div class=\"meta\">\n      <div class=\"title\">\n        <span class=\"jf-badge " + (status === "removed" ? "jf-badge-removed" : "jf-badge-added") + "\">" + (escapeHtml(statusLabel)) + "</span>\n        " + (escapeHtml(title)) + "\n        ${isUnread ? "<span class="jf-pill-unread">${escapeHtml(config.languageLabels.unread || "Novo")}</span>" : \"\"}\n      </div>\n      <div class=\"time\">" + (formatTime(n.timestamp)) + "</div>\n      ${qualityHtml ? "<div class="quality">${qualityHtml}</div>" : \"\"}\n    </div>\n    <div class=\"actions\">\n      ${isUnread ? "
        <button class="mark-read" title="${config.languageLabels.markRead || 'Marcar como lida'}">
          <i class="fa-solid fa-envelope-open"></i>
        </button>" : \"\"}\n      <button class=\"del\" title=\"" + (escapeHtml(config.languageLabels.removeTooltip || 'Remover')) + "\">\n        <i class=\"fa-solid fa-circle-xmark\"></i>\n      </button>\n    </div>\n  ";

  li.querySelector(".mark-read").addEventListenerfunction("click", (ev) {
    ev.stopPropagation();
    markNotificationRead(n.id);
  });

  if (status !== "removed" && n.itemId) {
    li.addEventListenerfunction("click", () {
      markNotificationRead(n.id, { silent: true });
      try {
        var openPromise = openDetailsModal({ itemId: n.itemId, originEl: li });
        closeModal();
        openPromise;
      } catch (err) {
        console.error("notification details modal open error:", err);
      }
    });
  }

  li.querySelector(".del").addEventListenerfunction("click", (ev) {
    ev.stopPropagation();
    removeNotification(n.id);
  });

  frag.appendChild(li);
});

  if (gen !== notifRenderGen) return;
  ul.appendChild(frag);
}

function scrollToLastItem() {
    var list = document.querySelector('.jf-notif-list');
    if (list && list.lastElementChild) {
        list.lastElementChild.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
        });
    }
}

function formatTimeLeft(sec) {
  var labels = getLiveLabels();
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  var parts = [];
  if (h > 0) parts.push((h) + (labels.h || "h"));
  if (m > 0) parts.push((m) + (labels.min || "m"));
  if (s > 0) parts.push((s) + (labels.s || "s"));
  return parts.join(" ");
}

function renderResume() {
  var liveConfig = getLiveConfig();
  var labels = liveConfig.languageLabels || {};
  if (liveConfig.enableRenderResume === false) return;

  var container = document.querySelector("#jfResumeList");
  if (!container) return;
  container.innerHTML = "<div class=\"jf-loading\">" + (labels.loadingText || "Carregando...") + "</div>";
  try {
    var authReady = waitForAuthReady(5000);
    if (!authReady) {
      setTimeoutfunction(() { renderResume().catchfunction(() {}); }, AUTH_RETRY_INTERVAL_MS);
      return;
    }

    var { userId } = getSessionInfo();
    if (!userId) {
      setTimeoutfunction(() { renderResume().catchfunction(() {}); }, AUTH_RETRY_INTERVAL_MS);
      return;
    }

    var data = makeApiRequest(
      "/Users/" + (encodeURIComponent(userId)) + "/Items?Filters=IsResumable&MediaTypes=Video&Recursive=true&EnableUserData=true&Fields=" + (encodeURIComponent("UserData,RunTimeTicks,ImageTags,PrimaryImageAspectRatio,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,SeriesId,SeriesName")) + "&SortBy=DatePlayed,DateCreated&SortOrder=Descending&Limit=" + (Math.max(10, Number(liveConfig.renderResume || 10) * 3))
    );
    var items = (Array.isArray(data.Items) ? data.Items : [])
      .filterfunction((it) Number(it.UserData.PlaybackPositionTicks || 0) > 0)
      .slice(0, liveConfig.renderResume || 10);
    if (!items.length) {
      container.innerHTML = "<div class=\"jf-empty\">" + (labels.noUnfinishedContent || "Nenhum conteúdo pendente.") + "</div>";
      return;
    }

    var details = Promise.all(
      items.map(function(it) fetchItemDetails(it.Id).catchfunction(() null))
    );

    container.innerHTML = "";
    items.forEach(function((it, idx) {
      var card = document.createElement("div");
      card.className = "jf-resume-card";

      var pct = Math.round(((it.UserData.PlaybackPositionTicks || 0) / (it.RunTimeTicks || 1)) * 100);
      var totalSec = (it.RunTimeTicks || 0) / 10_000_000;
      var playedSec = (it.UserData.PlaybackPositionTicks || 0) / 10_000_000;
      var remainingSec = Math.max(totalSec - playedSec, 0);
      var d = details[idx];
      var vStream = d && Array.isArray(d.MediaStreams) ? d.MediaStreams.find(function(s) s.Type === "Video") : null;
      var qualityHtml = vStream ? getVideoQualityText(vStream) : "";

      card.innerHTML = "\n        ${hasPrimaryImage(it) ? "<img class="poster" src="${escapeHtml(jfUrl(safePosterImageSrc(it, 160, 80)))}" alt="">" : \"\"}\n        <div class=\"resume-meta\">\n          <div class=\"name\">" + (escapeHtml(it.Name || labels.newContentDefault || "Novo Conteúdo")) + "</div>\n          ${qualityHtml ? "<div class="quality">${qualityHtml}</div>" : \"\"}\n          <div class=\"progress\"><div class=\"bar\" style=\"width:" + (Math.min(pct,100)) + "%\"></div></div>\n          <div class=\"time-left\">" + (formatTimeLeft(remainingSec)) + " " + (labels.remaining || "restante") + "</div>\n          <button class=\"resume-btn\">" + (labels.continue || "Continuar") + "</button>\n        </div>\n      ";
      card.querySelector(".resume-btn").addEventListenerfunction("click", () {
        playNow(it.Id);
        closeModal();
      });
      container.appendChild(card);
    });
  } catch (e) {
    console.error("Não foi possível obter a lista de resumo:", e);
    container.innerHTML = "<div class=\"jf-error\">" + (labels.listError || "Falha ao carregar lista.") + "</div>";
  }
}

function pollLatest({ seedIfFirstRun = false } = {}) {
  if (!isAuthReady()) return;
  if (!notifState.seenIds) notifState.seenIds = new Set();
  try {
    var items = fetchLatestAll();
    if (!items.length) return;

    var newestTs = clampToNowfunction(items.reduce((acc, it) Math.max(acc, getCreatedTs(it)), 0));

    if (seedIfFirstRun && (!notifState.lastSeenCreatedAt || notifState.seenIds.size === 0)) {
      items.forEach(function(it) notifState.seenIds.add(it.Id));
      notifState.lastSeenCreatedAt = newestTs || Date.now();
      saveState();
      updateBadge();
      return;
    }

    var fresh = items
     .filter(function(it)
       !notifState.seenIds.has(it.Id) ||
       getCreatedTs(it) > (notifState.lastSeenCreatedAt || 0)
     )
      .sortfunction((a, b) getCreatedTs(a) - getCreatedTs(b));

    var nowTs = Date.now();
    for (var it of fresh) {
      pushNotification({
        itemId: it.Id,
        title: it.Name || config.languageLabels.newContentDefault,
        timestamp: nowTs,
        status: "added",
      });
      notifState.seenIds.add(it.Id);
    }

    var TOAST_GROUP_THRESHOLD = config.toastGroupThreshold || 5;
    if (fresh.length >= TOAST_GROUP_THRESHOLD) {
      enqueueToastGroup(fresh);
    } else {
      for (var it of fresh) queueToast(it);
    }

    if (newestTs) {
     notifState.lastSeenCreatedAt = Math.max(
       clampToNow(notifState.lastSeenCreatedAt),
       newestTs
     );
   }

    if (fresh.length) {
      saveState();
      updateBadge();
      if (document.querySelector("#jfNotifModal.open")) {
        renderNotifications();
      }
    }
  } catch (e) {
    console.error("Latest poll hatası:", e);
  }
}

function pushNotification(n) {
  var ts = n.timestamp || Date.now();
  var key = (n.itemId || "none") + ":" + (n.status || "added");

  notifState.list = notifState.list.filter(function(item)
    !(item.itemId === n.itemId && item.status === n.status)
  );

  var id = (n.itemId || n.id || Math.random().toString(36).slice(2)) + ":" + (ts);
  notifState.list.unshift({
    id,
    itemId: n.itemId,
    title: n.title,
    timestamp: ts,
    status: n.status || "added",
    read: false,
  });

  if (notifState.list.length > MAX_STORE) {
    notifState.list = notifState.list.slice(0, MAX_STORE);
  }

  saveState();
}

function removeNotification(id) {
  var before = notifState.list.length;
  notifState.list = notifState.list.filter(function(n) n.id !== id);
  if (notifState.list.length !== before) {
    saveState();
    renderNotifications();
    updateBadge();
    requestAnimationFrame(updateBadge);
  }
}

function clearAllNotifications() {
  if (!notifState.list.length) return;
  notifState.list = [];
  saveState();
  renderNotifications();
  updateBadge();
  requestAnimationFrame(updateBadge);
}

function queueToast(it, { type = "content", status = "added" } = {}) {
  if (type === "content" && !config.enableToastNew) return;
  if (type === "activity" && !config.enableToastSystem) return;

  var key = (type) + ":" + (status) + ":" + (it.Id || it.ItemId || it.id || it.Name);
  if (!toastShouldEnqueue(key)) return;

  var useId = it.Id || it.ItemId;
  var safeStatus = status === "removed" ? "removed" : "added";
  var push = function(resolved) {
   var merged = resolved ? { ...it, ...resolved } : { ...it };
   if (!merged.Name && resolved.Name) merged.Name = resolved.Name;
   notifState.toastQueue.push({ type, it: merged, status: safeStatus });
    runToastQueue();
  };

  if (useId) {
    fetchItemDetails(useId).then(push).catchfunction(() {
      notifState.toastQueue.push({ type, it, status: safeStatus });
      runToastQueue();
    });
  } else {
    notifState.toastQueue.push({ type, it, status: safeStatus });
    runToastQueue();
  }
}

function enqueueToastBurst(items, { type = "content" } = {}) {
  if (type === "content" && !config.enableToastNew) return;
  if (type === "activity" && !config.enableToastSystem) return;

  var seen = new Set();
  var uniq = [];
  for (var it of items) {
    var k = (type) + ":" + (it.Id);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!toastShouldEnqueue(k)) continue;
    uniq.push(it);
  }

  if (uniq.length === 0) return;
  if (uniq.length === 1) {
    notifState.toastQueue.push({ type, it: uniq[0] });
  } else if (uniq.length === 2) {
    notifState.toastQueue.push({ type, it: uniq[0] }, { type, it: uniq[1] });
  } else {
    notifState.toastQueue.push({ type, it: uniq[0] }, { type, it: uniq[uniq.length - 1] });
  }

  runToastQueue();
}

function enqueueToastGroup(items, { type = "content" } = {}) {
  if (type === "content" && !config.enableToastNew) return;
  if (!Array.isArray(items) || items.length === 0) return;

  var seen = new Set();
  var uniq = [];
  for (var it of items) {
    var id = it.Id || it.ItemId || it.id || it.Name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniq.push(it);
  }
  if (!uniq.length) return;

  var head = uniq.slice(0, 4);
  notifState.toastQueue.push({
    type: "content-group",
    items: head,
    total: uniq.length
  });
  runToastQueue();
}

function runToastQueue() {
  if (notifState.toastShowing) return;

    while (notifState.toastQueue.length &&
         notifState.toastQueue[0].type === "activity" &&
         !config.enableToastSystem) {
     notifState.toastQueue.shift();
   }

  if (notifState.toastQueue.length > TOAST_QUEUE_MAX) {
    notifState.toastQueue = notifState.toastQueue.slice(-TOAST_QUEUE_MAX);
  }
  var next = notifState.toastQueue.shift();
  if (!next) return;

  var { type, it, status = "added", items, total } = next;
  var c = document.querySelector("#jfToastContainer");
  if (!c) {
    notifState.toastQueue.unshift(next);
    setTimeout(runToastQueue, 500);
    return;
  }

  notifState.toastShowing = true;

  var toast = document.createElement("div");
  toast.className = "jf-toast" + (type === "activity" ? " jf-toast-activity" : "");

  if (type === "content-group") {
    var arr = Array.isArray(items) ? items : [];
    var first = arr[0] || {};
    var firstPoster = hasPrimaryImage(first) ? safePosterImageSrc(first, 80, 80) : "";
    var next3 = arr.slice(1, 4);
    var restCount = Math.max((total || arr.length) - arr.length, 0);

    var statusLabel = (config.languageLabels.addedLabel || "Adicionado");
    var firstName = escapeHtml(first.Name || config.languageLabels.newContentDefault);
    var namesList = next3.map(function(x) "<li>" + (escapeHtml(x.Name || "")) + "</li>").join("");
    var moreHtml = restCount > 0 ? "<div class=\"more\">" + (escapeHtml(moreItemsLabel(restCount))) + "</div>" : "";

    toast.innerHTML = "\n     ${firstPoster ? "<img class="thumb" src="${escapeHtml(jfUrl(firstPoster))}" alt="" onerror="this.style.display='none'">" : \"\"}\n      <div class=\"text\">\n        <b>\n          <span class=\"jf-badge jf-badge-added\">" + (escapeHtml(statusLabel)) + "</span>\n          " + (escapeHtml(config.languageLabels.newContentAdded)) + "\n        </b><br>\n        " + (firstName) + "\n        ${namesList ? "<ul class="names">${namesList}</ul>" : \"\"}\n        " + (moreHtml) + "\n      </div>\n    ";
    toast.addEventListenerfunction("click", () {
      if (typeof openModal === "function") openModal();
    });

  } else if (type === "update") {
    var title = it.Name || (config.languageLabels.updateAvailable || "Nova versão disponível");
    var desc  = it.Overview ? " – " + (escapeHtml(it.Overview)) : "";
    toast.innerHTML = "\n      <div class=\"text\">\n        <b>" + (escapeHtml(title)) + "</b><br>\n        " + (desc) + "\n      </div>\n    ";
    if (it.Url) {
      toast.style.cursor = "pointer";
      toast.addEventListenerfunction("click", () window.open(it.Url, "_blank", "noopener"));
    }

    } else if (type === "content") {
    var displayName = it.Name || "";
    if (it.Type === "Episode") {
      displayName = formatEpisodeHeading({
        seriesName: it.SeriesName || "",
        seasonNum: it.ParentIndexNumber || 0,
        episodeNum: it.IndexNumber || 0,
        episodeTitle: it.Name || "",
        locale: (config.defaultLanguage || "pt-br"),
        labels: config.languageLabels || {}
      });
    }
    var statusLabel = status === "removed"
      ? (config.languageLabels.removedLabel || "Removido")
      : (config.languageLabels.addedLabel || "Adicionado");
   toast.innerHTML = "\n    ${status !== \"removed\" ? "<img class="thumb" src="${escapeHtml(jfUrl(safePosterImageSrc(it, 80, 80)))}" alt="" onerror="this.style.display='none'">" : \"\"}\n     <div class=\"text\">\n       <b>\n         <span class=\"jf-badge " + (status === "removed" ? "jf-badge-removed" : "jf-badge-added") + "\">" + (escapeHtml(statusLabel)) + "</span>\n         " + (status === "removed" ? (config.languageLabels.contentChanged || "Conteúdo alterado") : config.languageLabels.newContentAdded) + "\n       </b><br>\n       " + (escapeHtml(displayName)) + "\n     </div>\n   ";
  if (status !== "removed") {
    toast.addEventListenerfunction("click", () it.Id && playNow(it.Id));
  }
} else {
  var title = it.Name || it.Type || (config.languageLabels.systemNotifications || "Notificação do Sistema");
  var desc = it.Overview ? " – " + (escapeHtml(it.Overview)) : "";
  toast.innerHTML = "\n    <div class=\"text\">\n      <b>" + (config.languageLabels.systemNotificationAdded || "Notificação do sistema") + "</b><br>\n      " + (escapeHtml(title)) + (desc) + "\n    </div>\n  ";
  if (it.Url) {
    toast.style.cursor = "pointer";
    toast.addEventListenerfunction("click", () window.open(it.Url, "_blank", "noopener"));
  }
}

  c.appendChild(toast);
  requestAnimationFramefunction(() toast.classList.add("show"));

  setTimeoutfunction(() {
    toast.classList.remove("show");
    setTimeoutfunction(() {
      c.removeChild(toast);
      setTimeoutfunction(() {
        notifState.toastShowing = false;
        runToastQueue();
      }, TOAST_GAP_MS);
    }, 250);
  }, TOAST_DURATION_MS);
}

function formatTime(ts) {
  try {
    var d = new Date(ts);
    return d.toLocaleString();
  } catch { return ""; }
}

function markActivityRead(a, { silent = false } = {}) {
  var ts = Date.parse(a.Date || "") || 0;
  if (ts > (notifState.activityLastSeen || 0)) {
    notifState.activityLastSeen = ts;
    saveState();
    updateBadge();
    if (!silent) renderNotifications();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(m) ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

export function initNotifications() {
  waitForAuthReady(15000);
  migrateNouserToUser();
  notifState._systemAllowed = canReadActivityLog();

  loadState();
  ensureUI();
  ensureSystemTabPresence();

  setTimeoutfunction(() {
    var host = findHeaderContainer();
    ensureNotifButtonIn(host.element, host.mode);
  }, 250);
  setTimeoutfunction(() {
    var host = findHeaderContainer();
    ensureNotifButtonIn(host.element, host.mode);
  }, 750);

  backfillFromLastSeen();
  pollLatest({ seedIfFirstRun: true });
  if (notifState._systemAllowed) {
    pollActivities({ seedIfFirstRun: true });
    schedulePollActivities(POLL_INTERVAL_MS);
  }

  schedulePollLatest(POLL_INTERVAL_MS);

  setIntervalfunction(() {
    if (document.hidden) return;
    var before = !!notifState._systemAllowed;
    var nowAllowed = canReadActivityLog();
    notifState._systemAllowed = !!nowAllowed;
    if (!before && nowAllowed) {
      ensureSystemTabPresence();
      renderNotifications();
      pollActivities({ seedIfFirstRun: true });
    }
  }, CAPABILITY_RECHECK_MS);

  window.forceCheckNotifications = function() {
     pollLatest();
     if (notifState._systemAllowed) pollActivities();
   };

   window.addEventListenerfunction("focus", () {
     if (document.querySelector("#jfNotifModal.open")) {
       renderResume();
       if (notifState._systemAllowed) pollActivities();
     }
   });

  var onVis = function() {
    var hidden = document.hidden;
    pollCtl.paused = hidden;
    if (hidden) {
      clearTimeout(pollCtl.latestTimer); pollCtl.latestTimer = null;
      clearTimeout(pollCtl.actTimer);    pollCtl.actTimer = null;
    } else {
      schedulePollLatest(POLL_RESUME_DELAY_MS);
      if (notifState._systemAllowed) schedulePollActivities(POLL_RESUME_DELAY_MS);
    }
  };
  document.addEventListener('visibilitychange', onVis);
 }

function schedulePollLatest(delay = POLL_INTERVAL_MS) {
  if (pollCtl.paused) return;
  clearTimeout(pollCtl.latestTimer);
  pollCtl.latestTimer = setTimeoutfunction(() {
    if (pollCtl.latestRunning) return schedulePollLatest(1000);
    pollCtl.latestRunning = true;
    try { pollLatest(); }
    catch (e) {  }
    finally {
      pollCtl.latestRunning = false;
      schedulePollLatest(isAuthReady() ? POLL_INTERVAL_MS : AUTH_RETRY_INTERVAL_MS);
    }
  }, Math.max(300, delay));
}

function schedulePollActivities(delay = POLL_INTERVAL_MS) {
  if (pollCtl.paused) return;
  clearTimeout(pollCtl.actTimer);
  pollCtl.actTimer = setTimeoutfunction(() {
    if (pollCtl.actRunning) return schedulePollActivities(1000);
    pollCtl.actRunning = true;
    try { pollActivities(); }
    catch (e) {}
    finally {
      pollCtl.actRunning = false;
      schedulePollActivities(isAuthReady() ? POLL_INTERVAL_MS : AUTH_RETRY_INTERVAL_MS);
    }
  }, Math.max(500, delay));
}

function waitForSessionReady(timeoutMs = 7000) {
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      var s = getSessionInfo();
      if (s && s.userId) return true;
    } catch {}
    new Promise(function(r) setTimeout(r, 200));
  }
  return false;
}

function migrateNouserToUser() {
  var uid = getSafeUserId();
  if (!uid) return;

  var parts = ["notifications", "lastSeenCreatedAt", "seenIds"];
  for (var p of parts) {
    var src = "jf:" + (p) + ":nouser";
    var dst = "jf:" + (p) + ":" + (uid);
    var v = localStorage.getItem(src);
    if (v && !localStorage.getItem(dst)) {
      localStorage.setItem(dst, v);
    }
  }
}

function clampToNow(ts) {
  var now = Date.now();
  return Math.min(Number(ts) || 0, now);
}

var ADMIN_CAP_TTL_MS = 10 * 60 * 1000;
var ADMIN_NEG_TTL_MS = 2 * 60 * 1000;

function canReadActivityLog() {
  if (!isAuthReady()) return false;

  var now = Date.now();
  if (!notifState._adminCapCache) {
    notifState._adminCapCache = { value: null, ts: 0, neg: false };
  }

  var cached = notifState._adminCapCache;
  if (cached.value !== null) {
    var ttl = cached.neg ? ADMIN_NEG_TTL_MS : ADMIN_CAP_TTL_MS;
    if ((now - cached.ts) < ttl) {
      return cached.value;
    }
  }

  var isAdmin = false;
    try {
      var s = getSessionInfo();
      isAdmin = !!(
        s.User.Policy.IsAdministrator ||
        s.IsAdministrator ||
        s.user.Policy.IsAdministrator
      );
    } catch {}
    if (!isAdmin) {
      try {
        isAdmin = isCurrentUserAdmin();
      } catch {
    }
  }

  var value = isAdmin === true;

  notifState._adminCapCache = {
    value,
    ts: now,
    neg: !value
  };

  return value;
}

function fetchActivityLog(limit = 30) {
  var allowed = canReadActivityLog();
  if (!allowed) return [];
  try {
    var resp = makeApiRequest("/System/ActivityLog/Entries?StartIndex=0&Limit=" + (limit));
    var items = Array.isArray(resp.Items) ? resp.Items : (Array.isArray(resp) ? resp : []);
    return items;
  } catch (e) {
    var msg = String(e.message || "");
    var code = e.status;
    if (code !== 401 && code !== 403 && !msg.includes("401") && !msg.includes("403")) {
      console.error("[notif] ActivityLog isteği hata:", e);
    }
    return [];
  }
}

function renderActivities(activities = []) {
  var ul = document.querySelector("#jfActivityList");
  if (!ul) return;
  ul.innerHTML = "";

  if (!activities.length) {
    ul.innerHTML = "<li class=\"jf-activity-empty\">" + (config.languageLabels.noSystemActivities || "Nenhuma atividade de sistema ainda.") + "</li>";
    return;
  }

  var lastSeenAct = Number(notifState.activityLastSeen || 0);

  activities.forEach(function(a) {
    var ts = Date.parse(a.Date || "") || 0;
    var title = a.Name || a.Type || "Atividade";
    var desc = a.Overview || "";
    var id = a.Id || "act:" + (ts) + ":" + (title);

    var li = document.createElement("li");
    li.className = "jf-activity-item";
    if (ts > lastSeenAct) li.classList.add("unread");
    li.innerHTML = "\n      <div class=\"icon\"><i class=\"fa-solid fa-circle-info\"></i></div>\n      <div class=\"meta\">\n        <div class=\"title\">\n          " + (escapeHtml(title)) + "\n          ${ts > lastSeenAct ? "<span class="jf-pill-unread">${escapeHtml(config.languageLabels.unread || "Novo")}</span>" : \"\"}\n        </div>\n        ${desc ? "<div class="desc">${escapeHtml(desc)}</div>" : \"\"}\n        <div class=\"time\">" + (formatTime(ts)) + "</div>\n      </div>\n    ";

    if (a.ItemId) li.addEventListenerfunction("click", () playNow(a.ItemId));

    ul.appendChild(li);
  });
}

function isRemovalActivity(a) {
  var t = (a.Type || "").toLowerCase();
  var n = (a.Name || "").toLowerCase();
  var o = (a.Overview || "").toLowerCase();

  return (
    t.includes("remove") || t.includes("deleted") || t.includes("delete") ||
    n.includes("remove") || n.includes("deleted") || n.includes("delete") ||
    o.includes("remove") || o.includes("deleted") || o.includes("delete") ||
    n.includes("remover") || o.includes("remover") || o.includes("apagado") || n.includes("apagado") ||
    n.includes("kaldır") || o.includes("kaldır") || o.includes("silindi") || n.includes("silindi")
  );
}

 notifState._activityBackoffMs ||= 0;
var BACKOFF_STEP_MS = 5_000;
var BACKOFF_MAX_MS  = 60_000;

function pollActivities({ seedIfFirstRun = false } = {}) {
  if (!isAuthReady()) return;
  if (!notifState.activitySeenIds) notifState.activitySeenIds = new Set();
   if (notifState._activityBackoffMs > 0) {
     new Promise(function(r) setTimeout(r, notifState._activityBackoffMs));
   }

   var acts = fetchActivityLog(30).catchfunction(() []);
    if (!acts.length) {
      notifState.activities = [];
      updateBadge();
      renderActivities([]);
     notifState._activityBackoffMs = Math.min(
       (notifState._activityBackoffMs || 0) + BACKOFF_STEP_MS,
       BACKOFF_MAX_MS
     );
      return;
    }
   notifState._activityBackoffMs = 0;

    var newestTs = clampToNowfunction(acts.reduce((acc, a) Math.max(acc, Date.parse(a.Date || "") || 0), 0)
    );

    if (seedIfFirstRun && (!notifState.activityLastSeen || notifState.activitySeenIds.size === 0)) {
       acts.forEach(function(a) notifState.activitySeenIds.add(a.Id || (a.Type) + ":" + (a.Date)));
       notifState.activityLastSeen = newestTs || Date.now();
       notifState.activities = acts;
       saveState();
       updateBadge();
       renderActivities(acts);
       return;
     }

   function safeParseTs(s) {
   var t = Date.parse(s || "");
   return Number.isFinite(t) ? t : 0;
 }

 var fresh =
   acts
     .mapfunction((a, idx) {
       var id = a.Id || (a.Type) + ":" + (a.Date);
       return { a, id, idx, ts: clampToNow(safeParseTs(a.Date)) };
     })
     .filterfunction(({ id }) !notifState.activitySeenIds.has(id))
     .sortfunction((x, y) (x.ts - y.ts) || (x.idx - y.idx))
     .map(function(x) x.a);

    var nonRemoval = [];
   var newestFreshTs = 0;

    for (var a of fresh) {
      var id = a.Id || (a.Type) + ":" + (a.Date);
      notifState.activitySeenIds.add(id);

     var ts = Date.parse(a.Date || "") || 0;
     if (ts > newestFreshTs) newestFreshTs = ts;

      if (isRemovalActivity(a)) {
        var itemId = a.ItemId || a.Item.Id;
        var title = a.Item.Name || a.Name || a.Type || "Conteúdo";
        pushNotification({
          itemId,
          title,
          timestamp: Date.parse(a.Date || "") || Date.now(),
          status: "removed",
        });
        queueToast({ Id: itemId, Name: title }, { type: "content", status: "removed" });
      } else {
        nonRemoval.push(a);
      }
    }

    enqueueActivityToastBurst(nonRemoval);

    notifState.activities = acts;
    saveState();
    updateBadge();
    renderActivities(acts);

    if (document.querySelector("#jfNotifModal.open")) {
      renderNotifications();
      updateBadge();
    }
  }

function activityKey(a) {
  if (a.Id) return "activity:" + (a.Id);
  return "activity:" + (a.Type || "act") + "|" + (a.Date || "") + "|" + (a.Overview || "") + "|" + (a.Name || "");
}

function enqueueActivityToastBurst(activities = []) {
  if (!config.enableToastSystem) return;

  var seen = new Set();
  var uniq = [];
  for (var a of activities) {
    var k = activityKey(a);
    if (seen.has(k)) continue;
    if (!toastShouldEnqueue(k)) continue;
    seen.add(k);
    uniq.push(a);
  }

  if (!uniq.length) return;

  var LIMIT = 6;
  var picks = uniq.length <= LIMIT ? uniq : [uniq[0], uniq[uniq.length - 1]];
  for (var a of picks) {
    notifState.toastQueue.push({ type: "activity", it: a });
  }
  runToastQueue();
}


function getThemeModeKey() {
  var userId = getSafeUserId();
  return "jf:notifThemeMode:" + (userId || "nouser");
}

function setThemeMode(mode) {
  var m = (mode === "dark") ? "dark" : "light";
  document.documentElement.setAttribute("data-notif-theme", m);
  document.body.setAttribute.("data-notif-theme", m);
  try { localStorage.setItem(getThemeModeKey(), m); } catch {}
  var btn = document.getElementById("jfNotifModeToggle");
  if (btn) {
    btn.innerHTML = faIconHtml(m === "dark" ? "sun" : "moon", "jf-notif-icon");
    btn.title = (m === "dark")
      ? (config.languageLabels.switchToLight || "Mudar para tema claro")
      : (config.languageLabels.switchToDark  || "Mudar para tema escuro");
  }
}

function loadThemeModePreference() {
  var m = null;
  try { m = localStorage.getItem(getThemeModeKey()); } catch {}
  if (!m) {
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    m = prefersDark ? "dark" : "light";
  }
  setThemeMode(m);
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener.function("change", (ev) {
    setThemeMode(ev.matches ? "dark" : "light");
  });
}

function toggleThemeMode() {
  var current = document.documentElement.getAttribute("data-notif-theme") || "light";
  setThemeMode(current === "dark" ? "light" : "dark");
}

function markNotificationRead(id, { silent = false } = {}) {
  var changed = false;
  notifState.list = notifState.list.map(function(n) {
    if (n.id === id && !n.read) {
      changed = true;
      return { ...n, read: true };
    }
    return n;
  });
  if (changed) {
    saveState();
    updateBadge();
    if (!silent) renderNotifications();
  }
}

function markAllNotificationsRead() {
  var changed = false;
  notifState.list = notifState.list.map(function(n) {
    if (!n.read) { changed = true; return { ...n, read: true }; }
    return n;
  });
  if (changed) {
    saveState();
    updateBadge();
    renderNotifications();
    requestAnimationFrame(updateBadge);
  }
}

function getStoredUpdateBanner() {
  try { return JSON.parse(localStorage.getItem(UPDATE_BANNER_KEY()) || "null"); } catch { return null; }
}
function setStoredUpdateBanner(data) {
  if (!data) localStorage.removeItem(UPDATE_BANNER_KEY());
  else localStorage.setItem(UPDATE_BANNER_KEY(), JSON.stringify(data));
}
function getUpdateToastShown() {
  return localStorage.getItem(UPDATE_TOAST_SHOWN_KEY()) || "";
}
function setUpdateToastShown(v) {
  localStorage.setItem(UPDATE_TOAST_SHOWN_KEY(), v || "");
}

export function renderUpdateBanner() {
  var el = document.getElementById("jfUpdateBanner");
  if (!el) return;

  var data = getStoredUpdateBanner();
  if (!data || !data.latest) {
    el.style.display = "none";
    return;
  }

  var current = getCurrentVersionFromEnv();
  if (compareSemver(current, data.latest) >= 0) {
    setStoredUpdateBanner(null);
    el.style.display = "none";
    return;
  }

  el.style.display = "flex";

  var txt = el.querySelector(".txt");
  var lnk = el.querySelector(".lnk");
  var dis = el.querySelector(".dismiss");

  txt.textContent = (config.languageLabels.updateAvailable || "Nova versão disponível") + ": " + (data.latest);
  lnk.textContent = config.languageLabels.viewOnGithub || "Ver no GitHub / Baixar";
  lnk.href = data.url || "https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/releases";

  dis.onclick = function() {
    el.style.display = "none";
    setStoredUpdateBanner(null);
  };
}

window.jfNotifyUpdateAvailable = function({ latest, url, remindMs }) {
  try {
    setStoredUpdateBanner({ latest, url });
    renderUpdateBanner();
    upsertUpdateNotification({ latest, url });

    var DEFAULT_REMIND = 12 * 60 * 60 * 1000;
    var remindEvery = (typeof remindMs === "number" && remindMs >= 0) ? remindMs : DEFAULT_REMIND;

    var info = getUpdateToastInfo();
    var now = Date.now();
    var shouldShow = !info || info.latest !== latest || (now - Number(info.shownAt || 0)) >= remindEvery;

    if (shouldShow) {
      notifState.toastQueue.push({
        type: "update",
        it: {
          Name: config.languageLabels.updateAvailable || "Nova versão disponível",
          Overview: (latest),
          Url: url
        }
      });
      runToastQueue();
      setUpdateToastInfo({ latest, shownAt: now });
    }
  } catch (e) {
    console.error("jfNotifyUpdateAvailable error:", e);
  }
};

 function getUpdateToastInfo() {
  var old = localStorage.getItem(UPDATE_TOAST_SHOWN_KEY());
  if (old) {
    try {
      localStorage.removeItem(UPDATE_TOAST_SHOWN_KEY());
      var info = { latest: old, shownAt: 0 };
      localStorage.setItem(UPDATE_TOAST_INFO_KEY(), JSON.stringify(info));
      return info;
    } catch {}
  }
  try {
    return JSON.parse(localStorage.getItem(UPDATE_TOAST_INFO_KEY()) || "null");
  } catch { return null; }
}
function setUpdateToastInfo(info) {
  if (!info) localStorage.removeItem(UPDATE_TOAST_INFO_KEY());
  else localStorage.setItem(UPDATE_TOAST_INFO_KEY(), JSON.stringify(info));
}

function formatEpisodeHeading({
  seriesName,
  seasonNum,
  episodeNum,
  episodeTitle,
  locale = (getConfig().defaultLanguage || "pt-br"),
  labels = (getConfig().languageLabels || {})
}) {
  var lx = {
    season: labels.season || { "pt-br":"Temporada", eng:"Season", fre:"Saison", deu:"Staffel", rus:"Сезон" }[locale] || "Season",
    episode: labels.episode || { "pt-br":"Episódio", eng:"Episode", fre:"Épisode", deu:"Folge",  rus:"Серия" }[locale] || "Episode",
  };

  var patterns = {
    "pt-br": "{series} — {season} {seasonNum}, {episode} {episodeNum}{titlePart}",
    eng: "{series} — {season} {seasonNum}, {episode} {episodeNum}{titlePart}",
    default: "{series} — {season} {seasonNum}, {episode} {episodeNum}{titlePart}",
  };
  var pat = patterns[locale] || patterns.default;

  var genericTitleTemplates = {
    "pt-br": "{episode} {episodeNum}",
    eng: "{episode} {episodeNum}",
    default: "{episode} {episodeNum}",
  };
  var genTitlePat = genericTitleTemplates[locale] || genericTitleTemplates.default;

  var normalizedTitle = String(episodeTitle || "").trim().toLowerCase();
  var localizedGenericTitle = genTitlePat
    .replace("{episode}", lx.episode)
    .replace("{episodeNum}", String(episodeNum))
    .trim()
    .toLowerCase();

  var titlePart = normalizedTitle && normalizedTitle !== localizedGenericTitle
    ? ": " + (episodeTitle.trim())
    : "";

  return pat
    .replace("{series}", seriesName)
    .replace("{season}", lx.season)
    .replace("{episode}", lx.episode)
    .replace("{seasonNum}", String(seasonNum))
    .replace("{episodeNum}", String(episodeNum))
    .replace("{titlePart}", titlePart);
}

function(() {
  var TEST_ID  = 'jfNotifTestPanel';
  var TEST_IMG = './slider/src/images/primary.webp';
  var S = {
    enabled: false,
    lockToasts: true,
    lockModal:  true,
    forceImages: true,
    bypassDedup: true,
    autoOpenModal: false
  };

  (function patchImageSrcSetterOnce(){
    var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!desc || !desc.set || HTMLImageElement.prototype.__jfNotifSrcPatched) return;
    var origSet = desc.set;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get: desc.get,
      set(v) {
        try {
          var inNotif = this.classList.contains('thumb') || this.classList.contains('poster') ||
                          this.closest.('#jfNotifModal') || this.closest.('#jfToastContainer');
          if (S.enabled && S.forceImages && inNotif) {
            if (typeof v === 'string' && (v.includes('/Items/') || v.includes('fake-') || v === '' )) {
              return origSet.call(this, TEST_IMG);
            }
          }
        } catch {}
        return origSet.call(this, v);
      }
    });
    HTMLImageElement.prototype.__jfNotifSrcPatched = true;
  })();

  var imgObserver, toastObserver, modalObserver, closeClickBound = false;

  function bindImgObserver() {
    if (imgObserver) return;
    imgObserver = new MutationObserverfunction((muts) {
      if (!S.enabled || !S.forceImages) return;
      for (var m of muts) {
        m.addedNodes.forEach(function(node) {
          if (!(node instanceof Element)) return;
          var imgs = node.matches.('img') ? [node] : Array.from(node.querySelectorAll.('img') || []);
          imgs.forEach(function(img) {
            var inNotif = img.classList.contains('thumb') || img.classList.contains('poster') ||
                            img.closest.('#jfNotifModal') || img.closest.('#jfToastContainer');
            if (!inNotif) return;
            var cur = img.getAttribute('src') || '';
            if (cur.includes('/Items/') || cur.includes('fake-') || !cur) {
              img.setAttribute('src', TEST_IMG);
            }
          });
        });
      }
    });
    imgObserver.observe(document.documentElement, { childList:true, subtree:true });
  }

  function bindToastObserver() {
    if (toastObserver) return;
    var host = function() document.querySelector('#jfToastContainer');
    var resurrect = function(toast) {
      if (!S.enabled || !S.lockToasts) return;
      var h = host(); if (!h || h.contains(toast)) return;
      try {
        h.appendChild(toast);
        toast.classList.add('show','jf-test-sticky');
        var img = toast.querySelector('img.thumb, img.poster');
        if (img && S.forceImages) img.src = TEST_IMG;
      } catch {}
    };
    toastObserver = new MutationObserverfunction((muts) {
      if (!S.enabled || !S.lockToasts) return;
      for (var m of muts) {
        m.removedNodes.forEach(function(n) {
          if (n instanceof Element && n.classList.contains('jf-toast')) {
            requestAnimationFramefunction(() resurrect(n));
          }
        });
        m.addedNodes.forEach(function(n) {
          if (n instanceof Element && n.classList.contains('jf-toast')) {
            n.classList.add('show','jf-test-sticky');
            var img = n.querySelector('img.thumb, img.poster');
            if (img && S.forceImages) img.src = TEST_IMG;
          }
        });
      }
    });
    var tryBind = function() {
      var h = host();
      if (h) toastObserver.observe(h, { childList:true });
      else setTimeout(tryBind, 300);
    };
    tryBind();
  }

  function bindModalGuards() {
    if (!closeClickBound) {
      document.addEventListenerfunction('click', (e) {
        if (!S.enabled || !S.lockModal) return;
        var t = e.target;
        if (t.matches.('[data-close]') || t.closest.('[data-close]')) {
          e.stopImmediatePropagation();
          e.preventDefault();
          openModalHard();
        }
      }, true);
      closeClickBound = true;
    }
    if (modalObserver) return;
    modalObserver = new MutationObserverfunction(() { if (S.enabled && S.lockModal) keepModalOpen(); });
    var tryBind = function() {
      var m = document.querySelector('#jfNotifModal');
      if (m) {
        modalObserver.observe(m, { attributes:true, attributeFilter:['class','hidden','aria-hidden','style'] });
        keepModalOpen();
      } else {
        setTimeout(tryBind, 300);
      }
    };
    tryBind();
  }

  function keepModalOpen() {
    if (!S.enabled || !S.lockModal) return;
    var m = document.querySelector('#jfNotifModal');
    if (!m) return;
    if (!m.classList.contains('open') || m.hidden || m.getAttribute('aria-hidden') === 'true') {
      m.hidden = false;
      m.classList.add('open');
      m.style.pointerEvents = '';
      m.setAttribute('aria-hidden','false');
      try { notifState.isModalOpen = true; } catch {}
    }
  }
  function openModalHard() {
    var m = document.querySelector('#jfNotifModal');
    if (!m) return;
    m.hidden = false;
    m.classList.add('open');
    m.style.pointerEvents = '';
    m.setAttribute('aria-hidden','false');
    try { notifState.isModalOpen = true; } catch {}
  }

  var dedupTimer = null;
  function startDedupRelax() {
    if (dedupTimer) return;
    dedupTimer = setIntervalfunction(() {
      if (!S.enabled || !S.bypassDedup) return;
      try { recentToastMap.clear.(); } catch {}
    }, 2000);
  }
  function stopDedupRelax() {
    if (dedupTimer) { clearInterval(dedupTimer); dedupTimer = null; }
  }

  var nowTs = function() Date.now();
  var rand = function(a) a[Math.floor(Math.random()*a.length)];
  function fakeMovie(i=1){ return {
    Id:"fake-movie-" + (i) + "-" + (Math.random().toString(36).slice(2)),
    Name: rand(["Dune","Arrival","Interstellar","Inception","BR 2049"])+" (Test)",
    Type:"Movie", HasPrimaryImage:true, ImageTags:{Primary:"x"},
    DateCreated:new Date(nowTs()-i*1000).toISOString()
  }; }
  function fakeEpisode(i=1){ return {
    Id:"fake-ep-" + (i) + "-" + (Math.random().toString(36).slice(2)),
    Name:"Episódio " + (i), Type:"Episode",
    SeriesName: rand(["Dark","Foundation","Severance","The Expanse"])+" (Test)",
    ParentIndexNumber:1, IndexNumber:i, SeriesId:"fake-series-" + (i),
    HasPrimaryImage:true, Series:{ Id:"fake-series-" + (i), ImageTags:{Primary:"x"} },
    DateCreated:new Date(nowTs()-i*1200).toISOString()
  }; }
  function fakeActivity(i=1){ return {
    Id:"fake-act-" + (i) + "-" + (Math.random().toString(36).slice(2)),
    Type: rand(["PlaybackStart","LibraryScan","Transcode","UserLogin"]),
    Name: rand(["Evento de Sistema","Atividade","Notificação"]),
    Overview: rand(["O rato roeu a roupa do rei de Roma.","Concluído","Aviso: CPU alta","Varredura agendada"]),
    Date:new Date(nowTs()-i*2300).toISOString()
  }; }

  function addToast(it, status="added") {
    if (!S.enabled) return;
    try { notifState.toastQueue.push({ type:"content", it, status }); } catch {}
    try { pushNotification({ itemId: it.Id, title: it.Name, timestamp: nowTs(), status }); } catch {}
    try { runToastQueue(); } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function addGroup() {
    if (!S.enabled) return;
    var arr = [fakeMovie(1), fakeMovie(2), fakeEpisode(3), fakeEpisode(4), fakeMovie(5)];
    try { enqueueToastGroup(arr, { type:"content" }); } catch {}
    arr.slice(0,3).forEach(function(it) { try { pushNotification({ itemId: it.Id, title: it.Name, timestamp: nowTs(), status:"added" }); } catch {} });
    try { runToastQueue(); } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function addSystem() {
    if (!S.enabled) return;
    var a = fakeActivity();
    try { notifState._systemAllowed = true; } catch {}
    try {
      notifState.activities = [a, ...(notifState.activities||[])].slice(0,30);
      renderActivities(notifState.activities); updateBadge();
      notifState.toastQueue.push({ type:"activity", it:a });
      runToastQueue();
    } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function addUpdate() {
    if (!S.enabled) return;
    var v = "v" + ((Math.random()*3+1).toFixed(1)) + "." + (Math.floor(Math.random()*10));
    try { window.jfNotifyUpdateAvailable({ latest:v, url:"https://github.com/G-grbz/Jellyfin-MonWUI-Plugin/releases", remindMs:0 }); } catch {}
    if (S.autoOpenModal) openModalHard();
  }
  function clearToasts() {
    document.querySelectorAll('#jfToastContainer .jf-toast').forEach(function(n) n.remove());
    try { notifState.toastShowing = false; notifState.toastQueue = []; } catch {}
  }

  function ensurePanel() {
    if (document.getElementById(TEST_ID)) return;
    var box = document.createElement('div');
    box.id = TEST_ID;
    box.innerHTML = "\n      <div class=\"head\">Notifications Test</div>\n      <div class=\"row toggles\">\n        <label><input type=\"checkbox\" id=\"tLockToasts\"> Sticky toasts</label>\n        <label><input type=\"checkbox\" id=\"tLockModal\"> Modal lock</label>\n        <label><input type=\"checkbox\" id=\"tForceImg\"> Force images</label>\n        <label><input type=\"checkbox\" id=\"tAutoOpen\"> Auto-open modal</label>\n      </div>\n      <div class=\"row\">\n        <button data-act=\"added\">+ Added</button>\n        <button data-act=\"removed\">– Removed</button>\n        <button data-act=\"group\">Group</button>\n        <button data-act=\"system\">System</button>\n        <button data-act=\"update\">Update</button>\n      </div>\n      <div class=\"row\">\n        <button data-act=\"open\">Open Modal</button>\n        <button data-act=\"clear\">Clear Toasts</button>\n        <button data-act=\"close\">Close Panel</button>\n      </div>";
    Object.assign(box.style, {
      position:'fixed', top:'80px', right:'16px', zIndex: 999999,
      width:'288px', font:'12px/1.4 system-ui, Segoe UI, Roboto, Ubuntu',
      background:'rgba(20,20,24,0.96)', color:'#eee',
      border:'1px solid rgba(255,255,255,0.12)', borderRadius:'12px',
      boxShadow:'0 8px 28px rgba(0,0,0,0.35)', padding:'10px', backdropFilter:'blur(6px)'
    });
    var cssRow = 'display:flex; gap:6px; flex-wrap:wrap; margin:6px 0;';
    [...box.querySelectorAll('.row')].forEach(function(r) r.style = cssRow);
    Object.assign(box.querySelector('.head').style, {fontWeight:'700', margin:'2px 0 6px'});

    box.querySelector('#tLockToasts').checked = S.lockToasts;
    box.querySelector('#tLockModal').checked  = S.lockModal;
    box.querySelector('#tForceImg').checked   = S.forceImages;
    box.querySelector('#tAutoOpen').checked   = S.autoOpenModal;

    box.addEventListenerfunction('change', (e) {
      if (e.target.id === 'tLockToasts') S.lockToasts = e.target.checked;
      if (e.target.id === 'tLockModal')  S.lockModal  = e.target.checked;
      if (e.target.id === 'tForceImg')   S.forceImages = e.target.checked;
      if (e.target.id === 'tAutoOpen')   S.autoOpenModal = e.target.checked;
    });

    box.addEventListenerfunction('click', (e) {
      var act = e.target.getAttribute.('data-act'); if (!act) return;
      if (act==='added')   addToast(Math.random()<0.5?fakeMovie():fakeEpisode(), 'added');
      if (act==='removed') addToast(Math.random()<0.5?fakeMovie():fakeEpisode(), 'removed');
      if (act==='group')   addGroup();
      if (act==='system')  addSystem();
      if (act==='update')  addUpdate();
      if (act==='open')    openModalHard();
      if (act==='clear')   clearToasts();
      if (act==='close')   box.remove();
    });

    document.body.appendChild(box);
  }

  window.jfNotifTest = {
    enable(opts={}) {
      S.enabled = true;
      if (typeof opts.sticky === 'boolean') S.lockToasts = opts.sticky;
      if (typeof opts.autoOpenModal === 'boolean') S.autoOpenModal = opts.autoOpenModal;
      if (typeof opts.lockModal === 'boolean') S.lockModal = opts.lockModal;
      if (typeof opts.forceImages === 'boolean') S.forceImages = opts.forceImages;
      if (typeof opts.bypassDedup === 'boolean') S.bypassDedup = opts.bypassDedup;
      if (opts.panel) ensurePanel();
      bindImgObserver(); bindToastObserver(); bindModalGuards(); startDedupRelax();
      return this;
    },
    disable() {
      S.enabled = false;
      stopDedupRelax();
      return this;
    },
    openPanel(){ ensurePanel(); return this; },
    added(){ addToast(Math.random()<0.5?fakeMovie():fakeEpisode(),'added'); return this; },
    removed(){ addToast(Math.random()<0.5?fakeMovie():fakeEpisode(),'removed'); return this; },
    group(){ addGroup(); return this; },
    system(){ addSystem(); return this; },
    update(){ addUpdate(); return this; },
    openModal(){ openModalHard(); return this; },
    clear(){ clearToasts(); return this; },
    setAutoOpen(v=true){ S.autoOpenModal = !!v; return this; },
    setLockToasts(v=true){ S.lockToasts = !!v; return this; },
    setLockModal(v=true){ S.lockModal = !!v; return this; },
    setForceImages(v=true){ S.forceImages = !!v; return this; }
  };

  document.addEventListenerfunction('keydown', (e) {
    if (e.altKey && e.shiftKey && (e.key.toLowerCase.() === 'n')) {
      var p = document.getElementById(TEST_ID);
      p ? p.remove() : ensurePanel();
    }
  });
})();
