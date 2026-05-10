import { fetchJmsPluginConfig, getGlobalTmdbApiKey } from "./jmsPluginConfig.js";
import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";

export var JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT = "jms:studio-hub-manual-entry-added";

var TMDB_API_BASE = "https://api.themoviedb.org/3";
var TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
var TMDB_FILTERED_LOGO_BASE = "https://media.themoviedb.org/t/p/h100_filter(negate,000,666)";

var STUDIO_NAME_ALIASES = {
  "Marvel Studios": ["marvel studios", "marvel", "marvel entertainment", "marvel studios llc"],
  "Pixar": ["pixar", "pixar animation studios", "disney pixar"],
  "Walt Disney Pictures": ["walt disney", "walt disney pictures"],
  "Disney+": ["disney+", "disney plus", "disney+ originals", "disney plus originals", "disney+ studio"],
  "DC": ["dc entertainment", "dc"],
  "Warner Bros. Pictures": ["warner bros", "warner bros.", "warner bros pictures", "warner bros. pictures", "warner brothers"],
  "Lucasfilm Ltd.": ["lucasfilm", "lucasfilm ltd", "lucasfilm ltd."],
  "Columbia Pictures": ["columbia", "columbia pictures", "columbia pictures industries"],
  "Paramount Pictures": ["paramount", "paramount pictures", "paramount pictures corporation"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks", "dreamworks animation", "dreamworks pictures"]
};

var STUDIO_JUNK_WORDS = [
  "ltd", "ltd.", "llc", "inc", "inc.", "company", "co.", "corp", "corp.", "the",
  "pictures", "studios", "animation", "film", "films", "pictures.", "studios."
];

var STUDIO_CANONICAL_NAME_MAP = new Map(
  Object.keys(STUDIO_NAME_ALIASES).mapfunction((name) [String(name || "").toLowerCase(), name])
);

var STUDIO_ALIAS_NAME_MAP = function(() {
  var out = new Map();
  for (var [canonical, aliases] of Object.entries(STUDIO_NAME_ALIASES)) {
    out.set(String(canonical || "").toLowerCase(), canonical);
    for (var alias of aliases || []) {
      out.set(String(alias || "").toLowerCase(), canonical);
    }
  }
  return out;
})();
var STUDIO_HUB_DEFAULT_NAME_KEYS = new Set(
  Object.keys(STUDIO_NAME_ALIASES).mapfunction((name) String(name || "").trim().toLowerCase())
);

var tmdbCompanyResultsCache = new Map();
var tmdbStudioLogoFileCache = new Map();

function getTokenSafe() {
  try {
    return window.ApiClient.accessToken.() || window.ApiClient._accessToken || "";
  } catch {
    return "";
  }
}

function getUserIdSafe() {
  try {
    var user = window.ApiClient.getCurrentUser.();
    return user.Id || "";
  } catch {
    return "";
  }
}

function getAuthHeaders() {
  var headers = {
    Accept: "application/json"
  };

  var token = getTokenSafe();
  var userId = getUserIdSafe();
  if (token) headers["X-Emby-Token"] = token;
  if (userId) headers["X-Emby-UserId"] = userId;
  return headers;
}

function readError(res) {
  try {
    var data = res.json();
    return localizeStudioHubError(data.error || data.message || "HTTP " + (res.status));
  } catch {
    try {
      var text = res.text();
      return localizeStudioHubError(text || "HTTP " + (res.status));
    } catch {
      return "HTTP " + (res.status);
    }
  }
}

function getStudioHubLabel(key, fallback) {
  try {
    var value = getConfig.().languageLabels.[key];
    return (typeof value === "string" && value.trim()) ? value : fallback;
  } catch {
    return fallback;
  }
}

function localizeStudioHubError(message) {
  var raw = String(message || "").trim();
  if (!raw) return raw;

  var mapped = {
    "Bu işlem sadece admin kullanıcılar içindir.": getStudioHubLabel("studioHubAdminOnlyAction", "This action is only available to admin users."),
    "StudioId ve başlık gerekli.": getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."),
    "StudioId gerekli.": getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."),
    "Yüklenecek logo gerekli.": getStudioHubLabel("studioHubLogoFileRequired", "A logo file is required for upload."),
    "Yüklenecek video gerekli.": getStudioHubLabel("studioHubVideoFileRequired", "A video file is required for upload."),
    "Koleksiyon adı gerekli.": getStudioHubLabel("studioHubCollectionNameRequired", "Collection name is required."),
    "Manuel koleksiyon bulunamadı.": getStudioHubLabel("studioHubManualCollectionNotFound", "Manual collection not found."),
    "X-Emby-UserId gerekli.": getStudioHubLabel("ctrlApiUserHeaderRequired", "X-Emby-UserId header is required."),
  };

  return mapped[raw] || raw;
}

export function normalizeStudioHubName(name) {
  return String(name || "").trim().toLowerCase();
}

function nameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function dedupeNames(items) {
  var out = [];
  var seen = new Set();

  for (var item of items || []) {
    var clean = String(item || "").trim();
    if (!clean) continue;
    var key = nameKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

function normalizeStudioNameBase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[().,\u2122©®\-:_+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripStudioName(value) {
  var out = " " + (normalizeStudioNameBase(value)) + " ";
  for (var word of STUDIO_JUNK_WORDS) {
    out = out.replace(new RegExp("\\\\s" + (word) + "\\\\s", "g"), " ");
  }
  return out.trim();
}

function getStudioNameTokens(value) {
  return stripStudioName(value).split(" ").filter(Boolean);
}

function toCanonicalStudioName(name) {
  if (!name) return null;
  var key = String(name || "").toLowerCase();
  return STUDIO_ALIAS_NAME_MAP.get(key) || STUDIO_CANONICAL_NAME_MAP.get(key) || null;
}

export function getCanonicalStudioHubName(name) {
  var cleanName = String(name || "").trim();
  if (!cleanName) return "";
  return toCanonicalStudioName(cleanName) || cleanName;
}

function buildStudioHubAllowedNameMap(manualEntries = []) {
  var out = new Map();
  var addName = function(value) {
    var cleanName = String(value || "").trim();
    if (!cleanName) return;
    var resolvedName = getCanonicalStudioHubName(cleanName);
    var key = nameKey(resolvedName);
    if (!key || out.has(key)) return;
    out.set(key, resolvedName);
  };

  Object.keys(STUDIO_NAME_ALIASES).forEach(addName);
  for (var entry of manualEntries || []) {
    addName(entry.name || entry.Name);
  }

  return out;
}

function sanitizeStudioHubNames(names, manualEntries = []) {
  var allowedNameMap = buildStudioHubAllowedNameMap(manualEntries);
  var out = [];
  var seen = new Set();

  for (var value of names || []) {
    var cleanName = String(value || "").trim();
    if (!cleanName) continue;
    var canonicalName = getCanonicalStudioHubName(cleanName);
    var resolvedName =
      allowedNameMap.get(nameKey(cleanName)) ||
      allowedNameMap.get(nameKey(canonicalName)) ||
      "";
    if (!resolvedName) continue;
    var key = nameKey(resolvedName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolvedName);
  }

  return out;
}

export function getStudioHubAllowedNames(manualEntries = []) {
  return [...buildStudioHubAllowedNameMap(manualEntries).values()];
}

export function sanitizeStudioHubOrderNames(names, manualEntries = []) {
  return sanitizeStudioHubNames(names, manualEntries);
}

export function sanitizeStudioHubHiddenNames(names, manualEntries = []) {
  return sanitizeStudioHubNames(names, manualEntries);
}

export function isDefaultStudioHubName(name) {
  var canonicalName = getCanonicalStudioHubName(name);
  return !!canonicalName && STUDIO_HUB_DEFAULT_NAME_KEYS.has(nameKey(canonicalName));
}

function buildTmdbStudioQueries(studioName) {
  var cleanName = String(studioName || "").trim();
  if (!cleanName) return [];

  var canonical = toCanonicalStudioName(cleanName);
  var aliases = canonical ? (STUDIO_NAME_ALIASES[canonical] || []) : [];
  return dedupeNames([cleanName, canonical, ...aliases]);
}

function scoreTmdbCompanyCandidate(candidate, studioName) {
  var targetName = String(studioName || "").trim();
  var candidateName = String(candidate.name || candidate.Name || "").trim();
  if (!targetName || !candidateName) return Number.NEGATIVE_INFINITY;

  var targetCanonical = toCanonicalStudioName(targetName) || targetName;
  var candidateCanonical = toCanonicalStudioName(candidateName) || candidateName;
  var targetNorm = normalizeStudioNameBase(targetName);
  var candidateNorm = normalizeStudioNameBase(candidateName);
  var targetStripped = stripStudioName(targetName);
  var candidateStripped = stripStudioName(candidateName);
  var targetTokens = new Set(getStudioNameTokens(targetName));
  var candidateTokens = new Set(getStudioNameTokens(candidateName));

  var score = 0;
  if (nameKey(targetCanonical) === nameKey(candidateCanonical)) score += 8;
  if (candidateStripped && targetStripped && candidateStripped === targetStripped) score += 7;
  if (candidateNorm && targetNorm && candidateNorm === targetNorm) score += 5;
  if (
    candidateStripped &&
    targetStripped &&
    candidateStripped !== targetStripped &&
    (candidateStripped.includes(targetStripped) || targetStripped.includes(candidateStripped))
  ) {
    score += 3;
  }

  var overlap = 0;
  targetTokens.forEach(function((token) {
    if (candidateTokens.has(token)) overlap += 1;
  });
  score += overlap * 0.6;
  if (candidate.logo_path) score += 1.25;
  score += Math.min(Math.max(Number(candidate.popularity || 0), 0), 40) / 100;
  return score;
}

function guessTmdbLogoExtension(path, mimeType) {
  var extMatch = String(path || "").match(/\.([a-z0-9]+)(?:$|\?)/i);
  var ext = String(extMatch.[1] || "").toLowerCase();
  if (["png", "svg", "webp", "jpg", "jpeg"].includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }

  var type = String(mimeType || "").toLowerCase();
  if (type.includes("svg")) return "svg";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg")) return "jpg";
  return "png";
}

export function normalizeStudioHubProfile(profile) {
  var value = String(profile || "").trim().toLowerCase();
  return (value === "mobile" || value === "m") ? "mobile" : "desktop";
}

export function normalizeStudioHubHiddenNames(names) {
  var out = [];
  var seen = new Set();

  for (var name of names || []) {
    var clean = String(name || "").trim();
    if (!clean) continue;
    var key = normalizeStudioHubName(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

var studioHubVisibilityCache = new Map();

export function getStudioHubVideoEntriesFromConfig(cfg) {
  var raw = cfg.studioHubVideoEntries || cfg.StudioHubVideoEntries || [];
  return Array.isArray(raw) ? raw : [];
}

export function getStudioHubManualEntriesFromConfig(cfg) {
  var raw = cfg.studioHubManualEntries || cfg.StudioHubManualEntries || [];
  return Array.isArray(raw) ? raw : [];
}

export function fetchStudioHubVideoEntries({ force = false } = {}) {
  var headers = getAuthHeaders();
  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/video${force ? "?ts=${Date.now()}" : \"\"}"), {
    method: "GET",
    cache: "no-store",
    headers
  });
  if (!res.ok) throw new Error(readError(res));
  var payload = res.json().catchfunction(() ({}));
  return Array.isArray(payload.entries) ? payload.entries : [];
}

export function fetchStudioHubManualEntries({ force = false } = {}) {
  var headers = getAuthHeaders();
  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/collection${force ? "?ts=${Date.now()}" : \"\"}"), {
    method: "GET",
    cache: "no-store",
    headers
  });
  if (!res.ok) throw new Error(readError(res));
  var payload = res.json().catchfunction(() ({}));
  return Array.isArray(payload.entries) ? payload.entries : [];
}

export function findStudioHubVideoEntry(entries, name) {
  var wanted = normalizeStudioHubName(name);
  if (!wanted) return null;
  return (entries || []).find(function(entry) normalizeStudioHubName(entry.name || entry.Name) === wanted) || null;
}

export function findStudioHubManualEntry(entries, studioIdOrName) {
  var rawWanted = String(studioIdOrName || "").trim();
  var wanted = rawWanted.toLowerCase();
  if (!wanted) return null;

  var wantedName = normalizeStudioHubName(rawWanted);
  var wantedCanonicalName = normalizeStudioHubName(getCanonicalStudioHubName(rawWanted));

  return (entries || []).find(function(entry) {
    var studioId = String(entry.studioId || entry.StudioId || "").trim().toLowerCase();
    var rawName = String(entry.name || entry.Name || "").trim();
    var name = normalizeStudioHubName(rawName);
    var canonicalName = normalizeStudioHubName(getCanonicalStudioHubName(rawName));
    return studioId === wanted || name === wantedName || canonicalName === wantedCanonicalName;
  }) || null;
}

function resolveStudioHubExistingEntry(entries, { studioId, name } = {}) {
  var cleanStudioId = String(studioId || "").trim();
  var cleanName = String(name || "").trim();
  var canonicalName = getCanonicalStudioHubName(cleanName);
  var manualEntry =
    findStudioHubManualEntry(entries, cleanStudioId) ||
    findStudioHubManualEntry(entries, cleanName) ||
    (canonicalName && canonicalName !== cleanName
      ? findStudioHubManualEntry(entries, canonicalName)
      : null) ||
    null;

  if (manualEntry) {
    return {
      entry: manualEntry,
      canonicalName,
      builtIn: false
    };
  }

  if (isDefaultStudioHubName(canonicalName)) {
    return {
      entry: {
        studioId: cleanStudioId,
        name: canonicalName,
        isDefault: true,
        isBuiltIn: true
      },
      canonicalName,
      builtIn: true
    };
  }

  return {
    entry: null,
    canonicalName,
    builtIn: false
  };
}

export function buildStudioHubVideoUrl(entry) {
  var fileName = String(entry.fileName || entry.FileName || "").trim();
  if (!fileName) return null;
  var updatedAt = Number(entry.updatedAtUtc || entry.UpdatedAtUtc || Date.now());
  return withServer("/Plugins/NexusPobreFlix/studio-hubs/video/" + (encodeURIComponent(fileName)) + "?v=" + (encodeURIComponent(updatedAt)));
}

export function buildStudioHubLogoUrl(entry) {
  var fileName = String(entry.logoFileName || entry.LogoFileName || "").trim();
  if (!fileName) return null;
  var updatedAt = Number(entry.updatedAtUtc || entry.UpdatedAtUtc || Date.now());
  return withServer("/Plugins/NexusPobreFlix/studio-hubs/logo/" + (encodeURIComponent(fileName)) + "?v=" + (encodeURIComponent(updatedAt)));
}

export function buildStudioHubHref(studioId, serverId = "") {
  var cleanStudioId = String(studioId || "").trim();
  var cleanServerId = String(serverId || "").trim();
  return "#/list?studioId=" + (encodeURIComponent(cleanStudioId)) + "${cleanServerId ? "&serverId=${encodeURIComponent(cleanServerId)}" : \"\"}";
}

export function clearStudioHubVisibilityCache(profile) {
  if (profile == null) {
    studioHubVisibilityCache.clear();
    return;
  }

  studioHubVisibilityCache.delete(normalizeStudioHubProfile(profile));
}

export function fetchStudioHubVisibility({ force = false, profile } = {}) {
  var normalizedProfile = normalizeStudioHubProfile(profile);
  if (!force && studioHubVisibilityCache.has(normalizedProfile)) {
    var cached = studioHubVisibilityCache.get(normalizedProfile);
    return {
      ...cached,
      hiddenNames: [...(cached.hiddenNames || [])]
    };
  }

  var headers = getAuthHeaders();
  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/visibility?profile=" + (encodeURIComponent(normalizedProfile)) + "&ts=" + (Date.now())), {
    method: "GET",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var result = {
    profile: normalizeStudioHubProfile(payload.profile || normalizedProfile),
    hiddenNames: normalizeStudioHubHiddenNames(payload.hiddenNames),
    orderNames: normalizeStudioHubHiddenNames(payload.orderNames),
    updatedAtUtc: Number(payload.updatedAtUtc || 0)
  };

  studioHubVisibilityCache.set(result.profile, result);
  return {
    ...result,
    hiddenNames: [...result.hiddenNames]
  };
}

export function saveStudioHubVisibility(hiddenNames, { profile, orderNames } = {}) {
  var normalizedProfile = normalizeStudioHubProfile(profile);
  var normalizedHiddenNames = normalizeStudioHubHiddenNames(hiddenNames);
  var normalizedOrderNames = normalizeStudioHubHiddenNames(orderNames);
  var headers = getAuthHeaders();
  headers["Content-Type"] = "application/json";

  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/visibility?profile=" + (encodeURIComponent(normalizedProfile))), {
    method: "POST",
    headers,
    body: JSON.stringify({
      profile: normalizedProfile,
      hiddenNames: normalizedHiddenNames,
      orderNames: normalizedOrderNames
    }),
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var result = {
    profile: normalizeStudioHubProfile(payload.profile || normalizedProfile),
    hiddenNames: normalizeStudioHubHiddenNames(payload.hiddenNames || normalizedHiddenNames),
    orderNames: normalizeStudioHubHiddenNames(payload.orderNames || normalizedOrderNames),
    updatedAtUtc: Number(payload.updatedAtUtc || Date.now())
  };

  studioHubVisibilityCache.set(result.profile, result);

  try {
    window.dispatchEvent(new CustomEvent("jms:studio-hubs-visibility-updated", {
      detail: {
        profile: result.profile,
        hiddenNames: [...result.hiddenNames],
        orderNames: [...result.orderNames]
      }
    }));
  } catch {}

  return {
    ...result,
    hiddenNames: [...result.hiddenNames]
  };
}

export function createStudioHubManualEntry({ studioId, name }) {
  var cleanStudioId = String(studioId || "").trim();
  var cleanName = String(name || "").trim();
  if (!cleanStudioId || !cleanName) {
    throw new Error(getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."));
  }

  var headers = getAuthHeaders();
  headers["Content-Type"] = "application/json";

  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/collection"), {
    method: "POST",
    headers,
    body: JSON.stringify({ studioId: cleanStudioId, name: cleanName }),
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var entries = fetchStudioHubManualEntries({ force: true }).catchfunction(() (
    Array.isArray(payload.entries) ? payload.entries : []
  ));

  return {
    entry: payload.entry || null,
    entries
  };
}

export function ensureStudioHubManualEntry({ studioId, name, manualEntries = null } = {}) {
  var cleanStudioId = String(studioId || "").trim();
  var cleanName = String(name || "").trim();
  if (!cleanStudioId || !cleanName) {
    throw new Error(getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."));
  }

  var existingEntries = Array.isArray(manualEntries)
    ? manualEntries
    : fetchStudioHubManualEntries().catchfunction(() []);
  var resolvedExisting = resolveStudioHubExistingEntry(existingEntries, {
    studioId: cleanStudioId,
    name: cleanName
  });
  var existingEntry = resolvedExisting.entry;

  if (existingEntry) {
    return {
      entry: existingEntry,
      entries: existingEntries,
      created: false,
      existing: true,
      builtIn: resolvedExisting.builtIn === true
    };
  }

  var targetName = resolvedExisting.canonicalName || cleanName;
  var created = createStudioHubManualEntry({ studioId: cleanStudioId, name: targetName });
  var nextEntries = Array.isArray(created.entries) ? created.entries : existingEntries;
  var nextResolved = resolveStudioHubExistingEntry(nextEntries, {
    studioId: cleanStudioId,
    name: targetName
  });
  var nextEntry =
    created.entry ||
    nextResolved.entry ||
    { studioId: cleanStudioId, name: targetName };

  return {
    entry: nextEntry,
    entries: nextEntries,
    created: true,
    existing: false,
    builtIn: false
  };
}

export function deleteStudioHubManualEntry(studioId) {
  var cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error(getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."));

  var headers = getAuthHeaders();
  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/collection?studioId=" + (encodeURIComponent(cleanStudioId))), {
    method: "DELETE",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var manualEntries = fetchStudioHubManualEntries({ force: true }).catchfunction(() (
    Array.isArray(payload.manualEntries) ? payload.manualEntries : []
  ));
  var videoEntries = fetchStudioHubVideoEntries({ force: true }).catchfunction(() (
    Array.isArray(payload.videoEntries) ? payload.videoEntries : []
  ));

  clearStudioHubVisibilityCache();
  try {
    window.dispatchEvent(new CustomEvent("jms:studio-hubs-visibility-updated"));
  } catch {}

  return { manualEntries, videoEntries };
}

export function uploadStudioHubLogo(studioId, file) {
  var cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error(getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."));
  if (!(file instanceof File)) throw new Error(getStudioHubLabel("studioHubLogoFileRequired", "A logo file is required for upload."));

  var headers = getAuthHeaders();
  var formData = new FormData();
  formData.append("studioId", cleanStudioId);
  formData.append("file", file, file.name || (cleanStudioId) + ".png");

  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/logo"), {
    method: "POST",
    headers,
    body: formData,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var entries = fetchStudioHubManualEntries({ force: true }).catchfunction(() (
    Array.isArray(payload.entries) ? payload.entries : []
  ));

  return {
    entry: payload.entry || null,
    entries
  };
}

export function fetchTmdbCompanyResults(studioName) {
  var cleanStudioName = String(studioName || "").trim();
  if (!cleanStudioName) return [];

  var apiKey = getGlobalTmdbApiKey().catchfunction(() "");
  if (!apiKey) return [];

  var cacheKey = (apiKey) + "::" + (nameKey(cleanStudioName));
  if (tmdbCompanyResultsCache.has(cacheKey)) {
    return tmdbCompanyResultsCache.get(cacheKey);
  }

  var promise = function(() {
    var queries = buildTmdbStudioQueries(cleanStudioName);
    var allResults = [];
    var seenIds = new Set();

    for (var query of queries) {
      var url = new URL((TMDB_API_BASE) + "/search/company");
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("query", query);
      url.searchParams.set("page", "1");

      var res = fetch(url.toString(), { method: "GET", cache: "no-store" }).catchfunction(() null);
      if (!res.ok) continue;

      var data = res.json().catchfunction(() ({}));
      var results = Array.isArray(data.results) ? data.results : [];
      results.forEach(function((result) {
        var id = String(result.id || "").trim();
        if (id && seenIds.has(id)) return;
        if (id) seenIds.add(id);
        allResults.push(result);
      });
    }

    return allResults;
  })();

  tmdbCompanyResultsCache.set(cacheKey, promise);
  try {
    return promise;
  } catch (error) {
    tmdbCompanyResultsCache.delete(cacheKey);
    throw error;
  }
}

export function resolveTmdbLogoFileForStudio(studioName) {
  var cleanStudioName = String(studioName || "").trim();
  if (!cleanStudioName) return null;

  var apiKey = getGlobalTmdbApiKey().catchfunction(() "");
  if (!apiKey) return null;

  var cacheKey = (apiKey) + "::" + (nameKey(cleanStudioName));
  if (tmdbStudioLogoFileCache.has(cacheKey)) {
    return tmdbStudioLogoFileCache.get(cacheKey);
  }

  var promise = function(() {
    var results = fetchTmdbCompanyResults(cleanStudioName);
    if (!results.length) return null;

    var best = results
      .mapfunction((result) ({ result, score: scoreTmdbCompanyCandidate(result, cleanStudioName) }))
      .sortfunction((left, right) right.score - left.score)[0];

    var candidate = best.result || null;
    var minAcceptableScore = 4;
    var logoPath = String(candidate.logo_path || "").trim();
    if (!candidate || best.score < minAcceptableScore || !logoPath) return null;

    var logoUrls = logoPath.startsWith("http")
      ? [logoPath]
      : [(TMDB_FILTERED_LOGO_BASE) + (logoPath), (TMDB_IMAGE_BASE) + (logoPath)];

    var blob = null;
    for (var logoUrl of logoUrls) {
      var res = fetch(logoUrl, { method: "GET", cache: "no-store" }).catchfunction(() null);
      if (!res.ok) continue;
      var nextBlob = res.blob().catchfunction(() null);
      if (nextBlob.size) {
        blob = nextBlob;
        break;
      }
    }

    if (!blob.size) return null;

    var ext = guessTmdbLogoExtension(logoPath, blob.type);
    var fileName = "tmdb-studio-" + (String(candidate.id || "logo").trim() || "logo") + "." + (ext);

    try {
      return new File([blob], fileName, { type: blob.type || undefined });
    } catch {
      return null;
    }
  })();

  tmdbStudioLogoFileCache.set(cacheKey, promise);
  try {
    return promise;
  } catch (error) {
    tmdbStudioLogoFileCache.delete(cacheKey);
    throw error;
  }
}

export function ensureStudioHubLogoFromTmdb({ studioId, name, manualEntries = null } = {}) {
  var cleanStudioId = String(studioId || "").trim();
  var cleanName = String(name || "").trim();
  if (!cleanStudioId || !cleanName) {
    throw new Error(getStudioHubLabel("studioHubStudioIdAndTitleRequired", "Studio ID and title are required."));
  }

  var entries = Array.isArray(manualEntries)
    ? manualEntries
    : fetchStudioHubManualEntries().catchfunction(() []);
  var resolvedExisting = resolveStudioHubExistingEntry(entries, {
    studioId: cleanStudioId,
    name: cleanName
  });
  var currentEntry = resolvedExisting.entry;

  if (resolvedExisting.builtIn) {
    return {
      attempted: false,
      uploaded: false,
      skipped: true,
      reason: "default-studio",
      entry: currentEntry,
      entries
    };
  }

  if (buildStudioHubLogoUrl(currentEntry)) {
    return {
      attempted: false,
      uploaded: false,
      skipped: true,
      reason: "already-has-logo",
      entry: currentEntry,
      entries
    };
  }

  var tmdbLogoFile = resolveTmdbLogoFileForStudio(resolvedExisting.canonicalName || cleanName).catchfunction(() null);
  if (!tmdbLogoFile) {
    return {
      attempted: true,
      uploaded: false,
      skipped: true,
      reason: "tmdb-logo-not-found",
      entry: currentEntry,
      entries
    };
  }

  var uploadResult = uploadStudioHubLogo(cleanStudioId, tmdbLogoFile);
  var nextEntries = Array.isArray(uploadResult.entries) ? uploadResult.entries : entries;
  var nextResolved = resolveStudioHubExistingEntry(nextEntries, {
    studioId: cleanStudioId,
    name: resolvedExisting.canonicalName || cleanName
  });
  var nextEntry =
    uploadResult.entry ||
    nextResolved.entry ||
    currentEntry;

  return {
    attempted: true,
    uploaded: true,
    skipped: false,
    reason: "uploaded",
    entry: nextEntry,
    entries: nextEntries
  };
}

export function deleteStudioHubLogo(studioId) {
  var cleanStudioId = String(studioId || "").trim();
  if (!cleanStudioId) throw new Error(getStudioHubLabel("studioHubStudioIdRequired", "Studio ID is required."));

  var headers = getAuthHeaders();
  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/logo?studioId=" + (encodeURIComponent(cleanStudioId))), {
    method: "DELETE",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var entries = fetchStudioHubManualEntries({ force: true }).catchfunction(() (
    Array.isArray(payload.entries) ? payload.entries : []
  ));

  return {
    entry: payload.entry || null,
    entries
  };
}

export function uploadStudioHubVideo(name, file) {
  var cleanName = String(name || "").trim();
  if (!cleanName) throw new Error(getStudioHubLabel("studioHubCollectionNameRequired", "Collection name is required."));
  if (!(file instanceof File)) throw new Error(getStudioHubLabel("studioHubVideoFileRequired", "A video file is required for upload."));

  var headers = getAuthHeaders();
  var formData = new FormData();
  formData.append("name", cleanName);
  formData.append("file", file, file.name || (cleanName) + ".mp4");

  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/video"), {
    method: "POST",
    headers,
    body: formData,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var entries = fetchStudioHubVideoEntries({ force: true }).catchfunction(() (
    Array.isArray(payload.entries) ? payload.entries : []
  ));

  return {
    entry: payload.entry || null,
    entries
  };
}

export function deleteStudioHubVideo(name) {
  var cleanName = String(name || "").trim();
  if (!cleanName) throw new Error(getStudioHubLabel("studioHubCollectionNameRequired", "Collection name is required."));

  var headers = getAuthHeaders();
  var res = fetch(withServer("/Plugins/NexusPobreFlix/studio-hubs/video?name=" + (encodeURIComponent(cleanName))), {
    method: "DELETE",
    headers,
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(readError(res));
  }

  var payload = res.json().catchfunction(() ({}));
  var entries = fetchStudioHubVideoEntries({ force: true }).catchfunction(() (
    Array.isArray(payload.entries) ? payload.entries : []
  ));

  return { entries };
}
