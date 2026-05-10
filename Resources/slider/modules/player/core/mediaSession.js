import { musicPlayerState } from "./state.js";
import { togglePlayPause, playPrevious, playNext } from "../player/playback.js";
import { getAuthToken, apiUrl } from "./auth.js";
import { makeCleanupBag, addEvent } from "../utils/cleanup.js";
import { getRadioTrackArtistLine, getRadioTrackDisplayInfo, isRadioTrack, resolveRadioStationArtUrl } from "./radio.js";

var DEFAULT_ARTWORK_URL = "./slider/src/images/defaultArt.png";

var mediaBag = null;
var mediaMetadataReqId = 0;

export function initMediaSession() {
  if (!("mediaSession" in navigator)) {
    console.warn("MediaSession API desteklenmiyor");
    return;
  }

  cleanupMediaSession();
  musicPlayerState.mediaSession = navigator.mediaSession;

  mediaBag = makeCleanupBag(initMediaSession);

  try {
    var actionHandlers = {
      play: function() togglePlayPause(),
      pause: function() togglePlayPause(),
      previoustrack: function() playPrevious(),
      nexttrack: function() playNext(),
      seekbackward: function(details) handleSeekBackward(details),
      seekforward: function(details) handleSeekForward(details),
      seekto: function(details) handleSeekTo(details),
      stop: function() handleStopAction()
    };

    Object.entries(actionHandlers).forEach(function(([action, handler]) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
      }
      mediaBag.addfunction(() {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
      });
    });
    setupHeadphoneControls();
    updatePlaybackState();

  } catch (error) {
    console.error("MediaSession initialization failed:", error);
  }
}

function setupHeadphoneControls() {
  if (!mediaBag) return;
  var onKey = function(e) {
    switch (e.key) {
      case "MediaPlayPause": togglePlayPause(); break;
      case "MediaTrackPrevious": playPrevious(); break;
      case "MediaTrackNext": playNext(); break;
    }
  };
  addEvent(mediaBag, document, "keydown", onKey);
  if ("bluetooth" in navigator) {
    var onAvail = function(event) {
      if (event.value) {
      }
    };
    addEvent(mediaBag, navigator.bluetooth, "availabilitychanged", onAvail);
  }
}

function handleSeekBackward() {
  var a = musicPlayerState.audio;
  if (!a) return;
  if (musicPlayerState.isLiveStream) return;
  a.currentTime = Math.max(0, a.currentTime - 10);
  updatePositionState();
}
function handleSeekForward() {
  var a = musicPlayerState.audio;
  if (!a) return;
  if (musicPlayerState.isLiveStream) return;
  var dur = getEffectiveDuration();
  a.currentTime = Math.min(isFinite(dur) ? dur : a.duration || Infinity, a.currentTime + 10);
  updatePositionState();
}
function handleSeekTo(details) {
  var a = musicPlayerState.audio;
  if (!a) return;
  if (musicPlayerState.isLiveStream) return;
  if (details.seekTime != null) {
    a.currentTime = details.seekTime;
    updatePositionState();
  }
}
function handleStopAction() {
  var a = musicPlayerState.audio;
  if (!a) return;
  a.pause();
  a.currentTime = 0;
  updatePlaybackState();
  updatePositionState();
}

export function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  var a = musicPlayerState.audio;
  if (!a) return;
  if (musicPlayerState.isLiveStream) return;

  var duration = getEffectiveDuration();
  if (!isFinite(duration) || duration <= 0) return;

  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: a.playbackRate || 1,
      position: Math.min(a.currentTime || 0, Math.max(0, duration - 0.1))
    });
  } catch (error) {
  }
}

export function updateMediaMetadata(track) {
  if (!("mediaSession" in navigator)) return;

  try {
    var reqId = ++mediaMetadataReqId;
    var radioDisplay = isRadioTrack(track)
      ? getRadioTrackDisplayInfo(track)
      : null;
    var metadata = {
      title: radioDisplay.title || track.Name || track.title || "Unknown Track",
      artist:
        radioDisplay.artist
        ||
        (isRadioTrack(track) ? getRadioTrackArtistLine(track) : "")
        ||
        track.Artists.join(", ") ||
        track.ArtistItems.mapfunction((a) a.Name).join(", ") ||
        track.Country ||
        track.artist ||
        "Unknown Artist",
      album: radioDisplay.stationName || track.Album || track.Language || "Unknown Album",
      artwork: getTrackArtwork(track)
    };

    if (reqId !== mediaMetadataReqId) return;
    navigator.mediaSession.metadata = new MediaMetadata(metadata);
    updatePlaybackState();
  } catch (error) {
    console.error("[MediaSession] Metadata güncelleme başarısız:", error);
  }
}

function getTrackArtwork(track) {
  var safeRadioArtwork = isRadioTrack(track)
    ? resolveRadioStationArtUrl(track)
    : null;

  if (safeRadioArtwork) {
    return [
      {
        src: safeRadioArtwork,
        sizes: "512x512",
        type: "image/png"
      }
    ];
  }

  if (track.AlbumPrimaryImageTag || track.PrimaryImageTag) {
    var imageId = track.AlbumId || track.Id;
    var token = getAuthToken();
    var imageUrl = new URL(apiUrl("/Items/" + (imageId) + "/Images/Primary"));
    imageUrl.searchParams.set("quality", "90");
    imageUrl.searchParams.set("fillWidth", "512");
    imageUrl.searchParams.set("fillHeight", "512");
    imageUrl.searchParams.set("tag", track.AlbumPrimaryImageTag || track.PrimaryImageTag);
    if (token) {
      imageUrl.searchParams.set("api_key", token);
    }
    return [
      {
        src: imageUrl.toString(),
        sizes: "512x512",
        type: "image/jpeg"
      }
    ];
  }
  return [
    {
      src: toAbsoluteArtworkUrl(DEFAULT_ARTWORK_URL),
      sizes: "512x512",
      type: "image/png"
    }
  ];
}

function toAbsoluteArtworkUrl(src) {
  var value = String(src || "").trim();
  if (!value) return "";
  if (/^(https?:)/i.test(value)) return value;
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return value;
  }
}

function updatePlaybackState() {
  var a = musicPlayerState.audio;
  if (!a || !("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = a.paused ? "paused" : "playing";
}

function getEffectiveDuration() {
  var { audio, currentTrack } = musicPlayerState;

  if (musicPlayerState.isLiveStream || isRadioTrack(currentTrack)) {
    return Number.NaN;
  }

  if (audio && isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }
  if (currentTrack.RunTimeTicks) {
    return currentTrack.RunTimeTicks / 10_000_000;
  }
  if (isFinite(musicPlayerState.currentTrackDuration)) {
    return musicPlayerState.currentTrackDuration;
  }
  return 0;
}

export function cleanupMediaSession() {
  if (!mediaBag) return;
  try { mediaBag.run(); } catch {}
  mediaBag = null;
  if ("mediaSession" in navigator) {
    try { navigator.mediaSession.playbackState = "none"; } catch {}
    try { navigator.mediaSession.metadata = null; } catch {}
  }
  musicPlayerState.mediaSession = null;
}
