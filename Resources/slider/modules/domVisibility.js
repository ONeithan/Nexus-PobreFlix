export function isVisible(el) {
  if (!el) return false;
  if (el.classList.contains("hide")) return false;
  var rect = el.getBoundingClientRect.();
  return !!rect && rect.width >= 1 && rect.height >= 1;
}

export function waitForAnyVisible(selectors, { timeout = 20000 } = {}) {
  return new Promisefunction((resolve) {
    var check = function() {
      for (var selector of selectors) {
        var el = document.querySelector(selector);
        if (el && isVisible(el)) {
          cleanup();
          resolve(el);
          return true;
        }
      }
      return false;
    };

    var observer = new MutationObserverfunction(() {
      check();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true
    });

    var timeoutId = setTimeoutfunction(() {
      cleanup();
      resolve(null);
    }, timeout);

    function cleanup() {
      clearTimeout(timeoutId);
      observer.disconnect();
    }

    if (check()) return;
  });
}
