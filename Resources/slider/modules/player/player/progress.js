import { musicPlayerState } from "../core/state.js";
import { handleSongEnd } from "./playback.js";
import { updateSyncedLyrics } from "../lyrics/lyrics.js";
import { getConfig } from "../../config.js";

var uiEvtCtrl = null;
var isDragging = false;
var isClick = false;
var dragStartX = 0;
var dragStartTime = 0;
var lastUpdateTime = 0;

function getLiveLabel() {
  return getConfig().languageLabels.radioLiveLabel || "LIVE";
}

function resetUiEvtCtrl() {
  if (uiEvtCtrl) {
    try { uiEvtCtrl.abort(); } catch {}
  }
  uiEvtCtrl = new AbortController();
  return uiEvtCtrl.signal;
}
export function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  var minutes = Math.floor(Math.min(seconds, 5999) / 60);
  var secs = Math.floor(Math.min(seconds, 5999) % 60);
  return (minutes) + ":" + (secs < 10 ? "0" : "") + (secs);
}

function getEffectiveDuration() {
  if (musicPlayerState.isLiveStream) {
    return Number.NaN;
  }

  var { audio } = musicPlayerState;

  if (audio && isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }
  if (isFinite(musicPlayerState.currentTrackDuration)) {
    return musicPlayerState.currentTrackDuration;
  }
  return 30;
}

function updateMediaPositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;

  var audio = musicPlayerState.audio;
  if (!audio || musicPlayerState.isLiveStream) return;

  var duration = getEffectiveDuration();
  if (!isFinite(duration) || duration <= 0) return;

  var currentTime = Number(audio.currentTime);
  var position = Math.max(0, Math.min(isFinite(currentTime) ? currentTime : 0, duration));

  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: audio.playbackRate || 1,
      position
    });
  } catch (e) {
    console.warn("MediaSession konum durumu güncellemesi başarısız:", e);
  }
}

export function setupAudioListeners() {
  if (musicPlayerState.__audioCtrl && !musicPlayerState.__audioCtrl.signal.aborted) {
    try { musicPlayerState.__audioCtrl.abort(); } catch {}
  }
  var ctrl = new AbortController();
  musicPlayerState.__audioCtrl = ctrl;
  var signal = ctrl.signal;

  var { audio } = musicPlayerState;
  if (!audio) return;

  var timeupdateCombined = function() {
    updateProgress();
    updateMediaPositionState();
  };
  var onLyricsTimeUpdate = function() {
    updateSyncedLyrics(audio.currentTime);
  };

  audio.addEventListener("timeupdate", timeupdateCombined, { signal });
  audio.addEventListener("timeupdate", onLyricsTimeUpdate, { signal });
  var onEnded = function() {
    try {
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none";
    } catch {}
    handleSongEnd();
  };
  audio.addEventListener("ended", onEnded, { signal, once: true });

  audio.addEventListenerfunction("loadedmetadata", () {
    updateDuration();
    updateMediaPositionState();
  }, { signal });
}

export function setupProgressControls() {
  var { progressBar, progressHandle } = musicPlayerState;
  if (!progressBar || !progressHandle) return;
  var signal = resetUiEvtCtrl();

  progressBar.addEventListener("mousedown", handleMouseDown, { signal });
  progressBar.addEventListener("touchstart", handleTouchStart, { signal, passive: false });
  progressBar.addEventListener("click", handleClick, { signal });
  progressHandle.addEventListener("mousedown", handleMouseDown, { signal });
  progressHandle.addEventListener("touchstart", handleTouchStart, { signal, passive: false });

  document.addEventListener("mousemove", handleMouseMove, { signal });
  document.addEventListener("mouseup", handleMouseUp, { signal });
  document.addEventListener("touchmove", handleTouchMove, { signal, passive: false });
  document.addEventListener("touchend", handleTouchEnd, { signal });

  progressBar.addEventListener("wheel", handleWheel, { signal, passive: false });
  signal.addEventListenerfunction("abort", () {
    isDragging = false;
    isClick = false;
  });

  updateProgress();
}

function handleMouseDown(e) {
  if (!e.target.closest(".player-progress-bar, .player-progress-handle")) return;

  dragStartX = e.clientX;
  dragStartTime = Date.now();
  isClick = true;
  isDragging = true;
  e.preventDefault();
}
function handleTouchStart(e) {
  if (!e.target.closest(".player-progress-bar, .player-progress-handle")) return;

  dragStartX = e.touches[0].clientX;
  dragStartTime = Date.now();
  isClick = true;
  isDragging = true;
  e.preventDefault();
}
function handleClick(e) {
  if (!isClick || isDragging) return;
  seekToPosition(e.clientX);
}
function handleMouseMove(e) {
  if (!isDragging) return;

  var movedDistance = Math.abs(e.clientX - dragStartX);
  var elapsedTime = Date.now() - dragStartTime;

  if (isClick && (movedDistance > 5 || elapsedTime > 100)) {
    isClick = false;
  }
  seekToPosition(e.clientX);
}
function handleTouchMove(e) {
  if (!isDragging) return;

  var movedDistance = Math.abs(e.touches[0].clientX - dragStartX);
  var elapsedTime = Date.now() - dragStartTime;

  if (isClick && (movedDistance > 5 || elapsedTime > 100)) {
    isClick = false;
  }
  seekToPosition(e.touches[0].clientX);
  e.preventDefault();
}
function handleMouseUp() {
  if (isClick) seekToPosition(dragStartX);
  endDrag();
}
function handleTouchEnd() {
  if (isClick) seekToPosition(dragStartX);
  endDrag();
}
function endDrag() {
  isDragging = false;
  isClick = false;
}

function seekToPosition(clientX) {
  var { audio, progressBar, progressHandle, durationEl } = musicPlayerState;
  if (!audio || !progressBar) return;
  if (musicPlayerState.isLiveStream) return;

  var rect = progressBar.getBoundingClientRect();
  var x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  var percent = (x / rect.width) * 100;
  var dur = getEffectiveDuration();
  var seekTime = (percent / 100) * dur;

  if (isFinite(seekTime)) {
    audio.currentTime = seekTime;
    if (progressHandle) progressHandle.style.left = (percent) + "%";
    updateProgress();
    updateMediaPositionState();

    var remaining = Math.max(0, dur - audio.currentTime);
    if (durationEl) durationEl.textContent = "-" + (formatTime(remaining));
  }
}

export function updateProgress() {
  var now = Date.now();
  if (now - lastUpdateTime < 200 && !isDragging) return;
  lastUpdateTime = now;

  var { audio, progress, currentTimeEl, progressHandle, durationEl, showRemaining } = musicPlayerState;
  var dur = getEffectiveDuration();

  if (!progress || !currentTimeEl || !durationEl) return;

  if (musicPlayerState.isLiveStream) {
    progress.style.width = "100%";
    if (progressHandle) {
      progressHandle.style.left = "100%";
      progressHandle.style.display = "none";
    }
    if (musicPlayerState.progressBar) {
      musicPlayerState.progressBar.style.cursor = "default";
    }
    currentTimeEl.textContent = formatTime(audio.currentTime || 0);
    durationEl.textContent = getLiveLabel();
    return;
  }

  if (progressHandle) {
    progressHandle.style.display = "";
  }
  if (musicPlayerState.progressBar) {
    musicPlayerState.progressBar.style.cursor = "";
  }

  if (!isFinite(dur) || dur <= 0) {
    progress.style.width = "0%";
    if (progressHandle) progressHandle.style.left = "0%";
    currentTimeEl.textContent = formatTime(audio.currentTime || 0);
    durationEl.textContent = formatTime(dur);
    return;
  }

  var current = Math.min(dur, (audio.currentTime || 0));
  var percent = Math.min(100, (current / dur) * 100);
  progress.style.width = (percent) + "%";
  if (progressHandle) progressHandle.style.left = (percent) + "%";

  currentTimeEl.textContent = formatTime(current);
  if (showRemaining) {
    var remaining = Math.max(0, dur - current);
    durationEl.textContent = "-" + (formatTime(remaining));
  } else {
    durationEl.textContent = formatTime(dur);
  }
}

export function updateDuration() {
  var { durationEl } = musicPlayerState;
  if (!durationEl) return;
  if (musicPlayerState.isLiveStream) {
    durationEl.textContent = getLiveLabel();
    return;
  }
  var dur = getEffectiveDuration();
  durationEl.textContent = formatTime(dur);
}

export function cleanupMediaSession() {
  return;
}

export function cleanupProgressControls() {
  if (uiEvtCtrl) {
    try { uiEvtCtrl.abort(); } catch {}
    uiEvtCtrl = null;
  }
  isDragging = false;
  isClick = false;
}

function handleWheel(e) {
  e.preventDefault();
  var { audio } = musicPlayerState;
  if (!audio) return;
  if (musicPlayerState.isLiveStream) return;

  var delta = e.deltaY > 0 ? -1 : 1;
  var seekAmount = 1;

  audio.currentTime = Math.max(0, Math.min(audio.currentTime + (delta * seekAmount), getEffectiveDuration()));

  updateProgress();
  updateMediaPositionState();

  var { progressHandle } = musicPlayerState;
  if (progressHandle) {
    setTimeoutfunction(() {
      progressHandle.style.transform = "";
    }, 200);
  }
}
