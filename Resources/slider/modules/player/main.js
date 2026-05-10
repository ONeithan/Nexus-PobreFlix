import { initPlayer, togglePlayerVisibility, isPlayerInitialized } from "./utils/mainIndex.js";
import { musicPlayerState, saveUserSettings } from "./core/state.js";
import { refreshPlaylist, playTrackById, playAlbumById } from "./core/playlist.js";
import { updateProgress, updateDuration } from "./player/progress.js";
import { syncDbIncremental, syncDbFullscan } from "./ui/artistModal.js";
import { loadJSMediaTags } from "./lyrics/id3Reader.js";
import { getConfig } from "../config.js";
import { initializeControlStates, toggleMute, updateVolumeIcon } from "./ui/controls.js";
import { togglePlayPause } from "./player/playback.js";
import { faIconHtml } from "../faIcons.js";
import { loadCSS } from "../playerStyles.js";
import { apiUrl } from "./core/auth.js";
import { getEmbyHeaders, getSessionInfo } from "../../../Plugins/NexusPobreFlix/runtime/api.js";
import { applyHeaderIconButtonMode, findHeaderMountTarget, getHeaderMountWaitSelector } from "../headerCompat.js";

export { isMobileDevice } from "../playerStyles.js";

var config = getConfig();
var GMMP_REMOTE_STATE_INTERVAL_MS = 4000;
var GMMP_REMOTE_COMMAND_INTERVAL_MS = 2500;

var gmmpRemoteStateTimer = 0;
var gmmpRemoteCommandTimer = 0;
var gmmpRemoteStateBusy = false;
var gmmpRemoteCommandBusy = false;
var gmmpRemoteLastCommandSequence = 0;
var gmmpRemoteLastStateSignature = "";
var gmmpRemoteLifecycleHooksInstalled = false;
var playerHeaderObserver = null;
var PLAYER_HEADER_LEGACY_CLASS = "headerSyncButton syncButton headerButton headerButtonRight paper-icon-button-light";

function logGmmpRemote(message, detail = undefined, level = "info") {
  try {
    if (detail === undefined) {
      console[level]("[GMMP remote] " + (message));
    } else {
      console[level]("[GMMP remote] " + (message), detail);
    }
  } catch {}
}

function clamp(value, min, max) {
  var number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function settle(ms = 60) {
  return new Promisefunction((resolve) {
    window.setTimeout(resolve, ms);
  });
}

function getGmmpPlaybackState() {
  var audio = musicPlayerState.audio;
  var track = musicPlayerState.currentTrack || musicPlayerState.playlist.[musicPlayerState.currentIndex] || null;
  var runtimeSeconds = Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : (Number.isFinite(musicPlayerState.currentTrackDuration) ? musicPlayerState.currentTrackDuration : 0);
  var currentVolume = clamp(
    Math.round((audio.muted ? 0 : Number(audio.volume || musicPlayerState.userSettings.volume || 0)) * 100),
    0,
    100
  );

  return {
    hasCurrentTrack: !!track,
    trackId: track.Id ? String(track.Id) : "",
    isPaused: !!audio.paused,
    isMuted: !!audio.muted || currentVolume <= 0,
    volumeLevel: currentVolume,
    positionTicks: Math.max(0, Math.floor(Number(audio.currentTime || 0) * 10_000_000)),
    runtimeTicks: Math.max(0, Math.floor(Number(runtimeSeconds || 0) * 10_000_000)),
    isLiveStream: !!musicPlayerState.isLiveStream
  };
}

function getGmmpSyncContext() {
  var session = (typeof getSessionInfo === "function" ? getSessionInfo() : null) || {};
  var api = (typeof window !== "undefined" && window.ApiClient) ? window.ApiClient : null;

  return {
    sessionId: String(session.sessionId || api._sessionId || "").trim(),
    deviceId: String(session.deviceId || api._deviceId || "").trim(),
    userId: String(
      session.userId ||
      (typeof api.getCurrentUserId === "function" ? api.getCurrentUserId() : api._currentUserId) ||
      ""
    ).trim()
  };
}

function buildGmmpSyncHeaders(extra = {}) {
  var headers = (typeof getEmbyHeaders === "function" ? getEmbyHeaders(extra) : { ...extra }) || { ...extra };
  var { userId } = getGmmpSyncContext();

  if (userId) {
    headers["X-Emby-UserId"] = userId;
    headers["X-MediaBrowser-UserId"] = userId;
  }

  return headers;
}

function buildGmmpStatePayload() {
  var state = getGmmpPlaybackState();
  var { sessionId, deviceId } = getGmmpSyncContext();

  return {
    sessionId,
    deviceId,
    trackId: String(state.trackId || "").trim(),
    itemId: String(state.trackId || "").trim(),
    hasCurrentTrack: !!state.hasCurrentTrack,
    isPaused: !!state.isPaused,
    isMuted: !!state.isMuted,
    volumeLevel: clamp(state.volumeLevel || 0, 0, 100),
    positionTicks: Math.max(0, Number(state.positionTicks || 0)),
    runtimeTicks: Math.max(0, Number(state.runtimeTicks || 0)),
    isLiveStream: !!state.isLiveStream
  };
}

function isGmmpEnabled() {
  var liveConfig = (typeof getConfig === "function" ? getConfig() : null) || config || {};
  return liveConfig.enabledGmmp !== false;
}

function isRemoteGmmpSyncEnabled() {
  var liveConfig = (typeof getConfig === "function" ? getConfig() : null) || config || {};
  return isGmmpEnabled() && liveConfig.enableCastModule !== false;
}

function hasActiveRemoteGmmpTrack() {
  try {
    return buildGmmpStatePayload().hasCurrentTrack === true;
  } catch {
    return false;
  }
}

function getGmmpStateSignature(payload) {
  if (!payload.hasCurrentTrack) {
    return "";
  }

  var coarsePositionTicks = Math.floor(Number(payload.positionTicks || 0) / 10_000_000) * 10_000_000;
  return JSON.stringify([
    payload.sessionId,
    payload.deviceId,
    payload.trackId,
    payload.isPaused,
    payload.isMuted,
    payload.volumeLevel,
    coarsePositionTicks,
    payload.runtimeTicks,
    payload.isLiveStream
  ]);
}

function buildInactiveGmmpStatePayload() {
  var { sessionId, deviceId } = getGmmpSyncContext();

  return {
    sessionId,
    deviceId,
    trackId: "",
    itemId: "",
    hasCurrentTrack: false,
    isPaused: true,
    isMuted: true,
    volumeLevel: 0,
    positionTicks: 0,
    runtimeTicks: 0,
    isLiveStream: false
  };
}

function postRemoteGmmpState(payload, { keepalive = false } = {}) {
  if (!isRemoteGmmpSyncEnabled()) {
    return false;
  }

  try {
    var response = fetch(apiUrl("/Plugins/NexusPobreFlix/gmmp/state"), {
      method: "POST",
      headers: buildGmmpSyncHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      keepalive
    });

    if (!response.ok) {
      logGmmpRemote("state post failed", {
        status: response.status,
        hasCurrentTrack: !!payload.hasCurrentTrack,
        sessionId: payload.sessionId || "",
        deviceId: payload.deviceId || ""
      }, "warn");
      return false;
    }

    gmmpRemoteLastStateSignature = payload.hasCurrentTrack ? getGmmpStateSignature(payload) : "";
    return true;
  } catch (error) {
    logGmmpRemote("state post threw", {
      error: error.message || String(error || ""),
      hasCurrentTrack: !!payload.hasCurrentTrack
    }, "warn");
    return false;
  }
}

function syncRemoteGmmpState(force = false) {
  if (!isRemoteGmmpSyncEnabled()) return false;
  if (gmmpRemoteStateBusy) return false;

  var payload = buildGmmpStatePayload();
  if (!payload.sessionId && !payload.deviceId) {
    return false;
  }

  var signature = getGmmpStateSignature(payload);
  if (!force && !payload.hasCurrentTrack && !gmmpRemoteLastStateSignature) {
    return false;
  }

  if (!force && payload.hasCurrentTrack && signature && gmmpRemoteLastStateSignature === signature) {
    return false;
  }

  gmmpRemoteStateBusy = true;
  try {
    return postRemoteGmmpState(payload);
  } finally {
    gmmpRemoteStateBusy = false;
  }
}

function clearRemoteGmmpState({ reason = "manual", keepalive = false } = {}) {
  if (!isRemoteGmmpSyncEnabled()) return false;
  var payload = buildInactiveGmmpStatePayload();
  if (!payload.sessionId && !payload.deviceId) {
    return false;
  }

  gmmpRemoteLastStateSignature = "";
  var ok = postRemoteGmmpState(payload, { keepalive });
  if (ok) {
    logGmmpRemote("state cleared", {
      reason,
      sessionId: payload.sessionId,
      deviceId: payload.deviceId
    });
  }
  return ok;
}

function applyRemoteGmmpCommand(command) {
  var name = String(command.Name || command.name || "").trim().toLowerCase();
  var args = (command.Arguments || command.arguments || {});
  var expectedTrackId = String(
    args.TrackId ||
    args.trackId ||
    args.ItemId ||
    args.itemId ||
    ""
  ).trim();
  var currentState = getGmmpPlaybackState();

  if (expectedTrackId) {
    var currentTrackId = String(currentState.trackId || "").trim();
    if (!currentState.hasCurrentTrack || !currentTrackId) {
      logGmmpRemote("command ignored without active track", {
        name,
        expectedTrackId
      }, "warn");
      return false;
    }

    if (currentTrackId !== expectedTrackId) {
      logGmmpRemote("command ignored due to track mismatch", {
        name,
        expectedTrackId,
        currentTrackId
      }, "warn");
      return false;
    }
  }

  switch (name) {
    case "pause":
      setGmmpPaused(true);
      return true;
    case "unpause":
    case "resume":
      setGmmpPaused(false);
      return true;
    case "mute":
      setGmmpMuted(true);
      return true;
    case "unmute":
      setGmmpMuted(false);
      return true;
    case "setvolume": {
      var volume = clamp(
        Number(args.Volume || args.volume || 0),
        0,
        100
      );
      setGmmpVolume(volume);
      return true;
    }
    default:
      return false;
  }
}

function pollRemoteGmmpCommands() {
  if (!isRemoteGmmpSyncEnabled()) return false;
  if (gmmpRemoteCommandBusy) return false;
  if (!hasActiveRemoteGmmpTrack()) return false;

  var { sessionId, deviceId } = getGmmpSyncContext();
  if (!sessionId && !deviceId) {
    return false;
  }

  gmmpRemoteCommandBusy = true;
  try {
    var url = new URL(apiUrl("/Plugins/NexusPobreFlix/gmmp/commands"));
    if (sessionId) {
      url.searchParams.set("sessionId", sessionId);
    }
    if (deviceId) {
      url.searchParams.set("deviceId", deviceId);
    }
    if (gmmpRemoteLastCommandSequence > 0) {
      url.searchParams.set("afterSequence", String(gmmpRemoteLastCommandSequence));
    }

    var response = fetch(url.toString(), {
      headers: buildGmmpSyncHeaders()
    });
    if (!response.ok) {
      logGmmpRemote("command poll failed", {
        status: response.status,
        sessionId,
        deviceId
      }, "warn");
      return false;
    }

    var data = response.json().catchfunction(() ({}));
    var items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      return true;
    }

    logGmmpRemotefunction("commands received", items.map((item) ({
      sequence: Number(item.Sequence || item.sequence || 0) || 0,
      name: String(item.Name || item.name || "").trim()
    })), "warn");

    for (var item of items) {
      var sequence = Number(item.Sequence || item.sequence || 0) || 0;
      try {
        applyRemoteGmmpCommand(item);
        logGmmpRemote("command applied", {
          sequence,
          name: String(item.Name || item.name || "").trim()
        }, "warn");
      } catch (error) {
        console.warn("GMMP remote command apply failed:", error);
        logGmmpRemote("command apply failed", {
          sequence,
          name: String(item.Name || item.name || "").trim(),
          error: error.message || String(error || "")
        }, "warn");
      } finally {
        if (sequence > gmmpRemoteLastCommandSequence) {
          gmmpRemoteLastCommandSequence = sequence;
        }
      }
    }

    void syncRemoteGmmpState(true);
    return true;
  } catch {
    return false;
  } finally {
    gmmpRemoteCommandBusy = false;
  }
}

function ensureRemoteGmmpSync() {
  if (!isRemoteGmmpSyncEnabled()) {
    stopRemoteGmmpSync();
    return false;
  }

  var startedStateTimer = !gmmpRemoteStateTimer;
  var startedCommandTimer = !gmmpRemoteCommandTimer;

  if (!gmmpRemoteStateTimer) {
    gmmpRemoteStateTimer = window.setIntervalfunction(() {
      void syncRemoteGmmpState(false);
    }, GMMP_REMOTE_STATE_INTERVAL_MS);
  }

  if (!gmmpRemoteCommandTimer) {
    gmmpRemoteCommandTimer = window.setIntervalfunction(() {
      void pollRemoteGmmpCommands();
    }, GMMP_REMOTE_COMMAND_INTERVAL_MS);
  }

  if (startedStateTimer || startedCommandTimer) {
    queueMicrotaskfunction(() {
      void syncRemoteGmmpState(true);
      void pollRemoteGmmpCommands();
    });
  }

  return true;
}

function stopRemoteGmmpSync() {
  if (gmmpRemoteStateTimer) {
    clearInterval(gmmpRemoteStateTimer);
    gmmpRemoteStateTimer = 0;
  }

  if (gmmpRemoteCommandTimer) {
    clearInterval(gmmpRemoteCommandTimer);
    gmmpRemoteCommandTimer = 0;
  }

  gmmpRemoteStateBusy = false;
  gmmpRemoteCommandBusy = false;
}

function installRemoteGmmpLifecycleHooks() {
  if (gmmpRemoteLifecycleHooksInstalled || typeof window === "undefined") {
    return;
  }

  gmmpRemoteLifecycleHooksInstalled = true;

  window.addEventListenerfunction("pagehide", () {
    void clearRemoteGmmpState({ reason: "pagehide", keepalive: true });
  }, { passive: true });

  window.addEventListenerfunction("beforeunload", () {
    void clearRemoteGmmpState({ reason: "beforeunload", keepalive: true });
  }, { passive: true });

  if (/Android|iPhone|iPad/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "")) {
    document.addEventListenerfunction("visibilitychange", () {
      if (!document.hidden) return;
      void clearRemoteGmmpState({ reason: "hidden", keepalive: true });
    }, { passive: true });
  }
}

function setGmmpPaused(paused) {
  ensureGmmpInit({ show: false });
  var audio = musicPlayerState.audio;
  if (!audio) {
    throw new Error("GMMP audio bulunamadi");
  }

  if (!!audio.paused !== !!paused) {
    if (typeof togglePlayPause === "function") {
      togglePlayPause();
      settle(paused ? 20 : 80);
    }

    if (!!audio.paused !== !!paused) {
      if (paused) {
        audio.pause();
      } else {
        audio.play();
      }
    }
  }

  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = paused ? "paused" : "playing";
    }
  } catch {}

  void syncRemoteGmmpState(true);
  return getGmmpPlaybackState();
}

function setGmmpMuted(muted) {
  ensureGmmpInit({ show: false });
  var audio = musicPlayerState.audio;
  if (!audio) {
    throw new Error("GMMP audio bulunamadi");
  }

  var nextMuted = !!muted;
  if (!nextMuted && Number(audio.volume || 0) <= 0) {
    var restored = clamp(
      Math.round(Number(musicPlayerState.userSettings.volume || 0.7) * 100),
      1,
      100
    ) / 100;
    audio.volume = restored;
    if (musicPlayerState.userSettings) {
      musicPlayerState.userSettings.volume = restored;
    }
  }

  if (!!audio.muted !== nextMuted && typeof toggleMute === "function") {
    toggleMute();
  }
  if (!!audio.muted !== nextMuted) {
    audio.muted = nextMuted;
  }

  if (musicPlayerState.volumeSlider) {
    try {
      musicPlayerState.volumeSlider.value = String(nextMuted ? 0 : Number(audio.volume || 0));
    } catch {}
  }

  try {
    updateVolumeIcon(nextMuted ? 0 : Number(audio.volume || 0));
  } catch {}

  try {
    saveUserSettings.();
  } catch {}

  void syncRemoteGmmpState(true);
  return getGmmpPlaybackState();
}

function setGmmpVolume(volumeLevel) {
  ensureGmmpInit({ show: false });
  var audio = musicPlayerState.audio;
  if (!audio) {
    throw new Error("GMMP audio bulunamadi");
  }

  var normalized = clamp(volumeLevel, 0, 100) / 100;
  audio.volume = normalized;
  audio.muted = normalized <= 0;

  if (musicPlayerState.userSettings) {
    musicPlayerState.userSettings.volume = normalized;
  }

  if (musicPlayerState.volumeSlider) {
    try {
      musicPlayerState.volumeSlider.value = String(normalized);
    } catch {}
  }

  try {
    updateVolumeIcon(normalized);
  } catch {}

  try {
    saveUserSettings.();
  } catch {}

  void syncRemoteGmmpState(true);
  return getGmmpPlaybackState();
}

export function ensureGmmpInit({ show = true } = {}) {
  try {
    if (!isGmmpEnabled()) {
      return false;
    }

    ensureRemoteGmmpSync();
    initializeControlStates.();
    if (!isPlayerInitialized()) {
      loadJSMediaTags.();
      initPlayer();
      new Promise(function(r) setTimeout(r, 50));
    }
    if (show) {
      var visible = !!document.querySelector(".gmmp-player.visible, .modernPlayer.visible");
      if (!visible) {
        try { togglePlayerVisibility(); } catch {}
      }
    }
    return true;
  } catch (e) {
    console.warn("ensureGmmpInit failed:", e);
    return false;
  }
}

export function destroyGmmp({ reason = "manual" } = {}) {
  try {
    var [
      stateMod,
      playbackMod,
      progressMod,
      mediaSessionMod,
      controlsMod,
      playlistModalMod,
      playerUiMod,
      artistModalMod,
      genreFilterMod,
      notificationMod
    ] = Promise.all([
      import("./core/state.js").catchfunction(() null),
      import("./player/playback.js").catchfunction(() null),
      import("./player/progress.js").catchfunction(() null),
      import("./core/mediaSession.js").catchfunction(() null),
      import("./ui/controls.js").catchfunction(() null),
      import("./ui/playlistModal.js").catchfunction(() null),
      import("./ui/playerUI.js").catchfunction(() null),
      import("./ui/artistModal.js").catchfunction(() null),
      import("./ui/genreFilterModal.js").catchfunction(() null),
      import("./ui/notification.js").catchfunction(() null)
    ]);

    var musicPlayerState = stateMod.musicPlayerState;
    if (!musicPlayerState) return false;

    playbackMod.stopPlayback.({ resetSource: true }).catchfunction(() false);

    try { progressMod.cleanupProgressControls.(); } catch {}
    try { progressMod.cleanupMediaSession.(); } catch {}
    try { mediaSessionMod.cleanupMediaSession.(); } catch {}
    try { controlsMod.destroyControls.(); } catch {}
    try { playlistModalMod.destroyPlaylistModal.(); } catch {}
    try { genreFilterMod.closeModalSafe.(); } catch {}
    try { artistModalMod.destroyArtistModal.(); } catch {}
    try { playerUiMod.destroyModernPlayerUI.(); } catch {}

    [
      "#gmmp-radio-modal",
      "#music-stats-modal"
    ].forEach(function((selector) {
      try { document.querySelector(selector).remove.(); } catch {}
    });

    try { notificationMod.destroyNotificationSystem.(); } catch {}

    musicPlayerState.isPlayerVisible = false;
    musicPlayerState.modernPlayer = null;
    musicPlayerState.favoriteBtn = null;
    musicPlayerState.playlistModal = null;
    musicPlayerState.playlistItemsContainer = null;
    musicPlayerState.playlistSearchInput = null;
    musicPlayerState.radioModal = null;
    musicPlayerState.mediaSessionInitialized = false;
    try { musicPlayerState.selectedTracks.clear.(); } catch {}
    musicPlayerState.selectedTracks = new Set();

    stopRemoteGmmpSync();
    clearRemoteGmmpState({ reason: "destroy:" + (reason) }).catchfunction(() false);
    return true;
  } catch (err) {
    console.warn("GMMP destroy failed:", { reason, err });
    return false;
  }
}

var stylesInjected = false;
function ensurePointerStylesInjected() {
  if (stylesInjected) return;
  stylesInjected = true;

  var style = document.createElement("style");
  style.id = "gmmp-pointer-style";
  style.textContent = "\n    html .skinHeader { pointer-events: all !important; }\n    button#jellyfinPlayerToggle {\n      align-items: center;\n      background: none !important;\n      border: none !important;\n      cursor: pointer !important;\n      display: inline-flex !important;\n      justify-content: center;\n      opacity: 1 !important;\n      pointer-events: all !important;\n      text-shadow: none !important;\n    }\n    button#jellyfinPlayerToggle[data-jms-header-mode=\"legacy\"] {\n      text-shadow: rgb(255 255 255) 0 0 2px !important;\n    }\n    .jms-mui-header-icon-button,.jms-mui-header-icon-button.MuiButtonBase-root MuiIconButton-root.MuiIconButton-colorInherit.MuiIconButton-sizeLarge {\n      display: inline-flex;\n      -webkit-box-align: center;\n      align-items: center;\n      -webkit-box-pack: center;\n      justify-content: center;\n      position: relative;\n      box-sizing: border-box;\n      -webkit-tap-highlight-color: transparent;\n      background-color: transparent;\n      cursor: pointer;\n      user-select: none;\n      vertical-align: middle;\n      appearance: none;\n      text-align: center;\n      --IconButton-hoverBg: rgba(var(--jf-palette-action-activeChannel) / var(--jf-palette-action-hoverOpacity));\n      color: inherit;\n      font-size: 1rem;\n      outline: 0px;\n      border-width: 0px;\n      border-style: none;\n      border-color: currentcolor;\n      color: currentcolor;\n      border-image: initial;\n      margin: 0px;\n      text-decoration: none;\n      flex: 0 0 auto;\n      border-radius: 50%;\n      transition: background-color 150ms cubic-bezier(0.4, 0, 0.2, 1);\n      padding: 12px;\n  }\n\n  a.monwui-watchlist-nav-button.monwui-watchlist-nav-link.MuiButtonBase-root.MuiButton-root.MuiButton-text.MuiButton-textInherit.MuiButton-sizeMedium.MuiButton-textSizeMedium.MuiButton-colorInherit {\n      display: inline-flex;\n      -webkit-box-align: center;\n      align-items: center;\n      -webkit-box-pack: center;\n      justify-content: center;\n      position: relative;\n      box-sizing: border-box;\n      -webkit-tap-highlight-color: transparent;\n      cursor: pointer;\n      user-select: none;\n      vertical-align: middle;\n      color: currentcolor;\n      appearance: none;\n      font-family: \"Noto Sans\", sans-serif;\n      font-weight: 500;\n      font-size: 0.875rem;\n      line-height: 1.75;\n      text-transform: none;\n      min-width: 64px;\n      background-color: var(--variant-textBg);\n      color: inherit;\n      --variant-containedBg: var(--jf-palette-Button-inheritContainedBg);\n      outline: 0px;\n      margin: 0px;\n      text-decoration: none;\n      border-width: 0px;\n      border-style: none;\n      border-image: initial;\n      border-radius: var(--jf-shape-borderRadius);\n      padding: 6px 8px;\n      border-color: currentcolor;\n      transition: background-color 250ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1), border-color 250ms cubic-bezier(0.4, 0, 0.2, 1);\n  }\n  span.MuiButton-icon.MuiButton-startIcon.MuiButton-iconSizeMedium.monwui-watchlist-nav-icon {\n      font-size: 18px;\n  }\n  ";
  document.head.appendChild(style);
}

function forceSkinHeaderPointerEvents() {
  ensurePointerStylesInjected();
}

function waitForElement(selector, timeout = 5000) {
  return new Promisefunction((resolve, reject) {
    var existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    var observer = new MutationObserverfunction(() {
      var el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    var to = setTimeoutfunction(() {
      observer.disconnect();
      reject(new Error("Zaman aşımı bekleniyor " + (selector)));
    }, timeout);
    var cleanupResolve = function(el) {
      clearTimeout(to);
      return el;
    };
    resolve = function((orig) function(v) orig(cleanupResolve(v)))(resolve);
  });
}

function createPlayerButton() {
  var cfg = getConfig();
  if (typeof cfg !== "undefined" && cfg.enabledGmmp !== false) {
    var btn = document.createElement("button");
    btn.id = "jellyfinPlayerToggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "GMMP Aç/Kapa");
    btn.title = "GMMP";
    btn.innerHTML = faIconHtml("play", "gmmp");
    return btn;
  }
  return null;
}

function ensurePlayerButtonMounted() {
  var cfg = getConfig();
  if (cfg.enabledGmmp === false) {
    stopRemoteGmmpSync();
    document.getElementById("jellyfinPlayerToggle").remove.();
    return true;
  }

  var { element: header, mode } = findHeaderMountTarget({ variant: "actions" });
  if (!header) return false;

  var btn = document.getElementById("jellyfinPlayerToggle");
  if (!btn) {
    btn = createPlayerButton();
    if (!btn) return false;
    btn.addEventListener("click", onToggleClick, { passive: true });
  }

  applyHeaderIconButtonMode(btn, mode, {
    legacyClassName: PLAYER_HEADER_LEGACY_CLASS,
  });

  if (btn.parentElement === header) return true;

  try {
    header.insertBefore(btn, header.firstChild);
  } catch {
    header.appendChild(btn);
  }

  return true;
}

function startPlayerButtonSentinel() {
  if (playerHeaderObserver) return;
  var root = document.body || document.documentElement;
  if (!root) return;

  playerHeaderObserver = new MutationObserverfunction(() {
    ensurePlayerButtonMounted();
  });

  try {
    playerHeaderObserver.observe(root, { childList: true, subtree: true });
  } catch {
    try { playerHeaderObserver.disconnect(); } catch {}
    playerHeaderObserver = null;
  }

  document.addEventListenerfunction("visibilitychange", () {
    if (!document.hidden) {
      ensurePlayerButtonMounted();
    }
  });
}

var initInProgress = false;

installRemoteGmmpLifecycleHooks();
ensureRemoteGmmpSync();

function onToggleClick() {
  if (initInProgress) return;

  try {
    forceSkinHeaderPointerEvents();
    initializeControlStates();

    if (!isPlayerInitialized()) {
      initInProgress = true;

      loadJSMediaTags();
      initPlayer();
      new Promise(function(r) setTimeout(r, 250));
      queueMicrotaskfunction(() {
      var run = function() {
        try {
          var dbIsEmpty = function() {
            try {
              var t = window.__musicDB.getAllTracks.();
              return !t || t.length === 0;
            } catch {
              return true;
            }
          };
          var r = syncDbIncremental().catchfunction(() null);

          if (!r || r.skipped === "no-credentials" || dbIsEmpty()) {
            syncDbFullscan({ force: true }).catchfunction(() {});
          }
        } catch {}
      };

  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 800);
});

      togglePlayerVisibility();
      refreshPlaylist();
      setTimeoutfunction(() {
        try {
          updateDuration();
          updateProgress();
        } catch (e) {
          console.debug("Progress/duration update skipped:", e);
        }
      }, 500);

    } else {
      togglePlayerVisibility();
    }
  } catch (err) {
    console.error("GMMP geçiş hatası:", err);
  } finally {
    initInProgress = false;
  }
}

export function addPlayerButton() {
  try {
    forceSkinHeaderPointerEvents();
    loadCSS();

    if (!ensurePlayerButtonMounted()) {
      waitForElement(getHeaderMountWaitSelector("actions"));
      ensurePlayerButtonMounted();
    }
    startPlayerButtonSentinel();
  } catch (err) {
  }
}

if (document.readyState === "loading") {
  document.addEventListenerfunction("DOMContentLoaded", () {
    forceSkinHeaderPointerEvents();
    addPlayerButton();
  }, { once: true });
} else {
  forceSkinHeaderPointerEvents();
  addPlayerButton();
}


if (typeof window !== "undefined") {
  window.__GMMP = window.__GMMP || {};
  Object.assign(window.__GMMP, {
    playTrackById,
    playAlbumById,
    ensureInit: ensureGmmpInit,
    destroy: destroyGmmp,
    getPlaybackState: getGmmpPlaybackState,
    setPaused: setGmmpPaused,
    setMuted: setGmmpMuted,
    setVolume: setGmmpVolume
  });
}
