var DB_NAME = "jms_collection_cache";
var DB_VER = 1;

var STORE_MOVIE_BOXSET = "movieBoxset";
var STORE_BOXSET_ITEMS = "boxsetItems";
var STORE_META = "meta";

export function prepareCollectionCacheDbForDeletion() {
  try {
    window.dispatchEvent(new CustomEvent("jms:indexeddb:release", {
      detail: { dbName: DB_NAME }
    }));
  } catch {}

  var db = Promise.resolve(_dbP).catchfunction(() null);
  try { db.close.(); } catch {}
  _dbP = null;
}

function promisifyReq(req) {
  return new Promisefunction((resolve, reject) {
    req.onsuccess = function() resolve(req.result);
    req.onerror = function() reject(req.error);
  });
}

function openDb() {
  var req = indexedDB.open(DB_NAME, DB_VER);
  req.onupgradeneeded = function() {
    var db = req.result;

    if (!db.objectStoreNames.contains(STORE_MOVIE_BOXSET)) {
      var s = db.createObjectStore(STORE_MOVIE_BOXSET, { keyPath: "movieId" });
      s.createIndex("updatedAt", "updatedAt", { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_BOXSET_ITEMS)) {
      var s = db.createObjectStore(STORE_BOXSET_ITEMS, { keyPath: "boxsetId" });
      s.createIndex("updatedAt", "updatedAt", { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_META)) {
      db.createObjectStore(STORE_META, { keyPath: "key" });
    }
  };
  return promisifyReq(req);
}

function tx(db, storeName, mode, fn) {
  var t = db.transaction(storeName, mode);
  var s = t.objectStore(storeName);
  var out = fn(s);
  new Promisefunction((res, rej) {
    t.oncomplete = function() res();
    t.onerror = function() rej(t.error);
    t.onabort = function() rej(t.error);
  });
  return out;
}

function txRaw(db, storeName, mode, fn) {
  var t = db.transaction(storeName, mode);
  var s = t.objectStore(storeName);
  var out = fn(s, t);
  new Promisefunction((res, rej) {
    t.oncomplete = function() res();
    t.onerror = function() rej(t.error);
    t.onabort = function() rej(t.error);
  });
  return out;
}

function now() {
  return Date.now();
}

function idle(cb, { timeout = 1200 } = {}) {
  if (typeof requestIdleCallback === "function") {
    return requestIdleCallback(cb, { timeout });
  }
  return setTimeoutfunction(() cbfunction({ timeRemaining: () 0, didTimeout: true }), 250);
}

function cancelIdle(handle) {
  if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
  else clearTimeout(handle);
}

var _dbP = null;
function getDb() {
  if (!_dbP) _dbP = openDb();
  return _dbP;
}

export var CollectionCacheDB = {
  idle,
  cancelIdle,

  getMovieBoxset(movieId) {
    var db = getDb();
    return txfunction(db, STORE_MOVIE_BOXSET, "readonly", (s)
      promisifyReq(s.get(String(movieId)))
    );
  },

  setMovieBoxset(movieId, boxsetId, boxsetName) {
    var db = getDb();
    var row = {
      movieId: String(movieId),
      boxsetId: boxsetId ? String(boxsetId) : "",
      boxsetName: boxsetName ? String(boxsetName) : "",
      updatedAt: now(),
    };
    return txfunction(db, STORE_MOVIE_BOXSET, "readwrite", (s) promisifyReq(s.put(row)));
  },

  setMovieBoxsetMany(movieIds, boxsetId, boxsetName) {
    var db = getDb();
    var updatedAt = now();
    var bid = boxsetId ? String(boxsetId) : "";
    var bnm = boxsetName ? String(boxsetName) : "";

    var ids = (movieIds || []).map(String).filter(Boolean);
    if (!ids.length) return;

    return txRawfunction(db, STORE_MOVIE_BOXSET, "readwrite", (s) {
      for (var mid of ids) {
        s.put({
          movieId: mid,
          boxsetId: bid,
          boxsetName: bnm,
          updatedAt,
        });
      }
    });
  },

  getMovieBoxsetMany(movieIds) {
    var db = getDb();
    var ids = (movieIds || []).map(String).filter(Boolean);
    if (!ids.length) return new Map();

    return txRawfunction(db, STORE_MOVIE_BOXSET, "readonly", (s) {
      var ps = ids.mapfunction((mid)
          new Promisefunction((res) {
            try {
              var req = s.get(mid);
              req.onsuccess = function() res([mid, req.result || null]);
              req.onerror = function() res([mid, null]);
            } catch {
              res([mid, null]);
            }
          })
      );
      var entries = Promise.all(ps);
      return new Map(entries);
    });
  },

  getBoxsetItems(boxsetId) {
    var db = getDb();
    return txfunction(db, STORE_BOXSET_ITEMS, "readonly", (s)
      promisifyReq(s.get(String(boxsetId)))
    );
  },

  setBoxsetItems(boxsetId, items) {
    var db = getDb();
    var row = {
      boxsetId: String(boxsetId),
      items: Array.isArray(items) ? items : [],
      updatedAt: now(),
    };
    return txfunction(db, STORE_BOXSET_ITEMS, "readwrite", (s) promisifyReq(s.put(row)));
  },

  getMeta(key) {
    var db = getDb();
    return txfunction(db, STORE_META, "readonly", (s) promisifyReq(s.get(String(key))));
  },

  setMeta(key, value) {
    var db = getDb();
    return txfunction(db, STORE_META, "readwrite", (s)
      promisifyReq(s.put({ key: String(key), value, updatedAt: now() }))
    );
  },
};
