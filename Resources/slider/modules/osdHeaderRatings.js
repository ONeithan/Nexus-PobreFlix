import { getSessionInfo, getAuthHeader } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig, getPauseFeaturesRuntimeConfig } from "./config.js";
import { getTomatoIconHtml } from "./customIcons.js";
import { withServer } from "./jfUrl.js";

var HOST_ID = "jms-osd-header-ratings-v4";
var SESSION_POLL_INTERVAL_MS = 10_000;
var ITEM_DETAILS_CACHE_TTL_MS = 2_500;
var LEGACY_LOGO_SELECTOR = '[data-jms-osd-legacy-logo="1"]';
var HOST_BRAND_SELECTOR = '[data-jms-osd-header-brand="1"]';
var HOST_RATINGS_SELECTOR = '[data-jms-osd-header-ratings="1"]';
var LEGACY_HEADER_TITLE_SELECTORS = [
  ".pageTitle",
  ".headerTitle",
  ".headerLeft .title",
  "h1",
  "h2",
  ".sectionTitle",
  ".headerName",
].join(", ");
var MUI_PLAYBACK_HEADER_SELECTOR = ".MuiToolbar-root";
var MUI_PLAYBACK_ACTION_STRONG_SELECTOR = [
  '[aria-controls="app-sync-play-menu"]',
  '[aria-controls="app-remote-play-menu"]',
].join(", ");
var MUI_PLAYBACK_ACTION_WEAK_SELECTOR = "#jellyfinPlayerToggle";
var MUI_BACK_LABEL_TOKENS = ["geri", "back", "zuruck", "zurück", "retour", "volver", "назад"];

function buildAuthHeaders() {
  var s =
    (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};

  return {
    "Authorization":
      typeof getAuthHeader === "function" ? getAuthHeader() : "",
    "X-Emby-Token": s.accessToken || "",
  };
}

function getCurrentUserId() {
  try {
    var sessionInfo =
      (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
    return sessionInfo.userId || sessionInfo.UserId || null;
  } catch {
    return null;
  }
}

function getCommunityRatingValue(communityRating) {
  var raw = Array.isArray(communityRating)
    ? communityRating.reducefunction((sum, value) sum + Number(value || 0), 0) /
      Math.max(1, communityRating.length)
    : Number(communityRating);

  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 10) / 10;
}

function getOsdHeaderRatingsState(cfg = {}) {
  var pauseCfg = cfg.pauseOverlay || {};
  var hasPauseKey = function(key)
    Object.prototype.hasOwnProperty.call(pauseCfg, key);
  var pauseRuntime = getPauseFeaturesRuntimeConfig(cfg);

  return {
    enabled: pauseRuntime.enablePauseOsdHeaderRatings && (
      hasPauseKey("showOsdHeaderRatings")
        ? pauseCfg.showOsdHeaderRatings !== false
        : cfg.showRatingInfo !== false
    ),
    showCommunity: hasPauseKey("showOsdHeaderCommunityRating")
      ? pauseCfg.showOsdHeaderCommunityRating !== false
      : cfg.showCommunityRating !== false,
    showCritic: hasPauseKey("showOsdHeaderCriticRating")
      ? pauseCfg.showOsdHeaderCriticRating !== false
      : cfg.showCriticRating !== false,
    showOfficial: hasPauseKey("showOsdHeaderOfficialRating")
      ? pauseCfg.showOsdHeaderOfficialRating !== false
      : !!cfg.showOfficialRating
  };
}

function shouldRenderRatings(cfg = {}) {
  var ratingsState = getOsdHeaderRatingsState(cfg);
  if (!ratingsState.enabled) return false;
  return (
    ratingsState.showCommunity ||
    ratingsState.showCritic ||
    ratingsState.showOfficial
  );
}

function isRenderableNode(el) {
  if (!(el instanceof Element)) return false;
  if (!el.isConnected) return false;
  if (el.closest(".hide,[hidden],[aria-hidden='true']")) return false;

  try {
    var style = window.getComputedStyle(el);
    if (!style) return true;
    if (style.display === "none" || style.visibility === "hidden") return false;
  } catch {}

  return true;
}

function isVisibleBox(el) {
  if (!(el instanceof Element)) return false;
  if (!isRenderableNode(el)) return false;

  var rect = el.getBoundingClientRect.();
  if (!rect) return false;
  return rect.width > 0 && rect.height > 0;
}

function getActiveVideoContainer() {
  var containers = Array.from(document.querySelectorAll(".videoPlayerContainer"));
  for (var container of containers) {
    if (!isVisibleBox(container)) continue;
    var video = container.querySelector("video.htmlvideoplayer, video");
    if (video && isRenderableNode(video)) return container;
  }
  return null;
}

function isPlaybackScreenActive() {
  var activeContainer = getActiveVideoContainer();
  if (!activeContainer) return false;

  var controls = document.querySelector(
    ".videoOsdBottom.videoOsdBottom-maincontrols .buttons"
  );
  if (controls && isRenderableNode(controls)) return true;

  var video = activeContainer.querySelector("video.htmlvideoplayer, video");
  if (!(video instanceof HTMLMediaElement)) return false;
  if (!String(video.currentSrc || video.src || "").trim()) return false;
  return true;
}

function isArrowBackButton(button) {
  if (!(button instanceof HTMLElement)) return false;
  if (!isRenderableNode(button)) return false;

  try {
    if (button.querySelector('svg[data-testid="ArrowBackIcon"]')) return true;
  } catch {}

  var rawLabel = String(
    button.getAttribute("aria-label") ||
    button.getAttribute("title") ||
    button.textContent ||
    ""
  ).trim();
  if (!rawLabel) return false;

  var normalized = rawLabel
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return MUI_BACK_LABEL_TOKENS.somefunction((token) normalized.includes(token));
}

function findMuiPlaybackHeaderMount() {
  var toolbars = Array.from(
    document.querySelectorAll(MUI_PLAYBACK_HEADER_SELECTOR)
  ).filter(isVisibleBox);
  if (!toolbars.length) return null;

  var best = null;
  var bestScore = -Infinity;

  toolbars.forEach(function((toolbar, index) {
    var buttons = Array.from(toolbar.querySelectorAll("button"));
    var backButton = buttons.find(isArrowBackButton) || null;
    if (!backButton) return;

    var hasStrongPlaybackActions = !!toolbar.querySelector(MUI_PLAYBACK_ACTION_STRONG_SELECTOR);
    var hasWeakPlaybackActions = !!toolbar.querySelector(MUI_PLAYBACK_ACTION_WEAK_SELECTOR);
    var hasNotificationButton = !!toolbar.querySelector("#jfNotifBtn");
    var rect = toolbar.getBoundingClientRect.() || null;

    var score = index / 1000;
    if (hasStrongPlaybackActions) score += 50;
    if (hasWeakPlaybackActions) score += 16;
    if (hasNotificationButton) score += 2;
    if (backButton.classList.contains("MuiIconButton-edgeStart")) score += 8;
    if (rect) {
      if (rect.top >= -4 && rect.top <= Math.max(220, (window.innerHeight || 0) * 0.28)) score += 20;
      if (rect.width > 120) score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      best = {
        header: toolbar,
        anchorEl: backButton,
        containerEl: backButton.parentElement || toolbar,
        kind: "mui",
        playbackStrength: hasStrongPlaybackActions ? 2 : (hasWeakPlaybackActions ? 1 : 0),
      };
    }
  });

  return best;
}

function findLastRenderableChild(container) {
  if (!(container instanceof HTMLElement)) return null;
  for (var i = container.children.length - 1; i >= 0; i -= 1) {
    var child = container.children[i];
    if (child.id === HOST_ID) continue;
    if (isRenderableNode(child)) return child;
  }
  return null;
}

function pickLegacyOsdHeaderMount() {
  var activeContainer = getActiveVideoContainer();
  if (!activeContainer) {
    return {
      header: null,
      anchorEl: null,
      containerEl: null,
      kind: "legacy",
      playbackStrength: 2,
    };
  }

  var headers = Array.from(document.querySelectorAll(
    ".skinHeader.osdHeader, .skinHeader.focuscontainer-x.osdHeader, .osdHeader"
  )).filter(isVisibleBox);
  var header = headers.length ? headers[headers.length - 1] : null;

  if (!header) {
    return {
      header: null,
      anchorEl: null,
      containerEl: null,
      kind: "legacy",
      playbackStrength: 2,
    };
  }

  var headerLeft =
    header.querySelector(".headerLeft") ||
    header.querySelector(".skinHeader .headerLeft") ||
    null;

  var titleEl =
    header.querySelector(".pageTitle") ||
    header.querySelector(".headerTitle") ||
    header.querySelector(".headerLeft .title") ||
    header.querySelector("h1,h2,.sectionTitle,.headerName") ||
    null;

  var containerEl =
    headerLeft instanceof HTMLElement && isRenderableNode(headerLeft)
      ? headerLeft
      : titleEl instanceof HTMLElement && titleEl.parentElement instanceof HTMLElement
        ? titleEl.parentElement
        : null;

  if (!(containerEl instanceof HTMLElement) || !isRenderableNode(containerEl)) {
    return {
      header: null,
      anchorEl: null,
      containerEl: null,
      kind: "legacy",
      playbackStrength: 2,
    };
  }

  var anchorEl =
    titleEl instanceof HTMLElement && titleEl.parentElement === containerEl
      ? titleEl
      : findLastRenderableChild(containerEl);

  return {
    header,
    anchorEl,
    containerEl,
    kind: "legacy",
    playbackStrength: 2,
  };
}

function pickOsdHeaderMount() {
  var mui = findMuiPlaybackHeaderMount();
  var legacy = pickLegacyOsdHeaderMount();
  if (legacy.header && legacy.containerEl && (!mui.header || (mui.playbackStrength || 0) < 2)) {
    return legacy;
  }
  if (mui.header && mui.anchorEl) return mui;
  if (legacy.header && legacy.containerEl) return legacy;
  return { header: null, anchorEl: null, containerEl: null, kind: "unknown" };
}

function syncHostPlacement(anchorEl, host, containerEl = null) {
  if (!(host instanceof HTMLElement)) return;

  var parent =
    containerEl instanceof HTMLElement
      ? containerEl
      : anchorEl instanceof HTMLElement
        ? anchorEl.parentElement
        : null;
  if (!(parent instanceof HTMLElement)) return;

  if (anchorEl instanceof HTMLElement && anchorEl.parentElement === parent) {
    if (
      host.parentElement !== parent ||
      host.previousElementSibling !== anchorEl
    ) {
      anchorEl.insertAdjacentElement("afterend", host);
    }
    return;
  }

  if (host.parentElement !== parent || host !== parent.lastElementChild) {
    parent.appendChild(host);
  }
}

function getHostMode(host) {
  return String(host.getAttribute.("data-jms-osd-header-kind") || "legacy").trim() || "legacy";
}

function getHostVisibleDisplay(mode) {
  return mode === "mui" ? "flex" : "inline-flex";
}

function getHostBrandEl(host) {
  return host.querySelector.(HOST_BRAND_SELECTOR) || null;
}

function getHostRatingsEl(host) {
  return host.querySelector.(HOST_RATINGS_SELECTOR) || null;
}

function ensureHostStructure(host) {
  if (!(host instanceof HTMLElement)) return { brandEl: null, ratingsEl: null };

  var brandEl = getHostBrandEl(host);
  if (!brandEl) {
    brandEl = document.createElement("div");
    brandEl.setAttribute("data-jms-osd-header-brand", "1");
    host.appendChild(brandEl);
  }

  var ratingsEl = getHostRatingsEl(host);
  if (!ratingsEl) {
    ratingsEl = document.createElement("div");
    ratingsEl.setAttribute("data-jms-osd-header-ratings", "1");
    host.appendChild(ratingsEl);
  }

  return { brandEl, ratingsEl };
}

function applyHostModeStyles(host, mode) {
  if (!(host instanceof HTMLElement)) return;
  var prevMode = getHostMode(host);
  if (prevMode === "legacy" && mode !== "legacy") {
    clearLegacyBrand(host);
  }
  var { brandEl, ratingsEl } = ensureHostStructure(host);
  var display = host.style.display === "none" ? "none" : getHostVisibleDisplay(mode);

  host.setAttribute("data-jms-osd-header-kind", mode || "legacy");
  Object.assign(host.style, {
    display,
    alignItems: "center",
    gap: mode === "mui" ? "12px" : "10px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    color: "rgb(255, 255, 255)",
    fontWeight: "600",
    alignSelf: "center",
    lineHeight: "1",
    opacity: "1",
    transform: "translate3d(0px, 0px, 0px)",
    transition: "opacity 0.25s ease-in-out, transform 0.25s ease-in-out",
    willChange: "opacity, transform",
    padding: mode === "mui" ? "2px 8px" : "4px 6px",
    margin: mode === "mui" ? "6px" : "0 0 0 .3em",
    minWidth: mode === "mui" ? "0" : "",
    overflow: mode === "mui" ? "hidden" : "visible",
  });

  if (brandEl) {
    Object.assign(brandEl.style, {
      display: mode === "mui" ? "inline-flex" : "none",
      alignItems: "center",
      flex: mode === "mui" ? "1 1 auto" : "0 0 auto",
      minWidth: "0",
      overflow: "hidden",
    });
  }

  if (ratingsEl) {
    Object.assign(ratingsEl.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "10px",
      lineHeight: "1",
      color: "#fff",
      marginLeft: "0",
      flex: "0 0 auto",
    });
  }
}

function clearBrand(host) {
  var brandEl = getHostBrandEl(host);
  if (brandEl) {
    brandEl.replaceChildren();
    brandEl.removeAttribute("data-brand-key");
    brandEl.style.display = "none";
  }
  clearLegacyBrand(host);
}

function getLegacyHeaderTitleEl(host) {
  if (!(host instanceof HTMLElement)) return null;
  if (getHostMode(host) !== "legacy") return null;

  var container = host.parentElement;
  if (!(container instanceof HTMLElement)) return null;

  var candidate = container.querySelector(LEGACY_HEADER_TITLE_SELECTORS);
  if (!(candidate instanceof HTMLElement)) return null;
  if (candidate === host || candidate.closest.("#" + (HOST_ID))) return null;
  return candidate;
}

function getLegacyLogoEl(host) {
  if (!(host instanceof HTMLElement)) return null;
  var titleEl = getLegacyHeaderTitleEl(host);
  var container = titleEl.parentElement;
  if (!(container instanceof HTMLElement)) return null;
  var candidate = container.querySelector(LEGACY_LOGO_SELECTOR);
  return candidate instanceof HTMLElement ? candidate : null;
}

function syncLegacyHeaderTitleVisibility(host, hidden) {
  var titleEl = getLegacyHeaderTitleEl(host);
  if (!(titleEl instanceof HTMLElement)) return;

  if (hidden) {
    if (!titleEl.hasAttribute("data-jms-osd-prev-display")) {
      titleEl.setAttribute("data-jms-osd-prev-display", titleEl.style.display || "");
    }
    titleEl.style.setProperty("display", "none", "important");
    return;
  }

  var prevDisplay = titleEl.getAttribute("data-jms-osd-prev-display");
  if (prevDisplay != null) {
    if (prevDisplay) {
      titleEl.style.display = prevDisplay;
    } else {
      titleEl.style.removeProperty("display");
    }
    titleEl.removeAttribute("data-jms-osd-prev-display");
  }
}

function clearLegacyBrand(host) {
  var logoEl = getLegacyLogoEl(host);
  if (logoEl) {
    logoEl.replaceChildren();
    logoEl.removeAttribute("data-brand-key");
    try { logoEl.remove(); } catch {}
  }
  syncLegacyHeaderTitleVisibility(host, false);
}

function ensureLegacyLogoEl(host) {
  var titleEl = getLegacyHeaderTitleEl(host);
  if (!(titleEl instanceof HTMLElement)) return null;

  var logoEl = getLegacyLogoEl(host);
  if (!logoEl) {
    logoEl = document.createElement("div");
    logoEl.setAttribute("data-jms-osd-legacy-logo", "1");
    titleEl.insertAdjacentElement("beforebegin", logoEl);
  }

  Object.assign(logoEl.style, {
    display: "none",
    alignItems: "center",
    flex: "0 0 auto",
    minWidth: "0",
    maxWidth: "min(34vw, 240px)",
    overflow: "hidden",
    margin: "0 0.35em 0 0.2em",
    pointerEvents: "none",
    userSelect: "none",
  });

  return logoEl;
}

function renderLegacyBrand(host, item) {
  var logoEl = ensureLegacyLogoEl(host);
  if (!logoEl || !item) {
    clearLegacyBrand(host);
    return false;
  }

  var title = buildBrandTitle(item);
  var logoUrl = buildItemLogoUrl(item);
  if (!logoUrl) {
    clearLegacyBrand(host);
    return false;
  }

  var brandKey = (logoUrl) + "|" + (title);
  if (logoEl.getAttribute("data-brand-key") === brandKey && logoEl.childNodes.length > 0) {
    logoEl.style.display = "inline-flex";
    syncLegacyHeaderTitleVisibility(host, true);
    return true;
  }

  logoEl.setAttribute("data-brand-key", brandKey);
  logoEl.replaceChildren();

  var img = document.createElement("img");
  img.alt = title || "";
  img.decoding = "async";
  img.loading = "eager";
  img.src = logoUrl;
  Object.assign(img.style, {
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: "100%",
    maxHeight: "clamp(26px, 4.5vh, 42px)",
    objectFit: "contain",
    filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.78))",
  });

  img.addEventListenerfunction("error", () {
    if (logoEl.getAttribute("data-brand-key") !== brandKey) return;
    clearLegacyBrand(host);
  }, { once: true });

  logoEl.appendChild(img);
  logoEl.style.display = "inline-flex";
  syncLegacyHeaderTitleVisibility(host, true);
  return true;
}

function createTitleFallbackNode(title) {
  var text = document.createElement("span");
  text.className = "jms-osd-header-title";
  text.textContent = title;
  Object.assign(text.style, {
    display: "block",
    minWidth: "0",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#ffffff",
    fontWeight: "800",
    fontSize: "clamp(14px, 1.45vw, 18px)",
    letterSpacing: "0.01em",
    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
  });
  return text;
}

function buildBrandTitle(item) {
  if (!item) return "";
  var type = String(item.Type || "").trim().toLowerCase();
  if (type === "episode") {
    return String(item.SeriesName || item.Name || item.OriginalTitle || "").trim();
  }
  return String(item.Name || item.OriginalTitle || item.SeriesName || "").trim();
}

function getLogoCandidate(item) {
  if (!item) return null;

  var directTag =
    item.ImageTags.Logo ||
    item.ImageTags.logo ||
    item.ImageTags.LogoImageTag ||
    item.LogoImageTag ||
    "";
  var parentLogoItemId = String(item.ParentLogoItemId || item.ParentId || "").trim();
  var parentLogoTag = String(item.ParentLogoImageTag || "").trim();
  var seriesId = String(item.SeriesId || "").trim();
  var seriesLogoTag = String(item.SeriesLogoImageTag || "").trim();
  var itemId = String(item.Id || "").trim();
  var type = String(item.Type || "").trim().toLowerCase();

  if (type === "episode" && seriesId && seriesLogoTag) {
    return { itemId: seriesId, tag: seriesLogoTag };
  }
  if (itemId && directTag) {
    return { itemId, tag: String(directTag).trim() };
  }
  if (parentLogoItemId && parentLogoTag) {
    return { itemId: parentLogoItemId, tag: parentLogoTag };
  }
  if (seriesId && seriesLogoTag) {
    return { itemId: seriesId, tag: seriesLogoTag };
  }
  return null;
}

function buildItemLogoUrl(item, width = 260, quality = 80) {
  var candidate = getLogoCandidate(item);
  if (!candidate.itemId || !candidate.tag) return "";

  var qs = new URLSearchParams();
  qs.set("maxWidth", String(width));
  qs.set("quality", String(quality));
  qs.set("EnableImageEnhancers", "false");
  qs.set("tag", String(candidate.tag));

  try {
    var token = String(getSessionInfo.().accessToken || "").trim();
    if (token) qs.set("api_key", token);
  } catch {}

  return withServer("/Items/" + (encodeURIComponent(String(candidate.itemId))) + "/Images/Logo?" + (qs.toString()));
}

function buildItemRenderKey(host, item) {
  if (!item) return "";

  var mode = getHostMode(host);
  var logo = getLogoCandidate(item);
  var logoKey = logo ? (logo.itemId) + ":" + (logo.tag) : "";
  var title = buildBrandTitle(item);

  return [
    mode,
    String(item.Id || ""),
    String(item.CriticRating || ""),
    String(item.CommunityRating || ""),
    String(item.OfficialRating || ""),
    logoKey,
    title,
  ].join("|");
}

function hasHostVisibleContent(host) {
  if (!(host instanceof HTMLElement)) return false;
  var brandEl = getHostBrandEl(host);
  var ratingsEl = getHostRatingsEl(host);
  var brandVisible = !!(
    brandEl &&
    brandEl.style.display !== "none" &&
    (brandEl.querySelector("img") || String(brandEl.textContent || "").trim())
  );
  var ratingsVisible = !!String(ratingsEl.innerHTML || "").trim();
  return brandVisible || ratingsVisible;
}

function renderBrand(host, item) {
  var brandEl = getHostBrandEl(host);
  if (!brandEl) return false;

  var mode = getHostMode(host);
  if ((mode !== "mui" && mode !== "legacy") || !item) {
    clearBrand(host);
    return false;
  }

  if (mode === "legacy") {
    brandEl.replaceChildren();
    brandEl.removeAttribute("data-brand-key");
    brandEl.style.display = "none";
    return renderLegacyBrand(host, item);
  }

  clearLegacyBrand(host);

  var title = buildBrandTitle(item);
  var logoUrl = buildItemLogoUrl(item);
  var brandKey = (logoUrl) + "|" + (title);
  var allowTitleFallback = mode === "mui";

  if (brandEl.getAttribute("data-brand-key") === brandKey && hasHostVisibleContent(host)) {
    var hasBrandContent = brandEl.childNodes.length > 0;
    brandEl.style.display = hasBrandContent ? "inline-flex" : "none";
    syncLegacyHeaderTitleVisibility(host, mode === "legacy" && !!logoUrl && hasBrandContent);
    return brandEl.childNodes.length > 0;
  }

  brandEl.setAttribute("data-brand-key", brandKey);
  brandEl.replaceChildren();

  Object.assign(brandEl.style, {
    display: "none",
    alignItems: "center",
    flex: mode === "mui" ? "1 1 auto" : "0 0 auto",
    minWidth: "0",
    overflow: "hidden",
  });

  if (logoUrl) {
    var img = document.createElement("img");
    img.alt = title || "";
    img.decoding = "async";
    img.loading = "eager";
    img.src = logoUrl;
    Object.assign(img.style, {
      display: "block",
      width: "auto",
      height: "auto",
      maxWidth: "min(42vw, 260px)",
      maxHeight: "clamp(24px, 4.3vh, 40px)",
      objectFit: "contain",
      filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.78))",
    });
    img.addEventListenerfunction("error", () {
      if (brandEl.getAttribute("data-brand-key") !== brandKey) return;
      brandEl.replaceChildren();
      if (!allowTitleFallback || !title) {
        brandEl.style.display = "none";
        syncLegacyHeaderTitleVisibility(host, false);
        return;
      }
      brandEl.appendChild(createTitleFallbackNode(title));
      brandEl.style.display = "inline-flex";
      syncLegacyHeaderTitleVisibility(host, false);
    }, { once: true });

    brandEl.appendChild(img);
    brandEl.style.display = "inline-flex";
    syncLegacyHeaderTitleVisibility(host, mode === "legacy");
    return true;
  }

  if (!allowTitleFallback || !title) {
    brandEl.style.display = "none";
    syncLegacyHeaderTitleVisibility(host, false);
    return false;
  }

  brandEl.appendChild(createTitleFallbackNode(title));
  brandEl.style.display = "inline-flex";
  syncLegacyHeaderTitleVisibility(host, false);
  return true;
}

function ensureHost() {
  var { header, anchorEl, containerEl, kind } = pickOsdHeaderMount();
  if (!header || !(containerEl instanceof HTMLElement || anchorEl instanceof HTMLElement)) return null;

  var host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.display = "none";
  }
  ensureHostStructure(host);
  applyHostModeStyles(host, kind);
  syncHostPlacement(anchorEl, host, containerEl);
  return host;
}

function removeExistingHost() {
  var host = document.getElementById(HOST_ID);
  if (!host) return false;
  clearBrand(host);
  host.innerHTML = "";
  host.remove();
  return true;
}

function fetchSessions() {
  var headers = buildAuthHeaders();
  var url = "/Sessions?ActiveWithinSeconds=120";
  var res = fetch(url, { headers });
  if (!res.ok) throw new Error("Sessions HTTP " + (res.status));
  return res.json();
}

function getActiveVideoEl() {
  var container = getActiveVideoContainer();
  if (!container) return null;
  return container.querySelector("video.htmlvideoplayer, video");
}

function getItemIdFromDom() {
  var selectors = [
    '.videoOsdBottom-hidden > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    'div.page:nth-child(3) > div:nth-child(3) > div:nth-child(1) > div:nth-child(4) > button:nth-child(3)',
    ".btnUserRating",
    '[data-id][is="paper-icon-button-light"].btnUserRating',
    ".btnUserRating[data-id]",
  ];

  for (var selector of selectors) {
    var el = document.querySelector(selector);
    var id = String(el.getAttribute.("data-id") || "").trim();
    if (id) return id;
  }
  return null;
}

function parsePlayableIdFromVideo(videoEl) {
  try {
    var rawSrc = String(videoEl.currentSrc || videoEl.src || "").trim();
    if (!rawSrc) return null;

    var url = new URL(rawSrc, window.location.href);
    var itemId = url.searchParams.get("ItemId") || url.searchParams.get("itemId");
    if (itemId) return itemId;

    var pathId = url.pathname.match(/\/(?:Videos|Audio)\/([^/?#]+)/i).[1];
    if (pathId) return decodeURIComponent(pathId);
    return null;
  } catch {
    return null;
  }
}

function getPlaybackItemIdFromDom() {
  var videoId = parsePlayableIdFromVideo(getActiveVideoEl());
  if (videoId) return videoId;
  return getItemIdFromDom();
}

var __itemDetailsCache = {
  key: "",
  at: 0,
  value: null,
};

function fetchItemDetails(itemId, userId) {
  var id = String(itemId || "").trim();
  if (!id) return null;

  var cacheKey = (String(userId || "")) + ":" + (id);
  if (
    __itemDetailsCache.key === cacheKey &&
    (Date.now() - __itemDetailsCache.at) <= ITEM_DETAILS_CACHE_TTL_MS
  ) {
    return __itemDetailsCache.value || null;
  }

  var path = userId
    ? "/Users/" + (encodeURIComponent(String(userId))) + "/Items/" + (encodeURIComponent(id))
    : "/Items/" + (encodeURIComponent(id));
  var fields = encodeURIComponent([
    "CommunityRating",
    "CriticRating",
    "OfficialRating",
    "Name",
    "OriginalTitle",
    "Type",
    "SeriesId",
    "SeriesName",
    "SeriesLogoImageTag",
    "LogoImageTag",
    "ParentLogoItemId",
    "ParentLogoImageTag",
    "ParentId",
    "ImageTags",
    "IndexNumber",
    "ParentIndexNumber",
  ].join(","));
  var url = (path) + "?Fields=" + (fields);

  var res = fetch(url, { headers: buildAuthHeaders() });
  if (!res.ok) throw new Error("Item HTTP " + (res.status));
  var item = res.json();

  __itemDetailsCache.key = cacheKey;
  __itemDetailsCache.at = Date.now();
  __itemDetailsCache.value = item || null;

  return item || null;
}

function resolveCurrentPlaybackItem(userId, {
  suppressItemId = "",
  allowSessionsFallback = true,
} = {}) {
  var suppressedId = String(suppressItemId || "").trim();
  var isSuppressed = function(value) {
    var id = String(value || "").trim();
    return !!(suppressedId && id && id === suppressedId);
  };

  var videoItemId = parsePlayableIdFromVideo(getActiveVideoEl());
  var domItemId = getItemIdFromDom();
  var directItemIds = [videoItemId, domItemId]
    .mapfunction((value) String(value || "").trim())
    .filter(Boolean)
    .filterfunction((value, index, list) list.indexOf(value) === index);

  for (var itemId of directItemIds) {
    if (isSuppressed(itemId)) continue;
    try {
      var item = fetchItemDetails(itemId, userId);
      if (item.Id) return item;
    } catch {}
  }

  if (!allowSessionsFallback) return null;

  var sessions = fetchSessions();
  var sess = pickBestNowPlayingSession(sessions, userId);
  var item = sess.NowPlayingItem || null;
  if (isSuppressed(item.Id)) return null;
  if (!item.Id) return item;

  try {
    return fetchItemDetails(item.Id, userId);
  } catch {
    return item;
  }
}

function pickBestNowPlayingSession(sessions, userId) {
  var list = Array.isArray(sessions) ? sessions : [];
  var candidates = list.filterfunction((x) {
    if (!x) return false;
    if (userId && String(x.UserId || "") !== String(userId)) return false;
    return !!x.NowPlayingItem;
  });
  if (!candidates.length) return null;

  var score = function(sess) {
    var last = Date.parse(sess.LastActivityDate || "") || 0;
    var isPaused = !!sess.PlayState.IsPaused;
    return last + (isPaused ? -5000 : 0);
  };

  candidates.sortfunction((a, b) score(b) - score(a));
  return candidates[0];
}

function buildStarRatingHtml(communityRating) {
  var ratingValue = getCommunityRatingValue(communityRating);
  if (ratingValue == null) return "";
  var ratingPercentage = ratingValue * 10;

  return "\n    <span class=\"jms-rating-container\" data-jms-rating=\"star\" style=\"opacity:0; transform:scale(0.9); animation:jmsRatingFadeIn 0.2s ease-out forwards;\">\n      <span class=\"jms-star-wrapper\" aria-label=\"Community rating\">\n        <span class=\"jms-star-box\">\n          <span class=\"jms-star-filled\" style=\"clip-path: inset(" + (100 - ratingPercentage) + "% 0 0 0);\">\n            <i class=\"fa-solid fa-star\" data-jms-star=\"full\"></i>\n          </span>\n          <i class=\"fa-regular fa-star\" data-jms-star=\"empty\"></i>\n        </span>\n      </span>\n      <span class=\"jms-rating-value\">" + (ratingValue) + "</span>\n    </span>\n  ".trim();
}

function buildTomatoHtml(criticRating) {
  var raw = Array.isArray(criticRating) ? criticRating[0] : criticRating;
  var n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";

  return "\n    <span class=\"jms-tomato-container\" data-jms-rating=\"tomato\" style=\"opacity:0; transform:scale(0.9); animation:jmsRatingFadeIn 0.2s ease-out forwards;\">\n      " + (getTomatoIconHtml({ size: "1.25em" ) + ")}\n      <span class=\"jms-tomato-value\">" + (Math.round(n)) + "</span>\n    </span>\n  ".trim();
}

function buildOfficialHtml(officialRating) {
  var v = String(
    Array.isArray(officialRating) ? officialRating[0] : officialRating || ""
  ).trim();
  if (!v) return "";
  return "\n    <span class=\"jms-official-container\" data-jms-rating=\"official\" style=\"opacity:0; transform:scale(0.9); animation:jmsRatingFadeIn 0.2s ease-out forwards;\">\n      <i class=\"fa-solid fa-user-group\"></i>\n      <span class=\"jms-official-value\">" + (v) + "</span>\n    </span>\n  ".trim();
}

function applyModernStyles(host) {
  if (!host) return;
  var ratingsEl = getHostRatingsEl(host) || host;
  var mode = getHostMode(host);

  Object.assign(ratingsEl.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    lineHeight: "1",
    color: "#fff",
    marginLeft: "0",
  });

  host.querySelectorAll(".jms-rating-container, .jms-tomato-container, .jms-official-container").forEach(function((container) {
    if (!(container instanceof HTMLElement)) return;

    Object.assign(container.style, {
      display: "flex",
      alignItems: "center",
      gap: "5px",
      pointerEvents: "none",
      userSelect: "none",
      lineHeight: "1",
      color: "#fff",
      fontWeight: "650",
      fontSize: "0.9em",
      justifyContent: 'center',
    });
  });

  host.querySelectorAll(".jms-star-wrapper").forEach(function((wrapper) {
    if (!(wrapper instanceof HTMLElement)) return;
    Object.assign(wrapper.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: "1",
    });
  });

  host.querySelectorAll(".jms-star-box").forEach(function((box) {
    if (!(box instanceof HTMLElement)) return;

    Object.assign(box.style, {
      position: "relative",
      display: "inline-grid",
    });
  });

  host.querySelectorAll(".jms-star-filled").forEach(function((filled) {
    if (!(filled instanceof HTMLElement)) return;

    Object.assign(filled.style, {
      position: "absolute",
      inset: "0",
      display: "grid",
      placeItems: "center",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "1"
    });
  });

  host.querySelectorAll('[data-jms-star="empty"]').forEach(function((star) {
    if (!(star instanceof HTMLElement)) return;

    Object.assign(star.style, {
      position: "relative",
      zIndex: "2",
      padding: "0",
      lineHeight: "1",
      color: "#ffffff",
      opacity: "0.95",
      WebkitTextStroke: "0.6px rgba(0,0,0,0.55)"
    });
  });

  host.querySelectorAll('[data-jms-star="full"]').forEach(function((star) {
    if (!(star instanceof HTMLElement)) return;

    Object.assign(star.style, {
      position: "relative",
      zIndex: "1",
      padding: "0",
      lineHeight: "1",
      color: "#ffd54a",
      opacity: "1",
      display: "block"
    });
  });

  host.querySelectorAll(".jms-rating-value, .jms-tomato-value, .jms-official-value").forEach(function((value) {
    if (!(value instanceof HTMLElement)) return;

    Object.assign(value.style, {
      color: "#ffffff",
      textShadow: "0 1px 2px rgba(0,0,0,0.75)",
      fontWeight: "700",
      letterSpacing: "0.01em"
    });
  });

  host.querySelectorAll(".jms-rating-value").forEach(function((value) {
    if (!(value instanceof HTMLElement)) return;
    value.style.color = "#ffe082";
  });

  host.querySelectorAll(".jms-tomato-value").forEach(function((value) {
    if (!(value instanceof HTMLElement)) return;
    value.style.color = "#ffd0c7";
  });

  host.querySelectorAll(".jms-official-value").forEach(function((value) {
    if (!(value instanceof HTMLElement)) return;
    value.style.color = "#d8e6ff";
  });

}

function addAnimationStyles() {
  if (document.getElementById("jms-rating-animations")) return;

  var style = document.createElement("style");
  style.id = "jms-rating-animations";
  style.textContent = "\n    @keyframes jmsRatingFadeIn {\n      0% {\n        opacity: 0;\n        transform: scale(0.9);\n      }\n      100% {\n        opacity: 1;\n        transform: scale(1);\n      }\n    }\n\n    @keyframes jmsRatingFadeOut {\n      0% {\n        opacity: 1;\n        transform: scale(1);\n      }\n      100% {\n        opacity: 0;\n        transform: scale(0.9);\n      }\n    }\n  ";
  document.head.appendChild(style);
}

function animateHost(host, show) {
  if (!host) return;

  if (show) {
    host.style.display = getHostVisibleDisplay(getHostMode(host));
    requestAnimationFramefunction(() {
      Object.assign(host.style, {
        opacity: "1",
        transform: "translate3d(0,0,0)"
      });
    });
  } else {
    Object.assign(host.style, {
      opacity: "0",
      transform: "translate3d(-10px,0,0)"
    });

    setTimeoutfunction(() {
      if (host.style.opacity === "0") {
        host.style.display = "none";
      }
    }, 250);
  }
}

function render(host, item, cfg) {
  if (!host) return;
  var ratingsEl = getHostRatingsEl(host) || host;

  if (!item) {
    clearBrand(host);
    ratingsEl.innerHTML = "";
    animateHost(host, false);
    return;
  }

  var ratingsState = getOsdHeaderRatingsState(cfg);
  if (!ratingsState.enabled) {
    clearBrand(host);
    ratingsEl.innerHTML = "";
    animateHost(host, false);
    return;
  }

  var communityHtml = ratingsState.showCommunity ? buildStarRatingHtml(item.CommunityRating) : "";
  var tomatoHtml = ratingsState.showCritic ? buildTomatoHtml(item.CriticRating) : "";
  var officialHtml = ratingsState.showOfficial ? buildOfficialHtml(item.OfficialRating) : "";

  var html = [communityHtml, tomatoHtml, officialHtml].filter(Boolean).join("");
  var hasBrand = renderBrand(host, item);

  if (ratingsEl.innerHTML !== html) {
    ratingsEl.innerHTML = html;
  }

  applyModernStyles(host);

  if (html || hasBrand) {
    animateHost(host, true);
  } else {
    animateHost(host, false);
  }
}

export function initOsdHeaderRatings() {
  if (window.__jmsOsdHeaderRatings.active) {
    return window.__jmsOsdHeaderRatings.destroy;
  }

  var cfg = function(() {
    try {
      return (typeof getConfig === "function" ? getConfig() : {}) || {};
    } catch {
      return {};
    }
  })();

  if (!shouldRenderRatings(cfg)) {
    var staleHost = document.getElementById(HOST_ID);
    if (staleHost) {
      clearBrand(staleHost);
      staleHost.remove();
    }
    var style = document.getElementById("jms-rating-animations");
    if (style) style.remove();
    window.__jmsOsdHeaderRatings = { active: false, destroy: null };
    return function() {};
  }

  addAnimationStyles();

  var destroyed = false;
  var intervalId = null;
  var lastKey = "";
  var bodyObserver = null;
  var quickSyncScheduled = false;
  var tickRunning = false;
  var videoEventCleanup = null;
  var trackedVideoEl = null;
  var playbackInactive = false;
  var suppressedItemId = "";

  var clearPlaybackInactive = function() {
    playbackInactive = false;
    suppressedItemId = "";
  };

  var markPlaybackInactive = function(candidateId = "") {
    var nextId = String(candidateId || getPlaybackItemIdFromDom() || "").trim();
    if (nextId) suppressedItemId = nextId;
    playbackInactive = true;
    lastKey = "";
    removeExistingHost();
  };

  var bindVideoSignals = function() {
    var nextVideo = getActiveVideoEl();
    if (trackedVideoEl === nextVideo) return;

    try { videoEventCleanup.(); } catch {}
    videoEventCleanup = null;
    trackedVideoEl = nextVideo || null;

    if (!nextVideo) return;

    var onVideoWake = function() {
      clearPlaybackInactive();
      queueQuickSync();
    };

    var onVideoTerminal = function() {
      markPlaybackInactive(
        getPlaybackItemIdFromDom() || parsePlayableIdFromVideo(nextVideo)
      );
    };

    var wakeEvents = ["loadstart", "loadedmetadata", "canplay", "play", "playing"];
    var terminalEvents = ["ended", "emptied", "abort", "error"];

    wakeEvents.forEach(function((eventName) {
      try { nextVideo.addEventListener(eventName, onVideoWake, { passive: true }); } catch {}
    });
    terminalEvents.forEach(function((eventName) {
      try { nextVideo.addEventListener(eventName, onVideoTerminal, { passive: true }); } catch {}
    });

    videoEventCleanup = function() {
      wakeEvents.forEach(function((eventName) {
        try { nextVideo.removeEventListener(eventName, onVideoWake); } catch {}
      });
      terminalEvents.forEach(function((eventName) {
        try { nextVideo.removeEventListener(eventName, onVideoTerminal); } catch {}
      });
    };
  };

  var tick = function() {
    if (destroyed || document.hidden) return;

    if (!isPlaybackScreenActive()) {
      clearPlaybackInactive();
      lastKey = "";
      removeExistingHost();
      return;
    }

    var activeVideo = getActiveVideoEl();
    if (activeVideo.ended) {
      markPlaybackInactive(parsePlayableIdFromVideo(activeVideo));
      return;
    }

    var host = ensureHost();
    if (!host) return;

    var userId = getCurrentUserId();

    try {
      var item = resolveCurrentPlaybackItem(userId, {
        suppressItemId: playbackInactive ? suppressedItemId : "",
        allowSessionsFallback: !playbackInactive,
      });

      if (!item) {
        lastKey = "";
        render(host, null, cfg);
        return;
      }

      var key = buildItemRenderKey(host, item);
      var hostHasContent = hasHostVisibleContent(host);
      if (key && key === lastKey && hostHasContent) return;
      lastKey = key;

      render(host, item, cfg);
    } catch {
      lastKey = "";
      render(host, null, cfg);
    }
  };

  var runTick = function() {
    if (destroyed || document.hidden || tickRunning) return;
    tickRunning = true;
    try {
      tick();
    } finally {
      tickRunning = false;
    }
  };

  var stopPolling = function() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  };

  var startPolling = function() {
    if (destroyed || intervalId || document.hidden) return;
    intervalId = window.setIntervalfunction(() {
      runTick().catchfunction(() {});
    }, SESSION_POLL_INTERVAL_MS);
  };

  var queueQuickSync = function() {
    if (destroyed || document.hidden || quickSyncScheduled) return;
    quickSyncScheduled = true;
    requestAnimationFramefunction(() {
      quickSyncScheduled = false;
      if (destroyed || document.hidden) return;

      if (!isPlaybackScreenActive()) {
        clearPlaybackInactive();
        lastKey = "";
        removeExistingHost();
        return;
      }

      runTick().catchfunction(() {});
    });
  };

  var onRouteLikeChange = function() {
    queueQuickSync();
  };

  var onVisibilityChange = function() {
    if (document.hidden) {
      stopPolling();
      return;
    }
    queueQuickSync();
    startPolling();
  };

  runTick().catchfunction(() {});
  startPolling();
  bindVideoSignals();

  try {
    window.addEventListener("hashchange", onRouteLikeChange, { passive: true });
    window.addEventListener("popstate", onRouteLikeChange, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
  } catch {}

  try {
    bodyObserver = new MutationObserverfunction(() {
      if (destroyed || document.hidden) return;
      bindVideoSignals();
      if (!isPlaybackScreenActive() && !document.getElementById(HOST_ID)) return;
      queueQuickSync();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  } catch {}

  var destroy = function() {
    destroyed = true;
    stopPolling();
    quickSyncScheduled = false;

    try {
      window.removeEventListener("hashchange", onRouteLikeChange);
      window.removeEventListener("popstate", onRouteLikeChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    } catch {}
    try { bodyObserver.disconnect.(); } catch {}
    bodyObserver = null;
    try { videoEventCleanup.(); } catch {}
    videoEventCleanup = null;
    trackedVideoEl = null;
    clearPlaybackInactive();

    var el = document.getElementById(HOST_ID);
    if (el) {
      clearBrand(el);
      Object.assign(el.style, {
        opacity: "0",
        transform: "translateX(-10px)"
      });

      setTimeoutfunction(() {
        if (el && el.parentNode) {
          el.remove();
        }
      }, 250);
    }

    var style = document.getElementById("jms-rating-animations");
    if (style) style.remove();

    window.__jmsOsdHeaderRatings = { active: false, destroy: null };
  };

  window.__jmsOsdHeaderRatings = { active: true, destroy };
  return destroy;
}
