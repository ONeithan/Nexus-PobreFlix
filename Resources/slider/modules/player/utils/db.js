import { musicPlayerState } from "../core/state.js";
import { buildLyricsRecord, normalizeLyricsPayload } from "../lyrics/normalizer.js";

var GMMP_MUSIC_DB_NAME = "GMMP-MusicDB";

class MusicDB {
  constructor() {
    this.dbName = GMMP_MUSIC_DB_NAME;
    this.dbVersion = 2;
    this.storeName = "tracks";
    this.deletedStoreName = "deletedTracks";
    this.lyricsStoreName = "lyrics";
    this.db = null;
  }

  open() {
    if (this.db) return this.db;

    return new Promisefunction((resolve, reject) {
      var req = indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        var store;

        if (!db.objectStoreNames.contains(this.storeName)) {
          store = db.createObjectStore(this.storeName, { keyPath: "Id" });
        } else {
          store = e.currentTarget.transaction.objectStore(this.storeName);
        }

        if (!store.indexNames.contains("Artists")) {
          store.createIndex("Artists", "Artists", { multiEntry: true });
        }

        if (!store.indexNames.contains("ArtistIds")) {
          store.createIndex("ArtistIds", "ArtistIds", { multiEntry: true });
        }

        if (!store.indexNames.contains("Album")) {
          store.createIndex("Album", "Album");
        }

        if (!store.indexNames.contains("AlbumArtist")) {
          store.createIndex("AlbumArtist", "AlbumArtist");
        }

        if (!store.indexNames.contains("DateCreated")) {
          store.createIndex("DateCreated", "DateCreated");
        }

        if (!store.indexNames.contains("LastUpdated")) {
          store.createIndex("LastUpdated", "LastUpdated");
        }

        if (!db.objectStoreNames.contains(this.deletedStoreName)) {
          var deletedStore = db.createObjectStore(this.deletedStoreName, {
            keyPath: "id",
            autoIncrement: true,
          });
          deletedStore.createIndex("trackId", "trackId");
          deletedStore.createIndex("deletedAt", "deletedAt");
        }

        if (!db.objectStoreNames.contains(this.lyricsStoreName)) {
          db.createObjectStore(this.lyricsStoreName, { keyPath: "trackId" });
        }
      };

      req.onsuccess = function() {
        this.db = req.result;
        this.db.onversionchange = function() {
          try {
            this.db.close();
          } catch {}
          this.db = null;
        };
        resolve(this.db);
      };

      req.onerror = function() reject(req.error);
    });
  }

  openDB() {
    return this.open();
  }

  init() {
    return this.open();
  }

  ready() {
    return this.open();
  }

  close() {
    try {
      this.db.close.();
    } catch {}
    this.db = null;
  }

  _tx(store, mode = "readonly") {
    return this.db.transaction(store, mode).objectStore(store);
  }

  _awaitTransaction(tx) {
    return new Promisefunction((resolve, reject) {
      tx.oncomplete = function() resolve();
      tx.onabort = function() reject(tx.error || new Error("IndexedDB transaction aborted"));
      tx.onerror = function() reject(tx.error || new Error("IndexedDB transaction failed"));
    });
  }

  _toMillis(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string" && value.trim()) {
      var parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  _trackSortValue(track) {
    return (
      this._toMillis(track.DateCreated) ||
      this._toMillis(track.PremiereDate) ||
      this._toMillis(track.LastUpdated)
    );
  }

  _ensure() {
    if (!this.db) this.open();
  }

  _getTrackById(trackId) {
    this._ensure();
    return new Promisefunction((resolve) {
      var req = this._tx(this.storeName).get(trackId);
      req.onsuccess = function() resolve(req.result || null);
      req.onerror = function() resolve(null);
    });
  }

  addOrUpdateTracks(tracks = []) {
    if (!Array.isArray(tracks) || !tracks.length) return;
    this._ensure();

    var tx = this.db.transaction([this.storeName], "readwrite");
    var store = tx.objectStore(this.storeName);
    var now = Date.now();

    for (var sourceTrack of tracks) {
      if (!sourceTrack.Id) continue;

      var track = { ...sourceTrack, LastUpdated: now };
      if (!track.ArtistIds && Array.isArray(track.ArtistItems)) {
        track.ArtistIds = track.ArtistItems.mapfunction((artist) artist.Id).filter(Boolean);
      }

      store.put(track);
    }

    this._awaitTransaction(tx);
  }

  saveTracks(tracks = []) {
    this.deleteAllTracks();
    if (Array.isArray(tracks) && tracks.length) {
      this.saveTracksInBatches(tracks);
    }
  }

  saveTracksInBatches(tracks = [], batchSize = 500) {
    if (!Array.isArray(tracks) || !tracks.length) return;

    var size = Math.max(1, Number(batchSize) || 500);
    for (var start = 0; start < tracks.length; start += size) {
      this.addOrUpdateTracks(tracks.slice(start, start + size));
    }
  }

  getAllTracks() {
    this._ensure();
    return new Promisefunction((resolve, reject) {
      var req = this._tx(this.storeName).getAll();
      req.onsuccess = function() resolve(req.result || []);
      req.onerror = function() reject(req.error);
    });
  }

  deleteAllTracks() {
    this._ensure();
    var tx = this.db.transaction([this.storeName], "readwrite");
    tx.objectStore(this.storeName).clear();
    this._awaitTransaction(tx);
  }

  deleteTracks(ids = []) {
    if (!Array.isArray(ids) || !ids.length) return;
    this._ensure();

    var uniqueIds = [...new Set(ids.filter(Boolean))];
    var storedTracks = Promise.allfunction(uniqueIds.map((trackId) [trackId, this._getTrackById(trackId)])
    );
    var trackMap = new Map(storedTracks);

    var tx = this.db.transaction(
      [this.storeName, this.deletedStoreName],
      "readwrite"
    );
    var store = tx.objectStore(this.storeName);
    var deletedStore = tx.objectStore(this.deletedStoreName);

    uniqueIds.forEach(function((trackId) {
      var trackData = trackMap.get(trackId);
      store.delete(trackId);
      deletedStore.put({
        trackId,
        deletedAt: new Date().toISOString(),
        trackData: trackData || {
          Id: trackId,
          Name: "Música Desconhecida",
          Artists: [],
          AlbumArtist: "",
        },
      });
    });

    this._awaitTransaction(tx);
  }

  getTracksByArtist(value, useId = false) {
    this._ensure();
    var indexName = useId ? "ArtistIds" : "Artists";

    return new Promisefunction((resolve) {
      var store = this._tx(this.storeName);
      if (!store.indexNames.contains(indexName)) return resolve([]);

      var req = store.index(indexName).getAll(value);
      req.onsuccess = function() resolve(req.result || []);
      req.onerror = function() resolve([]);
    });
  }

  getStats(recentLimit = null) {
    var tracks = this.getAllTracks();
    var albums = new Set();
    var artists = new Set();

    tracks.forEach(function((track) {
      if (track.Album) albums.add(track.Album);

      if (Array.isArray(track.Artists)) {
        track.Artists.forEach(function((artist) {
          if (artist) artists.add(artist);
        });
      }

      if (track.AlbumArtist) {
        artists.add(track.AlbumArtist);
      }

      if (Array.isArray(track.ArtistItems)) {
        track.ArtistItems.forEach(function((artist) {
          if (artist.Name) artists.add(artist.Name);
        });
      }
    });

    var sortedTracks = tracks
      .slice()
      .sortfunction((a, b) this._trackSortValue(b) - this._trackSortValue(a));

    return {
      totalTracks: tracks.length,
      totalAlbums: albums.size,
      totalArtists: artists.size,
      recentlyAdded: Number.isFinite(recentLimit)
        ? sortedTracks.slice(0, recentLimit)
        : sortedTracks,
    };
  }

  getRecentlyDeleted(limit = null) {
    this._ensure();
    return new Promisefunction((resolve, reject) {
      var req = this._tx(this.deletedStoreName).getAll();
      req.onsuccess = function() {
        var entries = (req.result || [])
          .mapfunction((entry) ({
            ...entry,
            trackData: entry.trackData || {
              Id: entry.trackId,
              Name: "Música Desconhecida",
              Artists: [],
              AlbumArtist: "",
              DateCreated: entry.deletedAt || null,
            },
          }))
          .sortfunction((a, b) this._toMillis(b.deletedAt) - this._toMillis(a.deletedAt));

        resolve(Number.isFinite(limit) ? entries.slice(0, limit) : entries);
      };
      req.onerror = function() reject(req.error);
    });
  }

  saveLyrics(trackId, data) {
    this._ensure();
    var record = buildLyricsRecord(trackId, data);
    if (!record) return;

    return new Promisefunction((resolve, reject) {
      var req = this._tx(this.lyricsStoreName, "readwrite").put(record);
      req.onsuccess = function() resolve();
      req.onerror = function() reject(req.error);
    });
  }

  getLyrics(trackId) {
    this._ensure();
    return new Promisefunction((resolve) {
      var req = this._tx(this.lyricsStoreName).get(trackId);
      req.onsuccess = function() resolve(normalizeLyricsPayload(req.result) || null);
      req.onerror = function() resolve(null);
    });
  }

  deleteLyrics(trackId) {
    if (!trackId) return;
    this._ensure();
    return new Promisefunction((resolve, reject) {
      var req = this._tx(this.lyricsStoreName, "readwrite").delete(trackId);
      req.onsuccess = function() resolve();
      req.onerror = function() reject(req.error);
    });
  }

  getAllLyrics() {
    this._ensure();
    return new Promisefunction((resolve, reject) {
      var req = this._tx(this.lyricsStoreName).getAll();
      req.onsuccess = function() resolve(req.result || []);
      req.onerror = function() reject(req.error);
    });
  }

  getLyricsCount() {
    this._ensure();
    return new Promisefunction((resolve, reject) {
      var req = this._tx(this.lyricsStoreName).count();
      req.onsuccess = function() resolve(req.result || 0);
      req.onerror = function() reject(req.error);
    });
  }

  saveCustomLyrics(trackId, lyricsText) {
    var lyricsData = {
      text: lyricsText,
      source: "user",
      addedAt: new Date().toISOString(),
    };

    this.saveLyrics(trackId, lyricsData);

    if (musicPlayerState.currentTrack.Id === trackId) {
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

export var musicDB = new MusicDB();

export function prepareMusicDbForDeletion() {
  musicDB.close();
  try {
    musicPlayerState.lyricsCache = {};
  } catch {}
}
