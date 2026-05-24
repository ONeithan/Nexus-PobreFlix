import { createScopedJsonDb, prepareLegacyIndexedDbForDeletion } from "./scopedJsonCache.js";

const DB_NAME = "jms_prc_db";
const STORE_TYPE = "personalRecommendations";
const STABLE_IGNORE_FIELDS = ["fetchedAt", "expiresAt", "updatedAt", "UserData", "UserDataDto", "userData", "userDataDto"];

export async function preparePrcDbForDeletion() {
  try { await __prcDb?.close?.(); } catch {}
  __prcDb = null;
  return prepareLegacyIndexedDbForDeletion([DB_NAME]);
}

function ensureStoreShape(data) {
  if (!data || typeof data !== "object") return { items: {}, meta: {} };
  if (!data.items || typeof data.items !== "object" || Array.isArray(data.items)) data.items = {};
  if (!data.meta || typeof data.meta !== "object" || Array.isArray(data.meta)) data.meta = {};
  return data;
}

function normalizeCachedItem(rec) {
  if (!rec) return null;
  const Id = rec.Id || rec.itemId || null;
  if (!Id) return null;

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
    PrimaryImageTag: rec.PrimaryImageTag || rec.primaryImageTag || null,
    __preferTaglessImages: true,
  };
}

function toPrcItemRecord(it, now = Date.now()) {
  const Id = it?.Id || it?.itemId || null;
  if (!Id) return null;

  const communityRaw = it?.CommunityRating ?? it?.communityRating ?? null;
  const CommunityRating = Number.isFinite(communityRaw)
    ? communityRaw
    : (communityRaw == null ? null : (Number(communityRaw) || null));

  const ImageTags = it?.ImageTags || it?.imageTags || null;

  const PrimaryImageTag =
    it?.PrimaryImageTag ||
    it?.primaryImageTag ||
    (ImageTags && (ImageTags.Primary || ImageTags.primary)) ||
    null;

  const RemoteTrailers =
    it?.RemoteTrailers ||
    it?.remoteTrailers ||
    it?.RemoteTrailerItems ||
    it?.RemoteTrailerUrls ||
    [];

  const Genres = Array.isArray(it?.Genres)
    ? it.Genres
    : (Array.isArray(it?.genres) ? it.genres : []);

  return {
    itemId: Id,
    updatedAt: now,

    Id,
    Name: it?.Name || it?.name || "",
    Type: it?.Type || it?.type || "",
    ProductionYear: it?.ProductionYear ?? it?.productionYear ?? null,
    OfficialRating: it?.OfficialRating || it?.officialRating || "",
    CommunityRating,

    ImageTags,
    PrimaryImageTag,

    BackdropImageTags: it?.BackdropImageTags || it?.backdropImageTags || null,
    PrimaryImageAspectRatio: it?.PrimaryImageAspectRatio ?? it?.primaryImageAspectRatio ?? null,
    Overview: it?.Overview || it?.overview || "",

    RunTimeTicks: it?.RunTimeTicks ?? it?.runTimeTicks ?? null,
    CumulativeRunTimeTicks: it?.CumulativeRunTimeTicks ?? it?.cumulativeRunTimeTicks ?? null,

    Genres,
    RemoteTrailers,
    DateCreatedTicks: it?.DateCreatedTicks ?? it?.dateCreatedTicks ?? 0,
    People: it?.People || it?.people || [],
  };
}

function pruneItemsMap(store, {
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  maxItems = 1200,
} = {}) {
  const now = Date.now();
  const cutoff = now - Math.max(60_000, ttlMs | 0);
  const items = store.items || {};

  for (const [itemId, rec] of Object.entries(items)) {
    const updatedAt = Number(rec?.updatedAt || 0);
    if (updatedAt && updatedAt < cutoff) {
      delete items[itemId];
    }
  }

  const remaining = Object.entries(items);
  if (maxItems && remaining.length > maxItems) {
    remaining
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
      .slice(0, remaining.length - maxItems)
      .forEach(([itemId]) => {
        delete items[itemId];
      });
  }
}

function pruneMetaMap(store, {
  ttlMs = 30 * 24 * 60 * 60 * 1000,
  prefix = "prc:",
  maxItems = 1200,
} = {}) {
  const now = Date.now();
  const cutoff = now - Math.max(60_000, ttlMs | 0);
  const meta = store.meta || {};

  for (const [key, rec] of Object.entries(meta)) {
    if (prefix && !String(key).startsWith(prefix)) continue;
    const updatedAt = Number(rec?.updatedAt || 0);
    if (updatedAt && updatedAt < cutoff) {
      delete meta[key];
    }
  }

  const matching = Object.entries(meta).filter(([key]) => !prefix || String(key).startsWith(prefix));
  if (maxItems && matching.length > maxItems) {
    matching
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
      .slice(0, matching.length - maxItems)
      .forEach(([key]) => {
        delete meta[key];
      });
  }
}

function collectReferencedItemIds(store) {
  const refs = new Set();
  const visit = (value, key = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (key === "ids") {
        for (const rawId of value) {
          const id = String(rawId || "").trim();
          if (id) refs.add(id);
        }
      }
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  };

  for (const rec of Object.values(store.meta || {})) {
    visit(rec?.value);
  }

  return refs;
}

function pruneUnreferencedItems(store) {
  const refs = collectReferencedItemIds(store);
  if (!refs.size) return;

  for (const itemId of Object.keys(store.items || {})) {
    if (!refs.has(itemId)) {
      delete store.items[itemId];
    }
  }
}

function pruneStore(store) {
  pruneItemsMap(store);
  pruneMetaMap(store, { ttlMs: 45 * 24 * 60 * 60 * 1000, prefix: "", maxItems: 1600 });
  pruneUnreferencedItems(store);
}

function resolveMetaScope(db) {
  return String(db?.__jmsActiveScope || "").trim();
}

let __prcDb = null;

export function makeScope({ serverId, userId }) {
  return `${serverId || ""}|${userId || ""}`;
}

export async function openPrcDB() {
  if (!__prcDb) {
    __prcDb = createScopedJsonDb({
      cacheType: STORE_TYPE,
      defaultData: () => ({ items: {}, meta: {} }),
      saveDelayMs: 800,
      retryDelayMs: 2200,
      legacyDbNames: [DB_NAME],
      stableIgnoreFields: STABLE_IGNORE_FIELDS
    });
  }
  return __prcDb;
}

export async function putItems(db, scope, items) {
  if (!db || !scope || !items?.length) return;

  await db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const now = Date.now();

    for (const it of items) {
      const rec = toPrcItemRecord(it, now);
      if (rec?.Id) {
        store.items[rec.Id] = rec;
      }
    }

    pruneItemsMap(store);
  });
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
    pruneStore(store);
  }, { flush: true });
}

export async function purgeScopeItems(db, scope, {
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  maxItems = 1200,
} = {}) {
  if (!db || !scope) return { removed: 0, scanned: 0, capped: 0 };

  return db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const beforeEntries = Object.entries(store.items || {});
    const scanned = beforeEntries.length;

    const now = Date.now();
    const cutoff = now - Math.max(60_000, ttlMs | 0);
    let removed = 0;

    for (const [itemId, rec] of beforeEntries) {
      const updatedAt = Number(rec?.updatedAt || 0);
      if (updatedAt && updatedAt < cutoff) {
        delete store.items[itemId];
        removed++;
      }
    }

    let capped = 0;
    const remaining = Object.entries(store.items || {});
    if (maxItems && remaining.length > maxItems) {
      remaining
        .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
        .slice(0, remaining.length - maxItems)
        .forEach(([itemId]) => {
          delete store.items[itemId];
          capped++;
        });
    }

    pruneUnreferencedItems(store);
    return { removed, scanned, capped };
  }, { flush: true });
}

export async function purgePrcMeta(db, {
  ttlMs = 30 * 24 * 60 * 60 * 1000,
  prefix = "prc:",
  maxScan = 3000,
} = {}) {
  const scope = resolveMetaScope(db);
  if (!db || !scope) return { removed: 0, scanned: 0 };

  return db.writeScope(scope, (data) => {
    const store = ensureStoreShape(data);
    const entries = Object.entries(store.meta || {});
    const scanned = Math.min(entries.length, Math.max(0, Number(maxScan) || 0) || entries.length);
    const now = Date.now();
    const cutoff = now - Math.max(60_000, ttlMs | 0);
    let removed = 0;

    for (const [key, rec] of entries.slice(0, scanned)) {
      if (prefix && !String(key).startsWith(prefix)) continue;
      const updatedAt = Number(rec?.updatedAt || 0);
      if (updatedAt && updatedAt < cutoff) {
        delete store.meta[key];
        removed++;
      }
    }

    pruneUnreferencedItems(store);
    return { removed, scanned };
  }, { flush: true });
}

export async function purgePrcDb(db, scope, opts = {}) {
  if (db) {
    db.__jmsActiveScope = String(scope || "").trim();
  }
  const itemsRes = await purgeScopeItems(db, scope, opts.items || {});
  const metaRes = await purgePrcMeta(db, opts.meta || {});
  return { items: itemsRes, meta: metaRes };
}
