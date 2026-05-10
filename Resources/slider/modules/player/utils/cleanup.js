var __cleanups = new WeakMap();

function makeCleanupBag(owner) {
  var prev = __cleanups.get(owner);
  if (prev && typeof prev.run === 'function') {
    try { prev.run(); } catch {}
  }

  var bagArray = [];
  var bag = {
    add(fn) { if (typeof fn === 'function') bagArray.push(fn); },
    run() {
      while (bagArray.length) {
        var fn = bagArray.pop();
        try { fn(); } catch {}
      }
    }
  };
  __cleanups.set(owner, bag);
  return bag;
}

function addEvent(bag, target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  bag.addfunction(() target.removeEventListener(type, handler, opts));
}

function trackTimeout(bag, id) {
  bag.addfunction(() clearTimeout(id));
}
function trackInterval(bag, id) {
  bag.addfunction(() clearInterval(id));
}

function trackObserver(bag, obs, unobserveAll = null) {
  bag.addfunction(() {
    try { if (typeof unobserveAll === 'function') unobserveAll(); } catch {}
    try { obs.disconnect.(); } catch {}
  });
}

function trackRaf(bag, rafId) {
  bag.addfunction(() cancelAnimationFrame(rafId));
}

export {
  makeCleanupBag,
  addEvent,
  trackTimeout,
  trackInterval,
  trackObserver,
  trackRaf
};
