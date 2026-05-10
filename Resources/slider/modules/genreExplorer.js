import { makeApiRequest, getSessionInfo, getCachedUserTopGenres } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { faIconHtml } from "./faIcons.js";
import { resolveSliderAssetHref } from "./assetLinks.js";
import { formatOfficialRatingLabel } from "./utils.js";

var IS_MOBILE = (navigator.maxTouchPoints > 0) || (window.innerWidth <= 820);

var COMMON_FIELDS = [
  "PrimaryImageAspectRatio",
  "ImageTags",
  "CommunityRating",
  "Genres",
  "OfficialRating",
  "ProductionYear",
  "CumulativeRunTimeTicks",
  "RunTimeTicks",
].join(",");

function makeItemKey(it) {
  var id  = it.Id ? String(it.Id) : "";
  var nm  = (it.Name || "").trim().toLowerCase();
  var yr  = it.ProductionYear || "";
  var pt  = (it.ImageTags.Primary || it.PrimaryImageTag || "");
  return (id) + "::" + (nm) + "|" + (yr) + "::" + (pt);
}

function buildPosterUrl(item, height = 540, quality = 72) {
  var tag = item.ImageTags.Primary || item.PrimaryImageTag;
  if (!tag) return null;
  return withServer(
    "/Items/" + (item.Id) + "/Images/Primary?tag=" + (encodeURIComponent(tag)) + "&maxHeight=" + (height) + "&quality=" + (quality) + "&EnableImageEnhancers=false"
  );
}
function buildPosterUrlLQ(item) { return buildPosterUrl(item, 120, 25); }
function buildPosterUrlHQ(item) { return buildPosterUrl(item, 540, 72); }

function buildPosterSrcSet(item) {
  var hs = [240, 360, 540, 720];
  var q  = 50;
  var ar = Number(item.PrimaryImageAspectRatio) || 0.6667;
  return hs.map(function(h) (buildPosterUrl(item, h, q)) + " " + (Math.round(h * ar)) + "w").join(", ");
}

function getDetailsUrl(itemId, serverId) {
  return "#/details?id=" + (itemId) + "&serverId=" + (encodeURIComponent(serverId));
}

function getActiveExplorerServerId() {
  return __serverId || __d_serverId || __p_serverId || getSessionInfo().serverId || "";
}

function getExplorerCardOrigin(cardEl) {
  return (
    cardEl.querySelector.(".cardImage") ||
    cardEl.querySelector.(".cardImageContainer") ||
    cardEl
  );
}

function openExplorerCardDetails(cardEl) {
  var itemId = String(cardEl.dataset.itemId || "");
  if (!itemId) return;

  var backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
  try {
    openDetailsModal({
      itemId,
      serverId: getActiveExplorerServerId(),
      preferBackdropIndex: backdropIndex,
      originEl: getExplorerCardOrigin(cardEl),
    });
  } catch (err) {
    console.warn("openDetailsModal failed (explorer card):", err);
  }
}

function bindExplorerGridDetails(grid) {
  if (!grid) return;

  grid.addEventListenerfunction('click', (e) {
    var card = e.target.closest('a.ge-card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    openExplorerCardDetails(card);
  }, { passive: false });

  grid.addEventListenerfunction('keydown', (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest('a.ge-card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    openExplorerCardDetails(card);
  }, { passive: false });
}

function closeActiveExplorers() {
  if (__overlay) {
    try { closeGenreExplorer(true); } catch {}
  }
  if (__d_overlay) {
    try { closeDirectorExplorer(true); } catch {}
  }
  if (__p_overlay) {
    try { closePersonalExplorer(true); } catch {}
  }
}

(function bindDetailsModalPlayCloser() {
  if (window.__jmsGenreExplorerPlayCloseBound) return;
  window.__jmsGenreExplorerPlayCloseBound = true;
  window.addEventListenerfunction("jms:details-modal-play", () {
    closeActiveExplorers();
  }, { passive: true });
})();

function buildLogoUrl(item, width = 220, quality = 72) {
  var tag = item.ImageTags.Logo || item.LogoImageTag;
  if (!tag) return null;
  return withServer(
    "/Items/" + (item.Id) + "/Images/Logo?tag=" + (encodeURIComponent(tag)) + "&width=" + (width) + "&quality=" + (quality)
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  var cfg = getConfig() || {};
  if (!runtime) return '';
  return runtime
    .replace(/(\d+)h/g, "$1" + (cfg.languageLabels.sa || 'h'))
    .replace(/(\d+)m/g, "$1" + (cfg.languageLabels.dk || 'm'));
}

var PLACEHOLDER_URL = resolveSliderAssetHref(
  getConfig().placeholderImage || "/slider/src/images/placeholder.png"
);

var __scrollActive = false;
var __scrollIdleTimer = 0;

var HYDRATION_PER_FRAME = 12;
var __hydrationQueue = [];
var __hydrationRAF = 0;

function queueHydration(fn) {
  __hydrationQueue.push(fn);
  if (!__hydrationRAF) {
    __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
  }
}

function flushHydrationFrame() {
  __hydrationRAF = 0;
  if (__scrollActive) {
    return;
  }
  var budget = HYDRATION_PER_FRAME;
  while (budget-- > 0 && __hydrationQueue.length) {
    var fn = __hydrationQueue.shift();
    try { fn && fn(); } catch {}
  }
  if (__hydrationQueue.length) {
    __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
  }
}

var __imgIO = new IntersectionObserverfunction((entries) {
  for (var ent of entries) {
    var img = ent.target;
    var data = img.__data || {};
    if (ent.isIntersecting) {
      if (!img.__hiRequested) {
        img.__hiRequested = true;
        img.__phase = 'hi';
        queueHydrationfunction(() {
          if (!img.isConnected) return;
          if (data.hqSrcset) img.srcset = data.hqSrcset;
          if (data.hqSrc)    img.src    = data.hqSrc;
        });
      }
    } else {
      try { img.removeAttribute('srcset'); } catch {}
      if (data.lqSrc && img.src !== data.lqSrc) img.src = data.lqSrc;
      img.__phase = 'lq';
      img.__hiRequested = false;
      img.classList.add('is-lqip');
      img.__hydrated = false;
    }
  }
}, { rootMargin: '600px 0px' });

function hydrateBlurUp(img, { lqSrc, hqSrc, hqSrcset, fallback }) {
  var fb = fallback || PLACEHOLDER_URL;
  if (IS_MOBILE) {
    try { __imgIO.unobserve(img); } catch {}
    try { if (img.__onErr) img.removeEventListener('error', img.__onErr); } catch {}
    try { if (img.__onLoad) img.removeEventListener('load',  img.__onLoad); } catch {}
    delete img.__onErr;
    delete img.__onLoad;
    try { img.removeAttribute('srcset'); } catch {}
    if (hqSrcset) {
      try { img.srcset = hqSrcset; } catch {}
    }
    img.src = hqSrc || lqSrc || fb;
    img.classList.remove('is-lqip');
    img.classList.add('__hydrated');
    img.__phase = 'hi';
    img.__hiRequested = true;
    img.__hydrated = true;
    return;
  }

  img.__data = { lqSrc, hqSrc, hqSrcset, fallback: fb };
  img.__phase = 'lq';
  img.__hiRequested = false;

  try { img.removeAttribute('srcset'); } catch {}
  if (lqSrc) {
    if (img.src !== lqSrc) img.src = lqSrc;
  } else {
    img.src = fb;
  }
  img.classList.add('is-lqip');
  img.__hydrated = false;

  var onError = function() {
    if (img.__phase === 'hi') {
      try { img.removeAttribute('srcset'); } catch {}
      if (lqSrc) {
        if (img.src !== lqSrc) img.src = lqSrc;
      } else {
        img.src = fb;
      }
      img.classList.add('is-lqip');
      img.__phase = 'lq';
      img.__hiRequested = false;
    }
  };
  var onLoad = function() {
    if (img.__phase === 'hi') {
      img.classList.remove('is-lqip');
      img.__hydrated = true;
    }
  };
  img.__onErr = onError;
  img.__onLoad = onLoad;
  img.addEventListener('error', onError, { passive: true });
  img.addEventListener('load',  onLoad,  { passive: true });

  __imgIO.observe(img);
}
function unobserveImage(img) {
  try { __imgIO.unobserve(img); } catch {}
  try { img.removeEventListener('error', img.__onErr); } catch {}
  try { img.removeEventListener('load',  img.__onLoad); } catch {}
  delete img.__onErr;
  delete img.__onLoad;
  if (img) { img.removeAttribute('srcset'); }
}

function injectGEPerfStyles() {
  if (document.getElementById('ge-perf-css')) return;
  var st = document.createElement('style');
  st.id = 'ge-perf-css';
  st.textContent = "\n    .genre-explorer-overlay,\n    .genre-explorer,\n    .ge-card,\n    .ge-card .cardImage,\n    .ge-card .cardBox {\n      contain: none !important;\n      content-visibility: visible !important;\n      contain-intrinsic-size: auto !important;\n      will-change: auto !important;\n      backface-visibility: visible !important;\n      -webkit-backface-visibility: visible !important;\n    }\n\n    .ge-card .cardBox:hover { transform: scale(1.01); }\n  ";
  document.head.appendChild(st);
}

var __overlay = null;
var __abort = null;
var __busy = false;
var __startIndex = 0;
var __genre = "";
var __serverId = "";
var __io = null;
var __originPoint = null;
var __isClosing = false;

var MAX_CARDS = 600;
function pruneGridIfNeeded() {
  var grid = __overlay.querySelector('.ge-grid');
  if (!grid) return;
  var extra = grid.children.length - MAX_CARDS;
  if (extra > 0) {
    for (var i = 0; i < extra; i++) {
      var el = grid.firstElementChild;
      if (!el) break;
      try { el.dispatchEvent(new Event('jms:cleanup')); } catch {}
      el.remove();
    }
  }
}

(function bindGlobalPointerOrigin(){
  if (window.__jmsPointerOriginBound) return;
  window.__jmsPointerOriginBound = true;
  document.addEventListenerfunction('pointerdown', (e) {
    try { __originPoint = { x: e.clientX, y: e.clientY }; } catch {}
  }, { capture: true, passive: true });
})();


export function openGenreExplorer(genre) {
  if (__overlay) { try { closeGenreExplorer(true); } catch {} }

  __genre = String(genre || "").trim();
  var { serverId } = getSessionInfo();
  __serverId = serverId;
  __startIndex = 0;

  __overlay = document.createElement('div');
  __overlay.className = 'genre-explorer-overlay';
  __overlay.innerHTML = "\n    <div class=\"genre-explorer\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Genre Explorer\">\n      <div class=\"ge-header\">\n        <div class=\"ge-title\">\n          " + (escapeHtml(__genre)) + " • " + ((getConfig().languageLabels.all) || "Tudo") + "\n        </div>\n        <div class=\"ge-actions\">\n          <button class=\"ge-close\" aria-label=\"" + ((getConfig().languageLabels.close) || "Fechar") + "\">✕</button>\n        </div>\n      </div>\n      <div class=\"ge-content\">\n        <div class=\"ge-grid\" role=\"list\"></div>\n        <div class=\"ge-empty\" style=\"display:none\">\n          " + ((getConfig().languageLabels.noResults) || "Nenhum conteúdo encontrado") + "\n        </div>\n        <div class=\"ge-sentinel\"></div>\n      </div>\n    </div>\n  ";
  document.body.appendChild(__overlay);
  injectGEPerfStyles();
  try { playOpenAnimation(__overlay); } catch {}
  var grid = __overlay.querySelector('.ge-grid');
  bindExplorerGridDetails(grid);

  window.addEventListener('hashchange', hashCloser, { passive: true });

  __overlay.querySelector('.ge-close').addEventListenerfunction('click', () animatedCloseThen(), { passive:true });
  __overlay.addEventListenerfunction('click', (e) {
    if (e.target === __overlay) animatedCloseThen();
  }, { passive:true });
  document.addEventListener('keydown', escCloser, { passive:true });
  var scroller = __overlay.querySelector('.ge-content');
  var onScrollPerf = function() {
    __scrollActive = true;
    if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
    __scrollIdleTimer = setTimeoutfunction(() {
      __scrollActive = false;
      if (!__hydrationRAF && __hydrationQueue.length) {
        __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
      }
    }, 120);
  };
  scroller.addEventListener('scroll', onScrollPerf, { passive: true });
  __overlay.__onScrollPerf = onScrollPerf;
  loadMore();

  var sentinel = __overlay.querySelector('.ge-sentinel');
  __io = new IntersectionObserverfunction((ents){
    for (var ent of ents) {
      if (ent.isIntersecting) loadMore();
    }
  }, { root: scroller, rootMargin: '800px 0px' });
  __io.observe(sentinel);
}

var __d_overlay = null;
var __d_abort = null;
var __d_busy = false;
var __d_startIndex = 0;
var __d_serverId = "";
var __d_io = null;
var __d_originPoint = null;
var __d_isClosing = false;
var __d_person = { Id: "", Name: "" };

function d_playOpenAnimation(overlayEl) {
  var sheet = overlayEl;
  var dialog = overlayEl.querySelector('.genre-explorer');
  var origin = __d_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = (origin.x) + "px " + (origin.y) + "px";
  sheet.animate([{opacity:0},{opacity:1}], {duration:220, easing:'ease-out', fill:'both'});
  dialog.animate([{transform:'scale(0.84)',opacity:0},{transform:'scale(1)',opacity:1}], {duration:280, easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'});
}

function d_animatedCloseThen(cb) {
  if (!__d_overlay || __d_isClosing) { if (cb) cb(); return; }
  __d_isClosing = true;
  var sheet = __d_overlay;
  var dialog = __d_overlay.querySelector('.genre-explorer');
  var origin = __d_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = (origin.x) + "px " + (origin.y) + "px";

  var a = sheet.animate([{opacity:1},{opacity:0}], {duration:180, easing:'ease-in', fill:'forwards'});
  var b = dialog.animate([{transform:'scale(1)',opacity:1},{transform:'scale(0.84)',opacity:0}], {duration:220, easing:'cubic-bezier(.4,0,.6,1)', fill:'forwards'});

  var done = function() { if (cb) try{cb();}catch{}; if (__d_overlay) try{closeDirectorExplorer(true);}catch{} };
  var fin = 0; var mark=function(){ if(++fin>=2) done(); };
  a.addEventListener('finish', mark, {once:true});
  b.addEventListener('finish', mark, {once:true});
  setTimeout(mark, 260);
}

function d_escCloser(e){ if (e.key === 'Escape') d_animatedCloseThen(); }
function d_hashCloser(){ d_animatedCloseThen(); }

function d_renderIntoGrid(items){
  var grid = __d_overlay.querySelector('.ge-grid');
  var empty = __d_overlay.querySelector('.ge-empty');

  if ((!items || items.length === 0) && grid.children.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  var frag = document.createDocumentFragment();
  for (var it of items) frag.appendChild(createCardFor(it));
  grid.appendChild(frag);
  pruneGridIfNeeded();
}

function d_loadMore() {
  if (!__d_overlay || __d_busy) return;
  __d_busy = true;

  if (__d_abort) { try { __d_abort.abort(); } catch {} }
  __d_abort = new AbortController();

  var LIMIT = 40;
  var { userId } = getSessionInfo();
  var params = new URLSearchParams();
  params.set("IncludeItemTypes", "Movie,Series");
  params.set("Recursive", "true");
  params.set("Fields", COMMON_FIELDS);
  params.set("SortBy", "CommunityRating,DateCreated");
  params.set("SortOrder", "Descending");
  params.set("Limit", String(LIMIT));
  params.set("StartIndex", String(__d_startIndex));
  params.set("PersonIds", __d_person.Id);

  var url = "/Users/" + (encodeURIComponent(userId)) + "/Items?" + params.toString();

  try {
    var data = makeApiRequest(url, { signal: __d_abort.signal });
    var items = Array.isArray(data.Items) ? data.Items : [];
    d_renderIntoGrid(items);
    __d_startIndex += items.length;
    if (items.length < LIMIT) { try { __d_io.disconnect(); } catch {} }
  } catch (e) {
    if (e.name !== 'AbortError') console.error("Erro ao buscar explorador de diretor:", e);
  } finally {
    __d_busy = false;
  }
}

export function openDirectorExplorer(person) {
  if (__d_overlay) { try { closeDirectorExplorer(true); } catch {} }

  __d_person = { Id: String(person.Id || ""), Name: String(person.Name || "") };
  var { serverId } = getSessionInfo();
  __d_serverId = serverId;
  __d_startIndex = 0;

  __d_overlay = document.createElement('div');
  __d_overlay.className = 'genre-explorer-overlay';
  __d_overlay.innerHTML = "\n    <div class=\"genre-explorer\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Director Explorer\">\n      <div class=\"ge-header\">\n        <div class=\"ge-title\">\n          " + (escapeHtml(__d_person.Name)) + " • " + ((getConfig().languageLabels.all) || "Tudo") + "\n        </div>\n        <div class=\"ge-actions\">\n          <button class=\"ge-close\" aria-label=\"" + ((getConfig().languageLabels.close) || "Fechar") + "\">✕</button>\n        </div>\n      </div>\n      <div class=\"ge-content\">\n        <div class=\"ge-grid\" role=\"list\"></div>\n        <div class=\"ge-empty\" style=\"display:none\">\n          " + ((getConfig().languageLabels.noResults) || "Nenhum conteúdo encontrado") + "\n        </div>\n        <div class=\"ge-sentinel\"></div>\n      </div>\n    </div>\n  ";
  document.body.appendChild(__d_overlay);
  injectGEPerfStyles();
  try { d_playOpenAnimation(__d_overlay); } catch {}

  var grid = __d_overlay.querySelector('.ge-grid');
  bindExplorerGridDetails(grid);

  window.addEventListener('hashchange', d_hashCloser, { passive: true });
  __d_overlay.querySelector('.ge-close').addEventListenerfunction('click', () d_animatedCloseThen(), { passive:true });
  __d_overlay.addEventListenerfunction('click', (e) { if (e.target === __d_overlay) d_animatedCloseThen(); }, { passive:true });
  document.addEventListener('keydown', d_escCloser, { passive:true });
  var scroller = __d_overlay.querySelector('.ge-content');
  var onScrollPerf = function() {
    __scrollActive = true;
    if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
    __scrollIdleTimer = setTimeoutfunction(() {
      __scrollActive = false;
      if (!__hydrationRAF && __hydrationQueue.length) {
        __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
      }
    }, 120);
  };
  scroller.addEventListener('scroll', onScrollPerf, { passive: true });
  __d_overlay.__onScrollPerf = onScrollPerf;

  d_loadMore();
  var sentinel = __d_overlay.querySelector('.ge-sentinel');
  __d_io = new IntersectionObserverfunction((ents){
    for (var ent of ents) {
      if (ent.isIntersecting) d_loadMore();
    }
  }, { root: scroller, rootMargin: '800px 0px' });
  __d_io.observe(sentinel);
}

export function closeDirectorExplorer(skipAnimation = false) {
  if (!__d_overlay) return;
  try { document.removeEventListener('keydown', d_escCloser); } catch {}
  try { window.removeEventListener('hashchange', d_hashCloser); } catch {}
  try { __d_io.disconnect(); } catch {}
  __d_io = null;
  if (__d_abort) { try { __d_abort.abort(); } catch {} __d_abort = null; }

  var cleanup = function() {
    try {
      var scroller = __d_overlay.querySelector('.ge-content');
      scroller.removeEventListener('scroll', __d_overlay.__onScrollPerf);
      __d_overlay.__onScrollPerf = null;
    } catch {}
    __d_overlay.remove();
    __d_overlay = null;
    __d_busy = false;
    __d_startIndex = 0;
    __d_isClosing = false;
    __d_person = { Id: "", Name: "" };
  };

  if (skipAnimation) { cleanup(); return; }
  d_animatedCloseThen(cleanup);
}

export function closeGenreExplorer(skipAnimation = false) {
  if (!__overlay) return;
  try { document.removeEventListener('keydown', escCloser); } catch {}
  try { window.removeEventListener('hashchange', hashCloser); } catch {}

  try {
    var scroller = __overlay.querySelector('.ge-content');
    scroller.removeEventListener('scroll', __overlay.__onScrollPerf);
    __overlay.__onScrollPerf = null;
  } catch {}

  try { __io.disconnect(); } catch {}
  __io = null;
  if (__abort) { try { __abort.abort(); } catch {} __abort = null; }

  var cleanup = function() {
    __overlay.remove();
    __overlay = null;
    __busy = false;
    __startIndex = 0;
    __genre = "";
    __isClosing = false;
  };

  if (skipAnimation) {
    cleanup();
    return;
  }
  animatedCloseThen(cleanup);
}

function playOpenAnimation(overlayEl) {
  var sheet = overlayEl;
  var dialog = overlayEl.querySelector('.genre-explorer');
  var origin = __originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };

  var setOrigin = function(el) { el.style.transformOrigin = (origin.x) + "px " + (origin.y) + "px"; };
  setOrigin(dialog);

  sheet.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 220, easing: 'ease-out', fill: 'both' }
  );

  dialog.animate(
    [{ transform: 'scale(0.84)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
  );
}

function animatedCloseThen(cb) {
  if (!__overlay || __isClosing) { if (cb) cb(); return; }
  __isClosing = true;
  var sheet = __overlay;
  var dialog = __overlay.querySelector('.genre-explorer');
  var origin = __originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };

  var setOrigin = function(el) { el.style.transformOrigin = (origin.x) + "px " + (origin.y) + "px"; };
  setOrigin(dialog);

  var sheetAnim = sheet.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 180, easing: 'ease-in', fill: 'forwards' }
  );
  var dlgAnim = dialog.animate(
    [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.84)', opacity: 0 }],
    { duration: 220, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }
  );

  var done = function() {
    if (cb) { try { cb(); } catch {} }
    if (__overlay) { try { closeGenreExplorer(true); } catch {} }
  };

  var finished = 0;
  var mark = function() { finished++; if (finished >= 2) done(); };
  sheetAnim.addEventListener('finish', mark, { once: true });
  dlgAnim.addEventListener('finish', mark, { once: true });
  setTimeout(mark, 260);
}

function escCloser(e){ if (e.key === 'Escape') animatedCloseThen(); }
function hashCloser(){ animatedCloseThen(); }

function loadMore() {
  if (!__overlay || __busy) return;
  __busy = true;

  if (__abort) { try { __abort.abort(); } catch {} }
  __abort = new AbortController();

  var LIMIT = 40;
  var { userId } = getSessionInfo();
  var url =
    "/Users/" + (encodeURIComponent(userId)) + "/Items?" +
    "IncludeItemTypes=Movie,Series&Recursive=true&" +
    "Genres=" + (encodeURIComponent(__genre)) + "&Fields=" + (COMMON_FIELDS) + "&" +
    "SortBy=CommunityRating,DateCreated&SortOrder=Descending&Limit=" + (LIMIT) + "&StartIndex=" + (__startIndex);

  try {
    var data = makeApiRequest(url, { signal: __abort.signal });
    var items = Array.isArray(data.Items) ? data.Items : [];
    renderIntoGrid(items);
    __startIndex += items.length;
    if (items.length < LIMIT) { try { __io.disconnect(); } catch {} }
  } catch (e) {
    if (e.name !== 'AbortError') console.error("Erro ao buscar explorador de gênero:", e);
  } finally {
    __busy = false;
  }
}

function renderIntoGrid(items){
  var grid = __overlay.querySelector('.ge-grid');
  var empty = __overlay.querySelector('.ge-empty');

  if ((!items || items.length === 0) && grid.children.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  var frag = document.createDocumentFragment();
  for (var it of items) {
    var card = createCardFor(it);
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  pruneGridIfNeeded();
}

function createCardFor(item) {
  var serverId = __serverId || __p_serverId || "";
  var posterUrlHQ = buildPosterUrlHQ(item);
  var posterSetHQ = posterUrlHQ ? buildPosterSrcSet(item) : "";
  var posterUrlLQ = buildPosterUrlLQ(item);
  var isSeries = item.Type === "Series";
  var cfg = getConfig() || {};
  var typeLabel = isSeries
    ? ((cfg.languageLabels && cfg.languageLabels.dizi) || "Série")
    : ((cfg.languageLabels && cfg.languageLabels.film) || "Filme");
  var typeIcon = isSeries ? 'tv' : 'film';

  var ageChip = formatOfficialRatingLabel(item.OfficialRating || "");
  var year = item.ProductionYear || "";
  var runtimeTicks = isSeries ? item.CumulativeRunTimeTicks : item.RunTimeTicks;
  var runtime = formatRuntime(runtimeTicks);
  var runtimeText = runtime ? getRuntimeWithIcons(runtime) : "";
  var genresText = Array.isArray(item.Genres) ? item.Genres.slice(0, 3).join(", ") : "";

  var community = Number.isFinite(item.CommunityRating)
    ? "<div class=\"community-rating\" title=\"Community Rating\">⭐ " + (Number(item.CommunityRating).toFixed(1)) + "</div>"
    : "";

  var a = document.createElement('a');
  a.className = 'card ge-card personal-recs-card';
  a.href = getDetailsUrl(item.Id, serverId);
  a.setAttribute('role','listitem');
  a.dataset.itemId = item.Id;
  a.setAttribute('data-key', makeItemKey(item));

  a.innerHTML = "\n    <div class=\"cardBox\">\n      <div class=\"cardImageContainer\">\n        <img class=\"cardImage\" alt=\"" + (escapeHtml(item.Name)) + "\" loading=\"lazy\" decoding=\"async\">\n        <div class=\"prc-top-badges\">\n          " + (community) + "\n          <div class=\"prc-type-badge\">\n            " + (faIconHtml(typeIcon, "prc-type-icon")) + "\n            " + (escapeHtml(typeLabel)) + "\n          </div>\n        </div>\n        <div class=\"prc-gradient\"></div>\n        <div class=\"prc-overlay\">\n          <div class=\"prc-titleline\">\n            " + (escapeHtml(item.Name || "")) + "\n          </div>\n          <div class=\"prc-meta\">\n            ${ageChip ? "<span class="prc-age">${ageChip}</span><span class="prc-dot">•</span>" : \"\"}\n            ${year ? "<span class="prc-year">${year}</span><span class="prc-dot">•</span>" : \"\"}\n            ${runtimeText ? "<span class="prc-runtime">${runtimeText}</span>" : \"\"}\n          </div>\n          ${genresText ? "<div class="prc-genres">${escapeHtml(genresText)}</div>" : \"\"}\n        </div>\n      </div>\n    </div>\n  ";

  var img = a.querySelector('.cardImage');
  try { img.setAttribute('sizes', '(max-width: 640px) 45vw, (max-width: 1200px) 22vw, 220px'); } catch {}
  if (posterUrlHQ) {
    hydrateBlurUp(img, {
      lqSrc: posterUrlLQ,
      hqSrc: posterUrlHQ,
      hqSrcset: posterSetHQ,
      fallback: PLACEHOLDER_URL
    });
  } else {
    try { img.style.display = 'none'; } catch {}
    var noImg = document.createElement('div');
    noImg.className = 'prc-noimg-label';
    noImg.textContent =
      (cfg.languageLabels && (cfg.languageLabels.noImage || cfg.languageLabels.loadingText))
      || 'Sem imagem';
    noImg.style.minHeight = '220px';
    noImg.style.display = 'flex';
    noImg.style.alignItems = 'center';
    noImg.style.justifyContent = 'center';
    noImg.style.textAlign = 'center';
    noImg.style.padding = '12px';
    noImg.style.fontWeight = '600';
    a.querySelector('.cardImageContainer').prepend(noImg);
  }

  a.addEventListenerfunction('jms:cleanup', () {
    unobserveImage(img);
  }, { once: true });

  return a;
}


var __p_overlay = null;
var __p_abort = null;
var __p_busy = false;
var __p_startIndex = 0;
var __p_serverId = "";
var __p_io = null;
var __p_originPoint = null;
var __p_isClosing = false;
var __p_seenIds = new Set();
var __p_seenKeys = new Set();
var __p_topGenres = [];
var __p_genreStartIndex = 0;
var __p_fallbackStartIndex = 0;
var __p_genreDone = false;
var __p_fallbackDone = false;

function p_playOpenAnimation(overlayEl) {
  var sheet = overlayEl;
  var dialog = overlayEl.querySelector('.genre-explorer');
  var origin = __p_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = (origin.x) + "px " + (origin.y) + "px";
  sheet.animate([{opacity:0},{opacity:1}], {duration:220, easing:'ease-out', fill:'both'});
  dialog.animate([{transform:'scale(0.84)',opacity:0},{transform:'scale(1)',opacity:1}], {duration:280, easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'});
}

function p_animatedCloseThen(cb) {
  if (!__p_overlay || __p_isClosing) { if (cb) cb(); return; }
  __p_isClosing = true;
  var sheet = __p_overlay;
  var dialog = __p_overlay.querySelector('.genre-explorer');
  var origin = __p_originPoint || { x: (window.innerWidth/2)|0, y: (window.innerHeight/2)|0 };
  dialog.style.transformOrigin = (origin.x) + "px " + (origin.y) + "px";

  var a = sheet.animate([{opacity:1},{opacity:0}], {duration:180, easing:'ease-in', fill:'forwards'});
  var b = dialog.animate([{transform:'scale(1)',opacity:1},{transform:'scale(0.84)',opacity:0}], {duration:220, easing:'cubic-bezier(.4,0,.6,1)', fill:'forwards'});
  var done = function() { if (cb) try{cb();}catch{}; if (__p_overlay) try{closePersonalExplorer(true);}catch{} };
  var fin = 0; var mark=function(){ if(++fin>=2) done(); };
  a.addEventListener('finish', mark, {once:true}); b.addEventListener('finish', mark, {once:true}); setTimeout(mark,260);
}

function p_escCloser(e){ if (e.key === 'Escape') p_animatedCloseThen(); }
function p_hashCloser(){ p_animatedCloseThen(); }

function p_loadMore() {
  if (!__p_overlay || __p_busy) return;
  __p_busy = true;

  if (__p_abort) { try { __p_abort.abort(); } catch {} }
  __p_abort = new AbortController();

  var LIMIT = 40;
  var { userId } = getSessionInfo();
  if (!Array.isArray(__p_topGenres) || !__p_topGenres.length) {
    try {
      __p_topGenres = getCachedUserTopGenres(3);
    } catch {
      __p_topGenres = [];
    }
    __p_genreDone = !__p_topGenres.length;
  }

  try {
    var unique = [];
    var attempts = 0;

    var fetchSourceBatch = function({ genres = null, startIndex = 0, limit = 80 } = {}) {
      var params = new URLSearchParams();
      params.set("IncludeItemTypes", "Movie,Series");
      params.set("Recursive", "true");
      params.set("Filters", "IsUnplayed");
      params.set("Fields", COMMON_FIELDS);
      params.set("SortBy", genres.length ? "CommunityRating,DateCreated" : "Random,CommunityRating,DateCreated");
      params.set("SortOrder", "Descending");
      params.set("Limit", String(limit));
      params.set("StartIndex", String(startIndex));
      if (genres.length) params.set("Genres", genres.join("|"));

      var url = "/Users/" + (encodeURIComponent(userId)) + "/Items?" + params.toString();
      var data = makeApiRequest(url, { signal: __p_abort.signal });
      return Array.isArray(data.Items) ? data.Items : [];
    };

    var appendUniqueItems = function(items) {
      for (var it of items) {
        if (!it.Id) continue;
        var k = makeItemKey(it);
        if (!k || __p_seenKeys.has(k)) continue;
        __p_seenKeys.add(k);
        __p_seenIds.add(it.Id);
        unique.push(it);
        if (unique.length >= LIMIT) break;
      }
    };

    while (unique.length < LIMIT && attempts < 6 && (!__p_genreDone || !__p_fallbackDone)) {
      attempts++;
      var roundProgress = false;

      if (!__p_genreDone && unique.length < LIMIT) {
        var genreBatch = fetchSourceBatch({
          genres: __p_topGenres,
          startIndex: __p_genreStartIndex,
          limit: Math.max(LIMIT * 2, 80),
        });
        if (genreBatch.length) roundProgress = true;
        __p_genreStartIndex += genreBatch.length;
        if (genreBatch.length < Math.max(LIMIT * 2, 80)) __p_genreDone = true;
        appendUniqueItems(genreBatch);
      }

      if (!__p_fallbackDone && unique.length < LIMIT) {
        var fallbackBatch = fetchSourceBatch({
          startIndex: __p_fallbackStartIndex,
          limit: Math.max(LIMIT * 2, 80),
        });
        if (fallbackBatch.length) roundProgress = true;
        __p_fallbackStartIndex += fallbackBatch.length;
        if (fallbackBatch.length < Math.max(LIMIT * 2, 80)) __p_fallbackDone = true;
        appendUniqueItems(fallbackBatch);
      }

      if (!roundProgress) break;
    }

    var items = unique.slice(0, LIMIT);
    p_renderIntoGrid(items);
    __p_startIndex += items.length;
    if ((!items.length && __p_genreDone && __p_fallbackDone) || ((__p_genreDone && __p_fallbackDone) && items.length < LIMIT)) {
      try { __p_io.disconnect(); } catch {}
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error("Personal explorer fetch error:", e);
  } finally {
    __p_busy = false;
  }
}

function p_renderIntoGrid(items){
  var grid = __p_overlay.querySelector('.ge-grid');
  var empty = __p_overlay.querySelector('.ge-empty');

  if ((!items || items.length === 0) && grid.children.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  var frag = document.createDocumentFragment();
  for (var it of items) frag.appendChild(createCardFor(it));
  grid.appendChild(frag);
  pruneGridIfNeeded();
}

export function openPersonalExplorer() {
  if (__p_overlay) { try { closePersonalExplorer(true); } catch {} }

  var { serverId } = getSessionInfo();
  __p_serverId = serverId;
  __p_startIndex = 0;
  __p_seenIds.clear.();
  __p_seenKeys.clear.();
  __p_topGenres = [];
  __p_genreStartIndex = 0;
  __p_fallbackStartIndex = 0;
  __p_genreDone = false;
  __p_fallbackDone = false;
  __p_overlay = document.createElement('div');
  __p_overlay.className = 'genre-explorer-overlay';
  __p_overlay.innerHTML = "\n    <div class=\"genre-explorer\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Personal Explorer\">\n      <div class=\"ge-header\">\n        <div class=\"ge-title\">\n          " + ((getConfig().languageLabels.personalRecommendations) || "Sana Özel Öneriler") + " • " + ((getConfig().languageLabels.all) || "Tümü") + "\n        </div>\n        <div class=\"ge-actions\">\n          <button class=\"ge-close\" aria-label=\"" + ((getConfig().languageLabels.close) || "Fechar") + "\">✕</button>\n        </div>\n      </div>\n      <div class=\"ge-content\">\n        <div class=\"ge-grid\" role=\"list\"></div>\n        <div class=\"ge-empty\" style=\"display:none\">\n          " + ((getConfig().languageLabels.noResults) || "Nenhum conteúdo encontrado") + "\n        </div>\n        <div class=\"ge-sentinel\"></div>\n      </div>\n    </div>\n  ";
  document.body.appendChild(__p_overlay);
  injectGEPerfStyles();
  try { p_playOpenAnimation(__p_overlay); } catch {}

  var grid = __p_overlay.querySelector('.ge-grid');
  bindExplorerGridDetails(grid);

  window.addEventListener('hashchange', p_hashCloser, { passive: true });
  __p_overlay.querySelector('.ge-close').addEventListenerfunction('click', () p_animatedCloseThen(), { passive:true });
  __p_overlay.addEventListenerfunction('click', (e) { if (e.target === __p_overlay) p_animatedCloseThen(); }, { passive:true });
  document.addEventListener('keydown', p_escCloser, { passive:true });
  var scroller = __p_overlay.querySelector('.ge-content');
  var onScrollPerf = function() {
    __scrollActive = true;
    if (__scrollIdleTimer) clearTimeout(__scrollIdleTimer);
    __scrollIdleTimer = setTimeoutfunction(() {
      __scrollActive = false;
      if (!__hydrationRAF && __hydrationQueue.length) {
        __hydrationRAF = requestAnimationFrame(flushHydrationFrame);
      }
    }, 120);
  };
  scroller.addEventListener('scroll', onScrollPerf, { passive: true });
  __p_overlay.__onScrollPerf = onScrollPerf;

  p_loadMore();
  var sentinel = __p_overlay.querySelector('.ge-sentinel');
  __p_io = new IntersectionObserverfunction((ents){
    for (var ent of ents) {
      if (ent.isIntersecting) p_loadMore();
    }
  }, { root: scroller, rootMargin: '800px 0px' });
  __p_io.observe(sentinel);
}

export function closePersonalExplorer(skipAnimation = false) {
  if (!__p_overlay) return;
  try { document.removeEventListener('keydown', p_escCloser); } catch {}
  try { window.removeEventListener('hashchange', p_hashCloser); } catch {}
  try { __p_io.disconnect(); } catch {}
  __p_io = null;
  if (__p_abort) { try { __p_abort.abort(); } catch {} __p_abort = null; }
  var cleanup = function() {
    try {
      var scroller = __p_overlay.querySelector('.ge-content');
      scroller.removeEventListener('scroll', __p_overlay.__onScrollPerf);
      __p_overlay.__onScrollPerf = null;
    } catch {}
    __p_overlay.remove();
    __p_overlay = null;
    __p_busy = false;
    __p_startIndex = 0;
    __p_isClosing = false;
    __p_seenIds.clear.();
    __p_seenKeys.clear.();
    __p_topGenres = [];
    __p_genreStartIndex = 0;
    __p_fallbackStartIndex = 0;
    __p_genreDone = false;
    __p_fallbackDone = false;
  };
  if (skipAnimation) { cleanup(); return; }
  p_animatedCloseThen(cleanup);
}
