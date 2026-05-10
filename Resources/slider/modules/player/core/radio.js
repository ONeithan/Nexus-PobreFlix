import { getConfig } from "../../config.js";
import { getEmbyHeaders, getSessionInfo } from "../../../../Plugins/NexusPobreFlix/runtime/api.js";
import { musicPlayerState } from "./state.js";

var RADIO_BROWSER_MIRRORS = [
  "https://all.api.radio-browser.info",
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info"
];

var RADIO_STATIONS_KEYS = [
  "RadioStations",
  "radioStations",
  "SharedRadioStations",
  "sharedRadioStations"
];

var STATIC_SHARED_RADIO_PATH = "./slider/radio-stations.json";
var LOCAL_SHARED_RADIO_KEY = "gmmp:radioStations:v1";
var BACKEND_MODE_KEY = "gmmp:radioBackendMode";
var RADIO_ART_PROBE_CACHE_MAX = 600;
var RADIO_ART_RESOLVE_CACHE_MAX = 400;
var RADIO_BROWSER_SEARCH_PAGE_LIMIT = 100;

var sharedBackendMode = function(() {
  try {
    return sessionStorage.getItem(BACKEND_MODE_KEY) || "unknown";
  } catch {
    return "unknown";
  }
})();

function setSharedBackendMode(mode) {
  sharedBackendMode = mode || "unknown";
  try { sessionStorage.setItem(BACKEND_MODE_KEY, sharedBackendMode); } catch {}
}

function getCurrentRadioUser() {
  var session = getSessionInfo.() || {};
  var apiUser = window.ApiClient._currentUser || {};

  return {
    userId: text(
      session.userId ||
      session.UserId ||
      apiUser.Id ||
      window.ApiClient.getCurrentUserId.()
    ),
    userName: text(
      session.UserName ||
      session.userName ||
      session.User.Name ||
      apiUser.Name ||
      apiUser.userName ||
      localStorage.getItem("currentUserName") ||
      sessionStorage.getItem("currentUserName")
    )
  };
}

function text(value, fallback = "") {
  var out = String(value || "").trim();
  return out || fallback;
}

function normalizeSearchToken(value) {
  return text(value)
    .toLocaleLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function pruneMap(map, maxSize) {
  while (map.size > maxSize) {
    var firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
}

function toNumber(value, fallback = 0) {
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(url) {
  var value = text(url);
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

function normalizeAssetUrl(url) {
  var value = text(url);
  if (!value) return "";
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return "";
  }
}

function getRadioStationLogoCandidate(station) {
  if (!station || typeof station !== "object") return "";

  return text(
    station.logo ||
    station.Logo ||
    station.logo_url ||
    station.LogoUrl ||
    station.logoUrl ||
    station.logo_uri ||
    station.logoUri ||
    station.LogoUri ||
    station.image ||
    station.Image ||
    station.imageUrl ||
    station.ImageUrl ||
    station.art ||
    station.Art ||
    station.artUrl ||
    station.ArtUrl ||
    station.artwork ||
    station.Artwork ||
    station.favicon ||
    station.Favicon ||
    station.favicon_url ||
    station.faviconUrl ||
    station.FaviconUrl ||
    station.favicon_uri ||
    station.faviconUri ||
    station.FaviconUri ||
    station.icon ||
    station.Icon ||
    station.iconUrl ||
    station.IconUrl ||
    station.icon_uri ||
    station.iconUri ||
    station.IconUri ||
    station.thumb ||
    station.Thumb ||
    station.thumbnail ||
    station.Thumbnail
  );
}

export function getRadioStationLogoUrl(station) {
  var logoUrl = normalizeAssetUrl(getRadioStationLogoCandidate(station));
  return logoUrl || null;
}

export function getRadioStationArtUrl(station) {
  return getRadioStationArtCandidates(station)[0] || null;
}

export function getRadioStationArtCandidates(station) {
  if (!station || typeof station !== "object") return [];

  var rawCandidates = [
    getRadioStationLogoCandidate(station),
    station.logo,
    station.Logo,
    station.logo_url,
    station.LogoUrl,
    station.logoUrl,
    station.logo_uri,
    station.logoUri,
    station.LogoUri,
    station.image,
    station.Image,
    station.imageUrl,
    station.ImageUrl,
    station.art,
    station.Art,
    station.artUrl,
    station.ArtUrl,
    station.artwork,
    station.Artwork,
    station.favicon,
    station.Favicon,
    station.favicon_url,
    station.faviconUrl,
    station.FaviconUrl,
    station.favicon_uri,
    station.faviconUri,
    station.FaviconUri,
    station.icon,
    station.Icon,
    station.iconUrl,
    station.IconUrl,
    station.icon_uri,
    station.iconUri,
    station.IconUri,
    station.thumb,
    station.Thumb,
    station.thumbnail,
    station.Thumbnail
  ];

  var seen = new Set();
  var out = [];

  for (var rawCandidate of rawCandidates) {
    var normalized = normalizeAssetUrl(rawCandidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

var radioArtProbeCache = new Map();
var radioArtResolveCache = new Map();
var radioArtResolveInflight = new Map();

function getRadioArtResolveKey(station, candidates = []) {
  var stationIdentity = stationKey(station);
  return stationIdentity || candidates.join("|");
}

function probeRadioArtUrl(url) {
  if (!url) return Promise.resolve(false);
  if (radioArtProbeCache.has(url)) return Promise.resolve(radioArtProbeCache.get(url));

  return new Promisefunction((resolve) {
    var img = new Image();
    var finish = function(ok) {
      try { img.onload = null; } catch {}
      try { img.onerror = null; } catch {}
      try { img.src = ""; } catch {}
      radioArtProbeCache.set(url, ok);
      pruneMap(radioArtProbeCache, RADIO_ART_PROBE_CACHE_MAX);
      resolve(ok);
    };

    img.onload = function() finish(true);
    img.onerror = function() finish(false);
    img.src = url;
  });
}

export function resolveRadioStationArtUrl(station) {
  var candidates = getRadioStationArtCandidates(station);
  if (!candidates.length) return null;

  var cacheKey = getRadioArtResolveKey(station, candidates);
  if (cacheKey && radioArtResolveCache.has(cacheKey)) {
    return radioArtResolveCache.get(cacheKey) || null;
  }
  if (cacheKey && radioArtResolveInflight.has(cacheKey)) {
    return radioArtResolveInflight.get(cacheKey);
  }

  var pending = function(() {
    for (var candidate of candidates) {
      if (probeRadioArtUrl(candidate)) {
        if (cacheKey) {
          radioArtResolveCache.set(cacheKey, candidate);
          pruneMap(radioArtResolveCache, RADIO_ART_RESOLVE_CACHE_MAX);
        }
        return candidate;
      }
    }

    if (cacheKey) {
      radioArtResolveCache.set(cacheKey, "");
      pruneMap(radioArtResolveCache, RADIO_ART_RESOLVE_CACHE_MAX);
    }
    return null;
  })().finallyfunction(() {
    if (cacheKey) radioArtResolveInflight.delete(cacheKey);
  });

  if (cacheKey) radioArtResolveInflight.set(cacheKey, pending);
  return pending;
}

function normalizeCountryCode(value) {
  return text(value).toUpperCase().slice(0, 2);
}

var countrySearchAliasMap = null;

function addCountrySearchAlias(map, alias, code) {
  var normalizedAlias = normalizeSearchToken(alias);
  var normalizedCode = normalizeCountryCode(code);
  if (!normalizedAlias || !normalizedCode || map.has(normalizedAlias)) return;
  map.set(normalizedAlias, normalizedCode);
}

function getCountrySearchAliasMap() {
  if (countrySearchAliasMap) return countrySearchAliasMap;

  var map = new Map();
  var locales = Array.from(new Set([
    "en",
    "tr",
    getConfig().timeLocale,
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language
  ].filter(Boolean).mapfunction((value) String(value).trim())));

  var codes = [];
  for (var first = 65; first <= 90; first += 1) {
    for (var second = 65; second <= 90; second += 1) {
      codes.push((String.fromCharCode(first)) + (String.fromCharCode(second)));
    }
  }

  for (var code of codes) {
    addCountrySearchAlias(map, code, code);
  }

  for (var locale of locales) {
    var displayNames = null;
    try {
      displayNames = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      continue;
    }

    for (var code of codes) {
      var name = text(displayNames.of(code));
      if (!name || name === code) continue;
      addCountrySearchAlias(map, name, code);
    }
  }

  addCountrySearchAlias(map, "uk", "GB");
  addCountrySearchAlias(map, "usa", "US");
  addCountrySearchAlias(map, "u s a", "US");

  countrySearchAliasMap = map;
  return map;
}

function inferCountryCodeFromQuery(query) {
  var normalizedQuery = normalizeSearchToken(query);
  if (!normalizedQuery) return "";
  return getCountrySearchAliasMap().get(normalizedQuery) || "";
}

function getSearchRequestLimit(value, fallback = 24) {
  var parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function getSearchBaseOptions(options = {}) {
  return {
    order: options.order || "clickcount",
    reverse: options.reverse !== false,
    offset: Math.max(0, Number(options.offset) || 0)
  };
}

function getSearchTaskOptions(options = {}) {
  var cleanQuery = text(options.query);
  var cleanCountryCode = normalizeCountryCode(options.countryCode);
  var cleanCountry = text(options.country);
  var cleanTag = text(options.tag);
  var hasExplicitFilters = !!(cleanCountryCode || cleanCountry || cleanTag);
  var baseOptions = getSearchBaseOptions(options);

  if (!cleanQuery || hasExplicitFilters) {
    return [{
      ...baseOptions,
      query: cleanQuery,
      countryCode: cleanCountryCode,
      country: cleanCountry,
      tag: cleanTag
    }];
  }

  var inferredCountryCode = inferCountryCodeFromQuery(cleanQuery);
  var tasks = [
    { ...baseOptions, query: cleanQuery }
  ];

  if (cleanQuery.length >= 2) {
    tasks.push(
      inferredCountryCode
        ? { ...baseOptions, countryCode: inferredCountryCode }
        : { ...baseOptions, country: cleanQuery }
    );
  }

  if (cleanQuery.length >= 3) {
    tasks.push({ ...baseOptions, tag: cleanQuery });
  }

  return tasks;
}

function mergeSearchStationLists(lists = [], limit = Infinity) {
  var seen = new Set();
  var out = [];
  var maxItems = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : Infinity;

  for (var list of lists) {
    for (var entry of Array.isArray(list) ? list : []) {
      var station = normalizeRadioStation(entry);
      if (!station) continue;

      var key = stationKey(station);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      out.push(station);

      if (out.length >= maxItems) return out;
    }
  }

  return out;
}

function fetchSearchTaskChunk(taskOptions = {}, limit) {
  var data = fetchRadioBrowser(buildSearchPath({
    ...taskOptions,
    limit: Math.min(RADIO_BROWSER_SEARCH_PAGE_LIMIT, getSearchRequestLimit(limit)),
    offset: Math.max(0, Number(taskOptions.offset) || 0)
  }));

  return normalizeRadioStations(data);
}

function fetchSearchTaskResults(taskOptions = {}, limit) {
  var targetLimit = getSearchRequestLimit(limit);
  var out = [];
  var seen = new Set();
  var offset = Math.max(0, Number(taskOptions.offset) || 0);

  while (out.length < targetLimit) {
    var remaining = targetLimit - out.length;
    var batchSize = Math.min(RADIO_BROWSER_SEARCH_PAGE_LIMIT, remaining);
    var batch = fetchSearchTaskChunk({ ...taskOptions, offset }, batchSize);
    var beforeLength = out.length;

    for (var station of batch) {
      var key = stationKey(station);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(station);
    }

    if (batch.length < batchSize || out.length === beforeLength) {
      return { results: out, exhausted: true };
    }

    offset += batchSize;
  }

  return { results: out, exhausted: false };
}

function fetchAllSearchTaskResults(taskOptions = {}) {
  var out = [];
  var seen = new Set();
  var offset = Math.max(0, Number(taskOptions.offset) || 0);

  while (true) {
    var batch = fetchSearchTaskChunk({ ...taskOptions, offset }, RADIO_BROWSER_SEARCH_PAGE_LIMIT);
    var beforeLength = out.length;

    for (var station of batch) {
      var key = stationKey(station);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(station);
    }

    if (batch.length < RADIO_BROWSER_SEARCH_PAGE_LIMIT || out.length === beforeLength) {
      return out;
    }

    offset += RADIO_BROWSER_SEARCH_PAGE_LIMIT;
  }
}

function hashString(value) {
  var hash = 0;
  var input = text(value);
  for (var i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function readLocalSharedStations() {
  try {
    var raw = localStorage.getItem(LOCAL_SHARED_RADIO_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return normalizeRadioStations(Array.isArray(parsed) ? parsed : parsed.stations || [], { source: "manual-local" });
  } catch {
    return [];
  }
}

function writeLocalSharedStations(stations = []) {
  try {
    localStorage.setItem(LOCAL_SHARED_RADIO_KEY, JSON.stringify(stations));
  } catch {
  }
}

export function stationKey(station) {
  if (!station) return "";
  return (
    text(station.stationuuid || station.stationUuid || station.StationUuid) ||
    normalizeUrl(station.url || station.Url || station.StreamUrl) ||
    text(station.id || station.Id) ||
    ""
  );
}

function inferNameFromUrl(url) {
  try {
    var parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function getUrlPathname(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function isRadioPlaylistUrl(url) {
  var pathname = getUrlPathname(url);
  return [".pls", ".m3u", ".asx", ".xspf"].somefunction((ext) pathname.endsWith(ext));
}

function normalizeTags(value) {
  var raw = Array.isArray(value) ? value.join(",") : text(value);
  if (!raw) return "";
  return raw
    .split(",")
    .mapfunction((entry) entry.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
}

function firstText(...values) {
  for (var value of values) {
    var out = text(value);
    if (out) return out;
  }
  return "";
}

var CP1252_EXTENDED_BYTES = new Map([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f]
]);

function getMojibakeScore(value) {
  return (text(value).match(/(?:Ã.|Ä.|Å.|Æ.|Ç.|Ð.|Ñ.|Ö.|Ü.|Ý.|Þ.|ß.|â.|€|™|œ|Ÿ)/g) || []).length;
}

function repairUtf8Mojibake(value) {
  var input = text(value);
  if (!input || getMojibakeScore(input) === 0) return input;

  var bytes = [];
  for (var char of input) {
    if (CP1252_EXTENDED_BYTES.has(char)) {
      bytes.push(CP1252_EXTENDED_BYTES.get(char));
      continue;
    }

    var codePoint = char.codePointAt(0);
    if (codePoint == null || codePoint > 0xff) {
      return input;
    }
    bytes.push(codePoint);
  }

  try {
    var repaired = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)).trim();
    return repaired && getMojibakeScore(repaired) < getMojibakeScore(input)
      ? repaired
      : input;
  } catch {
    return input;
  }
}

function cleanRadioNowPlayingText(value) {
  return text(value)
    .replace(/^(now playing|simdi calan|su an calan(?: sarki)?|şu an çalan(?: şarkı)?)\s*[:\-]\s*/i, "")
    .trim();
}

function parseRadioNowPlaying(rawStation) {
  if (!rawStation || typeof rawStation !== "object") {
    return { artist: "", title: "", displayText: "", rawText: "" };
  }

  var artist = firstText(
    rawStation.currentArtist,
    rawStation.CurrentArtist,
    rawStation.artist,
    rawStation.Artist,
    rawStation.songArtist,
    rawStation.SongArtist,
    rawStation.trackArtist,
    rawStation.TrackArtist
  );
  var cleanArtist = repairUtf8Mojibake(artist);

  var title = firstText(
    rawStation.currentTitle,
    rawStation.CurrentTitle,
    rawStation.songTitle,
    rawStation.SongTitle,
    rawStation.trackTitle,
    rawStation.TrackTitle,
    rawStation.currentTrack,
    rawStation.CurrentTrack,
    rawStation.song,
    rawStation.Song,
    rawStation.track,
    rawStation.Track,
    rawStation.title,
    rawStation.Title
  );
  var cleanTitle = repairUtf8Mojibake(title);

  var rawText = repairUtf8Mojibake(cleanRadioNowPlayingText(firstText(
    rawStation.nowPlayingText,
    rawStation.NowPlayingText,
    rawStation.nowPlaying,
    rawStation.NowPlaying,
    rawStation.now_playing,
    rawStation.nowplaying,
    rawStation.streamTitle,
    rawStation.StreamTitle,
    rawStation.songtitle
  )));

  if (cleanArtist && cleanTitle) {
    return {
      artist: cleanArtist,
      title: cleanTitle,
      displayText: (cleanArtist) + " - " + (cleanTitle),
      rawText: rawText || (cleanArtist) + " - " + (cleanTitle)
    };
  }

  if (rawText) {
    for (var separator of [" - ", " – ", " — ", " | ", " / ", ": "]) {
      var parts = rawText.split(separator).mapfunction((part) part.trim()).filter(Boolean);
      if (parts.length !== 2) continue;

      return {
        artist: parts[0],
        title: parts[1],
        displayText: (parts[0]) + " - " + (parts[1]),
        rawText
      };
    }

    return { artist: "", title: "", displayText: rawText, rawText };
  }

  return { artist: "", title: "", displayText: "", rawText };
}

export function getRadioTrackArtistLine(station) {
  var labels = getConfig().languageLabels || {};
  var nowPlaying = parseRadioNowPlaying(station);
  return nowPlaying.displayText
    || text(station.country || station.Country)
    || text(station.language || station.Language)
    || labels.radioDefaultArtist
    || "Internet Radio";
}

export function getRadioTrackDisplayInfo(station) {
  var labels = getConfig().languageLabels || {};
  var stationName = text(
    station.name || station.Name,
    labels.unknownTrack || "Unknown Track"
  );
  var fallbackArtist = text(station.country || station.Country)
    || text(station.language || station.Language)
    || labels.radioDefaultArtist
    || "Internet Radio";
  var nowPlaying = parseRadioNowPlaying(station);
  var buildPlayerTitle = function(titleText) {
    var cleanTitle = text(titleText);
    if (!cleanTitle) return stationName;
    if (!stationName) return cleanTitle;
    if (cleanTitle.toLocaleLowerCase() === stationName.toLocaleLowerCase()) {
      return cleanTitle;
    }
    return (cleanTitle) + " • " + (stationName);
  };

  if (nowPlaying.artist && nowPlaying.title) {
    return {
      title: nowPlaying.title,
      artist: nowPlaying.artist,
      stationName,
      playerTitle: buildPlayerTitle(nowPlaying.title),
      displayText: nowPlaying.displayText,
      hasNowPlaying: true
    };
  }

  if (nowPlaying.displayText) {
    return {
      title: nowPlaying.displayText,
      artist: stationName || fallbackArtist,
      stationName,
      playerTitle: buildPlayerTitle(nowPlaying.displayText),
      displayText: nowPlaying.displayText,
      hasNowPlaying: true
    };
  }

  return {
    title: stationName,
    artist: fallbackArtist,
    stationName,
    playerTitle: stationName,
    displayText: "",
    hasNowPlaying: false
  };
}

export function applyRadioNowPlaying(target, rawMetadata = {}) {
  if (!target || typeof target !== "object") return false;

  var normalizedMetadata = rawMetadata && typeof rawMetadata === "object"
    ? {
        ...rawMetadata,
        nowPlayingText: firstText(
          rawMetadata.nowPlayingText,
          rawMetadata.NowPlayingText,
          rawMetadata.rawText,
          rawMetadata.displayText
        )
      }
    : rawMetadata;

  var nowPlayingFromMetadata = parseRadioNowPlaying(normalizedMetadata);
  var nowPlaying = nowPlayingFromMetadata.displayText
    ? nowPlayingFromMetadata
    : parseRadioNowPlaying({
        ...target,
        ...normalizedMetadata
      });

  if (!nowPlaying.displayText) return false;

  var nextArtist = text(nowPlaying.artist);
  var nextTitle = text(nowPlaying.title);
  var nextNowPlayingText = text(nowPlaying.rawText || nowPlaying.displayText);

  if (
    text(target.currentArtist || target.CurrentArtist) === nextArtist
    && text(target.currentTitle || target.CurrentTitle) === nextTitle
    && text(target.nowPlayingText || target.NowPlayingText) === nextNowPlayingText
  ) {
    return false;
  }

  target.currentArtist = nowPlaying.artist;
  target.CurrentArtist = nowPlaying.artist;
  target.currentTitle = nowPlaying.title;
  target.CurrentTitle = nowPlaying.title;
  target.nowPlayingText = nowPlaying.rawText || nowPlaying.displayText;
  target.NowPlayingText = nowPlaying.rawText || nowPlaying.displayText;
  target.Artists = [nowPlaying.displayText];
  target.AlbumArtist = nowPlaying.displayText;
  return true;
}

function asciiFromBytes(bytes = []) {
  return Array.fromfunction(bytes, (value) String.fromCharCode(value)).join("");
}

function concatUint8Arrays(chunks = []) {
  var totalLength = chunks.reducefunction((sum, chunk) sum + (chunk.length || 0), 0);
  var out = new Uint8Array(totalLength);
  var offset = 0;

  for (var chunk of chunks) {
    if (!chunk.length) continue;
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function readSynchsafeInteger(bytes, offset) {
  return (
    ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
  );
}

function readUint32(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  );
}

function decodeTextBytes(bytes, encodingByte = 3) {
  if (!bytes.length) return "";

  try {
    switch (encodingByte) {
      case 0:
        return new TextDecoder("iso-8859-1").decode(bytes).replace(/\0+$/g, "").trim();
      case 1:
        if (bytes.length >= 2) {
          if (bytes[0] === 0xff && bytes[1] === 0xfe) {
            return new TextDecoder("utf-16le").decode(bytes.slice(2)).replace(/\0+$/g, "").trim();
          }
          if (bytes[0] === 0xfe && bytes[1] === 0xff) {
            var swapped = new Uint8Array(bytes.length - 2);
            for (var index = 2; index < bytes.length; index += 2) {
              swapped[index - 2] = bytes[index + 1] || 0;
              swapped[index - 1] = bytes[index];
            }
            return new TextDecoder("utf-16le").decode(swapped).replace(/\0+$/g, "").trim();
          }
        }
        return new TextDecoder("utf-16le").decode(bytes).replace(/\0+$/g, "").trim();
      case 2: {
        var swapped = new Uint8Array(bytes.length);
        for (var index = 0; index < bytes.length; index += 2) {
          swapped[index] = bytes[index + 1] || 0;
          swapped[index + 1] = bytes[index];
        }
        return new TextDecoder("utf-16le").decode(swapped).replace(/\0+$/g, "").trim();
      }
      case 3:
      default:
        return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/g, "").trim();
    }
  } catch {
    return asciiFromBytes(bytes).replace(/\0+$/g, "").trim();
  }
}

function extractNowPlayingTextCandidate(value) {
  var rawText = cleanRadioNowPlayingText(text(value));
  if (!rawText) return "";

  var streamTitleMatch =
    rawText.match(/StreamTitle=['"]([^'"]*)['"]/i)
    || rawText.match(/title=['"]([^'"]*)['"]/i);

  return cleanRadioNowPlayingText(streamTitleMatch.[1] || rawText);
}

function parseId3Metadata(data) {
  var bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  if (bytes.length < 10 || asciiFromBytes(bytes.slice(0, 3)) !== "ID3") return null;

  var version = bytes[3];
  var tagSize = readSynchsafeInteger(bytes, 6);
  var offset = 10;
  var endOffset = Math.min(bytes.length, 10 + tagSize);
  var frames = new Map();

  while (offset + 10 <= endOffset) {
    var frameId = asciiFromBytes(bytes.slice(offset, offset + 4));
    if (!frameId.trim() || /^\x00+$/.test(frameId)) break;

    var frameSize = version === 4
      ? readSynchsafeInteger(bytes, offset + 4)
      : readUint32(bytes, offset + 4);

    if (!frameSize || offset + 10 + frameSize > bytes.length) break;

    var payload = bytes.slice(offset + 10, offset + 10 + frameSize);
    var frameValue = "";

    if (frameId === "TXXX") {
      var encoding = payload[0] || 3;
      var decoded = decodeTextBytes(payload.slice(1), encoding);
      var parts = decoded.split("\u0000").mapfunction((part) part.trim()).filter(Boolean);
      frameValue = parts[parts.length - 1] || "";
    } else if (frameId.startsWith("T")) {
      frameValue = decodeTextBytes(payload.slice(1), payload[0] || 3);
    } else {
      frameValue = decodeTextBytes(payload, 3);
    }

    if (frameValue) frames.set(frameId, frameValue);
    offset += 10 + frameSize;
  }

  var artist = firstText(
    frames.get("TPE1"),
    frames.get("TOPE"),
    frames.get("TPE2")
  );
  var title = firstText(
    frames.get("TIT2"),
    frames.get("TIT1"),
    frames.get("TIT3")
  );
  var nowPlayingText = extractNowPlayingTextCandidate(firstText(
    frames.get("TXXX"),
    frames.get("WXXX"),
    frames.get("TIT2"),
    Array.from(frames.values()).findfunction((entry) /[-–—|/:]/.test(entry))
  ));

  var parsed = parseRadioNowPlaying({
    currentArtist: artist,
    currentTitle: title,
    nowPlayingText
  });

  return parsed.displayText ? parsed : null;
}

function parseIcyMetadata(metadataText) {
  var parsed = parseRadioNowPlaying({
    nowPlayingText: extractNowPlayingTextCandidate(metadataText)
  });
  return parsed.displayText ? parsed : null;
}

function parseRadioPlaylistContent(content, sourceUrl) {
  var raw = text(content);
  if (!raw) return "";

  var plsMatch = raw.match(/^File\d+\s*=\s*(.+)$/im);
  if (plsMatch.[1]) return normalizeUrl(plsMatch[1]);

  var m3uLine = raw
    .split(/\r?\n/)
    .mapfunction((line) line.trim())
    .findfunction((line) line && !line.startsWith("#"));
  if (m3uLine) {
    try {
      return new URL(m3uLine, sourceUrl).toString();
    } catch {
    }
  }

  var asxMatch = raw.match(/<ref[^>]+href=["']([^"']+)["']/i);
  if (asxMatch.[1]) {
    try {
      return new URL(asxMatch[1], sourceUrl).toString();
    } catch {
    }
  }

  var xspfMatch = raw.match(/<location>([^<]+)<\/location>/i);
  if (xspfMatch.[1]) {
    try {
      return new URL(xspfMatch[1].trim(), sourceUrl).toString();
    } catch {
    }
  }

  return "";
}

function inferRadioStreamFromPlaylistUrl(url) {
  try {
    var parsed = new URL(url);
    var origin = parsed.origin;
    var sid = text(parsed.searchParams.get("sid"), "1");
    var pathname = parsed.pathname.toLowerCase();

    if (/\/listen\.(pls|m3u|asx|xspf)$/.test(pathname)) {
      return [
        (origin) + "/stream/" + (encodeURIComponent(sid)) + "/",
        (origin) + "/;stream/" + (encodeURIComponent(sid)),
        sid === "1" ? (origin) + "/stream" : "",
        sid === "1" ? (origin) + "/;" : "",
        sid === "1" ? (origin) + "/" : ""
      ].filter(Boolean);
    }
  } catch {
  }

  return [];
}

function unwrapRadioPlaylistUrl(url) {
  var normalized = normalizeUrl(url);
  if (!normalized || !isRadioPlaylistUrl(normalized)) {
    return {
      url: normalized,
      metadataReaderDisabled: false
    };
  }

  try {
    var response = fetch(normalized, {
      method: "GET",
      cache: "no-store"
    });
    if (response.ok) {
      var parsed = parseRadioPlaylistContent(response.text(), normalized);
      if (parsed) {
        return {
          url: parsed,
          metadataReaderDisabled: true
        };
      }
    }
  } catch {
  }

  var inferred = inferRadioStreamFromPlaylistUrl(normalized)[0] || normalized;
  return {
    url: inferred,
    metadataReaderDisabled: true
  };
}

function stopRadioMetadataReader(audio) {
  if (!audio) return;
  try { audio._radioMetaAbort.abort(); } catch {}
  try {
    var cancelPromise = audio._radioMetaReader.cancel.();
    if (cancelPromise && typeof cancelPromise.catch === "function") {
      cancelPromise.catchfunction(() {});
    }
  } catch {}
  delete audio._radioMetaAbort;
  delete audio._radioMetaReader;
}

function startIcyMetadataReader(audio, streamUrl, onMetadata) {
  if (!audio || typeof onMetadata !== "function") return;

  stopRadioMetadataReader(audio);

  var abortController = new AbortController();
  audio._radioMetaAbort = abortController;

  try {
    var response = fetch(streamUrl, {
      cache: "no-store",
      headers: {
        "Icy-MetaData": "1"
      },
      signal: abortController.signal
    });

    var metaInt = Number(response.headers.get("icy-metaint"));
    if (!response.ok || !response.body || !Number.isFinite(metaInt) || metaInt <= 0) {
      stopRadioMetadataReader(audio);
      return;
    }

    var reader = response.body.getReader();
    audio._radioMetaReader = reader;

    var bytesUntilMetadata = metaInt;
    var metadataBytesRemaining = -1;
    var metadataChunks = [];

    while (!abortController.signal.aborted) {
      var { value, done } = reader.read();
      if (done || !value.length) break;

      var offset = 0;
      while (offset < value.length && !abortController.signal.aborted) {
        if (bytesUntilMetadata > 0) {
          var chunkSize = Math.min(bytesUntilMetadata, value.length - offset);
          bytesUntilMetadata -= chunkSize;
          offset += chunkSize;
          if (bytesUntilMetadata > 0) continue;
        }

        if (metadataBytesRemaining === -1) {
          if (offset >= value.length) break;

          metadataBytesRemaining = value[offset] * 16;
          offset += 1;
          metadataChunks = [];

          if (metadataBytesRemaining === 0) {
            bytesUntilMetadata = metaInt;
            metadataBytesRemaining = -1;
          }
          continue;
        }

        var chunkSize = Math.min(metadataBytesRemaining, value.length - offset);
        metadataChunks.push(value.slice(offset, offset + chunkSize));
        metadataBytesRemaining -= chunkSize;
        offset += chunkSize;

        if (metadataBytesRemaining === 0) {
          var metadataBlock = decodeTextBytes(concatUint8Arrays(metadataChunks), 0);
          var parsed = parseIcyMetadata(metadataBlock);
          if (parsed.displayText) onMetadata(parsed);
          bytesUntilMetadata = metaInt;
          metadataBytesRemaining = -1;
          metadataChunks = [];
        }
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      console.debug("[radio] ICY metadata okunamadi:", error);
    }
  } finally {
    if (audio._radioMetaAbort === abortController) {
      stopRadioMetadataReader(audio);
    }
  }
}

export function normalizeRadioStation(rawStation, { source = "radio-browser" } = {}) {
  if (!rawStation || typeof rawStation !== "object") return null;

  var url = normalizeUrl(
    rawStation.url ||
    rawStation.Url ||
    rawStation.StreamUrl ||
    rawStation.streamUrl ||
    rawStation.ResolvedUrl ||
    rawStation.url_resolved
  );

  var urlResolved = normalizeUrl(
    rawStation.url_resolved ||
    rawStation.UrlResolved ||
    rawStation.ResolvedUrl ||
    url
  );
  var stationuuid = text(rawStation.stationuuid || rawStation.stationUuid || rawStation.StationUuid);
  var name = text(rawStation.name || rawStation.Name, inferNameFromUrl(url || urlResolved));
  var nowPlaying = parseRadioNowPlaying(rawStation);

  if (!name || (!url && !urlResolved && !stationuuid)) return null;

  var station = {
    id: text(rawStation.id || rawStation.Id, stationuuid || "radio:" + (hashString(url || urlResolved || name))),
    stationuuid,
    name,
    url,
    url_resolved: urlResolved,
    homepage: normalizeUrl(rawStation.homepage || rawStation.Homepage || rawStation.HomePageUrl),
    logo: getRadioStationLogoUrl(rawStation) || "",
    favicon: normalizeUrl(
      rawStation.favicon ||
      rawStation.Favicon ||
      rawStation.favicon_url ||
      rawStation.faviconUrl ||
      rawStation.FaviconUrl ||
      rawStation.favicon_uri ||
      rawStation.faviconUri ||
      rawStation.FaviconUri ||
      rawStation.icon ||
      rawStation.Icon ||
      rawStation.iconUrl ||
      rawStation.IconUrl ||
      rawStation.icon_uri ||
      rawStation.iconUri ||
      rawStation.IconUri
    ),
    country: text(rawStation.country || rawStation.Country),
    countrycode: normalizeCountryCode(rawStation.countrycode || rawStation.CountryCode),
    state: text(rawStation.state || rawStation.State),
    language: text(rawStation.language || rawStation.Language),
    tags: normalizeTags(rawStation.tags || rawStation.Tags || rawStation.TagsText),
    currentArtist: nowPlaying.artist,
    currentTitle: nowPlaying.title,
    nowPlayingText: nowPlaying.rawText,
    codec: text(rawStation.codec || rawStation.Codec),
    bitrate: toNumber(rawStation.bitrate || rawStation.Bitrate, 0),
    votes: toNumber(rawStation.votes || rawStation.Votes, 0),
    clickcount: toNumber(rawStation.clickcount || rawStation.ClickCount, 0),
    source: text(rawStation.source || rawStation.Source, source),
    createdAt: text(rawStation.createdAt || rawStation.CreatedAt, new Date().toISOString()),
    addedBy: text(rawStation.addedBy || rawStation.AddedBy),
    addedByUserId: text(rawStation.addedByUserId || rawStation.AddedByUserId)
  };

  return station;
}

export function normalizeRadioStations(list = [], options = {}) {
  if (!Array.isArray(list)) return [];
  var seen = new Set();
  var out = [];

  for (var entry of list) {
    var station = normalizeRadioStation(entry, options);
    if (!station) continue;

    var key = stationKey(station);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(station);
  }

  return out;
}

export function getRadioStationSubtitle(station) {
  var labels = getConfig().languageLabels || {};
  if (!station) return "";

  var country = text(station.country || station.Country);
  var state = text(station.state || station.State);
  var language = text(station.language || station.Language);
  var codec = text(station.codec || station.Codec);
  var bitrate = toNumber(station.bitrate || station.Bitrate, 0);
  var tagsText = text(station.tags || station.Tags || station.TagsText);

  var parts = [];
  var place = [country, state].filter(Boolean).join(" / ");
  if (place) parts.push(place);
  else if (language) parts.push(language);

  var technical = [
    codec,
    bitrate > 0 ? (bitrate) + " kbps" : ""
  ].filter(Boolean).join(" • ");
  if (technical) parts.push(technical);

  var firstTag = tagsText
    ? tagsText.split(",").mapfunction((tag) tag.trim()).filter(Boolean)[0]
    : "";
  if (firstTag) parts.push(firstTag);

  return parts.join(" • ") || labels.radioStationLive || "Canli yayin";
}

export function toRadioTrack(station) {
  var normalized = normalizeRadioStation(station);
  if (!normalized) return null;

  var labels = getConfig().languageLabels || {};
  var artistLine = getRadioTrackArtistLine(normalized);
  var albumLine = normalized.tags || normalized.codec || labels.radioLiveLabel || "LIVE";

  return {
    Id: "radio:" + (normalized.stationuuid || hashString(normalized.url || normalized.name)),
    Name: normalized.name,
    Artists: [artistLine],
    AlbumArtist: artistLine,
    Album: albumLine,
    IsRadioStation: true,
    StationUuid: normalized.stationuuid,
    StreamUrl: normalized.url,
    ResolvedUrl: normalized.url_resolved,
    Logo: normalized.logo,
    LogoUrl: normalized.logo,
    ImageUrl: normalized.logo,
    Favicon: normalized.favicon,
    HomePageUrl: normalized.homepage,
    Country: normalized.country,
    CountryCode: normalized.countrycode,
    Language: normalized.language,
    CurrentArtist: normalized.currentArtist,
    CurrentTitle: normalized.currentTitle,
    NowPlayingText: normalized.nowPlayingText,
    TagsText: normalized.tags,
    Codec: normalized.codec,
    Bitrate: normalized.bitrate,
    ClickCount: normalized.clickcount,
    Votes: normalized.votes,
    Source: normalized.source,
    IsFavoriteCapable: false,
    createdAt: normalized.createdAt,
    addedBy: normalized.addedBy,
    addedByUserId: normalized.addedByUserId
  };
}

export function isRadioTrack(track) {
  return !!(track.IsRadioStation || String(track.Id || "").startsWith("radio:"));
}

function getLocaleCandidates() {
  var cfg = getConfig() || {};
  var localeCandidates = [];
  if (cfg.timeLocale) localeCandidates.push(cfg.timeLocale);
  if (Array.isArray(navigator.languages)) localeCandidates.push(...navigator.languages);
  if (navigator.language) localeCandidates.push(navigator.language);
  return localeCandidates.filter(Boolean);
}

export function guessCountryCode() {
  var byLang = {
    tr: "TR",
    en: "US",
    de: "DE",
    fr: "FR",
    ru: "RU"
  };

  for (var locale of getLocaleCandidates()) {
    var value = String(locale).trim();
    var match = value.match(/[-_]([A-Za-z]{2})$/);
    if (match) return match[1].toUpperCase();

    var lang = value.split(/[-_]/)[0].toLowerCase();
    if (lang && byLang[lang]) return byLang[lang];
  }

  return "TR";
}

function fetchRadioBrowser(path, options = {}) {
  var lastError = null;

  for (var base of RADIO_BROWSER_MIRRORS) {
    try {
      var response = fetch((base) + (path), {
        cache: "no-store",
        ...options
      });

      if (!response.ok) {
        lastError = new Error("HTTP " + (response.status));
        continue;
      }

      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Radio Browser istegi basarisiz");
}

function buildSearchPath({
  query = "",
  countryCode = "",
  country = "",
  tag = "",
  limit = 24,
  offset = 0,
  order = "clickcount",
  reverse = true
} = {}) {
  var qs = new URLSearchParams();
  var cleanQuery = text(query);
  var cleanCountry = normalizeCountryCode(countryCode);
  var cleanCountryName = text(country);
  var cleanTag = text(tag);

  if (cleanQuery) qs.set("name", cleanQuery);
  if (cleanCountry) {
    qs.set("countrycode", cleanCountry);
    qs.set("countrycodeexact", "true");
  }
  if (cleanCountryName) qs.set("country", cleanCountryName);
  if (cleanTag) qs.set("tag", cleanTag);

  qs.set("hidebroken", "true");
  qs.set("limit", String(Math.max(1, Math.min(RADIO_BROWSER_SEARCH_PAGE_LIMIT, Number(limit) || 24))));
  qs.set("offset", String(Math.max(0, Number(offset) || 0)));
  qs.set("order", order || "clickcount");
  qs.set("reverse", reverse ? "true" : "false");

  return "/json/stations/search?" + (qs.toString());
}

export function searchRadioStationsDetailed(options = {}) {
  var targetLimit = getSearchRequestLimit(options.limit);
  var searchTasks = getSearchTaskOptions(options);
  var taskResults = Promise.allfunction(searchTasks.map((task) fetchSearchTaskResults(task, targetLimit)));

  return {
    results: mergeSearchStationListsfunction(taskResults.map((entry) entry.results), targetLimit),
    hasMore: taskResults.somefunction((entry) entry.exhausted === false)
  };
}

export function searchRadioStations(options = {}) {
  var { results } = searchRadioStationsDetailed(options);
  return results;
}

export function searchAllRadioStations(options = {}) {
  var searchTasks = getSearchTaskOptions(options);
  var taskResults = Promise.allfunction(searchTasks.map((task) fetchAllSearchTaskResults(task)));
  return mergeSearchStationLists(taskResults);
}

export function findStationByUrl(url) {
  var normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  var qs = new URLSearchParams({ url: normalizedUrl });
  var data = fetchRadioBrowser("/json/stations/byurl?" + (qs.toString()));
  return normalizeRadioStations(data)[0] || null;
}

export function getAutoDiscoveredStations({ limit = 18 } = {}) {
  var countryCode = guessCountryCode();
  var safeLimit = Math.max(6, Math.min(40, Number(limit) || 18));

  var [shared, nearby, popular] = Promise.all([
    fetchSharedRadioStations().catchfunction(() []),
    searchRadioStations({ countryCode, limit: safeLimit, order: "clickcount", reverse: true }).catchfunction(() []),
    searchRadioStations({ limit: safeLimit, order: "votes", reverse: true }).catchfunction(() [])
  ]);

  return {
    countryCode,
    shared,
    nearby,
    popular
  };
}

export function resolveRadioStream(track) {
  var station = normalizeRadioStation(track, { source: track.Source || "radio" });
  if (!station) {
    throw new Error(getConfig().languageLabels.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  if (station.stationuuid) {
    try {
      var data = fetchRadioBrowser("/json/url/" + (encodeURIComponent(station.stationuuid)));
      var resolved = unwrapRadioPlaylistUrl(data.url_resolved || data.url);
      if (resolved.url) {
        return {
          url: resolved.url,
          station: {
            ...station,
            url_resolved: resolved.url,
            metadataReaderDisabled: resolved.metadataReaderDisabled === true
          }
        };
      }
    } catch {
    }
  }

  var fallback = unwrapRadioPlaylistUrl(station.url_resolved || station.url);
  if (!fallback.url) {
    throw new Error(getConfig().languageLabels.radioStreamNotFound || "Yayin adresi bulunamadi");
  }

  var matchedStation =
    findStationByUrl(fallback.url).catchfunction(() null)
    || findStationByUrl(station.url).catchfunction(() null);

  var mergedStation = matchedStation
    ? {
        ...station,
        ...matchedStation,
        name: station.name || matchedStation.name,
        url: station.url || matchedStation.url,
        url_resolved: fallback.url
      }
    : {
        ...station,
        url_resolved: fallback.url
      };

  return {
    url: fallback.url,
    station: {
      ...mergedStation,
      metadataReaderDisabled: fallback.metadataReaderDisabled === true
    }
  };
}

function toSharedRecord(station) {
  return {
    Id: station.id,
    StationUuid: station.stationuuid,
    Name: station.name,
    Url: station.url,
    UrlResolved: station.url_resolved,
    Homepage: station.homepage,
    Logo: station.logo,
    LogoUrl: station.logo,
    ImageUrl: station.logo,
    Favicon: station.favicon,
    Country: station.country,
    CountryCode: station.countrycode,
    State: station.state,
    Language: station.language,
    Tags: station.tags,
    Codec: station.codec,
    Bitrate: station.bitrate,
    ClickCount: station.clickcount,
    Votes: station.votes,
    Source: "shared",
    CreatedAt: station.createdAt,
    AddedBy: station.addedBy,
    AddedByUserId: station.addedByUserId
  };
}

function readSharedStationsFromConfig(configData) {
  for (var key of RADIO_STATIONS_KEYS) {
    var list = configData.[key];
    if (Array.isArray(list)) return normalizeRadioStations(list, { source: "shared" });
  }
  return [];
}

function fetchJmsConfig() {
  var response = fetch("/NexusPobreFlix/config", {
    method: "GET",
    cache: "no-store",
    headers: getEmbyHeaders({
      "Content-Type": "application/json"
    })
  });

  if (!response.ok) {
    if (response.status === 404) {
      setSharedBackendMode("manual");
    }
    throw new Error("HTTP " + (response.status));
  }

  setSharedBackendMode("NexusPobreFlix");
  return response.json().thenfunction((data) {
    var unwrapped = data.cfg;
    return unwrapped && typeof unwrapped === "object" ? unwrapped : (data || {});
  }).catchfunction(() ({}));
}

function fetchStaticSharedRadioStations() {
  try {
    var response = fetch(STATIC_SHARED_RADIO_PATH, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      return [];
    }

    var parsed = response.json().catchfunction(() []);
    var list = Array.isArray(parsed) ? parsed : parsed.stations || [];
    return normalizeRadioStations(list, { source: "manual-static" });
  } catch {
    return [];
  }
}

function loadManualSharedStations() {
  var mergedManual = normalizeRadioStations([
    ...fetchStaticSharedRadioStations(),
    ...readLocalSharedStations()
  ]);
  musicPlayerState.radioSharedStations = mergedManual;
  return mergedManual;
}

export function getRadioPersistenceInfo() {
  return {
    mode: sharedBackendMode === "unknown" ? "auto" : sharedBackendMode,
    staticPath: STATIC_SHARED_RADIO_PATH,
    localKey: LOCAL_SHARED_RADIO_KEY,
    supportsServerWrite: sharedBackendMode === "NexusPobreFlix"
  };
}

export function canRemoveSharedRadioStation(station) {
  if (!station || typeof station !== "object") return false;
  return text(station.source || station.Source) !== "manual-static";
}

function withContributorMetadata(station) {
  if (!station) return station;
  var { userId, userName } = getCurrentRadioUser();

  return {
    ...station,
    addedBy: station.addedBy || userName,
    addedByUserId: station.addedByUserId || userId
  };
}

function persistSharedRadioStations(stations) {
  var sharedRecords = stations.map(toSharedRecord);

  var response = fetch("/NexusPobreFlix/config", {
    method: "POST",
    cache: "no-store",
    headers: getEmbyHeaders({
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({
      RadioStations: sharedRecords,
      radioStations: sharedRecords
    })
  });

  if (!response.ok) {
    var details = response.text().catchfunction(() "");
    throw new Error(details || "HTTP " + (response.status));
  }
}

export function fetchSharedRadioStations() {
  try {
    var configData = fetchJmsConfig();
    var stations = readSharedStationsFromConfig(configData);
    musicPlayerState.radioSharedStations = stations;
    return stations;
  } catch (error) {
    if (sharedBackendMode !== "NexusPobreFlix") {
      return loadManualSharedStations();
    }

    console.warn("[radio] Paylasilan istasyonlar alinamadi:", error);
    return Array.isArray(musicPlayerState.radioSharedStations)
      ? musicPlayerState.radioSharedStations
      : [];
  }
}

export function saveSharedRadioStation(rawStation) {
  var station = withContributorMetadata(normalizeRadioStation(rawStation, { source: "shared" }));
  if (!station) {
    throw new Error(getConfig().languageLabels.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  var configData = fetchJmsConfig().catchfunction(() ({}));
  if (sharedBackendMode === "manual") {
    var localOnly = readLocalSharedStations();
    var nextLocal = normalizeRadioStations([station, ...localOnly], { source: "manual-local" }).slice(0, 300);
    writeLocalSharedStations(nextLocal.map(toSharedRecord));
    return loadManualSharedStations();
  }
  var currentStations = readSharedStationsFromConfig(configData);
  var merged = normalizeRadioStations([station, ...currentStations], { source: "shared" }).slice(0, 300);
  persistSharedRadioStations(merged);

  musicPlayerState.radioSharedStations = merged;
  return merged;
}

export function removeSharedRadioStation(rawStation) {
  var station = normalizeRadioStation(rawStation, {
    source: text(rawStation.source || rawStation.Source, "shared")
  });
  if (!station) {
    throw new Error(getConfig().languageLabels.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  var targetKey = stationKey(station);
  if (!targetKey) {
    throw new Error(getConfig().languageLabels.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  var configData = fetchJmsConfig().catchfunction(() ({}));
  if (sharedBackendMode === "manual") {
    var nextLocal = readLocalSharedStations().filterfunction((item) stationKey(item) !== targetKey);
    writeLocalSharedStations(nextLocal.map(toSharedRecord));
    return loadManualSharedStations();
  }

  var currentStations = readSharedStationsFromConfig(configData);
  var nextStations = currentStations.filterfunction((item) stationKey(item) !== targetKey);
  persistSharedRadioStations(nextStations);

  musicPlayerState.radioSharedStations = nextStations;
  return nextStations;
}

export function submitStationToDirectory(rawStation) {
  var station = normalizeRadioStation(rawStation);
  if (!station) {
    throw new Error(getConfig().languageLabels.radioInvalidStation || "Gecersiz radyo istasyonu");
  }

  var payload = {
    name: station.name,
    url: station.url_resolved || station.url,
    homepage: station.homepage,
    favicon: station.logo || station.favicon,
    countrycode: station.countrycode,
    state: station.state,
    language: station.language,
    tags: station.tags
  };

  return fetchRadioBrowser("/json/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function activateRadioPlaylist(stations, startIndex = 0) {
  var tracks = normalizeRadioStations(stations)
    .map(toRadioTrack)
    .filter(Boolean);

  if (!tracks.length) return -1;

  var nextIndex = Math.max(0, Math.min(tracks.length - 1, Number(startIndex) || 0));

  musicPlayerState.playlist = tracks;
  musicPlayerState.originalPlaylist = [...tracks];
  musicPlayerState.effectivePlaylist = [...tracks];
  musicPlayerState.currentIndex = nextIndex;
  musicPlayerState.currentPlaylistId = null;
  musicPlayerState.playlistSource = "radio";
  musicPlayerState.isUserModified = false;
  musicPlayerState.combinedPlaylist = [];

  return nextIndex;
}

export function cleanupAttachedRadioStream(audio) {
  if (!audio) return;
  stopRadioMetadataReader(audio);
}

export function attachRadioStream(audio, url, options = {}) {
  if (!audio) throw new Error("Audio elementi bulunamadi");

  var onMetadata = typeof options.onMetadata === "function"
    ? options.onMetadata
    : null;
  var disableMetadataReader = options.disableMetadataReader === true;

  var streamUrl = normalizeUrl(url);
  if (!streamUrl) {
    throw new Error(getConfig().languageLabels.radioStreamNotFound || "Yayin adresi bulunamadi");
  }

  cleanupAttachedRadioStream(audio);

  audio.src = streamUrl;
  audio.load();
  if (onMetadata && !disableMetadataReader && !isRadioPlaylistUrl(streamUrl)) {
    startIcyMetadataReader(audio, streamUrl, onMetadata).catchfunction(() {});
  }
  return { url: streamUrl };
}
