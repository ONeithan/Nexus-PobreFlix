import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { getAuthToken, apiUrl } from "../core/auth.js";
import { musicDB } from "../utils/db.js";
import { showNotification } from "../ui/notification.js";
import { parseID3Tags } from "./id3Reader.js";
import { isRadioTrack } from "../core/radio.js";
import { hasLyricsPayload, normalizeLyricsPayload } from "./normalizer.js";

var config = getConfig();

var fetchAbort = null;
var currentRequestKey = null;
var audioEndedHandlerAttached = false;
var lastActiveIdx = -1;
var lastNextIdx = -1;
var settingsInitialized = false;
var settingsRefs = null;
var contentContainer = null;
var requestSequence = 0;

function safeClear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function buildRequestKey(trackId, source) {
  requestSequence += 1;
  return (trackId) + "::" + (source) + "::" + (requestSequence);
}

function cancelOngoingFetch() {
  if (fetchAbort) {
    try { fetchAbort.abort(); } catch {}
  }
  fetchAbort = null;
}

function getCurrentLyricsTrack(trackOverride = null) {
  return trackOverride || musicPlayerState.currentTrack || musicPlayerState.playlist[musicPlayerState.currentIndex] || null;
}

function ensureSettingsUI() {
  if (settingsInitialized) return;

  var root = musicPlayerState.lyricsContainer;
  safeClear(root);

  var headerContainer = document.createElement("div");
  headerContainer.className = "lyrics-header-container";

  var settingsContainer = document.createElement("div");
  settingsContainer.className = "lyrics-settings-container";

  var delayContainer = document.createElement("div");
  delayContainer.className = "lyrics-setting-group";

  var delayLabel = document.createElement("span");
  delayLabel.textContent = config.languageLabels.lyricsDelay || "Gecikme: ";

  var delaySlider = document.createElement("input");
  delaySlider.type = "range";
  delaySlider.id = "lyrics-delay-slider";
  delaySlider.name = "lyrics-delay-slider";
  delaySlider.min = "-5";
  delaySlider.max = "5";
  delaySlider.step = "0.1";
  delaySlider.value = localStorage.getItem("lyricsDelay") || "0";
  delaySlider.className = "lyrics-delay-slider";
  delaySlider.setAttribute("aria-label", config.languageLabels.lyricsDelay || "Şarkı sözü gecikmesi");

  var delayValue = document.createElement("span");
  delayValue.className = "lyrics-setting-value";
  delayValue.textContent = (delaySlider.value) + "s";

  delaySlider.addEventListenerfunction("input", (e) {
    var value = e.target.value;
    delayValue.textContent = (value) + "s";
    localStorage.setItem("lyricsDelay", value);
    musicPlayerState.lyricsDelay = parseFloat(value);
  });

  delayValue.addEventListenerfunction("click", () {
    var manualInput = document.createElement("input");
    manualInput.type = "number";
    manualInput.name = "lyrics-delay-manual-input";
    manualInput.step = "0.1";
    manualInput.value = delaySlider.value;
    manualInput.className = "lyrics-setting-manual-input";
    manualInput.style.width = "4em";
    manualInput.setAttribute("aria-label", config.languageLabels.lyricsDelay || "Şarkı sözü gecikmesi");

    delayValue.style.display = "none";
    delayValue.parentNode.insertBefore(manualInput, delayValue.nextSibling);

    var apply = function() {
      var v = parseFloat(manualInput.value);
      if (Number.isNaN(v)) v = 0;
      v = Math.max(parseFloat(delaySlider.min), Math.min(parseFloat(delaySlider.max), v));
      delaySlider.value = v;
      delayValue.textContent = (v) + "s";
      localStorage.setItem("lyricsDelay", v);
      musicPlayerState.lyricsDelay = v;
      cleanup();
    };
    var cleanup = function() {
      manualInput.removeEventListener("blur", onBlur);
      manualInput.removeEventListener("keydown", onKey);
      manualInput.remove();
      delayValue.style.display = "";
    };
    var onBlur = function() apply();
    var onKey = function(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); apply(); }
      else if (ev.key === "Escape") { cleanup(); }
    };
    manualInput.addEventListener("blur", onBlur);
    manualInput.addEventListener("keydown", onKey);
    manualInput.focus();
  });

  delayContainer.append(delayLabel, delaySlider, delayValue);

  var durationContainer = document.createElement("div");
  durationContainer.className = "lyrics-setting-group";

  var durationLabel = document.createElement("span");
  durationLabel.textContent = config.languageLabels.lyricsDuration || "Aktiflik Süresi: ";

  var durationSlider = document.createElement("input");
  durationSlider.type = "range";
  durationSlider.id = "lyrics-duration-slider";
  durationSlider.name = "lyrics-duration-slider";
  durationSlider.min = "1";
  durationSlider.max = "15";
  durationSlider.step = "0.5";
  durationSlider.value = localStorage.getItem("lyricsDuration") || "5";
  durationSlider.className = "lyrics-duration-slider";
  durationSlider.setAttribute("aria-label", config.languageLabels.lyricsDuration || "Şarkı sözü aktiflik süresi");

  var durationValue = document.createElement("span");
  durationValue.className = "lyrics-setting-value";
  durationValue.textContent = (durationSlider.value) + "s";

  durationSlider.addEventListenerfunction("input", (e) {
    var value = e.target.value;
    durationValue.textContent = (value) + "s";
    localStorage.setItem("lyricsDuration", value);
    musicPlayerState.lyricsDuration = parseFloat(value);
  });

  durationValue.addEventListenerfunction("click", () {
    var manualInput = document.createElement("input");
    manualInput.type = "number";
    manualInput.name = "lyrics-duration-manual-input";
    manualInput.step = "0.5";
    manualInput.min = "1";
    manualInput.max = "15";
    manualInput.value = durationSlider.value;
    manualInput.className = "lyrics-setting-manual-input";
    manualInput.style.width = "4em";
    manualInput.setAttribute("aria-label", config.languageLabels.lyricsDuration || "Şarkı sözü aktiflik süresi");

    durationValue.style.display = "none";
    durationValue.parentNode.insertBefore(manualInput, durationValue.nextSibling);

    var apply = function() {
      var v = parseFloat(manualInput.value);
      if (Number.isNaN(v)) v = 5;
      v = Math.max(parseFloat(durationSlider.min), Math.min(parseFloat(durationSlider.max), v));
      durationSlider.value = v;
      durationValue.textContent = (v) + "s";
      localStorage.setItem("lyricsDuration", v);
      musicPlayerState.lyricsDuration = v;
      cleanup();
    };
    var cleanup = function() {
      manualInput.removeEventListener("blur", onBlur);
      manualInput.removeEventListener("keydown", onKey);
      manualInput.remove();
      durationValue.style.display = "";
    };
    var onBlur = function() apply();
    var onKey = function(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); apply(); }
      else if (ev.key === "Escape") { cleanup(); }
    };
    manualInput.addEventListener("blur", onBlur);
    manualInput.addEventListener("keydown", onKey);
    manualInput.focus();
  });

  durationContainer.append(durationLabel, durationSlider, durationValue);
  settingsContainer.append(delayContainer, durationContainer);

  var updateBtn = document.createElement("span");
  updateBtn.className = "update-lyrics-btn";
  updateBtn.title = config.languageLabels.updateLyrics || "Şarkı sözünü güncelle";
  updateBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
  updateBtn.addEventListenerfunction("click", () {
    var track = getCurrentLyricsTrack();
    if (track) updateSingleTrackLyrics(track.Id);
  });

  headerContainer.append(settingsContainer, updateBtn);
  musicPlayerState.lyricsContainer.appendChild(headerContainer);

  contentContainer = document.createElement("div");
  contentContainer.className = "lyrics-content-container";
  musicPlayerState.lyricsContainer.appendChild(contentContainer);

  settingsRefs = { delaySlider, delayValue, durationSlider, durationValue };
  settingsInitialized = true;
}

function updateSettingsUIFromStorage() {
  if (!settingsRefs) return;
  var delay = localStorage.getItem("lyricsDelay") || "0";
  var duration = localStorage.getItem("lyricsDuration") || "5";
  settingsRefs.delaySlider.value = delay;
  settingsRefs.delayValue.textContent = (delay) + "s";
  musicPlayerState.lyricsDelay = parseFloat(delay);
  settingsRefs.durationSlider.value = duration;
  settingsRefs.durationValue.textContent = (duration) + "s";
  musicPlayerState.lyricsDuration = parseFloat(duration);
}

function setLoading() {
  ensureSettingsUI();
  safeClear(contentContainer);
  var loading = document.createElement("div");
  loading.className = "lyrics-loading";
  loading.textContent = config.languageLabels.loadingLyrics || "Yükleniyor...";
  contentContainer.appendChild(loading);
}

function setNoLyrics(message = "") {
  ensureSettingsUI();
  safeClear(contentContainer);
  var n = document.createElement("div");
  n.className = "lyrics-not-found";
  n.textContent = message || config.languageLabels.noLyricsFound || "Şarkı sözü yok";
  contentContainer.appendChild(n);
}

function setError(msg) {
  ensureSettingsUI();
  safeClear(contentContainer);
  var e = document.createElement("div");
  e.className = "lyrics-error";
  e.textContent = (config.languageLabels.lyricsError || "Hata") + ": " + (msg);
  contentContainer.appendChild(e);
}

function fetchLyricsFromServer(trackId, signal) {
  var token = getAuthToken();
  var endpoints = [
    { url: apiUrl("/Audio/" + (trackId) + "/Lyrics"), type: "text" },
    { url: apiUrl("/Items/" + (trackId) + "/Lyrics"), type: "json" },
  ];

  for (var { url, type } of endpoints) {
    try {
      var res = fetch(url, {
        headers: { "X-Emby-Token": token },
        signal,
      });

      if (res.status === 404) {
        continue;
      }
      if (!res.ok) {
        continue;
      }

      var data = (type === "json") ? res.json() : res.text();
      var lyrics = normalizeLyricsPayload(data);

      if (lyrics) {
        return lyrics;
      }
    } catch (err) {
      if (err.name === "AbortError") return null;
      continue;
    }
  }
  return null;
}

export function fetchLyrics(trackOverride = null) {
  var currentTrack = getCurrentLyricsTrack(trackOverride);
  if (!currentTrack) return null;

  if (isRadioTrack(currentTrack)) {
    setNoLyrics(config.languageLabels.radioNoLyrics || "Canli radyo yayini icin sarki sozu yok");
    return null;
  }

  updateSettingsUIFromStorage();
  stopLyricsSync();
  setLoading();
  var reqKey = buildRequestKey(currentTrack.Id, "fetchLyrics");
  currentRequestKey = reqKey;

  var cached = normalizeLyricsPayload(musicPlayerState.lyricsCache[currentTrack.Id]);
  if (reqKey !== currentRequestKey) return null;
  if (cached) {
    musicPlayerState.lyricsCache[currentTrack.Id] = cached;
    displayLyrics(cached);
    startLyricsSync();
    return cached;
  }

  var dbLyrics = normalizeLyricsPayload(musicDB.getLyrics(currentTrack.Id));
  if (reqKey !== currentRequestKey) return null;
  if (dbLyrics) {
    musicPlayerState.lyricsCache[currentTrack.Id] = dbLyrics;
    displayLyrics(dbLyrics);
    startLyricsSync();
    return dbLyrics;
  }

  cancelOngoingFetch();
  fetchAbort = new AbortController();
  currentRequestKey = reqKey;

  try {
    var serverLyrics = normalizeLyricsPayload(fetchLyricsFromServer(currentTrack.Id, fetchAbort.signal));
    if (reqKey !== currentRequestKey) return null;
    if (serverLyrics) {
      musicPlayerState.lyricsCache[currentTrack.Id] = serverLyrics;
      try { musicDB.saveLyrics(currentTrack.Id, serverLyrics); } catch {}
      displayLyrics(serverLyrics);
      startLyricsSync();
      return serverLyrics;
    }
  } catch (e) {
  }
  try {
    var embedded = normalizeLyricsPayload(getEmbeddedLyrics(currentTrack.Id));
    if (reqKey !== currentRequestKey) return null;
    if (embedded) {
      musicPlayerState.lyricsCache[currentTrack.Id] = embedded;
      try { musicDB.saveLyrics(currentTrack.Id, embedded); } catch {}
      displayLyrics(embedded);
      startLyricsSync();
      return embedded;
    }
  } catch {
  }
  if (reqKey !== currentRequestKey) return null;
  setNoLyrics();
  return null;
}

export function getEmbeddedLyrics(trackId) {
  try {
    var inMem = normalizeLyricsPayload(musicPlayerState.lyricsCache[trackId]);
    if (inMem) return inMem;

    cancelOngoingFetch();
    fetchAbort = new AbortController();

    var token = getAuthToken();
    var response = fetch(apiUrl("/Audio/" + (trackId) + "/stream.mp3?Static=true"), {
      headers: { "X-Emby-Token": token },
      signal: fetchAbort.signal
    });
    if (!response.ok) throw new Error("Stream alınamadı");

    var buffer = response.arrayBuffer();
    var lyrics = normalizeLyricsPayload(parseID3Tags(buffer));
    if (lyrics) musicPlayerState.lyricsCache[trackId] = lyrics;
    return lyrics || null;
  } catch (err) {
    return null;
  }
}

export function displayLyrics(data) {
  var normalized = normalizeLyricsPayload(data);
  if (!normalized) {
    setNoLyrics();
    return;
  }

  ensureSettingsUI();
  safeClear(contentContainer);

  musicPlayerState.lyricsContainer.scrollTop = 0;
  musicPlayerState.currentLyrics = [];
  musicPlayerState.syncedLyrics.lines = [];
  musicPlayerState.syncedLyrics.currentLine = -1;
  lastActiveIdx = -1;
  lastNextIdx = -1;

  if (typeof normalized === "object" && Array.isArray(normalized.Lyrics)) {
    renderStructuredLyrics(normalized.Lyrics, contentContainer);
  } else if (typeof normalized === "string") {
    if (normalized.includes("[")) {
      renderTimedTextLyrics(normalized, contentContainer);
    } else {
      renderPlainText(normalized, contentContainer);
    }
  }
}

function renderStructuredLyrics(lyricsArray, container) {
  var lines = [];
  var frag = document.createDocumentFragment();

  for (var i = 0; i < lyricsArray.length; i++) {
    var line = lyricsArray[i];
    var text = line.Text.trim();
    if (!text) continue;

    var time = line.Start ? line.Start / 10000000 : null;

    var lineContainer = document.createElement("div");
    lineContainer.className = "lyrics-line-container";

    if (time != null) {
      var timeEl = document.createElement("span");
      timeEl.className = "lyrics-time";
      var m = Math.floor(time / 60);
      var s = Math.floor(time % 60).toString().padStart(2, "0");
      timeEl.textContent = (m) + ":" + (s);
      lineContainer.appendChild(timeEl);
    }

    var textEl = document.createElement("div");
    textEl.className = "lyrics-text";
    textEl.textContent = text;
    lineContainer.appendChild(textEl);

    frag.appendChild(lineContainer);
    if (time != null) lines.push({ time, element: lineContainer });
  }

  container.appendChild(frag);
  musicPlayerState.currentLyrics = lines;
  musicPlayerState.syncedLyrics.lines = lines;
  musicPlayerState.syncedLyrics.currentLine = -1;
}

function renderTimedTextLyrics(text, container) {
  var lines = [];
  var frag = document.createDocumentFragment();
  var regex = /^\[(\d{2}):(\d{2})(?:\.(\d{2}))?\](.*)$/;

  var rows = text.split("\n");
  for (var i = 0; i < rows.length; i++) {
    var raw = rows[i];
    var match = raw.match(regex);
    if (match) {
      var [, m, s, /*ms*/, content] = match;
      var time = parseInt(m, 10) * 60 + parseInt(s, 10);

      var lineContainer = document.createElement("div");
      lineContainer.className = "lyrics-line-container";

      var timeEl = document.createElement("span");
      timeEl.className = "lyrics-time";
      timeEl.textContent = (m) + ":" + (s);
      lineContainer.appendChild(timeEl);

      var textEl = document.createElement("div");
      textEl.className = "lyrics-text";
      textEl.textContent = content.trim();
      lineContainer.appendChild(textEl);

      frag.appendChild(lineContainer);
      lines.push({ time, element: lineContainer });
    } else if (raw.trim()) {
      var lineContainer = document.createElement("div");
      lineContainer.className = "lyrics-line-container";
      var textEl = document.createElement("div");
      textEl.className = "lyrics-text";
      textEl.textContent = raw.trim();
      lineContainer.appendChild(textEl);
      frag.appendChild(lineContainer);
    }
  }

  container.appendChild(frag);
  musicPlayerState.currentLyrics = lines;
  musicPlayerState.syncedLyrics.lines = lines;
  musicPlayerState.syncedLyrics.currentLine = -1;
}

function renderPlainText(text, container) {
  var frag = document.createDocumentFragment();
  var rows = text.split("\n");
  for (var i = 0; i < rows.length; i++) {
    var line = rows[i];
    var lineContainer = document.createElement("div");
    lineContainer.className = "lyrics-line-container";
    var textEl = document.createElement("div");
    textEl.className = "lyrics-text";
    textEl.textContent = line;
    lineContainer.appendChild(textEl);
    frag.appendChild(lineContainer);
  }
  container.appendChild(frag);
}

export function toggleLyrics() {
  musicPlayerState.lyricsActive = !musicPlayerState.lyricsActive;
  var el = musicPlayerState.lyricsContainer;
  if (musicPlayerState.lyricsActive) {
    el.classList.add("lyrics-visible");
    el.classList.remove("lyrics-hidden");
    musicPlayerState.lyricsBtn.innerHTML = '<i class="fa-regular fa-closed-captioning"></i>';
    fetchLyrics();
  } else {
    el.classList.remove("lyrics-visible");
    el.classList.add("lyrics-hidden");
    musicPlayerState.lyricsBtn.innerHTML = '<i class="fa-regular fa-closed-captioning"></i>';
    stopLyricsSync();
    currentRequestKey = null;
    cancelOngoingFetch();
  }
}

export function showNoLyricsMessage() { setNoLyrics(); }
export function showLyricsError(msg) { setError(msg); }

export function updateSyncedLyrics(currentTime) {
  var playbackTime = typeof currentTime === "number"
    ? currentTime
    : (musicPlayerState.audio.currentTime || 0);
  var lines = musicPlayerState.currentLyrics;
  if (!lines || lines.length === 0) return;

  var delay = parseFloat(localStorage.getItem("lyricsDelay")) || 0;
  var duration = parseFloat(localStorage.getItem("lyricsDuration")) || 5;
  var t = playbackTime + delay;

  if (t < lines[0].time) {
    setActiveLine(-1, 0);
    return;
  }

  var lo = 0, hi = lines.length - 1, idx = 0;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }

  var lineStart = lines[idx].time;
  var lineEnd = lineStart + duration;

  if (t < lineEnd) {
    setActiveLine(idx, idx + 1 < lines.length ? idx + 1 : -1);
  } else if (idx + 1 < lines.length && t >= lines[idx + 1].time) {
    setActiveLine(idx + 1, idx + 2 < lines.length ? idx + 2 : -1);
  } else {
    setActiveLine(-1, idx + 1 < lines.length ? idx + 1 : -1);
  }
}

function setActiveLine(activeIdx, nextIdx) {
  if (activeIdx === lastActiveIdx && nextIdx === lastNextIdx) {
    return;
  }

  if (lastActiveIdx >= 0) {
    var prevEl = musicPlayerState.currentLyrics[lastActiveIdx].element;
    if (prevEl) {
      prevEl.classList.remove("lyrics-active");
      prevEl.querySelectorAll(".active").forEach(function(w) w.classList.remove("active"));
    }
  }
  if (lastNextIdx >= 0) {
    var prevNextEl = musicPlayerState.currentLyrics[lastNextIdx].element;
    if (prevNextEl) {
      prevNextEl.classList.remove("lyrics-next");
      var existingCheck = prevNextEl.querySelector(".next-check");
      if (existingCheck) existingCheck.remove();
    }
  }

  if (activeIdx >= 0) {
    var el = musicPlayerState.currentLyrics[activeIdx].element;
    if (el) {
      el.classList.add("lyrics-active");
      smoothScrollIntoView(el);
    }
  }

  if (nextIdx >= 0) {
    var nextEl = musicPlayerState.currentLyrics[nextIdx].element;
    if (nextEl) {
      nextEl.classList.add("lyrics-next");
      var nextup = nextEl.querySelector(".next-check");
      if (!nextup) {
        nextup = document.createElement("span");
        nextup.className = "next-check";
        nextup.innerHTML = '<i class="fas fa-arrow-right"></i>';
        nextEl.querySelector(".lyrics-text").prepend(nextup);
      }
    }
  }

  lastActiveIdx = activeIdx;
  lastNextIdx = nextIdx;
  musicPlayerState.syncedLyrics.currentLine = activeIdx;
}

function smoothScrollIntoView(element) {
  try {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    var parent = musicPlayerState.lyricsContainer;
    var containerHeight = parent.clientHeight;
    var elementRect = element.getBoundingClientRect();
    var containerRect = parent.getBoundingClientRect();
    var target = parent.scrollTop + elementRect.top - containerRect.top - (containerHeight / 2) + (elementRect.height / 2);
    parent.scrollTop = target;
  }
}

export function startLyricsSync() {
  if (musicPlayerState.audio && !audioEndedHandlerAttached) {
    var onEnded = function() {
      var container = musicPlayerState.lyricsContainer;
      if (container) container.scrollTop = 0;
      if (musicPlayerState.currentLyrics) {
        for (var line of musicPlayerState.currentLyrics) {
          var el = line.element;
          el.classList.remove("lyrics-active", "lyrics-next");
          el.querySelectorAll(".active").forEach(function(w) w.classList.remove("active"));
          var existingCheck = el.querySelector(".next-check");
          if (existingCheck) existingCheck.remove();
        }
      }
      lastActiveIdx = -1;
      lastNextIdx = -1;
    };
    musicPlayerState._lyricsOnEnded = onEnded;
    musicPlayerState.audio.addEventListener("ended", onEnded);
    audioEndedHandlerAttached = true;
  }
  updateSyncedLyrics(musicPlayerState.audio.currentTime || 0);
}

export function stopLyricsSync() {
  if (audioEndedHandlerAttached && musicPlayerState.audio && musicPlayerState._lyricsOnEnded) {
    try {
      musicPlayerState.audio.removeEventListener("ended", musicPlayerState._lyricsOnEnded);
    } catch {}
    audioEndedHandlerAttached = false;
    musicPlayerState._lyricsOnEnded = null;
  }
}

function updateSingleTrackLyrics(trackId) {
  if (String(trackId || "").startsWith("radio:")) {
    setNoLyrics(config.languageLabels.radioNoLyrics || "Canli radyo yayini icin sarki sozu yok");
    return false;
  }

  try {
    delete musicPlayerState.lyricsCache[trackId];
    musicDB.deleteLyrics(trackId);
    var track = musicPlayerState.playlist.find(function(t) t.Id === trackId)
      || (musicPlayerState.currentTrack.Id === trackId ? musicPlayerState.currentTrack : { Id: trackId });
    var lyrics = fetchLyrics(track);

    if (hasLyricsPayload(lyrics)) {
      showNotification(
        "<i class=\"fas fa-closed-captioning\"></i> " + (config.languageLabels.syncSingle),
        2000,
        "db"
      );
      return true;
    }
  } catch (err) {
    console.error("Şarkı sözü güncelleme hatası:", err);
    showNotification(
      "<i class=\"fas fa-closed-captioning-slash\"></i> " + (config.languageLabels.syncSingleError),
      2000,
      "error"
    );
  }
  return false;
}
