import { makeApiRequest, updateFavoriteStatus, getSessionInfo, fetchItemDetails } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getConfig } from "./config.js";
import { getVideoQualityText } from "./containerUtils.js";
import { tryOpenTrailerPopover, hideTrailerPopover } from "./studioTrailerPopover.js";
import { cleanupImageResourceRefs } from "./imageResourceCleanup.js";

var config = getConfig();
var DETAILS_TTL = 60 * 60 * 1000;
var detailsCache = new Map();
var DETAILS_LRU_MAX = 300;

var __miniPop = null;
var __miniCloseTimer = null;
var __cssLoaded = false;
var __miniOpenSeq = 0;
var __miniNavSeq  = 0;
var __miniTombstoneUntil = 0;

var __miniTimers = new Set();
var __abortByCard = new Map();

var __activeHoverCard = null;

function isAudioItem(it) {
  var t = (it.Type || it.MediaType || '').toLowerCase();
  return ['audio', 'musictrack', 'musicalbum', 'audiobook', 'playlist'].includes(t);
}

function isPersonItem(it) {
  var t = (it.Type || it.MediaType || '').toLowerCase();
  return t === 'person';
}

function allowTrailerPopover() {
  var cfg = getConfig();
  var localOk  = !!cfg.studioHubsHoverVideo;
  var globalOk = (cfg.globalPreviewMode === 'studioMini') && !!cfg.studioMiniTrailerPopover;
  return localOk || globalOk;
}

function isMobileLike() {
  return (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches)
    || (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
    || (window.innerWidth <= 768);
}

function ensureMiniPopover() {
  if (__miniPop) return __miniPop;

  var el = document.createElement("div");
  el.className = "mini-poster-popover";
  el.innerHTML = "\n    <div class=\"mini-bg\" aria-hidden=\"true\"></div>\n    <div class=\"mini-overlay\">\n      <button class=\"mini-close\" type=\"button\" aria-label=\"Fechar\" title=\"Fechar\">✕</button>\n      <div class=\"mini-title\"></div>\n      <div class=\"mini-meta\">\n        <div class=\"mini-topline\">\n          <div class=\"mini-left\">\n            <span class=\"mini-year\">📅 <b class=\"v\"></b></span>\n            <span class=\"mini-dot\" aria-hidden=\"true\">•</span>\n            <span class=\"mini-runtime\">⏱️ <b class=\"v\"></b></span>\n            <span class=\"mini-quality-inline\"></span>\n          </div>\n        </div>\n        <div class=\"mini-ratings\">\n          <span class=\"mini-star\" title=\"Community\">⭐ <b class=\"v\"></b></span>\n          <span class=\"mini-tomato\" title=\"Critic\">🍅 <b class=\"v\"></b></span>\n          <span class=\"mini-age\" title=\"Age\"></span>\n        </div>\n        <div class=\"mini-tags\"></div>\n        <div class=\"mini-audio\"></div>\n      </div>\n      <p class=\"mini-overview\"></p>\n    </div>\n  ";

  var host = window.__studioHubPreviewContainer || document.body;
  host.appendChild(el);

  __miniPop = el;

  var closeBtn = __miniPop.querySelector('.mini-close');
  closeBtn.addEventListenerfunction('click', (e) {
    e.preventDefault();
    try { hideMiniPopover(); } catch {}
    try { hideTrailerPopover(0); } catch {}
  }, { passive: false });

  __miniPop.addEventListenerfunction('pointerenter', () {
    if (__miniCloseTimer) { clearTimeout(__miniCloseTimer); __miniCloseTimer = null; }
  }, { passive: true });

  __miniPop.addEventListenerfunction('pointerleave', () {
    scheduleHideMini(120);
    try { hideTrailerPopover(120); } catch {}
  }, { passive: true });

  return el;
}

function cleanupMiniPopoverResources(pop = __miniPop) {
  if (!pop) return;
  try { cleanupImageResourceRefs(pop, { revokeDetachedBlobs: true }); } catch {}
}

function abortCardOpen(cardEl) {
  var ac = __abortByCard.get(cardEl);
  if (!ac) return;
  try { ac.abort(); } catch {}
  __abortByCard.delete(cardEl);
}

function abortAllMiniOpens() {
  for (var [cardEl, ac] of __abortByCard.entries()) {
    try { ac.abort(); } catch {}
    __abortByCard.delete(cardEl);
  }
}

function destroyMiniPopover() {
  if (!__miniPop) return;
  try { hideTrailerPopover(0); } catch {}
  try { window.dispatchEvent(new Event("studiohubs:miniDestroyed")); } catch {}
  cleanupMiniPopoverResources(__miniPop);
  try { __miniPop.remove(); } catch {}
  __miniPop = null;
}

function scheduleHideMini(delay = 140) {
  if (__miniCloseTimer) clearTimeout(__miniCloseTimer);
  __miniCloseTimer = setTimeoutfunction(() hideMiniPopover(), delay);
  try { hideTrailerPopover(delay); } catch {}
}

function __resetFx(el) {
  if (!el) return;
  el.style.animation = "none";
  el.style.transition = "none";
  void el.offsetWidth;
  el.style.animation = "";
  el.style.transition = "";
}

function __getTotalAnimMs(el) {
  var cs = getComputedStyle(el);
  var toArr = function(v) (v || "0s").split(",").map(function(s) s.trim());
  var toMs = function(s) {
    var n = parseFloat(s) || 0;
    return s.endsWith("ms") ? n : n * 1000;
  };
  var ad = toArr(cs.animationDuration).map(toMs);
  var at = toArr(cs.animationDelay).map(toMs);
  var td = toArr(cs.transitionDuration).map(toMs);
  var tt = toArr(cs.transitionDelay).map(toMs);
  var maxAnim = ad.reducefunction((m,v,i)Math.max(m, v+(at[i]||0)), 0);
  var maxTran = td.reducefunction((m,v,i)Math.max(m, v+(tt[i]||0)), 0);
  return Math.max(maxAnim, maxTran, 0);
}

export function hideMiniPopover() {
  if (__miniCloseTimer) { clearTimeout(__miniCloseTimer); __miniCloseTimer = null; }
  if (!__miniPop) return;

  var el = __miniPop;
  var wasVisible = el.classList.contains("visible");
  el.classList.remove("visible");

  if (!wasVisible) {
    el.classList.remove("leaving");
    el.style.display = "none";
    cleanupMiniPopoverResources(el);
    return;
  }

  el.classList.remove("leaving");
  __resetFx(el);
  __resetFx(el.querySelector(".mini-bg"));
  __resetFx(el.querySelector(".mini-overlay"));
  void el.offsetWidth;
  el.classList.add("leaving");
  el.style.pointerEvents = "none";

  var done = false;
  var cleanup = function() {
    if (done) return;
    done = true;

    if (el.classList.contains("visible")) {
      el.classList.remove("leaving");
      el.style.pointerEvents = "";
      el.removeEventListener("animationend", onEnd, true);
      el.removeEventListener("animationcancel", onEnd, true);
      el.removeEventListener("transitionend", onEnd, true);
      if (safety) clearTimeout(safety);
      return;
    }

    el.classList.remove("leaving");
    el.style.display = "none";
    el.style.pointerEvents = "";
    el.removeEventListener("animationend", onEnd, true);
    el.removeEventListener("animationcancel", onEnd, true);
    el.removeEventListener("transitionend", onEnd, true);
    if (safety) clearTimeout(safety);
    try { window.dispatchEvent(new Event("studiohubs:miniHidden")); } catch {}
    try { hideTrailerPopover(0); } catch {}
    cleanupMiniPopoverResources(el);
  };

  var onEnd = function() cleanup();

  el.addEventListener("animationend", onEnd, true);
  el.addEventListener("animationcancel", onEnd, true);
  el.addEventListener("transitionend", onEnd, true);

  var total = Math.max(__getTotalAnimMs(el), 100);
  var safety = setTimeout(cleanup, total + 0);
}

function posNear(anchor, pop) {
  var margin = 8;
  var vw = document.documentElement.clientWidth;
  var vh = document.documentElement.clientHeight;
  var r = anchor.getBoundingClientRect();

  pop.style.display = "block";
  pop.style.opacity = "0";
  pop.style.pointerEvents = "none";

  var pw = Math.min(pop.offsetWidth || 360, vw - 2 * margin);
  var ph = Math.min(pop.offsetHeight || 260, vh - 2 * margin);

  var spaceRight  = vw - r.right  - margin;
  var spaceLeft   = r.left        - margin;
  var spaceBottom = vh - r.bottom - margin;
  var spaceTop    = r.top         - margin;

  var place = "right";
  if (spaceRight >= pw) place = "right";
  else if (spaceLeft >= pw) place = "left";
  else if (spaceBottom >= ph) place = "bottom";
  else if (spaceTop >= ph) place = "top";
  else {
    var arr = [
      { side: "right",  size: spaceRight },
      { side: "left",   size: spaceLeft },
      { side: "bottom", size: spaceBottom },
      { side: "top",    size: spaceTop }
    ].sortfunction((a,b) b.size - a.size);
    place = arr[0].side;
  }

  var left, top;
  switch (place) {
    case "right":  left = r.right + margin; top = r.top + (r.height - ph)/2; break;
    case "left":   left = r.left - margin - pw; top = r.top + (r.height - ph)/2; break;
    case "bottom": left = r.left + (r.width - pw)/2; top = r.bottom + margin; break;
    case "top":    left = r.left + (r.width - pw)/2; top = r.top - margin - ph; break;
  }
  left = Math.max(margin, Math.min(left, vw - margin - pw));
  top  = Math.max(margin, Math.min(top,  vh - margin - ph));

  pop.style.left = (Math.round(left + window.scrollX)) + "px";
  pop.style.top  = (Math.round(top  + window.scrollY)) + "px";
  pop.style.opacity = "";
  pop.style.pointerEvents = "";
}

function ticksToHMin(ticks) {
  if (!ticks || typeof ticks !== "number") return "";
  var totalMinutes = Math.round(ticks / 600000000);
  var h = Math.floor(totalMinutes / 60);
  var m = totalMinutes % 60;
  var hLbl = (config.languageLabels.hourShort || "h");
  var mLbl = (config.languageLabels.minuteShort || "m");
  if (h > 0) return (h) + (hLbl) + " " + (m) + (mLbl);
  return (m) + (mLbl);
}

function uniq(arr) { return Array.from(new Set(arr)); }

var LANG_SHORT = {
  tur: "TR", tr: "TR", turkish:"TR",
  eng: "EN", en: "EN", english:"EN",
  deu: "DE", ger:"DE", de:"DE", german:"DE",
  fra: "FR", fre:"FR", fr:"FR", french:"FR",
  rus: "RU", ru:"RU", russian:"RU",
  spa: "ES", es:"ES", spanish:"ES",
  ita: "IT", it:"IT", italian:"IT",
  jpn: "JA", ja:"JA", japanese:"JA",
  kor: "KO", ko:"KO", korean:"KO",
  zho: "ZH", chi:"ZH", zh:"ZH", chinese:"ZH"
};

function shortLang(v) {
  if (!v) return null;
  var s = String(v).toLowerCase();
  return LANG_SHORT[s] || LANG_SHORT[s.slice(0,2)] || s.slice(0,2).toUpperCase();
}

function buildPosterUrl(it, h = 400, q = 95) {
  var tag = it.ImageTags.Primary || it.PrimaryImageTag;
  if (!tag) return null;
  return "/Items/" + (it.Id) + "/Images/Primary?tag=" + (encodeURIComponent(tag)) + "&fillHeight=" + (h) + "&quality=" + (q);
}

function buildBackdropUrl(it, idx = 0) {
  var t = (it.BackdropImageTags || [])[idx];
  if (!t) return null;
  return "/Items/" + (it.Id) + "/Images/Backdrop/" + (idx) + "?tag=" + (encodeURIComponent(t)) + "&quality=90";
}

function getDetails(itemId, abortSignal) {
  var cached = detailsCache.get(itemId);
  if (cached && (Date.now() - cached.ts) < DETAILS_TTL) return cached.data;

  try {
    var data = fetchItemDetails(itemId, { signal: abortSignal });
    if (!data) return null;

    if (data.Type === 'Season' && data.SeriesId) {
      var series = fetchItemDetails(data.SeriesId, { signal: abortSignal });
      data.__series = series || null;
    }

    detailsCache.set(itemId, { ts: Date.now(), data });
    if (detailsCache.size > DETAILS_LRU_MAX) {
      var oldest = detailsCache.keys().next().value;
      detailsCache.delete(oldest);
    }
    return data;
  } catch {
    return null;
  }
}

function safeJoin(arr, sep = " • ") {
  var a = Array.isArray(arr) ? arr.filter(Boolean).map(function(x) String(x).trim()).filter(Boolean) : [];
  return a.length ? a.join(sep) : "";
}

function parseDateMaybe(v) {
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(v) {
  var d = parseDateMaybe(v);
  if (!d) return "";
  try {
    return d.toLocaleDateString(config.culture || undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function calcAge(birth, deathOrNow) {
  var b = parseDateMaybe(birth);
  var e = deathOrNow ? parseDateMaybe(deathOrNow) : new Date();
  if (!b || !e) return null;
  var age = e.getFullYear() - b.getFullYear();
  var m = e.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && e.getDate() < b.getDate())) age--;
  return (age >= 0 && age < 130) ? age : null;
}

function getPersonFacts(item) {
  var birth = item.PremiereDate || item.BirthDate || item.DateOfBirth;
  var death = item.EndDate || item.DeathDate || item.DateOfDeath;

  var birthStr = fmtDate(birth);
  var deathStr = fmtDate(death);

  var birthPlace =
    item.BirthLocation ||
    (Array.isArray(item.ProductionLocations) && item.ProductionLocations[0]) ||
    item.OriginalTitle || "";

  var age = birth ? calcAge(birth, death || null) : null;
  var knownFor =
    safeJoin(item.KnownFor) ||
    safeJoin(item.Tags) ||
    safeJoin(item.Studios) ||
    safeJoin(item.Genres);

  var labels = getConfig().languageLabels || {};

  var lines = [];

  if (birthStr) {
    var birthLabel = labels.birthLabel || "Nascimento:";
    lines.push("🎂 " + (birthLabel) + " " + (birthStr) + "${age != null && !deathStr ? " (${age})" : \"\"}");
  }

  if (birthPlace) {
    var placeLabel = labels.placeLabel || "Local:";
    lines.push("📍 " + (placeLabel) + " " + (birthPlace));
  }

  if (deathStr) {
    var deathLabel = labels.deathLabel || "Falecimento:";
    lines.push("🕯️ " + (deathLabel) + " " + (deathStr) + "${age != null ? " (${age})" : \"\"}");
  }

  if (knownFor) {
    var knownLabel = labels.knownLabel || "Conhecido por:";
    lines.push("🏷️ " + (knownLabel) + " " + (knownFor));
  }

  return { lines, birthYear: parseDateMaybe(birth).getFullYear.() || null };
}

function fillMiniContent(pop, itemBase, details) {
  var titleWrap = pop.querySelector(".mini-title");

  var yearWrap = pop.querySelector(".mini-year");
  var yearEl = pop.querySelector(".mini-year .v");

  var rtWrap = pop.querySelector(".mini-runtime");
  var rtEl = pop.querySelector(".mini-runtime .v");

  var dotEl = pop.querySelector(".mini-dot");

  var starWrap = pop.querySelector(".mini-star");
  var starVal = pop.querySelector(".mini-star .v");

  var tomWrap = pop.querySelector(".mini-tomato");
  var tomVal = pop.querySelector(".mini-tomato .v");

  var ageWrap = pop.querySelector(".mini-age");
  var tagsEl = pop.querySelector(".mini-tags");
  var audioEl = pop.querySelector(".mini-audio");
  var qualityEl = pop.querySelector(".mini-quality-inline");
  var ovEl = pop.querySelector(".mini-overview");
  var bgEl = pop.querySelector(".mini-bg");

  var item = { ...itemBase, ...details };

  if (item.Type === 'Season' && details.__series) {
    var s = details.__series;
    item = {
      ...item,
      Overview: item.Overview || s.Overview,
      Genres: (Array.isArray(item.Genres) && item.Genres.length) ? item.Genres : (s.Genres || []),
      OfficialRating: item.OfficialRating || s.OfficialRating,
      ProductionYear: item.ProductionYear || s.ProductionYear,
      CommunityRating: (typeof item.CommunityRating === 'number') ? item.CommunityRating : s.CommunityRating,
      CriticRating: (typeof item.CriticRating === 'number') ? item.CriticRating : s.CriticRating,
      ImageTags: item.ImageTags && Object.keys(item.ImageTags).length ? item.ImageTags : s.ImageTags,
      BackdropImageTags: (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length)
        ? item.BackdropImageTags : (s.BackdropImageTags || []),
      MediaStreams: Array.isArray(item.MediaStreams) && item.MediaStreams.length ? item.MediaStreams : (s.MediaStreams || [])
    };
  }

  var poster = buildPosterUrl(item, 600, 95) || buildBackdropUrl(item, 0);
  bgEl.style.backgroundImage = poster ? "url(\"" + (poster) + "\")" : "none";

  if (isAudioItem(item)) {
    var artistName = item.Artists && item.Artists.length > 0
      ? item.Artists[0]
      : item.AlbumArtist || item.SeriesName || '';
    var titleText = item.Name || item.Album || '';
    if (titleWrap) {
      if (artistName && titleText) titleWrap.textContent = (artistName) + " - " + (titleText);
      else if (titleText) titleWrap.textContent = titleText;
      else titleWrap.textContent = '';
      titleWrap.style.display = titleWrap.textContent ? '' : 'none';
    }
  } else {
    if (titleWrap) {
      titleWrap.textContent = item.Name || item.SeriesName || '';
      titleWrap.style.display = titleWrap.textContent ? '' : 'none';
    }
  }

  var isPerson = isPersonItem(item);

  var hasQual = false;
  qualityEl.innerHTML = "";
  qualityEl.style.display = "none";

  starWrap.style.display = "none";
  tomWrap.style.display = "none";
  ageWrap.style.display = "none";

  tagsEl.innerHTML = "";
  tagsEl.style.display = "none";

  audioEl.innerHTML = "";
  audioEl.style.display = "none";

  if (isPerson) {
    var facts = getPersonFacts(item);

    if (yearWrap) yearWrap.style.display = "none";
    if (rtWrap) rtWrap.style.display = "none";
    if (dotEl) dotEl.style.display = "none";
    if (facts.lines && facts.lines.length) {
      tagsEl.innerHTML = facts.lines.map(function(t) "<span class=\"mini-tag\">" + (t) + "</span>").join("");
      tagsEl.style.display = "";
    } else {
      tagsEl.innerHTML = "";
      tagsEl.style.display = "none";
    }

    var bio = (item.Overview || item.Biography || item.Description || "").trim();
    ovEl.textContent = bio;
  } else {

    var hasYear = !!item.ProductionYear;
    yearEl.textContent = hasYear ? String(item.ProductionYear) : "";
    yearWrap.style.display = hasYear ? "" : "none";

    var rtTxt = ticksToHMin(item.RunTimeTicks) || "";
    var hasRt = rtTxt.length > 0;
    rtEl.textContent = rtTxt;
    rtWrap.style.display = hasRt ? "" : "none";

    var hasCommunity = (typeof item.CommunityRating === "number");
    starVal.textContent = hasCommunity ? item.CommunityRating.toFixed(1) : "";
    starWrap.style.display = hasCommunity ? "" : "none";

    var hasCritic = (typeof item.CriticRating === "number");
    tomVal.textContent = hasCritic ? (Math.round(item.CriticRating)) + "%" : "";
    tomWrap.style.display = hasCritic ? "" : "none";

    var hasAge = !!item.OfficialRating;
    ageWrap.textContent = hasAge ? item.OfficialRating : "";
    ageWrap.style.display = hasAge ? "" : "none";

    var gs = Array.isArray(item.Genres) ? item.Genres.slice(0, 3) : [];
    if (gs.length) {
      tagsEl.innerHTML = gs.map(function(g) "<span class=\"mini-tag\">" + (g) + "</span>").join("");
      tagsEl.style.display = "";
    } else {
      tagsEl.innerHTML = "";
      tagsEl.style.display = "none";
    }

    var langs = [];
    var streams = Array.isArray(item.MediaStreams) ? item.MediaStreams : [];
    langs = uniq(streams.filter(function(s) s.Type === "Audio")
      .map(function(s) shortLang(s.Language || s.DisplayLanguage || s.DisplayTitle))
      .filter(Boolean)
    ).slice(0, 3);

    if (langs.length) {
      audioEl.innerHTML = "<span class=\"mini-audio-badge\">🔊 " + (langs.join(" • ")) + "</span>";
      audioEl.style.display = "";
    } else {
      audioEl.innerHTML = "";
      audioEl.style.display = "none";
    }

    var videoStream = Array.isArray(item.MediaStreams)
      ? item.MediaStreams.find(function(s) s.Type === "Video")
      : null;

    if (videoStream) {
      var html = getVideoQualityText(videoStream);
      if (html && html.trim().length) {
        qualityEl.innerHTML = html;
        qualityEl.style.display = "";
        hasQual = true;
      } else {
        qualityEl.innerHTML = "";
        qualityEl.style.display = "none";
      }
    } else {
      qualityEl.innerHTML = "";
      qualityEl.style.display = "none";
    }

    if (dotEl) dotEl.style.display = (hasYear && (hasRt || hasQual)) ? "" : "none";

    var ov = (item.Overview || "").trim();
    ovEl.textContent = ov;
  }

  var nonPosterContent =
    (titleWrap.textContent || "").trim() ||
    (yearWrap.textContent || "").trim() ||
    (rtWrap.textContent || "").trim() ||
    (starVal.textContent || "").trim() ||
    (tomVal.textContent || "").trim() ||
    (ageWrap.textContent || "").trim() ||
    (tagsEl.textContent || "").trim() ||
    (audioEl.textContent || "").trim() ||
    (qualityEl.textContent || "").trim() ||
    (ovEl.textContent || "").trim();

  return Boolean(nonPosterContent && nonPosterContent.length);
}

export function attachMiniPosterHover(cardEl, itemLike) {
  if (!cardEl || !itemLike || !itemLike.Id) return;

  ensureMiniPopover();

  if (cardEl.dataset.miniHoverBound === '1') return;
  cardEl.dataset.miniHoverBound = '1';

  var overTimer = null;

  if (!window.__studioLastHumanInputTs) window.__studioLastHumanInputTs = 0;
  var markHuman = function() (window.__studioLastHumanInputTs = Date.now());
  if (!window.__miniHumanBound) {
    window.__miniHumanBound = true;
    window.addEventListener("pointerdown", markHuman, { capture: true, passive: true });
    window.addEventListener("pointermove", markHuman, { capture: true, passive: true });
    window.addEventListener("keydown",     markHuman, { capture: true, passive: true });
    window.addEventListener("touchstart",  markHuman, { capture: true, passive: true });
  }

  var cancelOpen = function() {
    if (overTimer) { clearTimeout(overTimer); __miniTimers.delete(overTimer); overTimer = null; }
    abortCardOpen(cardEl);
  };

  var open = function() {
    if (document.hidden || Date.now() < __miniTombstoneUntil) return;
    if (__activeHoverCard && __activeHoverCard !== cardEl) return;

    var myOpenSeq = ++__miniOpenSeq;
    var myNavSeq  = __miniNavSeq;
    var myKill    = window.__studioMiniKillToken || 0;

    cancelOpen();

    var ac = new AbortController();
    __abortByCard.set(cardEl, ac);

    if (!document.contains(cardEl)) { cancelOpen(); return; }

    var details = null;
    try {
      details = getDetails(itemLike.Id, ac.signal);
    } catch {}
    finally {
      if (__abortByCard.get(cardEl) === ac) {
        __abortByCard.delete(cardEl);
      }
    }

    if (ac.signal.aborted) return;
    if (document.hidden || Date.now() < __miniTombstoneUntil) return;
    if (__activeHoverCard !== cardEl) return;
    if (myOpenSeq !== __miniOpenSeq || myNavSeq !== __miniNavSeq) return;
    if ((window.__studioMiniKillToken || 0) !== myKill) return;
    if (!document.contains(cardEl)) { cancelOpen(); return; }

    var pop = ensureMiniPopover();

    if (!details) {
      hideMiniPopover();
      return;
    }

    var hasContent = fillMiniContent(pop, itemLike, details || {});
    if (!hasContent) {
      hideMiniPopover();
      return;
    }

    try { posNear(cardEl, pop); } catch {}
    if (!document.contains(cardEl)) { hideMiniPopover(); return; }

    requestAnimationFramefunction(() {
      if (!__miniPop) return;
      if (document.hidden || Date.now() < __miniTombstoneUntil) return;
      if (__activeHoverCard !== cardEl) return;

      if (myOpenSeq !== __miniOpenSeq || myNavSeq !== __miniNavSeq) return;
      if ((window.__studioMiniKillToken || 0) !== myKill) return;
      if (!document.contains(cardEl)) return;

      __miniPop.style.display = "block";
      __miniPop.classList.remove("leaving");
      __miniPop.classList.add("visible");
      try { window.dispatchEvent(new Event("studiohubs:miniShown")); } catch {}
    });

    new Promise(requestAnimationFrame);

    if (allowTrailerPopover()) {
      try { tryOpenTrailerPopover(cardEl, itemLike.Id, { requireMini: true }); } catch {}
    }
  };

  var scheduleOpen = function() {
    cancelOpen();
    if (document.hidden || Date.now() < __miniTombstoneUntil) return;
    var idleOk = Date.now() - (window.__studioLastHumanInputTs || 0) <= 1000;
    if (!idleOk) return;

    overTimer = setTimeout(open, isMobileLike() ? 0 : 160);
    __miniTimers.add(overTimer);
  };

  cardEl.addEventListenerfunction("pointerenter", () {
    __activeHoverCard = cardEl;
    scheduleOpen();
  }, { passive: true });

  cardEl.addEventListenerfunction("pointerleave", (e) {
    var to = e.relatedTarget || null;
    var intoPreview = !!(to && to.closest.(".mini-poster-popover, .mini-trailer-popover"));
    if (intoPreview) return;
    if (__activeHoverCard === cardEl) __activeHoverCard = null;
    cancelOpen();
    scheduleHideMini(120);
    hideTrailerPopover(120);
  }, { passive: true });

  cardEl.addEventListenerfunction("pointercancel", () {
    if (__activeHoverCard === cardEl) __activeHoverCard = null;
    cancelOpen();
    scheduleHideMini(0);
    hideTrailerPopover(0);
  }, { passive: true });

  if (isMobileLike()) {
    cardEl.addEventListenerfunction('touchstart', () {
      __miniTombstoneUntil = Date.now() + 500;
      __activeHoverCard = cardEl;
      scheduleOpen();
    }, { passive: true });
  }
}

function(() {
  if (window.__studioHubsAutoCloseInstalled) return;
  window.__studioHubsAutoCloseInstalled = true;

  var killAllTimers = function() {
    for (var t of __miniTimers) { try { clearTimeout(t); } catch {} }
    __miniTimers.clear();
  };

  var closeAll = function(destroy = false) {
    __miniOpenSeq++;
    __activeHoverCard = null;
    try { hideMiniPopover(); } catch {}
    try { hideTrailerPopover(0); } catch {}
    killAllTimers();
    abortAllMiniOpens();
    if (destroy) destroyMiniPopover();
  };

  var markNav = function() {
    if (window.__studioMiniSuppressNextNavClose && Date.now() < window.__studioMiniSuppressNextNavClose) {
      window.__studioMiniSuppressNextNavClose = 0;
      return;
    }
    __miniNavSeq++;
    __miniTombstoneUntil = Date.now() + 1500;
    window.__studioMiniKillToken = (window.__studioMiniKillToken || 0) + 1;
    closeAll(true);
  };

  var markWake = function() {
    __miniTombstoneUntil = Date.now() + 450;
    window.__studioMiniKillToken = (window.__studioMiniKillToken || 0) + 1;
    closeAll(false);
  };

  ["pushState", "replaceState"].forEach(function((fn) {
    var orig = history[fn];
    if (typeof orig === "function") {
      history[fn] = function (...args) {
        var ret = orig.apply(this, args);
        window.dispatchEvent(new Event("studiohubs:navigated"));
        markNav();
        return ret;
      };
    }
  });

  window.addEventListener("studiohubs:navigated", markNav, true);
  window.addEventListener("popstate", markNav, true);
  window.addEventListener("hashchange", markNav, true);
  window.addEventListenerfunction("pagehide", () markNav(), true);
  window.addEventListenerfunction("beforeunload", () markNav(), true);

  document.addEventListenerfunction("visibilitychange", () {
    if (document.hidden) markNav();
    else markWake();
  }, true);

  window.addEventListenerfunction("focus", () {
    __miniTombstoneUntil = Date.now() + 250;
  }, true);
  window.addEventListenerfunction("blur", () markNav(), true);
  window.addEventListenerfunction("scroll", () {
    scheduleHideMini(80);
    try { hideTrailerPopover(80); } catch {}
  }, { passive: true, capture: true });

  document.addEventListenerfunction("click", (e) {
    var a = e.target.closest.("a,[data-link],[data-href]") || null;
    if (!a) return;
    setTimeout(markNav, 0);
  }, true);

  try {
    var router = window.AppRouter || window.appRouter || window.router;
    if (router && typeof router.on === "function") {
      router.on("navigated", markNav);
      router.on("viewshow", markNav);
      router.on("viewhide", markNav);
    }
  } catch {}
})();

document.addEventListenerfunction('closeAllMiniPopovers', () {
  __miniOpenSeq++;
  __activeHoverCard = null;
  abortAllMiniOpens();
  try { hideTrailerPopover(0); } catch {}
  try { destroyMiniPopover(); } catch {}
});

if (typeof window !== 'undefined') {
  window.__closeMiniPopover = function() {
    __miniOpenSeq++;
    __activeHoverCard = null;
    abortAllMiniOpens();
    try { hideTrailerPopover(0); } catch {}
    try { destroyMiniPopover(); } catch {}
  };
}

export function openMiniPopoverFor(cardEl, itemLikeOrId) {
  ensureMiniPopover();
  var itemLike = (typeof itemLikeOrId === 'string') ? { Id: itemLikeOrId } : itemLikeOrId;
  if (!cardEl || !itemLike.Id || !document.contains(cardEl)) return;

  var myKill = (window.__studioMiniKillToken || 0);
  __activeHoverCard = cardEl;

  var details = null;
  try { details = getDetails(itemLike.Id); } catch {}

  var pop = ensureMiniPopover();
  if (!details) { hideMiniPopover(); return; }

  var hasContent = fillMiniContent(pop, itemLike, details || {});
  if (!hasContent) { hideMiniPopover(); return; }

  try { posNear(cardEl, pop); } catch {}

  requestAnimationFramefunction(() {
    if ((window.__studioMiniKillToken || 0) !== myKill) return;
    if (!document.contains(cardEl)) return;
    if (__activeHoverCard !== cardEl) return;

    pop.style.display = "block";
    pop.classList.remove("leaving");
    pop.classList.add("visible");
    try { window.dispatchEvent(new Event("studiohubs:miniShown")); } catch {}

    requestAnimationFramefunction(() {
      if (allowTrailerPopover()) {
        try { tryOpenTrailerPopover(cardEl, itemLike.Id, { requireMini: true }); } catch {}
      }
    });
  });
}

if (typeof window !== 'undefined') {
  window.openMiniPopoverFor = function(el, it) openMiniPopoverFor(el, it);
}
