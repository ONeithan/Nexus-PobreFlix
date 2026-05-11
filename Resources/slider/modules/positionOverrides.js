import { getConfig } from './config.js';

let homeTopObserver = null;
let skinHeaderObserver = null;
let applyHomeTop = null;
let applySkinHeader = null;
let homeTopLifecycleBound = false;
let skinHeaderLifecycleBound = false;
const homeTopHeaderBaselineByElement = new WeakMap();
const HOME_HEADER_OFFSET_VAR = '--jms-home-sections-header-offset-vh';

const OBSERVER_OPTIONS = {
  subtree: true,
  childList: true,
  attributes: false
};

function scheduleBurst(fn) {
  if (typeof fn !== 'function') return;
  const delays = [0, 60, 180, 420];
  for (const delay of delays) {
    setTimeout(() => {
      try { fn(); } catch {}
    }, delay);
  }
}

function reconnectObserver(observer) {
  const root = document.body || document.documentElement;
  if (!observer || !root || document.visibilityState === 'hidden') return;
  try { observer.disconnect(); } catch {}
  try { observer.observe(root, OBSERVER_OPTIONS); } catch {}
}

function bindHomeTopLifecycle() {
  if (homeTopLifecycleBound) return;
  homeTopLifecycleBound = true;

  const reapply = () => {
    scheduleBurst(() => {
      try { applyHomeTop?.(); } catch {}
      reconnectObserver(homeTopObserver);
    });
  };

  let resizeRafId = 0;
  const handleResize = () => {
    if (resizeRafId) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      reapply();
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { homeTopObserver?.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListener('pagehide', () => {
    try { homeTopObserver?.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
  window.addEventListener('resize', handleResize, { passive: true });
}

function bindSkinHeaderLifecycle() {
  if (skinHeaderLifecycleBound) return;
  skinHeaderLifecycleBound = true;

  const reapply = () => {
    scheduleBurst(() => {
      try { applySkinHeader?.(); } catch {}
      reconnectObserver(skinHeaderObserver);
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { skinHeaderObserver?.disconnect(); } catch {}
      return;
    }
    reapply();
  });

  window.addEventListener('pageshow', reapply);
  window.addEventListener('pagehide', () => {
    try { skinHeaderObserver?.disconnect(); } catch {}
  });
  window.addEventListener('hashchange', reapply);
  window.addEventListener('popstate', reapply);
  window.addEventListener('focus', reapply);
}

function isMobileDevice() {
  const widthNarrow = window.matchMedia?.('(max-width: 768px)')?.matches;
  const coarse     = window.matchMedia?.('(pointer: coarse)')?.matches;
  const hoverNone  = window.matchMedia?.('(hover: none)')?.matches;
  const touchPts   = navigator.maxTouchPoints || 0;
  const uaMobile   = navigator.userAgentData?.mobile ?? /Mobi|Android/i.test(navigator.userAgent);

  return widthNarrow && (coarse || hoverNone || touchPts > 0 || uaMobile);
}

function normalizeVariant(x) {
  const s = String(x ?? '').toLowerCase().trim();
  if (!s) return 'normalslider';

  if (s.includes('normalslider') || s.includes('normal')) return 'normalslider';
  if (s.includes('fullslider') || s.includes('full'))   return 'fullslider';
  if (s.includes('peakslider') || s.includes('peak'))   return 'peakslider';
  if (s.includes('slider')) return 'slider';
  return 'normalslider';
}

function detectCssVariantFromDom() {
  if (window.__cssVariant) return normalizeVariant(window.__cssVariant);

  const dv = document.documentElement?.dataset?.cssVariant;
  if (dv) return normalizeVariant(dv);

  const has = (s) => !!document.querySelector(`link[href*="${s}"]`);
  if (has('peakslider.css'))   return 'peakslider';
  if (has('normalslider.css')) return 'normalslider';
  if (has('fullslider.css')) return 'fullslider';
  if (has('slider.css')) return 'slider';
  return 'normalslider';
}

function resolveConfiguredVariant(cfg = {}) {
  const rawVariant = String(cfg?.cssVariant ?? '').trim();
  if (rawVariant) {
    return normalizeVariant(rawVariant);
  }
  return detectCssVariantFromDom();
}

function usesDynamicHeaderAdjustedTop(variant) {
  return variant === 'normalslider' || variant === 'peakslider' || variant === 'slider';
}

function getHeaderViewportBucket() {
  return window.matchMedia?.('(max-width: 768px)')?.matches ? 'mobile' : 'desktop';
}

function isElementVisible(element) {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect?.();
  if (!rect || rect.height <= 0 || rect.width <= 0) return false;
  const style = window.getComputedStyle?.(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function findVisibleSkinHeader() {
  const candidates = document.querySelectorAll('.skinHeader:not(.osdHeader)');
  for (const header of candidates) {
    if (isElementVisible(header)) return header;
  }
  return null;
}

function computeHeaderHeightOffsetPx(header) {
  const rect = header?.getBoundingClientRect?.();
  const currentHeight = Number(rect?.height || 0);
  if (!Number.isFinite(currentHeight) || currentHeight <= 0) return 0;

  const viewportBucket = getHeaderViewportBucket();
  const baselineState = homeTopHeaderBaselineByElement.get(header) || {
    mobile: null,
    desktop: null,
  };

  const previousBaseline = baselineState[viewportBucket];
  const nextBaseline = Number.isFinite(previousBaseline) && previousBaseline > 0
    ? Math.min(previousBaseline, currentHeight)
    : currentHeight;

  baselineState[viewportBucket] = nextBaseline;
  homeTopHeaderBaselineByElement.set(header, baselineState);

  const offsetPx = currentHeight - nextBaseline;
  return Math.abs(offsetPx) < 1 ? 0 : offsetPx;
}

function getHeaderHeightOffsetVh(variant) {
  if (!usesDynamicHeaderAdjustedTop(variant)) return 0;
  const header = findVisibleSkinHeader();
  if (!header) return 0;

  const offsetPx = computeHeaderHeightOffsetPx(header);
  if (!offsetPx) return 0;

  const viewportHeight =
    Number(window.innerHeight) ||
    Number(document.documentElement?.clientHeight) ||
    0;

  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  return Number(((offsetPx / viewportHeight) * 100).toFixed(3));
}

function setHomeHeaderOffsetVar(offsetVh = 0) {
  const root = document.documentElement;
  if (!root?.style) return;
  const numericOffset = Number.isFinite(offsetVh) ? offsetVh : 0;
  const value = `${numericOffset}vh`;
  if (root.style.getPropertyValue(HOME_HEADER_OFFSET_VAR) !== value) {
    root.style.setProperty(HOME_HEADER_OFFSET_VAR, value);
  }
}

function computeEffectiveTopState() {
  const cfg = (typeof getConfig === 'function') ? getConfig() : {};
  const userTop = readUserTopFromLocalStorage();
  if (userTop !== null) {
    setHomeHeaderOffsetVar(0);
    return {
      topValue: `${userTop}vh`,
      usesHeaderOffset: false,
    };
  }
  if (cfg?.enableSlider === false || cfg?.enableSlider === 'false') {
    setHomeHeaderOffsetVar(0);
    return null;
  }

  const variant = resolveConfiguredVariant(cfg);
  const baseTop = getDefaultTopByVariant(variant);
  const usesHeaderOffset = usesDynamicHeaderAdjustedTop(variant);
  const headerOffsetVh = usesHeaderOffset ? getHeaderHeightOffsetVh(variant) : 0;

  setHomeHeaderOffsetVar(headerOffsetVh);

  return {
    topValue: usesHeaderOffset
      ? `calc(${baseTop}vh + var(${HOME_HEADER_OFFSET_VAR}, 0vh))`
      : `${baseTop}vh`,
    usesHeaderOffset,
  };
}

function getDefaultTopByVariant(variant) {
  let baseTop;
  const mobile = window.matchMedia?.('(max-width: 768px)')?.matches || isMobileDevice();
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
  const raw = localStorage.getItem('homeSectionsTop');
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

function coerceBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return fallback;
}

function shouldAffectFavoritesTab(cfg) {
  const raw = localStorage.getItem('onlyShowSliderOnHomeTab');
  if (raw === 'true' || raw === 'false') return raw === 'false';
  return !coerceBoolean(cfg?.onlyShowSliderOnHomeTab, true);
}

function applyTopToElements(value, affectFavoritesTab = true) {
  const targets = [...document.querySelectorAll('.homeSectionsContainer')]
    .filter(el => affectFavoritesTab || el?.id !== 'favoritesTab');
  if (affectFavoritesTab) {
    const fav = document.querySelector('#favoritesTab');
    if (fav && !targets.includes(fav)) targets.push(fav);
  }
  for (const el of targets) {
    if (!el) continue;
    if (el.style.top !== value) {
      el.style.setProperty('top', value, 'important');
    }
  }
}

function clearTopOverrides(affectFavoritesTab = true) {
  const targets = [...document.querySelectorAll('.homeSectionsContainer')]
    .filter(el => affectFavoritesTab || el?.id !== 'favoritesTab');
  if (affectFavoritesTab) {
    const fav = document.querySelector('#favoritesTab');
    if (fav && !targets.includes(fav)) targets.push(fav);
  }
  for (const el of targets) {
    if (!el) continue;
    el.style.removeProperty('top');
  }
}

function clearFavoritesTabTopOverride() {
  const el = document.querySelector('#favoritesTab');
  if (!el) return;
  el.style.removeProperty('top');
}

function waitForFavoritesTabAndApply(topValue) {
  let tries = 0;
  function attempt() {
    const cfg = (typeof getConfig === 'function') ? getConfig() : {};
    if (!shouldAffectFavoritesTab(cfg)) return;

    const el = document.querySelector('#favoritesTab');
    if (el) {
      el.style.setProperty('top', topValue, 'important');
      return;
    }
    if (++tries < 30) setTimeout(attempt, 100);
  }
  attempt();
}

export function forceHomeSectionsTop() {
  const applyAlways = () => {
    const topState = computeEffectiveTopState();
    const cfg = (typeof getConfig === 'function') ? getConfig() : {};
    const affectFavoritesTab = shouldAffectFavoritesTab(cfg);

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
      document.addEventListener('DOMContentLoaded', () => scheduleBurst(applyAlways), { once: true });
    } else {
      scheduleBurst(applyAlways);
    }

    homeTopObserver = new MutationObserver(() => {
      try { applyHomeTop?.(); } catch {}
    });
    reconnectObserver(homeTopObserver);
  } else {
    scheduleBurst(applyAlways);
    reconnectObserver(homeTopObserver);
  }
}

export function forceSkinHeaderPointerEvents() {
  const apply = () => {
    document.querySelectorAll('html .skinHeader').forEach(el => {
      el.style.setProperty('pointer-events', 'all', 'important');
    });

    const playerToggle = document.querySelector('button#jellyfinPlayerToggle');
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
      document.addEventListener('DOMContentLoaded', () => scheduleBurst(apply), { once: true });
    } else {
      scheduleBurst(apply);
    }

    skinHeaderObserver = new MutationObserver(() => {
      try { applySkinHeader?.(); } catch {}
    });
    reconnectObserver(skinHeaderObserver);
  } else {
    scheduleBurst(apply);
    reconnectObserver(skinHeaderObserver);
  }
}
