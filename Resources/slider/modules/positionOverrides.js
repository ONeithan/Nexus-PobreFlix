import { getConfig } from './config.js';

var homeTopObserver = null;
var skinHeaderObserver = null;
var applyHomeTop = null;
var applySkinHeader = null;
var homeTopLifecycleBound = false;
var skinHeaderLifecycleBound = false;
var homeTopHeaderBaselineByElement = new WeakMap();
var HOME_HEADER_OFFSET_VAR = '--jms-home-sections-header-offset-vh';

var OBSERVER_OPTIONS = {
  subtree: true,
  childList: true,
  attributes: false
};

function scheduleBurst(fn) {
  if (typeof fn !== 'function') return;
  var delays = [0, 60, 180, 420];
  for (var delay of delays) {
    setTimeoutfunction(() {
      try { fn(); } catch {}
    }, delay);
  }
}

function reconnectObserver(observer) {
  var root = document.body || document.documentElement;
  if (!observer || !root || document.visibilityState === 'hidden') return;
  try { observer.disconnect(); } catch {}
  try { observer.observe(root, OBSERVER_OPTIONS); } catch {}
}

function bindHomeTopLifecycle() {
  if (homeTopLifecycleBound) return;
  homeTopLifecycleBound = true;

  var reapply = function() {
    scheduleBurstfunction(() {
      try { applyHomeTop.(); } catch {}
      reconnectObserver(homeTopObserver);
    });
  };

  var resizeRafId = 0;
  var handleResize = function() {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFramefunction(() {
      resizeRafId = 0;
      reapply();
    });
  };

  document.addEventListenerfunction('visibilitychange', () {
    if (document.visibilityState === 'hidden') {
      try { homeTopObserver.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListenerfunction('pagehide', () {
    try { homeTopObserver.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
  window.addEventListener('resize', handleResize, { passive: true });
}

function bindSkinHeaderLifecycle() {
  if (skinHeaderLifecycleBound) return;
  skinHeaderLifecycleBound = true;

  var reapply = function() {
    scheduleBurstfunction(() {
      try { applySkinHeader.(); } catch {}
      reconnectObserver(skinHeaderObserver);
    });
  };

  document.addEventListenerfunction('visibilitychange', () {
    if (document.visibilityState === 'hidden') {
      try { skinHeaderObserver.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListenerfunction('pagehide', () {
    try { skinHeaderObserver.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
}

function isMobileDevice() {
  var widthNarrow = window.matchMedia.('(max-width: 768px)').matches;
  var coarse     = window.matchMedia.('(pointer: coarse)').matches;
  var hoverNone  = window.matchMedia.('(hover: none)').matches;
  var touchPts   = navigator.maxTouchPoints || 0;
  var uaMobile   = navigator.userAgentData.mobile || /Mobi|Android/i.test(navigator.userAgent);

  return widthNarrow && (coarse || hoverNone || touchPts > 0 || uaMobile);
}

function normalizeVariant(x) {
  var s = String(x || '').toLowerCase().trim();
  if (!s) return 'normalslider';

  if (s.includes('normalslider') || s.includes('normal')) return 'normalslider';
  if (s.includes('fullslider') || s.includes('full'))   return 'fullslider';
  if (s.includes('peakslider') || s.includes('peak'))   return 'peakslider';
  if (s.includes('slider')) return 'slider';
  return 'normalslider';
}

function detectCssVariantFromDom() {
  if (window.__cssVariant) return normalizeVariant(window.__cssVariant);

  var dv = document.documentElement.dataset.cssVariant;
  if (dv) return normalizeVariant(dv);

  var has = function(s) !!document.querySelector("link[href*=\"" + (s) + "\"]");
  if (has('peakslider.css'))   return 'peakslider';
  if (has('normalslider.css')) return 'normalslider';
  if (has('fullslider.css')) return 'fullslider';
  if (has('slider.css')) return 'slider';
  return 'normalslider';
}

function resolveConfiguredVariant(cfg = {}) {
  var rawVariant = String(cfg.cssVariant || '').trim();
  if (rawVariant) {
    return normalizeVariant(rawVariant);
  }
  return detectCssVariantFromDom();
}

function usesDynamicHeaderAdjustedTop(variant) {
  return variant === 'normalslider' || variant === 'peakslider' || variant === 'slider';
}

function getHeaderViewportBucket() {
  return window.matchMedia.('(max-width: 768px)').matches ? 'mobile' : 'desktop';
}

function isElementVisible(element) {
  if (!element.isConnected) return false;
  var rect = element.getBoundingClientRect.();
  if (!rect || rect.height <= 0 || rect.width <= 0) return false;
  var style = window.getComputedStyle.(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function findVisibleSkinHeader() {
  var candidates = document.querySelectorAll('.skinHeader:not(.osdHeader)');
  for (var header of candidates) {
    if (isElementVisible(header)) return header;
  }
  return null;
}

function computeHeaderHeightOffsetPx(header) {
  var rect = header.getBoundingClientRect.();
  var currentHeight = Number(rect.height || 0);
  if (!Number.isFinite(currentHeight) || currentHeight <= 0) return 0;

  var viewportBucket = getHeaderViewportBucket();
  var baselineState = homeTopHeaderBaselineByElement.get(header) || {
    mobile: null,
    desktop: null,
  };

  var previousBaseline = baselineState[viewportBucket];
  var nextBaseline = Number.isFinite(previousBaseline) && previousBaseline > 0
    ? Math.min(previousBaseline, currentHeight)
    : currentHeight;

  baselineState[viewportBucket] = nextBaseline;
  homeTopHeaderBaselineByElement.set(header, baselineState);

  var offsetPx = currentHeight - nextBaseline;
  return Math.abs(offsetPx) < 1 ? 0 : offsetPx;
}

function getHeaderHeightOffsetVh(variant) {
  if (!usesDynamicHeaderAdjustedTop(variant)) return 0;
  var header = findVisibleSkinHeader();
  if (!header) return 0;

  var offsetPx = computeHeaderHeightOffsetPx(header);
  if (!offsetPx) return 0;

  var viewportHeight =
    Number(window.innerHeight) ||
    Number(document.documentElement.clientHeight) ||
    0;

  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  return Number(((offsetPx / viewportHeight) * 100).toFixed(3));
}

function setHomeHeaderOffsetVar(offsetVh = 0) {
  var root = document.documentElement;
  if (!root.style) return;
  var numericOffset = Number.isFinite(offsetVh) ? offsetVh : 0;
  var value = (numericOffset) + "vh";
  if (root.style.getPropertyValue(HOME_HEADER_OFFSET_VAR) !== value) {
    root.style.setProperty(HOME_HEADER_OFFSET_VAR, value);
  }
}

function computeEffectiveTopState() {
  var cfg = (typeof getConfig === 'function') ? getConfig() : {};
  var userTop = readUserTopFromLocalStorage();
  if (userTop !== null) {
    setHomeHeaderOffsetVar(0);
    return {
      topValue: (userTop) + "vh",
      usesHeaderOffset: false,
    };
  }
  if (cfg.enableSlider === false || cfg.enableSlider === 'false') {
    setHomeHeaderOffsetVar(0);
    return null;
  }

  var variant = resolveConfiguredVariant(cfg);
  var baseTop = getDefaultTopByVariant(variant);
  var usesHeaderOffset = usesDynamicHeaderAdjustedTop(variant);
  var headerOffsetVh = usesHeaderOffset ? getHeaderHeightOffsetVh(variant) : 0;

  setHomeHeaderOffsetVar(headerOffsetVh);

  return {
    topValue: usesHeaderOffset
      ? "calc(" + (baseTop) + "vh + var(" + (HOME_HEADER_OFFSET_VAR) + ", 0vh))"
      : (baseTop) + "vh",
    usesHeaderOffset,
  };
}

function getDefaultTopByVariant(variant) {
  var baseTop;
  var mobile = window.matchMedia.('(max-width: 768px)').matches || isMobileDevice();
  if (mobile) {
    switch (variant) {
      case 'normalslider': baseTop = -23; break;
      case 'fullslider': baseTop = -16; break;
      case 'peakslider': baseTop = -5.5; break;
      case 'slider': baseTop = -3; break;
      default: baseTop = 0; break;
    }
  } else {
    switch (variant) {
      case 'normalslider': baseTop = -15; break;
      case 'fullslider': baseTop = 6; break;
      case 'peakslider': baseTop = -3.5; break;
      case 'slider': baseTop = 1; break;
      default: baseTop = 0; break;
    }
  }

  return baseTop;
}

function readUserTopFromLocalStorage() {
  var raw = localStorage.getItem('homeSectionsTop');
  if (raw === null || raw === '') return null;
  var n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

function coerceBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    var s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return fallback;
}

function shouldAffectFavoritesTab(cfg) {
  var raw = localStorage.getItem('onlyShowSliderOnHomeTab');
  if (raw === 'true' || raw === 'false') return raw === 'false';
  return !coerceBoolean(cfg.onlyShowSliderOnHomeTab, true);
}

function applyTopToElements(value, affectFavoritesTab = true) {
  var targets = [...document.querySelectorAll('.homeSectionsContainer')]
    .filter(function(el) affectFavoritesTab || el.id !== 'favoritesTab');
  if (affectFavoritesTab) {
    var fav = document.querySelector('#favoritesTab');
    if (fav && !targets.includes(fav)) targets.push(fav);
  }
  for (var el of targets) {
    if (!el) continue;
    if (el.style.top !== value) {
      el.style.setProperty('top', value, 'important');
    }
  }
}

function clearTopOverrides(affectFavoritesTab = true) {
  var targets = [...document.querySelectorAll('.homeSectionsContainer')]
    .filter(function(el) affectFavoritesTab || el.id !== 'favoritesTab');
  if (affectFavoritesTab) {
    var fav = document.querySelector('#favoritesTab');
    if (fav && !targets.includes(fav)) targets.push(fav);
  }
  for (var el of targets) {
    if (!el) continue;
    el.style.removeProperty('top');
  }
}

function clearFavoritesTabTopOverride() {
  var el = document.querySelector('#favoritesTab');
  if (!el) return;
  el.style.removeProperty('top');
}

function waitForFavoritesTabAndApply(topValue) {
  var tries = 0;
  function attempt() {
    var cfg = (typeof getConfig === 'function') ? getConfig() : {};
    if (!shouldAffectFavoritesTab(cfg)) return;

    var el = document.querySelector('#favoritesTab');
    if (el) {
      el.style.setProperty('top', topValue, 'important');
      return;
    }
    if (++tries < 30) setTimeout(attempt, 100);
  }
  attempt();
}

export function forceHomeSectionsTop() {
  var applyAlways = function() {
    var topState = computeEffectiveTopState();
    var cfg = (typeof getConfig === 'function') ? getConfig() : {};
    var affectFavoritesTab = shouldAffectFavoritesTab(cfg);

    if (topState === null) {
      clearTopOverrides(affectFavoritesTab);
      if (!affectFavoritesTab) clearFavoritesTabTopOverride();
      return;
    }

    applyTopToElements(topState.topValue, affectFavoritesTab);
    if (affectFavoritesTab) {
      waitForFavoritesTabAndApply(topState.topValue);
    } else {
      clearFavoritesTabTopOverride();
    }
  };

  applyHomeTop = applyAlways;
  bindHomeTopLifecycle();

  if (!homeTopObserver) {
    if (document.readyState === 'loading') {
      document.addEventListenerfunction('DOMContentLoaded', () scheduleBurst(applyAlways), { once: true });
    } else {
      scheduleBurst(applyAlways);
    }

    homeTopObserver = new MutationObserverfunction(() {
      try { applyHomeTop.(); } catch {}
    });
    reconnectObserver(homeTopObserver);
  } else {
    scheduleBurst(applyAlways);
    reconnectObserver(homeTopObserver);
  }
}

export function forceSkinHeaderPointerEvents() {
  var apply = function() {
    document.querySelectorAll('html .skinHeader').forEach(function(el) {
      el.style.setProperty('pointer-events', 'all', 'important');
    });

    var playerToggle = document.querySelector('button#jellyfinPlayerToggle');
    if (playerToggle) {
      playerToggle.style.setProperty('display', 'block', 'important');
      playerToggle.style.setProperty('opacity', '1', 'important');
      playerToggle.style.setProperty('pointer-events', 'all', 'important');
      playerToggle.style.setProperty('background', 'none', 'important');
      playerToggle.style.setProperty('text-shadow', 'rgb(255, 255, 255) 0px 0px 2px', 'important');
      playerToggle.style.setProperty('cursor', 'pointer', 'important');
      playerToggle.style.setProperty('border', 'none', 'important');
    }
  };

  applySkinHeader = apply;
  bindSkinHeaderLifecycle();

  if (!skinHeaderObserver) {
    if (document.readyState === 'loading') {
      document.addEventListenerfunction('DOMContentLoaded', () scheduleBurst(apply), { once: true });
    } else {
      scheduleBurst(apply);
    }

    skinHeaderObserver = new MutationObserverfunction(() {
      try { applySkinHeader.(); } catch {}
    });
    reconnectObserver(skinHeaderObserver);
  } else {
    scheduleBurst(apply);
    reconnectObserver(skinHeaderObserver);
  }
}
