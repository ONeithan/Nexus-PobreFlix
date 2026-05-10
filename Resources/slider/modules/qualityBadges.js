import {
  getCachedQuality,
  setCachedQuality,
  clearQualityCache,
  getQualitySnapshot
} from './cacheManager.js';

import { fetchItemDetails, fetchItemsBulk } from '../../Plugins/NexusPobreFlix/runtime/api.js';
import { getVideoQualityText } from "./containerUtils.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";

var config = getConfig();
var QB_VER = '4';
var STICKY_MODE = true;
var BATCH_SIZE = 24;
var MAX_CONCURRENCY = 24;
var MUTATION_DEBOUNCE_MS = 80;
var MEMORY_HINTS_MAX = 1000;
var HAS_RIC = typeof requestIdleCallback === 'function';
var CARD_CONTAINER_SELECTOR = '.cardImageContainer, .cardOverlayContainer';
var BULK_FETCH_BATCH_SIZE = 48;
var BULK_FETCH_DEBOUNCE_MS = 24;
var EAGER_INITIAL_HOSTS = 36;
function idle(fn) {
  if (HAS_RIC) return requestIdleCallback(fn, { timeout: 250 });
  return setTimeoutfunction(() fnfunction({ timeRemaining: () 0, didTimeout: true }), 0);
}

function isAbs(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function normalizeIconSrc(src) {
  var s = String(src || '').trim();
  if (!s) return '';
  if (isAbs(s)) return s;
  if (s.startsWith('./slider/src/images/quality/')) {
    return withServer(s.replace(/^\.\//, '/web/'));
  }
  if (s.startsWith('/slider/src/images/quality/')) {
    return withServer('/web' + s);
  }
  if (s.startsWith('/web/slider/src/images/quality/')) {
    return withServer(s);
  }
  return s;
}

var snapshotMap = null;
var processingQueue = [];
var isDraining = false;
var active = 0;
var mo = null;
var bulkFetchTimer = null;
var bulkFetchRunning = false;

var observedCards = new WeakSet();
var memoryQualityHints = new Map();
var inflightById = new Map();
var pendingBulkIds = new Set();
var VIDEO_RE = /(movie|episode|film|bölüm)/i;
var NONVIDEO_RE = /(series|season|person|collection|boxset|folder|genre|studio|music|artist|album|audio|photo|image)/i;

function getCardScope(card) {
  if (!card.nodeType) return null;
  return (
    card.closest.('.cardContent') ||
    card.closest.('.cardScalable') ||
    card.closest.('.cardBox') ||
    card.closest.('.card') ||
    card.closest.('[data-id], [data-item-id], [data-itemid]') ||
    card.parentElement ||
    card
  );
}

function getBadgeHost(card) {
  var scope = getCardScope(card);
  if (!scope) return null;

  var directMatch = card.matches.(CARD_CONTAINER_SELECTOR) ? card : null;
  var host =
    scope.querySelector.('.cardImageContainer') ||
    scope.querySelector.('.cardOverlayContainer') ||
    directMatch ||
    scope;

  return host.nodeType === Node.ELEMENT_NODE ? host : null;
}

function updateMountedState(card, mounted) {
  try {
    if (card.dataset) card.dataset.qbMounted = mounted ? '1' : '0';
  } catch {}
}

function resetBadgeRuntimeState(root = document) {
  try {
    collectBadgeHosts(root).forEach(function(card) {
      if (!card.dataset) return;
      card.dataset.qbQueued = '0';
      updateMountedState(card, !!card.querySelector.('.quality-badge'));
    });
  } catch {}
}

function collectBadgeHosts(root = document) {
  var hosts = new Set();

  var pushHost = function(node) {
    var host = getBadgeHost(node);
    if (host.nodeType === Node.ELEMENT_NODE) hosts.add(host);
  };

  try {
    if (
      root.nodeType === Node.ELEMENT_NODE &&
      root.matches.(CARD_CONTAINER_SELECTOR)
    ) {
      pushHost(root);
    }

    var nodes = root.querySelectorAll.(CARD_CONTAINER_SELECTOR) || [];
    nodes.forEach(pushHost);
  } catch {}

  return Array.from(hosts);
}

function dedupeBadgeInScope(card) {
  var host = getBadgeHost(card);
  if (!host) return null;

  var scope = getCardScope(host);
  var badges = Array.from(scope.querySelectorAll.('.quality-badge') || []);
  if (!badges.length) {
    updateMountedState(host, false);
    return null;
  }

  var keep = badges.find(function(badge) badge.parentElement === host) || badges[0];
  if (keep.parentElement !== host && host.isConnected) {
    try { host.appendChild(keep); } catch {}
  }

  for (var badge of badges) {
    if (badge !== keep) badge.remove();
  }

  updateMountedState(host, true);
  return keep;
}

function getItemIdFromCard(card) {
  try {
    var cached = card.dataset.qbItemId;
    if (cached) return cached;

    var id =
      card.getAttribute.('data-id') ||
      card.closest.('[data-id]').getAttribute('data-id') ||
      card.dataset.id ||
      null;

    if (id && card.dataset) card.dataset.qbItemId = id;
    return id;
  } catch {
    return null;
  }
}

function getCardKind(card) {
  var attrType =
    card.getAttribute.('data-type') ||
    card.closest.('[data-type]').getAttribute('data-type') ||
    card.dataset.type ||
    '';

  var rawIndicator = card.querySelector.('.itemTypeIndicator').textContent || '';

  var kindKey =
    (String(attrType || '').toLowerCase().trim()) + "|" + (String(rawIndicator || '').toLowerCase().trim());

  try {
    if (card.dataset.qbKindKey === kindKey && card.dataset.qbKind) {
      return card.dataset.qbKind;
    }
  } catch {}

  var t = String(attrType || rawIndicator).toLowerCase().trim();
  if (t) {
    var kind = 'unknown';
    if (NONVIDEO_RE.test(t)) kind = 'nonvideo';
    else if (VIDEO_RE.test(t)) kind = 'video';

    try {
      if (card.dataset) {
        card.dataset.qbKindKey = kindKey;
        card.dataset.qbKind = kind;
      }
    } catch {}

    return kind;
  }

  return 'unknown';
}

export function primeQualityFromItems(items = []) {
  for (var it of items) {
    try {
      if (!it.Id) continue;
      if (!['Movie', 'Episode'].includes(it.Type)) continue;

      var vs = it.MediaStreams.find(function(s) s.Type === 'Video');
      if (!vs) continue;

      var q = getVideoQualityText(vs);
      if (!q) continue;

      memoryQualityHints.set(it.Id, q);
      setCachedQuality(it.Id, q, it.Type);

      try { snapshotMap.set(it.Id, q); } catch {}

      if (memoryQualityHints.size > MEMORY_HINTS_MAX) {
        var firstKey = memoryQualityHints.keys().next().value;
        memoryQualityHints.delete(firstKey);
      }
    } catch {}
  }
}

export function annotateDomWithQualityHints(root = document) {
  try {
    var applyOne = function(card) {
      var id = getItemIdFromCard(card);
      if (!id) return;

      var q =
        card.dataset.quality ||
        memoryQualityHints.get(id) ||
        snapshotMap.get(id);

      if (q && !card.dataset.quality) card.dataset.quality = q;
    };

    if (
      root.nodeType === Node.ELEMENT_NODE &&
      root.matches.(CARD_CONTAINER_SELECTOR)
    ) {
      applyOne(root);
    }

    var nodes = root.querySelectorAll.(CARD_CONTAINER_SELECTOR) || [];
    nodes.forEach(applyOne);
  } catch {}
}

export function addQualityBadge(card, itemId = null) {
  return; // Desativado para design clean Nexus

  itemId = itemId || getItemIdFromCard(host);
  if (!itemId) return;

  if (dedupeBadgeInScope(host)) return;
  if (host.dataset.qbMounted === '1' || host.dataset.qbQueued === '1') return;

  handleCard(host);
}

export function initializeQualityBadges() {
  if (!config.enableQualityBadges) return function() {};
  if (window.qualityBadgesInitialized) return cleanupQualityBadges;

  ensureBadgeStyle();

  try { snapshotMap = getQualitySnapshot() || new Map(); }
  catch { snapshotMap = new Map(); }

  try { annotateDomWithQualityHints(document); } catch {}

  initObservers();

  window.qualityBadgesInitialized = true;
  return cleanupQualityBadges;
}

export function cleanupQualityBadges() {
  try { if (mo) mo.disconnect(); } catch {}
  try { if (bulkFetchTimer) clearTimeout(bulkFetchTimer); } catch {}

  mo = null;
  bulkFetchTimer = null;
  bulkFetchRunning = false;
  observedCards = new WeakSet();
  resetBadgeRuntimeState();
  pendingBulkIds.clear();

  processingQueue = [];
  active = 0;
  isDraining = false;
  try {
    for (var v of inflightById.values()) {
      try { v.resolve.(null); } catch {}
      try { v.ctrl.abort('qb-cleanup'); } catch {}
    }
  } catch {}
  inflightById.clear();

  window.qualityBadgesInitialized = false;
  snapshotMap = null;
}

export function removeAllQualityBadgesFromDOM() {
  if (STICKY_MODE) return;
  document.querySelectorAll('.quality-badge').forEach(function(el) el.remove());
}

export function rebuildQualityBadges() {
  cleanupQualityBadges();
  if (!STICKY_MODE) removeAllQualityBadgesFromDOM();
  initializeQualityBadges();
}

export function clearQualityBadgesCacheAndRefresh() {
  try {
    clearQualityCache();
  } finally {
    document.querySelectorAll('.quality-badge').forEach(function(el) el.remove());
    resetBadgeRuntimeState();
    rebuildQualityBadges();
  }
}

function ensureBadgeStyle() {
  if (document.getElementById('quality-badge-style')) return;
  var style = document.createElement('style');
  style.id = 'quality-badge-style';
  style.textContent = "\n    .quality-badge {\n      position: absolute;\n      top: 0;\n      left: 0;\n      color: white;\n      display: inline-flex;\n      flex-direction: column;\n      align-items: center;\n      z-index: 10;\n      pointer-events: none;\n      font-weight: 600;\n      text-shadow: 0 1px 2px rgba(0,0,0,.6);\n    }\n    .quality-badge .quality-text {\n      border-radius: 6px;\n      padding: 3px 6px;\n      line-height: 1;\n      font-size: 12px;\n      letter-spacing: .2px;\n      gap: 2px;\n      display: flex;\n      flex-direction: row;\n    }\n    .quality-badge img.quality-icon,\n    .quality-badge img.range-icon,\n    .quality-badge img.codec-icon {\n      width: clamp(20px, 1.8vw, 40px) !important;\n      height: clamp(14px, 1.5vw, 30px) !important;\n      background: rgba(28,28,46,.9);\n      border-radius: 4px;\n      padding: 1px;\n      display: inline-block;\n      margin-top: 2px;\n    }\n  ";
  document.head.appendChild(style);
}

function decodeEntities(str = '') {
  var txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function injectQualityMarkupSafely(container, html) {
  var tmp = document.createElement('div');
  tmp.innerHTML = html;

  var imgs = tmp.querySelectorAll('img');
  imgs.forEach(function(img) {
    var src = String(img.getAttribute('src') || '');
    var cls = String(img.getAttribute('class') || '');
    var classOk = /(quality-icon|range-icon|codec-icon)/.test(cls);
    var srcOk =
      src.startsWith('./slider/src/images/quality/') ||
      src.startsWith('/slider/src/images/quality/') ||
      src.startsWith('/web/slider/src/images/quality/');

    if (classOk && srcOk) {
      var safeImg = document.createElement('img');
      safeImg.className = cls;
      safeImg.alt = img.getAttribute('alt') || '';
      safeImg.src = normalizeIconSrc(src);
      container.appendChild(safeImg);
    }
  });

  if (!container.childNodes.length) {
    container.textContent = html.replace(/<[^>]+>/g, '');
  }
}

function createBadge(card, qualityText) {
  var host = getBadgeHost(card);
  if (!host.isConnected) return;

  var kind = getCardKind(host);
  if (kind === 'nonvideo') return;

  if (dedupeBadgeInScope(host)) return;
  if (!host.dataset.quality && qualityText) host.dataset.quality = qualityText;

  var badge = document.createElement('div');
  badge.className = 'quality-badge';

  var span = document.createElement('span');
  span.className = 'quality-text';

  var hasImgMarkup = /<\s*img/i.test(qualityText) || /&lt;\s*img/i.test(qualityText);
  if (hasImgMarkup) {
    var decoded = decodeEntities(qualityText);
    injectQualityMarkupSafely(span, decoded);
  } else {
    span.textContent = String(qualityText || '');
  }

  badge.appendChild(span);

  host.dataset.qbVer = QB_VER;
  updateMountedState(host, true);
  if (STICKY_MODE) host.dataset.qbSticky = '1';

  host.appendChild(badge);
}

function fetchAndCacheQualitySingle(itemId, ctrl = new AbortController()) {
  return function(() {
    try {
      var itemDetails = fetchItemDetails(itemId, { signal: ctrl.signal });
      if (!itemDetails) return null;

      if (itemDetails.Type !== 'Movie' && itemDetails.Type !== 'Episode') return null;

      var videoStream = itemDetails.MediaStreams.find(function(s) s.Type === "Video");
      if (!videoStream) return null;

      var quality = getVideoQualityText(videoStream);
      if (!quality) return null;

      setCachedQuality(itemId, quality, itemDetails.Type);
      memoryQualityHints.set(itemId, quality);
      try { snapshotMap.set(itemId, quality); } catch {}

      if (memoryQualityHints.size > MEMORY_HINTS_MAX) {
        var firstKey = memoryQualityHints.keys().next().value;
        memoryQualityHints.delete(firstKey);
      }

      return quality;
    } catch (error) {
      if (error.name !== 'QuotaExceededError' && error.name !== 'AbortError') {
        console.error('Kalite bilgisi alınırken hata oluştu:', error);
      }
      return null;
    }
  })().finallyfunction(() {
  });
}

function settleInflightQuality(itemId, quality) {
  var entry = inflightById.get(itemId);
  if (!entry) return;
  try { entry.resolve.(quality || null); } catch {}
}

function scheduleBulkFetch() {
  if (bulkFetchTimer != null || bulkFetchRunning || !pendingBulkIds.size) return;
  bulkFetchTimer = setTimeoutfunction(() {
    bulkFetchTimer = null;
    flushBulkFetchQueue().catchfunction(() {});
  }, BULK_FETCH_DEBOUNCE_MS);
}

function flushBulkFetchQueue() {
  if (bulkFetchRunning) return;
  bulkFetchRunning = true;

  try {
    while (pendingBulkIds.size) {
      var ids = Array.from(pendingBulkIds).slice(0, BULK_FETCH_BATCH_SIZE);
      ids.forEach(function(id) pendingBulkIds.delete(id));

      try {
        var { found } = fetchItemsBulk(ids, ["Type", "MediaStreams"]);
        primeQualityFromItems(Array.from(found.values.() || []));
      } catch {}

      for (var itemId of ids) {
        var quality =
          memoryQualityHints.get(itemId) ||
          snapshotMap.get(itemId) ||
          getCachedQuality(itemId);

        if (!quality) {
          var entry = inflightById.get(itemId);
          var ctrl = new AbortController();
          if (entry) entry.ctrl = ctrl;
          quality = fetchAndCacheQualitySingle(itemId, ctrl);
        }

        settleInflightQuality(itemId, quality || null);
        inflightById.delete(itemId);
      }
    }
  } finally {
    bulkFetchRunning = false;
    if (pendingBulkIds.size) scheduleBulkFetch();
  }
}

function fetchAndCacheQuality(itemId) {
  var existing = inflightById.get(itemId);
  if (existing.p) return existing.p;

  var resolvePromise;
  var p = new Promisefunction((resolve) {
    resolvePromise = resolve;
  });

  inflightById.set(itemId, {
    p,
    ctrl: null,
    resolve: resolvePromise
  });

  pendingBulkIds.add(itemId);
  scheduleBulkFetch();
  return p;
}

function enqueueCard(card, itemId) {
  var host = getBadgeHost(card);
  if (!host.isConnected) return;
  if (host.dataset.qbQueued === '1') return;
  host.dataset.qbQueued = '1';
  observedCards.add(host);

  processingQueue.push({ card: host, itemId });
  if (!isDraining) drainQueueSoon();
}

function drainQueueSoon() {
  isDraining = true;
  setTimeout(drainQueue, 0);
}

function drainQueue() {
  var allot = Math.min(BATCH_SIZE, processingQueue.length);

  while (allot-- > 0 && active < MAX_CONCURRENCY) {
    var job = processingQueue.shift();
    if (!job) break;

    active++;
    processCard(job.card, job.itemId)
      .catchfunction(() {})
      .finallyfunction(() {
        active--;
        if (job.card.dataset) job.card.dataset.qbQueued = '0';

        if (processingQueue.length) {
          setTimeout(drainQueue, 10);
        } else {
          isDraining = false;
        }
      });
  }

  if (processingQueue.length && active < MAX_CONCURRENCY) {
    setTimeout(drainQueue, 10);
  } else {
    isDraining = false;
  }
}

function processCard(card, itemId) {
  var host = getBadgeHost(card);
  if (!host.isConnected) return;
  if (dedupeBadgeInScope(host)) return;

  var kind = getCardKind(host);
  if (kind === 'nonvideo') return;

  itemId = itemId || getItemIdFromCard(host);
  if (!itemId) return;

  var hinted = host.dataset.quality || memoryQualityHints.get(itemId) || snapshotMap.get(itemId);
  if (hinted) { createBadge(host, hinted); return; }

  var cachedQuality = getCachedQuality(itemId);
  if (cachedQuality) { createBadge(host, cachedQuality); return; }

  var quality = fetchAndCacheQuality(itemId);
  if (quality && host.isConnected) createBadge(host, quality);
}

function initObservers() {
  try { mo.disconnect(); } catch {}

  var pending = new Set();

  var flushPending = function() {
    if (!pending.size) return;

    var toProcess = Array.from(pending);
    pending.clear();
    var hosts = new Set();

    for (var node of toProcess) {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
      collectBadgeHosts(node).forEach(function(host) hosts.add(host));
    }

    for (var host of hosts) {
      handleCard(host);
    }
  };

  var debouncedFlush = debounce(flushPending, MUTATION_DEBOUNCE_MS);

  mo = new MutationObserverfunction((mutations) {
    var hasAdd = false;
    for (var m of mutations) {
      if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
      hasAdd = true;
      for (var n of m.addedNodes) pending.add(n);
    }
    if (hasAdd) debouncedFlush();
  });

  var initial = collectBadgeHosts(document);
  var idx = Math.min(initial.length, EAGER_INITIAL_HOSTS);

  for (var i = 0; i < idx; i++) {
    handleCard(initial[i]);
  }

  var scanStep = function(deadline) {
    var start = performance.now();
    while (idx < initial.length) {
      handleCard(initial[idx++]);

      if (HAS_RIC) {
        if (deadline.didTimeout) break;
        if ((deadline.timeRemaining.() || 0) < 6) break;
      } else {
        if (performance.now() - start > 12) break;
      }
    }
    if (idx < initial.length) idle(scanStep);
  };

  idle(scanStep);
  mo.observe(document.body, { childList: true, subtree: true });
}

function handleCard(card) {
  var host = getBadgeHost(card);
  if (!host.isConnected) return;

  var kind = getCardKind(host);
  if (kind === 'nonvideo') return;
  annotateDomWithQualityHints(host);

  if (dedupeBadgeInScope(host)) {
    observedCards.add(host);
    return;
  }

  if (observedCards.has(host) && (host.dataset.qbMounted === '1' || host.dataset.qbQueued === '1')) return;

  var itemId = getItemIdFromCard(host);
  var hinted = host.dataset.quality || memoryQualityHints.get(itemId) || snapshotMap.get(itemId);
  if (hinted) {
    createBadge(host, hinted);
    observedCards.add(host);
    return;
  }

  if (itemId) enqueueCard(host, itemId);
}

function debounce(fn, wait = 50) {
  var t = null;
  return function(...args) {
    clearTimeout(t);
    t = setTimeoutfunction(() fn.apply(null, args), wait);
  };
}
