import { getConfig } from "./config.js";
import { closeDetailsModalIfLoaded } from "./detailsModalLoader.js";
import {
  buildCinemaPreRollCacheUrl,
  resolveCinemaPreRollLocale
} from "./cinemaPreRollLocale.js";

const TRAILER_POOL_CACHE_KEY = "jms:cinema-preroll:pool:v2";
const TRAILER_DAILY_PLAYED_KEY_PREFIX = "jms:cinema-preroll:played:v1:";
const TRAILER_POOL_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TRAILER_COUNT = 2;
const MAX_TRAILER_COUNT = 5;
const MAX_DAILY_PLAYED_IDS = 150;
const PLAYER_WATCHDOG_MS = 15_000;
const YT_API_TIMEOUT_MS = 4_500;
const YT_PLAYABILITY_PROBE_TIMEOUT_MS = 3_500;
const YT_PLAYABILITY_PROBE_READY_GRACE_MS = 1_200;
const MIN_ACCEPTABLE_YT_HEIGHT = 720;
const TRAILER_QUALITY_RETRY_DELAYS_MS = [0, 350, 1200, 2600];
const MAX_TRAILER_CANDIDATE_ATTEMPTS = 150;
const NATIVE_HOOK_SCAN_INTERVAL_MS = 2_000;
const NATIVE_HOOK_RECENT_TTL_MS = 15_000;
const NATIVE_HOOK_MAX_SCAN_MS = 5 * 60_000;
const NATIVE_PLAYBACK_CHAIN_BYPASS_MS = 12_000;
const ADULT_CONTENT_MARKERS = Object.freeze([
  "porn",
  "porno",
  "pornographic",
  "xxx",
  "adult film",
  "adult movie",
  "erotic",
  "erotica",
  "erotik",
  "softcore",
  "hardcore",
  "hentai",
  "onlyfans",
  "jav "
]);

const YT_QUALITY_HEIGHT_MAP = Object.freeze({
  tiny: 144,
  small: 240,
  medium: 360,
  large: 480,
  hd720: 720,
  hd1080: 1080,
  hd1440: 1440,
  hd2160: 2160,
  hd2880: 2880,
  hd4320: 4320,
  highres: 4320,
  auto: 0,
  default: 0
});

let youtubeApiPromise = null;
let overlayStyleInjected = false;
let nativePlaybackHookInstalled = false;
let nativePlaybackHookScanTimer = 0;
let nativePlaybackHookScanStartedAt = 0;
let nativePlaybackHookBypassDepth = 0;
let nativePlaybackHookBypassUntil = 0;
let cinemaPreRollSessionActive = false;
const nativePlaybackHookPatchedTargets = new WeakSet();
const recentNativePreRollItems = new Map();
const PANEL_HIDDEN_CLASS = "monwui-cinema-preroll--panel-hidden";
const FULLSCREEN_ACTIVE_CLASS = "monwui-cinema-preroll--fullscreen-active";

function getLabels(config = getConfig()) {
  return config?.languageLabels || {};
}

function getText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clampTrailerCount(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TRAILER_COUNT;
  return Math.min(MAX_TRAILER_COUNT, Math.max(1, parsed));
}

function shouldRunForItem(item) {
  const type = String(item?.Type || "");
  const mediaType = String(item?.MediaType || "");
  const extraType = String(item?.ExtraType || "").trim();
  const resumeTicks = Number(item?.UserData?.PlaybackPositionTicks || 0);

  if (extraType) return false;
  if (resumeTicks > 0) return false;
  if (mediaType && mediaType !== "Video") return false;
  return type === "Movie" || type === "Episode";
}

function getItemId(item) {
  return String(item?.Id || item?.id || item?.ItemId || item?.itemId || "").trim();
}

function pruneRecentNativePreRollItems() {
  const now = Date.now();
  for (const [itemId, timestamp] of recentNativePreRollItems) {
    if (!Number.isFinite(timestamp) || now - timestamp > NATIVE_HOOK_RECENT_TTL_MS) {
      recentNativePreRollItems.delete(itemId);
    }
  }
}

function markNativePreRollAttempt(itemId) {
  const id = String(itemId || "").trim();
  if (!id) return;
  pruneRecentNativePreRollItems();
  recentNativePreRollItems.set(id, Date.now());
}

function markNativePreRollAttemptIds(...itemIds) {
  for (const itemId of itemIds) {
    markNativePreRollAttempt(itemId);
  }
}

function wasNativePreRollRecentlyAttempted(itemId) {
  const id = String(itemId || "").trim();
  if (!id) return false;
  pruneRecentNativePreRollItems();
  const timestamp = recentNativePreRollItems.get(id);
  return Number.isFinite(timestamp) && Date.now() - timestamp <= NATIVE_HOOK_RECENT_TTL_MS;
}

function armNativePlaybackChainBypass(delayMs = NATIVE_PLAYBACK_CHAIN_BYPASS_MS) {
  nativePlaybackHookBypassUntil = Math.max(
    nativePlaybackHookBypassUntil,
    Date.now() + Math.max(0, Number(delayMs) || 0)
  );
}

export function armCinemaPreRollNativePlaybackBypass({
  itemId = "",
  itemIds = [],
  delayMs = NATIVE_PLAYBACK_CHAIN_BYPASS_MS
} = {}) {
  armNativePlaybackChainBypass(delayMs);
  markNativePreRollAttemptIds(itemId, ...(Array.isArray(itemIds) ? itemIds : []));
  return true;
}

function readPoolCache(cacheKey) {
  try {
    const raw = localStorage.getItem(TRAILER_POOL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.cacheKey !== cacheKey) return null;
    if (Number(parsed?.expiresAt || 0) < Date.now()) return null;
    return Array.isArray(parsed?.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

function writePoolCache(cacheKey, items) {
  try {
    localStorage.setItem(TRAILER_POOL_CACHE_KEY, JSON.stringify({
      cacheKey,
      expiresAt: Date.now() + TRAILER_POOL_TTL_MS,
      items
    }));
  } catch {}
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDailyPlayedStorageKey(cacheKey) {
  const safeKey = encodeURIComponent(String(cacheKey || "default").trim() || "default");
  return `${TRAILER_DAILY_PLAYED_KEY_PREFIX}${safeKey}`;
}

function readDailyPlayedTrailerIds(cacheKey) {
  try {
    const raw = localStorage.getItem(buildDailyPlayedStorageKey(cacheKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.date !== getLocalDateKey()) return [];
    const source = Array.isArray(parsed?.ids) ? parsed.ids : [];
    return source
      .map((value) => Number(value))
      .filter(Number.isFinite)
      .slice(-MAX_DAILY_PLAYED_IDS);
  } catch {
    return [];
  }
}

function writeDailyPlayedTrailerIds(cacheKey, ids) {
  try {
    const uniqueIds = [];
    const seen = new Set();
    for (const value of Array.isArray(ids) ? ids : []) {
      const id = Number(value);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      uniqueIds.push(id);
    }

    localStorage.setItem(buildDailyPlayedStorageKey(cacheKey), JSON.stringify({
      date: getLocalDateKey(),
      ids: uniqueIds.slice(-MAX_DAILY_PLAYED_IDS)
    }));
  } catch {}
}

function shuffleInPlace(input = []) {
  const list = [...input];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function looksAdultTrailerItem(item) {
  if (item?.adult === true || item?.Adult === true) return true;
  const text = [
    item?.title,
    item?.Title,
    item?.videoName,
    item?.VideoName,
    item?.overview,
    item?.Overview
  ].map((value) => String(value || "").trim()).join(" ").toLowerCase();
  if (!text) return false;
  return ADULT_CONTENT_MARKERS.some((marker) => text.includes(marker));
}

async function fetchCinemaPreRollCache(locale, { signal } = {}) {
  const url = buildCinemaPreRollCacheUrl(locale);
  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal
  });
  const rawText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Cinema pre-roll cache HTTP ${response.status}`);
  }

  if (!rawText.trim()) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

function normalizeCacheItems(payload) {
  const source = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.Items) ? payload.Items : []);
  return source
    .map((item) => ({
      tmdbId: Number(item?.tmdbId ?? item?.TmdbId),
      youtubeKey: String(item?.youtubeKey ?? item?.YoutubeKey ?? "").trim(),
      videoName: String(item?.videoName ?? item?.VideoName ?? "").trim(),
      title: String(item?.title ?? item?.Title ?? "").trim(),
      overview: String(item?.overview ?? item?.Overview ?? "").trim(),
      releaseDate: String(item?.releaseDate ?? item?.ReleaseDate ?? "").trim(),
      backdropUrl: String(item?.backdropUrl ?? item?.BackdropUrl ?? "").trim(),
      posterUrl: String(item?.posterUrl ?? item?.PosterUrl ?? "").trim(),
      sourceList: String(item?.sourceList ?? item?.SourceList ?? "").trim(),
      adult: item?.adult === true || item?.Adult === true
    }))
    .filter((item) => Number.isFinite(item.tmdbId) && item.youtubeKey && !looksAdultTrailerItem(item));
}

async function fetchNowPlayingTrailerPool({ signal } = {}) {
  const locale = resolveCinemaPreRollLocale();
  const cached = readPoolCache(locale.cacheKey) || [];

  const payload = await fetchCinemaPreRollCache(locale, { signal }).catch(() => null);
  const items = normalizeCacheItems(payload);

  if (items.length) {
    writePoolCache(locale.cacheKey, items);
    return items;
  }

  return cached;
}

function toTrailerIdSet(values = []) {
  const out = new Set();
  for (const value of values instanceof Set ? Array.from(values) : (Array.isArray(values) ? values : [])) {
    const id = Number(value);
    if (Number.isFinite(id)) out.add(id);
  }
  return out;
}

function buildTrailerCandidateQueue(items = [], cacheKey = "default", {
  excludeIds = null,
  allowReset = true
} = {}) {
  const playedIds = new Set(readDailyPlayedTrailerIds(cacheKey));
  const excludedIds = toTrailerIdSet(excludeIds);
  const freshItems = [];
  const allItems = [];
  const poolIds = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.youtubeKey) continue;
    const tmdbId = Number(item?.tmdbId);
    if (!Number.isFinite(tmdbId) || poolIds.has(tmdbId)) continue;
    poolIds.add(tmdbId);
    if (excludedIds.has(tmdbId)) continue;
    allItems.push(item);
    if (!playedIds.has(tmdbId)) {
      freshItems.push(item);
    }
  }

  if (freshItems.length) {
    return shuffleInPlace(freshItems);
  }

  if (allItems.length && allowReset) {
    writeDailyPlayedTrailerIds(cacheKey, []);
  }

  return shuffleInPlace(allItems);
}

function getTrailerCandidateAttemptLimit(requestedCount, poolCount) {
  const desired = Math.max(
    requestedCount,
    MAX_TRAILER_CANDIDATE_ATTEMPTS
  );
  return Math.min(Math.max(0, Number(poolCount) || 0), desired);
}

function markTrailersAsShown(items = [], cacheKey = "default") {
  const existing = readDailyPlayedTrailerIds(cacheKey);
  const nextIds = items
    .map((item) => Number(item?.tmdbId))
    .filter(Number.isFinite);
  writeDailyPlayedTrailerIds(cacheKey, [...existing, ...nextIds]);
}

function getYouTubeQualityHeight(level) {
  const normalized = String(level || "").trim().toLowerCase();
  return YT_QUALITY_HEIGHT_MAP[normalized] ?? 0;
}

function getSortedYouTubeQualityLevels(levels = []) {
  return [...new Set(
    (Array.isArray(levels) ? levels : [])
      .map((level) => String(level || "").trim().toLowerCase())
      .filter(Boolean)
  )].sort((left, right) => getYouTubeQualityHeight(left) - getYouTubeQualityHeight(right));
}

function pickPreferredYouTubeQualityLevel(player) {
  const levels = getSortedYouTubeQualityLevels(player?.getAvailableQualityLevels?.() || []);
  const minimumAllowed = levels.find((level) => getYouTubeQualityHeight(level) >= MIN_ACCEPTABLE_YT_HEIGHT);
  if (minimumAllowed) return minimumAllowed;
  return levels.at(-1) || "hd720";
}

function enforceMinimumTrailerQuality(player, preferredLevel = "") {
  if (!player || typeof player.setPlaybackQuality !== "function") return null;

  const available = getSortedYouTubeQualityLevels(player?.getAvailableQualityLevels?.() || []);
  const current = String(player?.getPlaybackQuality?.() || "").trim().toLowerCase();
  const hasHdOrAbove = available.some((level) => getYouTubeQualityHeight(level) >= MIN_ACCEPTABLE_YT_HEIGHT);

  let target = String(preferredLevel || "").trim().toLowerCase();
  if (!target || !available.includes(target)) {
    target = pickPreferredYouTubeQualityLevel(player);
  }

  if (!target) return { available, current, target: "", hasHdOrAbove };

  try { player.setPlaybackQuality(target); } catch {}
  try { player.setPlaybackQualityRange?.(target); } catch {}

  if (
    hasHdOrAbove &&
    getYouTubeQualityHeight(current) > 0 &&
    getYouTubeQualityHeight(current) < MIN_ACCEPTABLE_YT_HEIGHT
  ) {
    try { player.setPlaybackQuality(target); } catch {}
    try { player.setPlaybackQualityRange?.(target); } catch {}
  }

  return { available, current, target, hasHdOrAbove };
}

function isDocumentFullscreenActive() {
  return !!getActiveFullscreenElement();
}

function getActiveFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  );
}

async function requestElementFullscreen(element) {
  if (!element) return false;
  const request =
    element.requestFullscreen ||
    element.webkitRequestFullscreen ||
    element.mozRequestFullScreen ||
    element.msRequestFullscreen;
  if (typeof request !== "function") return false;

  try {
    await request.call(element);
    return isDocumentFullscreenActive();
  } catch {
    return false;
  }
}

async function exitElementFullscreenIfNeeded(element) {
  const active = getActiveFullscreenElement();
  if (!active || !element || active !== element) return false;

  const exit =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.mozCancelFullScreen ||
    document.msExitFullscreen;
  if (typeof exit !== "function") return false;

  try {
    await exit.call(document);
    return true;
  } catch {
    return false;
  }
}

function getCinemaFullscreenTarget(overlay) {
  return document.documentElement || overlay;
}

function updateFullscreenButtonState(overlay) {
  const button = overlay?.querySelector?.('[data-action="fullscreen"]');
  if (!button) return;

  const labels = getLabels();
  const isFullscreen = isDocumentFullscreenActive();
  const label = isFullscreen
    ? getText(labels.cinemaPreRollExitFullscreen, "Tam ekrandan çık")
    : getText(labels.cinemaPreRollFullscreen, "Tam ekran");
  const icon = button.querySelector("i");

  button.classList.toggle("is-active", isFullscreen);
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  if (icon) {
    icon.className = isFullscreen ? "fa-solid fa-compress" : "fa-solid fa-expand";
  }

  updatePanelToggleState(overlay);
}

function setCinemaPanelHidden(overlay, hidden) {
  if (!overlay) return false;

  const shouldHide = !!hidden && isDocumentFullscreenActive();
  overlay.classList.toggle(PANEL_HIDDEN_CLASS, shouldHide);
  updatePanelToggleState(overlay);
  return shouldHide;
}

function toggleCinemaPanel(overlay) {
  if (!overlay || !isDocumentFullscreenActive()) return setCinemaPanelHidden(overlay, false);
  return setCinemaPanelHidden(overlay, !overlay.classList.contains(PANEL_HIDDEN_CLASS));
}

function updatePanelToggleState(overlay) {
  if (!overlay) return;

  const fullscreenActive = isDocumentFullscreenActive();
  overlay.classList.toggle(FULLSCREEN_ACTIVE_CLASS, fullscreenActive);
  if (!fullscreenActive) {
    overlay.classList.remove(PANEL_HIDDEN_CLASS);
  }

  const button = overlay.querySelector?.('[data-action="panel-toggle"]');
  if (!button) return;

  const labels = getLabels();
  const hidden = fullscreenActive && overlay.classList.contains(PANEL_HIDDEN_CLASS);
  const label = hidden
    ? getText(labels.cinemaPreRollShowPanel, "Bilgi panelini göster")
    : getText(labels.cinemaPreRollHidePanel, "Bilgi panelini gizle");
  const icon = button.querySelector("i");

  button.hidden = !fullscreenActive;
  button.classList.toggle("is-active", hidden);
  button.setAttribute("aria-pressed", hidden ? "true" : "false");
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  if (icon) {
    icon.className = hidden ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
  }
}

async function enterCinemaFullscreen(overlay, sessionState = {}) {
  if (!overlay || isDocumentFullscreenActive()) return false;

  const target = getCinemaFullscreenTarget(overlay);
  const entered = await requestElementFullscreen(target);
  if (entered) {
    sessionState.enteredFullscreen = true;
    sessionState.fullscreenElement = target;
    sessionState.keepFullscreenForNativePlayback = target === document.documentElement;
    overlay.classList.add("monwui-cinema-preroll--immersive");
  }
  updateFullscreenButtonState(overlay);
  return entered;
}

async function toggleCinemaFullscreen(overlay, sessionState = {}) {
  const active = getActiveFullscreenElement();
  if (active) {
    const exit =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;
    if (typeof exit === "function") {
      try { await exit.call(document); } catch {}
    }
    sessionState.keepFullscreenForNativePlayback = false;
    updateFullscreenButtonState(overlay);
    return false;
  }

  return enterCinemaFullscreen(overlay, sessionState);
}

async function maybeEnterTrailerFullscreen(overlay, sessionState = {}) {
  if (!sessionState?.prefersFullscreen) return false;
  if (!overlay || sessionState.enteredFullscreen === true || isDocumentFullscreenActive()) return false;

  return enterCinemaFullscreen(overlay, sessionState);
}

function ensureOverlayStyle() {
  if (overlayStyleInjected) return;
  overlayStyleInjected = true;

  const style = document.createElement("style");
  style.id = "monwui-cinema-preroll-style";
  style.textContent = `
    .monwui-cinema-preroll {
      position: fixed;
      inset: 0;
      z-index: 2147483643;
      display: flex;
      align-items: stretch;
      justify-content: center;
      background:
        radial-gradient(circle at 20% 20%, rgba(255,180,92,.14), transparent 30%),
        radial-gradient(circle at 80% 16%, rgba(255,255,255,.10), transparent 24%),
        linear-gradient(180deg, rgba(5,7,10,.94), rgba(3,4,6,.985));
      color: #f7f1e7;
      overflow: hidden;
      padding: 16px;
      box-sizing: border-box;
    }
    .monwui-cinema-preroll::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image: linear-gradient(transparent 96%, rgba(255,255,255,.025) 100%);
      background-size: 100% 4px;
      opacity: .35;
      pointer-events: none;
    }
    .monwui-cinema-preroll__bg {
      position: absolute;
      inset: -8%;
      background-position: center;
      background-size: cover;
      filter: blur(22px) saturate(1.05);
      opacity: .34;
      transform: scale(1.08);
    }
    .monwui-cinema-preroll__scrim {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(4,4,5,.9) 0%, rgba(4,4,5,.62) 35%, rgba(4,4,5,.56) 100%),
        linear-gradient(180deg, rgba(4,4,5,.2) 0%, rgba(4,4,5,.85) 100%);
    }
    .monwui-cinema-preroll__shell {
      position: relative;
      z-index: 1;
      width: min(1280px, 100%);
      height: min(100%, calc(100vh - 32px));
      max-height: calc(100vh - 32px);
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(280px, .7fr);
      gap: 22px;
      align-items: stretch;
    }
    .monwui-cinema-preroll__player {
      position: relative;
      min-height: 0;
      height: 100%;
      border-radius: 28px;
      overflow: hidden;
      box-shadow: 0 36px 84px rgba(0,0,0,.46);
      background: #040404;
      border: 1px solid rgba(255,255,255,.09);
    }
    .monwui-cinema-preroll__iconButton {
      appearance: none;
      position: absolute;
      z-index: 4;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      padding: 0;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(5,7,10,.58);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 12px 30px rgba(0,0,0,.28);
      transition: background-color .18s ease, border-color .18s ease, transform .18s ease, opacity .18s ease;
    }
    .monwui-cinema-preroll__iconButton:hover {
      background: rgba(22,24,28,.78);
      border-color: rgba(255,255,255,.28);
      transform: translateY(-1px);
    }
    .monwui-cinema-preroll__iconButton:focus-visible {
      outline: 2px solid #f3c275;
      outline-offset: 2px;
    }
    .monwui-cinema-preroll__fullscreen {
      top: 44px;
      right: 28px;
    }
    .monwui-cinema-preroll__panelToggle {
      top: 94px;
      right: 28px;
      display: none;
    }
    .monwui-cinema-preroll--fullscreen-active .monwui-cinema-preroll__panelToggle {
      display: inline-flex;
    }
    .monwui-cinema-preroll__playerMount,
    .monwui-cinema-preroll__playerMount iframe {
      width: 100%;
      height: 100%;
    }
    .monwui-cinema-preroll__panelWrap {
      position: relative;
      padding: 10px;
      overflow: hidden;
      border-radius: 28px;
      background: linear-gradient(180deg, rgba(17, 18, 20, .84), rgba(8, 8, 10, .78));
      border: 1px solid rgba(255, 255, 255, .10);
      box-shadow: 0 24px 60px rgba(0, 0, 0, .28);
      transition: opacity .18s ease, visibility .18s ease, transform .18s ease;
    }
    .monwui-cinema-preroll__panel {
      position: relative;
      display: flex;
      width: 100%;
      justify-content: space-between;
      gap: 18px;
      min-height: 0;
      overflow: auto;
      flex-direction: column;
      height: 100%;
      align-items: center;
      scrollbar-width: thin;
      scrollbar-color: #f3c275 transparent;
      box-sizing: border-box;
    }
      .monwui-cinema-preroll__eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 11px;
        letter-spacing: .28em;
        text-transform: uppercase;
        color: rgba(255,235,208,.72);
    }
    .monwui-cinema-preroll__counter {
      font-size: 12px;
      letter-spacing: .22em;
      text-transform: uppercase;
      color: rgba(255,255,255,.54);
    }
    .monwui-cinema-preroll__title {
      margin: 10px 0 6px;
      font-size: clamp(30px, 3vw, 44px);
      line-height: 1.02;
      font-weight: 800;
      letter-spacing: -.03em;
      color: #fff4df;
    }
    .monwui-cinema-preroll__meta {
      font-size: 14px;
      color: rgba(255,245,229,.72);
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    .monwui-cinema-preroll__overview {
      margin: 0;
      font-size: 14px;
      line-height: 1.65;
      color: rgba(255,250,242,.74);
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 7;
      overflow: hidden;
    }
    .monwui-cinema-preroll__overviewWrap {
      margin: 16px 0 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
    }
    .monwui-cinema-preroll__overview--expanded {
      display: block;
      -webkit-line-clamp: unset;
      overflow: visible;
    }
    .monwui-cinema-preroll__overviewToggle {
      appearance: none;
      padding: 0;
      border: none;
      background: none;
      color: #f3c275;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .02em;
      cursor: pointer;
    }
    .monwui-cinema-preroll__overviewToggle:hover {
      color: #f8e0b2;
    }
    .monwui-cinema-preroll__posterWrap {
      display: flex;
      justify-content: flex-start;
    }
    .monwui-cinema-preroll__poster {
      width: min(100%, 240px);
      aspect-ratio: 2 / 3;
      object-fit: cover;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,.11);
      box-shadow: 0 24px 50px rgba(0,0,0,.32);
      background: rgba(255,255,255,.06);
    }
    .monwui-cinema-preroll__actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .monwui-cinema-preroll__button {
      appearance: none;
      border: none;
      border-radius: 999px;
      padding: 12px 18px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .03em;
      cursor: pointer;
      transition: transform .18s ease, opacity .18s ease, background-color .18s ease;
    }
    .monwui-cinema-preroll__button:hover {
      transform: translateY(-1px);
    }
    .monwui-cinema-preroll__button--primary {
      background: linear-gradient(135deg, #f3c275, #f8e0b2);
      color: #111;
    }
    .monwui-cinema-preroll__button--ghost {
      background: rgba(255,255,255,.08);
      color: #fff4df;
      border: 1px solid rgba(255,255,255,.10);
    }
    .monwui-cinema-preroll--immersive {
      padding: 0;
      background: #000;
    }
    .monwui-cinema-preroll--immersive::before,
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__bg,
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__scrim {
      display: none;
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__shell {
      width: 100%;
      height: 100%;
      max-height: none;
      grid-template-columns: 1fr;
      gap: 0;
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__player {
      border-radius: 0;
      border: none;
      box-shadow: none;
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__fullscreen {
      top: 48px;
      right: 18px;
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__panelToggle {
      top: 100px;
      right: 18px;
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__panelWrap {
      position: absolute;
      right: 18px;
      bottom: 130px;
      width: min(420px, calc(100% - 36px));
      max-height: min(52vh, 420px);
      overflow: auto;
      z-index: 1;
      scrollbar-width: thin;
      scrollbar-color: #f3c275 transparent;
    }
    .monwui-cinema-preroll--immersive.monwui-cinema-preroll--panel-hidden .monwui-cinema-preroll__panelWrap {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(12px);
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__panel {
      height: auto;
      padding: 18px;
      gap: 14px;
      overflow: visible;
      background: linear-gradient(180deg, rgba(10,11,12,.56), rgba(7,7,8,.76));
      border-color: rgba(255,255,255,.12);
      box-shadow: 0 20px 48px rgba(0,0,0,.34);
      border-radius: 24px;
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__posterWrap {
      display: none;
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__title {
      font-size: clamp(24px, 2.2vw, 34px);
    }
    .monwui-cinema-preroll--immersive .monwui-cinema-preroll__overview {
      font-size: 13px;
      line-height: 1.55;
    }
    @media (max-width: 980px) {
      .monwui-cinema-preroll__shell {
        width: 100%;
        height: min(100%, calc(100vh - 32px));
        grid-template-columns: 1fr;
        grid-template-rows: minmax(220px, 1fr) auto;
      }
      .monwui-cinema-preroll__player {
        min-height: 220px;
      }
      .monwui-cinema-preroll__panel {
        padding: 18px;
        max-height: 42vh;
        box-sizing: border-box
      }
      .monwui-cinema-preroll__posterWrap {
        display: none;
      }
      .monwui-cinema-preroll--immersive .monwui-cinema-preroll__shell {
        height: 100%;
      }
      .monwui-cinema-preroll--immersive .monwui-cinema-preroll__panelWrap {
        right: 0;
        bottom: 12px;
        width: calc(100% - 24px);
        max-height: 38vh;
      }
      .monwui-cinema-preroll--immersive .monwui-cinema-preroll__fullscreen,.monwui-cinema-preroll__fullscreen {
        display: none
      }
      .monwui-cinema-preroll--immersive .monwui-cinema-preroll__panel {
        padding: 14px;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureOverlayDom({ immersive = false, sessionState = {} } = {}) {
  ensureOverlayStyle();
  const labels = getLabels();
  const fullscreenLabel = escapeAttribute(getText(labels.cinemaPreRollFullscreen, "Tam ekran"));
  const panelToggleLabel = escapeAttribute(getText(labels.cinemaPreRollHidePanel, "Bilgi panelini gizle"));

  const overlay = document.createElement("div");
  overlay.className = "monwui-cinema-preroll";
  if (immersive) overlay.classList.add("monwui-cinema-preroll--immersive");
  overlay.innerHTML = `
    <div class="monwui-cinema-preroll__bg"></div>
    <div class="monwui-cinema-preroll__scrim"></div>
    <div class="monwui-cinema-preroll__shell">
      <div class="monwui-cinema-preroll__player">
        <button type="button" class="monwui-cinema-preroll__iconButton monwui-cinema-preroll__fullscreen" data-action="fullscreen" aria-label="${fullscreenLabel}" title="${fullscreenLabel}">
          <i class="fa-solid fa-expand" aria-hidden="true"></i>
        </button>
        <button type="button" class="monwui-cinema-preroll__iconButton monwui-cinema-preroll__panelToggle" data-action="panel-toggle" aria-label="${panelToggleLabel}" title="${panelToggleLabel}" aria-pressed="false" hidden>
          <i class="fa-solid fa-eye-slash" aria-hidden="true"></i>
        </button>
        <div class="monwui-cinema-preroll__playerMount"></div>
      </div>
      <div class="monwui-cinema-preroll__panelWrap">
        <div class="monwui-cinema-preroll__panel">
          <div>
            <div class="monwui-cinema-preroll__eyebrow">${labels.cinemaPreRollBadge || "Cinema Pre-Roll"}</div>
            <div class="monwui-cinema-preroll__counter"></div>
            <h2 class="monwui-cinema-preroll__title"></h2>
            <div class="monwui-cinema-preroll__meta"></div>
            <div class="monwui-cinema-preroll__overviewWrap">
              <p class="monwui-cinema-preroll__overview"></p>
              <button type="button" class="monwui-cinema-preroll__overviewToggle" hidden>${labels.cinemaPreRollOverviewMore || "Show more"}</button>
            </div>
          </div>
          <div class="monwui-cinema-preroll__posterWrap">
            <img class="monwui-cinema-preroll__poster" alt="">
          </div>
          <div>
            <div class="monwui-cinema-preroll__actions">
              <button type="button" class="monwui-cinema-preroll__button monwui-cinema-preroll__button--primary" data-action="next">${labels.cinemaPreRollNextTrailer || "Next Trailer"}</button>
              <button type="button" class="monwui-cinema-preroll__button monwui-cinema-preroll__button--ghost" data-action="skip">${labels.cinemaPreRollSkip || "Skip Trailers"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  const overview = overlay.querySelector(".monwui-cinema-preroll__overview");
  const overviewToggle = overlay.querySelector(".monwui-cinema-preroll__overviewToggle");
  overviewToggle?.addEventListener("click", () => {
    if (!overview || overview.classList.contains("monwui-cinema-preroll__overview--expanded")) return;
    overview.classList.add("monwui-cinema-preroll__overview--expanded");
    overviewToggle.hidden = true;
    overviewToggle.setAttribute("aria-expanded", "true");
  });
  const fullscreenButton = overlay.querySelector('[data-action="fullscreen"]');
  const panelToggleButton = overlay.querySelector('[data-action="panel-toggle"]');
  const onFullscreenChange = () => updateFullscreenButtonState(overlay);
  fullscreenButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void toggleCinemaFullscreen(overlay, sessionState);
  });
  panelToggleButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCinemaPanel(overlay);
  });
  [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange"
  ].forEach((eventName) => {
    try { document.addEventListener(eventName, onFullscreenChange); } catch {}
  });
  overlay.__jmsCinemaPreRollCleanup = () => {
    [
      "fullscreenchange",
      "webkitfullscreenchange",
      "mozfullscreenchange",
      "MSFullscreenChange"
    ].forEach((eventName) => {
      try { document.removeEventListener(eventName, onFullscreenChange); } catch {}
    });
  };
  document.body.appendChild(overlay);
  updateFullscreenButtonState(overlay);
  return overlay;
}

function updateOverviewState(overlay) {
  const labels = getLabels();
  const overview = overlay.querySelector(".monwui-cinema-preroll__overview");
  const overviewToggle = overlay.querySelector(".monwui-cinema-preroll__overviewToggle");

  if (!overview || !overviewToggle) return;

  overview.classList.remove("monwui-cinema-preroll__overview--expanded");
  overviewToggle.hidden = true;
  overviewToggle.textContent = labels.cinemaPreRollOverviewMore || "Show more";
  overviewToggle.setAttribute("aria-expanded", "false");

  window.requestAnimationFrame(() => {
    if (!overview.isConnected || !overviewToggle.isConnected) return;
    overviewToggle.hidden = overview.scrollHeight <= overview.clientHeight + 1;
  });
}

async function ensureYouTubeApi() {
  if (typeof window.YT !== "undefined" && typeof window.YT.Player === "function") {
    return true;
  }
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { prevReady?.(); } catch {}
      finish(true);
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }

    setTimeout(() => {
      finish(typeof window.YT !== "undefined" && typeof window.YT.Player === "function");
    }, YT_API_TIMEOUT_MS);
  }).finally(() => {
    youtubeApiPromise = null;
  });

  return youtubeApiPromise;
}

function isProbePlayableYouTubeState(state) {
  if (!Number.isFinite(Number(state))) return false;
  const states = window.YT?.PlayerState || {};
  return (
    state === states.CUED ||
    state === states.BUFFERING ||
    state === states.PLAYING ||
    state === states.PAUSED
  );
}

async function probeYouTubeTrailerPlayable(trailer) {
  const videoId = String(trailer?.youtubeKey || "").trim();
  if (!videoId || typeof window.YT?.Player !== "function") return false;

  return await new Promise((resolve) => {
    let settled = false;
    let player = null;
    let readyGraceTimer = 0;
    let watchdogTimer = 0;
    const mount = document.createElement("div");

    Object.assign(mount.style, {
      position: "fixed",
      left: "-10000px",
      top: "-10000px",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
      overflow: "hidden"
    });
    mount.setAttribute("aria-hidden", "true");
    document.body?.appendChild(mount);

    const finish = (playable) => {
      if (settled) return;
      settled = true;
      try { clearTimeout(readyGraceTimer); } catch {}
      try { clearTimeout(watchdogTimer); } catch {}
      try { player?.destroy?.(); } catch {}
      try { mount.remove(); } catch {}
      resolve(playable === true);
    };

    watchdogTimer = window.setTimeout(() => finish(false), YT_PLAYABILITY_PROBE_TIMEOUT_MS);

    try {
      player = new window.YT.Player(mount, {
        host: "https://www.youtube-nocookie.com",
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady(event) {
            try {
              event.target.mute?.();
              event.target.cueVideoById?.({
                videoId,
                suggestedQuality: "hd720"
              });
              readyGraceTimer = window.setTimeout(() => finish(true), YT_PLAYABILITY_PROBE_READY_GRACE_MS);
            } catch {
              finish(false);
            }
          },
          onStateChange(event) {
            if (isProbePlayableYouTubeState(event?.data)) {
              finish(true);
            }
          },
          onError(event) {
            const code = Number(event?.data);
            if ([2, 5, 100, 101, 150].includes(code) || Number.isFinite(code)) {
              finish(false);
            }
          }
        }
      });
    } catch {
      finish(false);
    }
  });
}

function setOverlayContent(overlay, trailer, index, total) {
  const labels = getLabels();
  const bg = overlay.querySelector(".monwui-cinema-preroll__bg");
  const counter = overlay.querySelector(".monwui-cinema-preroll__counter");
  const title = overlay.querySelector(".monwui-cinema-preroll__title");
  const meta = overlay.querySelector(".monwui-cinema-preroll__meta");
  const overview = overlay.querySelector(".monwui-cinema-preroll__overview");
  const poster = overlay.querySelector(".monwui-cinema-preroll__poster");

  if (bg) {
    bg.style.backgroundImage = trailer?.backdropUrl
      ? `url("${trailer.backdropUrl}")`
      : (trailer?.posterUrl ? `url("${trailer.posterUrl}")` : "");
  }
  if (counter) counter.textContent = `${index + 1} / ${total}`;
  if (title) title.textContent = trailer?.title || labels.cinemaPreRollFallbackTitle || "Trailer";
  if (meta) {
    const releaseYear = String(trailer?.releaseDate || "").slice(0, 4);
    meta.innerHTML = "";
    [releaseYear, trailer?.videoName || labels.cinemaPreRollFallbackVideoName || "Now Playing"].filter(Boolean).forEach((value) => {
      const chip = document.createElement("span");
      chip.textContent = value;
      meta.appendChild(chip);
    });
  }
  if (overview) {
    overview.textContent = trailer?.overview || labels.cinemaPreRollFallbackOverview || "Coming Soon";
  }
  updateOverviewState(overlay);
  if (poster) {
    if (trailer?.posterUrl) {
      poster.src = trailer.posterUrl;
      poster.alt = trailer?.title || "Poster";
      poster.style.visibility = "visible";
    } else {
      poster.removeAttribute("src");
      poster.alt = "";
      poster.style.visibility = "hidden";
    }
  }
}

async function playSingleTrailer(overlay, trailer, index, total, sessionState = {}) {
  setOverlayContent(overlay, trailer, index, total);

  const mount = overlay.querySelector(".monwui-cinema-preroll__playerMount");
  if (!mount) return { action: "unplayable", played: false };
  mount.innerHTML = "";

  return new Promise((resolve) => {
    let settled = false;
    let player = null;
    let playbackConfirmed = false;
    let watchdogId = 0;
    const qualityTimerIds = new Set();

    const scheduleQualityEnforcement = (targetPlayer, delays = TRAILER_QUALITY_RETRY_DELAYS_MS) => {
      if (!targetPlayer) return;
      (Array.isArray(delays) ? delays : []).forEach((delay) => {
        const timerId = window.setTimeout(() => {
          qualityTimerIds.delete(timerId);
          enforceMinimumTrailerQuality(targetPlayer);
        }, delay);
        qualityTimerIds.add(timerId);
      });
    };

    const cleanup = () => {
      try { clearTimeout(watchdogId); } catch {}
      qualityTimerIds.forEach((timerId) => {
        try { clearTimeout(timerId); } catch {}
      });
      qualityTimerIds.clear();
      try { overlay.removeEventListener("keydown", onKeyDown, true); } catch {}
      try { overlay.removeEventListener("pointerdown", onPointerDown, true); } catch {}
      try { nextButton.removeEventListener("click", onNextClick); } catch {}
      try { skipButton.removeEventListener("click", onSkipClick); } catch {}
      try { player?.destroy?.(); } catch {}
      mount.innerHTML = "";
    };

    const finish = (action, options = {}) => {
      if (settled) return;
      settled = true;
      const played = options.played === true || playbackConfirmed === true;
      cleanup();
      resolve({ action, played });
    };

    const nextButton = overlay.querySelector('[data-action="next"]');
    const skipButton = overlay.querySelector('[data-action="skip"]');

    const onNextClick = () => finish("next");
    const onSkipClick = () => finish("skip");
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish("skip");
      }
    };
    const onPointerDown = (event) => {
      if (event?.target?.closest?.('[data-action], .monwui-cinema-preroll__overviewToggle')) return;
      void maybeEnterTrailerFullscreen(overlay, sessionState);
      try {
        player?.unMute?.();
        player?.setVolume?.(100);
        player?.playVideo?.();
        scheduleQualityEnforcement(player, [0, 600]);
      } catch {}
    };

    nextButton?.addEventListener("click", onNextClick);
    skipButton?.addEventListener("click", onSkipClick);
    overlay.addEventListener("keydown", onKeyDown, true);
    overlay.addEventListener("pointerdown", onPointerDown, true);
    overlay.tabIndex = -1;
    overlay.focus({ preventScroll: true });

    watchdogId = window.setTimeout(() => {
      if (!playbackConfirmed) finish("unplayable", { played: false });
    }, PLAYER_WATCHDOG_MS);

    try {
      player = new window.YT.Player(mount, {
        host: "https://www.youtube-nocookie.com",
        videoId: trailer.youtubeKey,
        playerVars: {
          autoplay: 1,
          controls: 1,
          fs: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          enablejsapi: 1,
          vq: "hd720",
          origin: window.location.origin
        },
        events: {
          onReady(event) {
            try {
              event.target.unMute?.();
              event.target.setVolume?.(100);
              enforceMinimumTrailerQuality(event.target);
              scheduleQualityEnforcement(event.target);
              event.target.playVideo?.();
            } catch {}
          },
          onStateChange(event) {
            if (event.data === window.YT.PlayerState.PLAYING) {
              playbackConfirmed = true;
              scheduleQualityEnforcement(event.target, [0, 900, 2200]);
            } else if (event.data === window.YT.PlayerState.ENDED) {
              finish("ended", { played: true });
            }
          },
          onPlaybackQualityChange(event) {
            const changedQuality = String(event?.data || "").trim().toLowerCase();
            const enforced = enforceMinimumTrailerQuality(event?.target);
            if (
              enforced?.hasHdOrAbove &&
              getYouTubeQualityHeight(changedQuality) > 0 &&
              getYouTubeQualityHeight(changedQuality) < MIN_ACCEPTABLE_YT_HEIGHT
            ) {
              scheduleQualityEnforcement(event?.target, [0, 450, 1300]);
            }
          },
          onError() {
            finish(playbackConfirmed ? "next" : "unplayable", { played: playbackConfirmed });
          }
        }
      });
    } catch {
      finish("unplayable", { played: false });
    }
  });
}

function getWebpackRequireForCinemaPreRollHook() {
  try {
    if (window.__jmsCinemaPreRollWebpackRequire) return window.__jmsCinemaPreRollWebpackRequire;
  } catch {}

  const chunkGlobals = [];
  try {
    if (Array.isArray(window.webpackChunk)) chunkGlobals.push(window.webpackChunk);
  } catch {}
  try {
    for (const key of Object.getOwnPropertyNames(window)) {
      if (!/^webpackChunk/i.test(key)) continue;
      const value = window[key];
      if (Array.isArray(value) && !chunkGlobals.includes(value)) {
        chunkGlobals.push(value);
      }
    }
  } catch {}

  for (const chunkGlobal of chunkGlobals) {
    try {
      let captured = null;
      const chunkId = `jms-cinema-preroll-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      chunkGlobal.push([[chunkId], {}, (req) => {
        captured = req;
      }]);
      if (typeof captured === "function") {
        try { window.__jmsCinemaPreRollWebpackRequire = captured; } catch {}
        return captured;
      }
    } catch {}
  }

  return null;
}

function collectWebpackPlaybackManagersForCinemaPreRollHook() {
  const req = getWebpackRequireForCinemaPreRollHook();
  if (!req) return [];

  const out = [];
  const add = (candidate, label) => {
    if (!candidate || typeof candidate.play !== "function") return;
    out.push({ target: candidate, label });
  };

  try {
    const direct = req(39738);
    add(direct?.f, "webpack:39738");
  } catch {}

  try {
    if (req.c) {
      for (const [moduleId, mod] of Object.entries(req.c)) {
        const candidate = mod?.exports?.f;
        if (candidate?.play && candidate?.canPlay && candidate?.getCurrentPlayer) {
          add(candidate, `webpack:${moduleId}`);
        }
      }
    }
  } catch {}

  return out;
}

function collectNativePlaybackManagersForCinemaPreRollHook() {
  const out = [];
  const seen = new Set();
  const add = (candidate, label) => {
    if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return;
    if (typeof candidate.play !== "function") return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    out.push({ target: candidate, label });
  };

  [
    [window.playbackManager, "window.playbackManager"],
    [window.MediaBrowser?.playbackManager, "MediaBrowser.playbackManager"],
    [window.MediaBrowser?.PlaybackManager, "MediaBrowser.PlaybackManager"],
    [window.Emby?.playbackManager, "Emby.playbackManager"],
    [window.Emby?.PlaybackManager, "Emby.PlaybackManager"],
    [window.appRouter?.playbackManager, "appRouter.playbackManager"],
    [window.__playbackManager, "__playbackManager"],
    [window.__jellyfinPlaybackManager, "__jellyfinPlaybackManager"],
    [window.__jmsPlaybackManager, "__jmsPlaybackManager"]
  ].forEach(([candidate, label]) => add(candidate, label));

  try {
    const keys = Object.getOwnPropertyNames(window);
    for (const key of keys) {
      if (!/playback/i.test(key)) continue;
      try { add(window[key], `window.${key}`); } catch {}
    }
  } catch {}

  for (const candidate of collectWebpackPlaybackManagersForCinemaPreRollHook()) {
    add(candidate.target, candidate.label);
  }

  return out;
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function getFirstNativePlaybackItem(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    return payload.find((item) => item && typeof item === "object" && getItemId(item)) || null;
  }
  if (payload.item && typeof payload.item === "object") return payload.item;
  if (payload.Item && typeof payload.Item === "object") return payload.Item;
  if (Array.isArray(payload.items)) return getFirstNativePlaybackItem(payload.items);
  if (Array.isArray(payload.Items)) return getFirstNativePlaybackItem(payload.Items);
  if (payload.Id || payload.id) return payload;
  return null;
}

function getFirstNativePlaybackId(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload.trim();
  if (Array.isArray(payload)) {
    for (const value of payload) {
      const id = getFirstNativePlaybackId(value);
      if (id) return id;
    }
    return "";
  }
  if (typeof payload !== "object") return "";

  const item = getFirstNativePlaybackItem(payload);
  const itemId = getItemId(item);
  if (itemId) return itemId;

  const listKeys = ["ids", "Ids", "itemIds", "ItemIds", "ItemIdsList", "PlaylistItemIds"];
  for (const key of listKeys) {
    const value = payload[key];
    if (Array.isArray(value) && value.length) {
      const id = getFirstNativePlaybackId(value[0]) || firstString(value[0]);
      if (id) return id;
    }
  }

  return firstString(
    payload.itemId,
    payload.ItemId,
    payload.id,
    payload.Id,
    payload.mediaSourceId,
    payload.MediaSourceId
  );
}

function getNativePlaybackStartTicks(payload) {
  if (!payload || typeof payload !== "object") return 0;
  const item = getFirstNativePlaybackItem(payload);
  const raw = firstString(
    payload.startPositionTicks,
    payload.StartPositionTicks,
    payload.positionTicks,
    payload.PositionTicks,
    item?.UserData?.PlaybackPositionTicks
  );
  const ticks = Number(raw);
  return Number.isFinite(ticks) ? Math.max(0, Math.floor(ticks)) : 0;
}

function extractNativePlaybackContext(args = []) {
  const list = Array.isArray(args) ? args : [];
  for (const arg of list) {
    const item = getFirstNativePlaybackItem(arg);
    const itemId = getFirstNativePlaybackId(arg);
    if (item || itemId) {
      return {
        item,
        itemId: itemId || getItemId(item),
        startPositionTicks: getNativePlaybackStartTicks(arg)
      };
    }
  }
  return { item: null, itemId: "", startPositionTicks: 0 };
}

async function fetchNativePlaybackItemDetails(itemId) {
  const id = String(itemId || "").trim();
  if (!id) return null;

  try {
    const api = await import("../../Plugins/JMSFusion/runtime/api.js");
    if (typeof api?.fetchItemDetails === "function") {
      return await api.fetchItemDetails(id);
    }
  } catch (error) {
    console.warn("[JMSFusion] Cinema pre-roll native item lookup failed:", error);
  }

  return null;
}

async function resolveNativePlaybackItem(context = {}) {
  const candidate = context?.item;
  if (candidate?.Type && getItemId(candidate)) {
    return candidate;
  }

  const itemId = context?.itemId || getItemId(candidate);
  if (!itemId) return candidate || null;

  const fetched = await fetchNativePlaybackItemDetails(itemId);
  if (fetched) return fetched;
  return candidate || { Id: itemId };
}

function shouldSkipNativePlaybackHook(context = {}) {
  if (nativePlaybackHookBypassDepth > 0 || Date.now() < nativePlaybackHookBypassUntil) return true;
  try {
    if (window.__jmsCinemaPreRollNativeHookBypass === true) return true;
  } catch {}

  const itemId = context?.itemId || getItemId(context?.item);
  if (!itemId) return true;
  return wasNativePreRollRecentlyAttempted(itemId);
}

function callOriginalNativePlay(original, target, args, { chainBypassMs = 0 } = {}) {
  if (chainBypassMs > 0) {
    armNativePlaybackChainBypass(chainBypassMs);
  }

  nativePlaybackHookBypassDepth += 1;
  try {
    return original.apply(target, args);
  } finally {
    nativePlaybackHookBypassDepth = Math.max(0, nativePlaybackHookBypassDepth - 1);
    if (chainBypassMs > 0) {
      armNativePlaybackChainBypass(chainBypassMs);
    }
  }
}

async function runNativePreRollBeforePlay(original, target, args, label) {
  const context = extractNativePlaybackContext(args);
  if (shouldSkipNativePlaybackHook(context)) {
    return callOriginalNativePlay(original, target, args);
  }
  if (context.startPositionTicks > 0) {
    return callOriginalNativePlay(original, target, args);
  }

  const item = await resolveNativePlaybackItem(context);
  const itemId = getItemId(item) || context.itemId;
  if (!itemId || !shouldRunForItem(item)) {
    return callOriginalNativePlay(original, target, args);
  }

  markNativePreRollAttemptIds(context.itemId, itemId);
  try {
    await maybePlayCinemaPreRollSession({ item, source: "native-playback-manager" });
  } catch (error) {
    console.warn(`[JMSFusion] Cinema pre-roll native hook skipped (${label || "playbackManager"}):`, error);
  }

  markNativePreRollAttemptIds(context.itemId, itemId);
  return callOriginalNativePlay(original, target, args, {
    chainBypassMs: NATIVE_PLAYBACK_CHAIN_BYPASS_MS
  });
}

function patchNativePlaybackManager(target, label) {
  if (!target || typeof target.play !== "function") return false;
  if (nativePlaybackHookPatchedTargets.has(target)) return false;
  if (target.play?.__jmsCinemaPreRollWrapped === true) {
    nativePlaybackHookPatchedTargets.add(target);
    return false;
  }

  const original = target.play;
  const wrapped = function cinemaPreRollWrappedNativePlay(...args) {
    return runNativePreRollBeforePlay(original, this || target, args, label);
  };

  try {
    Object.defineProperty(wrapped, "__jmsCinemaPreRollWrapped", { value: true });
    Object.defineProperty(wrapped, "__jmsCinemaPreRollOriginal", { value: original });
    target.play = wrapped;
    nativePlaybackHookPatchedTargets.add(target);
    return true;
  } catch {
    return false;
  }
}

function patchKnownNativePlaybackManagers() {
  if (typeof window === "undefined") return false;

  let patchedAny = false;
  for (const { target, label } of collectNativePlaybackManagersForCinemaPreRollHook()) {
    patchedAny = patchNativePlaybackManager(target, label) || patchedAny;
  }
  return patchedAny;
}

function installNativePlaybackHook() {
  if (nativePlaybackHookInstalled || typeof window === "undefined" || typeof document === "undefined") return;
  nativePlaybackHookInstalled = true;
  nativePlaybackHookScanStartedAt = Date.now();

  const scan = () => {
    patchKnownNativePlaybackManagers();
    if (
      nativePlaybackHookScanTimer &&
      Date.now() - nativePlaybackHookScanStartedAt > NATIVE_HOOK_MAX_SCAN_MS
    ) {
      window.clearInterval(nativePlaybackHookScanTimer);
      nativePlaybackHookScanTimer = 0;
    }
  };

  scan();
  nativePlaybackHookScanTimer = window.setInterval(scan, NATIVE_HOOK_SCAN_INTERVAL_MS);
  window.addEventListener("pageshow", scan, { passive: true });
  window.addEventListener("focus", scan, { passive: true });
}

export async function maybePlayCinemaPreRollSession({ item } = {}) {
  const runtimeConfig = getConfig() || {};
  if (runtimeConfig?.cinemaPreRollEnabled !== true) {
    return { played: false, reason: "disabled" };
  }
  if (!shouldRunForItem(item)) {
    return {
      played: false,
      reason: "unsupported-item",
      itemType: String(item?.Type || ""),
      mediaType: String(item?.MediaType || ""),
      extraType: String(item?.ExtraType || ""),
      resumeTicks: Number(item?.UserData?.PlaybackPositionTicks || 0)
    };
  }
  if (cinemaPreRollSessionActive) {
    return { played: false, reason: "session-active" };
  }
  markNativePreRollAttempt(getItemId(item));

  const count = clampTrailerCount(runtimeConfig?.cinemaPreRollTrailerCount);
  const locale = resolveCinemaPreRollLocale(runtimeConfig);
  const queueSource = await fetchNowPlayingTrailerPool().catch((error) => {
    console.warn("[JMSFusion] Cinema pre-roll TMDb fetch failed:", error);
    return [];
  });
  if (!queueSource.length) {
    return { played: false, reason: "empty", locale: locale.cacheKey, requestedCount: count };
  }

  const sessionConsumedIds = new Set();
  const sessionConsumedTrailers = [];
  let userSkipped = false;
  const candidateQueue = buildTrailerCandidateQueue(queueSource, locale.cacheKey)
    .slice(0, getTrailerCandidateAttemptLimit(count, queueSource.length));
  if (!candidateQueue.length) {
    return {
      played: false,
      reason: "empty-selection",
      locale: locale.cacheKey,
      requestedCount: count,
      poolCount: queueSource.length
    };
  }

  const ytReady = await ensureYouTubeApi().catch(() => false);
  if (!ytReady) {
    return {
      played: false,
      reason: "yt-api-unavailable",
      locale: locale.cacheKey,
      requestedCount: count,
      poolCount: queueSource.length
    };
  }

  const sessionState = {
    prefersFullscreen: runtimeConfig?.cinemaPreRollStartFullscreen === true,
    enteredFullscreen: false
  };
  let overlay = null;
  let shownCount = 0;
  const shownTrailers = [];
  const previousBodyOverflow = document.body?.style?.overflow || "";
  const previousHtmlOverflow = document.documentElement?.style?.overflow || "";
  let overflowLocked = false;

  const ensureSessionOverlay = async () => {
    if (overlay) return overlay;
    await closeDetailsModalIfLoaded().catch(() => null);
    overlay = ensureOverlayDom({ immersive: sessionState.prefersFullscreen, sessionState });
    try {
      if (document.body) document.body.style.overflow = "hidden";
      if (document.documentElement) document.documentElement.style.overflow = "hidden";
      overflowLocked = true;
    } catch {}
    await maybeEnterTrailerFullscreen(overlay, sessionState).catch(() => false);
    return overlay;
  };

  const rememberConsumedTrailer = (trailer) => {
    const tmdbId = Number(trailer?.tmdbId);
    if (!Number.isFinite(tmdbId) || sessionConsumedIds.has(tmdbId)) return;
    sessionConsumedIds.add(tmdbId);
    sessionConsumedTrailers.push(trailer);
  };

  const tryTrailerQueue = async (queue = []) => {
    for (const trailer of Array.isArray(queue) ? queue : []) {
      if (shownCount >= count || userSkipped) break;

      rememberConsumedTrailer(trailer);
      const playable = await probeYouTubeTrailerPlayable(trailer).catch(() => false);
      if (!playable) continue;

      const activeOverlay = await ensureSessionOverlay();
      const result = await playSingleTrailer(activeOverlay, trailer, shownCount, count, sessionState);
      if (result?.played === true) {
        shownTrailers.push(trailer);
        shownCount += 1;
      }
      if (result?.action === "skip") {
        userSkipped = true;
        break;
      }
    }
  };

  cinemaPreRollSessionActive = true;
  try {
    await tryTrailerQueue(candidateQueue);

    if (shownCount < count && !userSkipped && sessionConsumedTrailers.length) {
      markTrailersAsShown(sessionConsumedTrailers, locale.cacheKey);
      const retryQueue = buildTrailerCandidateQueue(queueSource, locale.cacheKey, {
        excludeIds: sessionConsumedIds,
        allowReset: true
      }).slice(0, getTrailerCandidateAttemptLimit(count - shownCount, queueSource.length));

      await tryTrailerQueue(retryQueue);
    }
  } finally {
    if (overlay) {
      await exitElementFullscreenIfNeeded(overlay).catch(() => false);
      try { overlay.__jmsCinemaPreRollCleanup?.(); } catch {}
      try { overlay.remove(); } catch {}
    }
    if (overflowLocked) {
      try {
        if (document.body) document.body.style.overflow = previousBodyOverflow;
        if (document.documentElement) document.documentElement.style.overflow = previousHtmlOverflow;
      } catch {}
    }
    cinemaPreRollSessionActive = false;
  }

  markTrailersAsShown(sessionConsumedTrailers, locale.cacheKey);
  return {
    played: shownCount > 0,
    shownCount,
    locale: locale.cacheKey,
    requestedCount: count,
    poolCount: queueSource.length,
    attemptedCount: candidateQueue.length
  };
}

installNativePlaybackHook();
