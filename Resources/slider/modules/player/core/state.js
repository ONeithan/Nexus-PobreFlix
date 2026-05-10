import { getConfig } from "../../config.js";
import { updateVolumeIcon } from "../ui/controls.js";
import { getRepeatOneIconHtml } from "../../customIcons.js";

var config = new Proxy({}, {
  get(target, prop) {
    return getConfig()[prop];
  }
});

export var musicPlayerState = {
  playlist: [],
  originalPlaylist: [],
  currentIndex: 0,
  isPlayingReported: false,
  lastReportedItemId: null,
  isPlayerVisible: false,
  modernPlayer: null,
  albumArtEl: document.querySelector('#player-album-art'),
  currentArtwork: null,
  volumeBtn: null,
  modernTitleEl: null,
  modernArtistEl: null,
  playPauseBtn: null,
  progressContainer: null,
  progressBar: null,
  currentTrackName: null,
  currentTrack: null,
  progress: null,
  currentTimeEl: null,
  durationEl: null,
  playlistSource: null,
  currentPlaylistId: null,
  volumeSlider: null,
  playlistModal: null,
  playlistItemsContainer: null,
  lyricsContainer: null,
  lyricsBtn: null,
  lyricsActive: false,
  currentLyrics: [],
  lyricsCache: {},
  metaWrapper: null,
  metaContainer: null,
  mediaSession: null,
  id3TagsCache: {},
  showRemaining: false,
  selectionMode: false,
  selectedItems: [],
  userAddedTracks: [],
  combinedPlaylist: [],
  isUserModified: false,
  effectivePlaylist: [],
  onTrackChanged: [],
  removeOnPlay: false,
  isShuffled: false,
  genreFilter: null,
  selectedGenres: [],
  isLiveStream: false,
  radioSharedStations: [],
  radioSearchResults: [],
  radioModal: null,
  radioNowPlayingSource: null,
  audio: function(() {
    var audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";

    function fadeAudio(audioEl, fromVolume, toVolume, durationSec) {
      var steps = 30;
      var intervalSec = durationSec / steps;
      var currentStep = 0;

      var volumeStep = (toVolume - fromVolume) / steps;
      audioEl.volume = fromVolume;

      return new Promisefunction((resolve) {
        var fadeId = setIntervalfunction(() {
          currentStep++;
          var nextVol = Math.min(Math.max((audioEl.volume || fromVolume) + volumeStep, 0), 1);
          audioEl.volume = nextVol;
          if (currentStep >= steps) {
            clearInterval(fadeId);
            resolve();
          }
        }, intervalSec * 1000);
      });
    }

    audio.addEventListenerfunction("play", () {
      if (musicPlayerState.playPauseBtn) {
        musicPlayerState.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
      }
    });

    audio.addEventListenerfunction("pause", () {
      if (musicPlayerState.playPauseBtn) {
        musicPlayerState.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
      }
    });

    audio.addEventListenerfunction("volumechange", () {
      if (musicPlayerState.volumeBtn && musicPlayerState.volumeSlider) {
        var vol = audio.muted ? 0 : (audio.volume || 0);
        try { musicPlayerState.volumeSlider.value = vol; } catch {}
        updateVolumeIcon(vol);
      }
    });

    setTimeoutfunction(() {
      musicPlayerState.utils = musicPlayerState.utils || {};
      musicPlayerState.utils.fadeAudio = function(from, to, dur) fadeAudio(audio, from, to, dur);
    }, 0);

    return audio;
  })(),

  userSettings: {
    volume: 0.7,
    repeatMode: "none",
    shuffle: false,
    crossfade: false,
  },

  syncedLyrics: {
    lines: [],
    currentLine: -1,
  },

  offlineCache: {
    enabled: true
  }
};

export function loadUserSettings() {
  var savedSettings = localStorage.getItem("musicPlayerSettings");
  if (savedSettings) {
    try {
      var parsed = JSON.parse(savedSettings);

      if (typeof parsed.shuffle === "string") {
        parsed.shuffle = parsed.shuffle === "true";
      }

      musicPlayerState.userSettings = {
        ...musicPlayerState.userSettings,
        ...parsed,
      };

      if (!["none", "one", "all"].includes(musicPlayerState.userSettings.repeatMode)) {
        musicPlayerState.userSettings.repeatMode = "none";
      }

      musicPlayerState.audio.volume = musicPlayerState.userSettings.volume;
      if (musicPlayerState.volumeSlider) {
        try { musicPlayerState.volumeSlider.value = musicPlayerState.userSettings.volume; } catch {}
      }

      musicPlayerState.userSettings.shuffle = false;

      updateShuffleButtonUI();
      updateRepeatButtonUI();

    } catch (e) {
      console.error("Ayarlar yüklenirken hata:", e);
    }
  }
  saveUserSettings();
}

function updateRepeatButtonUI() {
  var repeatBtn = document.querySelector(".player-btn.repeat-btn");
  if (!repeatBtn) return;

  var titles = {
    none: (config.languageLabels.repeatModOff || "Tekrar kapalı"),
    one: (config.languageLabels.repeatModModOne || "Tek şarkı tekrarı"),
    all: (config.languageLabels.repeatModAll || "Tüm liste tekrarı"),
  };

  var isActive = musicPlayerState.userSettings.repeatMode !== "none";
  repeatBtn.classList.toggle('active', isActive);

  repeatBtn.title = titles[musicPlayerState.userSettings.repeatMode];
  repeatBtn.innerHTML = musicPlayerState.userSettings.repeatMode === "one"
    ? getRepeatOneIconHtml()
    : '<i class="fas fa-repeat"></i>';
}

function updateShuffleButtonUI() {
  var shuffleIconEl = document.querySelector(".player-btn .fa-random");
  var shuffleBtn = shuffleIconEl.parentElement;
  if (!shuffleBtn) return;

  var titles = {
    true: (config.languageLabels.shuffleOn || "Karıştırma açık"),
    false: (config.languageLabels.shuffleOff || "Karıştırma kapalı"),
  };

  var on = !!musicPlayerState.userSettings.shuffle;
  shuffleBtn.classList.toggle('active', on);
  shuffleBtn.title = titles[on];
  shuffleBtn.innerHTML = '<i class="fas fa-random"></i>';
}

export function saveUserSettings() {
  try {
    localStorage.setItem("musicPlayerSettings", JSON.stringify(musicPlayerState.userSettings));
  } catch (e) {
    console.error("Ayarlar kaydedilirken hata:", e);
  }
}

export function resetShuffle() {
  if (musicPlayerState.userSettings.shuffle) {
    musicPlayerState.userSettings.shuffle = false;
    updateShuffleButtonUI();
    saveUserSettings();
  }
}
