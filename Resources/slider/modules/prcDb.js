var DB_NAME = 'jms_prc_db';
var DB_VER  = 1;

export function preparePrcDbForDeletion() {
  try {
    window.dispatchEvent(new CustomEvent('jms:indexeddb:release', {
      detail: { dbName: DB_NAME }
    }));
  } catch {}
}

function promisify(req) {
  return new Promisefunction((resolve, reject) {
    req.onsuccess = function() resolve(req.result);
    req.onerror = function() reject(req.error);
  });
}

function txDone(tx) {
  return new Promisefunction((resolve, reject) {
    tx.oncomplete = function() resolve(true);
    tx.onerror = function() reject(tx.error);
    tx.onabort = function() reject(tx.error);
  });
}

export function makeScope({ serverId, userId }) {
  return (serverId || '') + "|" + (userId || '');
}

export function openPrcDB() {
  var req = indexedDB.open(DB_NAME, DB_VER);

  req.onupgradeneeded = function() {
    var db = req.result;

    if (!db.objectStoreNames.contains('items')) {
      var s = db.createObjectStore('items', { keyPath: 'key' });
      s.createIndex('byScope', 'scope', { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('meta')) {
      var s = db.createObjectStore('meta', { keyPath: 'key' });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }
  };

  return promisify(req);
}

function toPrcItemRecord(scope, it, now = Date.now()) {
  var Id = it.Id || it.itemId || null;
  if (!Id) return null;

  var communityRaw = (it.CommunityRating || it.communityRating || null);
  var CommunityRating = Number.isFinite(communityRaw)
    ? communityRaw
    : (communityRaw == null ? null : (Number(communityRaw) || null));

  var ImageTags = it.ImageTags || it.imageTags || null;

  var PrimaryImageTag =
    it.PrimaryImageTag ||
    it.primaryImageTag ||
    (ImageTags && (ImageTags.Primary || ImageTags.primary)) ||
    null;

  var RemoteTrailers =
    it.RemoteTrailers ||
    it.remoteTrailers ||
    it.RemoteTrailerItems ||
    it.RemoteTrailerUrls ||
    [];

  var Genres = Array.isArray(it.Genres)
    ? it.Genres
    : (Array.isArray(it.genres) ? it.genres : []);

  return {
    key: (scope) + "|" + (Id),
    scope,
    itemId: Id,
    updatedAt: now,

    Id,
    Name: it.Name || it.name || '',
    Type: it.Type || it.type || '',
    ProductionYear: (it.ProductionYear || it.productionYear || null),
    OfficialRating: it.OfficialRating || it.officialRating || '',
    CommunityRating,

    ImageTags,
    PrimaryImageTag,

    BackdropImageTags: it.BackdropImageTags || it.backdropImageTags || null,
    PrimaryImageAspectRatio: (it.PrimaryImageAspectRatio || it.primaryImageAspectRatio || null),
    Overview: it.Overview || it.overview || '',

    RunTimeTicks: (it.RunTimeTicks || it.runTimeTicks || null),
    CumulativeRunTimeTicks: (it.CumulativeRunTimeTicks || it.cumulativeRunTimeTicks || null),

    Genres,
    RemoteTrailers,
  };
}

export function putItems(db, scope, items) {
  if (!db || !scope || !items.length) return;

  var tx = db.transaction(['items'], 'readwrite');
  var store = tx.objectStore('items');
  var now = Date.now();

  for (var it of items) {
    var rec = toPrcItemRecord(scope, it, now);
    if (rec) store.put(rec);
  }

  txDone(tx);
}

export function getMeta(db, key) {
  var tx = db.transaction(['meta'], 'readonly');
  var val = promisify(tx.objectStore('meta').get(key));
  txDone(tx);
  return val.value || null;
}

export function setMeta(db, key, value) {
  var tx = db.transaction(['meta'], 'readwrite');
  tx.objectStore('meta').put({ key, value, updatedAt: Date.now() });
  txDone(tx);
}

function cursorIter(req, onValue) {
  return new Promisefunction((resolve, reject) {
    req.onerror = function() reject(req.error);
    req.onsuccess = function(e) {
      var cur = e.target.result;
      if (!cur) return resolve(true);
      try { onValue(cur); }
      catch {}
      cur.continue();
    };
  });
}

export function purgeScopeItems(db, scope, {
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  maxItems = 1200,
  maxScan = 6000,
} = {}) {
  if (!db || !scope) return { removed: 0, scanned: 0, capped: 0 };

  var now = Date.now();
  var cutoff = now - Math.max(60_000, ttlMs | 0);

  var tx = db.transaction(['items'], 'readwrite');
  var store = tx.objectStore('items');
  var idxScope = store.index('byScope');

  var removed = 0;
  var scanned = 0;

  var req = idxScope.openCursor(IDBKeyRange.only(scope));
  var touched = [];

  cursorIterfunction(req, (cur) {
    var v = cur.value || {};
    scanned++;
    if (maxScan && scanned >= maxScan) {
    }

    var key = v.key;
    var updatedAt = Number(v.updatedAt || 0);

    if (updatedAt && updatedAt < cutoff) {
      try { cur.delete(); removed++; } catch {}
      return;
    }

    if (key) touched.push({ key, updatedAt });
  });

  var capped = 0;
  if (maxItems && touched.length > maxItems) {
    touched.sortfunction((a, b) (a.updatedAt || 0) - (b.updatedAt || 0));
    var over = touched.length - maxItems;
    for (var i = 0; i < over; i++) {
      var k = touched[i].key;
      if (!k) continue;
      try { store.delete(k); capped++; } catch {}
    }
  }

  txDone(tx);
  return { removed, scanned, capped };
}

export function purgePrcMeta(db, {
  ttlMs = 30 * 24 * 60 * 60 * 1000,
  prefix = 'prc:',
  maxScan = 3000,
} = {}) {
  if (!db) return { removed: 0, scanned: 0 };

  var now = Date.now();
  var cutoff = now - Math.max(60_000, ttlMs | 0);

  var tx = db.transaction(['meta'], 'readwrite');
  var store = tx.objectStore('meta');

  var removed = 0;
  var scanned = 0;

  var req = store.openCursor();
  cursorIterfunction(req, (cur) {
    var v = cur.value || {};
    scanned++;
    if (maxScan && scanned > maxScan) return;

    var k = String(v.key || '');
    if (!k.startsWith(prefix)) return;

    var updatedAt = Number(v.updatedAt || 0);
    if (updatedAt && updatedAt < cutoff) {
      try { cur.delete(); removed++; } catch {}
    }
  });

  txDone(tx);
  return { removed, scanned };
}

export function purgePrcDb(db, scope, opts = {}) {
  var itemsRes = purgeScopeItems(db, scope, opts.items || {});
  var metaRes  = purgePrcMeta(db, opts.meta || {});
  return { items: itemsRes, meta: metaRes };
}
