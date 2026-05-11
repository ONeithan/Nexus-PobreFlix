import { getConfig } from "./config.js";
import { forceHomeSectionsTop } from './positionOverrides.js';

const config = getConfig();
const HEADER_OFFSET_VAR = '--jms-slider-header-offset-px';
const sliderHeaderBaselineByElement = new WeakMap();

let sliderHeaderResizeObserver = null;
let sliderHeaderObservedEl = null;
let sliderHeaderLifecycleBound = false;
let sliderHeaderRafId = 0;

function normalizeSliderVariant(value) {
  const variant = String(value ?? '').trim().toLowerCase();
  if (!variant) return 'normalslider';
  if (variant.includes('full')) return 'fullslider';
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

function getSliderViewportBucket() {
  return window.matchMedia?.('(max-width: 768px)')?.matches ? 'mobile' : 'desktop';
}

function findActiveSlidesContainer() {
  return document.querySelector(
    '#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container'
  );
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

function setSliderHeaderOffsetVar(container, offsetPx) {
  if (!container) return;
  const roundedOffset = Number.isFinite(offsetPx) ? Math.round(offsetPx) : 0;
  const value = `${roundedOffset}px`;
  if (container.style.getPropertyValue(HEADER_OFFSET_VAR) !== value) {
    container.style.setProperty(HEADER_OFFSET_VAR, value);
  }
}

function clearSliderHeaderObserver() {
  sliderHeaderObservedEl = null;
  if (!sliderHeaderResizeObserver) return;
  try { sliderHeaderResizeObserver.disconnect(); } catch {}
}

function scheduleSliderHeaderOffsetSync() {
  if (sliderHeaderRafId) return;
  sliderHeaderRafId = requestAnimationFrame(() => {
    sliderHeaderRafId = 0;
    try { syncSliderHeaderOffset(); } catch {}
  });
}

function bindSliderHeaderLifecycle() {
  if (sliderHeaderLifecycleBound) return;
  sliderHeaderLifecycleBound = true;

  window.addEventListener('resize', scheduleSliderHeaderOffsetSync, { passive: true });
  window.addEventListener('pageshow', scheduleSliderHeaderOffsetSync);
  window.addEventListener('hashchange', scheduleSliderHeaderOffsetSync);
  window.addEventListener('popstate', scheduleSliderHeaderOffsetSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') {
      scheduleSliderHeaderOffsetSync();
    }
  });
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

function computeSliderHeaderOffsetPx(header) {
  const rect = header?.getBoundingClientRect?.();
  const currentHeight = Number(rect?.height || 0);
  if (!Number.isFinite(currentHeight) || currentHeight <= 0) return 0;

  const viewportBucket = getSliderViewportBucket();
  const baselineState = sliderHeaderBaselineByElement.get(header) || {
    mobile: null,
    desktop: null,
  };

  const previousBaseline = baselineState[viewportBucket];
  const nextBaseline = Number.isFinite(previousBaseline) && previousBaseline > 0
    ? Math.min(previousBaseline, currentHeight)
    : currentHeight;

  baselineState[viewportBucket] = nextBaseline;
  sliderHeaderBaselineByElement.set(header, baselineState);

  const offsetPx = currentHeight - nextBaseline;
  return Math.abs(offsetPx) < 1 ? 0 : offsetPx;
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
  const variant = getActiveSliderVariant();

  if (!container || !usesDynamicHeaderOffset(variant)) {
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
    return;
  }

  ensureSliderHeaderObserver(header);
  setSliderHeaderOffsetVar(container, computeSliderHeaderOffsetPx(header));
}

function setImportantStyle(element, property, value) {
  if (!element) return;

  if (value !== undefined && value !== null && value !== '') {
    element.style.setProperty(property, value, 'important');
  } else {
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
    syncSliderHeaderOffset(slidesContainer);
    applyContainerStyles(slidesContainer);
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

  const sliderWrapper = document.querySelector(".monwui-slider-wrapper");
  if (sliderWrapper) applyContainerStyles(sliderWrapper, 'slider');

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
