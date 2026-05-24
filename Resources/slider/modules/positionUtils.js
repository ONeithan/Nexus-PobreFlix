import { getConfig } from "./config.js";
import { forceHomeSectionsTop } from './positionOverrides.js';

const HEADER_OFFSET_VAR = '--jms-slider-header-offset-px';
const HEADER_REFERENCE_TOP_VAR = '--jms-slider-header-reference-top';
const VISUAL_TOP_VAR = '--jms-slider-visual-top';

let sliderHeaderResizeObserver = null;
let sliderHeaderObservedEl = null;
let sliderHeaderLifecycleBound = false;
let sliderHeaderRafId = 0;
let sliderHeaderMutationObserver = null;

const SLIDER_HEADER_OBSERVER_OPTIONS = {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['class', 'style', 'hidden']
};

const SLIDER_HEADER_RELEVANT_SELECTOR = [
  '.skinHeader',
  '.mainDrawer',
  '.mainDrawerButton',
  '#monwui-slides-container',
  '#indexPage',
  '#homePage',
  "[data-role='page']",
].join(', ');

function normalizeSliderVariant(value) {
  const variant = String(value ?? '').trim().toLowerCase();
  if (!variant) return 'normalslider';
  if (variant.includes('full')) return 'normalslider';
  if (variant.includes('peak')) return 'peakslider';
  if (variant.includes('normal')) return 'normalslider';
  if (variant.includes('slider')) return 'slider';
  return 'normalslider';
}

function getActiveSliderVariant(config = getConfig()) {
  return normalizeSliderVariant(
    config?.cssVariant ??
    document.documentElement?.dataset?.cssVariant ??
    window.__cssVariant ??
    'normalslider'
  );
}

function usesDynamicHeaderOffset(variant = getActiveSliderVariant()) {
  return variant === 'slider' || variant === 'normalslider' || variant === 'peakslider';
}

function findActiveSlidesContainer() {
  return document.querySelector(
    '#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container'
  );
}

function getActivePageScrollTop() {
  const activePage = document.querySelector(
    '#indexPage:not(.hide), #homePage:not(.hide), [data-role="page"]:not(.hide)'
  );

  const candidates = [
    window.scrollY,
    window.pageYOffset,
    document.scrollingElement?.scrollTop,
    document.documentElement?.scrollTop,
    document.body?.scrollTop,
    activePage?.scrollTop,
  ];

  let maxScrollTop = 0;
  for (const value of candidates) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > maxScrollTop) {
      maxScrollTop = numericValue;
    }
  }

  return maxScrollTop;
}

function isSliderContextNearTop(maxScrollTop = 24) {
  return getActivePageScrollTop() <= maxScrollTop;
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

function readSliderHeaderOffsetPx(container) {
  if (!container) return 0;
  const rawValue =
    container.style.getPropertyValue(HEADER_OFFSET_VAR) ||
    window.getComputedStyle?.(container)?.getPropertyValue?.(HEADER_OFFSET_VAR) ||
    '';
  const numericValue = Number.parseFloat(rawValue);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function readCustomProperty(element, name) {
  if (!element || !name) return '';
  return (
    element.style.getPropertyValue(name) ||
    window.getComputedStyle?.(element)?.getPropertyValue?.(name) ||
    ''
  ).trim();
}

function resolveCssLengthPx(rawValue, contextElement, fallback = 0) {
  const value = String(rawValue ?? '').trim();
  if (!value) return fallback;

  const probe = document.createElement('div');
  const parent = contextElement?.isConnected ? contextElement : document.body;
  if (!parent) return fallback;

  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;width:0;height:0;contain:strict;';
  probe.style.top = value;

  try {
    parent.appendChild(probe);
    const resolved = Number.parseFloat(window.getComputedStyle?.(probe)?.top || '');
    return Number.isFinite(resolved) ? resolved : fallback;
  } catch {
    return fallback;
  } finally {
    try { probe.remove(); } catch {}
  }
}

function readCssLengthVarPx(element, name, fallback = 0) {
  const rawValue = readCustomProperty(element, name);
  return resolveCssLengthPx(rawValue, element, fallback);
}

function readSliderVisualTopDeltaPx(container) {
  const referenceTopPx = readCssLengthVarPx(container, HEADER_REFERENCE_TOP_VAR, 0);
  const visualTopPx = readCssLengthVarPx(container, VISUAL_TOP_VAR, referenceTopPx);
  return visualTopPx - referenceTopPx;
}

function setSliderHeaderOffsetVar(container, offsetPx) {
  const roundedOffset = Number.isFinite(offsetPx) ? Math.round(offsetPx) : 0;
  const value = `${roundedOffset}px`;

  const rootStyle = document.documentElement?.style;
  if (rootStyle && rootStyle.getPropertyValue(HEADER_OFFSET_VAR) !== value) {
    rootStyle.setProperty(HEADER_OFFSET_VAR, value);
  }

  if (!container) return;
  if (container.style.getPropertyValue(HEADER_OFFSET_VAR) !== value) {
    container.style.setProperty(HEADER_OFFSET_VAR, value);
  }
}

function clearSliderHeaderObserver() {
  sliderHeaderObservedEl = null;
  if (!sliderHeaderResizeObserver) return;
  try { sliderHeaderResizeObserver.disconnect(); } catch {}
}

function reconnectSliderHeaderMutationObserver() {
  const root = document.body || document.documentElement;
  if (!sliderHeaderMutationObserver || !root || document.visibilityState === 'hidden') return;
  try { sliderHeaderMutationObserver.disconnect(); } catch {}
  try { sliderHeaderMutationObserver.observe(root, SLIDER_HEADER_OBSERVER_OPTIONS); } catch {}
}

function scheduleSliderHeaderOffsetSync() {
  if (sliderHeaderRafId) return;
  sliderHeaderRafId = requestAnimationFrame(() => {
    sliderHeaderRafId = 0;
    try { syncSliderHeaderOffset(); } catch {}
  });
}

function scheduleSliderHeaderOffsetBurst() {
  const delays = [0, 60, 180, 420, 900];
  for (const delay of delays) {
    setTimeout(() => {
      try { scheduleSliderHeaderOffsetSync(); } catch {}
    }, delay);
  }
}

function nodeMatchesSliderHeaderRelevantTarget(node) {
  return !!node?.matches?.(SLIDER_HEADER_RELEVANT_SELECTOR);
}

function nodeContainsSliderHeaderRelevantTarget(node) {
  return !!node?.querySelector?.(SLIDER_HEADER_RELEVANT_SELECTOR);
}

function shouldScheduleSliderHeaderSync(mutations = []) {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes') {
      if (nodeMatchesSliderHeaderRelevantTarget(mutation.target)) return true;
      continue;
    }

    for (const node of mutation.addedNodes || []) {
      if (nodeMatchesSliderHeaderRelevantTarget(node) || nodeContainsSliderHeaderRelevantTarget(node)) {
        return true;
      }
    }

    for (const node of mutation.removedNodes || []) {
      if (nodeMatchesSliderHeaderRelevantTarget(node) || nodeContainsSliderHeaderRelevantTarget(node)) {
        return true;
      }
    }
  }

  return false;
}

function bindSliderHeaderLifecycle() {
  if (sliderHeaderLifecycleBound) return;
  sliderHeaderLifecycleBound = true;

  window.addEventListener('resize', scheduleSliderHeaderOffsetBurst, { passive: true });
  window.addEventListener('pageshow', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('load', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('hashchange', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('popstate', scheduleSliderHeaderOffsetBurst);
  window.addEventListener('focus', scheduleSliderHeaderOffsetBurst);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') {
      scheduleSliderHeaderOffsetBurst();
      reconnectSliderHeaderMutationObserver();
      return;
    }
    try { sliderHeaderMutationObserver?.disconnect(); } catch {}
  });

  if (!sliderHeaderMutationObserver) {
    sliderHeaderMutationObserver = new MutationObserver((mutations) => {
      if (!shouldScheduleSliderHeaderSync(mutations)) return;
      scheduleSliderHeaderOffsetBurst();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSliderHeaderOffsetBurst, { once: true });
  } else {
    scheduleSliderHeaderOffsetBurst();
  }

  reconnectSliderHeaderMutationObserver();
}

function ensureSliderHeaderObserver(header) {
  if (!header?.isConnected || typeof ResizeObserver !== 'function') return;
  bindSliderHeaderLifecycle();

  if (!sliderHeaderResizeObserver) {
    sliderHeaderResizeObserver = new ResizeObserver(() => {
      scheduleSliderHeaderOffsetSync();
    });
  }

  if (sliderHeaderObservedEl === header) return;

  try { sliderHeaderResizeObserver.disconnect(); } catch {}
  sliderHeaderObservedEl = header;
  try { sliderHeaderResizeObserver.observe(header); } catch {}
}

function computeSliderHeaderOffsetPx(header, container) {
  const currentOffset = readSliderHeaderOffsetPx(container);
  if (!isSliderContextNearTop()) return currentOffset;

  const headerRect = header?.getBoundingClientRect?.();
  const slideRect = container?.getBoundingClientRect?.();
  const headerBottom = Number(headerRect?.bottom || 0);
  const slideTop = Number(slideRect?.top || 0) - readSliderVisualTopDeltaPx(container);

  if (!Number.isFinite(headerBottom) || !Number.isFinite(slideTop)) return 0;

  const overlapPx = headerBottom - slideTop;
  const nextOffset = Math.max(0, currentOffset + overlapPx);
  return Math.abs(nextOffset) < 1 ? 0 : nextOffset;
}

function resolveTopStyleValue(prefix, rawTopValue, config = getConfig()) {
  const numericTopValue = Number(rawTopValue);
  if (!Number.isFinite(numericTopValue) || numericTopValue === 0) return '';

  let topValue = `${numericTopValue}%`;
  if (prefix === 'slide' && usesDynamicHeaderOffset(getActiveSliderVariant(config))) {
    topValue = `calc(${topValue} + var(${HEADER_OFFSET_VAR}, 0px))`;
  }
  return topValue;
}

export function syncSliderHeaderOffset(container = findActiveSlidesContainer()) {
  bindSliderHeaderLifecycle();
  const variant = getActiveSliderVariant();

  if (!container || !usesDynamicHeaderOffset(variant)) {
    document.documentElement?.style?.removeProperty(HEADER_OFFSET_VAR);
    if (container) {
      container.style.removeProperty(HEADER_OFFSET_VAR);
    }
    if (!usesDynamicHeaderOffset(variant)) {
      clearSliderHeaderObserver();
    }
    return;
  }

  const header = findVisibleSkinHeader();
  if (!header) {
    setSliderHeaderOffsetVar(container, 0);
    clearSliderHeaderObserver();
    reconnectSliderHeaderMutationObserver();
    return;
  }

  ensureSliderHeaderObserver(header);
  setSliderHeaderOffsetVar(container, computeSliderHeaderOffsetPx(header, container));
}

function setImportantStyle(element, property, value) {
  if (!element) return;

  if (value !== undefined && value !== null && value !== '') {
    const nextValue = String(value);
    if (
      element.style.getPropertyValue(property) === nextValue &&
      element.style.getPropertyPriority(property) === 'important'
    ) {
      return;
    }
    element.style.setProperty(property, nextValue, 'important');
  } else {
    if (!element.style.getPropertyValue(property)) return;
    element.style.removeProperty(property);
  }
}

export function applyContainerStyles(container, type = '') {
  const config = getConfig();
  let prefix;

  if (type === 'progress') {
    prefix = 'progressBar';
  } else if (type === 'progressSeconds') {
    prefix = 'progressSeconds';
  } else if (type) {
    prefix = `${type}Container`;
  } else {
    prefix = 'slide';
  }

  setImportantStyle(container, 'top',    resolveTopStyleValue(prefix, config[`${prefix}Top`], config));
  setImportantStyle(container, 'left',   config[`${prefix}Left`]   ? `${config[`${prefix}Left`]}%`   : '');
  setImportantStyle(container, 'width',  config[`${prefix}Width`]  ? `${config[`${prefix}Width`]}%`  : '');
  setImportantStyle(container, 'height', config[`${prefix}Height`] ? `${config[`${prefix}Height`]}%` : '');

  if (type && type !== 'slide' && type !== 'progressSeconds' && type !== 'progress') {
    setImportantStyle(container, 'display',         config[`${prefix}Display`]        || '');
    setImportantStyle(container, 'flex-direction',  config[`${prefix}FlexDirection`]  || '');
    setImportantStyle(container, 'justify-content', config[`${prefix}JustifyContent`] || '');
    setImportantStyle(container, 'align-items',     config[`${prefix}AlignItems`]     || '');
    setImportantStyle(container, 'flex-wrap',       config[`${prefix}FlexWrap`]       || '');
  }
}

export function updateSlidePosition() {
  const config = getConfig();

  const slidesContainer = document.querySelector("#monwui-slides-container");
  if (slidesContainer) {
    applyContainerStyles(slidesContainer);
    syncSliderHeaderOffset(slidesContainer);
  } else {
    clearSliderHeaderObserver();
  }

  const containerTypes = [
    'logo', 'meta', 'status', 'rating', 'plot',
    'title', 'director', 'info', 'button',
    'existingDot', 'provider', 'providericons'
  ];

  containerTypes.forEach(type => {
    document.querySelectorAll(`.monwui-${type}-container`).forEach(container => {
      applyContainerStyles(container, type);
    });
  });

  document.querySelectorAll(".monwui-slider-wrapper").forEach(sliderWrapper => {
    if (!sliderWrapper.classList.contains("monwui-artist-menu")) {
      applyContainerStyles(sliderWrapper, 'slider');
    }
  });

  const progressBar = document.querySelector(".monwui-slide-progress-bar");
  if (progressBar) applyContainerStyles(progressBar, 'progress');

  const progressSeconds = document.querySelector(".monwui-slide-progress-seconds");
  if (progressSeconds) applyContainerStyles(progressSeconds, 'progressSeconds');

  const homeSectionsContainers = document.querySelectorAll(".homeSectionsContainer");
  if (homeSectionsContainers.length) {
    const explicitHomeTop = Number(config.homeSectionsTop);
    if (Number.isFinite(explicitHomeTop) && explicitHomeTop !== 0) {
      homeSectionsContainers.forEach(container => {
        setImportantStyle(container, 'top', `${explicitHomeTop}vh`);
      });
    } else {
      homeSectionsContainers.forEach(container => {
        setImportantStyle(container, 'top', '');
      });
      try { forceHomeSectionsTop(); } catch {}
    }
  }
}
