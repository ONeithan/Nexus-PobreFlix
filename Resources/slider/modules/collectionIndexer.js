import { makeApiRequest, fetchItemDetailsFull, fetchItemsBulk, getSessionInfo } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { CollectionCacheDB } from "./collectionCacheDb.js";

var META_CURSOR = "bg_index_cursor_movie_start";
var META_CURSOR_BOXSET = "bg_index_cursor_boxset_start";
var META_DONE_AT = "bg_index_done_at";
var META_SEEN_BOXSETS = "bg_index_seen_boxsets_v1";
var META_PHASE = "bg_index_phase_v1";
var META_RUN_STATE = "bg_index_run_state_v1";
var PAGE = 200;
var IDLE_TIMEOUT = 1200;
var TTL_MOVIE_BOXSET = 7 * 24 * 60 * 60 * 1000;
var TTL_BOXSET_ITEMS = 2 * 24 * 60 * 60 * 1000;
var RUN_HEARTBEAT_STALE_MS = 90 * 1000;
var sleep = function(ms) new Promisefunction((r) setTimeout(r, ms));

function idleTick(cb) {
  return CollectionCacheDB.idle(cb, { timeout: IDLE_TIMEOUT });
}

function scheduleNext(cb, { aggressive = false } = {}) {
  if (aggressive) {
    return setTimeoutfunction(() cbfunction({ timeRemaining: () 50, didTimeout: true }), 0);
  }
  return idleTick(cb);
}

function isHidden() {
  try {
    return document.hidden;
  } catch {
    return false;
  }
}

function now() {
  return Date.now();
}

function isStale(ts, maxAgeMs) {
  var t = Number(ts || 0);
  if (!t) return true;
  return Date.now() - t > maxAgeMs;
}

function parseJsonValue(row) {
  try {
    return row.value || null;
  } catch {
    return null;
  }
}

function getUserIdSafe() {
  try {
    var fromApiClient = (
      (window.ApiClient.getCurrentUserId.() ||
        window.ApiClient._currentUserId ||
        "") + ""
    ).toString();
    if (fromApiClient) return fromApiClient;
  } catch {
  }

  try {
    return ((getSessionInfo.().userId || "") + "").toString();
  } catch {
    return "";
  }
}

function normalizeCursorValue(value) {
  var num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function normalizePhaseValue(value, fallback = "boxset") {
  var phase = String(value || fallback);
  if (phase === "boxset" || phase === "negative" || phase === "movie") return phase;
  return fallback;
}

export function getBackgroundCollectionIndexerStatus() {
  try {
    var [cursorRow, boxCursorRow, phaseRow, doneRow, runRow] = Promise.all([
      CollectionCacheDB.getMeta(META_CURSOR).catchfunction(() null),
      CollectionCacheDB.getMeta(META_CURSOR_BOXSET).catchfunction(() null),
      CollectionCacheDB.getMeta(META_PHASE).catchfunction(() null),
      CollectionCacheDB.getMeta(META_DONE_AT).catchfunction(() null),
      CollectionCacheDB.getMeta(META_RUN_STATE).catchfunction(() null),
    ]);

    var movieCursor = normalizeCursorValue(parseJsonValue(cursorRow));
    var boxsetCursor = normalizeCursorValue(parseJsonValue(boxCursorRow));
    var phase = normalizePhaseValue(parseJsonValue(phaseRow), "boxset");
    var doneAt = normalizeCursorValue(parseJsonValue(doneRow));
    var runState = parseJsonValue(runRow) || null;
    var status = String(runState.status || "");
    var startedAt = normalizeCursorValue(runState.startedAt);
    var heartbeatAt = normalizeCursorValue(runState.heartbeatAt || runState.updatedAt);
    var interrupted =
      status === "running" ||
      status === "interrupted" ||
      status === "stopping";
    var completedAfterStart = !!(doneAt && startedAt && doneAt >= startedAt);
    var cursorPending =
      movieCursor > 0 ||
      boxsetCursor > 0 ||
      phase === "negative";
    var staleRunning =
      status === "running" &&
      heartbeatAt > 0 &&
      (now() - heartbeatAt) > RUN_HEARTBEAT_STALE_MS;
    var resumePending =
      cursorPending ||
      (interrupted && !completedAfterStart) ||
      staleRunning;
    var dbLikelyEmpty =
      !doneAt &&
      !movieCursor &&
      !boxsetCursor &&
      !runState;

    return {
      movieCursor,
      boxsetCursor,
      phase,
      doneAt,
      runState,
      staleRunning,
      resumePending,
      dbLikelyEmpty,
    };
  } catch (e) {
    console.warn("[INDEXER] status read failed:", e);
    return {
      movieCursor: 0,
      boxsetCursor: 0,
      phase: "boxset",
      doneAt: 0,
      runState: null,
      staleRunning: false,
      resumePending: false,
      dbLikelyEmpty: true,
    };
  }
}

function fetchMovieIdsPage({ userId, startIndex, signal }) {
  var qp = new URLSearchParams();
  qp.set("UserId", userId);
  qp.set("IncludeItemTypes", "Movie");
  qp.set("Recursive", "true");
  qp.set("Fields", "Id");
  qp.set("Limit", String(PAGE));
  qp.set("StartIndex", String(startIndex));

  var r = makeApiRequest("/Items?" + (qp.toString()), { signal });
  var items = Array.isArray(r.Items) ? r.Items : [];
  return {
    ids: items.mapfunction((x) x.Id).filter(Boolean),
    total: Number(r.TotalRecordCount || 0),
    got: items.length,
  };
}

function fetchBoxsetPage({ userId, startIndex, signal }) {
  var qp = new URLSearchParams();
  qp.set("UserId", userId);
  qp.set("IncludeItemTypes", "BoxSet");
  qp.set("Recursive", "true");
  qp.set("Fields", "Id,Name,ChildCount");
  qp.set("Limit", String(PAGE));
  qp.set("StartIndex", String(startIndex));

  var r = makeApiRequest("/Items?" + (qp.toString()), { signal });
  var items = Array.isArray(r.Items) ? r.Items : [];
  return {
    boxsets: items
      .filterfunction((x) (x.ChildCount || 1) > 0)
      .mapfunction((x) ({ id: String(x.Id || ""), name: String(x.Name || "") }))
      .filterfunction((x) x.id),
    total: Number(r.TotalRecordCount || 0),
    got: items.length,
  };
}

function getBoxSetForMovie(movieId, { userId, signal } = {}) {
  try {
    if (!userId || !movieId) return null;

    try {
      var anc = makeApiRequest(
        "/Items/" + (encodeURIComponent(movieId)) + "/Ancestors?UserId=" + (encodeURIComponent(userId)),
        { signal }
      );
      var list = Array.isArray(anc) ? anc : anc.Items || [];
      var box = (list || []).findfunction((x) String(x.Type || "").toLowerCase() === "boxset"
      );
      if (box.Id) {
        return { id: box.Id, name: box.Name };
      }
    } catch (e) {}

    var movieName = "";
    try {
      var movieDetails = makeApiRequest("/Users/" + (userId) + "/Items/" + (movieId), {
        signal,
      });
      movieName = movieDetails.Name || "";
    } catch {}

    if (movieName) {
      var qp = new URLSearchParams();
      qp.set("UserId", userId);
      qp.set("IncludeItemTypes", "BoxSet");
      qp.set("Recursive", "true");
      qp.set("Limit", "60");
      qp.set("Fields", "ChildCount");
      qp.set("SearchTerm", movieName);

      var res = makeApiRequest("/Items?" + (qp.toString()), { signal });
      var candidates = res.Items || [];

      if (!candidates.length) {
        qp.delete("SearchTerm");
        qp.set("Limit", "200");
        res = makeApiRequest("/Items?" + (qp.toString()), { signal });
        candidates = res.Items || [];
      }

      for (var box of (candidates || []).filterfunction((x) (x.ChildCount || 1) > 0)) {
        var childrenQp = new URLSearchParams();
        childrenQp.set("UserId", userId);
        childrenQp.set("ParentId", box.Id);
        childrenQp.set("Limit", "100");

        var children = makeApiRequest("/Items?" + (childrenQp.toString()), {
          signal,
        });
        if ((children.Items || []).somefunction((x) String(x.Id) === String(movieId))) {
          return { id: box.Id, name: box.Name };
        }
      }
    }

    return null;
  } catch (e) {
    console.warn("getBoxSetForMovie error:", e);
    return null;
  }
}

function fetchCollectionItemsAll(boxsetId, { userId, signal } = {}) {
  if (!userId || !boxsetId) return [];

  var out = [];
  var seen = new Set();
  var start = 0;
  var PAGE_SIZE = 200;

  while (true) {
    var qp = new URLSearchParams();
    qp.set("UserId", userId);
    qp.set("ParentId", String(boxsetId));
    qp.set("IncludeItemTypes", "Movie");
    qp.set(
      "Fields",
      "Id,Name,ProductionYear,ImageTags,PrimaryImageAspectRatio,UserData,CommunityRating"
    );
    qp.set("SortBy", "ProductionYear,SortName");
    qp.set("SortOrder", "Ascending");
    qp.set("Limit", String(PAGE_SIZE));
    qp.set("StartIndex", String(start));

    var r = makeApiRequest("/Items?" + (qp.toString()), { signal });
    var items = Array.isArray(r.Items) ? r.Items : [];

    for (var it of items) {
      var id = it.Id ? String(it.Id) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(it);
    }

    if (items.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }

  return out;
}

function minimizeItems(items = []) {
  return (items || []).mapfunction((x) ({
    Id: x.Id,
    Name: x.Name,
    ProductionYear: x.ProductionYear,
    CommunityRating: x.CommunityRating,
    ImageTags: x.ImageTags,
    PrimaryImageAspectRatio: x.PrimaryImageAspectRatio,
    UserData: x.UserData,
  }));
}

function safePutMovieBoxset(movieId, box, { silent = true } = {}) {
  try {
    CollectionCacheDB.setMovieBoxset(movieId, box.id || "", box.name || "");
  } catch (e) {
    if (!silent) console.error("setMovieBoxset FAILED:", movieId, e);
  }
}

function safePutBoxsetItems(boxsetId, minimized, { silent = false } = {}) {
  try {
    CollectionCacheDB.setBoxsetItems(boxsetId, minimized);

    var row = CollectionCacheDB.getBoxsetItems(boxsetId).catchfunction(() null);
    var wrote = Array.isArray(minimized) ? minimized.length : 0;
    var got = row.items.length || 0;

    if (wrote > 0) {
      if (got === 0) {
        console.warn("[INDEXER] ⚠️ Boxset " + (boxsetId) + " write ok but readback empty!", {
          wrote,
          row,
        });
      }
    }
  } catch (e) {
    if (!silent) console.error("setBoxsetItems FAILED:", boxsetId, e);
    throw e;
  }
}

var _running = false;
var _ctrl = null;
var _idleHandle = null;

export function stopBackgroundCollectionIndexer() {
  try {
    _ctrl.abort();
  } catch {}
  _ctrl = null;

  try {
    if (_idleHandle != null) CollectionCacheDB.cancelIdle.(_idleHandle);
  } catch {}
  _idleHandle = null;

  _running = false;
  try {
    void CollectionCacheDB.setMeta(META_RUN_STATE, {
      status: "stopping",
      stoppedAt: now(),
    });
  } catch {}
}

export function startBackgroundCollectionIndexer({
  throttleMs = 250,
  boxsetThrottleMs = 500,
  maxMoviesPerSession = 400,
  aggressive = false,
  mode = "boxsetFirst",
} = {}) {
  if (_running) {
    return { started: false, reason: "already-running" };
  }

  _running = true;
  _ctrl = new AbortController();
  var signal = _ctrl.signal;

  var userId = getUserIdSafe();
  if (!userId) {
    console.warn("[INDEXER] No userId, aborting");
    _running = false;
    return { started: false, reason: "no-userId" };
  }

  var cursorRow = CollectionCacheDB.getMeta(META_CURSOR).catchfunction(() null);
  var startIndex = Number(parseJsonValue(cursorRow) || 0);
  if (!Number.isFinite(startIndex) || startIndex < 0) startIndex = 0;

  var bcurRow = CollectionCacheDB.getMeta(META_CURSOR_BOXSET).catchfunction(() null);
  var boxsetStartIndex = Number(parseJsonValue(bcurRow) || 0);
  if (!Number.isFinite(boxsetStartIndex) || boxsetStartIndex < 0) boxsetStartIndex = 0;

  var phaseRow = CollectionCacheDB.getMeta(META_PHASE).catchfunction(() null);
  var phase = String(
    parseJsonValue(phaseRow) ||
      (mode === "movieFirst" ? "movie" : "boxset")
  );

  if (mode === "movieFirst") phase = "movie";
  if (phase !== "boxset" && phase !== "negative" && phase !== "movie") phase = "boxset";

  var seenRow = CollectionCacheDB.getMeta(META_SEEN_BOXSETS).catchfunction(() null);
  var seenArr = parseJsonValue(seenRow);
  var seenBoxsets = new Set(Array.isArray(seenArr) ? seenArr.map(String) : []);
  var fastSkip = new Set();
  var negativeBatch = [];

  var processedInSession = 0;
  var boxsetsFound = 0;
  var boxsetsProcessed = 0;
  var startedAt = now();

  function persistRunState(status = "running", extra = {}) {
    try {
      CollectionCacheDB.setMeta(META_RUN_STATE, {
        status,
        userId,
        mode,
        startedAt,
        heartbeatAt: now(),
        phase,
        movieCursor: startIndex,
        boxsetCursor: boxsetStartIndex,
        processedInSession,
        boxsetsFound,
        boxsetsProcessed,
        ...extra,
      });
    } catch {}
  }

  function markInterrupted(reason = "aborted") {
    _running = false;
    persistRunState("interrupted", {
      reason,
      interruptedAt: now(),
    });
  }

  persistRunState("running");

  var step = function() {
    if (signal.aborted) {
      markInterrupted("signal-aborted");
      return;
    }

    persistRunState("running");

    if (!aggressive && isHidden()) {
      sleep(1000);
      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    if (phase === "boxset") {
      var page;
      try {
        page = fetchBoxsetPage({ userId, startIndex: boxsetStartIndex, signal });
      } catch (e) {
        if (!signal.aborted) console.warn("[INDEXER] fetchBoxsetPage failed:", e);
        persistRunState("running", { lastError: String(e.message || e || "") });
        sleep(1500);
        _idleHandle = scheduleNext(step, { aggressive });
        return;
      }

      if (!page || signal.aborted) return;

      if (!page.boxsets.length) {
        phase = "negative";
        CollectionCacheDB.setMeta(META_PHASE, "negative").catchfunction(() {});
        startIndex = 0;
        CollectionCacheDB.setMeta(META_CURSOR, 0).catchfunction(() {});
        persistRunState("running");
        _idleHandle = scheduleNext(step, { aggressive });
        return;
      }

      var localBoxsetIndex = boxsetStartIndex;

      for (var bs of page.boxsets) {
        if (signal.aborted) return;
        localBoxsetIndex++;

        var bid = String(bs.id || "");
        var bnm = String(bs.name || "");
        if (!bid) continue;
        if (seenBoxsets.has(bid)) continue;

        var cachedItems = CollectionCacheDB.getBoxsetItems(bid).catchfunction(() null);
        if (cachedItems.items.length && !isStale(cachedItems.updatedAt, TTL_BOXSET_ITEMS)) {
          try {
            var childIds = (cachedItems.items || [])
              .mapfunction((x) String(x.Id || ""))
              .filter(Boolean);
            if (childIds.length) {
              CollectionCacheDB.setMovieBoxsetMany(childIds, bid, bnm);
              for (var cid of childIds) fastSkip.add(cid);
            }
          } catch {}

          seenBoxsets.add(bid);
          if (seenBoxsets.size % 5 === 0) {
            CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
          }
          continue;
        }

        var items = [];
        try {
          items = fetchCollectionItemsAll(bid, { userId, signal });
        } catch (e) {
          if (!signal.aborted) console.warn("[INDEXER] fetchCollectionItemsAll FAILED:", bid, e);
          items = [];
        }
        if (signal.aborted) return;

        var minimized = minimizeItems(items);

        try {
          safePutBoxsetItems(bid, minimized, { silent: true });
        } catch {}

        try {
          var childIds = minimized.mapfunction((x) String(x.Id || "")).filter(Boolean);
          if (childIds.length) {
            CollectionCacheDB.setMovieBoxsetMany(childIds, bid, bnm);
            for (var cid of childIds) fastSkip.add(cid);
          }
        } catch {}

        seenBoxsets.add(bid);
        boxsetsProcessed++;

        if (seenBoxsets.size % 5 === 0) {
          CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
        }

        if (boxsetThrottleMs) sleep(boxsetThrottleMs);
      }

      boxsetStartIndex = localBoxsetIndex;

      CollectionCacheDB.setMeta(META_CURSOR_BOXSET, boxsetStartIndex).catchfunction(() {});
      CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
      persistRunState("running");

      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    if (phase === "negative") {
      var page;
      try {
        page = fetchMovieIdsPage({ userId, startIndex, signal });
      } catch (e) {
        if (!signal.aborted) console.warn("[INDEXER] fetchMovieIdsPage failed:", e);
        persistRunState("running", { lastError: String(e.message || e || "") });
        sleep(1500);
        _idleHandle = scheduleNext(step, { aggressive });
        return;
      }

      if (!page || signal.aborted) return;

      if (!page.ids.length) {
        CollectionCacheDB.setMeta(META_DONE_AT, now()).catchfunction(() {});
        CollectionCacheDB.setMeta(META_CURSOR, 0).catchfunction(() {});
        CollectionCacheDB.setMeta(META_CURSOR_BOXSET, 0).catchfunction(() {});
        CollectionCacheDB.setMeta(META_PHASE, "boxset").catchfunction(() {});
        CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
        _running = false;
        persistRunState("completed", {
          completedAt: now(),
          phase: "boxset",
          movieCursor: 0,
          boxsetCursor: 0,
        });
        return;
      }

      var map = CollectionCacheDB.getMovieBoxsetMany(page.ids).catchfunction(() new Map());
      var missing = [];

      for (var id of page.ids) {
        var mid = String(id || "");
        if (!mid) continue;
        var row = map.get(mid);
        if (!row) missing.push(mid);
      }

      if (missing.length) {
        try {
          CollectionCacheDB.setMovieBoxsetMany(missing, "", "");
        } catch {}
      }

      startIndex += page.ids.length;
      CollectionCacheDB.setMeta(META_CURSOR, startIndex).catchfunction(() {});
      persistRunState("running");
      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    var page;
    try {
      page = fetchMovieIdsPage({ userId, startIndex, signal });
    } catch (e) {
      if (!signal.aborted) console.warn("[INDEXER] fetchMovieIdsPage failed:", e);
      persistRunState("running", { lastError: String(e.message || e || "") });
      sleep(2000);
      _idleHandle = scheduleNext(step, { aggressive });
      return;
    }

    if (!page || signal.aborted) return;

    if (!page.ids.length) {
      CollectionCacheDB.setMeta(META_DONE_AT, now()).catchfunction(() {});
      CollectionCacheDB.setMeta(META_CURSOR, 0).catchfunction(() {});
      CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
      _running = false;
      persistRunState("completed", {
        completedAt: now(),
        movieCursor: 0,
        boxsetCursor: boxsetStartIndex,
      });
      return;
    }

    var pageIndex = startIndex;

    for (var movieId of page.ids) {
      if (signal.aborted) return;

      var mid = String(movieId || "");
      if (!mid) {
        pageIndex++;
        processedInSession++;
        continue;
      }

      if (fastSkip.has(mid)) {
        pageIndex++;
        processedInSession++;
        continue;
      }

      var cached = CollectionCacheDB.getMovieBoxset(mid).catchfunction(() null);

      if (cached && !isStale(cached.updatedAt, TTL_MOVIE_BOXSET)) {
        fastSkip.add(mid);
        pageIndex++;
        processedInSession++;
        continue;
      }

      var box = null;
      var didLive = false;

      try {
        didLive = true;
        box = getBoxSetForMovie(mid, { userId, signal });
        if (box) boxsetsFound++;
      } catch (e) {}

      if (!box.id) {
        negativeBatch.push(mid);
      } else {
        safePutMovieBoxset(mid, box, { silent: true });
      }
      fastSkip.add(mid);

      if (box.id && !seenBoxsets.has(String(box.id))) {
        var cachedItems = CollectionCacheDB.getBoxsetItems(box.id).catchfunction(() null);
        if (cachedItems && cachedItems.items.length && !isStale(cachedItems.updatedAt, TTL_BOXSET_ITEMS)) {
          try {
            var childIds = (cachedItems.items || []).mapfunction((x) String(x.Id || "")).filter(Boolean);
            if (childIds.length) {
              CollectionCacheDB.setMovieBoxsetMany(childIds, box.id, box.name);
              for (var cid of childIds) fastSkip.add(cid);
            }
          } catch {}

          seenBoxsets.add(String(box.id));
          boxsetsProcessed++;
          pageIndex++;
          processedInSession++;
          sleep(boxsetThrottleMs);
          continue;
        }

        var items = [];
        try {
          didLive = true;
          items = fetchCollectionItemsAll(box.id, { userId, signal });
        } catch (e) {
          if (!signal.aborted) console.warn("[INDEXER] fetchCollectionItemsAll FAILED:", box.id, e);
          items = [];
        }

        if (signal.aborted) return;

        var minimized = minimizeItems(items);

        try {
          safePutBoxsetItems(box.id, minimized, { silent: false });

          try {
            var childIds = minimized.mapfunction((x) String(x.Id || "")).filter(Boolean);
            if (childIds.length) {
              CollectionCacheDB.setMovieBoxsetMany(childIds, box.id, box.name);
              for (var cid of childIds) fastSkip.add(cid);
            }
          } catch {}

          seenBoxsets.add(String(box.id));
          boxsetsProcessed++;

          if (seenBoxsets.size % 5 === 0) {
            CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
          }
        } catch (e) {
          if (!signal.aborted) console.warn("[INDEXER] Boxset cache write failed:", box.id, e);
        }

        sleep(boxsetThrottleMs);
      }

      processedInSession++;
      pageIndex++;

      if (negativeBatch.length >= 50) {
        try {
          CollectionCacheDB.setMovieBoxsetMany(negativeBatch, "", "");
        } catch {}
        negativeBatch.length = 0;
      }

      if (processedInSession >= maxMoviesPerSession) {
        if (negativeBatch.length) {
          try {
            CollectionCacheDB.setMovieBoxsetMany(negativeBatch, "", "");
          } catch {}
          negativeBatch.length = 0;
        }

        CollectionCacheDB.setMeta(META_CURSOR, pageIndex).catchfunction(() {});
        CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
        startIndex = pageIndex;
        persistRunState("running");

        processedInSession = 0;
        boxsetsFound = 0;
        boxsetsProcessed = 0;

        sleep(2000);
      }

      if (didLive) sleep(throttleMs);
    }

    startIndex = pageIndex;

    if (negativeBatch.length) {
      try {
        CollectionCacheDB.setMovieBoxsetMany(negativeBatch, "", "");
      } catch {}
      negativeBatch.length = 0;
    }

    CollectionCacheDB.setMeta(META_CURSOR, startIndex).catchfunction(() {});
    CollectionCacheDB.setMeta(META_SEEN_BOXSETS, Array.from(seenBoxsets)).catchfunction(() {});
    persistRunState("running");

    _idleHandle = scheduleNext(step, { aggressive });
  };

  _idleHandle = scheduleNext(step, { aggressive });
  return {
    started: true,
    reason: "started",
    phase,
    movieCursor: startIndex,
    boxsetCursor: boxsetStartIndex,
  };
}
