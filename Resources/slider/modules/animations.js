import { getConfig } from './config.js';

var __animTimers = new WeakMap();
var __animRafs   = new WeakMap();
var __globalTimers = new Set();
var __globalRafs   = new Set();

export function forceReflow(el) {
  if (!el) return;
  void el.offsetWidth;
}

var __animSeq = 0;
export function nextAnimToken() { return (++__animSeq) >>> 0; }

export function hardCleanupSlide(slide) {
  if (!slide) return;
  clearTimers(slide);
  slide.style.transition = "";
  slide.style.transform = "";
  slide.style.opacity = "";
  slide.style.filter = "";
  slide.style.clipPath = "";
  slide.style.borderRadius = "";
  slide.style.zIndex = "";
  slide.style.display = "";
  slide.style.backfaceVisibility = "";
  clearWillChange(slide);
  slide.__animating = false;
  slide.__animToken = 0;
}

function startTransition(el, setInitial, setFinal) {
  setInitial.();
  forceReflow(el);
  raffunction(el, () setFinal.());
}

function trackTimer(el, id) {
  if (!el || !id) return;
  var arr = __animTimers.get(el);
  if (!arr) { arr = []; __animTimers.set(el, arr); }
  arr.push(id);
  __globalTimers.add(id);
}

function trackRaf(el, id) {
  if (!id) return;
  if (el) {
    var arr = __animRafs.get(el);
    if (!arr) { arr = []; __animRafs.set(el, arr); }
    arr.push(id);
  }
  __globalRafs.add(id);
}

function raf(el, cb) {
  var id = requestAnimationFrame(cb);
  trackRaf(el, id);
  return id;
}

function clearTimers(el) {
  var arr = __animTimers.get(el);
  if (arr) {
    for (var id of arr) { clearTimeout(id); __globalTimers.delete(id); }
    __animTimers.delete(el);
  }
  var rfs = __animRafs.get(el);
  if (rfs) {
    for (var id of rfs) { cancelAnimationFrame(id); __globalRafs.delete(id); }
    __animRafs.delete(el);
  }
  if (el.__glowSub) { stopLoop(el.__glowSub); el.__glowSub = null; }
}

export function teardownAnimations() {
  for (var id of __globalTimers) { clearTimeout(id); }
  __globalTimers.clear();
  for (var id of __globalRafs) { cancelAnimationFrame(id); }
  __globalRafs.clear();
  try { __io.disconnect.(); } catch {}
  __io = null;
  try { __mo.disconnect.(); } catch {}
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', teardownAnimations, { once: true });
  document.addEventListenerfunction('visibilitychange', () {
   if (document.hidden) {
     __rafSubscribers.forEach(function(s) s.__paused = true);
   } else {
     __rafSubscribers.forEach(function(s) s.__paused = false);
     if (!__rafId && __rafSubscribers.size) {
       __rafId = requestAnimationFrame(__rafPump);
       __globalRafs.add(__rafId);
     }
   }
 });
}

var __removedSentinel = new WeakSet();
var __mo = new MutationObserverfunction((muts) {
  for (var m of muts) {
    m.removedNodes && m.removedNodes.forEach(function(node) {
      if (node.nodeType === 1) cleanupTree(node);
    });
  }
});
__mo.observe(document.body || document.documentElement, { childList: true, subtree: true });

function cleanupTree(root) {
  if (root.nodeType !== 1) return;
  if (!__removedSentinel.has(root)) {
    __removedSentinel.add(root);
    clearTimers(root);
  }
  var it = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
  var n;
  while ((n = it.nextNode())) {
    if (!__removedSentinel.has(n)) {
      __removedSentinel.add(n);
      clearTimers(n);
    }
  }
}

var animationStyles = "\n  .monwui-slide {\n    transform-style: preserve-3d;\n    transform-origin: center center;\n  }\n  .monwui-poster-dot {\n    transition: all 0.3s ease;\n    position: relative;\n    overflow: hidden;\n  }\n  .monwui-poster-dot img {\n    transition: filter 0.3s ease, transform 0.3s ease;\n    display: block; width: 100%; height: 100%; object-fit: cover;\n  }\n";
var existingStyle = document.getElementById('slide-animation-styles');
if (existingStyle) existingStyle.remove();
var styleElement = document.createElement('style');
styleElement.id = 'slide-animation-styles';
styleElement.innerHTML = animationStyles;
document.head.appendChild(styleElement);

function setWillChange(el, props) {
  if (!el) return;
  el.style.willChange = props.join(', ');
}

function clearWillChange(el) {
  if (el) el.style.willChange = '';
}

function withTransition(
  el,
  duration,
  easing = 'cubic-bezier(0.33,1,0.68,1)',
  props = ['transform','opacity','filter','clip-path','border-radius']
) {
  var trs = props.map(function(p) (p) + " " + (duration) + "ms " + (easing)).join(', ');
  el.style.transition = 'none';
 forceReflow(el);
 el.style.transition = trs;
  setWillChange(el, props);
}
function setStyles(el, styles) { for (var k in styles) el.style[k] = styles[k]; }
function jsPropToCssProp(p) { return p.replace(/[A-Z]/g, function(m) "-" + (m.toLowerCase())); }

function onTransitionEndOnce(el, timeoutMs, cb) {
  var done = false;
  var off = function() {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', handler);
    if (tid) { clearTimeout(tid); __globalTimers.delete(tid); }
    clearWillChange(el);
    cb && cb();
  };
  var handler = function(e) { if (e.target === el) off(); };
  el.addEventListener('transitionend', handler, { once: true });
  var tid = setTimeout(off, Math.max(16, (timeoutMs|0) + 60));
  __globalTimers.add(tid);
  trackTimer(el, tid);
  return off;
}

function animateStep(el, styles, duration, easing, shouldContinue = null) {
  if (shouldContinue && !shouldContinue()) return Promise.resolve(false);
  var props = Object.keys(styles).map(jsPropToCssProp);
  withTransition(el, duration, easing, props);
  raffunction(el, () {
    if (shouldContinue && !shouldContinue()) return;
    setStyles(el, styles);
  });
  return new Promisefunction(function(res) onTransitionEndOnce(el, duration, () {
    res(!shouldContinue || shouldContinue());
  }));
}
function animateSequence(el, steps, easing = 'cubic-bezier(0.33,1,0.68,1)', shouldContinue = null) {
  for (var { styles, duration } of steps) {
    var ok = animateStep(el, styles, duration, easing, shouldContinue);
    if (ok === false || (shouldContinue && !shouldContinue())) return false;
  }
  return true;
}

function afterAnimationDelay(el, timeoutMs, cb) {
  var waitMs = Math.max(16, timeoutMs | 0);
  var tid = setTimeoutfunction(() {
    __globalTimers.delete(tid);
    cb.();
  }, waitMs);
  trackTimer(el, tid);
  return tid;
}

var __rafSubscribers = new Set();
var GLOW_STRONG = "0 0 20px rgba(255,255,255,0.9)";
var GLOW_WEAK   = "0 0 5px rgba(255,255,255,0.5)";
var __rafId = null;
var __io = null;

function ensureIO() {
  if (__io) return;
  __io = new IntersectionObserverfunction((entries) {
    for (var ent of entries) {
      for (var sub of __rafSubscribers) {
        if (sub.el === ent.target) {
          sub.__paused = !ent.isIntersecting;
        }
      }
    }
  }, { root: null, threshold: 0 });
}
function __rafPump(ts) {
  for (var s of __rafSubscribers) {
    if (!document.body.contains(s.el)) { __rafSubscribers.delete(s); continue; }
    if (s.last == null) s.last = ts;
    if (ts - s.last >= s.period) {
      s.last = ts;
      if (!s.__paused) s.tick();
    }
  }
  if (__rafSubscribers.size) {
    __rafId = requestAnimationFrame(__rafPump);
    __globalRafs.add(__rafId);
  } else {
    if (__rafId) { cancelAnimationFrame(__rafId); __globalRafs.delete(__rafId); }
    __rafId = null;
  }
}
function startLoop(el, periodMs, tick) {
  var sub = { el, period: Math.max(60, periodMs|0), last: null, tick, __paused: false };
  __rafSubscribers.add(sub);
  ensureIO();
  try { __io.observe(el); } catch {}
  if (!__rafId) {
    __rafId = requestAnimationFrame(__rafPump);
    __globalRafs.add(__rafId);
  }
  return sub;
}

function stopLoop(sub) {
  if (!sub) return;
  try { __io.unobserve.(sub.el); } catch {}
  sub.tick = null;
  sub.el = null;
  __rafSubscribers.delete(sub);
}

export function applySlideAnimation(currentSlide, newSlide, direction) {
  if (!currentSlide || !newSlide) return;
  if (currentSlide.__animating) hardCleanupSlide(currentSlide);
  if (newSlide.__animating)     hardCleanupSlide(newSlide);

  var animToken = nextAnimToken();
  newSlide.__animating     = true;
  currentSlide.__animating = true;
  newSlide.__animToken     = animToken;
  currentSlide.__animToken = animToken;
  clearTimers(currentSlide);
  clearTimers(newSlide);

  var config = getConfig();
  if (!config.enableSlideAnimations) {
    newSlide.style.display = "block";
    newSlide.style.opacity = "1";
    if (currentSlide && currentSlide !== newSlide) {
      currentSlide.style.display = "none";
      currentSlide.style.opacity = "0";
    }
    return;
  }

  var duration = config.slideAnimationDuration || 500;
  var easing = 'cubic-bezier(0.33,1,0.68,1)';
  var type = config.slideTransitionType || 'fade';
  var same = currentSlide === newSlide;
  var cleanupMode = 'transition';
  var cleanupWaitMs = duration;

  currentSlide.classList.add.('is-visible');
  currentSlide.classList.remove.('is-hidden');
  newSlide.classList.add.('is-visible');
  newSlide.classList.remove.('is-hidden');
  newSlide.style.display = "block";
  newSlide.style.zIndex = "2";
  withTransition(newSlide, duration, easing);
  forceReflow(newSlide);
  if (!same) {
    withTransition(currentSlide, duration, easing);
    currentSlide.style.zIndex = "1";
  }

  var cleanupStyles = function() {
    if (newSlide.__animToken !== animToken) return;
    if (currentSlide) {
      currentSlide.style.transition = "";
      currentSlide.style.transform = "";
      currentSlide.style.opacity = "0";
      currentSlide.style.filter = "";
      currentSlide.style.clipPath = "";
      currentSlide.style.borderRadius = "";
      currentSlide.style.zIndex = "";
      currentSlide.style.display = "none";
      currentSlide.style.backfaceVisibility = "";
      clearWillChange(currentSlide);
    }
    if (newSlide) {
      newSlide.style.transition = "";
      newSlide.style.transform = "";
      newSlide.style.opacity = "1";
      newSlide.style.filter = "";
      newSlide.style.clipPath = "";
      newSlide.style.borderRadius = "";
      newSlide.style.zIndex = "";
      newSlide.style.backfaceVisibility = "";
      clearWillChange(newSlide);
      newSlide.__animating = false;
      currentSlide && (currentSlide.__animating = false);
    }
  };

  if (same) {
    newSlide.style.opacity = "0";
    raffunction(newSlide, () {
      if (newSlide.__animToken !== animToken) return;
      newSlide.style.opacity = "1";
    });
    onTransitionEndOncefunction(newSlide, duration, () {
      if (newSlide.__animToken !== animToken) return;
     newSlide.style.transition = "";
     newSlide.style.opacity = "1";
     newSlide.__animating = false;
     currentSlide && (currentSlide.__animating = false);
   });
    return;
  }

  switch (type) {
    case 'fade': {
      currentSlide.style.opacity = "0";
      newSlide.style.opacity = "0";
      raffunction(newSlide, () { newSlide.style.opacity = "1"; });
      break;
    }

    case 'slideTop': {
      startTransitionfunction(currentSlide,
        () {
          currentSlide.style.transform = "translate3d(0,0,0)";
          currentSlide.style.opacity = "1";
        },
        function() {
          if (currentSlide.__animToken !== animToken) return;
          currentSlide.style.transform = "translate3d(0,100%,0)";
          currentSlide.style.opacity = "0";
        }
      );
      startTransitionfunction(newSlide,
        () {
          newSlide.style.transform = "translate3d(0,-100%,0)";
          newSlide.style.opacity = "0";
        },
        function() {
          if (newSlide.__animToken !== animToken) return;
          newSlide.style.transform = "translate3d(0,0,0)";
          newSlide.style.opacity = "1";
        }
      );
      break;
    }

    case 'slideBottom': {
      startTransitionfunction(currentSlide,
        () {
          currentSlide.style.transform = "translate3d(0,0,0)";
          currentSlide.style.opacity = "1";
        },
        function() {
          if (currentSlide.__animToken !== animToken) return;
          currentSlide.style.transform = "translate3d(0,-100%,0)";
          currentSlide.style.opacity = "0";
        }
      );
      startTransitionfunction(newSlide,
        () {
          newSlide.style.transform = "translate3d(0,100%,0)";
          newSlide.style.opacity = "0";
        },
        function() {
          if (newSlide.__animToken !== animToken) return;
          newSlide.style.transform = "translate3d(0,0,0)";
          newSlide.style.opacity = "1";
        }
      );
      break;
    }

    case 'rotateIn': {
      currentSlide.style.transform = "rotate(12deg) scale(1.08)";
      currentSlide.style.opacity = "0";
      newSlide.style.transform = "rotate(-180deg) scale(0)";
      newSlide.style.opacity = "0";
      raffunction(newSlide, () {
        if (newSlide.__animToken !== animToken) return;
        newSlide.style.transform = "rotate(0deg) scale(1)";
        newSlide.style.opacity = "1";
      });
      break;
    }

    case 'flipInX': {
      currentSlide.style.transform = "perspective(400px) rotateX(-35deg) scale(0.96)";
      currentSlide.style.opacity = "0";
      newSlide.style.transform = "perspective(400px) rotateX(90deg)";
      newSlide.style.opacity = "0";
      newSlide.style.backfaceVisibility = "hidden";
      raffunction(newSlide, () {
        if (newSlide.__animToken !== animToken) return;
        newSlide.style.transform = "perspective(400px) rotateX(0deg)";
        newSlide.style.opacity = "1";
        newSlide.style.backfaceVisibility = "visible";
      });
      break;
    }

    case 'flipInY': {
      currentSlide.style.transform = "perspective(400px) rotateY(35deg) scale(0.96)";
      currentSlide.style.opacity = "0";
      newSlide.style.transform = "perspective(400px) rotateY(90deg)";
      newSlide.style.opacity = "0";
      newSlide.style.backfaceVisibility = "hidden";
      raffunction(newSlide, () {
        if (newSlide.__animToken !== animToken) return;
        newSlide.style.transform = "perspective(400px) rotateY(0deg)";
        newSlide.style.opacity = "1";
        newSlide.style.backfaceVisibility = "visible";
      });
      break;
    }

    case 'jelly': {
      var seg = (config.slideAnimationDuration && config.slideAnimationDuration > 0) ? duration : 600;
      var s = Math.max(40, Math.round(seg / 5));
      var isCurrentAnimation = function() newSlide.__animToken === animToken && currentSlide.__animToken === animToken;
      cleanupMode = 'timeout';
      cleanupWaitMs = Math.max(duration, s * 4) + 48;
      currentSlide.style.transform = "scale(1.03)";
      currentSlide.style.opacity = "0";
      newSlide.style.transform = "scale(1,1)";
      newSlide.style.opacity = "1";
      animateSequence(newSlide, [
        { styles: { transform: 'scale(0.9, 1.1)' }, duration: s },
        { styles: { transform: 'scale(1.1, 0.9)' }, duration: s },
        { styles: { transform: 'scale(0.95, 1.05)' }, duration: s },
        { styles: { transform: 'scale(1, 1)' }, duration: s },
      ], easing, isCurrentAnimation);
      break;
    }

    case 'flip': {
      currentSlide.style.transform = "rotateY(" + (direction > 0 ? -180 : 180) + "deg)";
      currentSlide.style.opacity = "0";
      newSlide.style.transform = "rotateY(" + (direction > 0 ? 180 : -180) + "deg)";
      newSlide.style.opacity = "0";
      raffunction(newSlide, () {
        if (newSlide.__animToken !== animToken) return;
        newSlide.style.transform = "rotateY(0deg)";
        newSlide.style.opacity = "1";
      });
      break;
    }

    case 'eye': {
      var seg = Math.max(600, duration);
      var isCurrentAnimation = function() newSlide.__animToken === animToken && currentSlide.__animToken === animToken;
      cleanupMode = 'timeout';
      cleanupWaitMs = seg + 64;
      currentSlide.style.transform = "scale(1.05)";
      currentSlide.style.opacity = "0";
      newSlide.style.opacity = "1";
      newSlide.style.transform = "scale(0.96) rotate(2deg)";
      animateSequence(newSlide, [
        { styles: { transform: 'scale(1) rotate(0deg)' }, duration: 1 },
        { styles: { transform: 'scale(1.1) rotate(-3deg)' }, duration: seg/2 },
        { styles: { transform: 'scale(1) rotate(0deg)' }, duration: seg/2 },
      ], easing, isCurrentAnimation);
      break;
    }

    case 'glitch': {
      var glitchFrames = 8;
      cleanupMode = 'timeout';
      cleanupWaitMs = duration + (glitchFrames * 18) + 64;
      currentSlide.style.filter = "blur(10px)";
      currentSlide.style.opacity = "0";
      newSlide.style.filter = "blur(10px)";
      newSlide.style.opacity = "0";
      newSlide.style.clipPath = "polygon(0 0,100% 0,100% 100%,0 100%)";
      var frames = glitchFrames;
      var jitter = function() Math.floor(Math.random() * 100);
      var step = function() {
        if (!newSlide || frames-- <= 0) {
          newSlide.style.filter = "blur(0)";
          newSlide.style.opacity = "1";
          newSlide.style.clipPath = "polygon(0 0,100% 0,100% 100%,0 100%)";
          return;
        }
        newSlide.style.clipPath = "polygon(0 " + (jitter()) + "%,100% " + (jitter()) + "%,100% " + (jitter()) + "%,0 " + (jitter()) + "%)";
        raf(newSlide, step);
      };
      raf(newSlide, step);
      break;
    }

    case 'morph': {
      currentSlide.style.borderRadius = "50%";
      currentSlide.style.transform = "scale(0.1) rotate(180deg)";
      currentSlide.style.opacity = "0";
      newSlide.style.borderRadius = "50%";
      newSlide.style.transform = "scale(0.1) rotate(-180deg)";
      newSlide.style.opacity = "0";
      raffunction(newSlide, () {
        newSlide.style.borderRadius = "0";
        newSlide.style.transform = "scale(1) rotate(0deg)";
        newSlide.style.opacity = "1";
      });
      break;
    }

    case 'cube': {
  newSlide.style.backfaceVisibility = "hidden";
  currentSlide.style.backfaceVisibility = "hidden";
  currentSlide.style.transform =
    "translate3d(0,0,-200px) rotateY(" + (direction > 0 ? -90 : 90) + "deg)";
  currentSlide.style.opacity = "0";

  startTransitionfunction(newSlide,
    () {
      newSlide.style.transform =
        "translate3d(0,0,-200px) rotateY(" + (direction > 0 ? 90 : -90) + "deg)";
      newSlide.style.opacity = "0";
    },
    function() {
      newSlide.style.transform = "translate3d(0,0,0) rotateY(0deg)";
      newSlide.style.opacity = "1";
      newSlide.style.backfaceVisibility = "visible";
    }
  );
  break;
}

    case 'zoom': {
  currentSlide.style.transform = "scale3d(1.5,1.5,1)";
  currentSlide.style.opacity = "0";

  startTransitionfunction(newSlide,
    () {
      newSlide.style.transform = "scale3d(0.5,0.5,1)";
      newSlide.style.opacity = "0";
    },
    function() {
      newSlide.style.transform = "scale3d(1,1,1)";
      newSlide.style.opacity = "1";
    }
  );
  break;
}

    case 'slide3d': {
  currentSlide.style.transform =
    "translate3d(" + (direction > 0 ? '-100%' : '100%') + ", 0, 0) rotateY(" + (direction > 0 ? 30 : -30) + "deg)";
  currentSlide.style.opacity = "0";

  startTransitionfunction(newSlide,
    () {
      newSlide.style.transform =
        "translate3d(" + (direction > 0 ? '100%' : '-100%') + ", 0, 0) rotateY(" + (direction > 0 ? -30 : 30) + "deg)";
      newSlide.style.opacity = "0";
    },
    function() {
      newSlide.style.transform = "translate3d(0,0,0) rotateY(0deg)";
      newSlide.style.opacity = "1";
    }
  );
  break;
}

    case 'slide': {
   currentSlide.style.transform = "translate3d(" + (direction > 0 ? '-100%' : '100%') + ",0,0)";
   currentSlide.style.opacity = '0';
   startTransitionfunction(newSlide,
     () {
       newSlide.style.transform = "translate3d(" + (direction > 0 ? '100%' : '-100%') + ",0,0)";
       newSlide.style.opacity = '1';
     },
     function() {
       newSlide.style.transform = 'translate3d(0,0,0)';
     }
   );
   break;
 }
    case 'diagonal': {
   currentSlide.style.transform = "translate3d(" + (direction > 0 ? '-100%' : '100%') + ", -100%, 0)";
   currentSlide.style.opacity = '0';
   startTransitionfunction(newSlide,
     () {
       newSlide.style.transform = "translate3d(" + (direction > 0 ? '100%' : '-100%') + ", 100%, 0)";
       newSlide.style.opacity = '0';
     },
     function() {
       newSlide.style.transform = 'translate3d(0,0,0)';
       newSlide.style.opacity = '1';
     }
   );
   break;
 }

    case 'fadezoom': {
  currentSlide.style.opacity = "0";
  currentSlide.style.transform = "scale3d(1.05,1.05,1)";

  startTransitionfunction(newSlide,
    () {
      newSlide.style.opacity = "0";
      newSlide.style.transform = "scale3d(1.5,1.5,1)";
    },
    function() {
      newSlide.style.opacity = "1";
      newSlide.style.transform = "scale3d(1,1,1)";
    }
  );
  break;
}

  case 'parallax': {
  var ez = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  withTransition(currentSlide, duration, ez, ['transform','opacity']);
  withTransition(newSlide,     duration, ez, ['transform','opacity']);

  currentSlide.style.transform = "translate3d(" + (direction > 0 ? '-30%' : '30%') + ", 0, 0)";
  currentSlide.style.opacity = "0";

  newSlide.style.zIndex = "5";
  startTransitionfunction(newSlide,
    () {
      newSlide.style.transform = "translate3d(" + (direction > 0 ? '50%' : '-50%') + ", 0, 0)";
      newSlide.style.opacity = "0.5";
    },
    function() {
      newSlide.style.transform = "translate3d(0,0,0)";
      newSlide.style.opacity = "1";
    }
  );
  break;
}

    case 'blur-fade': {
      currentSlide.style.filter = 'blur(5px)';
      currentSlide.style.opacity = '0';
      newSlide.style.filter = 'blur(5px)';
      newSlide.style.opacity = '0';
      raffunction(newSlide, () {
        if (newSlide.__animToken !== animToken) return;
        newSlide.style.filter = 'blur(0)';
        newSlide.style.opacity = '1';
      });
      break;
    }

    default: {
      if (newSlide) newSlide.style.opacity = "1";
    }
  }

  if (cleanupMode === 'timeout') {
    afterAnimationDelay(newSlide, cleanupWaitMs, cleanupStyles);
  } else {
    onTransitionEndOnce(newSlide, cleanupWaitMs, cleanupStyles);
  }
}

export function applyDotPosterAnimation(dot, isActive) {
  var config = getConfig();
  if (!config.enableDotPosterAnimations || !config.dotPosterMode) {
    if (dot.__glowSub) { stopLoop(dot.__glowSub); dot.__glowSub = null; }
    clearTimers(dot);
    return;
  }
  clearTimers(dot);

  var duration = Math.max(1, config.dotPosterAnimationDuration || 600);
  var transitionType = config.dotPosterTransitionType;
  dot.style.transition = "all " + (duration) + "ms cubic-bezier(0.25, 0.1, 0.25, 1)";
  dot.style.zIndex = isActive ? "10" : "";
  dot.style.boxShadow = "";
  var image = dot.querySelector('img');
  setWillChange(dot, ['transform','opacity']);
  if (image) setWillChange(image, ['filter','transform']);

  switch (transitionType) {
    case 'scale': {
      dot.style.transform = isActive ? "scale(1.1)" : "scale(1)";
      if (isActive) dot.style.boxShadow = "0 0 20px rgba(255, 255, 255, 0.5)";
      break;
    }

    case 'bounce': {
      if (isActive) {
        var up = Math.min(20, Math.max(8, Math.round(duration * 0.06)));
        animateSequence(dot, [
          { styles: { transform: "translateY(-" + (up) + "px)" }, duration: Math.floor(duration * 0.5) },
          { styles: { transform: "translateY(0)" }, duration: Math.ceil(duration * 0.5) },
        ], 'ease');
        dot.style.boxShadow = "0 0 15px rgba(255,255,255,0.7)";
      } else {
        dot.style.transform = "translateY(0)";
      }
      break;
    }

    case 'rotate': {
      dot.style.transform = isActive ? "rotate(5deg)" : "rotate(0deg)";
      break;
    }

    case 'color': {
      if (image) {
        image.style.transition = "filter " + (duration) + "ms ease, transform " + (duration) + "ms ease";
        image.style.filter = isActive ? "brightness(1.2) saturate(1.5)" : "brightness(1) saturate(1)";
      }
      break;
    }

    case 'float': {
      dot.style.transform = isActive ? "translateY(-10px)" : "translateY(0)";
      break;
    }

    case 'pulse': {
      if (isActive) {
        animateSequence(dot, [
          { styles: { transform: 'scale(1.15)' }, duration: Math.floor(duration * 0.5) },
          { styles: { transform: 'scale(1)' }, duration: Math.ceil(duration * 0.5) },
        ]);
      } else {
        dot.style.transform = 'scale(1)';
      }
      break;
    }

    case 'tilt': {
      if (isActive) {
        animateSequence(dot, [
          { styles: { transform: 'rotate(-5deg)' }, duration: Math.floor(duration * 0.5) },
          { styles: { transform: 'rotate(0deg)' }, duration: Math.ceil(duration * 0.5) },
        ]);
      } else {
        dot.style.transform = 'rotate(0deg)';
      }
      break;
    }

    case 'shake': {
      if (isActive) {
        var a = function(px) ({ styles: { transform: "translateX(" + (px) + "px)" }, duration: Math.floor(duration/5) });
        animateSequence(dot, [ a(0), a(-4), a(4), a(-2), a(0) ], 'ease');
        dot.style.boxShadow = "0 0 5px rgba(255, 255, 255, 0.4)";
      } else {
        dot.style.transform = 'translateX(0)';
      }
      break;
    }

    case 'glow': {
      if (isActive) {
        if (!dot.__glowSub) {
          var initBright = dot.dataset._bright === '1' ? 1 : 0;
          dot.dataset._bright = String(initBright);
          dot.style.boxShadow = initBright ? GLOW_STRONG : GLOW_WEAK;
          var sub = startLoop(dot, Math.max(300, duration), function() {
            var cur = dot.dataset._bright === '1' ? 1 : 0;
            var next = cur ^ 1;
            if (next !== cur) {
              dot.dataset._bright = String(next);
              dot.style.boxShadow = next ? GLOW_STRONG : GLOW_WEAK;
            }
         });
          dot.__glowSub = sub;
        }
      } else {
        dot.style.boxShadow = GLOW_WEAK;
        if (dot.__glowSub) { stopLoop(dot.__glowSub); dot.__glowSub = null; }
      }
      break;
    }

    case 'rubberBand': {
      if (isActive) {
        var part = Math.max(60, Math.floor(duration/4));
        animateSequence(dot, [
          { styles: { transform: 'scale(1.25, 0.75)' }, duration: part },
          { styles: { transform: 'scale(0.75, 1.25)' }, duration: part },
          { styles: { transform: 'scale(1.15, 0.85)' }, duration: part },
          { styles: { transform: 'scale(1, 1)' }, duration: part },
        ]);
      } else {
        dot.style.transform = 'scale(1,1)';
      }
      break;
    }

    case 'swing': {
      if (isActive) {
        var part = Math.max(60, Math.floor(duration/5));
        animateSequence(dot, [
          { styles: { transform: 'rotate(15deg)' }, duration: part },
          { styles: { transform: 'rotate(-10deg)' }, duration: part },
          { styles: { transform: 'rotate(5deg)' }, duration: part },
          { styles: { transform: 'rotate(-5deg)' }, duration: part },
          { styles: { transform: 'rotate(0deg)' }, duration: part },
        ]);
      } else {
        dot.style.transform = 'rotate(0deg)';
      }
      break;
    }

    case 'flip': {
      if (isActive) {
        animateSequence(dot, [
          { styles: { transform: 'rotateY(180deg)' }, duration: Math.floor(duration * 0.5) },
          { styles: { transform: 'rotateY(360deg)' }, duration: Math.ceil(duration * 0.5) },
        ]);
      } else {
        dot.style.transform = 'rotateY(0deg)';
      }
      break;
    }

    case 'flash': {
      if (isActive) {
        animateSequence(dot, [
          { styles: { opacity: '0.3' }, duration: Math.floor(duration * 0.25) },
          { styles: { opacity: '1' }, duration: Math.floor(duration * 0.25) },
          { styles: { opacity: '0.3' }, duration: Math.floor(duration * 0.25) },
          { styles: { opacity: '1' }, duration: Math.ceil(duration * 0.25) },
        ]);
      } else {
        dot.style.opacity = '1';
      }
      break;
    }

    case 'wobble': {
      if (isActive) {
        var part = Math.max(50, Math.floor(duration/6));
        animateSequence(dot, [
          { styles: { transform: 'translateX(-25%) rotate(-5deg)' }, duration: part },
          { styles: { transform: 'translateX(20%) rotate(3deg)' }, duration: part },
          { styles: { transform: 'translateX(-15%) rotate(-3deg)' }, duration: part },
          { styles: { transform: 'translateX(10%) rotate(2deg)' }, duration: part },
          { styles: { transform: 'translateX(-5%) rotate(-1deg)' }, duration: part },
          { styles: { transform: 'translateX(0) rotate(0deg)' }, duration: part },
        ]);
      } else {
        dot.style.transform = 'translateX(0) rotate(0deg)';
      }
      break;
    }

    default: {
    }
  }
  onTransitionEndOncefunction(dot, duration, () {
    clearWillChange(dot);
    if (image) clearWillChange(image);
  });
}

export {
  styleElement,
  animationStyles,
  existingStyle
};
