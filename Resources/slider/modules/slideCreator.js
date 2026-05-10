import { getYoutubeEmbedUrl, getProviderUrl, isValidUrl, createTrailerIframe, debounce, getHighResImageUrls, prefetchImages, getHighestQualityBackdropIndex, createImageWarmQueue } from "./utils.js";
import { updateFavoriteStatus, updatePlayedStatus, fetchItemDetails, getSessionInfo } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig } from "./config.js";
import { getLanguageLabels, getDefaultLanguage } from "../language/index.js";
import { createSlidesContainer, createHorizontalGradientOverlay, createLogoContainer, createStatusContainer, createActorSlider, createInfoContainer, createDirectorContainer, createRatingContainer, createLanguageContainer, createMetaContainer, createMainContentContainer, createPlotContainer, createTitleContainer } from "./containerUtils.js";
import { createButtons, createProviderContainer } from './buttons.js';
import { withServer, withServerSrcset } from "./jfUrl.js";
import { createTomatoIconElement } from "./customIcons.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { getWatchlistButtonText } from "./watchlist.js";

var S = function(u) withServer(u);
var config = getConfig();
var LOW_POWER_PEAK = function(() {
  try {
    var ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    var uaMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    var coarse = window.matchMedia.('(pointer: coarse)').matches === true || navigator.maxTouchPoints > 0;
    var shortestSide = Math.min(
      window.innerWidth || window.screen.width || 0,
      window.innerHeight || window.screen.height || 0
    );
    return !!config.peakSlider && coarse && (!!window.ReactNativeWebView || uaMobile || (shortestSide > 0 && shortestSide <= 1280));
  } catch {
    return false;
  }
})();
var settingsBackgroundSlides = [];
var backdropWarmQueue = createImageWarmQueue({ concurrency: LOW_POWER_PEAK ? 1 : 3 });
window.__backdropWarmQueue = backdropWarmQueue;

var BG_HYDRATION_PER_FRAME = LOW_POWER_PEAK ? 4 : 12;
var NEIGHBOR_WARM_COUNT = 2;
var BG_IO_ROOT_MARGIN = LOW_POWER_PEAK ? '240px 0px' : '800px 0px';
var WARM_OBSERVER_ROOT_MARGIN = LOW_POWER_PEAK ? '160px 0px' : '600px 0px';
var PRELOAD_IO_ROOT_MARGIN = LOW_POWER_PEAK ? '220px 0px' : '800px 0px';
var BG_SCROLL_IDLE_MS = LOW_POWER_PEAK ? 160 : 120;
var __bgHydrationQueue = [];
var __bgHydrationRAF = 0;
var __bgScrollActive = false;
var __bgScrollIdleTimer = 0;

function bgQueueHydration(fn) {
  __bgHydrationQueue.push(fn);
  if (!__bgHydrationRAF) {
    __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
  }
}

function bgFlushHydrationFrame() {
  __bgHydrationRAF = 0;
  if (__bgScrollActive) return;
  var budget = BG_HYDRATION_PER_FRAME;
  while (budget-- > 0 && __bgHydrationQueue.length) {
    var fn = __bgHydrationQueue.shift();
    try { fn && fn(); } catch {}
  }
  if (__bgHydrationQueue.length) {
    __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
  }
}

(function injectBackdropPerfStyles(){
  if (document.getElementById('backdrop-perf-css')) return;
  var st = document.createElement('style');
  st.id = 'backdrop-perf-css';
  st.textContent = "\n    .monwui-backdrop {\n      opacity: 1;\n      transition: opacity .28s ease, filter .34s ease, transform .34s cubic-bezier(.2,.6,.2,1);\n    }\n    .monwui-backdrop.is-lqip { filter: blur(14px); transform: scale(1.02); }\n    .monwui-backdrop.is-hi-pending { opacity: .94; }\n    #monwui-slides-container.is-scrolling *,\n    #monwui-slides-container.is-scrolling .monwui-backdrop,\n    #monwui-slides-container.is-scrolling .monwui-horizontal-gradient-overlay {\n      transition: none !important;\n      animation: none !important;\n    }\n  ";
  document.head.appendChild(st);
})();

var __bgIO = new IntersectionObserverfunction((entries) {
  for (var ent of entries) {
    var img = ent.target;
    if (!ent.isIntersecting) continue;
    if (img.__peakManaged && !isPeakBackdropEligible(img)) continue;
    img.__requestHi.();
  }
}, { rootMargin: BG_IO_ROOT_MARGIN });

function toNoTagUrl(url) {
  if (!url) return "";
  var s = String(url);
  try {
    var u = new URL(s, window.location.origin || "http://localhost");
    u.searchParams.delete("tag");
    return u.toString();
  } catch {
    var [base, q = ""] = s.split("?");
    if (!q) return s;
    var rest = q.split("&").filter(Boolean).filterfunction((p) !/^tag=/i.test(p));
    return rest.length ? (base) + "?" + (rest.join("&")) : base;
  }
}

function toNoTagSrcset(srcset) {
  if (!srcset || typeof srcset !== "string") return "";
  return srcset
    .split(",")
    .mapfunction((part) {
      var p = part.trim();
      if (!p) return "";
      var m = p.match(/^(\S+)(\s+.+)?$/);
      if (!m) return p;
      return (toNoTagUrl(m[1])) + (m[2] || "");
    })
    .filter(Boolean)
    .join(", ");
}

function isPlaybackCompleted(userData, runtimeTicks = 0) {
  if (!userData || typeof userData !== "object") return false;
  if (userData.Played === true) return true;

  var playedPercentage = Number(userData.PlayedPercentage);
  if (Number.isFinite(playedPercentage) && playedPercentage >= 100) return true;

  var positionTicks = Number(userData.PlaybackPositionTicks || 0);
  var totalTicks = Number(runtimeTicks || 0);
  return positionTicks > 0 && totalTicks > 0 && positionTicks >= totalTicks;
}

function promoteTaglessBackdropData(data) {
  if (!data || data.__taglessPromoted) return data;
  if (data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) data.lqSrc = data.lqSrcNoTag;
  if (data.hqSrcNoTag && data.hqSrcNoTag !== data.hqSrc) data.hqSrc = data.hqSrcNoTag;
  if (data.hqSrcsetNoTag && data.hqSrcsetNoTag !== data.hqSrcset) data.hqSrcset = data.hqSrcsetNoTag;
  data.__taglessPromoted = true;
  return data;
}

function isPeakBackdropEligible(img) {
  if (!img.__peakManaged) return true;
  var slide = img.closest.('.monwui-slide');
  if (!slide) return false;
  return slide.classList.contains('active') || slide.classList.contains('peak-neighbor');
}

function hydrateBackdrop(img, { lqSrc, hqSrc, hqSrcset = '', fallback = '', eager = false, onHiLoaded }) {
  var fb = fallback || lqSrc || '';
  var lqSrcNoTag = toNoTagUrl(lqSrc);
  var hqSrcNoTag = toNoTagUrl(hqSrc);
  var hqSrcsetNoTag = toNoTagSrcset(hqSrcset);
  img.__bgData = { lqSrc, hqSrc, hqSrcset, lqSrcNoTag, hqSrcNoTag, hqSrcsetNoTag, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;
  img.__peakHiTimer = 0;
  img.__fetchPriorityTarget = '';

  img.__clearPeakHiTimer = function() {
    if (!img.__peakHiTimer) return;
    clearTimeout(img.__peakHiTimer);
    img.__peakHiTimer = 0;
  };

  img.__requestHi = function({ eagerLoad = false, fetchPriority = '' } = {}) {
    var data = img.__bgData || {};
    if (!data.hqSrc || !img.isConnected) return;
    if (img.__phase === 'hi' && img.__hiRequested && (!data.hqSrcset || img.srcset === data.hqSrcset) && img.src === data.hqSrc) {
      return;
    }
    img.__clearPeakHiTimer.();
    img.__hiRequested = true;
    img.__phase = 'hi';
    img.__fetchPriorityTarget = fetchPriority || '';
    img.classList.add('is-hi-pending');
    bgQueueHydrationfunction(() {
      if (!img.isConnected) return;
      try {
        if (fetchPriority) img.setAttribute('fetchpriority', fetchPriority);
        else img.removeAttribute('fetchpriority');
      } catch {}
      try { img.loading = eagerLoad ? 'eager' : 'auto'; } catch {}
      try { img.decoding = eagerLoad ? 'auto' : 'async'; } catch {}
      if (data.hqSrcset) img.srcset = data.hqSrcset;
      if (data.hqSrc) img.src = data.hqSrc;
    });
  };

  img.__requestLq = function() {
    var data = img.__bgData || {};
    var target = data.lqSrc || data.fallback;
    if (!target || !img.isConnected) return;
    if (img.__phase === 'lq' && img.src === target && !img.srcset) return;
    img.__clearPeakHiTimer.();
    img.__hiRequested = false;
    img.__phase = 'lq';
    img.__fetchPriorityTarget = '';
    bgQueueHydrationfunction(() {
      if (!img.isConnected) return;
      try { img.removeAttribute('srcset'); } catch {}
      try { img.removeAttribute('fetchpriority'); } catch {}
      try { img.loading = 'lazy'; } catch {}
      try { img.decoding = 'async'; } catch {}
      img.classList.add('is-lqip');
      img.classList.remove('is-hi-pending');
      if (img.src !== target) img.src = target;
    });
  };

  try { img.removeAttribute('srcset'); } catch {}
  img.classList.add('is-lqip');
  img.decoding = 'async';
  img.loading = eager ? 'eager' : 'auto';
  img.src = lqSrc || fb || img.src;
  if (!eager) {
    img.style.opacity = '0';
  } else {
    img.style.opacity = '1';
  }

  var onError = function() {
    var data = img.__bgData || {};
    if (img.__phase === 'hi') {
      if (!data.__taglessPromoted && data.hqSrcNoTag && data.hqSrcNoTag !== data.hqSrc) {
        promoteTaglessBackdropData(data);
        try { img.removeAttribute('srcset'); } catch {}
        if (data.hqSrcset) img.srcset = data.hqSrcset;
        if (data.hqSrc) img.src = data.hqSrc;
        img.__hiRequested = true;
        return;
      }
      if (!data.__taglessPromoted && data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) {
        promoteTaglessBackdropData(data);
      }
      try { img.removeAttribute('srcset'); } catch {}
      if (data.lqSrc) img.src = data.lqSrc; else if (fb) img.src = fb;
      img.classList.add('is-lqip');
      img.classList.remove('is-hi-pending');
      img.__phase = 'lq';
      img.__hiRequested = false;
      img.__fetchPriorityTarget = '';
    } else {
      if (!data.__taglessPromoted && data.lqSrcNoTag && data.lqSrcNoTag !== data.lqSrc) {
        promoteTaglessBackdropData(data);
        if (data.lqSrc) {
          img.src = data.lqSrc;
          return;
        }
      }
      if (fb) img.src = fb;
    }
  };
  var onLoad = function() {
    if (img.__phase === 'hi') {
      img.classList.remove('is-lqip');
      img.classList.remove('is-hi-pending');
      img.style.opacity = '1';
      img.__hydrated = true;
      try { img.loading = 'eager'; } catch {}
      try { img.decoding = 'auto'; } catch {}
      try {
        if (img.__fetchPriorityTarget) img.setAttribute('fetchpriority', img.__fetchPriorityTarget);
        else img.removeAttribute('fetchpriority');
      } catch {}
      if (typeof onHiLoaded === 'function') { try { onHiLoaded(); } catch {} }
    } else {
      img.style.opacity = '1';
    }
  };

  img.__bgOnErr = onError;
  img.__bgOnLoad = onLoad;
  img.addEventListener('error', onError, { passive: true });
  img.addEventListener('load',  onLoad,  { passive: true });

  __bgIO.observe(img);
  if (eager && hqSrc) {
    img.__requestHi({ eagerLoad: true, fetchPriority: 'high' });
  }
}

function unobserveBackdrop(img) {
  try { img.__clearPeakHiTimer.(); } catch {}
  try { __bgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__bgOnErr); } catch {}
  try { img.removeEventListener('load',  img.__bgOnLoad); } catch {}
  delete img.__bgOnErr;
  delete img.__bgOnLoad;
  try { img.removeAttribute('srcset'); } catch {}
}

function warmImageOnce(url, { timeout = 2500 } = {}) {
  if (!url) return Promise.resolve();
  var LRU_MAX = 500;
  warmImageOnce._set  ||= new Set();
  warmImageOnce._list ||= [];
  if (warmImageOnce._set.has(url)) return Promise.resolve();
  warmImageOnce._set.add(url);
  warmImageOnce._list.push(url);
  if (warmImageOnce._list.length > LRU_MAX) {
    var drop = warmImageOnce._list.splice(0, warmImageOnce._list.length - LRU_MAX);
    for (var u of drop) warmImageOnce._set.delete(u);
  }

  return new Promisefunction((res) {
    var img = new Image();
    var done = false;
    var finish = function() { if (!done) { done = true; res(); } };
    var t = setTimeout(finish, timeout);
    img.onload = function() { clearTimeout(t); finish(); };
    img.onerror = function() { clearTimeout(t); finish(); };
    img.src = url;
  });
}

function shortPreload(url, ms = 1200) {
  if (!url) return;
  var sel = "link[rel=\"preload\"][as=\"image\"][href=\"" + (url) + "\"]";
  if (document.querySelector(sel)) return;
  var link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  document.head.appendChild(link);
  var id = setTimeoutfunction(() {
    try { link.remove(); } catch {}
  }, ms);
  return function() { clearTimeout(id); try { link.remove(); } catch {} };
}

function createSlide(item, options = {}) {
  var {
    insertAt = null,
    suppressInitialDisplay = false,
    deferPeakReveal = false
  } = options || {};
  var indexPage = document.querySelector("#indexPage:not(.hide)") || document.querySelector("#homePage:not(.hide)");
  if (!indexPage) return;

  var parentId = item.Id;
  var itemIdRaw = item.Id;

  if ((item.Type === "Episode" || item.Type === "Season") && item.SeriesId) {
    try {
      var parentItem = fetchItemDetails(item.SeriesId);
      parentId = parentItem.Id;

      var mergeTrailers = function(a = [], b = []) {
      var all = [...a, ...b];
      var seen = new Set();
      return all.filter(function(t) {
        var key = (t.Url || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    var effectiveRemoteTrailers = [];
    if (Array.isArray(item.RemoteTrailers) && item.RemoteTrailers.length) {
      effectiveRemoteTrailers = mergeTrailers(item.RemoteTrailers, parentItem.RemoteTrailers);
    } else {
      effectiveRemoteTrailers = parentItem.RemoteTrailers || [];
    }

    item = {
      ...parentItem,
      Id: item.Id,
      Type: item.Type,
      SeriesId: item.SeriesId,
      MediaStreams: item.MediaStreams,
      People: item.People || parentItem.People,
      UserData: item.UserData,
      RunTimeTicks: item.RunTimeTicks,
      RemoteTrailers: effectiveRemoteTrailers,
      ProviderIds: item.ProviderIds || parentItem.ProviderIds,
      ParentIndexNumber: item.ParentIndexNumber,
      IndexNumber: item.IndexNumber,
      Name: item.Name
    };
        } catch (err) {
      console.error("Não foi possível obter informações da série:", err);
    }
  }

  var ac = new AbortController();
  var { signal } = ac;
  var perSlideObservers = [];
  var perSlideCleanups = [];
  var slidesContainer = createSlidesContainer(indexPage);
  var existing = slidesContainer.querySelector(".monwui-slide[data-item-id=\"" + (itemIdRaw) + "\"]");
  (function bindSlidesScrollPerf(){
    if (window.__jmsSlidesScrollBound) return;
    window.__jmsSlidesScrollBound = true;
    var scroller = document.querySelector('#monwui-slides-container');
    if (!scroller) return;
    var onScrollPerf = function() {
      __bgScrollActive = true;
      if (__bgScrollIdleTimer) clearTimeout(__bgScrollIdleTimer);
      __bgScrollIdleTimer = setTimeoutfunction(() {
        __bgScrollActive = false;
        if (!__bgHydrationRAF && __bgHydrationQueue.length) {
          __bgHydrationRAF = requestAnimationFrame(bgFlushHydrationFrame);
        }
      }, BG_SCROLL_IDLE_MS);
    };
    scroller.addEventListener('scroll', onScrollPerf, { passive: true });
  })();
  if (existing) {
   try { existing.__cleanupSlide.(); } catch {}
   try { existing.remove(); } catch {}
 }
  if (!slidesContainer.__cleanupMO) {
    var mo = new MutationObserverfunction((muts) {
      for (var m of muts) {
        m.removedNodes.forEach.(function(node) {
          if (node && node.__cleanupSlide) {
            try { node.__cleanupSlide(); } catch {}
          }
          node.querySelectorAll.('.monwui-slide').forEach(function(el) {
            if (el.__cleanupSlide) { try { el.__cleanupSlide(); } catch {} }
          });
        });
      }
    });
    mo.observe(slidesContainer, { childList:true, subtree:true });
    slidesContainer.__cleanupMO = mo;
  }
  var existingSlides = Array.from(slidesContainer.children).filterfunction((child) child.classList.contains("monwui-slide"));
  var isFirstSlide = existingSlides.length === 0;
  var itemId = item.Id;

  var {
    Overview,
    Type: itemType,
    People,
    UserData,
    MediaStreams,
    Name: title,
    RunTimeTicks,
    OriginalTitle,
    Taglines,
    Genres,
    ChildCount,
    ProductionYear,
    ProductionLocations,
    CommunityRating,
    CriticRating,
    OfficialRating,
    RemoteTrailers,
    ProviderIds
  } = item;

  var highestQualityBackdropIndex;
  if (config.manualBackdropSelection || config.indexZeroSelection) {
    highestQualityBackdropIndex = "0";
  } else {
    highestQualityBackdropIndex = getHighestQualityBackdropIndex(parentId, { itemDetails: item });
  }

  function storeBackdropUrl(id, url) {
    try {
      var stored = JSON.parse(localStorage.getItem("backdropUrls")) || [];
      if (!stored.includes(url)) {
        stored.push(url);
        var MAX = 500;
        var trimmed = stored.slice(-MAX);
        localStorage.setItem("backdropUrls", JSON.stringify(trimmed));
      }
    } catch {}
  }

  var autoBackdropUrl = S("/Items/" + (parentId) + "/Images/Backdrop/" + (highestQualityBackdropIndex));
  var landscapeUrl = S("/Items/" + (parentId) + "/Images/Thumb/0");
  var primaryUrl  = S("/Items/" + (parentId) + "/Images/Primary");
  var logoUrl = S("/Items/" + (parentId) + "/Images/Logo");
  var bannerUrl = "/Items/" + (parentId) + "/Images/Banner";
  var artUrl = "/Items/" + (parentId) + "/Images/Art";
  var discUrl = "/Items/" + (parentId) + "/Images/Disc";
  var logoExists = true;

  storeBackdropUrl(parentId, autoBackdropUrl);

  var manualBackdropUrl = {
    backdropUrl: S("/Items/" + (parentId) + "/Images/Backdrop/0"),
    landscapeUrl,
    primaryUrl,
    logoUrl: logoExists ? logoUrl : "/Items/" + (parentId) + "/Images/Backdrop/0",
    bannerUrl: S("/Items/" + (parentId) + "/Images/Banner"),
    artUrl: S("/Items/" + (parentId) + "/Images/Art"),
    discUrl: S("/Items/" + (parentId) + "/Images/Disc"),
    none: ""
  }[config.backdropImageType];

  addSlideToSettingsBackground(parentId, autoBackdropUrl);

  var slide = document.createElement("div");
  slide.className = "monwui-slide";
  if (deferPeakReveal && config.peakSlider) {
    slide.classList.add("peak-batch-pending");
  }
  slide.dataset.backdropReady = "0";
  slide.style.position = "absolute";
  slide.style.display = "none";
  slide.dataset.detailUrl = "/web/#/details?id=" + (itemId);
  slide.dataset.itemId = itemId;
  slide.setAttribute('data-media-streams', JSON.stringify(MediaStreams || []));
  slide.dataset.played = isPlaybackCompleted(UserData, RunTimeTicks) ? "true" : "false";

  if (typeof UserData.PlaybackPositionTicks === "number") {
    slide.dataset.playbackpositionticks = UserData.PlaybackPositionTicks;
  }
  if (typeof RunTimeTicks === "number") {
    slide.dataset.runtimeticks = RunTimeTicks;
  }

  var backdropSyncDone = false;
  var backdropSyncReason = "0";
  var resolveBackdropSync = null;
  var backdropSyncPromise = new Promisefunction((resolve) {
    resolveBackdropSync = resolve;
  });
  var finishBackdropSync = function(reason = "loaded") {
    if (backdropSyncDone) return backdropSyncReason;
    backdropSyncDone = true;
    backdropSyncReason = reason;
    slide.dataset.backdropReady = reason === "loaded" ? "1" : String(reason || "1");
    slide.classList.add("backdrop-ready");
    try { resolveBackdropSync.(backdropSyncReason); } catch {}
    return backdropSyncReason;
  };

  slide.__waitForBackdropReady = function({ timeoutMs = LOW_POWER_PEAK ? 2400 : 1600 } = {}) {
    if (backdropSyncDone) return Promise.resolve(backdropSyncReason);
    var safeTimeout = Math.max(350, Number(timeoutMs) || 0);
    return new Promisefunction((resolve) {
      var timer = setTimeoutfunction(() {
        resolve(finishBackdropSync("timeout"));
      }, safeTimeout);
      backdropSyncPromise.thenfunction((reason) {
        clearTimeout(timer);
        resolve(reason);
      });
    });
  };

  slide.__releasePeakReveal = function({ timeoutMs = LOW_POWER_PEAK ? 2600 : 1800 } = {}) {
    if (!config.peakSlider || !slide.classList.contains("peak-batch-pending")) return;
    if (slide.__peakRevealArmed) return;
    slide.__peakRevealArmed = true;
    slide.__waitForBackdropReady({ timeoutMs }).finallyfunction(() {
      slide.__peakRevealArmed = false;
      if (!slide.isConnected) return;
      slide.classList.remove("peak-batch-pending");
    });
  };

  slide.dataset.backdropUrl = autoBackdropUrl;
  slide.dataset.landscapeUrl = landscapeUrl;
  slide.dataset.primaryUrl = primaryUrl;
  slide.dataset.logoUrl = logoUrl;
  slide.dataset.bannerUrl = S("/Items/" + (parentId) + "/Images/Banner");
  slide.dataset.artUrl  = S("/Items/" + (parentId) + "/Images/Art");
  slide.dataset.discUrl = S("/Items/" + (parentId) + "/Images/Disc");

  var { backdropUrl, placeholderUrl, srcset } = getHighResImageUrls(
    { ...item, Id: parentId },
    highestQualityBackdropIndex
  );
  var absBackdrop = config.manualBackdropSelection ? manualBackdropUrl : S(backdropUrl);
  var absPlaceholder = S(placeholderUrl);
  var absSrcset = withServerSrcset(srcset || "");
  var finalBackdropForWarm = absBackdrop;
  var allowPeakWarm = !config.peakSlider || isFirstSlide;
  slide.dataset.background = absBackdrop || S(autoBackdropUrl);

  var backdropImg = document.createElement('img');
  backdropImg.className = 'monwui-backdrop';
  backdropImg.alt = 'Backdrop';
  backdropImg.sizes = '100vw';
  backdropImg.__peakManaged = !!config.peakSlider;
  if (isFirstSlide) backdropImg.setAttribute('fetchpriority', 'high');

  hydrateBackdropfunction(backdropImg, {
    lqSrc: absPlaceholder,
    hqSrc: absBackdrop,
    hqSrcset: absSrcset,
    eager: isFirstSlide,
    onHiLoaded: () {  }
  });

  if ((!LOW_POWER_PEAK || isFirstSlide) && allowPeakWarm) {
    backdropWarmQueue.enqueue(finalBackdropForWarm, { shortPreload: true });
    var warmObserver = new IntersectionObserverfunction((entries, obs) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting && (!backdropImg.__peakManaged || isPeakBackdropEligible(backdropImg))) {
          shortPreload(finalBackdropForWarm, 1500);
          warmImageOnce(finalBackdropForWarm).catchfunction(() {});
          obs.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: WARM_OBSERVER_ROOT_MARGIN });
    warmObserver.observe(backdropImg);
    perSlideObservers.push(warmObserver);
  }

  var pinActiveIfNeeded = function() {
    var slideEl = backdropImg.closest('.monwui-slide');
    var active = slideEl.classList.contains('active');
    if (!active) return;
    try { backdropImg.setAttribute('fetchpriority','high'); } catch {}
    try { backdropImg.loading = 'eager'; } catch {}
  };
  backdropImg.addEventListenerfunction('load', () {
    finishBackdropSync("loaded");
  }, { passive: true, signal });
  backdropImg.addEventListener('load', pinActiveIfNeeded, { once:true, passive:true, signal });
  requestAnimationFramefunction(() {
    if (backdropImg.complete && backdropImg.naturalWidth > 0) {
      finishBackdropSync("loaded");
    }
  });

  var warmOnHover = function() { warmImageOnce(finalBackdropForWarm).catchfunction(() {}); };
  if (!LOW_POWER_PEAK) {
    backdropImg.addEventListener('mouseenter',  warmOnHover, { passive: true, signal });
    backdropImg.addEventListener('pointerover', warmOnHover, { passive: true, signal });
  }
  if ((!LOW_POWER_PEAK || isFirstSlide) && allowPeakWarm) {
    var ioPreload = new IntersectionObserverfunction((entries, observer) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        if (backdropImg.__peakManaged && !isPeakBackdropEligible(backdropImg)) return;
        var finalBackdrop = config.manualBackdropSelection ? manualBackdropUrl : backdropUrl;
        var preload = document.querySelector("link[rel=\"preload\"][as=\"image\"][href=\"" + (finalBackdrop) + "\"]");
        if (!preload) {
          preload = document.createElement('link');
          preload.rel = 'preload';
          preload.as = 'image';
          preload.href = finalBackdrop;
          document.head.appendChild(preload);
        }
        var tid = setTimeoutfunction(() { try { if (preload && !preload.__pinned) preload.remove(); } catch {} }, 1500);
        perSlideCleanups.pushfunction(() clearTimeout(tid));
        observer.unobserve(entry.target);
      });
    }, { rootMargin: PRELOAD_IO_ROOT_MARGIN });
    ioPreload.observe(backdropImg);
    perSlideObservers.push(ioPreload);
  }

  backdropImg.addEventListenerfunction('click', (ev) {
    var slideEl = ev.currentTarget.closest('.monwui-slide');
    var sc = document.querySelector('#monwui-slides-container');
    var isPeak = sc.classList.contains('peak-mode');
    var isActive = slideEl.classList.contains('active');
    if (isPeak && !isActive) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    var preferBackdropIndex = localStorage.getItem("jms_backdrop_index") || highestQualityBackdropIndex || "0";
    var serverId = getSessionInfo.().serverId || "";
    try {
      openDetailsModal({
        itemId,
        serverId,
        preferBackdropIndex,
        originEl: ev.currentTarget || slideEl || backdropImg,
      });
    } catch (err) {
      console.warn("openDetailsModal failed (slider click):", err);
    }
  }, { signal });

  var prevTeardown = slide.__cleanupSlide;
  var teardown = function() {
    try { perSlideObservers.forEach(function(o) o.disconnect()); } catch {}
    try { ac.abort(); } catch {}
    try { backdropImg.removeEventListener('mouseenter', warmOnHover); } catch {}
    try { backdropImg.removeEventListener('pointerover', warmOnHover); } catch {}
    try { unobserveBackdrop(backdropImg); } catch {}
    try { perSlideCleanups.forEach(function(fn) { try { fn(); } catch {} }); } catch {}
    if (typeof prevTeardown === 'function') { try { prevTeardown(); } catch {} }
  };

  slide.__cleanupSlide = teardown;
  slide.__backdropImg = backdropImg;

  var horizontalGradientOverlay = createHorizontalGradientOverlay();
  var backdropContainer = document.createElement('div');
  backdropContainer.className = 'monwui-bckdrp-cntnr';
  backdropContainer.append(backdropImg, horizontalGradientOverlay);
  slide.__backdropContainer = backdropContainer;
  slide.append(backdropContainer);

  if (!slide.__trailerInit) {
   slide.__trailerInit = true;
   createTrailerIframe({ config, RemoteTrailers, slide, backdropImg, itemId });
 }

  var logoContainer = createLogoContainer();
  var order = config.showDiscOnly
    ? ["disk"]
    : config.showTitleOnly
      ? ["originalTitle"]
      : config.showLogoOrTitle
        ? config.displayOrder.split(",").map(function(item) item.trim())
        : [];

  function createLogoElement(fallback) {
    var logoImg = document.createElement("img");
    logoImg.className = "monwui-logo";
    logoImg.src = logoUrl;
    logoImg.alt = "";
    logoImg.loading = "lazy";
    logoImg.decoding = "async";
   logoImg.addEventListenerfunction('error', () {
     logoImg.remove();
     fallback.();
   }, { once:true });
    Object.assign(logoImg.style, {
      width: "100%", maxWidth: "90%", height: "100%", maxHeight: "40%", objectFit: "contain", aspectRatio: "1", display: "block"
    });
    return logoImg;
  }

  function createDiskElement(fallback) {
    var discImg = document.createElement("img");
    discImg.className = "monwui-disk";
    discImg.src = discUrl;
    discImg.alt = "";
    discImg.loading = "lazy";
    Object.assign(discImg.style, {
      maxWidth: "75%", maxHeight: "75%", width: "auto", objectFit: "contain", borderRadius: "50%", display: "block"
    });
    discImg.onerror = fallback;
    return discImg;
  }

  function createTitleElement() {
    var titleDiv = document.createElement("div");
    titleDiv.className = "monwui-no-logo-container";
    titleDiv.textContent = OriginalTitle;
    Object.assign(titleDiv.style, {
      display: "flex", alignItems: "center", justifyContent: "center"
    });
    return titleDiv;
  }

  function tryDisplayElement(index) {
    if (index >= order.length) {
      // Se chegamos ao fim da lista e nada foi exibido, forçamos a Logo Nexus PobreFlix
      var nexusLogo = document.createElement("img");
      nexusLogo.src = "/Resources/slider/src/images/logo_pobreflix.png";
      nexusLogo.className = "monwui-nexus-branding-logo";
      nexusLogo.style.maxHeight = "120px";
      nexusLogo.style.objectFit = "contain";
      logoContainer.appendChild(nexusLogo);
      return;
    }
    var type = order[index];
    if (type === "logo") {
      var element = createLogoElementfunction(() {
        logoContainer.innerHTML = "";
        tryDisplayElement(index + 1);
      });
      logoContainer.appendChild(element);
    } else if (type === "disk") {
      var element = createDiskElementfunction(() {
        logoContainer.innerHTML = "";
        tryDisplayElement(index + 1);
      });
      logoContainer.appendChild(element);
    } else if (type === "originalTitle") {
      var element = createTitleElement();
      logoContainer.appendChild(element);
    } else {
      tryDisplayElement(index + 1);
    }
  }

  tryDisplayElement(0);

  var buttonContainer = createButtons(slide, config, UserData, itemId, RemoteTrailers, updatePlayedStatus, updateFavoriteStatus, openTrailerModal, item);
  var plotContainer = createPlotContainer(config, Overview, UserData, RunTimeTicks);
  var titleContainer = createTitleContainer({
  config,
  Taglines,
  title,
  OriginalTitle,
  Type: itemType,
  ParentIndexNumber: item.ParentIndexNumber,
  IndexNumber: item.IndexNumber
});

  var statusContainer = createStatusContainer(itemType, config, UserData, ChildCount, RunTimeTicks, MediaStreams);
  var actorSlider = createActorSlider(People, config, item);
  var infoContainer = createInfoContainer({ config, Genres, ProductionYear, ProductionLocations });
  var directorContainer = createDirectorContainer({ config, People, item });
  var { container: ratingContainer, ratingExists } = createRatingContainer({
  config,
  CommunityRating,
  CriticRating,
  OfficialRating,
  UserData,
  item
});
  var providerContainer = createProviderContainer({ config, ProviderIds, RemoteTrailers, itemId, slide, item });
  var languageContainer = createLanguageContainer({ config, MediaStreams, itemType });

  var metaContainer = createMetaContainer(
    item.Id || item.Name || item.BackdropImageTags.[0] || Date.now()
  );
  if (statusContainer) metaContainer.appendChild(statusContainer);
  if (ratingExists) metaContainer.appendChild(ratingContainer);
  if (languageContainer) metaContainer.appendChild(languageContainer);
  var mainContentContainer = createMainContentContainer();
  mainContentContainer.append(logoContainer, titleContainer, plotContainer, metaContainer, providerContainer);
  slide.append(mainContentContainer, buttonContainer, actorSlider, infoContainer, directorContainer);
  var frag = document.createDocumentFragment();
  frag.appendChild(slide);
  var slideChildren = Array.from(slidesContainer.children).filterfunction((child) child.classList.contains("monwui-slide"));
  var dotNav = Array.from(slidesContainer.children).findfunction((child) child.classList.contains("monwui-dot-navigation-container")) || null;
  var hasExplicitInsertAt = Number.isInteger(insertAt) && insertAt >= 0;
  var refNode = hasExplicitInsertAt && insertAt < slideChildren.length
    ? slideChildren[insertAt]
    : dotNav;
  if (refNode) {
    slidesContainer.insertBefore(frag, refNode);
  } else {
    slidesContainer.appendChild(frag);
  }
  if (!suppressInitialDisplay && slideChildren.length === 0) {
    import("./navigation.js").then(function(mod) mod.displaySlide(0));
  }
  return slide;
}

function addSlideToSettingsBackground(itemId, backdropUrl) {
  var settingsSlider = document.getElementById("settingsBackgroundSlider");
  if (!settingsSlider) return;
  var existingSlide = settingsSlider.querySelector("[data-item-id=\"" + (itemId) + "\"]");
  if (existingSlide) return;
  var slide = document.createElement("div");
  slide.className = "monwui-slide";
  slide.dataset.itemId = itemId;
  slide.style.backgroundImage = "url('" + (backdropUrl) + "')";
  var img = new Image();
  img.src = backdropUrl;
  img.onerror = function() {
    if (slide.parentNode) {
      slide.parentNode.removeChild(slide);
    }
  };
  img.onload = function() { img.onload = img.onerror = null; };
  settingsSlider.appendChild(slide);
  if (settingsSlider.children.length === 1) {
    slide.classList.add("active");
  }
}

function buildStarLayer(useSolid) {
  var layer = document.createElement("span");
  layer.className = useSolid ? "monwui-trailer-star-fill" : "monwui-trailer-star-track";

  for (var i = 0; i < 5; i++) {
    var star = document.createElement("i");
    star.className = useSolid ? "fa-solid fa-star" : "fa-regular fa-star";
    layer.appendChild(star);
  }
  return layer;
}

function openTrailerModal(trailerUrl, trailerName, itemName = '', itemType = '', isFavorite = false, itemId = null, updateFavoriteCallback = null, CommunityRating = null, CriticRating = null, OfficialRating = null) {
  var embedUrl = getYoutubeEmbedUrl(trailerUrl);
  var sep = embedUrl.includes('?') ? '&' : '?';
  var logoUrl = withServer("/Items/" + (itemId) + "/Images/Logo");
  var overlay = document.createElement("div");
  overlay.className = "monwui-trailer-modal-overlay";
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 0.3s ease-in-out";

  var modal = document.createElement("div");
  modal.className = "monwui-trailer-modal";
  modal.style.maxWidth = "90vw";
  modal.style.maxHeight = "90vh";
  modal.style.width = "800px";

  var modalHeader = document.createElement("div");
  modalHeader.className = "monwui-trailer-modal-header";

  var logoContainer = document.createElement("div");
  logoContainer.className = "monwui-trailer-modal-logo";
  logoContainer.style.display = "flex";
  logoContainer.style.alignItems = "center";
  logoContainer.style.height = "40px";
  logoContainer.style.maxWidth = "200px";
  logoContainer.style.marginRight = "auto";

  var logoImg = document.createElement("img");
  logoImg.src = itemId ? logoUrl : "/Resources/slider/src/images/logo_pobreflix.png";
  logoImg.alt = itemName;
  logoImg.style.maxHeight = "100%";
  logoImg.style.maxWidth = "100%";
  logoImg.style.objectFit = "contain";
  logoImg.style.display = "block";

  logoImg.onerror = function() {
    logoImg.src = "/Resources/slider/src/images/logo_pobreflix.png";
  };

  logoContainer.appendChild(logoImg);

  var titleElement = document.createElement("h3");
  var itemDisplayName = itemName ? itemName : 'Conteúdo Desconhecido';
  titleElement.textContent = (itemDisplayName) + " - " + (config.languageLabels.trailer);
  titleElement.style.margin = "0";
  titleElement.style.marginLeft = "15px";
  titleElement.style.flex = "1";
  titleElement.style.textAlign = "center";
  titleElement.style.color = "var(--monwui-primary, #7B2FBE)";

  var closeBtn = document.createElement("button");
  closeBtn.className = "monwui-trailer-modal-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.marginLeft = "auto";

  modalHeader.append(logoContainer, titleElement, closeBtn);

  var videoContainer = document.createElement("div");
  videoContainer.className = "monwui-trailer-video-container";
  videoContainer.style.paddingBottom = "56.25%";

  var loadingSpinner = document.createElement("div");
  loadingSpinner.className = "monwui-trailer-loading";
  videoContainer.appendChild(loadingSpinner);

  var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  var finalEmbedUrl = embedUrl;
  if (isMobile) {
    finalEmbedUrl = embedUrl;

    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      finalEmbedUrl += '&playsinline=1&autoplay=1';
    }
  }

  var iframe = document.createElement("iframe");
  try {
    var u = new URL(finalEmbedUrl, window.location.origin);
    u.searchParams.set('autoplay', '1');
    u.searchParams.set('mute', '0');
    u.searchParams.set('playsinline', '1');
    if (hasJsApi) {
      u.searchParams.set('enablejsapi', '1');
      u.searchParams.set('origin', window.location.origin);
    }
    finalEmbedUrl = u.toString();
  } catch {}
  iframe.src = finalEmbedUrl;
  iframe.title = trailerName;
  iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  iframe.referrerPolicy = 'origin-when-cross-origin';
  iframe.setAttribute('playsinline', 'true');
  iframe.style.position = "absolute";
  iframe.style.top = "0";
  iframe.style.left = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";

  var audioUnlocked = false;
  var hasJsApi = function(() {
   try { return new URL(finalEmbedUrl).searchParams.get("enablejsapi") === "1"; }
   catch { return false; }
 })();

 var playViaAPI = function() {
    if (!hasJsApi) return;
    try {
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
    } catch {}
  };

  var unlockAudio = function() {
    if (audioUnlocked) return;

    if (!hasJsApi) return;
    try {
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
      iframe.contentWindow.postMessage('{"event":"command","func":"setVolume","args":[50]}', '*');
      audioUnlocked = true;
    } catch (e) {
      console.log("Erro ao abrir áudio:", e);
    }
  };

  iframe.onload = function() {
    loadingSpinner.style.display = "none";
    playViaAPI();
    if (isMobile) {
      var userInteractionHandler = function() {
        unlockAudio();
        document.removeEventListener('click', userInteractionHandler);
        document.removeEventListener('touchstart', userInteractionHandler);
      };

      document.addEventListener('click', userInteractionHandler, { once: true });
      document.addEventListener('touchstart', userInteractionHandler, { once: true });
      setTimeout(playViaAPI, 400);
    }
  };

  videoContainer.appendChild(iframe);
  var modalFooter = document.createElement("div");
  modalFooter.className = "monwui-trailer-modal-footer";
  modalFooter.style.display = "flex";
  modalFooter.style.justifyContent = "space-between";
  modalFooter.style.alignItems = "center";
  modalFooter.style.width = "100%";
  modalFooter.style.padding = "10px 20px";
  modalFooter.style.boxSizing = "border-box";

  var infoContainer = document.createElement("div");
  infoContainer.style.display = "flex";
  infoContainer.style.gap = "8px";

  var itemTitleElement = document.createElement("div");
  var contentType = itemType === 'Movie' ? config.languageLabels.movie :
                    itemType === 'Series' ? config.languageLabels.series :
                    itemType === 'Episode' ? config.languageLabels.series :
                    "Conteúdo: ";
  itemTitleElement.textContent = (contentType) + ": " + (itemDisplayName);
  itemTitleElement.style.fontWeight = "bold";
  infoContainer.appendChild(itemTitleElement);
  var ratingContainer = document.createElement("div");
  ratingContainer.style.display = "flex";
  ratingContainer.style.gap = "15px";
  ratingContainer.style.alignItems = "center";

  if (CommunityRating != null) {
    var rating10 = Array.isArray(CommunityRating)
      ? function(CommunityRating.reduce((a, b) a + b, 0) / CommunityRating.length)
      : CommunityRating;
    rating10 = Math.max(0, Math.min(10, Number(rating10) || 0));

    var rating5 = rating10 / 2;
    var fillPercent = (rating5 / 5) * 100;

    var communityRatingElement = document.createElement("div");
    communityRatingElement.style.display = "flex";
    communityRatingElement.style.alignItems = "center";
    communityRatingElement.style.gap = "8px";

    var starWrap = document.createElement("span");
    starWrap.className = "monwui-trailer-star-rating";
    starWrap.setAttribute("aria-label", (rating5.toFixed(1)) + " / 5");

    var track = buildStarLayer(false);
    var fill = buildStarLayer(true);
    starWrap.style.display = 'inline-flex';
    starWrap.style.position = 'relative';
    starWrap.style.width = 'fit-content';
    fill.style.width = (fillPercent) + "%";
    fill.style.overflow = 'hidden';
    fill.style.position = 'absolute';
    fill.style.top = '0';
    fill.style.left = '0';
    fill.style.pointerEvents = 'none';
    track.style.position = 'relative';
    track.style.zIndex = '1';

    starWrap.appendChild(track);
    starWrap.appendChild(fill);

    var ratingText = document.createElement("span");
    ratingText.textContent = (rating5.toFixed(1)) + " / 5";

    communityRatingElement.appendChild(starWrap);
    communityRatingElement.appendChild(ratingText);
    ratingContainer.appendChild(communityRatingElement);
  }

  if (CriticRating) {
    var criticRatingElement = document.createElement("div");
    criticRatingElement.style.display = "flex";
    criticRatingElement.style.alignItems = "center";
    criticRatingElement.style.gap = "5px";

    var tomatoIcon = createTomatoIconElement();

    var ratingValue = document.createElement("span");
    ratingValue.textContent = (CriticRating) + "%";

    criticRatingElement.appendChild(tomatoIcon);
    criticRatingElement.appendChild(ratingValue);
    ratingContainer.appendChild(criticRatingElement);
}

  if (OfficialRating) {
    var officialRatingElement = document.createElement("div");
    officialRatingElement.className = "official-rating";
    officialRatingElement.textContent = OfficialRating;
    officialRatingElement.style.padding = "2px 5px";
    officialRatingElement.style.borderRadius = "3px";
    officialRatingElement.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
    officialRatingElement.style.fontSize = "0.9em";
    ratingContainer.appendChild(officialRatingElement);
  }

  if (itemId && updateFavoriteCallback) {
    var favoriteContainer = document.createElement("div");
    favoriteContainer.style.cursor = "pointer";

    var initiallyFav = Boolean(isFavorite);
    var favoriteIcon = document.createElement("i");
    favoriteIcon.className = initiallyFav
      ? "fa-solid fa-heart"
      : "fa-regular fa-heart";
    favoriteIcon.style.color = initiallyFav ? "#FFC107" : "#fff";

    var favoriteText = document.createElement("span");
    favoriteText.textContent = getWatchlistButtonText({ Type: itemType }, initiallyFav);

    favoriteContainer.addEventListenerfunction("click", (e) {
      e.stopPropagation();
      if (!itemId || !updateFavoriteCallback) return;

      var newFavoriteStatus = !favoriteIcon.classList.contains("fa-solid");
      try {
        updateFavoriteCallback(itemId, newFavoriteStatus, { item: { Id: itemId, Type: itemType, Name: itemName } });
        favoriteIcon.className = newFavoriteStatus
          ? "fa-solid fa-heart"
          : "fa-regular fa-heart";
        favoriteIcon.style.color = newFavoriteStatus ? "#FFC107" : "#fff";
        favoriteText.textContent = getWatchlistButtonText({ Type: itemType }, newFavoriteStatus);
        favoriteIcon.style.transform = "scale(1.2)";
        setTimeoutfunction(() (favoriteIcon.style.transform = ""), 200);
      } catch (err) {
        console.error("Erro ao atualizar status de favorito:", err);
      }
    });

    favoriteContainer.appendChild(favoriteIcon);
    favoriteContainer.appendChild(favoriteText);
    infoContainer.appendChild(favoriteContainer);
  }

  modalFooter.appendChild(infoContainer);
  modalFooter.appendChild(ratingContainer);

  modal.append(modalHeader, videoContainer, modalFooter);
  overlay.appendChild(modal);

  if (!document.getElementById('trailer-modal-styles')) {
    var style = document.createElement('style');
    style.id = 'trailer-modal-styles';
    style.textContent = "\n      .monwui-trailer-modal-header {\n        display: flex;\n        align-items: center;\n        justify-content: space-between;\n        padding: 15px 20px;\n        background: rgba(0, 0, 0, 0.8);\n        border-bottom: 1px solid rgba(255, 255, 255, 0.1);\n        position: relative;\n      }\n\n      .monwui-trailer-modal-logo {\n        flex-shrink: 0;\n      }\n\n      .monwui-trailer-loading {\n        position: absolute;\n        top: 50%;\n        left: 50%;\n        transform: translate(-50%, -50%);\n        width: 50px;\n        height: 50px;\n        border: 5px solid rgba(255, 255, 255, 0.3);\n        border-radius: 50%;\n        border-top-color: #fff;\n        animation: spin 1s ease-in-out infinite;\n        z-index: 10;\n      }\n\n      @keyframes spin {\n        to { transform: translate(-50%, -50%) rotate(360deg); }\n      }\n\n      @media (max-width: 768px) {\n        .monwui-trailer-modal {\n          width: 95vw !important;\n          height: auto !important;\n        }\n\n        .monwui-trailer-modal-header h3 {\n          font-size: 14px;\n          margin-left: 10px !important;\n        }\n\n        .monwui-trailer-modal-logo {\n          max-width: 120px !important;\n          height: 30px !important;\n        }\n\n        .trailer-audio-notice {\n          background: rgba(255, 193, 7, 0.2);\n          border: 1px solid #FFC107;\n          border-radius: 5px;\n          padding: 8px 12px;\n          margin: 10px 20px;\n          font-size: 12px;\n          text-align: center;\n          color: #FFC107;\n        }\n      }\n    ";
    document.head.appendChild(style);
  }

  var closeModal = function() {
    overlay.style.opacity = "0";
    setTimeoutfunction(() {
      if (document.body.contains(overlay)) {
        try { iframe.src = "about:blank"; } catch {}
        document.body.removeChild(overlay);
      }
      document.removeEventListener("keydown", escListener);
    }, 300);
  };

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListenerfunction("click", (e) {
    if (e.target === overlay) {
      closeModal();
    }
  });

  var escListener = function(e) {
    if (e.key === "Escape" || e.keyCode === 27) {
      closeModal();
    }
  };

  document.addEventListener("keydown", escListener);
  document.body.appendChild(overlay);

  setTimeoutfunction(() {
    overlay.style.opacity = "1";
  }, 10);

  return {
    close: closeModal,
    getIframe: function() iframe
  };
}

export { createSlide, openTrailerModal };
