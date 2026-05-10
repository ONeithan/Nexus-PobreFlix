import { startSlideTimer, stopSlideTimer, pauseSlideTimer, resumeSlideTimer, SLIDE_DURATION } from "./timer.js";
import { getCurrentIndex, setCurrentIndex, getSlideDuration, setAutoSlideTimeout, getAutoSlideTimeout, setSlideStartTime, getSlideStartTime, setRemainingTime, getRemainingTime } from "./sliderState.js";
import { attachMouseEvents, setupVisibilityHandler } from "./events.js";
import { getConfig } from './config.js';
import { applyContainerStyles } from "./positionUtils.js";
import { modalState, set, get, resetModalRefs } from './modalState.js';

var secondsEl = null;
var pausedProgressPct = 0;
var secondsTimer = null;
var secondsPausedMs = 0;
var secondsEndAt = 0;
var frameLockRaf = null;
var barAnimPlayer = null;
var barAnimState = null;
var __pbInited = false;
var __paused = false;
var secondsRunId = 0;

function now() { return performance.now(); }

function setSecondsText(el, remainingMs) {
  if (!el) return;
  el.textContent = Math.max(0, Math.ceil(Math.max(0, remainingMs) / 1000)).toString();
}

function getSlidesContainer() {
  return document.querySelector(
    "#indexPage:not(.hide) #monwui-slides-container, #homePage:not(.hide) #monwui-slides-container, #monwui-slides-container"
  );
}

function getActivePage() {
  return document.querySelector("#indexPage:not(.hide), #homePage:not(.hide)");
}

function getCurrentSlideHost() {
  var sc = getSlidesContainer();
  if (!sc) return null;
  var active = sc.querySelector(".monwui-slide.active");
  if (active) return active;
  return null;
}

function mountSecondsToActiveSlide(el) {
  if (!el) return;
  var host = getCurrentSlideHost();
  if (host && el.parentElement !== host) {
    host.appendChild(el);
    return;
  }
  if (host) return;
  if (el.parentElement) return;

  var sc = getSlidesContainer();
  if (sc && el.parentElement !== sc) {
    sc.appendChild(el);
  }
}

export function useSecondsMode() {
  var cfg = getConfig();
  return !!cfg.showProgressAsSeconds;
}

function removeVisualProgressBar() {
  cancelBarAnimation();
  try {
    document.querySelectorAll(".monwui-slide-progress-bar").forEach(function((node) node.remove());
  } catch {}
  modalState.progressBarEl = null;
}

function clearRaf() {
  if (frameLockRaf) {
    cancelAnimationFrame(frameLockRaf);
    frameLockRaf = null;
  }
}

function cancelBarAnimation({ commitCurrent = false } = {}) {
  var bar = barAnimState.bar || null;
  if (commitCurrent && bar) {
    setBarScale(ensureProgressFill(bar), getLiveBarScale(bar, 1), 1);
  }
  if (barAnimPlayer) {
    try { barAnimPlayer.cancel(); } catch {}
    barAnimPlayer = null;
  }
  clearRaf();
  barAnimState = null;
}

function isPeakProgressMode(slidesContainer = getSlidesContainer()) {
  return !!slidesContainer.classList.contains('peak-mode');
}

function getComputedScaleX(el) {
  if (!el) return 0;
  var st = getComputedStyle(el);
  var tr = st.transform || st.webkitTransform || "";
  if (!tr || tr === "none") return 0;
  if (tr.startsWith("matrix3d(")) {
    var vals = tr.slice(9, -1).split(",").map(function(s) parseFloat(s.trim()));
    var m11 = vals[0];
    return Number.isFinite(m11) ? m11 : 0;
  }
  if (tr.startsWith("matrix(")) {
    var vals = tr.slice(7, -1).split(",").map(function(s) parseFloat(s.trim()));
    var a = vals[0];
    return Number.isFinite(a) ? a : 0;
  }
  var m = tr.match(/scaleX\(([-+]?[\d.]+)\)/i);
  if (m) {
    var v = parseFloat(m[1]);
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

function targetScaleFromCfg() {
  return Math.max(0, Math.min(1, (getConfig().progressBarWidth || 100) / 100));
}

function restoreBarLayoutTransitions(bar) {
  if (!bar) return;
  bar.style.transition = 'none';
}

function clampScale(scale, maxScale = 1) {
  var safeScale = Number.isFinite(scale) ? scale : 0;
  var safeMaxScale = Math.max(0, Number.isFinite(maxScale) ? maxScale : 1);
  return Math.max(0, Math.min(safeMaxScale, safeScale));
}

function setBarScale(fill, scale, maxScale = 1) {
  if (!fill) return;
  var nextScale = clampScale(scale, maxScale);
  if (Number.isFinite(fill.__lastScale) && Math.abs(fill.__lastScale - nextScale) < 0.00005) {
    return;
  }
  fill.__lastScale = nextScale;
  fill.style.transform = "scaleX(" + (nextScale) + ")";
}

function ensureProgressFill(bar) {
  if (!bar) return null;

  var fill = bar.querySelector(':scope > .monwui-slide-progress-fill');
  var isNew = false;
  if (!fill) {
    fill = document.createElement('div');
    fill.className = 'monwui-slide-progress-fill';
    bar.appendChild(fill);
    isNew = true;
  }

  Object.assign(bar.style, {
    overflow: 'hidden',
    pointerEvents: 'none',
    background: 'rgba(255,255,255,0.10)',
    transform: 'none',
    transformOrigin: '50% 50%',
    transition: 'none'
  });

  Object.assign(fill.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    background: 'var(--color-e91e63, #e91e63)',
    borderRadius: 'inherit',
    transformOrigin: '0 50%',
    transition: 'none'
  });

  if (isNew) {
    fill.__lastScale = 0;
    fill.style.transform = 'scaleX(0)';
  }

  return fill;
}

function getLiveBarScale(bar, targetScale = 1) {
  if (!bar) return 0;
  var fill = ensureProgressFill(bar);
  if (!fill) return 0;

  if (barAnimPlayer && barAnimState && barAnimState.bar === bar) {
    var currentTime = Number(barAnimPlayer.currentTime);
    var progress = barAnimState.duration > 0 && Number.isFinite(currentTime)
      ? Math.max(0, Math.min(1, currentTime / barAnimState.duration))
      : 0;
    var currentScale = barAnimState.startScale
      + ((barAnimState.endScale - barAnimState.startScale) * progress);
    return clampScale(currentScale, targetScale);
  }

  if (barAnimState && barAnimState.bar === bar) {
    var startedAt = barAnimState.startedAt || now();
    var elapsed = Math.max(0, now() - startedAt);
    var progress = barAnimState.duration > 0
      ? Math.max(0, Math.min(1, elapsed / barAnimState.duration))
      : 1;
    var currentScale = barAnimState.startScale
      + ((barAnimState.endScale - barAnimState.startScale) * progress);
    return clampScale(currentScale, targetScale);
  }

  var computedScale = getComputedScaleX(fill);
  if (Number.isFinite(computedScale) && computedScale > 0) {
    return clampScale(computedScale, targetScale);
  }

  if (Number.isFinite(fill.__lastScale)) {
    return clampScale(fill.__lastScale, targetScale);
  }

  return 0;
}

function animateProgressBar(bar, {
  duration,
  startScale = 0,
  endScale = 1,
  syncLayout = true
} = {}) {
  if (!bar) return;
  cancelBarAnimation();
  var fill = ensureProgressFill(bar);
  if (!fill) return;

  if (syncLayout) updateProgressBarPosition();

  var safeDuration = Math.max(0, Math.round(Number(duration) || 0));
  var safeStartScale = clampScale(startScale, 1);
  var safeEndScale = clampScale(endScale, 1);

  bar.classList.remove('is-paused', 'is-animating');
  restoreBarLayoutTransitions(bar);
  setBarScale(fill, safeStartScale, 1);

  if (safeDuration <= 0 || Math.abs(safeEndScale - safeStartScale) < 0.0005) {
    setBarScale(fill, safeEndScale, 1);
    return;
  }

  barAnimState = {
    bar,
    fill,
    duration: safeDuration,
    startScale: safeStartScale,
    endScale: safeEndScale,
    startedAt: 0,
    mode: typeof fill.animate === 'function' ? 'waapi' : 'raf'
  };

  if (typeof fill.animate === 'function') {
    try {
      var animation = fill.animate(
        [
          { transform: "scaleX(" + (safeStartScale) + ")" },
          { transform: "scaleX(" + (safeEndScale) + ")" }
        ],
        {
          duration: safeDuration,
          easing: 'linear',
          fill: 'forwards'
        }
      );
      barAnimPlayer = animation;
      animation.onfinish = function() {
        if (barAnimPlayer !== animation) return;
        barAnimPlayer = null;
        barAnimState = null;
        setBarScale(fill, safeEndScale, 1);
      };
      animation.oncancel = function() {
        if (barAnimPlayer === animation) {
          barAnimPlayer = null;
        }
      };
      return;
    } catch {}
  }

  var step = function(ts) {
    if (!barAnimState || barAnimState.bar !== bar || !bar.isConnected || !fill.isConnected) {
      cancelBarAnimation();
      return;
    }

    if (!barAnimState.startedAt) {
      barAnimState.startedAt = ts;
    }

    var elapsed = Math.max(0, ts - barAnimState.startedAt);
    var progress = Math.max(0, Math.min(1, elapsed / barAnimState.duration));
    var currentScale = barAnimState.startScale
      + ((barAnimState.endScale - barAnimState.startScale) * progress);

    setBarScale(fill, currentScale, 1);

    if (progress >= 1) {
      setBarScale(fill, barAnimState.endScale, 1);
      cancelBarAnimation();
      return;
    }

    frameLockRaf = requestAnimationFrame(step);
  };

  frameLockRaf = requestAnimationFrame(step);
}

export function ensureProgressBarExists() {
  removeVisualProgressBar();
  return modalState.progressBarEl;
}

function getUntransformedSlidePosition(slide, slidesContainer) {
  if (!slide || !slidesContainer) return { left: 0, width: 0 };

  var isPeak = isPeakProgressMode(slidesContainer);

  if (!isPeak) {
    var slideRect = slide.getBoundingClientRect();
    var containerRect = slidesContainer.getBoundingClientRect();
    return {
      left: slideRect.left - containerRect.left,
      width: slideRect.width
    };
  }

  var containerWidth = slidesContainer.clientWidth || slidesContainer.getBoundingClientRect().width || 0;
  var activeWidth = slide.offsetWidth || slide.getBoundingClientRect().width || 0;
  var activeLeft = Math.max(0, (containerWidth - activeWidth) / 2);

  return {
    left: activeLeft,
    width: activeWidth
  };
}

export function updateProgressBarPosition() {
  removeVisualProgressBar();
}

function ensureSecondsExists() {
  if (!useSecondsMode()) {
    if (secondsEl && document.body.contains(secondsEl)) {
      secondsEl.remove();
      secondsEl = null;
    }
    clearSecondsTimer();
    return null;
  }
  if (secondsEl && !document.body.contains(secondsEl)) secondsEl = null;
  if (!secondsEl) {
    secondsEl = document.querySelector(".monwui-slide-progress-seconds");
    if (!secondsEl) {
      secondsEl = document.createElement("div");
      secondsEl.className = "monwui-slide-progress-seconds";
      applyContainerStyles(secondsEl, 'progressSeconds');
      mountSecondsToActiveSlide(secondsEl);
    }
  } else {
    mountSecondsToActiveSlide(secondsEl);
  }
  return secondsEl;
}

function clearSecondsTimer() {
  if (secondsTimer) {
    clearInterval(secondsTimer);
    secondsTimer = null;
  }
}

document.addEventListenerfunction('visibilitychange', () {
  if (!useSecondsMode()) return;
  if (document.hidden) {
    pauseProgressBar();
  } else {
    resumeProgressBar();
  }
}, { passive: true });

export function resetProgressBar() {
  var dur = (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION);
  removeVisualProgressBar();

  if (useSecondsMode()) {
    var el = ensureSecondsExists();
    if (!el) return;
    __paused = false;
    clearSecondsTimer();
    secondsPausedMs = 0;
    var t0tmp = now();
    secondsEndAt = t0tmp + dur;
    el.removeAttribute('data-done');
    setSecondsText(el, dur);
    setSlideStartTime(t0tmp);
    setRemainingTime(dur);
    return;
  }

  __paused = false;
  pausedProgressPct = 0;
  setSlideStartTime(now());
  setRemainingTime(dur);
}

export function startProgressBarWithDuration(duration) {
  var dur = Math.max(0, duration || (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION));
  removeVisualProgressBar();

  if (useSecondsMode()) {
    var el = ensureSecondsExists();
    if (!el) return;
    __paused = false;
    clearSecondsTimer();
    var t0 = now();
    secondsRunId = (secondsRunId + 1) || 1;
    var runId = secondsRunId;
    secondsEndAt = t0 + dur + 30;
    secondsPausedMs = 0;
    el.removeAttribute('data-done');
    setSecondsText(el, dur);
    secondsTimer = setIntervalfunction(() {
      if (runId !== secondsRunId) { clearSecondsTimer(); return; }

      var t = secondsEndAt - now();
      if (t <= 0) {
        clearSecondsTimer();
        el.setAttribute('data-done', '1');
        el.textContent = "0";
      } else {
        setSecondsText(el, t);
      }
    }, 100);
    setSlideStartTime(t0);
    setRemainingTime(dur);
    return;
  }

  __paused = false;
  var t0 = now();
  setSlideStartTime(t0);
  setRemainingTime(dur);
  pausedProgressPct = 0;
}

export function pauseProgressBar() {
  var dur = (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION);
  if (__paused) return;
  removeVisualProgressBar();

  if (useSecondsMode()) {
    var el = ensureSecondsExists();
    if (!el) return;
    var t0 = getSlideStartTime.() || now();
    var elapsed = Math.max(0, Math.min(dur, now() - t0));
    var remaining = Math.max(0, dur - elapsed);
    secondsPausedMs = secondsEndAt
      ? Math.max(0, secondsEndAt - now())
      : remaining;
    clearSecondsTimer();
    setSecondsText(el, secondsPausedMs || remaining);
    setRemainingTime(remaining);
    __paused = true;
    return;
  }

  var t0 = getSlideStartTime.() || now();
  var elapsed = Math.max(0, Math.min(dur, now() - t0));
  var doneFrac = dur > 0 ? (elapsed / dur) : 0;
  pausedProgressPct = Math.max(0, Math.min(100, doneFrac * 100));
  setRemainingTime(dur - elapsed);
  __paused = true;
}

export function resumeProgressBar() {
  var dur = (typeof getSlideDuration === 'function' ? (getSlideDuration() || SLIDE_DURATION) : SLIDE_DURATION);
  if (!__paused) return;
  removeVisualProgressBar();

  if (useSecondsMode()) {
    var el = ensureSecondsExists();
    if (!el) return;
    var remaining = secondsPausedMs > 0
      ? secondsPausedMs
      : (typeof getRemainingTime === 'function' ? (getRemainingTime() || 0) : 0);
    if (!Number.isFinite(remaining) || remaining <= 0) remaining = dur;
    var t0 = now();
    secondsEndAt = t0 + remaining + 30;
    clearSecondsTimer();
    secondsRunId = (secondsRunId + 1) || 1;
    var runId = secondsRunId;
    el.removeAttribute('data-done');
    setSecondsText(el, remaining);
    secondsTimer = setIntervalfunction(() {
      if (runId !== secondsRunId) { clearSecondsTimer(); return; }
      var t = secondsEndAt - now();
      if (t <= 0) {
        clearSecondsTimer();
        el.setAttribute('data-done', '1');
        el.textContent = "0";
      } else {
        setSecondsText(el, t);
      }
    }, 100);
    setSlideStartTime(t0 - (dur - remaining));
    setRemainingTime(remaining);
    __paused = false;
    return;
  }

  var prevRemaining = getRemainingTime.();
  var total = dur;

  var remainingTime = typeof prevRemaining === 'number' && isFinite(prevRemaining)
    ? Math.max(0, Math.min(total, prevRemaining))
    : Math.max(0, (1 - (pausedProgressPct / 100)) * total);

  var t0 = now();
  setSlideStartTime(t0 - (total - remainingTime));
  setRemainingTime(remainingTime);
  __paused = false;
}
