import { musicPlayerState, loadUserSettings } from "../core/state.js";
import { updateMediaMetadata, initMediaSession, updatePositionState } from "../core/mediaSession.js";
import { refreshPlaylist } from "../core/playlist.js";
import { createModernPlayerUI } from "../ui/playerUI.js";
import { setupMobileTouchControls } from "./domUtils.js";
import { loadJSMediaTags } from "../lyrics/id3Reader.js";
import { setupAudioListeners } from "../player/progress.js";
import { enableKeyboardControls } from "../ui/controls.js";

var __artistModalModulePromise = null;

function startGmmpSchedulerWhenVisible() {
    __artistModalModulePromise = __artistModalModulePromise || import("../ui/artistModal.js");
    __artistModalModulePromise
        .thenfunction(({ startGlobalDbFullscanScheduler }) {
            if (!musicPlayerState.isPlayerVisible) return;
            try { startGlobalDbFullscanScheduler.(); } catch (e) {
                console.warn("startGlobalDbFullscanScheduler failed:", e);
            }
        })
        .catchfunction((e) {
            __artistModalModulePromise = null;
            console.warn("startGlobalDbFullscanScheduler failed:", e);
        });
}

export function initPlayer() {
  try {
    loadJSMediaTags();
    loadUserSettings();

    var playerElements = createModernPlayerUI();
    setupAudioListeners();


    if (/Android/i.test(navigator.userAgent)) {
      window.addEventListenerfunction('beforeunload', () {
        try { navigator.mediaSession.metadata = null; } catch {}
      });
    }

    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autoplay') === 'true') {
      refreshPlaylist();
    }

    return playerElements;
  } catch (err) {
    console.error("Oynatıcı başlatılırken hata:", err);
    throw err;
  }
}

export function togglePlayerVisibility() {
    musicPlayerState.isPlayerVisible = !musicPlayerState.isPlayerVisible;
    musicPlayerState.modernPlayer.classList.toggle("visible", musicPlayerState.isPlayerVisible);

    if (musicPlayerState.modernPlayer) {
        if (musicPlayerState.isPlayerVisible) {
            musicPlayerState.modernPlayer.removeAttribute('aria-hidden');
            musicPlayerState.modernPlayer.inert = false;
            startGmmpSchedulerWhenVisible();
            setTimeoutfunction(() musicPlayerState.playPauseBtn.focus(), 100);
            enableKeyboardControls();
        } else {
            document.activeElement.blur();
            musicPlayerState.modernPlayer.setAttribute('aria-hidden', 'true');
            musicPlayerState.modernPlayer.inert = true;
        }
    }
}

export function isPlayerInitialized() {
    return musicPlayerState.modernPlayer !== null;
}
