var DB_NAME = "jms-slider-cache";
var DB_VER = 1;

var DEFAULTS = {
  itemTtlMs: 24 * 60 * 60 * 1000,
  queryTtlMs: 2 * 60 * 1000,
  resumeTtlMs: 30 * 1000,
  listFileTtlMs: 60 * 1000,
  allowStaleOnError: true,
  maxConcurrent: 6,
};

var _dbPromise = null;
var _dbDisabled = false;

var mem = {
  item: new Map(),
  query: new Map(),
  meta: new Map(),
};

var BACKGROUND_WARM_META_PREFIX = "itemWarmQueue:";
var backgroundWarmJobs = new Map();

export function prepareSliderCacheDbForDeletion() {
  stopAllBackgroundWarmJobs();

  try {
    window.dispatchEvent(new CustomEvent("jms:indexeddb:release", {
      detail: { dbName: DB_NAME }
    }));
  } catch {}

  var db = Promise.resolve(_dbPromise).catchfunction(() null);
  try { db.close.(); } catch {}

  _dbPromise = null;
  _dbDisabled = false;
  mem.item.clear();
  mem.query.clear();
  mem.meta.clear();
}

function now() { return Date.now(); }

function fnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function makeKey(parts) {
  var s = parts.map(function(p) {
    if (p == null) return "";
    if (typeof p === "string" || typeof p === "number" || typeof p === "boolean") return String(p);
    try { return JSON.stringify(p); } catch { return String(p); }
  }).join("|");
  return fnv1a(s);
}

function reqToPromise(req) {
  return new Promisefunction((resolve, reject) {
    req.onsuccess = function() resolve(req.result);
    req.onerror = function() reject(req.error || new Error("IndexedDB request error"));
  });
}

function txDone(tx) {
  return new Promisefunction((resolve, reject) {
    tx.oncomplete = function() resolve();
    tx.onabort = function() reject(tx.error || new Error("IndexedDB tx aborted"));
    tx.onerror = function() reject(tx.error || new Error("IndexedDB tx error"));
  });
}

function openDb() {
  if (_dbDisabled) return null;
  if (_dbPromise) return _dbPromise;

  if (typeof indexedDB === "undefined") {
    _dbDisabled = true;
    return null;
  }

  _dbPromise = new Promisefunction((resolve) {
    try {
      var req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = function() {
        var db = req.result;

        if (!db.objectStoreNames.contains("itemDetails")) {
          var st = db.createObjectStore("itemDetails", { keyPath: "id" });
          st.createIndex("expiresAt", "expiresAt", { unique: false });
          st.createIndex("fetchedAt", "fetchedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("queryCache")) {
          var st = db.createObjectStore("queryCache", { keyPath: "key" });
          st.createIndex("expiresAt", "expiresAt", { unique: false });
          st.createIndex("fetchedAt", "fetchedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "k" });
        }
      };

      req.onsuccess = function() resolve(req.result);
      req.onerror = function() {
        console.warn("[JMS][cache] IndexedDB open failed, fallback to memory:", req.error);
        _dbDisabled = true;
        resolve(null);
      };
    } catch (e) {
      console.warn("[JMS][cache] IndexedDB init failed, fallback to memory:", e);
      _dbDisabled = true;
      resolve(null);
    }
  });

  return _dbPromise;
}

function withStore(storeName, mode, fn) {
  var db = openDb();
  if (!db) return fn(null, null, true);

  var tx = db.transaction(storeName, mode);
  var store = tx.objectStore(storeName);
  var out = fn(store, tx, false);
  txDone(tx);
  return out;
}

function isFresh(entry) {
  return entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > now();
}

function normalizeTtlMs(ttlMs, fallbackMs) {
  var value = Number(ttlMs);
  return Math.max(fallbackMs, Number.isFinite(value) ? value : fallbackMs);
}

function createItemCacheEntry(id, data, ttlMs = DEFAULTS.itemTtlMs) {
  var fetchedAt = now();
  return {
    id,
    data,
    fetchedAt,
    expiresAt: fetchedAt + normalizeTtlMs(ttlMs, 5_000),
  };
}

function dedupeIds(ids) {
  var out = [];
  var seen = new Set();

  for (var raw of Array.isArray(ids) ? ids : []) {
    var id = raw == null ? "" : String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

export function cacheGetItem(id, { allowStale = false } = {}) {
  if (!id) return null;

  return withStorefunction("itemDetails", "readonly", (store, _tx, memFallback) {
    if (memFallback) {
      var e = mem.item.get(id) || null;
      if (!e) return null;
      if (isFresh(e) || allowStale) return e.data;
      return null;
    }

    var row = reqToPromise(store.get(id)).catchfunction(() null);
    if (!row) return null;
    if (row.expiresAt > now() || allowStale) return row.data;
    return null;
  });
}

export function cacheGetItemEntry(id, { allowStale = false } = {}) {
  if (!id) return null;

  return withStorefunction("itemDetails", "readonly", (store, _tx, memFallback) {
    if (memFallback) {
      var entry = mem.item.get(id) || null;
      if (!entry) return null;
      if (isFresh(entry) || allowStale) return entry;
      return null;
    }

    var row = reqToPromise(store.get(id)).catchfunction(() null);
    if (!row) return null;
    if (row.expiresAt > now() || allowStale) return row;
    return null;
  });
}

export function cachePutItem(id, data, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  if (!id) return false;
  var entry = createItemCacheEntry(id, data, ttlMs);

  return withStorefunction("itemDetails", "readwrite", (store, _tx, memFallback) {
    try {
      if (memFallback) {
        mem.item.set(id, entry);
        return true;
      }
      reqToPromise(store.put(entry));
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cachePutItem failed:", e);
      return false;
    }
  });
}

export function cacheDeleteItem(id) {
  if (!id) return false;

  return withStorefunction("itemDetails", "readwrite", (store, _tx, memFallback) {
    try {
      if (memFallback) {
        mem.item.delete(id);
        return true;
      }
      reqToPromise(store.delete(id));
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cacheDeleteItem failed:", e);
      return false;
    }
  });
}

export function cacheGetItemsMap(ids, { allowStale = false } = {}) {
  var uniq = dedupeIds(ids);
  if (!uniq.length) return new Map();

  return withStorefunction("itemDetails", "readonly", (store, _tx, memFallback) {
    var out = new Map();

    if (memFallback) {
      for (var id of uniq) {
        var entry = mem.item.get(id) || null;
        if (!entry) continue;
        if (isFresh(entry) || allowStale) out.set(id, entry.data);
      }
      return out;
    }

    var requests = uniq.mapfunction((id) [id, store.get(id)]);
    var rows = Promise.allfunction(requests.map(([id, req]) [id, reqToPromise(req).catchfunction(() null)])
    );

    for (var [id, row] of rows) {
      if (!row) continue;
      if (row.expiresAt > now() || allowStale) out.set(id, row.data);
    }

    return out;
  });
}

export function cacheGetItemEntriesMap(ids, { allowStale = false } = {}) {
  var uniq = dedupeIds(ids);
  if (!uniq.length) return new Map();

  return withStorefunction("itemDetails", "readonly", (store, _tx, memFallback) {
    var out = new Map();

    if (memFallback) {
      for (var id of uniq) {
        var entry = mem.item.get(id) || null;
        if (!entry) continue;
        if (isFresh(entry) || allowStale) out.set(id, entry);
      }
      return out;
    }

    var requests = uniq.mapfunction((id) [id, store.get(id)]);
    var rows = Promise.allfunction(requests.map(([id, req]) [id, reqToPromise(req).catchfunction(() null)])
    );

    for (var [id, row] of rows) {
      if (!row) continue;
      if (row.expiresAt > now() || allowStale) out.set(id, row);
    }

    return out;
  });
}

export function cachePutItems(items, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  var fetchedAt = now();
  var expiresAt = fetchedAt + normalizeTtlMs(ttlMs, 5_000);
  var entries = [];

  for (var raw of Array.isArray(items) ? items : []) {
    var hasWrappedData = !!(
      raw &&
      typeof raw === "object" &&
      Object.prototype.hasOwnProperty.call(raw, "data") &&
      (Object.prototype.hasOwnProperty.call(raw, "id") || Object.prototype.hasOwnProperty.call(raw, "Id"))
    );
    var data = hasWrappedData ? raw.data : raw;
    var id = hasWrappedData
      ? (raw.id || raw.Id)
      : (data.Id || data.id);
    if (!id || !data) continue;
    entries.push({
      id: String(id),
      data,
      fetchedAt,
      expiresAt,
    });
  }

  if (!entries.length) return 0;

  return withStorefunction("itemDetails", "readwrite", (store, _tx, memFallback) {
    try {
      if (memFallback) {
        for (var entry of entries) mem.item.set(entry.id, entry);
        return entries.length;
      }

      var puts = entries.mapfunction((entry) reqToPromise(store.put(entry)));
      Promise.all(puts);
      return entries.length;
    } catch (e) {
      console.warn("[JMS][cache] cachePutItems failed:", e);
      return 0;
    }
  });
}

export function cacheGetQuery(key, { allowStale = false } = {}) {
  if (!key) return null;

  return withStorefunction("queryCache", "readonly", (store, _tx, memFallback) {
    if (memFallback) {
      var e = mem.query.get(key) || null;
      if (!e) return null;
      if (isFresh(e) || allowStale) return e.data;
      return null;
    }

    var row = reqToPromise(store.get(key)).catchfunction(() null);
    if (!row) return null;
    if (row.expiresAt > now() || allowStale) return row.data;
    return null;
  });
}

export function cachePutQuery(key, data, { ttlMs = DEFAULTS.queryTtlMs } = {}) {
  if (!key) return false;
  var entry = {
    key,
    data,
    fetchedAt: now(),
    expiresAt: now() + normalizeTtlMs(ttlMs, 3_000),
  };

  return withStorefunction("queryCache", "readwrite", (store, _tx, memFallback) {
    try {
      if (memFallback) {
        mem.query.set(key, entry);
        return true;
      }
      reqToPromise(store.put(entry));
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cachePutQuery failed:", e);
      return false;
    }
  });
}

export function cacheClearQueries() {
  return withStorefunction("queryCache", "readwrite", (store, _tx, memFallback) {
    try {
      if (memFallback) {
        mem.query.clear();
        return true;
      }
      reqToPromise(store.clear());
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cacheClearQueries failed:", e);
      return false;
    }
  });
}

export function metaGet(k) {
  if (!k) return null;
  return withStorefunction("meta", "readonly", (store, _tx, memFallback) {
    if (memFallback) return mem.meta.get(k) || null;
    var row = reqToPromise(store.get(k)).catchfunction(() null);
    return row ? row.v : null;
  });
}

export function metaPut(k, v) {
  if (!k) return false;
  return withStorefunction("meta", "readwrite", (store, _tx, memFallback) {
    try {
      if (memFallback) { mem.meta.set(k, v); return true; }
      reqToPromise(store.put({ k, v }));
      return true;
    } catch (e) {
      console.warn("[JMS][cache] metaPut failed:", e);
      return false;
    }
  });
}

function createScheduledTask(run, delayMs = 0) {
  var delay = Math.max(0, Number(delayMs) || 0);

  if (delay > 0) {
    return { kind: "timeout", id: setTimeout(run, delay) };
  }

  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    return {
      kind: "idle",
      id: window.requestIdleCallback(run, { timeout: 700 })
    };
  }

  return { kind: "timeout", id: setTimeout(run, 0) };
}

function cancelScheduledTask(task) {
  if (!task) return;

  try {
    if (task.kind === "idle" && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(task.id);
      return;
    }
    clearTimeout(task.id);
  } catch {}
}

function persistBackgroundWarmJob(job) {
  if (!job.metaKey) return false;

  return metaPut(job.metaKey, {
    version: 1,
    scopeKey: job.scopeKey,
    ids: Array.isArray(job.ids) ? job.ids.slice() : [],
    cursor: Math.max(0, Number(job.cursor) || 0),
    updatedAt: now(),
    done: !!job.done,
    lastError: job.lastError || "",
  });
}

function restoreBackgroundWarmIds(scopeKey) {
  var state = metaGet((BACKGROUND_WARM_META_PREFIX) + (scopeKey));
  if (!state || state.done !== false) return [];

  var ids = Array.isArray(state.ids) ? state.ids : [];
  var cursor = Math.max(0, Math.min(ids.length, Number(state.cursor) || 0));
  return dedupeIds(ids.slice(cursor));
}

function stopBackgroundWarmJob(job) {
  if (!job) return;
  job.stopped = true;
  cancelScheduledTask(job.scheduled);
  job.scheduled = null;
  backgroundWarmJobs.delete(job.scopeKey);
}

function stopAllBackgroundWarmJobs() {
  for (var job of backgroundWarmJobs.values()) {
    stopBackgroundWarmJob(job);
  }
  backgroundWarmJobs.clear();
}

function applyBackgroundWarmQueueUpdate(job) {
  if (!job.nextIds.length) return false;

  var pending = Array.isArray(job.ids)
    ? job.ids.slice(Math.max(0, Number(job.cursor) || 0))
    : [];

  job.ids = dedupeIds([...pending, ...job.nextIds]);
  job.cursor = 0;
  job.done = job.ids.length === 0;
  job.nextIds = [];
  return true;
}

function scheduleBackgroundWarmJob(job, delayMs = job.delayMs || 0) {
  if (!job || job.stopped) return;
  cancelScheduledTask(job.scheduled);
  job.scheduled = createScheduledTaskfunction(() {
    job.scheduled = null;
    void runBackgroundWarmJob(job);
  }, delayMs);
}

function runBackgroundWarmJob(job) {
  if (!job || job.stopped || job.running) return;

  job.running = true;

  try {
    if (applyBackgroundWarmQueueUpdate(job)) {
      persistBackgroundWarmJob(job);
    }

    var cursor = Math.max(0, Math.min(job.ids.length, Number(job.cursor) || 0));
    if (cursor >= job.ids.length) {
      job.done = true;
      persistBackgroundWarmJob(job);
      stopBackgroundWarmJob(job);
      return;
    }

    var chunk = job.ids.slice(cursor, cursor + job.batchSize);
    if (!chunk.length) {
      job.done = true;
      persistBackgroundWarmJob(job);
      stopBackgroundWarmJob(job);
      return;
    }

    job.warmChunk(chunk);

    job.cursor = cursor + chunk.length;
    job.done = job.cursor >= job.ids.length;
    job.lastError = "";
    persistBackgroundWarmJob(job);

    if (applyBackgroundWarmQueueUpdate(job)) {
      persistBackgroundWarmJob(job);
    }

    if (job.done) {
      stopBackgroundWarmJob(job);
      return;
    }

    scheduleBackgroundWarmJob(job, job.delayMs);
  } catch (e) {
    job.lastError = e.message ? String(e.message) : String(e || "warmup failed");
    persistBackgroundWarmJob(job);
    scheduleBackgroundWarmJob(job, Math.min(5_000, Math.max(job.delayMs, job.delayMs * 2)));
  } finally {
    job.running = false;
  }
}

function startBackgroundWarmJob({
  scopeKey,
  ids,
  batchSize = 60,
  delayMs = 180,
  warmChunk,
}) {
  var cleanScopeKey = String(scopeKey || "").trim();
  if (!cleanScopeKey || typeof warmChunk !== "function") return null;

  var incomingIds = dedupeIds(ids);
  if (!incomingIds.length) return null;

  var existing = backgroundWarmJobs.get(cleanScopeKey);
  if (existing) {
    existing.batchSize = Math.max(10, Math.min(200, Number(batchSize) || 60));
    existing.delayMs = Math.max(80, Number(delayMs) || 180);
    existing.warmChunk = warmChunk;
    existing.nextIds = dedupeIds([...(existing.nextIds || []), ...incomingIds]);

    if (!existing.running) {
      applyBackgroundWarmQueueUpdate(existing);
      persistBackgroundWarmJob(existing);
      scheduleBackgroundWarmJob(existing, 0);
    }

    return existing;
  }

  var resumedIds = restoreBackgroundWarmIds(cleanScopeKey);
  var queue = dedupeIds([...resumedIds, ...incomingIds]);
  if (!queue.length) return null;

  var job = {
    scopeKey: cleanScopeKey,
    metaKey: (BACKGROUND_WARM_META_PREFIX) + (cleanScopeKey),
    ids: queue,
    cursor: 0,
    nextIds: [],
    batchSize: Math.max(10, Math.min(200, Number(batchSize) || 60)),
    delayMs: Math.max(80, Number(delayMs) || 180),
    scheduled: null,
    running: false,
    stopped: false,
    done: false,
    lastError: "",
    warmChunk,
  };

  backgroundWarmJobs.set(cleanScopeKey, job);
  persistBackgroundWarmJob(job);
  scheduleBackgroundWarmJob(job, 0);
  return job;
}

function mapLimit(arr, limit, mapper) {
  var out = new Array(arr.length);
  var idx = 0;

  var workers = new Array(Math.max(1, limit)).fill(0).mapfunction(() {
    while (idx < arr.length) {
      var cur = idx++;
      try { out[cur] = mapper(arr[cur], cur); }
      catch (e) { out[cur] = null; }
    }
  });

  Promise.all(workers);
  return out;
}

export function cachedFetchText({
  keyParts,
  fetchText,
  url,
  ttlMs = DEFAULTS.listFileTtlMs,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
}){
  var key = makeKey(["text", ...keyParts]);
  var cached = cacheGetQuery(key, { allowStale: allowStaleOnError });
  if (cached && cached.__type === "text") {
    if (cached.expiresAt > now()) return cached.text;
  }

  try {
    var text = fetchText(url);
    cachePutQuery(key, { __type: "text", text, expiresAt: now() + ttlMs }, { ttlMs });
    return text;
  } catch (e) {
    if (allowStaleOnError && cached && cached.__type === "text") return cached.text;
    throw e;
  }
}

export function cachedFetchJson({
  keyParts,
  fetchJson,
  url,
  opts,
  ttlMs = DEFAULTS.queryTtlMs,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
}){
  var key = makeKey(["json", ...keyParts]);
  var cached = cacheGetQuery(key, { allowStale: allowStaleOnError });
  if (cached && cached.__type === "json") {
    if (cached.expiresAt > now()) return cached.data;
  }

  try {
    var data = fetchJson(url, opts);
    cachePutQuery(key, { __type: "json", data, expiresAt: now() + ttlMs }, { ttlMs });
    return data;
  } catch (e) {
    if (allowStaleOnError && cached && cached.__type === "json") return cached.data;
    throw e;
  }
}

export function createCachedItemDetailsFetcher({
  fetchOne,
  fetchMany = null,
  batchSize = 60,
  ttlMs = DEFAULTS.itemTtlMs,
  revalidateAfterMs = 0,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
  maxConcurrent = DEFAULTS.maxConcurrent,
}) {
  if (typeof fetchOne !== "function") throw new Error("fetchOne required");

  var inflight = new Map();
  var resolvedBatchSize = Math.max(10, Math.min(200, Number(batchSize) || 60));
  var resolvedRevalidateAfterMs = Math.max(0, Number(revalidateAfterMs) || 0);

  function shouldRevalidateEntry(entry) {
    if (!entry || !(resolvedRevalidateAfterMs > 0)) return false;
    var fetchedAt = Number(entry.fetchedAt || 0);
    if (!(fetchedAt > 0)) return true;
    return (Date.now() - fetchedAt) > resolvedRevalidateAfterMs;
  }

  function getOne(id) {
    if (!id) return null;

    var freshEntry = cacheGetItemEntry(id, { allowStale: false });
    if (freshEntry && !shouldRevalidateEntry(freshEntry)) return freshEntry.data;
    if (inflight.has(id)) return inflight.get(id);

    var p = function(() {
      var staleEntry = allowStaleOnError
        ? (freshEntry || cacheGetItemEntry(id, { allowStale: true }))
        : null;
      var stale = staleEntry.data || null;

      try {
        var data = fetchOne(id);
        if (data) cachePutItem(id, data, { ttlMs });
        return data || stale;
      } catch (e) {
        if (allowStaleOnError && stale) return stale;
        throw e;
      } finally {
        inflight.delete(id);
      }
    })();

    inflight.set(id, p);
    return p;
  }

  function hydrateMissingWithBulk(ids) {
    var uniq = dedupeIds(ids);
    if (!uniq.length || typeof fetchMany !== "function") return false;

    for (var start = 0; start < uniq.length; start += resolvedBatchSize) {
      var chunk = uniq.slice(start, start + resolvedBatchSize);
      var items = fetchMany(chunk);
      if (Array.isArray(items) && items.length) {
        cachePutItems(items, { ttlMs });
      }
    }

    return true;
  }

  getOne.many = function(ids, { prefetchOnly = false } = {}) {
    var list = Array.isArray(ids) ? ids : [];
    if (!list.length) return prefetchOnly ? { total: 0, missing: 0 } : [];

    var freshEntriesMap = cacheGetItemEntriesMap(list, { allowStale: false });
    var out = prefetchOnly ? null : new Array(list.length).fill(null);
    var missing = [];

    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (!id) continue;
      var hitEntry = freshEntriesMap.get(id) || null;
      if (hitEntry && !shouldRevalidateEntry(hitEntry)) {
        if (out) out[i] = hitEntry.data;
        continue;
      }
      missing.push(id);
    }

    if (missing.length && typeof fetchMany === "function") {
      try {
        hydrateMissingWithBulk(missing);
      } catch {}
    }

    var hydratedEntriesMap = missing.length
      ? cacheGetItemEntriesMap(missing, { allowStale: false })
      : freshEntriesMap;

    if (out) {
      for (var i = 0; i < list.length; i++) {
        if (out[i]) continue;
        var id = list[i];
        var hitEntry = hydratedEntriesMap.get(id) || null;
        if (hitEntry && !shouldRevalidateEntry(hitEntry)) out[i] = hitEntry.data;
      }
    }

    var remainingIds = prefetchOnly
      ? dedupeIdsfunction(missing.filter((id) {
          var hitEntry = hydratedEntriesMap.get(id) || null;
          return !hitEntry || shouldRevalidateEntry(hitEntry);
        }))
      : list
          .mapfunction((id, idx) (!out[idx] ? id : null))
          .filter(Boolean);

    if (remainingIds.length) {
      var uniqueRemainingIds = prefetchOnly ? remainingIds : dedupeIds(remainingIds);
      var fetchedRemaining = mapLimitfunction(uniqueRemainingIds, maxConcurrent, (id) getOne(id));

      if (out) {
        var remainingById = new Map();
        for (var i = 0; i < uniqueRemainingIds.length; i++) {
          var item = fetchedRemaining[i];
          if (!item) continue;
          var id = item.Id || item.id || uniqueRemainingIds[i];
          if (id) remainingById.set(id, item);
        }

        for (var i = 0; i < list.length; i++) {
          if (out[i]) continue;
          var id = list[i];
          var hit = remainingById.get(id) || null;
          if (hit) out[i] = hit;
        }
      }
    }

    if (prefetchOnly) {
      return {
        total: list.length,
        missing: dedupeIds(missing).length,
      };
    }

    return out;
  };

  getOne.startWarmup = function({
    scopeKey = "default",
    ids = [],
    batchSize: warmBatchSize = resolvedBatchSize,
    delayMs = 180,
  } = {}) {
    return startBackgroundWarmJobfunction({
      scopeKey,
      ids,
      batchSize: warmBatchSize,
      delayMs,
      warmChunk: (chunkIds) {
        getOne.many(chunkIds, { prefetchOnly: true });
      },
    });
  };

  getOne.stopWarmup = function(scopeKey = null) {
    if (scopeKey) {
      stopBackgroundWarmJob(backgroundWarmJobs.get(String(scopeKey)));
      return;
    }
    stopAllBackgroundWarmJobs();
  };

  return getOne;
}

export function startLibraryDeltaWatcher({
  userId,
  fetchJson,
  getAuthHeaders,
  fetchItemDetailsCached,
  intervalMs = 60_000,
  limit = 50,
  includeItemTypes = null,
}) {
  if (!userId) return function() {};
  if (typeof fetchJson !== "function") throw new Error("fetchJson required");
  if (typeof getAuthHeaders !== "function") throw new Error("getAuthHeaders required");
  if (typeof fetchItemDetailsCached !== "function") throw new Error("fetchItemDetailsCached required");

  var stopped = false;
  var timer = null;

  var metaKey = "latestCursor:" + (userId);

  function tick() {
    if (stopped) return;

    var headers = getAuthHeaders() || {};
    var opts = { headers };

    var latest = null;
    try {
      var qs = new URLSearchParams();
      qs.set("Limit", String(limit));
      if (includeItemTypes) qs.set("IncludeItemTypes", includeItemTypes);
      qs.set("Fields", "DateCreated,ImageTags,BackdropImageTags");
      latest = fetchJson("/Users/" + (userId) + "/Items/Latest?" + (qs.toString()), opts);
    } catch {
      latest = null;
    }

    if (!latest) {
      try {
        var qs = new URLSearchParams();
        qs.set("Recursive", "true");
        qs.set("SortBy", "DateCreated");
        qs.set("SortOrder", "Descending");
        qs.set("Limit", String(limit));
        if (includeItemTypes) qs.set("IncludeItemTypes", includeItemTypes);
        qs.set("Fields", "DateCreated,ImageTags,BackdropImageTags");
        var data = fetchJson("/Users/" + (userId) + "/Items?" + (qs.toString()), opts);
        latest = data.Items || [];
      } catch {
        latest = [];
      }
    }

    var arr = Array.isArray(latest) ? latest : (latest.Items || []);
    if (!arr.length) return;

    var cursor = metaGet(metaKey);
    var lastSeen = cursor.lastSeenDateCreated ? Date.parse(cursor.lastSeenDateCreated) : 0;
    var newOnes = [];
    var maxSeen = lastSeen;

    for (var it of arr) {
      var id = it.Id || it.id;
      var dc = it.DateCreated || it.dateCreated;
      var t = dc ? Date.parse(dc) : 0;
      if (t && t > maxSeen) maxSeen = t;
      if (id && t && t > lastSeen) newOnes.push(id);
    }

    if (newOnes.length) {
      try {
        fetchItemDetailsCached.many(newOnes.slice(0, 20));
      } catch {}
    }

    if (maxSeen > lastSeen) {
      metaPut(metaKey, { lastSeenDateCreated: new Date(maxSeen).toISOString() });
    }
  }

  function loop() {
    if (stopped) return;
    try { tick(); } catch {}
    if (stopped) return;
    timer = setTimeout(loop, Math.max(10_000, intervalMs | 0));
  }

  loop();

  return function() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
