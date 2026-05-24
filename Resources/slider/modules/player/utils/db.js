import { musicPlayerState } from "../core/state.js";
import { buildLyricsRecord, normalizeLyricsPayload } from "../lyrics/normalizer.js";
import { createScopedJsonDb, prepareLegacyIndexedDbForDeletion } from "../../scopedJsonCache.js";
import { getSessionInfo } from "../../../../Plugins/JMSFusion/runtime/api.js";

const GMMP_MUSIC_DB_NAME = "GMMP-MusicDB";
const GMMP_CACHE_TYPE = "gmmpMusic";

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed."));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted."));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
  });
}

function safeStorageGet(storage, key) {
  try {
    return String(storage?.getItem?.(key) || "").trim();
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

function buildDefaultData() {
  return {
    tracks: {},
    deletedTracks: [],
    lyrics: {},
    meta: {}
  };
}

function ensureStoreShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return buildDefaultData();
  }

  if (!data.tracks || typeof data.tracks !== "object" || Array.isArray(data.tracks)) {
    data.tracks = {};
  }
  if (!Array.isArray(data.deletedTracks)) {
    data.deletedTracks = [];
  }
  if (!data.lyrics || typeof data.lyrics !== "object" || Array.isArray(data.lyrics)) {
    data.lyrics = {};
  }
  if (!data.meta || typeof data.meta !== "object" || Array.isArray(data.meta)) {
    data.meta = {};
  }

  return data;
}

function normalizeTrackForStorage(sourceTrack, { touch = false, now = Date.now() } = {}) {
  if (!sourceTrack?.Id) return null;

  const track = { ...sourceTrack };
  if (touch) {
    track.LastUpdated = now;
  }

  if (!track.ArtistIds && Array.isArray(track.ArtistItems)) {
    track.ArtistIds = track.ArtistItems.map((artist) => artist?.Id).filter(Boolean);
  }

  return track;
}

function toMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function trackSortValue(track) {
  return (
    toMillis(track?.DateCreated) ||
    toMillis(track?.PremiereDate) ||
    toMillis(track?.LastUpdated)
  );
}

function pickNewerTrack(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return trackSortValue(b) >= trackSortValue(a) ? b : a;
}

function deletedRecordKey(record) {
  return `${String(record?.trackId || "").trim()}|${String(record?.deletedAt || "").trim()}`;
}

function normalizeDeletedRecord(entry, fallback = {}) {
  const trackId = String(entry?.trackId || fallback?.trackId || fallback?.trackData?.Id || "").trim();
  if (!trackId) return null;

  const deletedAt = entry?.deletedAt || fallback?.deletedAt || new Date().toISOString();
  const rawId = Number(entry?.id);

  return {
    ...(Number.isFinite(rawId) && rawId > 0 ? { id: rawId } : {}),
    trackId,
    deletedAt,
    trackData: entry?.trackData || fallback?.trackData || {
      Id: trackId,
      Name: "Bilinmeyen Parca",
      Artists: [],
      AlbumArtist: ""
    }
  };
}

function normalizeDeletedRecords(records = []) {
  const seen = new Set();
  const out = [];

  for (const raw of Array.isArray(records) ? records : []) {
    const record = normalizeDeletedRecord(raw);
    if (!record) continue;

    const key = deletedRecordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }

  out.sort((a, b) => toMillis(b?.deletedAt) - toMillis(a?.deletedAt));
  return out;
}

function assignDeletedRecordIds(store) {
  const deleted = normalizeDeletedRecords(store.deletedTracks);
  let nextId = Math.max(
    Number(store.meta?.nextDeletedTrackRowId || 1),
    deleted.reduce((max, entry) => Math.max(max, Number(entry?.id || 0) + 1), 1)
  );

  for (const entry of deleted) {
    if (!Number.isFinite(Number(entry.id)) || Number(entry.id) <= 0) {
      entry.id = nextId++;
    }
  }

  store.deletedTracks = deleted;
  store.meta.nextDeletedTrackRowId = nextId;
}

function normalizeLyricsRecords(records = []) {
  const map = {};
  for (const raw of Array.isArray(records) ? records : []) {
    const trackId = String(raw?.trackId || "").trim();
    const record = buildLyricsRecord(trackId, raw);
    if (record && trackId) {
      map[trackId] = record;
    }
  }
  return map;
}

function countStoreRecords(payload) {
  const store = ensureStoreShape(payload);
  return Object.keys(store.tracks).length + store.deletedTracks.length + Object.keys(store.lyrics).length;
}

async function openExistingLegacyDb(dbName) {
  if (!dbName || typeof indexedDB === "undefined") return null;

  if (typeof indexedDB.databases === "function") {
    try {
      const list = await indexedDB.databases();
      if (Array.isArray(list) && !list.some((entry) => entry?.name === dbName)) {
        return null;
      }
    } catch {}
  }

  return new Promise((resolve, reject) => {
    let createdDuringProbe = false;

    try {
      const req = indexedDB.open(dbName);

      req.onupgradeneeded = () => {
        createdDuringProbe = true;
      };

      req.onerror = () => reject(req.error || new Error(`${dbName} could not be opened.`));

      req.onsuccess = async () => {
        const db = req.result;
        const storeCount = Number(db?.objectStoreNames?.length || 0);

        if (createdDuringProbe && storeCount === 0) {
          try { db.close(); } catch {}
          try { await prepareLegacyIndexedDbForDeletion([dbName]); } catch {}
          resolve(null);
          return;
        }

        resolve(db);
      };
    } catch (error) {
      reject(error);
    }
  });
}

async function readLegacyStore(db, storeName) {
  if (!db?.objectStoreNames?.contains?.(storeName)) return [];
  const tx = db.transaction(storeName, "readonly");
  const done = transactionDone(tx);
  const records = await requestToPromise(tx.objectStore(storeName).getAll());
  await done;
  return Array.isArray(records) ? records : [];
}

async function readLegacyMusicIndexedDb() {
  const db = await openExistingLegacyDb(GMMP_MUSIC_DB_NAME);
  if (!db) return null;

  try {
    const [tracks, deletedTracks, lyrics] = await Promise.all([
      readLegacyStore(db, "tracks"),
      readLegacyStore(db, "deletedTracks"),
      readLegacyStore(db, "lyrics")
    ]);

    return { tracks, deletedTracks, lyrics };
  } finally {
    try { db.close(); } catch {}
  }
}

class MusicDB {
  constructor() {
    this.dbName = GMMP_MUSIC_DB_NAME;
    this.dbVersion = 3;
    this.storeName = "tracks";
    this.deletedStoreName = "deletedTracks";
    this.lyricsStoreName = "lyrics";
    this.db = null;
    this.dbPromise = null;
    this.migrationPromises = new Map();
  }

  _resolveScope() {
    let session = null;
    try {
      session = typeof getSessionInfo === "function" ? getSessionInfo() : null;
    } catch {
      session = null;
    }

    const serverId = pickFirstString(
      session?.serverId,
      safeStorageGet(globalThis.localStorage, "persist_server_id"),
      safeStorageGet(globalThis.localStorage, "serverId"),
      safeStorageGet(globalThis.sessionStorage, "serverId"),
      "global"
    );

    const userId = pickFirstString(
      session?.userId,
      safeStorageGet(globalThis.localStorage, "persist_user_id"),
      safeStorageGet(globalThis.localStorage, "jf_userId"),
      safeStorageGet(globalThis.localStorage, "userId"),
      "anon"
    );

    return `${serverId}|${userId}`;
  }

  async open() {
    if (!this.dbPromise) {
      this.dbPromise = Promise.resolve(createScopedJsonDb({
        cacheType: GMMP_CACHE_TYPE,
        defaultData: buildDefaultData,
        saveDelayMs: 700,
        retryDelayMs: 2200,
        legacyDbNames: []
      }));
    }

    this.db = await this.dbPromise;
    await this._migrateLegacyIfNeeded(this._resolveScope());
    return this;
  }

  async openDB() {
    return this.open();
  }

  async init() {
    return this.open();
  }

  async ready() {
    return this.open();
  }

  async close() {
    try { await this.db?.flushAll?.(); } catch {}
    try { await this.db?.close?.(); } catch {}
    this.db = null;
    this.dbPromise = null;
  }

  async _ensure() {
    if (!this.db) await this.open();
    return this.db;
  }

  async _withStore(mode, fn, options = {}) {
    const db = await this._ensure();
    const scope = this._resolveScope();
    await this._migrateLegacyIfNeeded(scope);
    db.__jmsActiveScope = scope;

    if (mode === "readonly") {
      return db.readScope(scope, (data) => fn(ensureStoreShape(data), scope, db));
    }

    return db.writeScope(scope, (data) => {
      const store = ensureStoreShape(data);
      const result = fn(store, scope, db);
      assignDeletedRecordIds(store);
      return result;
    }, options);
  }

  async _migrateLegacyIfNeeded(scope) {
    const cleanScope = String(scope || "").trim();
    if (!cleanScope) return;

    const running = this.migrationPromises.get(cleanScope);
    if (running) return running;

    const task = (async () => {
      const db = await this._ensureNoMigration();
      const currentPayload = await db.readScope(cleanScope, (data) => ensureStoreShape(data));
      if (currentPayload?.meta?.legacyIndexedDbMigratedAt) {
        await prepareLegacyIndexedDbForDeletion([GMMP_MUSIC_DB_NAME]);
        return;
      }

      const legacy = await readLegacyMusicIndexedDb().catch((error) => {
        console.warn("[JMSFusion] GMMP legacy IndexedDB migration read failed:", error);
        return null;
      });

      await db.writeScope(cleanScope, (data) => {
        const store = ensureStoreShape(data);

        if (legacy) {
          for (const rawTrack of legacy.tracks || []) {
            const incoming = normalizeTrackForStorage(rawTrack, { touch: false });
            if (!incoming?.Id) continue;
            store.tracks[incoming.Id] = pickNewerTrack(store.tracks[incoming.Id], incoming);
          }

          const existingDeleted = normalizeDeletedRecords(store.deletedTracks);
          const seenDeleted = new Set(existingDeleted.map((entry) => deletedRecordKey(entry)));
          for (const record of normalizeDeletedRecords(legacy.deletedTracks || [])) {
            const key = deletedRecordKey(record);
            if (seenDeleted.has(key)) continue;
            seenDeleted.add(key);
            existingDeleted.push(record);
          }
          store.deletedTracks = existingDeleted;

          const incomingLyrics = normalizeLyricsRecords(legacy.lyrics || []);
          for (const [trackId, record] of Object.entries(incomingLyrics)) {
            if (!store.lyrics[trackId]) {
              store.lyrics[trackId] = record;
            }
          }
        }

        store.meta.legacyIndexedDbMigratedAt = new Date().toISOString();
        store.meta.legacyIndexedDbRecordCount = legacy
          ? (Number(legacy.tracks?.length || 0) + Number(legacy.deletedTracks?.length || 0) + Number(legacy.lyrics?.length || 0))
          : 0;
        assignDeletedRecordIds(store);
      }, { flush: true });

      await prepareLegacyIndexedDbForDeletion([GMMP_MUSIC_DB_NAME]);
    })().finally(() => {
      this.migrationPromises.delete(cleanScope);
    });

    this.migrationPromises.set(cleanScope, task);
    return task;
  }

  async _ensureNoMigration() {
    if (!this.dbPromise) {
      this.dbPromise = Promise.resolve(createScopedJsonDb({
        cacheType: GMMP_CACHE_TYPE,
        defaultData: buildDefaultData,
        saveDelayMs: 700,
        retryDelayMs: 2200,
        legacyDbNames: []
      }));
    }
    this.db = await this.dbPromise;
    return this.db;
  }

  async _getTrackById(trackId) {
    if (!trackId) return null;
    return this._withStore("readonly", (store) => store.tracks[String(trackId)] || null);
  }

  async addOrUpdateTracks(tracks = []) {
    if (!Array.isArray(tracks) || !tracks.length) return;

    await this._withStore("readwrite", (store) => {
      const now = Date.now();
      for (const sourceTrack of tracks) {
        const track = normalizeTrackForStorage(sourceTrack, { touch: true, now });
        if (track?.Id) {
          store.tracks[track.Id] = track;
        }
      }
    });
  }

  async saveTracks(tracks = []) {
    await this._withStore("readwrite", (store) => {
      store.tracks = {};
    });

    if (Array.isArray(tracks) && tracks.length) {
      await this.saveTracksInBatches(tracks);
    }
  }

  async saveTracksInBatches(tracks = [], batchSize = 500) {
    if (!Array.isArray(tracks) || !tracks.length) return;

    const size = Math.max(1, Number(batchSize) || 500);
    for (let start = 0; start < tracks.length; start += size) {
      await this.addOrUpdateTracks(tracks.slice(start, start + size));
    }
  }

  async getAllTracks() {
    return this._withStore("readonly", (store) => Object.values(store.tracks || {}));
  }

  async deleteAllTracks() {
    await this._withStore("readwrite", (store) => {
      store.tracks = {};
    });
  }

  async deleteTracks(ids = []) {
    if (!Array.isArray(ids) || !ids.length) return;

    const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
    if (!uniqueIds.length) return;

    await this._withStore("readwrite", (store) => {
      const existingDeleted = normalizeDeletedRecords(store.deletedTracks);
      const seenDeleted = new Set(existingDeleted.map((entry) => deletedRecordKey(entry)));

      for (const trackId of uniqueIds) {
        const trackData = store.tracks[trackId] || null;
        delete store.tracks[trackId];

        const record = normalizeDeletedRecord({
          trackId,
          deletedAt: new Date().toISOString(),
          trackData: trackData || {
            Id: trackId,
            Name: "Bilinmeyen Parca",
            Artists: [],
            AlbumArtist: ""
          }
        });

        const key = deletedRecordKey(record);
        if (record && !seenDeleted.has(key)) {
          seenDeleted.add(key);
          existingDeleted.push(record);
        }
      }

      store.deletedTracks = existingDeleted;
    });
  }

  async getTracksByArtist(value, useId = false) {
    const target = String(value || "").trim();
    if (!target) return [];

    return this._withStore("readonly", (store) => Object.values(store.tracks || {}).filter((track) => {
      const list = useId ? track?.ArtistIds : track?.Artists;
      return Array.isArray(list) && list.includes(target);
    }));
  }

  async getStats(recentLimit = null) {
    const tracks = await this.getAllTracks();
    const albums = new Set();
    const artists = new Set();

    tracks.forEach((track) => {
      if (track?.Album) albums.add(track.Album);

      if (Array.isArray(track?.Artists)) {
        track.Artists.forEach((artist) => {
          if (artist) artists.add(artist);
        });
      }

      if (track?.AlbumArtist) {
        artists.add(track.AlbumArtist);
      }

      if (Array.isArray(track?.ArtistItems)) {
        track.ArtistItems.forEach((artist) => {
          if (artist?.Name) artists.add(artist.Name);
        });
      }
    });

    const sortedTracks = tracks
      .slice()
      .sort((a, b) => trackSortValue(b) - trackSortValue(a));

    return {
      totalTracks: tracks.length,
      totalAlbums: albums.size,
      totalArtists: artists.size,
      recentlyAdded: Number.isFinite(recentLimit)
        ? sortedTracks.slice(0, recentLimit)
        : sortedTracks,
    };
  }

  async getRecentlyDeleted(limit = null) {
    return this._withStore("readonly", (store) => {
      const entries = normalizeDeletedRecords(store.deletedTracks)
        .map((entry) => ({
          ...entry,
          trackData: entry?.trackData || {
            Id: entry?.trackId,
            Name: "Bilinmeyen Parca",
            Artists: [],
            AlbumArtist: "",
            DateCreated: entry?.deletedAt || null,
          },
        }))
        .sort((a, b) => toMillis(b?.deletedAt) - toMillis(a?.deletedAt));

      return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
    });
  }

  async replaceDeletedTracks(records = []) {
    await this._withStore("readwrite", (store) => {
      store.deletedTracks = normalizeDeletedRecords(records);
    }, { flush: true });
  }

  async saveLyrics(trackId, data) {
    const record = buildLyricsRecord(trackId, data);
    if (!record) return;

    await this._withStore("readwrite", (store) => {
      store.lyrics[record.trackId] = record;
    });
  }

  async getLyrics(trackId) {
    if (!trackId) return null;
    return this._withStore("readonly", (store) => {
      const record = store.lyrics[String(trackId)] || null;
      return normalizeLyricsPayload(record) || null;
    });
  }

  async deleteLyrics(trackId) {
    if (!trackId) return;

    await this._withStore("readwrite", (store) => {
      delete store.lyrics[String(trackId)];
    });
  }

  async getAllLyrics() {
    return this._withStore("readonly", (store) => Object.values(store.lyrics || {}));
  }

  async getLyricsCount() {
    return this._withStore("readonly", (store) => Object.keys(store.lyrics || {}).length);
  }

  async replaceLyrics(records = []) {
    await this._withStore("readwrite", (store) => {
      store.lyrics = normalizeLyricsRecords(records);
    }, { flush: true });
  }

  async clearAll() {
    await this._withStore("readwrite", (store) => {
      store.tracks = {};
      store.deletedTracks = [];
      store.lyrics = {};
      store.meta.nextDeletedTrackRowId = 1;
    }, { flush: true });
  }

  async exportPayload() {
    return this._withStore("readonly", (store) => ({
      tracks: Object.values(store.tracks || {}),
      deletedTracks: normalizeDeletedRecords(store.deletedTracks),
      lyrics: Object.values(store.lyrics || {}),
      metadata: {
        cacheType: GMMP_CACHE_TYPE,
        scope: this._resolveScope(),
        recordCount: countStoreRecords(store),
        exportedAt: new Date().toISOString()
      }
    }));
  }

  async saveCustomLyrics(trackId, lyricsText) {
    const lyricsData = {
      text: lyricsText,
      source: "user",
      addedAt: new Date().toISOString(),
    };

    await this.saveLyrics(trackId, lyricsData);

    if (musicPlayerState.currentTrack?.Id === trackId) {
      musicPlayerState.lyricsCache[trackId] = lyricsData;

      try {
        window.dispatchEvent(
          new CustomEvent("gmmp:lyrics-updated", {
            detail: { trackId, lyricsText, lyricsData },
          })
        );
      } catch {}
    }
  }
}

export const musicDB = new MusicDB();

export async function prepareMusicDbForDeletion() {
  await musicDB.close();
  try {
    musicPlayerState.lyricsCache = {};
  } catch {}
  try {
    await prepareLegacyIndexedDbForDeletion([GMMP_MUSIC_DB_NAME]);
  } catch {}
}
