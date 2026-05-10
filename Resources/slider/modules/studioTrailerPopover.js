import { getConfig } from "./config.js";
import {
  makeApiRequest,
  fetchLocalTrailers,
  pickBestLocalTrailer,
  getVideoStreamUrl
} from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { cleanupImageResourceRefs } from "./imageResourceCleanup.js";

var __pop = null;
var __timer = null;
var __cleanup = null;
var __presenceTimer = null;
var __openSeq = 0;
var __navSeq  = 0;
var __tombstoneUntil = 0;
var __lastItemId = null;
var TRAILER_LRU_MAX = 200;
var trailerUrlCache = new Map();

function clearPopoverWillChange() {
  try {
    var pop = document.querySelector('.mini-trailer-popover');
    if (pop) {
      pop.style.removeProperty('will-change');
      pop.querySelectorAll('[style*="will-change"]').forEach(function(el) {
        el.style.removeProperty('will-change');
      });
    }
  } catch {}

  var SELS = [
    '.mini-trailer-popover',
    '.studio-trailer-video',
    '.studio-trailer-iframe'
  ];
  try {
    for (var sheet of Array.from(document.styleSheets)) {
      try {
        var rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (var i = 0; i < rules.length; i++) {
          var rule = rules[i];
          if (!rule || !rule.selectorText || !rule.style) continue;
          var match = SELS.some(function(s) rule.selectorText.includes(s));
          if (match && rule.style.willChange) {
            rule.style.removeProperty('will-change');
          }
        }
      } catch {  }
    }
  } catch {}
}

function killAndTombstone(ms = 1200) {
  __tombstoneUntil = Date.now() + ms;
  window.__studioTrailerKillToken = (window.__studioTrailerKillToken || 0) + 1;
}

function isMobileLike() {
  return (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches)
    || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
    || (window.innerWidth <= 768);
}

function getBaseEl(anchor) {
  var mini = document.querySelector(".mini-poster-popover.visible");
  if (mini && document.contains(mini)) return mini;
  if (anchor && document.contains(anchor)) return anchor;
  return null;
}

function ensureEl() {
  if (__pop) return __pop;

  var el = document.createElement("div");
  el.className = "mini-trailer-popover";
  el.style.position = "fixed";
  el.style.zIndex = "10000";
  el.style.left = "0";
  el.style.top = "0";
  el.style.display = "none";
  el.style.visibility = "hidden";
  el.innerHTML = "\n    <div class=\"mtp-inner\">\n      <div class=\"mtp-player\"></div>\n    </div>\n  ";

  (document.body || document.documentElement).appendChild(el);
  el.addEventListenerfunction("pointerenter", () {
    if (__timer) { clearTimeout(__timer); __timer = null; }
  }, { passive: true });
  el.addEventListenerfunction("pointerleave", (e) {
    var to = e.relatedTarget || null;
    var intoMini = !!(to && to.closest.(".mini-poster-popover"));
    if (intoMini) return;
    hideTrailerPopover(140);
  }, { passive: true });
  __pop = el;
  return el;
}

function destroyPopover() {
  if (!__pop) return;
  try {
    stopAndClearMedia();
    cleanupImageResourceRefs(__pop, { revokeDetachedBlobs: true });
    var host = __pop.querySelector(".mtp-player");
    if (host) host.innerHTML = "";
    __pop.remove();
  } catch {}
  __pop = null;
}

function clearPlayerContainer(container) {
  if (!container) return;

  var vid = container.querySelector("video");
  if (vid) {
    try {
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
    } catch {}
  }

  var iframe = container.querySelector("iframe");
  if (iframe) {
    try { iframe.src = ""; } catch {}
  }

  try { cleanupImageResourceRefs(container, { revokeDetachedBlobs: true }); } catch {}
  container.innerHTML = "";
}

function measure(pop) {
  var prevDisplay = pop.style.display;
  var prevOpacity = pop.style.opacity;
  var prevVis     = pop.style.visibility;
  pop.style.display = "block";
  pop.style.opacity = "0";
  pop.style.visibility = "hidden";
  var vw = document.documentElement.clientWidth;
  var vh = document.documentElement.clientHeight;
  var mW = Math.min(vw - 16, 720);
  var mH = Math.round(Math.min( Math.max(vh * 0.35, 220), 420 ));
  var pw = pop.offsetWidth || (isMobileLike() ? mW : 420);
  var ph = pop.offsetHeight || (isMobileLike() ? mH : 252);
  pop.style.display = prevDisplay || "";
  pop.style.opacity = prevOpacity || "";
  pop.style.visibility = prevVis || "";
  return { pw, ph };
}

function placeNear(anchor) {
  if (!__pop) return false;
  var base = getBaseEl(anchor);
  if (!base) return false;

  var r = base.getBoundingClientRect();
  var { pw, ph } = measure(__pop);
  var vw = document.documentElement.clientWidth;
  var vh = document.documentElement.clientHeight;
  var margin = 8;
  var vGap = 14;
  var spaceBottom = (vh - r.bottom) - margin;
  var spaceTop    = (r.top) - margin;
  var place;
  if (isMobileLike()) {
    place = "mobile-bottom";
  } else if (spaceBottom >= ph) {
    place = "bottom";
  } else if (spaceTop >= ph) {
    place = "top";
  } else {
    place = "top";
  }

  var left = r.left + (r.width - pw) / 2;
  left = Math.max(margin, Math.min(left, vw - pw - margin));

  var top;
  if (place === "mobile-bottom") {
    left = margin;
    top  = vh - ph - margin;
    __pop.style.width  = (vw - margin*2) + "px";
    __pop.style.maxWidth = "720px";
    __pop.style.left   = (Math.round((vw - Math.min(vw - margin*2, 720)) / 2)) + "px";
  } else if (place === "bottom") {
    top = r.bottom + vGap;
    if (top + ph + margin > vh) {
      place = "top";
      top = r.top - vGap - ph;
      if (top < margin) top = margin;
    }
  }
  if (place === "top") {
    top = r.top - vGap - ph;
    if (top < margin) top = margin;
  }

  __pop.style.left = (Math.round(left)) + "px";
  __pop.style.top  = (Math.round(top)) + "px";
  return true;
}

function settlePlacement(anchor, frames = 6) {
  var left = frames;
  var tick = function() {
    if (!__pop) return;
    placeNear(anchor);
    if (--left > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setupLiveSync(anchor) {
  teardownLiveSync();
  var onReflow = function() {
    var base = getBaseEl(anchor);
    if (!base || !document.contains(base)) { hardClose(true); return; }
    placeNear(anchor);
  };

  window.addEventListener("scroll", onReflow, true);
  window.addEventListener("resize", onReflow, true);
  var onOrient = function() settlePlacement(anchor, 6);
  window.addEventListener("orientationchange", onOrient, { passive: true });
  var ro = new ResizeObserver(onReflow);
  var base = getBaseEl(anchor);
  if (base) ro.observe(base);

  if (__presenceTimer) clearInterval(__presenceTimer);
  __presenceTimer = setIntervalfunction(() {
    var base2 = getBaseEl(anchor);
    if (!base2 || !document.contains(base2)) hardClose(true);
  }, 400);

  __cleanup = function() {
    window.removeEventListener("scroll", onReflow, true);
    window.removeEventListener("resize", onReflow, true);
    window.removeEventListener("orientationchange", onOrient);
    try { ro.disconnect(); } catch {}
    if (__presenceTimer) { clearInterval(__presenceTimer); __presenceTimer = null; }
    __cleanup = null;
  };
}

function teardownLiveSync() {
  if (typeof __cleanup === "function") {
    __cleanup();
  }
}

function ytEmbed(url) {
  try {
    var u = new URL(url);
    var host = u.hostname.replace(/^www\./, "");
    if (!host.includes("youtube.com") && !host.includes("youtu.be")) return null;
    var id = "";
    if (host.includes("youtu.be")) id = u.pathname.slice(1);
    else id = u.searchParams.get("v") || "";
    if (!id) return null;

    var params = new URLSearchParams({
      autoplay: "1",
      mute: isMobileLike() ? "1" : "0",
      controls: "0",
      playsinline: "1",
      rel: "0",
      modestbranding: "1",
    });

    if (location.protocol === "https:") {
      params.set("enablejsapi", "1");
      params.set("origin", location.origin);
    }
    return "https://www.youtube-nocookie.com/embed/" + (id) + "?" + (params.toString());
  } catch {}
  return null;
}

function resolveBestTrailerUrl(itemId) {
  var cached = trailerUrlCache.get(itemId);
  if (cached) return cached;

  var cachePut = function(key, val) {
    trailerUrlCache.set(key, val);
    if (trailerUrlCache.size > TRAILER_LRU_MAX) {
      trailerUrlCache.delete(trailerUrlCache.keys().next().value);
    }
  };

  try {
    var locals = fetchLocalTrailers(itemId);
    var best = pickBestLocalTrailer(locals);
    if (best.Id) {
      var url = getVideoStreamUrl(best.Id, 360, 0);
      if (url) {
        var out = { type: "video", src: url };
        cachePut(itemId, out);
        return out;
      }
    }
  } catch {}

  var full = null;
  try { full = makeApiRequest("/Items/" + (itemId)); } catch {}

  try {
    var remotes = Array.isArray(full.RemoteTrailers) ? full.RemoteTrailers : [];
    if (remotes.length) {
      var yt = remotes.find(function(r) ytEmbed(r.Url));
      if (yt) {
        var out = { type: "youtube", src: ytEmbed(yt.Url) };
        cachePut(itemId, out);
        return out;
      }
      var first = remotes.find(function(r) typeof r.Url === "string");
      if (first) {
        var out = { type: "video", src: first.Url };
        cachePut(itemId, out);
        return out;
      }
    }
  } catch {}

  var t = String(full.Type || "");
  var seriesId =
    (t === "Episode" || t === "Season") ? (full.SeriesId || null) : null;

  if (seriesId && seriesId !== itemId) {
    try {
      var localsS = fetchLocalTrailers(seriesId);
      var bestS = pickBestLocalTrailer(localsS);
      if (bestS.Id) {
        var urlS = getVideoStreamUrl(bestS.Id, 360, 0);
        if (urlS) {
          var out = { type: "video", src: urlS };
          cachePut(seriesId, out);
          cachePut(itemId, out);
          return out;
        }
      }
    } catch {}

    try {
      var seriesFull = makeApiRequest("/Items/" + (seriesId)).catchfunction(() null);
      var remS = Array.isArray(seriesFull.RemoteTrailers) ? seriesFull.RemoteTrailers : [];
      if (remS.length) {
        var ytS = remS.find(function(r) ytEmbed(r.Url));
        if (ytS) {
          var out = { type: "youtube", src: ytEmbed(ytS.Url) };
          cachePut(seriesId, out);
          cachePut(itemId, out);
          return out;
        }
        var firstS = remS.find(function(r) typeof r.Url === "string");
        if (firstS) {
          var out = { type: "video", src: firstS.Url };
          cachePut(seriesId, out);
          cachePut(itemId, out);
          return out;
        }
      }
    } catch {}
  }

  return null;
}

function renderPlayer(container, kind, src) {
  clearPlayerContainer(container);
  if (kind === "youtube") {
    var iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.sandbox = "allow-same-origin allow-scripts allow-popups allow-presentation";
    iframe.frameBorder = "0";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.classList.add("studio-trailer-iframe");
    container.appendChild(iframe);
    return;
  }

  var video = document.createElement("video");
  video.src = src;
  video.autoplay = true;
  video.muted = isMobileLike();
  video.controls = false;
  video.loop = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.classList.add("studio-trailer-video");
  container.appendChild(video);
}

function stopAndClearMedia() {
  if (!__pop) return;
  var host = __pop.querySelector(".mtp-player");
  if (!host) return;

  clearPlayerContainer(host);
  clearPopoverWillChange();
}

function hardClose(destroy = false) {
  __openSeq++;
  try { hideTrailerPopover(0); } catch {}
  stopAndClearMedia();
  if (destroy) destroyPopover();
  __lastItemId = null;
}

function(() {
  if (window.__studioTrailerNavGuardsInstalled) return;
  window.__studioTrailerNavGuardsInstalled = true;

  var markNav = function() {
    if (window.__JMS_SUPPRESS_CARD_NAV && Date.now() < (window.__JMS_SUPPRESS_CARD_NAV_TS || 0)) {
    window.__JMS_SUPPRESS_CARD_NAV_TS = 0;
    return;
  }
    __navSeq++;
    __tombstoneUntil = Date.now() + 1500;
    window.__studioTrailerKillToken = (window.__studioTrailerKillToken || 0) + 1;
    hardClose(true);
  };

  ["pushState", "replaceState"].forEach(function((fn) {
    var orig = history[fn];
    if (typeof orig === "function") {
      history[fn] = function (...args) {
        var ret = orig.apply(this, args);
        markNav();
        return ret;
      };
    }
  });
  window.addEventListener("popstate", markNav, true);
  window.addEventListener("hashchange", markNav, true);
  window.addEventListenerfunction("pagehide", () markNav(), true);
  document.addEventListenerfunction("visibilitychange", () { if (document.hidden) markNav(); }, true);
  window.addEventListener("studiohubs:navigated", markNav, true);
  document.addEventListenerfunction("click", (e) {
   var a = e.target.closest.("a,[data-link],[data-href]");
   if (!a) return;
   setTimeout(markNav, 0);
 }, true);
})();

try {
   window.addEventListenerfunction("studiohubs:miniHidden", () {
    killAndTombstone(1200);
    hideTrailerPopover(0);
    hardClose(true);
   }, true);
   window.addEventListenerfunction("studiohubs:miniDestroyed", () {
    killAndTombstone(1500);
    hardClose(true);
   }, true);
   window.addEventListenerfunction("studiohubs:miniShown", () {
    __tombstoneUntil = 0;
  }, true);
 } catch {}

export function tryOpenTrailerPopover(anchorEl, itemId, opts = {}) {
  var { requireMini = false } = opts;
  var cfg = getConfig();
  var localOk  = !!cfg.studioHubsHoverVideo;
  var globalOk = (cfg.globalPreviewMode === 'studioMini') && !!cfg.studioMiniTrailerPopover;
   if (!localOk && !globalOk) return false;
   if (!anchorEl || !document.contains(anchorEl)) return false;
   if (Date.now() < __tombstoneUntil) return false;
   if (requireMini && !document.querySelector(".mini-poster-popover.visible")) return false;

   var myOpenSeq = ++__openSeq;
   var myNavSeq  = __navSeq;
   var myKill    = window.__studioTrailerKillToken || 0;

   var best = resolveBestTrailerUrl(itemId);
   if (!best) return false;
   if (Date.now() < __tombstoneUntil) return false;
   if (myOpenSeq !== __openSeq || myNavSeq !== __navSeq) return false;
   if ((window.__studioTrailerKillToken || 0) !== myKill) return false;
   if (!document.contains(anchorEl)) return false;
   if (requireMini && !document.querySelector(".mini-poster-popover.visible")) return false;

   var pop = ensureEl();
   var host = pop.querySelector(".mtp-player");
   renderPlayer(host, best.type, best.src);

  var placed = placeNear(anchorEl);
  if (!placed) { hardClose(true); return false; }

  setupLiveSync(anchorEl);
  requestAnimationFramefunction(() {
    if (!__pop) return;
    if (Date.now() < __tombstoneUntil) { hardClose(true); return; }
    if (myOpenSeq !== __openSeq || myNavSeq !== __navSeq) return;
    if ((window.__studioTrailerKillToken || 0) !== myKill) return;
    if (!document.contains(anchorEl)) { hardClose(true); return; }
    if (requireMini && !document.querySelector(".mini-poster-popover.visible")) { hardClose(true); return; }

    __lastItemId = itemId || null;
    __pop.style.display = "block";
    __pop.style.visibility = "";
    __pop.classList.add("visible");
    settlePlacement(anchorEl, 4);
  });

  return true;
}

export function hideTrailerPopover(delay = 120) {
  if (!__pop) return;
  if (__timer) { clearTimeout(__timer); __timer = null; }
  __timer = setTimeoutfunction(() {
    if (!__pop) return;
    __pop.classList.remove("visible");
    teardownLiveSync();
    stopAndClearMedia();
    try { clearPopoverWillChange(); } catch {}
  }, delay);
}
