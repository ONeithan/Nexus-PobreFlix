import { getSessionInfo, getEmbyHeaders, makeApiRequest, updateFavoriteStatus } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig, getDeviceProfileAuto, getHomeSectionsRuntimeConfig } from './config.js';
import { getLanguageLabels } from "../language/index.js";
import { attachMiniPosterHover } from "./studioHubsUtils.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import {
  keepManagedSectionsBelowNative,
  bindManagedSectionsBelowNative,
  waitForNativeHomeSectionStability,
  waitForVisibleHomeSections
} from "./homeSectionNative.js";
import {
  enqueueManagedSectionRender,
  registerManagedHomeRowAnchor,
  waitForManagedHomeRowRelease,
  waitForManagedSectionDependencyCompletion,
  waitForManagedSectionGate
} from "./homeSectionChain.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import { withServer } from "./jfUrl.js";
import { ensureWatchlistLoaded, getCachedWatchlistMembership, getWatchlistButtonText } from "./watchlist.js";
import {
  buildStudioHubLogoUrl,
  buildStudioHubVideoUrl,
  fetchStudioHubVisibility,
  fetchStudioHubManualEntries,
  fetchStudioHubVideoEntries,
  findStudioHubVideoEntry,
  sanitizeStudioHubHiddenNames,
  sanitizeStudioHubOrderNames
} from "./studioHubsShared.js";

var config = getConfig();
var PLACEHOLDER_URL = resolveSliderAssetHref(
  config.placeholderImage || "/slider/src/images/placeholder.png"
);
var ALIASES = {
  "Marvel Studios": ["marvel studios","marvel","marvel entertainment","marvel studios llc"],
  "Pixar": ["pixar","pixar animation studios","disney pixar"],
  "Walt Disney Pictures": ["walt disney","walt disney pictures"],
  "Disney+": ["disney+","disney plus","disney+ originals","disney plus originals","disney+ studio"],
  "DC": ["DC Entertainment","dc entertainment","dc"],
  "Warner Bros. Pictures": ["warner bros","warner bros.","warner bros pictures","warner bros. pictures","warner brothers"],
  "Lucasfilm Ltd.": ["lucasfilm","lucasfilm ltd","lucasfilm ltd."],
  "Columbia Pictures": ["columbia","columbia pictures","columbia pictures industries"],
  "Paramount Pictures": ["paramount","paramount pictures","paramount pictures corporation"],
  "DreamWorks Animation": ["dreamworks","dreamworks animation","dreamworks pictures"]
};
var CORE_TOKENS = {
  "Marvel Studios": ["marvel"],
  "Pixar": ["pixar"],
  "Walt Disney Pictures": ["walt","disney"],
  "Disney+": ["disney","plus"],
  "DC": ["dc","entertainment"],
  "Warner Bros. Pictures": ["warner"],
  "Lucasfilm Ltd.": ["lucasfilm"],
  "Columbia Pictures": ["columbia"],
  "Paramount Pictures": ["paramount"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks", "animation"]
};

var LOGO_H = 160;
var CACHE_TTL = 6 * 60 * 60 * 1000;
var MAP_TTL   = 30 * 24 * 60 * 60 * 1000;
var IMG_TTL   = 7  * 24 * 60 * 60 * 1000;
var LS_KEY    = "studioHub_cache_v5";
var MAP_KEY   = "studioHub_nameIdMap_v5";
var IMG_KEY   = "studioHub_backdropMap_v1";
var STUDIO_ITEMS_LIMIT = 120;
var nbase = function(s) (s||"").toLowerCase().replace(/[().,™©®\-:_+]/g," ").replace(/\s+/g," ").trim();
var strip = function(s) {
  var out = " " + nbase(s) + " ";
  for (var w of JUNK_WORDS) out = out.replace(new RegExp("\\\\s" + (w) + "\\\\s", "g"), " ");
  return out.trim();
};
var toks = function(s) strip(s).split(" ").filter(Boolean);
var DEFAULT_ORDER = [
  "Marvel Studios","Pixar","Walt Disney Pictures","Disney+","DC",
  "Warner Bros. Pictures","Lucasfilm Ltd.","Columbia Pictures","Paramount Pictures",
  "Netflix","DreamWorks Animation"
];
var CANONICALS = new Map(DEFAULT_ORDER.map(function(n) [n.toLowerCase(), n]));
var DEFAULT_NAME_KEYS = new Set(DEFAULT_ORDER.map(function(name) String(name || "").trim().toLowerCase()));
var JUNK_WORDS = ["ltd","ltd.","llc","inc","inc.","company","co.","corp","corp.","the","pictures","studios","animation","film","films","pictures.","studios."];
var ALIAS_TO_CANON = function(() {
  var m = new Map();
  for (var [canon, aliases] of Object.entries(ALIASES)) {
    m.set(canon.toLowerCase(), canon);
    for (var a of aliases) m.set(String(a).toLowerCase(), canon);
  }
  return m;
})();

var __studioHubBusy = false;
var __fetchAbort = null;
var __studioHubsMounting = false;
var __studioHubsMountedOnce = false;
var __studioHubsRetryTo = null;

function setStudioHubsReady(done) {
  var next = done === true;
  var prev = false;
  try { prev = window.__jmsStudioHubsReady === true; } catch {}
  try { window.__jmsStudioHubsReady = next; } catch {}
  if (next && !prev) {
    try { document.dispatchEvent(new Event("jms:studio-hubs-ready")); } catch {}
  }
}

function stringToColor(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  var h = Math.abs(hash % 360);
  var isCool = (h >= 200 && h <= 280);
  var isWarm = (h < 45 || h > 300);
  var s = isCool ? 55 : isWarm ? 65 : 50;

  return {
    bg: "linear-gradient(145deg,\n          hsla(" + (h) + ", " + (s) + "%, 14%, 0.97),\n          hsla(" + (h) + ", " + (s - 10) + "%, 9%, 0.98),\n          hsla(" + ((h + 25) % 360) + ", " + (s - 15) + "%, 6%, 1))",
    shadow: "hsla(" + (h) + ", " + (s + 10) + "%, 35%, 0.40)"
  };
}

function getActiveHomePage() {
  return document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
}

function hasMountedStudioHubsSection() {
  var page = getActiveHomePage();
  var section = page.querySelector.("#studio-hubs");
  var row = section.querySelector.(".hub-row");
  return !!section && !!row;
}

function upsertImg(card, className) {
  var img = card.querySelector('img.hub-img');
  if (!img) {
    img = document.createElement('img');
    img.className = className;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.style.opacity = '0';
    img.addEventListenerfunction('load', () {
      card.classList.remove('skeleton');
      img.style.opacity = '1';
    }, { once: true });
    card.appendChild(img);
  } else {
    img.className = className;
  }
  return img;
}

function toCanonicalStudioName(name) {
  if (!name) return null;
  var key = String(name).toLowerCase();
  return ALIAS_TO_CANON.get(key) || CANONICALS.get(key) || null;
}

function ensurePreviewButton(card, studioName, studioId, userId) {
  if (!card.querySelector('.hub-preview-btn')) {
    createPreviewButton(card, studioName, studioId, userId);
  }
}

function mergeOrder(defaults, custom) {
  var out = [];
  var seen = new Set();
  for (var n of (custom || [])) {
    var canon = toCanonicalStudioName(n) || n;
    var k = canon.toLowerCase();
    if (!seen.has(k)) { out.push(canon); seen.add(k); }
  }
  for (var n of defaults) {
    var k = n.toLowerCase();
    if (!seen.has(k)) { out.push(n); seen.add(k); }
  }
  return out;
}

function nameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isDefaultStudioHub(name) {
  return DEFAULT_NAME_KEYS.has(nameKey(name));
}

var LOGO_BASE = "./slider/src/images/studios/";
var LOCAL_EXTS = [".webp"];
var LOGO_CACHE_KEY = "studioHub_logoUrlCache_v1";
var LOGO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
var VIDEO_EXTS = [".mp4"];
var HOVER_VIDEO_TIMEOUT = 4000;
var MIN_RATING = Number.isFinite(config.studioHubsMinRating) ? config.studioHubsMinRating : 6.5;
var LOCAL_STUDIO_LOGO_SLUGS = new Set([
  "columbia-pictures",
  "dc",
  "disney",
  "dreamworks-animation",
  "lucasfilm-ltd",
  "marvel-studios",
  "netflix",
  "paramount-pictures",
  "pixar",
  "universal",
  "walt-disney-pictures",
  "warner-bros-pictures"
]);
var LOCAL_STUDIO_VIDEO_SLUGS = new Set([
  "columbia-pictures",
  "dc",
  "disney",
  "dreamworks-animation",
  "lucasfilm-ltd",
  "marvel-studios",
  "netflix",
  "paramount-pictures",
  "pixar",
  "universal",
  "walt-disney-pictures",
  "warner-bros-pictures"
]);

var getRating = function(it) Number(it.CommunityRating || it.CriticRating || 0);
function randomSample(arr, n) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, n));
}
function selectTopNWithMinRating(items, min = MIN_RATING, count = 5) {
  var pool = items.filter(function(it) getRating(it) >= min);
  if (pool.length <= count) return pool;
  return randomSample(pool, count);
}

function isLocalStudioAssetUrl(url) {
  var clean = String(url || "");
  return clean.includes("/slider/src/images/studios/") || clean.includes("./slider/src/images/studios/");
}
function getStudioAssetSlugFromUrl(url) {
  var clean = String(url || "");
  var match = clean.match(/\/([^/?#]+)\.[a-z0-9]+(?:\?|#|$)/i);
  return String(match.[1] || "").trim().toLowerCase();
}
function hasKnownLocalStudioLogo(url) {
  var slug = getStudioAssetSlugFromUrl(url);
  return !!slug && LOCAL_STUDIO_LOGO_SLUGS.has(slug);
}
function deriveVideoCandidatesFromLogo(logoUrl) {
  if (!isLocalStudioAssetUrl(logoUrl) || !hasKnownLocalStudioLogo(logoUrl)) return [];
  var slug = getStudioAssetSlugFromUrl(logoUrl);
  if (!slug || !LOCAL_STUDIO_VIDEO_SLUGS.has(slug)) return [];
  return VIDEO_EXTS.map(function(ext) withVer((LOGO_BASE) + (slug) + (ext)));
}

function markCardReady(card, { textOnly = false } = {}) {
  if (!card) return;
  card.classList.remove("skeleton");
  card.classList.toggle("hub-card-textonly", textOnly);
  setStudioHubsReady(true);
}

function clearCardImage(card) {
  var img = card.querySelector.("img.hub-img");
  if (!img) return;
  try { img.removeAttribute("src"); } catch {}
  try { img.remove(); } catch {}
}
var __hubPreviewPopover = null;
var __hubPreviewCloseTimer = null;
var __userInteracted = false;
window.addEventListenerfunction('pointermove', () { __userInteracted = true; }, { once: true, passive: true });

function ensurePreviewPopover() {
  if (__hubPreviewPopover) return __hubPreviewPopover;
  var pop = document.createElement('div');
  pop.className = 'hub-preview-popover';
  pop.innerHTML = "\n    <div class=\"hub-preview-header\">\n      <h3 class=\"hub-preview-title\"></h3>\n      <button class=\"hub-preview-close\" aria-label=\"Close\">×</button>\n    </div>\n    <div class=\"hub-preview-body\"></div>\n  ";
  document.body.appendChild(pop);
  pop.querySelector('.hub-preview-close').addEventListener('click', hidePreviewPopover);
  pop.addEventListenerfunction('mouseenter', () {
    if (__hubPreviewCloseTimer) { clearTimeout(__hubPreviewCloseTimer); __hubPreviewCloseTimer = null; }
  });
  pop.addEventListenerfunction('mouseleave', () scheduleHidePopover());
  __hubPreviewPopover = pop;
  var autoHide = function() hidePreviewPopover();
  window.addEventListener('beforeunload', autoHide);
  document.addEventListenerfunction('visibilitychange', () { if (document.hidden) autoHide(); });
  window.addEventListener('hashchange', autoHide);
  return pop;
}

 var OPEN_INTENT_MS   = Number(config.studioHubsOpenIntentMs || 180);
 var CLOSE_GRACE_MS   = Number(config.studioHubsCloseGraceMs || 300);
 function scheduleHidePopover(delay = CLOSE_GRACE_MS) {
  if (__hubPreviewCloseTimer) clearTimeout(__hubPreviewCloseTimer);
  __hubPreviewCloseTimer = setTimeoutfunction(() { hidePreviewPopover(); }, delay);
}

function hidePreviewPopover() {
  if (__hubPreviewCloseTimer) { clearTimeout(__hubPreviewCloseTimer); __hubPreviewCloseTimer = null; }
  if (!__hubPreviewPopover) return;
  try { __hubPreviewPopover.__cleanup.(); __hubPreviewPopover.__cleanup = null; } catch {}
  __hubPreviewPopover.classList.remove('visible');
  setTimeoutfunction(() {
    if (!__hubPreviewPopover.classList.contains('visible')) {
      __hubPreviewPopover.style.display = 'none';
    }
  }, 200);
}

function setPopoverContent(studioName, items) {
  var pop = ensurePreviewPopover();
  var title = pop.querySelector('.hub-preview-title');
  var body = pop.querySelector('.hub-preview-body');

  title.textContent = (studioName) + " - " + ((config.languageLabels.previewModalTitle || 'Mais Bem Avaliados'));
  pop.querySelector('.hub-preview-close').setAttribute('aria-label', config.languageLabels.closeButton || 'Fechar');

  body.innerHTML = '';
  var { serverId } = getSessionInfo();

  items.slice(0, 5).forEach(function(item) {
    var itemEl = document.createElement('div');
    itemEl.className = 'hub-preview-item';
    var posterUrl = buildPosterUrl(item, 300, 95);
    var ratingVal = item.CommunityRating || item.CriticRating;
    var rating = (typeof ratingVal === "number") ? ratingVal.toFixed(1) : (config.languageLabels.noRating || 'N/A');
    var isFavorite = getCachedWatchlistMembership(item.Id, item.UserData.IsFavorite);
    item.UserData = item.UserData || {};
    item.UserData.IsFavorite = isFavorite;
    var favAddText = getWatchlistButtonText(item, false);
    var favRemoveText = getWatchlistButtonText(item, true);
    itemEl.innerHTML = "\n      <img class=\"hub-preview-poster\" src=\"" + (posterUrl || PLACEHOLDER_URL) + "\" alt=\"" + (item.Name) + "\" loading=\"lazy\">\n      <div class=\"hub-preview-info\">\n        <div class=\"hub-preview-item-title\">" + (item.Name) + "</div>\n        <div class=\"hub-preview-rating\">\n          ⭐ " + (rating) + "\n          <button class=\"favorite-heart " + (isFavorite ? 'favorited' : '') + "\"\n                  data-item-id=\"" + (item.Id) + "\"\n                  aria-label=\"" + (isFavorite ? favRemoveText : favAddText) + "\">\n            " + (isFavorite ? '❤️' : '🤍') + "\n          </button>\n        </div>\n      </div>\n    ";
    var favoriteBtn = itemEl.querySelector('.favorite-heart');
    favoriteBtn.addEventListenerfunction('click', (e) {
      e.stopPropagation();
      if (favoriteBtn.__busy) return;
      favoriteBtn.__busy = true;
      var next = !isFavorite;
      var ok = toggleFavorite(item.Id, next, favoriteBtn, item);
      favoriteBtn.__busy = false;
      if (ok) {
        isFavorite = next;
        item.UserData = item.UserData || {};
        item.UserData.IsFavorite = isFavorite;
        favoriteBtn.classList.toggle('favorited', isFavorite);
        favoriteBtn.innerHTML = isFavorite ? '❤️' : '🤍';
        favoriteBtn.setAttribute('aria-label', isFavorite ? favRemoveText : favAddText);
      }
    });

    ensureWatchlistLoaded().thenfunction(() {
      var synced = getCachedWatchlistMembership(item.Id, isFavorite);
      isFavorite = synced;
      item.UserData.IsFavorite = synced;
      favoriteBtn.classList.toggle('favorited', synced);
      favoriteBtn.innerHTML = synced ? '❤️' : '🤍';
      favoriteBtn.setAttribute('aria-label', synced ? favRemoveText : favAddText);
    }).catchfunction(() {});

    itemEl.addEventListenerfunction('click', (e) {
      if (!e.target.closest('.favorite-heart')) {
        e.preventDefault();
        e.stopPropagation();
        var backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
        try {
          openDetailsModal({
            itemId: item.Id,
            serverId,
            preferBackdropIndex: backdropIndex,
            originEl: itemEl.querySelector(".hub-preview-poster") || itemEl,
          });
          hidePreviewPopover();
        } catch (err) {
          console.warn("openDetailsModal failed (studio hub preview item):", err);
        }
      }
    });

    attachMiniPosterHover(itemEl, item);
    body.appendChild(itemEl);
  });

  return pop;
}

function toggleFavorite(itemId, isFavorite, buttonElement, item) {
  var favAddText = getWatchlistButtonText(item, false);
  var favRemoveText = getWatchlistButtonText(item, true);
  try {
    updateFavoriteStatus(itemId, isFavorite, { item });
    if (isFavorite) {
      buttonElement.innerHTML = '❤️';
      buttonElement.classList.add('favorited');
      buttonElement.setAttribute('aria-label', favRemoveText);
    } else {
      buttonElement.innerHTML = '🤍';
      buttonElement.classList.remove('favorited');
      buttonElement.setAttribute('aria-label', favAddText);
    }
    buttonElement.style.transform = 'scale(1.2)';
    setTimeoutfunction(() { buttonElement.style.transform = 'scale(1)'; }, 200);
    return true;
  } catch (error) {
    console.error('Erro na operação de favorito:', error);
    buttonElement.style.animation = 'shake 0.5s';
    setTimeoutfunction(() { buttonElement.style.animation = ''; }, 500);
    return false;
  }
}

function positionPopover(anchorEl, pop) {
  var margin = 8;
  var docEl = document.documentElement;
  var vw = docEl.clientWidth;
  var vh = docEl.clientHeight;
  var r = anchorEl.getBoundingClientRect();
  var prevDisplay = pop.style.display;
  pop.style.display = 'block';
  pop.style.opacity = '0';
  pop.style.pointerEvents = 'none';

  var pw = Math.min(pop.offsetWidth || 360, vw - 2 * margin);
  var ph = Math.min(pop.offsetHeight || 300, vh - 2 * margin);

  var spaceRight  = vw - r.right  - margin;
  var spaceLeft   = r.left        - margin;
  var spaceBottom = vh - r.bottom - margin;
  var spaceTop    = r.top         - margin;

  var placement = 'right';
  if (spaceRight >= pw) placement = 'right';
  else if (spaceLeft >= pw) placement = 'left';
  else if (spaceBottom >= ph) placement = 'bottom';
  else if (spaceTop >= ph) placement = 'top';
  else {
    var candidates = [
      { side: 'right',  size: spaceRight },
      { side: 'left',   size: spaceLeft },
      { side: 'bottom', size: spaceBottom },
      { side: 'top',    size: spaceTop },
    ].sortfunction((a,b) b.size - a.size);
    placement = candidates[0].side;
  }

  var left, top;
  switch (placement) {
    case 'right':  left = r.right + margin;          top = r.top + (r.height - ph) / 2; break;
    case 'left':   left = r.left - margin - pw;      top = r.top + (r.height - ph) / 2; break;
    case 'bottom': left = r.left + (r.width - pw)/2; top = r.bottom + margin;           break;
    case 'top':    left = r.left + (r.width - pw)/2; top = r.top - margin - ph;         break;
  }

  left = Math.max(margin, Math.min(left, vw - margin - pw));
  top  = Math.max(margin, Math.min(top,  vh - margin - ph));
  pop.style.left = (Math.round(left + window.scrollX)) + "px";
  pop.style.top  = (Math.round(top  + window.scrollY)) + "px";
  pop.style.display = prevDisplay || 'block';
  pop.style.opacity = '';
  pop.style.pointerEvents = '';
}

function showPreviewPopover(anchorEl, studioName, items) {
  var pop = setPopoverContent(studioName, items);
  pop.style.position = 'absolute';
  pop.style.maxWidth = 'min(520px, 90vw)';
  pop.style.maxHeight = 'min(70vh, 600px)';
  pop.style.overflow = 'auto';
  pop.style.display = 'block';
  pop.classList.remove('visible');

  var reposition = function() positionPopover(anchorEl, pop);
  requestAnimationFramefunction(() {
    reposition();
    requestAnimationFramefunction(() { pop.classList.add('visible'); });
  });

  var onWin = function() reposition();
  window.addEventListener('resize', onWin, { passive: true });
  window.addEventListener('scroll', onWin, { passive: true });

  var row = anchorEl.closest('.hub-row');
  var onRow = function() reposition();
  if (row) row.addEventListener('scroll', onRow, { passive: true });

  var closeIfLeft = function() {
    if (!anchorEl.matches(':hover') && !pop.matches(':hover')) {
      scheduleHidePopover(CLOSE_GRACE_MS);
      var cancelOnReHover = function() {
        if (__hubPreviewCloseTimer && (anchorEl.matches(':hover') || pop.matches(':hover'))) {
          clearTimeout(__hubPreviewCloseTimer);
          __hubPreviewCloseTimer = null;
        }
      };
      pop.addEventListener('mouseenter', cancelOnReHover, { once: true });
      anchorEl.addEventListener('mouseenter', cancelOnReHover, { once: true });
    }
  };
  anchorEl.addEventListener('mouseleave', closeIfLeft, { passive: true });
  var onPopLeave = function() scheduleHidePopover(CLOSE_GRACE_MS);
  pop.addEventListener('mouseleave', onPopLeave, { passive: true });

  var cleanup = function() {
    window.removeEventListener('resize', onWin);
    window.removeEventListener('scroll', onWin);
    if (row) row.removeEventListener('scroll', onRow);
    anchorEl.removeEventListener('mouseleave', closeIfLeft);
    pop.removeEventListener('mouseleave', onPopLeave);
  };

  pop.__cleanup = cleanup;
}

function createPreviewButton(card, studioName, studioId, userId) {
  var btn = document.createElement('button');
  btn.className = 'hub-preview-btn';
  btn.setAttribute('aria-label', (studioName) + " " + ((config.languageLabels.previewButtonLabel || "Pré-visualização")));
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';

  var isFetching = false;
  var studioItems = null;
  var hoverOpenTimer = null;

  function ensureItems() {
    if (studioItems || isFetching) return;
    isFetching = true;
    btn.style.opacity = '0.5';
    try {
      var signal = __fetchAbort ? __fetchAbort.signal : null;
      var fetched = fetchStudioItemsViaUsers(studioId, studioName, userId, signal);
      studioItems = selectTopNWithMinRating(fetched, MIN_RATING, 5);
    } catch (err) {
      console.error('Não foi possível carregar os dados de pré-visualização:', err);
      studioItems = [];
    } finally {
      isFetching = false;
      btn.style.opacity = '';
    }
  }

  btn.addEventListenerfunction('click', (e) {
    e.preventDefault();
    e.stopPropagation();
    ensureItems();
    if (studioItems && studioItems.length) { showPreviewPopover(btn, studioName, studioItems); }
  });

  btn.addEventListenerfunction('mouseenter', () {
    if (!__userInteracted) return;
    if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
    ensureItems();
    hoverOpenTimer = setTimeoutfunction(() {
      if (btn.matches(':hover') && studioItems && studioItems.length) {
        showPreviewPopover(btn, studioName, studioItems);
      }
    }, OPEN_INTENT_MS);
  });

  btn.addEventListenerfunction('mouseleave', () {
    if (hoverOpenTimer) { clearTimeout(hoverOpenTimer); hoverOpenTimer = null; }
    scheduleHidePopover(160);
  });

  btn.addEventListenerfunction('focus', () {
    ensureItems();
    if (studioItems && studioItems.length) { showPreviewPopover(btn, studioName, studioItems); }
  });
  btn.addEventListenerfunction('blur', () scheduleHidePopover(160));

  card.appendChild(btn);
  return btn;
}

function setupHoverVideo(card, options = {}) {
  if (!card) return;

  try {
    card.__hoverVideoCleanup.();
  } catch {}
  card.__hoverVideoCleanup = null;

  var oldVideo = card.querySelector("video.hub-video");
  if (oldVideo) {
    try { oldVideo.pause(); } catch {}
    try { oldVideo.removeAttribute("src"); oldVideo.load.(); } catch {}
    try { oldVideo.remove(); } catch {}
  }

  var logoUrl = options.logoUrl || null;
  var customVideoUrl = options.customVideoUrl || null;
  var studioName = options.studioName || "";
  var studioId = options.studioId || "";
  var userId = options.userId || "";

  var derivedVideoUrls = logoUrl ? deriveVideoCandidatesFromLogo(logoUrl) : [];
  var playableUrl = customVideoUrl || derivedVideoUrls[0] || null;
  if (!playableUrl) return;

  var vidEl = null;

  var ensureVideo = function() {
    if (vidEl) return vidEl;
    vidEl = document.createElement("video");
    vidEl.className = "hub-video";
    vidEl.src = playableUrl;
    
    var vol = config.studioHubsVolume;
    if (vol === 'muted' || vol === 0) {
      vidEl.muted = true;
      vidEl.volume = 0;
    } else {
      vidEl.muted = false;
      vidEl.volume = Math.max(0, Math.min(1, vol / 100));
    }

    vidEl.loop = true;
    vidEl.playsInline = true;
    vidEl.preload = "auto";
    vidEl.setAttribute("aria-hidden", "true");
    card.style.position = card.style.position || "relative";
    card.appendChild(vidEl);
    if (studioName && studioId && userId) {
      ensurePreviewButton(card, studioName, studioId, userId);
    }
    return vidEl;
  };

  var play = function() {
    var v = ensureVideo();
    v.currentTime = 0;
    v.style.opacity = "1";
    v.play().catchfunction(() {});
  };
  var stop = function(remove = false) {
    if (!vidEl) return;
    try { vidEl.pause(); } catch {}
    vidEl.style.opacity = "0";
    if (remove) {
      var v = vidEl;
      vidEl = null;
      try { v.removeAttribute('src'); v.load.(); } catch {}
      try { v.remove(); } catch {}
    }
  };

  var onMouseEnter = function() { if (__userInteracted) play(); };
  var onMouseLeave = function() stop(false);
  var onFocus = function() play();
  var onBlur = function() stop(false);
  var stopAndRemove = function() stop(true);
  card.addEventListener("mouseenter", onMouseEnter);
  card.addEventListener("mouseleave", onMouseLeave);
  card.addEventListener("focus", onFocus);
  card.addEventListener("blur", onBlur);
  card.addEventListener("click", stopAndRemove);
  card.addEventListener("pointerdown", stopAndRemove);

  var onRouteOrHide = function() stop(true);
  var onVisibilityChange = function() {
    if (document.hidden) onRouteOrHide();
  };
  window.addEventListener("hashchange", onRouteOrHide);
  window.addEventListener("beforeunload", onRouteOrHide);
  document.addEventListener("visibilitychange", onVisibilityChange);

  card.__hoverVideoCleanup = function() {
    stop(true);
    card.removeEventListener("mouseenter", onMouseEnter);
    card.removeEventListener("mouseleave", onMouseLeave);
    card.removeEventListener("focus", onFocus);
    card.removeEventListener("blur", onBlur);
    card.removeEventListener("click", stopAndRemove);
    card.removeEventListener("pointerdown", stopAndRemove);
    window.removeEventListener("hashchange", onRouteOrHide);
    window.removeEventListener("beforeunload", onRouteOrHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}


function withVer(url, v = "1") { return (url) + (url.includes("?") ? "&" : "?") + "v=" + (encodeURIComponent(v)); }
function loadLogoCache() {
  try { var raw = localStorage.getItem(LOGO_CACHE_KEY); if (!raw) return {}; var { ts, data } = JSON.parse(raw); if (!ts || Date.now() - ts > LOGO_CACHE_TTL) return {}; return data || {}; } catch { return {}; }
}
function saveLogoCache(map) {
  try {
    var entries = Object.entries(map);
    var MAX = 100;
    var trimmed = entries.slice(-MAX);
    var out = Object.fromEntries(trimmed);
    localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: out }));
  } catch {}
}
function slugify(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[().,™©®'’"&+]/g, " ")
    .replace(/\s+and\s+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function tryLocalLogo(name) {
  var slug = slugify(name);
  if (!slug || !LOCAL_STUDIO_LOGO_SLUGS.has(slug)) return null;
  var ext = LOCAL_EXTS[0];
  if (!ext) return null;
  var base = LOGO_BASE + slug;
  return withVer((base) + (ext));
}
function isCachedLocalStudioLogo(url) {
  return isLocalStudioAssetUrl(url) && hasKnownLocalStudioLogo(url);
}
function sanitizeLogoCacheEntry(cache, key) {
  if (!cache || !key || !cache[key]) return null;
  if (isCachedLocalStudioLogo(cache[key])) return cache[key];
  delete cache[key];
  saveLogoCache(cache);
  return null;
}
function resolveLogoUrl(name) {
  var cache = loadLogoCache();
  var cachedUrl = sanitizeLogoCacheEntry(cache, name);
  if (cachedUrl) return cachedUrl;
  var localUrl = tryLocalLogo(name);
  if (localUrl) { cache[name] = localUrl; saveLogoCache(cache); return localUrl; }
  return null;
}

function fetchStudios(signal) {
  var url = "/Studios?Limit=300&Recursive=true&SortBy=SortName&SortOrder=Ascending";
  var res = fetch(withServer(url), { headers: hJSON(), signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error("Não foi possível carregar os estúdios");
  var data = res.json();
  var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
  return items.map(function(s) ({
    Id: s.Id,
    Name: s.Name,
    ImageTags: s.ImageTags || {},
    PrimaryImageTag: s.PrimaryImageTag || (s.ImageTags.Primary) || null
  }));
}

function fetchStudioItemsViaUsers(studioId, studioName, userId, signal) {
  var ratingPart = Number.isFinite(MIN_RATING) ? "&MinCommunityRating=" + (MIN_RATING) : "";
  var common = "StartIndex=0&Limit=" + (STUDIO_ITEMS_LIMIT) + "&Fields=PrimaryImageAspectRatio,ImageTags,BackdropImageTags,CommunityRating,CriticRating&Recursive=true&SortOrder=Descending" + (ratingPart);
  var urls = [
    "/Users/" + (userId) + "/Items?" + (common) + "&IncludeItemTypes=Movie,Series&StudioIds=" + (encodeURIComponent(studioId)),
    "/Users/" + (userId) + "/Items?" + (common) + "&IncludeItemTypes=Movie,Series&Studios=" + (encodeURIComponent(studioName))
  ];
  for (var u of urls) {
    try {
      var r = fetch(withServer(u), { headers: hJSON(), signal, credentials: 'same-origin' });
      if (!r.ok) continue;
      var data = r.json();
      var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
      if (items.length) return items;
    } catch {}
  }
  return [];
}

function hJSON() {
  return getEmbyHeaders({ "Accept":"application/json" });
}

function buildBackdropUrl(item, index = 0) {
  var tags = item.BackdropImageTags || [];
  var tag = tags[index];
  if (!tag) return null;
  return withServer("/Items/" + (item.Id) + "/Images/Backdrop/" + (index) + "?tag=" + (encodeURIComponent(tag)) + "&quality=90");
}
function buildPosterUrl(item, height = 300, quality = 95) {
  var tag = item.ImageTags.Primary || item.PrimaryImageTag;
  if (!tag) return null;
  return withServer("/Items/" + (item.Id) + "/Images/Primary?tag=" + (encodeURIComponent(tag)) + "&fillHeight=" + (height) + "&quality=" + (quality));
}
function pickRandom(arr) { return arr.length ? arr[Math.floor(Math.random()*arr.length)] : null; }

function getHiddenStudioNameSet(manualEntries = []) {
  var liveConfig = getConfig();
  if (liveConfig.forceGlobalUserSettings) {
    var globalHidden = Array.isArray(liveConfig.studioHubsHidden) ? liveConfig.studioHubsHidden : [];
    return new Set(sanitizeStudioHubHiddenNames(globalHidden, manualEntries).map(nameKey));
  }

  try {
    var profile = getDeviceProfileAuto();
    var visibility = fetchStudioHubVisibility({ profile });
    return new Set(sanitizeStudioHubHiddenNames(visibility.hiddenNames || [], manualEntries).map(nameKey));
  } catch {
    return new Set();
  }
}

function getStudioOrderList(manualEntries = []) {
  var liveConfig = getConfig();
  var globalOrder = Array.isArray(liveConfig.studioHubsOrder) ? liveConfig.studioHubsOrder : [];

  if (liveConfig.forceGlobalUserSettings) {
    return mergeOrder(DEFAULT_ORDER, sanitizeStudioHubOrderNames(globalOrder, manualEntries));
  }

  try {
    var profile = getDeviceProfileAuto();
    var visibility = fetchStudioHubVisibility({ profile });
    var userOrder = Array.isArray(visibility.orderNames) && visibility.orderNames.length
      ? visibility.orderNames
      : globalOrder;
    return mergeOrder(DEFAULT_ORDER, sanitizeStudioHubOrderNames(userOrder, manualEntries));
  } catch {
    return mergeOrder(DEFAULT_ORDER, sanitizeStudioHubOrderNames(globalOrder, manualEntries));
  }
}

function chooseBackdropForStudio(studio, userId, signal, options = {}) {
  var map = loadCache(IMG_KEY, IMG_TTL) || {};
  var cached = map[studio.Id];
  if (cached.itemId && Number.isInteger(cached.index)) {
    var itemId = cached.itemId;
    var idx    = cached.index;
    var tag    = cached.tag || null;
    var url = tag
      ? withServer("/Items/" + (itemId) + "/Images/Backdrop/" + (idx) + "?tag=" + (encodeURIComponent(tag)) + "&quality=90")
      : withServer("/Items/" + (itemId) + "/Images/Backdrop/" + (idx) + "?quality=90");
    return { itemId, index: idx, url };
  }

  var items = Array.isArray(options.items)
    ? options.items
    : fetchStudioItemsViaUsers(studio.Id, studio.Name, userId, signal);
  if (!items.length) return null;

  var withBd = items.filter(function(it) Array.isArray(it.BackdropImageTags) && it.BackdropImageTags.length);
  var candidate = pickRandom(withBd.length ? withBd : items);
  if (!candidate) return null;

  var idx = 0;
  var url = buildBackdropUrl(candidate, idx);

  if (!url) {
    var purl = buildPosterUrl(candidate);
    if (!purl) return null;
    var payload = { studioId: studio.Id, itemId: candidate.Id, index: -1, tag: candidate.ImageTags.Primary || candidate.PrimaryImageTag || null };
    var newMap = { ...map, [studio.Id]: payload };
    saveCache(IMG_KEY, newMap);
    return { itemId: candidate.Id, index: -1, url: purl };
  }

  var tag = (candidate.BackdropImageTags||[])[idx] || null;
  var payload = { studioId: studio.Id, itemId: candidate.Id, index: idx, tag };
  var newMap = { ...map, [studio.Id]: payload };
  saveCache(IMG_KEY, newMap);

  return { itemId: candidate.Id, index: idx, url };
}

function loadCache(k, ttl) {
  try {
    var raw = localStorage.getItem(k);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    if (Date.now() - obj.ts > ttl) return null;
    return obj.data;
  } catch { return null; }
}
function saveCache(k, data) {
  try {
    var d = data;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      var MAX = 300;
      var ent = Object.entries(d);
      if (ent.length > MAX) d = Object.fromEntries(ent.slice(-MAX));
    }
    localStorage.setItem(k, JSON.stringify({ ts: Date.now(), data: d }));
  } catch {}
}

function buildStudioHref(studioId, serverId) {
  return "#/list?studioId=" + (encodeURIComponent(studioId)) + "${serverId ? "&serverId=${encodeURIComponent(serverId)}" : \"\"}";
}

function createBackdropCardShell(title, studio, serverId) {
  var a = document.createElement("a");
  a.className = "hub-card skeleton";
  a.dataset.hub = title;
  a.href = studio.Id ? buildStudioHref(studio.Id, serverId) : "javascript:void(0)";
  a.setAttribute("aria-label", title);

  var overlay = document.createElement("div");
  overlay.className = "hub-overlay";

  var label = document.createElement("div");
  label.className = "hub-title-text";
  label.textContent = title;

  overlay.appendChild(label);
  a.appendChild(overlay);
  return a;
}

function cleanupStudioHubsSection() {
  clearTimeout(__studioHubsRetryTo);
  __studioHubsRetryTo = null;
  __studioHubBusy = false;
  __studioHubsMounting = false;
  __studioHubsMountedOnce = false;
  setStudioHubsReady(false);

  if (__fetchAbort) {
    try { __fetchAbort.abort(); } catch {}
  }
  __fetchAbort = null;

  document.querySelectorAll("#studio-hubs").forEach(function((section) {
    try {
      section.querySelectorAll('video.hub-video').forEach(function(v) {
        try { v.pause(); } catch {}
        try { v.removeAttribute('src'); v.load.(); } catch {}
      });
    } catch {}

    try { section.remove(); } catch {}
  });
}

export function cleanupStudioHubs() {
  cleanupStudioHubsSection();
}

export function renderStudioHubs() {
  var runtimeConfig = getConfig.() || config || {};
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(runtimeConfig);
  if (!homeSectionsConfig.enableStudioHubs) {
    cleanupStudioHubsSection();
    return;
  }
  if (__studioHubBusy) return;
  __studioHubBusy = true;
  setStudioHubsReady(false);

  if (__fetchAbort) { try { __fetchAbort.abort(); } catch {} }
  __fetchAbort = new AbortController();

  try {
    var indexPage =
      document.querySelector("#indexPage:not(.hide)") ||
      document.querySelector("#homePage:not(.hide)");
    if (!indexPage) {
      return;
    }
     var row = ensureContainer(indexPage);
    if (!row) {
      return;
    }
    var section = row.closest("#studio-hubs");
     setupScroller(row);
     resetHubRowScrollPosition(row);
     row.innerHTML = "";
     var { serverId, userId } = getSessionInfo();
     serverId = serverId || localStorage.getItem("serverId") || sessionStorage.getItem("serverId") || null;
     var shells = {};

    var manualEntries = fetchStudioHubManualEntries().catchfunction(() []);
    var hiddenNames = getHiddenStudioNameSet(manualEntries);
    var userOrder = getStudioOrderList(manualEntries);
    var manualOrder = (manualEntries || [])
      .map(function(entry) String(entry.name || entry.Name || "").trim())
      .filter(Boolean);
    var effectiveOrder = mergeOrder(manualOrder, userOrder);
    var visibleOrder = effectiveOrder.filter(function(name) !hiddenNames.has(nameKey(name)));
    if (!visibleOrder.length) {
      if (section) section.style.display = "none";
      setStudioHubsReady(true);
      return;
    }

    var maxCards = Number.isFinite(config.studioHubsCardCount) ? config.studioHubsCardCount : visibleOrder.length;
    var wanted = visibleOrder.slice(0, Math.max(1, maxCards));
    var sharedVideos = config.studioHubsHoverVideo
      ? fetchStudioHubVideoEntries().catchfunction(() [])
      : [];

    for (var desired of wanted) {
      var existing = row.querySelector(".hub-card[data-hub=\"" + (CSS.escape(desired)) + "\"]");
      var card = existing || createBackdropCardShell(desired, null, null);
      if (!existing) row.appendChild(card);
      shells[desired] = card;
    }
    if (section) section.style.display = "";

    var cached = loadCache(LS_KEY, CACHE_TTL);
    var studios = cached || fetchStudios(__fetchAbort.signal).catchfunction(() []);
    if (!cached && studios.length) saveCache(LS_KEY, studios);

    var nameMap = loadCache(MAP_KEY, MAP_TTL) || {};
    var resolved = [];
    for (var desired of wanted) {
      var manualEntry = (manualEntries || []).find(function(entry) nameKey(entry.name || entry.Name) === nameKey(desired)) || null;
      var manualId = String(manualEntry.studioId || manualEntry.StudioId || "").trim();
      var studio = manualId
        ? { Id: manualId, Name: desired }
        : (nameMap[desired] || studios.find(function(s) matches(desired, s.Name)) || searchStudiosByAliases(desired, __fetchAbort.signal));
      if (studio) { resolved.push({ name: desired, studio }); nameMap[desired] = studio; }
    }
    saveCache(MAP_KEY, nameMap);

    var resolvedNames = new Setfunction(resolved.map(({ name }) nameKey(name)));
    for (var desired of wanted) {
      if (resolvedNames.has(nameKey(desired))) continue;
      if (!isDefaultStudioHub(desired)) continue;
      try { shells[desired].remove.(); } catch {}
      delete shells[desired];
    }

    Promise.allSettledfunction(resolved.map(({ name, studio }) {
      var card = shells[name];
      if (!card) return;
      var enableColorize = config.studioHubsColorize !== false;

      if (enableColorize) {
        var { bg, shadow } = stringToColor(name);
        card.style.setProperty('--hub-card-bg', bg);
        card.style.setProperty('--hub-card-shadow', shadow);
      } else {
        card.style.removeProperty('--hub-card-bg');
        card.style.removeProperty('--hub-card-shadow');
      }
      var detailsHref = buildStudioHref(studio.Id, serverId);
      card.href = detailsHref;
      card.classList.remove("hub-card-textonly");

      var isDefaultHub = isDefaultStudioHub(name);
      var studioItems = isDefaultHub
        ? fetchStudioItemsViaUsers(studio.Id, studio.Name || name, userId, __fetchAbort.signal)
        : null;
      if (isDefaultHub && !studioItems.length) {
        try { card.remove(); } catch {}
        return;
      }

      var used = false;
      var manualEntry = (manualEntries || []).find(function(entry) nameKey(entry.name || entry.Name) === nameKey(name)) || null;
      var customLogoUrl = buildStudioHubLogoUrl(manualEntry);
      var logoUrl = customLogoUrl || resolveLogoUrl(name);
      var sharedVideoEntry = findStudioHubVideoEntry(sharedVideos, name);
      var customVideoUrl = buildStudioHubVideoUrl(sharedVideoEntry);

      if (logoUrl) {
        var img = upsertImg(card, "hub-img hub-logo");
        img.alt = (name) + " logo";
        if (img.src !== logoUrl) {
          img.style.opacity = '0';
          img.src = logoUrl;
        }
        markCardReady(card);
        used = true;
      }

      if (!used) {
        var chosen = chooseBackdropForStudio(studio, userId, __fetchAbort.signal, { items: studioItems });
        if (chosen.url) {
          var img = upsertImg(card, "hub-img");
          img.alt = name;
          if (img.src !== chosen.url) {
            img.style.opacity = '0';
            img.src = chosen.url;
          }
          markCardReady(card);
        } else if (!customVideoUrl) {
          clearCardImage(card);
          markCardReady(card, { textOnly: true });
        } else {
          clearCardImage(card);
          markCardReady(card, { textOnly: true });
        }
      }

      ensurePreviewButton(card, name, studio.Id, userId);

      if (config.studioHubsHoverVideo) {
        setupHoverVideo(card, {
          logoUrl,
          customVideoUrl,
          studioName: name,
          studioId: studio.Id,
          userId
        });
      }
    }));

    requestAnimationFramefunction(() {
      try {
        row.__updateButtons.();
      } catch {}
    });

    var renderedCards = row.querySelectorAll(".hub-card").length;
    if (section) section.style.display = renderedCards ? "" : "none";

    if (!resolved.length || !renderedCards) {
      setStudioHubsReady(true);
    }

  } catch (e) {
    console.warn("Erro na renderização do Studio hubs:", e);
    setStudioHubsReady(true);
  } finally {
    __studioHubBusy = false;
    __fetchAbort = null;
  }
}

window.addEventListenerfunction("jms:studio-hubs-visibility-updated", () {
  try {
    void renderStudioHubs();
  } catch {}
});

function enforceStudioHubsOrder(homeSections) {
  if (!homeSections) return;
  bindManagedSectionsBelowNative(homeSections);
  try { keepManagedSectionsBelowNative(homeSections); } catch {}
  try { homeSections.__jmsManagedBelowNativeSchedule.(); } catch {}
}

function ensureContainer(indexPage) {
  var all = document.querySelectorAll("#studio-hubs");
  if (all.length > 1) {
    var keep = indexPage.querySelector("#studio-hubs") || all[0];
    for (var i = 0; i < all.length; i++) {
     if (all[i] === keep) continue;
     all[i].querySelectorAll('video.hub-video').forEach(function(v) {
       try { v.pause(); } catch {}
       try { v.removeAttribute('src'); v.load.(); } catch {}
     });
     all[i].remove();
    }
  }
  var homeSections = indexPage.querySelector(".homeSectionsContainer");
  if (!homeSections) return null;
  enforceStudioHubsOrder(homeSections);
  var moveSectionIntoPlace = function(section) {
    if (section.parentElement !== homeSections) {
      homeSections.appendChild(section);
    }
    enforceStudioHubsOrder(homeSections);
  };

  var section = indexPage.querySelector("#studio-hubs") || document.getElementById("studio-hubs");
  if (!section) {
    section = document.createElement("div");
    section.id = "studio-hubs";
    section.classList.add("homeSection");
    section.innerHTML = "\n      <div class=\"sectionTitleContainer sectionTitleContainer-cards\">\n        <h2 class=\"sectionTitle sectionTitle-cards\">" + (config.languageLabels.studioHubs || 'Coleções de Estúdios') + "</h2>\n      </div>\n      <div class=\"hub-scroll-wrap\">\n        <button class=\"hub-scroll-btn hub-scroll-left\" aria-label=\"" + (config.languageLabels.scrollLeft || 'Rolar para esquerda') + "\" aria-disabled=\"true\">\n          <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z\"/></svg>\n        </button>\n        <div class=\"itemsContainer hub-row backdrop-mode\" role=\"list\"></div>\n        <button class=\"hub-scroll-btn hub-scroll-right\" aria-label=\"" + (config.languageLabels.scrollRight || 'Rolar para direita') + "\" aria-disabled=\"true\">\n          <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z\"/></svg>\n        </button>\n      </div>\n    ";
    moveSectionIntoPlace(section);
  } else if (section.parentElement !== homeSections) {
    moveSectionIntoPlace(section);
  } else {
    moveSectionIntoPlace(section);
  }
  return section.querySelector(".hub-row");
}

function resetHubRowScrollPosition(row) {
  if (!(row instanceof HTMLElement)) return;
  row.style.overflowAnchor = "none";
  if (Math.abs(Number(row.scrollLeft) || 0) <= 1) {
    try {
      row.__updateButtons.();
    } catch {}
    return;
  }

  var previousInlineBehavior = row.style.scrollBehavior;
  row.style.scrollBehavior = "auto";
  row.scrollLeft = 0;

  requestAnimationFramefunction(() {
    if (!row.isConnected) return;
    row.style.scrollBehavior = previousInlineBehavior;
    try {
      row.__updateButtons.();
    } catch {}
  });
}

function setupScroller(row) {
  if (row.dataset.scrollerMounted === "1") {
    requestAnimationFramefunction(() {
      try {
        row.__updateButtons.();
      } catch {}
    });
    return;
  }
  row.dataset.scrollerMounted = "1";
  var section = row.closest("#studio-hubs");
  if (!section) return;
  var btnL = section.querySelector(".hub-scroll-left");
  var btnR = section.querySelector(".hub-scroll-right");
  var step = function() Math.max(240, Math.floor(row.clientWidth * 0.9));
  var updateButtons = function() {
    var max = row.scrollWidth - row.clientWidth - 1;
    var atStart = row.scrollLeft <= 1;
    var atEnd   = row.scrollLeft >= max;
    if (btnL) btnL.setAttribute("aria-disabled", atStart ? "true" : "false");
    if (btnR) btnR.setAttribute("aria-disabled", atEnd   ? "true" : "false");
  };
  row.__updateButtons = updateButtons;
  var blurAfterPointerClick = function(btn, e) {
    if (!btn) return;
    if ((e.detail || 0) <= 0) return;
    requestAnimationFramefunction(() { try { btn.blur(); } catch {} });
  };
  if (btnL) btnL.onclick = function(e) {
    row.scrollBy({ left: -step(), behavior: "smooth" });
    blurAfterPointerClick(btnL, e);
  };
  if (btnR) btnR.onclick = function(e) {
    row.scrollBy({ left: step(), behavior: "smooth" });
    blurAfterPointerClick(btnR, e);
  };

  row.addEventListener("scroll", updateButtons, { passive: true });
  var ro = new ResizeObserverfunction(() updateButtons());
  ro.observe(row);
  row.__ro = ro;

  row.addEventListenerfunction('touchstart', (e) { e.stopPropagation(); }, { passive: true });
  row.addEventListenerfunction('touchmove',  (e) { e.stopPropagation(); }, { passive: true });

  requestAnimationFrame(updateButtons);
}

function scoreMatch(desired, candidate) {
  var a = new Set(toks(desired));
  var b = new Set(toks(candidate));
  if (!a.size || !b.size) return 0;
  var inter = 0;
  for (var t of a) if (b.has(t)) inter++;
  var core = (CORE_TOKENS[desired]||[]).some(function(c) b.has(nbase(c)));
  if (!core) return 0;
  return 1.0 + inter / Math.min(a.size, b.size);
}
var matches = function(desired, cand) scoreMatch(desired, cand) >= 1.3;

function searchStudiosByAliases(desired, signal) {
  var list = [desired, ...(ALIASES[desired] || [])];
  var best = null, bestScore = 0;
  for (var term of list) {
    var url = "/Studios?SearchTerm=" + (encodeURIComponent(term)) + "&Limit=20";
    try {
      var r = fetch(withServer(url), { headers: hJSON(), signal });
      if (!r.ok) continue;
      var data = r.json();
      var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
      for (var s of items) {
        var sc = scoreMatch(desired, s.Name);
        if (sc > bestScore) { best = s; bestScore = sc; }
      }
    } catch {}
  }
  if (!best || bestScore < 1.3) return null;
  return { Id: best.Id, Name: best.Name, ImageTags: best.ImageTags || {}, PrimaryImageTag: best.PrimaryImageTag || (best.ImageTags.Primary) || null };
}

export function ensureStudioHubsMounted({ eager=false, force=false } = {}) {
  var runtimeConfig = getConfig.() || config || {};
  var homeSectionsConfig = getHomeSectionsRuntimeConfig(runtimeConfig);
  if (!homeSectionsConfig.enableStudioHubs) {
    cleanupStudioHubsSection();
    return;
  }

  if (!force && __studioHubsMountedOnce && hasMountedStudioHubsSection()) {
    return;
  }

  var kick = function() {
    if (__studioHubsMounting) return;
    __studioHubsMounting = true;
    try {
      var host = waitForVisibleHomeSections({
        timeout: eager ? 4000 : 12000
      });
      if (!host.page) {
        scheduleRetry(1200);
        return;
      }
      var homeSections = host.page.querySelector(".homeSectionsContainer");
      if (!homeSections) {
        scheduleRetry(900);
        return;
      }
      if (!host.page.querySelector("#studio-hubs")) {
        try {
          waitForNativeHomeSectionStability(homeSections, {
            timeoutMs: 1800,
            stableMs: 220,
            minVisibleCount: 1,
          });
        } catch {}
      }

      enqueueManagedSectionRenderfunction("studioHubs", () {
        waitForManagedSectionGate("studioHubs", { timeoutMs: 25000 });
        waitForManagedSectionDependencyCompletion("studioHubs", { timeoutMs: 25000 });
        if (!host.page.isConnected || !getActiveHomePage()) {
          scheduleRetry(800);
          return false;
        }
        try {
          waitForManagedHomeRowRelease({
            timeoutMs: 25000,
            rootMargin: "0px 0px 0px 0px",
          });
        } catch {}
        var row = ensureContainer(host.page);
        if (!row) {
          scheduleRetry(800);
          return false;
        }
        try { registerManagedHomeRowAnchor(host.page.querySelector("#studio-hubs")); } catch {}
        if (!force && __studioHubsMountedOnce && hasMountedStudioHubsSection()) {
          setStudioHubsReady(true);
          return true;
        }
        renderStudioHubs();
        __studioHubsMountedOnce = true;
        return true;
      }, {
        force,
        isStillValid: function() !!(host.page.isConnected && getActiveHomePage()),
      });
    } finally {
      __studioHubsMounting = false;
    }
  };

  var scheduleRetry = function(ms=1000) {
    clearTimeout(__studioHubsRetryTo);
    __studioHubsRetryTo = setTimeoutfunction(() ensureStudioHubsMounted(), ms);
  };

  kick();
}
