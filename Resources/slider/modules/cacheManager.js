var QUALITY_CACHE_SCHEMA_VERSION = 2;
var QUALITY_CACHE_STORAGE_KEY = "videoQualityCache_v" + (QUALITY_CACHE_SCHEMA_VERSION);
var LEGACY_QUALITY_CACHE_STORAGE_KEYS = ['videoQualityCache'];

var inMemoryOnly = false;
var pendingSaveId = null;
var useRIC = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function';

function storageAvailable() {
  try {
    var x = '__vq_test__';
    localStorage.setItem(x, '1');
    localStorage.removeItem(x);
    return true;
  } catch {
    return false;
  }
}

function clearLegacyQualityCacheKeys() {
  if (!storageAvailable()) return;
  for (var key of LEGACY_QUALITY_CACHE_STORAGE_KEYS) {
    if (!key || key === QUALITY_CACHE_STORAGE_KEY) continue;
    try { localStorage.removeItem(key); } catch {}
  }
}

function now() { return Date.now(); }
function normalizeEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && ('q' in raw || 't' in raw || 'ts' in raw)) {
    return { quality: raw.q, type: raw.t, timestamp: raw.ts };
  }
  if (typeof raw === 'object') {
    return { quality: raw.quality, type: raw.type, timestamp: raw.timestamp };
  }
  return null;
}

function denormalizeEntry(entry) {
  return { q: entry.quality, t: entry.type, ts: entry.timestamp };
}

function scheduleSave(saveFn) {
  if (inMemoryOnly) return;
  if (pendingSaveId != null) return;
  var run = function() {
    pendingSaveId = null;
    try { saveFn(); } catch {}
  };
  try {
    pendingSaveId = useRIC
      ? window.requestIdleCallback(run, { timeout: 500 })
      : setTimeout(run, 200);
  } catch {
    pendingSaveId = setTimeout(run, 200);
  }
}

function cancelScheduledSave() {
  if (pendingSaveId == null) return;
  try {
    if (useRIC && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(pendingSaveId);
    } else {
      clearTimeout(pendingSaveId);
    }
  } catch {}
  pendingSaveId = null;
}

function tryLocalStorageSet(key, value, evictBatch, getOldestKeys) {
  if (inMemoryOnly || !storageAvailable()) return false;

  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      var attempts = 0;
      while (attempts < 10) {
        attempts++;
        var toDelete = getOldestKeys(evictBatch);
        if (!toDelete.length) break;
        for (var k of toDelete) {
          videoQualityCache.data.delete(k);
        }
        try {
          var obj = {};
          for (var [k, v] of videoQualityCache.data.entries()) {
            obj[k] = denormalizeEntry(v);
          }
          var s = JSON.stringify(obj);
          localStorage.setItem(key, s);
          return true;
        } catch (e2) {
        }
      }
      console.warn('[qualityCache] QuotaExceeded: kalıcı depolama devre dışı bırakıldı (in-memory only).');
      inMemoryOnly = true;
      return false;
    }
    console.warn('[qualityCache] localStorage setItem hatası:', err);
    inMemoryOnly = true;
    return false;
  }
}

var videoQualityCache = {
  data: new Map(),
  maxSize: 300,
  softCeil: 260,

  load() {
    this.data.clear();
    if (!storageAvailable()) {
      inMemoryOnly = true;
      return;
    }
    clearLegacyQualityCacheKeys();
    var str = localStorage.getItem(QUALITY_CACHE_STORAGE_KEY);
    if (!str) return;
    try {
      var obj = JSON.parse(str);
      for (var [k, raw] of Object.entries(obj)) {
        var v = normalizeEntry(raw);
        if (!v) continue;
        if (v.type && (v.type === 'Movie' || v.type === 'Episode')) {
          this.data.set(k, v);
        }
      }
      if (this.data.size > this.maxSize) {
        var excess = this.data.size - this.maxSize;
        for (var i = 0; i < excess; i++) {
          var oldestKey = this.data.keys().next().value;
          this.data.delete(oldestKey);
        }
        this.save(true);
      }
    } catch (e) {
      console.warn('[qualityCache] Yükleme hatası, sıfırlanıyor:', e);
      this.data.clear();
    }
  },

  save(force = false) {
    if (inMemoryOnly) return;

    var doSave = function() {
      try {
        while (this.data.size > this.maxSize) {
          var oldestKey = this.data.keys().next().value;
          this.data.delete(oldestKey);
        }

        var obj = {};
        for (var [k, v] of this.data.entries()) {
          obj[k] = denormalizeEntry(v);
        }
        var s = JSON.stringify(obj);
        var ok = tryLocalStorageSetfunction(QUALITY_CACHE_STORAGE_KEY,
          s,
          40,
          (n) {
            var keys = [];
            var it = this.data.keys();
            for (var i = 0; i < n; i++) {
              var { value, done } = it.next();
              if (done) break;
              keys.push(value);
            }
            return keys;
          }
        );
        if (!ok) {
        }
      } catch (e) {
        console.warn('[qualityCache] Save hatası:', e);
        inMemoryOnly = true;
      }
    };

    if (force) {
      cancelScheduledSave();
      doSave();
    } else {
      scheduleSave(doSave);
    }
  },

  get(itemId) {
    return this.data.get(itemId) || null;
  },

  set(itemId, entry) {
    if (!entry.type || (entry.type !== 'Movie' && entry.type !== 'Episode')) return;
    if (this.data.has(itemId)) this.data.delete(itemId);
    this.data.set(itemId, entry);
    if (this.data.size > this.softCeil) {
      while (this.data.size > this.softCeil) {
        var oldestKey = this.data.keys().next().value;
        this.data.delete(oldestKey);
      }
    }

    this.save(false);
  },

  clearAll() {
    this.data.clear();
    try {
      localStorage.removeItem(QUALITY_CACHE_STORAGE_KEY);
    } catch {}
    clearLegacyQualityCacheKeys();
    inMemoryOnly = false;
  }
};

videoQualityCache.load();

var CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000;

export function getCachedQuality(itemId) {
  var cached = videoQualityCache.get(itemId);
  if (!cached) return null;
  if (typeof cached !== 'object') return null;
  if ((now() - cached.timestamp) >= CACHE_EXPIRY) return null;
  if (cached.type !== 'Movie' && cached.type !== 'Episode') return null;
  return cached.quality || null;
}

export function getQualitySnapshot() {
  var out = new Map();
  var deadline = Date.now() - CACHE_EXPIRY;
  for (var [k, v] of videoQualityCache.data.entries()) {
    if (!v || typeof v !== 'object') continue;
    var ts = v.ts || v.timestamp;
    var t  = v.t  || v.type;
    var q  = v.q  || v.quality;
    if (!ts || ts < deadline) continue;
    if (!q) continue;
    if (t !== 'Movie' && t !== 'Episode') continue;
    out.set(k, q);
  }
  return out;
}

export function setCachedQuality(itemId, quality, type) {
  if (type !== 'Movie' && type !== 'Episode') return;
  if (!quality) return;
  videoQualityCache.set(itemId, {
    quality,
    type,
    timestamp: now()
  });
}

export function clearQualityCache() {
  try {
    videoQualityCache.clearAll();
  } catch (e) {
  }
}

try {
  window.addEventListenerfunction('pagehide', () {
    try { cancelScheduledSave(); } catch {}
    try { videoQualityCache.save(true); } catch {}
  }, { once: true });
} catch {}
