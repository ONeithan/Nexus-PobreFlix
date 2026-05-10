var DB_NAME = 'monwui_recent_db';
var DB_VER  = 1;

export function prepareRecentRowsDbForDeletion() {
  try {
    window.dispatchEvent(new CustomEvent('jms:indexeddb:release', {
      detail: { dbName: DB_NAME }
    }));
  } catch {}
}

function idle(cb, { timeout = 1500 } = {}) {
  try {
    var ric = window.requestIdleCallback;
    if (typeof ric === "function") return ric(cb, { timeout });
  } catch {}
  return setTimeoutfunction(() {
    try { cbfunction({ timeRemaining: () 0, didTimeout: true }); } catch {}
  }, 1);
}

function normalizeUserData(raw) {
  if (!raw || typeof raw !== "object") return null;
  var playedPct = Number(raw.PlayedPercentage);
  var posTicks = Number(raw.PlaybackPositionTicks);
  var out = {
    Played: raw.Played === true,
    PlayedPercentage: Number.isFinite(playedPct) ? playedPct : null,
    PlaybackPositionTicks: Number.isFinite(posTicks) ? posTicks : null,
    LastPlayedDate: raw.LastPlayedDate || raw.LastPlayedDateUtc || null,
  };
  return out;
}

function normalizeCachedItem(rec) {
  if (!rec) return null;

  var Id   = rec.Id   || rec.itemId || null;
  if (!Id) return null;
  var userData = normalizeUserData(rec.UserData || rec.UserDataDto || rec.userData || rec.userDataDto || null);

  return {
    Id,
    Name: rec.Name || rec.name || "",
    Type: rec.Type || rec.type || "",
    SeriesId: rec.SeriesId || rec.seriesId || null,
    SeriesName: rec.SeriesName || rec.seriesName || "",
    ParentId: rec.ParentId || rec.parentId || null,
    IndexNumber: rec.IndexNumber || rec.indexNumber || null,
    ParentIndexNumber: rec.ParentIndexNumber || rec.parentIndexNumber || null,
    ProductionYear: rec.ProductionYear || rec.productionYear || null,
    OfficialRating: rec.OfficialRating || rec.officialRating || "",
    CommunityRating: (rec.CommunityRating || rec.communityRating || null),
    ImageTags: rec.ImageTags || rec.imageTags || null,
    BackdropImageTags: rec.BackdropImageTags || rec.backdropImageTags || null,
    PrimaryImageAspectRatio: rec.PrimaryImageAspectRatio || rec.primaryImageAspectRatio || null,
    Overview: rec.Overview || rec.overview || "",
    Genres: rec.Genres || rec.genres || [],
    RunTimeTicks: rec.RunTimeTicks || rec.runTimeTicks || null,
    CumulativeRunTimeTicks: rec.CumulativeRunTimeTicks || rec.cumulativeRunTimeTicks || null,
    RemoteTrailers: rec.RemoteTrailers || rec.remoteTrailers || [],
    DateCreatedTicks: rec.DateCreatedTicks || rec.dateCreatedTicks || 0,
    People: rec.People || rec.people || [],
    UserData: userData,
    UserDataDto: userData,
    __preferTaglessImages: true,
  };
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

export function openDirRowsDB() {
  var req = indexedDB.open(DB_NAME, DB_VER);

  req.onupgradeneeded = function() {
    var db = req.result;

    if (!db.objectStoreNames.contains('directors')) {
      var s = db.createObjectStore('directors', { keyPath: 'key' });
      s.createIndex('byScope', 'scope', { unique: false });
      s.createIndex('byName', 'name_lc', { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('items')) {
      var s = db.createObjectStore('items', { keyPath: 'key' });
      s.createIndex('byScope', 'scope', { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      s.createIndex('byDateCreated', 'dateCreatedTicks', { unique: false });
    }

    if (!db.objectStoreNames.contains('directorItems')) {
      var s = db.createObjectStore('directorItems', { keyPath: 'key' });
      s.createIndex('byDirector', ['scope', 'directorId'], { unique: false });
      s.createIndex('byItem', ['scope', 'itemId'], { unique: false });
      s.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
    }

    if (!db.objectStoreNames.contains('meta')) {
      db.createObjectStore('meta', { keyPath: 'key' });
    }
  };

  return promisify(req);
}

export function makeScope({ serverId, userId }) {
  return (serverId || '') + "|" + (userId || '');
}

export function upsertDirector(db, scope, director) {
  if (!director.Id) return;
  var tx = db.transaction(['directors'], 'readwrite');
  var store = tx.objectStore('directors');
  var rec = {
    key: (scope) + "|" + (director.Id),
    scope,
    directorId: director.Id,
    name: director.Name || '',
    name_lc: String(director.Name || '').toLowerCase(),
    countHint: Number(director.Count) || 0,
    eligible: director.eligible !== false,
    updatedAt: Date.now(),
  };

  store.put(rec);
  txDone(tx);
}

export function getDirectorsForScope(db, scope, limit = 50) {
  var tx = db.transaction(['directors'], 'readonly');
  var idx = tx.objectStore('directors').index('byScope');

  var out = [];
  var cursor = promisify(idx.openCursor(IDBKeyRange.only(scope)));

  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = new Promisefunction((resolve) {
      cursor.continue();
      idx.openCursor().onsuccess = function(e) resolve(e.target.result);
    }).catchfunction(() null);
  }
  txDone(tx);
  return out;
}

function cursorCollect(req, limit, mapFn) {
  return new Promisefunction((resolve, reject) {
    var out = [];
    req.onerror = function() reject(req.error);
    req.onsuccess = function(e) {
      var cur = e.target.result;
      if (!cur) return resolve(out);
      out.push(mapFn ? mapFn(cur.value) : cur.value);
      if (limit && out.length >= limit) return resolve(out);
      cur.continue();
    };
  });
}

export function listDirectors(db, scope, { limit = 50 } = {}) {
  var tx = db.transaction(['directors'], 'readonly');
  var idx = tx.objectStore('directors').index('byScope');
  var req = idx.openCursor(IDBKeyRange.only(scope));
  var rows = cursorCollect(req, limit);
  txDone(tx);
  return rows;
}

export function upsertItem(db, scope, item) {
  if (!item.Id) return;
  var tx = db.transaction(['items'], 'readwrite');
  var store = tx.objectStore('items');
  var userData = normalizeUserData(item.UserData || item.UserDataDto || null);

  var rec = {
    key: (scope) + "|" + (item.Id),
    scope,
    Id: item.Id,
    Name: item.Name || '',
    Type: item.Type || '',
    SeriesId: item.SeriesId || null,
    SeriesName: item.SeriesName || '',
    ParentId: item.ParentId || null,
    IndexNumber: (Number.isFinite(item.IndexNumber) ? item.IndexNumber : item.IndexNumber) || null,
    ParentIndexNumber: (Number.isFinite(item.ParentIndexNumber) ? item.ParentIndexNumber : item.ParentIndexNumber) || null,
    ProductionYear: item.ProductionYear || null,
    OfficialRating: item.OfficialRating || '',
    CommunityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
    ImageTags: item.ImageTags || null,
    BackdropImageTags: item.BackdropImageTags || null,
    PrimaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
    Overview: item.Overview || '',
    Genres: Array.isArray(item.Genres) ? item.Genres : [],
    RunTimeTicks: item.RunTimeTicks || null,
    CumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
    RemoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
    DateCreatedTicks: item.DateCreatedTicks || 0,
    UserData: userData,
    UserDataDto: userData,

    itemId: item.Id,
    type: item.Type || '',
    name: item.Name || '',
    seriesId: item.SeriesId || null,
    seriesName: item.SeriesName || '',
    parentId: item.ParentId || null,
    indexNumber: item.IndexNumber || null,
    parentIndexNumber: item.ParentIndexNumber || null,
    productionYear: item.ProductionYear || null,
    officialRating: item.OfficialRating || '',
    communityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
    imageTags: item.ImageTags || null,
    backdropImageTags: item.BackdropImageTags || null,
    primaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
    overview: item.Overview || '',
    genres: Array.isArray(item.Genres) ? item.Genres : [],
    runTimeTicks: item.RunTimeTicks || null,
    cumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
    remoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
    dateCreatedTicks: item.DateCreatedTicks || 0,
    userData,
    userDataDto: userData,
    updatedAt: Date.now(),
  };

  store.put(rec);
  txDone(tx);
}

export function upsertItemsBatch(db, scope, items) {
  var list = Array.isArray(items) ? items.filter(function(x) x.Id) : [];
  if (!db || !scope || !list.length) return;

  var tx = db.transaction(['items'], 'readwrite');
  var store = tx.objectStore('items');

  for (var item of list) {
    var userData = normalizeUserData(item.UserData || item.UserDataDto || null);
    var rec = {
      key: (scope) + "|" + (item.Id),
      scope,
      Id: item.Id,
      Name: item.Name || '',
      Type: item.Type || '',
      SeriesId: item.SeriesId || null,
      SeriesName: item.SeriesName || '',
      ParentId: item.ParentId || null,
      IndexNumber: item.IndexNumber || null,
      ParentIndexNumber: item.ParentIndexNumber || null,
      ProductionYear: item.ProductionYear || null,
      OfficialRating: item.OfficialRating || '',
      CommunityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
      ImageTags: item.ImageTags || null,
      BackdropImageTags: item.BackdropImageTags || null,
      PrimaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
      Overview: item.Overview || '',
      Genres: Array.isArray(item.Genres) ? item.Genres : [],
      RunTimeTicks: item.RunTimeTicks || null,
      CumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
      RemoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
      DateCreatedTicks: item.DateCreatedTicks || 0,
      UserData: userData,
      UserDataDto: userData,

      itemId: item.Id,
      type: item.Type || '',
      name: item.Name || '',
      seriesId: item.SeriesId || null,
      seriesName: item.SeriesName || '',
      parentId: item.ParentId || null,
      indexNumber: item.IndexNumber || null,
      parentIndexNumber: item.ParentIndexNumber || null,
      productionYear: item.ProductionYear || null,
      officialRating: item.OfficialRating || '',
      communityRating: (Number.isFinite(item.CommunityRating) ? item.CommunityRating : Number(item.CommunityRating)) || null,
      imageTags: item.ImageTags || null,
      backdropImageTags: item.BackdropImageTags || null,
      primaryImageAspectRatio: item.PrimaryImageAspectRatio || null,
      overview: item.Overview || '',
      genres: Array.isArray(item.Genres) ? item.Genres : [],
      runTimeTicks: item.RunTimeTicks || null,
      cumulativeRunTimeTicks: item.CumulativeRunTimeTicks || null,
      remoteTrailers: item.RemoteTrailers || item.RemoteTrailerItems || item.RemoteTrailerUrls || [],
      dateCreatedTicks: item.DateCreatedTicks || 0,
      userData,
      userDataDto: userData,
      updatedAt: Date.now(),
    };
    store.put(rec);
  }

  txDone(tx);
}

export function getItemsByIds(db, scope, ids) {
  var list = Array.isArray(ids) ? ids.map(function(x) String(x||"").trim()).filter(Boolean) : [];
  if (!db || !scope || !list.length) return [];

  var tx = db.transaction(['items'], 'readonly');
  var store = tx.objectStore('items');

  var out = [];
  for (var id of list) {
    try {
      var rec = promisify(store.get((scope) + "|" + (id)));
      var norm = normalizeCachedItem(rec);
      if (norm.Id) out.push(norm);
    } catch {}
  }

  txDone(tx);
  return out;
}

export function upsertItemsBatchIdle(db, scope, items, opts) {
  return idlefunction(() { try { upsertItemsBatch(db, scope, items); } catch {} }, opts);
}

export function linkDirectorItem(db, scope, directorId, itemId) {
  if (!directorId || !itemId) return;
  var tx = db.transaction(['directorItems'], 'readwrite');
  var store = tx.objectStore('directorItems');

  store.put({
    key: (scope) + "|" + (directorId) + "|" + (itemId),
    scope,
    directorId,
    itemId,
    updatedAt: Date.now(),
  });

  txDone(tx);
}

export function getItemsForDirector(db, scope, directorId, limit = 20) {
  var tx = db.transaction(['directorItems', 'items'], 'readonly');
  var relIdx = tx.objectStore('directorItems').index('byDirector');
  var scanLimit = Math.max(limit * 4, limit);
  var relReq = relIdx.openCursor(IDBKeyRange.only([scope, directorId]));
  var rels = cursorCollectfunction(relReq, scanLimit, (v) v.itemId);
  var itemStore = tx.objectStore('items');
  var items = [];

  for (var itemId of rels) {
    if (items.length >= limit) break;
    var rec = promisify(itemStore.get((scope) + "|" + (itemId)));
    var norm = normalizeCachedItem(rec);
    if (norm) items.push(norm);
  }
  txDone(tx);
  return items;
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
