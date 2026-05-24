import { createScopedJsonDb, prepareLegacyIndexedDbForDeletion } from "./scopedJsonCache.js";

const DB_NAME = "jms_dirrows_db";
const STORE_TYPE = "directorRows";
const MAX_DIRECTORS = 1200;
const MAX_ITEMS = 2400;
const MAX_ITEMS_PER_DIRECTOR = 36;
const MAX_DIRECTOR_ITEM_RELATIONS = 900;
const DIRECTOR_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ITEM_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const META_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const STABLE_IGNORE_FIELDS = ["fetchedAt", "expiresAt", "updatedAt", "UserData", "UserDataDto", "userData", "userDataDto"];

export async function prepareDirRowsDbForDeletion() {
  try { await __dirRowsDb?.close?.(); } catch {}
  __dirRowsDb = null;
  return prepareLegacyIndexedDbForDeletion([DB_NAME]);
}

function ensureStoreShape(data) {
  if (!data || typeof data !== "object") return { directors: {}, items: {}, directorItems: {}, meta: {} };
  if (!data.directors || typeof data.directors !== "object" || Array.isArray(data.directors)) data.directors = {};
  if (!data.items || typeof data.items !== "object" || Array.isArray(data.items)) data.items = {};
  if (!data.directorItems || typeof data.directorItems !== "object" || Array.isArray(data.directorItems)) data.directorItems = {};
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
  };
}

function toItemRecord(item, now = Date.now()) {
  if (!item?.Id) return null;
  const userData = normalizeUserData(item.UserData || item.UserDataDto || null);

  return {
    Id: item.Id,
    Name: item.Name || "",
    Type: item.Type || "",
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

function touchRelationMap(store, directorId) {
  let rel = store.directorItems[directorId];
  if (!rel || typeof rel !== "object" || Array.isArray(rel)) {
    rel = {};
    store.directorItems[directorId] = rel;
  }
  return rel;
}

function pruneByCount(map, maxItems) {
  const entries = Object.entries(map || {});
  if (!(maxItems > 0) || entries.length <= maxItems) return;

  entries
    .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
    .slice(0, entries.length - maxItems)
    .forEach(([key]) => {
      delete map[key];
    });
}

function compareRelationEntries(store, a, b) {
  const itemA = store.items?.[a[0]] || null;
  const itemB = store.items?.[b[0]] || null;
  const dateDiff =
    Number(itemB?.dateCreatedTicks || itemB?.DateCreatedTicks || 0) -
    Number(itemA?.dateCreatedTicks || itemA?.DateCreatedTicks || 0);
  if (dateDiff) return dateDiff;
  return Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0);
}

function pruneDirectorRelationCounts(store) {
  for (const [directorId, rels] of Object.entries(store.directorItems || {})) {
    if (!rels || typeof rels !== "object") {
      delete store.directorItems[directorId];
      continue;
    }

    const entries = Object.entries(rels).sort((a, b) => compareRelationEntries(store, a, b));
    if (entries.length > MAX_ITEMS_PER_DIRECTOR) {
      entries.slice(MAX_ITEMS_PER_DIRECTOR).forEach(([itemId]) => {
        delete rels[itemId];
      });
    }
  }

  const allRelations = [];
  for (const [directorId, rels] of Object.entries(store.directorItems || {})) {
    if (!rels || typeof rels !== "object") continue;
    for (const entry of Object.entries(rels)) {
      allRelations.push({ directorId, entry });
    }
  }

  if (allRelations.length <= MAX_DIRECTOR_ITEM_RELATIONS) return;

  allRelations
    .sort((a, b) => -compareRelationEntries(store, a.entry, b.entry))
    .slice(0, allRelations.length - MAX_DIRECTOR_ITEM_RELATIONS)
    .forEach(({ directorId, entry }) => {
      delete store.directorItems?.[directorId]?.[entry[0]];
    });
}

function pruneUnreferencedItems(store) {
  const refs = new Set();
  for (const rels of Object.values(store.directorItems || {})) {
    if (!rels || typeof rels !== "object") continue;
    Object.keys(rels).forEach((itemId) => refs.add(itemId));
  }

  if (!refs.size) return;

  for (const itemId of Object.keys(store.items || {})) {
    if (!refs.has(itemId)) {
      delete store.items[itemId];
    }
  }
}

function pruneStore(data, { pruneItemsWithoutRelations = false } = {}) {
  const store = ensureStoreShape(data);
  const now = Date.now();
  const itemCutoff = now - ITEM_TTL_MS;
  const directorCutoff = now - DIRECTOR_TTL_MS;
  const metaCutoff = now - META_TTL_MS;

  for (const [itemId, item] of Object.entries(store.items)) {
    const updatedAt = Number(item?.updatedAt || 0);
    if (updatedAt && updatedAt < itemCutoff) {
      delete store.items[itemId];
      for (const rels of Object.values(store.directorItems)) {
        if (rels && typeof rels === "object") delete rels[itemId];
      }
    }
  }

  pruneDirectorRelationCounts(store);

  for (const [directorId, rels] of Object.entries(store.directorItems)) {
    if (!rels || typeof rels !== "object") {
      delete store.directorItems[directorId];
      continue;
    }

    for (const itemId of Object.keys(rels)) {
      if (!store.items[itemId]) {
        delete rels[itemId];
      }
    }

    if (!Object.keys(rels).length) {
      delete store.directorItems[directorId];
      const director = store.directors[directorId];
      if (!director || Number(director.updatedAt || 0) < directorCutoff) {
        delete store.directors[directorId];
      }
    }
  }

  for (const [directorId, director] of Object.entries(store.directors)) {
    const updatedAt = Number(director?.updatedAt || 0);
    if (updatedAt && updatedAt < directorCutoff && !store.directorItems[directorId]) {
      delete store.directors[directorId];
    }
  }

  for (const [key, meta] of Object.entries(store.meta)) {
    const updatedAt = Number(meta?.updatedAt || 0);
    if (updatedAt && updatedAt < metaCutoff) {
      delete store.meta[key];
    }
  }

  pruneByCount(store.items, MAX_ITEMS);
  pruneByCount(store.directors, MAX_DIRECTORS);
  pruneDirectorRelationCounts(store);

  for (const [directorId, rels] of Object.entries(store.directorItems)) {
    if (!store.directors[directorId]) {
      delete store.directorItems[directorId];
      continue;
    }

    if (!rels || typeof rels !== "object") {
      delete store.directorItems[directorId];
      continue;
    }

    for (const itemId of Object.keys(rels)) {
      if (!store.items[itemId]) {
        delete rels[itemId];
      }
    }

    if (!Object.keys(rels).length) {
      delete store.directorItems[directorId];
    }
  }

  if (pruneItemsWithoutRelations) {
    pruneUnreferencedItems(store);
  }
}

function resolveMetaScope(db) {
  return String(db?.__jmsActiveScope || "").trim();
}

let __dirRowsDb = null;

export async function openDirRowsDB() {
  if (!__dirRowsDb) {
    __dirRowsDb = createScopedJsonDb({
      cacheType: STORE_TYPE,
      defaultData: () => ({ directors: {}, items: {}, directorItems: {}, meta: {} }),
      saveDelayMs: 850,
      retryDelayMs: 2200,
      legacyDbNames: [DB_NAME],
      stableIgnoreFields: STABLE_IGNORE_FIELDS
    });
  }
  return __dirRowsDb;
}

export function makeScope({ serverId, userId }) {
  return `${serverId || ""}|${userId || ""}`;
}

export async function upsertDirector(db, scope, director) {
  if (!db || !scope || !director?.Id) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const prev = store.directors[director.Id] || null;
    const countHint = Number(director.Count);
    const countActual = Number(director.countActual);
    const qualifiedMinItems = Number(director.qualifiedMinItems);

    store.directors[director.Id] = {
      ...(prev && typeof prev === "object" ? prev : {}),
      directorId: director.Id,
      name: director.Name || prev?.name || "",
      name_lc: String(director.Name || prev?.name || "").toLowerCase(),
      countHint: Number.isFinite(countHint) ? Math.max(0, countHint | 0) : (Number(prev?.countHint) || 0),
      eligible: director.eligible === undefined ? (prev?.eligible !== false) : (director.eligible !== false),
      countActual: Number.isFinite(countActual)
        ? Math.max(0, countActual | 0)
        : (Number.isFinite(Number(prev?.countActual)) ? Number(prev.countActual) : null),
      qualifiedMinItems: Number.isFinite(qualifiedMinItems)
        ? Math.max(0, qualifiedMinItems | 0)
        : (Number.isFinite(Number(prev?.qualifiedMinItems)) ? Number(prev.qualifiedMinItems) : null),
      updatedAt: Date.now(),
    };

    pruneStore(store);
  });
}

export async function listDirectors(db, scope, { limit = 50 } = {}) {
  if (!db || !scope) return [];

  return db.readScope(scope, (data) => {
    const store = ensureStoreShape(data);
    return Object.values(store.directors)
      .filter((row) => row?.directorId)
      .sort((a, b) => {
        const aActual = Number(a?.countActual);
        const bActual = Number(b?.countActual);
        if (Number.isFinite(aActual) && Number.isFinite(bActual) && aActual !== bActual) {
          return bActual - aActual;
        }
        return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
      })
      .slice(0, Math.max(1, limit | 0));
  });
}

export async function upsertItem(db, scope, item) {
  if (!db || !scope || !item?.Id) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const rec = toItemRecord(item);
    if (rec?.Id) {
      store.items[rec.Id] = rec;
    }
    pruneStore(store);
  });
}

export async function linkDirectorItem(db, scope, directorId, itemId) {
  if (!db || !scope || !directorId || !itemId) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const rel = touchRelationMap(store, directorId);
    rel[itemId] = { updatedAt: Date.now() };
    pruneStore(store);
  });
}

export async function getItemsForDirector(db, scope, directorId, limit = 20) {
  if (!db || !scope || !directorId) return [];

  return db.readScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const rel = store.directorItems[directorId];
    if (!rel || typeof rel !== "object") return [];

    const ids = Object.keys(rel)
      .sort((a, b) => {
        const itemA = store.items[a];
        const itemB = store.items[b];
        const dateDiff = Number(itemB?.dateCreatedTicks || itemB?.DateCreatedTicks || 0) - Number(itemA?.dateCreatedTicks || itemA?.DateCreatedTicks || 0);
        if (dateDiff) return dateDiff;
        return Number(rel[b]?.updatedAt || 0) - Number(rel[a]?.updatedAt || 0);
      })
      .slice(0, Math.max(limit * 4, limit));

    const out = [];
    for (const itemId of ids) {
      if (out.length >= limit) break;
      const norm = normalizeCachedItem(store.items[itemId]);
      if (norm?.Id) out.push(norm);
    }
    return out;
  });
}

export async function deleteItemsAndRelationsByIds(db, scope, ids) {
  const list = Array.isArray(ids)
    ? Array.from(new Set(ids.map((x) => String(x || "").trim()).filter(Boolean)))
    : [];
  if (!db || !scope || !list.length) return 0;

  return db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    let removed = 0;

    for (const itemId of list) {
      if (store.items[itemId]) {
        delete store.items[itemId];
      }
      for (const rels of Object.values(store.directorItems)) {
        if (rels && typeof rels === "object" && rels[itemId]) {
          delete rels[itemId];
          removed++;
        }
      }
    }

    pruneStore(store, { pruneItemsWithoutRelations: true });
    return removed;
  }, { flush: true });
}

export async function getMeta(db, key) {
  const scope = resolveMetaScope(db);
  if (!db || !scope || !key) return null;

  return db.readScope(scope, (data) => {
    const store = ensureStoreShape(data);
    return store.meta[key]?.value ?? null;
  });
}

export async function setMeta(db, key, value) {
  const scope = resolveMetaScope(db);
  if (!db || !scope || !key) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    store.meta[key] = { value, updatedAt: Date.now() };
    pruneStore(store, { pruneItemsWithoutRelations: true });
  }, { flush: true });
}

export async function compactDirectorRowsDb(db, scope) {
  if (!db || !scope) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    pruneStore(store, { pruneItemsWithoutRelations: true });
  }, { flush: true });
}
