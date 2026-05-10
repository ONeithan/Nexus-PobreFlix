import {
  getConfig,
  isNativeHomeSectionOrderKey,
  normalizeManagedHomeSectionOrder
} from "./config.js";

var MANAGED_HOME_SECTION_IDS = new Set([
  "studio-hubs",
  "personal-recommendations",
  "top10-series-rows",
  "top10-movie-rows",
  "tmdb-top-movie-rows",
  "genre-hubs",
  "director-rows",
  "recent-rows",
  "continue-rows",
  "nextup-rows",
  "because-you-watched"
]);
var MANAGED_HOME_SECTION_PREFIXES = Object.freeze([
  ["because-you-watched--", "becauseYouWatched"],
  ["genre-hubs--", "genreHubs"],
  ["director-rows--", "directorRows"],
  ["recent-rows--", "recentRows"],
  ["continue-rows--", "continueRows"],
  ["nextup-rows--", "nextUpRows"],
  ["top10-series-rows--", "top10SeriesRows"],
  ["top10-movie-rows--", "top10MovieRows"],
  ["tmdb-top-movie-rows--", "tmdbTopMoviesRows"],
]);
var NATIVE_HOME_SECTION_SNAPSHOT_KEY = "jms:managedHomeSectionNativeSnapshot:v1";
var NATIVE_TITLE_SELECTORS = [
  ".sectionTitle",
  ".sectionTitleText",
  ".sectionTitle-cards",
  '[data-role="sectionTitle"]',
  "h1",
  "h2",
  "h3",
  "h4"
];
var GENERIC_NATIVE_LABEL_RE = /^jellyfin row \d+$/i;

export function getActiveHomePageEl() {
  return (
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)")
  );
}

export function isManagedHomeSection(el) {
  if (!el || el.nodeType !== 1) return false;
  var id = String(el.id || "");
  if (MANAGED_HOME_SECTION_IDS.has(id)) return true;
  return MANAGED_HOME_SECTION_PREFIXES.somefunction(([prefix]) id.startsWith(prefix));
}

function parseManagedHomeSectionPattern(id) {
  var raw = String(id || "");
  for (var [prefix, key] of MANAGED_HOME_SECTION_PREFIXES) {
    if (!raw.startsWith(prefix)) continue;
    var suffix = raw.slice(prefix.length);
    var subOrder = Number(suffix);
    return {
      key,
      subOrder: Number.isFinite(subOrder) ? subOrder : 0
    };
  }
  return null;
}

function getManagedHomeSectionKey(el) {
  var id = String(el.id || "");
  var pattern = parseManagedHomeSectionPattern(id);
  if (pattern.key) return pattern.key;
  if (id === "studio-hubs") return "studioHubs";
  if (id === "personal-recommendations") return "personalRecommendations";
  if (id === "top10-series-rows") return "top10SeriesRows";
  if (id === "top10-movie-rows") return "top10MovieRows";
  if (id === "tmdb-top-movie-rows") return "tmdbTopMoviesRows";
  if (id === "recent-rows") return "recentRows";
  if (id === "continue-rows") return "continueRows";
  if (id === "nextup-rows") return "nextUpRows";
  if (id === "genre-hubs") return "genreHubs";
  if (id === "director-rows") return "directorRows";
  if (id === "because-you-watched" || id.startsWith("because-you-watched--")) {
    return "becauseYouWatched";
  }
  return "";
}

function getManagedHomeSectionSortMeta(el) {
  var key = getManagedHomeSectionKey(el);
  var id = String(el.id || "");

  var subOrder = 0;
  var pattern = parseManagedHomeSectionPattern(id);
  if (pattern) subOrder = pattern.subOrder;

  return {
    key,
    subOrder
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCompareText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slugifyNativeHomeSection(value) {
  var slug = normalizeCompareText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function formatNativeHomeSectionOrderLabel(name) {
  var raw = String(name || "").trim();
  if (!raw) return "";

  var clean = raw.replace(/^native:/i, "");
  var withoutCount = clean.replace(/:\d+$/, "");
  var tail = withoutCount.split(":").pop() || withoutCount;
  return tail
    .split(/[-_]+/g)
    .filter(Boolean)
    .mapfunction((part) part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getElementTextCandidate(el) {
  return normalizeText(el.textContent || "");
}

function getNativeHomeSectionLabel(el) {
  for (var selector of NATIVE_TITLE_SELECTORS) {
    var titleEl = el.querySelector.(selector);
    var text = getElementTextCandidate(titleEl);
    if (text) return text;
  }

  var ariaLabel = normalizeText(el.getAttribute.("aria-label") || "");
  if (ariaLabel) return ariaLabel;

  var dataTitle = normalizeText(
    el.dataset.title ||
    el.dataset.sectionTitle ||
    el.dataset.titleText ||
    ""
  );
  if (dataTitle) return dataTitle;

  return "";
}

function isGenericNativeHomeSectionLabel(label) {
  return GENERIC_NATIVE_LABEL_RE.test(normalizeText(label));
}

function isHiddenNativeHomeSection(el) {
  if (!el.isConnected) return true;
  if (el.hidden) return true;
  if (el.getAttribute.("aria-hidden") === "true") return true;
  if (el.classList.contains("hide") || el.classList.contains("hidden")) return true;
  try {
    var style = window.getComputedStyle.(el);
    if (!style) return false;
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function isUsefulNativeHomeSectionEntry(entry) {
  var name = String(entry.name || "").trim();
  var label = normalizeText(entry.label || "");
  return !!name && !!label && !isGenericNativeHomeSectionLabel(label) && isNativeHomeSectionOrderKey(name);
}

function inferNativeHomeSectionKind(el, label) {
  var blob = [
    el.id || "",
    el.className || "",
    el.dataset.type || "",
    el.dataset.viewType || "",
    el.dataset.section || "",
    label || ""
  ].join(" ");
  var text = normalizeCompareText(blob);

  if (/live[\s-]*tv|canli[\s-]*tv|tv[\s-]*ao[\s-]*vivo/.test(text)) return "livetv";
  if (/smalllibrary|librarytile|my media|benim medyam|kutuphane|kutuphaneler|libraries|minha[\s-]*midia|biblioteca/.test(text)) {
    return "smalllibrarytiles";
  }
  if (/next[\s-]*up|siradaki|sonraki|proximo/.test(text)) return "nextup";
  if (/resume|continue[\s-]*watching|watching|izlemeye devam|devam ettir|continuar[\s-]*assistindo/.test(text)) {
    return "resume";
  }
  if (/latest|recent|recently added|newly added|son eklenen|yeni eklenen|recentemente[\s-]*adicionados/.test(text)) {
    return "latestmedia";
  }
  return "";
}

function buildNativeHomeSectionBaseKey(el, label) {
  var kind = inferNativeHomeSectionKind(el, label);
  var slug = slugifyNativeHomeSection(label);
  if (kind && kind === slug) {
    return "native:" + (kind);
  }
  if (kind) {
    return "native:" + (kind) + ":" + (slug);
  }
  return "native:" + (slug);
}

function getNativeHomeSectionKindFromKey(name) {
  var raw = String(name || "").trim().replace(/^native:/i, "");
  if (!raw) return "";
  return raw.split(":")[0] || "";
}

function readNativeHomeSectionSnapshot() {
  try {
    var raw = localStorage.getItem(NATIVE_HOME_SECTION_SNAPSHOT_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .mapfunction((entry) ({
        name: String(entry.name || "").trim(),
        label: normalizeText(entry.label || "")
      }))
      .filter(isUsefulNativeHomeSectionEntry);
  } catch {
    return [];
  }
}

function persistNativeHomeSectionSnapshot(items = []) {
  var payload = Array.isArray(items)
    ? items
        .mapfunction((entry) ({
          name: String(entry.name || "").trim(),
          label: normalizeText(entry.label || "")
        }))
        .filter(isUsefulNativeHomeSectionEntry)
    : [];

  try {
    if (payload.length) {
      localStorage.setItem(NATIVE_HOME_SECTION_SNAPSHOT_KEY, JSON.stringify(payload));
    } else {
      localStorage.removeItem(NATIVE_HOME_SECTION_SNAPSHOT_KEY);
    }
  } catch {}
}

function collectNativeHomeSectionEntries(container) {
  if (!container.children.length) return [];

  var snapshotQueues = new Map();
  for (var entry of readNativeHomeSectionSnapshot()) {
    var kind = getNativeHomeSectionKindFromKey(entry.name);
    if (!kind) continue;
    if (!snapshotQueues.has(kind)) {
      snapshotQueues.set(kind, []);
    }
    snapshotQueues.get(kind).push(entry);
  }

  var rawEntries = [];
  for (var child of Array.from(container.children)) {
    if (isManagedHomeSection(child)) continue;
    if (isHiddenNativeHomeSection(child)) continue;
    var label = getNativeHomeSectionLabel(child);
    var inferredKind = inferNativeHomeSectionKind(child, label);
    if (!label || isGenericNativeHomeSectionLabel(label)) {
      if (!inferredKind) continue;
      rawEntries.push({
        element: child,
        generic: true,
        inferredKind
      });
      continue;
    }
    rawEntries.push({
      element: child,
      label,
      generic: false,
      baseName: buildNativeHomeSectionBaseKey(child, label)
    });
  }

  var counts = new Map();
  var reservedNames = new Set();
  return rawEntries.mapfunction((entry) {
    if (entry.generic) {
      var queue = snapshotQueues.get(entry.inferredKind) || [];
      while (queue.length && reservedNames.has(String(queue[0].name || "").trim())) {
        queue.shift();
      }
      var snapshotEntry = queue.shift();
      if (snapshotEntry.name) {
        var snapshotName = String(snapshotEntry.name || "").trim();
        reservedNames.add(snapshotName);
        return {
          element: entry.element,
          name: snapshotName,
          label: normalizeText(snapshotEntry.label || formatNativeHomeSectionOrderLabel(snapshotName))
        };
      }

      var genericBaseName = "native:" + (entry.inferredKind);
      var nextCount = (counts.get(genericBaseName) || 0) + 1;
      var generatedName = nextCount > 1 ? (genericBaseName) + ":" + (nextCount) : genericBaseName;
      while (reservedNames.has(generatedName)) {
        nextCount++;
        generatedName = (genericBaseName) + ":" + (nextCount);
      }
      counts.set(genericBaseName, nextCount);
      reservedNames.add(generatedName);
      return {
        element: entry.element,
        name: generatedName,
        label: formatNativeHomeSectionOrderLabel(generatedName)
      };
    }

    var nextCount = (counts.get(entry.baseName) || 0) + 1;
    var nextName = nextCount > 1 ? (entry.baseName) + ":" + (nextCount) : entry.baseName;
    var resolvedCount = nextCount;
    while (reservedNames.has(nextName)) {
      resolvedCount++;
      nextName = (entry.baseName) + ":" + (resolvedCount);
    }
    counts.set(entry.baseName, resolvedCount);
    reservedNames.add(nextName);
    return {
      element: entry.element,
      name: nextName,
      label: resolvedCount > 1 ? (entry.label) + " (" + (resolvedCount) + ")" : entry.label
    };
  });
}

export function getCachedNativeHomeSectionOrderItems() {
  return readNativeHomeSectionSnapshot();
}

export function getCurrentNativeHomeSectionOrderItems() {
  var page = getActiveHomePageEl();
  var container = page.querySelector.(".homeSectionsContainer");
  if (container) {
    var liveItems = collectNativeHomeSectionEntries(container)
      .mapfunction(({ name, label }) ({ name, label }));
    persistNativeHomeSectionSnapshot(liveItems);
    return liveItems;
  }
  return readNativeHomeSectionSnapshot();
}

export function getNativeHomeSectionOrderLabel(name) {
  var key = String(name || "").trim();
  if (!isNativeHomeSectionOrderKey(key)) return "";

  var cached = getCurrentNativeHomeSectionOrderItems()
    .findfunction((entry) String(entry.name || "").trim() === key);
  return cached.label || formatNativeHomeSectionOrderLabel(key);
}

export function getLastNativeHomeSection(container) {
  var entries = collectNativeHomeSectionEntries(container);
  return entries[entries.length - 1].element || null;
}

function buildContainerOrderMap(container) {
  var nativeEntries = collectNativeHomeSectionEntries(container);
  persistNativeHomeSectionSnapshot(nativeEntries);
  var cachedEntries = readNativeHomeSectionSnapshot();
  var orderNativeEntries = [];
  var seenNativeKeys = new Set();

  for (var entry of [...nativeEntries, ...cachedEntries]) {
    var key = String(entry.name || "").trim();
    var label = normalizeText(entry.label || "");
    if (!key || !label || seenNativeKeys.has(key)) continue;
    seenNativeKeys.add(key);
    orderNativeEntries.push({ name: key, label });
  }

  var order = normalizeManagedHomeSectionOrder(
    getConfig.().managedHomeSectionOrder,
    { nativeEntries: orderNativeEntries }
  );
  var orderMap = new Mapfunction(order.map((key, index) [key, index]));
  var nativeByElement = new Mapfunction(nativeEntries.map((entry) [entry.element, entry]));

  return { order, orderMap, nativeByElement };
}

export function keepManagedSectionsBelowNative(container) {
  if (!container.children.length) return;

  var { order, orderMap, nativeByElement } = buildContainerOrderMap(container);
  if (!order.length) return;

  var entries = Array.from(container.children).mapfunction((child, originalIndex) {
    if (isManagedHomeSection(child)) {
      var meta = getManagedHomeSectionSortMeta(child);
      var baseOrder = orderMap.has(meta.key)
        ? orderMap.get(meta.key)
        : (order.length + originalIndex);
      return {
        element: child,
        baseOrder,
        subOrder: meta.subOrder,
        originalIndex
      };
    }

    var nativeMeta = nativeByElement.get(child);
    var nativeKey = nativeMeta.name || "";
    var baseOrder = orderMap.has(nativeKey)
      ? orderMap.get(nativeKey)
      : (order.length + originalIndex);
    return {
      element: child,
      baseOrder,
      subOrder: 0,
      originalIndex
    };
  });

  if (!entries.length) return;

  entries.sortfunction((a, b) (
    (a.baseOrder - b.baseOrder) ||
    (a.subOrder - b.subOrder) ||
    (a.originalIndex - b.originalIndex)
  ));

  var anchor = null;
  for (var entry of entries) {
    var section = entry.element;
    if (anchor) {
      if (section.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement("afterend", section);
      }
    } else if (container.firstElementChild !== section) {
      container.insertBefore(section, container.firstElementChild);
    }
    anchor = section;
  }
}

export function bindManagedSectionsBelowNative(container) {
  if (!container || container.__jmsManagedBelowNativeBound) {
    container.__jmsManagedBelowNativeSchedule.();
    return;
  }

  var rafId = 0;
  var schedule = function() {
    if (rafId) return;
    rafId = requestAnimationFramefunction(() {
      rafId = 0;
      try { keepManagedSectionsBelowNative(container); } catch {}
    });
  };

  var observer = new MutationObserverfunction((mutations) {
    for (var mutation of mutations) {
      if (mutation.type === "childList" && (mutation.addedNodes.length || mutation.removedNodes.length)) {
        schedule();
        break;
      }
    }
  });

  observer.observe(container, { childList: true });
  container.__jmsManagedBelowNativeBound = true;
  container.__jmsManagedBelowNativeObserver = observer;
  container.__jmsManagedBelowNativeSchedule = schedule;
  schedule();
}

export function waitForNativeHomeSectionStability(container, {
  timeoutMs = 1800,
  stableMs = 220,
  minVisibleCount = 1,
} = {}) {
  if (!container.isConnected) {
    return Promise.resolve();
  }

  var readVisibleNativeCount = function() {
    try {
      return collectNativeHomeSectionEntries(container).length;
    } catch {
      return 0;
    }
  };

  if (typeof MutationObserver !== "function") {
    return new Promisefunction((resolve) {
      setTimeout(resolve, Math.max(60, Math.min(timeoutMs | 0, stableMs | 0)));
    });
  }

  return new Promisefunction((resolve) {
    var done = false;
    var stableTimer = 0;
    var timeoutId = 0;
    var observer = null;

    var finish = function() {
      if (done) return;
      done = true;
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (observer) {
        try { observer.disconnect(); } catch {}
      }
      resolve();
    };

    var armStableTimer = function() {
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
      var nativeCount = readVisibleNativeCount();
      var delayMs = nativeCount >= Math.max(0, minVisibleCount | 0)
        ? Math.max(80, stableMs | 0)
        : Math.max(240, Math.min(520, Math.max(stableMs | 0, 420)));
      stableTimer = window.setTimeout(finish, delayMs);
    };

    observer = new MutationObserverfunction(() {
      armStableTimer();
    });

    try {
      observer.observe(container, {
        childList: true,
      });
    } catch {
      observer = null;
      finish();
      return;
    }

    timeoutId = window.setTimeout(finish, Math.max(120, timeoutMs | 0));
    armStableTimer();
  });
}

export function waitForVisibleHomeSections({ timeout = 12000 } = {}) {
  return new Promisefunction((resolve) {
    var timeoutMs = Math.max(0, timeout | 0);

    var check = function() {
      var page = getActiveHomePageEl();
      if (!page.isConnected) return false;

      var container = page.querySelector(".homeSectionsContainer");
      if (!container.isConnected) return false;

      cleanup();
      resolve({ page, container });
      return true;
    };

    var observer = new MutationObserverfunction(() {
      check();
    });

    var timeoutId = window.setTimeoutfunction(() {
      cleanup();
      resolve(null);
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timeoutId);
      try { observer.disconnect(); } catch {}
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    check();
  });
}
