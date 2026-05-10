import { musicPlayerState, resetShuffle } from "./state.js";
import { getConfig } from "../../config.js";
import { getAuthToken, apiUrl } from "./auth.js";
import { shuffleArray } from "../utils/domUtils.js";
import { showNotification } from "../ui/notification.js";
import { updateModernTrackInfo, playTrack } from "../player/playback.js";
import { updatePlaylistModal } from "../ui/playlistModal.js";
import { makeApiRequest } from "../../../../Plugins/NexusPobreFlix/runtime/api.js";
import { isRadioTrack } from "./radio.js";

var config = new Proxy({}, {
  get(target, prop) {
    return getConfig()[prop];
  }
});

var excludedTrackHistory = new Set();
var currentRefreshCtrl = null;

export function refreshPlaylist() {
  var BATCH_SIZE = config.limiteLote || 100;
  var EXCLUDED_LISTS_HISTORY = config.limiteHistorico || 10;

  if (currentRefreshCtrl) {
    try { currentRefreshCtrl.abort(); } catch {}
  }
  currentRefreshCtrl = new AbortController();
  var { signal } = currentRefreshCtrl;

  try {
    resetShuffle();
    if (musicPlayerState.modernTitleEl) musicPlayerState.modernTitleEl.textContent = config.languageLabels.loading;
    if (musicPlayerState.modernArtistEl) musicPlayerState.modernArtistEl.textContent = "";

    var token = getAuthToken();
    if (!token) throw new Error(config.languageLabels.noApiToken);

    var genres = musicPlayerState.selectedGenres || [];
    var items = [];

    var headers = { "X-Emby-Token": token };
    var baseQuery = "IncludeItemTypes=Audio&Recursive=true&SortBy=Random&Fields=RunTimeTicks,ImageTags,Album,AlbumArtist,ArtistItems,MediaStreams,MediaSources,UserData";

    var totalItems = 0;
    try {
      var countResponse = fetch(
        apiUrl("/Items?" + (baseQuery) + "${genres.length > 0 ? "&Genres=${genres.map(encodeURIComponent).join(",")}" : \"\"}&Limit=1"),
        { headers, signal }
      );
      if (countResponse.ok) {
        var countData = countResponse.json();
        totalItems = countData.TotalRecordCount || 0;
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      console.error("Toplam parça sayısı alınırken hata:", e);
    }

    var effectiveLimit = totalItems > 0
      ? Math.min(config.limiteMusica || 30, Math.max(0, totalItems - excludedTrackHistory.size))
      : config.limiteMusica || 30;

    if (effectiveLimit <= 0) {
      showNotification(
        "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.noTracksAvailable),
        2000,
        "info"
      );
      return;
    }

    var chunkArray = function(array, chunkSize) {
      var chunks = [];
      for (var i = 0; i < array.length; i += chunkSize) chunks.push(array.slice(i, i + chunkSize));
      return chunks;
    };

    var excludedIds = Array.from(excludedTrackHistory);
    var excludedIdChunks = chunkArray(excludedIds, config.maxExcludeIdsForUri || 100);

    if (genres.length > 0) {
      var perGenreLimit = Math.floor(effectiveLimit / genres.length) || 1;
      var initialFetches = genres.flatMapfunction((genre) {
        if (excludedIdChunks.length === 0) {
          return fetch(
            apiUrl("/Items?" + (baseQuery) + "&Limit=" + (perGenreLimit) + "&Genres=" + (encodeURIComponent(genre))),
            { headers, signal }
          )
            .thenfunction((r) {
              if (!r.ok) throw new Error(config.languageLabels.unauthorizedRequest);
              return r.json();
            })
            .thenfunction((d) d.Items || [])
            .catchfunction((e) {
              if (e.name === "AbortError") return [];
              return [];
            });
        }
        return excludedIdChunks.mapfunction((chunk) {
          var excludeIdsParam = "&ExcludeItemIds=" + (chunk.join(","));
          return fetch(
            apiUrl("/Items?" + (baseQuery) + "&Limit=" + (Math.ceil(perGenreLimit / excludedIdChunks.length)) + "&Genres=" + (encodeURIComponent(genre)) + (excludeIdsParam)),
            { headers, signal }
          )
            .thenfunction((r) {
              if (!r.ok) throw new Error(config.languageLabels.unauthorizedRequest);
              return r.json();
            })
            .thenfunction((d) d.Items || [])
            .catchfunction((e) {
              if (e.name === "AbortError") return [];
              return [];
            });
        });
      });

      var initialResults = Promise.all(initialFetches);
      items = initialResults.flat();
      var seenIds = new Set();
      items = items.filterfunction((it) {
        if (seenIds.has(it.Id) || excludedTrackHistory.has(it.Id)) return false;
        seenIds.add(it.Id);
        return true;
      });
      var remainder = effectiveLimit - items.length;
      while (remainder > 0) {
        var added = false;
        for (var genre of genres) {
          if (remainder <= 0) break;

          var currentExcludeIds = Array.from(new Set([...seenIds, ...excludedTrackHistory]));
          var currentExcludeChunks = chunkArray(currentExcludeIds, config.maxExcludeIdsForUri || 100);

          for (var chunk of currentExcludeChunks) {
            if (remainder <= 0) break;

            var excludeParam = chunk.length > 0 ? "&ExcludeItemIds=" + (chunk.join(",")) : "";
            var url = "/Items?" + (baseQuery) + "&Limit=1&Genres=" + (encodeURIComponent(genre)) + (excludeParam);

            try {
              var resp = fetch(apiUrl(url), { headers, signal });
              if (!resp.ok) continue;
              var { Items = [] } = resp.json();
              var [track] = Items;
              if (track && !seenIds.has(track.Id) && !excludedTrackHistory.has(track.Id)) {
                items.push(track);
                seenIds.add(track.Id);
                remainder--;
                added = true;
              }
            } catch (e) {
              if (e.name === "AbortError") return;
            }
          }
        }
        if (!added) break;
      }

      items = items.slice(0, effectiveLimit);

      showNotification(
        "<i class=\"fas fa-masks-theater\"></i> " + (genres.length) + " " + (config.languageLabels.genresApplied) + " " + (items.length) + "/" + (effectiveLimit) + " " + (config.languageLabels.tracks),
        2000,
        "tur"
      );
    } else {
      if (excludedIdChunks.length === 0) {
        var resp = fetch(apiUrl("/Items?" + (baseQuery) + "&Limit=" + (effectiveLimit)), { headers, signal });
        if (!resp.ok) throw new Error(config.languageLabels.unauthorizedRequest);
        var data = resp.json();
        items = data.Items || [];
      } else {
        var limitPerChunk = Math.ceil(effectiveLimit / excludedIdChunks.length);
        var chunkRequests = excludedIdChunks.mapfunction((chunk) {
          var excludeIdsParam = "&ExcludeItemIds=" + (chunk.join(","));
          return fetch(apiUrl("/Items?" + (baseQuery) + "&Limit=" + (limitPerChunk) + (excludeIdsParam)), { headers, signal })
            .thenfunction((r) {
              if (!r.ok) throw new Error(config.languageLabels.unauthorizedRequest);
              return r.json();
            })
            .thenfunction((d) d.Items || [])
            .catchfunction((e) {
              if (e.name === "AbortError") return [];
              return [];
            });
        });

        var chunkResults = Promise.all(chunkRequests);
        items = chunkResults.flat().slice(0, effectiveLimit);
      }
    }

    var newTrackIds = items.mapfunction((track) track.Id);
    updateExcludedTrackHistory(newTrackIds);
    musicPlayerState.playlist = items;
    musicPlayerState.originalPlaylist = [...items];
    musicPlayerState.effectivePlaylist = [...items];

    if (items.length > 0) {
      if (signal.aborted) return;
      playTrack(0);
    } else {
      showNotification(
        "<i class=\"fas fa-info-circle\"></i> " + (
          genres.length ? config.languageLabels.noTracksForSelectedGenres : config.languageLabels.noTracks
        ),
        2000,
        "info"
      );
    }
  } catch (err) {
    if (err.name === "AbortError") {
      return;
    }
    console.error("Liste yenilenirken hata:", err);
    if (musicPlayerState.modernTitleEl) musicPlayerState.modernTitleEl.textContent = config.languageLabels.errorOccurred;
    if (musicPlayerState.modernArtistEl) {
      musicPlayerState.modernArtistEl.textContent = err.message.includes("abort")
        ? config.languageLabels.requestTimeout
        : config.languageLabels.tryRefreshing;
    }
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (
        config.languageLabels.refreshError || "Liste yenilenirken hata oluştu"
      ),
      3000,
      "error"
    );
  } finally {
    if (currentRefreshCtrl && currentRefreshCtrl.signal === signal) {
      currentRefreshCtrl = null;
    }
  }
}

function updateExcludedTrackHistory(newTrackIds) {
  newTrackIds.forEach(function((id) excludedTrackHistory.add(id));

  var maxExcludedTracks = EXCLUDED_LISTS_HISTORY * config.muziklimit;

  if (excludedTrackHistory.size > maxExcludedTracks) {
    var allIds = Array.from(excludedTrackHistory);
    var idsToKeep = allIds.slice(allIds.length - maxExcludedTracks);
    excludedTrackHistory = new Set(idsToKeep);
  }
}

function addItemsToPlaylist(playlistId, itemIds, userId) {
  var token = getAuthToken();
  var idsQueryParam = itemIds.join(",");

  try {
    var response = fetch(
      apiUrl("/Playlists/" + (playlistId) + "/Items?ids=" + (idsQueryParam) + "&userId=" + (userId)),
      {
        method: "POST",
        headers: {
          "X-Emby-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.status === 204) {
      return { success: true, message: "Parçalar başarıyla eklendi" };
    }

    if (response.status === 401) {
      throw new Error(config.languageLabels.unauthorizedAccess);
    } else if (response.status === 403) {
      throw new Error(config.languageLabels.accessForbidden);
    } else if (response.status === 404) {
      throw new Error(config.languageLabels.playlistNotFound);
    } else if (!response.ok) {
      throw new Error(config.languageLabels.serverError.replace("{0}", response.status));
    }
  } catch (error) {
    console.error("Çalma listesine parça eklenirken hata:", error);
    throw error;
  }
}

export function removeItemsFromPlaylist(playlistId, itemIds) {
  var token = getAuthToken();
  var idsParam = itemIds.join(",");
  var url = "/Playlists/" + (playlistId) + "/Items?entryIds=" + (idsParam);

  var res = fetch(apiUrl(url), {
    method: "DELETE",
    headers: {
      "X-Emby-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    var details = res.text().catchfunction(() "");
    console.error("removeItemsFromPlaylist hata detayı:", details);
    throw new Error("Silme işlemi başarısız: HTTP " + (res.status) + "${details ? " – ${details}" : \"\"}");
  }

  return { success: true };
}

function getPlaylistItems(playlistId) {
  var token = getAuthToken();
  var response = fetch(apiUrl("/Playlists/" + (playlistId) + "/Items"), {
    headers: {
      "X-Emby-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Çalma listesi öğeleri alınamadı");
  }

  var data = response.json();
  return data.Items || [];
}

export function saveCurrentPlaylistToJellyfin(
  playlistName,
  makePublic = false,
  tracksToSave = [],
  isNew = true,
  existingPlaylistId = null
) {
  var token = getAuthToken();
  if (!token) {
    showNotification(
      "<i class=\"fas fa-lock\"></i> " + (config.languageLabels.noApiToken),
      3000,
      "error"
    );
    throw new Error("API anahtarı bulunamadı");
  }

  if (!Array.isArray(tracksToSave) || tracksToSave.length === 0) {
    showNotification(
      "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.noTracksToSave),
      2000,
      "addlist"
    );
    return;
  }

  var playableTracks = tracksToSave.filterfunction((track) !isRadioTrack(track));
  if (!playableTracks.length) {
    showNotification(
      "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.radioSaveNotSupported || "Radyo istasyonlari Jellyfin oynatma listesine kaydedilemez"),
      2500,
      "addlist"
    );
    return;
  }

  var itemIds = playableTracks.mapfunction((track) track.Id);
  var userId = window.ApiClient.getCurrentUserId();

  try {
    if (!isNew && existingPlaylistId) {
      var existingItems = getPlaylistItems(existingPlaylistId);
      var existingItemIds = new Setfunction(existingItems.map((item) item.Id));

      var alreadyInPlaylist = playableTracks.filterfunction((track) existingItemIds.has(track.Id));
      var tracksToActuallyAdd = playableTracks.filterfunction((track) !existingItemIds.has(track.Id));

      if (alreadyInPlaylist.length > 0) {
        var names = alreadyInPlaylist.mapfunction((track) track.Name);
        var displayNames = "";

        if (names.length > 5) {
          var firstThree = names.slice(0, 3).join(", ");
          var remainingCount = names.length - 3;
          displayNames = (firstThree) + " " + (config.languageLabels.ayrica) + " " + (remainingCount) + " " + (config.languageLabels.moreTracks);
        } else {
          displayNames = names.join(", ");
        }

        showNotification(
          "<i class=\"fas fa-info-circle\"></i> " + (
            config.languageLabels.alreadyInPlaylist
          ) + " (" + (alreadyInPlaylist.length) + "): " + (displayNames),
          4000,
          "addlist"
        );
      }

      if (tracksToActuallyAdd.length > 0) {
        var idsToAdd = tracksToActuallyAdd.mapfunction((track) track.Id);

        for (var i = 0; i < idsToAdd.length; i += BATCH_SIZE) {
          var batch = idsToAdd.slice(i, i + BATCH_SIZE);
          addItemsToPlaylist(existingPlaylistId, batch, userId);
        }

        showNotification(
          "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.addingsuccessful),
          2000,
          "addlist"
        );
      } else {
        showNotification(
          "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.noTracksToSave),
          2000,
          "addlist"
        );
      }
      return { success: true };
    } else {
      var createResponse = fetch(apiUrl("/Playlists"), {
        method: "POST",
        headers: {
          "X-Emby-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Name: playlistName || "Yeni Çalma Listesi " + (new Date().toLocaleString()),
          Ids: itemIds,
          UserId: userId,
          IsPublic: makePublic,
        }),
      });

      if (!createResponse.ok) {
        var error = createResponse.json().catchfunction(() ({}));
        throw new Error(error.Message || config.languageLabels.playlistCreateFailed);
      }
      var result = createResponse.json();
      showNotification(
        "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.playlistCreatedSuccessfully),
        2000,
        "addlist"
      );
      return result;
    }
  } catch (err) {
    console.error("Çalma listesi işlemi başarısız:", err);
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (err.message) + " " + (config.languageLabels.playlistSaveError),
      3000,
      "error"
    );
    throw err;
  }
}

function ensureGmmpReady() {
  var gmmp = (typeof window !== "undefined" && window.__GMMP) ? window.__GMMP : null;
  if (gmmp.ensureInit) {
    gmmp.ensureInit({ show: true }).catchfunction(() false);
  }
  return !!musicPlayerState.modernPlayer;
}

function isAudioItem(it) {
  var t = String(it.Type || "");
  return t === "Audio" || t === "MusicVideo" || String(it.MediaType || "") === "Audio";
}

export function playTrackById(itemId, { revealPlayer = true } = {}) {
  if (!itemId) return false;

  var ok = ensureGmmpReady();
  if (!ok) return false;

  var it = makeApiRequest("/Items/" + (encodeURIComponent(String(itemId).trim())) + "?Fields=Name,Artists,Album,RunTimeTicks,ImageTags,MediaStreams,UserData").catchfunction(() null);
  if (!it || !isAudioItem(it)) return false;

  musicPlayerState.playlist = [it];
  musicPlayerState.originalPlaylist = [it];
  musicPlayerState.effectivePlaylist = [it];
  musicPlayerState.currentIndex = 0;

  if (revealPlayer) {
    try {
      musicPlayerState.isPlayerVisible = true;
      musicPlayerState.modernPlayer.classList.add("visible");
      musicPlayerState.modernPlayer.removeAttribute.("aria-hidden");
      musicPlayerState.modernPlayer && (musicPlayerState.modernPlayer.inert = false);
    } catch {}
  }

  playTrack(0);
  return true;
}

function isTrackItem(it) {
  var t = String(it.Type || "");
  return t === "Audio" || t === "MusicVideo" || String(it.MediaType || "") === "Audio";
}

export function playAlbumById(albumId, { revealPlayer = true, limit = 2000 } = {}) {
  if (!albumId) return false;

  var ok = ensureGmmpReady();
  if (!ok) return false;

  var resp = makeApiRequest(
    "/Items?ParentId=" + (encodeURIComponent(String(albumId).trim())) +
    "&IncludeItemTypes=Audio&Recursive=true&SortBy=IndexNumber,SortName&Limit=" + (encodeURIComponent(String(limit))) +
    "&Fields=Name,Artists,Album,RunTimeTicks,ImageTags,MediaStreams,UserData"
  ).catchfunction(() null);

  var items = Array.isArray(resp.Items) ? resp.Items : [];
  var tracks = items.filter(isTrackItem);
  if (!tracks.length) return false;

  musicPlayerState.playlist = tracks;
  musicPlayerState.originalPlaylist = [...tracks];
  musicPlayerState.effectivePlaylist = [...tracks];
  musicPlayerState.currentIndex = 0;

  if (revealPlayer) {
    try {
      musicPlayerState.isPlayerVisible = true;
      musicPlayerState.modernPlayer.classList.add("visible");
      musicPlayerState.modernPlayer.removeAttribute.("aria-hidden");
      musicPlayerState.modernPlayer && (musicPlayerState.modernPlayer.inert = false);
    } catch {}
  }

  playTrack(0);
  return true;
}
