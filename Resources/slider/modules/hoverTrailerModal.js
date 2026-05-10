import { getConfig } from './config.js';
import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';
import { playNow, getVideoStreamUrl, fetchItemDetails, fetchPlayableItemDetails, updateFavoriteStatus, goToDetailsPage, fetchLocalTrailers, pickBestLocalTrailer, getCachedUserTopGenres } from '../../Plugins/NexusPobreFlix/runtime/api.js';
import { getYoutubeEmbedUrl, isValidUrl } from './utils.js';
import { getVideoQualityText } from './containerUtils.js';
import { attachMiniPosterHover, openMiniPopoverFor } from "./studioHubsUtils.js";
import { positionModalRelativeToDot, centerActiveDot } from "./navigation.js";
import { modalState, set, get, resetModalRefs } from './modalState.js';
import { applyDotPosterAnimation } from "./animations.js";
import { getCurrentIndex } from "./sliderState.js";
import { openDetailsModal } from "./detailsModalLoader.js";
import { withServer } from "./jfUrl.js";
import { getWatchlistButtonTitle, hydrateWatchlistState } from "./watchlist.js";
import { cleanupImageResourceRefs } from "./imageResourceCleanup.js";

var REOPEN_BLOCK_MS = 600;
var HARD_CLOSE_BUFFER_MS = 20;
export var REOPEN_COOLDOWN_MS    = 400;
var CROSS_ITEM_SETTLE_MS  = 80;
export var getOpenHoverDelay = function() getConfig().atrasoTrailer || 500;
var config = getConfig();
var currentLang = config.defaultLanguage || getDefaultLanguage();
if (!config.languageLabels) {
  config.languageLabels = getLanguageLabels(currentLang) || {};
}
var DEVICE_MEM_GB = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 4;
export var PREVIEW_MAX_ENTRIES = Math.max(50, Math.min(200, Math.floor(DEVICE_MEM_GB * 60)));
var PREVIEW_TTL_MS = 5 * 60 * 1000;
var PREVIEW_EVICT_BATCH = Math.max(10, Math.floor(PREVIEW_MAX_ENTRIES * 0.15));
export var previewPreloadCache = new Map();
var _ytPlayers = new Map();
var _ytReadyMap = new Map();
var _seriesTrailerCache = new Map();
var MAX_META_CACHE = 1000;
var MODAL_ANIM = {
  openMs: 250,
  closeMs: 180,
  ease: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  scaleFrom: 0.92,
  scaleTo: 1,
  opacityFrom: 0,
  opacityTo: 1,
  translateFromY: 8,
  translateToY: 0
};

function canUseYTOriginAndJSAPI() {
  try {
    var isHttps = window.location.protocol === 'https:';
    var host = new URL(window.location.href).hostname;
    var isPrivateHost =
      /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/.test(host);
    return isHttps && !isPrivateHost;
  } catch {
    return false;
  }
}

var CAN_USE_YT_API = canUseYTOriginAndJSAPI();

function absServerUrl(url) {
  try {
    if (!url) return url;
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) return withServer(url);
    return url;
  } catch { return url; }
}

function capMap(m) {
  try {
    if (m.size <= MAX_META_CACHE) return;
    var n = m.size - MAX_META_CACHE;
    for (var k of m.keys()) {
      m.delete(k);
      if (--n <= 0) break;
    }
  } catch {}
}

var hasTrailerCache = new Map();
var pendingHasTrailer = new Map();
var _seriesIdCache = new Map();
var CONCURRENCY = Math.max(2, Math.min(6, (navigator.deviceMemory || 4) | 0));
var rIC = window.requestIdleCallback || function(function(cb) setTimeout(() cbfunction({ timeRemaining: () 0, didTimeout: true }), 50));
var __trailerBadgeObserver = null;
var __hoverModalDelegatesBound = false;
var __hoverTouchDelegatesBound = false;
var __hoverInfraReady = false;

function isTouchDevice() {
  return (typeof window !== 'undefined') && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
}

function isTouchRuntime() {
  return shouldEnableTouchDeviceClass();
}

function shouldEnableTouchDeviceClass() {
  if (!isTouchDevice()) return false;
  try {
    if (window.matchMedia) {
      return window.matchMedia('(max-width: 750px)').matches;
    }
  } catch {}
  return (window.innerWidth || 0) <= 750;
}

function syncTouchDeviceClass() {
  try {
    document.documentElement.classList.toggle('touch-device', shouldEnableTouchDeviceClass());
  } catch {}
  try {
    syncTrailerBadgeRuntime();
  } catch {}
}

function ensureHoverInfra() {
  if (__hoverInfraReady) return;
  __hoverInfraReady = true;
  try { injectOrUpdateModalStyle(); } catch {}
}

function isInsideDotArea(node) {
  return !!(node.closest.('.monwui-dot-navigation-container') || node.closest.('.monwui-poster-dot'));
}

try {
  syncTouchDeviceClass();
  window.addEventListener('resize', syncTouchDeviceClass, { passive: true });
  window.addEventListener('orientationchange', syncTouchDeviceClass, { passive: true });
} catch {}

function isMobileAppEnv() {
  try {
    var standalone = window.navigator.standalone === true
      || window.matchMedia.('(display-mode: standalone)').matches;
    var ua = navigator.userAgent || '';
    var isWV = /\bwv\b|Crosswalk/i.test(ua);
    var hasBridge = !!(window.cordova || window.Capacitor || window.ReactNativeWebView);
    return !!(standalone || isWV || hasBridge);
  } catch { return false; }
}
function suppressHoverOpens(ms = 1000) {
  modalState.__suppressOpenUntil = Date.now() + ms;
  try { if (modalState._hoverOpenTimer) { clearTimeout(modalState._hoverOpenTimer); modalState._hoverOpenTimer = null; } } catch {}
  try { modalState.itemHoverAbortController.abort.(); } catch {}
}

var inFlight = 0;
var __renderToken = 0;

function newRenderToken() { return (++__renderToken); }

function isTokenAlive(token) { return token === __renderToken; }

function hardWipeModalDom(modal = modalState.videoModal) {
  if (!modal) return;
  try { modal.dataset.itemId = ''; } catch {}
  var backdrop = modal.querySelector.('.preview-backdrop');
  if (backdrop) { try { backdrop.style.opacity = '0'; backdrop.removeAttribute('src'); backdrop.removeAttribute('srcset'); } catch {} }
  var iframe = modal.querySelector.('.preview-trailer-iframe');
  if (iframe) { try { iframe.src = ''; iframe.style.display = 'none'; iframe.__wrapper && (iframe.__wrapper.style.display = 'none'); } catch {} }
  var v = modalState.modalVideo;
  if (v) {
    try {
      v.pause(); v.removeAttribute('src'); v.load(); v.style.opacity = '0'; v.style.display = 'none';
    } catch {}
  }
  try { resetModalInfo(modal); } catch {}
  try { resetModalButtons(); } catch {}
  try { clearTransientOverlays(modal); } catch {}
  try {
    var matchBtn = modal.querySelector('.preview-match-button');
    if (matchBtn) {
      matchBtn.textContent = '';
      matchBtn.style.display = 'none';
    }
  } catch {}
  try { cleanupImageResourceRefs(modal, { revokeDetachedBlobs: true }); } catch {}
}

export function updateModalContent(item, videoUrl) {
  hydrateWatchlistState(item).catchfunction(() {});
  var modal = modalState.videoModal;
  if (!modal || !document.body.contains(modal)) return;
  if (modal.dataset.itemId && item.Id && String(item.Id) !== String(modal.dataset.itemId)) return;
  var cfg = getConfig();

  clearTransientOverlays(modal);

  var contextIsDot = modalState._modalContext === 'monwui-dot';
  var dotMode = cfg.dotPreviewPlaybackMode || null;
  var onlyTrailerGlobal   = !!cfg.onlyTrailerInPreviewModal;
  var preferTrailerGlobal = !!cfg.preferTrailersInPreviewModal;
  var onlyTrailer = false, preferTrailer = false;

  if (contextIsDot) {
    if (dotMode === 'onlyTrailer')      { onlyTrailer = true;  preferTrailer = false; }
    else if (dotMode === 'trailer')     { onlyTrailer = false; preferTrailer = true;  }
    else if (dotMode === 'video')       { onlyTrailer = false; preferTrailer = false; }
    else                                { onlyTrailer = onlyTrailerGlobal; preferTrailer = preferTrailerGlobal; }
  } else {
    onlyTrailer = onlyTrailerGlobal;
    preferTrailer = preferTrailerGlobal;
  }

  var trailerInfo = resolveTrailerUrlFor(item);
  var trailerUrl = trailerInfo.url;
  var isLocal = trailerInfo.level === 'local';
  var isYTValid = !!trailerUrl && (trailerInfo.level === 'item' || trailerInfo.level === 'series');

  var showYT = function(labelText) {
    var iframe = getOrCreateTrailerIframe(modal);
    var wantSoundStart = ((isMobileAppEnv() || !isTouchRuntime()) && !!modalState._soundOn);
    iframe.src = ensureYTParams(trailerUrl, {
      autoplay: true,
      muteInitial: !wantSoundStart,
      enableJsApi: CAN_USE_YT_API
    });
    iframe.__wrapper && (iframe.__wrapper.style.display = 'block');
    iframe.style.display = 'block';
    showYTFirstTouchShield(iframe, 380);
    sizeYTToCover(iframe);
    if (CAN_USE_YT_API) ensureYTAPI().thenfunction(() installYTPlayer(iframe));
    if (labelText) addTrailerTip(modal, labelText);
    var btn = modal.querySelector.('.preview-volume-button');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
  };

  if (modalState.modalButtonsContainer) {
    modalState.modalButtonsContainer.style.opacity = '1';
    modalState.modalButtonsContainer.style.pointerEvents = 'auto';
    modalState.modalButtonsContainer.classList.remove('preview-buttons--hidden');
  }

  if (onlyTrailer) {
    if (isLocal) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'block';
        modalState.modalVideo.style.opacity = '1';
      }
      if (gatePlaybackStart(item.Id)) modal.initVideoPlayer(trailerUrl);
      addTrailerTip(modal, cfg.languageLabels.yerelFragman || 'Yerel fragman');
    } else if (isYTValid) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'none';
        modalState.modalVideo.src = '';
      }
      showYT(trailerInfo.level === 'series'
        ? (cfg.languageLabels.diziFragmani || 'Dizi fragmanı')
        : (cfg.languageLabels.fragman || 'Fragman'));
    } else {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'none';
        modalState.modalVideo.src = '';
      }
      showNoTrailerMessage(modal, cfg.languageLabels.trailerNotAvailable || 'Fragman bulunamadı');
    }
  }
  else if (preferTrailer) {
    if (isLocal) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'block';
        modalState.modalVideo.style.opacity = '1';
      }
      if (gatePlaybackStart(item.Id)) modal.initVideoPlayer(trailerUrl);
      addTrailerTip(modal, cfg.languageLabels.yerelFragman || 'Yerel fragman');
    } else if (isYTValid) {
      if (modalState.modalVideo) {
        try { modalState.modalVideo.pause(); } catch {}
        modalState.modalVideo.style.opacity = '0';
        modalState.modalVideo.style.display = 'none';
        modalState.modalVideo.src = '';
      }
      showYT(trailerInfo.level === 'series'
        ? (cfg.languageLabels.diziFragmani || 'Dizi fragmanı')
        : (cfg.languageLabels.fragman || 'Fragman'));
    } else if (videoUrl) {
      if (gatePlaybackStart(item.Id)) modal.initVideoPlayer(videoUrl);
    } else {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        try { modalState.modalVideo.pause(); } catch {}
        modalState.modalVideo.src = '';
        modalState.modalVideo.style.display = 'none';
      }
    }
  }
  else {
    if (videoUrl) {
      if (gatePlaybackStart(item.Id)) modal.initVideoPlayer(videoUrl);
    } else if (isLocal) {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        modalState.modalVideo.style.display = 'block';
        modalState.modalVideo.style.opacity = '1';
      }
      if (gatePlaybackStart(item.Id)) modal.initVideoPlayer(trailerUrl);
      addTrailerTip(modal, cfg.languageLabels.yerelFragman || 'Yerel fragman');
    } else if (isYTValid) {
      if (gatePlaybackStart(item.Id)) {
        showYT(trailerInfo.level === 'series'
          ? (cfg.languageLabels.diziFragmani || 'Dizi fragmanı')
          : (cfg.languageLabels.fragman || 'Fragman'));
      }
    } else {
      hideTrailerIframe(modal);
      if (modalState.modalVideo) {
        try { modalState.modalVideo.pause(); } catch {}
        modalState.modalVideo.src = '';
        modalState.modalVideo.style.display = 'none';
      }
    }
  }

  if (item.Type === 'Episode') {
    var seriesTitle = item.SeriesName || item.Series.Name || '';
    if (modalState.modalTitle) modalState.modalTitle.textContent = seriesTitle || (item.Name || item.Title || '');
    if (modalState.modalEpisodeLine) {
      modalState.modalEpisodeLine.style.display = 'block';
      modalState.modalEpisodeLine.textContent = formatSeasonEpisodeLine(item);
    }
  } else {
    if (modalState.modalTitle) modalState.modalTitle.textContent = item.Name || item.Title || '';
    if (modalState.modalEpisodeLine) {
      modalState.modalEpisodeLine.textContent = '';
      modalState.modalEpisodeLine.style.display = 'none';
    }
  }

  var isPlayed = item.UserData.Played || false;
  var positionTicks = Number(item.UserData.PlaybackPositionTicks || 0);
  var runtimeTicks = Number(item.RunTimeTicks || 0);
  var hasPartialPlayback = hasPartialPlaybackState({
    isPlayed,
    playedPercentage: item.UserData.PlayedPercentage,
    positionTicks,
    runtimeTicks
  });
  var isFavorite = item.UserData.IsFavorite || false;
  var videoStream = item.MediaStreams ? item.MediaStreams.find(function(s) s.Type === "Video") : null;
  var qualityText = videoStream ? getVideoQualityText(videoStream) : '';

  modalState.modalMeta.innerHTML = [
    qualityText,
    item.ProductionYear,
    item.CommunityRating ? parseFloat(item.CommunityRating).toFixed(1) : null,
    runtimeTicks ? (Math.floor(runtimeTicks / 600000000)) + " " + (config.languageLabels.dk) : null
  ].filter(Boolean).join(' • ');

  var matchPercentage = calculateMatchPercentage(item.UserData, item);
  if (modalState.modalMatchButton) {
    modalState.modalMatchButton.textContent = (matchPercentage) + "%";
    modalState.modalMatchButton.style.display = 'flex';
  }

  modalState.modalGenres.innerHTML = '';
  if (item.Genres && item.Genres.length > 0) {
    var limitedGenres = item.Genres.slice(0, 3);
    limitedGenres.forEach(function((genre, index) {
      var genreBadge = document.createElement('span');
      genreBadge.className = 'genre-badge';
      genreBadge.textContent = genre.trim();
      modalState.modalGenres.appendChild(genreBadge);
      if (index < limitedGenres.length - 1) {
        var separator = document.createElement('span');
        separator.className = 'genre-separator';
        separator.textContent = ' • ';
        separator.style.margin = '0 4px';
        separator.style.color = '#a8aac7';
        modalState.modalGenres.appendChild(separator);
      }
    });
  }

  modalState.modalPlayButton.innerHTML = "<i class=\"fa-solid fa-play\"></i> " + (getPlayButtonText({ isPlayed, hasPartialPlayback ) + ")}";
  modalState.modalFavoriteButton.classList.toggle('favorited', isFavorite);
  modalState.modalFavoriteButton.innerHTML = isFavorite ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-plus"></i>';
  modalState.modalFavoriteButton.title = getWatchlistButtonTitle(item, isFavorite);
  modalState.modalFavoriteButton.dataset.itemType = item.Type || "";

  if (modalState.modalButtonsContainer) {
    modalState.modalButtonsContainer.style.opacity = '1';
    modalState.modalButtonsContainer.style.pointerEvents = 'auto';
  }

  applyVolumePreference(modal);
}

export function closeVideoModal() {
  if (!modalState.videoModal || modalState.videoModal.style.display === "none") return;

  modalState._isModalClosing = true;
  modalState._modalClosingUntil = Date.now() + MODAL_ANIM.closeMs + HARD_CLOSE_BUFFER_MS;

  clearTimeout(modalState.modalHideTimeout);
  var modal = modalState.videoModal;

  try {
   modal.style.transition = '';
   modal.style.opacity = '';
   modal.style.transform = '';
 } catch {}

  modal.classList.remove('video-preview-modal--visible');
  modal.classList.add('video-preview-modal--hidden');

  softStopPlayback();

  setTimeoutfunction(() {
    if (modalState.videoModal) {
      clearTransientOverlays(modalState.videoModal);
      modalState.videoModal.style.display = 'none';
      modalState.videoModal.classList.remove('video-preview-modal--hidden');
      try { hardWipeModalDom(modalState.videoModal); } catch {}
      try { clearWillChange(modalState.videoModal); } catch {}
    }
    modalState._lastModalHideAt = Date.now();
    modalState._isModalClosing = false;
  }, MODAL_ANIM.closeMs);
}

export function animatedShow(modal) {
  if (!modal) return;

  modal.style.display = 'block';
  modal.style.transition = 'none';
  modal.classList.add('video-preview-modal--hidden');
  modal.classList.remove('video-preview-modal--visible');
  void modal.offsetWidth;

  requestAnimationFramefunction(() {
    modal.style.transition = "opacity " + (MODAL_ANIM.openMs) + "ms " + (MODAL_ANIM.ease) + ", transform " + (MODAL_ANIM.openMs) + "ms " + (MODAL_ANIM.ease);
    modal.classList.add('video-preview-modal--visible');
    modal.classList.remove('video-preview-modal--hidden');
    modal.style.opacity = '';
    modal.style.transform = '';

    var buttonsContainer = modal.querySelector('.preview-buttons');
    if (buttonsContainer) {
      buttonsContainer.style.opacity = '1';
      buttonsContainer.style.pointerEvents = 'auto';
    }
  });
}

function animateModalContent(modal, isOpening) {
  if (!modal) return;

  var elements = [
    modal.querySelector('.video-container'),
    modal.querySelector('.preview-info'),
    modal.querySelector('.preview-buttons')
  ].filter(Boolean);

  elements.forEach(function((el, index) {
    if (isOpening) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeoutfunction(() {
        el.style.transition = 'opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94), transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 50 + (index * 80));
    } else {
      el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(5px)';
    }
  });
}

export function createVideoModal({ showButtons = true, context = 'monwui-dot' } = {}) {
  if (!config) return null;
  var allow = (context === 'monwui-dot')
   ? (config.previewModal !== false)
   : (config.allPreviewModal !== false);
  if (!allow) return null;

  injectOrUpdateModalStyle();
  destroyVideoModal();

  var modal = document.createElement('div');
  modal.className = 'video-preview-modal';
  modal.style.display = 'none';

  var videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';

  var backdropImg = document.createElement('img');
  backdropImg.className = 'preview-backdrop';
  backdropImg.alt = '';
  backdropImg.decoding = 'async';
  backdropImg.loading = 'lazy';
  videoContainer.appendChild(backdropImg);

  var video = document.createElement('video');
  video.className = 'preview-video';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('x-webkit-airplay', 'allow');
  video.autoplay = true;
  video.muted = !modalState._soundOn;
  video.loop = true;
  video.playsInline = true;
  video.addEventListenerfunction('stalled', () video.load());
  video.addEventListenerfunction('playing', () {
    video.style.opacity = '1';
    try { modal.hideBackdrop.(); } catch {}
  });

  var infoContainer = document.createElement('div');
  infoContainer.className = 'preview-info';
  var title = document.createElement('div');
  title.className = 'preview-title';
  var meta = document.createElement('div');
  meta.className = 'preview-meta';
  var genres = document.createElement('div');
  genres.className = 'preview-genres';
  var episodeLine = document.createElement('div');
  episodeLine.className = 'preview-episode';

  infoContainer.append(title, episodeLine, meta, genres);

  var buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'preview-buttons';
  buttonsContainer.style.opacity = '1';
  buttonsContainer.style.pointerEvents = 'auto';
  modalState.modalButtonsContainer = buttonsContainer;

  var matchButton = document.createElement('button');
  matchButton.className = 'preview-match-button';
  matchButton.textContent = '';

  var playButton = document.createElement('button');
  playButton.className = 'preview-play-button';
  playButton.innerHTML = '<i class="fa-solid fa-play"></i> Assistir';

  var favoriteButton = document.createElement('button');
  favoriteButton.className = 'preview-favorite-button';
  favoriteButton.innerHTML = '<i class="fa-solid fa-plus"></i>';

  var infoButton = document.createElement('button');
  infoButton.className = 'preview-info-button';
  infoButton.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';

  var volumeButton = document.createElement('button');
  volumeButton.className = 'preview-volume-button';

  buttonsContainer.append(matchButton, playButton, favoriteButton, infoButton, volumeButton);

  var closeMobileBtn = document.createElement('button');
  closeMobileBtn.className = 'preview-close-mobile';
  closeMobileBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  closeMobileBtn.addEventListenerfunction('click', (e) {
    e.stopPropagation();
    closeVideoModal();
  });

  playButton.addEventListenerfunction('click', (e) {
    e.stopPropagation();
    var itemId = modal.dataset.itemId;
    if (!itemId) { alert("Oynatma başarısız: itemId bulunamadı"); return; }
    closeVideoModal();
    try { playNow(itemId); }
    catch (error) { console.error("Oynatma hatası:", error); alert("Oynatma başarısız: " + error.message); }
    finally { closeVideoModal(); }
  });

  favoriteButton.addEventListenerfunction('click', (e) {
    e.stopPropagation();
    var itemId = modal.dataset.itemId;
    if (!itemId) return;
    try {
      var isFavorite = favoriteButton.classList.contains('favorited');
      updateFavoriteStatus(itemId, !isFavorite, {
        item: {
          Id: itemId,
          Type: favoriteButton.dataset.itemType || ""
        }
      });

      favoriteButton.classList.toggle('favorited', !isFavorite);
      favoriteButton.innerHTML = isFavorite ? '<i class="fa-solid fa-plus"></i>' : '<i class="fa-solid fa-check"></i>';
      favoriteButton.title = getWatchlistButtonTitle({ Type: favoriteButton.dataset.itemType || "" }, !isFavorite);
      var slide = document.querySelector(".monwui-slide[data-item-id=\"" + (itemId) + "\"]");
      if (slide) {
        var item = fetchItemDetails(itemId);
        var isFav = item.UserData.IsFavorite || false;
        var isPlayed = item.UserData.Played || false;
        slide.dataset.favorite = isFav.toString();
        slide.dataset.played = isPlayed.toString();
      }
    } catch (error) {
      console.error("Favori durumu güncelleme hatası:", error);
    }
  });

  infoButton.addEventListenerfunction('click', (e) {
    e.stopPropagation();
    var itemId = modal.dataset.itemId;
    if (!itemId) return;

    ensureOverlaysClosed();

    if (typeof openDetailsModal === 'function') {
      openDetailsModal({ itemId });
    } else {
      if (window.showItemDetailsPage) return window.showItemDetailsPage(itemId);
      var dialog = document.querySelector('.dialogContainer');
      if (dialog) {
        var event = new CustomEvent('showItemDetails', { detail: { Id: itemId } });
        document.dispatchEvent(event);
        return;
      }
      return goToDetailsPageSafe(itemId);
    }
  });

  var onVolumeTap = function(e) {
    var now = Date.now();
    if (now - modalState.__volTapGuardAt < 250) return;
    modalState.__volTapGuardAt = now;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var trailerIframe = modalState.videoModal.querySelector.('.preview-trailer-iframe');
    var trailerVisible = trailerIframe && trailerIframe.style.display !== 'none';

    if (trailerVisible) {
      try {
        var player = _ytPlayers.get(trailerIframe);
        if (!player || typeof player.getVolume !== 'function') {
          toggleYouTubeVolumeManual(trailerIframe, volumeButton);
          return;
        }
        var isMuted = typeof player.isMuted === 'function' ? player.isMuted() : (player.getVolume.() === 0);
        if (isMuted) {
          player.unMute.();
          player.setVolume.(100);
          player.playVideo.();
          volumeButton.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        } else {
          player.mute.();
          volumeButton.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        }
      } catch (err) {
        console.error('Player ses kontrol hatası:', err);
        toggleYouTubeVolumeManual(trailerIframe, volumeButton);
      }
      return;
    }

    if (modalState.modalVideo) {
      modalState.modalVideo.muted = !modalState.modalVideo.muted;
      modalState.modalVideo.volume = modalState.modalVideo.muted ? 0 : 1.0;
      volumeButton.innerHTML = modalState.modalVideo.muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
  };

  volumeButton.addEventListener('touchstart', onVolumeTap, { passive: false });
  volumeButton.addEventListener('click', onVolumeTap, { passive: false });
  [playButton, favoriteButton, infoButton, volumeButton, matchButton].forEach(function(function(button) {
    button.addEventListener('mouseenter', () button.style.transform = 'scale(1.11)');
    button.addEventListenerfunction('mouseleave', () button.style.transform = '');
  });

  modal.addEventListenerfunction('mouseenter', () {
    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
  });

  var onModalLeave = function() {
  modalState.isMouseInModal = false;
  closeVideoModal();
  };
  modal.addEventListener('mouseleave', onModalLeave);
  modal.addEventListener('pointerleave', onModalLeave);

  modal.addEventListenerfunction('click', (e) {
    var isBgTap = (e.target === modal) || e.target.classList.contains('video-container');
    if (!isBgTap) return;

    setGlobalSound(!modalState._soundOn);

    var trailerIframe = modal.querySelector('.preview-trailer-iframe');
    var trailerVisible = trailerIframe && trailerIframe.style.display !== 'none';
    var volumeButton = modal.querySelector('.preview-volume-button');

    if (trailerVisible) {
      volumeButton.click();
    } else if (modalState.modalVideo) {
      modalState.modalVideo.muted = !modalState.modalVideo.muted;
      modalState.modalVideo.volume = modalState.modalVideo.muted ? 0 : 1.0;
      volumeButton.innerHTML = modalState.modalVideo.muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
  });

  videoContainer.appendChild(video);
  modal.appendChild(videoContainer);
  modal.appendChild(closeMobileBtn);

  modal.setBackdrop = function(url) {
    try {
      if (!url) return;
      var finalUrl = url;
      if (url.startsWith('/') && !url.startsWith('//')) {
        finalUrl = withServer(url);
      }
      var img = modal.querySelector('.preview-backdrop');
      img.src = finalUrl;
      img.style.opacity = '1';
    } catch {}
  };

  modal.hideBackdrop = function() {
    try {
      modal.querySelector('.preview-backdrop').style.opacity = '0';
    } catch {}
  };

  if (showButtons) modal.appendChild(buttonsContainer);
  modal.appendChild(infoContainer);
  modal.initVideoPlayer = function(url) {
    url = absServerUrl(url);
    video.pause();
    video.src = '';
    video.load();
    video.style.opacity = '0';
    video.style.transition = 'opacity 0.3s ease-in-out';
    hideTrailerIframe(modal);
    video.style.display = 'block';
    if (showButtons) modal.appendChild(buttonsContainer);
    sleep(150);

    video.src = url;
    video.addEventListenerfunction('loadedmetadata', () {
      video.currentTime = 10 * 60;
      Promise.resolve(video.play()).catch(function(e) { if (e.name !== 'AbortError') console.warn('Video oynatma hatası:', e); });
    }, { once: true });
  };

  document.body.appendChild(modal);

  modalState.videoModal = modal;
  modalState.modalVideo = video;
  modalState.modalTitle = title;
  modalState.modalMeta = meta;
  modalState.modalGenres = genres;
  modalState.modalEpisodeLine = episodeLine;
  modalState.modalPlayButton = playButton;
  modalState.modalFavoriteButton = favoriteButton;
  modalState.modalMatchButton = matchButton;
  modalState.modalButtonsContainer = buttonsContainer;
  modalState._modalContext = context;

  bindModalHover(modal);

  return { modal, video, title, meta, genres, matchButton, playButton, favoriteButton, infoButton, volumeButton, episodeLine, buttonsContainer };
}


function installHoverOpenSuppressors() {
  if (window.__hoverOpenSuppressInstalled) return;
  window.__hoverOpenSuppressInstalled = true;

  var kill = function() suppressHoverOpens(1200);
  var cardDown = function(e) {
    if (e.target.closest.('.jms-trailer-badge, .yt-first-touch-shield')) return;
    if (e.target.closest.('.cardImageContainer,[data-id]')) kill();
  };
  ['pointerdown','mousedown','touchstart','click'].forEach(function(t) {
    document.addEventListener(t, cardDown, { capture: true, passive: false });
  });
  var linkDown = function(e) {
    if (e.target.closest.('.jms-trailer-badge, .yt-first-touch-shield')) return;
    if (e.target.closest.('a[href],button,[role="link"]')) kill();
  };
  ['pointerdown','mousedown','touchstart','click'].forEach(function(t) {
    document.addEventListener(t, linkDown, { capture: true, passive: false });
  });
  var onNav = function() suppressHoverOpens(1200);
  window.addEventListener('popstate',  onNav, true);
  window.addEventListener('hashchange',onNav, true);
  window.addEventListenerfunction('beforeunload', () suppressHoverOpens(5000));
  window.addEventListenerfunction('pagehide',     () suppressHoverOpens(5000));
}

installHoverOpenSuppressors();

function onFirstInteraction(cb, timeoutMs = 1500) {
  var fired = false;
  var fire = function() { if (fired) return; fired = true; cleanup(); cb(); };
  var cleanup = function() {
    ['mousedown','mousemove','touchstart','keydown','scroll']
      .forEach(function(t) window.removeEventListener(t, fire, { capture:true }));
  };
  ['mousedown','mousemove','touchstart','keydown','scroll']
    .forEach(function(t) window.addEventListener(t, fire, { capture:true, once:true }));
  setTimeout(fire, timeoutMs);
}

function chunkIter(nodes, fn, { size = 50, delayMs = 16, useIdle = true } = {}) {
  var i = 0, dead = false;
  var tick = function() {
    if (dead) return;
    var end = Math.min(i + size, nodes.length);
    for (; i < end; i++) fn(nodes[i], i);
    if (i < nodes.length) {
      if (useIdle) rICfunction(() setTimeout(tick, delayMs));
      else setTimeout(tick, delayMs);
    }
  };
  tick();
  return function() { dead = true; };
}

function ensureGlobalModal() {
  if (modalState.videoModal &&
      document.body.contains(modalState.videoModal) &&
      modalState._modalContext === 'global') {
    return modalState.videoModal;
  }
  try { destroyVideoModal(); } catch {}
  var res = createVideoModal({ showButtons: true, context: 'global' });
  return res.modal || null;
}

function _debounce(fn, wait = 80) {
  var t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeoutfunction(() fn.apply(null, args), wait);
  };
}

 function mountStudioMiniForAll() {
   var cfg = getConfig();
   if (!cfg || cfg.globalPreviewMode !== 'studioMini') return;

  var items = document.querySelectorAll('.cardImageContainer');
  if (!items.length) return;
  chunkIterfunction(items, (item) {
    if (item.__miniBound) return;
    var itemId =
      item.dataset.itemId ||
      item.dataset.id ||
      item.closest.('[data-id]').dataset.id;
    if (!itemId) return;
    item.__miniBound = true;
    attachMiniPosterHover(item, { Id: itemId });
  }, { size: 60, delayMs: 12, useIdle: true });
 }

function installStudioMiniAutobind() {
  if (window.__studioMiniObsInstalled) return;
  window.__studioMiniObsInstalled = true;

  var rebind = _debouncefunction(() {
    try { mountStudioMiniForAll(); } catch {}
  }, 120);
  window.addEventListenerfunction('hashchange', () rebind(), true);
  window.addEventListenerfunction('popstate',   () rebind(), true);
  var obs = new MutationObserverfunction((mutList) {
    for (var m of mutList) {
      for (var n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList.contains('cardImageContainer') || n.querySelector.('.cardImageContainer')) {
          rebind();
          return;
        }
      }
    }
  });

  obs.observe(document.body, { childList: true, subtree: true });
  window.__studioMiniObs = obs;
  window.addEventListenerfunction('jms:globalPreviewModeChanged', (ev) {
    try { ensureOverlaysClosed(); } catch {}
    rebind();
  });
  onFirstInteractionfunction(() rebind(), 1200);
}

installStudioMiniAutobind();

function hasTrailerForItemId(itemId, { signal } = {}) {
  if (!itemId) return false;
  if (hasTrailerCache.has(itemId)) return hasTrailerCache.get(itemId);
  if (pendingHasTrailer.has(itemId)) return pendingHasTrailer.get(itemId);

  var task = function(() {
    while (inFlight >= CONCURRENCY) {
      new Promise(function(r) setTimeout(r, 35));
      if (signal.aborted) return false;
    }
    inFlight++;
    try {
      var item = fetchPlayableItemDetails(itemId, { signal });
      if (!item) {
        hasTrailerCache.set(itemId, false);
        capMap(hasTrailerCache);
        return false;
      }

      try {
        var locals = fetchLocalTrailers(item.Id, { signal });
        if (Array.isArray(locals) && locals.length > 0) {
          hasTrailerCache.set(itemId, true);
          capMap(hasTrailerCache);
          return true;
        }
      } catch {}

      if (pickYouTubeTrailerUrl(item.RemoteTrailers)) {
        hasTrailerCache.set(itemId, true);
        capMap(hasTrailerCache);
        return true;
      }

      var seriesId = item.Type === 'Series' ? item.Id : (item.SeriesId || null);
      if (!seriesId) {
        if (_seriesIdCache.has(item.Id)) seriesId = _seriesIdCache.get(item.Id);
        else {
          seriesId = findSeriesIdByClimbing(item);
          _seriesIdCache.set(item.Id, seriesId);
          capMap(_seriesIdCache);
        }
      }
      if (seriesId) {
        var sUrl = getSeriesTrailerUrl(seriesId);
        if (sUrl) {
          hasTrailerCache.set(itemId, true);
          capMap(hasTrailerCache);
          return true;
        }
      }
      hasTrailerCache.set(itemId, false);
      capMap(hasTrailerCache);
      return false;
    } finally {
      inFlight--;
      pendingHasTrailer.delete(itemId);
    }
  })();
  pendingHasTrailer.set(itemId, task);
  return task;
}

function getOrCreateYTShield(modal = modalState.videoModal) {
  if (!modal) return null;
  var wrap = modal.querySelector.('.preview-iframe-wrapper');
  if (!wrap) return null;

  var shield = wrap.querySelector.('.yt-first-touch-shield');
  if (!shield) {
    shield = document.createElement('div');
    shield.className = 'yt-first-touch-shield';
    Object.assign(shield.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '3',
      background: 'transparent',
      pointerEvents: 'auto',
      touchAction: 'manipulation',
    });
    var swallow = function(e) { if (e.cancelable) e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
    ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','touchmove','contextmenu'].forEach(function(t)
      shield.addEventListener(t, swallow, { passive: false, capture: true })
    );
    wrap.appendChild(shield);
  }
  return shield;
}

function showYTFirstTouchShield(iframe, durationMs = 380) {
  if (!iframe) return;
  var modal = iframe.closest.('.video-preview-modal') || modalState.videoModal;
  var shield = getOrCreateYTShield(modal);
  if (!shield) return;
  shield.style.display = 'block';
  setTimeoutfunction(() { try { shield.style.display = 'none'; } catch {} }, durationMs);
}

function ensureTrailerBadgeCSS() {
  if (document.getElementById('jms-trailer-badge-css')) return;
  var s = document.createElement('style');
  s.id = 'jms-trailer-badge-css';
  s.textContent = "\n  .jms-trailer-badge {\n    position: absolute;\n    left: 8px;\n    bottom: 8px;\n    z-index: 2;\n    width: 36px;\n    height: 36px;\n    border-radius: 50%;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    background: rgba(20, 22, 35, 0.65);\n    color: #fff;\n    border: 1px solid rgba(194, 194, 255, 0.17);\n    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);\n    font-size: 12px;\n    font-weight: 600;\n    backdrop-filter: saturate(140%) blur(6px);\n    display: none;\n    pointer-events: auto;\n    user-select: none;\n    cursor: pointer;\n    touch-action: manipulation;\n    -webkit-tap-highlight-color: transparent;\n  }\n  .jms-trailer-badge:active {\n    transform: scale(0.96);\n  }\n  .jms-trailer-badge svg {\n    width: 18px;\n    height: 18px;\n  }\n  .touch-device .jms-trailer-badge { display: flex; }\n  ";
  document.head.appendChild(s);
}

function getCardRoot(el) {
  if (!el) return null;
  if (el.classList.contains('cardImageContainer')) return el;
  return el.closest.('.cardImageContainer') || null;
}
function getItemIdFromCard(card) {
  return card.dataset.itemId
      || card.dataset.id
      || card.closest.('[data-id]').dataset.id
      || null;
}

var __badgeIO;
function ensureBadgeIO() {
  if (!shouldRunTrailerBadge()) {
    return {
      observe(){}, unobserve(){}, disconnect(){},
    };
  }
  if (__badgeIO) return __badgeIO;
  __badgeIO = new IntersectionObserverfunction((entries) {
    for (var ent of entries) {
      if (!ent.isIntersecting) continue;
      var card = ent.target;
      if (card.dataset.hastrailer === 'true' || card.dataset.hastrailer === 'false') continue;

      var itemId = getItemIdFromCard(card);
      if (!itemId) { card.dataset.hastrailer = 'false'; continue; }

      try {
        var has = hasTrailerForItemId(itemId);
        card.dataset.hastrailer = has ? 'true' : 'false';
        if (has) {
          var labels = (getConfig().languageLabels) || {};
          mountTrailerBadge(card, labels.fragman || 'Fragman');
        }
      } catch {
        card.dataset.hastrailer = 'false';
      }
    }
  }, { rootMargin: '300px 0px', threshold: 0.01 });
  return __badgeIO;
}

function disconnectObservers() {
  try { window.__studioMiniObs.disconnect.(); } catch {}
  try { window.__jmsTrailerBadgeMO.disconnect.(); } catch {}
  try { __badgeIO.disconnect.(); } catch {}
  try { __trailerBadgeObserver.disconnect.(); } catch {}
  window.__jmsTrailerBadgeMO = null;
  __badgeIO = null;
  __trailerBadgeObserver = null;
  try {
    document.querySelectorAll('.cardImageContainer').forEach(function((card) {
      card.__jmsTrailerObserved = false;
      card.__jmsTrailerBadgeObserved = false;
      card.__jmsTrailerBadgePending = false;
    });
  } catch {}
}

function observeCardForTrailer(card) {
  if (!shouldRunTrailerBadge()) return;
  if (!card || card.__jmsTrailerObserved) return;
  card.__jmsTrailerObserved = true;
  ensureTrailerBadgeCSS();
  ensureBadgeIO().observe(card);
}

function rescanAllCardsForBadge(root = document) {
  if (!shouldRunTrailerBadge()) return;
  try {
    var list = root.querySelectorAll.('.cardImageContainer');
    if (!list || !list.length) return;
    list.forEach(observeCardForTrailer);
  } catch {}
}

function installTrailerBadgeAutobind() {
  if (window.__jmsTrailerBadgeObsInstalled) {
    if (shouldRunTrailerBadge()) {
      try { window.__jmsTrailerBadgeStartObserver.(); } catch {}
    }
    return;
  }
  if (!shouldRunTrailerBadge()) return;
  window.__jmsTrailerBadgeObsInstalled = true;
  onFirstInteractionfunction(() rescanAllCardsForBadge(), 1200);
  var deb = function(fn, ms=120) { var t; return function(...a){ clearTimeout(t); t=setTimeoutfunction(()fn(...a),ms);} };
  var rebind = debfunction(() rescanAllCardsForBadge(document), 120);
  var startObserver = function() {
    if (!shouldRunTrailerBadge()) return;
    if (window.__jmsTrailerBadgeMO) return;

    var mo = new MutationObserverfunction((mutList) {
      if (!shouldRunTrailerBadge()) return;
      var need = false;
      for (var m of mutList) {
        for (var n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList.contains('cardImageContainer')) {
            observeCardForTrailer(n);
            need = false;
          } else if (n.querySelector.('.cardImageContainer')) {
            need = true;
          }
        }
      }
      if (need) rescanAllCardsForBadge();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.__jmsTrailerBadgeMO = mo;
  };
  window.__jmsTrailerBadgeStartObserver = startObserver;

  window.addEventListener('hashchange', rebind, true);
  window.addEventListener('popstate',   rebind, true);
  startObserver();
  window.addEventListenerfunction('jms:globalPreviewModeChanged', () rebind(), { passive: true });
  document.addEventListenerfunction('dialogopen', () rescanAllCardsForBadge(document), { passive: true });
  document.addEventListenerfunction('dialogopened', () rescanAllCardsForBadge(document), { passive: true });
  document.addEventListenerfunction('visibilitychange', () {
    if (!document.hidden) rebind();
  });
}

function shouldShowTrailerBadge() {
  try {
    var cfg = getConfig();
    return !!(cfg && cfg.allPreviewModal !== false);
  } catch { return false; }
}

function shouldRunTrailerBadge() {
  return shouldShowTrailerBadge() && shouldEnableTouchDeviceClass();
}

function hideAllTrailerBadges() {
  try {
    document.querySelectorAll('.jms-trailer-badge').forEach(function(n) {
      n.style.display = 'none';
    });
  } catch {}
}

function showAllTrailerBadges() {
  try {
    document.querySelectorAll('.jms-trailer-badge').forEach(function(n) {
      n.style.display = '';
    });
  } catch {}
}

function ensureTrailerBadgeGlobalCSSLock() {
  var id = 'jms-trailer-badge-visibility-lock';
  var style = document.getElementById(id);
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = shouldRunTrailerBadge()
    ? ''
    : '.jms-trailer-badge{display:none!important}';
}

function syncTrailerBadgeRuntime() {
  ensureTrailerBadgeGlobalCSSLock();
  if (shouldRunTrailerBadge()) {
    showAllTrailerBadges();
    installTrailerBadgeAutobind();
    try { rescanAllCardsForBadge(document); } catch {}
  } else {
    try { disconnectObservers(); } catch {}
    hideAllTrailerBadges();
  }
}

syncTrailerBadgeRuntime();

window.addEventListenerfunction('jms:globalPreviewModeChanged', () {
  syncTrailerBadgeRuntime();
}, { passive:true });

function mountTrailerBadge(card, text = 'Fragman') {
  if (!card) return;
  var existing = card.querySelector('.jms-trailer-badge');
  if (existing) {
    existing.style.display = '';
    return;
  }
  try { if (getComputedStyle(card).position === 'static') card.style.position = 'relative'; } catch {}
  var el = document.createElement('div');
  el.className = 'jms-trailer-badge';
  el.innerHTML = "<svg viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z\"/></svg>";
  card.appendChild(el);
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', text);

  var getId = function(host)
    host.dataset.itemId || host.dataset.id || host.closest.('[data-id]').dataset.id || null;

  var openFromBadge = function(evt) {
    if (evt.cancelable) evt.preventDefault();
    evt.stopImmediatePropagation();
    evt.stopPropagation();
    try { navigator.vibrate.(8); } catch {}
    var itemId = getId(card);
    if (!itemId) return;
    modalState.__suppressOpenUntil = 0;
   openPreviewModalForItem(itemId, card, { bypass: true });
  };

  el.addEventListener('click', openFromBadge, { passive: false });
  el.addEventListener('touchstart', openFromBadge, { passive: false });
 el.addEventListener('touchend',   openFromBadge, { passive: false });
  el.addEventListenerfunction('contextmenu', (e) { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  el.addEventListenerfunction('keydown', (e) {
    if (e.key === 'Enter' || e.key === ' ') openFromBadge(e);
  });
}

function scanAndMarkCardsForTrailers() {
  if (!shouldRunTrailerBadge()) return;
  ensureTrailerBadgeCSS();
  var items = document.querySelectorAll('.cardImageContainer');
  if (!items.length) return;

  if (!__trailerBadgeObserver) {
    __trailerBadgeObserver = new IntersectionObserverfunction((entries) {
      for (var ent of entries) {
        if (!ent.isIntersecting) continue;
        var card = ent.target;
        if (!card || card.__jmsTrailerBadgePending) continue;
        if (card.dataset.hastrailer === 'true') {
          var labels = (getConfig().languageLabels) || {};
          mountTrailerBadge(card, labels.fragman || 'Fragman');
          try { __trailerBadgeObserver.unobserve(card); } catch {}
          continue;
        }
        if (card.dataset.hastrailer === 'false') {
          try { __trailerBadgeObserver.unobserve(card); } catch {}
          continue;
        }

        card.__jmsTrailerBadgePending = true;
        try {
          var itemId = card.dataset.itemId || card.dataset.id || card.closest.('[data-id]').dataset.id;
          if (!itemId) {
            card.dataset.hastrailer = 'false';
            continue;
          }
          var has = hasTrailerForItemId(itemId);
          card.dataset.hastrailer = has ? 'true' : 'false';
          if (has) {
            var labels = (getConfig().languageLabels) || {};
            mountTrailerBadge(card, labels.fragman || 'Fragman');
          }
        } finally {
          card.__jmsTrailerBadgePending = false;
          try { __trailerBadgeObserver.unobserve(card); } catch {}
        }
      }
    }, { rootMargin: '200px 0px', threshold: 0.01 });
  }

  items.forEach(function((card) {
    if (!card) return;
    if (card.dataset.hastrailer === 'true') {
      var labels = (getConfig().languageLabels) || {};
      mountTrailerBadge(card, labels.fragman || 'Fragman');
      return;
    }
    if (card.dataset.hastrailer === 'false' || card.__jmsTrailerBadgeObserved) return;
    card.__jmsTrailerBadgeObserved = true;
    __trailerBadgeObserver.observe(card);
  });
}

function canOpenItem(itemId) {
  var now = Date.now();
  if (now < modalState.__openLatchUntil && modalState.__lastOpenedItem === String(itemId)) return false;
  modalState.__openLatchUntil = now + REOPEN_BLOCK_MS;
  modalState.__lastOpenedItem = String(itemId);
  return true;
}

export function setModalAnimation(opts = {}) {
  Object.assign(MODAL_ANIM, opts);
  injectOrUpdateModalStyle();
}

function L(key, fallback = '') {
  try { return (getConfig().languageLabels.[key]) || fallback; }
  catch { return fallback; }
}

function getYTPlayerForIframe(iframe) {
   if (!iframe) return null;

   var p = _ytPlayers.get(iframe);
   if (p) return p;

   if (typeof YT === 'undefined' || typeof YT.Player !== 'function') {
     return null;
   }
   try {
    p = new YT.Playerfunction(iframe, {
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        origin: window.location.origin
      },
      events: {
         onReady: (ev) {
  try {
    var root = iframe.closest.('.video-preview-modal') || document.querySelector('.video-preview-modal');
    var btn = root.querySelector.('.preview-volume-button');
     if (isTouchRuntime()) {
       if (typeof ev.target.mute === 'function') ev.target.mute();
     } else {
       if (modalState._soundOn) {
         if (typeof ev.target.unMute === 'function') ev.target.unMute();
         if (typeof ev.target.setVolume === 'function') ev.target.setVolume(100);
       } else {
         if (typeof ev.target.mute === 'function') ev.target.mute();
       }
     }
     if (btn) {
       btn.innerHTML = modalState._soundOn
         ? '<i class="fa-solid fa-volume-high"></i>'
         : '<i class="fa-solid fa-volume-xmark"></i>';
     }
   } catch (error) {}
 },
         onStateChange: function(event) {
   if (event.data === YT.PlayerState.PLAYING) {
     try { modalState.videoModal.hideBackdrop.(); } catch {}
            var root = iframe.closest.('.video-preview-modal') || document.querySelector('.video-preview-modal');
            var btn = root.querySelector.('.preview-volume-button');
             if (btn && typeof event.target.getVolume === 'function') {
               try {
                 var volume = event.target.getVolume();
                 btn.innerHTML = volume === 0
                   ? '<i class="fa-solid fa-volume-xmark"></i>'
                   : '<i class="fa-solid fa-volume-high"></i>';
               } catch (error) {
               }
             }
           }
         }
       }
     });

     _ytPlayers.set(iframe, p);
     return p;

   } catch (error) {
     return null;
   }
 }

function sleep(ms) { return new Promise(function(res) setTimeout(res, ms)); }
export function modalIsVisible() {
  return !!(modalState.videoModal && modalState.videoModal.style.display !== 'none' && document.body.contains(modalState.videoModal));
}

export function hardStopPlayback() {
  try {
    hideTrailerIframe();

    if (modalState.modalVideo) {
      modalState.modalVideo.pause();
      modalState.modalVideo.removeAttribute('src');
      modalState.modalVideo.load();
      modalState.modalVideo.style.opacity = '0';
      modalState.modalVideo.style.display = 'none';
    }
  } catch (e) {}
}

export function getClosingRemaining() {
  return Math.max(0, modalState._modalClosingUntil - Date.now());
}

function gatePlaybackStart(expectedItemId) {
  sleep(MODAL_ANIM.openMs);
  if (!modalIsVisible()) return false;
  if (expectedItemId && modalState.videoModal.dataset.itemId && modalState.videoModal.dataset.itemId !== String(expectedItemId)) {
    return false;
  }
  if (getClosingRemaining() > 0) {
    sleep(getClosingRemaining());
    if (!modalIsVisible()) return false;
  }
  return true;
}

export function scheduleOpenForItem(itemEl, itemId, signal, openFn) {
  if (Date.now() < (modalState.__suppressOpenUntil || 0)) return;
  if (modalState._hoverOpenTimer) {
    clearTimeout(modalState._hoverOpenTimer);
    modalState._hoverOpenTimer = null;
  }
  modalState._currentHoverItemId = itemId;
  modalState._lastItemEnterAt = Date.now();

  var sinceHide = Date.now() - modalState._lastModalHideAt;
  var needCooldown = Math.max(0, REOPEN_COOLDOWN_MS - sinceHide);
  var settleLeft = Math.max(0, CROSS_ITEM_SETTLE_MS);
  var closingLeft = getClosingRemaining();

  var delay = Math.max(getOpenHoverDelay(), needCooldown, settleLeft, closingLeft);

  var run = function() {
    if (Date.now() < (modalState.__suppressOpenUntil || 0)) return;
    var stillClosing = getClosingRemaining();
    if (stillClosing > 0) {
      modalState._hoverOpenTimer = setTimeout(run, stillClosing);
      return;
    }
    if (modalState._currentHoverItemId !== itemId || signal.aborted) return;
    openFn();
  };

  modalState._hoverOpenTimer = setTimeout(run, delay);
}

function resolveLocalTrailerUrlFor(item, { signal } = {}) {
  try {
    if (!item.Id) return { url: null, level: null };
    var locals = fetchLocalTrailers(item.Id, { signal });
    if (!locals || locals.length === 0) return { url: null, level: null };
    var best = pickBestLocalTrailer(locals);
    if (!best.Id) return { url: null, level: null };
    var url = getVideoStreamUrl(best.Id);
    return url ? { url, level: 'local', trailerItem: best } : { url: null, level: null };
  } catch {
    return { url: null, level: null };
  }
}

function getSeriesTrailerUrl(seriesId) {
  if (!seriesId) return null;
  if (_seriesTrailerCache.has(seriesId)) return _seriesTrailerCache.get(seriesId);

  try {
    var series = fetchItemDetails(seriesId);
    var url = pickYouTubeTrailerUrl(series.RemoteTrailers);
    _seriesTrailerCache.set(seriesId, url || null);
    capMap(_seriesTrailerCache);
    return url || null;
  } catch {
    _seriesTrailerCache.set(seriesId, null);
    capMap(_seriesTrailerCache);
    return null;
  }
}

function findSeriesIdByClimbing(item) {
  if (!item) return null;
  if (item.Type === 'Series') return item.Id || null;
  var probeId = item.SeriesId || item.ParentId || null;
  while (probeId) {
    var p = fetchItemDetails(probeId);
    if (!p) break;
    if (p.Type === 'Series') return p.Id || probeId;
    probeId = p.ParentId || null;
  }
  return null;
}

function pickYouTubeTrailerUrl(remoteTrailers = []) {
  if (!Array.isArray(remoteTrailers)) return null;
  for (var t of remoteTrailers) {
    var raw = t.Url;
    if (!raw) continue;
    var embed = getYoutubeEmbedUrl(raw);
    if (embed && isValidUrl(embed)) return embed;
  }
  return null;
}

function resolveTrailerUrlFor(item) {
  var local = resolveLocalTrailerUrlFor(item);
  if (local.url) return local;
  var itemUrl = pickYouTubeTrailerUrl(item.RemoteTrailers);
  if (itemUrl) return { url: itemUrl, level: 'item' };
  var seriesId = findSeriesIdByClimbing(item);
  if (seriesId) {
    var seriesUrl = getSeriesTrailerUrl(seriesId);
    if (seriesUrl) return { url: seriesUrl, level: 'series' };
  }
  return { url: null, level: null };
}

function ensureYTParams(url, { autoplay = true, muteInitial = true, enableJsApi = true } = {}) {
  try {
    var u = new URL(url, window.location.href);
    u.searchParams.set('autoplay', autoplay ? '1' : '0');
    u.searchParams.set('playsinline', '1');
    u.searchParams.set('rel', '0');
    u.searchParams.set('modestbranding', '1');
    u.searchParams.set('mute', muteInitial ? '1' : '0');

    if (enableJsApi) {
      u.searchParams.set('enablejsapi', '1');
      var origin = window.location.origin;
      if (origin && origin !== 'null' && /^https:\/\//i.test(origin)) {
        u.searchParams.set('origin', origin);
        u.searchParams.set('widget_referrer', origin);
      } else {
        u.searchParams.delete('origin');
        u.searchParams.delete('widget_referrer');
      }
    } else {
      u.searchParams.set('enablejsapi', '0');
      u.searchParams.delete('origin');
      u.searchParams.delete('widget_referrer');
    }

    return u.toString();
  } catch {
    return url;
  }
}

function now() { return Date.now(); }

function cacheGet(id) {
  var entry = previewPreloadCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { previewPreloadCache.delete(id); return null; }
  previewPreloadCache.delete(id);
  previewPreloadCache.set(id, { ...entry, lastAccess: Date.now() });
  return entry.url;
}

function cacheSet(id, url) {
  var entry = { url, createdAt: Date.now(), lastAccess: Date.now(), expiresAt: Date.now() + PREVIEW_TTL_MS };
  if (previewPreloadCache.has(id)) previewPreloadCache.delete(id);
  previewPreloadCache.set(id, entry);
  pruneOverLimit();
  return url;
}

function pruneExpired() {
  var t = Date.now();
  for (var [id, entry] of previewPreloadCache) if (entry.expiresAt < t) previewPreloadCache.delete(id);
}

function pruneOverLimit() {
  var overflow = previewPreloadCache.size - PREVIEW_MAX_ENTRIES;
  if (overflow <= 0) return;
  var toEvict = Math.max(overflow, PREVIEW_EVICT_BATCH);
  for (var [id] of previewPreloadCache) {
    previewPreloadCache.delete(id);
    if (--toEvict <= 0) break;
  }
}

export function preloadVideoPreview(itemId) {
  var hit = cacheGet(itemId);
  if (hit) return hit;
  try {
    var url = absServerUrl(getVideoStreamUrl(itemId));
    return cacheSet(itemId, url);
  } catch { return null; }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    closeVideoModal();
  }
}

function handleWindowBlur() {
  if (isTouchRuntime()) return;
  try {
    var iframe = modalState.videoModal.querySelector.('.preview-trailer-iframe');
    var ytShown = !!(iframe && iframe.style.display !== 'none');
    if (ytShown) return;
  } catch {}
  closeVideoModal();
}

if (!window.__hoverTrailer_globalBound) {
   window.addEventListener("blur", handleWindowBlur);
   document.addEventListener("visibilitychange", handleVisibilityChange);
   window.__hoverTrailer_globalBound = true;
 }

if (typeof window !== 'undefined') {
  window.addEventListenerfunction('beforeunload', () { destroyVideoModal(); disconnectObservers(); });
  window.addEventListenerfunction('pagehide', () { destroyVideoModal(); disconnectObservers(); });
}


function hideOnVisibility() {
  if (document.hidden || document.visibilityState === 'hidden') {
    closeVideoModal();
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener("visibilitychange", hideOnVisibility);
}

export function destroyVideoModal() {
  if (modalState.videoModal) {
    hideTrailerIframe(modalState.videoModal);
    clearTransientOverlays(modalState.videoModal);
    if (modalState.modalVideo) {
      modalState.modalVideo.pause();
      modalState.modalVideo.src = '';
    }
    try { hardWipeModalDom(modalState.videoModal); } catch {}
    try { modalState.videoModal.remove(); } catch {}
    modalState.videoModal = null;
    modalState.modalVideo = null;
  }
  try {
    if (modalState._cacheMaintenanceTimer) {
      clearInterval(modalState._cacheMaintenanceTimer);
      modalState._cacheMaintenanceTimer = null;
    }
    if (modalState._visibilityHandler) {
      document.removeEventListener('visibilitychange', modalState._visibilityHandler);
      modalState._visibilityHandler = null;
    }
  } catch {}
}

function sizeYTToCover(iframe) {
  try {
    var wrap = iframe.__wrapper;
    if (!wrap) return;
    var W = wrap.clientWidth || 0;
    var H = wrap.clientHeight || 0;
    if (!W || !H) return;

    var TARGET = 16 / 9;
    var r = W / H;

    if (r >= TARGET) {
      iframe.style.width = '100%';
      iframe.style.height = Math.ceil(W * 9 / 16) + 'px';
    } else {
      iframe.style.height = '100%';
      iframe.style.width = Math.ceil(H * 16 / 9) + 'px';
    }
    iframe.style.left = '50%';
    iframe.style.top  = '50%';
    iframe.style.transform = 'translate(-50%, -50%)';
  } catch {}
}

window.addEventListenerfunction('resize', () {
  try {
    for (var [iframe] of _ytPlayers) sizeYTToCover(iframe);
  } catch {}
});

function getOrCreateTrailerIframe(modal = modalState.videoModal) {
  if (!modal) return null;
  var container = modal.querySelector.('.video-container');
  if (!container) return null;

  var wrap = modal.querySelector.('.preview-iframe-wrapper');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'preview-iframe-wrapper';
    wrap.style.display = 'none';
    wrap.style.position = 'absolute';
    wrap.style.inset = '10px';
    wrap.style.borderRadius = '0px';
    wrap.style.overflow = 'hidden';
    wrap.style.zIndex = '2';
    container.appendChild(wrap);
  }

  var iframe = wrap.querySelector.('.preview-trailer-iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.className = 'preview-trailer-iframe';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.referrerPolicy = 'origin-when-cross-origin';
    iframe.allowFullscreen = true;
    Object.assign(iframe.style, {
      position: 'absolute',
      border: 'none',
      display: 'none',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'auto'
    });
    wrap.appendChild(iframe);
  }

  iframe.__wrapper = wrap;
  return iframe;
}

function hideTrailerIframe(modal = modalState.videoModal) {
  if (!modal) return;
  var iframe = modal.querySelector.('.preview-trailer-iframe');
  if (!iframe) return;

  var p = _ytPlayers.get(iframe);
  if (p) {
    try { if (p.stopVideo) p.stopVideo(); if (p.mute) p.mute(); if (p.destroy) p.destroy(); } catch {}
    _ytPlayers.delete(iframe);
    _ytReadyMap.delete(iframe);
  }

  try {
    iframe.src = 'about:blank';
    iframe.removeAttribute('src');
  } catch {}
  iframe.style.display = 'none';
  try { iframe.__wrapper && (iframe.__wrapper.style.display = 'none'); } catch {}
  try {
    var shield = iframe.__wrapper.querySelector.('.yt-first-touch-shield');
    if (shield) shield.style.display = 'none';
  } catch {}
  var volumeButton = modal.querySelector.('.preview-volume-button');
  if (volumeButton) {
    volumeButton.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    delete volumeButton.dataset.ytMuted;
  }
  clearTransientOverlays(modal);
}

function installYTPlayer(iframe) {
  if (!iframe) return null;
  var p = _ytPlayers.get(iframe);
  if (p) return p;
  if (typeof YT === 'undefined' || typeof YT.Player !== 'function') return null;

  function bindFirstInteractionUnmute() {
    var btn = (iframe.closest('.video-preview-modal') || document).querySelector.('.preview-volume-button');
    var handler = function() {
      try {
        var player = _ytPlayers.get(iframe);
        player.unMute.();
        var currentHoverVolume = parseInt(localStorage.getItem('hoverVolume'), 10);
        var prefVolume = (!isNaN(currentHoverVolume)) ? currentHoverVolume : 80;
        player.setVolume.(prefVolume);
        player.playVideo.();
        if (btn) btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
      } catch {}
      cleanup();
    };
    var cleanup = function() {
      ['pointerdown','keydown'].forEach(function(t) window.removeEventListener(t, handler, true));
    };
    ['pointerdown','keydown'].forEach(function(t) window.addEventListener(t, handler, { once:true, capture:true }));
    setTimeout(cleanup, 6000);
  }

  try {
    p = new YT.Playerfunction(iframe, {
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        origin: window.location.origin
      },
      events: {
        onReady: (ev) {
          try {
            var root = iframe.closest.('.video-preview-modal') || document.querySelector('.video-preview-modal');
            var btn  = root.querySelector.('.preview-volume-button');
            if (btn) {
              btn.innerHTML = modalState._soundOn
                ? '<i class="fa-solid fa-volume-high"></i>'
                : '<i class="fa-solid fa-volume-xmark"></i>';
            }

            if ((isMobileAppEnv() || !isTouchRuntime()) && modalState._soundOn) {
              ev.target.unMute.();
              var currentHoverVolume = parseInt(localStorage.getItem('hoverVolume'), 10);
              var prefVolume = (!isNaN(currentHoverVolume)) ? currentHoverVolume : 80;
              ev.target.setVolume.(prefVolume);
              try { ev.target.playVideo.(); } catch {}
              setTimeoutfunction(() {
                try {
                  var muted = typeof ev.target.isMuted === 'function' ? ev.target.isMuted() : true;
                  if (muted) bindFirstInteractionUnmute();
                } catch {
                  bindFirstInteractionUnmute();
                }
              }, 250);
            } else {
              if (btn) btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            }
          } catch {}
        },
        onStateChange: function(event) {
          if (event.data === YT.PlayerState.PLAYING) {
            try { modalState.videoModal.hideBackdrop.(); } catch {}
            var root = iframe.closest.('.video-preview-modal') || document.querySelector('.video-preview-modal');
            var btn  = root.querySelector.('.preview-volume-button');
            if (btn) {
              try {
                var muted = typeof event.target.isMuted === 'function' ? event.target.isMuted() : true;
                btn.innerHTML = muted
                  ? '<i class="fa-solid fa-volume-xmark"></i>'
                  : '<i class="fa-solid fa-volume-high"></i>';
              } catch {}
            }
            try {
     if (isMobileAppEnv() && modalState._soundOn) {
       event.target.unMute.();
       var currentHoverVolume = parseInt(localStorage.getItem('hoverVolume'), 10);
       var prefVolume = (!isNaN(currentHoverVolume)) ? currentHoverVolume : 80;
       event.target.setVolume.(prefVolume);
     }
   } catch {}
          }
        }
      }
    });
    _ytPlayers.set(iframe, p);
    return p;
  } catch {
    return null;
  }
}

function ensureYTAPI() {
  if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
    modalState._ytApiReady = true;
    return Promise.resolve();
  }
  if (modalState._ytApiLoading) {
    return new Promisefunction(function(resolve) {
      var iv = setInterval(() {
        if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
          clearInterval(iv);
          modalState._ytApiReady = true;
          resolve();
        }
      }, 100);
    });
  }
  modalState._ytApiLoading = true;
  return new Promisefunction((resolve) {
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    setTimeoutfunction(() {
      if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
        modalState._ytApiReady = true;
        modalState._ytApiLoading = false;
        resolve();
      } else {
        console.warn('YouTube API zaman aşımına uğradı, API olmadan devam ediyor');
        modalState._ytApiReady = false;
        modalState._ytApiLoading = false;
        resolve();
      }
    }, 3000);
  });
}

export function setGlobalSound(on) {
  modalState._soundOn = !!on;
  applyVolumePreference();
}

export function applyVolumePreference(modal = modalState.videoModal) {
  var volumeButton = modal.querySelector.('.preview-volume-button');
  var trailerIframe = modal.querySelector.('.preview-trailer-iframe');
  var trailerVisible = trailerIframe && trailerIframe.style.display !== 'none';
  if (trailerVisible) {
    var player = _ytPlayers.get(trailerIframe);
    if (volumeButton) {
      var muted = true;
      try { muted = player.isMuted.() || true; } catch {}
      volumeButton.innerHTML = muted
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
    return;
  }
  if (modalState.modalVideo) {
    var currentHoverVolume = parseInt(localStorage.getItem('hoverVolume'), 10);
    var prefVolume = (!isNaN(currentHoverVolume)) ? (currentHoverVolume / 100) : 0.8;
    modalState.modalVideo.muted = !modalState._soundOn;
    modalState.modalVideo.volume = modalState._soundOn ? prefVolume : 0.0;
  }
  if (volumeButton) {
    volumeButton.innerHTML = modalState._soundOn
      ? '<i class="fa-solid fa-volume-high"></i>'
      : '<i class="fa-solid fa-volume-xmark"></i>';
  }
}

function injectOrUpdateModalStyle() {
  var id = 'video-modal-modern-style';
  var style = document.getElementById(id) || document.createElement('style');
  style.id = id;
  style.textContent = "\n    .video-preview-modal {\n      position: absolute;\n      width: 400px;\n      height: 330px;\n      background: rgba(28, 28, 46, 0.97);\n      border-radius: 20px;\n      box-shadow:\n        0 8px 32px 0 rgba(123, 47, 190, 0.35),\n        0 1.5px 4px rgba(0, 0, 0, 0.09);\n      z-index: 1000;\n      display: none;\n      overflow: hidden;\n      transform: translateY(8px) scale(0.92);\n      opacity: 0;\n      transition:\n        opacity 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94),\n        transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94);\n      font-family: \"Inter\", \"Netflix Sans\", \"Helvetica Neue\", Helvetica, Arial, sans-serif;\n      pointer-events: auto;\n      border: 1.5px solid rgba(255, 255, 255, 0.10);\n      backdrop-filter: blur(12px) saturate(160%);\n      user-select: none;\n      box-sizing: border-box;\n      max-width: calc(100vw - 32px);\n    }\n\n    .video-preview-modal.video-preview-modal--visible {\n      display: block;\n      transform: translateY(0) scale(1);\n      opacity: 1;\n    }\n\n    .video-preview-modal.video-preview-modal--hidden {\n      transform: translateY(8px) scale(0.92);\n      opacity: 0;\n    }\n\n    .video-preview-modal .preview-iframe-wrapper {\n      position: absolute;\n      inset: 10px;\n      border-radius: 12px;\n      overflow: hidden;\n      z-index: 2;\n      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.21);\n      opacity: 1;\n      transition: opacity 0.3s ease;\n    }\n\n    .video-preview-modal .preview-iframe-wrapper--hidden {\n      opacity: 0;\n    }\n\n    .video-preview-modal .preview-trailer-iframe {\n      position: absolute;\n      border: none;\n      display: none;\n      left: 50%;\n      top: 50%;\n      transform: translate(-50%, -50%);\n      pointer-events: auto;\n    }\n\n    .video-preview-modal .preview-close-mobile {\n      position: absolute;\n      top: 8px;\n      right: 8px;\n      width: 32px;\n      height: 32px;\n      border-radius: 50%;\n      display: none;\n      align-items: center;\n      justify-content: center;\n      background: rgba(56, 60, 90, 0.76);\n      color: #fff;\n      border: 1px solid rgba(194, 194, 255, 0.17);\n      z-index: 5;\n      cursor: pointer;\n      transition:\n        transform 0.15s ease,\n        background-color 0.2s ease;\n    }\n\n    .video-preview-modal .preview-close-mobile:active {\n      transform: scale(0.95);\n    }\n\n    .video-preview-modal .preview-backdrop {\n      position: absolute;\n      inset: 10px 10px 130px 10px;\n      border-radius: 12px;\n      padding: 10px;\n      box-sizing: border-box;\n      object-fit: cover;\n      width: 100%;\n      height: 190px;\n      background-position: center;\n      opacity: 0;\n      transition: opacity 0.25s ease;\n      pointer-events: none;\n      z-index: 0;\n      left: 0;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      overflow: hidden;\n    }\n\n    .video-preview-modal .preview-backdrop--visible {\n      opacity: 1;\n    }\n\n    .video-preview-modal .video-container {\n      position: relative;\n      width: 100%;\n      height: 200px;\n      padding: 10px;\n      box-sizing: border-box;\n      background: linear-gradient(160deg, rgba(33, 36, 54, 0.97) 65%, rgba(52, 56, 80, 0.19));\n      border-radius: 16px;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      overflow: hidden;\n      box-shadow: 0 4px 18px 0 rgba(20, 20, 50, 0.06);\n      opacity: 1;\n    }\n\n    .video-preview-modal .preview-video {\n      width: 100%;\n      height: 100%;\n      object-fit: cover;\n      background: #111;\n      border-radius: 12px;\n      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.21);\n      transition:\n        opacity 0.4s ease,\n        transform 0.3s ease;\n    }\n\n    .video-preview-modal .preview-video--hidden {\n      opacity: 0;\n      transform: scale(0.95);\n    }\n\n    .video-preview-modal .preview-info {\n      padding: 16px 18px 12px 18px;\n      position: absolute;\n      bottom: -5px;\n      left: 0;\n      right: 0;\n      z-index: 2;\n      background: linear-gradient(0deg, rgba(24, 27, 38, 0.94) 60%, transparent 100%);\n      display: grid;\n      grid-template-columns: auto 1fr;\n      grid-template-rows: repeat(3, auto);\n      gap: 6px 16px;\n      align-items: end;\n      opacity: 1;\n    }\n\n    .video-preview-modal .preview-title {\n      grid-column: 1 / 2;\n      color: #fff;\n      font-weight: 700;\n      font-size: 1.24rem;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      max-width: 100%;\n      margin: 0 0 2px 0;\n      padding: 0;\n      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);\n      line-height: 1.13;\n    }\n\n    .video-preview-modal .preview-episode {\n      grid-column: 1 / 3;\n      color: #e5e6fb;\n      font-size: 13.5px;\n      opacity: 0.95;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n    }\n\n    .video-preview-modal .preview-meta {\n      grid-column: 1 / 3;\n      color: #b9badb;\n      font-size: 13px;\n      display: flex;\n      flex-wrap: wrap;\n      gap: 14px 10px;\n      width: 100%;\n      opacity: 0.95;\n      align-items: center;\n      margin: 0 0 -6px 0;\n    }\n\n    .video-preview-modal img.range-icon,\n    .video-preview-modal img.codec-icon,\n    .video-preview-modal img.quality-icon {\n      width: 24px;\n      height: 18px;\n      background: rgba(30, 30, 40, 0.7);\n      border-radius: 4px;\n      padding: 1px;\n    }\n\n    .video-preview-modal .preview-genres {\n      grid-column: 1 / 3;\n      display: flex;\n      gap: 8px;\n      margin-top: 2px;\n      font-size: 12.7px;\n      color: #a8aac7;\n      width: 99%;\n      overflow: hidden;\n      opacity: 1;\n    }\n\n    .video-preview-modal .genre-badge {\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      display: inline-block;\n    }\n\n    .video-preview-modal .genre-separator {\n      color: #a8aac7;\n      margin: 0 4px;\n    }\n\n    .video-preview-modal .preview-buttons {\n      display: flex;\n      gap: 12px;\n      position: absolute;\n      top: 60%;\n      left: 50%;\n      opacity: 1;\n      z-index: 6;\n      pointer-events: auto;\n      padding: 5px 0;\n      transform: translateX(-50%);\n      transition:\n        opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),\n        transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);\n    }\n\n    .video-preview-modal .preview-buttons--hidden {\n      opacity: 0;\n      transform: translateX(-50%) scale(0.95);\n    }\n\n    .video-preview-modal button {\n      outline: none;\n      border: none;\n      padding: 0;\n      background: none;\n      font: inherit;\n    }\n\n    .video-preview-modal .preview-play-button {\n      background: linear-gradient(94deg, #fff 78%, #eee 100%) !important;\n      color: #000;\n      border-radius: 4px;\n      padding: 8px 18px 8px 16px;\n      font-size: 15px;\n      display: flex;\n      align-items: center;\n      gap: 8px;\n      height: 32px;\n      cursor: pointer;\n      min-width: 82px;\n      box-shadow: 0 2px 8px 0 rgba(23, 22, 31, 0.05);\n      transition:\n        box-shadow 0.18s ease,\n        transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94);\n      text-wrap-mode: nowrap;\n      font-weight: 700;\n      text-overflow: ellipsis;\n      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);\n      line-height: 1.13;\n    }\n\n    .video-preview-modal .preview-play-button:hover {\n      background: linear-gradient(92deg, #f5f4f9 64%, #fff 100%) !important;\n      box-shadow: 0 4px 16px 0 rgba(21, 12, 50, 0.11);\n      transform: scale(1.05);\n    }\n\n    .video-preview-modal .preview-play-button:active {\n      transform: scale(0.98);\n    }\n\n    .video-preview-modal .preview-favorite-button,\n    .video-preview-modal .preview-info-button,\n    .video-preview-modal .preview-volume-button,\n    .video-preview-modal .preview-match-button {\n      background: rgba(56, 60, 90, 0.76);\n      color: #fff;\n      border-radius: 50%;\n      width: 32px;\n      height: 32px;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      cursor: pointer;\n      font-size: 15px;\n      border: 1px solid rgba(194, 194, 255, 0.17);\n      transition:\n        background 0.18s ease,\n        transform 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94);\n      box-shadow: 0 1px 4px 0 rgba(23, 22, 31, 0.07);\n    }\n\n    .video-preview-modal .preview-favorite-button.favorited {\n      background: linear-gradient(80deg, #9D58E2 65%, #7B2FBE 100%);\n      color: #fff;\n      border: 1px solid #7B2FBE;\n    }\n\n    .video-preview-modal .preview-match-button {\n      background: rgba(70, 211, 105, 0.15);\n      color: #46d369;\n      border: 1px solid rgba(70, 211, 105, 0.3);\n      font-weight: 600;\n      font-size: 12px;\n      border-radius: 6px;\n      width: auto;\n      padding: 0 8px;\n      min-width: 50px;\n    }\n\n    .video-preview-modal .preview-favorite-button:hover,\n    .video-preview-modal .preview-info-button:hover,\n    .video-preview-modal .preview-volume-button:hover,\n    .video-preview-modal .preview-match-button:hover {\n      background: rgba(81, 85, 140, 0.98);\n      transform: scale(1.09);\n    }\n\n    .video-preview-modal .preview-favorite-button:active,\n    .video-preview-modal .preview-info-button:active,\n    .video-preview-modal .preview-volume-button:active,\n    .video-preview-modal .preview-match-button:active {\n      transform: scale(1.05);\n    }\n\n    /* Trailer tip overlay */\n    .video-preview-modal .trailer-tip {\n      position: absolute;\n      top: 11px;\n      left: 11px;\n      font-size: 11px;\n      padding: 3px 8px;\n      border-radius: 6px;\n      background: rgba(0, 0, 0, 0.45);\n      color: #eee;\n      z-index: 1;\n      pointer-events: none;\n      opacity: 1;\n      transition: opacity 0.3s ease;\n    }\n\n    .video-preview-modal .trailer-tip--hidden {\n      opacity: 0;\n    }\n\n    /* No trailer message */\n    .video-preview-modal .no-trailer-message {\n      position: absolute;\n      top: 50%;\n      left: 50%;\n      transform: translate(-50%, -50%);\n      color: #ccc;\n      font-size: 18px;\n      font-weight: 500;\n      text-align: center;\n      pointer-events: none;\n      white-space: nowrap;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      opacity: 1;\n      transition: opacity 0.3s ease;\n    }\n\n    .video-preview-modal .no-trailer-message--hidden {\n      opacity: 0;\n    }\n\n    /* YouTube touch shield */\n    .video-preview-modal .yt-first-touch-shield {\n      position: absolute;\n      inset: 0;\n      z-index: 3;\n      background: transparent;\n      pointer-events: auto;\n      touch-action: manipulation;\n    }\n\n    /* Mobile responsive */\n    @media (max-width: 750px) {\n      .video-preview-modal .preview-close-mobile {\n        display: flex;\n      }\n\n      .video-preview-modal {\n        width: 95vw;\n        max-width: 380px;\n        height: 300px;\n      }\n\n      .video-preview-modal .preview-buttons {\n        gap: 8px;\n      }\n\n      .video-preview-modal .preview-play-button {\n        padding: 6px 14px 6px 12px;\n        font-size: 14px;\n        min-width: 70px;\n      }\n    }\n\n    /* High DPI screens optimization */\n    @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {\n      .video-preview-modal {\n        backdrop-filter: blur(16px) saturate(180%);\n      }\n    }\n\n    /* Reduced motion support */\n    @media (prefers-reduced-motion: reduce) {\n      .video-preview-modal,\n      .video-preview-modal * {\n        transition-duration: 0.01ms !important;\n        animation-duration: 0.01ms !important;\n        animation-iteration-count: 1 !important;\n      }\n    }\n\n    /* Performance optimizations */\n    .video-preview-modal * {\n      will-change: auto;\n      -webkit-backface-visibility: visible;\n      backface-visibility: visible;\n    }\n\n    /* Content fade animations */\n    .video-preview-modal .content-element {\n      opacity: 1;\n      transform: translateY(0);\n      transition:\n        opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),\n        transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);\n    }\n\n    .video-preview-modal .content-element--hidden {\n      opacity: 0;\n      transform: translateY(8px);\n    }\n  ";
  if (!style.isConnected) document.head.appendChild(style);
}


function bindModalHover(modal) {
  modal.addEventListenerfunction('mouseenter', () {
    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
  });
  var leave = function() {
    modalState.isMouseInModal = false;
    closeVideoModal();
  };
  modal.addEventListener('mouseleave', leave);
  modal.addEventListener('pointerleave', leave);
}

function shouldHideModal() { return !modalState.isMouseInModal; }

export function startModalHideTimer() {
  clearTimeout(modalState.modalHideTimeout);
  if (isTouchRuntime()) return;
  modalState.modalHideTimeout = setTimeoutfunction(() {
    if (shouldHideModal() && modalState.videoModal) {
      modalState._isModalClosing = true;
      modalState._modalClosingUntil = Date.now() + MODAL_ANIM.closeMs + HARD_CLOSE_BUFFER_MS;
      modalState.videoModal.style.transition =
        "opacity " + (MODAL_ANIM.closeMs) + "ms " + (MODAL_ANIM.ease) + ", " +
        "transform " + (MODAL_ANIM.closeMs) + "ms " + (MODAL_ANIM.ease);
      modalState.videoModal.style.opacity = String(MODAL_ANIM.opacityFrom);
      modalState.videoModal.style.transform = "scale(" + (MODAL_ANIM.scaleFrom) + ")";
      softStopPlayback();
      setTimeoutfunction(() {
        if (shouldHideModal() && modalState.videoModal) {
          hardStopPlayback();
          resetModalInfo(modalState.videoModal);
          resetModalButtons();
          modalState._lastModalHideAt = Date.now();
          modalState._isModalClosing = false;
          clearTransientOverlays(modalState.videoModal);
          modalState.videoModal.style.display = 'none';
        }
      }, MODAL_ANIM.closeMs);
    }
  }, 150);
}

function getCardItemType(el){
  try{
    var cand = (
      el.dataset.type ||
      el.dataset.mediaType ||
      el.dataset.mediatype ||
      el.dataset.collectionType ||
      el.dataset.collectiontype ||
      el.closest('[data-type]').dataset.type ||
      el.closest('[data-mediatype]').dataset.mediatype ||
      el.closest('[data-media-type]').dataset.mediaType ||
      el.closest('[data-collectiontype]').dataset.collectiontype
    );
    if (!cand) return null;
    var norm = String(cand).trim().toLowerCase();
    var cap  = norm.charAt(0).toUpperCase() + norm.slice(1);
    return cap;
  } catch { return null; }
}

var __typeCache = new Map();
function getItemTypeCached(itemId){
  if (__typeCache.has(itemId)) return __typeCache.get(itemId);
  try{
    var it = fetchPlayableItemDetails(itemId);
    var t  = it.Type || null;
    if (t) {
      __typeCache.set(itemId, t);
      capMap(__typeCache);
    }
    return t || null;
  } catch {
    return null;
  }
}

export function setupHoverForAllItems() {
  if (!config || config.allPreviewModal === false) return;
  installHoverOpenSuppressors();
  scanAndMarkCardsForTrailers();
  var isTouch = isTouchRuntime();
  var mode = config.globalPreviewMode || 'modal';
  if (isTouch) {
    if (!__hoverTouchDelegatesBound) {
      __hoverTouchDelegatesBound = true;

      var ALLOWED_TYPES = new Set(['Movie','Episode','Series','Season']);
      var LONG_PRESS_MS = 380;
      var MOVE_TOL = 12;
      var SUPPRESS_MS = 450;

      var lpTimer = null;
      var startX = 0;
      var startY = 0;
      var activeItem = null;
      var activeId = null;
      var longPressFiredAt = 0;

      var getId = function(el)
        el.dataset.itemId || el.dataset.id || el.closest.('[data-id]').dataset.id || null;

      var isSuppressionActive = function() (Date.now() - longPressFiredAt) < SUPPRESS_MS;

      var fireLongPress = function() {
        longPressFiredAt = Date.now();
        try { navigator.vibrate.(10); } catch {}
        if (activeItem && activeId) {
          modalState.__suppressOpenUntil = 0;
          openPreviewModalForItem(activeId, activeItem, { bypass: true });
        }
      };

      var cancelLP = function() {
        clearTimeout(lpTimer);
        lpTimer = null;
        if (activeItem) activeItem.style.touchAction = '';
        activeItem = null;
        activeId = null;
      };

      var suppressIfNeeded = function(e) {
        if (e.target.closest.('.jms-trailer-badge')) return;
        if (!isSuppressionActive()) return;
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
      };

      ['click','mousedown','mouseup','pointerup','pointerdown','touchend','touchstart','contextmenu']
        .forEach(function((type) {
          document.addEventListenerfunction(type, (e) {
            if (e.target.closest.('.jms-trailer-badge')) return;
            suppressIfNeeded(e);
          }, { capture: true, passive: false });
        });

      var onTouchStart = function(e) {
        if (e.target.closest.('.jms-trailer-badge')) return;
        var card = e.target.closest.('.cardImageContainer');
        if (!card) return;
        var itemId = getId(card);
        if (!itemId) return;
        var type = getCardItemType(card);
        if (!type) type = getItemTypeCached(itemId);
        if (!type || !ALLOWED_TYPES.has(type)) return;
        activeItem = card;
        activeId = itemId;
        activeItem.style.touchAction = 'none';
        var t = e.touches.[0];
        startX = t.clientX || 0;
        startY = t.clientY || 0;
        clearTimeout(lpTimer);
        lpTimer = setTimeoutfunction(() {
          fireLongPress();
        }, LONG_PRESS_MS);
      };

      var onTouchMove = function(e) {
        if (!lpTimer) return;
        var t = e.touches.[0];
        if (!t) return;
        var dx = Math.abs((t.clientX || 0) - startX);
        var dy = Math.abs((t.clientY || 0) - startY);
        if (dx > MOVE_TOL || dy > MOVE_TOL) {
          cancelLP();
        } else if (e.cancelable) {
          e.preventDefault();
        }
      };

      var onTouchEnd = function(e) {
        if (isSuppressionActive()) {
          if (e.cancelable) e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
        }
        cancelLP();
      };

      var onTouchCancel = function() cancelLP();

      document.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
      document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
      document.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });
      document.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });
    }

    return;
  }

  if (mode === 'studioMini') {
    var items = document.querySelectorAll('.cardImageContainer');
    installStudioMiniAutobind();
    destroyVideoModal();
    items.forEach(function(item) {
      if (item.__miniBound) return;
      item.__miniBound = true;
      var itemId =
        item.dataset.itemId ||
        item.dataset.id ||
        (item.closest('[data-id]') && item.closest('[data-id]').dataset.id);
      if (!itemId) return;
      attachMiniPosterHover(item, { Id: itemId });
    });
    return;
  }

  if (typeof config !== 'undefined' && config.allPreviewModal !== false && !__hoverModalDelegatesBound) {
    __hoverModalDelegatesBound = true;

    var onEnter = function(e) {
      if (Date.now() < (modalState.__suppressOpenUntil || 0)) return;
      ensureHoverInfra();
      var item = e.target.closest.('.cardImageContainer');
      if (!item || isInsideDotArea(item)) return;
      var itemId =
        item.dataset.itemId || item.dataset.id || (item.closest('[data-id]').dataset.id);
      if (!itemId) return;
      modalState.isMouseInItem = true;
      clearTimeout(modalState.modalHideTimeout);
      if (modalState.itemHoverAbortController) modalState.itemHoverAbortController.abort();
      modalState.itemHoverAbortController = new AbortController();
      var { signal } = modalState.itemHoverAbortController;

      scheduleOpenForItemfunction(item, itemId, signal, () {
        if (!modalState.isMouseInItem && !modalState.isMouseInModal) return;
        try {
          if (modalState.videoModal) {
            hardStopPlayback();
            hardWipeModalDom(modalState.videoModal);
            modalState.videoModal.style.display = 'none';
          }
          var itemDetails = fetchPlayableItemDetails(itemId, { signal });
          if (signal.aborted || !itemDetails) { closeVideoModal(); return; }
          if (itemDetails.Genres && itemDetails.Genres.length > 3) itemDetails.Genres = itemDetails.Genres.slice(0,3);
          var videoTypes = ['Movie','Episode','Series','Season'];
          if (!videoTypes.includes(itemDetails.Type)) { closeVideoModal(); return; }
          if (!modalState.videoModal || !document.body.contains(modalState.videoModal) || modalState._modalContext !== 'global') {
            try { destroyVideoModal(); } catch {}
            var modalElements = createVideoModal({ showButtons: true, context: 'global' });
            if (!modalElements) return;
            modalState.videoModal = modalElements.modal;
            modalState.modalVideo = modalElements.video;
            modalState.modalTitle = modalElements.title;
            modalState.modalMeta = modalElements.meta;
            modalState.modalMatchInfo = modalElements.matchInfo;
            modalState.modalGenres = modalElements.genres;
            modalState.modalPlayButton = modalElements.playButton;
            modalState.modalFavoriteButton = modalElements.favoriteButton;
            modalState.modalEpisodeLine = modalElements.episodeLine;
            modalState.modalMatchButton = modalElements.matchButton;
            bindModalEvents(modalState.videoModal);
          }
          var domBackdrop = item.dataset.background || item.dataset.backdrop || null;
          var itemBackdrop = getBackdropFromItem(itemDetails);
          modalState.videoModal.setBackdrop(domBackdrop || itemBackdrop || null);
          if (!modalState.isMouseInItem && !modalState.isMouseInModal) return;
          var myToken = newRenderToken();
          modalState.videoModal.dataset.itemId = itemId;
          positionModalRelativeToItem(modalState.videoModal, item);
          animatedShow(modalState.videoModal);
          applyVolumePreference(modalState.videoModal);
          var videoUrl = null;
          try { videoUrl = preloadVideoPreview(itemId); } catch {}
          if (signal.aborted || !isTokenAlive(myToken) || modalState.videoModal.dataset.itemId !== String(itemId)) return;
          updateModalContent(itemDetails, videoUrl);
        } catch (error) {
          if (error.name !== 'AbortError') {
            console.error('Öğe hover hatası:', error);
            if (modalState.videoModal) modalState.videoModal.style.display = 'none';
          }
        }
      });
    };

    var onLeave = function(e) {
      var fromItem = e.target.closest.('.cardImageContainer');
      if (!fromItem) return;
      var toModal = !!(e.relatedTarget && modalState.videoModal && modalState.videoModal.contains(e.relatedTarget));
      if (toModal) return;
      modalState.isMouseInItem = false;
      if (modalState._hoverOpenTimer) { clearTimeout(modalState._hoverOpenTimer); modalState._hoverOpenTimer = null; }
      if (modalState.itemHoverAbortController) modalState.itemHoverAbortController.abort();
      startModalHideTimer();
    };

    document.addEventListener('pointerenter', onEnter, { passive: true, capture: true });
    document.addEventListener('pointerleave', onLeave, { passive: true, capture: true });
  }
}

function softStopPlayback() {
  try {
    var iframe = modalState.videoModal.querySelector.('.preview-trailer-iframe');
    if (iframe) {
      var p = _ytPlayers.get(iframe);
      try { if (p.pauseVideo) p.pauseVideo(); if (p.mute) p.mute(); } catch {}
    }
    if (modalState.modalVideo) {
      try { modalState.modalVideo.pause(); } catch {}
      modalState.modalVideo.muted = true;
      modalState.modalVideo.volume = 0;
    }
  } catch {}
}




export function positionModalRelativeToItem(modal, item, options = {}) {
  var defaults = {
    modalWidth: 400,
    modalHeight: 330,
    windowPadding: 16,
    preferredPosition: 'center',
    autoReposition: true
  };
  var settings = {...defaults, ...options};
  var modalStyle = modal.style;
  var positionModal = function() {
    var itemRect = item.getBoundingClientRect();
    var scrollX = window.scrollX;
    var scrollY = window.scrollY;
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    var left = itemRect.left + scrollX + (itemRect.width - settings.modalWidth) / 2;
    var top = itemRect.top + scrollY + (itemRect.height - settings.modalHeight) / 2;
    switch(settings.preferredPosition) {
      case 'top': top = itemRect.top + scrollY - settings.modalHeight - 10; break;
      case 'bottom': top = itemRect.bottom + scrollY + 10; break;
      case 'left': left = itemRect.left + scrollX - settings.modalWidth - 10; break;
      case 'right': left = itemRect.right + scrollX + 10; break;
    }
    var maxLeft = viewportWidth + scrollX - settings.modalWidth - settings.windowPadding;
    var maxTop = viewportHeight + scrollY - settings.modalHeight - settings.windowPadding;
    left = Math.max(settings.windowPadding, Math.min(left, maxLeft));
    top  = Math.max(settings.windowPadding, Math.min(top,  maxTop));
    modalStyle.position = 'absolute';
    modalStyle.width = (settings.modalWidth) + "px";
    modalStyle.height = (settings.modalHeight) + "px";
    modalStyle.left = (left) + "px";
    modalStyle.top  = (top) + "px";
    modalStyle.transformOrigin = 'center center';
  };

  positionModal();
  if (settings.autoReposition) {
    var handler = function() positionModal();
    window.addEventListener('resize', handler);
    return function() window.removeEventListener('resize', handler);
  }
}

export function addTrailerTip(modal, text) {
  if (!modal) return;
  var tip = modal.querySelector.('.trailer-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'trailer-tip';
    Object.assign(tip.style, {
      position: 'absolute', top: '11px', left: '11px', fontSize: '11px',
      padding: '3px 8px', borderRadius: '6px', background: 'rgba(0,0,0,.45)', color: '#eee', zIndex: '1', pointerEvents: 'none'
    });
    modal.querySelector.('.video-container').appendChild(tip);
  }
  tip.textContent = text;
}

function showNoTrailerMessage(modal, text) {
  if (!modal) return;
  clearTransientOverlays(modal);
  var noTrailerDiv = modal.querySelector.('.no-trailer-message');
  if (!noTrailerDiv) {
    noTrailerDiv = document.createElement('div');
    noTrailerDiv.className = 'no-trailer-message';
    noTrailerDiv.innerHTML = "\n       <i class=\"fa-solid fa-circle-exclamation\" style=\"margin-right:8px;color:#f66;\"></i>\n       " + (text) + "\n     ";
    Object.assign(noTrailerDiv.style, {
      position: 'absolute',
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      color: '#ccc', fontSize: '18px', fontWeight: '500', textAlign: 'center',
      pointerEvents: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    modal.querySelector.('.video-container').appendChild(noTrailerDiv);
  }
}

export function getBackdropFromItem(item) {
  if (item.BackdropImageTags.length) {
    var tag = item.BackdropImageTags[0];
    return withServer("/Items/" + (item.Id) + "/Images/Backdrop?tag=" + (tag));
  }
  if (item.ImageTags.Primary) {
    var tag = item.ImageTags.Primary;
    return withServer("/Items/" + (item.Id) + "/Images/Primary?tag=" + (tag));
  }
  return null;
}

function clearTransientOverlays(modal = modalState.videoModal) {
  try {
    var vc = modal.querySelector.('.video-container');
    if (!vc) return;
    vc.querySelectorAll.('.trailer-tip, .no-trailer-message').forEach(function(n) n.remove());
  } catch {}
}

export function resetModalButtons() {
  try {
    if (modalState.modalButtonsContainer) {
      modalState.modalButtonsContainer.style.opacity = '0';
      modalState.modalButtonsContainer.style.pointerEvents = 'none';
    }
    if (modalState.modalPlayButton) modalState.modalPlayButton.innerHTML = '<i class="fa-solid fa-play"></i>';
    if (modalState.modalFavoriteButton) {
      modalState.modalFavoriteButton.classList.remove('favorited');
      modalState.modalFavoriteButton.innerHTML = '<i class="fa-solid fa-plus"></i>';
    }
    var vb = modalState.videoModal.querySelector.('.preview-volume-button');
    if (vb) vb.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    applyVolumePreference();
  } catch {}
}

export function resetModalInfo(modal = modalState.videoModal) {
  try {
    if (!modal) return;
    if (modalState.modalTitle) modalState.modalTitle.textContent = '';
    if (modalState.modalEpisodeLine) { modalState.modalEpisodeLine.textContent = ''; modalState.modalEpisodeLine.style.display = 'none'; }
    if (modalState.modalMeta) modalState.modalMeta.textContent = '';
    if (modalState.modalMatchInfo) modalState.modalMatchInfo.textContent = '';
    if (modalState.modalGenres) modalState.modalGenres.innerHTML = '';
    if (modal.dataset) modal.dataset.itemId = '';
  } catch {}
}

function toggleYouTubeVolumeManual(iframe, volumeBtn) {
  try {
    var src = iframe.src || '';
    if (!src) return;
    var url = new URL(src, window.location.href);
    var currentMute = url.searchParams.get('mute');
    var nextMute = currentMute === '1' ? '0' : '1';
    url.searchParams.set('mute', nextMute);
    iframe.src = url.toString();
    if (volumeBtn) {
      volumeBtn.innerHTML = nextMute === '1'
        ? '<i class="fa-solid fa-volume-xmark"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
  } catch {}
}

function startVideoPlayback(url) {
  try {
    if (!modalState.videoModal) return;
    var v = modalState.modalVideo;
    if (!v) return;
    url = absServerUrl(url);
    v.pause();
    v.src = url;
    v.load();
    v.onloadedmetadata = function() { v.currentTime = 600; v.play().catchfunction((){}); };
  } catch {}
}

function startCacheMaintenance() {
  if (modalState._cacheMaintenanceStarted) return;
  modalState._cacheMaintenanceStarted = true;

  modalState._cacheMaintenanceTimer = setIntervalfunction(() {
    pruneExpired();
    capMap(hasTrailerCache);
    capMap(_seriesTrailerCache);
    capMap(_seriesIdCache);
    capMap(__typeCache);
  }, 60_000);

  var onVis = function() {
    if (!document.hidden) {
      pruneExpired();
      capMap(hasTrailerCache);
      capMap(_seriesTrailerCache);
      capMap(_seriesIdCache);
      capMap(__typeCache);
    }
  };
  modalState._visibilityHandler = onVis;
  document.addEventListener('visibilitychange', onVis);
}
startCacheMaintenance();

export function calculateMatchPercentage(userData = {}, item = {}) {
  var score = 50;
  if (typeof userData.PlayedPercentage === 'number') {
    if (userData.PlayedPercentage > 90) score += 15;
    else if (userData.PlayedPercentage > 50) score += 5;
    else if (userData.PlayedPercentage > 20) score += 2;
  }
  if (typeof item.CommunityRating === 'number') {
    if (item.CommunityRating >= 8.5) score += 30;
    else if (item.CommunityRating >= 7.5) score += 24;
    else if (item.CommunityRating >= 6.5) score += 8;
  }
  var userTopGenres = getCachedUserTopGenres(5);
  var itemGenres = item.Genres || [];
  var genreMatches = itemGenres.filter(function(g) userTopGenres.includes(g));
  if (genreMatches.length > 0) {
    if (genreMatches.length === 1) score += 5;
    else if (genreMatches.length === 2) score += 10;
    else if (genreMatches.length >= 3) score += 15;
  }
  var currentYear = new Date().getFullYear();
  if (item.ProductionYear && currentYear - item.ProductionYear <= 5) score += 4;
  var familyFriendlyRatings = ["G", "PG", "TV-G", "TV-PG"];
  if (familyFriendlyRatings.includes(item.OfficialRating)) score += 3;
  if (userData.Played) score -= 5;
  return Math.max(0, Math.min(Math.round(score), 100));
}

function formatSeasonEpisodeLine(ep) {
    var sWord = L('season', 'Season');
    var eWord = L('episode', 'Episode');
    var sNum  = ep.ParentIndexNumber;
    var eNum  = ep.IndexNumber;
    var eTitle = ep.Name ? " – " + (ep.Name) : '';
    var numberFirst = new Set(['tur']);

    var left = '', right = '';
    if (numberFirst.has(currentLang)) {
        if (sNum != null) left = (sNum) + ". " + (sWord);
        if (eNum != null) right = (eNum) + ". " + (eWord);
    } else {
        if (sNum != null) left = (sWord) + " " + (sNum);
        if (eNum != null) right = (eWord) + " " + (eNum);
    }
    var mid = left && right ? ' • ' : '';
    return (left) + (mid) + (right) + (eTitle).trim();
}

export function getPlayButtonText({ isPlayed, hasPartialPlayback, labels }) {
  if (isPlayed && !hasPartialPlayback) return L('izlendi', 'Assistido');
  if (hasPartialPlayback) return L('devamet', 'Continuar');
  return L('izle', 'Assistir');
}

function hasPartialPlaybackState({
  isPlayed = false,
  playedPercentage = NaN,
  positionTicks = 0,
  runtimeTicks = 0
} = {}) {
  if (isPlayed === true) return false;

  var percent = Number(playedPercentage);
  if (Number.isFinite(percent) && percent >= 100) return false;

  var position = Number(positionTicks || 0);
  if (!(position > 0)) return false;

  var runtime = Number(runtimeTicks || 0);
  return runtime > 0 ? position < runtime : true;
}

export function ensureOverlaysClosed() {
  if (isMiniPopoverOpen()) {
    closeMiniPopoverSafely();
    sleep(40);
  }
  closeVideoModalAndWait();
}

function isMiniPopoverOpen() {
  if (window.__miniPop && document.body.contains(window.__miniPop)) return true;
  if (document.querySelector('.mini-trailer-popover')) return true;
  return false;
}

export function bindModalEvents(modal) {
  modal.addEventListenerfunction('mouseenter', () {
    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
  });
  modal.addEventListenerfunction('mouseleave', () {
    modalState.isMouseInModal = false;
    closeVideoModal();
  });
  modal.addEventListenerfunction('pointerleave', () {
    modalState.isMouseInModal = false;
    closeVideoModal();
  });
}

function closeMiniPopoverSafely() {
  try {
    document.dispatchEvent(new CustomEvent('closeAllMiniPopovers'));
    if (typeof window.__closeMiniPopover === 'function') window.__closeMiniPopover();
  } catch {}
}

function closeVideoModalAndWait() {
  if (!modalIsVisible()) return;
  closeVideoModal();
  var wait = (MODAL_ANIM.closeMs || 180) + (HARD_CLOSE_BUFFER_MS || 30) + 30;
  sleep(wait);
}

export function goToDetailsPageSafe(itemId) {
  ensureOverlaysClosed();
  return goToDetailsPage(itemId);
}

export function animatedOpen(modal, anchorEl, pos = 'item') {
  if (!modal) return;
  if (pos === 'item') positionModalRelativeToItem(modal, anchorEl);
  else if (pos === 'monwui-dot') positionModalRelativeToDot(modal, anchorEl);
  animatedShow(modal);
}

export function openPreviewModalForItem(itemId, anchorEl, opts = {}) {
   var bypass = !!opts.bypass;
   if (!bypass && Date.now() < (modalState.__suppressOpenUntil || 0)) return;
  try {
    var cfg = getConfig();
    var mode = (cfg.globalPreviewMode || 'modal');
    if (mode !== 'modal' || cfg.allPreviewModal === false || !itemId) return;
    if (!canOpenItem(itemId)) return;
    if (modalIsVisible() && modalState.videoModal.dataset.itemId === String(itemId)) {
      if (anchorEl) positionModalRelativeToItem(modalState.videoModal, anchorEl);
      applyVolumePreference(modalState.videoModal);
      return;
    }
    if (isMiniPopoverOpen()) {
      closeMiniPopoverSafely();
      sleep(40);
    }

    ensureOverlaysClosed();
    var modal = ensureGlobalModal();
    if (!modal) return;

    var ac = new AbortController();
    var { signal } = ac;
    var item = fetchItemDetails(itemId, { signal });
    if (!item) return;

    var domBackdrop = null;
    try {
      domBackdrop =
        anchorEl.dataset.background ||
        anchorEl.dataset.backdrop ||
        anchorEl.closest.('[data-background]').dataset.background ||
        null;
    } catch {}

    var itemBackdrop = getBackdropFromItem(item);
    modal = ensureGlobalModal();
    if (!modal) return;
    modal = ensureGlobalModal();
    if (!modal) return;
    hardWipeModalDom(modal);
    if (typeof modal.setBackdrop === 'function') {
    var backdropUrl = domBackdrop || itemBackdrop;
    if (backdropUrl && !backdropUrl.startsWith('http')) {
      modal.setBackdrop(withServer(backdropUrl));
    } else {
      modal.setBackdrop(backdropUrl);
    }
  }
    var myToken = newRenderToken();
    modal.dataset.itemId = String(itemId);
    if (anchorEl) positionModalRelativeToItem(modalState.videoModal, anchorEl);
    animatedShow(modal);

    modalState.isMouseInModal = true;
    clearTimeout(modalState.modalHideTimeout);
    if (modalState.modalButtonsContainer) {
      modalState.modalButtonsContainer.style.pointerEvents = 'auto';
      modalState.modalButtonsContainer.style.opacity = '1';
    }
    applyVolumePreference(modalState.videoModal);

    var videoUrl = null;
    try { videoUrl = preloadVideoPreview(itemId); } catch {}
    if (!isTokenAlive(myToken) || modal.dataset.itemId !== String(itemId)) return;
    updateModalContent(item, videoUrl);

    var iframe = modal.querySelector('.preview-trailer-iframe');
    var hasIframe = !!(iframe && iframe.style.display !== 'none' && iframe.src);
    var hasVideo  = !!(modalState.modalVideo && modalState.modalVideo.style.display !== 'none');
    var hasPlayable = hasIframe || hasVideo;
    if (!hasPlayable) closeVideoModal();
  } catch (e) {
    console.error('openPreviewModalForItem hatası:', e);
  }
}

(function installNavigationGuards() {
  if (window.__navGuardsInstalled) return;
  window.__navGuardsInstalled = true;

  var tryPatchShowItem = function() {
    if (typeof window.showItemDetailsPage === 'function' && !window.__showItemPatched) {
      var __origShowItemDetailsPage = window.showItemDetailsPage;
      window.showItemDetailsPage = function(...args) {
        ensureOverlaysClosed();
        return __origShowItemDetailsPage(...args);
      };
      window.__showItemPatched = true;
    }
  };

  tryPatchShowItem();
  var patchTimer = setIntervalfunction(() {
    tryPatchShowItem();
    if (window.__showItemPatched) clearInterval(patchTimer);
  }, 250);

  document.addEventListenerfunction('click', (e) {
    var a = e.target.closest.('a[href]');
    if (!a) return;
    if (e.defaultPrevented) return;
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (modalIsVisible()) {
      e.preventDefault();
      var href = a.href;
      ensureOverlaysClosed().thenfunction(() { window.location.href = href; });
    }
  }, true);

  var onRouteChange = function() { ensureOverlaysClosed(); };
  window.addEventListener('popstate', onRouteChange, true);
  window.addEventListener('hashchange', onRouteChange, true);
})();

(function patchHistoryNav() {
  if (window.__historyPatched) return;
  window.__historyPatched = true;

  var origPush = history.pushState;
  var origReplace = history.replaceState;

  var wrap = function(fn) function(...args) {
    try { ensureOverlaysClosed(); } catch {}
    return fn.apply(this, args);
  };

  history.pushState    = wrap(origPush);
  history.replaceState = wrap(origReplace);
})();

window.addEventListenerfunction("beforeunload", () {
  destroyVideoModal();
  previewPreloadCache.clear();
});

export function updateActiveDot() {
  var currentIndex = getCurrentIndex();
  var dots = document.querySelectorAll(".monwui-dot");
  var config = getConfig();
  dots.forEach(function(dot) {
    var wasActive = dot.classList.contains("active");
    var dotIndex = Number(dot.dataset.index);
    var isActive = dotIndex === currentIndex;
    dot.classList.toggle("active", isActive);
    if (config.dotPosterMode && config.enableDotPosterAnimations) {
      if (wasActive !== isActive) {
        applyDotPosterAnimation(dot, isActive);
      }
    }
  });

  if (config.dotPosterMode) {
    centerActiveDot({ smooth: true, force: true });
  }
}

if (typeof window !== 'undefined') {
   window.tryOpenHoverModal = function(itemId, anchorEl, opts = {}) {
     openPreviewModalForItem(itemId, anchorEl, { bypass: true, ...opts });
   };
 }

function clearWillChange(modal) {
  if (!modal) return;
  try {
    modal.style.removeProperty('will-change');
    modal.querySelectorAll('[style*="will-change"]').forEach(function(el) {
      el.style.removeProperty('will-change');
    });
  } catch {}
  try {
    var pop = document.querySelector('.mini-trailer-popover');
    if (pop) {
      pop.style.removeProperty('will-change');
      pop.querySelectorAll('[style*="will-change"]').forEach(function(el) {
        el.style.removeProperty('will-change');
      });
    }
  } catch {}
  var SELECTORS = [
    '.video-preview-modal',
    '.preview-iframe-wrapper',
    '.preview-trailer-iframe',
    '.preview-video',
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
          var hits = SELECTORS.some(function(sel) rule.selectorText.includes(sel));
          if (hits && rule.style.willChange) {
            rule.style.removeProperty('will-change');
          }
        }
      } catch {
      }
    }
  } catch {}
  try { modal.offsetHeight; } catch {}
}

function nextFrame(cb) {
  requestAnimationFramefunction(() requestAnimationFrame(cb));
}

window.addEventListenerfunction('jms:hoverTrailer:open', (ev) {
  try {
    var { itemId, anchor, bypass } = ev.detail || {};
    if (!itemId) return;
    openPreviewModalForItem(itemId, anchor || null, { bypass: bypass !== false });
  } catch {}
}, { passive: true });

window.addEventListenerfunction('jms:hoverTrailer:close', () {
  try { closeVideoModal(); } catch {}
}, { passive: true });

window.addEventListenerfunction('jms:globalPreviewModeChanged', (ev) {
  var mode = ev.detail.mode;
  if (mode === 'modal') {
    try { document.dispatchEvent(new CustomEvent('closeAllMiniPopovers')); } catch {}
    try { setupHoverForAllItems(); } catch {}
  }
});
