import { createScopedJsonDb, prepareLegacyIndexedDbForDeletion } from "./scopedJsonCache.js";

const DB_NAME = "monwui_recent_db";
const STORE_TYPE = "recentRows";
const MAX_ITEMS = 2400;
const MAX_META = 200;
const ITEM_TTL_MS = 45 * 24 * 60 * 60 * 1000;
const META_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const STABLE_IGNORE_FIELDS = ["fetchedAt", "expiresAt", "updatedAt", "UserData", "UserDataDto", "userData", "userDataDto"];

export async function prepareRecentRowsDbForDeletion() {
  try { await __recentRowsDb?.close?.(); } catch {}
  __recentRowsDb = null;
  return prepareLegacyIndexedDbForDeletion([DB_NAME]);
}

function idle(cb, { timeout = 1500 } = {}) {
  try {
    const ric = window.requestIdleCallback;
    if (typeof ric === "function") return ric(cb, { timeout });
  } catch {}
  return setTimeout(() => {
    try { cb({ timeRemaining: () => 0, didTimeout: true }); } catch {}
  }, 1);
}

function ensureStoreShape(data) {
  if (!data || typeof data !== "object") return { items: {}, meta: {} };
  if (!data.items || typeof data.items !== "object" || Array.isArray(data.items)) data.items = {};
  if (!data.meta || typeof data.meta !== "object" || Array.isArray(data.meta)) data.meta = {};
  return data;
}

function normalizeUserData(raw) {
  if (!raw || typeof raw !== "object") return null;
  const playedPct = Number(raw.PlayedPercentage);
  const posTicks = Number(raw.PlaybackPositionTicks);
  return {
    Played: raw.Played === true,
    PlayedPercentage: Number.isFinite(playedPct) ? playedPct : null,
    PlaybackPositionTicks: Number.isFinite(posTicks) ? posTicks : null,
    LastPlayedDate: raw.LastPlayedDate || raw.LastPlayedDateUtc || null,
  };
}

function normalizeCachedItem(rec) {
  if (!rec) return null;

  const Id = rec.Id || rec.itemId || null;
  if (!Id) return null;
  const userData = normalizeUserData(rec.UserData || rec.UserDataDto || rec.userData || rec.userDataDto || null);

  return {
    Id,
    Name: rec.Name || rec.name || "",
    Type: rec.Type || rec.type || "",
    SeriesId: rec.SeriesId ?? rec.seriesId ?? null,
    SeriesName: rec.SeriesName ?? rec.seriesName ?? "",
    ParentId: rec.ParentId ?? rec.parentId ?? null,
    IndexNumber: rec.IndexNumber ?? rec.indexNumber ?? null,
    ParentIndexNumber: rec.ParentIndexNumber ?? rec.parentIndexNumber ?? null,
    ProductionYear: rec.ProductionYear ?? rec.productionYear ?? null,
    OfficialRating: rec.OfficialRating || rec.officialRating || "",
    CommunityRating: rec.CommunityRating ?? rec.communityRating ?? null,
    ImageTags: rec.ImageTags || rec.imageTags || null,
    BackdropImageTags: rec.BackdropImageTags || rec.backdropImageTags || null,
    PrimaryImageAspectRatio: rec.PrimaryImageAspectRatio ?? rec.primaryImageAspectRatio ?? null,
    Overview: rec.Overview || rec.overview || "",
    Genres: rec.Genres || rec.genres || [],
    RunTimeTicks: rec.RunTimeTicks ?? rec.runTimeTicks ?? null,
    CumulativeRunTimeTicks: rec.CumulativeRunTimeTicks ?? rec.cumulativeRunTimeTicks ?? null,
    RemoteTrailers: rec.RemoteTrailers || rec.remoteTrailers || [],
    DateCreatedTicks: rec.DateCreatedTicks ?? rec.dateCreatedTicks ?? 0,
    People: rec.People || rec.people || [],
    UserData: userData,
    UserDataDto: userData,
    __preferTaglessImages: true,
  };
}

function toItemRecord(item, now = Date.now()) {
  if (!item?.Id) return null;
  const userData = normalizeUserData(item.UserData || item.UserDataDto || null);

  return {
    Id: item.Id,
    Name: item.Name || "",
    Type: item.Type || "",
    SeriesId: item.SeriesId || null,
    SeriesName: item.SeriesName || "",
    ParentId: item.ParentId || null,
    IndexNumber: item.IndexNumber ?? null,
    ParentIndexNumber: item.ParentIndexNumber ?? null,
    ProductionYear: item.ProductionYear || null,
    OfficialRating: item.OfficialRating || "",
    CommunityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
    ImageTags: item.ImageTags || null,
    BackdropImageTags: item.BackdropImageTags || null,
    PrimaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
    Overview: item.Overview || "",
    Genres: Array.isArray(item.Genres) ? item.Genres : [],
    RunTimeTicks: item.RunTimeTicks || null,
    CumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
    RemoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
    DateCreatedTicks: item.DateCreatedTicks || 0,
    People: item.People || [],
    UserData: userData,
    UserDataDto: userData,

    itemId: item.Id,
    type: item.Type || "",
    name: item.Name || "",
    seriesId: item.SeriesId || null,
    seriesName: item.SeriesName || "",
    parentId: item.ParentId || null,
    indexNumber: item.IndexNumber ?? null,
    parentIndexNumber: item.ParentIndexNumber ?? null,
    productionYear: item.ProductionYear || null,
    officialRating: item.OfficialRating || "",
    communityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
    imageTags: item.ImageTags || null,
    backdropImageTags: item.BackdropImageTags || null,
    primaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
    overview: item.Overview || "",
    genres: Array.isArray(item.Genres) ? item.Genres : [],
    runTimeTicks: item.RunTimeTicks || null,
    cumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
    remoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
    dateCreatedTicks: item.DateCreatedTicks || 0,
    people: item.People || [],
    userData,
    userDataDto: userData,
    updatedAt: now,
  };
}

function pruneMapByAgeAndCount(map, ttlMs, maxItems) {
  const now = Date.now();
  const entries = Object.entries(map || {});

  if (ttlMs > 0) {
    const cutoff = now - ttlMs;
    for (const [key, value] of entries) {
      const updatedAt = Number(value?.updatedAt || 0);
      if (updatedAt && updatedAt < cutoff) {
        delete map[key];
      }
    }
  }

  const remaining = Object.entries(map || {});
  if (maxItems > 0 && remaining.length > maxItems) {
    remaining
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
      .slice(0, remaining.length - maxItems)
      .forEach(([key]) => {
        delete map[key];
      });
  }
}

function collectReferencedItemIds(store) {
  const refs = new Set();
  for (const rec of Object.values(store.meta || {})) {
    const ids = Array.isArray(rec?.value?.ids) ? rec.value.ids : [];
    for (const rawId of ids) {
      const id = String(rawId || "").trim();
      if (id) refs.add(id);
    }
  }
  return refs;
}

function pruneStore(store) {
  pruneMapByAgeAndCount(store.items, ITEM_TTL_MS, MAX_ITEMS);
  pruneMapByAgeAndCount(store.meta, META_TTL_MS, MAX_META);

  const refs = collectReferencedItemIds(store);
  if (!refs.size) return;

  for (const itemId of Object.keys(store.items || {})) {
    if (!refs.has(itemId)) {
      delete store.items[itemId];
    }
  }
}

function resolveMetaScope(db, key) {
  const active = String(db?.__jmsActiveScope || "").trim();
  if (active) return active;
  const raw = String(key || "");
  const pipeIndex = raw.indexOf("|");
  return pipeIndex >= 0 ? raw.slice(pipeIndex + 1) : "";
}

let __recentRowsDb = null;

export async function openDirRowsDB() {
  if (!__recentRowsDb) {
    __recentRowsDb = createScopedJsonDb({
      cacheType: STORE_TYPE,
      defaultData: () => ({ items: {}, meta: {} }),
      saveDelayMs: 800,
      retryDelayMs: 2200,
      legacyDbNames: [DB_NAME],
      stableIgnoreFields: STABLE_IGNORE_FIELDS
    });
  }
  return __recentRowsDb;
}

export function makeScope({ serverId, userId }) {
  return `${serverId || ""}|${userId || ""}`;
}

export async function upsertItemsBatch(db, scope, items) {
  const list = Array.isArray(items) ? items.filter((x) => x?.Id) : [];
  if (!db || !scope || !list.length) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const now = Date.now();

    for (const item of list) {
      const rec = toItemRecord(item, now);
      if (rec?.Id) {
        store.items[rec.Id] = rec;
      }
    }

    pruneStore(store);
  }, { flush: true });
}

export async function getItemsByIds(db, scope, ids) {
  const list = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!db || !scope || !list.length) return [];

  return db.readScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const out = [];
    for (const id of list) {
      const norm = normalizeCachedItem(store.items[id]);
      if (norm?.Id) out.push(norm);
    }
    return out;
  });
}

export function upsertItemsBatchIdle(db, scope, items, opts) {
  return idle(() => { void upsertItemsBatch(db, scope, items); }, opts);
}

export async function getMeta(db, key) {
  const scope = resolveMetaScope(db, key);
  if (!db || !scope || !key) return null;

  return db.readScope(scope, (data) => {
    const store = ensureStoreShape(data);
    return store.meta[key]?.value ?? null;
  });
}

export async function setMeta(db, key, value) {
  const scope = resolveMetaScope(db, key);
  if (!db || !scope || !key) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    store.meta[key] = {
      value,
      updatedAt: Date.now(),
    };
    pruneStore(store);
  }, { flush: true });
}
