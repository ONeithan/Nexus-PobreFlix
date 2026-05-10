import { fetchItemDetailsFull, fetchItemsBulk, getEmbyHeaders, getLastPlayNowBlockReason, getSessionInfo, makeApiRequest, playNow, updateFavoriteStatus } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { CollectionCacheDB } from "./collectionCacheDb.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import { ensureStudioHubLogoFromTmdb, ensureStudioHubManualEntry, JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT } from "./studioHubsShared.js";
import { showNotification } from "./player/ui/notification.js";
import { closeDetailsModalIfLoaded } from "./detailsModalLoader.js";

var WATCHLIST_ENDPOINT = "/Plugins/NexusPobreFlix/watchlist";
export var WATCHLIST_MODAL_ID = "monwui-watchlist-modal-root";
var WATCHLIST_STYLE_ID = "monwui-watchlist-modal-style";
var WATCHLIST_NAV_BUTTON_CLASS = "monwui-watchlist-nav-button";
var WATCHLIST_MUI_NAV_LINK_CLASS = "monwui-watchlist-nav-link";
var WATCHLIST_NAV_KIND_ATTR = "data-monwui-watchlist-nav-kind";
var WATCHLIST_ICON_PATH = "M1 3h16v2H1Zm0 6h6v2H1Zm0 6h8v2H1Zm8-4.24h3.85L14.5 7l1.65 3.76H20l-3 3.17l.9 4.05l-3.4-2.14L11.1 18l.9-4.05Z";
var WATCHLIST_ICON_DATA_URI = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"><path fill=\"rgba(255,247,224,0.92)\" d=\"" + WATCHLIST_ICON_PATH + "\"/></svg>"
);
var DASHBOARD_TTL_MS = 30000;
var GENERAL_STATS_TTL_MS = 60000;

var dashboardCache = null;
var dashboardPromise = null;
var generalStatsCache = null;
var generalStatsPromise = null;
var usersCache = null;
var usersPromise = null;
var tabsSliderObserver = null;
var tabsSliderObserverStopTimer = 0;
var tabsSliderRefreshQueued = false;
var tabsSliderBindingsInstalled = false;
var autoRemoveQueue = Promise.resolve();
var pendingAutoRemovalKeys = {};
var tabsSliderRefreshTimers = {};
var TABS_SLIDER_ROUTE_REFRESH_DELAYS_MS = [0, 120, 360, 900, 1800];
var TABS_SLIDER_OBSERVER_WINDOW_MS = 4000;
var collectionAutoRemovePending = {};
var favoriteMirrorPending = {};
var favoriteMirrorSuppressed = {};
var autoAddStudioHubPendingIds = {};
var autoAddedStudioHubIds = {};
var autoStudioHubLogoPendingIds = {};
var autoStudioHubLogoResolvedIds = {};
var favoriteMirrorInstalled = false;
var scheduleFavoriteMirrorTask = typeof queueMicrotask === "function"
  ? function(cb) { queueMicrotask(cb); }
  : function(cb) { Promise.resolve().then(cb); };

var WATCHLIST_STATS_TAB_KEY = "stats";
var WATCHLIST_TABS = [
  { key: "movies", labelKey: "watchlistMovieTab", fallback: "Filmes" },
  { key: "series", labelKey: "watchlistSeriesTab", fallback: "Séries" },
  { key: "music", labelKey: "watchlistMusicTab", fallback: "Música" },
  { key: "collections", labelKey: "watchlistCollectionTab", fallback: "Coleções" },
  { key: "albums", labelKey: "watchlistAlbumTab", fallback: "Álbuns" },
  { key: WATCHLIST_STATS_TAB_KEY, labelKey: "watchlistStatsTab", fallback: "Estatísticas" }
];

var WATCHLIST_CONTENT_TABS = [];
for (var i = 0; i < WATCHLIST_TABS.length; i++) {
  if (WATCHLIST_TABS[i].key !== WATCHLIST_STATS_TAB_KEY) {
    WATCHLIST_CONTENT_TABS.push(WATCHLIST_TABS[i]);
  }
}

var WATCHLIST_TAB_KEYS = {};
for (var j = 0; j < WATCHLIST_TABS.length; j++) {
  WATCHLIST_TAB_KEYS[WATCHLIST_TABS[j].key] = true;
}

var WATCHLIST_TAB_ALIASES = {
  watchlist: "movies",
  movie: "movies",
  movies: "movies",
  film: "movies",
  films: "movies",
  series: "series",
  show: "series",
  shows: "series",
  tv: "series",
  music: "music",
  collection: "collections",
  collections: "collections",
  boxset: "collections",
  album: "albums",
  albums: "albums",
  stats: WATCHLIST_STATS_TAB_KEY,
  statistics: WATCHLIST_STATS_TAB_KEY,
  summary: WATCHLIST_STATS_TAB_KEY,
  overview: WATCHLIST_STATS_TAB_KEY,
  istatistik: WATCHLIST_STATS_TAB_KEY,
  istatistikler: WATCHLIST_STATS_TAB_KEY,
  estatisticas: WATCHLIST_STATS_TAB_KEY
};
var DEFAULT_WATCHLIST_TAB = "movies";
var WATCHLIST_PREVIEW_HOVER_DELAY_MS = 90;
var WATCHLIST_PREVIEW_SWITCH_DELAY_MS = 320;
var WATCHLIST_COLLECTION_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
var WATCHLIST_COLLECTION_REFRESH_MS = 30000;
var WATCHLIST_COLLECTION_PREVIEW_LIMIT = 8;
var WATCHLIST_COLLECTION_PAGE_SIZE = 200;
var GENERAL_STATS_ITEM_FIELDS = [
  "Type","Name","SeriesName","ProductionYear","DateCreated","UserData","AlbumArtist","Artists","RunTimeTicks"
];
var WATCHLIST_VIEW_FIELDS = [
  "Type","Name","SeriesId","SeriesName","Album","AlbumId","AlbumArtist","Artists","Overview","Genres","RunTimeTicks",
  "CumulativeRunTimeTicks",
  "OfficialRating","ProductionYear","CommunityRating","CriticRating","ImageTags","PrimaryImageTag",
  "AlbumPrimaryImageTag","BackdropImageTags","ParentBackdropImageTags","ParentBackdropItemId",
  "SeriesBackdropImageTag","SeasonId","Series","UserData","MediaType","ChildCount"
];
var WATCHLIST_PROGRESSIVE_RENDER_THRESHOLD = 48;
var WATCHLIST_PROGRESSIVE_INITIAL_BATCH = 24;
var WATCHLIST_PROGRESSIVE_BATCH_SIZE = 32;
var watchlistPreviewCache = {};
var nextWatchlistFrame = typeof requestAnimationFrame === "function"
  ? function(cb) { requestAnimationFrame(cb); }
  : function(cb) { setTimeout(cb, 16); };
var watchlistViewModelCacheKey = "";
var watchlistViewModelCacheValue = null;
var watchlistViewModelCachePromise = null;
var WATCHLIST_HOME_TAB_ROUTE_RE = /^#\/(?:home|index)\?tab=/i;

function cfg() {
  var g = (typeof getConfig === "function" ? getConfig() : null);
  return g || {};
}

function shouldShowWatchlistTabsSliderButton() {
  var c = cfg();
  return (c && c.watchlistTabsSliderEnabled !== false);
}

function shouldAutoRemovePlayedFromWatchlist() {
  var c = cfg();
  return (c && c.watchlistAutoRemovePlayed === true);
}

function shouldAutoRemovePlayedFromFavorites() {
  var c = cfg();
  return shouldAutoRemovePlayedFromWatchlist() && (c && c.watchlistAutoRemovePlayedFromFavorites === true);
}

function shouldImportFavoritesOnStartup() {
  var c = cfg();
  return (c && c.watchlistImportFavoritesOnStartup === true);
}

function labels() {
  var c = cfg();
  return (c && c.languageLabels) || {};
}

function L(key, fallback) {
  var map = labels();
  var value = map ? map[key] : undefined;
  return (typeof value === "string" && value.trim()) ? value : fallback;
}

function text(value, fallback) {
  if (fallback === undefined) fallback = "";
  var out = String((value !== null && value !== undefined) ? value : "").trim();
  return out || fallback;
}

function notifyStudioHubResult(message, type, icon, duration) {
  if (type === undefined) type = "success";
  if (icon === undefined) icon = "building";
  if (duration === undefined) duration = 2600;

  var cleanMessage = text(message);
  if (!cleanMessage) return;

  showNotification("<i class=\"fas fa-" + String(icon) + "\" style=\"margin-right:8px;\"></i> " + String(cleanMessage), duration, type);
  var showMessage = window.showMessage;
  if (showMessage && typeof showMessage === "function") {
      showMessage(cleanMessage, type === "error" ? "error" : "success");
  }
}

function setStudioHubLoadingState(targetEl, isLoading) {
  var el = (targetEl && typeof targetEl.closest === "function") ? targetEl.closest("[data-monwuiwl-studio-id]") : targetEl;
  if (!el) return false;

  if (isLoading) {
    if (el.__studioHubBusy) return false;
    el.__studioHubBusy = true;
    el.__studioHubOriginalHtml = el.innerHTML;
    el.classList.add("is-loading");
    el.setAttribute("aria-busy", "true");
    el.style.pointerEvents = "none";
    el.style.opacity = "0.82";
    el.innerHTML = "<i class=\"fas fa-spinner fa-spin\" aria-hidden=\"true\" style=\"margin-right:6px;\"></i>" + String(el.__studioHubOriginalHtml || "");
    try {
      if ("disabled" in el) el.disabled = true;
    } catch (e) {}
    return true;
  }

  if (el.__studioHubOriginalHtml != null) {
    el.innerHTML = el.__studioHubOriginalHtml;
  }
  el.__studioHubOriginalHtml = null;
  el.__studioHubBusy = false;
  el.classList.remove("is-loading");
  el.removeAttribute("aria-busy");
  el.style.pointerEvents = "";
  el.style.opacity = "";
  try {
    if ("disabled" in el) el.disabled = false;
  } catch (e) {}
  return true;
}

function getItemTypeName(itemLike) {
  var val = (itemLike && (itemLike.Type || itemLike.ItemType || itemLike.type || itemLike.itemType));
  return text(val).toLowerCase();
}

function getItemMediaTypeName(itemLike) {
  var val = (itemLike && (itemLike.MediaType || itemLike.mediaType));
  return text(val).toLowerCase();
}

function normalizeWatchlistTabKey(value) {
  var key = text(value).toLowerCase();
  var normalized = WATCHLIST_TAB_ALIASES[key] || key;
  return WATCHLIST_TAB_KEYS[normalized] ? normalized : DEFAULT_WATCHLIST_TAB;
}

function isWatchlistStatsTab(value) {
  return normalizeWatchlistTabKey(value) === WATCHLIST_STATS_TAB_KEY;
}

function createEmptyWatchlistModel() {
  var model = {};
  for (var i = 0; i < WATCHLIST_TABS.length; i++) {
    model[WATCHLIST_TABS[i].key] = { own: [], shared: [] };
  }
  return model;
}

function getWatchlistTabLabel(tabKey) {
  var normalizedKey = normalizeWatchlistTabKey(tabKey);
  var tab = null;
  for (var i = 0; i < WATCHLIST_TABS.length; i++) {
    if (WATCHLIST_TABS[i].key === normalizedKey) {
      tab = WATCHLIST_TABS[i];
      break;
    }
  }
  var labelKey = (tab && tab.labelKey) ? tab.labelKey : "watchlistMovieTab";
  var fallbackLabel = (tab && tab.fallback) ? tab.fallback : "Filmes";
  return L(labelKey, fallbackLabel);
}

function getWatchlistTabButtonText(model, tabKey) {
  var normalizedTabKey = normalizeWatchlistTabKey(tabKey);
  var tab = null;
  for (var i = 0; i < WATCHLIST_TABS.length; i++) {
    if (WATCHLIST_TABS[i].key === normalizedTabKey) {
      tab = WATCHLIST_TABS[i];
      break;
    }
  }
  if (!tab) return "";

  var label = L(tab.labelKey, tab.fallback);
  if (normalizedTabKey === WATCHLIST_STATS_TAB_KEY) {
    return label;
  }

  var tabData = (model && model[normalizedTabKey]) ? model[normalizedTabKey] : null;
  var count = ((tabData && tabData.own) ? tabData.own : []).length + ((tabData && tabData.shared) ? tabData.shared : []).length;
  return String(label) + " (" + String(formatCount(count)) + ")";
}

function isSeriesItem(itemLike) {
  var type = getItemTypeName(itemLike);
  return type === "series" || type === "season" || type === "episode";
}

function isCollectionItem(itemLike) {
  var type = getItemTypeName(itemLike);
  return type === "boxset" || type === "collectionfolder";
}

function getPreviewContainerMode(itemLike) {
  var type = getItemTypeName(itemLike);
  if (type === "boxset" || type === "collectionfolder") return "collection";
  if (type === "series") return "season";
  if (type === "season") return "episode";
  return "";
}

function isMusicItem(itemLike) {
  var type = getItemTypeName(itemLike);
  var mediaType = getItemMediaTypeName(itemLike);
  if (type === "musicalbum") return false;
  if (mediaType === "audio") return true;
  var musicTypes = ["audio", "musicartist", "musicvideo", "playlist", "folder", "audiobook"];
  for (var i = 0; i < musicTypes.length; i++) {
    if (musicTypes[i] === type) return true;
  }
  return false;
}

function isMarkedPlayed(itemLike) {
  return (itemLike && itemLike.UserData && itemLike.UserData.Played === true);
}

function hasPartialPlayback(itemLike) {
  var userData = (itemLike && itemLike.UserData) ? itemLike.UserData : null;
  var playbackTicks = Number((userData && userData.PlaybackPositionTicks) ? userData.PlaybackPositionTicks : 0);
  if (!(playbackTicks > 0)) return false;

  var runtimeTicks = Number(
    (itemLike && (
      itemLike.RunTimeTicks ||
      itemLike.CumulativeRunTimeTicks ||
      itemLike.runtimeTicks
    )) || 0
  );

  if (runtimeTicks > 0) return playbackTicks < runtimeTicks;
  return !isMarkedPlayed(itemLike);
}

function getPlayActionLabel(itemLike) {
  return hasPartialPlayback(itemLike)
    ? L("devamet", "Continuar")
    : L("playNowLabel", "Assistir Agora");
}

function toTimestampMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return isFinite(value) ? value : 0;

  var asNumber = Number(value);
  if (isFinite(asNumber) && asNumber > 0) {
    return asNumber;
  }

  var parsed = Date.parse(String(value));
  return isFinite(parsed) ? parsed : 0;
}

function getLastPlayedTimestamp(itemLike) {
  var userData = (itemLike && itemLike.UserData) ? itemLike.UserData : null;
  return Math.max(
    toTimestampMs(userData && userData.LastPlayedDate),
    toTimestampMs(userData && userData.LastPlayedDateUtc),
    toTimestampMs(itemLike && itemLike.DatePlayed)
  );
}

function wasPlayedAfterWatchlistTimestamp(itemLike, watchlistTs) {
  if (!isMarkedPlayed(itemLike)) return false;
  var threshold = toTimestampMs(watchlistTs);
  if (threshold <= 0) return false;
  return getLastPlayedTimestamp(itemLike) > threshold;
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttrSelector(value) {
  var raw = text(value);
  try {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(raw);
    }
  } catch (e) {}
  return raw.replace(/["\\]/g, "\\$&");
}

function copyTextToClipboard(value) {
  var raw = text(value);
  if (!raw) return Promise.resolve(false);

  try {
    var cb = navigator ? navigator.clipboard : null;
    if (cb && typeof cb.writeText === "function") {
      return cb.writeText(raw).then(function() {
        return true;
      });
    }
  } catch (e) {}

  try {
    var input = document.createElement("textarea");
    input.value = raw;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    var copied = document.execCommand("copy");
    if (input.parentNode) input.parentNode.removeChild(input);
    return Promise.resolve(!!copied);
  } catch (e) {}

  return Promise.resolve(false);
}

function getCurrentServerIdSafe() {
  try {
    var session = (typeof getSessionInfo === "function" ? getSessionInfo() : null);
    var apiClient = window.ApiClient;
    return text(
      (session && (session.serverId || session.ServerId)) ||
      (apiClient && (apiClient._serverInfo && apiClient._serverInfo.Id)) ||
      (apiClient && apiClient._serverId)
    );
  } catch (e) {
    var sessionErr = (typeof getSessionInfo === "function" ? getSessionInfo() : null);
    return text(
      (sessionErr && (sessionErr.serverId || sessionErr.ServerId))
    );
  }
}

function maybeAutoEnsureStudioHub(studioId, studioName) {
  var cleanStudioId = text(studioId);
  var cleanStudioName = text(studioName);
  if (!cleanStudioId || !cleanStudioName) {
    return Promise.resolve({ attempted: false, added: false });
  }

  var config = cfg();
  if (!config || config.currentUserIsAdmin !== true || config.studioHubsAutoAddFromWatchlistCopy !== true) {
    return Promise.resolve({ attempted: false, added: false });
  }

  if (autoAddStudioHubPendingIds[cleanStudioId]) {
    return Promise.resolve({ attempted: false, added: false, skipped: true, pending: true });
  }

  if (autoAddedStudioHubIds[cleanStudioId]) {
    return Promise.resolve({ attempted: false, added: false, skipped: true, existing: true });
  }

  autoAddStudioHubPendingIds[cleanStudioId] = true;
  return ensureStudioHubManualEntry({
    studioId: cleanStudioId,
    name: cleanStudioName
  }).then(function(result) {
    autoAddedStudioHubIds[cleanStudioId] = true;

    try {
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, {
          detail: {
            source: "watchlist-auto-add",
            studioId: cleanStudioId,
            studioName: cleanStudioName,
            entry: (result && result.entry) ? result.entry : null,
            entries: (result && Array.isArray(result.entries)) ? result.entries : []
          }
        }));
      }
    } catch (e) {}

    return {
      attempted: true,
      added: (result && result.created === true),
      existing: (result && result.existing === true),
      entry: (result && result.entry) ? result.entry : null,
      entries: (result && Array.isArray(result.entries)) ? result.entries : []
    };
  })["catch"](function(error) {
    return {
      attempted: true,
      added: false,
      error: error
    };
  })["finally"](function() {
    delete autoAddStudioHubPendingIds[cleanStudioId];
  });
}

function maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, options) {
  var entries = (options && options.entries) ? options.entries : null;
  var cleanStudioId = text(studioId);
  var cleanStudioName = text(studioName);
  if (!cleanStudioId || !cleanStudioName) {
    return Promise.resolve({ attempted: false, uploaded: false });
  }

  var config = cfg();
  if (!config || config.currentUserIsAdmin !== true || config.studioHubsAutoAddFromWatchlistCopy !== true) {
    return Promise.resolve({ attempted: false, uploaded: false });
  }

  if (autoStudioHubLogoResolvedIds[cleanStudioId] || autoStudioHubLogoPendingIds[cleanStudioId]) {
    return Promise.resolve({ attempted: false, uploaded: false, skipped: true });
  }

  autoStudioHubLogoPendingIds[cleanStudioId] = true;
  return ensureStudioHubLogoFromTmdb({
    studioId: cleanStudioId,
    name: cleanStudioName,
    manualEntries: Array.isArray(entries) ? entries : null
  }).then(function(result) {
    autoStudioHubLogoResolvedIds[cleanStudioId] = true;
    return {
      attempted: (result && result.attempted !== false),
      uploaded: (result && result.uploaded === true),
      skipped: (result && result.skipped === true),
      reason: text(result && result.reason),
      entry: (result && result.entry) ? result.entry : null,
      entries: (result && Array.isArray(result.entries)) ? result.entries : []
    };
  })["catch"](function(error) {
    return {
      attempted: true,
      uploaded: false,
      error: error
    };
  })["finally"](function() {
    delete autoStudioHubLogoPendingIds[cleanStudioId];
  });
}

function getWatchlistTabsButtonMarkup(label) {
  var safeLabel = escapeHtml(label);
  return "" +
    "<span class=\"monwui-watchlist-nav-icon\" aria-hidden=\"true\">" +
    "  <svg class=\"monwui-watchlist-nav-svg\" xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" viewBox=\"0 0 20 20\" focusable=\"false\">" +
    "    <path fill=\"currentColor\" d=\"" + WATCHLIST_ICON_PATH + "\" />" +
    "  </svg>" +
    "</span>" +
    "<span class=\"monwui-watchlist-nav-label\">" + safeLabel + "</span>";
}

function getWatchlistMuiTabsButtonMarkup(label) {
  var safeLabel = escapeHtml(label);
  return "" +
    "<span class=\"MuiButton-icon MuiButton-startIcon MuiButton-iconSizeMedium monwui-watchlist-nav-icon\" aria-hidden=\"true\">" +
    "  <svg class=\"MuiSvgIcon-root MuiSvgIcon-fontSizeMedium monwui-watchlist-nav-svg\" xmlns=\"http://www.w3.org/2000/svg\" width=\"1em\" height=\"1em\" focusable=\"false\" aria-hidden=\"true\" viewBox=\"0 0 20 20\">" +
    "    <path fill=\"currentColor\" d=\"" + WATCHLIST_ICON_PATH + "\" />" +
    "  </svg>" +
    "</span>" +
    "<span class=\"monwui-watchlist-nav-label\">" + safeLabel + "</span>";
}

function renderWatchlistIconSvg(className, options) {
  if (className === undefined) className = "";
  var ariaHidden = (options && options.ariaHidden !== undefined) ? options.ariaHidden : true;
  var safeClassName = escapeHtml(text(className));
  var hiddenAttr = ariaHidden ? " aria-hidden=\"true\" focusable=\"false\"" : "";
  return "<svg class=\"" + String(safeClassName) + "\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 20\"" + String(hiddenAttr) + "><path fill=\"currentColor\" d=\"" + String(WATCHLIST_ICON_PATH) + "\" /></svg>";
}

function getWatchlistNavHref() {
  return text(window.location.hash).indexOf("#/index") === 0
    ? "#/index?tab=watchlist"
    : "#/home?tab=watchlist";
}

function isMuiHomeTabLink(link) {
  var href = text(link && typeof link.getAttribute === "function" ? link.getAttribute("href") : null);
  return WATCHLIST_HOME_TAB_ROUTE_RE.test(href);
}

function findMuiHomeTabsTargets() {
  var targets = [];
  var seenContainers = [];
  var favoritesLinksList = document.querySelectorAll("a[href=\"#/home?tab=1\"], a[href=\"#/index?tab=1\"]");
  var favoritesLinks = [];
  for (var i = 0; i < favoritesLinksList.length; i++) favoritesLinks.push(favoritesLinksList[i]);

  for (var j = 0; j < favoritesLinks.length; j++) {
    var link = favoritesLinks[j];
    var container = link.parentElement;
    if (!container) continue;
    var alreadySeen = false;
    for (var k = 0; k < seenContainers.length; k++) {
      if (seenContainers[k] === container) {
        alreadySeen = true;
        break;
      }
    }
    if (alreadySeen) continue;
    seenContainers.push(container);
    targets.push({ container: container, anchor: link });
  }

  if (targets.length) return targets;

  var allHomeLinks = document.querySelectorAll("a[href^=\"#/home?tab=\"], a[href^=\"#/index?tab=\"]");
  var homeTabLinks = [];
  for (var m = 0; m < allHomeLinks.length; m++) {
    if (isMuiHomeTabLink(allHomeLinks[m])) homeTabLinks.push(allHomeLinks[m]);
  }

  var groups = [];
  for (var n = 0; n < homeTabLinks.length; n++) {
    var l = homeTabLinks[n];
    var c = l.parentElement;
    if (!c) continue;
    var group = null;
    for (var p = 0; p < groups.length; p++) {
      if (groups[p].container === c) {
        group = groups[p];
        break;
      }
    }
    if (!group) {
      group = { container: c, links: [] };
      groups.push(group);
    }
    group.links.push(l);
  }

  for (var q = 0; q < groups.length; q++) {
    var g = groups[q];
    if (!g.links.length) continue;
    var seenAgain = false;
    for (var r = 0; r < seenContainers.length; r++) {
      if (seenContainers[r] === g.container) {
        seenAgain = true;
        break;
      }
    }
    if (seenAgain) continue;
    if (g.links.length < 2) continue;
    targets.push({ container: g.container, anchor: g.links[g.links.length - 1] });
  }

  return targets;
}

function getCurrentUserContext() {
  var userId = "";
  var userName = "";

  try {
    var api = window.ApiClient || window.apiClient || null;
    var session = (typeof getSessionInfo === "function" ? getSessionInfo() : null);
    userId = text(
      (api && (typeof api.getCurrentUserId === "function" ? api.getCurrentUserId() : api._currentUserId)) ||
      (session && session.userId)
    );
    userName = text(
      (api && api._currentUser && (api._currentUser.Name || api._currentUser.Username)) ||
      localStorage.getItem("currentUserName") ||
      sessionStorage.getItem("currentUserName")
    );
  } catch (e) {}

  return { userId: userId, userName: userName };
}

function normalizeIdentity(value) {
  return text(value).toLowerCase();
}

function buildFavoriteMirrorKey(itemId, isFavorite) {
  return (isFavorite ? "add" : "remove") + ":" + text(itemId);
}

function suppressFavoriteMirrorOnce(itemId, isFavorite) {
  var key = buildFavoriteMirrorKey(itemId, isFavorite);
  if (key.indexOf(":") !== (key.length - 1)) {
    favoriteMirrorSuppressed[key] = true;
    setTimeout(function() {
      delete favoriteMirrorSuppressed[key];
    }, 15000);
  }
}

function consumeFavoriteMirrorSuppression(itemId, isFavorite) {
  var key = buildFavoriteMirrorKey(itemId, isFavorite);
  if (!favoriteMirrorSuppressed[key]) return false;
  delete favoriteMirrorSuppressed[key];
  return true;
}

function getFavoriteMirrorUserId() {
  var session = (typeof getSessionInfo === "function" ? getSessionInfo() : null);
  return text(getCurrentUserContext().userId || (session && session.userId));
}

function setJellyfinFavoriteStatus(itemId, isFavorite, options) {
  var signal = (options && options.signal) ? options.signal : undefined;
  var userId = text(getFavoriteMirrorUserId());
  if (!userId) {
    var err = new Error("Sessão de usuário não encontrada.");
    err.status = 401;
    return Promise.reject(err);
  }

  var cleanItemId = text(itemId);
  if (!cleanItemId) {
    return Promise.reject(new Error("itemId gerekli"));
  }

  return makeApiRequest("/Users/" + String(encodeURIComponent(userId)) + "/FavoriteItems/" + String(encodeURIComponent(cleanItemId)), {
    method: isFavorite ? "POST" : "DELETE",
    signal: signal,
    __quiet: true
  });
}

function shouldSyncJellyfinFavoriteFromWatchlist(options) {
  if (options && options.syncJellyfinFavorite === true) return true;
  if (options && options.syncJellyfinFavorite === false) return false;
  if (options && options.__skipNativeFavoriteSync) return false;
  if (options && options.__favoriteMirror) return false;
  if (options && options.__startupImport) return false;
  return true;
}

function syncJellyfinFavoriteFromWatchlist(itemId, isFavorite, options) {
  var opt = options || {};
  if (!shouldSyncJellyfinFavoriteFromWatchlist(opt)) {
    return Promise.resolve(false);
  }

  var cleanItemId = text(itemId);
  if (!cleanItemId) return Promise.resolve(false);

  suppressFavoriteMirrorOnce(cleanItemId, isFavorite);
  return setJellyfinFavoriteStatus(cleanItemId, isFavorite, { signal: opt.signal }).then(function() {
    return true;
  });
}

function extractRequestUrl(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return String(input || "");
}

function parseFavoriteMutationRequest(method, requestUrl) {
  var normalizedMethod = text(method).toUpperCase();
  if (normalizedMethod !== "POST" && normalizedMethod !== "DELETE") return null;

  var parsed;
  try {
    parsed = new URL(extractRequestUrl(requestUrl), window.location.href);
  } catch (e) {
    return null;
  }

  var match = parsed.pathname.match(/\/Users\/([^/]+)\/FavoriteItems(?:\/([^/?#]+))?\/?$/i);
  if (!match) return null;

  var requestUserId = text(match[1]);
  var activeUserId = getFavoriteMirrorUserId();
  if (activeUserId && requestUserId && normalizeIdentity(activeUserId) !== normalizeIdentity(requestUserId)) {
    return null;
  }

  var itemIdsMap = {};
  var directItemId = text(match[2]);
  if (directItemId) {
    itemIdsMap[directItemId] = true;
  }

  var idsFromQuery = text(parsed.searchParams.get("Id")).split(",").concat(text(parsed.searchParams.get("Ids")).split(","));
  for (var i = 0; i < idsFromQuery.length; i++) {
    var id = text(idsFromQuery[i]);
    if (id) itemIdsMap[id] = true;
  }

  var finalIds = [];
  for (var key in itemIdsMap) {
    if (Object.prototype.hasOwnProperty.call(itemIdsMap, key)) {
      finalIds.push(key);
    }
  }

  if (!finalIds.length) return null;

  return {
    itemIds: finalIds,
    isFavorite: normalizedMethod !== "DELETE"
  };
}

function queueFavoriteMirror(mutation) {
  var isFavorite = (mutation && mutation.isFavorite === true);
  var rawIds = (mutation && Array.isArray(mutation.itemIds)) ? mutation.itemIds : [];
  var ids = [];
  for (var i = 0; i < rawIds.length; i++) {
    var val = text(rawIds[i]);
    if (val) ids.push(val);
  }
  if (!ids.length) return;

  scheduleFavoriteMirrorTask(function() {
    var sequence = Promise.resolve();
    var processItem = function(id) {
      if (consumeFavoriteMirrorSuppression(id, isFavorite)) return;

      var pendingKey = buildFavoriteMirrorKey(id, isFavorite);
      if (favoriteMirrorPending[pendingKey]) return;
      favoriteMirrorPending[pendingKey] = true;

      var action = isFavorite
        ? addToWatchlist(id, { __favoriteMirror: true })
        : removeFromWatchlist(id, { __favoriteMirror: true });

      return action.then(function() {
        delete favoriteMirrorPending[pendingKey];
      })["catch"](function(error) {
        console.debug("watchlist favorite mirror failed:", id, isFavorite, error);
        delete favoriteMirrorPending[pendingKey];
      });
    };

    for (var j = 0; j < ids.length; j++) {
      (function(idx) {
        sequence = sequence.then(function() {
          return processItem(ids[idx]);
        });
      })(j);
    }
  });
}

function fetchAllFavoriteItemsForUser(userId) {
  var cleanUserId = text(userId);
  if (!cleanUserId) return Promise.resolve([]);

  var limit = 200;
  var startIndex = 0;
  var out = [];

  var fetchNext = function() {
    return makeApiRequest(
      "/Users/" + encodeURIComponent(cleanUserId) + "/Items?Filters=IsFavorite&Recursive=true&IncludeItemTypes=Movie,Series,Season,Episode,Audio,MusicAlbum,MusicVideo,BoxSet,CollectionFolder,Playlist,Folder,AudioBook&SortBy=DateCreated&SortOrder=Descending&StartIndex=" + startIndex + "&Limit=" + limit
    ).then(function(result) {
      var items = (result && Array.isArray(result.Items)) ? result.Items : [];
      if (!items.length) return out;

      for (var i = 0; i < items.length; i++) out.push(items[i]);

      if (items.length < limit) return out;
      startIndex += items.length;
      return fetchNext();
    })["catch"](function() {
      return out;
    });
  };

  return fetchNext();
}

function syncFavoritesOnStartup() {
  if (!shouldImportFavoritesOnStartup()) return;

  var ctx = getCurrentUserContext();
  var userId = ctx.userId;
  var serverId = getCurrentServerIdSafe();
  var storageKey = "monwui:watchlist:favorites-bootstrap:" + String(serverId || "default") + ":" + String(userId || "anonymous");

  if (!userId) return;

  try {
    if (sessionStorage.getItem(storageKey) === "done") return;
  } catch (e) {}

  try {
    ensureWatchlistLoaded().then(function() {
      return fetchAllFavoriteItemsForUser(userId);
    }).then(function(favoriteItems) {
      if (!favoriteItems || !favoriteItems.length) {
        try {
          sessionStorage.setItem(storageKey, "done");
        } catch (e) {}
        return;
      }

      var sequence = Promise.resolve();
      var processItem = function(item) {
        var itemId = text(item && item.Id);
        if (!itemId) return;
        if (getCachedWatchlistMembership(itemId, false)) return;

        suppressFavoriteMirrorOnce(itemId, true);
        return addToWatchlist(itemId, {
          item: item,
          __favoriteMirror: true,
          __startupImport: true
        })["catch"](function(error) {
          console.debug("watchlist startup favorite import failed:", itemId, error);
        });
      };

      for (var i = 0; i < favoriteItems.length; i++) {
        (function(idx) {
          sequence = sequence.then(function() {
            return processItem(favoriteItems[idx]);
          });
        })(i);
      }

      return sequence.then(function() {
        try {
          sessionStorage.setItem(storageKey, "done");
        } catch (e) {}
      });
    })["catch"](function(error) {
      console.debug("watchlist favorite bootstrap sync failed:", error);
    });
  } catch (err) {
    console.debug("watchlist favorite bootstrap sync outer failed:", err);
  }
}

function installJellyfinFavoriteMirror() {
  if (favoriteMirrorInstalled) return;
  favoriteMirrorInstalled = true;

  if (typeof window.fetch === "function") {
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function patchedWatchlistFavoriteMirror(input, init) {
      var method = text((init && init.method) ? init.method : (input && input.method ? input.method : "GET"));
      var requestUrl = extractRequestUrl(input);

      return nativeFetch(input, init).then(function(response) {
        if (response && response.ok) {
          var mutation = parseFavoriteMutationRequest(method, requestUrl);
          if (mutation && mutation.itemIds && mutation.itemIds.length) queueFavoriteMirror(mutation);
        }
        return response;
      });
    };
  }

  if (typeof XMLHttpRequest !== "undefined") {
    var proto = XMLHttpRequest.prototype;
    var nativeOpen = proto.open;
    var nativeSend = proto.send;

    proto.open = function patchedWatchlistFavoriteMirrorOpen(method, url) {
      var args = Array.prototype.slice.call(arguments, 2);
      this.__monwuiFavoriteMirror = {
        method: text(method),
        url: extractRequestUrl(url)
      };
      this.__monwuiFavoriteMirrorListenerAttached = false;
      return nativeOpen.apply(this, [method, url].concat(args));
    };

    proto.send = function patchedWatchlistFavoriteMirrorSend(body) {
      var self = this;
      if (!this.__monwuiFavoriteMirrorListenerAttached) {
        this.__monwuiFavoriteMirrorListenerAttached = true;
        this.addEventListener("loadend", function() {
          if (self.status < 200 || self.status >= 300) return;
          var details = self.__monwuiFavoriteMirror || {};
          var mutation = parseFavoriteMutationRequest(details.method, details.url);
          if (mutation && mutation.itemIds && mutation.itemIds.length) queueFavoriteMirror(mutation);
        });
      }

      return nativeSend.call(this, body);
    };
  }
  scheduleFavoriteMirrorTask(function() {
    syncFavoritesOnStartup();
  });
}

function buildWatchlistHeaders(extra) {
  if (extra === undefined) extra = {};
  var ctx = getCurrentUserContext();
  var userId = ctx.userId;
  var userName = ctx.userName;

  var baseHeaders = { Accept: "application/json" };
  for (var k in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, k)) {
        baseHeaders[k] = extra[k];
    }
  }

  var headers = getEmbyHeaders(baseHeaders);

  if (userId) headers["X-Emby-UserId"] = userId;
  if (userName) headers["X-NexusPobreFlix-UserName"] = userName;

  return headers;
}

function requestWatchlist(path, options) {
  if (path === undefined) path = "";
  if (options === undefined) options = {};
  return fetch(String(WATCHLIST_ENDPOINT) + String(path), {
    method: options.method || "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: buildWatchlistHeaders(options.headers || {}),
    body: options.body
  }).then(function(response) {
    if (!response.ok) {
      return response.text().then(function(details) {
        throw new Error(details || "HTTP " + String(response.status));
      })["catch"](function() {
        throw new Error("HTTP " + String(response.status));
      });
    }

    if (response.status === 204) return null;
    return response.json()["catch"](function() { return {}; });
  });
}

function normalizeDashboard(raw) {
  var data = raw && typeof raw === "object" ? raw : {};
  var normalized = {
    revision: Number(data.revision || 0),
    myItems: Array.isArray(data.myItems) ? data.myItems : [],
    sharedWithMe: Array.isArray(data.sharedWithMe) ? data.sharedWithMe : [],
    outgoingShares: Array.isArray(data.outgoingShares) ? data.outgoingShares : [],
    historyEntries: Array.isArray(data.historyEntries) ? data.historyEntries : []
  };

  normalized._membership = buildMembershipSet(normalized);
  normalized._loadedAt = Date.now();
  normalized._userId = getCurrentUserContext().userId;
  return normalized;
}

function invalidateWatchlistViewModelCache() {
  watchlistViewModelCacheKey = "";
  watchlistViewModelCacheValue = null;
  watchlistViewModelCachePromise = null;
}

function getWatchlistViewModelCacheKey(dashboard) {
  if (!dashboard || typeof dashboard !== "object") return "";

  return [
    text(dashboard._userId),
    Number(dashboard.revision || 0),
    Number(dashboard._loadedAt || 0),
    Array.isArray(dashboard.myItems) ? dashboard.myItems.length : 0,
    Array.isArray(dashboard.sharedWithMe) ? dashboard.sharedWithMe.length : 0,
    Array.isArray(dashboard.outgoingShares) ? dashboard.outgoingShares.length : 0
  ].join("|");
}

function getCachedWatchlistViewModel(dashboard, options) {
  var force = (options && options.force === true);
  var cacheKey = getWatchlistViewModelCacheKey(dashboard);
  if (!cacheKey) {
    invalidateWatchlistViewModelCache();
    return Promise.resolve(createEmptyWatchlistModel());
  }

  if (!force && watchlistViewModelCacheKey === cacheKey) {
    if (watchlistViewModelCacheValue) return Promise.resolve(watchlistViewModelCacheValue);
    if (watchlistViewModelCachePromise) return watchlistViewModelCachePromise;
  }

  watchlistViewModelCacheKey = cacheKey;
  watchlistViewModelCacheValue = null;
  watchlistViewModelCachePromise = buildViewModel(dashboard)
    .then(function(model) {
      if (watchlistViewModelCacheKey === cacheKey) {
        watchlistViewModelCacheValue = model;
      }
      return model;
    })["finally"](function() {
      if (watchlistViewModelCacheKey === cacheKey) {
        watchlistViewModelCachePromise = null;
      }
    });

  return watchlistViewModelCachePromise;
}

function buildMembershipSet(dashboard) {
  var map = {};
  var myItems = (dashboard && dashboard.myItems) ? dashboard.myItems : [];

  for (var i = 0; i < myItems.length; i++) {
    var entry = myItems[i];
    var itemId = text(entry.ItemId || entry.itemId);
    if (itemId) map[itemId] = true;
  }

  var sharedWithMe = (dashboard && dashboard.sharedWithMe) ? dashboard.sharedWithMe : [];
  for (var j = 0; j < sharedWithMe.length; j++) {
    var shared = sharedWithMe[j];
    var shareEntry = (shared && (shared.Entry || shared.entry)) ? (shared.Entry || shared.entry) : null;
    var sharedId = text(shared.ItemId || shared.itemId || (shareEntry && (shareEntry.ItemId || shareEntry.itemId)));
    if (sharedId) map[sharedId] = true;
  }

  return map;
}

function refreshMembership(dashboard) {
  if (dashboard === undefined) dashboard = dashboardCache;
  if (!dashboard) return null;
  invalidateWatchlistViewModelCache();
  dashboard._membership = buildMembershipSet(dashboard);
  dashboard._loadedAt = Date.now();
  dashboard._userId = getCurrentUserContext().userId;
  dashboardCache = dashboard;
  return dashboardCache;
}

function invalidateGeneralStatsCache() {
  generalStatsCache = null;
  generalStatsPromise = null;
}

function dashboardStale() {
  var currentUserId = getCurrentUserContext().userId;
  if (!dashboardCache) return true;
  if (dashboardCache._userId !== currentUserId) return true;
  return (Date.now() - Number(dashboardCache._loadedAt || 0)) > DASHBOARD_TTL_MS;
}

export function ensureWatchlistLoaded(options) {
  var force = (options && options.force === true);
  if (!force && dashboardCache && !dashboardStale()) {
    return Promise.resolve(dashboardCache);
  }

  if (!force && dashboardPromise) {
    return dashboardPromise;
  }

  dashboardPromise = requestWatchlist("?ts=" + String(Date.now())).then(function(raw) {
    invalidateWatchlistViewModelCache();
    dashboardCache = normalizeDashboard(raw);
    return dashboardCache;
  })["finally"](function() {
    dashboardPromise = null;
  });

  return dashboardPromise;
}

export function getCachedWatchlistMembership(itemId, fallback) {
  var id = text(itemId);
  if (!id) return !!fallback;
  var membership = (dashboardCache && dashboardCache._membership) ? dashboardCache._membership : null;
  if (membership && typeof membership === "object") {
    return !!membership[id];
  }
  return !!fallback;
}

function patchItemMembership(item) {
  if (!item || typeof item !== "object") return item;
  var itemId = text(item.Id || item.ItemId);
  if (!itemId) return item;

  var inWatchlist = getCachedWatchlistMembership(itemId, (item.UserData && item.UserData.IsFavorite === true));
  if (!item.UserData || typeof item.UserData !== "object") {
    item.UserData = {};
  }
  item.UserData.IsFavorite = inWatchlist;
  item.__monwuiInWatchlist = inWatchlist;
  return item;
}

export function applyWatchlistState(payload) {
  if (Array.isArray(payload)) {
    for (var i = 0; i < payload.length; i++) {
      patchItemMembership(payload[i]);
    }
    return payload;
  }

  if (payload && Array.isArray(payload.Items)) {
    for (var j = 0; j < payload.Items.length; j++) {
      patchItemMembership(payload.Items[j]);
    }
    return payload;
  }

  return patchItemMembership(payload);
}

export function hydrateWatchlistState(payload, options) {
  var force = (options && options.force === true);
  return ensureWatchlistLoaded({ force: force }).then(function() {
    return applyWatchlistState(payload);
  });
}

function snapshotFromItem(item, itemId) {
  var genres = (item && Array.isArray(item.Genres)) ? item.Genres : [];
  var cleanGenres = [];
  for (var i = 0; i < genres.length; i++) if (genres[i]) cleanGenres.push(genres[i]);

  var artists = (item && Array.isArray(item.Artists)) ? item.Artists : [];
  var cleanArtists = [];
  for (var j = 0; j < artists.length; j++) if (artists[j]) cleanArtists.push(artists[j]);

  return {
    ItemId: text(item ? (item.Id || itemId) : itemId),
    ItemType: text(item && item.Type),
    Name: text(item ? (item.Name || item.Album) : ""),
    Overview: text(item && item.Overview),
    ProductionYear: (item && isFinite(Number(item.ProductionYear))) ? Number(item.ProductionYear) : null,
    RunTimeTicks: (item && isFinite(Number(item.RunTimeTicks))) ? Number(item.RunTimeTicks) : null,
    CommunityRating: (item && isFinite(Number(item.CommunityRating))) ? Number(item.CommunityRating) : null,
    OfficialRating: text(item && item.OfficialRating),
    Genres: cleanGenres,
    AlbumArtist: text(item && item.AlbumArtist),
    Artists: cleanArtists,
    ParentName: text(item ? (item.SeriesName || item.Album || item.ParentName) : "")
  };
}

function ensureDashboardCacheShell() {
  if (!dashboardCache) {
    dashboardCache = normalizeDashboard({
      myItems: [],
      sharedWithMe: [],
      outgoingShares: [],
      historyEntries: []
    });
  }
  return dashboardCache;
}

function createLocalHistoryEntry(itemLike, itemId, options) {
  var removedAfterPlayed = (options && options.removedAfterPlayed === true);
  var ctx = getCurrentUserContext();
  var userId = ctx.userId;
  var userName = ctx.userName;
  var now = Date.now();
  return {
    ItemId: text(itemLike ? (itemLike.ItemId || itemLike.itemId || itemLike.Id || itemId) : itemId),
    ItemType: text(itemLike && (itemLike.ItemType || itemLike.itemType || itemLike.Type)),
    Name: text(itemLike && (itemLike.Name || itemLike.name || itemLike.Album || itemLike.album)),
    OwnerUserId: text(itemLike ? (itemLike.OwnerUserId || itemLike.ownerUserId || userId) : userId),
    OwnerUserName: text(itemLike ? (itemLike.OwnerUserName || itemLike.ownerUserName || userName) : userName),
    FirstAddedAtUtc: Number(itemLike ? (itemLike.AddedAtUtc || itemLike.addedAtUtc || now) : now),
    LastAddedAtUtc: Number(itemLike ? (itemLike.AddedAtUtc || itemLike.addedAtUtc || now) : now),
    LastRemovedAtUtc: removedAfterPlayed ? now : 0,
    AddCount: 1,
    RemoveCount: removedAfterPlayed ? 1 : 0,
    RemovedAfterPlayed: removedAfterPlayed === true
  };
}

function mutateHistoryAfterAdd(entry) {
  var cache = ensureDashboardCacheShell();
  var itemId = text(entry && (entry.ItemId || entry.itemId));
  if (!itemId) return;

  var historyEntries = Array.isArray(cache.historyEntries) ? cache.historyEntries : [];
  var existing = null;
  for (var i = 0; i < historyEntries.length; i++) {
    if (text(historyEntries[i].ItemId || historyEntries[i].itemId) === itemId) {
        existing = historyEntries[i];
        break;
    }
  }
  var now = Number(entry ? (entry.AddedAtUtc || entry.addedAtUtc || Date.now()) : Date.now());

  if (!existing) {
    historyEntries.unshift(createLocalHistoryEntry(entry, itemId));
    cache.historyEntries = historyEntries;
    return;
  }

  if (entry && text(entry.ItemType || entry.itemType) && !text(existing.ItemType || existing.itemType)) {
    existing.ItemType = text(entry.ItemType || entry.itemType);
  }
  if (entry && text(entry.Name || entry.name) && !text(existing.Name || existing.name)) {
    existing.Name = text(entry.Name || entry.name);
  }
  if (now > Number(existing.LastAddedAtUtc || existing.lastAddedAtUtc || 0)) {
    existing.LastAddedAtUtc = now;
  }
  if (!(Number(existing.FirstAddedAtUtc || existing.firstAddedAtUtc || 0) > 0)) {
    existing.FirstAddedAtUtc = now;
  }
  existing.AddCount = Math.max(1, Number(existing.AddCount || existing.addCount || 0) + 1);
}

function mutateHistoryAfterRemove(itemId, options) {
  var cache = ensureDashboardCacheShell();
  var id = text(itemId);
  if (!id) return;

  var played = (options && options.played === true) || isMarkedPlayed(options && options.item);
  var historyEntries = Array.isArray(cache.historyEntries) ? cache.historyEntries : [];
  var existing = null;
  for (var i = 0; i < historyEntries.length; i++) {
    if (text(historyEntries[i].ItemId || historyEntries[i].itemId) === id) {
        existing = historyEntries[i];
        break;
    }
  }

  if (!existing) {
    existing = createLocalHistoryEntry((options && options.item) || { ItemId: id }, id, { removedAfterPlayed: played });
    historyEntries.unshift(existing);
    cache.historyEntries = historyEntries;
  }

  var now = Date.now();
  existing.LastRemovedAtUtc = now;
  existing.RemoveCount = Math.max(1, Number(existing.RemoveCount || existing.removeCount || 0) + 1);
  if (played) {
    existing.RemovedAfterPlayed = true;
  }
}

function mutateCacheAfterAdd(entry) {
  var normalizedEntry = entry && typeof entry === "object" ? entry : null;
  if (!normalizedEntry) return;
  ensureDashboardCacheShell();

  var itemId = text(normalizedEntry.ItemId || normalizedEntry.itemId);
  if (!itemId) return;

  var myItems = (dashboardCache.myItems || []);
  var nextItems = [];
  for (var i = 0; i < myItems.length; i++) {
      if (text(myItems[i].ItemId || myItems[i].itemId) !== itemId) {
          nextItems.push(myItems[i]);
      }
  }
  nextItems.unshift(normalizedEntry);
  dashboardCache.myItems = nextItems;
  mutateHistoryAfterAdd(normalizedEntry);
  refreshMembership(dashboardCache);
}

function mutateCacheAfterRemove(itemId, options) {
  ensureDashboardCacheShell();
  if (!dashboardCache) return;
  var id = text(itemId);
  var myItems = (dashboardCache.myItems || []);
  var nextItems = [];
  for (var i = 0; i < myItems.length; i++) {
      if (text(myItems[i].ItemId || myItems[i].itemId) !== id) {
          nextItems.push(myItems[i]);
      }
  }
  dashboardCache.myItems = nextItems;
  mutateHistoryAfterRemove(id, options);
  refreshMembership(dashboardCache);
}

function mutateCacheAfterShareRemoval(shareId) {
  ensureDashboardCacheShell();
  if (!dashboardCache) return;
  var id = text(shareId);
  
  var sharedWithMe = (dashboardCache.sharedWithMe || []);
  var nextShared = [];
  for (var i = 0; i < sharedWithMe.length; i++) {
    if (text(sharedWithMe[i].Id || sharedWithMe[i].id) !== id) {
        nextShared.push(sharedWithMe[i]);
    }
  }
  dashboardCache.sharedWithMe = nextShared;

  var outgoingShares = (dashboardCache.outgoingShares || []);
  var nextOutgoing = [];
  for (var j = 0; j < outgoingShares.length; j++) {
    if (text(outgoingShares[j].Id || outgoingShares[j].id) !== id) {
        nextOutgoing.push(outgoingShares[j]);
    }
  }
  dashboardCache.outgoingShares = nextOutgoing;

  refreshMembership(dashboardCache);
}

function notifyWatchlistChanged(detail) {
  if (detail === undefined) detail = {};
  try {
    var revision = (dashboardCache && dashboardCache.revision) ? dashboardCache.revision : 0;
    var finalDetail = {};
    for (var k in detail) {
        if (Object.prototype.hasOwnProperty.call(detail, k)) finalDetail[k] = detail[k];
    }
    finalDetail.revision = revision;

    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("monwui:watchlist-changed", {
        detail: finalDetail
      }));
    }
  } catch (e) {}
}

export function isMusicAlbumItem(itemLike) {
  var type = text(
    itemLike && (
      itemLike.Type ||
      itemLike.ItemType ||
      itemLike.type ||
      itemLike.itemType
    )
  );
  return type.toLowerCase() === "musicalbum";
}

export function getWatchlistButtonText(itemLike, inWatchlist) {
  if (inWatchlist) {
    return isMusicAlbumItem(itemLike)
      ? L("watchlistAlbumRemove", "Remover da lista de álbuns")
      : L("watchlistRemove", "Remover da lista");
  }

  return isMusicAlbumItem(itemLike)
    ? L("watchlistAlbumAdd", "Adicionar à lista de álbuns")
    : L("watchlistAdd", "Listeme ekle");
}

export function getWatchlistButtonTitle(itemLike, inWatchlist) {
  return getWatchlistButtonText(itemLike, inWatchlist);
}

export function getWatchlistToast(itemLike, added) {
  if (added) {
    return isMusicAlbumItem(itemLike)
      ? L("watchlistAlbumAdded", "Álbum adicionado à lista")
      : L("watchlistAdded", "Item adicionado à lista");
  }

  return isMusicAlbumItem(itemLike)
    ? L("watchlistAlbumRemoved", "Removido da lista de álbuns")
    : L("watchlistRemoved", "Item removido da lista");
}

export function getWatchlistTabKey(itemLike) {
  if (isMusicAlbumItem(itemLike)) return "albums";
  if (isCollectionItem(itemLike)) return "collections";
  if (isSeriesItem(itemLike)) return "series";
  if (isMusicItem(itemLike)) return "music";
  return "movies";
}

export function addToWatchlist(itemId, options) {
  var opt = options || {};
  var id = text(itemId);
  if (!id) return Promise.reject(new Error("itemId gerekli"));

  return syncJellyfinFavoriteFromWatchlist(id, true, opt).then(function(syncedFavorite) {
    var item = opt.item;
    var fetchPromise = (!item || text(item.Id) !== id)
      ? fetchItemDetailsFull(id)
      : Promise.resolve(item);

    return fetchPromise.then(function(fetchedItem) {
      item = fetchedItem;
      var payload = snapshotFromItem(item, id);
      return requestWatchlist("/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function(result) {
        mutateCacheAfterAdd((result && result.item) ? result.item : payload);
        if (item) patchItemMembership(item);
        notifyWatchlistChanged({ itemId: id, inWatchlist: true });
        return result;
      })["catch"](function(error) {
        if (syncedFavorite) {
          suppressFavoriteMirrorOnce(id, false);
          setJellyfinFavoriteStatus(id, false, { signal: opt.signal })["catch"](function() {});
        }
        throw error;
      });
    });
  });
}

export function removeFromWatchlist(itemId, options) {
  var opt = options || {};
  var id = text(itemId);
  if (!id) return Promise.reject(new Error("itemId gerekli"));
  var wasPlayed = opt.played === true || isMarkedPlayed(opt.item);

  return syncJellyfinFavoriteFromWatchlist(id, false, opt).then(function(syncedFavorite) {
    var query = wasPlayed ? "?played=true" : "";
    return requestWatchlist("/items/" + String(encodeURIComponent(id)) + String(query), {
      method: "DELETE"
    }).then(function(result) {
      mutateCacheAfterRemove(id, opt);
      if (opt.item) patchItemMembership(opt.item);
      notifyWatchlistChanged({ itemId: id, inWatchlist: false });
      return result;
    })["catch"](function(error) {
      if (syncedFavorite) {
        suppressFavoriteMirrorOnce(id, true);
        setJellyfinFavoriteStatus(id, true, { signal: opt.signal })["catch"](function() {});
      }
      throw error;
    });
  });
}

export function shareWatchlistItem(itemId, targets, note) {
  var id = text(itemId);
  if (!id) return Promise.reject(new Error("itemId gerekli"));
  
  var tgs = targets || [];
  var normalizedTargets = [];
  for (var i = 0; i < tgs.length; i++) {
    var target = tgs[i];
    var targetUserId = text(target ? (target.UserId || target.userId || target.Id || target.id) : "");
    if (targetUserId) {
        normalizedTargets.push({
            UserId: targetUserId,
            UserName: text(target ? (target.UserName || target.userName || target.Name || target.name) : "")
        });
    }
  }

  if (!normalizedTargets.length) return Promise.reject(new Error(L("watchlistSelectUsers", "Selecione pelo menos um usuário")));

  return requestWatchlist("/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ItemId: id,
      Targets: normalizedTargets,
      Note: text(note)
    })
  }).then(function(result) {
    return ensureWatchlistLoaded({ force: true }).then(function() {
      notifyWatchlistChanged({ itemId: id, shared: true });
      return result;
    });
  });
}

export function removeWatchlistShare(shareId) {
  var id = text(shareId);
  if (!id) return Promise.reject(new Error("shareId gerekli"));

  return requestWatchlist("/shares/" + String(encodeURIComponent(id)), {
    method: "DELETE"
  }).then(function(result) {
    mutateCacheAfterShareRemoval(id);
    notifyWatchlistChanged({ shareId: id, shared: false });
    return result;
  });
}

function collectAutoRemovalTasksByItemId(itemId, dashboard) {
  if (dashboard === undefined) dashboard = dashboardCache;
  var id = text(itemId);
  if (!id || !dashboard) return [];

  var tasks = [];
  var myItems = (dashboard.myItems || []);
  var hasOwn = false;
  for (var i = 0; i < myItems.length; i++) {
    if (text(myItems[i].ItemId || myItems[i].itemId) === id) {
        hasOwn = true;
        break;
    }
  }
  if (hasOwn) {
    tasks.push({ kind: "own", itemId: id });
  }

  var sharedWithMe = (dashboard.sharedWithMe || []);
  for (var j = 0; j < sharedWithMe.length; j++) {
    var shared = sharedWithMe[j];
    var shareId = text(shared && (shared.Id || shared.id));
    var entry = (shared && (shared.Entry || shared.entry)) ? (shared.Entry || shared.entry) : null;
    var sharedItemId = text(shared.ItemId || shared.itemId || (entry && (entry.ItemId || entry.itemId)));
    if (!shareId || sharedItemId !== id) continue;
    tasks.push({ kind: "shared", itemId: id, shareId: shareId });
  }

  return tasks;
}

function dedupeAutoRemovalTasks(tasks) {
  if (tasks === undefined) tasks = [];
  var out = [];
  var seen = {};
  var list = Array.isArray(tasks) ? tasks : [];

  for (var i = 0; i < list.length; i++) {
    var task = list[i];
    var dedupeKey = (task && task.kind === "shared")
      ? ("shared:" + String(text(task.shareId)))
      : ("own:" + String(text(task && task.itemId)));

    if (!dedupeKey || seen[dedupeKey]) continue;
    seen[dedupeKey] = true;
    out.push(task);
  }

  return out;
}

function mapWithConcurrency(items, limit, iteratee) {
  if (items === undefined) items = [];
  if (limit === undefined) limit = 3;
  var list = Array.isArray(items) ? items : [];
  if (!list.length || typeof iteratee !== "function") return Promise.resolve([]);

  var out = new Array(list.length);
  var nextIndex = 0;
  var workerCount = Math.max(1, Math.min(Number(limit) || 1, list.length));

  var createWorker = function() {
    var step = function() {
      var index = nextIndex++;
      if (index >= list.length) return Promise.resolve();

      return Promise.resolve(iteratee(list[index], index)).then(function(val) {
        out[index] = val;
        return step();
      });
    };
    return step();
  };

  var workers = [];
  for (var w = 0; w < workerCount; w++) {
    workers.push(createWorker());
  }

  return Promise.all(workers).then(function() {
    return out;
  });
}

function getSeriesSeasonAutoRemoveMode(itemLike) {
  var type = getItemTypeName(itemLike);
  if (type === "series") return "series";
  if (type === "season") return "season";
  return "";
}

function fetchSeriesSeasonAutoRemoveItems(containerItem, options) {
  var signal = (options && options.signal) ? options.signal : undefined;
  var mode = getSeriesSeasonAutoRemoveMode(containerItem);
  var itemId = text(containerItem && (containerItem.Id || containerItem.itemId));
  var userId = (typeof getCurrentUserIdSafe === "function" ? getCurrentUserIdSafe() : "");
  if (!userId || !itemId || !mode) return Promise.resolve([]);

  var out = [];
  var seen = {};
  var startIndex = 0;

  var fetchNext = function() {
    var url = "/Items?UserId=" + encodeURIComponent(userId) +
              "&ParentId=" + encodeURIComponent(itemId) +
              "&IncludeItemTypes=Episode" +
              "&Recursive=" + (mode === "series" ? "true" : "false") +
              "&Fields=Id,UserData" +
              "&SortBy=ParentIndexNumber,IndexNumber,SortName" +
              "&SortOrder=Ascending" +
              "&Limit=" + WATCHLIST_COLLECTION_PAGE_SIZE +
              "&StartIndex=" + startIndex;

    return makeApiRequest(url, { signal: signal }).then(function(response) {
      var pageItems = (response && Array.isArray(response.Items)) ? response.Items : [];
      if (!pageItems.length) return out;

      for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        var id = text(item && item.Id);
        if (!id || seen[id]) continue;
        seen[id] = true;
        out.push(item);
      }

      if (pageItems.length < WATCHLIST_COLLECTION_PAGE_SIZE) return out;
      startIndex += WATCHLIST_COLLECTION_PAGE_SIZE;
      return fetchNext();
    });
  };

  return fetchNext();
}

function isSeriesSeasonWatchlistItemComplete(containerItem, options) {
  var signal = (options && options.signal) ? options.signal : undefined;
  return fetchSeriesSeasonAutoRemoveItems(containerItem, { signal: signal }).then(function(items) {
    if (!items || !items.length) return false;
    for (var i = 0; i < items.length; i++) {
      if (!isMarkedPlayed(items[i])) return false;
    }
    return true;
  })["catch"](function() {
    return false;
  });
}

function getCompletedSeriesSeasonWatchlistItemIds(dashboard, found) {
  var candidates = {};

  var registerCandidate = function(entryLike, liveItem) {
    if (liveItem === undefined) liveItem = null;
    var itemId = text(
      (liveItem && liveItem.Id) ||
      (entryLike && (entryLike.ItemId || entryLike.itemId)) ||
      (entryLike && entryLike.Entry && (entryLike.Entry.ItemId || entryLike.Entry.itemId)) ||
      (entryLike && entryLike.entry && (entryLike.entry.ItemId || entryLike.entry.itemId))
    );
    if (!itemId || candidates[itemId]) return;

    var mode = getSeriesSeasonAutoRemoveMode(liveItem || entryLike);
    if (!mode) return;

    candidates[itemId] = {
      Id: itemId,
      Type: mode === "series" ? "Series" : "Season"
    };
  };

  var myItems = (dashboard && dashboard.myItems) ? dashboard.myItems : [];
  for (var i = 0; i < myItems.length; i++) {
    var entry = myItems[i];
    var id = text(entry.ItemId || entry.itemId);
    registerCandidate(entry, (found && typeof found.get === "function" ? found.get(id) : (found ? found[id] : null)));
  }

  var sharedWithMe = (dashboard && dashboard.sharedWithMe) ? dashboard.sharedWithMe : [];
  for (var j = 0; j < sharedWithMe.length; j++) {
    var shared = sharedWithMe[j];
    var sEntry = (shared && (shared.Entry || shared.entry)) ? (shared.Entry || shared.entry) : shared;
    var sId = text(shared.ItemId || shared.itemId || (sEntry && (sEntry.ItemId || sEntry.itemId)));
    registerCandidate(sEntry, (found && typeof found.get === "function" ? found.get(sId) : (found ? found[sId] : null)));
  }

  var candidateList = [];
  for (var k in candidates) if (Object.prototype.hasOwnProperty.call(candidates, k)) candidateList.push(candidates[k]);

  if (!candidateList.length) return Promise.resolve({});

  return mapWithConcurrency(
    candidateList,
    3,
    function(candidate) {
      return isSeriesSeasonWatchlistItemComplete(candidate).then(function(complete) {
        return complete ? candidate.Id : "";
      });
    }
  ).then(function(checks) {
    var set = {};
    for (var l = 0; l < checks.length; l++) if (checks[l]) set[checks[l]] = true;
    return set;
  });
}

function collectParentContainerAutoRemovalTasks(itemId, dashboard) {
  if (dashboard === undefined) dashboard = dashboardCache;
  var id = text(itemId);
  if (!id || !dashboard) return Promise.resolve([]);

  return fetchItemDetailsFull(id).then(function(details) {
    var type = getItemTypeName(details);
    if (!type) return [];

    var candidates = [];
    if (type === "episode") {
      var seasonId = text(details && details.SeasonId);
      var seriesId = text(details && (details.SeriesId || (details.Series && details.Series.Id)));
      if (seasonId) candidates.push({ Id: seasonId, Type: "Season" });
      if (seriesId) candidates.push({ Id: seriesId, Type: "Series" });
    } else if (type === "season") {
      var seriesId2 = text(details && (details.SeriesId || (details.Series && details.Series.Id)));
      if (seriesId2) candidates.push({ Id: seriesId2, Type: "Series" });
    }

    if (!candidates.length) return [];

    var processCandidates = function() {
      var results = [];
      var next = function(idx) {
        if (idx >= candidates.length) return results;
        var candidate = candidates[idx];
        var tasks = collectAutoRemovalTasksByItemId(candidate.Id, dashboard);
        if (!tasks.length) return next(idx + 1);

        return isSeriesSeasonWatchlistItemComplete(candidate).then(function(complete) {
          if (complete) {
            for (var m = 0; m < tasks.length; m++) results.push(tasks[m]);
          }
          return next(idx + 1);
        });
      };
      return next(0);
    };

    return processCandidates().then(function(mergedTasks) {
      return dedupeAutoRemovalTasks(mergedTasks);
    });
  })["catch"](function() {
    return [];
  });
}

function processAutoRemovalTasks(tasks) {
  var queue = dedupeAutoRemovalTasks(tasks || []).filter(function(t) { return !!t; });
  if (!queue.length) return Promise.resolve();

  autoRemoveQueue = Promise.resolve(autoRemoveQueue)["catch"](function() { return undefined; })
    .then(function() {
      var processNext = function(idx) {
        if (idx >= queue.length) return;
        var task = queue[idx];
        var dedupeKey = (task.kind === "shared")
          ? ("shared:" + String(text(task.shareId)))
          : ("own:" + String(text(task.itemId)));

        if (!dedupeKey || pendingAutoRemovalKeys[dedupeKey]) return processNext(idx + 1);
        pendingAutoRemovalKeys[dedupeKey] = true;

        var action = Promise.resolve();
        if (task.kind === "shared" && task.shareId) {
          action = removeWatchlistShare(task.shareId);
        } else if (task.itemId) {
          if (shouldAutoRemovePlayedFromFavorites()) {
            action = updateFavoriteStatus(task.itemId, false, { played: true });
          } else {
            action = removeFromWatchlist(task.itemId, { syncJellyfinFavorite: false, played: true });
          }
        }

        return action.then(function() {
          delete pendingAutoRemovalKeys[dedupeKey];
          return processNext(idx + 1);
        })["catch"](function() {
          delete pendingAutoRemovalKeys[dedupeKey];
          return processNext(idx + 1);
        });
      };
      return processNext(0);
    });

  return autoRemoveQueue;
}

function queueAutoRemoveWatchedEntries(tasks) {
  if (!shouldAutoRemovePlayedFromWatchlist()) return;
  processAutoRemovalTasks(tasks || []);
}

export function removePlayedItemFromWatchlist(itemId) {
  if (!shouldAutoRemovePlayedFromWatchlist()) return Promise.resolve(false);

  var id = text(itemId);
  if (!id) return Promise.resolve(false);

  return ensureWatchlistLoaded().then(function(dashboard) {
    var directTasks = collectAutoRemovalTasksByItemId(id, dashboard);
    return collectParentContainerAutoRemovalTasks(id, dashboard).then(function(parentTasks) {
      var tasks = dedupeAutoRemovalTasks(directTasks.concat(parentTasks));
      if (!tasks.length) return false;

      return processAutoRemovalTasks(tasks).then(function() {
        return true;
      });
    });
  })["catch"](function() {
    return false;
  });
}

function fetchShareableUsers() {
  if (Array.isArray(usersCache)) return Promise.resolve(usersCache);
  if (usersPromise) return usersPromise;

  var currentUserId = getCurrentUserContext().userId;
  var users = [];

  var tryApi = function() {
    try {
      var api = window.ApiClient || window.apiClient || null;
      if (api && typeof api.getUsers === "function") {
        return api.getUsers()["catch"](function() { return null; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  };

  var tryPublic = function() {
    return fetch(withServer("/Users/Public"), {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    }).then(function(response) {
      if (response.ok) return response.json()["catch"](function() { return []; });
      return [];
    })["catch"](function() { return []; });
  };

  usersPromise = tryApi().then(function(apiUsers) {
    if (Array.isArray(apiUsers)) return apiUsers;
    return tryPublic();
  }).then(function(found) {
    var raw = Array.isArray(found) ? found : (found && Array.isArray(found.Items) ? found.Items : []);
    var list = [];
    for (var i = 0; i < raw.length; i++) {
      var u = raw[i];
      var uid = text(u && (u.Id || u.id));
      var uname = text(u && (u.Name || u.Username || u.name || u.username));
      if (uid && uname && uid !== currentUserId) {
        list.push({ id: uid, name: uname });
      }
    }

    list.sort(function(left, right) {
      var config = cfg();
      var locale = (config && config.dateLocale) ? config.dateLocale : "pt-BR";
      if (typeof left.name.localeCompare === "function") {
        return left.name.localeCompare(right.name, locale);
      }
      return left.name < right.name ? -1 : (left.name > right.name ? 1 : 0);
    });

    usersCache = list;
    return usersCache;
  })["finally"](function() {
    usersPromise = null;
  });

  return usersPromise;
}

function ensureStyles() {
  if (document.getElementById(WATCHLIST_STYLE_ID)) return;

  var style = document.createElement("style");
  style.id = WATCHLIST_STYLE_ID;
    "#" + WATCHLIST_MODAL_ID + " {" +
    "  inset: 0;" +
    "  position: fixed;" +
    "  z-index: 9998;" +
    "  display: none;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + ".visible {" +
    "  display: block;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-backdrop {" +
    "  position: absolute;" +
    "  inset: 0;" +
    "  background:" +
    "    radial-gradient(circle at top left, rgba(255, 193, 7, 0.18), transparent 28%)," +
    "    linear-gradient(180deg, rgba(8, 10, 16, 0.72), rgba(7, 9, 15, 0.92));" +
    "  backdrop-filter: blur(14px);" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  padding: 18px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-card {" +
    "  width: min(1280px, calc(110vw - 24px));" +
    "  height: min(92vh, 900px);" +
    "  background:" +
    "    linear-gradient(180deg, rgba(21, 25, 36, 0.96), rgba(10, 12, 18, 0.98));" +
    "  border: 1px solid rgba(255, 255, 255, 0.08);" +
    "  border-radius: 24px;" +
    "  color: #f8f8fb;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  overflow: hidden;" +
    "  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-header {" +
    "  display: flex;" +
    "  align-items: flex-start;" +
    "  justify-content: space-between;" +
    "  gap: 18px;" +
    "  padding: 24px 24px 14px;" +
    "  border-bottom: 1px solid rgba(255, 255, 255, 0.06);" +
    "  background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-title {" +
    "  font-size: 28px;" +
    "  font-weight: 800;" +
    "  letter-spacing: -0.03em;" +
    "  margin: 0 0 6px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-subtitle {" +
    "  color: rgba(255,255,255,0.72);" +
    "  font-size: 14px;" +
    "  line-height: 1.5;" +
    "  margin: 0;" +
    "  max-width: 680px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-header-actions {" +
    "  display: flex;" +
    "  align-items: center;" +
    "  gap: 10px;" +
    "  flex-shrink: 0;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-close," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-tab," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-btn," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-submit," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-cancel {" +
    "  border: 0;" +
    "  cursor: pointer;" +
    "  transition: transform .18s ease, background-color .18s ease, opacity .18s ease;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-close {" +
    "  width: 44px;" +
    "  height: 44px;" +
    "  border-radius: 8px;" +
    "  background: rgba(255,255,255,0.08);" +
    "  color: #fff;" +
    "  font-size: 18px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-close:hover," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-btn:hover," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-submit:hover," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-cancel:hover {" +
    "  transform: translateY(-1px);" +
    "}" +
    ".emby-tabs-slider ." + WATCHLIST_NAV_BUTTON_CLASS + "," +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + " {" +
    "  align-items: center;" +
    "  display: inline-flex !important;" +
    "  gap: 8px;" +
    "  position: relative;" +
    "  border:none;" +
    "  color: inherit;" +
    "}" +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + " {" +
    "  text-decoration: none;" +
    "}" +
    ".emby-tabs-slider ." + WATCHLIST_NAV_BUTTON_CLASS + ":hover," +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + ":hover {" +
    "  opacity: 1;" +
    "  text-decoration: none;" +
    "}" +
    ".emby-tabs-slider ." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-icon," +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-icon {" +
    "  display: inline-flex;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  line-height: 1;" +
    "  flex-shrink: 0;" +
    "  min-width: 1em;" +
    "  pointer-events: none;" +
    "}" +
    ".emby-tabs-slider ." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-svg," +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-svg {" +
    "  display: block;" +
    "  width: 1em;" +
    "  height: 1em;" +
    "  min-width: 1em;" +
    "  min-height: 1em;" +
    "  fill: currentColor;" +
    "  overflow: visible;" +
    "}" +
    ".emby-tabs-slider ." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-label," +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-label {" +
    "  display: inline-block;" +
    "  pointer-events: none;" +
    "}" +
    ".emby-tabs-slider ." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-icon svg," +
    ".emby-tabs-slider ." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-icon path," +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-icon svg," +
    "." + WATCHLIST_MUI_NAV_LINK_CLASS + "." + WATCHLIST_NAV_BUTTON_CLASS + " .monwui-watchlist-nav-icon path {" +
    "  pointer-events: none;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-tabs {" +
    "  display: inline-flex;" +
    "  gap: 10px;" +
    "  padding: 14px 24px 0;" +
    "  flex-wrap: wrap;" +
    "  flex-direction: row;" +
    "  align-content: center;" +
    "  justify-content: center;" +
    "  align-items: center;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-tab {" +
    "  padding: 11px 16px;" +
    "  border-radius: 8px;" +
    "  background: rgba(255,255,255,0.06);" +
    "  color: rgba(255,255,255,0.78);" +
    "  font-size: 12px;" +
    "  font-weight: 700;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-tab.active {" +
    "  background: linear-gradient(135deg, #ffb703, #fb8500);" +
    "  color: #141822;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-body {" +
    "  flex: 1;" +
    "  min-height: 0;" +
    "  overflow: hidden;" +
    "  padding: 18px 24px 24px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-layout {" +
    "  display: grid;" +
    "  grid-template-columns: minmax(0, 1fr) minmax(330px, 400px);" +
    "  grid-template-areas: \"main preview\";" +
    "  gap: 18px;" +
    "  height: 100%;" +
    "  min-height: 0;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-layout.is-stats-tab {" +
    "  grid-template-columns: minmax(0, 1fr);" +
    "  grid-template-areas: \"main\";" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-layout.is-stats-tab .monwuiwl-preview {" +
    "  display: none;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-main {" +
    "  grid-area: main;" +
    "  min-height: 0;" +
    "  overflow: auto;" +
    "  padding-right: 6px;" +
    "  scrollbar-color: #ffb703 transparent;" +
    "  overscroll-behavior: contain;" +
    "  -webkit-overflow-scrolling: touch;" +
    "  touch-action: pan-y;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-layout.is-stats-tab .monwuiwl-main {" +
    "  padding-right: 0;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-shell {" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 18px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero {" +
    "  position: relative;" +
    "  isolation: isolate;" +
    "  display: grid;" +
    "  grid-template-columns: minmax(0, 1fr) minmax(150px, 220px);" +
    "  align-items: stretch;" +
    "  gap: 20px;" +
    "  border-radius: 24px;" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  padding: 24px;" +
    "  overflow: hidden;" +
    "  background:" +
    "    radial-gradient(circle at top right, rgba(255,183,3,0.22), transparent 38%)," +
    "    linear-gradient(135deg, rgba(18,22,32,0.98), rgba(10,12,18,0.98));" +
    "  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-content {" +
    "  position: relative;" +
    "  z-index: 1;" +
    "  min-width: 0;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art {" +
    "  position: relative;" +
    "  display: flex;" +
    "  align-items: flex-end;" +
    "  justify-content: flex-end;" +
    "  min-height: 152px;" +
    "  pointer-events: none;" +
    "  z-index: 0;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art::before {" +
    "  content: \"\";" +
    "  position: absolute;" +
    "  inset: 18px 14px 0 auto;" +
    "  width: 132px;" +
    "  height: 132px;" +
    "  border-radius: 999px;" +
    "  background:" +
    "    radial-gradient(circle at 35% 35%, rgba(255,255,255,0.22), rgba(255,255,255,0.02) 54%, transparent 72%)," +
    "    linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02));" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  box-shadow:" +
    "    inset 0 1px 0 rgba(255,255,255,0.08)," +
    "    0 24px 48px rgba(0,0,0,0.18);" +
    "  opacity: 0.92;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art::after {" +
    "  content: \"\";" +
    "  position: absolute;" +
    "  inset: auto 10px 6px auto;" +
    "  width: 170px;" +
    "  height: 100px;" +
    "  border-radius: 28px;" +
    "  background:" +
    "    linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02))," +
    "    rgba(6,10,18,0.28);" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "  opacity: 0.64;" +
    "  transform: rotate(-10deg);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-badge {" +
    "  position: relative;" +
    "  z-index: 1;" +
    "  display: inline-flex;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  width: 92px;" +
    "  height: 92px;" +
    "  margin: 0 18px 22px 0;" +
    "  border-radius: 28px;" +
    "  background:" +
    "    linear-gradient(145deg, rgba(255,255,255,0.18), rgba(255,255,255,0.03))," +
    "    rgba(12,18,30,0.38);" +
    "  border: 1px solid rgba(255,255,255,0.1);" +
    "  box-shadow:" +
    "    inset 0 1px 0 rgba(255,255,255,0.14)," +
    "    0 22px 40px rgba(0,0,0,0.22);" +
    "  color: rgba(255,247,224,0.94);" +
    "  transform: rotate(-8deg);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-icon {" +
    "  width: 46px;" +
    "  height: 46px;" +
    "  filter: drop-shadow(0 8px 16px rgba(0,0,0,0.24));" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-bars {" +
    "  position: absolute;" +
    "  inset: auto 0 18px auto;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 10px;" +
    "  width: 120px;" +
    "  z-index: 1;" +
    "  opacity: 0.8;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-bars span {" +
    "  display: block;" +
    "  height: 10px;" +
    "  border-radius: 999px;" +
    "  background: linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.3));" +
    "  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-bars span:nth-child(1) {" +
    "  width: 100%;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-bars span:nth-child(2) {" +
    "  width: 78%;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-bars span:nth-child(3) {" +
    "  width: 58%;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-kicker {" +
    "  color: #ffb703;" +
    "  font-size: 11px;" +
    "  font-weight: 800;" +
    "  letter-spacing: 0.1em;" +
    "  text-transform: uppercase;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-user {" +
    "  margin: 10px 0 8px;" +
    "  font-size: 30px;" +
    "  line-height: 1.05;" +
    "  font-weight: 900;" +
    "  letter-spacing: -0.04em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-copy {" +
    "  margin: 0;" +
    "  max-width: 560px;" +
    "  color: rgba(255,255,255,0.74);" +
    "  font-size: 14px;" +
    "  line-height: 1.6;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-total {" +
    "  margin-top: 22px;" +
    "  display: inline-flex;" +
    "  flex-direction: column;" +
    "  gap: 6px;" +
    "  padding: 16px 18px;" +
    "  border-radius: 18px;" +
    "  background: rgba(255,255,255,0.06);" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  box-shadow: 0 16px 32px rgba(0,0,0,0.22);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-total-label {" +
    "  color: rgba(255,255,255,0.72);" +
    "  font-size: 12px;" +
    "  font-weight: 700;" +
    "  letter-spacing: 0.04em;" +
    "  text-transform: uppercase;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-total-value {" +
    "  color: #fff7e0;" +
    "  font-size: 46px;" +
    "  line-height: 1;" +
    "  font-weight: 900;" +
    "  letter-spacing: -0.05em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-cards {" +
    "  display: grid;" +
    "  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));" +
    "  gap: 12px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stat-card {" +
    "  min-height: 116px;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  justify-content: space-between;" +
    "  gap: 16px;" +
    "  padding: 16px 18px;" +
    "  border-radius: 18px;" +
    "  background: rgba(255,255,255,0.04);" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stat-label {" +
    "  color: rgba(255,255,255,0.72);" +
    "  font-size: 12px;" +
    "  line-height: 1.5;" +
    "  font-weight: 700;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stat-value {" +
    "  color: #fff;" +
    "  font-size: 34px;" +
    "  line-height: 1;" +
    "  font-weight: 900;" +
    "  letter-spacing: -0.04em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-breakdown {" +
    "  border-radius: 22px;" +
    "  padding: 18px;" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "  background:" +
    "    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))," +
    "    rgba(8,11,18,0.72);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-breakdown-head {" +
    "  margin-bottom: 14px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-breakdown-title {" +
    "  margin: 0;" +
    "  font-size: 18px;" +
    "  line-height: 1.2;" +
    "  font-weight: 800;" +
    "  letter-spacing: -0.02em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-grid {" +
    "  display: grid;" +
    "  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));" +
    "  gap: 12px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-card {" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 10px;" +
    "  padding: 16px;" +
    "  border-radius: 18px;" +
    "  background: rgba(255,255,255,0.04);" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-name {" +
    "  font-size: 16px;" +
    "  font-weight: 800;" +
    "  line-height: 1.25;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-total," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-row {" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: space-between;" +
    "  gap: 12px;" +
    "  color: rgba(255,255,255,0.76);" +
    "  font-size: 12px;" +
    "  line-height: 1.45;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-total strong," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-row strong {" +
    "  color: #fff;" +
    "  font-size: 16px;" +
    "  font-weight: 800;" +
    "  line-height: 1;" +
    "  letter-spacing: -0.02em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-page {" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 18px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-secondary {" +
    "  background:" +
    "    radial-gradient(circle at top left, rgba(96,165,250,0.16), transparent 36%)," +
    "    linear-gradient(135deg, rgba(18,22,32,0.98), rgba(10,12,18,0.98));" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-grid {" +
    "  display: grid;" +
    "  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));" +
    "  gap: 12px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card {" +
    "  position: relative;" +
    "  isolation: isolate;" +
    "  background: rgba(255,255,255,0.04);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card::before {" +
    "  content: \"\";" +
    "  position: absolute;" +
    "  right: -8px;" +
    "  bottom: -4px;" +
    "  width: 94px;" +
    "  height: 94px;" +
    "  border-radius: 24px;" +
    "  background:" +
    "    linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))," +
    "    radial-gradient(circle at 35% 35%, rgba(255,255,255,0.12), transparent 68%)," +
    "    url(\"" + WATCHLIST_ICON_DATA_URI + "\") center / 52px 52px no-repeat;" +
    "  border: 1px solid rgba(255,255,255,0.05);" +
    "  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);" +
    "  opacity: 0.85;" +
    "  pointer-events: none;" +
    "  transform: rotate(-8deg);" +
    "  z-index: 0;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card[data-media-key=\"movies\"] {" +
    "  background:" +
    "    radial-gradient(circle at top right, rgba(244,63,94,0.16), transparent 40%)," +
    "    rgba(255,255,255,0.04);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card[data-media-key=\"series\"] {" +
    "  background:" +
    "    radial-gradient(circle at top right, rgba(96,165,250,0.16), transparent 40%)," +
    "    rgba(255,255,255,0.04);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card[data-media-key=\"music\"] {" +
    "  background:" +
    "    radial-gradient(circle at top right, rgba(52,211,153,0.16), transparent 40%)," +
    "    rgba(255,255,255,0.04);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-head {" +
    "  position: relative;" +
    "  z-index: 1;" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: space-between;" +
    "  gap: 12px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-badge {" +
    "  flex: 0 0 auto;" +
    "  width: 40px;" +
    "  height: 40px;" +
    "  display: inline-flex;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  border-radius: 14px;" +
    "  background:" +
    "    linear-gradient(145deg, rgba(255,255,255,0.18), rgba(255,255,255,0.03))," +
    "    rgba(8,12,18,0.3);" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  color: rgba(255,255,255,0.86);" +
    "  box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-badge svg {" +
    "  width: 20px;" +
    "  height: 20px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-title {" +
    "  margin: 0;" +
    "  font-size: 18px;" +
    "  line-height: 1.2;" +
    "  font-weight: 800;" +
    "  letter-spacing: -0.02em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-stats {" +
    "  position: relative;" +
    "  z-index: 1;" +
    "  display: grid;" +
    "  grid-template-columns: repeat(2, minmax(0, 1fr));" +
    "  gap: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-stat {" +
    "  padding: 12px;" +
    "  border-radius: 14px;" +
    "  background: rgba(255,255,255,0.04);" +
    "  border: 1px solid rgba(255,255,255,0.05);" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 8px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-stat span," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-last-label," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-last-subtitle," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-last-meta," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-repeat-subtitle {" +
    "  color: rgba(255,255,255,0.72);" +
    "  font-size: 12px;" +
    "  line-height: 1.45;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-stat strong," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-repeat-count {" +
    "  color: #fff;" +
    "  font-size: 24px;" +
    "  line-height: 1;" +
    "  font-weight: 900;" +
    "  letter-spacing: -0.03em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-last {" +
    "  position: relative;" +
    "  z-index: 1;" +
    "  margin-top: auto;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 6px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-last-title," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-repeat-title {" +
    "  font-size: 15px;" +
    "  line-height: 1.35;" +
    "  font-weight: 800;" +
    "  color: #fff;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-last-empty {" +
    "  color: rgba(255,255,255,0.6);" +
    "  font-size: 13px;" +
    "  line-height: 1.5;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-repeat-list {" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-repeat-item {" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: space-between;" +
    "  gap: 14px;" +
    "  padding: 14px 16px;" +
    "  border-radius: 16px;" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "  background: rgba(255,255,255,0.04);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-general-repeat-main {" +
    "  min-width: 0;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 4px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview {" +
    "  grid-area: preview;" +
    "  min-height: 0;" +
    "  overflow: auto;" +
    "  border-radius: 22px;" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  background:" +
    "    linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))," +
    "    linear-gradient(180deg, rgba(18, 22, 32, 0.98), rgba(10, 12, 18, 0.98));" +
    "  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);" +
    "  scrollbar-color: #ffb703 transparent;" +
    "  overscroll-behavior: contain;" +
    "  -webkit-overflow-scrolling: touch;" +
    "  touch-action: pan-y;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-empty {" +
    "  min-height: 100%;" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  padding: 26px;" +
    "  text-align: center;" +
    "  color: rgba(255,255,255,0.78);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-empty-copy {" +
    "  max-width: 280px;" +
    "  line-height: 1.7;" +
    "  font-size: 13px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-shell {" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  min-height: 100%;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-hero {" +
    "  position: relative;" +
    "  min-height: 252px;" +
    "  overflow: hidden;" +
    "  border-bottom: 1px solid rgba(255,255,255,0.08);" +
    "  background: linear-gradient(135deg, rgba(255,183,3,0.12), rgba(251,133,0,0.06));" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-backdrop {" +
    "  position: absolute;" +
    "  inset: 0;" +
    "  width: 100%;" +
    "  height: 100%;" +
    "  object-fit: cover;" +
    "  opacity: 0.28;" +
    "  filter: saturate(1.05);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-hero::after {" +
    "  content: \"\";" +
    "  position: absolute;" +
    "  inset: 0;" +
    "  background:" +
    "    linear-gradient(180deg, rgba(7, 9, 15, 0.18), rgba(7, 9, 15, 0.94))," +
    "    linear-gradient(90deg, rgba(7, 9, 15, 0.12), rgba(7, 9, 15, 0.66));" +
    "  pointer-events: none;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-hero-inner {" +
    "  position: relative;" +
    "  z-index: 1;" +
    "  display: grid;" +
    "  grid-template-columns: 104px minmax(0, 1fr);" +
    "  gap: 14px;" +
    "  padding: 18px;" +
    "  align-items: end;" +
    "  min-height: 252px;" +
    "  box-sizing: border-box;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-poster {" +
    "  width: 104px;" +
    "  height: 152px;" +
    "  border-radius: 16px;" +
    "  overflow: hidden;" +
    "  background:" +
    "    linear-gradient(160deg, rgba(255,183,3,0.28), rgba(251,133,0,0.08))," +
    "    rgba(255,255,255,0.06);" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  box-shadow: 0 20px 40px rgba(0,0,0,0.28);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-poster img {" +
    "  width: 100%;" +
    "  height: 100%;" +
    "  object-fit: cover;" +
    "  display: block;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-poster-fallback {" +
    "  width: 100%;" +
    "  height: 100%;" +
    "  display: flex;" +
    "  align-items: flex-end;" +
    "  justify-content: flex-start;" +
    "  padding: 12px;" +
    "  box-sizing: border-box;" +
    "  color: rgba(255,255,255,0.9);" +
    "  font-size: 11px;" +
    "  font-weight: 800;" +
    "  letter-spacing: 0.08em;" +
    "  color: #ffb703;" +
    "  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.54));" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-head {" +
    "  min-width: 0;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-kicker {" +
    "  color: rgba(255,255,255,0.68);" +
    "  font-size: 11px;" +
    "  font-weight: 800;" +
    "  letter-spacing: 0.1em;" +
    "  color: #ffb703;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-title {" +
    "  margin: 0;" +
    "  font-size: 24px;" +
    "  line-height: 1.08;" +
    "  font-weight: 900;" +
    "  letter-spacing: -0.03em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-subtitle {" +
    "  color: rgba(255,255,255,0.74);" +
    "  font-size: 13px;" +
    "  line-height: 1.5;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-chips {" +
    "  display: flex;" +
    "  flex-wrap: wrap;" +
    "  gap: 8px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-chip {" +
    "  display: inline-flex;" +
    "  align-items: center;" +
    "  gap: 6px;" +
    "  border-radius: 6px;" +
    "  padding: 6px 10px;" +
    "  background: rgba(255,255,255,0.10);" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  color: rgba(255,255,255,0.9);" +
    "  font-size: 11px;" +
    "  font-weight: 800;" +
    "  line-height: 1;" +
    "  backdrop-filter: blur(10px);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-chip.accent {" +
    "  background: linear-gradient(135deg, rgba(255,183,3,0.22), rgba(251,133,0,0.18));" +
    "  color: #fff3d2;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-progress {" +
    "  margin-top: 2px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-progress-track {" +
    "  width: 100%;" +
    "  height: 8px;" +
    "  border-radius: 6px;" +
    "  overflow: hidden;" +
    "  background: rgba(255,255,255,0.12);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-progress-bar {" +
    "  height: 100%;" +
    "  border-radius: inherit;" +
    "  background: linear-gradient(90deg, #ffb703, #fb8500);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-progress-copy {" +
    "  margin-top: 8px;" +
    "  color: rgba(255,255,255,0.72);" +
    "  font-size: 12px;" +
    "  line-height: 1.5;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-body {" +
    "  padding: 18px;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 16px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-loading {" +
    "  color: rgba(255,255,255,0.66);" +
    "  font-size: 12px;" +
    "  font-weight: 700;" +
    "  letter-spacing: 0.04em;" +
    "  color: #ffb703;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-note {" +
    "  margin: 0;" +
    "  padding: 12px 14px;" +
    "  border-radius: 16px;" +
    "  background: rgba(255,255,255,0.04);" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  color: rgba(255,255,255,0.84);" +
    "  font-size: 13px;" +
    "  line-height: 1.6;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-overview {" +
    "  margin: 0;" +
    "  color: rgba(255,255,255,0.82);" +
    "  font-size: 13px;" +
    "  line-height: 1.72;" +
    "  display: -webkit-box;" +
    "  -webkit-line-clamp: 7;" +
    "  -webkit-box-orient: vertical;" +
    "  overflow: hidden;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-stats {" +
    "  display: grid;" +
    "  grid-template-columns: repeat(2, minmax(0, 1fr));" +
    "  gap: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-stat {" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 6px;" +
    "  padding: 12px;" +
    "  border-radius: 16px;" +
    "  background: rgba(255,255,255,0.04);" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  min-width: 0;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-stat-label {" +
    "  color: rgba(255,255,255,0.58);" +
    "  font-size: 11px;" +
    "  font-weight: 800;" +
    "  letter-spacing: 0.08em;" +
    "  color: #ffb703;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-stat-value {" +
    "  color: #fff;" +
    "  font-size: 13px;" +
    "  line-height: 1.5;" +
    "  font-weight: 700;" +
    "  word-break: break-word;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-section {" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-section-title {" +
    "  margin: 0;" +
    "  color: rgba(255,255,255,0.66);" +
    "  font-size: 11px;" +
    "  font-weight: 800;" +
    "  letter-spacing: 0.12em;" +
    "  color: #ffb703;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-field-list {" +
    "  display: grid;" +
    "  gap: 8px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-field {" +
    "  display: grid;" +
    "  grid-template-columns: 90px minmax(0, 1fr);" +
    "  gap: 10px;" +
    "  align-items: start;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-field-label {" +
    "  color: rgba(255,255,255,0.52);" +
    "  font-size: 12px;" +
    "  font-weight: 700;" +
    "  line-height: 1.45;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-field-value {" +
    "  color: rgba(255,255,255,0.88);" +
    "  font-size: 12px;" +
    "  line-height: 1.6;" +
    "  word-break: break-word;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-list {" +
    "  list-style: none;" +
    "  margin: 0;" +
    "  padding: 0;" +
    "  display: grid;" +
    "  gap: 8px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-list li {" +
    "  padding: 10px 12px;" +
    "  border-radius: 8px;" +
    "  background: rgba(255,255,255,0.04);" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "  color: rgba(255,255,255,0.88);" +
    "  font-size: 12px;" +
    "  line-height: 1.55;" +
    "  word-break: break-word;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-tags {" +
    "  display: flex;" +
    "  flex-wrap: wrap;" +
    "  gap: 8px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-tag {" +
    "  appearance: none;" +
    "  border-radius: 6px;" +
    "  background: rgba(255,255,255,0.08);" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "  color: rgba(255,255,255,0.88);" +
    "  font-size: 11px;" +
    "  font-weight: 700;" +
    "  line-height: 1.3;" +
    "  padding: 7px 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-tag-button {" +
    "  cursor: pointer;" +
    "  transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-tag-button:hover {" +
    "  background: rgba(255,183,3,0.16);" +
    "  border-color: rgba(255,183,3,0.28);" +
    "  color: #fff3d2;" +
    "  transform: translateY(-1px);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-tag-button:focus-visible {" +
    "  outline: 2px solid rgba(255,183,3,0.55);" +
    "  outline-offset: 2px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-tag-button.is-copied {" +
    "  background: linear-gradient(135deg, rgba(255,183,3,0.24), rgba(251,133,0,0.18));" +
    "  border-color: rgba(255,183,3,0.36);" +
    "  color: #fff6dd;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-head {" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: space-between;" +
    "  gap: 10px;" +
    "  flex-wrap: wrap;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-count {" +
    "  color: rgba(255,255,255,0.62);" +
    "  font-size: 11px;" +
    "  font-weight: 700;" +
    "  line-height: 1.4;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-grid {" +
    "  display: grid;" +
    "  grid-template-columns: repeat(2, minmax(0, 1fr));" +
    "  gap: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-card {" +
    "  appearance: none;" +
    "  display: block;" +
    "  width: 100%;" +
    "  min-width: 0;" +
    "  padding: 10px;" +
    "  border-radius: 16px;" +
    "  border: 1px solid rgba(255,255,255,0.06);" +
    "  background:" +
    "    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))," +
    "    rgba(255,255,255,0.02);" +
    "  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);" +
    "  text-align: left;" +
    "  cursor: pointer;" +
    "  color: inherit;" +
    "  font: inherit;" +
    "  transition: transform .18s ease, border-color .18s ease, background-color .18s ease;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-card:hover," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-card:focus-visible {" +
    "  transform: translateY(-1px);" +
    "  border-color: rgba(255,183,3,0.34);" +
    "  background:" +
    "    linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))," +
    "    rgba(255,255,255,0.03);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-card:focus-visible {" +
    "  outline: 2px solid rgba(255,183,3,0.72);" +
    "  outline-offset: 2px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-poster {" +
    "  position: relative;" +
    "  overflow: hidden;" +
    "  border-radius: 12px;" +
    "  aspect-ratio: 2 / 3;" +
    "  background:" +
    "    linear-gradient(160deg, rgba(255,183,3,0.20), rgba(251,133,0,0.08))," +
    "    rgba(255,255,255,0.06);" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  margin-bottom: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-poster img {" +
    "  width: 100%;" +
    "  height: 100%;" +
    "  object-fit: cover;" +
    "  display: block;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-fallback {" +
    "  width: 100%;" +
    "  height: 100%;" +
    "  display: flex;" +
    "  align-items: flex-end;" +
    "  justify-content: flex-start;" +
    "  padding: 10px;" +
    "  box-sizing: border-box;" +
    "  color: #ffcf6e;" +
    "  font-size: 11px;" +
    "  font-weight: 900;" +
    "  letter-spacing: 0.08em;" +
    "  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.58));" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-main {" +
    "  min-width: 0;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  gap: 6px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-title {" +
    "  color: #fff;" +
    "  font-size: 12px;" +
    "  font-weight: 800;" +
    "  line-height: 1.45;" +
    "  display: -webkit-box;" +
    "  -webkit-line-clamp: 2;" +
    "  -webkit-box-orient: vertical;" +
    "  overflow: hidden;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-meta {" +
    "  color: rgba(255,255,255,0.66);" +
    "  font-size: 11px;" +
    "  line-height: 1.45;" +
    "  display: -webkit-box;" +
    "  -webkit-line-clamp: 2;" +
    "  -webkit-box-orient: vertical;" +
    "  overflow: hidden;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-progress {" +
    "  height: 5px;" +
    "  border-radius: 999px;" +
    "  overflow: hidden;" +
    "  background: rgba(255,255,255,0.10);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-progress-bar {" +
    "  height: 100%;" +
    "  border-radius: inherit;" +
    "  background: linear-gradient(90deg, #ffb703, #fb8500);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-note {" +
    "  color: rgba(255,255,255,0.62);" +
    "  font-size: 12px;" +
    "  line-height: 1.5;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-played-overlay {" +
    "  position: absolute;" +
    "  inset: 0;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  gap: 8px;" +
    "  pointer-events: none;" +
    "  background:" +
    "    radial-gradient(circle at center, rgba(129,201,149,0.16), rgba(12,18,26,0.26) 42%, rgba(7,9,15,0.72) 100%);" +
    "  backdrop-filter: blur(1px);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-played-mark {" +
    "  width: 60px;" +
    "  height: 60px;" +
    "  border-radius: 999px;" +
    "  display: inline-flex;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  background: linear-gradient(135deg, rgba(163,230,53,0.98), rgba(16,185,129,0.88));" +
    "  box-shadow:" +
    "    0 18px 34px rgba(0,0,0,0.34)," +
    "    0 0 0 3px rgba(255,255,255,0.12);" +
    "  color: #04210f;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-played-mark svg {" +
    "  width: 34px;" +
    "  height: 34px;" +
    "  display: block;" +
    "  fill: currentColor;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-played-text {" +
    "  color: #f4fff7;" +
    "  font-size: 10px;" +
    "  font-weight: 900;" +
    "  letter-spacing: 0.16em;" +
    "  line-height: 1;" +
    "  text-transform: uppercase;" +
    "  text-shadow: 0 6px 16px rgba(0,0,0,0.45);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item.is-played," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-card.is-played {" +
    "  border-color: rgba(129,201,149,0.34);" +
    "  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(163,230,53,0.08);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item.is-played .monwuiwl-item-poster img," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-card.is-played .monwuiwl-preview-collection-poster img {" +
    "  filter: saturate(0.85) brightness(0.76);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-poster .monwuiwl-played-mark {" +
    "  width: 54px;" +
    "  height: 54px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-poster .monwuiwl-played-mark svg {" +
    "  width: 30px;" +
    "  height: 30px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-poster .monwuiwl-played-text {" +
    "  font-size: 9px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-section + .monwuiwl-section {" +
    "  margin-top: 22px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-section-head {" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: space-between;" +
    "  gap: 14px;" +
    "  margin-bottom: 12px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-section-title {" +
    "  margin: 0;" +
    "  font-size: 16px;" +
    "  font-weight: 800;" +
    "  letter-spacing: -0.02em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-sharemeta {" +
    "  background: linear-gradient(135deg, #ffb703, #fb8500) !important;" +
    "  -webkit-background-clip: text !important;" +
    "  background-clip: text !important;" +
    "  color: transparent !important;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-grid {" +
    "  display: grid;" +
    "  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));" +
    "  gap: 14px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item {" +
    "  background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  border-radius: 20px;" +
    "  overflow: hidden;" +
    "  display: grid;" +
    "  grid-template-columns: 110px minmax(0, 1fr);" +
    "  min-height: 206px;" +
    "  cursor: pointer;" +
    "  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item:hover," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item.is-preview-active," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item:focus-within {" +
    "  transform: translateY(-2px);" +
    "  border-color: rgba(255, 183, 3, 0.42);" +
    "  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-poster {" +
    "  background:" +
    "    linear-gradient(160deg, rgba(255,183,3,0.38), rgba(251,133,0,0.08))," +
    "    rgba(255,255,255,0.04);" +
    "  position: relative;" +
    "  min-height: 100%;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-poster img {" +
    "  width: 100%;" +
    "  height: 100%;" +
    "  object-fit: cover;" +
    "  display: block;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-poster-fallback {" +
    "  inset: 0;" +
    "  position: absolute;" +
    "  display: flex;" +
    "  align-items: flex-end;" +
    "  justify-content: flex-start;" +
    "  padding: 12px;" +
    "  font-size: 12px;" +
    "  font-weight: 700;" +
    "  color: rgba(255,255,255,0.92);" +
    "  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.55));" +
    "  color: #ffb703;" +
    "  letter-spacing: .08em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-main {" +
    "  padding: 14px 14px 12px;" +
    "  display: flex;" +
    "  flex-direction: column;" +
    "  min-width: 0;" +
    "  gap: 10px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-title {" +
    "  margin: 0;" +
    "  font-size: 17px;" +
    "  font-weight: 800;" +
    "  line-height: 1.22;" +
    "  letter-spacing: -0.02em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-meta," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-extra," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-sharemeta {" +
    "  color: rgba(255,255,255,0.72);" +
    "  font-size: 12px;" +
    "  line-height: 1.5;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-overview {" +
    "  color: rgba(255,255,255,0.78);" +
    "  font-size: 13px;" +
    "  line-height: 1.56;" +
    "  display: -webkit-box;" +
    "  -webkit-line-clamp: 4;" +
    "  -webkit-box-orient: vertical;" +
    "  overflow: hidden;" +
    "  min-height: 82px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-tags {" +
    "  display: flex;" +
    "  gap: 8px;" +
    "  flex-wrap: wrap;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  align-content: center;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-tag {" +
    "  border-radius: 6px;" +
    "  background: rgba(255,255,255,0.08);" +
    "  color: rgba(255,255,255,0.84);" +
    "  font-size: 11px;" +
    "  font-weight: 700;" +
    "  padding: 5px 9px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item-actions {" +
    "  display: flex;" +
    "  gap: 8px;" +
    "  flex-wrap: wrap;" +
    "  margin-top: auto;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  align-content: center;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-btn {" +
    "  border-radius: 6px;" +
    "  padding: 10px 12px;" +
    "  font-size: 12px;" +
    "  font-weight: 800;" +
    "  color: #fff;" +
    "  background: rgba(255,255,255,0.08);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-btn.primary {" +
    "  background: linear-gradient(135deg, #ffb703, #fb8500);" +
    "  color: #1b1f28;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-btn.danger {" +
    "  background: rgba(244, 63, 94, 0.18);" +
    "  color: #ffd7df;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-item:focus {" +
    "  outline: none;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-empty," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-loading," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-error {" +
    "  border: 1px dashed rgba(255,255,255,0.14);" +
    "  border-radius: 18px;" +
    "  padding: 24px;" +
    "  text-align: center;" +
    "  color: rgba(255,255,255,0.74);" +
    "  background: rgba(255,255,255,0.03);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-overlay {" +
    "  position: absolute;" +
    "  inset: 0;" +
    "  background: rgba(7, 9, 15, 0.74);" +
    "  backdrop-filter: blur(8px);" +
    "  display: flex;" +
    "  align-items: center;" +
    "  justify-content: center;" +
    "  padding: 20px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-card {" +
    "  width: min(560px, calc(100vw - 40px));" +
    "  max-height: min(82vh, 760px);" +
    "  overflow: auto;" +
    "  background: linear-gradient(180deg, rgba(25,29,40,0.98), rgba(12,14,20,0.98));" +
    "  border: 1px solid rgba(255,255,255,0.08);" +
    "  border-radius: 20px;" +
    "  padding: 22px;" +
    "  color: #fff;" +
    "  box-shadow: 0 24px 60px rgba(0,0,0,0.42);" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-title {" +
    "  margin: 0 0 6px;" +
    "  font-size: 22px;" +
    "  font-weight: 800;" +
    "  letter-spacing: -0.03em;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-help {" +
    "  color: rgba(255,255,255,0.7);" +
    "  font-size: 13px;" +
    "  line-height: 1.56;" +
    "  margin: 0 0 16px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-list {" +
    "  display: grid;" +
    "  gap: 8px;" +
    "  margin-bottom: 16px;" +
    "  max-height: 240px;" +
    "  overflow: auto;" +
    "  padding-right: 4px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-user {" +
    "  display: flex;" +
    "  align-items: center;" +
    "  gap: 10px;" +
    "  background: rgba(255,255,255,0.04);" +
    "  border-radius: 12px;" +
    "  padding: 10px 12px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-user input {" +
    "  accent-color: #ffb703;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-note-label {" +
    "  display: block;" +
    "  font-size: 13px;" +
    "  font-weight: 700;" +
    "  margin-bottom: 8px;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-note {" +
    "  width: 100%;" +
    "  min-height: 120px;" +
    "  resize: vertical;" +
    "  border-radius: 8px;" +
    "  border: 1px solid rgba(255,255,255,0.12);" +
    "  background: rgba(255,255,255,0.04);" +
    "  color: #fff;" +
    "  padding: 12px 14px;" +
    "  font: inherit;" +
    "  box-sizing: border-box;" +
    "  outline: none;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-footer {" +
    "  display: flex;" +
    "  gap: 10px;" +
    "  justify-content: flex-end;" +
    "  margin-top: 16px;" +
    "  flex-wrap: wrap;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-submit," +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-cancel {" +
    "  border-radius: 12px;" +
    "  padding: 11px 14px;" +
    "  font-size: 13px;" +
    "  font-weight: 800;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-submit {" +
    "  background: linear-gradient(135deg, #ffb703, #fb8500);" +
    "  color: #1b1f28;" +
    "}" +
    "#" + WATCHLIST_MODAL_ID + " .monwuiwl-share-cancel {" +
    "  background: rgba(255,255,255,0.08);" +
    "  color: #fff;" +
    "}" +
    "@media (max-width: 920px) {" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-card {" +
    "    height: min(92vh, 980px);" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-layout {" +
    "    grid-template-columns: 1fr;" +
    "    grid-template-areas:" +
    "      \"preview\"" +
    "      \"main\";" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview {" +
    "    max-height: 56vh;" +
    "  }" +
    "}" +
    "@media (max-width: 760px) {" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-card {" +
    "    width: 100%;" +
    "    height: 100%;" +
    "    border-radius: 0;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-backdrop {" +
    "    padding: 0;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-header {" +
    "    padding: 18px 16px 12px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-tabs {" +
    "    padding: 12px 16px 0;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-body {" +
    "    padding: 16px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-layout {" +
    "    gap: 14px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero {" +
    "    grid-template-columns: 1fr;" +
    "    padding: 20px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art {" +
    "    min-height: 96px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art::before {" +
    "    width: 96px;" +
    "    height: 96px;" +
    "    inset: 8px 10px 0 auto;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art::after {" +
    "    width: 132px;" +
    "    height: 74px;" +
    "    bottom: 0;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-badge {" +
    "    width: 72px;" +
    "    height: 72px;" +
    "    margin: 0 10px 8px 0;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-icon {" +
    "    width: 34px;" +
    "    height: 34px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-hero-art-bars {" +
    "    display: none;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-user {" +
    "    font-size: 24px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-total-value {" +
    "    font-size: 38px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-cards," +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-stats-type-grid," +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-general-grid {" +
    "    grid-template-columns: 1fr;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-general-card-stats {" +
    "    grid-template-columns: 1fr;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-main {" +
    "    padding-right: 0;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview {" +
    "    max-height: none;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-hero-inner {" +
    "    grid-template-columns: 88px minmax(0, 1fr);" +
    "    gap: 12px;" +
    "    min-height: 220px;" +
    "    padding: 16px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-poster {" +
    "    width: 88px;" +
    "    height: 132px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-title {" +
    "    font-size: 20px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-body {" +
    "    padding: 16px;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-stats {" +
    "    grid-template-columns: 1fr;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-preview-collection-grid {" +
    "    grid-template-columns: repeat(2, minmax(0, 1fr));" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-grid {" +
    "    grid-template-columns: 1fr;" +
    "  }" +
    "  #" + WATCHLIST_MODAL_ID + " .monwuiwl-item {" +
    "    grid-template-columns: 96px minmax(0, 1fr);" +
    "  }" +
    "}";
 }
    }
  `;
  document.head.appendChild(style);
}

function ensureModalRoot() {
  var root = document.getElementById(WATCHLIST_MODAL_ID);
  if (root) return root;

  root = document.createElement("div");
  root.id = WATCHLIST_MODAL_ID;
  document.body.appendChild(root);
  root.addEventListener("click", function(event) {
    var target = (event && event.target) ? event.target : null;
    var closeButton = (target && typeof target.closest === "function") ? target.closest("[data-monwuiwl-close='1']") : null;
    if (closeButton) {
      closeWatchlistModal();
      return;
    }

    var backdrop = (target && typeof target.closest === "function") ? target.closest(".monwuiwl-backdrop") : null;
    var card = (target && typeof target.closest === "function") ? target.closest(".monwuiwl-card") : null;
    if (backdrop && !card) {
      closeWatchlistModal();
    }
  });

  window.addEventListener("monwui:watchlist-changed", function(event) {
    if (!root.classList.contains("visible")) return;
    var detail = (event && event.detail) ? event.detail : {};

    applyWatchlistChangeToOpenModal(root, detail).then(function(applied) {
      if (applied || !root.classList.contains("visible")) return;
      var state = root.__state || {};
      renderWatchlistModal(root, state)["catch"](function() {});
    })["catch"](function() {
      if (!root.classList.contains("visible")) return;
      var state = root.__state || {};
      renderWatchlistModal(root, state)["catch"](function() {});
    });
  });

  return root;
}

function setVisible(root, visible) {
  if (!root) return;
  root.classList.toggle("visible", !!visible);
  root.setAttribute("aria-hidden", visible ? "false" : "true");
}

function formatDate(ts) {
  var date = new Date(Number(ts || 0));
  if (isNaN(date.getTime())) return "";

  try {
    var config = cfg();
    var locale = (config && config.dateLocale) ? config.dateLocale : "pt-BR";
    if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
      return new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(date);
    }
  } catch (e) {}
  return date.toLocaleDateString();
}

function formatCount(value) {
  var count = Math.max(0, Math.floor(Number(value || 0)));
  try {
    var config = cfg();
    var locale = (config && config.timeLocale) ? config.timeLocale : ((config && config.dateLocale) ? config.dateLocale : "pt-BR");
    if (typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function") {
      return new Intl.NumberFormat(locale).format(count);
    }
  } catch (err) {}
  return String(count);
}

function formatRuntime(ticks) {
  var totalMinutes = Math.round(Number(ticks || 0) / 600000000);
  if (!isFinite(totalMinutes) || totalMinutes <= 0) return "";
  var hours = Math.floor(totalMinutes / 60);
  var minutes = totalMinutes % 60;
  if (hours <= 0) return minutes + " " + L("min", "min");
  return hours + " " + L("h", "h") + " " + minutes + " " + L("min", "min");
}

function ticksToMs(value) {
  var ticks = Number(value || 0);
  if (!isFinite(ticks) || ticks <= 0) return 0;
  return Math.round(ticks / 10000);
}

function formatDateTime(ts) {
  var date = new Date(Number(ts || 0));
  if (isNaN(date.getTime())) return "";

  var now = new Date();
  var sameDay = now.toDateString() === date.toDateString();

  try {
    var config = cfg();
    var locale = (config && config.timeLocale) ? config.timeLocale : ((config && config.dateLocale) ? config.dateLocale : "pt-BR");
    if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
      return new Intl.DateTimeFormat(locale, sameDay ? {
        hour: "2-digit",
        minute: "2-digit"
      } : {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
    }
  } catch (e) {}
  return sameDay ? date.toLocaleTimeString() : date.toLocaleString();
}

function formatFinishTime(runtimeTicks, playbackTicks) {
  if (playbackTicks === undefined) playbackTicks = 0;
  var totalTicks = Math.max(Number(runtimeTicks || 0), 0);
  var watchedTicks = Math.max(Number(playbackTicks || 0), 0);
  var remainingTicks = Math.max(totalTicks - watchedTicks, 0);
  if (!remainingTicks) return "";
  return formatDateTime(Date.now() + ticksToMs(remainingTicks));
}

function formatBitrate(value) {
  var bitrate = Number(value || 0);
  if (!isFinite(bitrate) || bitrate <= 0) return "";
  if (bitrate >= 1000000) {
    var mbps = bitrate / 1000000;
    return (mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)) + " Mbps";
  }
  return Math.round(bitrate / 1000) + " kbps";
}

function formatChannels(value) {
  var channels = Number(value || 0);
  if (!isFinite(channels) || channels <= 0) return "";
  if (channels === 1) return "1.0";
  if (channels === 2) return "2.0";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return channels + " ch";
}

function parseNumberLike(value) {
  if (typeof value === "number") {
    return isFinite(value) ? value : 0;
  }

  var raw = text(value);
  if (!raw) return 0;

  if (raw.indexOf("/") !== -1) {
    var parts = raw.split("/");
    var num = Number(parts[0]);
    var den = Number(parts[1]);
    if (isFinite(num) && isFinite(den) && den) {
      return num / den;
    }
  }

  var parsed = Number(raw);
  return isFinite(parsed) ? parsed : 0;
}

function uniqTextList(values) {
  var list = values || [];
  var out = [];
  var seen = {};

  for (var i = 0; i < list.length; i++) {
    var value = list[i];
    var normalized = text(value);
    if (!normalized) continue;
    var key = normalized.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(normalized);
  }

  return out;
}

function buildPosterUrl(item, options) {
  var opt = options || {};
  var width = opt.width || 220;
  var height = opt.height || 320;
  var quality = opt.quality || 90;

  var itemId = text(item && item.Id);
  var imgTags = (item && item.ImageTags) ? item.ImageTags : {};
  var primaryTag = text(imgTags.Primary || (item && item.PrimaryImageTag) || (item && item.AlbumPrimaryImageTag));

  if (itemId && primaryTag) {
    return withServer("/Items/" + encodeURIComponent(itemId) + "/Images/Primary?tag=" + encodeURIComponent(primaryTag) + "&fillWidth=" + encodeURIComponent(width) + "&fillHeight=" + encodeURIComponent(height) + "&quality=" + encodeURIComponent(quality));
  }

  var albumId = text(item && item.AlbumId);
  var albumTag = text(item && item.AlbumPrimaryImageTag);
  if (albumId && albumTag) {
    return withServer("/Items/" + encodeURIComponent(albumId) + "/Images/Primary?tag=" + encodeURIComponent(albumTag) + "&fillWidth=" + encodeURIComponent(width) + "&fillHeight=" + encodeURIComponent(height) + "&quality=" + encodeURIComponent(quality));
  }

  return "";
}

function buildBackdropUrl(item, options) {
  var opt = options || {};
  var width = opt.width || 960;
  var quality = opt.quality || 85;

  var itemId = text(item && item.Id);
  var backdropTags = (item && item.BackdropImageTags) ? item.BackdropImageTags : [];
  var imgTags = (item && item.ImageTags) ? item.ImageTags : {};
  var itemTag = text(
    (Array.isArray(backdropTags) && backdropTags[0]) ||
    (item && item.BackdropImageTag) ||
    imgTags.Backdrop
  );

  if (itemId && itemTag) {
    return withServer("/Items/" + encodeURIComponent(itemId) + "/Images/Backdrop?tag=" + encodeURIComponent(itemTag) + "&maxWidth=" + encodeURIComponent(width) + "&quality=" + encodeURIComponent(quality) + "&EnableImageEnhancers=false");
  }

  var itemType = getItemTypeName(item);
  if (itemType === "season" || itemType === "episode") {
    var seriesId = text(item && (item.SeriesId || (item.Series && item.Series.Id)));
    var sBackdropTags = (item && item.SeriesBackdropImageTags) ? item.SeriesBackdropImageTags : [];
    var sInnerBackdropTags = (item && item.Series && item.Series.BackdropImageTags) ? item.Series.BackdropImageTags : [];
    var seriesBackdropTag = text(
      (item && item.SeriesBackdropImageTag) ||
      (Array.isArray(sBackdropTags) && sBackdropTags[0]) ||
      (Array.isArray(sInnerBackdropTags) && sInnerBackdropTags[0]) ||
      (item && item.Series && item.Series.BackdropImageTag)
    );
    if (seriesId && seriesBackdropTag) {
      return withServer("/Items/" + encodeURIComponent(seriesId) + "/Images/Backdrop?tag=" + encodeURIComponent(seriesBackdropTag) + "&maxWidth=" + encodeURIComponent(width) + "&quality=" + encodeURIComponent(quality) + "&EnableImageEnhancers=false");
    }
  }

  var parentBackdropItemId = text(item && (item.ParentBackdropItemId || item.ParentId));
  var pBackdropTags = (item && item.ParentBackdropImageTags) ? item.ParentBackdropImageTags : [];
  var parentBackdropTag = text(Array.isArray(pBackdropTags) ? pBackdropTags[0] : "");
  if (parentBackdropItemId && parentBackdropTag) {
    return withServer("/Items/" + encodeURIComponent(parentBackdropItemId) + "/Images/Backdrop?tag=" + encodeURIComponent(parentBackdropTag) + "&maxWidth=" + encodeURIComponent(width) + "&quality=" + encodeURIComponent(quality) + "&EnableImageEnhancers=false");
  }

  return "";
}

function getVideoQualityLabel(videoStream) {
  if (!videoStream || text(videoStream && videoStream.Type).toLowerCase() !== "video") return "";

  var height = Math.max(
    Number(videoStream.Height || 0),
    Number(videoStream.RealHeight || 0)
  );
  var width = Math.max(
    Number(videoStream.Width || 0),
    Number(videoStream.RealWidth || 0)
  );
  var range = text(videoStream.VideoRangeType).toUpperCase();
  var codec = text(videoStream.Codec).toUpperCase();
  var fps = parseNumberLike(videoStream.RealFrameRate || videoStream.AverageFrameRate || videoStream.FrameRate);
  var bitrate = formatBitrate(videoStream.BitRate);

  var quality = "";
  if (height >= 2160 || width >= 3800) quality = "4K";
  else if (height >= 1440) quality = "1440p";
  else if (height >= 1080 || width >= 1900) quality = "1080p";
  else if (height >= 720) quality = "720p";
  else if (height >= 480) quality = "480p";
  else if (height > 0) quality = Math.round(height) + "p";

  var dynamicRange = range.indexOf("DOVI") !== -1
    ? "Dolby Vision"
    : (range.indexOf("HDR") !== -1 ? "HDR" : "");
  var fpsText = fps > 0 ? (fps >= 10 ? fps.toFixed(0) : fps.toFixed(2)) + " fps" : "";
  if (fpsText) fpsText = fpsText.replace(/\.00(?= fps)/, "");

  var labels = [quality, dynamicRange, codec, fpsText, bitrate];
  var finalLabels = [];
  for (var i = 0; i < labels.length; i++) if (labels[i]) finalLabels.push(labels[i]);
  return finalLabels.join(" • ");
}

function getMediaStreamsByType(item, type) {
  return (item && Array.isArray(item.MediaStreams) ? item.MediaStreams : [])
    .filter(function(stream) {
      return text(stream && stream.Type).toLowerCase() === text(type).toLowerCase();
    });
}

function getPrimaryVideoStream(item) {
  return getMediaStreamsByType(item, "Video")[0] || null;
}

function formatAudioStream(stream) {
  if (!stream) return "";
  var language = text(stream.DisplayLanguage || stream.Language || stream.LanguageCode);
  var codec = text(stream.Codec).toUpperCase();
  var channels = formatChannels(stream.Channels);
  var bitrate = formatBitrate(stream.BitRate);
  
  var labels = [language, codec, channels, bitrate];
  var cleanLabels = [];
  for (var i = 0; i < labels.length; i++) if (labels[i]) cleanLabels.push(labels[i]);
  
  var flags = [];
  if (stream.IsDefault) flags.push(L("default", "Padrão"));
  if (stream.IsExternal) flags.push(L("external", "Externo"));
  if (stream.Title) flags.push(text(stream.Title));

  var parts = [cleanLabels.join(" • ")];
  if (flags.length) parts.push(flags.join(" • "));
  return parts.join(" - ");
}

function formatSubtitleStream(stream) {
  if (!stream) return "";
  var language = text(stream.DisplayLanguage || stream.Language || stream.LanguageCode);
  var codec = text(stream.Codec).toUpperCase();
  var title = text(stream.DisplayTitle || stream.Title);
  var flags = [];
  if (stream.IsDefault) flags.push(L("default", "Padrão"));
  if (stream.IsForced) flags.push(L("forced", "Forçado"));
  if (stream.IsExternal) flags.push(L("external", "Externo"));

  var labels = [language, codec, title];
  if (flags.length) labels.push(flags.join(" • "));
  
  var cleanLabels = [];
  for (var i = 0; i < labels.length; i++) if (labels[i]) cleanLabels.push(labels[i]);
  return cleanLabels.join(" • ");
}

function isStale(ts, maxAgeMs) {
  var value = Number(ts || 0);
  if (!value) return true;
  return (Date.now() - value) > maxAgeMs;
}

function getCurrentUserIdSafe() {
  try {
    var api = window.ApiClient;
    var session = (typeof getSessionInfo === "function") ? getSessionInfo() : null;
    return text(
      (api && typeof api.getCurrentUserId === "function" && api.getCurrentUserId()) ||
      (api && api._currentUserId) ||
      (session && session.userId)
    );
  } catch (err) {
    var session2 = (typeof getSessionInfo === "function") ? getSessionInfo() : null;
    return text(session2 && session2.userId);
  }
}

function createPreviewPayload(overrides) {
  var base = {
    details: null,
    collectionItems: [],
    collectionItemsTotal: 0,
    collectionItemsLoaded: false,
    collectionItemsStale: false,
    collectionItemsUpdatedAt: 0,
    collectionItemsSource: ""
  };
  if (overrides && typeof overrides === "object") {
    for (var k in overrides) if (Object.prototype.hasOwnProperty.call(overrides, k)) base[k] = overrides[k];
  }
  return base;
}

function getPreviewPayload(value) {
  if (!value || typeof value !== "object") {
    return createPreviewPayload();
  }

  if (
    Object.prototype.hasOwnProperty.call(value, "details") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItems") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItemsLoaded") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItemsTotal") ||
    Object.prototype.hasOwnProperty.call(value, "collectionItemsStale")
  ) {
    return createPreviewPayload({
      details: value.details && typeof value.details === "object" ? value.details : null,
      collectionItems: Array.isArray(value.collectionItems) ? value.collectionItems : [],
      collectionItemsTotal: Number(value.collectionItemsTotal || 0),
      collectionItemsLoaded: value.collectionItemsLoaded === true,
      collectionItemsStale: value.collectionItemsStale === true,
      collectionItemsUpdatedAt: Number(value.collectionItemsUpdatedAt || 0),
      collectionItemsSource: text(value.collectionItemsSource)
    });
  }

  return createPreviewPayload({ details: value });
}

function hasPreviewDetails(value) {
  var p = getPreviewPayload(value);
  return !!(p.details && p.details.Id);
}

function normalizeCollectionPreviewItems(items) {
  var list = Array.isArray(items) ? items : [];
  var out = [];
  var seen = {};

  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var id = text(item && (item.Id || item.id));
    var hasRenderableData = !!(
      id ||
      text(item && (item.Name || item.name)) ||
      text(item && item.ProductionYear) ||
      (item && item.ImageTags && item.ImageTags.Primary) ||
      (item && item.PrimaryImageTag)
    );
    if (!hasRenderableData) continue;
    if (id) {
      if (seen[id]) continue;
      seen[id] = true;
    }
    out.push(item);
  }

  return out;
}

function minimizeCollectionPreviewItems(items) {
  if (items === undefined) items = [];
  return normalizeCollectionPreviewItems(items).map(function(item) {
    return {
      Id: item && item.Id,
      Name: item && item.Name,
      Type: item && item.Type,
      Overview: item && item.Overview,
      ProductionYear: item && item.ProductionYear,
      CommunityRating: item && item.CommunityRating,
      ImageTags: item && item.ImageTags,
      PrimaryImageTag: item && item.PrimaryImageTag,
      PrimaryImageAspectRatio: item && item.PrimaryImageAspectRatio,
      UserData: item && item.UserData,
      RunTimeTicks: item && item.RunTimeTicks,
      CumulativeRunTimeTicks: item && item.CumulativeRunTimeTicks,
      ChildCount: item && item.ChildCount,
      SeriesId: item && item.SeriesId,
      SeriesName: item && item.SeriesName,
      SeasonId: item && item.SeasonId,
      IndexNumber: item && item.IndexNumber,
      ParentIndexNumber: item && item.ParentIndexNumber,
      BackdropImageTags: item && item.BackdropImageTags,
      ParentBackdropImageTags: item && item.ParentBackdropImageTags,
      ParentBackdropItemId: item && item.ParentBackdropItemId,
      SeriesBackdropImageTag: item && item.SeriesBackdropImageTag,
      OfficialRating: item && item.OfficialRating,
      Genres: item && item.Genres
    };
  });
}

function getCachedCollectionPreview(itemId) {
  return CollectionCacheDB.getBoxsetItems(itemId).then(function(row) {
    var items = normalizeCollectionPreviewItems(row && row.items ? row.items : []);
    return {
      items: items,
      total: items.length,
      hasCache: !!row,
      updatedAt: Number(row && row.updatedAt ? row.updatedAt : 0),
      stale: !row || isStale(row && row.updatedAt, WATCHLIST_COLLECTION_CACHE_TTL_MS)
    };
  })["catch"](function() {
    return {
      items: [],
      total: 0,
      hasCache: false,
      updatedAt: 0,
      stale: true
    };
  });
}

function getContainerPreviewFields() {
  return [
    "Id","Name","Type","Overview","ProductionYear","CommunityRating",
    "ImageTags","PrimaryImageTag","PrimaryImageAspectRatio","UserData",
    "RunTimeTicks","CumulativeRunTimeTicks","ChildCount","SeriesId",
    "SeriesName","SeasonId","IndexNumber","ParentIndexNumber",
    "BackdropImageTags","ParentBackdropImageTags","ParentBackdropItemId",
    "SeriesBackdropImageTag","OfficialRating","Genres"
  ].join(",");
}

function compareText(left, right) {
  var locale = "pt-BR";
  try {
    var config = cfg();
    if (config && config.dateLocale) locale = config.dateLocale;
  } catch (e) {}

  if (typeof String.prototype.localeCompare === "function") {
    return text(left).localeCompare(text(right), locale, {
      numeric: true,
      sensitivity: "base"
    });
  }
  var a = text(left).toLowerCase();
  var b = text(right).toLowerCase();
  return a < b ? -1 : (a > b ? 1 : 0);
}

function compareMaybeNumber(left, right) {
  var a = Number(left);
  var b = Number(right);
  var hasA = isFinite(a);
  var hasB = isFinite(b);
  if (hasA && hasB) return a - b;
  if (hasA) return -1;
  if (hasB) return 1;
  return 0;
}

function sortContainerPreviewItems(items, mode) {
  var rawItems = Array.isArray(items) ? items : [];
  var list = normalizeCollectionPreviewItems(rawItems).slice();
  var cleanMode = text(mode);

  if (cleanMode === "season") {
    return list.sort(function(left, right) {
      var byIndex = compareMaybeNumber(left ? left.IndexNumber : null, right ? right.IndexNumber : null);
      return byIndex || compareText(left ? left.Name : "", right ? right.Name : "");
    });
  }

  if (cleanMode === "episode") {
    return list.sort(function(left, right) {
      var bySeason = compareMaybeNumber(left ? left.ParentIndexNumber : null, right ? right.ParentIndexNumber : null);
      if (bySeason) return bySeason;
      var byIndex2 = compareMaybeNumber(left ? left.IndexNumber : null, right ? right.IndexNumber : null);
      return byIndex2 || compareText(left ? left.Name : "", right ? right.Name : "");
    });
  }

  return list.sort(function(left, right) {
    var byYear = compareMaybeNumber(left && left.ProductionYear, right && right.ProductionYear);
    return byYear || compareText(left && left.Name, right && right.Name);
  });
}

function fetchContainerPreviewItems(containerItem, options) {
  var mode = getPreviewContainerMode(containerItem);
  var itemId = text(containerItem && (containerItem.Id || containerItem.itemId));
  var userId = getCurrentUserIdSafe();
  if (!userId || !itemId || !mode) return Promise.resolve([]);

  var includeItemTypes = mode === "collection"
    ? "Movie"
    : (mode === "season" ? "Season" : "Episode");
  var sortBy = mode === "collection"
    ? "ProductionYear,SortName"
    : (mode === "season" ? "IndexNumber,SortName" : "ParentIndexNumber,IndexNumber,SortName");
  var sortOrder = "Ascending";

  var out = [];
  var seen = {};
  var startIndex = 0;

  var fetchNext = function() {
    var url = "/Items?UserId=" + encodeURIComponent(userId) +
              "&ParentId=" + encodeURIComponent(itemId) +
              "&IncludeItemTypes=" + encodeURIComponent(includeItemTypes) +
              "&Recursive=false" +
              "&Fields=" + encodeURIComponent(getContainerPreviewFields()) +
              "&SortBy=" + encodeURIComponent(sortBy) +
              "&SortOrder=" + sortOrder +
              "&Limit=" + WATCHLIST_COLLECTION_PAGE_SIZE +
              "&StartIndex=" + startIndex;

    return makeApiRequest(url, { signal: (options && options.signal) }).then(function(response) {
      var pageItems = (response && Array.isArray(response.Items)) ? response.Items : [];
      if (!pageItems.length) return out;

      for (var i = 0; i < pageItems.length; i++) {
        var item = pageItems[i];
        var id = text(item && item.Id);
        if (!id || seen[id]) continue;
        seen[id] = true;
        out.push(item);
      }

      if (pageItems.length < WATCHLIST_COLLECTION_PAGE_SIZE) return out;
      startIndex += WATCHLIST_COLLECTION_PAGE_SIZE;
      return fetchNext();
    });
  };

  return fetchNext().then(function(items) {
    return sortContainerPreviewItems(items, mode);
  });
}

function seedContainerPreviewPayload(itemId, existingPayload) {
  var payload = getPreviewPayload(existingPayload);
  if (!itemId || payload.collectionItemsLoaded) return Promise.resolve(payload);

  return getCachedCollectionPreview(itemId).then(function(cached) {
    if (!cached.hasCache) return payload;

    var merged = {};
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) merged[k] = payload[k];
    merged.collectionItems = cached.items;
    merged.collectionItemsTotal = cached.total;
    merged.collectionItemsLoaded = true;
    merged.collectionItemsStale = cached.stale;
    merged.collectionItemsUpdatedAt = cached.updatedAt;
    merged.collectionItemsSource = "db";
    return createPreviewPayload(merged);
  });
}

function isContainerPreviewView(view, previewData) {
  var payload = getPreviewPayload(previewData);
  var baseItem = (view && view.item) ? view.item : {};
  return !!getPreviewContainerMode(payload.details || baseItem);
}

function getExpectedContainerPreviewTotal(view, previewData) {
  var payload = getPreviewPayload(previewData);
  var details = payload.details || {};
  var baseItem = (view && view.item) ? view.item : {};
  var mode = getPreviewContainerMode(details.Id ? details : baseItem);
  if (mode === "collection") {
    return Math.max(
      Number(payload.collectionItemsTotal || 0),
      Number(details.ChildCount || 0),
      Number(baseItem.childCount || baseItem.ChildCount || 0),
      normalizeCollectionPreviewItems(payload.collectionItems || []).length
    );
  }

  return Math.max(
    Number(payload.collectionItemsTotal || 0),
    normalizeCollectionPreviewItems(payload.collectionItems || []).length
  );
}

function isContainerPreviewIncomplete(view, previewData) {
  var payload = getPreviewPayload(previewData);
  if (!payload.collectionItemsLoaded) return false;
  var expectedTotal = getExpectedContainerPreviewTotal(view, previewData);
  var loadedCount = normalizeCollectionPreviewItems(payload.collectionItems || []).length;
  return expectedTotal > loadedCount;
}

function hasContainerPreviewItems(previewData) {
  return normalizeCollectionPreviewItems(getPreviewPayload(previewData).collectionItems || []).length > 0;
}

function shouldFetchContainerPreview(view, previewData) {
  var payload = getPreviewPayload(previewData);
  return isContainerPreviewView(view, previewData) && (
    !payload.collectionItemsLoaded ||
    payload.collectionItemsStale ||
    isContainerPreviewIncomplete(view, previewData) ||
    payload.collectionItemsSource !== "live" ||
    !payload.collectionItemsUpdatedAt ||
    isStale(payload.collectionItemsUpdatedAt, WATCHLIST_COLLECTION_REFRESH_MS)
  );
}

function formatCommunityRating(value) {
  var rating = Number(value);
  if (isFinite(rating)) {
    return "★ " + rating.toFixed(1);
  }
  return "";
}

function getCollectionYearRange(items) {
  var normalized = normalizeCollectionPreviewItems(items || []);
  var years = [];
  for (var i = 0; i < normalized.length; i++) {
    var y = Number(normalized[i] && normalized[i].ProductionYear);
    if (isFinite(y) && y > 0) years.push(y);
  }
  years.sort(function(a, b) { return a - b; });

  if (!years.length) return "";
  var first = years[0];
  var last = years[years.length - 1];
  return first === last ? String(first) : first + "-" + last;
}

function getCollectionWatchedSummary(items, total) {
  var normalized = normalizeCollectionPreviewItems(items || []);
  var count = 0;
  for (var i = 0; i < normalized.length; i++) if (isMarkedPlayed(normalized[i])) count++;
  if (!total) return "";
  return count + "/" + total;
}

function getCollectionWatchedCount(items) {
  var normalized = normalizeCollectionPreviewItems(items || []);
  var count = 0;
  for (var i = 0; i < normalized.length; i++) if (isMarkedPlayed(normalized[i])) count++;
  return count;
}

function getCollectionAverageRating(items) {
  var normalized = normalizeCollectionPreviewItems(items || []);
  var sum = 0;
  var count = 0;
  for (var i = 0; i < normalized.length; i++) {
    var r = Number(normalized[i] && normalized[i].CommunityRating);
    if (isFinite(r) && r > 0) {
      sum += r;
      count++;
    }
  }

  if (!count) return "";
  var avg = sum / count;
  return "★ " + avg.toFixed(1);
}

function getContainerPreviewSectionTitle(mode) {
  var cleanMode = text(mode);
  if (mode === "season") return L("watchlistPreviewSeasonSection", "Temporadas");
  if (mode === "episode") return L("watchlistPreviewEpisodeSection", "Episódios");
  return L("watchlistPreviewCollectionSection", "Itens da Coleção");
}

function getContainerPreviewLoadingText(mode) {
  var cleanMode = text(mode);
  if (mode === "season") return L("watchlistPreviewSeasonLoading", "Carregando temporadas");
  if (mode === "episode") return L("watchlistPreviewEpisodeLoading", "Carregando episódios");
  return L("watchlistPreviewCollectionLoading", "Carregando itens da coleção");
}

function getContainerPreviewCountText(mode, count) {
  var cleanMode = text(mode);
  var c = Number(count || 0);
  if (!count) return "";
  if (cleanMode === "season") return String(c) + " " + String(L("season", "Temporada"));
  if (cleanMode === "episode") return String(c) + " " + String(L("episode", "Episódio"));
  return String(c) + " " + String(L("watchlistPreviewCollectionItemSuffix", "item"));
}

function getContainerPreviewMoreText(hiddenCount) {
  var h = Number(hiddenCount || 0);
  if (!h) return "";
  return "+" + String(h) + " " + String(L("watchlistPreviewCollectionMore", "mais"));
}

function formatSeasonPreviewTitle(item) {
  var raw = text(item && item.Name);
  var index = Number(item && item.IndexNumber || 0);
  if (raw) return raw;
  if (index > 0) return L("season", "Temporada") + " " + index;
  return L("season", "Temporada");
}

function formatEpisodePreviewTitle(item) {
  var seasonNumber = Number(item && item.ParentIndexNumber || 0);
  var episodeNumber = Number(item && item.IndexNumber || 0);
  var hasSeason = isFinite(seasonNumber) && seasonNumber > 0;
  var hasEpisode = isFinite(episodeNumber) && episodeNumber > 0;

  var prefix = "";
  if (hasSeason && hasEpisode) {
    var s = String(seasonNumber);
    if (s.length < 2) s = "0" + s;
    var e = String(episodeNumber);
    if (e.length < 2) e = "0" + e;
    prefix = "S" + s + "E" + e;
  } else if (hasEpisode) {
    var e2 = String(episodeNumber);
    if (e2.length < 2) e2 = "0" + e2;
    prefix = "E" + e2;
  }

  var raw = text(item && item.Name, L("episode", "Episódio"));
  return prefix ? prefix + " • " + raw : raw;
}

function getContainerPreviewCardTitle(item, mode) {
  if (mode === "season") return formatSeasonPreviewTitle(item);
  if (mode === "episode") return formatEpisodePreviewTitle(item);
  return text(item && item.Name, L("untitled", "Sem título"));
}

function getContainerPreviewCardMeta(item, mode) {
  var playedText = isMarkedPlayed(item) ? L("played", "Assistido") : "";
  if (mode === "season") {
    var episodeCount = Number(item && item.ChildCount || 0);
    var labels = [];
    if (episodeCount > 0) labels.push(episodeCount + " " + L("episode", "Episódio"));
    if (playedText) labels.push(playedText);
    return labels.join(" • ");
  }

  if (mode === "episode") {
    var labels2 = [];
    var runtime = formatRuntime(item && item.RunTimeTicks);
    if (runtime) labels2.push(runtime);
    if (playedText) labels2.push(playedText);
    return labels2.join(" • ");
  }

  var year = text(item && item.ProductionYear);
  var rating = formatCommunityRating(item && item.CommunityRating);
  var labels3 = [];
  if (year) labels3.push(year);
  if (rating) labels3.push(rating);
  if (playedText) labels3.push(playedText);
  return labels3.join(" • ");
}

function getPreferredVisibleContainerItems(items, limit) {
  var normalized = normalizeCollectionPreviewItems(items || []);
  if (!normalized.length || limit <= 0) return [];
  if (normalized.length <= limit) return normalized.slice(0, limit);

  var unplayed = [];
  var played = [];

  for (var i = 0; i < normalized.length; i++) {
    var item = normalized[i];
    if (isMarkedPlayed(item)) {
      played.push(item);
    } else {
      unplayed.push(item);
    }
  }

  var combined = unplayed.concat(played);
  return combined.slice(0, limit);
}

function renderPlayedOverlayMarkup() {
  return "" +
    "<div class=\"monwuiwl-played-overlay\" aria-hidden=\"true\">" +
    "  <span class=\"monwuiwl-played-mark\">" +
    "    <svg viewBox=\"0 0 24 24\" focusable=\"false\" aria-hidden=\"true\">" +
    "      <path d=\"M9.2 16.6 4.8 12.2 3.4 13.6 9.2 19.4 20.6 8 19.2 6.6z\"></path>" +
    "    </svg>" +
    "  </span>" +
    "  <span class=\"monwuiwl-played-text\">" + escapeHtml(L("played", "Assistido")) + "</span>" +
    "</div>";
}

function renderCollectionPreviewCards(items, options) {
  items = items || [];
  options = options || {};
  var mode = options.mode || "collection";

  var visible = getPreferredVisibleContainerItems(items, WATCHLIST_COLLECTION_PREVIEW_LIMIT);
  if (!visible.length) return "";

  return "" +
    "<div class=\"monwuiwl-preview-collection-grid\">" +
      visible.map(function(item) {
        var title = getContainerPreviewCardTitle(item, mode);
        var posterUrl = buildPosterUrl(item, { width: 220, height: 330, quality: 88 });
        var meta = getContainerPreviewCardMeta(item, mode);
        var runtimeTicks = Number((item && item.RunTimeTicks) || (item && item.CumulativeRunTimeTicks) || 0);
        var playbackTicks = Number((item && item.UserData && item.UserData.PlaybackPositionTicks) || 0);
        var progressPercent = runtimeTicks > 0 && playbackTicks > 0
          ? Math.max(0, Math.min(100, Math.round((playbackTicks / runtimeTicks) * 100)))
          : 0;
        var fallback = mode === "season"
          ? L("season", "Temporada")
          : (mode === "episode" ? L("episode", "Episódio") : text(item && item.Type, title.slice(0, 2).toUpperCase() || L("content", "Conteúdo")));
        var isPlayed = isMarkedPlayed(item);
        var playLabel = getPlayActionLabel(item);

        return "" +
          "<button" +
          "  type=\"button\"" +
          "  class=\"monwuiwl-preview-collection-card " + (isPlayed ? "is-played" : "") + "\"" +
          "  data-monwuiwl-preview-play=\"" + escapeHtml(item && item.Id) + "\"" +
          "  aria-label=\"" + escapeHtml(playLabel + ": " + title) + "\"" +
          ">" +
          "  <div class=\"monwuiwl-preview-collection-poster\">" +
          (posterUrl
            ? "<img src=\"" + escapeHtml(posterUrl) + "\" alt=\"" + escapeHtml(title) + "\" loading=\"lazy\" decoding=\"async\">"
            : "<div class=\"monwuiwl-preview-collection-fallback\">" + escapeHtml(fallback) + "</div>") +
          (isPlayed ? renderPlayedOverlayMarkup() : "") +
          "  </div>" +
          "  <div class=\"monwuiwl-preview-collection-main\">" +
          "    <div class=\"monwuiwl-preview-collection-title\">" + escapeHtml(title) + "</div>" +
          (meta ? "<div class=\"monwuiwl-preview-collection-meta\">" + escapeHtml(meta) + "</div>" : "") +
          (progressPercent > 0 ? "" +
          "    <div class=\"monwuiwl-preview-collection-progress\">" +
          "      <div class=\"monwuiwl-preview-collection-progress-bar\" style=\"width:" + progressPercent + "%\"></div>" +
          "    </div>" : "") +
          "  </div>" +
          "</button>";
      }).join("") +
    "</div>";
}

function renderCollectionPreviewSection(items, total, options) {
  items = items || [];
  total = total || 0;
  options = options || {};
  var loading = options.loading === true;
  var mode = options.mode || "collection";

  var normalized = normalizeCollectionPreviewItems(items);
  var visible = getPreferredVisibleContainerItems(normalized, WATCHLIST_COLLECTION_PREVIEW_LIMIT);
  var itemCount = Math.max(Number(total || 0), normalized.length);
  var hiddenCount = Math.max(0, itemCount - visible.length);

  if (!visible.length && !loading) return "";

  var meta = [
    getContainerPreviewCountText(mode, itemCount),
    getContainerPreviewMoreText(hiddenCount)
  ].filter(Boolean).join(" • ");

  return "" +
    "<section class=\"monwuiwl-preview-section\">" +
    "  <div class=\"monwuiwl-preview-collection-head\">" +
    "    <h4 class=\"monwuiwl-preview-section-title\">" + escapeHtml(getContainerPreviewSectionTitle(mode)) + "</h4>" +
    (meta ? "<div class=\"monwuiwl-preview-collection-count\">" + escapeHtml(meta) + "</div>" : "") +
    "  </div>" +
    renderCollectionPreviewCards(visible, { mode: mode }) +
    (loading ? "<div class=\"monwuiwl-preview-collection-note\">" + escapeHtml(getContainerPreviewLoadingText(mode)) + "</div>" : "") +
    "</section>";
}

function getPeopleNames(item, type, limit) {
  var max = limit || 8;
  var people = Array.isArray(item && item.People) ? item.People : [];
  var filtered = [];
  for (var i = 0; i < people.length; i++) {
    var p = people[i];
    if (text(p && p.Type).toLowerCase() === text(type).toLowerCase()) {
      filtered.push(p && p.Name);
    }
  }
  return uniqTextList(filtered).slice(0, max);
}

function getActorNames(item, limit) {
  var max = limit || 8;
  var roles = { "actor": true, "gueststar": true, "voice": true };
  var people = Array.isArray(item && item.People) ? item.People : [];
  var filtered = [];
  for (var i = 0; i < people.length; i++) {
    var p = people[i];
    var t = text(p && p.Type).toLowerCase();
    if (roles[t]) filtered.push(p && p.Name);
  }
  return uniqTextList(filtered).slice(0, max);
}

function getStudioNames(item, limit) {
  var max = limit || 6;
  var studios = Array.isArray(item && item.Studios) ? item.Studios : [];
  var names = [];
  for (var i = 0; i < studios.length; i++) {
    var s = studios[i];
    names.push((s && s.Name) || s);
  }
  return uniqTextList(names).slice(0, max);
}

function getStudioEntries(item, limit) {
  var max = limit || 6;
  var out = [];
  var seen = {};

  var studios = Array.isArray(item && item.Studios) ? item.Studios : [];
  for (var i = 0; i < studios.length; i++) {
    var studio = studios[i];
    var name = text((studio && studio.Name) || studio);
    if (!name) continue;

    var key = name.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;

    out.push({
      name: name,
      id: text((studio && (studio.Id || studio.StudioId || studio.studioId)) || (typeof studio === "string" ? "" : ""))
    });

    if (out.length >= max) break;
  }

  return out;
}

function getWatchlistTabViews(model, tabKey) {
  var currentTab = normalizeWatchlistTabKey(tabKey);
  var own = (model && model[currentTab] && model[currentTab].own) || [];
  var shared = (model && model[currentTab] && model[currentTab].shared) || [];
  return own.concat(shared);
}

function getAllWatchlistContentViews(model, kind) {
  kind = kind || "";
  var views = [];
  for (var i = 0; i < WATCHLIST_CONTENT_TABS.length; i++) {
    var tab = WATCHLIST_CONTENT_TABS[i];
    var bucket = model && model[tab.key];
    if (!bucket) continue;

    if (kind !== "shared") {
      views = views.concat(bucket.own || []);
    }
    if (kind !== "own") {
      views = views.concat(bucket.shared || []);
    }
  }

  return views;
}

function createStatsBucketState(tab) {
  return {
    key: tab.key,
    label: L(tab.labelKey, tab.fallback),
    totalSet: {},
    activeSet: {},
    completedSet: {}
  };
}

function getWatchlistHistoryEntries(dashboard) {
  dashboard = dashboard || dashboardCache;
  return Array.isArray(dashboard && dashboard.historyEntries) ? dashboard.historyEntries : [];
}

function resolveWatchlistStatsBucket(itemLike) {
  return getWatchlistTabKey({
    Type: (itemLike && (itemLike.ItemType || itemLike.itemType || itemLike.Type)) || "",
    MediaType: (itemLike && (itemLike.MediaType || itemLike.mediaType)) || ""
  });
}

function buildWatchlistHistorySummary(model, dashboard) {
  var dash = dashboard || dashboardCache;
  var ownViews = getAllWatchlistContentViews(model, "own");
  var sharedViews = getAllWatchlistContentViews(model, "shared");
  var historyEntries = getWatchlistHistoryEntries(dash);
  
  var completedItemIds = {};
  var removedCompletedItemIds = {};
  var buckets = {};
  for (var k = 0; k < WATCHLIST_CONTENT_TABS.length; k++) {
    var t = WATCHLIST_CONTENT_TABS[k];
    buckets[t.key] = createStatsBucketState(t);
  }

  var outgoingSharesCount = 0;

  for (var i = 0; i < historyEntries.length; i++) {
    var historyEntry = historyEntries[i];
    var itemId = text((historyEntry && (historyEntry.ItemId || historyEntry.itemId)) || "");
    if (!itemId) continue;

    var bucketKey = resolveWatchlistStatsBucket(historyEntry);
    var bucket = buckets[bucketKey];
    if (bucket) {
      bucket.totalSet[itemId] = true;
    }

    if (historyEntry && historyEntry.RemovedAfterPlayed === true) {
      completedItemIds[itemId] = true;
      removedCompletedItemIds[itemId] = true;
      if (bucket) {
        bucket.completedSet[itemId] = true;
      }
    }
  }

  for (var j = 0; j < ownViews.length; j++) {
    var view = ownViews[j];
    var itemId2 = text(view && view.itemId);
    if (!itemId2) continue;

    var bucketKey2 = resolveWatchlistStatsBucket((view && view.item) || {});
    var bucket2 = buckets[bucketKey2];
    if (bucket2) {
      bucket2.activeSet[itemId2] = true;
    }

    var playable = (view && view.item && view.item.liveItem) || (view && view.item) || {};
    if (isMarkedPlayed(playable)) {
      completedItemIds[itemId2] = true;
      if (bucket2) {
        bucket2.completedSet[itemId2] = true;
      }
    }

    outgoingSharesCount += Array.isArray(view && view.outgoingShares) ? view.outgoingShares.length : 0;
  }

  var userContext = getCurrentUserContext();
  var userName = userContext.userName;
  var resolvedUserName = text(
    userName ||
    (dash && dash.myItems && dash.myItems[0] && dash.myItems[0].OwnerUserName) ||
    (dash && dash.outgoingShares && dash.outgoingShares[0] && dash.outgoingShares[0].OwnerUserName),
    L("unknownUser", "Usuário desconhecido")
  );

  var typeBreakdown = [];
  for (var l = 0; l < WATCHLIST_CONTENT_TABS.length; l++) {
    var tabObj = WATCHLIST_CONTENT_TABS[l];
    var b = buckets[tabObj.key] || createStatsBucketState(tabObj);
    typeBreakdown.push({
      key: tabObj.key,
      label: b.label,
      totalEverAdded: Object.keys(b.totalSet || {}).length,
      activeCount: Object.keys(b.activeSet || {}).length,
      completedCount: Object.keys(b.completedSet || {}).length
    });
  }

  return {
    userName: resolvedUserName,
    totalEverAdded: historyEntries.length,
    activeOwnCount: ownViews.length,
    completedCount: Object.keys(completedItemIds).length,
    removedCompletedCount: Object.keys(removedCompletedItemIds).length,
    sharedCount: sharedViews.length,
    outgoingSharesCount: outgoingSharesCount,
    typeBreakdown: typeBreakdown
  };
}

function renderStatsCard(label, value) {
  return "" +
    "<article class=\"monwuiwl-stat-card\">" +
    "  <div class=\"monwuiwl-stat-label\">" + escapeHtml(label) + "</div>" +
    "  <div class=\"monwuiwl-stat-value\">" + escapeHtml(formatCount(value)) + "</div>" +
    "</article>";
}

function renderWatchlistHistoryTypeCard(typeSummary) {
  return "" +
    "<article class=\"monwuiwl-stats-type-card\">" +
    "  <div class=\"monwuiwl-stats-type-name\">" + escapeHtml(typeSummary.label) + "</div>" +
    "  <div class=\"monwuiwl-stats-type-total\">" +
    "    <span>" + escapeHtml(L("watchlistStatsTracked", "Total de registros")) + "</span>" +
    "    <strong>" + escapeHtml(formatCount(typeSummary.totalEverAdded)) + "</strong>" +
    "  </div>" +
    "  <div class=\"monwuiwl-stats-type-row\">" +
    "    <span>" + escapeHtml(L("watchlistHistoryActive", "Watchlist ativa")) + "</span>" +
    "    <strong>" + escapeHtml(formatCount(typeSummary.activeCount)) + "</strong>" +
    "  </div>" +
    "  <div class=\"monwuiwl-stats-type-row\">" +
    "    <span>" + escapeHtml(L("watchlistHistoryCompleted", "Total assistido / ouvido")) + "</span>" +
    "    <strong>" + escapeHtml(formatCount(typeSummary.completedCount)) + "</strong>" +
    "  </div>" +
    "</article>";
}

function getStatsUserId() {
  var context = getCurrentUserContext();
  var session = typeof getSessionInfo === "function" ? getSessionInfo() : null;
  return text(context.userId || (session && session.userId));
}

function generalStatsStale() {
  var userId = getStatsUserId();
  if (!userId) return false;
  if (!generalStatsCache) return true;
  if (text(generalStatsCache && generalStatsCache.userId) !== userId) return true;
  return (Date.now() - Number((generalStatsCache && generalStatsCache.loadedAt) || 0)) > GENERAL_STATS_TTL_MS;
}

function buildUserItemsQuery(userId, params) {
  var p = params || {};
  var search = [];
  for (var k in p) {
    if (Object.prototype.hasOwnProperty.call(p, k)) {
      var val = p[k];
      if (val === null || val === undefined || val === "") continue;
      search.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(val)));
    }
  }
  return "/Users/" + encodeURIComponent(userId) + "/Items?" + search.join("&");
}

function queryUserItems(userId, params, options) {
  params = params || {};
  options = options || {};
  var signal = options.signal;

  var queryParams = {
    Recursive: "true",
    EnableTotalRecordCount: "true"
  };
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    queryParams[keys[i]] = params[keys[i]];
  }

  var url = buildUserItemsQuery(userId, queryParams);
  return makeApiRequest(url, { signal: signal, __quiet: true, __preview: true })
    ["catch"](function() {
      return { Items: [], TotalRecordCount: 0 };
    });
}

function getTotalRecordCount(data) {
  var direct = Number((data && (data.TotalRecordCount !== undefined ? data.TotalRecordCount : data.totalRecordCount)) || 0);
  if (isFinite(direct) && direct >= 0) return direct;
  return Array.isArray(data && data.Items) ? data.Items.length : 0;
}

function getGeneralMediaSpecs() {
  return [
    {
      key: "movies",
      label: L("watchlistMovieTab", "Filmes"),
      libraryTypes: "Movie",
      playedTypes: "Movie",
    },
    {
      key: "series",
      label: L("watchlistSeriesTab", "Séries"),
      libraryTypes: "Series",
      playedTypes: "Episode",
    },
    {
      key: "music",
      label: L("watchlistMusicTab", "Música"),
      libraryTypes: "Audio",
      playedTypes: "Audio",
    }
  ];
}

function mapGeneralStatsItem(item, key) {
  if (!item || typeof item !== "object") return null;

  var playedAt = getLastPlayedTimestamp(item);
  var typeName = getItemTypeName(item);
  var title = key === "series"
    ? text((item && (item.SeriesName || item.Name)) || "", L("untitled", "Sem título"))
    : text((item && (item.Name || item.Album)) || "", L("untitled", "Sem título"));

  var subtitle = "";
  if (key === "series") {
    subtitle = text((item && item.Name && item.SeriesName && item.Name !== item.SeriesName ? item.Name : ""));
  } else if (key === "music") {
    var artists = (item && Array.isArray(item.Artists) ? item.Artists.filter(Boolean).join(", ") : "");
    subtitle = text(
      (item && item.AlbumArtist) ||
      artists ||
      (item && item.Album) || ""
    );
  } else if (typeName === "movie") {
    subtitle = text(item && item.ProductionYear);
  }

  var playCount = Number((item && item.UserData && item.UserData.PlayCount) || 0);

  return {
    id: text((item && (item.Id || item.ItemId)) || ""),
    title: title,
    subtitle: subtitle,
    playedAt: playedAt,
    playCount: playCount,
    label: key === "series" ? L("watchlistSeriesTab", "Séries") : (key === "music" ? L("watchlistMusicTab", "Música") : L("watchlistMovieTab", "Filmes"))
  };
}

function loadWatchlistGeneralStats(options) {
  var opt = options || {};
  var force = opt.force === true;

  var userId = getStatsUserId();
  if (!userId) {
    generalStatsCache = {
      userId: "",
      loadedAt: Date.now(),
      media: [],
      topRepeated: []
    };
    return Promise.resolve(generalStatsCache);
  }

  if (!force && !generalStatsStale() && generalStatsCache) {
    return Promise.resolve(generalStatsCache);
  }

  if (!force && generalStatsPromise) {
    return generalStatsPromise;
  }

  generalStatsPromise = Promise.resolve().then(function() {
    var fields = GENERAL_STATS_ITEM_FIELDS.join(",");
    var specs = getGeneralMediaSpecs();

    var mediaPromises = [];
    for (var i = 0; i < specs.length; i++) {
      (function(spec) {
        mediaPromises.push(
          Promise.all([
            queryUserItems(userId, { IncludeItemTypes: spec.libraryTypes, Limit: 1 }),
            queryUserItems(userId, {
              IncludeItemTypes: spec.playedTypes,
              Filters: "IsPlayed",
              EnableUserData: "true",
              SortBy: "DatePlayed,DateCreated",
              SortOrder: "Descending",
              Limit: 1,
              Fields: fields
            })
          ]).then(function(results) {
            var libraryData = results[0];
            var playedData = results[1];
            return {
              key: spec.key,
              label: spec.label,
              totalCount: getTotalRecordCount(libraryData),
              playedCount: getTotalRecordCount(playedData),
              lastItem: mapGeneralStatsItem(Array.isArray(playedData && playedData.Items) ? playedData.Items[0] : null, spec.key)
            };
          })
        );
      })(specs[i]);
    }

    return Promise.all(mediaPromises).then(function(media) {
      return queryUserItems(userId, {
        IncludeItemTypes: "Movie,Episode,Audio",
        Filters: "IsPlayed",
        EnableUserData: "true",
        SortBy: "PlayCount,DatePlayed,DateCreated",
        SortOrder: "Descending",
        Limit: 12,
        Fields: fields
      }).then(function(topRepeatedData) {
        var raw = (topRepeatedData && Array.isArray(topRepeatedData.Items)) ? topRepeatedData.Items : [];
        var filtered = [];
        for (var j = 0; j < raw.length; j++) {
          var it = raw[j];
          if (Number((it && it.UserData && it.UserData.PlayCount) || 0) > 1) {
            filtered.push(it);
          }
        }
        var limited = filtered.slice(0, 6);
        var mapped = [];
        for (var l = 0; l < limited.length; l++) {
          var bucket = resolveWatchlistStatsBucket(limited[l]);
          var m = mapGeneralStatsItem(limited[l], bucket === "albums" || bucket === "music" ? "music" : (bucket === "series" ? "series" : "movies"));
          if (m) mapped.push(m);
        }

        generalStatsCache = {
          userId: userId,
          loadedAt: Date.now(),
          media: media,
          topRepeated: mapped
        };

        return generalStatsCache;
      });
    });
  })["finally"](function() {
    generalStatsPromise = null;
  });

  return generalStatsPromise;
}

function renderWatchlistHistorySection(model) {
  var summary = buildWatchlistHistorySummary(model);

  return "" +
    "<section class=\"monwuiwl-stats-shell monwuiwl-stats-shell-history\">" +
    "  <article class=\"monwuiwl-stats-hero\">" +
    "    <div class=\"monwuiwl-stats-hero-content\">" +
    "      <div class=\"monwuiwl-stats-kicker\">" + escapeHtml(L("watchlistHistoryTitle", "Histórico da Watchlist")) + "</div>" +
    "      <h3 class=\"monwuiwl-stats-user\">" + escapeHtml(summary.userName) + "</h3>" +
    "      <p class=\"monwuiwl-stats-copy\">" + escapeHtml(L("watchlistHistorySubtitle", "Sua lista ativa, conteúdos removidos e totais históricos são mantidos aqui juntos.")) + " </p>" +
    "      <div class=\"monwuiwl-stats-total\">" +
    "        <span class=\"monwuiwl-stats-total-label\">" + escapeHtml(L("watchlistStatsTracked", "Total de registros")) + "</span>" +
    "        <strong class=\"monwuiwl-stats-total-value\">" + escapeHtml(formatCount(summary.totalEverAdded)) + "</strong>" +
    "      </div>" +
    "    </div>" +
    "    <div class=\"monwuiwl-stats-hero-art\" aria-hidden=\"true\">" +
    "      <div class=\"monwuiwl-stats-hero-art-badge\">" +
    renderWatchlistIconSvg("monwuiwl-stats-hero-art-icon") +
    "      </div>" +
    "      <div class=\"monwuiwl-stats-hero-art-bars\">" +
    "        <span></span>" +
    "        <span></span>" +
    "        <span></span>" +
    "      </div>" +
    "    </div>" +
    "  </article>" +
    "" +
    "  <div class=\"monwuiwl-stats-cards\">" +
    renderStatsCard(L("watchlistHistoryActive", "Watchlist ativa"), summary.activeOwnCount) +
    renderStatsCard(L("watchlistHistoryCompleted", "Total assistido / ouvido"), summary.completedCount) +
    renderStatsCard(L("watchlistHistoryCompletedRemoved", "Assistidos e removidos"), summary.removedCompletedCount) +
    renderStatsCard(L("watchlistStatsOutgoingShares", "Compartilhamentos enviados"), summary.outgoingSharesCount) +
    renderStatsCard(L("watchlistSharedItems", "Compartilhados com você"), summary.sharedCount) +
    "  </div>" +
    "" +
    "  <section class=\"monwuiwl-stats-breakdown\">" +
    "    <div class=\"monwuiwl-stats-breakdown-head\">" +
    "      <h3 class=\"monwuiwl-stats-breakdown-title\">" + escapeHtml(L("watchlistStatsByType", "Distribuição por tipo")) + "</h3>" +
    "    </div>" +
    "    <div class=\"monwuiwl-stats-type-grid\">" +
    summary.typeBreakdown.map(renderWatchlistHistoryTypeCard).join("") +
    "    </div>" +
    "  </section>" +
    "</section>";
}

function renderGeneralStatsMediaCard(section) {
  var lastItem = (section && section.lastItem) || null;
  var lastItemMarkup = lastItem
    ? "" +
      "<div class=\"monwuiwl-general-last-title\">" + escapeHtml(lastItem.title) + "</div>" +
      (lastItem.subtitle ? "<div class=\"monwuiwl-general-last-subtitle\">" + escapeHtml(lastItem.subtitle) + "</div>" : "") +
      "<div class=\"monwuiwl-general-last-meta\">" + escapeHtml(lastItem.playedAt ? formatDate(lastItem.playedAt) : L("watchlistGeneralEmptyLast", "Nenhuma reprodução ainda")) + "</div>"
    : "<div class=\"monwuiwl-general-last-empty\">" + escapeHtml(L("watchlistGeneralEmptyLast", "Nenhuma reprodução ainda")) + "</div>";

  return "" +
    "<article class=\"monwuiwl-general-card\" data-media-key=\"" + escapeHtml((section && section.key) || "") + "\">" +
    "  <div class=\"monwuiwl-general-card-head\">" +
    "    <h4 class=\"monwuiwl-general-card-title\">" + escapeHtml((section && section.label) || "") + "</h4>" +
    "    <span class=\"monwuiwl-general-card-badge\" aria-hidden=\"true\">" +
    renderWatchlistIconSvg("monwuiwl-general-card-badge-icon") +
    "    </span>" +
    "  </div>" +
    "  <div class=\"monwuiwl-general-card-stats\">" +
    "    <div class=\"monwuiwl-general-card-stat\">" +
    "      <span>" + escapeHtml(L("watchlistGeneralLibraryTotal", "Total na biblioteca")) + "</span>" +
    "      <strong>" + escapeHtml(formatCount((section && section.totalCount) || 0)) + "</strong>" +
    "    </div>" +
    "    <div class=\"monwuiwl-general-card-stat\">" +
    "      <span>" + escapeHtml(L("watchlistGeneralPlayedTotal", "Assistidos / ouvidos")) + "</span>" +
    "      <strong>" + escapeHtml(formatCount((section && section.playedCount) || 0)) + "</strong>" +
    "    </div>" +
    "  </div>" +
    "  <div class=\"monwuiwl-general-last\">" +
    "    <div class=\"monwuiwl-general-last-label\">" + escapeHtml(L("watchlistGeneralLastActivity", "Última atividade")) + "</div>" +
    lastItemMarkup +
    "  </div>" +
    "</article>";
}

function renderGeneralTopRepeated(topRepeated) {
  var list = topRepeated || [];
  if (!Array.isArray(list) || !list.length) {
    return "<div class=\"monwuiwl-empty\">" + escapeHtml(L("watchlistGeneralTopReplayEmpty", "Ainda não há dados de reprodução repetida.")) + "</div>";
  }

  var html = "<div class=\"monwuiwl-general-repeat-list\">";
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var labels = [];
    if (item.label) labels.push(item.label);
    if (item.subtitle) labels.push(item.subtitle);

    html += "" +
      "<article class=\"monwuiwl-general-repeat-item\">" +
      "  <div class=\"monwuiwl-general-repeat-main\">" +
      "    <div class=\"monwuiwl-general-repeat-title\">" + escapeHtml(item.title) + "</div>" +
      "    <div class=\"monwuiwl-general-repeat-subtitle\">" + escapeHtml(labels.join(" • ")) + "</div>" +
      "  </div>" +
      "  <div class=\"monwuiwl-general-repeat-count\">" + escapeHtml(formatCount(item.playCount)) + "</div>" +
      "</article>";
  }
  html += "</div>";
  return html;
}

function renderWatchlistGeneralSection() {
  var stats = generalStatsCache;
  var currentUserId = getStatsUserId();
  var statsMatchCurrentUser = !!currentUserId && text(stats && stats.userId) === currentUserId;
  var loading = !statsMatchCurrentUser ? (!!currentUserId && (generalStatsStale() || !!generalStatsPromise)) : false;
  var media = statsMatchCurrentUser && Array.isArray(stats && stats.media) ? stats.media : [];
  var topRepeated = statsMatchCurrentUser && Array.isArray(stats && stats.topRepeated) ? stats.topRepeated : [];

  var mediaCardsHtml = "";
  for (var i = 0; i < media.length; i++) {
    mediaCardsHtml += renderGeneralStatsMediaCard(media[i]);
  }

  return "" +
    "<section class=\"monwuiwl-stats-shell monwuiwl-stats-shell-general\">" +
    "  <article class=\"monwuiwl-stats-hero monwuiwl-stats-hero-secondary\">" +
    "    <div class=\"monwuiwl-stats-hero-content\">" +
    "      <div class=\"monwuiwl-stats-kicker\">" + escapeHtml(L("watchlistGeneralTitle", "Geral do Jellyfin")) + "</div>" +
    "      <h3 class=\"monwuiwl-stats-user\">" + escapeHtml(L("watchlistGeneralHeroTitle", "Resumo de Mídia do Usuário")) + "</h3>" +
    "      <p class=\"monwuiwl-stats-copy\">" + escapeHtml(L("watchlistGeneralSubtitle", "Conteúdo total, últimas reproduções e hábitos de repetição são exibidos aqui.")) + "</p>" +
    "    </div>" +
    "    <div class=\"monwuiwl-stats-hero-art\" aria-hidden=\"true\">" +
    "      <div class=\"monwuiwl-stats-hero-art-badge\">" +
    renderWatchlistIconSvg("monwuiwl-stats-hero-art-icon") +
    "      </div>" +
    "      <div class=\"monwuiwl-stats-hero-art-bars\">" +
    "        <span></span>" +
    "        <span></span>" +
    "        <span></span>" +
    "      </div>" +
    "    </div>" +
    "  </article>" +
    "" +
    "  <section class=\"monwuiwl-stats-breakdown\">" +
    "    <div class=\"monwuiwl-stats-breakdown-head\">" +
    "      <h3 class=\"monwuiwl-stats-breakdown-title\">" + escapeHtml(L("watchlistGeneralTitle", "Geral do Jellyfin")) + "</h3>" +
    "    </div>" +
    (loading
      ? "<div class=\"monwuiwl-loading\">" + escapeHtml(L("watchlistGeneralLoading", "Carregando estatísticas gerais...")) + "</div>"
      : (media.length
        ? "" +
          "<div class=\"monwuiwl-general-grid\">" +
          mediaCardsHtml +
          "</div>"
        : "<div class=\"monwuiwl-empty\">" + escapeHtml(L("watchlistGeneralNoData", "Nenhum dado de estatística geral encontrado.")) + "</div>")) +
    "  </section>" +
    "" +
    "  <section class=\"monwuiwl-stats-breakdown\">" +
    "    <div class=\"monwuiwl-stats-breakdown-head\">" +
    "      <h3 class=\"monwuiwl-stats-breakdown-title\">" + escapeHtml(L("watchlistGeneralTopReplay", "Mais assistidos / ouvidos repetidamente")) + "</h3>" +
    "    </div>" +
    (loading
      ? "<div class=\"monwuiwl-loading\">" + escapeHtml(L("watchlistGeneralLoading", "Carregando estatísticas gerais...")) + "</div>"
      : renderGeneralTopRepeated(topRepeated)) +
    "  </section>" +
    "</section>";
}

function renderWatchlistStatsPanel(model) {
  return "" +
    "<section class=\"monwuiwl-stats-page\">" +
    renderWatchlistHistorySection(model) +
    renderWatchlistGeneralSection() +
    "</section>";
}

function findViewByItemId(model, itemId, tabKey) {
  tabKey = tabKey || "";
  var id = text(itemId);
  if (!id) return null;

  var searchTabs = [];
  if (tabKey) searchTabs.push(normalizeWatchlistTabKey(tabKey));
  for (var i = 0; i < WATCHLIST_TABS.length; i++) {
    var tab = WATCHLIST_TABS[i];
    if (searchTabs.indexOf(tab.key) === -1) searchTabs.push(tab.key);
  }

  for (var j = 0; j < searchTabs.length; j++) {
    var key = searchTabs[j];
    var views = getWatchlistTabViews(model, key);
    for (var k = 0; k < views.length; k++) {
      if (text(views[k] && views[k].itemId) === id) return views[k];
    }
  }

  return null;
}

function getPreviewInfoLine(view) {
  if (view && view.kind === "shared") {
    var by = text(view.ownerUserName);
    var at = formatDate(view.sharedAtUtc);
    var labels = [];
    if (by) labels.push(L("watchlistSharedBy", "Compartilhado por") + ": " + by);
    if (at) labels.push(at);
    return labels.join(" • ");
  }

  var shares = (view && view.outgoingShares) || [];
  var namesRaw = [];
  for (var i = 0; i < shares.length; i++) {
    var share = shares[i];
    namesRaw.push((share && (share.TargetUserName || share.targetUserName)) || "");
  }
  var names = uniqTextList(namesRaw);
  if (!names.length) return "";
  return L("watchlistSharedWith", "Compartilhado com") + ": " + names.join(", ");
}

function renderPreviewEmptyState() {
  return "" +
    "<div class=\"monwuiwl-preview-empty\">" +
    "  <div class=\"monwuiwl-preview-empty-copy\">" +
    escapeHtml(L("watchlistEmptySection", "Nenhum item aqui ainda.")) +
    "  </div>" +
    "</div>";
}

function renderPreviewStats(stats) {
  var list = stats || [];
  if (!list.length) return "";
  var html = "<div class=\"monwuiwl-preview-stats\">";
  for (var i = 0; i < list.length; i++) {
    var stat = list[i];
    html += "" +
      "<div class=\"monwuiwl-preview-stat\">" +
      "  <div class=\"monwuiwl-preview-stat-label\">" + escapeHtml(stat.label) + "</div>" +
      "  <div class=\"monwuiwl-preview-stat-value\">" + escapeHtml(stat.value) + "</div>" +
      "</div>";
  }
  html += "</div>";
  return html;
}

function renderPreviewFieldSection(title, fields) {
  var list = fields || [];
  var visible = [];
  for (var i = 0; i < list.length; i++) {
    if (text(list[i] && list[i].value)) visible.push(list[i]);
  }
  if (!visible.length) return "";

  var html = "" +
    "<section class=\"monwuiwl-preview-section\">" +
    "  <h4 class=\"monwuiwl-preview-section-title\">" + escapeHtml(title) + "</h4>" +
    "  <div class=\"monwuiwl-preview-field-list\">";
  
  for (var j = 0; j < visible.length; j++) {
    var field = visible[j];
    html += "" +
      "    <div class=\"monwuiwl-preview-field\">" +
      "      <div class=\"monwuiwl-preview-field-label\">" + escapeHtml(field.label) + "</div>" +
      "      <div class=\"monwuiwl-preview-field-value\">" + escapeHtml(field.value) + "</div>" +
      "    </div>";
  }
  html += "  </div></section>";
  return html;
}

function renderPreviewListSection(title, items) {
  var list = items || [];
  var visible = [];
  for (var i = 0; i < list.length; i++) if (list[i]) visible.push(list[i]);
  if (!visible.length) return "";

  var html = "" +
    "<section class=\"monwuiwl-preview-section\">" +
    "  <h4 class=\"monwuiwl-preview-section-title\">" + escapeHtml(title) + "</h4>" +
    "  <ul class=\"monwuiwl-preview-list\">";
  
  for (var j = 0; j < visible.length; j++) {
    html += "<li>" + escapeHtml(visible[j]) + "</li>";
  }
  html += "  </ul></section>";
  return html;
}

function renderPreviewTagSection(title, items) {
  var list = items || [];
  var visible = [];
  for (var i = 0; i < list.length; i++) if (list[i]) visible.push(list[i]);
  if (!visible.length) return "";

  var html = "" +
    "<section class=\"monwuiwl-preview-section\">" +
    "  <h4 class=\"monwuiwl-preview-section-title\">" + escapeHtml(title) + "</h4>" +
    "  <div class=\"monwuiwl-preview-tags\">";
  
  for (var j = 0; j < visible.length; j++) {
    html += "<span class=\"monwuiwl-preview-tag\">" + escapeHtml(visible[j]) + "</span>";
  }
  html += "  </div></section>";
  return html;
}

function renderPreviewStudioSection(title, studios) {
  var list = Array.isArray(studios) ? studios : [];
  var visible = [];
  for (var i = 0; i < list.length; i++) {
    if (text(list[i] && list[i].name)) visible.push(list[i]);
  }
  if (!visible.length) return "";

  var openTitle = L("watchlistPreviewStudioAdd", "Adicionar à coleção de estúdios");
  var html = "" +
    "<section class=\"monwuiwl-preview-section\">" +
    "  <h4 class=\"monwuiwl-preview-section-title\">" + escapeHtml(title) + "</h4>" +
    "  <div class=\"monwuiwl-preview-tags\">";
  
  for (var j = 0; j < visible.length; j++) {
    var studio = visible[j];
    var name = text(studio && studio.name);
    var studioId = text(studio && studio.id);

    if (!studioId) {
      html += "<span class=\"monwuiwl-preview-tag\">" + escapeHtml(name) + "</span>";
    } else {
      html += "" +
        "<button" +
        "  type=\"button\"" +
        "  class=\"monwuiwl-preview-tag monwuiwl-preview-tag-button\"" +
        "  data-monwuiwl-studio-id=\"" + escapeHtml(studioId) + "\"" +
        "  data-monwuiwl-studio-name=\"" + escapeHtml(name) + "\"" +
        "  title=\"" + escapeHtml(openTitle) + "\"" +
        "  aria-label=\"" + escapeHtml(name + " - " + openTitle) + "\"" +
        ">" + escapeHtml(name) + "</button>";
    }
  }
  html += "  </div></section>";
  return html;
}

function clearPreviewHoverTimer(root) {
  if (!root) return;
  clearTimeout(root.__previewHoverTimer);
  root.__previewHoverTimer = 0;
  root.__pendingPreviewItemId = "";
}

function cancelProgressiveWatchlistRender(root) {
  if (!root) return;
  root.__progressiveRenderToken = Number(root.__progressiveRenderToken || 0) + 1;
}

function renderPreviewPanel(view, details, options) {
  var opt = options || {};
  var loading = opt.loading === true;
  var collectionLoading = opt.collectionLoading === true;

  if (!view) return renderPreviewEmptyState();

  var baseItem = (view && view.item) || {};
  var previewPayload = getPreviewPayload(details);
  var item = previewPayload.details && typeof previewPayload.details === "object" ? previewPayload.details : {};
  var containerMode = getPreviewContainerMode((item && item.Id) ? item : baseItem);
  var hasContainerPreview = !!containerMode;
  var isCollection = containerMode === "collection";
  var collectionItems = normalizeCollectionPreviewItems(previewPayload.collectionItems || []);
  var childCount = Number((item && item.ChildCount) || (baseItem && (baseItem.childCount || baseItem.ChildCount)) || 0);
  var collectionTotal = Math.max(
    Number(previewPayload.collectionItemsTotal || 0),
    collectionItems.length,
    isCollection ? childCount : 0
  );
  var containerCountText = hasContainerPreview ? getContainerPreviewCountText(containerMode, collectionTotal) : "";
  var collectionYears = isCollection ? getCollectionYearRange(collectionItems) : "";
  var collectionWatched = hasContainerPreview ? getCollectionWatchedSummary(collectionItems, collectionTotal) : "";
  var collectionRating = hasContainerPreview ? getCollectionAverageRating(collectionItems) : "";
  var posterUrl = buildPosterUrl(item, { width: 360, height: 540 }) || (baseItem && baseItem.posterUrl) || "";
  var backdropUrl = buildBackdropUrl(item, { width: 1280, quality: 88 }) || (baseItem && baseItem.backdropUrl) || "";
  var itemType = text((item && item.Type) || (baseItem && baseItem.itemType), L("content", "Conteúdo"));
  var title = text((item && item.Name) || (baseItem && baseItem.name), L("untitled", "Sem título"));
  var parentLine = text((item && (item.SeriesName || item.Album)) || (baseItem && (baseItem.parentName || baseItem.albumArtist)) || "");
  
  var subtitleLine = "";
  if (hasContainerPreview) {
    var parts = [];
    if (parentLine) parts.push(parentLine);
    if (containerCountText) parts.push(containerCountText);
    if (isCollection && collectionYears) parts.push(collectionYears);
    subtitleLine = parts.join(" • ");
  } else {
    subtitleLine = parentLine;
  }

  var infoLine = getPreviewInfoLine(view);
  var overview = text(
    (item && item.Overview) || (baseItem && baseItem.overview),
    hasContainerPreview
      ? (
        isCollection
          ? L("watchlistPreviewCollectionOverview", "Você pode ver os títulos nesta coleção abaixo.")
          : (containerMode === "season"
            ? L("watchlistPreviewSeriesOverview", "Você pode ver as temporadas desta série abaixo.")
            : L("watchlistPreviewSeasonOverview", "Você pode ver os episódios desta temporada abaixo."))
      )
      : L("noDescription", "Sem descrição.")
  );
  var runtimeTicks = Number((item && item.RunTimeTicks) || (baseItem && baseItem.runtimeTicks) || 0);
  var playbackTicks = Number((item && item.UserData && item.UserData.PlaybackPositionTicks) || 0);
  var runtime = formatRuntime(runtimeTicks);
  var remaining = playbackTicks > 0 && runtimeTicks > playbackTicks
    ? formatRuntime(runtimeTicks - playbackTicks)
    : "";
  var finishTime = formatFinishTime(runtimeTicks, playbackTicks);
  var communityRating = formatCommunityRating((item && item.CommunityRating !== undefined ? item.CommunityRating : (baseItem && baseItem.communityRating)));
  var officialRating = text((item && item.OfficialRating) || (baseItem && baseItem.officialRating) || "");
  var productionYear = text((item && item.ProductionYear) || (baseItem && baseItem.productionYear) || "");
  var genres = uniqTextList((item && item.Genres) || (baseItem && baseItem.genres) || []).slice(0, 6);
  var studioEntries = getStudioEntries(item);
  var studios = [];
  for (var k = 0; k < studioEntries.length; k++) studios.push(studioEntries[k].name);
  
  var directors = isCollection ? [] : getPeopleNames(item, "Director", 4);
  var writers = isCollection ? [] : getPeopleNames(item, "Writer", 4);
  var actors = isCollection ? [] : getActorNames(item, 8);
  var artists = uniqTextList((item && item.Artists) || (baseItem && baseItem.artists) || []).slice(0, 8);
  var albumArtist = text((item && item.AlbumArtist) || (baseItem && baseItem.albumArtist) || "");
  var albumName = text(item && item.Album);
  var videoStream = isCollection ? null : getPrimaryVideoStream(item);
  var videoQuality = getVideoQualityLabel(videoStream);
  
  var audioTracks = [];
  if (!isCollection) {
    var aStreams = getMediaStreamsByType(item, "Audio");
    for (var l = 0; l < aStreams.length; l++) {
      var s = formatAudioStream(aStreams[l]);
      if (s) audioTracks.push(s);
    }
    audioTracks = audioTracks.slice(0, 4);
  }

  var subtitleTracks = [];
  if (!isCollection) {
    var subStreams = getMediaStreamsByType(item, "Subtitle");
    for (var m = 0; m < subStreams.length; m++) {
      var sub = formatSubtitleStream(subStreams[m]);
      if (sub) subtitleTracks.push(sub);
    }
    subtitleTracks = subtitleTracks.slice(0, 4);
  }

  var note = view && view.kind === "shared" ? text(view.note) : "";
  var progressPercent = runtimeTicks > 0 && playbackTicks > 0
    ? Math.max(0, Math.min(100, Math.round((playbackTicks / runtimeTicks) * 100)))
    : 0;

  var statsList = [];
  if (isCollection) {
    if (collectionTotal) statsList.push({ label: L("watchlistPreviewCollectionCount", "Item"), value: collectionTotal + " " + L("watchlistPreviewCollectionItemSuffix", "item") });
    if (collectionYears) statsList.push({ label: L("watchlistPreviewCollectionYears", "Intervalo de anos"), value: collectionYears });
    if (collectionWatched) statsList.push({ label: L("watchlistPreviewCollectionWatched", "Assistido"), value: collectionWatched });
    if (collectionRating) statsList.push({ label: L("watchlistPreviewCollectionRating", "Avaliação Média"), value: collectionRating });
  } else {
    if (hasContainerPreview) {
      statsList.push({
        label: containerMode === "season" ? L("watchlistPreviewSeasonCount", "Total de Temporadas") : L("watchlistPreviewEpisodeCount", "Total de Episódios"),
        value: containerCountText
      });
      if (collectionWatched) statsList.push({ label: L("watchlistPreviewCollectionWatched", "Assistido"), value: collectionWatched });
    }
    if (runtime) statsList.push({ label: L("sure", "Duração"), value: runtime });
    if (remaining) statsList.push({ label: L("watchlistPreviewRemaining", "Restante"), value: remaining });
    if (finishTime) statsList.push({ label: L("watchlistPreviewFinishAt", "Término"), value: finishTime });
    if (videoQuality || text((item && item.MediaType) || (baseItem && baseItem.mediaType))) {
      statsList.push({ label: L("watchlistPreviewVideoQuality", "Vídeo"), value: videoQuality || text((item && item.MediaType) || (baseItem && baseItem.mediaType)) });
    }
    if (directors.length) statsList.push({ label: L("yonetmen", "Diretor"), value: directors.join(", ") });
    if (studios.length || albumArtist || albumName) {
      statsList.push({ label: L("watchlistPreviewStudio", "Estúdio"), value: studios.join(", ") || albumArtist || albumName });
    }
  }

  var mediaFields = [];
  if (!isCollection) {
    if (videoQuality) mediaFields.push({ label: L("watchlistPreviewVideoTrack", "Vídeo"), value: videoQuality });
    if (audioTracks.length) mediaFields.push({ label: L("watchlistPreviewAudioCount", "Áudio"), value: audioTracks.length + " " + L("watchlistPreviewTrackSuffix", "faixa") });
    if (subtitleTracks.length) mediaFields.push({ label: L("watchlistPreviewSubtitleCount", "Legenda"), value: subtitleTracks.length + " " + L("watchlistPreviewTrackSuffix", "faixa") });
  }

  var creditFields = [];
  if (!isCollection) {
    if (directors.length) creditFields.push({ label: L("yonetmen", "Diretor"), value: directors.join(", ") });
    if (writers.length) creditFields.push({ label: L("watchlistPreviewWriter", "Escritor"), value: writers.join(", ") });
    if (actors.length) creditFields.push({ label: L("watchlistPreviewActors", "Atores"), value: actors.join(", ") });
    if (artists.length) creditFields.push({ label: L("watchlistPreviewArtists", "Artistas"), value: artists.join(", ") });
    if (albumName) creditFields.push({ label: L("watchlistPreviewAlbum", "Álbum"), value: albumName });
    if (albumArtist) creditFields.push({ label: L("watchlistPreviewAlbumArtist", "Artista do Álbum"), value: albumArtist });
  }

  var chips = [];
  var chipPool = isCollection ? [
    collectionTotal ? (collectionTotal + " " + L("watchlistPreviewCollectionItemSuffix", "itens")) : "",
    collectionYears,
    collectionRating,
    officialRating
  ] : [
    hasContainerPreview ? containerCountText : "",
    productionYear,
    hasContainerPreview ? collectionRating : "",
    communityRating,
    officialRating,
    videoQuality ? videoQuality.split(" • ").slice(0, 2).join(" • ") : ""
  ];
  for (var n = 0; n < chipPool.length; n++) {
    if (chipPool[n]) chips.push(chipPool[n]);
    if (chips.length >= 4) break;
  }

  var chipsHtml = "";
  for (var p = 0; p < chips.length; p++) {
    chipsHtml += "<span class=\"monwuiwl-preview-chip " + (p === 1 ? "accent" : "") + "\">" + escapeHtml(chips[p]) + "</span>";
  }

  return "" +
    "<div class=\"monwuiwl-preview-shell\">" +
    "  <div class=\"monwuiwl-preview-hero\">" +
    (backdropUrl ? "<img class=\"monwuiwl-preview-backdrop\" src=\"" + escapeHtml(backdropUrl) + "\" alt=\"\" loading=\"eager\" fetchpriority=\"high\" decoding=\"async\">" : "") +
    "    <div class=\"monwuiwl-preview-hero-inner\">" +
    "      <div class=\"monwuiwl-preview-poster\">" +
    (posterUrl
      ? "<img src=\"" + escapeHtml(posterUrl) + "\" alt=\"" + escapeHtml(title) + "\" loading=\"eager\" fetchpriority=\"high\" decoding=\"async\">"
      : "<div class=\"monwuiwl-preview-poster-fallback\">" + escapeHtml(itemType) + "</div>") +
    "      </div>" +
    "      <div class=\"monwuiwl-preview-head\">" +
    "        <div class=\"monwuiwl-preview-kicker\">" + escapeHtml(itemType) + "</div>" +
    "        <h3 class=\"monwuiwl-preview-title\">" + escapeHtml(title) + "</h3>" +
    (subtitleLine ? "<div class=\"monwuiwl-preview-subtitle\">" + escapeHtml(subtitleLine) + "</div>" : "") +
    (infoLine ? "<div class=\"monwuiwl-preview-subtitle\">" + escapeHtml(infoLine) + "</div>" : "") +
    (chipsHtml ? "<div class=\"monwuiwl-preview-chips\">" + chipsHtml + "</div>" : "") +
    (progressPercent > 0 ? "" +
    "        <div class=\"monwuiwl-preview-progress\">" +
    "          <div class=\"monwuiwl-preview-progress-track\">" +
    "            <div class=\"monwuiwl-preview-progress-bar\" style=\"width:" + Math.max(0, Math.min(100, progressPercent)) + "%\"></div>" +
    "          </div>" +
    "          <div class=\"monwuiwl-preview-progress-copy\">" +
    escapeHtml(progressPercent + "% " + L("watchlistPreviewWatched", "assistido") + (remaining ? " • " + remaining + " " + L("watchlistPreviewLeft", "restante") : "")) +
    "          </div>" +
    "        </div>" : "") +
    "      </div>" +
    "    </div>" +
    "  </div>" +
    "  <div class=\"monwuiwl-preview-body\">" +
    (loading ? "<div class=\"monwuiwl-preview-loading\">" + escapeHtml(L("watchlistPreviewLoading", "Carregando detalhes")) + "</div>" : "") +
    (note ? "<p class=\"monwuiwl-preview-note\"><strong>" + escapeHtml(L("watchlistShareNote", "Not")) + ":</strong> " + escapeHtml(note) + "</p>" : "") +
    "    <p class=\"monwuiwl-preview-overview\">" + escapeHtml(overview) + "</p>" +
    (hasContainerPreview ? renderCollectionPreviewSection(collectionItems, collectionTotal, { loading: collectionLoading, mode: containerMode }) : "") +
    renderPreviewStats(statsList) +
    renderPreviewFieldSection(L("watchlistPreviewMediaSection", "Resumo de Mídia"), mediaFields) +
    renderPreviewListSection(L("watchlistPreviewAudioTracks", "Faixas de Áudio"), audioTracks) +
    renderPreviewListSection(L("watchlistPreviewSubtitleTracks", "Legendas"), subtitleTracks) +
    renderPreviewFieldSection(L("watchlistPreviewCredits", "Créditos"), creditFields) +
    renderPreviewTagSection(L("genre", "Gênero"), genres) +
    renderPreviewStudioSection(L("watchlistPreviewStudios", "Estúdios"), studioEntries) +
    "  </div>" +
    "</div>";
}

function getInitialPreviewItemId(root) {
  var state = (root && root.__state) || {};
  var model = (root && root.__model) || {};
  var currentTab = normalizeWatchlistTabKey(state && state.activeTab);
  var tabViews = getWatchlistTabViews(model, currentTab);
  var preferredId = text((state && (state.previewItemId || state.focusItemId)) || "");

  if (preferredId) {
    for (var i = 0; i < tabViews.length; i++) {
      if (text(tabViews[i] && tabViews[i].itemId) === preferredId) return preferredId;
    }
  }

  return text(tabViews[0] && tabViews[0].itemId);
}

function setPreviewActiveCard(root, itemId) {
  var previousCard = root && root.__previewActiveCard;
  if (previousCard && previousCard.classList && previousCard.classList.contains("is-preview-active")) {
    previousCard.classList.remove("is-preview-active");
  }
  if (root) root.__previewActiveCard = null;

  var id = text(itemId);
  if (!id) return;

  var nextCard = root.querySelector("[data-monwuiwl-item=\"" + escapeAttrSelector(id) + "\"]");
  if (nextCard && nextCard.classList) {
    nextCard.classList.add("is-preview-active");
  }
  if (root) root.__previewActiveCard = nextCard || null;
}

function samePreviewAssetUrl(a, b) {
  var left = text(a);
  var right = text(b);
  return !!left && left === right;
}

function applyPreviewPanelMarkup(panel, markup, options) {
  var opt = options || {};
  var preserveMedia = opt.preserveMedia === true;
  if (!panel) return;
  if (panel.__previewMarkup === markup) return;

  if (!preserveMedia) {
    panel.innerHTML = markup;
    panel.__previewMarkup = markup;
    return;
  }

  var currentShell = panel.querySelector(".monwuiwl-preview-shell");
  if (!currentShell) {
    panel.innerHTML = markup;
    panel.__previewMarkup = markup;
    return;
  }

  var template = document.createElement("div");
  template.innerHTML = markup.trim();
  var nextShell = template.querySelector(".monwuiwl-preview-shell");
  if (!nextShell) {
    panel.innerHTML = markup;
    panel.__previewMarkup = markup;
    return;
  }

  var currentBackdrop = currentShell.querySelector(".monwuiwl-preview-backdrop");
  var nextBackdrop = nextShell.querySelector(".monwuiwl-preview-backdrop");
  if (currentBackdrop && nextBackdrop && samePreviewAssetUrl(currentBackdrop.getAttribute("src"), nextBackdrop.getAttribute("src"))) {
    nextBackdrop.parentNode.replaceChild(currentBackdrop, nextBackdrop);
  }

  var currentPoster = currentShell.querySelector(".monwuiwl-preview-poster img");
  var nextPoster = nextShell.querySelector(".monwuiwl-preview-poster img");
  if (currentPoster && nextPoster && samePreviewAssetUrl(currentPoster.getAttribute("src"), nextPoster.getAttribute("src"))) {
    currentPoster.alt = nextPoster.getAttribute("alt") || currentPoster.alt || "";
    nextPoster.parentNode.replaceChild(currentPoster, nextPoster);
  }

  while (panel.firstChild) panel.removeChild(panel.firstChild);
  panel.appendChild(nextShell);
  panel.__previewMarkup = markup;
}

function startWatchlistPlayback(triggerEl, itemId) {
  var id = text(itemId);
  if (!id) return Promise.resolve(false);

  if (triggerEl) triggerEl.disabled = true;

  return Promise.resolve()
    .then(function() {
      return closeDetailsModalIfLoaded()["catch"](function() {});
    })
    .then(function() {
      return closeWatchlistModal();
    })
    .then(function() {
      return playNow(id);
    })
    .then(function(started) {
      if (!started) {
        if (getLastPlayNowBlockReason() === "parental-pin") {
          return false;
        }
        throw new Error(L("playStartFailed", "Falha ao iniciar reprodução"));
      }
      return true;
    })
    ["catch"](function(error) {
      if (typeof window.showMessage === "function") {
        window.showMessage(error && error.message || L("playStartFailed", "Falha ao iniciar reprodução"), "error");
      }
      return false;
    })
    ["finally"](function() {
      if (triggerEl) triggerEl.disabled = false;
    });
}

function buildCollectionAutoRemoveTaskKey(view) {
  if (!view) return "";
  if (view.kind === "shared" && view.shareId) return "shared:" + text(view.shareId);
  return "own:" + text(view.itemId);
}

function getAutoRemoveTasksForView(view) {
  if (!view) return [];
  if (view.kind === "shared" && view.shareId) {
    return [{ kind: "shared", itemId: text(view.itemId), shareId: text(view.shareId) }];
  }
  if (view.itemId) {
    return [{ kind: "own", itemId: text(view.itemId) }];
  }
  return [];
}

function autoRemoveContainerViewIfNeeded(root, view, previewData) {
  if (!shouldAutoRemovePlayedFromWatchlist()) return Promise.resolve(false);
  if (!isContainerPreviewView(view, previewData)) return Promise.resolve(false);

  var payload = getPreviewPayload(previewData);
  var mode = getPreviewContainerMode((payload && payload.details) || (view && view.item) || {});
  if (mode && mode !== "collection" && text(payload && payload.collectionItemsSource) !== "live") return Promise.resolve(false);
  var total = getExpectedContainerPreviewTotal(view, payload);
  var items = normalizeCollectionPreviewItems((payload && payload.collectionItems) || []);
  if (!total || items.length < total) return Promise.resolve(false);

  var watchedCount = getCollectionWatchedCount(items);
  if (watchedCount < total) return Promise.resolve(false);

  var autoRemoveKey = buildCollectionAutoRemoveTaskKey(view);
  if (!autoRemoveKey || collectionAutoRemovePending[autoRemoveKey]) return Promise.resolve(false);

  var tasks = getAutoRemoveTasksForView(view);
  if (!tasks.length) return Promise.resolve(false);

  collectionAutoRemovePending[autoRemoveKey] = true;
  return processAutoRemovalTasks(tasks)
    .then(function() {
      var currentPreviewItemId = text(root && root.__state && root.__state.previewItemId);
      if (root && root.isConnected && currentPreviewItemId === text(view && view.itemId)) {
        var newState = {};
        var oldState = (root && root.__state) || {};
        var keys = Object.keys(oldState);
        for (var i = 0; i < keys.length; i++) {
          newState[keys[i]] = oldState[keys[i]];
        }
        newState.previewItemId = "";
        newState.focusItemId = "";
        root.__state = newState;
        return renderWatchlistModal(root, newState);
      }
      return true;
    })
    ["catch"](function() {
      return false;
    })
    ["finally"](function() {
      delete collectionAutoRemovePending[autoRemoveKey];
    });
}

function updatePreviewPanel(root, itemId) {
  var panel = root && root.querySelector && root.querySelector(".monwuiwl-preview");
  var currentTab = normalizeWatchlistTabKey(root && root.__state && root.__state.activeTab);
  var view = findViewByItemId((root && root.__model) || {}, itemId, currentTab);
  var normalizedId = text(itemId);
  var previousPreviewItemId = text(root && root.__state && root.__state.previewItemId);
  var switchedItem = previousPreviewItemId !== normalizedId;

  if (!panel || !view || !normalizedId) {
    if (panel) {
      panel.scrollTop = 0;
      applyPreviewPanelMarkup(panel, renderPreviewEmptyState());
    }
    if (root && text(root.__previewLoadingItemId) === normalizedId) root.__previewLoadingItemId = "";
    setPreviewActiveCard(root, "");
    return Promise.resolve();
  }

  var newState = {};
  var oldState = (root && root.__state) || {};
  var keys = Object.keys(oldState);
  for (var i = 0; i < keys.length; i++) {
    newState[keys[i]] = oldState[keys[i]];
  }
  newState.previewItemId = normalizedId;
  root.__state = newState;
  setPreviewActiveCard(root, normalizedId);

  if (switchedItem) {
    panel.scrollTop = 0;
  }

  var cached = watchlistPreviewCache.get(normalizedId) || null;

  return Promise.resolve()
    .then(function() {
      if (isContainerPreviewView(view, cached)) {
        return seedContainerPreviewPayload(normalizedId, cached).then(function(newCached) {
          cached = newCached;
          if (cached.collectionItemsLoaded || cached.collectionItems.length) {
            watchlistPreviewCache.set(normalizedId, cached);
          }
        });
      }
    })
    .then(function() {
      var needsDetails = !hasPreviewDetails(cached);
      var needsCollection = shouldFetchContainerPreview(view, cached);
      var hideIncompleteCollectionCache = isContainerPreviewIncomplete(view, cached);

      var renderPayload;
      if (hideIncompleteCollectionCache) {
        var basePayload = getPreviewPayload(cached);
        renderPayload = createPreviewPayload({
          details: basePayload.details,
          collectionItems: [],
          collectionItemsTotal: basePayload.collectionItemsTotal,
          collectionItemsLoaded: false,
          collectionItemsStale: basePayload.collectionItemsStale,
          collectionItemsUpdatedAt: basePayload.collectionItemsUpdatedAt,
          collectionItemsSource: basePayload.collectionItemsSource
        });
      } else {
        renderPayload = cached;
      }

      var loadingMarkup = renderPreviewPanel(view, renderPayload, {
        loading: needsDetails,
        collectionLoading: needsCollection && !hasContainerPreviewItems(renderPayload)
      });
      applyPreviewPanelMarkup(panel, loadingMarkup, {
        preserveMedia: !switchedItem && !isContainerPreviewView(view, renderPayload)
      });

      if (!needsDetails && !needsCollection) {
        if (text(root.__previewLoadingItemId) === normalizedId) root.__previewLoadingItemId = "";
        return;
      }

      var requestInFlightForSameItem =
        text(root.__previewLoadingItemId) === normalizedId &&
        !!root.__previewAbortController &&
        (root.__previewAbortController.signal && root.__previewAbortController.signal.aborted !== true);
      if (requestInFlightForSameItem) return;

      if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
        try {
          root.__previewAbortController.abort();
        } catch (e) {}
      }

      var controller = new AbortController();
      var requestId = Number(root.__previewRequestId || 0) + 1;
      root.__previewAbortController = controller;
      root.__previewRequestId = requestId;
      root.__previewLoadingItemId = normalizedId;

      var cachedPayload = getPreviewPayload(cached);

      var p1 = needsDetails
        ? fetchItemDetailsFull(normalizedId, { signal: controller.signal })["catch"](function() { return null; })
        : Promise.resolve(cachedPayload.details);

      var p2 = needsCollection
        ? Promise.resolve().then(function() {
            return fetchContainerPreviewItems(
              {
                Id: normalizedId,
                Type: text((cachedPayload.details && cachedPayload.details.Type) || (view && view.item && view.item.itemType)),
              },
              { signal: controller.signal }
            ).then(function(liveItems) {
              if (!Array.isArray(liveItems)) {
                return getCachedCollectionPreview(normalizedId).then(function(fallback) {
                  return {
                    items: fallback.items,
                    total: fallback.total,
                    loaded: true,
                    stale: fallback.stale,
                    updatedAt: fallback.updatedAt,
                    source: fallback.hasCache ? "db" : "",
                  };
                });
              }

              var minimized = minimizeCollectionPreviewItems(liveItems);
              return CollectionCacheDB.setBoxsetItems(normalizedId, minimized)
                ["catch"](function() {})
                .then(function() {
                  var normalizedItems = normalizeCollectionPreviewItems(liveItems);
                  return {
                    items: normalizedItems,
                    total: normalizedItems.length,
                    loaded: true,
                    stale: false,
                    updatedAt: Date.now(),
                    source: "live",
                  };
                });
            })["catch"](function() { return null; });
          })
        : Promise.resolve({
            items: cachedPayload.collectionItems,
            total: cachedPayload.collectionItemsTotal,
            loaded: cachedPayload.collectionItemsLoaded,
            stale: cachedPayload.collectionItemsStale,
            updatedAt: cachedPayload.collectionItemsUpdatedAt,
            source: cachedPayload.collectionItemsSource,
          });

      return Promise.all([p1, p2]).then(function(results) {
        var details = results[0];
        var collectionResult = results[1];

        if (controller.signal.aborted || root.__previewRequestId !== requestId) {
          if (root.__previewRequestId === requestId && text(root.__previewLoadingItemId) === normalizedId) {
            root.__previewLoadingItemId = "";
          }
          return;
        }

        var nextPayload = createPreviewPayload({
          details: (details && details.Id) ? details : cachedPayload.details,
          collectionItems: (collectionResult && Array.isArray(collectionResult.items)) ? collectionResult.items : cachedPayload.collectionItems,
          collectionItemsTotal: Number((collectionResult && collectionResult.total) || cachedPayload.collectionItemsTotal || 0),
          collectionItemsLoaded: (collectionResult && collectionResult.loaded === true) || cachedPayload.collectionItemsLoaded,
          collectionItemsStale: collectionResult && collectionResult.stale === true,
          collectionItemsUpdatedAt: Number((collectionResult && collectionResult.updatedAt) || cachedPayload.collectionItemsUpdatedAt || 0),
          collectionItemsSource: text((collectionResult && collectionResult.source) || cachedPayload.collectionItemsSource),
        });

        if ((nextPayload.details && nextPayload.details.Id) || nextPayload.collectionItemsLoaded || nextPayload.collectionItems.length) {
          watchlistPreviewCache.set(normalizedId, nextPayload);
        }

        var freshPanel = root && typeof root.querySelector === "function" ? root.querySelector(".monwuiwl-preview") : null;
        var freshState = (root && root.__state) || {};
        var freshView = findViewByItemId((root && root.__model) || {}, normalizedId, normalizeWatchlistTabKey(freshState.activeTab));
        if (!freshPanel || !freshView) return;

        if (switchedItem) {
          freshPanel.scrollTop = 0;
        }
        var loadedMarkup = renderPreviewPanel(freshView, nextPayload, {
          loading: !(nextPayload.details && nextPayload.details.Id),
          collectionLoading: false
        });
        applyPreviewPanelMarkup(freshPanel, loadedMarkup, {
          preserveMedia: !isContainerPreviewView(freshView, nextPayload)
        });
        if (text(root.__previewLoadingItemId) === normalizedId) root.__previewLoadingItemId = "";
        return autoRemoveContainerViewIfNeeded(root, freshView, nextPayload)["catch"](function() { return false; });
      });
    });
}

function queuePreviewPanelUpdate(root, itemId, options) {
  if (!root) return;
  options = options || {};
  var immediate = options.immediate === true;
  clearPreviewHoverTimer(root);

  var id = text(itemId);
  if (!id) {
    var panel = root.querySelector(".monwuiwl-preview");
    if (panel) panel.innerHTML = renderPreviewEmptyState();
    setPreviewActiveCard(root, "");
    return;
  }

  root.__pendingPreviewItemId = id;
  var currentPreviewItemId = text(root.__state && root.__state.previewItemId);
  var delay = immediate
    ? 0
    : (currentPreviewItemId && currentPreviewItemId !== id
      ? WATCHLIST_PREVIEW_SWITCH_DELAY_MS
      : WATCHLIST_PREVIEW_HOVER_DELAY_MS);

  var run = function() {
    if (text(root.__pendingPreviewItemId) !== id) return;
    root.__pendingPreviewItemId = "";
    updatePreviewPanel(root, id)["catch"](function() {});
  };

  if (delay <= 0) {
    run();
    return;
  }

  root.__previewHoverTimer = setTimeout(run, delay);
}

function mergeLiveItem(entry, live) {
  var base = entry && typeof entry === "object" ? entry : {};
  var item = live && typeof live === "object" ? live : {};
  var type = text((item && item.Type) || (base && base.ItemType));

  return {
    itemId: text((item && item.Id) || (base && base.ItemId)),
    itemType: type,
    mediaType: text((item && item.MediaType) || (base && base.MediaType)),
    name: text((item && item.Name) || (base && base.Name), L("untitled", "Sem título")),
    overview: text((item && item.Overview) || (base && base.Overview), L("noDescription", "Sem descrição.")),
    productionYear: (item && item.ProductionYear !== undefined) ? item.ProductionYear : ((base && base.ProductionYear !== undefined) ? base.ProductionYear : ""),
    runtimeTicks: (item && (item.RunTimeTicks || item.CumulativeRunTimeTicks)) || (base && (base.RunTimeTicks || base.CumulativeRunTimeTicks)) || 0,
    communityRating: (item && item.CommunityRating !== undefined) ? item.CommunityRating : ((base && base.CommunityRating !== undefined) ? base.CommunityRating : null),
    officialRating: text((item && item.OfficialRating) || (base && base.OfficialRating)),
    genres: (item && Array.isArray(item.Genres) && item.Genres.length) ? item.Genres : (base && Array.isArray(base.Genres) ? base.Genres : []),
    albumArtist: text((item && item.AlbumArtist) || (base && base.AlbumArtist)),
    artists: (item && Array.isArray(item.Artists) && item.Artists.length) ? item.Artists : (base && Array.isArray(base.Artists) ? base.Artists : []),
    parentName: text((item && (item.SeriesName || item.Album)) || (base && base.ParentName)),
    childCount: (item && item.ChildCount !== undefined) ? item.ChildCount : ((base && base.ChildCount !== undefined) ? base.ChildCount : 0),
    ChildCount: (item && item.ChildCount !== undefined) ? item.ChildCount : ((base && base.ChildCount !== undefined) ? base.ChildCount : 0),
    SeriesId: text((item && item.SeriesId) || (base && base.SeriesId)),
    SeasonId: text((item && item.SeasonId) || (base && base.SeasonId)),
    IndexNumber: (item && item.IndexNumber !== undefined) ? item.IndexNumber : ((base && base.IndexNumber !== undefined) ? base.IndexNumber : null),
    ParentIndexNumber: (item && item.ParentIndexNumber !== undefined) ? item.ParentIndexNumber : ((base && base.ParentIndexNumber !== undefined) ? base.ParentIndexNumber : null),
    UserData: (item && item.UserData && typeof item.UserData === "object")
      ? item.UserData
      : ((base && base.UserData && typeof base.UserData === "object") ? base.UserData : null),
    posterUrl: buildPosterUrl(item, { width: 360, height: 540, quality: 90 }),
    backdropUrl: buildBackdropUrl(item, { width: 1280, quality: 88 }),
    liveItem: (item && item.Id) ? item : null,
  };
}

function buildViewModel(dashboard) {
  var myItems = (dashboard && dashboard.myItems) || [];
  var sharedWithMe = (dashboard && dashboard.sharedWithMe) || [];

  var uniqueIds = [];
  var idMap = {};

  for (var i = 0; i < myItems.length; i++) {
    var id = text(myItems[i] && (myItems[i].ItemId || myItems[i].itemId));
    if (id && !idMap[id]) {
      uniqueIds.push(id);
      idMap[id] = true;
    }
  }
  for (var j = 0; j < sharedWithMe.length; j++) {
    var shared = sharedWithMe[j];
    var entry = (shared && (shared.Entry || shared.entry)) || shared;
    var id2 = text(shared && (shared.ItemId || shared.itemId || (entry && (entry.ItemId || entry.itemId))));
    if (id2 && !idMap[id2]) {
      uniqueIds.push(id2);
      idMap[id2] = true;
    }
  }

  return fetchItemsBulk(uniqueIds, WATCHLIST_VIEW_FIELDS)
    ["catch"](function() { return { found: null }; })
    .then(function(bulk) {
      var found = (bulk && bulk.found) || null;
      var outgoingShares = (dashboard && dashboard.outgoingShares) || [];
      var outgoingByItemId = {};

      for (var k = 0; k < outgoingShares.length; k++) {
        var share = outgoingShares[k];
        var entry2 = (share && (share.Entry || share.entry)) || {};
        var shareItemId = text(share && (share.ItemId || share.itemId || (entry2 && (entry2.ItemId || entry2.itemId))));
        if (!shareItemId) continue;
        if (!outgoingByItemId[shareItemId]) outgoingByItemId[shareItemId] = [];
        outgoingByItemId[shareItemId].push(share);
      }

      var model = createEmptyWatchlistModel();
      var autoRemovalTasks = [];

      var autoRemoveEnabled = shouldAutoRemovePlayedFromWatchlist();

      return Promise.resolve()
        .then(function() {
          if (autoRemoveEnabled) {
            return getCompletedSeriesSeasonWatchlistItemIds(dashboard, found)["catch"](function() { return []; });
          }
          return [];
        })
        .then(function(completedIdsArray) {
          var completedSeriesSeasonIds = {};
          if (Array.isArray(completedIdsArray)) {
            for (var m = 0; m < completedIdsArray.length; m++) {
              completedSeriesSeasonIds[completedIdsArray[m]] = true;
            }
          }

          for (var n = 0; n < myItems.length; n++) {
            var entryOwn = myItems[n];
            var itemIdOwn = text(entryOwn && (entryOwn.ItemId || entryOwn.itemId));
            if (!itemIdOwn) continue;
            var live = (found && typeof found.get === "function") ? found.get(itemIdOwn) : (found ? found[itemIdOwn] : null);
            var merged = mergeLiveItem(entryOwn, live);
            var addedAtUtc = Number(entryOwn.AddedAtUtc || entryOwn.addedAtUtc || 0);

            if (autoRemoveEnabled && wasPlayedAfterWatchlistTimestamp(merged.liveItem || live, addedAtUtc)) {
              autoRemovalTasks.push({ kind: "own", itemId: itemIdOwn });
              continue;
            }
            if (completedSeriesSeasonIds[itemIdOwn]) {
              autoRemovalTasks.push({ kind: "own", itemId: itemIdOwn });
              continue;
            }

            var tab = getWatchlistTabKey({ Type: merged.itemType, MediaType: merged.mediaType });
            if (model[tab]) {
              model[tab].own.push({
                kind: "own",
                key: "own:" + itemIdOwn,
                itemId: itemIdOwn,
                entryId: text(entryOwn.Id || entryOwn.id),
                addedAtUtc: addedAtUtc,
                outgoingShares: outgoingByItemId[itemIdOwn] || [],
                item: merged
              });
            }
          }

          for (var p = 0; p < sharedWithMe.length; p++) {
            var sharedEntry = sharedWithMe[p];
            var shareId = text(sharedEntry.Id || sharedEntry.id);
            var entryInner = sharedEntry.Entry || sharedEntry.entry || {};
            var itemIdShared = text(sharedEntry.ItemId || sharedEntry.itemId || entryInner.ItemId || entryInner.itemId);
            if (!itemIdShared || !shareId) continue;
            var liveShared = (found && typeof found.get === "function") ? found.get(itemIdShared) : (found ? found[itemIdShared] : null);
            var mergedShared = mergeLiveItem(entryInner, liveShared);
            var sharedAtUtc = Number(sharedEntry.SharedAtUtc || sharedEntry.sharedAtUtc || 0);

            if (autoRemoveEnabled && wasPlayedAfterWatchlistTimestamp(mergedShared.liveItem || liveShared, sharedAtUtc)) {
              autoRemovalTasks.push({ kind: "shared", itemId: itemIdShared, shareId: shareId });
              continue;
            }
            if (completedSeriesSeasonIds[itemIdShared]) {
              autoRemovalTasks.push({ kind: "shared", itemId: itemIdShared, shareId: shareId });
              continue;
            }

            var tabShared = getWatchlistTabKey({ Type: mergedShared.itemType, MediaType: mergedShared.mediaType });
            if (model[tabShared]) {
              model[tabShared].shared.push({
                kind: "shared",
                key: "shared:" + shareId,
                shareId: shareId,
                itemId: itemIdShared,
                ownerUserName: text(sharedEntry.OwnerUserName || sharedEntry.ownerUserName, L("unknownUser", "Usuário desconhecido")),
                note: text(sharedEntry.Note || sharedEntry.note),
                sharedAtUtc: sharedAtUtc,
                item: mergedShared
              });
            }
          }

          queueAutoRemoveWatchedEntries(autoRemovalTasks);
          return model;
        });
    });
}

function createOutgoingSharesByItemId(shares) {
  var list = Array.isArray(shares) ? shares : [];
  var map = {};

  for (var i = 0; i < list.length; i++) {
    var share = list[i];
    var entry = (share && (share.Entry || share.entry)) || {};
    var itemId = text(share && (share.ItemId || share.itemId || (entry && (entry.ItemId || entry.itemId))));
    if (!itemId) continue;
    if (!map[itemId]) map[itemId] = [];
    map[itemId].push(share);
  }

  return map;
}

function buildPartialWatchlistItemModel(itemId, dashboard) {
  var id = text(itemId);
  var dash = dashboard || dashboardCache;
  var model = createEmptyWatchlistModel();
  if (!id || !dash) return Promise.resolve(model);

  var ownEntries = [];
  var myItems = (dash && dash.myItems) || [];
  for (var i = 0; i < myItems.length; i++) {
    if (text(myItems[i] && (myItems[i].ItemId || myItems[i].itemId)) === id) {
      ownEntries.push(myItems[i]);
    }
  }

  var sharedEntries = [];
  var sharedWithMe = (dash && dash.sharedWithMe) || [];
  for (var j = 0; j < sharedWithMe.length; j++) {
    var shared = sharedWithMe[j];
    var entry = (shared && (shared.Entry || shared.entry || shared)) || {};
    if (text(shared && (shared.ItemId || shared.itemId || (entry && (entry.ItemId || entry.itemId)))) === id) {
      sharedEntries.push(shared);
    }
  }

  if (!ownEntries.length && !sharedEntries.length) {
    return Promise.resolve(model);
  }

  return fetchItemsBulk([id], WATCHLIST_VIEW_FIELDS)
    ["catch"](function() { return { found: null }; })
    .then(function(bulk) {
      var found = (bulk && bulk.found) || null;
      var live = (found && typeof found.get === "function") ? found.get(id) : (found ? found[id] : null);
      var outgoingByItemId = createOutgoingSharesByItemId((dash && dash.outgoingShares) || []);

      for (var k = 0; k < ownEntries.length; k++) {
        var entryOwn = ownEntries[k];
        var merged = mergeLiveItem(entryOwn, live);
        var tab = getWatchlistTabKey({ Type: merged.itemType, MediaType: merged.mediaType });
        if (model[tab]) {
          model[tab].own.push({
            kind: "own",
            key: "own:" + id,
            itemId: id,
            entryId: text(entryOwn.Id || entryOwn.id),
            addedAtUtc: Number(entryOwn.AddedAtUtc || entryOwn.addedAtUtc || 0),
            outgoingShares: outgoingByItemId[id] || [],
            item: merged
          });
        }
      }

      for (var m = 0; m < sharedEntries.length; m++) {
        var sharedEntry = sharedEntries[m];
        var shareId = text(sharedEntry.Id || sharedEntry.id);
        if (!shareId) continue;

        var entryInner = sharedEntry.Entry || sharedEntry.entry || {};
        var mergedShared = mergeLiveItem(entryInner, live);
        var tabShared = getWatchlistTabKey({ Type: mergedShared.itemType, MediaType: mergedShared.mediaType });
        if (model[tabShared]) {
          model[tabShared].shared.push({
            kind: "shared",
            key: "shared:" + shareId,
            shareId: shareId,
            itemId: id,
            ownerUserName: text(sharedEntry.OwnerUserName || sharedEntry.ownerUserName, L("unknownUser", "Usuário desconhecido")),
            note: text(sharedEntry.Note || sharedEntry.note),
            sharedAtUtc: Number(sharedEntry.SharedAtUtc || sharedEntry.sharedAtUtc || 0),
            item: mergedShared
          });
        }
      }

      return model;
    });
}

function mergePartialWatchlistItemModel(model, partialModel, detail) {
  var id = text(detail && detail.itemId);
  var isItemAdd = !!id && (detail && detail.inWatchlist === true);
  var isShareAdd = !!id && (detail && detail.shared === true);

  if (!model || !id || (!isItemAdd && !isShareAdd)) {
    return { applied: false };
  }

  var affectedTabs = {};
  var ownInsertions = {};
  var sharedInsertions = {};
  var hasAffected = false;

  var ownPlacement = null;
  for (var i = 0; i < WATCHLIST_TABS.length; i++) {
    var tabKey = WATCHLIST_TABS[i].key;
    var bucket = model[tabKey];
    if (!bucket) continue;

    var existingIndex = -1;
    for (var j = 0; j < bucket.own.length; j++) {
      if (text(bucket.own[j] && bucket.own[j].itemId) === id) {
        existingIndex = j;
        break;
      }
    }

    if (existingIndex >= 0 && !ownPlacement) {
      ownPlacement = { tabKey: tabKey, index: existingIndex };
    }

    var nextOwn = [];
    for (var k = 0; k < bucket.own.length; k++) {
      if (text(bucket.own[k] && bucket.own[k].itemId) !== id) {
        nextOwn.push(bucket.own[k]);
      }
    }

    if (nextOwn.length !== bucket.own.length) {
      bucket.own = nextOwn;
      affectedTabs[tabKey] = true;
      hasAffected = true;
    }
  }

  for (var m = 0; m < WATCHLIST_TABS.length; m++) {
    var tabKey2 = WATCHLIST_TABS[m].key;
    var partialBucket = partialModel && partialModel[tabKey2];
    var partialOwn = (partialBucket && partialBucket.own) || [];
    var nextOwnViews = [];
    for (var n = 0; n < partialOwn.length; n++) {
      if (text(partialOwn[n] && partialOwn[n].itemId) === id) {
        nextOwnViews.push(partialOwn[n]);
      }
    }

    if (!nextOwnViews.length) continue;

    var bucket2 = model[tabKey2];
    if (!bucket2) continue;

    var insertAt = isItemAdd
      ? 0
      : ((ownPlacement && ownPlacement.tabKey === tabKey2)
        ? Math.min(Number(ownPlacement.index || 0), bucket2.own.length)
        : 0);

    for (var p = 0; p < nextOwnViews.length; p++) {
      bucket2.own.splice(insertAt + p, 0, nextOwnViews[p]);
      ownInsertions[text(nextOwnViews[p] && nextOwnViews[p].key)] = true;
    }
    affectedTabs[tabKey2] = true;
    hasAffected = true;
  }

  if (isShareAdd) {
    var sharedPlacementByTab = {};

    for (var q = 0; q < WATCHLIST_TABS.length; q++) {
      var tabKey3 = WATCHLIST_TABS[q].key;
      var bucket3 = model[tabKey3];
      if (!bucket3) continue;

      var existingIndexShared = -1;
      for (var r = 0; r < bucket3.shared.length; r++) {
        if (text(bucket3.shared[r] && bucket3.shared[r].itemId) === id) {
          existingIndexShared = r;
          break;
        }
      }

      if (existingIndexShared >= 0) {
        sharedPlacementByTab[tabKey3] = existingIndexShared;
      }

      var nextShared = [];
      for (var s = 0; s < bucket3.shared.length; s++) {
        if (text(bucket3.shared[s] && bucket3.shared[s].itemId) !== id) {
          nextShared.push(bucket3.shared[s]);
        }
      }

      if (nextShared.length !== bucket3.shared.length) {
        bucket3.shared = nextShared;
        affectedTabs[tabKey3] = true;
        hasAffected = true;
      }
    }

    for (var t = 0; t < WATCHLIST_TABS.length; t++) {
      var tabKey4 = WATCHLIST_TABS[t].key;
      var partialBucketShared = partialModel && partialModel[tabKey4];
      var partialShared = (partialBucketShared && partialBucketShared.shared) || [];
      var nextSharedViews = [];
      for (var u = 0; u < partialShared.length; u++) {
        if (text(partialShared[u] && partialShared[u].itemId) === id) {
          nextSharedViews.push(partialShared[u]);
        }
      }

      if (!nextSharedViews.length) continue;

      var bucket4 = model[tabKey4];
      if (!bucket4) continue;

      var insertAtShared = (sharedPlacementByTab[tabKey4] !== undefined)
        ? Math.min(Number(sharedPlacementByTab[tabKey4] || 0), bucket4.shared.length)
        : 0;

      for (var v = 0; v < nextSharedViews.length; v++) {
        bucket4.shared.splice(insertAtShared + v, 0, nextSharedViews[v]);
        sharedInsertions[text(nextSharedViews[v] && nextSharedViews[v].key)] = true;
      }
      affectedTabs[tabKey4] = true;
      hasAffected = true;
    }
  }

  return {
    applied: hasAffected || Object.keys(ownInsertions).length > 0 || Object.keys(sharedInsertions).length > 0,
    affectedTabs: affectedTabs,
    ownInsertions: ownInsertions,
    sharedInsertions: sharedInsertions,
    itemId: id,
    isItemAdd: isItemAdd,
    isShareAdd: isShareAdd
  };
}

function renderShareSummary(outgoingShares) {
  var list = outgoingShares || [];
  if (!Array.isArray(list) || !list.length) return "";
  var names = [];
  for (var i = 0; i < list.length; i++) {
    var n = text(list[i] && (list[i].TargetUserName || list[i].targetUserName));
    if (n) names.push(n);
  }

  if (!names.length) return "";

  return "<div class=\"monwuiwl-item-sharemeta\">" + escapeHtml(L("watchlistSharedWith", "Compartilhado com")) + ": " + escapeHtml(names.join(", ")) + "</div>";
}

function getShareOverlayTitle(view) {
  var itemName = text(view && view.item && (view.item.name || view.item.parentName));
  if (!itemName) {
    return L("watchlistShareTitle", "Compartilhar item da Minha Lista");
  }
  return L("watchlistShareAction", "Compartilhar") + ": " + itemName;
}

function renderItemCard(view) {
  var item = (view && view.item) || {};
  var playableItem = (item && item.liveItem) || item;
  var isPlayed = isMarkedPlayed(playableItem);
  var playActionLabel = getPlayActionLabel(playableItem);
  var year = item.productionYear ? String(item.productionYear) : "";
  var runtime = formatRuntime(item.runtimeTicks);
  var rating = (typeof item.communityRating === "number" && isFinite(item.communityRating))
    ? "★ " + Number(item.communityRating).toFixed(1)
    : "";
  var official = text(item.officialRating);
  var typeLabel = item.itemType || L("content", "Conteúdo");
  var playedText = isPlayed ? L("played", "Assistido") : "";
  var metaParts = [typeLabel, year, runtime, rating, official, playedText];
  var meta = "";
  for (var i = 0; i < metaParts.length; i++) {
    if (metaParts[i]) {
      meta += (meta ? " • " : "") + metaParts[i];
    }
  }

  var tags = (item.genres || []).slice(0, 3);
  var poster = item.posterUrl
    ? "<img src=\"" + item.posterUrl + "\" alt=\"" + escapeHtml(item.name) + "\" loading=\"lazy\" decoding=\"async\">"
    : "<div class=\"monwuiwl-item-poster-fallback\">" + escapeHtml(typeLabel) + "</div>";

  var extraLine = "";
  if (item.albumArtist) {
    extraLine = escapeHtml(item.albumArtist);
  } else if (Array.isArray(item.artists) && item.artists.length) {
    extraLine = escapeHtml(item.artists.join(", "));
  } else if (item.parentName) {
    extraLine = escapeHtml(item.parentName);
  }

  var noteHtml = (view.kind === "shared" && view.note)
    ? "<div class=\"monwuiwl-item-sharemeta\"><strong>" + escapeHtml(L("watchlistShareNote", "Nota")) + ":</strong> " + escapeHtml(view.note) + "</div>"
    : "";

  var shareMeta = "";
  if (view.kind === "shared") {
    shareMeta = "<div class=\"monwuiwl-item-sharemeta\">" + escapeHtml(L("watchlistSharedBy", "Compartilhado por")) + ": " + escapeHtml(view.ownerUserName) + (view.sharedAtUtc ? (" • " + escapeHtml(formatDate(view.sharedAtUtc))) : "") + "</div>";
  } else {
    shareMeta = renderShareSummary(view.outgoingShares);
  }

  var secondaryAction = (view.kind === "own")
    ? "<button class=\"monwuiwl-btn\" data-monwuiwl-share=\"" + escapeHtml(view.itemId) + "\">" + escapeHtml(L("watchlistShareAction", "Compartilhar")) + "</button>"
    : "";

  var viewKey = text(view && view.key) || ((view.kind === "shared" ? "shared" : "own") + ":" + (view.kind === "shared" ? text(view.shareId) : text(view.itemId)));

  var tagsHtml = "";
  for (var j = 0; j < tags.length; j++) {
    tagsHtml += "<span class=\"monwuiwl-tag\">" + escapeHtml(tags[j]) + "</span>";
  }

  return "" +
    "<article class=\"monwuiwl-item " + (isPlayed ? "is-played" : "") + "\" tabindex=\"0\" data-monwuiwl-item=\"" + escapeHtml(view.itemId) + "\" data-monwuiwl-kind=\"" + escapeHtml(view.kind) + "\" data-monwuiwl-view-key=\"" + escapeHtml(viewKey) + "\"" + (view.kind === "shared" && text(view.shareId) ? (" data-monwuiwl-share-id=\"" + escapeHtml(text(view.shareId)) + "\"") : "") + ">" +
    "  <div class=\"monwuiwl-item-poster\">" +
    poster +
    (isPlayed ? renderPlayedOverlayMarkup() : "") +
    "  </div>" +
    "  <div class=\"monwuiwl-item-main\">" +
    "    <h3 class=\"monwuiwl-item-title\">" + escapeHtml(item.name) + "</h3>" +
    (meta ? ("    <div class=\"monwuiwl-item-meta\">" + escapeHtml(meta) + "</div>") : "") +
    (extraLine ? ("    <div class=\"monwuiwl-item-extra\">" + extraLine + "</div>") : "") +
    "    <div class=\"monwuiwl-item-overview\">" + escapeHtml(item.overview) + "</div>" +
    (tagsHtml ? ("    <div class=\"monwuiwl-item-tags\">" + tagsHtml + "</div>") : "") +
    shareMeta +
    noteHtml +
    "    <div class=\"monwuiwl-item-actions\">" +
    "      <button class=\"monwuiwl-btn primary\" data-monwuiwl-play-now=\"" + escapeHtml(view.itemId) + "\">" + escapeHtml(playActionLabel) + "</button>" +
    secondaryAction +
    "      <button class=\"monwuiwl-btn danger\" data-monwuiwl-remove=\"" + escapeHtml(view.kind === "shared" ? view.shareId : view.itemId) + "\" data-monwuiwl-remove-kind=\"" + escapeHtml(view.kind) + "\">" + escapeHtml(L("watchlistRemoveAction", "Remover")) + "</button>" +
    "    </div>" +
    "  </div>" +
    "</article>";
}

function getWatchlistInitialRenderCount(items) {
  var list = Array.isArray(items) ? items : [];
  if (!list.length) return 0;
  if (list.length <= WATCHLIST_PROGRESSIVE_RENDER_THRESHOLD) return list.length;
  return Math.min(WATCHLIST_PROGRESSIVE_INITIAL_BATCH, list.length);
}

function getWatchlistSectionTitle(title, items) {
  var list = Array.isArray(items) ? items : [];
  return list.length ? (title + " (" + list.length + ")") : title;
}

function findWatchlistSectionElement(root, sectionKey) {
  var key = text(sectionKey);
  if (!root || !key) return null;

  var directMatch = (typeof root.querySelector === "function") ? root.querySelector("[data-monwuiwl-section=\"" + escapeAttrSelector(key) + "\"]") : null;
  if (directMatch) return directMatch;

  var sections = (typeof root.querySelectorAll === "function") ? root.querySelectorAll(".monwuiwl-main .monwuiwl-section") : [];
  if (!sections || !sections.length) return null;
  return sections[key === "shared" ? 1 : 0] || null;
}

function renderSection(title, items, sectionKey) {
  var list = Array.isArray(items) ? items : [];
  var sectionTitle = getWatchlistSectionTitle(title, list);
  var key = sectionKey || "";

  if (!list.length) {
    return "" +
      "<section class=\"monwuiwl-section\" " + (key ? ("data-monwuiwl-section=\"" + escapeHtml(key) + "\"") : "") + ">" +
      "  <div class=\"monwuiwl-section-head\">" +
      "    <h3 class=\"monwuiwl-section-title\">" + escapeHtml(sectionTitle) + "</h3>" +
      "  </div>" +
      "  <div class=\"monwuiwl-empty\">" + escapeHtml(L("watchlistEmptySection", "Nenhum item encontrado aqui.")) + "</div>" +
      "</section>";
  }

  var initialCount = getWatchlistInitialRenderCount(list);
  var initialItems = list.slice(0, initialCount);
  var showLoader = !!key && initialCount < list.length;

  var itemsHtml = "";
  for (var i = 0; i < initialItems.length; i++) {
    itemsHtml += renderItemCard(initialItems[i]);
  }

  return "" +
    "<section class=\"monwuiwl-section\" " + (key ? ("data-monwuiwl-section=\"" + escapeHtml(key) + "\"") : "") + ">" +
    "  <div class=\"monwuiwl-section-head\">" +
    "    <h3 class=\"monwuiwl-section-title\">" + escapeHtml(sectionTitle) + "</h3>" +
    "  </div>" +
    "  <div class=\"monwuiwl-grid\" " + (key ? ("data-monwuiwl-section-grid=\"" + escapeHtml(key) + "\"") : "") + ">" +
    itemsHtml +
    "  </div>" +
    (showLoader ? ("  <div class=\"monwuiwl-loading\" data-monwuiwl-section-loading=\"" + escapeHtml(key) + "\">" + escapeHtml(L("loading", "Carregando...")) + "</div>") : "") +
    "</section>";
}

function getRenderedTabData(model, activeTab) {
  var currentTab = normalizeWatchlistTabKey(activeTab);
  var bucket = model && model[currentTab];
  var ownItems = (bucket && bucket.own) || [];
  var sharedItems = (bucket && bucket.shared) || [];
  var ownTitle = currentTab === "albums"
    ? L("watchlistOwnAlbums", "Sua lista de Álbuns")
    : L("watchlistOwnItems", "Sua lista");
  var sharedTitle = currentTab === "albums"
    ? L("watchlistSharedAlbums", "Álbuns compartilhados com você")
    : L("watchlistSharedItems", "Compartilhados com você");

  return {
    currentTab: currentTab,
    ownItems: ownItems,
    sharedItems: sharedItems,
    ownTitle: ownTitle,
    sharedTitle: sharedTitle
  };
}

function syncDeferredWatchlistFocus(root) {
  var state = (root && root.__state) || {};
  var focusItemId = text(state.focusItemId);
  if (!focusItemId || root.__focusItemApplied === focusItemId) return;

  var focusCard = (typeof root.querySelector === "function") ? root.querySelector("[data-monwuiwl-item=\"" + escapeAttrSelector(focusItemId) + "\"]") : null;
  if (!focusCard) return;

  root.__focusItemApplied = focusItemId;
  nextWatchlistFrame(function() {
    if (typeof focusCard.scrollIntoView === "function") {
      focusCard.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  });
}

function scheduleWatchlistSectionRender(root, sectionKey, items, startIndex, renderToken) {
  var list = Array.isArray(items) ? items : [];
  var start = startIndex || 0;
  var token = renderToken || 0;
  if (!root || !sectionKey || start >= list.length) return;

  var run = function() {
    if (!root.isConnected || Number(root.__progressiveRenderToken || 0) !== token) return;

    var grid = root.querySelector("[data-monwuiwl-section-grid=\"" + escapeAttrSelector(sectionKey) + "\"]");
    if (!grid) return;

    var nextItems = list.slice(start, start + WATCHLIST_PROGRESSIVE_BATCH_SIZE);
    if (!nextItems.length) {
      var loader = root.querySelector("[data-monwuiwl-section-loading=\"" + escapeAttrSelector(sectionKey) + "\"]");
      if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
      return;
    }

    var nextHtml = "";
    for (var i = 0; i < nextItems.length; i++) {
      nextHtml += renderItemCard(nextItems[i]);
    }
    grid.insertAdjacentHTML("beforeend", nextHtml);
    start += nextItems.length;

    var state = (root && root.__state) || {};
    var previewItemId = text(state.previewItemId);
    if (previewItemId) {
      setPreviewActiveCard(root, previewItemId);
    }
    syncDeferredWatchlistFocus(root);

    if (start < list.length) {
      nextWatchlistFrame(run);
      return;
    }

    var loaderEnd = root.querySelector("[data-monwuiwl-section-loading=\"" + escapeAttrSelector(sectionKey) + "\"]");
    if (loaderEnd && loaderEnd.parentNode) loaderEnd.parentNode.removeChild(loaderEnd);
  };

  nextWatchlistFrame(run);
}

function scheduleProgressiveWatchlistSections(root, model, activeTab) {
  if (!root) return;
  cancelProgressiveWatchlistRender(root);

  var renderToken = Number(root.__progressiveRenderToken || 0);
  var data = getRenderedTabData(model, activeTab);
  var ownItems = data.ownItems;
  var sharedItems = data.sharedItems;
  var ownStart = getWatchlistInitialRenderCount(ownItems);
  var sharedStart = getWatchlistInitialRenderCount(sharedItems);

  if (ownStart < ownItems.length) {
    scheduleWatchlistSectionRender(root, "own", ownItems, ownStart, renderToken);
  } else {
    var loaderOwn = root.querySelector("[data-monwuiwl-section-loading=\"own\"]");
    if (loaderOwn && loaderOwn.parentNode) loaderOwn.parentNode.removeChild(loaderOwn);
  }

  if (sharedStart < sharedItems.length) {
    scheduleWatchlistSectionRender(root, "shared", sharedItems, sharedStart, renderToken);
  } else {
    var loaderShared = root.querySelector("[data-monwuiwl-section-loading=\"shared\"]");
    if (loaderShared && loaderShared.parentNode) loaderShared.parentNode.removeChild(loaderShared);
  }
}

function renderModalShell(model, activeTab) {
  var data = getRenderedTabData(model, activeTab);
  var currentTab = data.currentTab;
  var tabTitle = getWatchlistTabLabel(currentTab);
  var layoutClass = isWatchlistStatsTab(currentTab) ? " is-stats-tab" : "";

  var tabsHtml = "";
  for (var i = 0; i < WATCHLIST_TABS.length; i++) {
    var tab = WATCHLIST_TABS[i];
    tabsHtml += "<button class=\"monwuiwl-tab " + (currentTab === tab.key ? "active" : "") + "\" data-monwuiwl-tab=\"" + escapeHtml(tab.key) + "\">" + escapeHtml(getWatchlistTabButtonText(model, tab.key)) + "</button>";
  }

  return "" +
    "<div class=\"monwuiwl-backdrop\">" +
    "  <div class=\"monwuiwl-card\" role=\"dialog\" aria-modal=\"true\" aria-label=\"" + escapeHtml(tabTitle) + "\">" +
    "    <div class=\"monwuiwl-header\">" +
    "      <div>" +
    "        <h2 class=\"monwuiwl-title\">" + escapeHtml(L("watchlistOpen", "Minha Lista")) + "</h2>" +
    "        <p class=\"monwuiwl-subtitle\">" + escapeHtml(L("watchlistModalSubtitle", "Os itens são mantidos no servidor, independente do dispositivo. Você pode compartilhar com outros usuários adicionando notas.")) + "</p>" +
    "      </div>" +
    "      <div class=\"monwuiwl-header-actions\">" +
    "        <button class=\"monwuiwl-close\" data-monwuiwl-close=\"1\" aria-label=\"" + escapeHtml(L("closeButton", "Fechar")) + "\">✕</button>" +
    "      </div>" +
    "    </div>" +
    "" +
    "    <div class=\"monwuiwl-tabs\">" +
    tabsHtml +
    "    </div>" +
    "" +
    "    <div class=\"monwuiwl-body\">" +
    "      <div class=\"monwuiwl-layout" + layoutClass + "\">" +
    "        <div class=\"monwuiwl-main\">" +
    renderCurrentWatchlistTabSections(model, currentTab) +
    "        </div>" +
    "        <aside class=\"monwuiwl-preview\" aria-live=\"polite\">" +
    renderPreviewEmptyState() +
    "        </aside>" +
    "      </div>" +
    "    </div>" +
    "  </div>" +
    "</div>";
}

function renderCurrentWatchlistTabSections(model, activeTab) {
  if (isWatchlistStatsTab(activeTab)) {
    return renderWatchlistStatsPanel(model);
  }

  var data = getRenderedTabData(model, activeTab);

  return "" +
    renderSection(data.ownTitle, data.ownItems, "own") +
    renderSection(data.sharedTitle, data.sharedItems, "shared");
}

function getWatchlistCardViewKey(card) {
  if (!card) return "";

  var explicitKey = text(card.getAttribute("data-monwuiwl-view-key"));
  if (explicitKey) return explicitKey;

  var kind = text(card.getAttribute("data-monwuiwl-kind"));
  var shareId = text(card.getAttribute("data-monwuiwl-share-id"));
  var itemId = text(card.getAttribute("data-monwuiwl-item"));
  if (kind === "shared" && shareId) return "shared:" + shareId;
  if (kind && itemId) return kind + ":" + itemId;
  return itemId ? ("own:" + itemId) : "";
}

function createWatchlistCardElement(view) {
  if (!view) return null;

  var template = document.createElement("div");
  template.innerHTML = renderItemCard(view).trim();
  var first = template.firstChild;
  while (first && first.nodeType !== 1) {
    first = first.nextSibling;
  }
  return first;
}

function updateWatchlistTabButtons(root, model, activeTab) {
  if (!root) return;

  var currentTab = normalizeWatchlistTabKey(activeTab);
  var buttons = (typeof root.querySelectorAll === "function") ? root.querySelectorAll("[data-monwuiwl-tab]") : [];

  for (var i = 0; i < buttons.length; i++) {
    var button = buttons[i];
    var tabKey = normalizeWatchlistTabKey(button.getAttribute("data-monwuiwl-tab"));
    var tabFound = null;
    for (var j = 0; j < WATCHLIST_TABS.length; j++) {
      if (WATCHLIST_TABS[j].key === tabKey) {
        tabFound = WATCHLIST_TABS[j];
        break;
      }
    }
    if (!tabFound) continue;

    button.textContent = getWatchlistTabButtonText(model, tabKey);
    if (tabKey === currentTab) {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
  }
}

function renderCurrentWatchlistTabContent(root, model, options) {
  var opt = options || {};
  var preserveScroll = opt.preserveScroll === true;
  var main = (root && typeof root.querySelector === "function") ? root.querySelector(".monwuiwl-main") : null;
  if (!root || !main) return false;

  var previousScrollTop = preserveScroll ? main.scrollTop : 0;
  root.__focusItemApplied = "";
  root.__previewActiveCard = null;
  var state = root.__state || {};
  main.innerHTML = renderCurrentWatchlistTabSections(model, state.activeTab);
  if (preserveScroll) {
    main.scrollTop = previousScrollTop;
  }
  if (!isWatchlistStatsTab(state.activeTab)) {
    scheduleProgressiveWatchlistSections(root, model, state.activeTab);
  }
  maybeLoadStatsTabData(root);
  return true;
}

function maybeLoadStatsTabData(root) {
  var state = (root && root.__state) || {};
  if (!root || !isWatchlistStatsTab(state.activeTab)) return;
  if (!generalStatsStale() && !generalStatsPromise) return;

  loadWatchlistGeneralStats().then(function() {
    var currentState = (root && root.__state) || {};
    if (!(root && root.isConnected) || !isWatchlistStatsTab(currentState.activeTab) || !root.__model) return;
    renderCurrentWatchlistTabContent(root, root.__model, { preserveScroll: true });
  })["catch"](function() {});
}

function updateWatchlistSectionAfterRemoval(root, sectionKey, title, items, change) {
  var section = findWatchlistSectionElement(root, sectionKey);
  if (!section) return false;

  var list = Array.isArray(items) ? items : [];
  var nextMarkup = renderSection(title, list, sectionKey);
  if (!list.length) {
    section.outerHTML = nextMarkup;
    return true;
  }

  var grid = section.querySelector("[data-monwuiwl-section-grid=\"" + escapeAttrSelector(sectionKey) + "\"]");
  var titleEl = section.querySelector(".monwuiwl-section-title");
  if (!grid || !titleEl) {
    section.outerHTML = nextMarkup;
    var initialCount = getWatchlistInitialRenderCount(list);
    if (initialCount < list.length) {
      scheduleWatchlistSectionRender(root, sectionKey, list, initialCount, Number(root.__progressiveRenderToken || 0));
    }
    return true;
  }

  titleEl.textContent = getWatchlistSectionTitle(title, list);

  var opt = change || {};
  var removedViewKeys = opt.removedViewKeys || {};
  var updatedViewKeys = opt.updatedViewKeys || {};
  var removedItemId = text(opt.removedItemId);
  var removedShareId = text(opt.removedShareId);

  var currentCards = (typeof grid.querySelectorAll === "function") ? grid.querySelectorAll(".monwuiwl-item") : [];
  var visibleCountBefore = currentCards.length;

  for (var i = 0; i < currentCards.length; i++) {
    var card = currentCards[i];
    var viewKey = getWatchlistCardViewKey(card);
    var cardItemId = text(card.getAttribute("data-monwuiwl-item"));
    var cardShareId = text(card.getAttribute("data-monwuiwl-share-id"));
    var shouldRemove =
      removedViewKeys[viewKey] ||
      (!!removedItemId && cardItemId === removedItemId) ||
      (!!removedShareId && cardShareId === removedShareId);

    if (shouldRemove) {
      if (card.parentNode) card.parentNode.removeChild(card);
    }
  }

  var updatedCount = 0;
  for (var key in updatedViewKeys) {
    if (updatedViewKeys.hasOwnProperty(key)) updatedCount++;
  }

  if (updatedCount > 0) {
    var viewMap = {};
    for (var j = 0; j < list.length; j++) {
      var vKey = text(list[j] && list[j].key);
      if (vKey) viewMap[vKey] = list[j];
    }

    var cardsToUpdate = (typeof grid.querySelectorAll === "function") ? grid.querySelectorAll(".monwuiwl-item") : [];
    for (var k = 0; k < cardsToUpdate.length; k++) {
      var cardToUpdate = cardsToUpdate[k];
      var vKey2 = getWatchlistCardViewKey(cardToUpdate);
      if (!updatedViewKeys[vKey2]) continue;

      var nextView = viewMap[vKey2];
      var nextCard = createWatchlistCardElement(nextView);
      if (nextCard && cardToUpdate.parentNode) {
        cardToUpdate.parentNode.replaceChild(nextCard, cardToUpdate);
      }
    }
  }

  var desiredRenderedCount = Math.min(
    list.length,
    Math.max(getWatchlistInitialRenderCount(list), visibleCountBefore)
  );
  var desiredViews = list.slice(0, desiredRenderedCount);
  var desiredKeys = {};
  for (var m = 0; m < desiredViews.length; m++) {
    var dKey = text(desiredViews[m] && desiredViews[m].key);
    if (dKey) desiredKeys[dKey] = true;
  }

  var cardsToFilter = (typeof grid.querySelectorAll === "function") ? grid.querySelectorAll(".monwuiwl-item") : [];
  for (var n = 0; n < cardsToFilter.length; n++) {
    var cardToFilter = cardsToFilter[n];
    var vKey3 = getWatchlistCardViewKey(cardToFilter);
    if (vKey3 && !desiredKeys[vKey3]) {
      if (cardToFilter.parentNode) cardToFilter.parentNode.removeChild(cardToFilter);
    }
  }

  var renderedKeys = {};
  var remainingCards = (typeof grid.querySelectorAll === "function") ? grid.querySelectorAll(".monwuiwl-item") : [];
  for (var p = 0; p < remainingCards.length; p++) {
    var rKey = getWatchlistCardViewKey(remainingCards[p]);
    if (rKey) renderedKeys[rKey] = true;
  }

  for (var q = 0; q < desiredViews.length; q++) {
    var view = desiredViews[q];
    var viewKeyFinal = text(view && view.key);
    if (!viewKeyFinal || renderedKeys[viewKeyFinal]) continue;

    var newCard = createWatchlistCardElement(view);
    if (!newCard) continue;
    grid.appendChild(newCard);
    renderedKeys[viewKeyFinal] = true;
  }

  var loadingSelector = "[data-monwuiwl-section-loading=\"" + escapeAttrSelector(sectionKey) + "\"]";
  var existingLoader = section.querySelector(loadingSelector);
  if (desiredRenderedCount < list.length) {
    if (!existingLoader) {
      var loader = document.createElement("div");
      loader.className = "monwuiwl-loading";
      loader.setAttribute("data-monwuiwl-section-loading", sectionKey);
      loader.textContent = L("loading", "Carregando...");
      section.appendChild(loader);
    }

    scheduleWatchlistSectionRender(
      root,
      sectionKey,
      list,
      desiredRenderedCount,
      Number(root.__progressiveRenderToken || 0)
    );
  } else {
    if (existingLoader && existingLoader.parentNode) {
      existingLoader.parentNode.removeChild(existingLoader);
    }
  }

  return true;
}

function applyWatchlistChangeToModel(model, detail) {
  var d = detail || {};
  var itemId = text(d.itemId);
  var shareId = text(d.shareId);
  var isItemRemoval = !!itemId && d.inWatchlist === false;
  var isShareRemoval = !!shareId && d.shared === false;

  if (!model || (!isItemRemoval && !isShareRemoval)) {
    return { applied: false };
  }

  var affectedTabs = {};
  var affectedCount = 0;
  var removedItemIds = {};
  var removedViewKeysBySection = {
    own: {},
    shared: {}
  };
  var updatedViewKeysBySection = {
    own: {},
    shared: {}
  };

  for (var i = 0; i < WATCHLIST_TABS.length; i++) {
    var tabKey = WATCHLIST_TABS[i].key;
    var bucket = model[tabKey];
    if (!bucket) continue;

    if (isItemRemoval) {
      var nextOwn = [];
      var ownList = bucket.own || [];
      for (var j = 0; j < ownList.length; j++) {
        var view = ownList[j];
        if (text(view && view.itemId) === itemId) {
          removedItemIds[itemId] = true;
          removedViewKeysBySection.own[text(view.key) || ("own:" + itemId)] = true;
          if (!affectedTabs[tabKey]) {
            affectedTabs[tabKey] = true;
            affectedCount++;
          }
          continue;
        }
        nextOwn.push(view);
      }
      bucket.own = nextOwn;
      continue;
    }

    var nextShared = [];
    var sharedRemoved = false;
    var sharedList = bucket.shared || [];
    for (var k = 0; k < sharedList.length; k++) {
      var sView = sharedList[k];
      if (text(sView && sView.shareId) === shareId) {
        sharedRemoved = true;
        removedItemIds[text(sView.itemId)] = true;
        removedViewKeysBySection.shared[text(sView.key) || ("shared:" + shareId)] = true;
        continue;
      }
      nextShared.push(sView);
    }
    if (sharedRemoved) {
      bucket.shared = nextShared;
      if (!affectedTabs[tabKey]) {
        affectedTabs[tabKey] = true;
        affectedCount++;
      }
    }

    var ownList2 = bucket.own || [];
    for (var m = 0; m < ownList2.length; m++) {
      var oView = ownList2[m];
      var shares = Array.isArray(oView && oView.outgoingShares) ? oView.outgoingShares : [];
      var nextShares = [];
      var shareFound = false;
      for (var n = 0; n < shares.length; n++) {
        if (text(shares[n] && (shares[n].Id || shares[n].id)) === shareId) {
          shareFound = true;
          continue;
        }
        nextShares.push(shares[n]);
      }
      if (!shareFound) continue;

      oView.outgoingShares = nextShares;
      updatedViewKeysBySection.own[text(oView.key) || ("own:" + text(oView.itemId))] = true;
      if (!affectedTabs[tabKey]) {
        affectedTabs[tabKey] = true;
        affectedCount++;
      }
    }
  }

  return {
    applied: affectedCount > 0,
    affectedTabs: affectedTabs,
    removedItemId: itemId,
    removedShareId: shareId,
    removedItemIds: removedItemIds,
    removedViewKeysBySection: removedViewKeysBySection,
    updatedViewKeysBySection: updatedViewKeysBySection
  };
}

function applyWatchlistAdditionToOpenModal(root, detail) {
  var d = detail || {};
  var itemId = text(d.itemId);
  var isItemAdd = !!itemId && d.inWatchlist === true;
  var isShareAdd = !!itemId && d.shared === true;
  if (!root || !root.__model || (!isItemAdd && !isShareAdd)) return Promise.resolve(false);

  return (dashboardCache && !dashboardStale()
    ? Promise.resolve(dashboardCache)
    : ensureWatchlistLoaded()["catch"](function() { return null; })
  ).then(function(dashboard) {
    if (!dashboard) return false;

    return buildPartialWatchlistItemModel(itemId, dashboard)["catch"](function() { return null; })
      .then(function(partialModel) {
        if (!partialModel) return false;

        var change = mergePartialWatchlistItemModel(root.__model, partialModel, d);
        if (!change.applied) return false;

        var state = root.__state || {};
        var currentTab = normalizeWatchlistTabKey(state.activeTab);
        var currentTabAffected = !!(change.affectedTabs && change.affectedTabs[currentTab]);
        var currentTabIsStats = isWatchlistStatsTab(currentTab);

        updateWatchlistTabButtons(root, root.__model, currentTab);
        if (!currentTabAffected && !currentTabIsStats) return true;

        clearPreviewHoverTimer(root);
        cancelProgressiveWatchlistRender(root);

        if (!renderCurrentWatchlistTabContent(root, root.__model, { preserveScroll: true })) {
          return false;
        }

        if (currentTabIsStats) {
          root.__state.focusItemId = "";
          root.__state.previewItemId = "";
          try {
            if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
              root.__previewAbortController.abort();
            }
          } catch (e) {}
          var panel = root.querySelector(".monwuiwl-preview");
          if (panel) {
            panel.scrollTop = 0;
            applyPreviewPanelMarkup(panel, renderPreviewEmptyState());
          }
          setPreviewActiveCard(root, "");
          return true;
        }

        var currentPreviewItemId = text(root.__state && root.__state.previewItemId);
        var currentFocusItemId = text(root.__state && root.__state.focusItemId);
        var tabViews = getWatchlistTabViews(root.__model, currentTab);
        var previewStillExists = false;
        var focusStillExists = false;
        for (var i = 0; i < tabViews.length; i++) {
          if (text(tabViews[i] && tabViews[i].itemId) === currentPreviewItemId) previewStillExists = true;
          if (text(tabViews[i] && tabViews[i].itemId) === currentFocusItemId) focusStillExists = true;
        }

        root.__state.focusItemId = focusStillExists ? currentFocusItemId : "";
        root.__state.previewItemId = previewStillExists ? currentPreviewItemId : "";

        var shouldRefreshPreview =
          !previewStillExists ||
          currentPreviewItemId === itemId ||
          (!currentPreviewItemId && tabViews.length > 0);

        if (shouldRefreshPreview) {
          try {
            if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
              root.__previewAbortController.abort();
            }
          } catch (e2) {}
        }

        var nextPreviewItemId = getInitialPreviewItemId(root);
        if (nextPreviewItemId && (shouldRefreshPreview || nextPreviewItemId !== currentPreviewItemId)) {
          queuePreviewPanelUpdate(root, nextPreviewItemId, { immediate: true });
        } else if (nextPreviewItemId) {
          setPreviewActiveCard(root, nextPreviewItemId);
        } else {
          var panelEnd = root.querySelector(".monwuiwl-preview");
          if (panelEnd) {
            panelEnd.scrollTop = 0;
            applyPreviewPanelMarkup(panelEnd, renderPreviewEmptyState());
          }
          setPreviewActiveCard(root, "");
        }

        syncDeferredWatchlistFocus(root);
        return true;
      });
  });
}

function applyWatchlistChangeToOpenModal(root, detail) {
  if (!root || !root.__model) return Promise.resolve(false);

  var d = detail || {};
  var itemId = text(d.itemId);
  var isItemAdd = !!itemId && d.inWatchlist === true;
  var isShareAdd = !!itemId && d.shared === true;
  if (isItemAdd || isShareAdd) {
    return applyWatchlistAdditionToOpenModal(root, d);
  }

  var change = applyWatchlistChangeToModel(root.__model, d);
  if (!change.applied) return Promise.resolve(false);

  var state = root.__state || {};
  var currentTab = normalizeWatchlistTabKey(state.activeTab);
  var currentTabAffected = !!(change.affectedTabs && change.affectedTabs[currentTab]);
  var currentTabIsStats = isWatchlistStatsTab(currentTab);

  updateWatchlistTabButtons(root, root.__model, currentTab);

  if (currentTabAffected || currentTabIsStats) {
    clearPreviewHoverTimer(root);
    cancelProgressiveWatchlistRender(root);

    if (currentTabIsStats) {
      if (!renderCurrentWatchlistTabContent(root, root.__model, { preserveScroll: true })) {
        return Promise.resolve(false);
      }
      root.__state.focusItemId = "";
      root.__state.previewItemId = "";
      try {
        if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
          root.__previewAbortController.abort();
        }
      } catch (e) {}
      var panel = root.querySelector(".monwuiwl-preview");
      if (panel) {
        panel.scrollTop = 0;
        applyPreviewPanelMarkup(panel, renderPreviewEmptyState());
      }
      setPreviewActiveCard(root, "");
      return Promise.resolve(true);
    }

    var data = getRenderedTabData(root.__model, currentTab);
    var ownItems = data.ownItems;
    var sharedItems = data.sharedItems;
    var ownTitle = data.ownTitle;
    var sharedTitle = data.sharedTitle;

    var ownUpdated = change.updatedViewKeysBySection && change.updatedViewKeysBySection.own;
    var sharedUpdated = change.updatedViewKeysBySection && change.updatedViewKeysBySection.shared;
    var ownUpdatedIds = {};
    if (ownUpdated) {
      var keys = Object.keys(ownUpdated);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.indexOf("own:") === 0) {
          ownUpdatedIds[key.slice(4)] = true;
        }
      }
    }

    var ownHandled = updateWatchlistSectionAfterRemoval(root, "own", ownTitle, ownItems, {
      removedItemId: (change.removedViewKeysBySection && change.removedViewKeysBySection.own && Object.keys(change.removedViewKeysBySection.own).length) ? change.removedItemId : "",
      removedShareId: change.removedShareId,
      removedViewKeys: change.removedViewKeysBySection && change.removedViewKeysBySection.own,
      updatedViewKeys: ownUpdated
    });
    var sharedHandled = updateWatchlistSectionAfterRemoval(root, "shared", sharedTitle, sharedItems, {
      removedItemId: (change.removedViewKeysBySection && change.removedViewKeysBySection.shared && Object.keys(change.removedViewKeysBySection.shared).length) ? change.removedItemId : "",
      removedShareId: change.removedShareId,
      removedViewKeys: change.removedViewKeysBySection && change.removedViewKeysBySection.shared,
      updatedViewKeys: sharedUpdated
    });

    if (!ownHandled || !sharedHandled) {
      if (!renderCurrentWatchlistTabContent(root, root.__model)) {
        return Promise.resolve(false);
      }
    }

    var currentPreviewItemId = text(root.__state && root.__state.previewItemId);
    var currentFocusItemId = text(root.__state && root.__state.focusItemId);
    var tabViews = getWatchlistTabViews(root.__model, currentTab);
    var previewStillExists = false;
    var focusStillExists = false;
    for (var j = 0; j < tabViews.length; j++) {
      if (text(tabViews[j] && tabViews[j].itemId) === currentPreviewItemId) previewStillExists = true;
      if (text(tabViews[j] && tabViews[j].itemId) === currentFocusItemId) focusStillExists = true;
    }

    root.__state.focusItemId = focusStillExists ? currentFocusItemId : "";
    root.__state.previewItemId = previewStillExists ? currentPreviewItemId : "";

    var shouldRefreshPreview =
      !previewStillExists ||
      (change.removedItemIds && change.removedItemIds[currentPreviewItemId]) ||
      ownUpdatedIds[currentPreviewItemId];

    if (shouldRefreshPreview) {
      try {
        if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
          root.__previewAbortController.abort();
        }
      } catch (e2) {}
    }

    var nextPreviewItemId = getInitialPreviewItemId(root);
    if (nextPreviewItemId && (shouldRefreshPreview || nextPreviewItemId !== currentPreviewItemId)) {
      queuePreviewPanelUpdate(root, nextPreviewItemId, { immediate: true });
    } else if (nextPreviewItemId) {
      setPreviewActiveCard(root, nextPreviewItemId);
    } else {
      var panelEnd = root.querySelector(".monwuiwl-preview");
      if (panelEnd) {
        panelEnd.scrollTop = 0;
        applyPreviewPanelMarkup(panelEnd, renderPreviewEmptyState());
      }
      setPreviewActiveCard(root, "");
    }

    syncDeferredWatchlistFocus(root);
  }

  return Promise.resolve(true);
}

function renderWatchlistShellFromModel(root, model) {
  root.__model = model;
  root.__focusItemApplied = "";
  root.__previewActiveCard = null;
  var state = root.__state || {};
  root.innerHTML = renderModalShell(model, state.activeTab);
  if (!isWatchlistStatsTab(state.activeTab)) {
    scheduleProgressiveWatchlistSections(root, model, state.activeTab);
  }
  maybeLoadStatsTabData(root);
}

function renderWatchlistModal(root, state) {
  var renderToken = Date.now();
  root.__renderToken = renderToken;
  clearPreviewHoverTimer(root);
  cancelProgressiveWatchlistRender(root);
  bindModalInteractions(root);
  try {
    if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
      root.__previewAbortController.abort();
    }
  } catch (e) {}

  var s = state || {};
  root.__state = {
    activeTab: normalizeWatchlistTabKey(s.activeTab),
    focusItemId: text(s.focusItemId),
    previewItemId: text(s.previewItemId)
  };

  var hotDashboard = dashboardCache && !dashboardStale() ? dashboardCache : null;
  var hotCacheKey = getWatchlistViewModelCacheKey(hotDashboard);
  var hotModel = (hotCacheKey && watchlistViewModelCacheKey === hotCacheKey)
    ? watchlistViewModelCacheValue
    : null;

  if (hotModel) {
    renderWatchlistShellFromModel(root, hotModel);
  } else {
    root.innerHTML = "" +
      "<div class=\"monwuiwl-backdrop\">" +
      "  <div class=\"monwuiwl-card\" role=\"dialog\" aria-modal=\"true\" aria-label=\"" + escapeHtml(L("watchlistOpen", "Minha Lista")) + "\">" +
      "    <div class=\"monwuiwl-header\">" +
      "      <div>" +
      "        <h2 class=\"monwuiwl-title\">" + escapeHtml(L("watchlistOpen", "Minha Lista")) + "</h2>" +
      "        <p class=\"monwuiwl-subtitle\">" + escapeHtml(L("loading", "Carregando...")) + "</p>" +
      "      </div>" +
      "      <div class=\"monwuiwl-header-actions\">" +
      "        <button class=\"monwuiwl-close\" data-monwuiwl-close=\"1\" aria-label=\"" + escapeHtml(L("closeButton", "Fechar")) + "\">✕</button>" +
      "      </div>" +
      "    </div>" +
      "    <div class=\"monwuiwl-body\">" +
      "      <div class=\"monwuiwl-loading\">" + escapeHtml(L("loading", "Carregando...")) + "</div>" +
      "    </div>" +
      "  </div>" +
      "</div>";
  }

  return ensureWatchlistLoaded()
    ["catch"](function() { return null; })
    .then(function(dashboard) {
      if (!dashboard) throw new Error(L("watchlistLoadError", "Falha ao carregar Minha Lista."));
      return getCachedWatchlistViewModel(dashboard);
    })
    .then(function(model) {
      if (root.__renderToken !== renderToken) return;

      if (root.__model !== model) {
        renderWatchlistShellFromModel(root, model);
      }
      var previewItemId = getInitialPreviewItemId(root);
      if (previewItemId) {
        queuePreviewPanelUpdate(root, previewItemId, { immediate: true });
      } else {
        root.__state.previewItemId = "";
        setPreviewActiveCard(root, "");
        var panel = root.querySelector(".monwuiwl-preview");
        if (panel) panel.innerHTML = renderPreviewEmptyState();
      }
      syncDeferredWatchlistFocus(root);
    })
    ["catch"](function(error) {
      if (root.__renderToken !== renderToken) return;
      root.innerHTML = "" +
        "<div class=\"monwuiwl-backdrop\">" +
        "  <div class=\"monwuiwl-card\" role=\"dialog\" aria-modal=\"true\" aria-label=\"" + escapeHtml(L("watchlistOpen", "Minha Lista")) + "\">" +
        "    <div class=\"monwuiwl-header\">" +
        "      <div>" +
        "        <h2 class=\"monwuiwl-title\">" + escapeHtml(L("watchlistOpen", "Minha Lista")) + "</h2>" +
        "        <p class=\"monwuiwl-subtitle\">" + escapeHtml(L("watchlistLoadError", "Falha ao carregar Minha Lista.")) + "</p>" +
        "      </div>" +
        "      <div class=\"monwuiwl-header-actions\">" +
        "        <button class=\"monwuiwl-close\" data-monwuiwl-close=\"1\" aria-label=\"" + escapeHtml(L("closeButton", "Fechar")) + "\">✕</button>" +
        "      </div>" +
        "    </div>" +
        "    <div class=\"monwuiwl-body\">" +
        "      <div class=\"monwuiwl-error\">" + escapeHtml((error && error.message) || L("watchlistLoadError", "Falha ao carregar Minha Lista.")) + "</div>" +
        "    </div>" +
        "  </div>" +
        "</div>";
    });
}

function bindModalInteractions(root) {
  if (!root || root.__watchlistDelegatedBindingsInstalled) return;
  root.__watchlistDelegatedBindingsInstalled = true;

  root.addEventListener("mouseover", function(event) {
    var target = event.target;
    var preview = (target && typeof target.closest === "function") ? target.closest(".monwuiwl-preview") : null;
    if (preview && root.contains(preview)) {
      var previewRelated = event.relatedTarget;
      if (!previewRelated || !preview.contains(previewRelated)) {
        clearPreviewHoverTimer(root);
      }
    }

    var card = (target && typeof target.closest === "function") ? target.closest(".monwuiwl-item") : null;
    if (!card || !root.contains(card)) return;

    var related = event.relatedTarget;
    if (related && card.contains(related)) return;

    var itemId = text(card.getAttribute("data-monwuiwl-item"));
    if (itemId) {
      queuePreviewPanelUpdate(root, itemId);
    }
  });

  root.addEventListener("mouseout", function(event) {
    var target = event.target;
    var card = (target && typeof target.closest === "function") ? target.closest(".monwuiwl-item") : null;
    if (!card || !root.contains(card)) return;

    var related = event.relatedTarget;
    if (related && card.contains(related)) return;

    var itemId = text(card.getAttribute("data-monwuiwl-item"));
    if (text(root.__pendingPreviewItemId) === itemId) {
      clearPreviewHoverTimer(root);
    }
  });

  root.addEventListener("focusin", function(event) {
    var target = event.target;
    var card = (target && typeof target.closest === "function") ? target.closest(".monwuiwl-item") : null;
    if (!card || !root.contains(card)) return;

    var itemId = text(card.getAttribute("data-monwuiwl-item"));
    if (itemId) {
      queuePreviewPanelUpdate(root, itemId, { immediate: true });
    }
  });

  root.addEventListener("click", function(event) {
    var target = event.target;
    if (target && typeof target.closest === "function" && target.closest("[data-monwuiwl-close='1']")) return;

    var tabButton = (target && typeof target.closest === "function") ? target.closest("[data-monwuiwl-tab]") : null;
    if (tabButton && root.contains(tabButton)) {
      var nextTab = normalizeWatchlistTabKey(tabButton.getAttribute("data-monwuiwl-tab"));
      var state = root.__state || {};
      if (nextTab === normalizeWatchlistTabKey(state.activeTab)) return;

      clearPreviewHoverTimer(root);
      try {
        if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
          root.__previewAbortController.abort();
        }
      } catch (e) {}

      root.__state.activeTab = nextTab;
      root.__state.focusItemId = "";
      root.__state.previewItemId = "";

      if (root.__model) {
        renderWatchlistShellFromModel(root, root.__model);
        var previewItemId = getInitialPreviewItemId(root);
        if (previewItemId) {
          queuePreviewPanelUpdate(root, previewItemId, { immediate: true });
        } else {
          setPreviewActiveCard(root, "");
          var panel = root.querySelector(".monwuiwl-preview");
          if (panel) panel.innerHTML = renderPreviewEmptyState();
        }
      } else {
        renderWatchlistModal(root, root.__state)["catch"](function() {});
      }
      return;
    }

    var studioButton = (target && typeof target.closest === "function") ? target.closest("[data-monwuiwl-studio-id]") : null;
    if (studioButton && root.contains(studioButton)) {
      event.preventDefault();
      event.stopPropagation();

      if (!setStudioHubLoadingState(studioButton, true)) return;

      var studioId = text(studioButton.getAttribute("data-monwuiwl-studio-id"));
      var studioName = text(studioButton.getAttribute("data-monwuiwl-studio-name"));
      if (!studioId) {
        setStudioHubLoadingState(studioButton, false);
        return;
      }

      copyTextToClipboard(studioId).then(function(copied) {
        if (copied) {
          studioButton.classList.add("is-copied");
          clearTimeout(studioButton.__copiedTimer);
          studioButton.__copiedTimer = setTimeout(function() {
            studioButton.classList.remove("is-copied");
            studioButton.__copiedTimer = 0;
          }, 1400);
        } else {
          var message = studioName
            ? studioName + ": " + L("watchlistPreviewStudioCopyFailed", "Falha ao copiar ID do estúdio.")
            : L("watchlistPreviewStudioCopyFailed", "Falha ao copiar ID do estúdio.");
          notifyStudioHubResult(message, "error", "clipboard", 2400);
        }

        return maybeAutoEnsureStudioHub(studioId, studioName).then(function(autoAddResult) {
          if (autoAddResult && autoAddResult.pending) return;

          if (autoAddResult && autoAddResult.attempted && autoAddResult.added === false && autoAddResult.existing !== true) {
            var err = (autoAddResult.error && autoAddResult.error.message) || L("watchlistPreviewStudioAutoAddFailed", "Falha ao adicionar coleção automaticamente.");
            var msg = studioName ? (studioName + ": " + err) : err;
            notifyStudioHubResult(msg, "error", "triangle-exclamation", 3200);
            return;
          }

          return maybeAutoEnsureStudioHubTmdbLogo(studioId, studioName, {
            entries: autoAddResult && autoAddResult.entries
          }).then(function(logoResult) {
            if (autoAddResult && autoAddResult.added && logoResult && logoResult.uploaded) {
              var m1 = studioName
                ? studioName + ": " + L("watchlistPreviewStudioAutoAdded", "Salvo automaticamente na lista de coleções.") + " " + L("watchlistPreviewStudioTmdbLogoSaved", "Logotipo do TMDb também salvo automaticamente.")
                : L("watchlistPreviewStudioAutoAdded", "Salvo automaticamente na lista de coleções.") + " " + L("watchlistPreviewStudioTmdbLogoSaved", "Logotipo do TMDb também salvo automaticamente.");
              notifyStudioHubResult(m1, "success", "building", 3000);
              return;
            }

            if (autoAddResult && autoAddResult.existing && logoResult && logoResult.uploaded) {
              var m2 = studioName
                ? studioName + ": " + L("manualCollectionDuplicate", "Esta coleção já foi adicionada.") + " " + L("watchlistPreviewStudioTmdbLogoSavedSingle", "Logotipo do TMDb salvo automaticamente.")
                : L("manualCollectionDuplicate", "Esta coleção já foi adicionada.") + " " + L("watchlistPreviewStudioTmdbLogoSavedSingle", "Logotipo do TMDb salvo automaticamente.");
              notifyStudioHubResult(m2, "success", "building", 3000);
              return;
            }

            if (autoAddResult && autoAddResult.added) {
              var m3 = studioName
                ? studioName + ": " + L("watchlistPreviewStudioAutoAdded", "Salvo automaticamente na lista de coleções.")
                : L("watchlistPreviewStudioAutoAdded", "Salvo automaticamente na lista de coleções.");
              notifyStudioHubResult(m3, "success", "building", 2600);
              return;
            }

            if (autoAddResult && autoAddResult.existing) {
              var m4 = studioName
                ? studioName + ": " + L("manualCollectionDuplicate", "Esta coleção já foi adicionada.")
                : L("manualCollectionDuplicate", "Esta coleção já foi adicionada.");
              notifyStudioHubResult(m4, "success", "building", 2600);
              return;
            }

            if (logoResult && logoResult.uploaded) {
              var m5 = studioName
                ? studioName + ": " + L("watchlistPreviewStudioTmdbLogoSavedSingle", "Logotipo do TMDb salvo automaticamente.")
                : L("watchlistPreviewStudioTmdbLogoSavedSingle", "Logotipo do TMDb salvo automaticamente.");
              notifyStudioHubResult(m5, "success", "image", 2600);
            }
          });
        });
      })["finally"](function() {
        setStudioHubLoadingState(studioButton, false);
      });

      return;
    }

    var previewPlayButton = (target && typeof target.closest === "function") ? target.closest("[data-monwuiwl-preview-play]") : null;
    if (previewPlayButton && root.contains(previewPlayButton)) {
      event.preventDefault();
      event.stopPropagation();

      var itemIdPlay = text(previewPlayButton.getAttribute("data-monwuiwl-preview-play"));
      if (!itemIdPlay) return;
      startWatchlistPlayback(previewPlayButton, itemIdPlay);
      return;
    }

    var playNowButton = (target && typeof target.closest === "function") ? target.closest("[data-monwuiwl-play-now]") : null;
    if (playNowButton && root.contains(playNowButton)) {
      var itemIdNow = text(playNowButton.getAttribute("data-monwuiwl-play-now"));
      if (!itemIdNow) return;
      startWatchlistPlayback(playNowButton, itemIdNow);
      return;
    }

    var removeButton = (target && typeof target.closest === "function") ? target.closest("[data-monwuiwl-remove]") : null;
    if (removeButton && root.contains(removeButton)) {
      var removeKind = text(removeButton.getAttribute("data-monwuiwl-remove-kind"));
      var targetId = text(removeButton.getAttribute("data-monwuiwl-remove"));
      if (!targetId) return;

      removeButton.disabled = true;
      var p = (removeKind === "shared")
        ? removeWatchlistShare(targetId)
        : (function() {
            var currentView = findViewByItemId(root.__model || {}, targetId, (root.__state && root.__state.activeTab));
            var playableItem = (currentView && currentView.item && (currentView.item.liveItem || currentView.item)) || null;
            return updateFavoriteStatus(targetId, false, {
              item: playableItem,
              played: isMarkedPlayed(playableItem)
            });
          })();

      p.then(function() {
        if (typeof window.showMessage === "function") window.showMessage(L("watchlistRemoved", "Item removido da lista"), "success");
      })["catch"](function(err) {
        if (typeof window.showMessage === "function") window.showMessage((err && err.message) || L("watchlistActionError", "Falha na operação"), "error");
      })["finally"](function() {
        removeButton.disabled = false;
      });
      return;
    }

    var shareButton = (target && typeof target.closest === "function") ? target.closest("[data-monwuiwl-share]") : null;
    if (shareButton && root.contains(shareButton)) {
      var itemIdShare = text(shareButton.getAttribute("data-monwuiwl-share"));
      if (!itemIdShare) return;
      openShareOverlay(root, itemIdShare);
      return;
    }

    var itemCard = (target && typeof target.closest === "function") ? target.closest(".monwuiwl-item") : null;
    if (!itemCard || !root.contains(itemCard)) return;
    if (target && typeof target.closest === "function" && target.closest(".monwuiwl-btn")) return;

    var itemIdFinal = text(itemCard.getAttribute("data-monwuiwl-item"));
    if (itemIdFinal) {
      queuePreviewPanelUpdate(root, itemIdFinal, { immediate: true });
    }
  });
}

function openShareOverlay(root, itemId) {
  return fetchShareableUsers().then(function(users) {
    var model = root.__model || {};
    var state = root.__state || {};
    var activeTab = normalizeWatchlistTabKey(state.activeTab);
    var bucket = model[activeTab];
    var allItems = ((bucket && bucket.own) || []).concat((bucket && bucket.shared) || []);

    var allOwnItems = [];
    for (var i = 0; i < WATCHLIST_TABS.length; i++) {
      var b = model[WATCHLIST_TABS[i].key];
      if (b && b.own) {
        allOwnItems = allOwnItems.concat(b.own);
      }
    }

    var view = null;
    for (var j = 0; j < allItems.length; j++) {
      if (text(allItems[j] && allItems[j].itemId) === itemId) {
        view = allItems[j];
        break;
      }
    }
    if (!view) {
      for (var k = 0; k < allOwnItems.length; k++) {
        if (text(allOwnItems[k] && allOwnItems[k].itemId) === itemId) {
          view = allOwnItems[k];
          break;
        }
      }
    }

    if (!view) {
      if (typeof window.showMessage === "function") window.showMessage(L("watchlistItemMissing", "Item para compartilhar não encontrado"), "error");
      return;
    }

    var shareTitle = getShareOverlayTitle(view);

    var overlay = document.createElement("div");
    overlay.className = "monwuiwl-share-overlay";

    var usersHtml = "";
    if (users.length) {
      for (var m = 0; m < users.length; m++) {
        usersHtml += "" +
          "<label class=\"monwuiwl-share-user\">" +
          "  <input type=\"checkbox\" value=\"" + escapeHtml(users[m].id) + "\">" +
          "  <span>" + escapeHtml(users[m].name) + "</span>" +
          "</label>";
      }
    } else {
      usersHtml = "<div class=\"monwuiwl-empty\">" + escapeHtml(L("watchlistNoUsers", "Nenhum usuário encontrado para compartilhar.")) + "</div>";
    }

    overlay.innerHTML = "" +
      "<div class=\"monwuiwl-share-card\" role=\"dialog\" aria-modal=\"true\" aria-label=\"" + escapeHtml(shareTitle) + "\">" +
      "  <h3 class=\"monwuiwl-share-title\">" + escapeHtml(shareTitle) + "</h3>" +
      "  <p class=\"monwuiwl-share-help\">" + escapeHtml(L("watchlistShareSubtitle", "Você pode selecionar vários usuários e adicionar uma nota curta durante o compartilhamento.")) + "</p>" +
      "  <div class=\"monwuiwl-share-list\">" +
      usersHtml +
      "  </div>" +
      "  <label class=\"monwuiwl-share-note-label\" for=\"monwuiwl-share-note\">" + escapeHtml(L("watchlistShareNoteLabel", "Nota de compartilhamento")) + "</label>" +
      "  <textarea id=\"monwuiwl-share-note\" class=\"monwuiwl-share-note\" placeholder=\"" + escapeHtml(L("watchlistShareNotePlaceholder", "Você pode deixar uma nota curta se desejar.")) + "\"></textarea>" +
      "  <div class=\"monwuiwl-share-footer\">" +
      "    <button class=\"monwuiwl-share-cancel\" type=\"button\">" + escapeHtml(L("cancel", "Cancelar")) + "</button>" +
      "    <button class=\"monwuiwl-share-submit\" type=\"button\">" + escapeHtml(L("watchlistShareAction", "Compartilhar")) + "</button>" +
      "  </div>" +
      "</div>";

    var closeOverlay = function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    overlay.addEventListener("click", function(event) {
      if (event.target === overlay) closeOverlay();
    });

    var cancelBtn = overlay.querySelector(".monwuiwl-share-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", closeOverlay);

    var submitBtn = overlay.querySelector(".monwuiwl-share-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", function(event) {
        var submitButton = event.currentTarget;
        var checked = (typeof overlay.querySelectorAll === "function") ? overlay.querySelectorAll(".monwuiwl-share-user input:checked") : [];
        var selectedIds = [];
        for (var n = 0; n < checked.length; n++) {
          var val = text(checked[n].value);
          if (val) selectedIds.push(val);
        }

        var noteEl = overlay.querySelector(".monwuiwl-share-note");
        var noteValue = text(noteEl && noteEl.value);

        if (!selectedIds.length) {
          if (typeof window.showMessage === "function") window.showMessage(L("watchlistSelectUsers", "Selecione pelo menos um usuário"), "error");
          return;
        }

        submitButton.disabled = true;
        var selectedUsers = [];
        for (var p = 0; p < users.length; p++) {
          var found = false;
          for (var q = 0; q < selectedIds.length; q++) {
            if (users[p].id === selectedIds[q]) {
              found = true;
              break;
            }
          }
          if (found) selectedUsers.push(users[p]);
        }

        shareWatchlistItem(itemId, selectedUsers, noteValue).then(function() {
          if (typeof window.showMessage === "function") window.showMessage(L("watchlistSharedSuccess", "Item compartilhado com os usuários"), "success");
          closeOverlay();
        })["catch"](function(err) {
          if (typeof window.showMessage === "function") window.showMessage((err && err.message) || L("watchlistShareError", "Falha no compartilhamento"), "error");
        })["finally"](function() {
          submitButton.disabled = false;
        });
      });
    }

    root.appendChild(overlay);
  });
}

function openWatchlistModal(options) {
  ensureStyles();
  var root = ensureModalRoot();
  try {
    if (document.body && root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
  } catch (e) {}
  setVisible(root, true);

  var opt = options || {};
  var initialTab = opt.initialTab
    ? normalizeWatchlistTabKey(opt.initialTab)
    : getWatchlistTabKey(opt.item || opt);

  var state = {
    activeTab: initialTab,
    focusItemId: text(opt.focusItemId || opt.itemId || (opt.item && opt.item.Id))
  };

  root.__state = state;
  return renderWatchlistModal(root, state).then(function() {
    return root;
  });
}

function closeWatchlistModal() {
  var root = document.getElementById(WATCHLIST_MODAL_ID);
  if (!root) return Promise.resolve();
  clearPreviewHoverTimer(root);
  cancelProgressiveWatchlistRender(root);
  try {
    if (root.__previewAbortController && typeof root.__previewAbortController.abort === "function") {
      root.__previewAbortController.abort();
    }
  } catch (e) {}
  setVisible(root, false);
  root.innerHTML = "";
  return Promise.resolve();
}

try {
  window.__monwuiOpenWatchlistModal = openWatchlistModal;
} catch (e) {}

function refreshWatchlistUi() {
  scheduleTabsSliderRefreshSequence();

  var root = document.getElementById(WATCHLIST_MODAL_ID);
  if (root && root.classList.contains("visible")) {
    renderWatchlistModal(root, root.__state || {})["catch"](function() {});
  }
}

function createTabsSliderButton() {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "emby-tab-button " + WATCHLIST_NAV_BUTTON_CLASS;
  button.setAttribute(WATCHLIST_NAV_KIND_ATTR, "legacy");
  button.setAttribute("aria-haspopup", "dialog");
  button.addEventListener("click", function(event) {
    event.preventDefault();
    event.stopPropagation();
    try { button.blur(); } catch (e) {}
    openWatchlistModal({ initialTab: DEFAULT_WATCHLIST_TAB });
  });
  return button;
}

function createMuiTabsSliderButton() {
  var link = document.createElement("a");
  link.className = [
    WATCHLIST_NAV_BUTTON_CLASS,
    WATCHLIST_MUI_NAV_LINK_CLASS,
    "MuiButtonBase-root",
    "MuiButton-root",
    "MuiButton-text",
    "MuiButton-textInherit",
    "MuiButton-sizeMedium",
    "MuiButton-textSizeMedium",
    "MuiButton-colorInherit"
  ].join(" ");
  link.href = getWatchlistNavHref();
  link.setAttribute(WATCHLIST_NAV_KIND_ATTR, "mui");
  link.setAttribute("aria-haspopup", "dialog");
  link.setAttribute("role", "button");
  link.addEventListener("click", function(event) {
    event.preventDefault();
    event.stopPropagation();
    try { link.blur(); } catch (e) {}
    openWatchlistModal({ initialTab: DEFAULT_WATCHLIST_TAB });
  });
  return link;
}

function refreshTabsSliderButton() {
  tabsSliderRefreshQueued = false;
  ensureStyles();
  var slidersList = document.querySelectorAll(".emby-tabs-slider");
  var sliders = [];
  for (var i = 0; i < slidersList.length; i++) sliders.push(slidersList[i]);

  var muiTargets = findMuiHomeTabsTargets();
  if (!sliders.length && !muiTargets.length) return false;

  if (!shouldShowWatchlistTabsSliderButton()) {
    var buttons = document.querySelectorAll("." + WATCHLIST_NAV_BUTTON_CLASS);
    for (var j = 0; j < buttons.length; j++) {
      if (buttons[j].parentNode) buttons[j].parentNode.removeChild(buttons[j]);
    }
    return true;
  }

  var label = L("watchlistOpen", "Minha Lista");
  var legacyMarkup = getWatchlistTabsButtonMarkup(label);
  var muiMarkup = getWatchlistMuiTabsButtonMarkup(label);

  for (var k = 0; k < sliders.length; k++) {
    var slider = sliders[k];
    if (!(slider instanceof HTMLElement)) continue;

    var button = slider.querySelector("." + WATCHLIST_NAV_BUTTON_CLASS + "[" + WATCHLIST_NAV_KIND_ATTR + "=\"legacy\"]");
    if (!button) {
      button = createTabsSliderButton();
      slider.appendChild(button);
    }

    if (button.innerHTML !== legacyMarkup) {
      button.innerHTML = legacyMarkup;
    }
    if (button.getAttribute("title") !== label) {
      button.setAttribute("title", label);
    }
    if (button.getAttribute("aria-label") !== label) {
      button.setAttribute("aria-label", label);
    }
  }

  for (var m = 0; m < muiTargets.length; m++) {
    var target = muiTargets[m];
    var container = target.container;
    var anchor = target.anchor;
    if (!(container instanceof HTMLElement)) continue;

    var link = container.querySelector("." + WATCHLIST_NAV_BUTTON_CLASS + "[" + WATCHLIST_NAV_KIND_ATTR + "=\"mui\"]");
    if (!link) {
      link = createMuiTabsSliderButton();
      if (anchor && anchor.parentElement === container && anchor.nextSibling) {
        container.insertBefore(link, anchor.nextSibling);
      } else if (anchor && anchor.parentElement === container) {
        container.appendChild(link);
      } else {
        container.appendChild(link);
      }
    }

    link.setAttribute("href", getWatchlistNavHref());
    if (link.innerHTML !== muiMarkup) {
      link.innerHTML = muiMarkup;
    }
    if (link.getAttribute("title") !== label) {
      link.setAttribute("title", label);
    }
    if (link.getAttribute("aria-label") !== label) {
      link.setAttribute("aria-label", label);
    }
  }

  return true;
}

function queueTabsSliderRefresh() {
  if (tabsSliderRefreshQueued) return;
  tabsSliderRefreshQueued = true;
  var raf = window.requestAnimationFrame || function(cb) { return setTimeout(cb, 16); };
  raf(function() {
    var hasTabsSlider = refreshTabsSliderButton();
    if (hasTabsSlider || !shouldShowWatchlistTabsSliderButton()) {
      stopTabsSliderObserver();
    }
  });
}

function clearTabsSliderRefreshTimers() {
  if (typeof tabsSliderRefreshTimers.forEach === "function") {
    tabsSliderRefreshTimers.forEach(function(timerId) {
      clearTimeout(timerId);
    });
  }
  if (typeof tabsSliderRefreshTimers.clear === "function") {
    tabsSliderRefreshTimers.clear();
  }
}

function stopTabsSliderObserver() {
  if (tabsSliderObserverStopTimer) {
    clearTimeout(tabsSliderObserverStopTimer);
    tabsSliderObserverStopTimer = 0;
  }
  if (!tabsSliderObserver) return;
  try {
    tabsSliderObserver.disconnect();
  } catch {}
  tabsSliderObserver = null;
}

function isTabsSliderMutationRelevant(mutations) {
  for (var i = 0; i < mutations.length; i++) {
    var mutation = mutations[i];
    if (mutation.type !== "childList") continue;

    var target = mutation.target;
    if (target && target.nodeType === 1) {
      if (typeof target.closest === "function" && target.closest("." + WATCHLIST_NAV_BUTTON_CLASS)) {
        continue;
      }
      var isSlider = false;
      if (typeof target.matches === "function") {
        if (target.matches(".emby-tabs-slider")) isSlider = true;
      }
      if (!isSlider && typeof target.closest === "function") {
        if (target.closest(".emby-tabs-slider")) isSlider = true;
      }
      if (isSlider) return true;

      if (typeof target.matches === "function" && (target.matches("a[href^=\"#/home?tab=\"]") || target.matches("a[href^=\"#/index?tab=\"]"))) {
        return true;
      }
      if (typeof target.querySelector === "function" && (target.querySelector("a[href^=\"#/home?tab=\"]") || target.querySelector("a[href^=\"#/index?tab=\"]"))) {
        return true;
      }
    }

    var added = mutation.addedNodes || [];
    var removed = mutation.removedNodes || [];
    var nodes = [];
    for (var j = 0; j < added.length; j++) nodes.push(added[j]);
    for (var k = 0; k < removed.length; k++) nodes.push(removed[k]);

    for (var m = 0; m < nodes.length; m++) {
      var node = nodes[m];
      if (!node || node.nodeType !== 1) continue;
      if (typeof node.matches === "function" && node.matches(".emby-tabs-slider")) return true;
      if (typeof node.querySelector === "function" && node.querySelector(".emby-tabs-slider")) return true;
      if (typeof node.matches === "function" && (node.matches("a[href^=\"#/home?tab=\"]") || node.matches("a[href^=\"#/index?tab=\"]"))) return true;
      if (typeof node.querySelector === "function" && node.querySelector("a[href^=\"#/home?tab=\"]") || node.querySelector("a[href^=\"#/index?tab=\"]")) return true;
    }
  }
  return false;
}

function startTabsSliderObserver() {
  if (tabsSliderObserver || !shouldShowWatchlistTabsSliderButton()) return;
  if (document.hidden) return;

  var root = document.body || document.documentElement;
  if (!root) return;

  tabsSliderObserver = new MutationObserver(function(mutations) {
    if (!isTabsSliderMutationRelevant(mutations)) return;
    queueTabsSliderRefresh();
  });

  try {
    tabsSliderObserver.observe(root, {
      childList: true,
      subtree: true
    });
  } catch (e) {
    stopTabsSliderObserver();
    return;
  }

  tabsSliderObserverStopTimer = setTimeout(function() {
    stopTabsSliderObserver();
  }, TABS_SLIDER_OBSERVER_WINDOW_MS);
}

function scheduleTabsSliderRefreshSequence() {
  clearTabsSliderRefreshTimers();

  for (var i = 0; i < TABS_SLIDER_ROUTE_REFRESH_DELAYS_MS.length; i++) {
    var delay = TABS_SLIDER_ROUTE_REFRESH_DELAYS_MS[i];
    if (delay === 0) {
      queueTabsSliderRefresh();
    } else {
      (function(d) {
        var timerId = setTimeout(function() {
          if (typeof tabsSliderRefreshTimers["delete"] === "function") tabsSliderRefreshTimers["delete"](timerId);
          queueTabsSliderRefresh();
        }, d);
        if (typeof tabsSliderRefreshTimers.add === "function") tabsSliderRefreshTimers.add(timerId);
      })(delay);
    }
  }

  startTabsSliderObserver();
}

export function installWatchlistTabsButton() {
  if (tabsSliderBindingsInstalled) {
    scheduleTabsSliderRefreshSequence();
    return;
  }
  tabsSliderBindingsInstalled = true;

  var refresh = function() { return scheduleTabsSliderRefreshSequence(); };
  refresh();

  window.addEventListener("pageshow", refresh, { passive: true });
  window.addEventListener("popstate", refresh, { passive: true });
  window.addEventListener("hashchange", refresh, { passive: true });
  window.addEventListener("focus", refresh, { passive: true });
  document.addEventListener("viewshow", refresh, { passive: true });
  document.addEventListener("viewshown", refresh, { passive: true });
  document.addEventListener("visibilitychange", function() {
    if (document.hidden) {
      clearTabsSliderRefreshTimers();
      stopTabsSliderObserver();
      return;
    }
    refresh();
  }, { passive: true });
}

function bootstrapWatchlistUi() {
  try {
    installJellyfinFavoriteMirror();
  } catch {}
  try {
    installWatchlistTabsButton();
  } catch {}
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapWatchlistUi, { once: true });
  } else {
    bootstrapWatchlistUi();
  }
}
