import {
  getConfig,
  isNativeHomeSectionOrderKey,
  normalizeManagedHomeSectionOrder
} from "./config.js";
import { createScopedJsonDb } from "./scopedJsonCache.js";

const MANAGED_HOME_SECTION_IDS = new Set([
  "studio-hubs",
  "personal-recommendations",
  "top10-series-rows",
  "top10-movie-rows",
  "tmdb-top-movie-rows",
  "tmdb-trailer-rows",
  "genre-hubs",
  "director-rows",
  "recent-rows",
  "continue-rows",
  "nextup-rows",
  "because-you-watched"
]);
const MANAGED_HOME_SECTION_PREFIXES = Object.freeze([
  ["because-you-watched--", "becauseYouWatched"],
  ["genre-hubs--", "genreHubs"],
  ["director-rows--", "directorRows"],
  ["recent-rows--", "recentRows"],
  ["continue-rows--", "continueRows"],
  ["nextup-rows--", "nextUpRows"],
  ["top10-series-rows--", "top10SeriesRows"],
  ["top10-movie-rows--", "top10MovieRows"],
  ["tmdb-top-movie-rows--", "tmdbTopMoviesRows"],
  ["tmdb-trailer-rows--", "tmdbTrailerRows"],
]);
const NATIVE_HOME_SECTION_SNAPSHOT_KEY = "jms:managedHomeSectionNativeSnapshot:v1";
const NATIVE_TITLE_SELECTORS = [
  ".sectionTitle",
  ".sectionTitleText",
  ".sectionTitle-cards",
  '[data-role="sectionTitle"]',
  "h1",
  "h2",
  "h3",
  "h4"
];
const GENERIC_NATIVE_LABEL_RE = /^jellyfin row \d+$/i;

export function getActiveHomePageEl() {
  return (
    document.querySelector("#indexPage:not(.hide)") ||
    document.querySelector("#homePage:not(.hide)")
  );
}

export function isManagedHomeSection(el) {
  if (!el || el.nodeType !== 1) return false;
  const id = String(el.id || "");
  if (MANAGED_HOME_SECTION_IDS.has(id)) return true;
  return MANAGED_HOME_SECTION_PREFIXES.some(([prefix]) => id.startsWith(prefix));
}

function parseManagedHomeSectionPattern(id) {
  const raw = String(id || "");
  for (const [prefix, key] of MANAGED_HOME_SECTION_PREFIXES) {
    if (!raw.startsWith(prefix)) continue;
    const suffix = raw.slice(prefix.length);
    const subOrder = Number(suffix);
    return {
      key,
      subOrder: Number.isFinite(subOrder) ? subOrder : 0
    };
  }
  return null;
}

function getManagedHomeSectionKey(el) {
  const id = String(el?.id || "");
  const pattern = parseManagedHomeSectionPattern(id);
  if (pattern?.key) return pattern.key;
  if (id === "studio-hubs") return "studioHubs";
  if (id === "personal-recommendations") return "personalRecommendations";
  if (id === "top10-series-rows") return "top10SeriesRows";
  if (id === "top10-movie-rows") return "top10MovieRows";
  if (id === "tmdb-top-movie-rows") return "tmdbTopMoviesRows";
  if (id === "tmdb-trailer-rows") return "tmdbTrailerRows";
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
  const key = getManagedHomeSectionKey(el);
  const id = String(el?.id || "");

  let subOrder = 0;
  const pattern = parseManagedHomeSectionPattern(id);
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
  const slug = normalizeCompareText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function formatNativeHomeSectionOrderLabel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";

  const clean = raw.replace(/^native:/i, "");
  const withoutCount = clean.replace(/:\d+$/, "");
  const tail = withoutCount.split(":").pop() || withoutCount;
  return tail
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getElementTextCandidate(el) {
  return normalizeText(el?.textContent || "");
}

function getNativeHomeSectionLabel(el) {
  for (const selector of NATIVE_TITLE_SELECTORS) {
    const titleEl = el?.querySelector?.(selector);
    const text = getElementTextCandidate(titleEl);
    if (text) return text;
  }

  const ariaLabel = normalizeText(el?.getAttribute?.("aria-label") || "");
  if (ariaLabel) return ariaLabel;

  const dataTitle = normalizeText(
    el?.dataset?.title ||
    el?.dataset?.sectionTitle ||
    el?.dataset?.titleText ||
    ""
  );
  if (dataTitle) return dataTitle;

  return "";
}

function isGenericNativeHomeSectionLabel(label) {
  return GENERIC_NATIVE_LABEL_RE.test(normalizeText(label));
}

function isHiddenNativeHomeSection(el) {
  if (!el?.isConnected) return true;
  if (el.hidden) return true;
  if (el.getAttribute?.("aria-hidden") === "true") return true;
  if (el.classList?.contains("hide") || el.classList?.contains("hidden")) return true;
  try {
    const style = window.getComputedStyle?.(el);
    if (!style) return false;
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

function isUsefulNativeHomeSectionEntry(entry) {
  const name = String(entry?.name || "").trim();
  const label = normalizeText(entry?.label || "");
  return !!name && !!label && !isGenericNativeHomeSectionLabel(label) && isNativeHomeSectionOrderKey(name);
}

function inferNativeHomeSectionKind(el, label) {
  const blob = [
    el?.id || "",
    el?.className || "",
    el?.dataset?.type || "",
    el?.dataset?.viewType || "",
    el?.dataset?.section || "",
    label || ""
  ].join(" ");
  const text = normalizeCompareText(blob);

  if (/live[\s-]*tv|canli[\s-]*tv/.test(text)) return "livetv";
  if (/smalllibrary|librarytile|my media|minha[\s-]*midia|minhas[\s-]*midias|bibliotecas|meus[\s-]*conteudos|benim medyam|kutuphane|kutuphaneler|libraries/.test(text)) {
    return "smalllibrarytiles";
  }
  if (/next[\s-]*up|siradaki|sonraki/.test(text)) return "nextup";
  if (/resume|continuar[\s-]*assistindo|continue[\s-]*watching|watching|continue[\s-]*assistindo|izlemeye devam|devam ettir/.test(text)) {
    return "resume";
  }
  if (/latest|recent|recently added|newly added|son eklenen|yeni eklenen/.test(text)) {
    return "latestmedia";
  }
  return "";
}

function buildNativeHomeSectionBaseKey(el, label) {
  const kind = inferNativeHomeSectionKind(el, label);
  const slug = slugifyNativeHomeSection(label);
  if (kind === "smalllibrarytiles" || slug === "minha-midia" || slug === "minhas-midias" || slug === "bibliotecas") {
    return "native:smalllibrarytiles";
  }
  if (kind === "resume" || slug === "continuar-assistindo") {
    return "native:resume";
  }
  if (kind && kind === slug) {
    return `native:${kind}`;
  }
  if (kind) {
    return `native:${kind}:${slug}`;
  }
  return `native:${slug}`;
}

function getNativeHomeSectionKindFromKey(name) {
  const raw = String(name || "").trim().replace(/^native:/i, "");
  if (!raw) return "";
  return raw.split(":")[0] || "";
}

function readNativeHomeSectionSnapshot() {
  try {
    const raw = localStorage.getItem(NATIVE_HOME_SECTION_SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        name: String(entry?.name || "").trim(),
        label: normalizeText(entry?.label || "")
      }))
      .filter(isUsefulNativeHomeSectionEntry);
  } catch {
    return [];
  }
}

function persistNativeHomeSectionSnapshot(items = []) {
  const payload = Array.isArray(items)
    ? items
        .map((entry) => ({
          name: String(entry?.name || "").trim(),
          label: normalizeText(entry?.label || "")
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
  if (!container?.children?.length) return [];

  const snapshotQueues = new Map();
  for (const entry of readNativeHomeSectionSnapshot()) {
    const kind = getNativeHomeSectionKindFromKey(entry.name);
    if (!kind) continue;
    if (!snapshotQueues.has(kind)) {
      snapshotQueues.set(kind, []);
    }
    snapshotQueues.get(kind).push(entry);
  }

  const rawEntries = [];
  for (const child of Array.from(container.children)) {
    if (isManagedHomeSection(child)) continue;
    if (isHiddenNativeHomeSection(child)) continue;
    const label = getNativeHomeSectionLabel(child);
    const inferredKind = inferNativeHomeSectionKind(child, label);
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

  const counts = new Map();
  const reservedNames = new Set();
  return rawEntries.map((entry) => {
    if (entry.generic) {
      const queue = snapshotQueues.get(entry.inferredKind) || [];
      while (queue.length && reservedNames.has(String(queue[0]?.name || "").trim())) {
        queue.shift();
      }
      const snapshotEntry = queue.shift();
      if (snapshotEntry?.name) {
        const snapshotName = String(snapshotEntry.name || "").trim();
        reservedNames.add(snapshotName);
        return {
          element: entry.element,
          name: snapshotName,
          label: normalizeText(snapshotEntry.label || formatNativeHomeSectionOrderLabel(snapshotName))
        };
      }

      const genericBaseName = `native:${entry.inferredKind}`;
      let nextCount = (counts.get(genericBaseName) || 0) + 1;
      let generatedName = nextCount > 1 ? `${genericBaseName}:${nextCount}` : genericBaseName;
      while (reservedNames.has(generatedName)) {
        nextCount++;
        generatedName = `${genericBaseName}:${nextCount}`;
      }
      counts.set(genericBaseName, nextCount);
      reservedNames.add(generatedName);
      return {
        element: entry.element,
        name: generatedName,
        label: formatNativeHomeSectionOrderLabel(generatedName)
      };
    }

    const nextCount = (counts.get(entry.baseName) || 0) + 1;
    let nextName = nextCount > 1 ? `${entry.baseName}:${nextCount}` : entry.baseName;
    let resolvedCount = nextCount;
    while (reservedNames.has(nextName)) {
      resolvedCount++;
      nextName = `${entry.baseName}:${resolvedCount}`;
    }
    counts.set(entry.baseName, resolvedCount);
    reservedNames.add(nextName);
    return {
      element: entry.element,
      name: nextName,
      label: resolvedCount > 1 ? `${entry.label} (${resolvedCount})` : entry.label
    };
  });
}

export function getCachedNativeHomeSectionOrderItems() {
  return readNativeHomeSectionSnapshot();
}

export function getCurrentNativeHomeSectionOrderItems() {
  const page = getActiveHomePageEl();
  const container = page?.querySelector?.(".homeSectionsContainer");
  if (container) {
    const liveItems = collectNativeHomeSectionEntries(container)
      .map(({ name, label }) => ({ name, label }));
    persistNativeHomeSectionSnapshot(liveItems);
    return liveItems;
  }
  return readNativeHomeSectionSnapshot();
}

export function getNativeHomeSectionOrderLabel(name) {
  const key = String(name || "").trim();
  if (!isNativeHomeSectionOrderKey(key)) return "";

  const cached = getCurrentNativeHomeSectionOrderItems()
    .find((entry) => String(entry?.name || "").trim() === key);
  return cached?.label || formatNativeHomeSectionOrderLabel(key);
}

export function getLastNativeHomeSection(container) {
  const entries = collectNativeHomeSectionEntries(container);
  return entries[entries.length - 1]?.element || null;
}

function buildContainerOrderMap(container) {
  const nativeEntries = collectNativeHomeSectionEntries(container);
  persistNativeHomeSectionSnapshot(nativeEntries);
  const cachedEntries = readNativeHomeSectionSnapshot();
  const orderNativeEntries = [];
  const seenNativeKeys = new Set();

  for (const entry of [...nativeEntries, ...cachedEntries]) {
    const key = String(entry?.name || "").trim();
    const label = normalizeText(entry?.label || "");
    if (!key || !label || seenNativeKeys.has(key)) continue;
    seenNativeKeys.add(key);
    orderNativeEntries.push({ name: key, label });
  }

  const order = normalizeManagedHomeSectionOrder(
    getConfig?.()?.managedHomeSectionOrder,
    { nativeEntries: orderNativeEntries }
  );
  const orderMap = new Map(order.map((key, index) => [key, index]));
  const nativeByElement = new Map(nativeEntries.map((entry) => [entry.element, entry]));

  return { order, orderMap, nativeByElement };
}

export function keepManagedSectionsBelowNative(container) {
  if (!container?.children?.length) return;

  const { order, orderMap, nativeByElement } = buildContainerOrderMap(container);
  if (!order.length) return;

  const entries = Array.from(container.children).map((child, originalIndex) => {
    if (isManagedHomeSection(child)) {
      const meta = getManagedHomeSectionSortMeta(child);
      const baseOrder = orderMap.has(meta.key)
        ? orderMap.get(meta.key)
        : (order.length + originalIndex);
      return {
        element: child,
        baseOrder,
        subOrder: meta.subOrder,
        originalIndex
      };
    }

    const nativeMeta = nativeByElement.get(child);
    const nativeKey = nativeMeta?.name || "";
    const baseOrder = orderMap.has(nativeKey)
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

  entries.sort((a, b) => (
    (a.baseOrder - b.baseOrder) ||
    (a.subOrder - b.subOrder) ||
    (a.originalIndex - b.originalIndex)
  ));

  let anchor = null;
  for (const entry of entries) {
    const section = entry.element;
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
    container?.__jmsManagedBelowNativeSchedule?.();
    return;
  }

  let rafId = 0;
  const schedule = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      try { keepManagedSectionsBelowNative(container); } catch {}
    });
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
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
  if (!container?.isConnected) {
    return Promise.resolve();
  }

  const readVisibleNativeCount = () => {
    try {
      return collectNativeHomeSectionEntries(container).length;
    } catch {
      return 0;
    }
  };

  if (typeof MutationObserver !== "function") {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(60, Math.min(timeoutMs | 0, stableMs | 0)));
    });
  }

  return new Promise((resolve) => {
    let done = false;
    let stableTimer = 0;
    let timeoutId = 0;
    let observer = null;

    const finish = () => {
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

    const armStableTimer = () => {
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
      const nativeCount = readVisibleNativeCount();
      const delayMs = nativeCount >= Math.max(0, minVisibleCount | 0)
        ? Math.max(80, stableMs | 0)
        : Math.max(240, Math.min(520, Math.max(stableMs | 0, 420)));
      stableTimer = window.setTimeout(finish, delayMs);
    };

    observer = new MutationObserver(() => {
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

export async function waitForVisibleHomeSections({ timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(0, timeout | 0);

    const check = () => {
      const page = getActiveHomePageEl();
      if (!page?.isConnected) return false;

      const container = page.querySelector(".homeSectionsContainer");
      if (!container?.isConnected) return false;

      cleanup();
      resolve({ page, container });
      return true;
    };

    const observer = new MutationObserver(() => {
      check();
    });

    const timeoutId = window.setTimeout(() => {
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

const HIDDEN_CONTINUE_STORAGE_PREFIX = "nexus_hidden_continue_v2:";
const HIDDEN_CONTINUE_DB = createScopedJsonDb({
  cacheType: "hiddenContinue",
  defaultData: () => ({ hidden: {} }),
  saveDelayMs: 250,
  retryDelayMs: 1500
});
let __lastContinueSyncAt = 0;

function normalizeJfId(value) {
  return String(value || "").replace(/-/g, "").trim().toLowerCase();
}

function getActiveUserIdSafe() {
  try {
    return normalizeJfId(window.ApiClient?.getCurrentUserId?.() || "");
  } catch {
    return "";
  }
}

function getHiddenContinueLsKey(userId = "") {
  return `${HIDDEN_CONTINUE_STORAGE_PREFIX}${userId || getActiveUserIdSafe() || "anon"}`;
}

function readLocalHiddenContinueMap(userId = "") {
  try {
    const raw = localStorage.getItem(getHiddenContinueLsKey(userId)) || localStorage.getItem("nexus_hidden_continue_watching");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const map = parsed?.hidden && typeof parsed.hidden === "object" ? parsed.hidden : parsed;
    return map && typeof map === "object" && !Array.isArray(map) ? { ...map } : {};
  } catch {
    return {};
  }
}

function writeLocalHiddenContinueMap(map, userId = "") {
  try {
    localStorage.setItem(getHiddenContinueLsKey(userId), JSON.stringify(map || {}));
  } catch {}
}

function extractCardItemMeta(card) {
  if (!card) return { rawId: "", cleanId: "", seriesId: "" };
  const linkHref = card.querySelector?.("a")?.getAttribute("href") || "";
  const rawId =
    card.getAttribute("data-id") ||
    card.getAttribute("data-itemid") ||
    card.dataset?.id ||
    card.dataset?.itemid ||
    linkHref.match(/[?&]id=([a-f0-9-]+)/i)?.[1] ||
    "";
  const seriesId =
    card.getAttribute("data-seriesid") ||
    card.dataset?.seriesid ||
    card.getAttribute("data-parentid") ||
    "";
  return {
    rawId: String(rawId || "").trim(),
    cleanId: normalizeJfId(rawId),
    seriesId: normalizeJfId(seriesId)
  };
}

function isContinueWatchingSectionEl(sectionEl) {
  if (!sectionEl) return false;
  if (sectionEl.dataset?.nexusNativeKind === "resume") return true;
  if (sectionEl.matches?.('div[data-type="resume"], .resumeSection, #resumeSection, [id*="resume"]')) return true;
  const label = getNativeHomeSectionLabel(sectionEl);
  if (label && inferNativeHomeSectionKind(sectionEl, label) === "resume") return true;
  return false;
}

export function annotateNativeHomeSections(root = document) {
  try {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const sections = scope.querySelectorAll('.homeSectionsContainer > *, .verticalSection, .homeSection, div[data-type]');
    sections.forEach((sec) => {
      if (!sec || isManagedHomeSection(sec)) return;
      if (sec.id === "studio-hubs" || sec.classList?.contains("studio-hubs-section")) return;
      const label = getNativeHomeSectionLabel(sec);
      const kind = inferNativeHomeSectionKind(sec, label);
      if (kind && sec.dataset.nexusNativeKind !== kind) {
        sec.dataset.nexusNativeKind = kind;
      }
    });
  } catch {}
}

export function suppressRedundantNativeLatestMedia(root = document) {
  try {
    annotateNativeHomeSections(root);
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const latestSections = scope.querySelectorAll('[data-nexus-native-kind="latestmedia"]');
    latestSections.forEach((sec) => {
      if (isManagedHomeSection(sec)) return;
      sec.style.setProperty("display", "none", "important");
      sec.dataset.nexusSuppressedNative = "1";
    });
  } catch {}
}

export function enhanceSmallLibraryTiles(root = document) {
  try {
    annotateNativeHomeSections(root);
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const sections = scope.querySelectorAll('[data-nexus-native-kind="smalllibrarytiles"], div[data-type="smalllibrarytiles"], .section0');
    sections.forEach((sec) => {
      if (!isContinueWatchingSectionEl(sec) && sec.dataset.nexusNativeKind !== "latestmedia" && sec.dataset.nexusNativeKind !== "nextup") {
        sec.querySelectorAll('.card').forEach(async (card) => {
          const imgContainer = card.querySelector('.cardImageContainer');
          if (!imgContainer) return;

          const hasInlineBg = !!(imgContainer.style?.backgroundImage && imgContainer.style.backgroundImage !== 'none');
          const hasLazyAttr = !!(imgContainer.getAttribute('data-src') || imgContainer.classList?.contains('lazy'));
          const hasImg = !!imgContainer.querySelector('img');
          if (hasInlineBg || hasImg || hasLazyAttr) return;

          const computedBg = window.getComputedStyle(imgContainer).backgroundImage;
          if (computedBg && computedBg !== 'none' && !computedBg.includes('undefined')) return;

          if (card.dataset.nexusEnhanced === "pending" || card.dataset.nexusEnhanced === "done") return;
          card.dataset.nexusEnhanced = "pending";

          const { rawId } = extractCardItemMeta(card);
          if (!rawId || !window.ApiClient?.getJSON) return;

          try {
            const userId = window.ApiClient.getCurrentUserId?.();
            if (!userId) return;

            // 1. Try library view own primary image first
            const viewUrl = window.ApiClient.getUrl(`/Users/${userId}/Items/${rawId}`);
            const viewItem = await window.ApiClient.getJSON(viewUrl).catch(() => null);
            const ownTag = viewItem?.ImageTags?.Primary || viewItem?.BackdropImageTags?.[0];
            if (ownTag) {
              const ownImgType = viewItem?.ImageTags?.Primary ? "Primary" : "Backdrop";
              const finalUrl = window.ApiClient.getUrl(`/Items/${rawId}/Images/${ownImgType}`, {
                tag: ownTag,
                maxWidth: 640,
                quality: 90
              });
              imgContainer.style.backgroundImage = `url("${finalUrl}")`;
              imgContainer.style.backgroundSize = "cover";
              imgContainer.style.backgroundPosition = "center";
              card.dataset.nexusEnhanced = "done";
              return;
            }

            // 2. Fallback: pull latest item artwork from the library
            const url = window.ApiClient.getUrl(`/Users/${userId}/Items`, {
              ParentId: rawId,
              Limit: 1,
              Recursive: true,
              SortBy: "DateCreated",
              SortOrder: "Descending",
              ImageTypeLimit: 1,
              EnableImageTypes: "Primary,Backdrop"
            });
            const data = await window.ApiClient.getJSON(url).catch(() => null);
            const item = data?.Items?.[0];
            if (item) {
              const tag = item.BackdropImageTags?.[0] || item.ImageTags?.Primary;
              const type = item.BackdropImageTags?.[0] ? "Backdrop" : "Primary";
              if (tag) {
                const finalUrl = window.ApiClient.getUrl(`/Items/${item.Id}/Images/${type}`, {
                  tag,
                  maxWidth: 640,
                  quality: 90
                });
                imgContainer.style.backgroundImage = `url("${finalUrl}")`;
                imgContainer.style.backgroundSize = "cover";
                imgContainer.style.backgroundPosition = "center";
                card.dataset.nexusEnhanced = "done";
              }
            }
          } catch {}
        });
      }
    });
  } catch {}
}

function getHiddenContinueMatchKey(card, hiddenMap) {
  const { cleanId, seriesId } = extractCardItemMeta(card);
  if (cleanId && hiddenMap[cleanId]) return cleanId;
  if (seriesId && hiddenMap[`series:${seriesId}`]) return `series:${seriesId}`;
  return null;
}

export function filterHiddenContinueWatching(root = document) {
  try {
    annotateNativeHomeSections(root);
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const userId = getActiveUserIdSafe();
    const hiddenMap = readLocalHiddenContinueMap(userId);
    const hasHidden = Object.keys(hiddenMap).length > 0;

    const resumeSections = scope.querySelectorAll('[data-nexus-native-kind="resume"], div[data-type="resume"], .resumeSection, #resumeSection, [id*="resume"]');
    resumeSections.forEach((sec) => {
      if (!isContinueWatchingSectionEl(sec)) return;
      sec.querySelectorAll('.card').forEach((card) => {
        const matchKey = hasHidden ? getHiddenContinueMatchKey(card, hiddenMap) : null;
        if (matchKey) {
          card.style.setProperty("display", "none", "important");
          card.dataset.nexusHiddenContinue = "1";
        } else if (card.dataset.nexusHiddenContinue === "1") {
          card.style.removeProperty("display");
          delete card.dataset.nexusHiddenContinue;
        }
      });

      const itemsContainer = sec.querySelector('.itemsContainer');
      if (itemsContainer && !itemsContainer.__nexusContinueObserver) {
        itemsContainer.__nexusContinueObserver = new MutationObserver(() => {
          filterHiddenContinueWatching(sec);
        });
        itemsContainer.__nexusContinueObserver.observe(itemsContainer, { childList: true });
      }
    });
  } catch {}
}

export async function syncAndFilterHiddenContinueWatching(root = document, { force = false } = {}) {
  filterHiddenContinueWatching(root);
  const userId = getActiveUserIdSafe();
  if (!userId || !window.ApiClient?.getJSON) return;

  const now = Date.now();
  if (!force && now - __lastContinueSyncAt < 2500) return;
  __lastContinueSyncAt = now;

  try {
    const serverHidden = await HIDDEN_CONTINUE_DB.readScope(userId, (data) => {
      return data?.hidden && typeof data.hidden === "object" ? { ...data.hidden } : {};
    }).catch(() => ({}));

    const localHidden = readLocalHiddenContinueMap(userId);
    const merged = { ...serverHidden, ...localHidden };
    const entries = Object.entries(merged);
    if (!entries.length) {
      filterHiddenContinueWatching(root);
      return;
    }

    const resumeUrl = window.ApiClient.getUrl(`/Users/${userId}/Items/Resume`, {
      Limit: 50,
      Recursive: true,
      Fields: "UserData"
    });
    const resumeData = await window.ApiClient.getJSON(resumeUrl).catch(() => null);
    const resumeItems = Array.isArray(resumeData?.Items) ? resumeData.Items : [];

    let changed = Object.keys(merged).length !== Object.keys(localHidden).length;
    for (const [key, entry] of entries) {
      if (!entry || typeof entry !== "object") {
        delete merged[key];
        changed = true;
        continue;
      }
      const hiddenAt = Number(entry.hiddenAt || 0);
      const entryItemId = normalizeJfId(entry.itemId || key.replace(/^series:/, ""));
      const entrySeriesId = normalizeJfId(entry.seriesId || "");

      const matched = resumeItems.find((it) => {
        const itId = normalizeJfId(it?.Id);
        const itSeries = normalizeJfId(it?.SeriesId);
        return (entryItemId && itId === entryItemId) || (entrySeriesId && itSeries === entrySeriesId);
      });

      if (matched) {
        const lastPlayedStr = String(matched?.UserData?.LastPlayedDate || "");
        const lastPlayedMs = Date.parse(lastPlayedStr);
        const posTicks = Number(matched?.UserData?.PlaybackPositionTicks || 0);
        const sameEpisodeReplayed =
          normalizeJfId(matched.Id) === entryItemId &&
          Number.isFinite(lastPlayedMs) &&
          lastPlayedMs > (hiddenAt + 2000) &&
          (lastPlayedStr !== String(entry.lastPlayedDate || "") || posTicks !== Number(entry.playbackPositionTicks || 0));
        const differentEpisodePlayed =
          normalizeJfId(matched.Id) !== entryItemId &&
          Number.isFinite(lastPlayedMs) &&
          lastPlayedMs > (hiddenAt + 2000);

        if (sameEpisodeReplayed || differentEpisodePlayed) {
          delete merged[key];
          if (entryItemId) delete merged[entryItemId];
          if (entrySeriesId) delete merged[`series:${entrySeriesId}`];
          changed = true;
        }
      }
    }

    writeLocalHiddenContinueMap(merged, userId);
    if (changed || Object.keys(merged).length !== Object.keys(serverHidden).length) {
      void HIDDEN_CONTINUE_DB.writeScope(userId, (data) => {
        data.hidden = merged;
      }, { flush: true });
    }
    filterHiddenContinueWatching(root);
  } catch {}
}

function closeOpenActionSheet(actionSheet) {
  try {
    const dialog = actionSheet?.closest?.('.dialogContainer, .dialog, [data-role="dialog"]');
    const backdrop = document.querySelector('.dialogBackdropOpened, .dialogBackdrop');
    const cancelBtn = dialog?.querySelector?.('.btnCancel, [data-action="cancel"], .dialogHeader button');
    if (cancelBtn) {
      cancelBtn.click();
      return;
    }
    if (backdrop) {
      backdrop.click();
      return;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
    if (dialog && dialog.isConnected) {
      try { dialog.remove(); } catch {}
    }
    if (backdrop && backdrop.isConnected) {
      try { backdrop.remove(); } catch {}
    }
  } catch {}
}

export function setupContinueWatchingMenuHooks() {
  if (typeof window === "undefined" || window.__nexusMenuHooksInstalled) return;
  window.__nexusMenuHooksInstalled = true;

  let lastCardTarget = null;

  const captureCardTarget = (e) => {
    const target = e.target;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest("#nexus-btn-remove-continue") || target.closest(".actionSheet, .actionSheetScroller")) return;

    const card = target.closest(".card");
    if (!card) return;

    annotateNativeHomeSections(document);
    const sec = card.closest(".verticalSection, .homeSection, div[data-type]");
    const isContinue = isContinueWatchingSectionEl(sec);
    const meta = extractCardItemMeta(card);

    lastCardTarget = {
      card,
      isContinue,
      rawId: meta.rawId,
      cleanId: meta.cleanId,
      seriesId: meta.seriesId,
      capturedAt: Date.now()
    };
  };

  document.addEventListener("pointerdown", captureCardTarget, { capture: true, passive: true });
  document.addEventListener("mousedown", captureCardTarget, { capture: true, passive: true });
  document.addEventListener("click", captureCardTarget, { capture: true, passive: true });
  document.addEventListener("contextmenu", captureCardTarget, { capture: true, passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ContextMenu" || e.keyCode === 93) {
      captureCardTarget(e);
    }
  }, { capture: true, passive: true });

  const injectMenuOption = () => {
    const actionSheet = document.querySelector(".actionSheetScroller, .actionSheet .actionSheetContent");
    if (!actionSheet || actionSheet.querySelector("#nexus-btn-remove-continue")) return;
    if (!lastCardTarget || !lastCardTarget.isContinue || !lastCardTarget.cleanId) return;
    if ((Date.now() - lastCardTarget.capturedAt) > 10000) return;

    const { card, rawId, cleanId, seriesId } = lastCardTarget;
    const list = actionSheet.classList?.contains("actionSheetScroller")
      ? actionSheet
      : (actionSheet.querySelector(".actionSheetScroller, .actionsheetList, .verticalSection") || actionSheet);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "nexus-btn-remove-continue";
    btn.setAttribute("is", "emby-button");
    btn.className = "listItem listItem-button actionSheetMenuItem emby-button";
    btn.innerHTML = `
      <span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons visibility_off" aria-hidden="true" style="color: #a855f7;"></span>
      <div class="listItemBody actionsheetListItemBody">
        <div class="listItemBodyText actionSheetItemText">Remover do Continuar Assistindo</div>
      </div>
    `;

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const userId = getActiveUserIdSafe();
      const hiddenEntry = {
        itemId: cleanId,
        seriesId: seriesId || "",
        hiddenAt: Date.now(),
        lastPlayedDate: "",
        playbackPositionTicks: 0
      };

      closeOpenActionSheet(actionSheet);

      if (card?.isConnected) {
        card.style.transition = "opacity 0.25s ease, transform 0.25s ease";
        card.style.opacity = "0";
        card.style.transform = "scale(0.9)";
        card.dataset.nexusHiddenContinue = "1";
        setTimeout(() => {
          card.style.setProperty("display", "none", "important");
          card.style.opacity = "";
          card.style.transform = "";
        }, 240);
      }

      try {
        if (userId && rawId && window.ApiClient?.getJSON) {
          const itemUrl = window.ApiClient.getUrl(`/Users/${userId}/Items/${rawId}`);
          const fullItem = await window.ApiClient.getJSON(itemUrl).catch(() => null);
          if (fullItem) {
            hiddenEntry.seriesId = normalizeJfId(fullItem.SeriesId || seriesId);
            hiddenEntry.lastPlayedDate = String(fullItem.UserData?.LastPlayedDate || "");
            hiddenEntry.playbackPositionTicks = Number(fullItem.UserData?.PlaybackPositionTicks || 0);
          }
        }
      } catch {}

      const map = readLocalHiddenContinueMap(userId);
      map[cleanId] = hiddenEntry;
      if (hiddenEntry.seriesId) {
        map[`series:${hiddenEntry.seriesId}`] = hiddenEntry;
      }
      writeLocalHiddenContinueMap(map, userId);

      if (userId) {
        void HIDDEN_CONTINUE_DB.writeScope(userId, (data) => {
          const existing = data?.hidden && typeof data.hidden === "object" ? data.hidden : {};
          existing[cleanId] = hiddenEntry;
          if (hiddenEntry.seriesId) {
            existing[`series:${hiddenEntry.seriesId}`] = hiddenEntry;
          }
          data.hidden = existing;
        }, { flush: true });
      }
    });

    list.appendChild(btn);
  };

  const observer = new MutationObserver(() => {
    injectMenuOption();
  });

  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {}
}

try {
  setupContinueWatchingMenuHooks();
} catch {}
