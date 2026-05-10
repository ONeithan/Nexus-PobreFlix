import { stopSlideTimer, startSlideTimer, SLIDE_DURATION, clearAllTimers } from "./timer.js";
import { resetProgressBar, updateProgressBarPosition, useSecondsMode } from "./progressBar.js";
import { getConfig, getDeviceProfileAuto } from './config.js';
import { getLanguageLabels, getDefaultLanguage } from '../language/index.js';
import { getCurrentIndex, setCurrentIndex, setRemainingTime } from "./sliderState.js";
import { applyContainerStyles } from "./positionUtils.js";
import { playNow, fetchItemDetails, getCachedUserTopGenres, getGenresForDot, goToDetailsPage } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { applySlideAnimation, applyDotPosterAnimation, teardownAnimations, forceReflow, nextAnimToken, hardCleanupSlide } from "./animations.js";
import { getVideoQualityText } from "./containerUtils.js";
import { previewPreloadCache } from "./hoverTrailerModal.js";
import { attachMiniPosterHover, openMiniPopoverFor } from "./studioHubsUtils.js";
import { modalState, set, get, resetModalRefs } from './modalState.js';
import { createVideoModal, destroyVideoModal, animatedShow, closeVideoModal, modalIsVisible, preloadVideoPreview, updateModalContent, positionModalRelativeToItem, applyVolumePreference, ensureOverlaysClosed, getBackdropFromItem, calculateMatchPercentage, openPreviewModalForItem, setModalAnimation, getPlayButtonText, PREVIEW_MAX_ENTRIES, startModalHideTimer, getClosingRemaining, bindModalEvents, hardStopPlayback, resetModalInfo, resetModalButtons, scheduleOpenForItem } from './hoverTrailerModal.js';
import { withServer } from "./jfUrl.js";

var IS_TOUCH = (typeof window !== 'undefined') && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
var config = getConfig();
var currentLang = config.defaultLanguage || getDefaultLanguage();
if (!config.languageLabels) {
  config.languageLabels = getLanguageLabels(currentLang) || {};
}

var __peakViewportObserver = null;
var __peakObservedContainer = null;
var __peakObserveMO = null;
var __peakRefreshTimer = 0;
var __peakRefreshRaf = 0;
var __peakLiteContainer = null;
var __peakLiteEnabled = false;
var __peakStructureSyncTimer = 0;
var __peakStructureSyncRaf = 0;

function getPeakShiftDurationMs() {
  return isLowPowerPeakRuntime() ? 220 : 320;
}

function getPeakShiftEasing() {
  return 'cubic-bezier(.23,.78,.32,1)';
}

function isPlaybackCompletedState({
  isPlayed = false,
  playedPercentage = NaN,
  positionTicks = 0,
  runtimeTicks = 0
} = {}) {
  if (isPlayed === true) return true;

  var percent = Number(playedPercentage);
  if (Number.isFinite(percent) && percent >= 100) return true;

  var position = Number(positionTicks || 0);
  var runtime = Number(runtimeTicks || 0);
  return position > 0 && runtime > 0 && position >= runtime;
}

function hasPartialPlaybackState({
  isPlayed = false,
  playedPercentage = NaN,
  positionTicks = 0,
  runtimeTicks = 0
} = {}) {
  if (isPlaybackCompletedState({ isPlayed, playedPercentage, positionTicks, runtimeTicks })) return false;

  var position = Number(positionTicks || 0);
  if (!(position > 0)) return false;

  var runtime = Number(runtimeTicks || 0);
  return runtime > 0 ? position < runtime : true;
}

if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) {
  closeVideoModal();
}

function ensureFlickerFixCSS() {
  if (document.getElementById('android-flicker-fix')) return;
  var st = document.createElement('style');
  st.id = 'android-flicker-fix';
  st.textContent = "\n    #monwui-slides-container.peak-mode .monwui-slide {\n      will-change: transform, opacity;\n      backface-visibility: hidden;\n    }\n    .monwui-slide.is-hidden {\n      visibility: hidden !important;\n      pointer-events: none !important;\n    }\n    #monwui-slides-container.peak-first-reveal {\n      opacity: 0 !important;\n    }\n    #monwui-slides-container.peak-first-reveal.peak-first-reveal-active {\n      opacity: 1 !important;\n      transition: opacity .22s cubic-bezier(.2,.6,.2,1) !important;\n    }\n    .monwui-slide.is-visible {\n      visibility: visible !important;\n      pointer-events: auto !important;\n    }\n    .monwui-slide.peak-batch-pending,\n    .monwui-slide.peak-batch-pending * {\n      animation: none !important;\n      transition: none !important;\n    }\n    .monwui-slide.peak-batch-pending {\n      opacity: 0 !important;\n      pointer-events: none !important;\n      visibility: hidden !important;\n    }\n    #monwui-slides-container.peak-shifting .monwui-slide {\n      transition:\n        transform var(--peak-shift-ms, 320ms) var(--peak-shift-ease, cubic-bezier(.23,.78,.32,1)),\n        opacity var(--peak-shift-opacity-ms, 220ms) ease-out !important;\n      will-change: transform, opacity !important;\n    }\n    #monwui-slides-container.peak-shifting .monwui-slide,\n    #monwui-slides-container.peak-shifting .monwui-slide.active {\n      box-shadow: none !important;\n    }\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-backdrop {\n      transition: opacity var(--peak-shift-opacity-ms, 220ms) ease-out !important;\n      will-change: opacity !important;\n    }\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-button-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-button-container *,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-director-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-horizontal-gradient-overlay,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-horizontal-gradient-overlay:before,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-horizontal-gradient-overlay:after,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-info-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-language-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-logo-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-logo-container .logo-img,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-main-button-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-meta-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-meta-container *,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-plot-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-plot-container *,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-provider-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-provider-container *,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-slider-wrapper,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-status-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-status-container *,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-title-container,\n    #monwui-slides-container.peak-shifting .monwui-slide .monwui-title-container * {\n      animation: none !important;\n      transition: none !important;\n      will-change: auto !important;\n    }\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) {\n      box-shadow: none !important;\n      outline: none !important;\n    }\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-button-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-director-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-info-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-language-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-logo-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-main-button-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-meta-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-plot-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-provider-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-slider-wrapper,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-status-container,\n    html[data-css-variant=showcase] #monwui-slides-container.peak-mode .monwui-slide.active:not(.backdrop-ready) .monwui-title-container {\n      opacity: 0 !important;\n      pointer-events: none !important;\n      transform: translateY(4px) !important;\n      visibility: hidden !important;\n    }\n    #monwui-slides-container.peak-ready .monwui-slide.peak-snap-in,\n    #monwui-slides-container.peak-ready .monwui-slide.peak-snap-in * {\n      transition: none !important;\n      animation: none !important;\n    }\n	    #monwui-slides-container.peak-ready .monwui-slide.off-left,\n	    #monwui-slides-container.peak-ready .monwui-slide.off-right {\n	      visibility: hidden !important;\n	      pointer-events: none !important;\n	      content-visibility: hidden !important;\n	      contain: strict !important;\n	    }\n	    html[data-css-variant=showcase] #monwui-slides-container.peak-ready .monwui-slide.off-left {\n	      transform: translate3d(calc(-50% - 220vw), -50%, 0) scale(.82) !important;\n	    }\n	    html[data-css-variant=showcase] #monwui-slides-container.peak-ready .monwui-slide.off-right {\n	      transform: translate3d(calc(-50% + 220vw), -50%, 0) scale(.82) !important;\n	    }\n	  ";
  document.head.appendChild(st);
}

function isLowPowerPeakRuntime() {
  try {
    var ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    var uaMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    var coarse = window.matchMedia.('(pointer: coarse)').matches === true;
    var anyCoarse = window.matchMedia.('(any-pointer: coarse)').matches === true;
    var fine = window.matchMedia.('(pointer: fine)').matches === true;
    var shortestSide = Math.min(
      window.innerWidth || window.screen.width || 0,
      window.innerHeight || window.screen.height || 0
    );
    var autoMobileProfile = getDeviceProfileAuto() === 'mobile';
    var touchOnlyLikeMobile = (coarse || anyCoarse || IS_TOUCH) && !fine;

    // Touch-enabled desktop/laptop devices can expose maxTouchPoints > 0 even when
    // they should still use the desktop peak layout. Gate low-power mode behind the
    // mobile profile heuristic so diagonal neighbor counts are not collapsed to 1/1.
    return autoMobileProfile && (
      !!window.ReactNativeWebView ||
      uaMobile ||
      touchOnlyLikeMobile ||
      (shortestSide > 0 && shortestSide <= 1280)
    );
  } catch {
    return false;
  }
}

function injectPeakLiteCSS() {
  if (document.getElementById('peak-mobile-lite-css')) return;
  var st = document.createElement('style');
  st.id = 'peak-mobile-lite-css';
  st.textContent = "\n    html.jms-peak-lite,\n    body.jms-peak-lite {\n      scroll-behavior: auto !important;\n    }\n    html.jms-peak-lite #homePage,\n    html.jms-peak-lite #indexPage,\n    html.jms-peak-lite .homeSectionsContainer {\n      scroll-snap-type: none !important;\n    }\n    #monwui-slides-container.peak-lite {\n      contain: none !important;\n      will-change: auto !important;\n      overflow: visible !important;\n    }\n    #monwui-slides-container.peak-lite .monwui-slide,\n    #monwui-slides-container.peak-lite .monwui-slide .monwui-backdrop {\n      contain: none !important;\n      contain-intrinsic-size: auto !important;\n      content-visibility: visible !important;\n      will-change: auto !important;\n      backface-visibility: hidden !important;\n      -webkit-backface-visibility: hidden !important;\n    }\n    #monwui-slides-container.peak-lite .monwui-slide {\n      transition: none !important;\n      animation: none !important;\n      box-shadow: none !important;\n      outline: none !important;\n    }\n    #monwui-slides-container.peak-lite .monwui-slide.active {\n      box-shadow: 0 10px 18px -12px rgba(28,39,64,.9) !important;\n    }\n    #monwui-slides-container.peak-lite .monwui-backdrop,\n    #monwui-slides-container.peak-lite .monwui-horizontal-gradient-overlay,\n    #monwui-slides-container.peak-lite .monwui-button-container,\n    #monwui-slides-container.peak-lite .monwui-info-container,\n    #monwui-slides-container.peak-lite .monwui-language-container,\n    #monwui-slides-container.peak-lite .monwui-meta-container,\n    #monwui-slides-container.peak-lite .monwui-plot-container,\n    #monwui-slides-container.peak-lite .monwui-provider-container,\n    #monwui-slides-container.peak-lite .monwui-status-container,\n    #monwui-slides-container.peak-lite .monwui-title-container {\n      backdrop-filter: none !important;\n      filter: none !important;\n      box-shadow: none !important;\n    }\n    #monwui-slides-container.peak-lite .monwui-backdrop,\n    #monwui-slides-container.peak-lite .monwui-horizontal-gradient-overlay {\n      transition: none !important;\n      animation: none !important;\n    }\n    #monwui-slides-container.peak-lite .monwui-slide.active,\n    #monwui-slides-container.peak-lite .monwui-slide.active .monwui-backdrop {\n      opacity: 1 !important;\n      visibility: visible !important;\n    }\n    #monwui-slides-container.peak-lite .monwui-slide.active img.monwui-backdrop {\n      left: 0 !important;\n      right: 0 !important;\n      width: 100% !important;\n      transform: none !important;\n      object-position: 50% 50% !important;\n    }\n  ";
  document.head.appendChild(st);
}

function syncPeakLiteMode(container = document.querySelector('#monwui-slides-container')) {
  injectPeakLiteCSS();
  var enabled = !!container && container.classList.contains('peak-mode') && isLowPowerPeakRuntime();

  if (__peakLiteEnabled !== enabled) {
    try { document.documentElement.classList.toggle('jms-peak-lite', enabled); } catch {}
    try { document.body.classList.toggle('jms-peak-lite', enabled); } catch {}
    __peakLiteEnabled = enabled;
  }

  if (__peakLiteContainer && __peakLiteContainer !== container) {
    __peakLiteContainer.classList.remove('peak-lite');
  }
  if (container && container.classList.contains('peak-lite') !== enabled) {
    container.classList.toggle('peak-lite', enabled);
  }
  __peakLiteContainer = enabled ? container : null;

  return enabled;
}

export function getPeakDisplayOptions() {
  var cfg = getConfig();
  if (isLowPowerPeakRuntime()) {
    return {
      spanLeft: 1,
      spanRight: 1,
      diagonal: !!cfg.peakDiagonal
    };
  }
  var spanLeft = Number(cfg.peakSpanLeft || 1);
  var spanRight = Number(cfg.peakSpanRight || 5);
  var diagonal = !!cfg.peakDiagonal;
  if (!diagonal) {
    spanLeft = 1;
    spanRight = 1;
  }
  return { spanLeft, spanRight, diagonal };
}

function getPeakActiveIndex(slides) {
  var arr = Array.from(slides || []);
  if (!arr.length) return 0;

  var stateIndex = Number(getCurrentIndex());
  if (Number.isInteger(stateIndex) && stateIndex >= 0 && stateIndex < arr.length) {
    return stateIndex;
  }

  var domIndex = arr.findIndexfunction((slide) slide.classList.contains('active'));
  return domIndex >= 0 ? domIndex : 0;
}

function getPeakViewportContainer(root = document) {
  return root.querySelector.("#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container") || null;
}

function resolveSlidesArray(slides) {
  return Array.isArray(slides) ? slides : Array.from(slides || []);
}

var LEGACY_PEAK_POS_CLASS_RE = /\b(?:left|right)\d+\b/;

function removeLegacyPeakPosClasses(slide) {
  var className = slide.className;
  if (typeof className !== 'string' || !LEGACY_PEAK_POS_CLASS_RE.test(className)) return;
  Array.from(slide.classList).forEach(function((name) {
    if (/^(left|right)\d+$/.test(name)) slide.classList.remove(name);
  });
}

function normalizePeakOptions(spanOrOpts = 2) {
  var base = (typeof spanOrOpts === 'object')
    ? { spanLeft: 2, spanRight: 2, diagonal: false, ...spanOrOpts }
    : { spanLeft: spanOrOpts, spanRight: spanOrOpts, diagonal: false };

  return {
    spanLeft: Math.max(0, Number(base.spanLeft) || 0),
    spanRight: Math.max(0, Number(base.spanRight) || 0),
    diagonal: !!base.diagonal
  };
}

function buildPeakVisibleIndexSet(len, activeIndex, spanLeft, spanRight) {
  var visible = new Set();
  if (!len) return visible;
  visible.add(activeIndex);
  for (var step = 1; step <= spanLeft; step++) visible.add((activeIndex - step + len) % len);
  for (var step = 1; step <= spanRight; step++) visible.add((activeIndex + step) % len);
  return visible;
}

function getPeakSlideState(index, activeIndex, len, spanLeft, spanRight) {
  var d = circSignedDist(index, activeIndex, len);
  if (d === 0) {
    return {
      active: true,
      neighbor: false,
      offLeft: false,
      offRight: false,
      side: '',
      k: '',
      visible: true
    };
  }
  if (d < 0 && -d <= spanLeft) {
    return {
      active: false,
      neighbor: true,
      offLeft: false,
      offRight: false,
      side: 'left',
      k: String(Math.min(-d, spanLeft)),
      visible: true
    };
  }
  if (d > 0 && d <= spanRight) {
    return {
      active: false,
      neighbor: true,
      offLeft: false,
      offRight: false,
      side: 'right',
      k: String(Math.min(d, spanRight)),
      visible: true
    };
  }
  return {
    active: false,
    neighbor: false,
    offLeft: d < 0,
    offRight: d > 0,
    side: '',
    k: '',
    visible: false
  };
}

function applyPeakSlideState(slide, nextState) {
  if (!slide) return;
  var prev = slide.__peakState || {};
  var enteringVisible = !prev.visible && !!nextState.visible;
  removeLegacyPeakPosClasses(slide);

  if (enteringVisible) {
    if (slide.__peakSnapRafA) cancelAnimationFrame(slide.__peakSnapRafA);
    if (slide.__peakSnapRafB) cancelAnimationFrame(slide.__peakSnapRafB);
    slide.__peakSnapRafA = 0;
    slide.__peakSnapRafB = 0;
    slide.classList.add('peak-snap-in');
  }

  if (prev.visible !== nextState.visible && !nextState.visible) {
    hideSlide(slide, { soft: true });
  }
  if (!!prev.active !== !!nextState.active) {
    slide.classList.toggle('active', !!nextState.active);
  }
  if (!!prev.neighbor !== !!nextState.neighbor) {
    slide.classList.toggle('peak-neighbor', !!nextState.neighbor);
  }
  if (!!prev.offLeft !== !!nextState.offLeft) {
    slide.classList.toggle('off-left', !!nextState.offLeft);
  }
  if (!!prev.offRight !== !!nextState.offRight) {
    slide.classList.toggle('off-right', !!nextState.offRight);
  }
  if ((prev.side || '') !== nextState.side) {
    if (nextState.side) slide.dataset.side = nextState.side;
    else slide.removeAttribute('data-side');
  }
  if ((prev.k || '') !== nextState.k) {
    if (nextState.k) slide.style.setProperty('--k', nextState.k);
    else slide.style.removeProperty('--k');
  }

  if (prev.visible !== nextState.visible && nextState.visible) {
    showSlide(slide);
  }

  syncPeakBackdropForState(slide, prev, nextState);
  slide.__peakState = nextState;

  if (enteringVisible) {
    slide.__peakSnapRafA = requestAnimationFramefunction(() {
      slide.__peakSnapRafA = 0;
      slide.__peakSnapRafB = requestAnimationFramefunction(() {
        slide.__peakSnapRafB = 0;
        slide.classList.remove('peak-snap-in');
      });
    });
  }
}

function rebuildPeakState(arr, activeIndex, opts) {
  var { spanLeft, spanRight } = opts;
  var len = arr.length;
  for (var i = 0; i < len; i++) {
    applyPeakSlideState(arr[i], getPeakSlideState(i, activeIndex, len, spanLeft, spanRight));
  }
  return buildPeakVisibleIndexSet(len, activeIndex, spanLeft, spanRight);
}

function applyPeakContainerState(container, diagonal) {
  if (!container) return;
  container.classList.toggle('peak-diagonal', !!diagonal);
  ensurePeakVars(container);
  syncPeakLiteMode(container);
}

function isPeakViewportMutationNode(node) {
  if (!(node instanceof Element)) return false;
  if (node.id === 'monwui-slides-container' || node.id === 'indexPage' || node.id === 'homePage') return true;
  return !!node.querySelector.('#monwui-slides-container, #indexPage, #homePage');
}

function mutationTouchesPeakViewport(mutations) {
  return mutations.somefunction((mutation) (
    isPeakViewportMutationNode(mutation.target) ||
    Array.from(mutation.addedNodes || []).some(isPeakViewportMutationNode) ||
    Array.from(mutation.removedNodes || []).some(isPeakViewportMutationNode)
  ));
}

function isElementInViewport(el) {
  if (!el.getBoundingClientRect) return false;
  var rect = el.getBoundingClientRect();
  var vw = window.innerWidth || document.documentElement.clientWidth || 0;
  var vh = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
}

function promotePeakBackdrop(activeSlide) {
  var backdrop = activeSlide.__backdropImg || activeSlide.querySelector.('.monwui-backdrop');
  if (!backdrop) return;

  try { backdrop.style.opacity = '1'; } catch {}
  try { backdrop.style.visibility = 'visible'; } catch {}
  backdrop.__requestHi.({ eagerLoad: true, fetchPriority: 'high' });
}

function syncPeakBackdropForState(slide, prevState, nextState) {
  var backdrop = slide.__backdropImg || slide.querySelector.('.monwui-backdrop');
  if (!backdrop) return;
  backdrop.__clearPeakHiTimer.();

  if (!nextState.visible) {
    backdrop.__requestLq.();
    return;
  }

  if (nextState.active) {
    promotePeakBackdrop(slide);
    return;
  }

  try { backdrop.removeAttribute('fetchpriority'); } catch {}
  var wasVisibleNeighbor = !!prevState.visible && !!prevState.neighbor;
  var step = Math.max(1, Number(nextState.k) || 1);
  var delay = wasVisibleNeighbor ? 0 : Math.min(160, 35 + (step - 1) * 55);
  if (delay <= 0) {
    backdrop.__requestHi.({ fetchPriority: 'low' });
    return;
  }
  backdrop.__peakHiTimer = setTimeoutfunction(() {
    backdrop.__peakHiTimer = 0;
    if (!backdrop.isConnected) return;
    if (!slide.classList.contains('active') && !slide.classList.contains('peak-neighbor')) return;
    backdrop.__requestHi.({ fetchPriority: 'low' });
  }, delay);
}

function refreshPeakViewport({ forcePrime = false } = {}) {
  var container = getPeakViewportContainer();
  if (!container || !container.classList.contains('peak-mode')) {
    syncPeakLiteMode(null);
    return;
  }

  var lite = syncPeakLiteMode(container);
  if (!lite && !forcePrime) return;
  if (!isElementInViewport(container)) return;

  var slides = container.querySelectorAll('.monwui-slide');
  if (!slides.length) return;

  var activeIndex = getPeakActiveIndex(slides);
  var activeSlide = slides[activeIndex];
  if (activeSlide) {
    showSlide(activeSlide);
    activeSlide.classList.add('active');
    promotePeakBackdrop(activeSlide);
  }

  var peakOpts = getPeakDisplayOptions();
  if (!container.classList.contains('peak-ready')) {
    try { delete container.dataset.peakPrimed; } catch {}
    primePeakFirstPaint(slides, activeIndex, container, peakOpts);
    return;
  }

  updatePeakClasses(slides, activeIndex, peakOpts);
  if (modalState.progressBarEl && !useSecondsMode()) {
    updateProgressBarPosition();
  }
}

function schedulePeakViewportRefresh({ forcePrime = false } = {}) {
  if (__peakRefreshTimer) clearTimeout(__peakRefreshTimer);
  if (__peakRefreshRaf) cancelAnimationFrame(__peakRefreshRaf);

  __peakRefreshTimer = setTimeoutfunction(() {
    __peakRefreshTimer = 0;
    __peakRefreshRaf = requestAnimationFramefunction(() {
      __peakRefreshRaf = 0;
      refreshPeakViewport({ forcePrime });
    });
  }, forcePrime ? 40 : 18);
}

function bindPeakViewportObserver() {
  var container = getPeakViewportContainer();
  if (container === __peakObservedContainer) {
    syncPeakLiteMode(container);
    return;
  }

  if (!__peakViewportObserver) {
    __peakViewportObserver = new IntersectionObserverfunction((entries) {
      for (var entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.15) {
          schedulePeakViewportRefresh({ forcePrime: false });
        }
      }
    }, { threshold: [0, 0.15, 0.35, 0.6] });
  }

  __peakViewportObserver.disconnect();
  __peakObservedContainer = container;
  if (container) {
    __peakViewportObserver.observe(container);
    syncPeakLiteMode(container);
  } else {
    syncPeakLiteMode(null);
  }
}

function ensurePeakViewportStability() {
  if (window.__peakViewportStabilityBound) {
    bindPeakViewportObserver();
    return;
  }
  window.__peakViewportStabilityBound = true;

  bindPeakViewportObserver();
  window.addEventListenerfunction('pageshow', () schedulePeakViewportRefresh({ forcePrime: true }), { passive: true });
  window.addEventListenerfunction('orientationchange', () schedulePeakViewportRefresh({ forcePrime: true }), { passive: true });
  document.addEventListenerfunction('visibilitychange', () {
    if (!document.hidden) schedulePeakViewportRefresh({ forcePrime: true });
  }, { passive: true });

  __peakObserveMO = new MutationObserverfunction((mutations) {
    if (mutationTouchesPeakViewport(mutations)) bindPeakViewportObserver();
  });
  __peakObserveMO.observe(document.documentElement, { childList: true, subtree: true });
}

function armPeakShiftLite(container) {
  if (!container) return;
  var duration = getPeakShiftDurationMs();
  var opacityDuration = Math.max(180, Math.round(duration * 0.82));
  container.style.setProperty('--peak-shift-ms', (duration) + "ms");
  container.style.setProperty('--peak-shift-opacity-ms', (opacityDuration) + "ms");
  container.style.setProperty('--peak-shift-ease', getPeakShiftEasing());
  container.classList.add('peak-shifting');

  if (container.__peakShiftTimer) {
    clearTimeout(container.__peakShiftTimer);
  }
  container.__peakShiftTimer = setTimeoutfunction(() {
    container.__peakShiftTimer = 0;
    if (!container.isConnected) return;
    container.classList.remove('peak-shifting');
  }, duration + 34);
}

function showSlide(el) {
  if (!el) return;
  el.classList.add('is-visible');
  el.classList.remove('is-hidden');
  if (el.style.display) el.style.removeProperty('display');
}

function releasePeakPending(slide) {
  if (!slide) return;
  if (typeof slide.__releasePeakReveal === 'function') {
    slide.__releasePeakReveal();
    return;
  }
  slide.classList.remove('peak-batch-pending');
}

function armPeakInitialReveal(container) {
  if (!container || container.dataset.peakInitialRevealDone === '1') return;
  container.dataset.peakInitialRevealDone = '1';

  var prefersReduced = window.matchMedia.('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;

  if (container.__peakInitialRevealTimer) {
    clearTimeout(container.__peakInitialRevealTimer);
    container.__peakInitialRevealTimer = 0;
  }

  container.classList.add('peak-first-reveal');
  container.classList.remove('peak-first-reveal-active');

  requestAnimationFramefunction(() {
    requestAnimationFramefunction(() {
      if (!container.isConnected) return;
      container.classList.add('peak-first-reveal-active');
    });
  });

  container.__peakInitialRevealTimer = setTimeoutfunction(() {
    container.__peakInitialRevealTimer = 0;
    if (!container.isConnected) return;
    container.classList.remove('peak-first-reveal');
    container.classList.remove('peak-first-reveal-active');
  }, 320);
}

function hideSlide(el, { soft = true } = {}) {
  if (!el) return;
  el.classList.remove('is-visible');
  el.classList.add('is-hidden');
  if (!soft) {
    setTimeoutfunction(() {
      if (!el.classList.contains('active')) el.style.display = 'none';
    }, 50);
  }
}

function scrollContainerToSlide(index, { smooth = true } = {}) {
  var container = document.querySelector("#monwui-slides-container");
  if (!container) return;
  var slides = container.querySelectorAll(".monwui-slide");
  var target = slides.[index];
  if (!target) return;

  var left = target.offsetLeft - (container.clientWidth - target.clientWidth) / 2;
  container.scrollTo({
    left: Math.max(0, left),
    behavior: smooth ? "smooth" : "auto",
  });
}

function L(key, fallback = '') {
  try { return (getConfig().languageLabels.[key]) || fallback; }
  catch { return fallback; }
}
function sleep(ms) { return new Promise(function(res) setTimeout(res, ms)); }
function hardResetProgressBarEl() {
  var pb = document.querySelector(".monwui-slide-progress-bar");
  if (!pb) return;
  pb.style.transition = "none";
  pb.style.animation  = "none";
  pb.style.width      = "0%";
  void pb.offsetWidth;
  pb.style.transition = "";
  pb.style.animation  = "";
}

function microFadeSwap(
  oldSlide,
  newSlide,
  durMs = Math.min(300, Math.max(120, (getConfig().slideAnimationDuration || 280)))
) {
  if (!newSlide) return;

  var prefersReduced = window.matchMedia.('(prefers-reduced-motion: reduce)').matches;
  var D = prefersReduced ? 0 : durMs;

  if (newSlide.dataset.fx === 'running') return;
  newSlide.dataset.fx = 'running';
  if (oldSlide) oldSlide.dataset.fxPrev = 'running';

  var killTransitions = function(el) {
    el.style.transition = 'none';
    el.style.willChange = 'auto';
  };
  var flush = function() { void document.body.offsetWidth; };

  showSlide(newSlide);
  newSlide.style.opacity = '0';
  newSlide.style.zIndex = '2';
  newSlide.style.willChange = 'opacity';
  killTransitions(newSlide);

  if (oldSlide && oldSlide !== newSlide) {
    showSlide(oldSlide);
    oldSlide.style.opacity = '1';
    oldSlide.style.zIndex = '1';
    oldSlide.style.pointerEvents = 'none';
    oldSlide.style.willChange = 'opacity';
    killTransitions(oldSlide);
  }

  flush(); flush();

  var cleanup = function() {
    newSlide.style.transition = '';
    newSlide.style.willChange = '';
    newSlide.style.zIndex = '';
    delete newSlide.dataset.fx;

    if (oldSlide && oldSlide !== newSlide) {
      hideSlide(oldSlide, { soft: true });
      oldSlide.style.transition = '';
      oldSlide.style.transform = '';
      oldSlide.style.willChange = '';
      oldSlide.style.pointerEvents = '';
      oldSlide.style.zIndex = '';
      oldSlide.style.opacity = '0';
      setTimeoutfunction(() {
        if (!oldSlide.classList.contains('active')) oldSlide.style.display = 'none';
      }, 60);
      delete oldSlide.dataset.fxPrev;
    }
  };

  if (D === 0) {
    newSlide.style.opacity = '1';
    if (oldSlide && oldSlide !== newSlide) oldSlide.style.opacity = '0';
    cleanup();
    return;
  }

  newSlide.style.transition = "opacity " + (D) + "ms ease";
  if (oldSlide && oldSlide !== newSlide) {
    oldSlide.style.transition = "opacity " + (D) + "ms ease";
  }

  requestAnimationFramefunction(() {
    newSlide.style.opacity = '1';
    if (oldSlide && oldSlide !== newSlide) {
      oldSlide.style.opacity = '0';
    }
  });

  var done = false;
  var onEnd = function() {
    if (done) return;
    done = true;
    newSlide.removeEventListener('transitionend', onEnd);
    cleanup();
  };

  newSlide.addEventListener('transitionend', onEnd, { once: true });
  setTimeout(onEnd, D + 100);
}


function getBackdropFromDot(dot) {
  var img = dot.querySelector.('.monwui-dot-poster-image');
  if (img.src) return img.src;
  var slideEl = document.querySelector(".monwui-slide[data-item-id=\"" + (dot.dataset.itemId) + "\"]");
  if (slideEl) {
    return slideEl.dataset.background || slideEl.dataset.backdrop || slideEl.dataset.primaryimage || null;
  }
  return null;
}

function enterPeakScrollMode() {
  var sc = document.querySelector("#monwui-slides-container");
  if (!sc) return;
  sc.classList.add("peak-scroll");
  sc.querySelectorAll(".monwui-slide").forEach(function(slide) {
    slide.removeAttribute("data-side");
    slide.removeAttribute("data-prime-pos");
  });
}

export function changeSlide(direction) {
  var slides = getPeakViewportContainer().querySelectorAll(".monwui-slide") || document.querySelectorAll(".monwui-slide");
  if (!slides.length) return;

  clearAllTimers();
  stopSlideTimer();
  var currentIndex = getCurrentIndex();
  var newIndex = (currentIndex + direction + slides.length) % slides.length;
  setCurrentIndex(newIndex);
  var sc = document.querySelector("#monwui-slides-container");
  if (sc && sc.classList.contains("peak-scroll")) {
    scrollContainerToSlide(newIndex, { smooth: true });
  }
  displaySlide(newIndex);
  hardResetProgressBarEl();
  resetProgressBar();
  setRemainingTime(SLIDE_DURATION);
  startSlideTimer();
}

function clearManagedDotStateClasses(dot) {
  if (!dot) return;

  dot.classList.remove(
    "active",
    "monwui-dot-prev",
    "monwui-dot-next",
    "monwui-dot-hidden",
    "monwui-dot-hidden-prev",
    "monwui-dot-hidden-next"
  );

  Array.from(dot.classList).forEach(function((className) {
    if (/^monwui-dot-(prev|next)-\d+$/.test(className)) {
      dot.classList.remove(className);
    }
  });

  delete dot.dataset.dotState;
  delete dot.dataset.dotDirection;
  delete dot.dataset.dotDistance;
}

function getDotWindowBounds(totalDots, currentIndex, rawVisibleCount) {
  if (!Number.isFinite(totalDots) || totalDots <= 0) {
    return { start: 0, end: -1, visibleCount: 0 };
  }

  var requestedVisibleCount = Number.parseInt(rawVisibleCount, 10);
  var visibleCount =
    Number.isFinite(requestedVisibleCount) && requestedVisibleCount > 0
      ? Math.max(1, Math.min(totalDots, requestedVisibleCount))
      : totalDots;

  if (visibleCount >= totalDots) {
    return { start: 0, end: totalDots - 1, visibleCount };
  }

  var safeCurrentIndex = Math.max(0, Math.min(totalDots - 1, currentIndex));
  var visibleBefore = Math.floor((visibleCount - 1) / 2);
  var visibleAfter = visibleCount - visibleBefore - 1;

  var start = safeCurrentIndex - visibleBefore;
  var end = safeCurrentIndex + visibleAfter;

  if (start < 0) {
    end = Math.min(totalDots - 1, end - start);
    start = 0;
  }

  if (end > totalDots - 1) {
    start = Math.max(0, start - (end - (totalDots - 1)));
    end = totalDots - 1;
  }

  return { start, end, visibleCount };
}

function applyDotStateClasses(dots, currentIndex, config, lowPower = false) {
  var dotArray = Array.from(dots || []);
  if (!dotArray.length) return;
  var maxStyledDistance = 5;

  var safeCurrentIndex = Math.max(0, Math.min(dotArray.length - 1, currentIndex));
  var { start, end } = getDotWindowBounds(
    dotArray.length,
    safeCurrentIndex,
    config.dotVisibleCount
  );

  dotArray.forEach(function((dot, arrayIndex) {
    var wasActive = dot.classList.contains("active");
    var parsedIndex = Number(dot.dataset.index);
    var dotIndex = Number.isFinite(parsedIndex) ? parsedIndex : arrayIndex;
    var isActive = dotIndex === safeCurrentIndex;

    clearManagedDotStateClasses(dot);

    if (isActive) {
      dot.classList.add("active");
      dot.dataset.dotState = "active";
      dot.dataset.dotDirection = "current";
      dot.dataset.dotDistance = "0";
    } else {
      var distance = Math.abs(dotIndex - safeCurrentIndex);
      var styledDistance = Math.min(distance, maxStyledDistance);
      var direction = dotIndex < safeCurrentIndex ? "prev" : "next";
      var isHidden = dotIndex < start || dotIndex > end;

      dot.dataset.dotState = isHidden ? "hidden" : direction;
      dot.dataset.dotDirection = direction;
      dot.dataset.dotDistance = String(distance);

      if (isHidden) {
        dot.classList.add("monwui-dot-hidden", "monwui-dot-hidden-" + (direction));
      } else {
        dot.classList.add("monwui-dot-" + (direction), "monwui-dot-" + (direction) + "-" + (styledDistance));
      }
    }

    if (config.dotPosterMode && config.enableDotPosterAnimations && !lowPower) {
      if (wasActive !== isActive) applyDotPosterAnimation(dot, isActive);
    }
  });
}

export function updateActiveDot() {
  var currentIndex = getCurrentIndex();
  var dots = document.querySelectorAll(".monwui-dot");
  var config = getConfig();
  var lowPower = isLowPowerPeakRuntime();

  applyDotStateClasses(dots, currentIndex, config, lowPower);

  if (config.dotPosterMode) centerActiveDot({ smooth: !lowPower, force: true });
}

export function createDotNavigation() {
  var config = getConfig();
  if (!config.showDotNavigation) {
    var existingDotContainer = document.querySelector(".monwui-dot-navigation-container");
    if (existingDotContainer) {
      teardownAnimations();
      existingDotContainer.remove();
    }
    return;
  }

  var dotType = config.dotBackgroundImageType;
  var slidesContainer = getPeakViewportContainer();
  if (!slidesContainer) {
    return;
  }

  var slides = slidesContainer.querySelectorAll(".monwui-slide");
  if (!slides || slides.length === 0) return;

  var dotContainer = slidesContainer.querySelector(".monwui-dot-navigation-container");
  if (!dotContainer) {
    dotContainer = document.createElement("div");
    dotContainer.className = "monwui-dot-navigation-container";
    applyContainerStyles(dotContainer, 'existingDot');
    slidesContainer.appendChild(dotContainer);
  }

  var currentIndex = getCurrentIndex();
  var lowPower = isLowPowerPeakRuntime();

  if (config.dotPosterMode) {
    dotContainer.innerHTML = "";
    dotContainer.classList.add("dot-poster-mode");

    var scrollWrapper = document.createElement("div");
    scrollWrapper.className = "monwui-dot-scroll-wrapper";

    var slidesArray = Array.from(slides);

    var dotElements = slidesArray.mapfunction((slide, index) {
    var itemId = slide.dataset.itemId;
    if (!itemId) {
        console.warn("Dot oluşturulamadı: monwui-slide " + (index) + " için itemId eksik");
        return null;
    }

    var dot = document.createElement("div");
    dot.className = "monwui-dot monwui-poster-dot";
    dot.dataset.index = index;
    dot.dataset.itemId = itemId;

    var imageUrl = dotType === "useSlideBackground"
        ? slide.dataset.background
        : slide.dataset[dotType];

    if (imageUrl) {
        var image = document.createElement("img");
        image.src = withServer(imageUrl);
        image.className = "monwui-dot-poster-image";
        image.style.opacity = config.dotBackgroundOpacity || 0.3;
        image.style.filter = lowPower ? "none" : "blur(" + (config.dotBackgroundBlur || 10) + "px)";
        dot.appendChild(image);
    }

    try {
        var mediaStreams = slide.dataset.mediaStreams ? JSON.parse(slide.dataset.mediaStreams) : [];
        var videoStream = mediaStreams.find(function(s) s.Type === "Video");
        if (videoStream) {
            var qualityText = getVideoQualityText(videoStream);
            if (qualityText) {
                var qualityBadge = document.createElement("div");
                qualityBadge.className = "monwui-dot-quality-badge";
                qualityBadge.innerHTML = (qualityText);
                dot.appendChild(qualityBadge);
                var style = document.createElement("style");
            }
        }
    } catch (e) {
        console.warn("Video kalite bilgisi yüklenirken hata:", e);
    }

        var positionTicks = Number(slide.dataset.playbackpositionticks);
        var runtimeTicks = Number(slide.dataset.runtimeticks);
        var slideIsPlayed = slide.dataset.played === "true";

        if (config.showPlaybackProgress && hasPartialPlaybackState({
            isPlayed: slideIsPlayed,
            positionTicks,
            runtimeTicks
        })) {
            var progressContainer = document.createElement("div");
            progressContainer.className = "monwui-dot-progress-container";

            var barWrapper = document.createElement("div");
            barWrapper.className = "monwui-dot-duration-bar-wrapper";

            var bar = document.createElement("div");
            bar.className = "monwui-dot-duration-bar";
            var percentage = Math.min((positionTicks / runtimeTicks) * 100, 100);
            bar.style.width = (percentage.toFixed(1)) + "%";

            var remainingMinutes = Math.round((runtimeTicks - positionTicks) / 600000000);
            var text = document.createElement("span");
            text.className = "monwui-dot-duration-remaining";
            text.innerHTML = "<i class=\"fa-solid fa-hourglass-half\"></i> " + (remainingMinutes) + " " + (config.languageLabels.dakika) + " " + (config.languageLabels.kaldi);

            barWrapper.appendChild(bar);
            progressContainer.appendChild(barWrapper);
            progressContainer.appendChild(text);
            dot.appendChild(progressContainer);
        }

        var playButtonContainer = document.createElement("div");
        playButtonContainer.className = "monwui-dot-play-container";

        var playButton = document.createElement("button");
        playButton.className = "monwui-dot-play-button";
        playButton.textContent = config.languageLabels.izle;

        playButton.addEventListenerfunction('click', (e) {
        e.stopPropagation();
        var itemId = slide.dataset.itemId;
        if (!itemId) {
        alert("Oynatma başarısız: itemId bulunamadı");
        return;
      }
      closeVideoModal();
      try {
        playNow(itemId);
      } catch (error) {
        console.error("Oynatma hatası:", error);
        alert("Oynatma başarısız: " + error.message);
      } finally {
        closeVideoModal();
      }
    });

        var matchBadge = document.createElement("div");
        matchBadge.className = "monwui-dot-match-div";
        matchBadge.textContent = "...% " + (config.languageLabels.uygun);

        playButtonContainer.appendChild(playButton);
        playButtonContainer.appendChild(matchBadge);
        dot.appendChild(playButtonContainer);

        dot.classList.toggle("active", index === currentIndex);

        if (config.dotPosterMode && config.enableDotPosterAnimations && !lowPower) {
            applyDotPosterAnimation(dot, index === currentIndex);
        }
        dot.addEventListenerfunction("click", () {
            if (index !== getCurrentIndex()) {
                changeSlide(index - getCurrentIndex());
            }
        });

      dot.addEventListenerfunction("mouseenter", () {
      modalState.isMouseInItem = true;
      clearTimeout(modalState.modalHideTimeout);
      modalState.modalHoverState = true;
      if (dot.abortController) dot.abortController.abort();
      dot.abortController = new AbortController();
      var { signal } = dot.abortController;
      var itemId = dot.dataset.itemId;
      if (!itemId) return;
      scheduleOpenForItemfunction(dot, itemId, signal, () {
      if (!modalState.isMouseInItem && !modalState.isMouseInModal) return;
      try {
      openModalForDot(dot, itemId, signal);

      var item = fetchItemDetails(itemId, { signal });
      var isFavorite = item.UserData.IsFavorite || false;
      var isPlayed   = item.UserData.Played || false;
      var positionTicks = Number(item.UserData.PlaybackPositionTicks || 0);
      var runtimeTicks  = Number(item.RunTimeTicks || 0);
      var hasPartialPlayback = hasPartialPlaybackState({
        isPlayed,
        playedPercentage: item.UserData.PlayedPercentage,
        positionTicks,
        runtimeTicks
      });

      var playButton = dot.querySelector('.monwui-dot-play-button');
      if (playButton) {
        playButton.textContent = getPlayButtonText({
          isPlayed,
          hasPartialPlayback,
          labels: config.languageLabels
        });
      }

      var matchPercentage = calculateMatchPercentage(item.UserData, item);
      var matchBadge = dot.querySelector('.monwui-dot-match-div');
      if (matchBadge) {
        matchBadge.textContent = (matchPercentage) + "% " + (config.languageLabels.uygun);
      }

      dot.dataset.favorite = isFavorite.toString();
      dot.dataset.played   = isPlayed.toString();
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Poster monwui-dot hover hatası:', error);
        if (modalState.videoModal) modalState.videoModal.style.display = 'none';
      }
    }
  });
});
      dot.addEventListenerfunction("mouseleave", () {
      modalState.isMouseInItem = false;

      if (dot.abortController) {
      dot.abortController.abort();
      dot.abortController = null;
    }

      if (modalState._hoverOpenTimer) {
      clearTimeout(modalState._hoverOpenTimer);
      modalState._hoverOpenTimer = null;
    }
      startModalHideTimer();
});

      return dot;
      }).filter(Boolean);

      ensureDotQualityBadgeCSS();

      if (!lowPower) {
        setTimeoutfunction(() {
          var createdDots = Array.from(scrollWrapper.querySelectorAll('.monwui-poster-dot'));
          createdDots.forEach(function(dot) {
            var itemId = dot.dataset.itemId;
            if (itemId) preloadVideoPreview(itemId);
          });

          if (previewPreloadCache.size > PREVIEW_MAX_ENTRIES) {
            clearVideoPreloadCache({ mode: 'overLimit' });
          }
        }, 0);
      }

      dotElements.forEach(function(dot) scrollWrapper.appendChild(dot));
      setTimeoutfunction(() {
        var dotItemIds = dotElements.map(function(dot) dot.dataset.itemId).filter(Boolean);
        preloadGenreData(dotItemIds);
        for (var dot of dotElements) {
          try {
              var itemId = dot.dataset.itemId;
              var item = fetchItemDetails(itemId);
              var isFavorite = item.UserData.IsFavorite || false;
              var isPlayed = item.UserData.Played || false;
              var positionTicks = Number(item.UserData.PlaybackPositionTicks || 0);
              var runtimeTicks = Number(item.RunTimeTicks || 0);
              var hasPartialPlayback = hasPartialPlaybackState({
                isPlayed,
                playedPercentage: item.UserData.PlayedPercentage,
                positionTicks,
                runtimeTicks
              });
              var playButton = dot.querySelector('.monwui-dot-play-button');
              if (playButton) {
              playButton.textContent = getPlayButtonText({
              isPlayed,
              hasPartialPlayback,
              labels: config.languageLabels
            });
          }
              var matchPercentage = calculateMatchPercentage(item.UserData, item);
              var matchBadge = dot.querySelector('.monwui-dot-match-div');
              if (matchBadge) {
                  matchBadge.textContent = (matchPercentage) + "% " + (config.languageLabels.uygun);
              }
              dot.dataset.favorite = isFavorite.toString();
              dot.dataset.played = isPlayed.toString();

          } catch (error) {
              console.error("Dot verileri yüklenirken hata (" + (dot.dataset.itemId) + "):", error);
          }
      }
  }, lowPower ? 350 : 0);

    applyDotStateClasses(dotElements, currentIndex, config, lowPower);

    var leftArrow = document.createElement("button");
    leftArrow.className = "monwui-dot-arrow monwui-dot-arrow-left";
    leftArrow.innerHTML = "&#10094;";
    leftArrow.addEventListenerfunction("click", () {
        scrollWrapper.scrollBy({ left: -scrollWrapper.clientWidth, behavior: lowPower ? "auto" : "smooth" });
    });

    var rightArrow = document.createElement("button");
    rightArrow.className = "monwui-dot-arrow monwui-dot-arrow-right";
    rightArrow.innerHTML = "&#10095;";
    rightArrow.addEventListenerfunction("click", () {
        scrollWrapper.scrollBy({ left: scrollWrapper.clientWidth, behavior: lowPower ? "auto" : "smooth" });
    });

    dotContainer.append(leftArrow, scrollWrapper, rightArrow);
    if (scrollWrapper.__dotRO) scrollWrapper.__dotRO.disconnect();
    scrollWrapper.__dotRO = new ResizeObserverfunction(() { centerActiveDot(); });
    scrollWrapper.__dotRO.observe(scrollWrapper);

    setTimeoutfunction(() centerActiveDot({ smooth: !lowPower, force: true }), 300);
    return;
  }

  dotContainer.innerHTML = "";
  var currentDotIndex = getCurrentIndex();

  slides.forEach(function((slide, index) {
    var dot = document.createElement("span");
    dot.className = "monwui-dot";
    dot.dataset.index = index;

    var imageUrl = dotType === "useSlideBackground"
      ? slide.dataset.background
      : slide.dataset[dotType];

    if (imageUrl) {
      var imageOverlay = document.createElement("div");
      imageOverlay.className = "monwui-dot-image-overlay";
      imageOverlay.style.backgroundImage = "url(" + (imageUrl) + ")";
      imageOverlay.style.backgroundSize = "cover";
      imageOverlay.style.backgroundPosition = "center";
      imageOverlay.style.opacity = config.dotBackgroundOpacity || 0.3;
      imageOverlay.style.filter = lowPower ? "none" : "blur(" + (config.dotBackgroundBlur || 10) + "px)";
      dot.appendChild(imageOverlay);
    }

    dot.classList.toggle("active", index === currentDotIndex);
    dot.addEventListenerfunction("click", () {
      if (index !== getCurrentIndex()) {
        changeSlide(index - getCurrentIndex());
      }
    });

    dotContainer.appendChild(dot);
  });

  applyDotStateClasses(dotContainer.querySelectorAll(".monwui-dot"), currentDotIndex, config, lowPower);
}

function openModalForDot(dot, itemId, signal) {
  var cfg = getConfig();
  if (!cfg || cfg.previewModal === false) return
  if (modalState.videoModal) {
    hardStopPlayback();
    resetModalInfo(modalState.videoModal);
    resetModalButtons();
    if (modalState._modalContext !== 'monwui-dot') {
      destroyVideoModal();
    } else {
      modalState.videoModal.style.display = 'none';
    }
  }

  var item = fetchItemDetails(itemId, { signal });
  if (signal.aborted) return;
  if (!modalState.videoModal || !document.body.contains(modalState.videoModal)) {
    var modalElements = createVideoModal({ showButtons: true, context: 'monwui-dot' });
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

  var domUrl = getBackdropFromDot(dot);
  var itemUrl = getBackdropFromItem(item);
  modalState.videoModal.setBackdrop(domUrl || itemUrl || null);

  modalState.videoModal.dataset.itemId = itemId;
  positionModalRelativeToDot(modalState.videoModal, dot);
  if (modalState.videoModal.style.display !== 'block') {
    animatedShow(modalState.videoModal);
  } else {
    modalState.videoModal.style.display = 'block';
  }
  applyVolumePreference();

  var videoUrl = preloadVideoPreview(itemId);
  if (signal.aborted) return;
  updateModalContent(item, videoUrl);
}

export function initSwipeEvents() {
  var slidesContainer = getPeakViewportContainer();
  if (!slidesContainer) return;
  if (slidesContainer.__swipeBound) return;
  slidesContainer.__swipeBound = true;

  var touchStartX = 0;
  var touchStartY = 0;
  var touchEndX = 0;
  var touchEndY = 0;
  var isHorizontalSwipe = false;

  var handleTouchStart = function(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    isHorizontalSwipe = false;
    e.stopImmediatePropagation.();
  };

  var handleTouchMove = function(e) {
    var moveX = e.changedTouches[0].screenX - touchStartX;
    var moveY = e.changedTouches[0].screenY - touchStartY;
    if (Math.abs(moveX) > Math.abs(moveY) && Math.abs(moveX) > 10) {
      isHorizontalSwipe = true;
      e.preventDefault();
    } else {
      isHorizontalSwipe = false;
    }
    e.stopImmediatePropagation.();
  };

  var handleTouchEnd = function(e) {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    var deltaX = touchEndX - touchStartX;
    var deltaY = touchEndY - touchStartY;

    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      changeSlide(deltaX > 0 ? -1 : 1);
    }

    isHorizontalSwipe = false;
    e.stopImmediatePropagation.();
  };

  slidesContainer.addEventListener("touchstart", handleTouchStart, { passive: false });
  slidesContainer.addEventListener("touchmove", handleTouchMove, { passive: false });
  slidesContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
}

export function centerActiveDot({ smooth = true, force = false } = {}) {
  if (isLowPowerPeakRuntime()) smooth = false;
  var scrollWrapper = document.querySelector(".monwui-dot-scroll-wrapper");
  var activeDot = scrollWrapper.querySelector(".monwui-poster-dot.active");
  if (!scrollWrapper || !activeDot) return;

  var wrapperRect = scrollWrapper.getBoundingClientRect();
  var dotRect = activeDot.getBoundingClientRect();

  var isFullyVisible =
    dotRect.left >= wrapperRect.left &&
    dotRect.right <= wrapperRect.right;

  var dotCenter = dotRect.left + dotRect.width / 2;
  var isRoughlyCentered =
    dotCenter > wrapperRect.left + wrapperRect.width * 0.4 &&
    dotCenter < wrapperRect.right - wrapperRect.width * 0.4;

  if (!force && isFullyVisible && isRoughlyCentered) return;

  var scrollAmount =
    activeDot.offsetLeft - scrollWrapper.clientWidth / 2 + activeDot.offsetWidth / 2;

  scrollWrapper.scrollTo({
    left: scrollAmount,
    behavior: smooth ? "smooth" : "auto",
  });
}

function preloadGenreData(itemIds) {
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) return;

  var genreMap = new Map();

  Promise.allfunction(itemIds.map((itemId) {
      try {
        var item = fetchItemDetails(itemId);
        if (item && Array.isArray(item.Genres)) {
          genreMap.set(itemId, item.Genres);
        }
      } catch (err) {
      }
    })
  );
}

export function displaySlide(index) {
  ensureFlickerFixCSS();

  var slidesContainer = getPeakViewportContainer();
  if (!slidesContainer) return;

  var slides = slidesContainer.querySelectorAll(".monwui-slide");
  if (!slides.length) return;

  if (!document.querySelector(".monwui-dot-navigation-container")) {
    createDotNavigation();
  }

  var currentSlide = slides[index];
  if (!currentSlide) return;

  var activeSlide = slidesContainer.querySelector(".monwui-slide.active");
  var slidesArr = Array.from(slides);
  var len = slidesArr.length;

  var prevIndex = activeSlide ? slidesArr.indexOf(activeSlide) : -1;
  if (prevIndex < 0) prevIndex = (index - 1 + len) % len;

  var delta = index - prevIndex;
  if (delta >  len / 2)  delta -= len;
  if (delta < -len / 2)  delta += len;

  var direction = delta === 0 ? 1 : (delta > 0 ? 1 : -1);

  var isPeak = !!getConfig().peakSlider;
  if (slidesContainer) slidesContainer.classList.toggle("peak-mode", isPeak);
  if (isPeak && slidesContainer && !slidesContainer.classList.contains('peak-ready')) {
    slidesContainer.classList.add('peak-init');
    slidesContainer.scrollLeft = 0;
  }
  if (isPeak && activeSlide && activeSlide !== currentSlide && slidesContainer.classList.contains('peak-ready')) {
    armPeakShiftLite(slidesContainer);
  }

  slides.forEach(function(s) {
    if (s === currentSlide || s === activeSlide) {
      showSlide(s);
    } else if (!isPeak) {
      hideSlide(s, { soft: true });
    }
  });

  if (activeSlide) {
    if (!isPeak) {
      var enableAnims = !!getConfig().enableSlideAnimations;
      if (!enableAnims) {
        requestAnimationFramefunction(() {
          microFadeSwap(activeSlide, currentSlide);
        });
      } else {
        cancelOngoingAnimations(slidesArr);
        showSlide(currentSlide);
        var currentBackdrop =
          currentSlide.__backdropImg ||
          currentSlide.querySelector.('img.monwui-backdrop') ||
          currentSlide.querySelector.('.monwui-backdrop') ||
          null;
        if (currentBackdrop) {
          currentBackdrop.style.opacity = "0";
          currentBackdrop.style.willChange = "transform, opacity";
          forceReflow(currentBackdrop);
        }
        requestAnimationFramefunction(() {
          applySlideAnimation(activeSlide, currentSlide, direction);
        });
      }
    }
  } else {
    showSlide(currentSlide);
    currentSlide.style.opacity = "1";
  }

  if (isPeak) {
    ensurePeakViewportStability();
    syncPeakLiteMode(slidesContainer);
    ensurePeakVars(slidesContainer);
    primePeakFirstPaint(slides, index, slidesContainer, getPeakDisplayOptions());
    enablePeakNeighborActivation();
  } else {
    syncPeakLiteMode(null);
    slides.forEach(function(slide) {
      if (slide !== currentSlide) {
        slide.classList.remove("active");
        setTimeoutfunction(() {
          if (!slide.classList.contains("active")) {
            hideSlide(slide, { soft: true });
          }
        }, getConfig().slideAnimationDuration || 300);
      }
    });
  }

  showSlide(currentSlide);
  requestAnimationFramefunction(() {
    currentSlide.classList.add("active");
    currentSlide.dispatchEvent(new CustomEvent("slideActive", {
      bubbles: true,
      detail: { index }
    }));

    if (isPeak) {
      if (window.__peakBooting) {
        setTimeoutfunction(() {
          updateProgressBarPosition();
        }, 50);
      }
    } else {
      updateProgressBarPosition();
    }

    var directorContainer = currentSlide.querySelector(".monwui-director-container");
    if (directorContainer && !isPeak) {
      showAndHideElementWithAnimation(directorContainer, {
        girisSure: config.girisSure,
        aktifSure: config.aktifSure,
        transitionDuration: 600,
      });
    }
  });

  updateActiveDot();
  initSliderArrows(currentSlide);
  initSwipeEvents();
}

window.addEventListenerfunction('resize', () {
  if (modalState.progressBarEl && !useSecondsMode()) {
    updateProgressBarPosition();
  }
});

function cancelOngoingAnimations(slidesArr) {
  for (var s of slidesArr) {
    if (s.__animating || s.__animToken) {
      hardCleanupSlide(s);
      if (!s.classList.contains('active')) {
        s.style.display = "none";
        s.style.opacity = "0";
      }
    }
  }
}

function circSignedDist(i, active, len) {
  var d = ((i - active) % len + len) % len;
  if (d > len / 2) d -= len;
  return d;
}

export function updatePeakClasses(slides, activeIndex, spanOrOpts = 2) {
  var arr = resolveSlidesArray(slides);
  if (!arr.length) return;
  var len = arr.length;
  var safeActiveIndex = ((Number(activeIndex) || 0) % len + len) % len;

  if (window.__peakBooting) {
    arr.forEach(function((slide, index) {
      removeLegacyPeakPosClasses(slide);
      slide.classList.remove('off-left', 'off-right', 'peak-neighbor');
      slide.classList.toggle('active', index === safeActiveIndex);
      slide.removeAttribute("data-side");
      slide.style.removeProperty("--k");
      showSlide(slide);
      slide.__peakState = {
        active: index === safeActiveIndex,
        neighbor: false,
        offLeft: false,
        offRight: false,
        side: '',
        k: '',
        visible: true
      };
    });

    var container = arr[0].closest.('#monwui-slides-container') || getPeakViewportContainer();
    if (container) {
      container.__peakStateCache = null;
      container.classList.remove('peak-ready');
      container.classList.add('peak-init');
    }
    return;
  }

  var opts = normalizePeakOptions(spanOrOpts);
  var { spanLeft, spanRight, diagonal } = opts;
  var container = arr[0].closest.('#monwui-slides-container') || getPeakViewportContainer();
  if (container) {
    applyPeakContainerState(container, diagonal);
  }
  var prevState = container.__peakStateCache || null;
  var nextVisible = buildPeakVisibleIndexSet(len, safeActiveIndex, spanLeft, spanRight);
  var needsFullRebuild = !prevState || prevState.len !== len;

  if (needsFullRebuild) {
    rebuildPeakState(arr, safeActiveIndex, opts);
  } else {
    var dirty = new Set([safeActiveIndex, prevState.activeIndex, ...prevState.visibleIndices, ...nextVisible]);
    dirty.forEach(function((idx) {
      var slide = arr[idx];
      if (!slide) return;
      applyPeakSlideState(slide, getPeakSlideState(idx, safeActiveIndex, len, spanLeft, spanRight));
    });
  }

  if (modalState.progressBarEl && !useSecondsMode()) {
    setTimeoutfunction(() {
      updateProgressBarPosition();
    }, 50);
  }

  if (container) {
    container.__peakStateCache = {
      activeIndex: safeActiveIndex,
      diagonal: !!diagonal,
      len,
      spanLeft,
      spanRight,
      visibleIndices: nextVisible
    };
  }
}

export function primePeakFirstPaint(slides, activeIndex, slidesContainer, spanOrOpts = 2) {
  var opts = (typeof spanOrOpts === 'object')
    ? { spanLeft: 2, spanRight: 2, diagonal: false, ...spanOrOpts }
    : { spanLeft: spanOrOpts, spanRight: spanOrOpts, diagonal: false };

  if (window.__peakBooting) {
    var arr = Array.from(slides);
    if (slidesContainer) {
      slidesContainer.__peakStateCache = null;
      ensurePeakVars(slidesContainer);
      syncPeakLiteMode(slidesContainer);
      applyPeakContainerState(slidesContainer, opts.diagonal);
      slidesContainer.dataset.peakPrimed = '1';
      slidesContainer.classList.add('peak-init');
      slidesContainer.classList.remove('peak-ready');
    }
    arr.forEach(function((s, i) {
      s.style.setProperty('transition','none','important');
      showSlide(s);
      s.classList.toggle('active', i === activeIndex);
      s.classList.remove('off-left','off-right','peak-neighbor');
      [...s.classList].forEach(function(c) { if (/^(left|right)\d+$/.test(c)) s.classList.remove(c); });
      s.removeAttribute('data-side');
      s.style.removeProperty('--k');
    });
    requestAnimationFramefunction(() {
      arr.forEach(function((s) {
        s.style.removeProperty('transition');
        releasePeakPending(s);
      });
    });
    return;
  }

  if (!slidesContainer || slidesContainer.dataset.peakPrimed === '1') {
    updatePeakClasses(slides, activeIndex, opts);
    return;
  }
  slidesContainer.__peakStateCache = null;
  ensurePeakVars(slidesContainer);
  syncPeakLiteMode(slidesContainer);
  applyPeakContainerState(slidesContainer, opts.diagonal);
  slidesContainer.dataset.peakPrimed = '1';
  slidesContainer.classList.add('peak-init');

  var arr = Array.from(slides);
  var len = arr.length;
  var { spanLeft, spanRight, diagonal } = opts;

  arr.forEach(function((s, i) {
    s.style.setProperty('transition', 'none', 'important');
    s.style.display = 'block';
    s.style.left = '50%';
    s.style.top  = '50%';
    s.removeAttribute('data-prime-pos');

    var leftDist  = (activeIndex - i + len) % len;
    var rightDist = (i - activeIndex + len) % len;

    if (i === activeIndex) {
      s.setAttribute('data-prime-pos', 'active');
    } else if (leftDist >= 1 && leftDist <= spanLeft) {
  s.dataset.side = "left";
  s.style.setProperty("--k", leftDist);
} else if (rightDist >= 1 && rightDist <= spanRight) {
  s.dataset.side = "right";
  s.style.setProperty("--k", rightDist);
}
  });

  requestAnimationFramefunction(() {
    void document.body.offsetHeight;
    requestAnimationFramefunction(() {
      arr.forEach(function(s) {
        s.style.removeProperty('transition');
        s.style.removeProperty('left');
        s.style.removeProperty('top');
      });
      slidesContainer.classList.add('peak-ready');
      slidesContainer.classList.remove('peak-init');
      updatePeakClasses(slides, activeIndex, opts);
      arr.forEach(function((s) {
        s.removeAttribute('data-prime-pos');
        releasePeakPending(s);
      });
      armPeakInitialReveal(slidesContainer);
    });
  });
}

function ensurePeakVars(container) {
  if (!container) return;
  var cfg = getConfig();
  var gxLeft  = (cfg.peakGapLeft  || cfg.peakGapX || 110) + 'px';
  var gxRight = (cfg.peakGapRight || cfg.peakGapX || 110) + 'px';
  var gy      = (cfg.peakGapY || 0) + 'px';
  var varsKey = (gxLeft) + "|" + (gxRight) + "|" + (gy);

  if (container.__peakVarsKey === varsKey) return;
  container.__peakVarsKey = varsKey;

  container.style.setProperty('--peak-gap-left', gxLeft);
  container.style.setProperty('--peak-gap-right', gxRight);
  container.style.setProperty('--peak-gap-y', gy);
}

function syncPeakStructure(root = null, { forcePrime = false } = {}) {
  var base = root && root.nodeType === 1 ? root : document;
  var container = base.querySelector.('#monwui-slides-container') || getPeakViewportContainer();
  if (!container || !container.classList.contains('peak-mode')) return;

  var slides = container.querySelectorAll('.monwui-slide');
  if (!slides.length) return;

  var activeIndex = getPeakActiveIndex(slides);
  var opts = getPeakDisplayOptions();
  if (forcePrime || !container.classList.contains('peak-ready') || container.dataset.peakPrimed !== '1') {
    primePeakFirstPaint(slides, activeIndex, container, opts);
    return;
  }
  updatePeakClasses(slides, activeIndex, opts);
}

export function syncPeakStructureNow(root = null, { forcePrime = false } = {}) {
  syncPeakStructure(root, { forcePrime });
}

export function schedulePeakStructureSync(root = null, { forcePrime = false } = {}) {
  if (__peakStructureSyncTimer) clearTimeout(__peakStructureSyncTimer);
  if (__peakStructureSyncRaf) cancelAnimationFrame(__peakStructureSyncRaf);

  __peakStructureSyncTimer = setTimeoutfunction(() {
    __peakStructureSyncTimer = 0;
    __peakStructureSyncRaf = requestAnimationFramefunction(() {
      __peakStructureSyncRaf = 0;
      syncPeakStructure(root, { forcePrime });
    });
  }, forcePrime ? 32 : 16);
}

export function showAndHideElementWithAnimation(el, config) {
  var {
    girisSure = 0,
    aktifSure = 2000,
    transitionDuration = 600,
  } = config;
  el.style.transition = "none";
  el.style.opacity = "0";
  el.style.transform = "scale(0.95)";
  el.style.display = "none";
  setTimeoutfunction(() {
    el.style.display = "flex";
    requestAnimationFramefunction(() {
      el.style.transition = "opacity " + (transitionDuration) + "ms ease, transform " + (transitionDuration) + "ms ease";
      el.style.opacity = "1";
      el.style.transform = "scale(1)";
      setTimeoutfunction(() {
        el.style.opacity = "0";
        el.style.transform = "scale(0.95)";
        setTimeoutfunction(() {
          el.style.display = "none";
        }, transitionDuration);
      }, aktifSure);
    });
  }, girisSure);
}

function initSliderArrows(slide) {
  var actorContainer = slide.querySelector(".monwui-artist-container");
  var leftArrow = slide.querySelector(".monwui-slider-arrow.left");
  var rightArrow = slide.querySelector(".monwui-slider-arrow.right");
  var lowPower = isLowPowerPeakRuntime();

  if (!actorContainer || !leftArrow || !rightArrow) return;

  var updateArrows = function() {
    var maxScrollLeft = actorContainer.scrollWidth - actorContainer.clientWidth;
    leftArrow.classList.toggle("hidden", actorContainer.scrollLeft <= 0);
    rightArrow.classList.toggle("hidden", actorContainer.scrollLeft >= maxScrollLeft - 1);
  };

  leftArrow.onclick = function() {
    actorContainer.scrollBy({ left: -actorContainer.clientWidth, behavior: lowPower ? "auto" : "smooth" });
    setTimeout(updateArrows, 300);
  };

  rightArrow.onclick = function() {
    actorContainer.scrollBy({ left: actorContainer.clientWidth, behavior: lowPower ? "auto" : "smooth" });
    setTimeout(updateArrows, 300);
  };

  if (actorContainer.__jmsArrowScrollHandler) {
    actorContainer.removeEventListener("scroll", actorContainer.__jmsArrowScrollHandler);
  }
  actorContainer.__jmsArrowScrollHandler = updateArrows;
  actorContainer.addEventListener("scroll", updateArrows, { passive: true });

  if (actorContainer.__jmsArrowInitTimeout) {
    clearTimeout(actorContainer.__jmsArrowInitTimeout);
  }
  actorContainer.__jmsArrowInitTimeout = setTimeout(updateArrows, 100);
}

export function positionModalRelativeToDot(modal, dot) {
  var dotRect = dot.getBoundingClientRect();
  var modalWidth = 400;
  var modalHeight = 330;
  var windowPadding = 20;
  var edgeThreshold = 100;
  var verticalOffset = -10;

  var left = dotRect.left + window.scrollX + (dotRect.width - modalWidth) / 2;
  var top = dotRect.top + window.scrollY - modalHeight + verticalOffset;

  if (dotRect.right > window.innerWidth - edgeThreshold) {
    left = window.innerWidth - modalWidth - windowPadding;
  } else if (dotRect.left < edgeThreshold) {
    left = windowPadding;
  }

  if (top < windowPadding) {
    top = dotRect.bottom + window.scrollY + 15;
    if (top + modalHeight > window.innerHeight + window.scrollY - windowPadding) {
      top = dotRect.top + window.scrollY - modalHeight + verticalOffset;
    }
  }

  left = Math.max(windowPadding, Math.min(left, window.innerWidth - modalWidth - windowPadding));
  top = Math.max(windowPadding, Math.min(top, window.innerHeight + window.scrollY - modalHeight - windowPadding));

  modal.style.left = (left) + "px";
  modal.style.top = (top) + "px";
}

function clearVideoPreloadCache(opts = {}) {
  var { mode = 'all', itemId, test } = opts;
  try {
    switch (mode) {
      case 'expired':
        {
          var now = Date.now();
          for (var [id, entry] of previewPreloadCache) {
            if (!entry || entry.expiresAt <= now) previewPreloadCache.delete(id);
          }
        }
        break;
      case 'overLimit':
        {
          var limit = typeof PREVIEW_MAX_ENTRIES === 'number' ? PREVIEW_MAX_ENTRIES : 100;
          var overflow = previewPreloadCache.size - limit;
          if (overflow > 0) {
            var n = overflow;
            for (var [id] of previewPreloadCache) {
              previewPreloadCache.delete(id);
              if (--n <= 0) break;
            }
          }
        }
        break;
      case 'item':
        if (itemId) previewPreloadCache.delete(itemId);
        break;
      case 'predicate':
        if (typeof test === 'function') {
          for (var [id, entry] of previewPreloadCache) {
            if (test(id, entry)) previewPreloadCache.delete(id);
          }
        }
        break;
      case 'all':
      default:
        previewPreloadCache.clear();
        break;
    }
  } catch {}
}

function ensureDotQualityBadgeCSS() {
  if (document.getElementById('dot-quality-badge-css')) return;
  var style = document.createElement('style');
  style.id = 'dot-quality-badge-css';
  style.textContent = "\n    .monwui-dot-quality-badge {\n      position: absolute;\n      bottom: 24px;\n      left: 2px;\n      color: white;\n      display: flex;\n      gap: 2px;\n      flex-direction: column;\n    }\n    .monwui-dot-quality-badge img.range-icon,\n    .monwui-dot-quality-badge img.codec-icon,\n    .monwui-dot-quality-badge img.quality-icon {\n      width: 20px;\n      height: 14px;\n      background: rgba(30,30,40,.7);\n      border-radius: 4px;\n      padding: 1px;\n      object-fit: contain;\n      transition: all .3s ease;\n    }\n  ";
  document.head.appendChild(style);
}

export function enablePeakNeighborActivation() {
  var container = document.querySelector('#monwui-slides-container');
  if (!container || container.__peakClickBound) return;
  container.__peakClickBound = true;

  container.addEventListenerfunction('click', (e) {
    if (!container.classList.contains('peak-mode')) return;

    var IG = ['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL','VIDEO'];
    if (e.defaultPrevented || IG.includes(e.target.tagName)) return;
    if (e.target.closest.('[data-no-peak-activate="1"], .monwui-dot-navigation-container')) return;

    var x = e.clientX, y = e.clientY;
    var topEl    = document.elementFromPoint(x, y);
    var topSlide = topEl.closest.('.monwui-slide');
    if (!topSlide) return;
    if (!topSlide.classList.contains('peak-neighbor')) return;
    if (topSlide.classList.contains('active')) return;

    e.preventDefault();
    e.stopPropagation();

    var slides = Array.from(container.querySelectorAll('.monwui-slide'));
    var targetIndex  = slides.indexOf(topSlide);
    var currentIndex = getCurrentIndex();
    if (targetIndex < 0 || targetIndex === currentIndex) return;

    var len = slides.length;
    var delta = targetIndex - currentIndex;
    if (delta >  len / 2) delta -= len;
    if (delta < -len / 2) delta += len;

    changeSlide(delta);
  }, { capture: true, passive: false });

  if (!document.getElementById('peak-neighbor-cursor-css')) {
    var style = document.createElement('style');
    style.id = 'peak-neighbor-cursor-css';
    style.textContent = ".peak-ready .monwui-slide.peak-neighbor{ cursor:pointer; }";
    document.head.appendChild(style);
  }
}
