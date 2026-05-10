import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { getAuthToken, apiUrl } from "../core/auth.js";
import { updateMediaMetadata, initMediaSession, updatePositionState } from "../core/mediaSession.js";
import { getFromOfflineCache, cacheForOffline } from "../core/offlineCache.js";
import { readID3Tags } from "../lyrics/id3Reader.js";
import { fetchLyrics, updateSyncedLyrics, startLyricsSync, stopLyricsSync } from "../lyrics/lyrics.js";
import { updatePlaylistModal } from "../ui/playlistModal.js";
import { showNotification } from "../ui/notification.js";
import { updateProgress, updateDuration, setupAudioListeners } from "./progress.js";
import {
  updateNextTracks,
  checkMarqueeNeeded,
  updateFavoriteButtonState,
  updatePlayerBackground,
  updateAlbumArt
} from "../ui/playerUI.js";
import { refreshPlaylist } from "../core/playlist.js";
import {
  applyRadioNowPlaying,
  attachRadioStream,
  cleanupAttachedRadioStream,
  getRadioTrackDisplayInfo,
  getRadioTrackArtistLine,
  getRadioStationSubtitle,
  isRadioTrack,
  resolveRadioStationArtUrl,
  resolveRadioStream
} from "../core/radio.js";
import { getVideoStreamUrl, getAuthHeader, getEmbyHeaders, getSessionInfo } from "../../../../Plugins/NexusPobreFlix/runtime/api.js";

var config = getConfig();
var SEEK_RETRY_DELAY = 0;
var DEFAULT_ARTWORK = "./slider/src/images/defaultArt.png";
var DEFAULT_ARTWORK_CSS = "url('" + (DEFAULT_ARTWORK) + "')";

var currentCanPlayHandler = null;
var currentPlayErrorHandler = null;
var _metaReqId = 0;
var _artReqId = 0;
var _streamReqId = 0;
var resolvedAudioUrlCache = new Map();

var updatePlaybackUI = function(isPlaying) {
  if (musicPlayerState.playPauseBtn) {
    musicPlayerState.playPauseBtn.innerHTML = isPlaying
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play"></i>';
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
};

var handlePlaybackError = function(error, action = 'play') {
  console.error("Oynatma sırasında hata oluştu " + (action) + ":", error);
  var t = musicPlayerState.playlist[musicPlayerState.currentIndex];
  if (t && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(t, convertSecondsToTicks(musicPlayerState.audio.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }
  showNotification(
  "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.playbackError || "Oynatma Hatası"),
  3000,
  'error'
);
  if (isRadioTrack(t) && musicPlayerState.playlist.length <= 1) {
    updatePlaybackUI(false);
    return;
  }
  setTimeout(playNext, SEEK_RETRY_DELAY);
};

var disposables = {
  timeouts: new Set(),
  images: new Set(),
  aborters: new Set(),
  listeners: new Set(),
  clearAll() {
    for (var id of this.timeouts) { clearTimeout(id); }
    this.timeouts.clear();

    for (var { target, type, fn, opts } of this.listeners) {
      try { target.removeEventListener(type, fn, opts); } catch {}
    }
    this.listeners.clear();

    for (var img of this.images) {
      try { img.onload = img.onerror = null; img.src = ""; } catch {}
    }
    this.images.clear();

    for (var a of this.aborters) { try { a.abort(); } catch {} }
    this.aborters.clear();
  },
  addTimeout(id){ this.timeouts.add(id); return id; },
  addImage(img){ this.images.add(img); return img; },
  addAborter(a){ this.aborters.add(a); return a; },
  addListener(target, type, fn, opts){
    target.addEventListener(type, fn, opts);
    this.listeners.add({ target, type, fn, opts });
  }
};

var _lyricsRunning = false;
var _marqueeT1 = null;
var _loadedMetaRetryT = null;

function isRadioPlaylist(playlist = musicPlayerState.playlist) {
  return Array.isArray(playlist) && playlist.length > 0 && playlist.everyfunction((track) isRadioTrack(track));
}

function getTrackArtists(track) {
  if (isRadioTrack(track)) {
    return [getRadioTrackArtistLine(track)];
  }
  if (Array.isArray(track.Artists) && track.Artists.length) {
    return track.Artists.mapfunction((artist) typeof artist === "string" ? artist : artist.Name).filter(Boolean);
  }
  if (Array.isArray(track.ArtistItems) && track.ArtistItems.length) {
    return track.ArtistItems.mapfunction((artist) artist.Name).filter(Boolean);
  }
  if (track.artist) return [track.artist];
  if (track.Country) return [track.Country];
  return [config.languageLabels.unknownArtist];
}

function setModernPlayerTitle(title) {
  if (!musicPlayerState.modernTitleEl) return false;

  var nextTitle = String(title || "");
  if (musicPlayerState.modernTitleEl.textContent === nextTitle) return false;

  musicPlayerState.modernTitleEl.textContent = nextTitle;
  checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  clearMarqueeTimers();
  _marqueeT1 = disposables.addTimeoutfunction(setTimeout(() {
    if (musicPlayerState.modernTitleEl.textContent !== nextTitle) return;
    checkMarqueeNeeded(musicPlayerState.modernTitleEl);
  }, 500));

  return true;
}

function setModernPlayerArtist(artist) {
  if (!musicPlayerState.modernArtistEl) return false;

  var nextArtist = String(artist || "");
  if (musicPlayerState.modernArtistEl.textContent === nextArtist) return false;

  musicPlayerState.modernArtistEl.textContent = nextArtist;
  return true;
}

function refreshLiveRadioTrackInfo(track) {
  if (!track) return;
  if (musicPlayerState.currentTrack.Id !== track.Id) return;

  var liveInfo = getRadioTrackDisplayInfo(track);
  setModernPlayerTitle(liveInfo.playerTitle || liveInfo.title);
  setModernPlayerArtist(liveInfo.artist);

  musicPlayerState.currentTrackName = liveInfo.title;
  musicPlayerState.radioNowPlayingSource = track.NowPlayingText || track.nowPlayingText || getRadioStationSubtitle(track);
  updateMediaMetadata(track);
}

 function handleCanPlay() {
  musicPlayerState.audio.play()
    .thenfunction(() {
      updatePlaybackUI(true);
      var track = musicPlayerState.isUserModified
        ? musicPlayerState.combinedPlaylist[musicPlayerState.currentIndex]
        : musicPlayerState.playlist[musicPlayerState.currentIndex];
      if (track && !musicPlayerState.isPlayingReported) {
        reportPlaybackStart(track);
        musicPlayerState.isPlayingReported = true;
        musicPlayerState.lastReportedItemId = track.Id || null;
      }
    })
     .catch(function(err) handlePlaybackError(err, 'canplay'));
 }


function handlePlayError() {
  console.error("Şarkı yükleme hatası:", musicPlayerState.audio.src);
  var t = musicPlayerState.playlist[musicPlayerState.currentIndex];
  if (t && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(t, convertSecondsToTicks(musicPlayerState.audio.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }
  if (isRadioTrack(t) && musicPlayerState.playlist.length <= 1) {
    updatePlaybackUI(false);
    return;
  }
  setTimeout(playNext, SEEK_RETRY_DELAY);
}

function cleanupAudioListeners() {
  var audio = musicPlayerState.audio;
  _streamReqId += 1;
  disposables.clearAll();
  try { stopLyricsSync(); } catch {}
  _lyricsRunning = false;
  try { musicPlayerState.__audioCtrl.abort.(); } catch {}
  musicPlayerState.__audioCtrl = null;

  if (!audio) return;

  cleanupAttachedRadioStream(audio);
  try { audio.pause(); } catch {}
  try { audio.removeEventListener('canplay', handleCanPlay); } catch {}
  try { audio.removeEventListener('error', handlePlayError); } catch {}
  try { audio.removeEventListener('loadedmetadata', handleLoadedMetadata); } catch {}
  audio.onended = null;
  audio.src = '';
  audio.removeAttribute('src');
  try { audio.load(); } catch {}
}

export function stopPlayback({ resetSource = true } = {}) {
  var audio = musicPlayerState.audio;
  var currentTrack =
    musicPlayerState.currentTrack ||
    musicPlayerState.playlist.[musicPlayerState.currentIndex] ||
    null;

  if (currentTrack && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(
      currentTrack,
      convertSecondsToTicks(audio.currentTime || 0)
    ).catchfunction(() {});
  }

  musicPlayerState.isPlayingReported = false;
  musicPlayerState.lastReportedItemId = null;

  cleanupAudioListeners();
  updatePlaybackUI(false);

  if (resetSource) {
    musicPlayerState.isLiveStream = false;
    musicPlayerState.currentTrackDuration = 0;
    musicPlayerState.radioNowPlayingSource = null;
  }
}

export function handleSongEnd() {
   var { userSettings, playlist, audio } = musicPlayerState;
   var currentTrack = playlist[musicPlayerState.currentIndex];
  if (currentTrack && musicPlayerState.isPlayingReported) {
     reportPlaybackStopped(
       currentTrack,
       convertSecondsToTicks(audio.currentTime)
     );
    musicPlayerState.isPlayingReported = false;
   }

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    if (musicPlayerState.playlistSource === "radio") {
      showNotification(
        config.languageLabels.radioPlaybackStopped || "Radyo yayini sonlandi",
        2000,
        'info'
      );
      return;
    }
    showNotification(
      config.languageLabels.playlistEnded || "Lista de reprodução terminou, atualizando...",
      2000,
      'info'
    );
    return setTimeoutfunction(() refreshPlaylist(), 500);
  }

  switch (userSettings.repeatMode) {
    case 'one':
      musicPlayerState.audio.currentTime = 0;
      musicPlayerState.audio.play()
        .thenfunction(() updatePlaybackUI(true))
        .catch(function(err) handlePlaybackError(err, 'repeat'));
      break;

    case 'all':
      if (userSettings.removeOnPlay) {
        playNext();
      } else {
        var nextIndex = (musicPlayerState.currentIndex + 1) % playlist.length;
        playTrack(nextIndex);
      }
      break;

    default:
      playNext();
  }
}

export function togglePlayPause() {
  var { audio } = musicPlayerState;

  if (!audio) {
    console.warn('Ses okunamadı');
    return;
  }

  if (audio.paused) {
    audio.play()
      .thenfunction(() {
        updatePlaybackUI(true);
        var currentTrack = musicPlayerState.playlist[musicPlayerState.currentIndex];
        if (currentTrack && !musicPlayerState.isPlayingReported) {
          reportPlaybackStart(currentTrack);
          musicPlayerState.isPlayingReported = true;
          musicPlayerState.lastReportedItemId = currentTrack.Id || null;
        }
      })
      .catch(function(error) handlePlaybackError(error));
  } else {
    audio.pause();
    updatePlaybackUI(false);
    var currentTrack = musicPlayerState.playlist[musicPlayerState.currentIndex];
    if (currentTrack && musicPlayerState.isPlayingReported) {
      reportPlaybackStopped(
        currentTrack,
        convertSecondsToTicks(audio.currentTime)
      );
      musicPlayerState.isPlayingReported = false;
    }
  }
}

export function playPrevious() {
  var { playlist, effectivePlaylist, userSettings, audio } = musicPlayerState;
  var liveRadio = isRadioPlaylist(playlist);
  var prevTrack = playlist[musicPlayerState.currentIndex];
  if (prevTrack && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(prevTrack, convertSecondsToTicks(audio.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }
  var currentIndex = musicPlayerState.currentIndex;

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    if (musicPlayerState.playlistSource === "radio") return;
    showNotification(
      config.languageLabels.playlistEnded || "Lista de reprodução terminou, atualizando...",
      2000,
      'info'
    );
    return refreshPlaylist();
  }

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    showNotification(
  "<i class=\"fas fa-music\" style=\"margin-right: 8px;\"></i>" + (config.languageLabels.simdioynat) + ": " + (musicPlayerState.currentTrackName),
  2000,
  'kontrol'
);
    return;
  }

  if (userSettings.removeOnPlay && !liveRadio) {
    var removed = playlist.splice(currentIndex, 1);
    var effIdx = effectivePlaylist.findIndex(function(t) t.Id === removed[0].Id);
    if (effIdx > -1) effectivePlaylist.splice(effIdx, 1);
    updatePlaylistModal();

    if (playlist.length === 0) {
      updatePlaybackUI(false);
      showNotification(
        config.languageLabels.playlistEnded || "Lista de reprodução terminou, atualizando...",
        2000,
        'info'
      );
      return refreshPlaylist();
    }

    musicPlayerState.currentIndex = Math.min(currentIndex, playlist.length - 1);
  }

  var prevIndex = musicPlayerState.currentIndex - 1;
  if (prevIndex < 0) prevIndex = playlist.length - 1;

  playTrack(prevIndex);
}

export function playNext() {
  var { playlist, effectivePlaylist, userSettings, currentIndex, audio } = musicPlayerState;
  var liveRadio = isRadioPlaylist(playlist);
  var prevTrack = playlist[currentIndex];
  if (prevTrack && musicPlayerState.isPlayingReported) {
    reportPlaybackStopped(prevTrack, convertSecondsToTicks(audio.currentTime || 0));
    musicPlayerState.isPlayingReported = false;
  }

  if (playlist.length === 0) {
    updatePlaybackUI(false);
    if (musicPlayerState.playlistSource === "radio") return;
    showNotification(
      config.languageLabels.playlistEnded || "Lista de reprodução terminou, atualizando...",
      2000,
      'info'
    );
    return refreshPlaylist();
  }

  var playableLength = effectivePlaylist.length || playlist.length;
  if (playableLength === 0) {
    updatePlaybackUI(false);
    if (musicPlayerState.playlistSource === "radio") return;
    showNotification(
      config.languageLabels.playlistEnded || "Lista de reprodução terminou, atualizando...",
      2000,
      'info'
    );
    return refreshPlaylist();
  }

  if (userSettings.removeOnPlay && !liveRadio && currentIndex >= 0 && currentIndex < playlist.length) {
    var removed = playlist.splice(currentIndex, 1);
    var removedTrackId = removed[0].Id;
    var effIdx = effectivePlaylist.findIndex(function(t) t.Id === removedTrackId);
    if (effIdx > -1) effectivePlaylist.splice(effIdx, 1);
    updatePlaylistModal();

    if (playlist.length === 0) {
      updatePlaybackUI(false);
      showNotification(
        config.languageLabels.playlistEnded || "Lista de reprodução terminou, atualizando...",
        2000,
        'info'
      );
      return refreshPlaylist();
    }

    if (userSettings.shuffle) {
      var nextIndex = Math.floor(Math.random() * playlist.length);
      return playTrack(nextIndex);
    } else {
      var newIndex = currentIndex >= playlist.length ? 0 : currentIndex;
      return playTrack(newIndex);
    }
  }

  var nextIndex;
  if (userSettings.shuffle) {
    var rnd;
    do {
      rnd = Math.floor(Math.random() * playableLength);
    } while (rnd === currentIndex && playableLength > 1);
    nextIndex = rnd;
  } else {
    if (userSettings.repeatMode === 'all') {
      nextIndex = (currentIndex + 1) % playableLength;
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex >= playableLength) {
        if (isRadioPlaylist(playlist)) {
          return playTrack(0);
        }
        updatePlaybackUI(false);
        showNotification(
          config.languageLabels.playlistEnded || "Lista de reprodução terminou, atualizando...",
          2000,
          'info'
        );
        return refreshPlaylist();
      }
    }
  }

  playTrack(nextIndex);
}

export function updateModernTrackInfo(track) {
  if (!track) {
    resetTrackInfo();
    return;
  }

  var radioDisplay = isRadioTrack(track)
    ? getRadioTrackDisplayInfo(track)
    : null;
  var title = radioDisplay.playerTitle || radioDisplay.title || track.Name || config.languageLabels.unknownTrack;
  var artistLine = radioDisplay.artist || getTrackArtists(track).join(", ");

  setModernPlayerTitle(title);
  setModernPlayerArtist(artistLine);
  updateMediaMetadata(track);

  Promise.all([ loadAlbumArt(track), updateTrackMeta(track) ]);
  updatePlayerBackground();

  if (musicPlayerState.favoriteBtn) {
    updateFavoriteButtonState(track);
  }
}

function resetTrackInfo() {
  musicPlayerState.modernTitleEl.textContent = config.languageLabels.unknownTrack;
  musicPlayerState.modernArtistEl.textContent = config.languageLabels.unknownArtist;
  setAlbumArt(DEFAULT_ARTWORK);
}

function updateTrackMeta(track) {
  var reqId = ++_metaReqId;

  if (!musicPlayerState.metaWrapper) createMetaWrapper();
  if (musicPlayerState.modernPlayer) {
    musicPlayerState.modernPlayer
      .querySelectorAll(".player-meta-container")
      .forEach(function(el) { if (el !== musicPlayerState.metaContainer) el.remove(); });
  }
  if (!musicPlayerState.metaContainer) {
    musicPlayerState.metaContainer = document.createElement("div");
    musicPlayerState.metaContainer.className = "player-meta-container";
    Object.assign(musicPlayerState.metaContainer.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      overflow: 'hidden',
      textAlign: 'center'
    });
    musicPlayerState.metaWrapper.appendChild(musicPlayerState.metaContainer);
  }

  musicPlayerState.metaContainer.innerHTML = '';

  var appendMetaItem = function(item) {
    if (!item.text) return;
    var span = document.createElement('span');
    span.className = (item.key) + "-meta";
    var label = config.languageLabels[item.key] || item.label || item.key;
    span.title = (label) + ": " + (item.text);
    span.innerHTML = "<i class=\"" + (item.icon) + "\" style=\"margin-right:4px\"></i>" + (item.text);

    if (item.compact) {
      Object.assign(span.style, {
        flex: '0 0 auto',
        whiteSpace: 'nowrap'
      });
    } else {
      Object.assign(span.style, {
        minWidth: '0',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      });
    }

    musicPlayerState.metaContainer.appendChild(span);
  };

  if (isRadioTrack(track)) {
    var radioMeta = [
      { key: 'radioLiveLabel', label: config.languageLabels.radioLiveLabel || "LIVE", icon: 'fas fa-broadcast-tower', text: config.languageLabels.radioLiveLabel || "LIVE", compact: true },
      { key: 'country', label: config.languageLabels.country || "Ülke", icon: 'fas fa-globe', text: track.Country || track.Language },
      { key: 'codec', label: config.languageLabels.codec || "Codec", icon: 'fas fa-wave-square', text: track.Codec || "" },
      { key: 'bitrate', label: config.languageLabels.bitrate || "Bitrate", icon: 'fas fa-tachometer-alt', text: track.Bitrate > 0 ? (track.Bitrate) + " kbps" : "", compact: true },
      { key: 'tag', label: config.languageLabels.tags || "Etiket", icon: 'fas fa-tags', text: track.TagsText || "" }
    ];

    radioMeta.forEach(appendMetaItem);
    return;
  }

  var tags = readID3Tags(track.Id);
  if (reqId !== _metaReqId) return;
  var metaItems = [
    { key: 'tracknumber', show: track.IndexNumber != null, icon: 'fas fa-list-ol', text: track.IndexNumber },
    { key: 'year', show: track.ProductionYear != null, icon: 'fas fa-calendar-alt', text: track.ProductionYear },
    { key: 'album', show: !!track.Album, icon: 'fas fa-compact-disc', text: track.Album },
    { key: 'genre', show: !!tags.genre, icon: 'fas fa-music', text: tags.genre }
  ];

  for (var item of metaItems) {
    if (!item.show || item.text == null) continue;
    appendMetaItem({
      ...item,
      compact: item.key === 'tracknumber' || item.key === 'year'
    });
  }
}


function setAlbumArt(imageUrl) {
  if (!musicPlayerState.albumArtEl) return;

  if (!imageUrl || imageUrl === 'undefined') {
    musicPlayerState.albumArtEl.style.backgroundImage = DEFAULT_ARTWORK_CSS;
    musicPlayerState.currentArtwork = [{
      src: DEFAULT_ARTWORK,
      sizes: '300x300',
      type: 'image/png'
    }];
    return;
  }

  if (imageUrl.startsWith('url(')) {
    musicPlayerState.albumArtEl.style.backgroundImage = imageUrl;
    musicPlayerState.currentArtwork = [{
      src: imageUrl.replace("url('", "").replace("')", ""),
      sizes: '300x300',
      type: 'image/jpeg'
    }];
    return;
  }

  musicPlayerState.albumArtEl.style.backgroundImage = "url('" + (imageUrl) + "')";
  musicPlayerState.currentArtwork = [{
    src: imageUrl,
    sizes: '300x300',
    type: imageUrl.startsWith('data:') ? imageUrl.split(';')[0].split(':')[1] : 'image/jpeg'
  }];
}

function createMetaWrapper() {
  var metaWrapper = document.createElement("div");
  metaWrapper.className = "player-meta-wrapper";

  if (musicPlayerState.modernPlayer) {
    musicPlayerState.modernPlayer.insertBefore(
      metaWrapper,
      musicPlayerState.progressContainer
    );
  }
  musicPlayerState.metaWrapper = metaWrapper;
}

function addMetaItem(className, icon, text) {
  if (!musicPlayerState.metaContainer || !text) return;

  var span = document.createElement("span");
  span.className = (className) + "-meta";

  var label = config.languageLabels[className] || className;
  span.title = (label) + ": " + (text);

  span.innerHTML = "<i class=\"" + (icon) + "\"></i> " + (text);
  musicPlayerState.metaContainer.appendChild(span);
}

function loadAlbumArt(track) {
  var artReqId = ++_artReqId;
  try {
    var artwork = getArtworkFromSources(track);
    if (artReqId !== _artReqId) return;
    setAlbumArt(artwork);

    if (artwork && artwork !== DEFAULT_ARTWORK) {
      cacheForOffline(track.Id, 'artwork', artwork);
    }
  } catch (err) {
    console.error("Albüm kapağı yükleme hatası:", err);
    if (artReqId !== _artReqId) return;
    setAlbumArt(DEFAULT_ARTWORK);
  }
}

function getArtworkFromSources(track) {
  try {
    if (isRadioTrack(track)) {
      return resolveRadioStationArtUrl(track) || DEFAULT_ARTWORK;
    }

    var fromCache = getFromOfflineCache(track.Id, 'artwork');
    if (fromCache) return fromCache;

    var embedded = getEmbeddedImage(track.Id);
    if (embedded) return embedded;

    var imageTag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
    if (imageTag) {
      var imageId = track.AlbumId || track.Id;
      var url = apiUrl("/Items/" + (imageId) + "/Images/Primary?fillHeight=300&fillWidth=300&quality=90&tag=" + (imageTag));
      var valid = checkImageExists(url);
      return valid ? url : DEFAULT_ARTWORK;
    }

    return DEFAULT_ARTWORK;
  } catch (error) {
    console.error("Artwork alınırken hata:", error);
    return DEFAULT_ARTWORK;
  }
}

function checkImageExists(url) {
  return new Promisefunction((resolve) {
    var img = disposables.addImage(new Image());
    img.onload = function() { resolve(true); img.onload = img.onerror = null; img.src = ""; disposables.images.delete(img); };
    img.onerror = function() { resolve(false); img.onload = img.onerror = null; img.src = ""; disposables.images.delete(img); };
    img.src = url;
  });
}

function clearMarqueeTimers() {
  if (_marqueeT1) { clearTimeout(_marqueeT1); _marqueeT1 = null; }
}

function getEmbeddedImage(trackId) {
  var tags = readID3Tags(trackId);
  return tags.pictureUri || null;
}

function getTrackId(track) {
  return track.Id || track.id || null;
}

function isDirectJellyfinAudioUrl(url) {
  var value = String(url || "");
  return /\/Audio\/[^/]+\/stream(?:\.\w+)?(?:\?|$)/i.test(value);
}

function syncResolvedTrackSource(trackId, url) {
  if (!trackId || !url) return;
  resolvedAudioUrlCache.set(trackId, url);

  var lists = [
    musicPlayerState.playlist,
    musicPlayerState.originalPlaylist,
    musicPlayerState.effectivePlaylist,
    musicPlayerState.combinedPlaylist,
  ];

  lists.forEach(function((list) {
    if (!Array.isArray(list)) return;
    list.forEach(function((item) {
      if (getTrackId(item) === trackId) {
        item.mediaSource = url;
      }
    });
  });

  if (getTrackId(musicPlayerState.currentTrack) === trackId && musicPlayerState.currentTrack) {
    musicPlayerState.currentTrack.mediaSource = url;
  }
}

function buildDirectAudioUrl(track) {
  var trackId = getTrackId(track);
  if (!trackId) {
    console.error("Parça Id Bulunamadı:", track);
    return null;
  }

  var authToken = getAuthToken();
  if (!authToken) {
    showNotification(
    "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.authRequired || "Kimlik doğrulama hatası"),
    3000,
    'error'
  );
    return null;
  }

  return apiUrl("/Audio/" + (encodeURIComponent(trackId)) + "/stream.mp3?Static=true&api_key=" + (authToken));
}

function resolveTrackAudioUrl(track) {
  if (!track) return null;
  if (track.filePath) return track.filePath;

  var trackId = getTrackId(track);
  if (!trackId) return null;

  var cached = resolvedAudioUrlCache.get(trackId);
  if (cached) return cached;

  var existingSource = String(track.mediaSource || "").trim();
  var shouldResolveViaPlaybackInfo =
    !existingSource ||
    isDirectJellyfinAudioUrl(existingSource) ||
    musicPlayerState.playlistSource === "jellyfin";

  if (shouldResolveViaPlaybackInfo) {
    try {
      var resolvedUrl = getVideoStreamUrl(trackId, 360, 0);
      if (resolvedUrl) {
        syncResolvedTrackSource(trackId, resolvedUrl);
        return resolvedUrl;
      }
    } catch {}
  }

  if (existingSource) return existingSource;
  return buildDirectAudioUrl(track);
}

export function playTrack(index) {
  if (index === musicPlayerState.currentIndex &&
      musicPlayerState.playlist[index].Id ===
      musicPlayerState.playlist[musicPlayerState.currentIndex].Id) {
  }
  cleanupAudioListeners();
  var prevIndex = musicPlayerState.currentIndex;
  var hadTime = Number.isFinite(musicPlayerState.audio.currentTime) && musicPlayerState.audio.currentTime > 0.25;
  var prevTrack = (prevIndex != null && prevIndex > -1) ? musicPlayerState.playlist[prevIndex] : null;

  if (index < 0 || index >= musicPlayerState.playlist.length) return;

  if (!musicPlayerState.mediaSessionInitialized && 'mediaSession' in navigator) {
    initMediaSession();
    musicPlayerState.mediaSessionInitialized = true;
  }

  var track = musicPlayerState.isUserModified
    ? musicPlayerState.combinedPlaylist[index]
    : musicPlayerState.playlist[index];

  if (prevTrack && musicPlayerState.isPlayingReported) {
    var switchingToDifferent = prevTrack.Id !== track.Id;
    if (switchingToDifferent || hadTime) {
      reportPlaybackStopped(
        prevTrack,
        convertSecondsToTicks(musicPlayerState.audio.currentTime)
      );
    }
    musicPlayerState.isPlayingReported = false;
  }

  musicPlayerState.currentIndex = index;
  musicPlayerState.currentTrack = track;
  musicPlayerState.isLiveStream = isRadioTrack(track);
  musicPlayerState.currentTrackDuration = isRadioTrack(track) ? Number.NaN : 0;
  musicPlayerState.currentTrackName = isRadioTrack(track)
    ? getRadioTrackDisplayInfo(track).title
    : (track.Name || config.languageLabels.unknownTrack);
  musicPlayerState.currentAlbumName = track.Album || config.languageLabels.unknownAlbum;
  musicPlayerState.radioNowPlayingSource = isRadioTrack(track)
    ? getRadioStationSubtitle(track)
    : null;

  showNotification(
    (isRadioTrack(track) ? '<i class="fas fa-broadcast-tower" style="margin-right: 8px;"></i>' : '<i class="fas fa-music" style="margin-right: 8px;"></i>') + (config.languageLabels.simdioynat) + ": " + (musicPlayerState.currentTrackName),
    2000,
    'kontrol'
  );

  updateModernTrackInfo(track);
  updatePlaylistModal();

  try { stopLyricsSync(); } catch {}
  _lyricsRunning = false;

  if (musicPlayerState.lyricsActive) {
    fetchLyrics();
    if (!_lyricsRunning && !isRadioTrack(track)) {
      startLyricsSync();
      _lyricsRunning = true;
    }
  }

  var audio = musicPlayerState.audio;
  disposables.addListener(audio, 'canplay', handleCanPlay, { once: true });
  disposables.addListener(audio, 'error', handlePlayError, { once: true });
  disposables.addListener(audio, 'loadedmetadata', handleLoadedMetadata, { once: true });
  setupAudioListeners();

  if (isRadioTrack(track)) {
    try {
      audio.removeAttribute("crossorigin");
      audio.crossOrigin = null;
    } catch {}
    function(() {
      try {
        var { url, station } = resolveRadioStream(track);
        Object.assign(track, {
          StreamUrl: station.url || track.StreamUrl,
          ResolvedUrl: url,
          StationUuid: station.stationuuid || track.StationUuid,
          Logo: station.logo || track.Logo || track.LogoUrl || track.ImageUrl,
          LogoUrl: station.logo || track.LogoUrl || track.Logo || track.ImageUrl,
          ImageUrl: station.logo || track.ImageUrl || track.LogoUrl || track.Logo,
          Favicon: station.favicon || track.Favicon,
          Country: station.country || track.Country,
          Language: station.language || track.Language,
          CurrentArtist: station.currentArtist || track.CurrentArtist,
          CurrentTitle: station.currentTitle || track.CurrentTitle,
          NowPlayingText: station.nowPlayingText || track.NowPlayingText,
          TagsText: station.tags || track.TagsText,
          Codec: station.codec || track.Codec,
          Bitrate: station.bitrate || track.Bitrate
        });
        applyRadioNowPlaying(track, station);
        refreshLiveRadioTrackInfo(track);
        attachRadioStreamfunction(audio, url, {
          disableMetadataReader: station.metadataReaderDisabled === true,
          onMetadata: (metadata) {
            if (!applyRadioNowPlaying(track, metadata)) return;
            refreshLiveRadioTrackInfo(track);
          }
        });
      } catch (error) {
        handlePlaybackError(error, 'radio');
      }
    })();
  } else {
    try {
      audio.crossOrigin = "anonymous";
    } catch {}
    var streamReqId = ++_streamReqId;
    function(() {
      var audioUrl = resolveTrackAudioUrl(track);
      if (streamReqId !== _streamReqId) return;
      if (!audioUrl) {
        handlePlaybackError(new Error("Audio source unavailable"), "resolve-url");
        return;
      }
      audio.src = audioUrl;
      audio.load();
    })();
  }

  updateNextTracks();
}

function getAudioUrl(track) {
  if (track.filePath) return track.filePath;
  if (track.mediaSource) return track.mediaSource;
  var trackId = getTrackId(track);
  if (trackId) {
    var cached = resolvedAudioUrlCache.get(trackId);
    if (cached) return cached;
  }
  return buildDirectAudioUrl(track);
}

function getEffectiveDuration() {
  var audio = musicPlayerState.audio;
  if (audio && isFinite(audio.duration)) return audio.duration;
  if (isFinite(musicPlayerState.currentTrackDuration)) return musicPlayerState.currentTrackDuration;
  return 0;
}

function handleLoadedMetadata() {
  var effectiveDuration = getEffectiveDuration();
  musicPlayerState.currentTrackDuration = effectiveDuration;

  updateDuration();
  updateProgress();

  if (!isFinite(effectiveDuration)) {
    if (_loadedMetaRetryT) { clearTimeout(_loadedMetaRetryT); _loadedMetaRetryT = null; }
    _loadedMetaRetryT = disposables.addTimeoutfunction(setTimeout(() {
      updateDuration();
      updateProgress();
    }, 1000));
  }
}

function reportPlaybackStart(track) {
  if (!track.Id || isRadioTrack(track)) return;

  try {
    var authToken = getAuthToken();
    if (!authToken) return;
    var session = getSessionInfo.() || {};
    var authHeader = getAuthHeader.() || "MediaBrowser Token=\"" + (authToken) + "\"";
    var headers = getEmbyHeaders.({
      "Content-Type": "application/json",
      "Authorization": authHeader
    }) || {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    };
    if (session.userId) {
      headers["X-Emby-UserId"] = session.userId;
      headers["X-MediaBrowser-UserId"] = session.userId;
    }

    var response = fetch(apiUrl("/Sessions/Playing"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        ItemId: track.Id,
        PlayMethod: "DirectStream",
        CanSeek: true,
        IsPaused: false,
        IsMuted: false,
        PositionTicks: 0
      })
    });

    if (!response.ok) {
      console.error("Oynatma başlatma raporu gönderilemedi:", response.status);
    }
  } catch (error) {
    console.error("Oynatma raporlama hatası:", error);
  }
}

function reportPlaybackStopped(track, positionTicks) {
  if (!track.Id || isRadioTrack(track)) return;

  try {
    var authToken = getAuthToken();
    if (!authToken) return;
    var session = getSessionInfo.() || {};
    var authHeader = getAuthHeader.() || "MediaBrowser Token=\"" + (authToken) + "\"";
    var headers = getEmbyHeaders.({
      "Content-Type": "application/json",
      "Authorization": authHeader
    }) || {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    };
    if (session.userId) {
      headers["X-Emby-UserId"] = session.userId;
      headers["X-MediaBrowser-UserId"] = session.userId;
    }

    var response = fetch(apiUrl("/Sessions/Playing/Stopped"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        ItemId: track.Id,
        PlayMethod: "DirectStream",
        PositionTicks: positionTicks || 0
      })
    });

    if (!response.ok) {
      console.error("Oynatma durdurma raporu gönderilemedi:", response.status);
    }
  } catch (error) {
    console.error("Oynatma durdurma raporlama hatası:", error);
  }
}

function convertSecondsToTicks(seconds) {
  return seconds ? Math.floor(seconds * 10000000) : 0;
}
