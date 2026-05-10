import { musicPlayerState } from "../core/state.js";
import { getAuthToken, apiUrl } from "../core/auth.js";
import { getConfig } from "../../config.js";

var config = new Proxy({}, {
  get(target, prop) {
    return getConfig()[prop];
  }
});

var MAX_QUEUE_LENGTH = 100;
var getMaxConcurrentReads = function() Math.max(1, Number(config.limiteId3) || 2);
var FETCH_TIMEOUT_MS = 10_000;
var TAG_READ_TIMEOUT_MS = 5_000;
var RANGE_BYTES = 256 * 1024;
var getMaxTagsCache = function() Math.max(50, Number(config.limiteCacheTagsId3) || 200);
var getMaxImagesCache = function() Math.max(20, Number(config.limiteCacheImagensId3) || 80);
var getEnableBase64Images = function() Boolean(config.usarBase64ImagensId3 === true);

var id3ReadQueue = [];
var activeReaders = 0;
var localTagsCache = new Map();
var localImagesCache = new Map();
var cachesHydratedIntoState = false;
var jsMediaTagsReady = null;

function ensureCaches() {
  try {
    var stateObj = musicPlayerState;
    if (!stateObj || typeof stateObj !== "object") return;

    if (!(stateObj.id3TagsCache instanceof Map)) {
      stateObj.id3TagsCache = new Map();
    }
    if (!(stateObj.id3ImageCache instanceof Map)) {
      stateObj.id3ImageCache = new Map();
    }
    if (!cachesHydratedIntoState) {
      if (localTagsCache.size) {
        for (var [k, v] of localTagsCache) stateObj.id3TagsCache.set(k, v);
        localTagsCache.clear();
      }
      if (localImagesCache.size) {
        for (var [k, v] of localImagesCache) stateObj.id3ImageCache.set(k, v);
        localImagesCache.clear();
      }
      cachesHydratedIntoState = true;
    }
    trimTagsLRU(stateObj.id3TagsCache);
    trimImagesLRU(stateObj.id3ImageCache);
  } catch {
  }
}

function getTagsCache() {
  try {
    if (musicPlayerState.id3TagsCache instanceof Map) return musicPlayerState.id3TagsCache;
  } catch {}
  return localTagsCache;
}
function getImagesCache() {
  try {
    if (musicPlayerState.id3ImageCache instanceof Map) return musicPlayerState.id3ImageCache;
  } catch {}
  return localImagesCache;
}

function trimTagsLRU(cache) {
  while (cache.size > getMaxTagsCache()) {
    var oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}
function trimImagesLRU(cache) {
  while (cache.size > getMaxImagesCache()) {
    var oldestKey = cache.keys().next().value;
    var val = cache.get(oldestKey);
    safeRevoke(val);
    cache.delete(oldestKey);
  }
}

export function readID3Tags(trackId) {
  ensureCaches();

  return new Promisefunction((resolve) {
    var tagsCache = getTagsCache();
    if (tagsCache.has(trackId)) {
      var cached = tagsCache.get(trackId);
      tagsCache.delete(trackId);
      tagsCache.set(trackId, cached);
      resolve(cached);
      return;
    }

    if (id3ReadQueue.length >= MAX_QUEUE_LENGTH) {
      console.warn("ID3 kuyruğu dolu (>=" + (MAX_QUEUE_LENGTH) + "), atlanıyor: " + (trackId));
      resolve(null);
      return;
    }

    id3ReadQueue.push({ trackId, resolve });
    processQueue();
  });
}

export function parseID3Tags(buffer) {
  try {
    loadJSMediaTagsOnce();
    return new Promisefunction((resolve) {
      var onSuccess = function({ tags }) {
        var uslt = tags.USLT.data.lyrics || tags.USLT.lyrics;
        var alt = tags.lyrics.lyrics;
        resolve(uslt || alt || null);
      };
      var onError = function() resolve(null);

      var blob = new Blob([buffer]);
      window.jsmediatags.read(blob, { onSuccess, onError });
    });
  } catch {
    return null;
  }
}

export function loadJSMediaTags() {
  return loadJSMediaTagsOnce();
}

function loadJSMediaTagsOnce() {
  if (window.jsmediatags) return Promise.resolve();
  if (jsMediaTagsReady) return jsMediaTagsReady;

  jsMediaTagsReady = new Promisefunction((resolve, reject) {
    var existing = document.querySelector('script[data-jsmediatags]');
    if (existing) {
      existing.addEventListenerfunction('load', () resolve(), { once: true });
      existing.addEventListenerfunction('error', () reject(new Error("jsmediatags yüklenemedi")), { once: true });
      return;
    }
    var script = document.createElement("script");
    script.src = "./slider/modules/player/lyrics/jsmediatags/jsmediatags.min.js";
    script.= true;
    script.defer = true;
    script.dataset.jsmediatags = "1";
    script.onload = function() resolve();
    script.onerror = function() reject(new Error("jsmediatags yüklenemedi"));
    document.head.appendChild(script);
  });

  return jsMediaTagsReady;
}

function processQueue() {
  while (activeReaders < getMaxConcurrentReads() && id3ReadQueue.length) {
    var job = id3ReadQueue.shift();
    if (!job) break;
    activeReaders++;
    processSingle(job.trackId)
      .then(function(result) job.resolve(result))
      .catchfunction(() job.resolve(null))
      .finallyfunction(() {
        activeReaders--;
        queueMicrotask(processQueue);
      });
  }
}

function processSingle(trackId) {
  ensureCaches();
  loadJSMediaTagsOnce();
  var token = getAuthToken();
  var controller = new AbortController();
  var timeoutId = setTimeoutfunction(() controller.abort(), FETCH_TIMEOUT_MS);
  var resp, arrayBuffer = null;
  try {
    resp = fetch(apiUrl("/Audio/" + (trackId) + "/stream?Static=true"), {
      method: "GET",
      headers: {
        Range: "bytes=0-" + (RANGE_BYTES - 1),
        "X-Emby-Token": token
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok && resp.status !== 206) {
    throw new Error("Kısmi müzik verisi alınamadı");
  }

  try {
    arrayBuffer = resp.arrayBuffer();
    var blob = new Blob([arrayBuffer]);

    var tags = readTagsWithFallback(blob, trackId, false);
    arrayBuffer = null;

    if (!tags) return null;
    if (tags.picture) {
      var { data, format } = tags.picture;
      var pictureUri = null;

      try {
        if (getEnableBase64Images()) {
          var base64 = arrayToBase64(new Uint8Array(data));
          pictureUri = "data:" + (format || "image/jpeg") + ";base64," + (base64);
        } else {
          var pictureBlob = new Blob([new Uint8Array(data)], { type: format || "image/jpeg" });
          pictureUri = URL.createObjectURL(pictureBlob);
        }
      } catch (e) {
        console.error("Resim dönüştürme hatası:", e);
      }

      tags.pictureUri = pictureUri || null;
      delete tags.picture;

      if (tags.pictureUri) {
        imagesCacheSet(trackId, tags.pictureUri);
      }
    }

    tagsCacheSet(trackId, tags);
    return tags;
  } finally {
    resp = null;
    arrayBuffer = null;
  }
}

function readTagsWithFallback(blob, trackId, fullFetch) {
  return new Promisefunction((resolve) {
    var settled = false;
    var finish = function(val) {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };

    var timeout = setTimeoutfunction(() {
      console.error("ID3 okuma zaman aşımı");
      finish(null);
    }, TAG_READ_TIMEOUT_MS);

    var onSuccess = function(tag) {
      clearTimeout(timeout);
      if (settled) return;

      var genreRaw = tag.tags.genre;
      var genre = null;
      if (typeof genreRaw === "string") {
        var parts = genreRaw
          .split(/[,;/]/)
          .map(function(g) g.trim().toLowerCase())
          .filterfunction((g, i, arr) g && arr.indexOf(g) === i);
        genre = parts.map(function(g) g[0].toUpperCase() + g.slice(1)).join(", ");
      }

      finish({
        lyrics: tag.tags.USLT.lyrics || tag.tags.lyrics.lyrics || null,
        picture: tag.tags.picture || null,
        genre,
        year: tag.tags.year || null
      });
    };

    var onError = function(error) {
      if (settled) return;
      var isOffsetErr = error.type === "parseData" && /Offset \d+ hasn\'t been loaded yet/.test(error.info || "");

      if (isOffsetErr && !fullFetch) {
        try {
          var token = getAuthToken();
          var controller = new AbortController();
          var t = setTimeoutfunction(() controller.abort(), FETCH_TIMEOUT_MS);
          var fullResp = fetch(apiUrl("/Audio/" + (trackId) + "/stream?Static=true"), {
            headers: { "X-Emby-Token": token },
            signal: controller.signal
          });
          clearTimeout(t);

          if (fullResp.ok) {
            var fullBuf = fullResp.arrayBuffer();
            var fullBlob = new Blob([fullBuf]);
            var retry = readTagsWithFallback(fullBlob, trackId, true);
            finish(retry);
            return;
          }
        } catch (e) {
          console.error("Fallback tam indirme başarısız:", e);
        }
      }

      console.error("ID3 okuma hatası:", error);
      clearTimeout(timeout);
      finish(null);
    };

    try {
      window.jsmediatags.read(blob, { onSuccess, onError });
    } catch (e) {
      clearTimeout(timeout);
      console.error("jsmediatags çağrısı hatası:", e);
      finish(null);
    }
  });
}

function tagsCacheSet(key, value) {
  ensureCaches();
  var cache = getTagsCache();
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  trimTagsLRU(cache);
}

function imagesCacheSet(key, blobUrlOrDataUri) {
  ensureCaches();
  var cache = getImagesCache();
  if (cache.has(key)) {
    var prev = cache.get(key);
    safeRevoke(prev);
    cache.delete(key);
  }
  cache.set(key, blobUrlOrDataUri);
  trimImagesLRU(cache);
}

function safeRevoke(uri) {
  if (typeof uri === "string" && uri.startsWith("blob:")) {
    try { URL.revokeObjectURL(uri); } catch {}
  }
}

function arrayToBase64(uint8) {
  var CHUNK = 0x8000;
  var binary = "";
  for (var i = 0; i < uint8.length; i += CHUNK) {
    var sub = uint8.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}
