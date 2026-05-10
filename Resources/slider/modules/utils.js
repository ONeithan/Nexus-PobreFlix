import { getConfig } from "./config.js";
import {
  fetchItemDetails,
  getIntroVideoUrl,
  getVideoStreamUrl,
  fetchLocalTrailers,
  pickBestLocalTrailer,
  getAuthHeader,
  playNow,
} from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { withServer, withServerSrcset, invalidateServerBaseCache, resolveServerBase } from "./jfUrl.js";

var config = getConfig();
var S = function(u) {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return withServer(u);
};

function ensureAudioPreviewCssOnce() {
  if (document.getElementById("jms-audio-preview-css")) return;
  var style = document.createElement("style");
  style.id = "jms-audio-preview-css";
  style.textContent = "\n    .jms-audio-preview-overlay {\n      align-items: flex-end;\n      background:\n        radial-gradient(circle at 76% 22%, rgba(255,255,255,.14), transparent 24%),\n        linear-gradient(180deg, rgba(6,10,18,.12), rgba(6,10,18,.58));\n      display: none;\n      inset: 0;\n      justify-content: flex-start;\n      pointer-events: none;\n      position: absolute;\n      z-index: 3;\n    }\n    .jms-audio-preview-overlay__panel {\n      backdrop-filter: blur(6px);\n      background: linear-gradient(135deg, rgba(10,18,26,.78), rgba(19,31,43,.56));\n      border: 1px solid rgba(255,255,255,.14);\n      border-radius: 16px;\n      box-shadow: 0 18px 36px rgba(0,0,0,.24);\n      color: #f5f8fb;\n      display: flex;\n      gap: 10px;\n      margin: 18px;\n      padding: 14px 16px;\n      flex-direction: row;\n      flex-wrap: wrap;\n      align-items: center;\n      max-width: min(360px, calc(100% - 36px));\n  }\n    .jms-audio-preview-overlay__eyebrow {\n      align-items: center;\n      color: rgba(235,244,255,.72);\n      display: inline-flex;\n      font-size: 11px;\n      font-weight: 700;\n      gap: 8px;\n      letter-spacing: .12em;\n      text-transform: uppercase;\n    }\n    .jms-audio-preview-overlay__title {\n      display: -webkit-box;\n      font-size: 20px;\n      font-weight: 700;\n      line-height: 1.08;\n      margin: 0;\n      overflow: hidden;\n      -webkit-box-orient: vertical;\n      -webkit-line-clamp: 2;\n    }\n    .jms-audio-preview-overlay__subtitle {\n      color: rgba(232,241,247,.78);\n      display: -webkit-box;\n      font-size: 13px;\n      line-height: 1.35;\n      margin: 0;\n      overflow: hidden;\n      -webkit-box-orient: vertical;\n      -webkit-line-clamp: 2;\n    }\n    .jms-audio-preview-overlay__bars {\n      align-items: end;\n      display: flex;\n      gap: 5px;\n      height: 22px;\n    }\n    .jms-audio-preview-overlay__bars span {\n      animation: jms-audio-preview-bars 1.4s ease-in-out infinite;\n      background: linear-gradient(180deg, rgba(255,255,255,.94), rgba(94,214,177,.86));\n      border-radius: 999px;\n      display: block;\n      height: 100%;\n      transform-origin: center bottom;\n      width: 4px;\n    }\n    .jms-audio-preview-overlay__bars span:nth-child(2) { animation-delay: .16s; }\n    .jms-audio-preview-overlay__bars span:nth-child(3) { animation-delay: .32s; }\n    .jms-audio-preview-overlay__bars span:nth-child(4) { animation-delay: .48s; }\n    @keyframes jms-audio-preview-bars {\n      0%, 100% { transform: scaleY(.38); opacity: .62; }\n      45% { transform: scaleY(1); opacity: 1; }\n    }\n    @media (prefers-reduced-motion: reduce) {\n      .jms-audio-preview-overlay__bars span { animation: none; transform: scaleY(.72); }\n    }\n  ";
  document.head.appendChild(style);
}

export function getYoutubeEmbedUrl(input) {
  if (!input || typeof input !== "string") return input;

  var isHttps = function(() {
    try { return window.location.protocol === "https:"; } catch { return false; }
  })();
  var host = function(() {
    try { return new URL(window.location.href).hostname; } catch { return ""; }
  })();
  var isPrivateHost = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(host);
  var canUseOriginAndJSAPI = isHttps && !isPrivateHost;

  if (/^[a-zA-Z0-9_-]{10,}$/.test(input) && !/youtu\.?be|youtube\.com/i.test(input)) {
    var params = new URLSearchParams({
      autoplay: "1",
      rel: "0",
      modestbranding: "1",
      iv_load_policy: "3",
      enablejsapi: canUseOriginAndJSAPI ? "1" : "0",
      playsinline: "1",
      mute: "0",
      controls: "1",
    });

    try {
      var orig = window.location.origin || "";
        if (canUseOriginAndJSAPI && orig && /^https:\/\//i.test(orig)) {
          params.set("origin", orig);
        }
      } catch {}
    return "https://www.youtube-nocookie.com/embed/" + (encodeURIComponent(input)) + "?" + (params.toString());
  }

  var isMobile = function(() {
    try {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
             (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 1024);
    } catch { return false; }
  })();

  var parseYouTubeTime = function(t) {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    var m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m) return 0;
    var h = parseInt(m[1] || "0", 10);
    var min = parseInt(m[2] || "0", 10);
    var s = parseInt(m[3] || "0", 10);
    return h * 3600 + min * 60 + s;
  };

  var ensureUrl = function(raw) {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    var lower = raw.toLowerCase();
    var isYT = /\b(youtu\.be|youtube\.com)\b/.test(lower);
    var scheme = function(() {
      try { return window.location.protocol === "https:" ? "https:" : "http:"; } catch { return "http:"; }
    })();
    return (scheme) + "//" + (raw);
  };

  var parsed;
  try {
    parsed = new URL(ensureUrl(input));
  } catch {
    return input;
  }

  var ytHost = parsed.hostname.replace(/^www\./, "").toLowerCase();
  var isYouTube = ytHost === "youtu.be" || ytHost.endsWith("youtube.com");
  if (!isYouTube) return input;

  var videoId = "";
  if (ytHost === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else {
    if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
    } else {
      videoId = parsed.searchParams.get("v") || "";
    }
  }
  if (!videoId) return input;

  var startParam = parsed.searchParams.get("start");
  var tParam = parsed.searchParams.get("t");
  var start = startParam ? parseInt(startParam, 10) : parseYouTubeTime(tParam);

  var params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    enablejsapi: canUseOriginAndJSAPI ? "1" : "0",
    playsinline: "1",
    mute: "0",
    controls: "1",
  });
  try {
    var orig = (typeof window !== "undefined" && window.location.origin) || "";
    if (canUseOriginAndJSAPI && orig && /^https:\/\//i.test(orig)) {
      params.set("origin", orig);
    }
  } catch {}

  if (Number.isFinite(start) && start > 0) params.set("start", String(start));

  return "https://www.youtube-nocookie.com/embed/" + (encodeURIComponent(
    videoId
  )) + "?" + (params.toString());
}

export function getProviderUrl(provider, id, slug = "") {
  if (!provider || !id) return "#";

  var normalizedProvider = provider.toString().trim().toLowerCase();
  var cleanId = id.toString().trim();
  var cleanSlug = slug.toString().trim();

  switch (normalizedProvider) {
    case "imdb":
      return "https://www.imdb.com/title/" + (cleanId) + "/";
    case "tmdb":
      return "https://www.themoviedb.org/movie/" + (cleanId);
    case "tvdb": {
      var pathSegment = cleanSlug || cleanId;
      var isSeries = /series/i.test(pathSegment) || /^series[-_]/i.test(pathSegment);
      return "https://www.thetvdb.com/" + (isSeries ? "series" : "movies") + "/" + (pathSegment);
    }
    default:
      return "#";
  }
}

export function debounce(func, wait = 300, immediate = false) {
  var timeout;
  return function (...args) {
    var context = this;
    var later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    var callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

export function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function __jmsIsHoverDesktop() {
  try {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  } catch { return false; }
}

export function ensureJmsDetailsOverlay({
  hostEl,
  itemId,
  serverId,
  detailsHref,
  onDetails,
  onPlay,
  showPlay = true,
} = {}) {
  if (!hostEl || !itemId) return null;

  var _detailsHref =
    detailsHref ||
    (itemId && serverId ? "#/details?id=" + (itemId) + "&serverId=" + (encodeURIComponent(serverId)) : null);

  try {
    var cs = getComputedStyle(hostEl);
    if (cs.position === "static") hostEl.style.position = "relative";
  } catch {}

  var wrap = hostEl.querySelector(".jms-details-overlay");
  if (wrap) return wrap;

  var isHoverDesktop = __jmsIsHoverDesktop();

  wrap = document.createElement("div");
  wrap.className = "jms-details-overlay";
  Object.assign(wrap.style, {
    position: "absolute",
    left: "clamp(10px, 1vw, 22px)",
    bottom: "clamp(10px, 1vw, 22px)",
    pointerEvents: "none",
    display: "flex",
    gap: "10px",
    alignItems: "center",
  });

  if (isHoverDesktop) {
    wrap.dataset.hoverOnly = "1";
  }

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jms-details-btn";
  btn.setAttribute("aria-label", "Detalhes");

  var arrowIcon = document.createElement("span");
  arrowIcon.className = "jms-details-arrow";
  arrowIcon.innerHTML = "\n    <svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">\n      <path d=\"M12 5v14M5 12l7 7 7-7\"/>\n    </svg>\n  ";
  btn.appendChild(arrowIcon);

  Object.assign(btn.style, {
    pointerEvents: "auto",
    cursor: "pointer",
    borderRadius: "50%",
    padding: "16px",
    border: "2px solid rgba(255,255,255,0.25)",
    background: "rgba(15,23,42)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  });

  if (isHoverDesktop) {
    btn.style.opacity = "0";
    btn.style.transform = "translateY(4px)";
    btn.style.pointerEvents = "none";
  }

  btn.addEventListenerfunction("click", (e) {
    e.preventDefault();
    e.stopPropagation();

    if (typeof onDetails === "function") {
      try { onDetails(e); return; } catch {}
    }

    if (_detailsHref) {
      try { window.location.hash = String(_detailsHref).replace(/^#/, ""); }
      catch { window.location.href = _detailsHref; }
    }
  });

  wrap.appendChild(btn);

  if (showPlay) {
    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "jms-play-btn";
    playBtn.setAttribute("aria-label", "Reproduzir Agora");
    playBtn.innerHTML = "\n      <span class=\"jms-play-icon\" style=\"display:flex;align-items:center;justify-content:center;\">\n        <svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\">\n          <path d=\"M8 5v14l11-7z\"></path>\n        </svg>\n      </span>\n    ";
    Object.assign(playBtn.style, {
      pointerEvents: "auto",
      cursor: "pointer",
      borderRadius: "50%",
      padding: "16px",
      border: "2px solid rgba(255,255,255,0.25)",
      background: "rgba(15,23,42)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "26px",
      height: "26px",
      transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    });

    if (isHoverDesktop) {
      playBtn.style.opacity = "0";
      playBtn.style.transform = "translateY(4px)";
      playBtn.style.pointerEvents = "none";
    }

    playBtn.addEventListenerfunction("click", (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onPlay === "function") {
        try { onPlay(); } catch {}
      }
    });

  wrap.appendChild(playBtn);
  }

  hostEl.appendChild(wrap);

  if (isHoverDesktop) {
    var show = function() wrap.classList.add("is-hover");
    var hide = function() wrap.classList.remove("is-hover");
    hostEl.addEventListener("mouseenter", show, { passive: true });
    hostEl.addEventListener("mouseleave", hide, { passive: true });
    try {
      if (hostEl.matches(":hover")) show();
    } catch {}
  }
  return wrap;
}

export function createTrailerIframe({
  config,
  RemoteTrailers,
  slide,
  backdropImg,
  itemId,
  previewItemId = null,
  serverId,
  detailsUrl,
  detailsText,
  showDetailsOverlay = true,
}) {
  var labels = config.languageLabels || {};
  var normalizePreviewPlaybackMode = function(value) (
    value === "trailer" ||
    value === "video" ||
    value === "trailerThenVideo" ||
    value === "none"
  ) ? value : null;

  var liveMode = normalizePreviewPlaybackMode(localStorage.getItem("previewPlaybackMode"));

  if (config.disableAllPlayback === true || liveMode === "none") {
    try {
      slide.classList.remove("video-active", "intro-active", "trailer-active");
      if (backdropImg) backdropImg.style.opacity = "1";
    } catch {}
    return;
  }

  try {
    var cs = getComputedStyle(slide);
    if (cs.position === "static") slide.style.position = "relative";
  } catch {}
  ensureAudioPreviewCssOnce();

  var _detailsHref =
  detailsUrl ||
  (itemId && serverId ? "#/details?id=" + (itemId) + "&serverId=" + (encodeURIComponent(serverId)) : null);

  var previewMediaItemId = previewItemId || itemId;

  var arrowIntervalId = null;

  function ensureDetailsOverlay() {
    if (!showDetailsOverlay) return null;
    if (!_detailsHref || !slide) return null;
    var wrap = ensureJmsDetailsOverlayfunction({
      hostEl: slide,
      itemId,
      serverId,
      detailsHref: _detailsHref,
      onDetails: (e) {
  try {
    isMouseOver = false;
    latestHoverId++;
    abortController.abort.("details-modal");
    abortController = new AbortController();
    if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
    try { fullCleanup(); } catch {}
    var backdropIndex = localStorage.getItem("jms_backdrop_index") || "0";
    var origin = backdropImg || slide;

    openDetailsModal({
      itemId,
      serverId,
      preferBackdropIndex: backdropIndex,
      originEl: origin
    });
  } catch (err) {
    console.error("openDetailsModal error:", err);
    navigateToDetails();
  }
},
      onPlay: function() {
        try {
          isMouseOver = false;
          latestHoverId++;
          abortController.abort.("playnow");
          abortController = new AbortController();
          if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
          try { fullCleanup(); } catch {}
          playNow(itemId);
        } catch (err) {
          console.error("PlayNow click error:", err);
          if (typeof window.showMessage === "function") {
            window.showMessage("Erro ao executar Reproduzir Agora", "error");
          }
        }
      },
      showPlay: true,
    });
    return wrap;
  }

    function navigateToDetails() {
    try {
      isMouseOver = false;
      latestHoverId++;
      abortController.abort.("navigate");
      abortController = new AbortController();
      if (enterTimeout) { clearTimeout(enterTimeout); enterTimeout = null; }
    } catch {}

    try { fullCleanup(); } catch {}
    try { detachGuards.(); } catch {}
    try { classObserver.disconnect(); } catch {}

    try {
      window.location.hash = String(_detailsHref || "").replace(/^#/, "");
    } catch {
      window.location.href = _detailsHref;
    }
  }

  function showDetailsOverlay() {
    var wrap = ensureDetailsOverlay();
    if (wrap) wrap.style.display = "flex";
  }

  function hideDetailsOverlay() {
    var wrap = slide.querySelector.(".jms-details-overlay");
    if (wrap) wrap.style.display = "none";
  }

  var isActiveSlide = function() slide.classList.contains('active');
  var mode =
    normalizePreviewPlaybackMode(liveMode) ||
    normalizePreviewPlaybackMode(config.previewPlaybackMode) ||
    (config.enableTrailerPlayback
      ? "trailer"
      : config.enableTrailerThenVideo
      ? "trailerThenVideo"
      : "video");

  if (!itemId) return;

  var videoContainer = document.createElement("div");
  videoContainer.className = "intro-video-container";
  videoContainer.style.display = "none";

  var videoElement = document.createElement("video");
  videoElement.controls = true;
  videoElement.dataset.jmsPreview = "1";
  videoElement.dataset.jmsIgnorePauseOverlay = "1";
  videoElement.muted = false;
  videoElement.autoplay = true;
  videoElement.playsInline = true;
  videoElement.style.width = "100%";
  videoElement.style.height = "100%";
  videoElement.style.transition = "opacity 0.2s ease-in-out";
  videoElement.style.opacity = "0";

  videoContainer.appendChild(videoElement);

  var audioOverlay = document.createElement("div");
  audioOverlay.className = "jms-audio-preview-overlay";
  audioOverlay.innerHTML = "\n    <div class=\"jms-audio-preview-overlay__panel\">\n      <div class=\"jms-audio-preview-overlay__eyebrow\">\n        <i class=\"fa-solid fa-wave-square\"></i>\n        <span>" + (labels.track || "Faixa") + "</span>\n      </div>\n      <div class=\"jms-audio-preview-overlay__title\"></div>\n      <div class=\"jms-audio-preview-overlay__subtitle\"></div>\n      <div class=\"jms-audio-preview-overlay__bars\" aria-hidden=\"true\">\n        <span></span>\n        <span></span>\n        <span></span>\n        <span></span>\n      </div>\n    </div>\n  ";
  videoContainer.appendChild(audioOverlay);

  var backdropContainer = slide.__backdropContainer || slide.querySelector.(".bckdrp-cntnr");
  (backdropContainer || slide).appendChild(videoContainer);

  function setPreviewPlaybackFlag(kind, itemId) {
  try {
    window.__JMS_PREVIEW_PLAYBACK = {
      active: true,
      kind,
      itemId: itemId || null,
      startedAt: Date.now()
    };
  } catch {}
}

function clearPreviewPlaybackFlag() {
  try {
    var cur = window.__JMS_PREVIEW_PLAYBACK;
    if (cur) window.__JMS_PREVIEW_PLAYBACK = { active: false };
  } catch {}
}

  var ytIframe = null;
  var playingKind = null;
  var isMouseOver = false;
  var latestHoverId = 0;
  var abortController = new AbortController();
  var enterTimeout = null;
  var detachGuards = null;
  var ytRevealTimer = null;
  var videoHideTimer = null;

  var clearYtRevealTimer = function() {
    if (!ytRevealTimer) return;
    clearTimeout(ytRevealTimer);
    ytRevealTimer = null;
  };

  var clearVideoHideTimer = function() {
    if (!videoHideTimer) return;
    clearTimeout(videoHideTimer);
    videoHideTimer = null;
  };

  var showBackdrop = function() {
    try {
      if (backdropImg) backdropImg.style.opacity = "1";
    } catch {}
  };

  var hideBackdrop = function() {
    try {
      if (backdropImg) backdropImg.style.opacity = "0";
    } catch {}
  };

  var isAudioLikeItem = function(it) {
    var type = String(it.Type || "");
    var mediaType = String(it.MediaType || "");
    return type === "Audio" || type === "MusicVideo" || mediaType === "Audio";
  };

  var setAudioOverlayState = function(active, itemDetails = null) {
    if (!audioOverlay) return;

    if (!active) {
      audioOverlay.style.display = "none";
      slide.classList.remove("jms-audio-preview-active");
      videoElement.style.display = "block";
      videoElement.style.opacity = "0";
      return;
    }

    var titleEl = audioOverlay.querySelector(".jms-audio-preview-overlay__title");
    var subtitleEl = audioOverlay.querySelector(".jms-audio-preview-overlay__subtitle");
    var titleText = itemDetails.Name || "";
    var artistText =
      (Array.isArray(itemDetails.Artists) && itemDetails.Artists.filter(Boolean).join(", ")) ||
      itemDetails.AlbumArtist ||
      itemDetails.Album ||
      "";

    if (titleEl) titleEl.textContent = titleText;
    if (subtitleEl) subtitleEl.textContent = artistText;

    audioOverlay.style.display = "flex";
    slide.classList.add("jms-audio-preview-active");
    videoElement.style.display = "none";
    videoElement.style.opacity = "0";
    showBackdrop();
  };

  videoElement.addEventListenerfunction("ended", () {
    clearVideoHideTimer();
    clearPreviewPlaybackFlag();
    setAudioOverlayState(false);
    try { videoElement.style.opacity = "0"; } catch {}
    showBackdrop();
    slide.classList.remove("video-active", "intro-active", "trailer-active");
    setTimeoutfunction(() {
      try {
        if (videoElement.ended || videoElement.paused) videoContainer.style.display = "none";
      } catch {}
    }, 200);
    playingKind = null;
  });

  var _detailsCache = new Map();

  function getDetailsCached(id, { signal } = {}) {
    if (!id) return null;
    if (_detailsCache.has(id)) return _detailsCache.get(id);
    try {
      var d = fetchItemDetails(id, { signal });
      _detailsCache.set(id, d || null);
      return d || null;
    } catch {
      _detailsCache.set(id, null);
      return null;
    }
  }

  function ticksToSeconds(ticks) {
    var n = Number(ticks) || 0;
    return n > 0 ? (n / 10_000_000) : 0;
  }

  function getSmartStartSeconds(id, { signal } = {}) {
    var LEGACY = 600;
    var d = getDetailsCached(id, { signal });
    var type = (d.Type || "").toString();

    if (type === "Audio" || type === "MusicAlbum" || type === "AudioBook") return 0;

    var durSec =
      ticksToSeconds(d.RunTimeTicks) ||
      ticksToSeconds(d.CumulativeRunTimeTicks) ||
      0;

    if (durSec > 0 && durSec < 12 * 60) return 0;
    if (durSec > 0) return Math.max(0, Math.min(LEGACY, Math.max(0, durSec - 30)));

    return LEGACY;
  }

  var delayRaw = config && (config.gecikmeSure || config.gecikmesure);
  var delay = Number.isFinite(+delayRaw) ? +delayRaw : 500;

  var canUseYTApiPostMessage = function(() {
    try {
      var isHttps = window.location.protocol === "https:";
      var host = new URL(window.location.href).hostname;
      var isPrivateHost = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(host);
      return isHttps && !isPrivateHost;
    } catch { return false; }
  })();

  var stopYoutube = function(iframe) {
    try {
      if (!canUseYTApiPostMessage) return;
      if (!iframe) return;
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "stopVideo", args: [] }),
        "*"
      );
    } catch {}
  };

  var hardStopVideo = function({ immediate = false } = {}) {
    clearPreviewPlaybackFlag();
    clearVideoHideTimer();
    setAudioOverlayState(false);
    try { videoElement.pause(); } catch {}

    var finalize = function() {
      try {
        videoElement.removeAttribute("src");
        videoElement.load();
      } catch {}
      videoContainer.style.display = "none";
      videoElement.style.opacity = "0";
      slide.classList.remove("video-active", "intro-active", "trailer-active");
    };

    var shouldFadeOut = !immediate && videoContainer.style.display !== "none";
    if (!shouldFadeOut) {
      finalize();
      return;
    }

    try { videoElement.style.opacity = "0"; } catch {}
    videoHideTimer = setTimeoutfunction(() {
      videoHideTimer = null;
      finalize();
    }, 220);
  };

  var hardStopIframe = function() {
    clearPreviewPlaybackFlag();
    clearYtRevealTimer();
    setAudioOverlayState(false);
    if (ytIframe) {
      try { stopYoutube(ytIframe); } catch {}
      try { ytIframe.src = "about:blank"; } catch {}
      try { ytIframe.remove(); } catch {}
      ytIframe = null;
    }
    slide.classList.remove("trailer-active");
  };

  var fullCleanup = function() {
    clearPreviewPlaybackFlag();
    setAudioOverlayState(false);
    hideDetailsOverlay();
    showBackdrop();
    hardStopVideo({ immediate: false });
    hardStopIframe();
    if (arrowIntervalId) { clearInterval(arrowIntervalId); arrowIntervalId = null; }
    playingKind = null;
  };

  function loadStreamFor(itemIdToPlay, hoverId, startSeconds = 0, { previewDetails = null } = {}) {
    var introUrl = getVideoStreamUrl(
      itemIdToPlay,
      1920,
      0,
      null,
      ["h264"],
      ["aac"],
      false,
      false,
      { signal: abortController.signal }
    );
    if (!isMouseOver || hoverId !== latestHoverId) throw new Error("HoverAbortError");
    if (!introUrl || introUrl === "null") return false;
    var audioPreview = isAudioLikeItem(previewDetails);
    if (audioPreview) {
      try { videoElement.style.opacity = "0"; } catch {}
      showBackdrop();
    }

    videoElement.src = introUrl;
    
    var vol = config.studioHubsVolume;
    if (vol === 'muted' || vol === 0) {
      videoElement.muted = true;
      videoElement.volume = 0;
    } else {
      videoElement.muted = false;
      videoElement.volume = Math.max(0, Math.min(1, vol / 100));
    }

    videoElement.load();
    var onMeta = function() {
      videoElement.removeEventListener("loadedmetadata", onMeta);
      if (!isMouseOver || hoverId !== latestHoverId) {
        fullCleanup();
        return;
      }
      videoElement.currentTime = startSeconds;
      videoElement
        .play()
        .thenfunction(() {
          if (audioPreview) {
            setAudioOverlayState(true, previewDetails);
          } else {
            videoElement.style.display = "block";
            videoElement.style.opacity = "1";
            hideBackdrop();
          }
        })
        .catchfunction(() {});
    };
    videoElement.addEventListener("loadedmetadata", onMeta, { once: true });
    return true;
  }

  function tryPlayLocalTrailer(hoverId) {
    if (!isActiveSlide()) return false;
    var locals = fetchLocalTrailers(previewMediaItemId, { signal: abortController.signal });
    if (!isMouseOver || hoverId !== latestHoverId || !isActiveSlide()) throw new Error("HoverAbortError");
    var best = pickBestLocalTrailer(locals);
    if (!best.Id) return false;

    if (!isActiveSlide()) return false;
    hardStopIframe();
    clearVideoHideTimer();
    videoContainer.style.display = "block";
    showDetailsOverlay();
    slide.classList.add("video-active", "intro-active", "trailer-active");
    playingKind = "localTrailer";
    setPreviewPlaybackFlag("localTrailer", best.Id);
    loadStreamFor(best.Id, hoverId, 0);
    return true;
  }

  function tryPlayRemoteTrailer(_hoverId) {
    if (!isActiveSlide()) return false;
    var trailer = Array.isArray(RemoteTrailers) && RemoteTrailers.length ? RemoteTrailers[0] : null;
    if (!trailer.Url) return false;

    var url = getYoutubeEmbedUrl(trailer.Url);
    if (!isValidUrl(url) || !isActiveSlide()) return false;

    hardStopVideo({ immediate: true });

    if (!ytIframe) {
      ytIframe = document.createElement("iframe");
      ytIframe.dataset.jmsPreview = "1";
      ytIframe.dataset.jmsIgnorePauseOverlay = "1";
      ytIframe.allow = "autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture";
      ytIframe.referrerPolicy = "origin-when-cross-origin";
      "autoplay; encrypted-media; clipboard-write; accelerometer; gyroscope; picture-in-picture";
      ytIframe.setAttribute("playsinline", "");
      ytIframe.allowFullscreen = true;
      Object.assign(ytIframe.style, {
        width: "70%",
        height: "100%",
        border: "none",
        display: "none",
        position: "absolute",
        top: "0%",
        right: "0%",
        bottom: "0",
      });
      var backdropContainer = slide.__backdropContainer || slide.querySelector.(".bckdrp-cntnr");
      (backdropContainer || slide).appendChild(ytIframe);
    }

    if (!isActiveSlide()) return false;
    clearYtRevealTimer();
    ytIframe.onload = function() {
      clearYtRevealTimer();
      if (!isMouseOver || !isActiveSlide()) return;
      hideBackdrop();
    };
    ytRevealTimer = setTimeoutfunction(() {
      ytRevealTimer = null;
      if (!isMouseOver || !isActiveSlide()) return;
      hideBackdrop();
    }, 900);
    ytIframe.style.display = "block";
    ytIframe.src = url;
    showDetailsOverlay();
    slide.classList.add("trailer-active");
    playingKind = "remoteTrailer";
    setPreviewPlaybackFlag("remoteTrailer", itemId);
    return true;
  }

  function playMainVideo(hoverId) {
    if (!isActiveSlide()) return false;
    var previewDetails = getDetailsCached(previewMediaItemId, { signal: abortController.signal });
    if (!isMouseOver || hoverId !== latestHoverId || !isActiveSlide()) throw new Error("HoverAbortError");
    hardStopIframe();
    clearVideoHideTimer();
    videoContainer.style.display = "block";
    showDetailsOverlay();
    slide.classList.add("video-active", "intro-active", "trailer-active");
    playingKind = "video";
    setPreviewPlaybackFlag("videoPreview", previewMediaItemId);
    var startSeconds = getSmartStartSeconds(previewMediaItemId, { signal: abortController.signal });
    var ok = loadStreamFor(previewMediaItemId, hoverId, startSeconds, { previewDetails });
    if (!ok) {
      fullCleanup();
      return false;
    }
    return true;
  }

  var handleEnter = function() {
    if (!isActiveSlide()) return;

    isMouseOver = true;
    showDetailsOverlay();
    latestHoverId++;
    var thisHoverId = latestHoverId;
    abortController.abort("hover-cancel");
    abortController = new AbortController();

    if (enterTimeout) {
      clearTimeout(enterTimeout);
      enterTimeout = null;
    }

    enterTimeout = setTimeoutfunction(() {
      if (!isMouseOver || thisHoverId !== latestHoverId || !isActiveSlide()) return;
      try {
        if (mode === "video") {
          if (playMainVideo(thisHoverId)) return;
        } else {
          if (tryPlayLocalTrailer(thisHoverId)) return;
          if (tryPlayRemoteTrailer(thisHoverId)) return;
          if (mode === "trailerThenVideo") {
            if (playMainVideo(thisHoverId)) return;
          } else {
            fullCleanup();
          }
        }
      } catch (e) {
        if (e.name === "AbortError" || e.message === "HoverAbortError") return;
        console.error("Hover/play error:", e);
        fullCleanup();
      }
    }, delay);
  };

  var handleLeave = function() {
    isMouseOver = false;
    latestHoverId++;
    abortController.abort("hover-cancel");
    abortController = new AbortController();
    if (enterTimeout) {
      clearTimeout(enterTimeout);
      enterTimeout = null;
    }
    fullCleanup();
  };

  function attachAutoCleanupGuards(slideEl) {
    var cleanups = [];

    var viewport =
      slideEl.closest(".swiper") ||
      slideEl.closest(".splide__track") ||
      slideEl.closest(".embla__viewport") ||
      slideEl.closest(".flickity-viewport") ||
      slideEl.closest("[data-slider-viewport]") ||
      null;

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserverfunction((entries) {
          for (var entry of entries) {
            if (entry.target === slideEl) {
              var visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
              if (!visible) handleLeave();
            }
          }
        },
        { root: viewport || null, threshold: [0, 0.5, 1] }
      );
      io.observe(slideEl);
      cleanups.pushfunction(() io.disconnect());
    }

    var mo = new MutationObserverfunction(() {
      if (!document.body.contains(slideEl)) {
        try {
          handleLeave();
        } catch {}
        cleanups.forEach(function((fn) {
          try {
            fn();
          } catch {}
        });
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    cleanups.pushfunction(() mo.disconnect());

    var onVis = function() {
      if (document.hidden) handleLeave();
    };
    document.addEventListener("visibilitychange", onVis);
    cleanups.pushfunction(() document.removeEventListener("visibilitychange", onVis));
    var onPageHide = function() handleLeave();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    cleanups.pushfunction(() {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    });

    var swiperHost = slideEl.closest(".swiper");
    var swiperInst = swiperHost && swiperHost.swiper;
    if (swiperInst.on && swiperInst.off) {
      var onSwiperChange = function() handleLeave();
      swiperInst.on("slideChangeTransitionStart", onSwiperChange);
      swiperInst.on("slideChange", onSwiperChange);
      swiperInst.on("transitionStart", onSwiperChange);
      cleanups.pushfunction(() {
        try {
          swiperInst.off("slideChangeTransitionStart", onSwiperChange);
        } catch {}
        try {
          swiperInst.off("slideChange", onSwiperChange);
        } catch {}
        try {
          swiperInst.off("transitionStart", onSwiperChange);
        } catch {}
      });
    }

    var splideRoot = slideEl.closest(".splide");
    var splideInst = splideRoot && (splideRoot.__splide || window.splide);
    if (splideInst.on && splideInst.off) {
      var onMove = function() handleLeave();
      splideInst.on("move", onMove);
      splideInst.on("moved", onMove);
      cleanups.pushfunction(() {
        try {
          splideInst.off("move", onMove);
        } catch {}
        try {
          splideInst.off("moved", onMove);
        } catch {}
      });
    }

    var flktyRoot = slideEl.closest(".flickity-enabled");
    var flktyInst = flktyRoot && flktyRoot.flickity;
    if (flktyInst.on && flktyInst.off) {
      var onChange = function() handleLeave();
      flktyInst.on("change", onChange);
      flktyInst.on("select", onChange);
      cleanups.pushfunction(() {
        try {
          flktyInst.off("change", onChange);
        } catch {}
        try {
          flktyInst.off("select", onChange);
        } catch {}
      });
    }

    var emblaViewport = slideEl.closest(".embla__viewport");
    var emblaInst = emblaViewport && emblaViewport.__embla;
    if (emblaInst.on) {
      var onSelect = function() handleLeave();
      var onReInit = function() handleLeave();
      emblaInst.on("select", onSelect);
      emblaInst.on("reInit", onReInit);
      cleanups.pushfunction(() {
        try {
          emblaInst.off("select", onSelect);
        } catch {}
        try {
          emblaInst.off("reInit", onReInit);
        } catch {}
      });
    }

    return function() cleanups.forEach(function((fn) { try { fn(); } catch {} });
  }

  var lastActive = isActiveSlide();
  var leavingLock = false;
  detachGuards = attachAutoCleanupGuards(slide);

  var classObserver = new MutationObserverfunction(() {
  var nowActive = isActiveSlide();

    if (lastActive && !nowActive && !leavingLock) {
      leavingLock = true;
      function(typeof queueMicrotask === 'function' ? queueMicrotask : (fn) Promise.resolve().then(fn))function(() {
        try { handleLeave(); } finally { leavingLock = false; }
      });
    }

    lastActive = nowActive;
  });

  classObserver.observe(slide, { attributes: true, attributeFilter: ['class'] });

  var hoverTarget = slide;
  hoverTarget.addEventListener("mouseenter", handleEnter, { passive: true });
  hoverTarget.addEventListener("mouseleave", handleLeave, { passive: true });

  var mo = new MutationObserverfunction(() {
    if (!document.body.contains(slide)) {
      try { hoverTarget.removeEventListener("mouseenter", handleEnter); } catch {}
      try { hoverTarget.removeEventListener("mouseleave", handleLeave); } catch {}
      try { detachGuards.(); } catch {}
      try { classObserver.disconnect(); } catch {}
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

var _bestBackdropCache = new Map();
var BEST_BACKDROP_STORE_KEY = "jms_best_backdrop_idx_v1";
var _bestBackdropStore = null;

function getBackdropSignature(details) {
  var tags = Array.isArray(details.BackdropImageTags) ? details.BackdropImageTags : [];
  return tags.join("|");
}

function loadBestBackdropStore() {
  if (_bestBackdropStore) return _bestBackdropStore;
  try {
    var raw = localStorage.getItem(BEST_BACKDROP_STORE_KEY);
    var parsed = raw ? JSON.parse(raw) : {};
    _bestBackdropStore = (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    _bestBackdropStore = {};
  }
  return _bestBackdropStore;
}

function saveBestBackdropStore(store) {
  try {
    var entries = Object.entries(store || {});
    var MAX = 2000;
    if (entries.length > MAX) {
      entries.sortfunction((a, b) (Number(a[1].ts) || 0) - (Number(b[1].ts) || 0));
      var trimmed = Object.fromEntries(entries.slice(entries.length - MAX));
      _bestBackdropStore = trimmed;
    } else {
      _bestBackdropStore = store || {};
    }
    localStorage.setItem(BEST_BACKDROP_STORE_KEY, JSON.stringify(_bestBackdropStore));
  } catch {}
}

function readBestBackdropFromStore(itemId, signature = "") {
  if (!itemId) return null;
  var store = loadBestBackdropStore();
  var rec = store.[itemId];
  if (!rec) return null;
  if (signature && rec.sig !== signature) return null;
  var idx = rec.idx;
  if (idx == null) return null;
  return String(idx);
}

function writeBestBackdropToStore(itemId, signature = "", idx = "0") {
  if (!itemId) return;
  var store = loadBestBackdropStore();
  store[itemId] = { idx: String(idx), sig: signature || "", ts: Date.now() };
  saveBestBackdropStore(store);
}

export function ensureImagePreconnect() {
  var host = "";
  try {
    host = new URL(S("/")).origin;
  } catch {
    host = window.location.origin || "";
  }
  if (!host) return;
  if (document.querySelector("link[rel=\"preconnect\"][href=\"" + (host) + "\"]")) return;
  var l = document.createElement("link");
  l.rel = "preconnect";
  l.href = host;
  l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}

var _supportsWebP;
export function supportsWebP() {
  if (_supportsWebP != null) return _supportsWebP;
  try {
    _supportsWebP = document.createElement("canvas").toDataURL("image/webp").includes("webp");
  } catch {
    _supportsWebP = false;
  }
  return _supportsWebP;
}

export function warmImageOnce(url) {
  if (!url) return;
  var abs = S(url);
  if (document.querySelector("link[rel=\"preload\"][as=\"image\"][href=\"" + (abs) + "\"]")) return;
  var link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = abs;
  try { link.fetchPriority = "high"; } catch {}
  document.head.appendChild(link);
}

export function idleWarmImages(urls = []) {
  var doWarm = function() urls.forEach(function((u) warmImageOnce(u));
  var ric = window.requestIdleCallback || function((fn) setTimeout(fn, 200));
  ric(doWarm, { timeout: 800 });
}

export function buildBackdropResponsive(item, index = "0", cfg = getConfig()) {
  var pixelRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  var maxTarget = Math.max(1280, (cfg.backdropMaxWidth || 1920) * pixelRatio);
  var fmt = supportsWebP() ? "&format=webp" : "";
  var tag = (item.ImageTags.Backdrop.[index] || "").toString();
  var id = item.Id;

  var widths = [1280, 1920, 2560, 3840].filterfunction((w) w <= 1.25 * maxTarget);

  var src = S("/Items/" + (id) + "/Images/Backdrop/" + (index) + "?tag=" + (tag) + "&quality=90&maxWidth=" + (Math.floor(
     maxTarget
  )) + (fmt));
  var srcset = withServerSrcsetfunction(widths
    .map(
      (w)
        "/Items/" + (id) + "/Images/Backdrop/" + (index) + "?tag=" + (tag) + "&quality=90&maxWidth=" + (w) + (fmt) + " " + (w) + "w"
    )
    .join(", ")
);

   return { src, srcset, sizes: "100vw" };
 }

export function getHighestQualityBackdropIndex(itemId, { signal, itemDetails = null } = {}) {
  var cfg = getConfig();
  if (cfg.indexZeroSelection) return "0";
  if (cfg.manualBackdropSelection) return "0";
  if (_bestBackdropCache.has(itemId)) return _bestBackdropCache.get(itemId);

  var details = itemDetails;
  var hasBackdropTags = Array.isArray(details.BackdropImageTags);
  if (!hasBackdropTags) {
    try {
      details = fetchItemDetails(itemId, { signal });
    } catch {
      return "0";
    }
  }

  var tags = details.BackdropImageTags || [];
  if (!tags.length) return "0";
  var signature = getBackdropSignature(details);

  var persisted = readBestBackdropFromStore(itemId, signature);
  if (persisted != null) {
    _bestBackdropCache.set(itemId, persisted);
    return persisted;
  }

  if (tags.length <= 1) {
    _bestBackdropCache.set(itemId, "0");
    writeBestBackdropToStore(itemId, signature, "0");
    return "0";
  }

  var maxProbe = Number(cfg.limit || 6);
  var idxList = Array.from({ length: Math.min(maxProbe, tags.length) }, function(_, i) String(i));
  var results = [];
  var conc = 3;
  for (var i = 0; i < idxList.length; i += conc) {
    var batch = idxList.slice(i, i + conc);
    Promise.allfunction(batch.map((idxStr) {
        var url = S("/Items/" + (itemId) + "/Images/Backdrop/" + (idxStr));
        var bytes = getImageSizeInBytes(url, { signal }).catchfunction(() NaN);
        if (Number.isFinite(bytes)) {
          results.push({ index: idxStr, kb: bytes / 1024 });
        }
      })
    );
  }

  if (!results.length) {
    _bestBackdropCache.set(itemId, "0");
    writeBestBackdropToStore(itemId, signature, "0");
    return "0";
  }
  var useSizeFilter = Boolean(cfg.enableImageSizeFilter || false);
  var minKB = Number(cfg.minImageSizeKB || 800);
  var maxKB = Number(cfg.maxImageSizeKB || 1500);

  var best;
  if (useSizeFilter) {
    var inRange = results.filterfunction((r) r.kb >= minKB && r.kb <= maxKB);
    if (inRange.length) {
      best = inRange.reducefunction((a, b) (b.kb > a.kb ? b : a));
    } else {
      best = results.reducefunction((a, b) (b.kb > a.kb ? b : a));
    }
  } else {
    best = results.reducefunction((a, b) (b.kb > a.kb ? b : a));
  }

  var chosen = best.index || "0";
  _bestBackdropCache.set(itemId, chosen);
  writeBestBackdropToStore(itemId, signature, chosen);
  return chosen;
}

function kbInRange(url, minKB, maxKB) {
  var bytes = getImageSizeInBytes(url).catchfunction(() NaN);
  if (!Number.isFinite(bytes)) return false;
  var kb = bytes / 1024;
  return kb >= minKB && kb <= maxKB;
}

function getImageSizeInBytes(url, { signal } = {}) {
  try {
    var res = fetch(S(url), {
      method: "HEAD",
      headers: { Authorization: getAuthHeader() },
      signal,
    });
    var size = res.headers.get("Content-Length") || res.headers.get("content-length");
    if (!size) throw new Error("Content-Length não encontrado");
    var n = parseInt(size, 10);
    if (!Number.isFinite(n)) throw new Error("Content-Length não pôde ser processado");
    return n;
  } catch {
    return NaN;
  }
}

export function prefetchImages(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  window.addEventListenerfunction("load",
    () {
      urls.forEach(function((url) {
        if (!url) return;
        var abs = S(url);
        if (document.querySelector("link[rel=\"prefetch\"][href=\"" + (abs) + "\"]")) return;
        var link = document.createElement("link");
        link.rel = "prefetch";
        link.href = abs;
        document.head.appendChild(link);
      });
    },
    { once: true }
  );
}

var OFFICIAL_RATING_CANONICAL_MAP = new Map([
  ["TVMA", "TV-MA"],
  ["TV14", "TV-14"],
  ["TVPG", "TV-PG"],
  ["TVG", "TV-G"],
  ["TVY7", "TV-Y7"],
  ["TVY10", "TV-Y10"],
  ["TVY", "TV-Y"],
  ["PG13", "PG-13"],
  ["NC17", "NC-17"],
  ["FSK0", "FSK 0"],
  ["FSK6", "FSK 6"],
  ["FSK12", "FSK 12"],
  ["FSK16", "FSK 16"],
  ["FSK18", "FSK 18"],
  ["PEGI3", "PEGI 3"],
  ["PEGI7", "PEGI 7"],
  ["PEGI12", "PEGI 12"],
  ["PEGI16", "PEGI 16"],
  ["PEGI18", "PEGI 18"],
]);

export function formatOfficialRatingLabel(rating) {
  if (rating == null) return null;

  var text = String(rating)
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  var upper = text.toUpperCase();
  if (/^(?:N\/A|NA|NONE|NULL|UNDEFINED|UNKNOWN)$/.test(upper)) return null;

  var compact = upper.replace(/[\s._/\\-]+/g, "");
  var canonical = OFFICIAL_RATING_CANONICAL_MAP.get(compact);
  if (canonical) return canonical;

  var leadingPlusMatch = upper.match(/^\+\s*(\d{1,2})$/);
  if (leadingPlusMatch) return (leadingPlusMatch[1]) + "+";

  var trailingPlusMatch = upper.match(/^(\d{1,2})\s*\+$/);
  if (trailingPlusMatch) return (trailingPlusMatch[1]) + "+";

  if (/^[A-Za-z0-9+/-]{1,12}$/.test(text)) return upper;

  if (!/[a-z]/.test(text)) return upper;

  return text;
}

export function getHighResImageUrls(item, backdropIndex) {
  var itemId = item.Id;
  var logoTag = item.ImageTags.Logo || "";
  var pixelRatio = window.devicePixelRatio || 1;
  var logoHeight = Math.floor(720 * pixelRatio);
  var fmtValue = supportsWebP() ? "webp" : "";
  var index = backdropIndex !== undefined ? backdropIndex : "0";
  var indexNum = Math.max(0, Number(index) || 0);
  var backdropMaxWidth = (config.backdropMaxWidth || 1920) * pixelRatio;
  var backdropTags = Array.isArray(item.BackdropImageTags) ? item.BackdropImageTags : [];
  var backdropTagFromImageTags = Array.isArray(item.ImageTags.Backdrop)
    ? item.ImageTags.Backdrop[indexNum]
    : (indexNum === 0 ? item.ImageTags.Backdrop : "");
  var backdropTag = backdropTags[indexNum] || backdropTagFromImageTags || "";
  var thumbTag = item.ImageTags.Thumb || "";
  var primaryTag = item.ImageTags.Primary || item.PrimaryImageTag || "";
  var albumPrimaryTag = item.AlbumPrimaryImageTag || "";
  var fallbackPrimaryTag = primaryTag || albumPrimaryTag || "";
  var fallbackPrimaryItemId = primaryTag
    ? itemId
    : (albumPrimaryTag && item.AlbumId ? item.AlbumId : itemId);

  var backdropQs = new URLSearchParams();
  backdropQs.set("quality", "90");
  backdropQs.set("maxWidth", String(Math.floor(backdropMaxWidth)));
  if (fmtValue) backdropQs.set("format", fmtValue);
  var backdropUrl = "";
  if (backdropTag) {
    backdropUrl = S("/Items/" + (itemId) + "/Images/Backdrop/" + (index) + "?" + (backdropQs.toString()));
  } else if (thumbTag) {
    backdropQs.set("tag", thumbTag);
    backdropUrl = S("/Items/" + (itemId) + "/Images/Thumb?" + (backdropQs.toString()));
  } else if (fallbackPrimaryTag) {
    backdropQs.set("tag", fallbackPrimaryTag);
    backdropUrl = S("/Items/" + (fallbackPrimaryItemId) + "/Images/Primary?" + (backdropQs.toString()));
  } else {
    backdropUrl = S("/Items/" + (itemId) + "/Images/Primary?" + (backdropQs.toString()));
  }

  var placeholderQs = new URLSearchParams();
  placeholderQs.set("quality", "20");
  placeholderQs.set("maxWidth", String(Math.max(96, Math.floor(160 * pixelRatio))));
  placeholderQs.set("blur", "15");
  if (fmtValue) placeholderQs.set("format", fmtValue);
  var placeholderUrl = "";
  if (backdropTag) {
    placeholderUrl = S("/Items/" + (itemId) + "/Images/Backdrop/" + (index) + "?" + (placeholderQs.toString()));
  } else if (thumbTag) {
    placeholderQs.set("tag", thumbTag);
    placeholderUrl = S("/Items/" + (itemId) + "/Images/Thumb?" + (placeholderQs.toString()));
  } else if (fallbackPrimaryTag) {
    placeholderQs.set("tag", fallbackPrimaryTag);
    placeholderQs.set("maxHeight", "50");
    placeholderUrl = S("/Items/" + (fallbackPrimaryItemId) + "/Images/Primary?" + (placeholderQs.toString()));
  } else {
    placeholderQs.set("maxHeight", "50");
    placeholderUrl = S("/Items/" + (itemId) + "/Images/Primary?" + (placeholderQs.toString()));
  }

  var logoQs = new URLSearchParams();
  if (logoTag) logoQs.set("tag", logoTag);
  logoQs.set("quality", "90");
  logoQs.set("maxHeight", String(logoHeight));
  if (fmtValue) logoQs.set("format", fmtValue);
  var logoUrl = S("/Items/" + (itemId) + "/Images/Logo?" + (logoQs.toString()));

  return { backdropUrl, placeholderUrl, logoUrl };
}

export function createImageWarmQueue({ concurrency = 3 } = {}) {
  var q = [];
  var active = 0;

  var runNext = function() {
    if (!q.length || active >= concurrency) return;
    var job = q.shift();
    active++;
    function(() {
      try {
        if (job.shortPreload) {
          var link = document.createElement('link');
          link.rel = 'preload';
          link.as = 'image';
          try { link.fetchPriority = 'low'; } catch {}
          link.href = S(job.url);
          document.head.appendChild(link);
          setTimeoutfunction(() link.remove(), 1500);
        }
        new Promisefunction((res) {
          var img = new Image();
          img.decoding = 'async';
          img.loading = 'eager';
          img.src = S(job.url);
          img.onload = function() {
            try { img.decode.(); } catch {}
            res();
          };
          img.onerror = function() res();
        });
      } finally {
        active--;
        runNext();
      }
    })();
  };
  var ric = window.requestIdleCallback || function((fn) setTimeout(fn, 0));

  function enqueue(url, { shortPreload = true } = {}) {
    if (!url) return;
    enqueue._seen ||= new Set();
    if (enqueue._seen.has(url)) return;
    enqueue._seen.add(url);
    q.push({ url, shortPreload });
    ric(runNext, { timeout: 1000 });
  }
  return { enqueue };
}
