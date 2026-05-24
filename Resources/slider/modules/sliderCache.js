import { getSessionInfo } from "../../Plugins/JMSFusion/runtime/api.js";
import { createScopedJsonDb, prepareLegacyIndexedDbForDeletion } from "./scopedJsonCache.js";

const DB_NAME = "jms-slider-cache";
const STORE_TYPE = "sliderCache";
const STORE_ITEM_DETAILS = "itemDetails";
const STORE_QUERY_CACHE = "queryCache";
const STORE_USER_DATA = "userData";
const STORE_META = "meta";
const MAX_ITEM_RECORDS = 5000;
const MAX_QUERY_RECORDS = 1200;
const MAX_USER_DATA_RECORDS = 5000;
const MAX_META_RECORDS = 1500;
const META_TTL_MS = 45 * 24 * 60 * 60 * 1000;

const DEFAULTS = {
  itemTtlMs: 24 * 60 * 60 * 1000,
  queryTtlMs: 2 * 60 * 1000,
  resumeTtlMs: 30 * 1000,
  listFileTtlMs: 60 * 1000,
  allowStaleOnError: true,
  maxConcurrent: 6,
};

let _dbPromise = null;

const mem = {
  item: new Map(),
  query: new Map(),
  userData: new Map(),
  meta: new Map(),
};

const BACKGROUND_WARM_META_PREFIX = "itemWarmQueue:";
const backgroundWarmJobs = new Map();

export async function prepareSliderCacheDbForDeletion() {
  stopAllBackgroundWarmJobs();

  try { await prepareLegacyIndexedDbForDeletion([DB_NAME]); } catch {}

  const db = await Promise.resolve(_dbPromise).catch(() => null);
  try { await db?.close?.(); } catch {}

  _dbPromise = null;
  mem.item.clear();
  mem.query.clear();
  mem.userData.clear();
  mem.meta.clear();
}

export async function releaseSliderCacheMemory({ closeDb = false, stopWarmups = true } = {}) {
  if (stopWarmups) {
    try { stopAllBackgroundWarmJobs(); } catch {}
  }

  mem.item.clear();
  mem.query.clear();
  mem.userData.clear();
  mem.meta.clear();

  if (!closeDb) return;

  const db = await Promise.resolve(_dbPromise).catch(() => null);
  try { await db?.close?.(); } catch {}
  _dbPromise = null;
}

function now() { return Date.now(); }

function readStorageValue(storage, key) {
  try {
    const value = storage?.getItem?.(key);
    return value ? String(value).trim() : "";
  } catch {
    return "";
  }
}

function pickFirstString(...values) {
  for (const value of values) {
    const out = String(value || "").trim();
    if (out) return out;
  }
  return "";
}

function resolveScope() {
  let session = null;
  try {
    session = typeof getSessionInfo === "function" ? getSessionInfo() : null;
  } catch {
    session = null;
  }

  const serverId = pickFirstString(
    session?.serverId,
    readStorageValue(globalThis.localStorage, "persist_server_id"),
    readStorageValue(globalThis.localStorage, "serverId"),
    readStorageValue(globalThis.sessionStorage, "serverId"),
    "global"
  );

  const userId = pickFirstString(
    session?.userId,
    readStorageValue(globalThis.localStorage, "persist_user_id"),
    readStorageValue(globalThis.localStorage, "jf_userId"),
    "anon"
  );

  return `${serverId}|${userId}`;
}

function makeScopedMemKey(scope, key) {
  return `${scope}::${key}`;
}

function getMemEntry(map, scope, key) {
  return map.get(makeScopedMemKey(scope, key)) || null;
}

function setMemEntry(map, scope, key, value) {
  map.set(makeScopedMemKey(scope, key), value);
  return value;
}

function deleteMemEntry(map, scope, key) {
  map.delete(makeScopedMemKey(scope, key));
}

function clearMemScope(map, scope) {
  const prefix = `${scope}::`;
  for (const key of Array.from(map.keys())) {
    if (key.startsWith(prefix)) {
      map.delete(key);
    }
  }
}

function ensureStoreShape(data) {
  if (!data || typeof data !== "object") {
    return {
      [STORE_ITEM_DETAILS]: {},
      [STORE_QUERY_CACHE]: {},
      [STORE_USER_DATA]: {},
      [STORE_META]: {},
    };
  }

  if (!data[STORE_ITEM_DETAILS] || typeof data[STORE_ITEM_DETAILS] !== "object" || Array.isArray(data[STORE_ITEM_DETAILS])) {
    data[STORE_ITEM_DETAILS] = {};
  }
  if (!data[STORE_QUERY_CACHE] || typeof data[STORE_QUERY_CACHE] !== "object" || Array.isArray(data[STORE_QUERY_CACHE])) {
    data[STORE_QUERY_CACHE] = {};
  }
  if (!data[STORE_USER_DATA] || typeof data[STORE_USER_DATA] !== "object" || Array.isArray(data[STORE_USER_DATA])) {
    data[STORE_USER_DATA] = {};
  }
  if (!data[STORE_META] || typeof data[STORE_META] !== "object" || Array.isArray(data[STORE_META])) {
    data[STORE_META] = {};
  }

  return data;
}

function pruneExpiringMap(map, maxItems) {
  const current = now();

  for (const [key, entry] of Object.entries(map || {})) {
    const expiresAt = Number(entry?.expiresAt || 0);
    if (expiresAt > 0 && expiresAt <= current) {
      delete map[key];
    }
  }

  const entries = Object.entries(map || {});
  if (maxItems > 0 && entries.length > maxItems) {
    entries
      .sort((a, b) => {
        const exp = Number(a[1]?.expiresAt || 0) - Number(b[1]?.expiresAt || 0);
        if (exp) return exp;
        return Number(a[1]?.fetchedAt || 0) - Number(b[1]?.fetchedAt || 0);
      })
      .slice(0, entries.length - maxItems)
      .forEach(([key]) => {
        delete map[key];
      });
  }
}

function pruneMetaMap(map, maxItems, ttlMs = META_TTL_MS) {
  const cutoff = now() - Math.max(60_000, ttlMs | 0);

  for (const [key, entry] of Object.entries(map || {})) {
    const updatedAt = Number(entry?.updatedAt || 0);
    if (updatedAt && updatedAt < cutoff) {
      delete map[key];
    }
  }

  const entries = Object.entries(map || {});
  if (maxItems > 0 && entries.length > maxItems) {
    entries
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
      .slice(0, entries.length - maxItems)
      .forEach(([key]) => {
        delete map[key];
      });
  }
}

function readWrappedJsonItems(row) {
  if (!isRecord(row) || !isRecord(row.data) || row.data.__type !== "json") return [];
  const payload = row.data.data;
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.Items)) return payload.Items;
  return [];
}

function pruneItemDetailsCoveredByItemsPool(store) {
  const itemDetails = store[STORE_ITEM_DETAILS] || {};
  const queryCache = store[STORE_QUERY_CACHE] || {};
  const coveredIds = new Set();

  for (const row of Object.values(queryCache)) {
    if (String(row?.meta?.kind || "") !== "itemsPool") continue;
    for (const item of readWrappedJsonItems(row)) {
      const id = String(item?.Id || item?.id || "").trim();
      if (id) coveredIds.add(id);
    }
  }

  if (!coveredIds.size) return;

  for (const id of coveredIds) {
    if (!itemDetails[id]) continue;
    delete itemDetails[id];
  }
}

function pruneStore(store) {
  const scope = resolveScope();
  pruneItemDetailsCoveredByItemsPool(store);

  for (const [key, row] of Object.entries(store[STORE_QUERY_CACHE] || {})) {
    if (row?.meta?.kind === "homeItemUserData") {
      delete store[STORE_QUERY_CACHE][key];
      deleteMemEntry(mem.query, scope, key);
    }
  }

  pruneExpiringMap(store[STORE_ITEM_DETAILS], MAX_ITEM_RECORDS);
  pruneExpiringMap(store[STORE_QUERY_CACHE], MAX_QUERY_RECORDS);
  pruneExpiringMap(store[STORE_USER_DATA], MAX_USER_DATA_RECORDS);
  pruneMetaMap(store[STORE_META], MAX_META_RECORDS);
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function makeKey(parts) {
  const s = parts.map(p => {
    if (p == null) return "";
    if (typeof p === "string" || typeof p === "number" || typeof p === "boolean") return String(p);
    try { return JSON.stringify(p); } catch { return String(p); }
  }).join("|");
  return fnv1a(s);
}

async function openDb() {
  if (!_dbPromise) {
    _dbPromise = Promise.resolve(createScopedJsonDb({
      cacheType: STORE_TYPE,
      defaultData: () => ({
        [STORE_ITEM_DETAILS]: {},
        [STORE_QUERY_CACHE]: {},
        [STORE_USER_DATA]: {},
        [STORE_META]: {},
      }),
      saveDelayMs: 700,
      retryDelayMs: 2000,
      legacyDbNames: [DB_NAME],
      stableIgnoreFields: ["fetchedAt", "expiresAt", "updatedAt"]
    }));
  }

  return _dbPromise;
}

async function withStore(_storeName, mode, fn) {
  const db = await openDb();
  const scope = resolveScope();
  db.__jmsActiveScope = scope;

  if (mode === "readonly") {
    return db.readScope(scope, (data) => fn(ensureStoreShape(data), null, false, scope));
  }

  return db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const result = fn(store, null, false, scope);
    pruneStore(store);
    return result;
  });
}

function isFresh(entry) {
  return entry && Number.isFinite(entry.expiresAt) && entry.expiresAt > now();
}

function normalizeTtlMs(ttlMs, fallbackMs) {
  const value = Number(ttlMs);
  return Math.max(fallbackMs, Number.isFinite(value) ? value : fallbackMs);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createItemCacheEntry(id, data, ttlMs = DEFAULTS.itemTtlMs) {
  const fetchedAt = now();
  return {
    id,
    data,
    fetchedAt,
    expiresAt: fetchedAt + normalizeTtlMs(ttlMs, 5_000),
  };
}

function createQueryCacheEntry(key, data, ttlMs = DEFAULTS.queryTtlMs) {
  const fetchedAt = now();
  return {
    key,
    data,
    fetchedAt,
    expiresAt: fetchedAt + normalizeTtlMs(ttlMs, 3_000),
  };
}

function createUserDataCacheEntry(id, userData, ttlMs = DEFAULTS.resumeTtlMs) {
  const fetchedAt = now();
  return {
    id,
    userData: isRecord(userData) ? { ...userData } : {},
    fetchedAt,
    expiresAt: fetchedAt + normalizeTtlMs(ttlMs, 30_000),
  };
}

function isCompletedUserData(userData = {}) {
  if (!isRecord(userData)) return false;
  if (userData.Played === true) return true;
  const playedPercentage = Number(userData.PlayedPercentage);
  return Number.isFinite(playedPercentage) && playedPercentage >= 100;
}

function isPartialPlaybackUserData(userData = {}) {
  if (!isRecord(userData) || isCompletedUserData(userData)) return false;
  const playbackTicks = Number(userData.PlaybackPositionTicks || 0);
  return Number.isFinite(playbackTicks) && playbackTicks > 0;
}

function normalizeUserDataPatch(userDataPatch = {}) {
  if (!isRecord(userDataPatch)) return {};
  const next = {};

  for (const [key, value] of Object.entries(userDataPatch)) {
    if (value !== undefined) next[key] = value;
  }

  if (Object.prototype.hasOwnProperty.call(next, "PlaybackPositionTicks")) {
    const ticks = Number(next.PlaybackPositionTicks || 0);
    next.PlaybackPositionTicks = Number.isFinite(ticks) ? Math.max(0, Math.floor(ticks)) : 0;
  }

  if (Object.prototype.hasOwnProperty.call(next, "PlayedPercentage")) {
    const pct = Number(next.PlayedPercentage);
    next.PlayedPercentage = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  }

  if (next.Played === true) {
    next.PlayedPercentage = 100;
    next.PlaybackPositionTicks = 0;
  }

  return next;
}

function mergeUserDataPatch(baseUserData = {}, userDataPatch = {}) {
  const next = {
    ...(isRecord(baseUserData) ? baseUserData : {}),
    ...normalizeUserDataPatch(userDataPatch),
  };

  if (next.Played === true) {
    next.PlayedPercentage = 100;
    next.PlaybackPositionTicks = 0;
  }

  return next;
}

function touchCacheEntry(entry, ttlMs) {
  const freshTtlMs = Math.max(30_000, Number(ttlMs) || 0);
  const fetchedAt = now();
  entry.fetchedAt = fetchedAt;
  entry.expiresAt = fetchedAt + freshTtlMs;
  return entry;
}

function patchItemRecordUserData(itemRecord, itemId, userDataPatch = {}) {
  if (!isRecord(itemRecord)) return itemRecord;
  const currentId = String(itemRecord.Id || itemRecord.id || "").trim();
  if (!currentId || currentId !== itemId) return itemRecord;
  return {
    ...itemRecord,
    UserData: mergeUserDataPatch(itemRecord.UserData, userDataPatch),
  };
}

function patchItemsArrayUserData(items, itemId, userDataPatch = {}, {
  allowUpsert = false,
  itemData = null,
  removeIf = null,
} = {}) {
  if (!Array.isArray(items)) return items;

  let changed = false;
  let found = false;
  const nextItems = [];

  for (const rawItem of items) {
    const currentId = String(rawItem?.Id || rawItem?.id || "").trim();
    if (!currentId || currentId !== itemId) {
      nextItems.push(rawItem);
      continue;
    }

    found = true;
    const patchedItem = patchItemRecordUserData(rawItem, itemId, userDataPatch);
    if (typeof removeIf === "function" && removeIf(patchedItem?.UserData || {})) {
      changed = true;
      continue;
    }

    if (patchedItem !== rawItem) changed = true;
    nextItems.push(patchedItem);
  }

  if (!found && allowUpsert && isRecord(itemData)) {
    const patchedItemData = patchItemRecordUserData(itemData, itemId, userDataPatch);
    if (!(typeof removeIf === "function" && removeIf(patchedItemData?.UserData || {}))) {
      nextItems.unshift(patchedItemData);
      changed = true;
    }
  }

  return changed ? nextItems : items;
}

function patchWrappedJsonItems(wrapper, itemId, userDataPatch = {}, options = {}) {
  if (!isRecord(wrapper) || wrapper.__type !== "json") return wrapper;
  const payload = wrapper.data;

  if (Array.isArray(payload)) {
    const nextItems = patchItemsArrayUserData(payload, itemId, userDataPatch, options);
    if (nextItems === payload) return wrapper;
    return { ...wrapper, data: nextItems };
  }

  if (isRecord(payload) && Array.isArray(payload.Items)) {
    const nextItems = patchItemsArrayUserData(payload.Items, itemId, userDataPatch, options);
    if (nextItems === payload.Items) return wrapper;
    const nextPayload = {
      ...payload,
      Items: nextItems,
    };
    if (typeof payload.TotalRecordCount === "number") {
      nextPayload.TotalRecordCount = nextItems.length;
    }
    return { ...wrapper, data: nextPayload };
  }

  return wrapper;
}

function lastPlayedTime(item) {
  const raw = item?.UserData?.LastPlayedDate || item?.UserData?.lastPlayedDate || "";
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortResumeItems(items) {
  if (!Array.isArray(items) || items.length < 2) return items;

  const sorted = items.slice().sort((a, b) => lastPlayedTime(b) - lastPlayedTime(a));
  for (let i = 0; i < items.length; i++) {
    const oldId = String(items[i]?.Id || items[i]?.id || "");
    const newId = String(sorted[i]?.Id || sorted[i]?.id || "");
    if (oldId !== newId) return sorted;
  }

  return items;
}

function sortResumeWrappedJsonItems(wrapper) {
  if (!isRecord(wrapper) || wrapper.__type !== "json") return wrapper;

  const payload = wrapper.data;
  if (Array.isArray(payload)) {
    const items = sortResumeItems(payload);
    return items === payload ? wrapper : { ...wrapper, data: items };
  }

  if (isRecord(payload) && Array.isArray(payload.Items)) {
    const items = sortResumeItems(payload.Items);
    return items === payload.Items ? wrapper : { ...wrapper, data: { ...payload, Items: items } };
  }

  return wrapper;
}

function queryDataForRead(row) {
  if (!isRecord(row)) return row?.data;
  return String(row?.meta?.kind || "") === "resume"
    ? sortResumeWrappedJsonItems(row.data)
    : row.data;
}

function dedupeIds(ids) {
  const out = [];
  const seen = new Set();

  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = raw == null ? "" : String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

export async function cacheGetItem(id, { allowStale = false } = {}) {
  if (!id) return null;

  return withStore(STORE_ITEM_DETAILS, "readonly", (store, _tx, _memFallback, scope) => {
    const memEntry = getMemEntry(mem.item, scope, id);
    if (memEntry && (isFresh(memEntry) || allowStale)) return memEntry.data;

    const row = store[STORE_ITEM_DETAILS][id] || null;
    if (!row) return null;
    setMemEntry(mem.item, scope, id, row);
    if (row.expiresAt > now() || allowStale) return row.data;
    return null;
  });
}

export async function cacheGetItemEntry(id, { allowStale = false } = {}) {
  if (!id) return null;

  return withStore(STORE_ITEM_DETAILS, "readonly", (store, _tx, _memFallback, scope) => {
    const memEntry = getMemEntry(mem.item, scope, id);
    if (memEntry && (isFresh(memEntry) || allowStale)) return memEntry;

    const row = store[STORE_ITEM_DETAILS][id] || null;
    if (!row) return null;
    setMemEntry(mem.item, scope, id, row);
    if (row.expiresAt > now() || allowStale) return row;
    return null;
  });
}

export async function cachePutItem(id, data, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  if (!id) return false;
  const entry = createItemCacheEntry(id, data, ttlMs);

  return withStore(STORE_ITEM_DETAILS, "readwrite", (store, _tx, _memFallback, scope) => {
    try {
      setMemEntry(mem.item, scope, id, entry);
      store[STORE_ITEM_DETAILS][id] = entry;
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cachePutItem failed:", e);
      return false;
    }
  });
}

function cachePutItemMemory(id, data, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  if (!id || !data) return false;
  const scope = resolveScope();
  const entry = createItemCacheEntry(id, data, ttlMs);
  setMemEntry(mem.item, scope, id, entry);
  return true;
}

export async function cacheDeleteItem(id) {
  if (!id) return false;

  return withStore(STORE_ITEM_DETAILS, "readwrite", (store, _tx, _memFallback, scope) => {
    try {
      deleteMemEntry(mem.item, scope, id);
      deleteMemEntry(mem.userData, scope, id);
      delete store[STORE_ITEM_DETAILS][id];
      delete store[STORE_USER_DATA][id];
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cacheDeleteItem failed:", e);
      return false;
    }
  });
}

export async function cachePatchItemUserData(itemId, userDataPatch, {
  itemData = null,
  queryFreshTtlMs = 5 * 60 * 1000,
} = {}) {
  const id = String(itemId || "").trim();
  const patch = normalizeUserDataPatch(userDataPatch);
  if (!id || !Object.keys(patch).length) return false;

  const candidateItem = patchItemRecordUserData(itemData, id, patch);

  return withStore(STORE_QUERY_CACHE, "readwrite", (store, _tx, _memFallback, scope) => {
    let changed = false;

    const existingUserDataRow = store[STORE_USER_DATA][id] || null;
    const mergedUserData = mergeUserDataPatch(existingUserDataRow?.userData, patch);
    const userDataEntry = createUserDataCacheEntry(id, mergedUserData, queryFreshTtlMs);
    store[STORE_USER_DATA][id] = userDataEntry;
    setMemEntry(mem.userData, scope, id, userDataEntry);
    changed = true;

    const itemRow = store[STORE_ITEM_DETAILS][id] || null;
    if (itemRow?.data) {
      const nextItem = patchItemRecordUserData(itemRow.data, id, patch);
      if (nextItem !== itemRow.data) {
        itemRow.data = nextItem;
        touchCacheEntry(itemRow, DEFAULTS.itemTtlMs);
        setMemEntry(mem.item, scope, id, itemRow);
        changed = true;
      }
    } else if (isRecord(candidateItem)) {
      const entry = createItemCacheEntry(id, candidateItem, DEFAULTS.itemTtlMs);
      store[STORE_ITEM_DETAILS][id] = entry;
      setMemEntry(mem.item, scope, id, entry);
      changed = true;
    }

    for (const [queryKey, row] of Object.entries(store[STORE_QUERY_CACHE] || {})) {
      if (!isRecord(row) || !isRecord(row.data) || row.data.__type !== "json") continue;

      const metaKind = String(row.meta?.kind || "").trim();
      let nextWrapped = row.data;

      if (metaKind === "homeItemUserData") {
        nextWrapped = patchWrappedJsonItems(row.data, id, patch);
      } else if (metaKind === "resume") {
        nextWrapped = patchWrappedJsonItems(row.data, id, patch, {
          allowUpsert: isRecord(candidateItem),
          itemData: candidateItem,
          removeIf: (userData) => !isPartialPlaybackUserData(userData),
        });
        nextWrapped = sortResumeWrappedJsonItems(nextWrapped);
      } else if (metaKind === "itemsPool") {
        const queryString = String(row.meta?.queryString || "").toLowerCase();
        const isOnlyUnwatchedQuery =
          /(?:^|[?&])isplayed=false(?:$|&)/i.test(queryString) ||
          /(?:^|[?&])filters=isunplayed(?:$|&)/i.test(queryString);
        if (isOnlyUnwatchedQuery && patch.Played === true) {
          nextWrapped = patchWrappedJsonItems(row.data, id, patch, {
            removeIf: (userData) => isCompletedUserData(userData),
          });
        }
      } else {
        nextWrapped = patchWrappedJsonItems(row.data, id, patch);
      }

      if (nextWrapped === row.data) continue;

      row.data = {
        ...nextWrapped,
        expiresAt: now() + Math.max(30_000, Number(queryFreshTtlMs) || 0),
      };
      touchCacheEntry(row, queryFreshTtlMs);
      setMemEntry(mem.query, scope, queryKey, row);
      changed = true;
    }

    return changed;
  });
}

export async function cacheGetItemsMap(ids, { allowStale = false } = {}) {
  const uniq = dedupeIds(ids);
  if (!uniq.length) return new Map();

  return withStore(STORE_ITEM_DETAILS, "readonly", (store, _tx, _memFallback, scope) => {
    const out = new Map();

    for (const id of uniq) {
      const row = getMemEntry(mem.item, scope, id) || store[STORE_ITEM_DETAILS][id] || null;
      if (!row) continue;
      setMemEntry(mem.item, scope, id, row);
      if (row.expiresAt > now() || allowStale) out.set(id, row.data);
    }

    return out;
  });
}

export async function cacheGetItemEntriesMap(ids, { allowStale = false } = {}) {
  const uniq = dedupeIds(ids);
  if (!uniq.length) return new Map();

  return withStore(STORE_ITEM_DETAILS, "readonly", (store, _tx, _memFallback, scope) => {
    const out = new Map();

    for (const id of uniq) {
      const row = getMemEntry(mem.item, scope, id) || store[STORE_ITEM_DETAILS][id] || null;
      if (!row) continue;
      setMemEntry(mem.item, scope, id, row);
      if (row.expiresAt > now() || allowStale) out.set(id, row);
    }

    return out;
  });
}

export async function cachePutItems(items, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  const fetchedAt = now();
  const expiresAt = fetchedAt + normalizeTtlMs(ttlMs, 5_000);
  const entries = [];

  for (const raw of Array.isArray(items) ? items : []) {
    const hasWrappedData = !!(
      raw &&
      typeof raw === "object" &&
      Object.prototype.hasOwnProperty.call(raw, "data") &&
      (Object.prototype.hasOwnProperty.call(raw, "id") || Object.prototype.hasOwnProperty.call(raw, "Id"))
    );
    const data = hasWrappedData ? raw.data : raw;
    const id = hasWrappedData
      ? (raw.id || raw.Id)
      : (data?.Id || data?.id);
    if (!id || !data) continue;
    entries.push({
      id: String(id),
      data,
      fetchedAt,
      expiresAt,
    });
  }

  if (!entries.length) return 0;

  return withStore(STORE_ITEM_DETAILS, "readwrite", (store, _tx, _memFallback, scope) => {
    try {
      for (const entry of entries) {
        setMemEntry(mem.item, scope, entry.id, entry);
        store[STORE_ITEM_DETAILS][entry.id] = entry;
      }
      return entries.length;
    } catch (e) {
      console.warn("[JMS][cache] cachePutItems failed:", e);
      return 0;
    }
  });
}

function cachePutItemsMemory(items, { ttlMs = DEFAULTS.itemTtlMs } = {}) {
  const fetchedAt = now();
  const expiresAt = fetchedAt + normalizeTtlMs(ttlMs, 5_000);
  const scope = resolveScope();
  let count = 0;

  for (const raw of Array.isArray(items) ? items : []) {
    const hasWrappedData = !!(
      raw &&
      typeof raw === "object" &&
      Object.prototype.hasOwnProperty.call(raw, "data") &&
      (Object.prototype.hasOwnProperty.call(raw, "id") || Object.prototype.hasOwnProperty.call(raw, "Id"))
    );
    const data = hasWrappedData ? raw.data : raw;
    const id = hasWrappedData
      ? (raw.id || raw.Id)
      : (data?.Id || data?.id);
    if (!id || !data) continue;
    setMemEntry(mem.item, scope, String(id), {
      id: String(id),
      data,
      fetchedAt,
      expiresAt,
    });
    count++;
  }

  return count;
}

export async function cacheGetUserDataMap(ids, { allowStale = false } = {}) {
  const uniq = dedupeIds(ids);
  if (!uniq.length) return new Map();

  return withStore(STORE_USER_DATA, "readonly", (store, _tx, _memFallback, scope) => {
    const out = new Map();

    for (const id of uniq) {
      const row = getMemEntry(mem.userData, scope, id) || store[STORE_USER_DATA][id] || null;
      if (!row) continue;
      setMemEntry(mem.userData, scope, id, row);
      if (row.expiresAt > now() || allowStale) {
        out.set(id, {
          Id: id,
          UserData: isRecord(row.userData) ? { ...row.userData } : {},
        });
      }
    }

    return out;
  });
}

export async function cachePutUserDataItems(items, { ttlMs = DEFAULTS.resumeTtlMs } = {}) {
  const entries = [];

  for (const raw of Array.isArray(items) ? items : []) {
    const id = String(raw?.Id || raw?.id || "").trim();
    if (!id || !isRecord(raw?.UserData)) continue;
    entries.push(createUserDataCacheEntry(id, raw.UserData, ttlMs));
  }

  if (!entries.length) return 0;

  return withStore(STORE_USER_DATA, "readwrite", (store, _tx, _memFallback, scope) => {
    try {
      for (const entry of entries) {
        setMemEntry(mem.userData, scope, entry.id, entry);
        store[STORE_USER_DATA][entry.id] = entry;
      }
      return entries.length;
    } catch (e) {
      console.warn("[JMS][cache] cachePutUserDataItems failed:", e);
      return 0;
    }
  });
}

export async function cacheGetQuery(key, { allowStale = false } = {}) {
  if (!key) return null;

  return withStore(STORE_QUERY_CACHE, "readonly", (store, _tx, _memFallback, scope) => {
    const memEntry = getMemEntry(mem.query, scope, key);
    if (memEntry && (isFresh(memEntry) || allowStale)) return queryDataForRead(memEntry);

    const row = store[STORE_QUERY_CACHE][key] || null;
    if (!row) return null;
    setMemEntry(mem.query, scope, key, row);
    if (row.expiresAt > now() || allowStale) return queryDataForRead(row);
    return null;
  });
}

export async function cachePutQuery(key, data, { ttlMs = DEFAULTS.queryTtlMs, entryMeta = undefined } = {}) {
  if (!key) return false;
  const entry = createQueryCacheEntry(key, data, ttlMs);
  if (entryMeta !== undefined) {
    entry.meta = isRecord(entryMeta) ? { ...entryMeta } : entryMeta;
  }

  return withStore(STORE_QUERY_CACHE, "readwrite", (store, _tx, _memFallback, scope) => {
    try {
      setMemEntry(mem.query, scope, key, entry);
      store[STORE_QUERY_CACHE][key] = entry;
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cachePutQuery failed:", e);
      return false;
    }
  });
}

export async function cacheClearQueries() {
  return withStore(STORE_QUERY_CACHE, "readwrite", (store, _tx, _memFallback, scope) => {
    try {
      clearMemScope(mem.query, scope);
      store[STORE_QUERY_CACHE] = {};
      return true;
    } catch (e) {
      console.warn("[JMS][cache] cacheClearQueries failed:", e);
      return false;
    }
  });
}

export async function metaGet(k) {
  if (!k) return null;
  return withStore(STORE_META, "readonly", (store, _tx, _memFallback, scope) => {
    const memEntry = getMemEntry(mem.meta, scope, k);
    if (memEntry) return memEntry.v;
    const row = store[STORE_META][k] || null;
    if (row) setMemEntry(mem.meta, scope, k, row);
    return row ? row.v : null;
  });
}

export async function metaPut(k, v) {
  if (!k) return false;
  return withStore(STORE_META, "readwrite", (store, _tx, _memFallback, scope) => {
    try {
      const row = { k, v, updatedAt: now() };
      setMemEntry(mem.meta, scope, k, row);
      store[STORE_META][k] = row;
      return true;
    } catch (e) {
      console.warn("[JMS][cache] metaPut failed:", e);
      return false;
    }
  });
}

function createScheduledTask(run, delayMs = 0) {
  const delay = Math.max(0, Number(delayMs) || 0);

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

async function persistBackgroundWarmJob(job) {
  if (!job?.metaKey) return false;

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

async function restoreBackgroundWarmIds(scopeKey) {
  const state = await metaGet(`${BACKGROUND_WARM_META_PREFIX}${scopeKey}`);
  if (!state || state.done !== false) return [];

  const ids = Array.isArray(state.ids) ? state.ids : [];
  const cursor = Math.max(0, Math.min(ids.length, Number(state.cursor) || 0));
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
  for (const job of backgroundWarmJobs.values()) {
    stopBackgroundWarmJob(job);
  }
  backgroundWarmJobs.clear();
}

function applyBackgroundWarmQueueUpdate(job) {
  if (!job?.nextIds?.length) return false;

  const pending = Array.isArray(job.ids)
    ? job.ids.slice(Math.max(0, Number(job.cursor) || 0))
    : [];

  job.ids = dedupeIds([...pending, ...job.nextIds]);
  job.cursor = 0;
  job.done = job.ids.length === 0;
  job.nextIds = [];
  return true;
}

function scheduleBackgroundWarmJob(job, delayMs = job?.delayMs || 0) {
  if (!job || job.stopped) return;
  cancelScheduledTask(job.scheduled);
  job.scheduled = createScheduledTask(() => {
    job.scheduled = null;
    void runBackgroundWarmJob(job);
  }, delayMs);
}

async function runBackgroundWarmJob(job) {
  if (!job || job.stopped || job.running) return;

  job.running = true;

  try {
    if (applyBackgroundWarmQueueUpdate(job)) {
      await persistBackgroundWarmJob(job);
    }

    const cursor = Math.max(0, Math.min(job.ids.length, Number(job.cursor) || 0));
    if (cursor >= job.ids.length) {
      job.done = true;
      await persistBackgroundWarmJob(job);
      stopBackgroundWarmJob(job);
      return;
    }

    const chunk = job.ids.slice(cursor, cursor + job.batchSize);
    if (!chunk.length) {
      job.done = true;
      await persistBackgroundWarmJob(job);
      stopBackgroundWarmJob(job);
      return;
    }

    await job.warmChunk(chunk);

    job.cursor = cursor + chunk.length;
    job.done = job.cursor >= job.ids.length;
    job.lastError = "";
    await persistBackgroundWarmJob(job);

    if (applyBackgroundWarmQueueUpdate(job)) {
      await persistBackgroundWarmJob(job);
    }

    if (job.done) {
      stopBackgroundWarmJob(job);
      return;
    }

    scheduleBackgroundWarmJob(job, job.delayMs);
  } catch (e) {
    job.lastError = e?.message ? String(e.message) : String(e || "warmup failed");
    await persistBackgroundWarmJob(job);
    scheduleBackgroundWarmJob(job, Math.min(5_000, Math.max(job.delayMs, job.delayMs * 2)));
  } finally {
    job.running = false;
  }
}

async function startBackgroundWarmJob({
  scopeKey,
  ids,
  batchSize = 60,
  delayMs = 180,
  warmChunk,
}) {
  const cleanScopeKey = String(scopeKey || "").trim();
  if (!cleanScopeKey || typeof warmChunk !== "function") return null;

  const incomingIds = dedupeIds(ids);
  if (!incomingIds.length) return null;

  const existing = backgroundWarmJobs.get(cleanScopeKey);
  if (existing) {
    existing.batchSize = Math.max(10, Math.min(200, Number(batchSize) || 60));
    existing.delayMs = Math.max(80, Number(delayMs) || 180);
    existing.warmChunk = warmChunk;
    existing.nextIds = dedupeIds([...(existing.nextIds || []), ...incomingIds]);

    if (!existing.running) {
      applyBackgroundWarmQueueUpdate(existing);
      await persistBackgroundWarmJob(existing);
      scheduleBackgroundWarmJob(existing, 0);
    }

    return existing;
  }

  const resumedIds = await restoreBackgroundWarmIds(cleanScopeKey);
  const queue = dedupeIds([...resumedIds, ...incomingIds]);
  if (!queue.length) return null;

  const job = {
    scopeKey: cleanScopeKey,
    metaKey: `${BACKGROUND_WARM_META_PREFIX}${cleanScopeKey}`,
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
  await persistBackgroundWarmJob(job);
  scheduleBackgroundWarmJob(job, 0);
  return job;
}

async function mapLimit(arr, limit, mapper) {
  const out = new Array(arr.length);
  let idx = 0;

  const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (idx < arr.length) {
      const cur = idx++;
      try { out[cur] = await mapper(arr[cur], cur); }
      catch (e) { out[cur] = null; }
    }
  });

  await Promise.all(workers);
  return out;
}

export async function cachedFetchText({
  keyParts,
  fetchText,
  url,
  ttlMs = DEFAULTS.listFileTtlMs,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
}){
  const key = makeKey(["text", ...keyParts]);
  const cached = await cacheGetQuery(key, { allowStale: allowStaleOnError });
  if (cached && cached.__type === "text") {
    if (cached.expiresAt > now()) return cached.text;
  }

  try {
    const text = await fetchText(url);
    await cachePutQuery(key, { __type: "text", text, expiresAt: now() + ttlMs }, { ttlMs });
    return text;
  } catch (e) {
    if (allowStaleOnError && cached && cached.__type === "text") return cached.text;
    throw e;
  }
}

export async function cachedFetchJson({
  keyParts,
  fetchJson,
  url,
  opts,
  ttlMs = DEFAULTS.queryTtlMs,
  entryMeta = null,
  allowStaleOnError = DEFAULTS.allowStaleOnError,
}){
  const key = makeKey(["json", ...keyParts]);
  const cached = await cacheGetQuery(key, { allowStale: allowStaleOnError });
  if (cached && cached.__type === "json") {
    if (cached.expiresAt > now()) return cached.data;
  }

  try {
    const data = await fetchJson(url, opts);
    await cachePutQuery(
      key,
      { __type: "json", data, expiresAt: now() + ttlMs },
      { ttlMs, entryMeta }
    );
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

  const inflight = new Map();
  const resolvedBatchSize = Math.max(10, Math.min(200, Number(batchSize) || 60));
  const resolvedRevalidateAfterMs = Math.max(0, Number(revalidateAfterMs) || 0);

  function shouldRevalidateEntry(entry) {
    if (!entry || !(resolvedRevalidateAfterMs > 0)) return false;
    const fetchedAt = Number(entry.fetchedAt || 0);
    if (!(fetchedAt > 0)) return true;
    return (Date.now() - fetchedAt) > resolvedRevalidateAfterMs;
  }

  async function getOne(id, { persistFetched = true } = {}) {
    if (!id) return null;

    const freshEntry = await cacheGetItemEntry(id, { allowStale: false });
    if (freshEntry && !shouldRevalidateEntry(freshEntry)) return freshEntry.data;
    if (inflight.has(id)) return inflight.get(id);

    const p = (async () => {
      const staleEntry = allowStaleOnError
        ? (freshEntry || await cacheGetItemEntry(id, { allowStale: true }))
        : null;
      const stale = staleEntry?.data || null;

      try {
        const data = await fetchOne(id);
        if (data) {
          if (persistFetched) {
            await cachePutItem(id, data, { ttlMs });
          } else {
            cachePutItemMemory(id, data, { ttlMs });
          }
        }
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

  async function hydrateMissingWithBulk(ids, { persistFetched = true } = {}) {
    const uniq = dedupeIds(ids);
    if (!uniq.length || typeof fetchMany !== "function") return false;

    for (let start = 0; start < uniq.length; start += resolvedBatchSize) {
      const chunk = uniq.slice(start, start + resolvedBatchSize);
      const items = await fetchMany(chunk);
      if (Array.isArray(items) && items.length) {
        if (persistFetched) {
          await cachePutItems(items, { ttlMs });
        } else {
          cachePutItemsMemory(items, { ttlMs });
        }
      }
    }

    return true;
  }

  getOne.many = async function(ids, { prefetchOnly = false, persistFetched = true } = {}) {
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) return prefetchOnly ? { total: 0, missing: 0 } : [];

    const freshEntriesMap = await cacheGetItemEntriesMap(list, { allowStale: false });
    const out = prefetchOnly ? null : new Array(list.length).fill(null);
    const missing = [];

    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (!id) continue;
      const hitEntry = freshEntriesMap.get(id) || null;
      if (hitEntry && !shouldRevalidateEntry(hitEntry)) {
        if (out) out[i] = hitEntry.data;
        continue;
      }
      missing.push(id);
    }

    if (missing.length && typeof fetchMany === "function") {
      try {
        await hydrateMissingWithBulk(missing, { persistFetched });
      } catch {}
    }

    const hydratedEntriesMap = missing.length
      ? await cacheGetItemEntriesMap(missing, { allowStale: false })
      : freshEntriesMap;

    if (out) {
      for (let i = 0; i < list.length; i++) {
        if (out[i]) continue;
        const id = list[i];
        const hitEntry = hydratedEntriesMap.get(id) || null;
        if (hitEntry && !shouldRevalidateEntry(hitEntry)) out[i] = hitEntry.data;
      }
    }

    const remainingIds = prefetchOnly
      ? dedupeIds(missing.filter((id) => {
          const hitEntry = hydratedEntriesMap.get(id) || null;
          return !hitEntry || shouldRevalidateEntry(hitEntry);
        }))
      : list
          .map((id, idx) => (!out[idx] ? id : null))
          .filter(Boolean);

    if (remainingIds.length) {
      const uniqueRemainingIds = prefetchOnly ? remainingIds : dedupeIds(remainingIds);
      const fetchedRemaining = await mapLimit(uniqueRemainingIds, maxConcurrent, async (id) => getOne(id, { persistFetched }));

      if (out) {
        const remainingById = new Map();
        for (let i = 0; i < uniqueRemainingIds.length; i++) {
          const item = fetchedRemaining[i];
          if (!item) continue;
          const id = item?.Id || item?.id || uniqueRemainingIds[i];
          if (id) remainingById.set(id, item);
        }

        for (let i = 0; i < list.length; i++) {
          if (out[i]) continue;
          const id = list[i];
          const hit = remainingById.get(id) || null;
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

  getOne.startWarmup = async function({
    scopeKey = "default",
    ids = [],
    batchSize: warmBatchSize = resolvedBatchSize,
    delayMs = 180,
  } = {}) {
    return startBackgroundWarmJob({
      scopeKey,
      ids,
      batchSize: warmBatchSize,
      delayMs,
      warmChunk: async (chunkIds) => {
        await getOne.many(chunkIds, { prefetchOnly: true });
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
  initialDelayMs = null,
  limit = 50,
  includeItemTypes = null,
}) {
  if (!userId) return () => {};
  if (typeof fetchJson !== "function") throw new Error("fetchJson required");
  if (typeof getAuthHeaders !== "function") throw new Error("getAuthHeaders required");
  if (typeof fetchItemDetailsCached !== "function") throw new Error("fetchItemDetailsCached required");

  let stopped = false;
  let timer = null;
  const resolvedIntervalMs = Math.max(10_000, Number(intervalMs) || 60_000);
  const resolvedInitialDelayMs = Math.max(
    10_000,
    Number(initialDelayMs) || resolvedIntervalMs
  );

  const metaKey = `latestCursor:${userId}`;

  async function tick() {
    if (stopped) return;

    const headers = getAuthHeaders() || {};
    const opts = { headers };

    let latest = null;
    try {
      const qs = new URLSearchParams();
      qs.set("Limit", String(limit));
      if (includeItemTypes) qs.set("IncludeItemTypes", includeItemTypes);
      qs.set("Fields", "DateCreated,ImageTags,BackdropImageTags");
      latest = await fetchJson(`/Users/${userId}/Items/Latest?${qs.toString()}`, opts);
    } catch {
      latest = null;
    }

    if (!latest) {
      try {
        const qs = new URLSearchParams();
        qs.set("Recursive", "true");
        qs.set("SortBy", "DateCreated");
        qs.set("SortOrder", "Descending");
        qs.set("Limit", String(limit));
        if (includeItemTypes) qs.set("IncludeItemTypes", includeItemTypes);
        qs.set("Fields", "DateCreated,ImageTags,BackdropImageTags");
        const data = await fetchJson(`/Users/${userId}/Items?${qs.toString()}`, opts);
        latest = data?.Items || [];
      } catch {
        latest = [];
      }
    }

    const arr = Array.isArray(latest) ? latest : (latest?.Items || []);
    if (!arr.length) return;

    const cursor = await metaGet(metaKey);
    const lastSeen = cursor?.lastSeenDateCreated ? Date.parse(cursor.lastSeenDateCreated) : 0;
    const newOnes = [];
    let maxSeen = lastSeen;

    for (const it of arr) {
      const id = it?.Id || it?.id;
      const dc = it?.DateCreated || it?.dateCreated;
      const t = dc ? Date.parse(dc) : 0;
      if (t && t > maxSeen) maxSeen = t;
      if (id && t && t > lastSeen) newOnes.push(id);
    }

    if (newOnes.length) {
      try {
        await fetchItemDetailsCached.many(newOnes.slice(0, 20));
      } catch {}
    }

    if (maxSeen > lastSeen) {
      await metaPut(metaKey, { lastSeenDateCreated: new Date(maxSeen).toISOString() });
    }
  }

  async function loop() {
    if (stopped) return;
    try { await tick(); } catch {}
    if (stopped) return;
    timer = setTimeout(loop, resolvedIntervalMs);
  }

  timer = setTimeout(loop, resolvedInitialDelayMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
