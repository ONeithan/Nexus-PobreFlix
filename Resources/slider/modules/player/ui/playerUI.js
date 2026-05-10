import { createPlaylistModal, togglePlaylistModal } from "./playlistModal.js";
import { musicPlayerState, loadUserSettings, saveUserSettings } from "../core/state.js";
import { getConfig } from "../../config.js";
import { togglePlayPause, playPrevious, playNext, playTrack } from "../player/playback.js";
import { setupProgressControls } from "../player/progress.js";
import { toggleLyrics } from "../lyrics/lyrics.js";
import { toggleRepeatMode, toggleShuffle, toggleMute, toggleRemoveOnPlayMode } from "./controls.js";
import { refreshPlaylist } from "../core/playlist.js";
import { updateConfig } from "../../configPersistence.js";
import { showJellyfinPlaylistsModal } from "../core/jellyfinPlaylists.js";
import { togglePlayerVisibility } from "../utils/mainIndex.js";
import { readID3Tags } from "../lyrics/id3Reader.js";
import { toggleArtistModal, setupArtistClickHandler } from "./artistModal.js";
import { showGenreFilterModal } from "./genreFilterModal.js";
import { showTopTracksModal } from "./topModal.js";
import { getAuthToken } from "../core/auth.js";
import { showNotification } from "./notification.js";
import { openSettings } from "../../settingsLoader.js";
import { loadCSS, isMobileDevice } from "../../playerStyles.js";
import { makeCleanupBag, addEvent, trackTimeout, trackObserver } from "../utils/cleanup.js";
import { withServer, withParams } from "../../jfUrl.js";
import { showRadioModal } from "./radioModal.js";
import { updateFavoriteStatus } from "../../../../Plugins/NexusPobreFlix/runtime/api.js";
import { getCachedWatchlistMembership, getWatchlistButtonTitle, getWatchlistToast } from "../../watchlist.js";
import {
  getRadioPersistenceInfo,
  isRadioTrack,
  resolveRadioStationArtUrl,
  saveSharedRadioStation,
  stationKey,
  submitStationToDirectory
} from "../core/radio.js";

var config = new Proxy({}, {
  get(target, prop) {
    return getConfig()[prop];
  }
});
var DEFAULT_ARTWORK = "./slider/src/images/defaultArt.png";
var DEFAULT_ARTWORK_CSS = "url('" + (DEFAULT_ARTWORK) + "')";

var __topTracksAborter = null;
var __playerBackgroundRequestId = 0;

function trackGlobalTimeout(id) {
  if (!musicPlayerState.__timeouts) musicPlayerState.__timeouts = new Set();
  musicPlayerState.__timeouts.add(id);
}

function setPageScrollLocked(lock) {
  var html = document.documentElement;
  var body = document.body;

  if (lock) {
    if (!body.dataset._prevOverflow) body.dataset._prevOverflow = body.style.overflow || '';
    if (!html.dataset._prevOverflow) html.dataset._prevOverflow = html.style.overflow || '';

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
  } else {
    body.style.overflow = body.dataset._prevOverflow || '';
    html.style.overflow = html.dataset._prevOverflow || '';
    delete body.dataset._prevOverflow;
    delete html.dataset._prevOverflow;
  }
}

function clearGlobalTimeouts() {
  var set = musicPlayerState.__timeouts;
  if (!set) return;
  for (var id of set) { try { clearTimeout(id); } catch {} }
  set.clear();
}

function createButton({ className, iconClass, title, onClick, id = "" }) {
  var btn = document.createElement("div");
  btn.className = "player-btn " + (className || "").trim();
  if (id) btn.id = id;
  btn.innerHTML = "<i class=\"" + (iconClass) + "\"></i>";
  btn.title = title;
  btn.onclick = onClick;
  return btn;
}

function getFavoriteIconHtml(active) {
  return active
    ? '<i class="fas fa-heart" style="color:#e91e63"></i>'
    : '<i class="fas fa-heart"></i>';
}

function isSharedRadioTrack(track) {
  if (!isRadioTrack(track)) return false;

  var source = String(track.Source || track.source || "").trim().toLowerCase();
  if (["shared", "manual-static", "manual-local"].includes(source)) {
    return true;
  }

  var currentKey = stationKey(track);
  if (!currentKey || !Array.isArray(musicPlayerState.radioSharedStations)) {
    return false;
  }

  return musicPlayerState.radioSharedStations.somefunction((station) stationKey(station) === currentKey);
}

export function updateFavoriteButtonState(track = musicPlayerState.playlist.[musicPlayerState.currentIndex]) {
  var favoriteBtn = musicPlayerState.favoriteBtn;
  if (!favoriteBtn) return;

  if (!track) {
    favoriteBtn.innerHTML = getFavoriteIconHtml(false);
    favoriteBtn.title = getWatchlistButtonTitle({ Type: "Audio" }, false);
    return;
  }

  if (isRadioTrack(track)) {
    var isShared = isSharedRadioTrack(track);
    favoriteBtn.classList.remove("hidden");
    favoriteBtn.innerHTML = getFavoriteIconHtml(isShared);
    favoriteBtn.title = isShared
      ? (config.languageLabels.radioAlreadyShared || "Estação já está nas rádios compartilhadas")
      : (config.languageLabels.radioShare || "Adicionar às rádios compartilhadas");
    return;
  }

  var isFavorite = getCachedWatchlistMembership(track.Id, track.UserData.IsFavorite || false);
  track.UserData = track.UserData || {};
  track.UserData.IsFavorite = isFavorite;
  favoriteBtn.innerHTML = getFavoriteIconHtml(isFavorite);
  favoriteBtn.title = getWatchlistButtonTitle(track, isFavorite);
}

export function createModernPlayerUI() {
  if (musicPlayerState.__teardownModern) {
    try { musicPlayerState.__teardownModern(); } catch {}
    musicPlayerState.__teardownModern = null;
  }
  var player = Object.assign(document.createElement("div"), {
    id: "modern-music-player",
    role: "region",
    ariaLabel: "Music Player",
    ariaHidden: "true"
  });
  var __bag = makeCleanupBag(player);

  if (isMobileDevice()) {
    player.classList.add('mobile-device');
  }

  var bgLayer = document.createElement("div");
  bgLayer.className = "player-bg-layer";
  player.appendChild(bgLayer);

  var { container: nextTracksContainer, name: nextTracksName, list: nextTracksList } = createNextTracksUI();

  if (config.nextTracksSource === 'playlist') {
    uiElements.name.textContent = userSettings.shuffle
      ? config.languageLabels.rastgele || "Aleatório"
      : config.languageLabels.sirada || "Próximos";
  } else {
    nextTracksName.textContent = getSourceLabel(config.nextTracksSource);
    nextTracksName.title = config.languageLabels.changeSource || "Clique para mudar a fonte";
    nextTracksName.onclick = function(e) {
      e.stopPropagation();
      var cfg = getConfig();
      var nextSource = getNextTrackSource(cfg.nextTracksSource);
      var updatedConfig = { ...cfg, nextTracksSource: nextSource.value };
      updateConfig(updatedConfig);

      showNotification(
        "<i class=\"fas fa-music\"></i> " + (nextSource.label),
        2000,
        'info'
      );

      if (nextSource.value === 'playlist') {
        updateNextTracks();
      } else {
        showTopTracksInMainView(nextSource.value);
      }
    };
  }

  setTimeoutfunction(() {
    nextTracksName.classList.remove('hidden');
  }, 4000);

  var topControlsContainer = document.createElement("div");
  topControlsContainer.className = "top-controls-container";

  var buttonsTop = [
    {
      className: "theme-toggle-btn",
      iconClass: config.playerTheme === 'light' ? "fas fa-moon" : "fas fa-sun",
      title: config.playerTheme === 'light' ? config.languageLabels.darkTheme || 'Tema Escuro' : config.languageLabels.lightTheme || 'Tema Claro',
      onClick: toggleTheme
    },
    { className: "playlist-btn", iconClass: "fas fa-list", title: config.languageLabels.playlist, onClick: togglePlaylistModal },
    { className: "jplaylist-btn", iconClass: "fa-solid fa-list-ol", title: config.languageLabels.jellyfinPlaylists || "Playlists do Jellyfin", onClick: showJellyfinPlaylistsModal },
    { className: "radio-btn", iconClass: "fas fa-broadcast-tower", title: config.languageLabels.radioStations || "Rádios", onClick: showRadioModal },
    {
      className: "settingsLink",
      iconClass: "fas fa-cog",
      title: config.languageLabels.ayarlar || "Configurações",
      onClick: function(e) {
        e.preventDefault();
        openSettings("music");
      }
    },
    { className: "kapat-btn", iconClass: "fas fa-times", title: config.languageLabels.close || "Fechar", onClick: togglePlayerVisibility },
  ];

  buttonsTop.forEach(function(btnInfo) {
    var div = document.createElement("div");
    div.className = btnInfo.className;
    div.innerHTML = "<i class=\"" + (btnInfo.iconClass) + "\"></i>";
    div.title = btnInfo.title;
    div.onclick = btnInfo.onClick;
    topControlsContainer.appendChild(div);
  });

  var onThemeChanged = function(ev) {
    var theme = ev.detail.theme || getConfig().playerTheme || 'dark';
    var themeBtn = player.querySelector('.theme-toggle-btn');
    if (themeBtn) {
      themeBtn.innerHTML = "<i class=\"fas fa-" + (theme === 'light' ? 'moon' : 'sun') + "\"></i>";
      var cfgNow = getConfig();
      themeBtn.title = theme === 'light'
        ? (cfgNow.languageLabels.darkTheme || 'Tema Escuro')
        : (cfgNow.languageLabels.lightTheme || 'Tema Claro');
    }
    updatePlayerBackground();
    initializePlayerStyle();
  };
  addEvent(__bag, window, 'app:theme-changed', onThemeChanged);

  var albumArt = document.createElement("div");
  albumArt.id = "player-album-art";

  var favoriteBtn = document.createElement("div");
  favoriteBtn.className = "musicfavorite-btn hidden";
  favoriteBtn.innerHTML = '<i class="fas fa-heart"></i>';
  favoriteBtn.title = getWatchlistButtonTitle({ Type: "Audio" }, false);
  favoriteBtn.onclick = function(e) {
    e.stopPropagation();
    toggleFavorite();
  };

  var albumArtContainer = document.createElement("div");
  albumArtContainer.className = "album-art-container";
  albumArtContainer.append(albumArt, favoriteBtn);
  var favEnter = function() {
    var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
    if (currentTrack) {
      updateFavoriteButtonState(currentTrack);
      favoriteBtn.classList.remove("hidden");
    }
  };
  var favLeave = function() { favoriteBtn.classList.add("hidden"); };
  addEvent(__bag, albumArtContainer, "mouseenter", favEnter, { passive:true });
  addEvent(__bag, albumArtContainer, "mouseleave", favLeave, { passive:true });

  albumArtContainer.addEventListenerfunction("click", () {
    var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
    if (!currentTrack) return;
    if (isRadioTrack(currentTrack)) return;

    var artistName = currentTrack.Artists.join(", ") ||
      currentTrack.AlbumArtist ||
      config.languageLabels.unknownArtist;

    var artistId = currentTrack.ArtistItems.[0].Id ||
      currentTrack.AlbumArtistId ||
      currentTrack.ArtistId ||
      null;

    toggleArtistModal(true, artistName, artistId);
  });

  var trackInfo = document.createElement("div");
  trackInfo.className = "player-track-info";

  var titleContainer = document.createElement("div");
  titleContainer.id = "player-track-title";
  titleContainer.className = "marquee-container";

  var titleText = document.createElement("div");
  titleText.className = "marquee-text";
  titleText.textContent = config.languageLabels.noSongSelected;
  titleContainer.appendChild(titleText);

  var observer = new MutationObserverfunction(() { checkMarqueeNeeded(titleText); });
  observer.observe(titleText, { childList: true, characterData: true, subtree: true });
  trackObserver(__bag, observer);

  var onResize = function() { checkMarqueeNeeded(titleText); };
  addEvent(__bag, window, 'resize', onResize, { passive:true });

  trackTimeoutfunction(__bag, setTimeout(() { checkMarqueeNeeded(titleText); }, 100));

  var artist = document.createElement("div");
  artist.id = "player-track-artist";
  artist.textContent = config.languageLabels.artistUnknown;
  artist.onclick = function() {
    var currentTrack = musicPlayerState.playlist.[musicPlayerState.currentIndex];
    if (isRadioTrack(currentTrack)) return;
    toggleArtistModal(true, config.languageLabels.artistUnknown, null);
  };

  var topTracksBtn = createButtonfunction({
    className: "top-tracks-btn",
    iconClass: "fas fa-chart-line",
    title: config.languageLabels.myMusic || "Mais Ouvidas",
    onClick: () { showTopTracksModal(); },
  });

  trackInfo.append(titleContainer, artist);

  var repeatBtn = createButton({ className: "repeat-btn", iconClass: "fas fa-repeat", title: config.languageLabels.repeatModOff, onClick: toggleRepeatMode });
  var shuffleBtn = createButton({ iconClass: "fas fa-random", title: (config.languageLabels.shuffle) + ": " + (config.languageLabels.shuffleOff), onClick: toggleShuffle });
  var removeOnPlayBtn = createButton({
    className: "remove-on-play-btn",
    iconClass: "fa-solid fa-trash",
    title: musicPlayerState.userSettings.removeOnPlay
      ? config.languageLabels.removeOnPlayOn || "Remover após tocar: Ativado"
      : config.languageLabels.removeOnPlayOff || "Remover após tocar: Desativado",
    onClick: toggleRemoveOnPlayMode
  });

  if (musicPlayerState.userSettings.removeOnPlay) {
    removeOnPlayBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
  }
  var refreshBtn = createButton({ iconClass: "fas fa-sync-alt", title: config.languageLabels.refreshPlaylist, onClick: refreshPlaylist });

  var genreFilterBtn = createButton({
    className: "genre-filter-btn",
    iconClass: "fas fa-filter",
    title: config.languageLabels.filterByGenre || "Filtrar por Gênero",
    onClick: showGenreFilterModal
  });
  var prevBtn = createButton({ iconClass: "fas fa-step-backward", title: config.languageLabels.previousTrack, onClick: playPrevious });
  var playPauseBtn = createButton({ className: "main", iconClass: "fas fa-play", title: config.languageLabels.playPause, onClick: togglePlayPause, id: "play-pause-btn" });
  var nextBtn = createButton({ iconClass: "fas fa-step-forward", title: config.languageLabels.nextTrack, onClick: playNext });
  var lyricsBtn = createButtonfunction({
    className: "lyrics-btn",
    iconClass: "fa-regular fa-closed-captioning",
    title: config.languageLabels.lyrics,
    onClick: () {
      toggleLyrics();
      musicPlayerState.lyricsDelay = parseFloat(localStorage.getItem("lyricsDelay")) || 0;
    }
  });
  var volumeBtn = createButton({ iconClass: "fas fa-volume-up", title: config.languageLabels.volume, onClick: toggleMute });

  var volumeSlider = Object.assign(document.createElement("input"), {
    type: "range",
    className: "player-volume-slider",
    id: "player-volume-slider",
    name: "player-volume-slider",
    min: "0",
    max: "1",
    step: "0.01",
    value: "1",
    title: config.languageLabels.volumeLevel,
  });
  volumeSlider.setAttribute("aria-label", config.languageLabels.volumeLevel || config.languageLabels.volume || "Volume");

  volumeSlider.addEventListener('input', function(e) {
    var volume = parseFloat(e.target.value);
    var audio = musicPlayerState.audio;
    audio.volume = volume;
    audio.muted = false;
    musicPlayerState.userSettings.volume = volume;
    updateVolumeIcon(volume);
    saveUserSettings();
  });

  function updateVolumeIcon(volume) {
    var icon;
    if (volume === 0) icon = "fas fa-volume-mute";
    else if (volume < 0.5) icon = "fas fa-volume-down";
    else icon = "fas fa-volume-up";
    volumeBtn.innerHTML = "<i class=\"" + (icon) + "\"></i>";
  }

  var controls = document.createElement("div");
  controls.className = "player-controls";

  var controlElements = [
    prevBtn, playPauseBtn, nextBtn, repeatBtn, shuffleBtn,
    removeOnPlayBtn, lyricsBtn, refreshBtn, genreFilterBtn,
    topTracksBtn, volumeBtn, createButton({
      className: "fullscreen-btn",
      iconClass: "fa-solid fa-maximize",
      title: config.languageLabels.fullscreen || "Tela Cheia",
      onClick: toggleFullscreenMode
    }),
    createButton({
      className: "style-toggle-btn",
      iconClass: "fa-solid fa-up-down",
      title: config.playerStyle === 'player' ? config.languageLabels.dikeyStil || 'Estilo Vertical' : config.languageLabels.yatayStil || 'Estilo Horizontal',
      onClick: togglePlayerStyle
    }),
  ];

  addEvent(__bag, window, 'load', initializeFullscreen, { once:true });
  addEvent(__bag, document, 'DOMContentLoaded', initializeFullscreen, { once:true });

  controlElements.forEach(function(btn) controls.appendChild(btn));
  controls.appendChild(volumeSlider);

  var progressContainer = document.createElement("div");
  progressContainer.className = "player-progress-container";

  var progressBar = document.createElement("div");
  progressBar.className = "player-progress-bar";

  var progress = document.createElement("div");
  progress.className = "player-progress";

  var progressHandle = document.createElement("div");
  progressHandle.className = "player-progress-handle";

  var timeContainer = document.createElement("div");
  timeContainer.className = "player-time-container";

  var currentTimeEl = document.createElement("span");
  currentTimeEl.className = "player-current-time";
  currentTimeEl.textContent = "0:00";

  var durationEl = document.createElement("span");
  durationEl.className = "player-duration";
  durationEl.textContent = "0:00";

  progressBar.append(progress, progressHandle);
  timeContainer.append(currentTimeEl, durationEl);
  progressContainer.append(progressBar, timeContainer);

  timeContainer.addEventListenerfunction("click", () {
    musicPlayerState.showRemaining = !musicPlayerState.showRemaining;
    setupProgressControls();
  });

  var lyricsContainer = document.createElement("div");
  lyricsContainer.id = "player-lyrics-container";
  lyricsContainer.className = "lyrics-hidden";

  player.append(lyricsContainer, topControlsContainer, albumArtContainer, nextTracksContainer, trackInfo, progressContainer, controls);
  document.body.appendChild(player);
  createPlaylistModal();

  Object.assign(musicPlayerState, {
    modernPlayer: player,
    albumArtEl: albumArt,
    modernTitleEl: titleText,
    modernArtistEl: artist,
    progressBar,
    favoriteBtn,
    progress,
    progressHandle,
    playPauseBtn,
    progressContainer,
    currentTimeEl,
    durationEl,
    lyricsContainer,
    lyricsBtn,
    volumeBtn,
    volumeSlider,
    nextTracksContainer,
    nextTracksName,
    nextTracksList,
  });

  musicPlayerState.audio.volume = musicPlayerState.userSettings.volume || 0.7;
  setupProgressControls();
  loadUserSettings();
  setupArtistClickHandler();
  updatePlayerBackground();
  initializeFullscreen();
  initializePlayerStyle();

  var teardown = function() {
    try { setPageScrollLocked(false); } catch {}
    try { stopFullscreenAnimation(player); } catch {}
    if (musicPlayerState.nextTracksObserver) {
      try {
        var list = musicPlayerState.nextTracksList;
        if (list) for (var el of Array.from(list.children)) {
          try { musicPlayerState.nextTracksObserver.unobserve(el); } catch {}
        }
      } catch {}
      try { musicPlayerState.nextTracksObserver.disconnect(); } catch {}
      musicPlayerState.nextTracksObserver = null;
    }
    try { __topTracksAborter.abort.(); } catch {}
    __topTracksAborter = null;
    clearGlobalTimeouts();

    __bag.run();
    try { player.remove(); } catch {}
    musicPlayerState.isPlayerVisible = false;
    musicPlayerState.modernPlayer =
    musicPlayerState.favoriteBtn =
    musicPlayerState.albumArtEl =
    musicPlayerState.modernTitleEl =
    musicPlayerState.modernArtistEl =
    musicPlayerState.progressBar =
    musicPlayerState.progress =
    musicPlayerState.progressHandle =
    musicPlayerState.playPauseBtn =
    musicPlayerState.progressContainer =
    musicPlayerState.currentTimeEl =
    musicPlayerState.durationEl =
    musicPlayerState.lyricsContainer =
    musicPlayerState.lyricsBtn =
    musicPlayerState.volumeBtn =
    musicPlayerState.volumeSlider =
    musicPlayerState.nextTracksContainer =
    musicPlayerState.nextTracksName =
    musicPlayerState.nextTracksList = null;
  };
  musicPlayerState.__teardownModern = teardown;

  return { player, albumArt, title: titleContainer, artist, progressBar, progress, playPauseBtn, progressContainer, currentTimeEl, durationEl, volumeSlider, lyricsContainer, lyricsBtn };
}

export function updateNextTracks() {
  var config = getConfig();
  var {
    playlist,
    currentIndex,
    userSettings,
    nextTracksContainer,
  } = musicPlayerState;

  if (!nextTracksContainer || !playlist) return;

  if (musicPlayerState.nextTracksObserver) {
    try {
      var prevList = musicPlayerState.nextTracksList;
      if (prevList) for (var el of Array.from(prevList.children)) {
        try { musicPlayerState.nextTracksObserver.unobserve(el); } catch {}
      }
    } catch {}
    try { musicPlayerState.nextTracksObserver.disconnect(); } catch {}
    musicPlayerState.nextTracksObserver = null;
  }

  var uiElements = createNextTracksUI();
  nextTracksContainer.innerHTML = '';

  uiElements.name.onclick = function(e) {
    e.stopPropagation();
    var cfg = getConfig();
    var nextSource = getNextTrackSource(cfg.nextTracksSource);
    var updatedConfig = { ...cfg, nextTracksSource: nextSource.value };
    updateConfig(updatedConfig);

    showNotification(
      "<i class=\"fas fa-music\"></i> " + (nextSource.label),
      2000,
      'info'
    );

    if (nextSource.value === 'playlist') {
      updateNextTracks();
    } else {
      showTopTracksInMainView(nextSource.value);
    }
  };

  if (config.nextTracksSource === 'playlist') {
    uiElements.name.style.cursor = 'pointer';
    uiElements.name.textContent = userSettings.shuffle
      ? config.languageLabels.rastgele || "Aleatório"
      : config.languageLabels.sirada || "Próximos";
  } else {
    return showTopTracksInMainView(config.nextTracksSource);
  }

  var playlistLength = playlist.length;
  if (playlistLength <= 1) return;

  if (!musicPlayerState.playedHistory ||
      musicPlayerState.lastShuffleState !== userSettings.shuffle ||
      musicPlayerState.lastCurrentIndex !== currentIndex) {
    musicPlayerState.playedHistory = [currentIndex];
    musicPlayerState.lastShuffleState = userSettings.shuffle;
    musicPlayerState.lastCurrentIndex = currentIndex;
  }

  var nextIndices = userSettings.shuffle
    ? getShuffledIndices(playlist, currentIndex, config.nextTrack)
    : getSequentialIndices(playlist, currentIndex, config.nextTrack);

  var trackElements = nextIndices.map(function(nextIndex) {
    var track = playlist[nextIndex];
    if (!track) return null;

    var { trackElement, coverElement } = createTrackElementfunction(track,
      nextIndex,
      () playTrack(nextIndex)
    );

    uiElements.list.appendChild(trackElement);
    return { track, trackElement, coverElement, index: nextIndex };
  }).filter(Boolean);

  var observer = new IntersectionObserver(handleIntersection, {
    root: uiElements.wrapper,
    rootMargin: '100px',
    threshold: 0.1
  });

  var scrollControlsContainer = document.createElement('div');
  scrollControlsContainer.className = 'next-tracks-scroll-controls';
  scrollControlsContainer.append(uiElements.scrollLeft, uiElements.scrollRight);

  if (trackElements.length > 4) {
    nextTracksContainer.append(
      uiElements.name,
      scrollControlsContainer,
      uiElements.wrapper
    );
  } else {
    nextTracksContainer.append(uiElements.wrapper, uiElements.name);
  }

  musicPlayerState.nextTracksObserver = observer;
  setupImageLoading(trackElements, observer);
  requestAnimationFramefunction(() {
    setupScrollControls(
      trackElements,
      uiElements.list,
      uiElements.scrollLeft,
      uiElements.scrollRight
    );
  });

  trackGlobalTimeoutfunction(setTimeout(() {
    uiElements.name.classList.remove('hidden');
    uiElements.name.classList.add('visible');
  }, 100));

  musicPlayerState.nextTracksList = uiElements.list;
  musicPlayerState.nextTracksName = uiElements.name;
}

function getTrackImage(track) {
  if (isRadioTrack(track)) {
    return resolveRadioStationArtUrl(track);
  }

  var imageTag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
  var imageId = track.AlbumId || track.Id;
  if (imageTag) {
    return withParams("/Items/" + (imageId) + "/Images/Primary", {
      fillHeight: 100,
      fillWidth: 100,
      quality: 70,
      tag: imageTag,
      api_key: getAuthToken(),
    });
  }

  try {
    var tags = readID3Tags(track.Id);
    if (tags.pictureUri) return tags.pictureUri;
  } catch (e) {
    console.warn("ID3 etiqueta não pode ser lida (ID: " + (track.Id) + ")", e);
  }

  return null;
}

function toggleFavorite() {
  var { playlist, currentIndex, favoriteBtn } = musicPlayerState;
  var track = playlist.[currentIndex];
  if (!track.Id) return;

  if (isRadioTrack(track)) {
    if (isSharedRadioTrack(track)) {
      updateFavoriteButtonState(track);
      showNotification(
        "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.radioAlreadyShared || "Estação já está nas rádios compartilhadas"),
        2200,
        "info"
      );
      return;
    }

    try {
      var merged = saveSharedRadioStation(track);
      var info = getRadioPersistenceInfo();

      if (Array.isArray(merged)) {
        musicPlayerState.radioSharedStations = merged;
        var sharedTrack = merged.findfunction((station) stationKey(station) === stationKey(track));
        if (sharedTrack) {
          track.Source = sharedTrack.source || sharedTrack.Source || "shared";
          track.addedBy = sharedTrack.addedBy || sharedTrack.AddedBy || track.addedBy;
          track.addedByUserId = sharedTrack.addedByUserId || sharedTrack.AddedByUserId || track.addedByUserId;
          track.createdAt = sharedTrack.createdAt || sharedTrack.CreatedAt || track.createdAt;
        } else {
          track.Source = "shared";
        }
      } else {
        track.Source = "shared";
      }

      updateFavoriteButtonState(track);
      showNotification(
        "<i class=\"fas fa-check-circle\"></i> " + (info.supportsServerWrite
          ? (config.languageLabels.radioSharedSaved || "Estação adicionada à lista compartilhada")
          : (config.languageLabels.radioLocalSaved || "Estação salva neste navegador")),
        2200,
        "success"
      );
      submitStationToDirectory(track).catchfunction(() {});
    } catch (error) {
      console.error("Radyo paylasim islemi hatasi:", error);
      showNotification(
        "<i class=\"fas fa-exclamation-circle\"></i> " + (
          config.languageLabels.radioSharedSaveError || "Não foi possível adicionar a estação à lista compartilhada"
        ),
        3000,
        "error"
      );
    }
    return;
  }

  try {
    var isFavorite = track.UserData.IsFavorite || false;
    updateFavoriteStatus(track.Id, !isFavorite, { item: track });
    track.UserData = track.UserData || {};
    track.UserData.IsFavorite = !isFavorite;

    if (favoriteBtn) {
      updateFavoriteButtonState(track);
    }

    showNotification(
      "<i class=\"fas fa-heart\"></i> " + (getWatchlistToast(track, !isFavorite)),
      2000,
      'kontrol'
    );
  } catch (error) {
    console.error("Favori işlemi hatası:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (
        config.languageLabels.favoriteError || "Favori işlemi sırasında hata"
      ),
      3000,
      'error'
    );
  }
}

export function checkMarqueeNeeded(element) {
  if (!element || !element.parentElement) return;

  var container = element.parentElement;
  var textWidth = Math.ceil(element.scrollWidth || 0);
  var containerWidth = Math.ceil(container.clientWidth || container.offsetWidth || 0);
  var overflowWidth = Math.max(0, textWidth - containerWidth);
  var marqueeGap = Math.max(32, Math.min(96, Math.round(containerWidth * 0.18) || 48));
  var travelDistance = overflowWidth + marqueeGap;
  var durationSec = Math.max(8, Math.min(28, travelDistance / 28));

  container.style.setProperty('--container-width', (containerWidth) + "px");
  element.style.removeProperty('--marquee-distance');
  element.style.removeProperty('--marquee-duration');
  element.style.removeProperty('--marquee-gap');

  element.style.removeProperty('animation');
  element.classList.remove('marquee-active');
  element.style.transform = 'translate3d(0, 0, 0)';

  requestAnimationFramefunction(() {
    if (overflowWidth > 2) {
      element.style.setProperty('--marquee-distance', "-" + (travelDistance) + "px");
      element.style.setProperty('--marquee-duration', (durationSec) + "s");
      element.style.setProperty('--marquee-gap', (marqueeGap) + "px");
      element.classList.add('marquee-active');
    } else {
      element.classList.remove('marquee-active');
      element.style.transform = 'translate3d(0, 0, 0)';
    }
  });
}

function toggleTheme() {
  var config = getConfig();
  var newTheme = config.playerTheme === 'light' ? 'dark' : 'light';
  var updatedConfig = { ...config, playerTheme: newTheme };
  updateConfig(updatedConfig);
  var themeBtn = document.querySelector('.theme-toggle-btn');
  if (themeBtn) {
    themeBtn.innerHTML = "<i class=\"fas fa-" + (newTheme === 'light' ? 'moon' : 'sun') + "\"></i>";
    themeBtn.title = newTheme === 'light' ? config.languageLabels.darkTheme || 'Tema Escuro' : config.languageLabels.lightTheme || 'Tema Claro';
  }
  loadCSS();

  showNotification(
    "<i class=\"fas fa-" + (newTheme === 'light' ? 'sun' : 'moon') + "\"></i> " + (newTheme === 'light' ? config.languageLabels.lightThemeEnabled || 'Aydınlık tema etkin' : config.languageLabels.darkThemeEnabled || 'Karanlık tema etkin'),
    2000,
    'info'
  );
  try {
    window.dispatchEvent(new CustomEvent('app:theme-changed', { detail: { theme: newTheme, source: 'playerUI' } }));
  } catch {}
}

function togglePlayerStyle() {
  var config = getConfig();
  var newStyle = config.playerStyle === 'player' ? 'newplayer' : 'player';
  var iconName = newStyle === 'player' ? 'up-down' : 'left-right';
  var notifName = newStyle === 'player' ? 'left-right' : 'up-down';
  var updatedConfig = { ...config, playerStyle: newStyle };

  updateConfig(updatedConfig);

  var styleBtn = document.querySelector('.style-toggle-btn');
  if (styleBtn) {
    styleBtn.innerHTML = "<i class=\"fas fa-" + (iconName) + "\"></i>";
    styleBtn.title = newStyle === 'player'
      ? config.languageLabels.dikeyStil || 'Dikey Stil'
      : config.languageLabels.yatayStil || 'Yatay Stil';
  }

  loadCSS();
  showNotification(
    "<i class=\"fas fa-" + (notifName) + "\"></i> " + (
      newStyle === 'player'
        ? config.languageLabels.yatayStilEnabled || 'Yatay stil etkin'
        : config.languageLabels.dikeyStilEnabled || 'Dikey stil etkin'
    ),
    2000,
    'info'
  );
}

export function updatePlayerBackground() {
  var config = getConfig();
  var bgLayer = document.querySelector('#modern-music-player .player-bg-layer');
  var track = musicPlayerState.playlist.[musicPlayerState.currentIndex];
  var requestId = ++__playerBackgroundRequestId;

  var applyLayerStyles = function(imageCss) {
    if (!bgLayer || requestId !== __playerBackgroundRequestId) return;
    bgLayer.style.backgroundImage = imageCss;
    bgLayer.style.opacity = config.albumArtBackgroundOpacity;
    bgLayer.style.filter = "blur(" + (config.albumArtBackgroundBlur) + "px)";
    bgLayer.style.display = 'block';
  };

  var applyValidatedBackground = function(imageUrl) {
    var candidateUrl = imageUrl || DEFAULT_ARTWORK;
    var img = new Image();
    img.onload = function() {
      if (requestId !== __playerBackgroundRequestId) return;
      applyLayerStyles("url('" + (candidateUrl) + "')");
    };
    img.onerror = function() {
      if (requestId !== __playerBackgroundRequestId) return;
      applyLayerStyles(DEFAULT_ARTWORK_CSS);
    };
    img.src = candidateUrl;
  };

  if (!config.useAlbumArtAsBackground) {
    bgLayer.style.backgroundImage = 'none';
    bgLayer.style.opacity = '';
    bgLayer.style.filter = '';
    return;
  }

  if (!track) {
    applyValidatedBackground(DEFAULT_ARTWORK);
    return;
  }

  if (isRadioTrack(track)) {
    applyLayerStyles(DEFAULT_ARTWORK_CSS);
    resolveRadioStationArtUrl(track)
      .thenfunction((resolvedUrl) {
        if (requestId !== __playerBackgroundRequestId) return;
        applyValidatedBackground(resolvedUrl || DEFAULT_ARTWORK);
      })
      .catchfunction(() {
        if (requestId !== __playerBackgroundRequestId) return;
        applyLayerStyles(DEFAULT_ARTWORK_CSS);
      });
    return;
  }

  var bgUrl = DEFAULT_ARTWORK;
  var tag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
  var id = track.AlbumId || track.Id;
  if (tag && id) {
    bgUrl = withParams("/Items/" + (id) + "/Images/Primary", {
      fillHeight: 1000,
      fillWidth: 1000,
      quality: 96,
      tag,
      api_key: getAuthToken(),
    });
  }

  applyValidatedBackground(bgUrl);
}

export function updateAlbumArt(artUrl) {
  return new Promisefunction((resolve) {
    var albumArtEl = musicPlayerState.albumArtEl;
    if (!albumArtEl) return resolve();

    var url = artUrl ? "url('" + (artUrl) + "')" : DEFAULT_ARTWORK_CSS;
    var img = new Image();
    img.onload = function() {
      albumArtEl.style.backgroundImage = url;
      resolve();
    };
    img.onerror = function() {
      albumArtEl.style.backgroundImage = DEFAULT_ARTWORK_CSS;
      resolve();
    };
    img.src = artUrl || DEFAULT_ARTWORK;
  });
}

function toggleFullscreenMode() {
  var config = getConfig();
  var player = document.getElementById('modern-music-player');
  var fullscreenBtn = document.querySelector('.fullscreen-btn i');

  if (!isMobileDevice()) {
    localStorage.setItem('fullscreenMode', 'false');
    updateConfig({ ...config, fullscreenMode: false });
    setPageScrollLocked(false);
    applyFullscreenState(player, fullscreenBtn, false);
    return;
  }

  var newMode = !config.fullscreenMode;
  localStorage.setItem('fullscreenMode', String(newMode));
  updateConfig({ ...config, fullscreenMode: newMode });
  setPageScrollLocked(newMode);
  animateFullscreenState(player, fullscreenBtn, newMode);
}

function initializePlayerStyle() {
  var config = getConfig();
  var player = document.getElementById('modern-music-player');
  var styleToggleBtn = document.querySelector('.style-toggle-btn i');

  if (!player || !styleToggleBtn) return;

  if (config.playerStyle === 'newplayer') {
    player.classList.add('style-toggle');
    styleToggleBtn.className = 'fas fa-left-right';
    styleToggleBtn.title = config.languageLabels.dikeyStil || 'Dikey Stil';
  } else {
    player.classList.remove('style-toggle');
    styleToggleBtn.className = 'fas fa-up-down';
    styleToggleBtn.title = config.languageLabels.yatayStil || 'Yatay Stil';
  }
}

function initializeFullscreen() {
  var config = getConfig();
  var player = document.getElementById('modern-music-player');
  var fullscreenBtn = document.querySelector('.fullscreen-btn i');

  if (!isMobileDevice()) {
    setPageScrollLocked(false);
    applyFullscreenState(player, fullscreenBtn, false);
    return;
  }

  setPageScrollLocked(!!config.fullscreenMode);
  applyFullscreenState(player, fullscreenBtn, !!config.fullscreenMode);
}

function applyFullscreenState(player, fullscreenBtn, enabled) {
  player.classList.toggle('fullscreen-mode', enabled);
  if (fullscreenBtn) {
    fullscreenBtn.className = enabled ? 'fa-solid fa-minimize' : 'fa-solid fa-maximize';
  }
}

function animateFullscreenState(player, fullscreenBtn, enabled) {
  stopFullscreenAnimation(player);
  if (!player) return;

  if (player.classList.contains('style-toggle')) {
    applyFullscreenState(player, fullscreenBtn, enabled);
    return;
  }

  var cleaned = false;
  var unlockFrameA = 0;
  var unlockFrameB = 0;
  var cleanup = function() {
    if (cleaned) return;
    cleaned = true;
    if (unlockFrameA) {
      try { cancelAnimationFrame(unlockFrameA); } catch {}
      unlockFrameA = 0;
    }
    if (unlockFrameB) {
      try { cancelAnimationFrame(unlockFrameB); } catch {}
      unlockFrameB = 0;
    }
    player.classList.remove('fullscreen-layout-lock');
    player.__fullscreenAnimationCleanup = null;
  };

  player.__fullscreenAnimationCleanup = cleanup;
  player.classList.add('fullscreen-layout-lock');
  applyFullscreenState(player, fullscreenBtn, enabled);
  unlockFrameA = requestAnimationFramefunction(() {
    unlockFrameB = requestAnimationFrame(cleanup);
  });
}

function stopFullscreenAnimation(player) {
  player.__fullscreenAnimationCleanup.();
}

function showTopTracksInMainView(tab) {
  if (tab === 'playlist') {
    updateNextTracks();
    return;
  }

  var { nextTracksContainer } = musicPlayerState;

  var uiElements = createNextTracksUI();
  nextTracksContainer.innerHTML = '';

  uiElements.name.textContent = getSourceLabel(tab);
  uiElements.name.style.cursor = 'pointer';
  uiElements.name.onclick = function(e) {
    e.stopPropagation();
    var cfg = getConfig();
    var nextSource = getNextTrackSource(cfg.nextTracksSource);
    var updatedConfig = { ...cfg, nextTracksSource: nextSource.value };
    updateConfig(updatedConfig);

    showNotification(
      "<i class=\"fas fa-music\"></i> " + (nextSource.label),
      2000,
      'info'
    );

    if (nextSource.value === 'playlist') {
      updateNextTracks();
    } else {
      showTopTracksInMainView(nextSource.value);
    }
  };

  if (__topTracksAborter) { try { __topTracksAborter.abort(); } catch {} }
  __topTracksAborter = new AbortController();

  try {
    var token = getAuthToken();
    var userId = window.ApiClient.getCurrentUserId();
    var { apiPath, params } = getApiUrlForTab(tab, userId);

    var response = fetch(withParams(apiPath, params), {
      headers: { "X-Emby-Token": token },
      signal: __topTracksAborter.signal
    });

    if (!response.ok) throw new Error('Şarkılar yüklenemedi');

    var data = response.json();
    var tracks = data.Items || [];
    tracks = tracks.filterfunction((track, idx, arr)
      arr.findIndex(function(t) isSameTrack(t, track)) === idx
    );

    var trackElements = [];

    if (tracks.length === 0) {
      var noTracksElement = document.createElement('div');
      noTracksElement.className = 'no-tracks';
      noTracksElement.textContent = config.languageLabels.noTracks || 'Şarkı bulunamadı';
      uiElements.list.appendChild(noTracksElement);

      showNotification(
        "<i class=\"fas fa-info-circle\"></i> " + (getSourceLabel(tab)) + ": " + (config.languageLabels.noTracks || 'Şarkı bulunamadı'),
        2000,
        'info'
      );
    } else {
      trackElements = tracks.mapfunction((track, index) {
        var { trackElement, coverElement } = createTrackElementfunction(track,
          index,
          () addAndPlayTrack(track)
        );
        loadInitialBatch([{ track, trackElement, coverElement, index }])
          .catch(function(err) console.error('Görsel yükleme hatası:', err));

        uiElements.list.appendChild(trackElement);
        return { track, trackElement, coverElement, index };
      });

    }

    var scrollControlsContainer = document.createElement('div');
    scrollControlsContainer.className = 'next-tracks-scroll-controls';
    scrollControlsContainer.append(uiElements.scrollLeft, uiElements.scrollRight);

    if (tracks.length > 4) {
      nextTracksContainer.append(
        uiElements.name,
        scrollControlsContainer,
        uiElements.wrapper
      );
    } else {
      nextTracksContainer.append(uiElements.wrapper, uiElements.name);
    }

    if (tracks.length > 0) {
      requestAnimationFramefunction(() {
        setupScrollControls(
          trackElements,
          uiElements.list,
          uiElements.scrollLeft,
          uiElements.scrollRight
        );
      });
    }

    trackGlobalTimeoutfunction(setTimeout(() {
      uiElements.name.classList.remove('hidden');
      uiElements.name.classList.add('visible');
    }, 100));

  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Sıradaki şarkılar yüklenirken hata:', error);
    var errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = config.languageLabels.loadError || 'Yüklenirken hata oluştu';
    uiElements.list.appendChild(errorElement);

    nextTracksContainer.append(uiElements.wrapper, uiElements.name);

    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (getSourceLabel(tab)) + ": " + (config.languageLabels.loadError || 'Yüklenirken hata oluştu'),
      2000,
      'error'
    );
  }
}

function isSameTrack(a, b) {
  if (a.Id === b.Id) return true;
  if (a.Name !== b.Name) return false;
  var artistsA = (a.Artists || []).map(function(x) typeof x === 'string' ? x : x.Name).filter(Boolean).sort().join(',');
  var artistsB = (b.Artists || []).map(function(x) typeof x === 'string' ? x : x.Name).filter(Boolean).sort().join(',');
  return artistsA === artistsB;
}

function addAndPlayTrack(track) {
  var playlist = musicPlayerState.playlist;
  var existingIndex = playlist.findIndex(function(t) isSameTrack(t, track));

  if (existingIndex >= 0) {
    musicPlayerState.currentIndex = existingIndex;
  } else {
    playlist.push(track);
    musicPlayerState.originalPlaylist.push(track);
    musicPlayerState.currentIndex = playlist.length - 1;
  }
  playTrack(musicPlayerState.currentIndex);
}

function createNextTracksUI() {
  var nextTracksContainer = document.createElement('div');
  nextTracksContainer.className = 'next-tracks-container';

  var nextTracksName = document.createElement('div');
  nextTracksName.className = 'next-tracks-name hidden';
  nextTracksName.style.cursor = 'pointer';

  var nextTracksList = document.createElement('div');
  nextTracksList.className = 'next-tracks-list';

  var scrollLeftBtn = document.createElement('div');
  scrollLeftBtn.className = 'track-scroll-btn track-scroll-left';
  scrollLeftBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';

  var scrollRightBtn = document.createElement('div');
  scrollRightBtn.className = 'track-scroll-btn track-scroll-right';
  scrollRightBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';

  var wrapper = document.createElement('div');
  wrapper.className = 'next-tracks-wrapper';
  wrapper.appendChild(nextTracksList);

  return {
    container: nextTracksContainer,
    name: nextTracksName,
    list: nextTracksList,
    scrollLeft: scrollLeftBtn,
    scrollRight: scrollRightBtn,
    wrapper
  };
}

function setupScrollControls(trackElements, nextTracksList, scrollLeftBtn, scrollRightBtn) {
  if (!nextTracksList || !scrollLeftBtn || !scrollRightBtn) return;

  if (typeof nextTracksList.__cleanupScrollControls === 'function') {
    try { nextTracksList.__cleanupScrollControls(); } catch {}
  }

  nextTracksList.style.transform = '';

  var getMetrics = function() {
    var wrapper = nextTracksList.parentElement;
    var firstItem = nextTracksList.querySelector('.next-track-item');
    var wrapperWidth = wrapper.clientWidth || nextTracksList.clientWidth || 0;
    var itemWidth = firstItem.getBoundingClientRect.().width || 70;
    var gap = function(() {
      try {
        var styles = window.getComputedStyle(nextTracksList);
        var raw = styles.columnGap || styles.gap || '0';
        var parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : 0;
      } catch {
        return 0;
      }
    })();
    var step = Math.max(itemWidth + gap, wrapperWidth || 0);
    var maxScrollLeft = Math.max(0, nextTracksList.scrollWidth - wrapperWidth);
    return { step, maxScrollLeft };
  };

  var syncButtons = function() {
    var { maxScrollLeft } = getMetrics();
    var pos = Math.max(0, nextTracksList.scrollLeft || 0);
    var atStart = pos <= 2;
    var atEnd = pos >= Math.max(0, maxScrollLeft - 2);
    scrollLeftBtn.style.opacity = atStart ? '0.45' : '1';
    scrollRightBtn.style.opacity = atEnd ? '0.45' : '1';
    scrollLeftBtn.style.pointerEvents = atStart ? 'none' : 'auto';
    scrollRightBtn.style.pointerEvents = atEnd ? 'none' : 'auto';
  };

  var scrollByPage = function(direction) {
    var { step, maxScrollLeft } = getMetrics();
    var current = Math.max(0, nextTracksList.scrollLeft || 0);
    var target = Math.max(0, Math.min(maxScrollLeft, current + (direction * step)));
    if (typeof nextTracksList.scrollTo === 'function') {
      nextTracksList.scrollTo({ left: target, behavior: 'smooth' });
    } else {
      nextTracksList.scrollLeft = target;
    }
    requestAnimationFrame(syncButtons);
  };

  var onScroll = function() syncButtons();
  var onResize = function() {
    if (!nextTracksList.isConnected) {
      window.removeEventListener('resize', onResize);
      return;
    }
    syncButtons();
  };

  scrollLeftBtn.onclick = function() scrollByPage(-1);
  scrollRightBtn.onclick = function() scrollByPage(1);
  nextTracksList.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  nextTracksList.__cleanupScrollControls = function() {
    try { nextTracksList.removeEventListener('scroll', onScroll); } catch {}
    try { window.removeEventListener('resize', onResize); } catch {}
    nextTracksList.__cleanupScrollControls = null;
  };
  syncButtons();
  requestAnimationFrame(syncButtons);
}

export function destroyModernPlayerUI() {
  if (musicPlayerState.__teardownModern) {
    musicPlayerState.__teardownModern();
    musicPlayerState.__teardownModern = null;
  }
}

function createTrackElement(track, index, onClickHandler) {
  var config = getConfig();
  var trackElement = document.createElement('div');
  trackElement.className = 'next-track-item hidden';
  trackElement.dataset.trackId = track.Id;
  trackElement.dataset.trackIndex = index;
  trackElement.dataset.loaded = "false";
  trackElement.title = track.Name || config.languageLabels.unknownTrack;

  var coverElement = document.createElement('div');
  coverElement.className = 'next-track-cover';
  coverElement.style.backgroundImage = DEFAULT_ARTWORK_CSS;
  coverElement.onclick = function() onClickHandler(track, index);

  var titleElement = document.createElement('div');
  titleElement.className = 'next-track-title';
  titleElement.textContent = track.Name || config.languageLabels.unknownTrack;
  titleElement.onclick = function() onClickHandler(track, index);

  trackElement.append(coverElement, titleElement);
  return { trackElement, coverElement };
}

function getShuffledIndices(playlist, currentIndex, maxNextTracks) {
  var playedSet = new Set(musicPlayerState.playedHistory);
  if (!playedSet.has(currentIndex)) playedSet.add(currentIndex);

  if (playedSet.size >= playlist.length) {
    playedSet.clear();
    playedSet.add(currentIndex);
  }

  var selectedSet = new Set();
  while (selectedSet.size < maxNextTracks && selectedSet.size < playlist.length - 1) {
    var randIdx = Math.floor(Math.random() * playlist.length);
    if (randIdx !== currentIndex && !playedSet.has(randIdx)) {
      selectedSet.add(randIdx);
    }
  }

  var nextIndices = Array.from(selectedSet);
  if (nextIndices.length < maxNextTracks) {
    for (var i = 0; i < playlist.length && nextIndices.length < maxNextTracks; i++) {
      if (i !== currentIndex && !nextIndices.includes(i)) {
        nextIndices.push(i);
      }
    }
  }

  musicPlayerState.playedHistory.push(...nextIndices);
  musicPlayerState.playedHistory = Array.from(new Set(musicPlayerState.playedHistory));
  if (musicPlayerState.playedHistory.length > playlist.length) {
    musicPlayerState.playedHistory = musicPlayerState.playedHistory.slice(-playlist.length);
  }

  return nextIndices;
}

function getSequentialIndices(playlist, currentIndex, maxNextTracks) {
  var idx = currentIndex;
  var attempts = 0;
  var maxAttempts = playlist.length * 2;
  var nextIndices = [];

  while (nextIndices.length < maxNextTracks && attempts < maxAttempts) {
    idx = (idx + 1) % playlist.length;
    if (!musicPlayerState.playedHistory.includes(idx)) {
      nextIndices.push(idx);
      musicPlayerState.playedHistory.push(idx);
    }
    attempts++;
    if (attempts >= playlist.length && nextIndices.length === 0) {
      musicPlayerState.playedHistory = [currentIndex];
      idx = currentIndex;
      attempts = 0;
    }
  }

  return nextIndices;
}

function getApiUrlForTab(tab, userId) {
  var config = getConfig();

  var base = "/Users/" + (userId) + "/Items";
  var common = {
    IncludeItemTypes: "Audio",
    Recursive: "true",
  };

  switch (tab) {
    case "top":
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "PlayCount",
          SortOrder: "Descending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.topTracks || "En Çok Dinlenenler",
      };

    case "recent":
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "DatePlayed",
          SortOrder: "Descending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.recentTracks || "Son Dinlenenler",
      };

    case "latest":
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "DateCreated",
          SortOrder: "Descending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.latestTracks || "Son Eklenenler",
      };

    case "favorites":
      return {
        apiPath: base,
        params: {
          Filters: "IsFavorite",
          IncludeItemTypes: "Audio",
          Recursive: "true",
          SortBy: "SortName",
          SortOrder: "Ascending",
          Limit: config.topTrack,
        },
        trackListName: config.languageLabels.favorites || "Favorilerim",
      };

    default:
      return {
        apiPath: base,
        params: {
          ...common,
          SortBy: "PlayCount",
          SortOrder: "Descending",
          Limit: config.nextTrack,
        },
        trackListName: config.languageLabels.topTracks || "En Çok Dinlenenler",
      };
  }
}

function handleIntersection(entries, observer) {
  entries.forEach(function(entry) {
    if (!entry.isIntersecting) return;

    var el = entry.target;
    if (el.dataset.loaded === "true") return;

    var trackId = el.dataset.trackId;
    var trackElements = Array.from(el.parentElement.children);
    var trackIndex = trackElements.indexOf(el);

    loadTrackImageForElement(el, trackIndex);
  });
}

function getNextTrackSource(currentSource) {
  var config = getConfig();
  var sources = [
    { value: 'top', label: config.languageLabels.topTracks || 'En Çok Dinlenenler' },
    { value: 'recent', label: config.languageLabels.recentTracks || 'Son Dinlenenler' },
    { value: 'latest', label: config.languageLabels.latestTracks || 'Son Eklenenler' },
    { value: 'favorites', label: config.languageLabels.favorites || 'Favorilerim' },
    { value: 'playlist', label: musicPlayerState.userSettings.shuffle
        ? config.languageLabels.rastgele || "Rastgele"
        : config.languageLabels.sirada || "Sıradakiler" }
  ];

  var currentIndex = sources.findIndex(function(s) s.value === currentSource);
  var nextIndex = (currentIndex + 1) % sources.length;
  return sources[nextIndex];
}

function setupImageLoading(trackElements, observer) {
  var initialBatch = trackElements.slice(0, config.limiteId3 || 4);
  loadInitialBatch(initialBatch);

  trackElements.slice(config.limiteId3 || 4).forEach(function(({ trackElement }) {
    trackElement.classList.remove('hidden');
    observer.observe(trackElement);
  });
}

function loadInitialBatch(trackElements) {
  if (!Array.isArray(trackElements)) {
    console.error('loadInitialBatch: trackElements bir dizi olmalı', trackElements);
    return;
  }

  var chunkSize = config.limiteId3 || 4;
  for (var i = 0; i < trackElements.length; i += chunkSize) {
    var chunk = trackElements.slice(i, i + chunkSize);
    Promise.allfunction(chunk.map(({ track, trackElement, coverElement }) {
      if (!trackElement || !coverElement) return;

      trackElement.classList.remove('hidden');
      trackElement.classList.add('visible');

      try {
        var imageUri = getTrackImage(track);
        if (imageUri) {
          coverElement.style.backgroundImage = "url('" + (imageUri) + "')";
        }
        trackElement.dataset.loaded = "true";
      } catch (err) {
        console.error('İlk batch görsel yükleme hatası:', err);
      }
    }));
  }
}

function loadTrackImageForElement(trackElement, trackIndex) {
  var { playlist } = musicPlayerState;
  var track = playlist[trackIndex];
  if (!track) return;

  try {
    var imageUri = getTrackImage(track);
    if (imageUri) {
      var coverElement = trackElement.querySelector('.next-track-cover');
      if (coverElement) {
        coverElement.style.backgroundImage = "url('" + (imageUri) + "')";
      }
    }
    trackElement.dataset.loaded = "true";
  } catch (err) {
    console.error("Track #" + (trackIndex) + " resmi yüklenirken hata:", err);
  }
}

function getSourceLabel(source) {
  var config = getConfig();
  var labels = {
    'top': config.languageLabels.topTracks || "En Çok Dinlenenler",
    'recent': config.languageLabels.recentTracks || "Son Dinlenenler",
    'latest': config.languageLabels.latestTracks || "Son Eklenenler",
    'favorites': config.languageLabels.favorites || "Favorilerim",
    'playlist': musicPlayerState.userSettings.shuffle
      ? config.languageLabels.rastgele || "Rastgele"
      : config.languageLabels.sirada || "Sıradakiler"
  };
  return labels[source] || source;
}
