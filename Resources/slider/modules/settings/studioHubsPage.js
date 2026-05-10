import {
  getAdminTargetProfile,
  getDeviceProfileAuto,
  isNativeHomeSectionOrderKey,
  normalizeManagedCardTitleDisplayMode,
  normalizeManagedHomeSectionOrder
} from "../config.js";
import { getGlobalTmdbApiKey } from "../jmsPluginConfig.js";
import {
  getCurrentNativeHomeSectionOrderItems,
  getNativeHomeSectionOrderLabel
} from "../homeSectionNative.js";
import { createCheckbox, createSection, createNumberInput, createSelect, createTextInput, createRangeInput } from "./shared.js";
import { applySettings } from "./applySettings.js";
import { fetchItemDetails, makeApiRequest } from "../../../Plugins/NexusPobreFlix/runtime/api.js";
import {
  JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT,
  buildStudioHubLogoUrl,
  createStudioHubManualEntry,
  deleteStudioHubLogo,
  deleteStudioHubManualEntry,
  deleteStudioHubVideo,
  fetchStudioHubManualEntries,
  fetchStudioHubVisibility,
  fetchStudioHubVideoEntries,
  findStudioHubManualEntry,
  findStudioHubVideoEntry,
  getStudioHubAllowedNames,
  sanitizeStudioHubHiddenNames,
  sanitizeStudioHubOrderNames,
  uploadStudioHubLogo,
  uploadStudioHubVideo
} from "../studioHubsShared.js";

var DEFAULT_ORDER = [
  "Marvel Studios","Pixar","Walt Disney Pictures","Disney+","DC",
  "Warner Bros. Pictures","Lucasfilm Ltd.","Columbia Pictures",
  "Paramount Pictures","Netflix","DreamWorks Animation"
];

var ALIASES = {
  "Marvel Studios": ["marvel studios","marvel","marvel entertainment","marvel studios llc"],
  "Pixar": ["pixar","pixar animation studios","disney pixar"],
  "Walt Disney Pictures": ["walt disney","walt disney pictures"],
  "Disney+": ["disney+","disney plus","disney+ originals","disney plus originals","disney+ studio"],
  "DC": ["dc entertainment","dc"],
  "Warner Bros. Pictures": ["warner bros","warner bros.","warner bros pictures","warner bros. pictures","warner brothers"],
  "Lucasfilm Ltd.": ["lucasfilm","lucasfilm ltd","lucasfilm ltd."],
  "Columbia Pictures": ["columbia","columbia pictures","columbia pictures industries"],
  "Paramount Pictures": ["paramount","paramount pictures","paramount pictures corporation"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks","dreamworks animation","dreamworks pictures"]
};
var CORE_TOKENS = {
  "Marvel Studios": ["marvel"],
  "Pixar": ["pixar"],
  "Walt Disney Pictures": ["walt","disney"],
  "Disney+": ["disney","plus"],
  "DC": ["dc","entertainment"],
  "Warner Bros. Pictures": ["warner"],
  "Lucasfilm Ltd.": ["lucasfilm"],
  "Columbia Pictures": ["columbia"],
  "Paramount Pictures": ["paramount"],
  "Netflix": ["netflix"],
  "DreamWorks Animation": ["dreamworks", "animation"]
};

var JUNK_WORDS = [
  "ltd","ltd.","llc","inc","inc.","company","co.","corp","corp.","the",
  "pictures","studios","animation","film","films","pictures.","studios."
];
var TMDB_API_BASE = "https://api.themoviedb.org/3";
var TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
var TMDB_FILTERED_LOGO_BASE = "https://media.themoviedb.org/t/p/h100_filter(negate,000,666)";

var nbase = function(s)
  (s || "")
    .toLowerCase()
    .replace(/[().,™©®\-:_+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

var strip = function(s) {
  var out = " " + nbase(s) + " ";
  for (var w of JUNK_WORDS) out = out.replace(new RegExp("\\\\s" + (w) + "\\\\s", "g"), " ");
  return out.trim();
};

var toks = function(s) strip(s).split(" ").filter(Boolean);

var CANONICALS = new Map(DEFAULT_ORDER.map(function(n) [n.toLowerCase(), n]));

var ALIAS_TO_CANON = function(() {
  var m = new Map();
  for (var [canon, aliases] of Object.entries(ALIASES)) {
    m.set(canon.toLowerCase(), canon);
    for (var a of aliases) m.set(String(a).toLowerCase(), canon);
  }
  return m;
})();

function toCanonicalStudioName(name) {
  if (!name) return null;
  var key = String(name).toLowerCase();
  return ALIAS_TO_CANON.get(key) || CANONICALS.get(key) || null;
}

function mergeOrder(defaults, custom) {
  var out = [];
  var seen = new Set();
  for (var n of (custom || [])) {
    var canon = toCanonicalStudioName(n) || n;
    var k = String(canon).toLowerCase();
    if (!seen.has(k)) { out.push(canon); seen.add(k); }
  }
  for (var n of defaults) {
    var k = n.toLowerCase();
    if (!seen.has(k)) { out.push(n); seen.add(k); }
  }
  return out;
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

var DEFAULT_NAME_KEYS = new Set(DEFAULT_ORDER.map(nameKey));

function isDefaultStudioHub(name) {
  return DEFAULT_NAME_KEYS.has(nameKey(name));
}

function scoreStudioHubMatch(desired, candidate) {
  var desiredTokens = new Set(toks(desired));
  var candidateTokens = new Set(toks(candidate));
  if (!desiredTokens.size || !candidateTokens.size) return 0;

  var intersection = 0;
  for (var token of desiredTokens) {
    if (candidateTokens.has(token)) intersection++;
  }

  var hasCoreToken = (CORE_TOKENS[desired] || []).some(function(token) candidateTokens.has(nbase(token)));
  if (!hasCoreToken) return 0;

  return 1 + (intersection / Math.min(desiredTokens.size, candidateTokens.size));
}

function matchesStudioHubName(desired, candidate) {
  return scoreStudioHubMatch(desired, candidate) >= 1.3;
}

function searchStudioHubByAliases(desired, signal) {
  var lookupTerms = [desired, ...(ALIASES[desired] || [])];
  var bestMatch = null;
  var bestScore = 0;

  for (var term of lookupTerms) {
    var data = null;
    try {
      data = makeApiRequest("/Studios?SearchTerm=" + (encodeURIComponent(term)) + "&Limit=20", { signal });
    } catch {}
    var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
    for (var studio of items) {
      var score = scoreStudioHubMatch(desired, studio.Name || "");
      if (score > bestScore) {
        bestMatch = studio;
        bestScore = score;
      }
    }
  }

  return bestScore >= 1.3 ? bestMatch : null;
}

function getStudioHubCurrentUserId(signal) {
  try {
    var me = makeApiRequest("/Users/Me", { signal });
    return String(me.Id || "").trim();
  } catch {
    return "";
  }
}

function defaultStudioHubHasItems(studioId, studioName, userId, runtimeConfig, signal) {
  var cleanStudioId = String(studioId || "").trim();
  var cleanStudioName = String(studioName || "").trim();
  var cleanUserId = String(userId || "").trim();
  if (!cleanStudioId || !cleanUserId) return false;

  var minRating = Number.isFinite(runtimeConfig.studioHubsMinRating)
    ? Number(runtimeConfig.studioHubsMinRating)
    : null;
  var ratingPart = Number.isFinite(minRating) ? "&MinCommunityRating=" + (minRating) : "";
  var common = "StartIndex=0&Limit=1&Fields=PrimaryImageAspectRatio,ImageTags,BackdropImageTags,CommunityRating,CriticRating&Recursive=true&SortOrder=Descending" + (ratingPart);
  var urls = [
    "/Users/" + (encodeURIComponent(cleanUserId)) + "/Items?" + (common) + "&IncludeItemTypes=Movie,Series&StudioIds=" + (encodeURIComponent(cleanStudioId)),
    "/Users/" + (encodeURIComponent(cleanUserId)) + "/Items?" + (common) + "&IncludeItemTypes=Movie,Series&Studios=" + (encodeURIComponent(cleanStudioName))
  ];

  for (var url of urls) {
    try {
      var data = makeApiRequest(url, { signal });
      var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
      if (items.length) return true;
    } catch {}
  }

  return false;
}

function findEmptyDefaultStudioHubNames(runtimeConfig, signal) {
  var userId = getStudioHubCurrentUserId(signal);
  if (!userId) return [];

  var data = null;
  try {
    data = makeApiRequest("/Studios?Limit=300&Recursive=true&SortBy=SortName&SortOrder=Ascending", { signal });
  } catch {
    return [];
  }

  var studios = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
  var emptyNames = [];

  for (var desired of DEFAULT_ORDER) {
    var studio =
      studios.find(function(item) matchesStudioHubName(desired, item.Name || "")) ||
      searchStudioHubByAliases(desired, signal);
    if (!studio.Id) {
      emptyNames.push(desired);
      continue;
    }

    var hasItems = defaultStudioHubHasItems(
      studio.Id,
      studio.Name || desired,
      userId,
      runtimeConfig,
      signal
    );
    if (!hasItems) emptyNames.push(desired);
  }

  return emptyNames;
}

function createHiddenInput(id, value) {
  var inp = document.createElement("input");
  inp.type = "hidden";
  inp.id = id;
  inp.name = id;
  inp.value = value;
  return inp;
}

function getDnDItemName(item) {
  if (item && typeof item === "object") {
    return String(item.name || item.key || "").trim();
  }
  return String(item || "").trim();
}

function getDnDItemLabel(item) {
  if (item && typeof item === "object") {
    return String(item.label || item.name || item.key || "").trim();
  }
  return String(item || "").trim();
}

function dedupeDnDItems(items) {
  var out = [];
  var seen = new Set();
  for (var item of items || []) {
    var name = getDnDItemName(item);
    if (!name) continue;
    var key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      label: getDnDItemLabel(item) || name
    });
  }
  return out;
}

function getManagedHomeSectionOrderLabel(name, config, labels) {
  if (isNativeHomeSectionOrderKey(name)) {
    return getNativeHomeSectionOrderLabel(name) || name;
  }
  if (name === "studioHubs") {
    return (
      labels.studioHubs ||
      config.languageLabels.studioHubs ||
      "Coleções de Estúdios"
    );
  }
  if (name === "personalRecommendations") {
    return (
      labels.personalRecommendations ||
      config.languageLabels.personalRecommendations ||
      "Sugestões Para Você"
    );
  }
  if (name === "top10SeriesRows") {
    return labels.top10Series || "Top 10 Séries";
  }
  if (name === "top10MovieRows") {
    return labels.top10Movies || "Top 10 Filmes";
  }
  if (name === "tmdbTopMoviesRows") {
    return labels.tmdbTopMovies || "Melhores Filmes TMDb";
  }
  if (name === "recentRows") {
    return labels.managedRecentRowsLabel || "Adicionados Recentemente";
  }
  if (name === "continueRows") {
    return labels.managedContinueRowsLabel || "Continuar Assistindo";
  }
  if (name === "nextUpRows") {
    return labels.managedNextUpRowsLabel || labels.nextUpEpisodes || "Próximos Episódios";
  }
  if (name === "becauseYouWatched") {
    return (
      labels.becauseYouWatched ||
      config.languageLabels.becauseYouWatched ||
      "Sugestões por você ter assistido"
    );
  }
  if (name === "genreHubs") {
    return labels.managedGenreHubsLabel || "Sugestões de Gênero";
  }
  if (name === "directorRows") {
    return labels.managedDirectorRowsLabel || "Coleções de Diretores";
  }
  return name;
}

function getManagedHomeSectionOrderItems(config, labels, nativeItems = []) {
  var nativeLabels = new Map(
    (Array.isArray(nativeItems) ? nativeItems : []).mapfunction((item) [
      String(item.name || "").trim(),
      String(item.label || "").trim()
    ])
  );

  return normalizeManagedHomeSectionOrder(
    config.managedHomeSectionOrder,
    { nativeEntries: nativeItems }
  ).mapfunction((name) ({
    name,
    label: nativeLabels.get(name) || getManagedHomeSectionOrderLabel(name, config, labels)
  }));
}

function ensureStudioHubsSpinnerStyles() {
  if (document.getElementById("jms-studio-hubs-spinner-style")) return;
  var style = document.createElement("style");
  style.id = "jms-studio-hubs-spinner-style";
  style.textContent = "\n    @keyframes jmsStudioHubsSpin {\n      to { transform: rotate(360deg); }\n    }\n    .dnd-item.dnd-item-studio {\n      align-items: flex-start;\n      flex-wrap: wrap;\n    }\n    .dnd-main {\n      align-items: flex-start;\n      display: flex;\n      flex: 1 1 240px;\n      gap: 8px;\n      max-width: 100%;\n      min-width: min(240px, 100%);\n    }\n    .dnd-actions {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 6px;\n      justify-content: flex-end;\n      margin-left: auto;\n    }\n    .dnd-handle {\n      touch-action: none;\n    }\n    .dnd-name {\n      line-height: 1.35;\n      min-width: 0;\n      overflow-wrap: anywhere;\n      text-decoration-color: var(--accent, #ff6b6b);\n      word-break: normal;\n    }\n  ";
  document.head.appendChild(style);
}

function setButtonBusy(button, textEl, spinnerEl, busy, options = {}) {
  if (!button) return;
  var idleText = options.idleText;
  var busyText = options.busyText;
  button.disabled = !!busy;
  if (textEl) {
    var nextText = busy ? busyText : idleText;
    if (nextText != null) textEl.textContent = nextText;
  }
  if (spinnerEl) spinnerEl.style.display = busy ? "inline-block" : "none";
}

function buildTmdbStudioQueries(studioName) {
  var cleanName = String(studioName || "").trim();
  if (!cleanName) return [];

  var canonical = toCanonicalStudioName(cleanName);
  var aliases = canonical ? (ALIASES[canonical] || []) : [];
  return dedupeNames([cleanName, canonical, ...aliases]);
}

function scoreTmdbCompanyCandidate(candidate, studioName) {
  var targetName = String(studioName || "").trim();
  var candidateName = String(candidate.name || candidate.Name || "").trim();
  if (!targetName || !candidateName) return Number.NEGATIVE_INFINITY;

  var targetCanonical = toCanonicalStudioName(targetName) || targetName;
  var candidateCanonical = toCanonicalStudioName(candidateName) || candidateName;
  var targetNorm = nbase(targetName);
  var candidateNorm = nbase(candidateName);
  var targetStripped = strip(targetName);
  var candidateStripped = strip(candidateName);
  var targetTokens = new Set(toks(targetName));
  var candidateTokens = new Set(toks(candidateName));

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
  targetTokens.forEach(function(token) {
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

function fetchTmdbCompanyResults(studioName) {
  var apiKey = getGlobalTmdbApiKey().catchfunction(() "");
  if (!apiKey) return [];

  var queries = buildTmdbStudioQueries(studioName);
  var allResults = [];
  var seenIds = new Set();

  for (var query of queries) {
    var url = new URL((TMDB_API_BASE) + "/search/company");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("page", "1");

    var res = fetch(url.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) continue;

    var data = res.json().catchfunction(() ({}));
    var results = Array.isArray(data.results) ? data.results : [];
    results.forEach(function(result) {
      var id = String(result.id || "").trim();
      if (id && seenIds.has(id)) return;
      if (id) seenIds.add(id);
      allResults.push(result);
    });
  }

  return allResults;
}

function resolveTmdbLogoFileForStudio(studioName) {
  var results = fetchTmdbCompanyResults(studioName);
  if (!results.length) return null;

  var best = results
    .map(function(result) ({ result, score: scoreTmdbCompanyCandidate(result, studioName) }))
    .sortfunction((a, b) b.score - a.score)[0];

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
}

function refreshStudioHubHiddenInputs(list, orderInput, hiddenInput) {
  var names = [...list.querySelectorAll(".dnd-item")].map(function(li) li.dataset.name).filter(Boolean);
  var hiddenNames = [...list.querySelectorAll('.dnd-item[data-hidden="1"]')].map(function(li) li.dataset.name).filter(Boolean);
  orderInput.value = JSON.stringify(dedupeNames(names));
  hiddenInput.value = JSON.stringify(dedupeNames(hiddenNames));
}

function applyDnDItemState(li, labels, state = {}) {
  if (!li) return;
  var sharedVideos = Array.isArray(state.sharedVideos) ? state.sharedVideos : [];
  var manualEntries = Array.isArray(state.manualEntries) ? state.manualEntries : [];
  var visibilityDisabled = state.visibilityDisabled === true;

  var hidden = li.dataset.hidden === "1";
  li.style.opacity = hidden ? "0.58" : "1";
  li.style.filter = hidden ? "saturate(0.65)" : "";

  var txt = li.querySelector(".dnd-name");
  if (txt) {
    if (hidden) {
      txt.style.textDecoration = "line-through";
      txt.style.textDecorationColor = "var(--accent-color, #ff6b6b)";
    } else {
      txt.style.textDecoration = "none";
    }
  }

  var toggleBtn = li.querySelector(".dnd-btn-visibility");
  if (toggleBtn) {
    var showText = labels.showCollection || "Mostrar";
    var hideText = labels.hideCollection || "Ocultar";
    toggleBtn.textContent = hidden ? showText : hideText;
    toggleBtn.disabled = visibilityDisabled;
    toggleBtn.title = visibilityDisabled
      ? (labels.showCollectionLockedHint || "Esta configuração só pode ser alterada pelo admin no modo global")
      : (hidden ? (labels.showCollectionHint || "Mostrar coleção") : (labels.hideCollectionHint || "Ocultar coleção"));
    toggleBtn.style.opacity = visibilityDisabled ? "0.55" : "";
    toggleBtn.style.cursor = visibilityDisabled ? "not-allowed" : "";
  }

  var manualBadge = li.querySelector(".dnd-manual-badge");
  if (manualBadge) {
    manualBadge.style.display = li.dataset.manual === "1" ? "" : "none";
  }

  var removeBtn = li.querySelector(".dnd-btn-remove");
  if (removeBtn) {
    removeBtn.style.display = li.dataset.manual === "1" ? "" : "none";
  }

  var videoBadge = li.querySelector(".dnd-video-badge");
  var hasSharedVideo = !!findStudioHubVideoEntry(sharedVideos, li.dataset.name);
  var manualEntry = findStudioHubManualEntry(manualEntries, li.dataset.studioId || li.dataset.name);
  var hasCustomLogo = !!buildStudioHubLogoUrl(manualEntry);
  if (videoBadge) {
    videoBadge.textContent = hasSharedVideo ? (labels.hoverVideoAvailable || "Video") : "";
    videoBadge.style.color = "var(--accent, #10b981)";
    videoBadge.style.display = hasSharedVideo ? "" : "none";
  }

  var deleteVideoBtn = li.querySelector(".dnd-btn-delete-video");
  if (deleteVideoBtn) {
    deleteVideoBtn.disabled = !hasSharedVideo;
    deleteVideoBtn.style.display = hasSharedVideo ? "" : "none";
    deleteVideoBtn.title = labels.deleteHoverVideo || "Excluir vídeo carregado";
  }

  var logoBadge = li.querySelector(".dnd-logo-badge");
  if (logoBadge) {
    logoBadge.textContent = hasCustomLogo ? (labels.logoAvailable || "Logo") : "";
    logoBadge.style.color = "var(--accent, #10b981)";
    logoBadge.style.display = hasCustomLogo ? "" : "none";
  }

  var deleteLogoBtn = li.querySelector(".dnd-btn-delete-logo");
  if (deleteLogoBtn) {
    deleteLogoBtn.disabled = !hasCustomLogo;
    deleteLogoBtn.style.display = (li.dataset.manual === "1" && hasCustomLogo) ? "" : "none";
    deleteLogoBtn.title = labels.deleteLogo || "Excluir logo carregado";
  }

  var uploadLogoBtn = li.querySelector(".dnd-btn-upload-logo");
  if (uploadLogoBtn) {
    uploadLogoBtn.style.display = li.dataset.manual === "1" ? "" : "none";
  }
}

function createDraggableList(id, items, labels, options = {}) {
  var enableStudioControls = options.enableStudioControls === true;
  var hiddenNames = new Set((options.hiddenNames || []).map(nameKey));
  var sharedVideos = Array.isArray(options.sharedVideos) ? options.sharedVideos : [];
  var manualEntries = Array.isArray(options.manualEntries) ? options.manualEntries : [];
  var isAdmin = options.isAdmin === true;
  var visibilityDisabled = options.visibilityDisabled === true;
  var dndItems = dedupeDnDItems(items);

  var wrap = document.createElement("div");
  wrap.className = "setting-input setting-dnd";

  var lab = document.createElement("div");
  lab.textContent = options.labelText || labels.studioHubsOrderLabel || "Ordenação (arrastar e soltar)";
  lab.style.display = "block";
  lab.style.marginBottom = "6px";

  var list = document.createElement("ul");
  list.id = id;
  list.className = "dnd-list";
  list.style.listStyle = "none";
  list.style.padding = "0";
  list.style.margin = "0";
  list.style.border = "1px solid var(--theme-text-color, #8882)";
  list.style.borderRadius = "8px";
  list.style.maxHeight = "320px";
  list.style.overflow = "auto";

  dndItems.forEach(function((item) {
    var name = getDnDItemName(item);
    list.appendChild(createDnDItem(item, labels, {
      enableStudioControls,
      hidden: hiddenNames.has(nameKey(name)),
      isManual: !!findStudioHubManualEntry(manualEntries, name),
      studioId: String(findStudioHubManualEntry(manualEntries, name).studioId || findStudioHubManualEntry(manualEntries, name).StudioId || "").trim(),
      isAdmin,
      visibilityDisabled,
      manualEntries,
      sharedVideos
    }));
  });

  var dragEl = null;
  var touchDrag = null;
  var restoreUserSelect = "";

  var setDragActive = function(li, active) {
    if (!li) return;
    li.style.opacity = active ? "0.6" : "";
  };

  var moveDraggedItem = function(clientY) {
    if (!dragEl) return;

    var listRect = list.getBoundingClientRect();
    var scrollEdge = 44;
    if (clientY < listRect.top + scrollEdge) {
      list.scrollTop -= Math.max(8, Math.ceil((listRect.top + scrollEdge - clientY) / 3));
    } else if (clientY > listRect.bottom - scrollEdge) {
      list.scrollTop += Math.max(8, Math.ceil((clientY - (listRect.bottom - scrollEdge)) / 3));
    }

    var siblings = [...list.querySelectorAll(".dnd-item")].filter(function(item) item !== dragEl);
    var nextSibling = null;
    for (var item of siblings) {
      var rect = item.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        nextSibling = item;
        break;
      }
    }
    list.insertBefore(dragEl, nextSibling);
  };

  var finishTouchDrag = function(notify = false) {
    if (!touchDrag) return;
    setDragActive(touchDrag.li, false);
    document.body.style.userSelect = restoreUserSelect;
    restoreUserSelect = "";
    dragEl = null;
    var moved = touchDrag.moved;
    touchDrag = null;
    if (notify && moved) {
      list.dispatchEvent(new CustomEvent("dnd:reorder"));
    }
  };

  list.addEventListenerfunction("dragstart", (e) {
    var li = e.target.closest(".dnd-item");
    if (!li) return;
    dragEl = li;
    setDragActive(li, true);
    e.dataTransfer.setData.("text/plain", li.dataset.name || "");
    e.dataTransfer.effectAllowed = "move";
  });

  list.addEventListenerfunction("dragend", (e) {
    var li = e.target.closest(".dnd-item");
    if (!li) return;
    setDragActive(li, false);
    dragEl = null;
  });

  list.addEventListenerfunction("dragover", (e) {
    e.preventDefault();
    if (!dragEl) return;
    moveDraggedItem(e.clientY);
  });

  list.addEventListenerfunction("touchstart", (e) {
    var handle = e.target.closest(".dnd-handle");
    if (!handle) return;
    var li = handle.closest(".dnd-item");
    var touch = e.touches.[0];
    if (!li || !touch) return;

    e.preventDefault();
    finishTouchDrag(false);
    dragEl = li;
    restoreUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    touchDrag = {
      li,
      touchId: touch.identifier,
      moved: false
    };
    setDragActive(li, true);
  }, { passive: false });

  var onTouchMove = function(e) {
    if (!touchDrag) return;
    var touch = [...(e.touches || [])].find(function(item) item.identifier === touchDrag.touchId);
    if (!touch) return;
    e.preventDefault();
    touchDrag.moved = true;
    moveDraggedItem(touch.clientY);
  };

  var onTouchEnd = function(e) {
    if (!touchDrag) return;
    var ended = [...(e.changedTouches || [])].some(function(item) item.identifier === touchDrag.touchId);
    if (!ended) return;
    e.preventDefault();
    finishTouchDrag(true);
  };

  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: false });
  window.addEventListener("touchcancel", onTouchEnd, { passive: false });

  var __cleanup = function() {
    finishTouchDrag(false);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchEnd);
  };
  wrap.addEventListener('jms:cleanup', __cleanup, { once:true });

  list.addEventListenerfunction("click", (e) {
    var btnUp = e.target.closest.(".dnd-btn-up");
    var btnDown = e.target.closest.(".dnd-btn-down");
    if (!btnUp && !btnDown) return;
    var li = e.target.closest(".dnd-item");
    if (!li) return;
    if (btnUp && li.previousElementSibling) {
      li.parentElement.insertBefore(li, li.previousElementSibling);
    } else if (btnDown && li.nextElementSibling) {
      li.parentElement.insertBefore(li.nextElementSibling, li);
    }
  });

  var wrapAll = document.createElement("div");
  wrapAll.appendChild(lab);
  wrapAll.appendChild(list);
  return { wrap: wrapAll, list };
}

function createDnDItem(name, labels, options = {}) {
  var itemName = getDnDItemName(name);
  var itemLabel = getDnDItemLabel(name) || itemName;
  if (!options.enableStudioControls) {
    var li = document.createElement("li");
    li.className = "dnd-item";
    li.draggable = true;
    li.dataset.name = itemName;
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.gap = "8px";
    li.style.padding = "8px 10px";
    li.style.borderBottom = "1px solid #0002";
    li.style.background = "var(--theme-background, rgba(255,255,255,0.02))";

    var handle = document.createElement("span");
    handle.className = "dnd-handle";
    handle.textContent = "↕";
    handle.title = labels.dragToReorder || "Arrastar e soltar";
    handle.style.cursor = "grab";
    handle.style.userSelect = "none";
    handle.style.fontWeight = "700";

    var txt = document.createElement("span");
    txt.textContent = itemLabel;
    txt.style.flex = "1";
    txt.style.textDecorationColor = "var(--accent-color, #ff6b6b)";

    var btns = document.createElement("div");
    btns.style.display = "flex";
    btns.style.gap = "6px";

    var up = document.createElement("button");
    up.type = "button";
    up.className = "dnd-btn-up";
    up.textContent = "↑";
    up.title = labels.moveUp || "Mover para cima";
    up.style.minWidth = "28px";

    var down = document.createElement("button");
    down.type = "button";
    down.className = "dnd-btn-down";
    down.textContent = "↓";
    down.title = labels.moveDown || "Mover para baixo";
    down.style.minWidth = "28px";

    btns.appendChild(up);
    btns.appendChild(down);

    li.appendChild(handle);
    li.appendChild(txt);
    li.appendChild(btns);
    return li;
  }

  var li = document.createElement("li");
  li.className = "dnd-item dnd-item-studio";
  li.draggable = true;
  li.dataset.name = itemName;
  li.dataset.hidden = options.hidden ? "1" : "0";
  li.dataset.manual = options.isManual ? "1" : "0";
  li.dataset.studioId = String(options.studioId || "").trim();
  li.dataset.visibilityDisabled = options.visibilityDisabled ? "1" : "0";
  li.style.display = "flex";
  li.style.alignItems = "flex-start";
  li.style.gap = "8px";
  li.style.padding = "8px 10px";
  li.style.flexWrap = "wrap";
  li.style.borderBottom = "1px solid #0002";
  li.style.background = "var(--theme-background, rgba(255,255,255,0.02))";

  var handle = document.createElement("span");
  handle.className = "dnd-handle";
  handle.textContent = "↕";
  handle.title = labels.dragToReorder || "Arrastar e soltar";
  handle.style.cursor = "grab";
  handle.style.userSelect = "none";
  handle.style.fontWeight = "700";

  var main = document.createElement("div");
  main.className = "dnd-main";

  var content = document.createElement("div");
  content.style.display = "flex";
  content.style.flex = "1 1 auto";
  content.style.minWidth = "0";
  content.style.maxWidth = "100%";
  content.style.flexDirection = "column";
  content.style.gap = "4px";

  var txt = document.createElement("span");
  txt.className = "dnd-name";
  txt.textContent = itemLabel;
  txt.style.flex = "1 1 auto";
  txt.style.fontWeight = "600";
  txt.style.textDecorationColor = "var(--accent-color, #ff6b6b)";

  var meta = document.createElement("div");
  meta.style.display = "flex";
  meta.style.gap = "6px";
  meta.style.flexWrap = "wrap";
  meta.style.minWidth = "0";
  meta.style.fontSize = "12px";

  var manualBadge = document.createElement("span");
  manualBadge.className = "dnd-manual-badge";
  manualBadge.textContent = labels.manualCollectionBadge || "Manual";
  manualBadge.style.padding = "2px 6px";
  manualBadge.style.borderRadius = "999px";
  manualBadge.style.background = "rgba(16,185,129,0.18)";

  var videoBadge = document.createElement("span");
  videoBadge.className = "dnd-video-badge";
  videoBadge.style.padding = "2px 6px";
  videoBadge.style.borderRadius = "999px";
  videoBadge.style.background = "rgba(255,255,255,0.08)";

  var logoBadge = document.createElement("span");
  logoBadge.className = "dnd-logo-badge";
  logoBadge.style.padding = "2px 6px";
  logoBadge.style.borderRadius = "999px";
  logoBadge.style.background = "rgba(255,255,255,0.08)";

  meta.appendChild(manualBadge);
  meta.appendChild(logoBadge);
  meta.appendChild(videoBadge);
  content.appendChild(txt);
  content.appendChild(meta);

  var btns = document.createElement("div");
  btns.className = "dnd-actions";

  var toggleVisibility = document.createElement("button");
  toggleVisibility.type = "button";
  toggleVisibility.className = "dnd-btn-visibility";
  toggleVisibility.style.minWidth = "56px";

  var uploadVideo = document.createElement("button");
  uploadVideo.type = "button";
  uploadVideo.className = "dnd-btn-upload-video";
  uploadVideo.textContent = labels.uploadHoverVideo || "Video";
  uploadVideo.title = labels.uploadHoverVideoHint || "Carregar vídeo de hover";
  uploadVideo.style.minWidth = "56px";

  var uploadLogo = document.createElement("button");
  uploadLogo.type = "button";
  uploadLogo.className = "dnd-btn-upload-logo";
  uploadLogo.textContent = labels.uploadLogoShort || "Logo";
  uploadLogo.title = labels.uploadLogoHint || "Carregar logo";
  uploadLogo.style.minWidth = "56px";

  var deleteLogo = document.createElement("button");
  deleteLogo.type = "button";
  deleteLogo.className = "dnd-btn-delete-logo";
  deleteLogo.textContent = labels.deleteLogoShort || "Excluir Logo";
  deleteLogo.style.minWidth = "72px";

  var deleteVideo = document.createElement("button");
  deleteVideo.type = "button";
  deleteVideo.className = "dnd-btn-delete-video";
  deleteVideo.textContent = labels.deleteHoverVideoShort || "Excluir";
  deleteVideo.style.minWidth = "44px";

  var up = document.createElement("button");
  up.type = "button";
  up.className = "dnd-btn-up";
  up.textContent = "↑";
  up.title = labels.moveUp || "Mover para cima";
  up.style.minWidth = "28px";

  var down = document.createElement("button");
  down.type = "button";
  down.className = "dnd-btn-down";
  down.textContent = "↓";
  down.title = labels.moveDown || "Mover para baixo";
  down.style.minWidth = "28px";

  var remove = document.createElement("button");
  remove.type = "button";
  remove.className = "dnd-btn-remove";
  remove.textContent = labels.removeCollection || "Remover";
  remove.title = labels.removeCollectionHint || "Remover coleção manual";
  remove.style.minWidth = "60px";

  btns.appendChild(toggleVisibility);
  if (options.isAdmin) {
    btns.appendChild(uploadLogo);
    btns.appendChild(deleteLogo);
    btns.appendChild(uploadVideo);
    btns.appendChild(deleteVideo);
  }
  btns.appendChild(remove);
  btns.appendChild(up);
  btns.appendChild(down);

  main.appendChild(handle);
  main.appendChild(content);
  li.appendChild(main);
  li.appendChild(btns);
  applyDnDItemState(li, labels, {
    visibilityDisabled: options.visibilityDisabled,
    sharedVideos: options.sharedVideos,
    manualEntries: options.manualEntries
  });
  return li;
}

export function createStudioHubsPanel(config, labels) {
  ensureStudioHubsSpinnerStyles();
  var panel = document.createElement('div');
  panel.id = 'studio-panel';
  panel.className = 'setting-item';

  var section = createSection(
    labels.studioHubsSettings ||
    config.languageLabels.studioHubsSettings ||
    'Configurações de Coleções de Estúdios'
  );

  var enableCheckbox = createCheckbox(
    'enableStudioHubs',
    labels.enableStudioHubs || config.languageLabels.enableStudioHubs || 'Ativar Coleções de Estúdios',
    config.enableStudioHubs
  );

  section.appendChild(enableCheckbox);

  var colorizeCheckbox = createCheckbox(
    'studioHubsColorize',
    labels.studioHubsColorize || config.languageLabels.studioHubsColorize || 'Coleções Coloridas',
    config.studioHubsColorize
  );

  section.appendChild(colorizeCheckbox);

  var enableHoverVideo = createCheckbox(
    'studioHubsHoverVideo',
    labels.studioHubsHoverVideo || 'Reproduzir vídeo no hover',
    config.studioHubsHoverVideo
  );
  section.appendChild(enableHoverVideo);

  var countWrap = createNumberInput(
    'studioHubsCardCount',
    labels.studioHubsCardCount || 'Número de cards a exibir (Tela principal)',
    Number.isFinite(config.studioHubsCardCount) ? config.studioHubsCardCount : 10,
    1,
    100
  );
  section.appendChild(countWrap);

  var baseOrder = mergeOrder(
    DEFAULT_ORDER,
    Array.isArray(config.studioHubsOrder) && config.studioHubsOrder.length
      ? config.studioHubsOrder
      : []
  );
  var isForceGlobal = config.forceGlobalUserSettings === true;
  var isAdmin = config.currentUserIsAdmin === true;
  var visibilityDisabled = isForceGlobal && !isAdmin;
  var useGlobalVisibility = isForceGlobal;
  var useGlobalOrder = isForceGlobal;

  var autoAddFromWatchlistCopyCheckbox = createCheckbox(
    'studioHubsAutoAddFromWatchlistCopy',
    labels.studioHubsAutoAddFromWatchlistCopy || 'Adicionar coleção automaticamente ao copiar ID de estúdio da Watchlist',
    config.studioHubsAutoAddFromWatchlistCopy === true
  );
  autoAddFromWatchlistCopyCheckbox.style.display = isAdmin ? '' : 'none';
  section.appendChild(autoAddFromWatchlistCopyCheckbox);

  var autoAddFromWatchlistCopyHint = document.createElement("div");
  autoAddFromWatchlistCopyHint.className = "description-text2";
  autoAddFromWatchlistCopyHint.style.margin = "4px 0 10px";
  autoAddFromWatchlistCopyHint.style.display = isAdmin ? "" : "none";
  autoAddFromWatchlistCopyHint.textContent =
    labels.studioHubsAutoAddFromWatchlistCopyHint ||
    "Quando ativado, se o administrador clicar em um estúdio na pré-visualização da watchlist e copiar o ID, a coleção do estúdio correspondente será criada ou atualizada automaticamente.";
  section.appendChild(autoAddFromWatchlistCopyHint);

  var manualEntries = [];
  var manualEntriesLoaded = false;
  var sharedVideos = [];
  var currentOrderNames = dedupeNames(baseOrder);
  var currentHiddenNames = useGlobalVisibility
    ? dedupeNames(Array.isArray(config.studioHubsHidden) ? config.studioHubsHidden : [])
    : [];
  var getVisibilityProfile = function() ((isForceGlobal && isAdmin) ? getAdminTargetProfile() : getDeviceProfileAuto());

  var orderHiddenInput = createHiddenInput('studioHubsOrder', JSON.stringify(dedupeNames(baseOrder)));
  var hiddenHiddenInput = createHiddenInput('studioHubsHidden', JSON.stringify(currentHiddenNames));
  var { wrap: dndWrap, list } = createDraggableList('studioHubsOrderList', baseOrder, labels, {
    enableStudioControls: true,
    hiddenNames: currentHiddenNames,
    isAdmin,
    visibilityDisabled,
    manualEntries,
    sharedVideos
  });

  var normalizeOrderNamesForState = function(names) (
    manualEntriesLoaded
      ? sanitizeStudioHubOrderNames(names, manualEntries)
      : dedupeNames(names)
  );

  var normalizeHiddenNamesForState = function(names) (
    manualEntriesLoaded
      ? sanitizeStudioHubHiddenNames(names, manualEntries)
      : dedupeNames(names)
  );

  var getAllowedNames = function() (
    manualEntriesLoaded
      ? getStudioHubAllowedNames(manualEntries)
      : dedupeNames([
          ...[...list.querySelectorAll(".dnd-item")].map(function(li) li.dataset.name).filter(Boolean),
          ...DEFAULT_ORDER
        ])
  );

  var pruneInvalidListItems = function() {
    if (!manualEntriesLoaded) return;
    var allowedKeys = new Set(getAllowedNames().map(nameKey));
    [...list.querySelectorAll(".dnd-item")].forEach(function(li) {
      if (!allowedKeys.has(nameKey(li.dataset.name))) {
        li.remove();
      }
    });
  };

  var syncHiddenNamesFromInput = function() {
    try {
      var parsed = JSON.parse(hiddenHiddenInput.value || "[]");
      currentHiddenNames = normalizeHiddenNamesForState(Array.isArray(parsed) ? parsed : []);
    } catch {
      currentHiddenNames = [];
    }
    return currentHiddenNames;
  };

  var syncOrderNamesFromInput = function() {
    try {
      var parsed = JSON.parse(orderHiddenInput.value || "[]");
      currentOrderNames = normalizeOrderNamesForState(Array.isArray(parsed) ? parsed : []);
    } catch {
      currentOrderNames = dedupeNames(baseOrder);
    }
    return currentOrderNames;
  };

  var applyOrderNamesToList = function(orderNames) {
    currentOrderNames = normalizeOrderNamesForState(orderNames);
    pruneInvalidListItems();
    var desiredOrder = mergeOrder(
      getAllowedNames(),
      currentOrderNames
    );
    var itemsByKey = new Map(
      [...list.querySelectorAll(".dnd-item")].map(function(li) [nameKey(li.dataset.name), li])
    );

    desiredOrder.forEach(function(name) {
      var key = nameKey(name);
      var li = itemsByKey.get(key);
      if (!li) return;
      list.appendChild(li);
      itemsByKey.delete(key);
    });

    itemsByKey.forEach(function(li) li.remove());
    refreshListState();
  };

  var applyHiddenNamesToList = function(hiddenNames) {
    currentHiddenNames = normalizeHiddenNamesForState(hiddenNames);
    pruneInvalidListItems();
    var hiddenSet = new Set(currentHiddenNames.map(nameKey));
    [...list.querySelectorAll(".dnd-item")].forEach(function(li) {
      li.dataset.hidden = hiddenSet.has(nameKey(li.dataset.name)) ? "1" : "0";
    });
    refreshListState();
  };

  var findListItemsByManualEntry = function(entry) {
    var name = String(entry.name || entry.Name || "").trim();
    var studioId = String(entry.studioId || entry.StudioId || "").trim();
    return [...list.querySelectorAll(".dnd-item")].filter(function(li) {
      var sameStudioId = studioId && nameKey(li.dataset.studioId) === nameKey(studioId);
      var sameName = name && nameKey(li.dataset.name) === nameKey(name);
      return sameStudioId || sameName;
    });
  };

  var upsertManualEntryInList = function(entry) {
    var name = String(entry.name || entry.Name || "").trim();
    var studioId = String(entry.studioId || entry.StudioId || "").trim();
    if (!name || !studioId) return null;

    var matches = findListItemsByManualEntry(entry);
    var existing = matches[0] || null;
    if (existing) {
      existing.dataset.name = name;
      existing.dataset.studioId = studioId;
      existing.dataset.manual = "1";
      var nameEl = existing.querySelector(".dnd-name");
      if (nameEl) nameEl.textContent = name;
      matches.slice(1).forEach(function(li) li.remove());
      return existing;
    }

    var li = createDnDItem(name, labels, {
      enableStudioControls: true,
      hidden: currentHiddenNames.some(function(item) nameKey(item) === nameKey(name)),
      isManual: true,
      studioId,
      isAdmin,
      visibilityDisabled,
      manualEntries,
      sharedVideos
    });
    list.appendChild(li);
    return li;
  };

  var refreshListState = function() {
    pruneInvalidListItems();
    refreshStudioHubHiddenInputs(list, orderHiddenInput, hiddenHiddenInput);
    syncOrderNamesFromInput();
    syncHiddenNamesFromInput();
    [...list.querySelectorAll(".dnd-item")].forEach(function(li) applyDnDItemState(li, labels, {
      visibilityDisabled: li.dataset.visibilityDisabled === "1",
      sharedVideos,
      manualEntries
    }));
  };

  var statusText = document.createElement("div");
  statusText.className = "description-text2";
  statusText.style.margin = "8px 0 12px";
  statusText.style.minHeight = "18px";

  var setStatus = function(text = "", tone = "") {
    statusText.textContent = text;
    statusText.style.color =
      tone === "error" ? "#ff7b7b" :
      tone === "success" ? "var(--accent, #10b981)" :
      "";
  };

  var handleExternalManualEntryAdded = function(event) {
    var entry = event.detail.entry || null;
    var entries = Array.isArray(event.detail.entries) ? event.detail.entries : null;
    var studioId = String(entry.studioId || entry.StudioId || "").trim();
    var name = String(entry.name || entry.Name || "").trim();
    if (!entries && !studioId && !name) return;

    if (entries) {
      manualEntries = entries;
    } else if (entry) {
      var existing = findStudioHubManualEntry(manualEntries, studioId || name);
      manualEntries = existing
        ? manualEntries.mapfunction((item) {
            var sameStudioId = studioId && nameKey(item.studioId || item.StudioId) === nameKey(studioId);
            var sameName = name && nameKey(item.name || item.Name) === nameKey(name);
            return (sameStudioId || sameName) ? entry : item;
          })
        : [...manualEntries, entry];
    }

    if (entry) {
      upsertManualEntryInList(entry);
    } else if (entries) {
      entries.forEach(function(nextEntry) upsertManualEntryInList(nextEntry));
    }

    refreshListState();

    if (event.detail.source === "watchlist-auto-add" && name) {
      setStatus(
        labels.studioHubAutoAddedFromWatchlist || "{name} foi adicionado à lista de coleções.", {
          name
        }),
        "success"
      );
    }
  };

  window.addEventListener(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, handleExternalManualEntryAdded);

  var formatLabel = function(key, fallback, vars = {}) {
    var text = String(labels.[key] || fallback);
    for (var [name, value] of Object.entries(vars)) {
      text = text.split("{" + (name) + "}").join(String(value || ""));
    }
    return text;
  };

  var manualAddWrap = document.createElement("div");
  manualAddWrap.className = "input-container";
  manualAddWrap.style.display = isAdmin ? "" : "none";

  var manualAddLabel = document.createElement("div");
  manualAddLabel.textContent = labels.addManualCollection || "Adicionar nova coleção";
  manualAddWrap.appendChild(manualAddLabel);

  var manualAddHint = document.createElement("div");
  manualAddHint.className = "description-text2";
  manualAddHint.style.marginBottom = "8px";
  manualAddHint.textContent = labels.manualCollectionStudioIdHint || "Insira o Studio ID. O título é resolvido automaticamente; carregar logo e vídeo é opcional.";
  manualAddWrap.appendChild(manualAddHint);

  var studioIdLabel = document.createElement("label");
  studioIdLabel.textContent = labels.studioIdPlaceholder || "Studio ID";
  studioIdLabel.htmlFor = "studioHubsManualStudioId";
  studioIdLabel.style.display = "block";
  studioIdLabel.style.marginBottom = "6px";
  manualAddWrap.appendChild(studioIdLabel);

  var manualAddRow = document.createElement("div");
  manualAddRow.style.display = "flex";
  manualAddRow.style.gap = "8px";
  manualAddRow.style.flexWrap = "wrap";

  var studioIdInput = document.createElement("input");
  studioIdInput.type = "text";
  studioIdInput.id = "studioHubsManualStudioId";
  studioIdInput.name = "studioHubsManualStudioId";
  studioIdInput.placeholder = labels.studioIdPlaceholder || "Studio ID";
  studioIdInput.style.flex = "1";
  studioIdInput.style.minWidth = "240px";

  var manualAddBtn = document.createElement("button");
  manualAddBtn.type = "button";
  manualAddBtn.style.display = "inline-flex";
  manualAddBtn.style.alignItems = "center";
  manualAddBtn.style.justifyContent = "center";
  manualAddBtn.style.gap = "8px";

  var manualAddSpinner = document.createElement("span");
  manualAddSpinner.setAttribute("aria-hidden", "true");
  manualAddSpinner.style.display = "none";
  manualAddSpinner.style.width = "14px";
  manualAddSpinner.style.height = "14px";
  manualAddSpinner.style.border = "2px solid currentColor";
  manualAddSpinner.style.borderRightColor = "transparent";
  manualAddSpinner.style.borderRadius = "50%";
  manualAddSpinner.style.animation = "jmsStudioHubsSpin 0.7s linear infinite";

  var manualAddBtnText = document.createElement("span");
  manualAddBtnText.textContent = labels.addCollectionButton || "Adicionar";
  manualAddBtn.append(manualAddSpinner, manualAddBtnText);

  manualAddRow.appendChild(studioIdInput);
  manualAddRow.appendChild(manualAddBtn);
  manualAddWrap.appendChild(manualAddRow);

  var manualAssetRow = document.createElement("div");
  manualAssetRow.style.display = "flex";
  manualAssetRow.style.gap = "8px";
  manualAssetRow.style.flexWrap = "wrap";
  manualAssetRow.style.marginTop = "8px";

  var manualLogoWrap = document.createElement("div");
  manualLogoWrap.style.display = "flex";
  manualLogoWrap.style.flexDirection = "column";
  manualLogoWrap.style.gap = "6px";

  var manualLogoLabel = document.createElement("label");
  manualLogoLabel.textContent = labels.optionalLogoTitle || "Logo opcional";
  manualLogoLabel.htmlFor = "studioHubsManualLogoInput";

  var manualLogoInput = document.createElement("input");
  manualLogoInput.type = "file";
  manualLogoInput.id = "studioHubsManualLogoInput";
  manualLogoInput.name = "studioHubsManualLogoInput";
  manualLogoInput.accept = "image/png,image/webp,image/svg+xml,image/jpeg,.png,.webp,.svg,.jpg,.jpeg";
  manualLogoInput.title = labels.optionalLogoTitle || "Logo opcional";

  var manualVideoWrap = document.createElement("div");
  manualVideoWrap.style.display = "flex";
  manualVideoWrap.style.flexDirection = "column";
  manualVideoWrap.style.gap = "6px";

  var manualVideoLabel = document.createElement("label");
  manualVideoLabel.textContent = labels.optionalVideoTitle || "Vídeo de hover opcional";
  manualVideoLabel.htmlFor = "studioHubsManualVideoInput";

  var manualVideoInput = document.createElement("input");
  manualVideoInput.type = "file";
  manualVideoInput.id = "studioHubsManualVideoInput";
  manualVideoInput.name = "studioHubsManualVideoInput";
  manualVideoInput.accept = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.m4v,.mov";
  manualVideoInput.title = labels.optionalVideoTitle || "Vídeo de hover opcional";

  manualLogoWrap.append(manualLogoLabel, manualLogoInput);
  manualVideoWrap.append(manualVideoLabel, manualVideoInput);
  manualAssetRow.append(manualLogoWrap, manualVideoWrap);
  manualAddWrap.appendChild(manualAssetRow);

  var sharedVideoHint = document.createElement("div");
  sharedVideoHint.className = "description-text2";
  sharedVideoHint.style.marginBottom = "8px";
  sharedVideoHint.textContent = isAdmin
    ? (labels.hoverVideoAdminHint || "Os vídeos de hover são salvos instantaneamente no servidor e usados por todos os usuários.")
    : (labels.hoverVideoAdminOnlyHint || "O carregamento e exclusão de vídeos de hover é permitido apenas para administradores.");

  var videoFileInput = document.createElement("input");
  videoFileInput.type = "file";
  videoFileInput.id = "studioHubsSharedVideoFileInput";
  videoFileInput.name = "studioHubsSharedVideoFileInput";
  videoFileInput.accept = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.m4v,.mov";
  videoFileInput.style.display = "none";
  videoFileInput.setAttribute("aria-hidden", "true");

  var logoFileInput = document.createElement("input");
  logoFileInput.type = "file";
  logoFileInput.id = "studioHubsSharedLogoFileInput";
  logoFileInput.name = "studioHubsSharedLogoFileInput";
  logoFileInput.accept = "image/png,image/webp,image/svg+xml,image/jpeg,.png,.webp,.svg,.jpg,.jpeg";
  logoFileInput.style.display = "none";
  logoFileInput.setAttribute("aria-hidden", "true");

  var pendingVideoTarget = "";
  var pendingLogoTargetStudioId = "";
  var manualAddBusy = false;

  panel.addEventListenerfunction("jms:cleanup", () {
    window.removeEventListener(JMS_STUDIO_HUB_MANUAL_ENTRY_ADDED_EVENT, handleExternalManualEntryAdded);
  }, { once: true });

  var setManualAddBusy = function(busy) {
    manualAddBusy = !!busy;
    setButtonBusy(manualAddBtn, manualAddBtnText, manualAddSpinner, manualAddBusy, {
      idleText: labels.addCollectionButton || "Adicionar",
      busyText: labels.addCollectionBusy || "Adicionando..."
    });
    studioIdInput.disabled = manualAddBusy;
    manualLogoInput.disabled = manualAddBusy;
    manualVideoInput.disabled = manualAddBusy;
  };

  var addManualCollection = function() {
    if (manualAddBusy) return;
    var studioId = String(studioIdInput.value || "").trim();
    if (!studioId) {
      setStatus(labels.manualCollectionEmpty || "Insira primeiro o Studio ID.", "error");
      return;
    }

    setManualAddBusy(true);
    try {
      setStatus(labels.studioResolving || "Resolvendo estúdio...");
      var item = fetchItemDetails(studioId).catchfunction(() null);
      var resolvedName = String(item.Name || "").trim();
      if (!resolvedName) {
        setStatus(labels.studioResolveFailed || "Não foi possível resolver o título para este Studio ID.", "error");
        return;
      }
      var canonicalName = toCanonicalStudioName(resolvedName) || resolvedName;

      if (isDefaultStudioHub(canonicalName)) {
        setStatus(labels.manualCollectionDuplicate || "Esta coleção já foi adicionada.", "error");
        return;
      }

      var existing = findStudioHubManualEntry(manualEntries, studioId) || findStudioHubManualEntry(manualEntries, canonicalName);
      if (existing) {
        setStatus(labels.manualCollectionDuplicate || "Esta coleção já foi adicionada.", "error");
        return;
      }

      var existingListName = [...list.querySelectorAll(".dnd-item")].some(function(li) nameKey(li.dataset.name) === nameKey(canonicalName));
      if (existingListName) {
        setStatus(labels.manualCollectionDuplicate || "Esta coleção já existe na lista.", "error");
        return;
      }

      var created = createStudioHubManualEntry({ studioId, name: canonicalName });
      manualEntries = Array.isArray(created.entries) ? created.entries : manualEntries;
      upsertManualEntryInList(created.entry || { studioId, name: canonicalName });

      var logoFile = manualLogoInput.files.[0];
      var autoLogoUploaded = false;
      if (logoFile) {
        var logoRes = uploadStudioHubLogo(studioId, logoFile);
        manualEntries = Array.isArray(logoRes.entries) ? logoRes.entries : manualEntries;
      } else {
        setStatus(formatLabel("studioHubTmdbLogoSearching", "Procurando logo no TMDB para {name}...", {
          name: canonicalName
        }));
        var tmdbLogoFile = resolveTmdbLogoFileForStudio(canonicalName).catchfunction(() null);
        if (tmdbLogoFile) {
          var logoRes = uploadStudioHubLogo(studioId, tmdbLogoFile);
          manualEntries = Array.isArray(logoRes.entries) ? logoRes.entries : manualEntries;
          autoLogoUploaded = true;
        }
      }

      var videoFile = manualVideoInput.files.[0];
      if (videoFile) {
        var videoRes = uploadStudioHubVideo(canonicalName, videoFile);
        sharedVideos = Array.isArray(videoRes.entries) ? videoRes.entries : sharedVideos;
      }

      studioIdInput.value = "";
      manualLogoInput.value = "";
      manualVideoInput.value = "";
      refreshListState();
      setStatus(
        autoLogoUploaded
          ? formatLabel("studioHubManualCollectionAddedWithTmdbLogo", "{name} adicionado. Logo do TMDB salvo automaticamente.", {
            name: canonicalName
          })
          : formatLabel("studioHubManualCollectionAdded", "{name} adicionado.", {
            name: canonicalName
          }),
        "success"
      );
    } catch (error) {
      setStatus(error.message || (labels.studioHubManualCollectionAddFailed || "Não foi possível adicionar a coleção."), "error");
    } finally {
      setManualAddBusy(false);
    }
  };

  manualAddBtn.addEventListener("click", addManualCollection);
  studioIdInput.addEventListenerfunction("keydown", (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addManualCollection();
    }
  });

  videoFileInput.addEventListenerfunction("change", () {
    var file = videoFileInput.files.[0];
    var targetName = pendingVideoTarget;
    pendingVideoTarget = "";
    videoFileInput.value = "";

    if (!file || !targetName) return;

    setStatus(formatLabel("studioHubHoverVideoUploading", "Carregando vídeo para {name}...", {
      name: targetName
    }));
    try {
      var result = uploadStudioHubVideo(targetName, file);
      sharedVideos = Array.isArray(result.entries) ? result.entries : sharedVideos;
      refreshListState();
      setStatus(formatLabel("studioHubHoverVideoSaved", "Vídeo de hover salvo para {name}.", {
        name: targetName
      }), "success");
    } catch (error) {
      setStatus(error.message || (labels.studioHubHoverVideoUploadFailed || "Não foi possível carregar o vídeo de hover."), "error");
    }
  });

  logoFileInput.addEventListenerfunction("change", () {
    var file = logoFileInput.files.[0];
    var studioId = pendingLogoTargetStudioId;
    pendingLogoTargetStudioId = "";
    logoFileInput.value = "";

    if (!file || !studioId) return;

    var target = findStudioHubManualEntry(manualEntries, studioId);
    var targetName = String(target.name || target.Name || studioId);

    setStatus(formatLabel("studioHubLogoUploading", "Carregando logo para {name}...", {
      name: targetName
    }));
    try {
      var result = uploadStudioHubLogo(studioId, file);
      manualEntries = Array.isArray(result.entries) ? result.entries : manualEntries;
      refreshListState();
      setStatus(formatLabel("studioHubLogoSaved", "Logo salvo para {name}.", {
        name: targetName
      }), "success");
    } catch (error) {
      setStatus(error.message || (labels.studioHubLogoUploadFailed || "Não foi possível carregar o logo."), "error");
    }
  });

  section.appendChild(dndWrap);
  section.appendChild(statusText);
  if (isAdmin) section.appendChild(manualAddWrap);
  section.appendChild(sharedVideoHint);
  section.appendChild(videoFileInput);
  section.appendChild(logoFileInput);
  section.appendChild(orderHiddenInput);
  section.appendChild(hiddenHiddenInput);

  function(() {
    try {
      var ctrl = new AbortController();
      panel.addEventListenerfunction('jms:cleanup', () ctrl.abort(), { once: true });
      var url = "/Studios?Limit=300&Recursive=true&SortBy=SortName&SortOrder=Ascending";
      var data = makeApiRequest(url, { signal: ctrl.signal });
      var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
      var existing = new Set(
        [...list.querySelectorAll(".dnd-item")].map(function(li) li.dataset.name.toLowerCase())
      );

      var toAdd = [];
      for (var s of items) {
        var canon = toCanonicalStudioName(s.Name);
        if (!canon) continue;
        if (!existing.has(canon.toLowerCase())) {
          existing.add(canon.toLowerCase());
          toAdd.push(canon);
        }
      }

      if (toAdd.length) {
        var appendSorted = toAdd.sortfunction((a, b) DEFAULT_ORDER.indexOf(a) - DEFAULT_ORDER.indexOf(b)
        );

        for (var name of appendSorted) {
          list.appendChild(createDnDItem(name, labels, {
            enableStudioControls: true,
            hidden: currentHiddenNames.some(function(item) nameKey(item) === nameKey(name)),
            isManual: false,
            isAdmin,
            visibilityDisabled,
            manualEntries,
            sharedVideos
          }));
        }

        applyOrderNamesToList(currentOrderNames);
        refreshListState();
      }
    } catch (e) {
      console.warn("studioHubsPage: Studios genişletme başarısız:", e);
    }
  })();

  list.addEventListenerfunction("click", (e) {
    var li = e.target.closest(".dnd-item");
    if (!li) return;

    var toggleBtn = e.target.closest(".dnd-btn-visibility");
    if (toggleBtn) {
      if (toggleBtn.disabled || li.dataset.visibilityDisabled === "1") return;
      li.dataset.hidden = li.dataset.hidden === "1" ? "0" : "1";
      refreshListState();
      return;
    }

    var removeBtn = e.target.closest(".dnd-btn-remove");
    if (removeBtn) {
      var studioId = li.dataset.studioId || "";
      if (!studioId) return;
      var targetName = li.dataset.name || formatLabel("studioHubCollectionFallbackName", "Koleksiyon");
      setStatus(formatLabel("studioHubCollectionRemoving", "{name} kaldırılıyor...", {
        name: targetName
      }));
      try {
        var result = deleteStudioHubManualEntry(studioId);
        manualEntries = Array.isArray(result.manualEntries) ? result.manualEntries : manualEntries;
        sharedVideos = Array.isArray(result.videoEntries) ? result.videoEntries : sharedVideos;
        li.remove();
        refreshListState();
        setStatus(labels.manualCollectionRemoved || "Koleksiyon listeden kaldırıldı.", "success");
      } catch (error) {
        setStatus(error.message || (labels.studioHubManualCollectionRemoveFailed || "Koleksiyon kaldırılamadı."), "error");
      }
      return;
    }

    var uploadLogoBtn = e.target.closest(".dnd-btn-upload-logo");
    if (uploadLogoBtn) {
      pendingLogoTargetStudioId = li.dataset.studioId || "";
      logoFileInput.click();
      return;
    }

    var deleteLogoBtn = e.target.closest(".dnd-btn-delete-logo");
    if (deleteLogoBtn && !deleteLogoBtn.disabled) {
      var studioId = li.dataset.studioId || "";
      var targetName = li.dataset.name || "";
      setStatus(formatLabel("studioHubLogoDeleting", "{name} için logo siliniyor...", {
        name: targetName
      }));
      try {
        var result = deleteStudioHubLogo(studioId);
        manualEntries = Array.isArray(result.entries) ? result.entries : manualEntries;
        refreshListState();
        setStatus(formatLabel("studioHubLogoDeleted", "{name} için logo silindi.", {
          name: targetName
        }), "success");
      } catch (error) {
        setStatus(error.message || (labels.studioHubLogoDeleteFailed || "Logo silinemedi."), "error");
      }
      return;
    }

    var uploadBtn = e.target.closest(".dnd-btn-upload-video");
    if (uploadBtn) {
      pendingVideoTarget = li.dataset.name || "";
      videoFileInput.click();
      return;
    }

    var deleteVideoBtn = e.target.closest(".dnd-btn-delete-video");
    if (deleteVideoBtn && !deleteVideoBtn.disabled) {
      var targetName = li.dataset.name || "";
      setStatus(formatLabel("studioHubHoverVideoDeleting", "{name} için hover videosu siliniyor...", {
        name: targetName
      }));
      try {
        var result = deleteStudioHubVideo(targetName);
        sharedVideos = Array.isArray(result.entries) ? result.entries : [];
        refreshListState();
        setStatus(formatLabel("studioHubHoverVideoDeleted", "{name} için hover videosu silindi.", {
          name: targetName
        }), "success");
      } catch (error) {
        setStatus(error.message || (labels.studioHubHoverVideoDeleteFailed || "Hover videosu silinemedi."), "error");
      }
    }
  });

  list.addEventListener("dragend", refreshListState);
  list.addEventListener("drop", refreshListState);
  list.addEventListener("dnd:reorder", refreshListState);
  list.addEventListenerfunction("click", (e) {
    if (e.target.closest(".dnd-btn-up") || e.target.closest(".dnd-btn-down")) refreshListState();
  });
  refreshListState();

  var visibilityLoadPromise = useGlobalVisibility
    ? Promise.resolve().thenfunction(() {
        if (useGlobalOrder) applyOrderNamesToList(currentOrderNames);
        applyHiddenNamesToList(currentHiddenNames);
      })
    : function(() {
        try {
          var visibility = fetchStudioHubVisibility({
            force: true,
            profile: getVisibilityProfile()
          });
          applyOrderNamesToList(
            Array.isArray(visibility.orderNames) && visibility.orderNames.length
              ? visibility.orderNames
              : currentOrderNames
          );
          applyHiddenNamesToList(visibility.hiddenNames || []);
        } catch (e) {
          console.warn("studioHubsPage: visibility alınamadı:", e);
        }
      })();

  var sharedDataLoadPromise = function(() {
    try {
      manualEntries = fetchStudioHubManualEntries();
      manualEntriesLoaded = true;
      manualEntries.forEach(function(entry) upsertManualEntryInList(entry));
      sharedVideos = fetchStudioHubVideoEntries();
      applyOrderNamesToList(currentOrderNames);
      refreshListState();
    } catch (e) {
      console.warn("studioHubsPage: shared data alınamadı:", e);
    }
  })();

  function(() {
    var ctrl = new AbortController();
    panel.addEventListenerfunction("jms:cleanup", () ctrl.abort(), { once: true });
    try {
      Promise.allSettled([visibilityLoadPromise, sharedDataLoadPromise]);
      if (ctrl.signal.aborted) return;

      var emptyDefaultNames = findEmptyDefaultStudioHubNames(config, ctrl.signal);
      if (ctrl.signal.aborted || !emptyDefaultNames.length) return;

      var hiddenSet = new Set(currentHiddenNames.map(nameKey));
      var nextHiddenNames = dedupeNames([...currentHiddenNames, ...emptyDefaultNames]);
      var changed = emptyDefaultNames.some(function(name) !hiddenSet.has(nameKey(name)));
      if (!changed) return;

      applyHiddenNamesToList(nextHiddenNames);
    } catch (e) {
      if (!ctrl.signal.aborted) {
        console.warn("studioHubsPage: boş varsayılan koleksiyonlar otomatik gizlenemedi:", e);
      }
    }
  })();

  var subheading = document.createElement('h3');
  subheading.textContent = labels.personalRecommendations || 'Para Você';
  section.appendChild(subheading);

  var cardTitleModeWrap = document.createElement("div");
  cardTitleModeWrap.className = "input-container";

  var cardTitleModeLabel = document.createElement("label");
  cardTitleModeLabel.htmlFor = "managedCardTitleDisplayMode";
  cardTitleModeLabel.textContent =
    labels.managedCardTitleDisplayMode ||
    "Exibição de Logo/Título nos cards";
  cardTitleModeWrap.appendChild(cardTitleModeLabel);

  var cardTitleModeSelect = document.createElement("select");
  cardTitleModeSelect.id = "managedCardTitleDisplayMode";
  cardTitleModeSelect.name = "managedCardTitleDisplayMode";

  var cardTitleModeValue = normalizeManagedCardTitleDisplayMode(
    config.managedCardTitleDisplayMode
  );
  var cardTitleModeOptions = [
    {
      value: "logo",
      label: labels.managedCardTitleDisplayModeLogoOnly || "Apenas logo",
    },
    {
      value: "title",
      label: labels.managedCardTitleDisplayModeTitleOnly || "Apenas título",
    },
    {
      value: "logoTitle",
      label: labels.managedCardTitleDisplayModeLogoAndTitle || "Logo e título",
    },
    {
      value: "none",
      label: labels.managedCardTitleDisplayModeNone || "Ocultar ambos",
    },
  ];

  for (var optionDef of cardTitleModeOptions) {
    var option = document.createElement("option");
    option.value = optionDef.value;
    option.textContent = optionDef.label;
    option.selected = optionDef.value === cardTitleModeValue;
    cardTitleModeSelect.appendChild(option);
  }

  cardTitleModeWrap.appendChild(cardTitleModeSelect);
  section.appendChild(cardTitleModeWrap);

  var enableForYouCheckbox = createCheckbox(
    'enablePersonalRecommendations',
    labels.enableForYou || 'Habilitar Recomendações \'Para Você\'',
    config.enablePersonalRecommendations
  );
  section.appendChild(enableForYouCheckbox);

  var ratingWrap = createNumberInput(
   'studioHubsMinRating',
   labels.studioHubsMinRating || 'Nota Mínima',
   Number.isFinite(config.studioHubsMinRating) ? config.studioHubsMinRating : 6.5,
   1,
   10,
   0.1
  );
  section.appendChild(ratingWrap);

  var volumeWrap = createSelect(
    'studioHubsVolume',
    labels.studioHubsVolume || 'Volume dos Trailers (Coleções)',
    [
      { value: 'muted', text: labels.studioHubsMuted || 'Mudo' },
      { value: '10', text: (labels.studioHubsVolumeValue || '{value}%').replace('{value}', '10') },
      { value: '20', text: (labels.studioHubsVolumeValue || '{value}%').replace('{value}', '20') },
      { value: '30', text: (labels.studioHubsVolumeValue || '{value}%').replace('{value}', '30') },
      { value: '50', text: (labels.studioHubsVolumeValue || '{value}%').replace('{value}', '50') }
    ],
    config.studioHubsVolume || '20'
  );
  section.appendChild(volumeWrap);

  var personalcountWrap = createNumberInput(
    'personalRecsCardCount',
    labels.studioHubsCardCount || 'Número de cards a exibir (Tela principal)',
    Number.isFinite(config.personalRecsCardCount) ? config.personalRecsCardCount : 9,
    1,
    20
  );
  section.appendChild(personalcountWrap);

  var raHeading = document.createElement('h3');
  raHeading.textContent =
    labels.recentAndContinueHeading ||
    'Novidades e Continuar';
  section.appendChild(raHeading);

  var enableRecentRows = createCheckbox(
    'enableRecentRows',
    labels.enableRecentRows || 'Habilitar Seção',
    config.enableRecentRows !== false
  );
  section.appendChild(enableRecentRows);

  var recentSubWrap = document.createElement("div");
  recentSubWrap.style.paddingLeft = "8px";
  recentSubWrap.style.borderLeft = "2px solid #0002";
  recentSubWrap.style.marginBottom = "10px";
  section.appendChild(recentSubWrap);

  var showRecentRowsHeroCards = createCheckbox(
    'showRecentRowsHeroCards',
    labels.showRecentRowsHeroCards || 'Mostrar Hero Card (Master)',
    config.showRecentRowsHeroCards !== false
  );
  recentSubWrap.appendChild(showRecentRowsHeroCards);

  var enableTop10SeriesRow = createCheckbox(
    'enableTop10SeriesRow',
    labels.enableTop10SeriesRow || 'Habilitar Top 10 Séries',
    config.enableTop10SeriesRow !== false
  );
  recentSubWrap.appendChild(enableTop10SeriesRow);

  var enableTop10MoviesRow = createCheckbox(
    'enableTop10MoviesRow',
    labels.enableTop10MoviesRow || 'Habilitar Top 10 Filmes',
    config.enableTop10MoviesRow !== false
  );
  recentSubWrap.appendChild(enableTop10MoviesRow);

  var enableTmdbTopMoviesRow = createCheckbox(
    'enableTmdbTopMoviesRow',
    labels.enableTmdbTopMoviesRow || 'Habilitar Top 10 TMDb',
    config.enableTmdbTopMoviesRow !== false
  );
  recentSubWrap.appendChild(enableTmdbTopMoviesRow);

  var enableRecentMoviesRow = createCheckbox(
    'enableRecentMoviesRow',
    labels.enableRecentMoviesRow || 'Habilitar Filmes Recentes',
    config.enableRecentMoviesRow !== false
  );
  recentSubWrap.appendChild(enableRecentMoviesRow);

  var showRecentMoviesHeroCards = createCheckbox(
    'showRecentMoviesHeroCards',
    labels.showRecentMoviesHeroCards || 'Mostrar Hero Card (Filmes)',
    config.showRecentMoviesHeroCards !== false
  );
  recentSubWrap.appendChild(showRecentMoviesHeroCards);

  var splitMovieLibRows = createCheckbox(
    'recentRowsSplitMovieLibs',
    labels.recentRowsSplitMovieLibs || 'Film Kütüphanelerini Ayrı Bölümlerde Göster',
    config.recentRowsSplitMovieLibs === true
  );
  recentSubWrap.appendChild(splitMovieLibRows);

  var recentMoviesCountWrap = createNumberInput(
    'recentMoviesCardCount',
    labels.recentMoviesCardCount || 'Limite de Filmes Recentes',
    Number.isFinite(config.recentMoviesCardCount) ? config.recentMoviesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentMoviesCountWrap);

  var enableRecentSeriesRow = createCheckbox(
    'enableRecentSeriesRow',
    labels.enableRecentSeriesRow || 'Habilitar Séries Recentes',
    config.enableRecentSeriesRow !== false
  );
  recentSubWrap.appendChild(enableRecentSeriesRow);

  var showRecentSeriesHeroCards = createCheckbox(
    'showRecentSeriesHeroCards',
    labels.showRecentSeriesHeroCards || 'Mostrar Hero Card (Séries)',
    config.showRecentSeriesHeroCards !== false
  );
  recentSubWrap.appendChild(showRecentSeriesHeroCards);

  var splitTvLibRows = createCheckbox(
    'recentRowsSplitTvLibs',
    labels.recentRowsSplitTvLibs || 'Dizi Kütüphanelerini Ayrı Bölümle',
    config.recentRowsSplitTvLibs !== false
  );
  recentSubWrap.appendChild(splitTvLibRows);

  var recentSeriesCountWrap = createNumberInput(
    'recentSeriesCardCount',
    labels.recentSeriesCardCount || 'Limite de Séries Recentes',
    Number.isFinite(config.recentSeriesCardCount) ? config.recentSeriesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentSeriesCountWrap);

  var enableRecentMusicRow = createCheckbox(
    'enableRecentMusicRow',
    labels.enableRecentMusicRow || 'Habilitar Álbuns Recentes',
    config.enableRecentMusicRow !== false
  );
  recentSubWrap.appendChild(enableRecentMusicRow);

  var showRecentMusicHeroCards = createCheckbox(
    'showRecentMusicHeroCards',
    labels.showRecentMusicHeroCards || 'Mostrar Hero Card (Álbuns)',
    config.showRecentMusicHeroCards !== false
  );
  recentSubWrap.appendChild(showRecentMusicHeroCards);

  var enableRecentMusicTracksRow = createCheckbox(
    'enableRecentMusicTracksRow',
    labels.enableRecentMusicTracksRow || 'Son Dinlenen Parçalar',
    config.enableRecentMusicTracksRow !== false
  );
  recentSubWrap.appendChild(enableRecentMusicTracksRow);

  var showRecentTracksHeroCards = createCheckbox(
    'showRecentTracksHeroCards',
    labels.showRecentTracksHeroCards || 'Mostrar Hero Card (Músicas)',
    config.showRecentTracksHeroCards !== false
  );
  recentSubWrap.appendChild(showRecentTracksHeroCards);

  var recentMusicCountWrap = createNumberInput(
    'recentMusicCardCount',
    labels.recentMusicCardCount || 'Limite de Música Recente',
    Number.isFinite(config.recentMusicCardCount) ? config.recentMusicCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentMusicCountWrap);

  var enableRecentEpisodesRow = createCheckbox(
    'enableRecentEpisodesRow',
    labels.enableRecentEpisodesRow || 'Habilitar Episódios Recentes',
    config.enableRecentEpisodesRow !== false
  );
  recentSubWrap.appendChild(enableRecentEpisodesRow);

  var showRecentEpisodesHeroCards = createCheckbox(
    'showRecentEpisodesHeroCards',
    labels.showRecentEpisodesHeroCards || 'Mostrar Hero Card (Episódios)',
    config.showRecentEpisodesHeroCards !== false
  );
  recentSubWrap.appendChild(showRecentEpisodesHeroCards);

  var recentEpisodesCountWrap = createNumberInput(
    'recentEpisodesCardCount',
    labels.recentEpisodesCardCount || 'Limite de Episódios Recentes',
    Number.isFinite(config.recentEpisodesCardCount) ? config.recentEpisodesCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(recentEpisodesCountWrap);

  var enableNextUpRow = createCheckbox(
    'enableNextUpRow',
    labels.enableNextUpRow || 'Habilitar Próximos Episódios',
    config.enableNextUpRow !== false
  );
  recentSubWrap.appendChild(enableNextUpRow);

  var showNextUpHeroCards = createCheckbox(
    'showNextUpHeroCards',
    labels.showNextUpHeroCards || 'Mostrar Hero Card (Próximos)',
    config.showNextUpHeroCards !== false
  );
  recentSubWrap.appendChild(showNextUpHeroCards);

  var nextUpCountWrap = createNumberInput(
    'nextUpCardCount',
    labels.nextUpCardCount || 'Limite de Próximos',
    Number.isFinite(config.nextUpCardCount) ? config.nextUpCardCount : 10,
    1,
    20
  );
  recentSubWrap.appendChild(nextUpCountWrap);

  var getCb = function(wrap) wrap.querySelector.('input[type="checkbox"]');
  var bindDependentCheckboxVisibility = function(controllerWrap, dependentWrap) {
    var controllerCb = getCb(controllerWrap);
    var dependentCb = getCb(dependentWrap);

    var sync = function() {
      var visible = !!controllerCb.checked;
      if (dependentWrap) dependentWrap.style.display = visible ? '' : 'none';
      if (!visible && dependentCb) dependentCb.checked = false;
    };

    sync();
    controllerWrap.addEventListener.('change', sync, { passive: true });
    return sync;
  };

  var masterCb = getCb(enableRecentRows);
  var top10SeriesCb = getCb(enableTop10SeriesRow);
  var top10MoviesCb = getCb(enableTop10MoviesRow);
  var tmdbTopMoviesCb = getCb(enableTmdbTopMoviesRow);
  var recMovCb = getCb(enableRecentMoviesRow);
  var recMovHeroCb = getCb(showRecentMoviesHeroCards);
  var recSerCb = getCb(enableRecentSeriesRow);
  var recSerHeroCb = getCb(showRecentSeriesHeroCards);
  var recMusicCb = getCb(enableRecentMusicRow);
  var recMusicHeroCb = getCb(showRecentMusicHeroCards);
  var recTracksCb = getCb(enableRecentMusicTracksRow);
  var recTracksHeroCb = getCb(showRecentTracksHeroCards);
  var recEpCb  = getCb(enableRecentEpisodesRow);
  var recEpHeroCb = getCb(showRecentEpisodesHeroCards);
  var nextUpCb = getCb(enableNextUpRow);
  var nextUpHeroCb = getCb(showNextUpHeroCards);
  var syncRecentMoviesHeroVisibility = bindDependentCheckboxVisibility(enableRecentMoviesRow, showRecentMoviesHeroCards);
  var syncRecentSeriesHeroVisibility = bindDependentCheckboxVisibility(enableRecentSeriesRow, showRecentSeriesHeroCards);
  var syncRecentMusicHeroVisibility = bindDependentCheckboxVisibility(enableRecentMusicRow, showRecentMusicHeroCards);
  var syncRecentTracksHeroVisibility = bindDependentCheckboxVisibility(enableRecentMusicTracksRow, showRecentTracksHeroCards);
  var syncRecentEpisodesHeroVisibility = bindDependentCheckboxVisibility(enableRecentEpisodesRow, showRecentEpisodesHeroCards);
  var syncNextUpHeroVisibility = bindDependentCheckboxVisibility(enableNextUpRow, showNextUpHeroCards);

  function syncRecentSubState() {
    var on = !!masterCb.checked;
    recentSubWrap.style.display = on ? '' : 'none';
    if (!on) {
      if (top10SeriesCb) top10SeriesCb.checked = false;
      if (top10MoviesCb) top10MoviesCb.checked = false;
      if (tmdbTopMoviesCb) tmdbTopMoviesCb.checked = false;
      if (recMovCb) recMovCb.checked = false;
      if (recMovHeroCb) recMovHeroCb.checked = false;
      if (recSerCb) recSerCb.checked = false;
      if (recSerHeroCb) recSerHeroCb.checked = false;
      if (recMusicCb) recMusicCb.checked = false;
      if (recMusicHeroCb) recMusicHeroCb.checked = false;
      if (recTracksCb) recTracksCb.checked = false;
      if (recTracksHeroCb) recTracksHeroCb.checked = false;
      if (recEpCb)  recEpCb.checked  = false;
      if (recEpHeroCb) recEpHeroCb.checked = false;
      if (nextUpCb) nextUpCb.checked = false;
      if (nextUpHeroCb) nextUpHeroCb.checked = false;
    }
    syncRecentMoviesHeroVisibility();
    syncRecentSeriesHeroVisibility();
    syncRecentMusicHeroVisibility();
    syncRecentTracksHeroVisibility();
    syncRecentEpisodesHeroVisibility();
    syncNextUpHeroVisibility();
  }
  syncRecentSubState();
  enableRecentRows.addEventListener('change', syncRecentSubState, { passive: true });

  var enableContinueMovies = createCheckbox(
    'enableContinueMovies',
    labels.enableContinueMovies || 'Habilitar Continuar Assistindo (Filmes)',
    !!config.enableContinueMovies
  );
  section.appendChild(enableContinueMovies);

  var showContinueMoviesHeroCards = createCheckbox(
    'showContinueMoviesHeroCards',
    labels.showContinueMoviesHeroCards || 'Mostrar Hero Card (Continuar - Filmes)',
    config.showContinueMoviesHeroCards !== false
  );
  section.appendChild(showContinueMoviesHeroCards);

  var continueMoviesCountWrap = createNumberInput(
    'continueMoviesCardCount',
    labels.continueMoviesCardCount || 'Limite de Continuar (Filmes)',
    Number.isFinite(config.continueMoviesCardCount) ? config.continueMoviesCardCount : 10,
    1,
    20
  );
  section.appendChild(continueMoviesCountWrap);

  var enableContinueSeries = createCheckbox(
    'enableContinueSeries',
    labels.enableContinueSeries || 'Habilitar Continuar Assistindo (Séries)',
    !!config.enableContinueSeries
  );
  section.appendChild(enableContinueSeries);

  var showContinueSeriesHeroCards = createCheckbox(
    'showContinueSeriesHeroCards',
    labels.showContinueSeriesHeroCards || 'Mostrar Hero Card (Continuar - Séries)',
    config.showContinueSeriesHeroCards !== false
  );
  section.appendChild(showContinueSeriesHeroCards);

  var continueSeriesCountWrap = createNumberInput(
    'continueSeriesCardCount',
    labels.continueSeriesCardCount || 'Limite de Continuar (Séries)',
    Number.isFinite(config.continueSeriesCardCount) ? config.continueSeriesCardCount : 10,
    1,
    20
  );
  section.appendChild(continueSeriesCountWrap);

  var continueMoviesCb = getCb(enableContinueMovies);
  var continueMoviesHeroCb = getCb(showContinueMoviesHeroCards);
  var continueSeriesCb = getCb(enableContinueSeries);
  var continueSeriesHeroCb = getCb(showContinueSeriesHeroCards);
  var syncContinueMoviesHeroVisibility = bindDependentCheckboxVisibility(enableContinueMovies, showContinueMoviesHeroCards);
  var syncContinueSeriesHeroVisibility = bindDependentCheckboxVisibility(enableContinueSeries, showContinueSeriesHeroCards);

  function syncContinueHeroState() {
    if (continueMoviesCb && continueMoviesHeroCb && !continueMoviesCb.checked) {
      continueMoviesHeroCb.checked = false;
    }
    if (continueSeriesCb && continueSeriesHeroCb && !continueSeriesCb.checked) {
      continueSeriesHeroCb.checked = false;
    }
    syncContinueMoviesHeroVisibility();
    syncContinueSeriesHeroVisibility();
  }

  syncContinueHeroState();
  enableContinueMovies.addEventListener('change', syncContinueHeroState, { passive: true });
  enableContinueSeries.addEventListener('change', syncContinueHeroState, { passive: true });

  var movieLibBox = document.createElement("div");
  movieLibBox.className = "setting-item movies";
  movieLibBox.style.paddingLeft = "8px";
  movieLibBox.style.borderLeft = "2px solid #0002";
  movieLibBox.style.marginBottom = "10px";
  section.appendChild(movieLibBox);

  var splitMovieCb = splitMovieLibRows.querySelector.('input[type="checkbox"]');
  function syncMovieLibBoxVisibility() {
    var splitOn = !!splitMovieCb.checked;
    movieLibBox.style.display = splitOn ? "" : "none";
  }
  syncMovieLibBoxVisibility();
  splitMovieLibRows.addEventListener("change", syncMovieLibBoxVisibility, { passive: true });

  var movieLibTitle = document.createElement("div");
  movieLibTitle.style.fontWeight = "700";
  movieLibTitle.style.margin = "6px 0";
  movieLibTitle.textContent = labels.movieLibSelectHeading || "Selecionar Bibliotecas de Filmes";
  movieLibBox.appendChild(movieLibTitle);

  var tvLibBox = document.createElement("div");
  tvLibBox.className = "setting-item tvshows";
  tvLibBox.style.paddingLeft = "8px";
  tvLibBox.style.borderLeft = "2px solid #0002";
  tvLibBox.style.marginBottom = "10px";
  section.appendChild(tvLibBox);

  var splitCb = splitTvLibRows.querySelector.('input[type="checkbox"]');
  function syncTvLibBoxVisibility() {
    var splitOn = !!splitCb.checked;
    tvLibBox.style.display = splitOn ? "" : "none";
  }
  syncTvLibBoxVisibility();
  splitTvLibRows.addEventListener("change", syncTvLibBoxVisibility, { passive: true });

  var tvLibTitle = document.createElement("div");
  tvLibTitle.style.fontWeight = "700";
  tvLibTitle.style.margin = "6px 0";
  tvLibTitle.textContent = labels.tvLibSelectHeading || "Selecionar Bibliotecas de Séries";
  tvLibBox.appendChild(tvLibTitle);

  function readJsonArr(k) {
    try {
      var raw = localStorage.getItem(k);
      if (!raw || raw === "[object Object]") return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(function(x)String(x||"").trim()).filter(Boolean) : [];
    } catch { return []; }
  }
  function writeJsonArr(k, arr) {
    try { localStorage.setItem(k, JSON.stringify((arr||[]).filter(Boolean))); } catch {}
  }
  function mkHidden(k, initialArr) {
    var inp = document.createElement("input");
    inp.type = "hidden";
    inp.id = k;
    inp.name = k;
    inp.value = JSON.stringify((initialArr||[]).filter(Boolean));
    return inp;
  }

  var hiddenRecentMovies   = mkHidden("recentMoviesLibIds",    readJsonArr("recentMoviesLibIds"));
  var hiddenRecentSeries   = mkHidden("recentSeriesTvLibIds",   readJsonArr("recentSeriesTvLibIds"));
  var hiddenRecentEpisodes = mkHidden("recentEpisodesTvLibIds", readJsonArr("recentEpisodesTvLibIds"));
  var hiddenContinueSeries = mkHidden("continueSeriesTvLibIds", readJsonArr("continueSeriesTvLibIds"));
  movieLibBox.appendChild(hiddenRecentMovies);
  tvLibBox.appendChild(hiddenRecentSeries);
  tvLibBox.appendChild(hiddenRecentEpisodes);
  tvLibBox.appendChild(hiddenContinueSeries);

  var movieLibHint = document.createElement("div");
  movieLibHint.style.opacity = "0.85";
  movieLibHint.style.fontSize = "0.95em";
  movieLibHint.style.marginBottom = "6px";
  movieLibHint.textContent = labels.movieLibSelectHint || "Se vazio: todas as bibliotecas de Filmes serão incluídas.";
  movieLibBox.appendChild(movieLibHint);

  var movieLibGrid = document.createElement("div");
  movieLibGrid.style.display = "grid";
  movieLibGrid.style.gridTemplateColumns = "1fr";
  movieLibGrid.style.gap = "8px";
  movieLibBox.appendChild(movieLibGrid);

  var tvLibHint = document.createElement("div");
  tvLibHint.style.opacity = "0.85";
  tvLibHint.style.fontSize = "0.95em";
  tvLibHint.style.marginBottom = "6px";
  tvLibHint.textContent = labels.tvLibSelectHint || "Se vazio: todas as bibliotecas de Séries serão incluídas.";
  tvLibBox.appendChild(tvLibHint);

  var tvLibGrid = document.createElement("div");
  tvLibGrid.style.display = "grid";
  tvLibGrid.style.gridTemplateColumns = "1fr";
  tvLibGrid.style.gap = "8px";
  tvLibBox.appendChild(tvLibGrid);

  var OTHER_CT_EXCLUDE = new Set(["movies","tvshows","music"]);

  function readJsonArrGeneric(k) {
    try {
      var raw = localStorage.getItem(k);
      if (!raw || raw === "[object Object]") return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(function(x)String(x||"").trim()).filter(Boolean) : [];
    } catch { return []; }
  }

  function writeJsonArrGeneric(k, arr) {
    try { localStorage.setItem(k, JSON.stringify((arr||[]).filter(Boolean))); } catch {}
  }

  var allViewsPromise = null;

  function getAllViews() {
    if (!allViewsPromise) {
      allViewsPromise = fetchAllViews();
    }
    return allViewsPromise;
  }

  function fetchTvLibs() {
    try {
      var all = getAllViews();
      return all.filter(function(x) x.CollectionType === "tvshows" && x.Id).map(function(x) ({
        Id: x.Id,
        Name: x.Name || (labels.studioHubTvLibraryFallbackName || "TV")
      }));
    } catch {
      return [];
    }
  }

  function fetchMovieLibs() {
    try {
      var all = getAllViews();
      return all.filter(function(x) x.CollectionType === "movies" && x.Id).map(function(x) ({
        Id: x.Id,
        Name: x.Name || (labels.studioHubMovieLibraryFallbackName || "Movies")
      }));
    } catch {
      return [];
    }
  }

  function fetchAllViews() {
    try {
      var me = makeApiRequest("/Users/Me");
      var uid = me.Id;
      if (!uid) return [];
      var v = makeApiRequest("/Users/" + (uid) + "/Views");
      var items = Array.isArray(v.Items) ? v.Items : [];
      return items
        .filter(function(x) x.Id)
        .map(function(x) ({
          Id: x.Id,
          Name: x.Name || (labels.studioHubLibraryFallbackName || "Library"),
          CollectionType: (x.CollectionType || "").toString()
        }));
    } catch { return []; }
  }

  function(() {
    var libs = fetchMovieLibs();
    if (!libs.length) {
      var warn = document.createElement("div");
      warn.style.opacity = "0.85";
      warn.textContent = labels.movieLibSelectNoLibs || "Nenhuma biblioteca de filmes encontrada.";
      movieLibGrid.appendChild(warn);
      return;
    }

    var box = document.createElement("div");
    box.style.border = "1px solid #0002";
    box.style.borderRadius = "8px";
    box.style.padding = "8px";

    var h = document.createElement("div");
    h.style.fontWeight = "700";
    h.style.marginBottom = "6px";
    h.textContent = labels.movieLibRowRecentMovies || "Escolha as bibliotecas para a seção de filmes recentes";
    box.appendChild(h);

    var selected = new Set(readJsonArr("recentMoviesLibIds"));
    var list = document.createElement("div");
    list.style.display = "grid";
    list.style.gridTemplateColumns = "1fr";
    list.style.gap = "6px";

    var sync = function() {
      var arr = Array.from(selected);
      hiddenRecentMovies.value = JSON.stringify(arr);
      writeJsonArr("recentMoviesLibIds", arr);
    };

    for (var lib of libs) {
      var line = document.createElement("label");
      line.style.display = "flex";
      line.style.alignItems = "center";
      line.style.gap = "8px";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(lib.Id);
      cb.addEventListenerfunction("change", () {
        if (cb.checked) selected.add(lib.Id);
        else selected.delete(lib.Id);
        sync();
      }, { passive: true });

      var t = document.createElement("span");
      t.textContent = lib.Name;

      line.appendChild(cb);
      line.appendChild(t);
      list.appendChild(line);
    }

    var actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.marginTop = "8px";

    var btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.textContent = labels.selectAll || "Selecionar Tudo";
    btnAll.addEventListenerfunction("click", () {
      selected.clear();
      libs.forEach(function(l) selected.add(l.Id));
      [...list.querySelectorAll("input[type=checkbox]")].forEach(function(i) i.checked = true);
      sync();
    });

    var btnNone = document.createElement("button");
    btnNone.type = "button";
    btnNone.textContent = labels.selectNone || "Remover Tudo";
    btnNone.addEventListenerfunction("click", () {
      selected.clear();
      [...list.querySelectorAll("input[type=checkbox]")].forEach(function(i) i.checked = false);
      sync();
    });

    actions.appendChild(btnAll);
    actions.appendChild(btnNone);

    box.appendChild(list);
    box.appendChild(actions);
    movieLibGrid.appendChild(box);

    sync();
  })();

  function(() {
    var libs = fetchTvLibs();
    if (!libs.length) {
      var warn = document.createElement("div");
      warn.style.opacity = "0.85";
      warn.textContent = labels.tvLibSelectNoLibs || "Nenhuma biblioteca de séries encontrada.";
      tvLibGrid.appendChild(warn);
      return;
    }

    var makeRow = function(title, key, hiddenInp) {
      var box = document.createElement("div");
      box.style.border = "1px solid #0002";
      box.style.borderRadius = "8px";
      box.style.padding = "8px";

      var h = document.createElement("div");
      h.style.fontWeight = "700";
      h.style.marginBottom = "6px";
      h.textContent = title;
      box.appendChild(h);

      var selected = new Set(readJsonArr(key));
      var list = document.createElement("div");
      list.style.display = "grid";
      list.style.gridTemplateColumns = "1fr";
      list.style.gap = "6px";

      var sync = function() {
        var arr = Array.from(selected);
        hiddenInp.value = JSON.stringify(arr);
        writeJsonArr(key, arr);
      };

      for (var lib of libs) {
        var line = document.createElement("label");
        line.style.display = "flex";
        line.style.alignItems = "center";
        line.style.gap = "8px";

        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(lib.Id);
        cb.addEventListenerfunction("change", () {
          if (cb.checked) selected.add(lib.Id);
          else selected.delete(lib.Id);
          sync();
        }, { passive: true });

        var t = document.createElement("span");
        t.textContent = lib.Name;

        line.appendChild(cb);
        line.appendChild(t);
        list.appendChild(line);
      }

      var actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.marginTop = "8px";

      var btnAll = document.createElement("button");
      btnAll.type = "button";
      btnAll.textContent = labels.selectAll || "Selecionar Tudo";
      btnAll.addEventListenerfunction("click", () {
        selected.clear();
        libs.forEach(function(l) selected.add(l.Id));
        [...list.querySelectorAll("input[type=checkbox]")].forEach(function(i) i.checked = true);
        sync();
      });

      var btnNone = document.createElement("button");
      btnNone.type = "button";
      btnNone.textContent = labels.selectNone || "Remover Tudo";
      btnNone.addEventListenerfunction("click", () {
        selected.clear();
        [...list.querySelectorAll("input[type=checkbox]")].forEach(function(i) i.checked = false);
        sync();
      });

      actions.appendChild(btnAll);
      actions.appendChild(btnNone);

      box.appendChild(list);
      box.appendChild(actions);

      sync();
      return box;
    };

    tvLibGrid.appendChild(makeRow(
      labels.tvLibRowRecentSeries || "Escolha as bibliotecas para a seção de séries recentes",
      "recentSeriesTvLibIds",
      hiddenRecentSeries
    ));
    tvLibGrid.appendChild(makeRow(
      labels.tvLibRowRecentEpisodes || "Escolha as bibliotecas para a seção de episódios recentes",
      "recentEpisodesTvLibIds",
      hiddenRecentEpisodes
    ));
    tvLibGrid.appendChild(makeRow(
      labels.tvLibRowContinueSeries || "Escolha as bibliotecas para a seção de continuar assistindo",
      "continueSeriesTvLibIds",
      hiddenContinueSeries
    ));
  })();

  var otherLibsHeading = document.createElement("div");
  otherLibsHeading.style.fontWeight = "800";
  otherLibsHeading.style.margin = "14px 0 6px";
  otherLibsHeading.textContent = labels.otherLibrariesHeading || "Diğer Kütüphaneler";
  section.appendChild(otherLibsHeading);

  var enableOtherLibRows = createCheckbox(
    "enableOtherLibRows",
    labels.enableOtherLibRows || "Diğer kütüphane bölümleirni göster (Son Eklenen / Devam / Bölüm)",
    !!config.enableOtherLibRows
  );
  section.appendChild(enableOtherLibRows);

  var showOtherLibrariesHeroCards = createCheckbox(
    "showOtherLibrariesHeroCards",
    labels.showOtherLibrariesHeroCards || "Mostrar Hero Card (Outros)",
    config.showOtherLibrariesHeroCards !== false
  );
  section.appendChild(showOtherLibrariesHeroCards);

  var otherLibBox = document.createElement("div");
  otherLibBox.style.paddingLeft = "8px";
  otherLibBox.style.borderLeft = "2px solid #0002";
  otherLibBox.style.marginBottom = "10px";
  section.appendChild(otherLibBox);

  var otherRecentCountWrap = createNumberInput(
    "otherLibrariesRecentCardCount",
    labels.otherLibrariesRecentCardCount || "Novidades • Limite de cards",
    Number.isFinite(config.otherLibrariesRecentCardCount) ? config.otherLibrariesRecentCardCount : 10,
    1,
    20
  );
  otherLibBox.appendChild(otherRecentCountWrap);

  var otherContinueCountWrap = createNumberInput(
    "otherLibrariesContinueCardCount",
    labels.otherLibrariesContinueCardCount || "Continuar Assistindo • Limite de cards",
    Number.isFinite(config.otherLibrariesContinueCardCount) ? config.otherLibrariesContinueCardCount : 10,
    1,
    20
  );
  otherLibBox.appendChild(otherContinueCountWrap);

  var otherEpisodesCountWrap = createNumberInput(
    "otherLibrariesEpisodesCardCount",
    labels.otherLibrariesEpisodesCardCount || "Episódios Recentes • Limite de cards",
    Number.isFinite(config.otherLibrariesEpisodesCardCount) ? config.otherLibrariesEpisodesCardCount : 10,
    1,
    20
  );
  otherLibBox.appendChild(otherEpisodesCountWrap);

  var hiddenOtherLibIds = function(() {
    var inp = document.createElement("input");
    inp.type = "hidden";
    inp.id = "otherLibrariesIds";
    inp.name = "otherLibrariesIds";
    inp.value = JSON.stringify(readJsonArrGeneric("otherLibrariesIds"));
    return inp;
  })();
  otherLibBox.appendChild(hiddenOtherLibIds);

  var otherHint = document.createElement("div");
  otherHint.style.opacity = "0.85";
  otherHint.style.fontSize = "0.95em";
  otherHint.style.margin = "6px 0";
  otherHint.textContent = labels.otherLibrariesHint || "Se vazio: todas as outras bibliotecas serão incluídas.";
  otherLibBox.appendChild(otherHint);

  var otherGrid = document.createElement("div");
  otherGrid.style.display = "grid";
  otherGrid.style.gridTemplateColumns = "1fr";
  otherGrid.style.gap = "6px";
  otherLibBox.appendChild(otherGrid);

  var otherActions = document.createElement("div");
  otherActions.style.display = "flex";
  otherActions.style.gap = "8px";
  otherActions.style.marginTop = "8px";
  otherLibBox.appendChild(otherActions);

  var btnOtherAll = document.createElement("button");
  btnOtherAll.type = "button";
  btnOtherAll.textContent = labels.selectAll || "Hepsini seç";
  otherActions.appendChild(btnOtherAll);

  var btnOtherNone = document.createElement("button");
  btnOtherNone.type = "button";
  btnOtherNone.textContent = labels.selectNone || "Hepsini kaldır";
  otherActions.appendChild(btnOtherNone);

  var otherMasterCb = enableOtherLibRows.querySelector.('input[type="checkbox"]');
  var otherHeroCb = showOtherLibrariesHeroCards.querySelector.('input[type="checkbox"]');
  var syncOtherHeroVisibility = bindDependentCheckboxVisibility(enableOtherLibRows, showOtherLibrariesHeroCards);
  function syncOtherBoxVisibility() {
    var on = !!otherMasterCb.checked;
    otherLibBox.style.display = on ? "" : "none";
    if (!on) {
      if (otherHeroCb) otherHeroCb.checked = false;
      hiddenOtherLibIds.value = "[]";
      writeJsonArrGeneric("otherLibrariesIds", []);
      [...otherGrid.querySelectorAll('input[type="checkbox"]')].forEach(function(i) (i.checked = false));
    }
    syncOtherHeroVisibility();
  }
  syncOtherBoxVisibility();
  enableOtherLibRows.addEventListener("change", syncOtherBoxVisibility, { passive: true });

  function(() {
    var all = getAllViews();
    var others = all.filter(function(v) {
      var ct = (v.CollectionType || "").toLowerCase();
      return !OTHER_CT_EXCLUDE.has(ct);
    });

    if (!others.length) {
      var warn = document.createElement("div");
      warn.style.opacity = "0.85";
      warn.textContent = labels.otherLibrariesNone || "Nenhuma biblioteca adicional encontrada.";
      otherGrid.appendChild(warn);
      return;
    }

    var selected = new Set(readJsonArrGeneric("otherLibrariesIds"));
    var sync = function() {
      var arr = Array.from(selected);
      hiddenOtherLibIds.value = JSON.stringify(arr);
      writeJsonArrGeneric("otherLibrariesIds", arr);
    };

    for (var lib of others) {
      var line = document.createElement("label");
      line.style.display = "flex";
      line.style.alignItems = "center";
      line.style.gap = "8px";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(lib.Id);
      cb.addEventListenerfunction("change", () {
        if (cb.checked) selected.add(lib.Id);
        else selected.delete(lib.Id);
        sync();
      }, { passive: true });

      var t = document.createElement("span");
      var ct = (lib.CollectionType || "").toLowerCase();
      var ctLabel = ct ? " (" + (ct) + ")" : "";
      t.textContent = (lib.Name) + (ctLabel);

      line.appendChild(cb);
      line.appendChild(t);
      otherGrid.appendChild(line);
    }

    btnOtherAll.addEventListenerfunction("click", () {
      selected.clear();
      others.forEach(function(l) selected.add(l.Id));
      [...otherGrid.querySelectorAll('input[type="checkbox"]')].forEach(function(i) (i.checked = true));
      sync();
    });

    btnOtherNone.addEventListenerfunction("click", () {
      selected.clear();
      [...otherGrid.querySelectorAll('input[type="checkbox"]')].forEach(function(i) (i.checked = false));
      sync();
    });

    sync();
  })();

  var becauseYouWatchedSection = createSection(
    labels.becauseYouWatchedSettings ||
    config.languageLabels.becauseYouWatchedSettings ||
    'Recomendações por Histórico'
  );

  var enableBecauseYouWatched = createCheckbox(
    'enableBecauseYouWatched',
    labels.enableBecauseYouWatched || 'Ativar Sugestões Baseadas no que Assistiu',
    config.enableBecauseYouWatched !== false
  );
  becauseYouWatchedSection.appendChild(enableBecauseYouWatched);

  var showPersonalRecsHeroCards = createCheckbox(
    'showPersonalRecsHeroCards',
    labels.showPersonalRecsHeroCards || 'Mostrar Hero Card (Sugeridos)',
    config.showPersonalRecsHeroCards !== false
  );
  becauseYouWatchedSection.appendChild(showPersonalRecsHeroCards);
  bindDependentCheckboxVisibility(enableBecauseYouWatched, showPersonalRecsHeroCards);

  var bywRowCountWrap = createNumberInput(
    'becauseYouWatchedRowCount',
    labels.becauseYouWatchedRowCount || 'Número de fileiras de sugestão',
    Number.isFinite(config.becauseYouWatchedRowCount) ? config.becauseYouWatchedRowCount : 1,
    1,
    50
  );
  becauseYouWatchedSection.appendChild(bywRowCountWrap);

  var bywCardCountWrap = createNumberInput(
    'becauseYouWatchedCardCount',
    labels.becauseYouWatchedCardCount || 'Cards por fileira',
    Number.isFinite(config.becauseYouWatchedCardCount) ? config.becauseYouWatchedCardCount : 10,
    1,
    20
  );
  becauseYouWatchedSection.appendChild(bywCardCountWrap);

  var genreSection = createSection(
    labels.genreHubsSettings ||
    config.languageLabels.genreHubsSettings ||
    'Coleções por Gênero'
  );

  var enableGenreHubs = createCheckbox(
    'enableGenreHubs',
    labels.enableGenreHubs || 'Ativar Coleções por Gênero',
    !!config.enableGenreHubs
  );
  genreSection.appendChild(enableGenreHubs);

  var showGenreHubsHeroCards = createCheckbox(
    'showGenreHubsHeroCards',
    labels.showGenreHubsHeroCards || 'Mostrar Hero Card (Gêneros)',
    config.showGenreHubsHeroCards !== false
  );
  genreSection.appendChild(showGenreHubsHeroCards);

  var rowsCountWrap = createNumberInput(
    'studioHubsGenreRowsCount',
    labels.studioHubsGenreRowsCount || 'Número de fileiras de gêneros',
    Number.isFinite(config.studioHubsGenreRowsCount) ? config.studioHubsGenreRowsCount : 4,
    1,
    50
  );
  genreSection.appendChild(rowsCountWrap);

  var perRowCountWrap = createNumberInput(
    'studioHubsGenreCardCount',
    labels.studioHubsGenreCardCount || 'Cards por fileira',
    Number.isFinite(config.studioHubsGenreCardCount) ? config.studioHubsGenreCardCount : 10,
    1,
    20
  );
  genreSection.appendChild(perRowCountWrap);

  var genreHidden = createHiddenInput('genreHubsOrder', JSON.stringify(Array.isArray(config.genreHubsOrder) ? config.genreHubsOrder : []));
  genreSection.appendChild(genreHidden);

  var { wrap: genreDndWrap, list: genreList } = createDraggableList('genreHubsOrderList', Array.isArray(config.genreHubsOrder) && config.genreHubsOrder.length ? config.genreHubsOrder : [], labels);
  genreSection.appendChild(genreDndWrap);

  function(() {
    try {
      var ctrl = new AbortController(); panel.addEventListenerfunction('jms:cleanup', ()ctrl.abort(), {once:true});
      var genres = fetchGenresForSettings(ctrl);
      var existing = new Set(
        [...genreList.querySelectorAll(".dnd-item")].map(function(li) li.dataset.name.toLowerCase())
      );
      var appended = 0;
      for (var g of genres) {
        var k = String(g).toLowerCase();
        if (!existing.has(k)) {
          existing.add(k);
          genreList.appendChild(createDnDItem(g, labels));
          appended++;
        }
      }
      if (appended > 0) {
        var names = [...genreList.querySelectorAll(".dnd-item")].map(function(li) li.dataset.name);
        genreHidden.value = JSON.stringify(names);
      }
    } catch (e) {
      console.warn("Falha ao carregar lista de gêneros:", e);
    }
  })();

  var refreshGenreHidden = function() {
    var names = [...genreList.querySelectorAll(".dnd-item")].map(function(li) li.dataset.name);
    genreHidden.value = JSON.stringify(names);
  };
  var genreMasterCb = enableGenreHubs.querySelector.('input[type="checkbox"]');
  var genreHeroCb = showGenreHubsHeroCards.querySelector.('input[type="checkbox"]');
  var syncGenreHeroVisibility = bindDependentCheckboxVisibility(enableGenreHubs, showGenreHubsHeroCards);
  function syncGenreHeroState() {
    if (genreMasterCb && genreHeroCb && !genreMasterCb.checked) {
      genreHeroCb.checked = false;
    }
    syncGenreHeroVisibility();
  }
  syncGenreHeroState();
  enableGenreHubs.addEventListener('change', syncGenreHeroState, { passive: true });
  genreList.addEventListener("dragend", refreshGenreHidden);
  genreList.addEventListener("drop", refreshGenreHidden);
  genreList.addEventListener("dnd:reorder", refreshGenreHidden);
  genreList.addEventListenerfunction("click", (e) {
    if (e.target.closest(".dnd-btn-up") || e.target.closest(".dnd-btn-down")) refreshGenreHidden();
  });

  var dirSection = createSection(labels.directorRowsSettings || 'Coleções por Diretor');

  var enableDirectorRows = createCheckbox(
    'enableDirectorRows',
    labels.enableDirectorRows || 'Ativar Coleções por Diretor',
    !!config.enableDirectorRows
  );
  dirSection.appendChild(enableDirectorRows);

  var showDirectorRowsHeroCards = createCheckbox(
    'showDirectorRowsHeroCards',
    labels.showDirectorRowsHeroCards || 'Mostrar Hero Card (Diretores)',
    config.showDirectorRowsHeroCards !== false
  );
  dirSection.appendChild(showDirectorRowsHeroCards);
  bindDependentCheckboxVisibility(enableDirectorRows, showDirectorRowsHeroCards);

  var directorRowsUseTopGenres = createCheckbox(
    'directorRowsUseTopGenres',
    labels.directorRowsUseTopGenres || 'Selecionar diretores dos seus gêneros favoritos',
    config.directorRowsUseTopGenres !== false
  );
  dirSection.appendChild(directorRowsUseTopGenres);

  var dirCount = createNumberInput(
    'directorRowsCount',
    labels.directorRowsCount || 'Número de diretores',
    Number.isFinite(config.directorRowsCount) ? config.directorRowsCount : 5,
    1, 50
  );
  dirSection.appendChild(dirCount);

  var dirPerRow = createNumberInput(
    'directorRowCardCount',
    labels.directorRowCardCount || 'Cards por fileira',
    Number.isFinite(config.directorRowCardCount) ? config.directorRowCardCount : 10,
    1, 20
  );
  dirSection.appendChild(dirPerRow);

  var directorRowsMinItemsPerDirector = createNumberInput(
    'directorRowsMinItemsPerDirector',
    labels.directorRowsMinItemsPerDirector || 'Mínimo de itens por diretor',
    Number.isFinite(config.directorRowsMinItemsPerDirector) ? config.directorRowsMinItemsPerDirector : 10,
    1, 20
  );
  dirSection.appendChild(directorRowsMinItemsPerDirector);

  var managedOrderSection = createSection(
    labels.managedHomeSectionOrderSettings ||
    config.languageLabels.managedHomeSectionOrderSettings ||
    'Ordem das Seções da Home'
  );

  var managedOrderHint = document.createElement("div");
  managedOrderHint.className = "description-text2";
  managedOrderHint.style.margin = "4px 0 10px";
  managedOrderHint.textContent =
    labels.managedHomeSectionOrderHint ||
    "Esta ordem define tanto a posição visual quanto a prioridade de carregamento das fileiras.";
  managedOrderSection.appendChild(managedOrderHint);

  var currentNativeHomeSectionItems = getCurrentNativeHomeSectionOrderItems();

  var managedHomeSectionOrderHidden = createHiddenInput(
    'managedHomeSectionOrder',
    JSON.stringify(
      normalizeManagedHomeSectionOrder(
        config.managedHomeSectionOrder,
        { nativeEntries: currentNativeHomeSectionItems }
      )
    )
  );
  managedOrderSection.appendChild(managedHomeSectionOrderHidden);

  var { wrap: managedOrderWrap, list: managedOrderList } = createDraggableList(
    'managedHomeSectionOrderList',
    getManagedHomeSectionOrderItems(config, labels, currentNativeHomeSectionItems),
    labels,
    {
      labelText:
        labels.managedHomeSectionOrderLabel ||
        'Ordem das fileiras na tela principal'
    }
  );
  managedOrderSection.appendChild(managedOrderWrap);

  var refreshManagedHomeSectionOrder = function() {
    var names = [...managedOrderList.querySelectorAll(".dnd-item")]
      .mapfunction((li) String(li.dataset.name || "").trim())
      .filter(Boolean);
    managedHomeSectionOrderHidden.value = JSON.stringify(
      normalizeManagedHomeSectionOrder(
        names,
        { nativeEntries: currentNativeHomeSectionItems }
      )
    );
  };

  managedOrderList.addEventListener("dragend", refreshManagedHomeSectionOrder);
  managedOrderList.addEventListener("drop", refreshManagedHomeSectionOrder);
  managedOrderList.addEventListener("dnd:reorder", refreshManagedHomeSectionOrder);
  managedOrderList.addEventListenerfunction("click", (e) {
    if (e.target.closest(".dnd-btn-up") || e.target.closest(".dnd-btn-down")) {
      refreshManagedHomeSectionOrder();
    }
  });

  panel.appendChild(section);
  panel.appendChild(becauseYouWatchedSection);
  panel.appendChild(genreSection);
  panel.appendChild(dirSection);
  panel.appendChild(managedOrderSection);

  return panel;
}

function fetchGenresForSettings(ctrl) {
  try {
    var url = "/Genres?Recursive=true&SortBy=SortName&SortOrder=Ascending&IncludeItemTypes=Movie,Series";
    var data = makeApiRequest(url, { signal: ctrl.signal });
    var items = Array.isArray(data.Items) ? data.Items : (Array.isArray(data) ? data : []);
    var names = [];
    for (var it of items) {
      var name = (it.Name || "").trim();
      if (name) names.push(name);
    }
    return uniqueCaseInsensitive(names);
  } catch (e) {
    console.warn("fetchGenresForSettings erro:", e);
    return [];
  }
}

function uniqueCaseInsensitive(list) {
  var seen = new Set();
  var out = [];
  for (var g of list) {
    var k = String(g).toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(g); }
  }
  return out;
}
