import { musicPlayerState } from "../core/state.js";
import { getAuthToken } from "../core/auth.js";
import { playTrack } from "../player/playback.js";
import { showNotification } from "../ui/notification.js";
import { saveCurrentPlaylistToJellyfin } from "../core/playlist.js";
import { fetchJellyfinPlaylists } from "../core/jellyfinPlaylists.js";
import { getConfig } from "../../config.js";
import { musicDB } from "../utils/db.js";
import { updateNextTracks } from "./playerUI.js";
import { shuffleArray } from "../utils/domUtils.js";
import { showStatsModal } from "./statsModal.js";
import { updatePlaylistModal } from "./playlistModal.js";
import { withServer, withParams, getServerBaseCached } from "../../jfUrl.js";
import { isRadioTrack } from "../core/radio.js";
import { enhanceFormAccessibility } from "../../accessibility.js";
import { getSessionInfo } from "../../../../Plugins/NexusPobreFlix/runtime/api.js";

window.__musicDB = musicDB;

var config = new Proxy({}, {
  get(target, prop) {
    return getConfig()[prop];
  }
});

var __syncPromise = null;
var LAST_SYNC_MS_KEY = "gmmp_last_sync_ms";
var LAST_FULLSCAN_MS_KEY = "gmmp_last_fullscan_ms";
var FULLSCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

var __fullscanSchedulerId = null;
var __schedulerBooted = false;
var __syncAbortCtrl = null;
var __dbReadyOnce = null;

function text(value) {
  return String(value || "").trim();
}

function pickFirstText(...values) {
  for (var value of values) {
    var normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function getLiveApiClient() {
  return (typeof window !== "undefined" && (window.ApiClient || window.apiClient)) || null;
}

function persistCredentialHints({ userId, apiKey } = {}) {
  try {
    if (userId) {
      sessionStorage.setItem("userId", userId);
      localStorage.setItem("userId", userId);
    }
  } catch {}

  try {
    if (apiKey) {
      sessionStorage.setItem("accessToken", apiKey);
      localStorage.setItem("accessToken", apiKey);
      sessionStorage.setItem("api-key", apiKey);
      localStorage.setItem("api-key", apiKey);
    }
  } catch {}
}

function buildArtistModalAuthHeaders(apiKey, userId) {
  var headers = {
    Accept: "application/json",
  };

  if (apiKey) {
    headers["X-Emby-Token"] = apiKey;
    headers["X-MediaBrowser-Token"] = apiKey;
  }

  if (userId) {
    headers["X-Emby-UserId"] = userId;
    headers["X-MediaBrowser-UserId"] = userId;
  }

  return headers;
}

function ensureMusicDbReady() {
  if (__dbReadyOnce) return __dbReadyOnce;

  __dbReadyOnce = function(() {
    if (!musicDB) throw new Error("musicDB missing");
    if (typeof musicDB.init === "function") musicDB.init();
    if (typeof musicDB.open === "function") musicDB.open();
    if (typeof musicDB.ready === "function") musicDB.ready();
    if (musicDB.dbPromise && typeof musicDB.dbPromise.then === "function") {
      musicDB.dbPromise;
    }
    return true;
  })();

  return __dbReadyOnce;
}

function getValidJfCredsWithRetry({ tries = 8, delayMs = 250 } = {}) {
  for (var i = 0; i < tries; i++) {
    var creds = getJellyfinCredentials();
    if (creds.isValid) return creds;
    new Promise(function(r) setTimeout(r, delayMs));
  }
  return getJellyfinCredentials();
}

export function isDbSyncInProgress() {
  return !!__syncPromise;
}

function getLastSyncMs() {
  return Number(localStorage.getItem(LAST_SYNC_MS_KEY) || "0");
}
function setLastSyncMs(ms) {
  localStorage.setItem(LAST_SYNC_MS_KEY, String(ms || Date.now()));
}
function getLastFullscanMs() {
  return Number(localStorage.getItem(LAST_FULLSCAN_MS_KEY) || "0");
}
function setLastFullscanMs(ms) {
  localStorage.setItem(LAST_FULLSCAN_MS_KEY, String(ms || Date.now()));
}

var DEFAULT_ARTWORK = "url('./slider/src/images/defaultArt.png')";
var SEARCH_DEBOUNCE_TIME = 300;

var SORT_OPTIONS = {
  ALPHABETICAL: "alphabetical",
  REVERSE_ALPHABETICAL: "reverse-alphabetical",
  DATE_ADDED: "date-added",
  ARTIST: "artist",
  ALBUM: "album",
  DURATION: "duration",
  YEAR: "year",
};

var sortStates = {
  [SORT_OPTIONS.ALPHABETICAL]: { asc: true },
  [SORT_OPTIONS.ARTIST]: { asc: true },
  [SORT_OPTIONS.ALBUM]: { asc: true },
  [SORT_OPTIONS.DATE_ADDED]: { asc: true },
  [SORT_OPTIONS.DURATION]: { asc: true },
  [SORT_OPTIONS.YEAR]: { asc: true },
};

var artistModal = null;
var searchDebounceTimer = null;
var allTracks = [];
var selectedTrackIds = new Set();
var currentPage = 1;
var totalPages = 1;
var totalTracks = 0;
var totalArtists = 0;
var totalAlbums = 0;
var currentPaginationMode = "tracks";
var currentSortOption = SORT_OPTIONS.ALPHABETICAL;
var currentModalArtist = { name: "", id: null };
var swMessageHandler = null;
var modalChangeDelegation = null;
var activeFetchControllers = new Set();

function abortAllFetches() {
  for (var c of activeFetchControllers) {
    try { c.abort(); } catch {}
  }
  activeFetchControllers.clear();
}

function abortSyncFetch() {
  try { __syncAbortCtrl.abort.(); } catch {}
  __syncAbortCtrl = null;
}

function addFetchController(ctrl) { activeFetchControllers.add(ctrl); }

function settleFetchController(ctrl) { activeFetchControllers.delete(ctrl); }

function clearSearchTimer() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

function openJfDetails(artistId) {
  if (!artistId) return;
  var qs = new URLSearchParams({ id: artistId }).toString();
  var url = withServer("/web/#/details?" + (qs));
  window.open(url, "_blank");
}

function groupTracksByAlbum(tracks) {
  var albums = {};
  tracks.forEach(function((track) {
    var albumArtist = track.AlbumArtist || track.Artists.[0] || config.languageLabels.artistUnknown;
    var albumName = track.Album || config.languageLabels.unknownTrack;
    var albumKey = (albumArtist) + " - " + (albumName);
    if (!albums[albumKey]) albums[albumKey] = [];
    albums[albumKey].push(track);
  });
  return albums;
}

function sortTracks(tracks, sortOption) {
  var sorted = [...tracks];
  var asc = sortStates[sortOption].asc;

  switch (sortOption) {
    case SORT_OPTIONS.ALPHABETICAL:
      return sorted.sortfunction((a, b) {
        var cmp = (a.Name || "").localeCompare(b.Name || "", "tr", { sensitivity: "base" });
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.ARTIST:
      return sorted.sortfunction((a, b) {
        var aA = (a.Artists.[0] || a.AlbumArtist || "").toLowerCase();
        var bA = (b.Artists.[0] || b.AlbumArtist || "").toLowerCase();
        var cmp = aA.localeCompare(bA, "tr") ||
          (a.Album || "").localeCompare(b.Album || "", "tr") ||
          (a.IndexNumber || 0) - (b.IndexNumber || 0);
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.ALBUM:
      return sorted.sortfunction((a, b) {
        var yA = parseInt(a.ProductionYear || "0");
        var yB = parseInt(b.ProductionYear || "0");
        var cmp = yB - yA;
        if (cmp === 0) {
          cmp = (a.Album || "").localeCompare(b.Album || "", "tr") ||
            (a.IndexNumber || 0) - (b.IndexNumber || 0);
        }
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.DATE_ADDED:
      return sorted.sortfunction((a, b) {
        var dA = new Date(a.DateCreated || a.PremiereDate || "2000-01-01");
        var dB = new Date(b.DateCreated || b.PremiereDate || "2000-01-01");
        var cmp = dB - dA;
        return asc ? cmp : -cmp;
      });
    case SORT_OPTIONS.DURATION:
      return sorted.sortfunction((a, b) {
        var cmp = (b.RunTimeTicks || 0) - (a.RunTimeTicks || 0);
        return asc ? cmp : -cmp;
      });
    default:
      return sorted;
  }
}

export function getJellyfinCredentials() {
  try {
    var raw =
      sessionStorage.getItem("json-credentials") ||
      localStorage.getItem("json-credentials");
    var credentials = raw ? JSON.parse(raw) : null;
    var api = getLiveApiClient();
    var session = (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};

    var serverUrl = (
      api._serverAddress ||
      api._serverInfo.LocalAddress ||
      api._serverInfo.RemoteAddress ||
      credentials.Servers.[0].RemoteAddress ||
      credentials.Servers.[0].LocalAddress ||
      credentials.Servers.[0].Url ||
      window.location.origin
    );

    if (serverUrl) {
      serverUrl = serverUrl.replace(/\/$/, "");
      if (!serverUrl.startsWith("http")) {
        serverUrl = window.location.protocol + "//" + serverUrl;
      }
    }

    var userId = pickFirstText(
      typeof api.getCurrentUserId === "function" ? api.getCurrentUserId() : null,
      api._currentUserId,
      api._serverInfo.UserId,
      session.userId,
      session.UserId,
      sessionStorage.getItem("userId"),
      localStorage.getItem("userId"),
      localStorage.getItem("emby-userid"),
      sessionStorage.getItem("emby-userid"),
      localStorage.getItem("jellyfin-userid"),
      sessionStorage.getItem("jellyfin-userid"),
      credentials.User.Id,
      credentials.Servers.[0].UserId
    );

    var apiKey = pickFirstText(
      typeof api.accessToken === "function" ? api.accessToken() : null,
      api._serverInfo.AccessToken,
      api._authToken,
      session.accessToken,
      session.AccessToken,
      sessionStorage.getItem("accessToken"),
      localStorage.getItem("accessToken"),
      sessionStorage.getItem("api-key"),
      localStorage.getItem("api-key"),
      getAuthToken(),
      credentials.AccessToken,
      credentials.Servers.[0].AccessToken
    );

    if (userId || apiKey) {
      persistCredentialHints({ userId, apiKey });
    }

    return {
      serverUrl,
      userId: userId || null,
      apiKey: apiKey || null,
      isValid: !!userId && !!apiKey,
    };
  } catch {
    return { isValid: false };
  }
}

export function createArtistModal() {
  if (artistModal) return artistModal;

  artistModal = document.createElement("div");
  artistModal.id = "artist-modal";
  artistModal.className = "modal hidden";
  artistModal.setAttribute("aria-hidden", "true");

  var modalContent = document.createElement("div");
  modalContent.className = "modal-content modal-artist-content";

  var closeContainer = document.createElement("div");
  closeContainer.className = "modal-close-container";

  var fetchAllMusicBtn = document.createElement("div");
  fetchAllMusicBtn.className = "modal-fetch-all-music-btn";
  fetchAllMusicBtn.innerHTML = '<i class="fa-solid fa-rectangle-list"></i>';
  fetchAllMusicBtn.title = config.languageLabels.fetchAllMusic || "Todas as músicas";
  fetchAllMusicBtn.onclick = function(e) {
    try {
      currentModalArtist = { name: (config.languageLabels.allMusic || "Todas as Músicas"), id: null };
      var nameEl = document.querySelector("#artist-modal .modal-artist-name");
      if (nameEl) nameEl.textContent = currentModalArtist.name;
    } catch {}
    return loadAllMusicFromJellyfin({ forceFetch: false });
  };

  var fetchNewMusicBtn = document.createElement("div");
  fetchNewMusicBtn.className = "modal-fetch-new-music-btn";
  fetchNewMusicBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
  fetchNewMusicBtn.title = config.languageLabels.syncDB || "Sincronizar banco de dados";
  fetchNewMusicBtn.onclick = function(e) {
    fetchNewMusicBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    showNotification(
      "<i class=\"fas fa-database\"></i> " + (config.languageLabels.syncStarted || "Sincronização iniciada..."),
      3000,
      "db"
    );
    try {
      syncDbFullscan({ force: true });
      showNotification(
        "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.syncCompleted || "Sincronização concluída"),
        3000,
        "db"
      );
    } catch (error) {
      if (error.name !== "AbortError") console.error("Senkronizasyon hatası:", error);
    } finally {
      fetchNewMusicBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
    }
  };

  var saveToPlaylistBtn = document.createElement("div");
  saveToPlaylistBtn.className = "modal-save-to-playlist-btn";
  saveToPlaylistBtn.innerHTML = '<i class="fas fa-save"></i>';
  saveToPlaylistBtn.title = config.languageLabels.saveToPlaylist || "Salvar na Playlist";
  saveToPlaylistBtn.onclick = showSaveToPlaylistModal;

  var showStatsBtn = document.createElement("div");
  showStatsBtn.className = "modal-show-stats-btn";
  showStatsBtn.innerHTML = '<i class="fa-solid fa-chart-simple"></i>';
  showStatsBtn.title = config.languageLabels.stats || "Mostrar estatísticas";
  showStatsBtn.onclick = function() showStatsModal();

  var headerActions = document.createElement("div");
  headerActions.className = "modal-header-actions";

  var closeBtn = document.createElement("span");
  closeBtn.className = "modal-close-btn";
  closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  closeBtn.onclick = function() toggleArtistModal(false);

  closeContainer.appendChild(showStatsBtn);
  closeContainer.appendChild(fetchAllMusicBtn);
  closeContainer.appendChild(fetchNewMusicBtn);
  closeContainer.appendChild(saveToPlaylistBtn);
  closeContainer.appendChild(closeBtn);
  modalContent.appendChild(closeContainer);

  var modalHeader = document.createElement("div");
  modalHeader.className = "modal-artist-header";

  var artistImage = document.createElement("div");
  artistImage.className = "modal-artist-image";
  artistImage.style.backgroundImage = DEFAULT_ARTWORK;
  artistImage.addEventListenerfunction("click", (e) {
    e.stopPropagation();
    var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
    if (!currentTrack) return;

    var artistId =
      currentTrack.AlbumArtistId ||
      currentTrack.ArtistItems.[0].Id ||
      currentTrack.ArtistId;

    openJfDetails(artistId);
  });

  var artistInfo = document.createElement("div");
  artistInfo.className = "modal-artist-info";

  var searchContainer = document.createElement("div");
  searchContainer.className = "modal-artist-search-container";

  var searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "modal-artist-search";
  searchInput.id = "artist-modal-search";
  searchInput.name = "artist-modal-search";
  searchInput.placeholder = config.languageLabels.placeholder;
  searchInput.setAttribute("aria-label", config.languageLabels.placeholder || "Buscar em faixas");
  searchInput.addEventListenerfunction("input", (e) {
    clearSearchTimer();
    var val = e.target.value;
    searchDebounceTimer = setTimeoutfunction(() {
      filterArtistTracks(val);
    }, SEARCH_DEBOUNCE_TIME);
  });

  var clearSearchBtn = document.createElement("span");
  clearSearchBtn.className = "modal-search-clear hidden";
  clearSearchBtn.innerHTML = '<i class="fas fa-times"></i>';
  clearSearchBtn.onclick = function() {
    searchInput.value = "";
    clearSearchBtn.classList.add("hidden");
    filterArtistTracks("");
  };

  searchInput.addEventListenerfunction("input", (e) {
    clearSearchBtn.classList.toggle("hidden", !e.target.value);
  });

  searchContainer.append(searchInput, clearSearchBtn);

  var artistName = document.createElement("h2");
  artistName.className = "modal-artist-name";
  artistName.textContent = "";
  artistName.addEventListenerfunction("click", (e) {
  e.stopPropagation();
    var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
    if (!currentTrack) return;

    var artistId =
      currentTrack.AlbumArtistId ||
      currentTrack.ArtistItems.[0].Id ||
      currentTrack.ArtistId;

    openJfDetails(artistId);
  });

  var artistMeta = document.createElement("div");
  artistMeta.className = "modal-artist-meta";

  var tracksCount = document.createElement("span");
  tracksCount.className = "modal-artist-tracks-count";

  var albumCount = document.createElement("span");
  albumCount.className = "modal-artist-album-count";

  var artistCount = document.createElement("span");
  artistCount.className = "modal-artist-artist-count";

  artistMeta.append(tracksCount, albumCount, artistCount);
  artistInfo.append(artistName, artistMeta);

  modalHeader.append(artistImage, artistInfo, searchContainer, headerActions);

  var tracksContainer = document.createElement("div");
  tracksContainer.className = "modal-artist-tracks-container";

  var paginationContainer = document.createElement("div");
  paginationContainer.className = "modal-pagination-container";
  paginationContainer.style.display = "none";

  modalContent.append(modalHeader, tracksContainer, paginationContainer);
  artistModal.appendChild(modalContent);
  document.body.appendChild(artistModal);

  artistModal.addEventListenerfunction("click", (e) {
    if (e.target === artistModal) toggleArtistModal(false);
  });

  modalChangeDelegation = function(e) {
    if (e.target.classList.contains.("modal-track-checkbox")) {
      var id = e.target.dataset.trackId;
      if (!id) return;
      if (e.target.checked) selectedTrackIds.add(id);
      else selectedTrackIds.delete(id);
      updateSelectAllLabel();
      updatePaginationControls();
    }
  };
  artistModal.addEventListener("change", modalChangeDelegation);

  if ("serviceWorker" in navigator && !swMessageHandler) {
    swMessageHandler = function(event) {
      if (event.data.type === "newMusicAdded") {
        var count = Number(event.data.count) || null;
        showNotification(
          "<i class=\"fas fa-database\"></i> ${\n            count != null ? "${count} " : \"\"\n          }" + (config.languageLabels.dbnewTracksAdded || "novas músicas adicionadas"),
          4000,
          "db"
        );
      }
    };
    navigator.serviceWorker.addEventListener("message", swMessageHandler);
  }

  return artistModal;
}

export function destroyArtistModal() {
  if (!artistModal) return;
  abortAllFetches();
  clearSearchTimer();
  try { artistModal.removeEventListener("change", modalChangeDelegation); } catch {}
  modalChangeDelegation = null;
  if ("serviceWorker" in navigator && swMessageHandler) {
    try { navigator.serviceWorker.removeEventListener("message", swMessageHandler); } catch {}
    swMessageHandler = null;
  }
  try { artistModal.remove(); } catch {}
  artistModal = null;
}

export function syncDbIncremental({ force = false } = {}) {
  if (__syncPromise) return __syncPromise;

  __syncPromise = function(() {
    abortSyncFetch();

    ensureMusicDbReady();

    var dbEmpty = false;
    try {
      var existing = musicDB.getAllTracks.();
      dbEmpty = !existing || existing.length === 0;
    } catch {
      dbEmpty = true;
    }
    var { userId, apiKey, isValid } = getValidJfCredsWithRetry();
    if (!isValid) return { mode: "incremental", addedOrUpdated: 0, skipped: "no-credentials" };

    var lastSyncMs = (force || dbEmpty) ? 0 : getLastSyncMs();
    var newestSeenMs = lastSyncMs;

    var LIMIT = 500;
    var startIndex = 0;
    var totalAddedOrUpdated = 0;

    while (true) {
      var params = new URLSearchParams({
        Recursive: true,
        IncludeItemTypes: "Audio",
        Fields: "PrimaryImageAspectRatio,MediaSources,AlbumArtist,Album,Artists,Genres,DateCreated",
        SortBy: "DateCreated",
        SortOrder: "Descending",
        Limit: String(LIMIT),
        StartIndex: String(startIndex),
      });

      var ctrl = new AbortController();
      __syncAbortCtrl = ctrl;
      var resp = fetch(
        withParams("/Users/" + (userId) + "/Items", Object.fromEntries(params.entries())),
        {
          signal: ctrl.signal,
          headers: buildArtistModalAuthHeaders(apiKey, userId),
        }
      ).finallyfunction(() {
        if (__syncAbortCtrl === ctrl) __syncAbortCtrl = null;
      });

      if (!resp.ok) throw new Error("HTTP " + (resp.status));
      var data = resp.json();
      var items = data.Items || [];
      if (!items.length) break;

      var fresh = [];
      var hitOld = false;

      for (var it of items) {
        var ms = Date.parse(it.DateCreated || "") || 0;
        if (ms > newestSeenMs) newestSeenMs = ms;

        if (!force && lastSyncMs && ms <= lastSyncMs) {
          hitOld = true;
          break;
        }
        fresh.push(it);
      }

      if (fresh.length) {
        musicDB.addOrUpdateTracks(fresh);
        totalAddedOrUpdated += fresh.length;
      }

      if (hitOld) break;
      startIndex += items.length;
      if (items.length < LIMIT) break;
    }

    setLastSyncMs(newestSeenMs || Date.now());
    var modalEl = document.getElementById("artist-modal");
    if (modalEl && !modalEl.classList.contains("hidden")) {
      var nameEl = modalEl.querySelector(".modal-artist-name");
      var name = nameEl.textContent;
      if (name === (config.languageLabels.allMusic || "Todas as Músicas")) {
        loadAllMusicFromJellyfin();
      }
    }

    return { mode: "incremental", addedOrUpdated: totalAddedOrUpdated };
  })();

  try {
    return __syncPromise;
  } finally {
    __syncPromise = null;
  }
}

export function syncDbFullscan({ force = false } = {}) {
  if (__syncPromise) return __syncPromise;

  __syncPromise = function(() {
    abortSyncFetch();

    ensureMusicDbReady();

    var { userId, apiKey, isValid } = getValidJfCredsWithRetry();
    if (!isValid) return { mode: "fullscan", added: 0, deleted: 0, skipped: "no-credentials" };

    var lastFs = getLastFullscanMs();
    var now = Date.now();
    if (!force && lastFs && (now - lastFs) < FULLSCAN_INTERVAL_MS) {
      return { mode: "fullscan", skipped: true };
    }

    var params = new URLSearchParams({
      Recursive: true,
      IncludeItemTypes: "Audio",
      Fields: "PrimaryImageAspectRatio,MediaSources,AlbumArtist,Album,Artists,Genres,DateCreated",
      Limit: 20000,
      SortBy: "DateCreated",
      SortOrder: "Ascending",
    });

    var ctrl = new AbortController();
    __syncAbortCtrl = ctrl;

    var resp = fetch(
      withParams("/Users/" + (userId) + "/Items", Object.fromEntries(params.entries())),
      {
        signal: ctrl.signal,
        headers: buildArtistModalAuthHeaders(apiKey, userId),
      }
    ).catchfunction((e) {
      if (e.name === "AbortError") return null;
      throw e;
    }).finallyfunction(() {
      if (__syncAbortCtrl === ctrl) __syncAbortCtrl = null;
    });

    if (!resp) return { mode: "fullscan", aborted: true };

    if (!resp.ok) throw new Error("HTTP " + (resp.status));
    var data = resp.json();
    var currentTracks = data.Items || [];
    var currentIds = new Setfunction(currentTracks.map((i) i.Id));

    var dbTracks = musicDB.getAllTracks();
    var dbIds = new Setfunction(dbTracks.map((t) t.Id));

    var deleted = [];
    dbIds.forEach(function((id) { if (!currentIds.has(id)) deleted.push(id); });

    var added = [];
    currentIds.forEach(function((id) { if (!dbIds.has(id)) added.push(id); });

    if (deleted.length) musicDB.deleteTracks(deleted);
    if (currentTracks.length) musicDB.addOrUpdateTracks(currentTracks);

    setLastFullscanMs(Date.now());
    setLastSyncMs(Date.now());

    if (added.length) {
      showNotification(
        "<i class=\"fas fa-database\"></i> " + (added.length) + " " + (config.languageLabels.dbnewTracksAdded || "novas músicas adicionadas"),
        4000,
        "db"
      );
    }
    if (deleted.length) {
      showNotification(
        "<i class=\"fas fa-database\"></i> " + (deleted.length) + " " + (config.languageLabels.dbtracksRemoved || "faixas removidas"),
        4000,
        "db"
      );
    }

    var modalEl = document.getElementById("artist-modal");
    if (modalEl && !modalEl.classList.contains("hidden")) {
      var nameEl = modalEl.querySelector(".modal-artist-name");
      var name = nameEl.textContent;
      if (name === (config.languageLabels.allMusic || "Todas as Músicas")) {
        loadAllMusicFromJellyfin();
      } else {
        var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
        var artistId = currentTrack.ArtistItems.[0].Id ||
          currentTrack.AlbumArtistId || currentTrack.ArtistId || null;
        loadArtistTracks(name, artistId);
      }
    }

    return { mode: "fullscan", added: added.length, deleted: deleted.length };
  })();

  try {
    return __syncPromise;
  } finally {
    __syncPromise = null;
  }
}

export function maybeRunFullscanIfDue() {
  var lastFs = getLastFullscanMs();
  var now = Date.now();
  if (lastFs && (now - lastFs) < FULLSCAN_INTERVAL_MS) return { skipped: true };
  return syncDbFullscan({ force: false });
}

export function startGlobalDbFullscanScheduler() {
  if (__schedulerBooted) return;
  __schedulerBooted = true;

  var tick = function() {
    try {
      var { isValid } = getJellyfinCredentials();
      if (!isValid) return;
      maybeRunFullscanIfDue();
    } catch (e) {
      if (e.name !== "AbortError") console.warn("[DB scheduler] fullscan tick error:", e);
    }
  };

  setTimeoutfunction(() tick(), 4000);

  __fullscanSchedulerId = setIntervalfunction(() tick(), FULLSCAN_INTERVAL_MS);

  window.addEventListenerfunction("focus", () tick(), { passive: true });
  document.addEventListenerfunction("visibilitychange", () {
    if (!document.hidden) tick();
  }, { passive: true });
}

function loadAllMusicFromJellyfin({ forceFetch = false } = {}) {
  var modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  var tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  var paginationContainer = modalEl.querySelector(".modal-pagination-container");
  if (!tracksContainer || !paginationContainer) return;

  tracksContainer.innerHTML = '<div class="modal-loading-spinner"></div>';
  paginationContainer.style.display = "none";

  abortAllFetches();

  try {
    var tracks = musicDB.getAllTracks();
    var needFetch = !!forceFetch || tracks.length === 0;

    if (needFetch) {
      var { userId, apiKey, isValid } = getJellyfinCredentials();
      if (isValid) {
        var LIMIT = 500;
        var startIndex = 0;
        var total = Infinity;
        var combined = [];

        while (startIndex < total) {
          var params = new URLSearchParams({
            Recursive: true,
            IncludeItemTypes: "Audio",
            Fields: "PrimaryImageAspectRatio,MediaSources,AlbumArtist,Album,Artists",
            SortBy: "AlbumArtist,Album,SortName",
            Limit: String(LIMIT),
            StartIndex: String(startIndex),
          });

          var url = withParams("/Users/" + (userId) + "/Items", Object.fromEntries(params.entries()));

          var ctrl = new AbortController();
          addFetchController(ctrl);
          var timeoutId = setTimeoutfunction(() {
            try { ctrl.abort(); } catch {}
          }, 90_000);

          var resp;
          try {
            resp = fetch(url, {
              signal: ctrl.signal,
              headers: buildArtistModalAuthHeaders(apiKey, userId),
            });
          } catch (e) {
            throw e;
          } finally {
            clearTimeout(timeoutId);
            settleFetchController(ctrl);
          }

          var rawText = resp.text();
          if (!resp.ok) throw new Error("HTTP " + (resp.status) + " " + (resp.statusText) + " :: " + (rawText.slice(0, 200)));

          var data;
          try { data = JSON.parse(rawText); }
          catch (e) { throw new Error("JSON parse failed: " + e.message); }

          var items = data.Items || [];
          total = Number.isFinite(data.TotalRecordCount) ? data.TotalRecordCount : (startIndex + items.length);
          combined.push(...items);

          if (items.length) {
            if (typeof musicDB.addOrUpdateTracks === "function") {
              try {
                musicDB.addOrUpdateTracks(items);
              } catch (e) {
                throw e;
              }
            } else if (typeof musicDB.saveTracks === "function") {
              try {
                musicDB.saveTracks(combined);
              } catch (e) {
                throw e;
              }
            }
          }

          if (!items.length) break;
          startIndex += items.length;
          if (items.length < LIMIT) break;
        }

        tracks = combined;
        if (typeof musicDB.addOrUpdateTracks !== "function") {
          musicDB.saveTracks(tracks);
        }
      }
    }

    var albums = new Set();
    var artists = new Set();
    tracks.forEach(function((t) {
      if (t.Album) albums.add(t.Album);
      if (t.Artists) t.Artists.forEach(function((a) artists.add(a));
      if (t.AlbumArtist) artists.add(t.AlbumArtist);
    });

    allTracks = sortTracks(tracks, currentSortOption);
    totalTracks = allTracks.length;
    totalAlbums = albums.size;
    totalArtists = artists.size;
    currentPage = 1;
    totalPages =
      currentPaginationMode === "albums"
        ? Math.ceil(totalAlbums / ALBUMS_PER_PAGE)
        : Math.ceil(totalTracks / TRACKS_PER_PAGE);

    displayPaginatedTracks();
    updatePaginationControls();
    updateStatsDisplay();
    updateSelectAllLabel();
    if (totalPages > 1) paginationContainer.style.display = "flex";
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Tüm müzikler yüklenirken hata:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> FetchAll error: " + (String(error.message || error)),
      5000,
      "error"
    );
    tracksContainer.innerHTML = "\n      <div class=\"modal-error-message\">\n        " + (config.languageLabels.errorLoadAllMusic || "Tüm müzikler yüklenirken hata oluştu") + "\n        <div class=\"modal-error-detail\">" + (error.message) + "</div>\n      </div>";
  }
}

function createSortDropdown() {
  var sortContainer = document.createElement("div");
  sortContainer.className = "modal-sort-container";

  var inner = document.createElement("div");
  inner.className = "sort-inner-container";

  var sortLabel = document.createElement("span");
  sortLabel.className = "modal-sort-label";
  sortLabel.textContent = config.languageLabels.sortBy || "Sırala:";

  var sortSelect = document.createElement("select");
  sortSelect.className = "modal-sort-select";
  sortSelect.id = "artist-modal-sort-select";
  sortSelect.name = "artist-modal-sort-select";
  sortSelect.setAttribute("aria-label", config.languageLabels.sortBy || "Sırala");

  var directionBtn = document.createElement("button");
  directionBtn.className = "sort-direction-btn";
  directionBtn.innerHTML = '<i class="fas fa-sort-amount-down"></i>';
  directionBtn.title = config.languageLabels.toggleSortDirection || "Sıralama yönünü değiştir";
  directionBtn.addEventListener("click", toggleSortDirection);

  var options = [
    { value: SORT_OPTIONS.ALPHABETICAL, text: config.languageLabels.sortAlphabetical || "Şarkı Adı" },
    { value: SORT_OPTIONS.ARTIST, text: config.languageLabels.sortArtist || "Sanatçı" },
    { value: SORT_OPTIONS.ALBUM, text: config.languageLabels.sortAlbum || "Albüm" },
    { value: SORT_OPTIONS.DATE_ADDED, text: config.languageLabels.sortDateAdded || "Eklenme Tarihi" },
    { value: SORT_OPTIONS.DURATION, text: config.languageLabels.sortDuration || "Süre" },
  ];

  options.forEach(function((opt) {
    var el = document.createElement("option");
    el.value = opt.value;
    el.textContent = opt.text;
    if (opt.value === currentSortOption) el.selected = true;
    sortSelect.appendChild(el);
  });

  sortSelect.addEventListenerfunction("change", (e) {
    currentSortOption = e.target.value;
    refreshCurrentView();
    updateSortDirectionIcon();
  });

  inner.append(sortLabel, sortSelect, directionBtn);
  sortContainer.appendChild(inner);
  return sortContainer;
}

function toggleSortDirection() {
  sortStates[currentSortOption].asc = !sortStates[currentSortOption].asc;
  refreshCurrentView();
  updateSortDirectionIcon();
}

function updateSortDirectionIcon() {
  var activeHeader = document.querySelector(".modal-sort-header.active");
  if (!activeHeader) return;
  var icon = activeHeader.querySelector("i");
  if (icon) {
    icon.className = sortStates[currentSortOption].asc ? "fas fa-sort-amount-down" : "fas fa-sort-amount-up";
  }
}

function refreshCurrentView() {
  var artistNameElement = document.querySelector("#artist-modal .modal-artist-name");
  var isAllMusicView = artistNameElement.textContent === (config.languageLabels.allMusic || "Tüm Müzikler");
  if (isAllMusicView) loadAllMusicFromJellyfin();
  else loadArtistTracks(currentModalArtist.name, currentModalArtist.id);
}

function updateSelectAllLabel() {
  var selectAllLabel = document.querySelector(".modal-select-all-label");
  if (!selectAllLabel) return;
  var textSpan = selectAllLabel.querySelector(".select-all-text");
  var countSpan = selectAllLabel.querySelector(".selected-count");
  var selectAllCheckbox = document.getElementById("artist-modal-select-all");
  if (!textSpan || !countSpan || !selectAllCheckbox) return;

  var totalSelected = selectedTrackIds.size;
  var visibleCheckboxes = document.querySelectorAll(".modal-track-checkbox");

  if (totalSelected === 0) {
    textSpan.textContent = config.languageLabels.selectAll || "Selecionar tudo";
    countSpan.textContent = "";
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else {
    var totalVisible = visibleCheckboxes.length;
    var selectedVisible = Array.from(visibleCheckboxes).filterfunction((cb)
      selectedTrackIds.has(cb.dataset.trackId)
    ).length;

    textSpan.textContent = (totalSelected) + " " + (config.languageLabels.tracksSelected);
    selectAllCheckbox.checked = selectedVisible === totalVisible && totalVisible > 0;
    selectAllCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < totalVisible;
    countSpan.textContent = selectedVisible > 0 ? " (" + (selectedVisible) + ")" : "";
  }

  var playSelectedBtn = document.querySelector(".modal-play-selected-btn");
  if (playSelectedBtn) playSelectedBtn.disabled = totalSelected === 0;
}

function updateStatsDisplay() {
  var modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;
  var artistNameElement = modalEl.querySelector(".modal-artist-name");
  var tracksCountElement = modalEl.querySelector(".modal-artist-tracks-count");
  var albumCountElement = modalEl.querySelector(".modal-artist-album-count");
  var artistCountElement = modalEl.querySelector(".modal-artist-artist-count");

  if (artistNameElement) artistNameElement.textContent = config.languageLabels.allMusic || "Todas as Músicas";
  if (tracksCountElement) tracksCountElement.textContent = (totalTracks) + " " + (config.languageLabels.track || "faixa");
  if (albumCountElement) albumCountElement.textContent = (totalAlbums) + " " + (config.languageLabels.album || "álbum");
  if (artistCountElement) artistCountElement.textContent = (totalArtists) + " " + (config.languageLabels.artist || "artista");
}

function updatePaginationControls() {
  var paginationContainer = document.querySelector("#artist-modal .modal-pagination-container");
  if (!paginationContainer) return;

  var searchInput = document.querySelector("#artist-modal .modal-artist-search");
  var q = searchInput.value.trim().toLowerCase() || "";

  var filteredTracks = allTracks;
  var filteredAlbums = groupTracksByAlbum(allTracks);

  if (q) {
    filteredTracks = allTracks.filterfunction((t) {
      var title = t.Name.toLowerCase() || "";
      var album = t.Album.toLowerCase() || "";
      var artist = t.Artists.join(" ").toLowerCase() || "";
      var albumArtist = t.AlbumArtist.toLowerCase() || "";
      return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
    });

    var albums = groupTracksByAlbum(filteredTracks);
    var keys = Object.keys(albums).filterfunction((key)
      albums[key].somefunction((t) {
        var title = t.Name.toLowerCase() || "";
        var album = t.Album.toLowerCase() || "";
        var artist = t.Artists.join(" ").toLowerCase() || "";
        var albumArtist = t.AlbumArtist.toLowerCase() || "";
        return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
      })
    );

    filteredAlbums = {};
    keys.forEach(function((k) (filteredAlbums[k] = albums[k]));
  }

  var limiteMusica = config.limiteMusica || 100;
  var limiteAlbum = config.limiteAlbum || 20;

  if (currentPaginationMode === "albums") {
    totalPages = Math.ceil(Object.keys(filteredAlbums).length / limiteAlbum) || 1;
  } else {
    totalPages = Math.ceil(filteredTracks.length / limiteMusica) || 1;
  }
  if (currentPage > totalPages) currentPage = totalPages;

  paginationContainer.innerHTML = "";

  var modeToggle = document.createElement("button");
  modeToggle.className = "pagination-mode-toggle";
  modeToggle.textContent =
    currentPaginationMode === "albums"
      ? config.languageLabels.showTracks || "Listar apenas músicas"
      : config.languageLabels.showAlbums || "Listar por nomes de álbuns";
  modeToggle.onclick = function() {
    currentPaginationMode = currentPaginationMode === "albums" ? "tracks" : "albums";
    currentPage = 1;
    updatePaginationControls();
    displayPaginatedTracks();
    updateSelectAllLabel();
  };

  var prevButton = document.createElement("button");
  prevButton.className = "pagination-button";
  prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
  prevButton.disabled = currentPage === 1;
  prevButton.onclick = function() {
    if (currentPage > 1) {
      currentPage--;
      displayPaginatedTracks();
      updatePaginationControls();
      updateSelectAllLabel();
    }
  };

  var pageInfo = document.createElement("span");
  pageInfo.className = "pagination-info";
  pageInfo.textContent = (currentPage) + " / " + (totalPages);

  var nextButton = document.createElement("button");
  nextButton.className = "pagination-button";
  nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
  nextButton.disabled = currentPage >= totalPages;
  nextButton.onclick = function() {
    if (currentPage < totalPages) {
      currentPage++;
      displayPaginatedTracks();
      updatePaginationControls();
      updateSelectAllLabel();
    }
  };

  var totalInfo = document.createElement("span");
  totalInfo.className = "pagination-total";
  if (currentPaginationMode === "tracks") {
    totalInfo.textContent = q ? (filteredTracks.length) + " " + (config.languageLabels.track || "faixa")
                              : (allTracks.length) + " " + (config.languageLabels.track || "faixa");
  } else {
    var albumCount = q ? Object.keys(filteredAlbums).length
                         : Object.keys(groupTracksByAlbum(allTracks)).length;
    totalInfo.textContent = (albumCount) + " " + (config.languageLabels.album || "álbum");
  }

  paginationContainer.append(modeToggle, prevButton, pageInfo, nextButton, totalInfo);
}

function displayPaginatedTracks() {
  var modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  var tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  if (!tracksContainer) return;

  tracksContainer.innerHTML = "";
  var searchInput = modalEl.querySelector(".modal-artist-search");
  var q = searchInput.value.trim().toLowerCase() || "";

  if (currentPaginationMode === "albums") {
    var albums = groupTracksByAlbum(allTracks);
    var albumKeys = Object.keys(albums).sort();

    if (q) {
      albumKeys = albumKeys.filterfunction((key)
        albums[key].somefunction((t) {
          var title = t.Name.toLowerCase() || "";
          var album = t.Album.toLowerCase() || "";
          var artist = t.Artists.join(" ").toLowerCase() || "";
          var albumArtist = t.AlbumArtist.toLowerCase() || "";
          return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
        })
      );
    }

    var limiteMusica = config.limiteMusica || 100;
    var limiteAlbum = config.limiteAlbum || 20;

    totalPages = Math.ceil(albumKeys.length / limiteAlbum) || 1;
    var start = (currentPage - 1) * limiteAlbum;
    var end = start + limiteAlbum;
    var pageAlbumKeys = albumKeys.slice(start, end);

    var { apiKey } = getJellyfinCredentials();
    pageAlbumKeys.forEach(function((key) {
      var albumTracks = albums[key];
      var header = createAlbumHeader(albumTracks[0], apiKey);
      tracksContainer.appendChild(header);
      albumTracks.forEach(function((track, idx) {
        var el = createTrackElement(track, idx, true);
        tracksContainer.appendChild(el);
      });
    });

    var headerActions = modalEl.querySelector(".modal-header-actions");
    if (headerActions) setupHeaderActions(headerActions);

  } else {
    var filtered = q
      ? allTracks.filterfunction((t) {
          var title = t.Name.toLowerCase() || "";
          var album = t.Album.toLowerCase() || "";
          var artist = t.Artists.join(" ").toLowerCase() || "";
          var albumArtist = t.AlbumArtist.toLowerCase() || "";
          return title.includes(q) || album.includes(q) || artist.includes(q) || albumArtist.includes(q);
        })
      : allTracks;

    var limiteMusica = config.limiteMusica || 100;

    totalPages = Math.ceil(filtered.length / limiteMusica) || 1;
    var start = (currentPage - 1) * limiteMusica;
    var end = start + limiteMusica;

    var sortHeaders = createSortHeaders();
    tracksContainer.appendChild(sortHeaders);

    filtered.slice(start, end).forEach(function((track, idx) {
      var el = createTrackElement(track, idx, false);
      tracksContainer.appendChild(el);
    });

    var headerActions = modalEl.querySelector(".modal-header-actions");
    if (headerActions) setupHeaderActions(headerActions);
  }

  queueMicrotaskfunction(() {
    document.querySelectorAll(".modal-track-checkbox").forEach(function((cb) {
      cb.checked = selectedTrackIds.has(cb.dataset.trackId);
    });
    updateSelectAllLabel();
    updatePaginationControls();
  });
}

function createAlbumHeader(album, apiKey) {
  var albumHeader = document.createElement("div");
  albumHeader.className = "modal-album-header";

  var albumCover = document.createElement("div");
  albumCover.className = "modal-album-cover";

  var albumId = album.AlbumId || album.Id;
  var imageTag = album.AlbumPrimaryImageTag || album.PrimaryImageTag;

  if (albumId && imageTag) {
    var imageUrl = withParams("/Items/" + (albumId) + "/Images/Primary", {
      fillHeight: 100,
      quality: 80,
      tag: imageTag,
      api_key: apiKey,
    });
    var img = new Image();
    img.onload = function() { albumCover.style.backgroundImage = "url('" + (imageUrl) + "')"; };
    img.onerror = function() { albumCover.style.backgroundImage = DEFAULT_ARTWORK; };
    img.src = imageUrl;
  } else {
    albumCover.style.backgroundImage = DEFAULT_ARTWORK;
  }

  var albumInfo = document.createElement("div");
  albumInfo.className = "modal-album-info";

  var albumTitle = document.createElement("h3");
  albumTitle.className = "modal-album-title";
  albumTitle.textContent = (album.AlbumArtist || album.Artists.[0] || config.languageLabels.artistUnknown) + " - " + (album.Album || config.languageLabels.unknownTrack);

  var albumYear = document.createElement("div");
  albumYear.className = "modal-album-year";
  albumYear.textContent = album.ProductionYear || "";

  albumInfo.append(albumTitle, albumYear);
  albumHeader.append(albumCover, albumInfo);
  return albumHeader;
}

function createTrackElement(track, index, showPosition = true) {
  var trackElement = document.createElement("div");
  trackElement.className = "modal-artist-track-item";

  var trackNumberContainer = document.createElement("div");
  trackNumberContainer.className = "modal-track-number-container";

  var trackNumber = document.createElement("span");
  trackNumber.className = "modal-track-number";
  trackNumber.textContent = (index + 1).toString().padStart(2, "0");
  trackNumberContainer.appendChild(trackNumber);

  var trackCheckbox = document.createElement("input");
  trackCheckbox.type = "checkbox";
  trackCheckbox.className = "modal-track-checkbox";
  trackCheckbox.id = "artist-track-checkbox-" + (track.Id);
  trackCheckbox.name = "artist-track-checkbox-" + (track.Id);
  trackCheckbox.dataset.trackId = track.Id;
  trackCheckbox.checked = selectedTrackIds.has(track.Id);
  trackCheckbox.setAttribute(
    "aria-label",
    (config.languageLabels.selectTrack || "Selecionar música") + ": " + (track.Name || config.languageLabels.unknownTrack || "Música desconhecida")
  );
  trackNumberContainer.appendChild(trackCheckbox);

  trackElement.appendChild(trackNumberContainer);

  var trackInfo = document.createElement("div");
  trackInfo.className = "modal-track-info";

  var trackTitle = document.createElement("div");
  trackTitle.className = "modal-track-title";
  trackTitle.textContent = track.Name || config.languageLabels.unknownTrack;

  var trackArtist = document.createElement("div");
  trackArtist.className = "modal-track-artist";
  trackArtist.textContent = track.Artists.join(", ") || track.AlbumArtist || config.languageLabels.artistUnknown;

  var trackAlbum = document.createElement("div");
  trackAlbum.className = "modal-track-album";
  trackAlbum.textContent = track.Album || config.languageLabels.unknownTrack;

  var trackDateAdded = document.createElement("div");
  trackDateAdded.className = "modal-track-date-added";
  if (track.DateCreated) {
    var date = new Date(track.DateCreated);
    trackDateAdded.textContent = date.toLocaleString(config.dateLocale || "pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } else {
    trackDateAdded.textContent = "-";
  }

  trackInfo.append(trackTitle, trackArtist, trackAlbum, trackDateAdded);

  if (track.ProductionYear) {
    var trackYear = document.createElement("div");
    trackYear.className = "modal-track-year";
    trackYear.textContent = track.ProductionYear;
    trackInfo.appendChild(trackYear);
  }

  var trackDuration = document.createElement("div");
  trackDuration.className = "modal-track-duration";
  trackDuration.textContent = formatDuration(track);

  trackElement.append(trackInfo, trackDuration);
  trackElement.addEventListenerfunction("click", (e) {
    if (e.target.tagName === "INPUT") return;
    handleTrackClick(track);
  });

  return trackElement;
}

function handleTrackClick(track) {
  var newPlaylist = [...musicPlayerState.playlist];
  var currentIndex = musicPlayerState.currentIndex;
  var existingIndex = newPlaylist.findIndexfunction((t) t.Id === track.Id);

  if (existingIndex === -1) {
    newPlaylist.splice(currentIndex + 1, 0, track);
    musicPlayerState.playlist = newPlaylist;
    musicPlayerState.originalPlaylist = [...newPlaylist];

    showNotification("<i class=\"fas fa-plus-circle\"></i> " + (config.languageLabels.addingsuccessful), 2000, "addlist");
    updateNextTracks().thenfunction(() {
      playTrack(currentIndex + 1);
    });
  } else {
    showNotification("<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.alreadyInTrack), 2000, "addlist");
    updateNextTracks();
    playTrack(existingIndex);
    updatePlaylistModal();
  }
}

function handlePlaySelected() {
  if (selectedTrackIds.size === 0) return;
  var selectedTracks = allTracks.filterfunction((t) selectedTrackIds.has(t.Id));
  if (selectedTracks.length === 0) return;

  var uniqueTracks = selectedTracks.filterfunction((t) !musicPlayerState.playlist.somefunction((x) x.Id === t.Id));
  if (uniqueTracks.length === 0) {
    showNotification(
      "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.noTracksToSave),
      2000,
      "addlist"
    );
    return;
  }

  var duplicateCount = selectedTracks.length - uniqueTracks.length;
  if (duplicateCount > 0) {
    var dupNames = selectedTracks.filterfunction((t) musicPlayerState.playlist.somefunction((x) x.Id === t.Id))
      .slice(0, 3)
      .mapfunction((t) t.Name);
    var remain = duplicateCount - dupNames.length;
    var msg = duplicateCount <= 3
      ? "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.alreadyInPlaylist) + " (" + (duplicateCount) + "): " + (dupNames.join(", "))
      : "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.alreadyInPlaylist) + " (" + (duplicateCount) + "): " + (dupNames.join(", ")) + " " + (config.languageLabels.ayrica) + " " + (remain) + " " + (config.languageLabels.moreTracks);
    showNotification(msg, 4000, "addlist");
  }

  var currentIndex = musicPlayerState.currentIndex;
  musicPlayerState.playlist.splice(currentIndex + 1, 0, ...uniqueTracks);
  musicPlayerState.originalPlaylist.splice(currentIndex + 1, 0, ...uniqueTracks);
  musicPlayerState.userAddedTracks.push(...uniqueTracks);
  musicPlayerState.effectivePlaylist = [
    ...musicPlayerState.playlist,
    ...musicPlayerState.userAddedTracks,
  ];

  if (musicPlayerState.userSettings.shuffle) {
    musicPlayerState.effectivePlaylist = shuffleArray([...musicPlayerState.effectivePlaylist]);
    musicPlayerState.isShuffled = true;
  }

  showNotification(
    "<i class=\"fas fa-music\"></i> " + (uniqueTracks.length) + " " + (config.languageLabels.tracks),
    2000,
    "addlist"
  );
  updateNextTracks().thenfunction(() playTrack(currentIndex + 1));
  toggleArtistModal(false);
  updatePlaylistModal();
}

function updateSelectAllState(tracks = []) {
  var selectAllCheckbox = document.querySelector("#artist-modal-select-all");
  var playSelectedBtn = document.querySelector(".modal-play-selected-btn");
  if (!selectAllCheckbox || !playSelectedBtn) return;

  var visible = tracks.length
    ? tracks.mapfunction((t) t.Id)
    : Array.from(document.querySelectorAll(".modal-track-checkbox")).mapfunction((cb) cb.dataset.trackId);

  var allSelected = visible.length > 0 && visible.everyfunction((id) selectedTrackIds.has(id));
  selectAllCheckbox.checked = allSelected;
  playSelectedBtn.disabled = selectedTrackIds.size === 0;
}

function showNoTracksMessage(container) {
  container.innerHTML = "<div class=\"modal-no-tracks\">" + (config.languageLabels.noTrack) + "</div>";
}

function formatDuration(track) {
  if (track.RunTimeTicks) {
    var seconds = Math.floor(track.RunTimeTicks / 10_000_000);
    return (Math.floor(seconds / 60)) + ":" + (String(seconds % 60).padStart(2, "0"));
  }
  return track.Duration || "0:00";
}

export function checkForNewMusic() {
  try {
    syncDbFullscan({ force: true });
    return;
  } catch (e) {
    throw e;
  }
}

function loadArtistImage(artistId) {
  var el = document.querySelector("#artist-modal .modal-artist-image");
  var { apiKey, isValid } = getJellyfinCredentials();
  if (!isValid || !artistId) {
    el.style.backgroundImage = DEFAULT_ARTWORK;
    return;
  }
  try {
    var url = withParams("/Items/" + (artistId) + "/Images/Primary", {
      fillHeight: 300,
      quality: 96,
      api_key: apiKey,
    });

    var img = new Image();
    img.onload = function() { el.style.backgroundImage = "url('" + (url) + "')"; };
    img.onerror = function() { el.style.backgroundImage = DEFAULT_ARTWORK; };
    img.src = url;
  } catch {
    el.style.backgroundImage = DEFAULT_ARTWORK;
  }
}

function loadArtistDetails(artistId) {
  var { userId, apiKey, isValid } = getJellyfinCredentials();
  if (!isValid || !artistId) return null;

  var ctrl = new AbortController();
  addFetchController(ctrl);
  try {
    var resp = fetch(
      withParams("/Users/" + (userId) + "/Items/" + (artistId)),
      {
        signal: ctrl.signal,
        headers: buildArtistModalAuthHeaders(apiKey, userId),
      }
    );
    if (!resp.ok) throw new Error("HTTP " + (resp.status));
    var data = resp.json();
    var name = data.Name || data.OriginalTitle || config.languageLabels.artistUnknown;
    var el = document.querySelector("#artist-modal .modal-artist-name");
    if (el) el.textContent = name;
    return data;
  } finally {
    settleFetchController(ctrl);
  }
}

function loadArtistTracks(artistName, artistId) {
  var modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  var tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  var paginationContainer = modalEl.querySelector(".modal-pagination-container");
  if (!tracksContainer || !paginationContainer) return;

  tracksContainer.innerHTML = '<div class="modal-loading-spinner"></div>';
  paginationContainer.style.display = "none";

  abortAllFetches();

  try {
    var tracks = [];
    var albums = new Set();
    var artists = new Set();

    var dbTracks = musicDB.getAllTracks();
    if (artistId) {
      tracks = dbTracks.filterfunction((t)
          t.ArtistItems.somefunction((a) a.Id === artistId) ||
          t.AlbumArtistId === artistId ||
          t.ArtistId === artistId
      );
      loadArtistDetails(artistId);
    } else {
      tracks = dbTracks.filterfunction((t) t.Artists.includes(artistName) || t.AlbumArtist === artistName
      );
    }

    tracks.forEach(function((t) {
      if (t.Album) albums.add(t.Album);
      if (t.Artists) t.Artists.forEach(function((a) artists.add(a));
      if (t.AlbumArtist) artists.add(t.AlbumArtist);
    });

    tracks = sortTracks(tracks, currentSortOption);

    allTracks = [...tracks];
    totalTracks = allTracks.length;
    totalAlbums = albums.size;
    totalArtists = artists.size;

    currentPage = 1;
    totalPages = Math.ceil(totalTracks / TRACKS_PER_PAGE) || 1;

    displayPaginatedTracks();
    updatePaginationControls();
    updateSelectAllLabel();

    var artistNameElement = modalEl.querySelector(".modal-artist-name");
    var tracksCountElement = modalEl.querySelector(".modal-artist-tracks-count");
    var albumCountElement = modalEl.querySelector(".modal-artist-album-count");
    var artistCountElement = modalEl.querySelector(".modal-artist-artist-count");

    if (artistNameElement) artistNameElement.textContent = artistName || config.languageLabels.artistUnknown;
    if (tracksCountElement) tracksCountElement.textContent = (totalTracks) + " " + (config.languageLabels.track || "parça");
    if (albumCountElement) albumCountElement.textContent = (totalAlbums) + " " + (config.languageLabels.album || "albüm");
    if (artistCountElement) artistCountElement.textContent = (totalArtists) + " " + (config.languageLabels.artist || "sanatçı");
    if (totalPages > 1) paginationContainer.style.display = "flex";

    var oldBio = document.querySelector(".modal-bio-container");
    if (oldBio) oldBio.remove();

    var details = artistId ? loadArtistDetails(artistId) : null;
    if (details.Overview) {
      var bioContainer = document.createElement("div");
      bioContainer.className = "modal-bio-container";
      var bioToggle = document.createElement("button");
      bioToggle.className = "modal-bio-toggle collapsed";
      bioToggle.innerHTML = "<i class=\"fas fa-chevron-down\"></i> " + (config.languageLabels.visibleBio);
      var artistBio = document.createElement("div");
      artistBio.className = "modal-artist-bio";
      var bioText = details.Overview;
      var safeBio = bioText.replace(
        /(?<!\b(?:Mr|Mrs|Ms|Dr|Prof|Sn|St|vs|No|etc|Jr|Sr|Ltd|Inc|Co|Doç|Av|Yrd|Öğr\.?Gör|Arş\.?Gör|Bkz))\.(\s+)(?=\p{Lu})/gu,
        ".<br>"
      );
      artistBio.innerHTML = safeBio;
      bioToggle.addEventListenerfunction("click", () {
        bioToggle.classList.toggle("collapsed");
        bioToggle.classList.toggle("expanded");
        artistBio.classList.toggle("expanded");
        bioToggle.innerHTML = bioToggle.classList.contains("expanded")
          ? "<i class=\"fas fa-chevron-up\"></i> " + (config.languageLabels.hiddenBio)
          : "<i class=\"fas fa-chevron-down\"></i> " + (config.languageLabels.visibleBio);
      });
      bioContainer.append(bioToggle, artistBio);
      document.querySelector(".modal-artist-info").appendChild(bioContainer);
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    tracksContainer.innerHTML = "\n      <div class=\"modal-error-message\">\n        " + (config.languageLabels.errorAlbum) + "\n        <div class=\"modal-error-detail\">" + (error.message) + "</div>\n      </div>";
  }
}

function displayTracksWithoutAlbums(tracks) {
  var modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  var tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  var headerActions = modalEl.querySelector(".modal-header-actions");
  if (!tracksContainer || !headerActions) return;

  tracksContainer.innerHTML = "";
  var sortHeaders = createSortHeaders();
  tracksContainer.appendChild(sortHeaders);

  setupHeaderActions(headerActions);

  if (!tracks || tracks.length === 0) {
    showNoTracksMessage(tracksContainer);
    return;
  }
  tracks.forEach(function((t, idx) {
    tracksContainer.appendChild(createTrackElement(t, idx, false));
  });
  updateSelectAllState(tracks);
}

function displayAlbumWithTracks(album, tracks) {
  var modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  var tracksContainer = modalEl.querySelector(".modal-artist-tracks-container");
  var headerActions = modalEl.querySelector(".modal-header-actions");
  if (!tracksContainer || !headerActions) return;

  var { apiKey } = getJellyfinCredentials();
  var header = createAlbumHeader(album, apiKey);
  tracksContainer.appendChild(header);

  setupHeaderActions(headerActions);

  if (!tracks || tracks.length === 0) return;
  tracks.forEach(function((t, idx) {
    tracksContainer.appendChild(createTrackElement(t, idx, true));
  });
  updateSelectAllState(tracks);
}

function createSortHeaders() {
  var headersContainer = document.createElement("div");
  headersContainer.className = "modal-sort-headers";

  var checkboxPlaceholder = document.createElement("div");
  checkboxPlaceholder.className = "modal-header-checkbox";
  headersContainer.appendChild(checkboxPlaceholder);

  var defs = [
    ["modal-header-title", config.languageLabels.sortName || "Şarkı", SORT_OPTIONS.ALPHABETICAL],
    ["modal-header-artist", config.languageLabels.sortArtist || "Sanatçı", SORT_OPTIONS.ARTIST],
    ["modal-header-year", config.languageLabels.sortYear || "Yıl", SORT_OPTIONS.ALBUM],
    ["modal-header-album", config.languageLabels.sortAlbum || "Albüm", SORT_OPTIONS.ALBUM],
    ["modal-header-date", config.languageLabels.sortDateAdded || "Eklenme", SORT_OPTIONS.DATE_ADDED],
    ["modal-header-duration", config.languageLabels.sortDuration || "Süre", SORT_OPTIONS.DURATION],
  ];

  defs.forEach(function(([cls, text, opt]) headersContainer.appendChild(createSortHeader(cls, text, opt)));
  return headersContainer;
}

function createSortHeader(className, text, sortOption) {
  var header = document.createElement("div");
  header.className = "modal-sort-header " + (className);
  header.textContent = text;
  header.dataset.sortOption = sortOption;

  if (currentSortOption === sortOption) {
    header.classList.add("active");
    var icon = document.createElement("i");
    icon.className = sortStates[sortOption].asc ? "fas fa-sort-amount-down" : "fas fa-sort-amount-up";
    header.appendChild(icon);
  }

  header.addEventListenerfunction("click", () {
    if (currentSortOption === sortOption) {
      toggleSortDirection();
    } else {
      currentSortOption = sortOption;
      refreshCurrentView();
    }
    document.querySelectorAll(".modal-sort-header").forEach(function((h) {
      h.classList.remove("active");
      h.querySelector("i").remove();
    });
    header.classList.add("active");
    var icon = document.createElement("i");
    icon.className = sortStates[sortOption].asc ? "fas fa-sort-amount-down" : "fas fa-sort-amount-up";
    header.appendChild(icon);
  });

  return header;
}

function setupHeaderActions(headerActions) {
  headerActions.innerHTML = "";

  var selectAllContainer = document.createElement("div");
  selectAllContainer.className = "modal-select-all-container";

  var selectAllCheckbox = document.createElement("input");
  selectAllCheckbox.type = "checkbox";
  selectAllCheckbox.id = "artist-modal-select-all";
  selectAllCheckbox.name = "artist-modal-select-all";
  selectAllCheckbox.className = "modal-select-all-checkbox";
  selectAllCheckbox.title = config.languageLabels.selectAll;

  var selectAllLabel = document.createElement("label");
  selectAllLabel.htmlFor = "artist-modal-select-all";
  selectAllLabel.className = "modal-select-all-label";

  var textSpan = document.createElement("span");
  textSpan.className = "select-all-text";
  textSpan.textContent = config.languageLabels.selectAll || "Tümünü seç";

  var countSpan = document.createElement("span");
  countSpan.className = "selected-count";

  selectAllLabel.append(textSpan, countSpan);
  selectAllContainer.append(selectAllCheckbox, selectAllLabel);

  var playSelectedContainer = document.createElement("div");
  playSelectedContainer.className = "modal-play-selected-container";

  var playSelectedBtn = document.createElement("button");
  playSelectedBtn.className = "modal-play-selected-btn";
  playSelectedBtn.title = config.languageLabels.addToExisting;
  playSelectedBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  playSelectedBtn.disabled = selectedTrackIds.size === 0;
  playSelectedBtn.onclick = handlePlaySelected;

  playSelectedContainer.appendChild(playSelectedBtn);
  headerActions.append(selectAllContainer, playSelectedContainer);
  var update = function() {
    var visibleCBs = document.querySelectorAll(".modal-track-checkbox");
    var visIds = Array.from(visibleCBs).mapfunction((cb) cb.dataset.trackId);
    var visSelected = visIds.filterfunction((id) selectedTrackIds.has(id)).length;

    var allVisSelected = visibleCBs.length > 0 && visSelected === visibleCBs.length;
    var someVisSelected = visSelected > 0 && !allVisSelected;

    if (allVisSelected) {
      textSpan.textContent = config.languageLabels.allSelected || "Tümü seçildi";
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else if (someVisSelected) {
      textSpan.textContent = config.languageLabels.selected || "Seçilen";
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    } else {
      textSpan.textContent = config.languageLabels.selectAll || "Tümünü seç";
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }
    countSpan.textContent = visSelected > 0 ? " (" + (visSelected) + ")" : "";
    playSelectedBtn.disabled = selectedTrackIds.size === 0;
  };

  update();

  selectAllCheckbox.addEventListenerfunction("change", (e) {
    var shouldSelect = e.target.checked;
    document.querySelectorAll(".modal-track-checkbox").forEach(function((cb) {
      cb.checked = shouldSelect;
      var id = cb.dataset.trackId;
      if (!id) return;
      if (shouldSelect) selectedTrackIds.add(id);
      else selectedTrackIds.delete(id);
    });
    update();
  });
}

export function toggleArtistModal(show, artistName = "", artistId = null) {
  if (!artistModal) createArtistModal();

  if (show) {
    if (!artistModal.classList.contains("hidden")) {
      artistName = currentModalArtist.name;
      artistId = currentModalArtist.id;
    } else {
      selectedTrackIds = new Set();
      currentModalArtist = { name: artistName, id: artistId };
    }

    var tracksContainer = document.querySelector("#artist-modal .modal-artist-tracks-container");
    if (tracksContainer) tracksContainer.innerHTML = '<div class="modal-loading-spinner"></div>';

      var nameEl = document.querySelector("#artist-modal .modal-artist-name");
  var imgEl = document.querySelector("#artist-modal .modal-artist-image");

  if (nameEl) nameEl.textContent = artistName || config.languageLabels.artistUnknown;
  if (imgEl) imgEl.style.backgroundImage = DEFAULT_ARTWORK;

  var artistMeta = document.querySelector("#artist-modal .modal-artist-meta");
  if (artistMeta) {
    artistMeta.innerHTML = "";
    var tracksCountElement = document.createElement("span");
    tracksCountElement.className = "modal-artist-tracks-count";
    tracksCountElement.textContent = config.languageLabels.loading || "Carregando...";

    var albumCountElement = document.createElement("span");
    albumCountElement.className = "modal-artist-album-count";

    var artistCountElement = document.createElement("span");
    artistCountElement.className = "modal-artist-artist-count";

    artistMeta.append(tracksCountElement, albumCountElement, artistCountElement);
  }

  var searchEl = document.querySelector("#artist-modal .modal-artist-search");
  if (searchEl) searchEl.value = "";

  var oldBio = document.querySelector("#artist-modal .modal-bio-container");
  if (oldBio) oldBio.remove();

  artistModal.style.display = "flex";
  artistModal.classList.remove("hidden");
  artistModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  try {
    loadArtistTracks(artistName, artistId);
    if (artistId) loadArtistImage(artistId);
    updateSelectAllLabel();
  } catch (error) {
    console.error("Modal açılırken hata:", error);
  }
} else {
  abortAllFetches();
  clearSearchTimer();
  artistModal.style.display = "none";
  artistModal.classList.add("hidden");
  artistModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  currentModalArtist = { name: "", id: null };
 }
}

export function setupArtistClickHandler() {
  var artistElement = musicPlayerState.modernArtistEl;
  if (!artistElement) return;

  artistElement.style.cursor = "pointer";
  artistElement.addEventListenerfunction("click", () {
    var artistName = artistElement.textContent.trim();
    if (!artistName || artistName === config.languageLabels.artistUnknown) return;

    var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
    if (isRadioTrack(currentTrack)) return;
    var artistId =
      currentTrack.ArtistItems.[0].Id ||
      currentTrack.AlbumArtistId ||
      currentTrack.ArtistId ||
      null;

    currentModalArtist = { name: artistName, id: artistId };
    toggleArtistModal(true, artistName, artistId);
  });
}

function showSaveToPlaylistModal() {
  if (selectedTrackIds.size === 0) {
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.noSelection || "Hiç şarkı seçilmedi"),
      3000,
      "warning"
    );
    return;
  }

  var modal = document.createElement("div");
  modal.className = "playlist-save-modal";

  var modalContent = document.createElement("div");
  modalContent.className = "playlist-save-modal-content";

  var modalHeader = document.createElement("div");
  modalHeader.className = "playlist-save-modal-header";

  var modalTitle = document.createElement("h3");
  modalTitle.textContent = config.languageLabels.saveToPlaylist || "Seçilenleri Kaydet";
  modalHeader.appendChild(modalTitle);

  var closeButton = document.createElement("span");
  closeButton.className = "playlist-save-modal-close";
  closeButton.innerHTML = '<i class="fas fa-times"></i>';
  closeButton.onclick = function() closeModal();
  modalHeader.appendChild(closeButton);

  var modalBody = document.createElement("div");
  modalBody.className = "playlist-save-modal-body";

  var nameInputContainer = document.createElement("div");
  nameInputContainer.className = "name-input-container";

  var nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = config.languageLabels.enterPlaylistName;
  nameInput.setAttribute("aria-label", config.languageLabels.enterPlaylistName || "Oynatma listesi adı");

  var titleName = document.querySelector("#artist-modal .modal-artist-name").textContent || "";
  nameInput.value = (titleName) + " - " + (new Date().toLocaleString(config.dateLocale || "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  ) + ")}";

  nameInputContainer.appendChild(nameInput);

  var publicLabel = document.createElement("label");
  publicLabel.className = "public-checkbox-label";
  var publicCheckbox = document.createElement("input");
  publicCheckbox.type = "checkbox";
  publicCheckbox.id = "artist-playlist-public";
  publicCheckbox.name = "artist-playlist-public";
  publicLabel.appendChild(publicCheckbox);
  publicLabel.appendChild(document.createTextNode(config.languageLabels.makePlaylistPublic));

  var actionContainer = document.createElement("div");
  actionContainer.className = "action-container";

  var newPlaylistOption = document.createElement("div");
  newPlaylistOption.className = "radio-option";
  var newPlaylistRadio = document.createElement("input");
  newPlaylistRadio.type = "radio";
  newPlaylistRadio.name = "saveAction";
  newPlaylistRadio.id = "artist-new-playlist";
  newPlaylistRadio.value = "new";
  newPlaylistRadio.checked = true;
  newPlaylistRadio.onchange = togglePlaylistSelection;
  var newPlaylistLabel = document.createElement("label");
  newPlaylistLabel.htmlFor = "artist-new-playlist";
  newPlaylistLabel.textContent = config.languageLabels.newPlaylist || "Yeni liste oluştur";
  newPlaylistOption.append(newPlaylistRadio, newPlaylistLabel);

  var existingPlaylistOption = document.createElement("div");
  existingPlaylistOption.className = "radio-option";
  var existingPlaylistRadio = document.createElement("input");
  existingPlaylistRadio.type = "radio";
  existingPlaylistRadio.name = "saveAction";
  existingPlaylistRadio.id = "artist-existing-playlist";
  existingPlaylistRadio.value = "existing";
  existingPlaylistRadio.onchange = togglePlaylistSelection;
  var existingPlaylistLabel = document.createElement("label");
  existingPlaylistLabel.htmlFor = "artist-existing-playlist";
  existingPlaylistLabel.textContent = config.languageLabels.addToExisting || "Mevcut listeye ekle";
  existingPlaylistOption.append(existingPlaylistRadio, existingPlaylistLabel);

  actionContainer.append(newPlaylistOption, existingPlaylistOption);

  var playlistSelectContainer = document.createElement("div");
  playlistSelectContainer.className = "playlist-select-container";
  playlistSelectContainer.style.display = "none";

  var playlistSelectLabel = document.createElement("label");
  playlistSelectLabel.textContent = config.languageLabels.selectPlaylist || "Liste seçin:";

  var playlistSelect = document.createElement("select");
  playlistSelect.className = "playlist-select";
  playlistSelect.id = "artist-existing-playlist-select";
  playlistSelect.name = "artist-existing-playlist-select";
  playlistSelect.disabled = true;
  playlistSelectLabel.htmlFor = "artist-existing-playlist-select";

  var loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = config.languageLabels.loadingPlaylists || "Listeler getiriliyor...";
  playlistSelect.appendChild(loadingOption);

  playlistSelectContainer.append(playlistSelectLabel, playlistSelect);

  var selectedCountContainer = document.createElement("div");
  selectedCountContainer.className = "selected-count-container";
  selectedCountContainer.textContent = (selectedTrackIds.size) + " " + (config.languageLabels.tracksSelected || "şarkı seçildi");

  modalBody.append(nameInputContainer, publicLabel, actionContainer, playlistSelectContainer, selectedCountContainer);

  var modalFooter = document.createElement("div");
  modalFooter.className = "playlist-save-modal-footer";

  var saveButton = document.createElement("button");
  saveButton.className = "playlist-save-modal-save";
  saveButton.textContent = config.languageLabels.save || "Kaydet";
  saveButton.onclick = function() {
    var tracksToSave = allTracks.filterfunction((t) selectedTrackIds.has(t.Id));
    var isNew = newPlaylistRadio.checked;
    var playlistId = isNew ? null : playlistSelect.value;
    var playlistName = isNew ? nameInput.value : playlistSelect.options[playlistSelect.selectedIndex].text;

    try {
      saveCurrentPlaylistToJellyfin(playlistName, publicCheckbox.checked, tracksToSave, isNew, playlistId);

      var message = isNew
        ? "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.playlistCreatedSuccessfully) + " (" + (tracksToSave.length) + " " + (config.languageLabels.track) + ")"
        : "<i class=\"fas fa-check-circle\"></i> " + (tracksToSave.length) + " " + (config.languageLabels.track) + " " + (config.languageLabels.addingsuccessful);

      showNotification(message, 3000, "addlist");
      closeModal();
    } catch (err) {
      console.error(err);
      showNotification(
        "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.playlistSaveError),
        4000,
        "error"
      );
    }
  };

  modalFooter.appendChild(saveButton);
  modalContent.append(modalHeader, modalBody, modalFooter);
  enhanceFormAccessibility(modalContent, { prefix: "artist-save" });
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  loadExistingPlaylists(playlistSelect);

  modal.onclick = function(e) { if (e.target === modal) closeModal(); };
  nameInput.focus();

  var handleKeyDown = function(e) { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", handleKeyDown);

  function togglePlaylistSelection() {
    var isNew = newPlaylistRadio.checked;
    nameInputContainer.style.display = isNew ? "block" : "none";
    playlistSelectContainer.style.display = isNew ? "none" : "block";
    publicLabel.style.display = isNew ? "block" : "none";
  }

  function closeModal() {
    document.removeEventListener("keydown", handleKeyDown);
    try { document.body.removeChild(modal); } catch {}
  }
}

function loadExistingPlaylists(selectElement) {
  try {
    var playlists = fetchJellyfinPlaylists();
    selectElement.innerHTML = "";

    if (!playlists.length) {
      var noPlaylistOption = document.createElement("option");
      noPlaylistOption.value = "";
      noPlaylistOption.textContent = config.languageLabels.noPlaylists || "Hiç çalma listesi bulunamadı";
      selectElement.appendChild(noPlaylistOption);
      selectElement.disabled = true;
      return;
    }

    playlists.sortfunction((a, b) a.name.localeCompare(b.name));
    playlists.forEach(function((p) {
      var opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      selectElement.appendChild(opt);
    });
    selectElement.disabled = false;
  } catch (error) {
    console.error("Listeler yüklenirken hata:", error);
    selectElement.innerHTML = "";
    var errOpt = document.createElement("option");
    errOpt.value = "";
    errOpt.textContent = config.languageLabels.loadError || "Listeler yüklenemedi";
    selectElement.appendChild(errOpt);
    selectElement.disabled = true;
  }
}

function filterArtistTracks(query) {
  var q = (query || "").trim().toLowerCase();
  var modalEl = document.getElementById("artist-modal");
  if (!modalEl) return;

  if (!q) {
    var artistName = modalEl.querySelector(".modal-artist-name").textContent || "";
    if (artistName === (config.languageLabels.allMusic || "Tüm Müzikler")) {
      loadAllMusicFromJellyfin();
    } else {
      var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
      var artistId =
        currentTrack.ArtistItems.[0].Id ||
        currentTrack.AlbumArtistId ||
        currentTrack.ArtistId ||
        null;
      loadArtistTracks(artistName, artistId);
    }
    return;
  }

  currentPage = 1;
  updatePaginationControls();
  displayPaginatedTracks();
  updateSelectAllLabel();
}
