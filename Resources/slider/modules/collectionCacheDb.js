import { getSessionInfo } from "../../Plugins/JMSFusion/runtime/api.js";
import { createScopedJsonDb, prepareLegacyIndexedDbForDeletion } from "./scopedJsonCache.js";

const DB_NAME = "jms_collection_cache";
const STORE_TYPE = "collectionCache";
const STORE_MOVIE_BOXSET = "movieBoxset";
const STORE_BOXSET_ITEMS = "boxsetItems";
const STORE_META = "meta";
const MAX_MOVIE_BOXSET = 6000;
const MAX_BOXSET_ITEMS = 1200;
const MAX_META = 600;
const MOVIE_BOXSET_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const BOXSET_ITEMS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const META_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let _dbP = null;

export async function prepareCollectionCacheDbForDeletion() {
  try {
    await prepareLegacyIndexedDbForDeletion([DB_NAME]);
  } catch {}

  const db = await Promise.resolve(_dbP).catch(() => null);
  try { await db?.close?.(); } catch {}
  _dbP = null;
}

function now() {
  return Date.now();
}

function idle(cb, { timeout = 1200 } = {}) {
  if (typeof requestIdleCallback === "function") {
    return requestIdleCallback(cb, { timeout });
  }
  return setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 250);
}

function cancelIdle(handle) {
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  else clearTimeout(handle);
}

function ensureStoreShape(data) {
  if (!data || typeof data !== "object") {
    return {
      [STORE_MOVIE_BOXSET]: {},
      [STORE_BOXSET_ITEMS]: {},
      [STORE_META]: {},
    };
  }

  if (!data[STORE_MOVIE_BOXSET] || typeof data[STORE_MOVIE_BOXSET] !== "object" || Array.isArray(data[STORE_MOVIE_BOXSET])) {
    data[STORE_MOVIE_BOXSET] = {};
  }
  if (!data[STORE_BOXSET_ITEMS] || typeof data[STORE_BOXSET_ITEMS] !== "object" || Array.isArray(data[STORE_BOXSET_ITEMS])) {
    data[STORE_BOXSET_ITEMS] = {};
  }
  if (!data[STORE_META] || typeof data[STORE_META] !== "object" || Array.isArray(data[STORE_META])) {
    data[STORE_META] = {};
  }

  return data;
}

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
    const str = String(value || "").trim();
    if (str) return str;
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

function pruneMapByAgeAndCount(map, ttlMs, maxItems) {
  const cutoff = now() - Math.max(60_000, ttlMs | 0);

  for (const [key, row] of Object.entries(map || {})) {
    const updatedAt = Number(row?.updatedAt || 0);
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

function pruneStore(store) {
  pruneMapByAgeAndCount(store[STORE_MOVIE_BOXSET], MOVIE_BOXSET_TTL_MS, MAX_MOVIE_BOXSET);
  pruneMapByAgeAndCount(store[STORE_BOXSET_ITEMS], BOXSET_ITEMS_TTL_MS, MAX_BOXSET_ITEMS);
  pruneMapByAgeAndCount(store[STORE_META], META_TTL_MS, MAX_META);
}

function getDb() {
  if (!_dbP) {
    _dbP = Promise.resolve(createScopedJsonDb({
      cacheType: STORE_TYPE,
      defaultData: () => ({
        [STORE_MOVIE_BOXSET]: {},
        [STORE_BOXSET_ITEMS]: {},
        [STORE_META]: {},
      }),
      saveDelayMs: 700,
      retryDelayMs: 2000,
      legacyDbNames: [DB_NAME]
    }));
  }
  return _dbP;
}

async function readScope(reader) {
  const db = await getDb();
  const scope = resolveScope();
  db.__jmsActiveScope = scope;
  return db.readScope(scope, (data) => reader(ensureStoreShape(data), scope, db));
}

async function writeScope(writer, options = {}) {
  const db = await getDb();
  const scope = resolveScope();
  db.__jmsActiveScope = scope;
  return db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const result = writer(store, scope, db);
    pruneStore(store);
    return result;
  }, options);
}

export const CollectionCacheDB = {
  idle,
  cancelIdle,

  async getMovieBoxset(movieId) {
    if (!movieId) return null;
    return readScope((store) => store[STORE_MOVIE_BOXSET][String(movieId)] || null);
  },

  async setMovieBoxset(movieId, boxsetId, boxsetName) {
    if (!movieId) return null;
    const row = {
      movieId: String(movieId),
      boxsetId: boxsetId ? String(boxsetId) : "",
      boxsetName: boxsetName ? String(boxsetName) : "",
      updatedAt: now(),
    };

    await writeScope((store) => {
      store[STORE_MOVIE_BOXSET][row.movieId] = row;
    });
    return row;
  },

  async setMovieBoxsetMany(movieIds, boxsetId, boxsetName) {
    const ids = (movieIds || []).map(String).filter(Boolean);
    if (!ids.length) return;

    const updatedAt = now();
    const bid = boxsetId ? String(boxsetId) : "";
    const bnm = boxsetName ? String(boxsetName) : "";

    await writeScope((store) => {
      for (const movieId of ids) {
        store[STORE_MOVIE_BOXSET][movieId] = {
          movieId,
          boxsetId: bid,
          boxsetName: bnm,
          updatedAt,
        };
      }
    });
  },

  async getMovieBoxsetMany(movieIds) {
    const ids = (movieIds || []).map(String).filter(Boolean);
    if (!ids.length) return new Map();

    return readScope((store) => {
      const out = new Map();
      for (const movieId of ids) {
        out.set(movieId, store[STORE_MOVIE_BOXSET][movieId] || null);
      }
      return out;
    });
  },

  async getBoxsetItems(boxsetId) {
    if (!boxsetId) return null;
    return readScope((store) => store[STORE_BOXSET_ITEMS][String(boxsetId)] || null);
  },

  async setBoxsetItems(boxsetId, items) {
    if (!boxsetId) return null;

    const row = {
      boxsetId: String(boxsetId),
      items: Array.isArray(items) ? items : [],
      updatedAt: now(),
    };

    await writeScope((store) => {
      store[STORE_BOXSET_ITEMS][row.boxsetId] = row;
    });
    return row;
  },

  async getMeta(key) {
    if (!key) return null;
    return readScope((store) => store[STORE_META][String(key)] || null);
  },

  async setMeta(key, value) {
    if (!key) return null;

    const row = {
      key: String(key),
      value,
      updatedAt: now(),
    };

    await writeScope((store) => {
      store[STORE_META][row.key] = row;
    });
    return row;
  },
};
