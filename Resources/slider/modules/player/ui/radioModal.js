import { getConfig } from "../../config.js";
import { showNotification } from "./notification.js";
import { playTrack } from "../player/playback.js";
import { musicPlayerState } from "../core/state.js";
import {
  activateRadioPlaylist,
  canRemoveSharedRadioStation,
  findStationByUrl,
  getAutoDiscoveredStations,
  getRadioPersistenceInfo,
  getRadioStationSubtitle,
  normalizeRadioStation,
  removeSharedRadioStation,
  resolveRadioStationArtUrl,
  saveSharedRadioStation,
  searchAllRadioStations,
  searchRadioStationsDetailed,
  stationKey,
  submitStationToDirectory
} from "../core/radio.js";

var DEFAULT_RADIO_ART_CSS = "url('./slider/src/images/defaultArt.png')";
var SEARCH_DEBOUNCE_MS = 250;
var SEARCH_CACHE_LIMIT = 24;
var SEARCH_PAGE_SIZE = 50;
var SEARCH_SCROLL_THRESHOLD = 280;

var modalState = {
  root: null,
  results: null,
  status: null,
  searchInput: null,
  searchBtn: null,
  discoverBtn: null,
  addBtn: null,
  addForm: null,
  hint: null,
  requestId: 0,
  view: "discover",
  sharedStations: [],
  nearbyStations: [],
  popularStations: [],
  searchResults: [],
  countryCode: "TR",
  searchDebounceId: 0,
  lastSearchKey: "",
  isSearchComposing: false,
  searchLimit: SEARCH_PAGE_SIZE,
  searchHasMore: false,
  searchLoadingMore: false,
  searchPlaybackLoading: false,
  searchCache: new Map()
};

function labels() {
  return getConfig().languageLabels || {};
}

function text(value, fallback = "") {
  var out = String(value || "").trim();
  return out || fallback;
}

function normalizeSearchKey(value) {
  return text(value).toLocaleLowerCase();
}

function clearSearchDebounce() {
  if (!modalState.searchDebounceId) return;
  window.clearTimeout(modalState.searchDebounceId);
  modalState.searchDebounceId = 0;
}

function readCachedSearchResults(searchKey) {
  if (!searchKey || !modalState.searchCache.has(searchKey)) return null;
  var cached = modalState.searchCache.get(searchKey);
  modalState.searchCache.delete(searchKey);
  modalState.searchCache.set(searchKey, cached);
  if (Array.isArray(cached)) {
    return {
      limit: cached.length,
      results: cached
    };
  }
  if (!cached || !Array.isArray(cached.results)) return null;
  return {
    limit: Math.max(Number(cached.limit) || 0, cached.results.length),
    results: cached.results,
    hasMore: cached.hasMore !== false
  };
}

function storeCachedSearchResults(searchKey, limit, results, hasMore = false) {
  if (!searchKey) return;
  var cachedResults = Array.isArray(results) ? results : [];
  if (modalState.searchCache.has(searchKey)) {
    modalState.searchCache.delete(searchKey);
  }
  modalState.searchCache.set(searchKey, {
    limit: Math.max(Number(limit) || 0, cachedResults.length),
    results: cachedResults,
    hasMore: hasMore === true
  });

  while (modalState.searchCache.size > SEARCH_CACHE_LIMIT) {
    var oldestKey = modalState.searchCache.keys().next().value;
    modalState.searchCache.delete(oldestKey);
  }
}

function normalizeSearchLimit(value) {
  return Math.max(SEARCH_PAGE_SIZE, Math.floor(Number(value) || SEARCH_PAGE_SIZE));
}

function scheduleSearch() {
  clearSearchDebounce();
  if (modalState.isSearchComposing) return;

  modalState.searchDebounceId = window.setTimeoutfunction(() {
    modalState.searchDebounceId = 0;
    runSearch();
  }, SEARCH_DEBOUNCE_MS);
}

function ensureStyles() {
  if (document.getElementById("gmmp-radio-modal-styles")) return;

  var style = document.createElement("style");
  style.id = "gmmp-radio-modal-styles";
  style.textContent = "\n    #gmmp-radio-modal-styles {\n      display: none;\n    }\n\n    .gmmp-radio-modal {\n      --gmmp-radio-radius-sm: 8px;\n      --gmmp-radio-radius-md: 12px;\n      --gmmp-radio-radius-lg: 20px;\n      --gmmp-radio-radius-xl: 24px;\n      --gmmp-radio-surface-0: var(--gmmp-bg-primary, var(--background-color, linear-gradient(180deg, #151924, #0a0c12)));\n      --gmmp-radio-surface-1: var(--gmmp-bg-secondary, var(--modal-bg, rgba(20, 28, 40, 0.85)));\n      --gmmp-radio-surface-2: var(--gmmp-bg-surface, rgba(30, 38, 50, 0.6));\n      --gmmp-radio-surface-3: var(--gmmp-bg-surface-hover, rgba(40, 48, 62, 0.8));\n      --gmmp-radio-surface-elevated: var(--gmmp-bg-elevated, rgba(35, 45, 60, 0.9));\n      --gmmp-radio-border: var(--gmmp-border-light, rgba(255, 255, 255, 0.08));\n      --gmmp-radio-border-medium: var(--gmmp-border-medium, rgba(255, 255, 255, 0.12));\n      --gmmp-radio-border-strong: var(--gmmp-accent-primary-soft, var(--gmmp-border-strong, rgba(255, 255, 255, 0.2)));\n      --gmmp-radio-text-primary: var(--gmmp-text-primary, var(--ptext-color, #ffffff));\n      --gmmp-radio-text-secondary: var(--gmmp-text-secondary, var(--lighter-text, rgba(255, 255, 255, 0.85)));\n      --gmmp-radio-text-muted: var(--gmmp-text-tertiary, var(--light-text, rgba(255, 255, 255, 0.6)));\n      --gmmp-radio-text-subtle: var(--gmmp-text-muted, rgba(255, 255, 255, 0.45));\n      --gmmp-radio-accent: var(--gmmp-accent-primary, var(--primary-color, #10b981));\n      --gmmp-radio-accent-strong: var(--gmmp-accent-primary-dark, var(--secondary-color, #059669));\n      --gmmp-radio-accent-soft: var(--gmmp-accent-primary-soft, rgba(16, 185, 129, 0.15));\n      --gmmp-radio-danger-bg: var(--gmmp-accent-danger-soft, rgba(239, 68, 68, 0.15));\n      --gmmp-radio-danger-text: var(--gmmp-accent-danger, #ef4444);\n      --gmmp-radio-shadow-sm: var(--gmmp-shadow-sm, 0 4px 6px -1px rgba(0, 0, 0, 0.1));\n      --gmmp-radio-shadow-md: var(--gmmp-shadow-md, 0 10px 25px -5px rgba(0, 0, 0, 0.15));\n      --gmmp-radio-shadow-lg: var(--gmmp-shadow-lg, 0 25px 50px -12px rgba(0, 0, 0, 0.25));\n      --gmmp-radio-shadow-glow: var(--gmmp-shadow-glow, 0 0 0 2px var(--gmmp-radio-accent-soft));\n      position: fixed;\n      inset: 0;\n      z-index: 2147483647;\n      display: none;\n      place-items: center;\n      padding: 18px;\n      color: var(--gmmp-radio-text-primary);\n      font-family: inherit;\n    }\n\n    .gmmp-radio-modal.visible {\n      display: grid;\n    }\n\n    .gmmp-radio-modal,\n    .gmmp-radio-modal * {\n      box-sizing: border-box;\n    }\n\n    .gmmp-radio-backdrop {\n      position: absolute;\n      inset: 0;\n      background:\n        radial-gradient(circle at top left, var(--gmmp-radio-accent-soft), transparent 28%),\n        linear-gradient(180deg, rgba(15, 23, 42, 0.28), rgba(15, 23, 42, 0.44));\n      backdrop-filter: var(--gmmp-blur, blur(14px));\n    }\n\n    .gmmp-radio-dialog {\n      position: relative;\n      z-index: 1;\n      width: min(1180px, calc(100vw - 36px));\n      max-height: min(92vh, 900px);\n      display: flex;\n      flex-direction: column;\n      gap: 18px;\n      overflow: hidden;\n      border-radius: var(--gmmp-radio-radius-xl);\n      border: 1px solid var(--gmmp-radio-border);\n      background: var(--gmmp-radio-surface-0);\n      color: var(--gmmp-radio-text-primary);\n      box-shadow: var(--gmmp-radio-shadow-lg);\n    }\n\n    .gmmp-radio-header {\n      display: flex;\n      align-items: flex-start;\n      justify-content: space-between;\n      gap: 18px;\n      padding: 24px 24px 14px;\n      border-bottom: 1px solid var(--gmmp-radio-border);\n      background: linear-gradient(180deg, var(--gmmp-radio-surface-2), transparent);\n    }\n\n    .gmmp-radio-title {\n      margin: 0 0 6px;\n      font-size: 28px;\n      font-weight: 800;\n      letter-spacing: -0.03em;\n      color: var(--gmmp-radio-text-primary);\n    }\n\n    .gmmp-radio-status {\n      margin: 0;\n      max-width: 720px;\n      color: var(--gmmp-radio-text-muted);\n      font-size: 13px;\n      line-height: 1.56;\n    }\n\n    .gmmp-radio-actions {\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      flex-shrink: 0;\n    }\n\n    .gmmp-radio-btn,\n    .gmmp-radio-iconbtn,\n    .gmmp-radio-cardbtn,\n    .gmmp-radio-linkbtn {\n      appearance: none;\n      border: 1px solid transparent;\n      cursor: pointer;\n      color: var(--gmmp-radio-text-secondary);\n      font: inherit;\n      font-size: 12px;\n      font-weight: 800;\n      line-height: 1.2;\n      transition: transform .18s ease, background-color .18s ease, box-shadow .18s ease, opacity .18s ease;\n    }\n\n    .gmmp-radio-btn:disabled,\n    .gmmp-radio-iconbtn:disabled,\n    .gmmp-radio-cardbtn:disabled,\n    .gmmp-radio-linkbtn:disabled {\n      cursor: not-allowed;\n      opacity: 0.55;\n    }\n\n    .gmmp-radio-btn,\n    .gmmp-radio-cardbtn,\n    .gmmp-radio-linkbtn {\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      min-height: 38px;\n      padding: 10px 12px;\n      border-radius: var(--gmmp-radio-radius-sm);\n      background: var(--gmmp-radio-surface-2);\n      border-color: var(--gmmp-radio-border);\n    }\n\n    .gmmp-radio-btn.primary,\n    .gmmp-radio-cardbtn.primary {\n      background: linear-gradient(135deg, var(--gmmp-radio-accent), var(--gmmp-radio-accent-strong));\n      border-color: transparent;\n      color: #fff;\n    }\n\n    .gmmp-radio-btn.secondary,\n    .gmmp-radio-cardbtn.secondary,\n    .gmmp-radio-linkbtn {\n      background: var(--gmmp-radio-surface-2);\n      color: var(--gmmp-radio-text-secondary);\n    }\n\n    .gmmp-radio-cardbtn.danger {\n      background: var(--gmmp-radio-danger-bg);\n      color: var(--gmmp-radio-danger-text);\n      border-color: transparent;\n    }\n\n    .gmmp-radio-linkbtn:disabled {\n      opacity: 1;\n      cursor: default;\n      background: var(--gmmp-radio-accent-soft);\n      border-color: transparent;\n      color: var(--gmmp-radio-accent);\n    }\n\n    .gmmp-radio-btn:hover:not(:disabled),\n    .gmmp-radio-iconbtn:hover:not(:disabled),\n    .gmmp-radio-cardbtn:hover:not(:disabled),\n    .gmmp-radio-linkbtn:hover:not(:disabled) {\n      transform: translateY(-1px);\n    }\n\n    .gmmp-radio-btn:focus-visible,\n    .gmmp-radio-iconbtn:focus-visible,\n    .gmmp-radio-cardbtn:focus-visible,\n    .gmmp-radio-linkbtn:focus-visible,\n    .gmmp-radio-input:focus-visible {\n      outline: 2px solid var(--gmmp-radio-accent);\n      outline-offset: 2px;\n    }\n\n    .gmmp-radio-iconbtn {\n      width: 44px;\n      height: 44px;\n      border-radius: var(--gmmp-radio-radius-sm);\n      background: var(--gmmp-radio-surface-2);\n      border-color: var(--gmmp-radio-border);\n      color: var(--gmmp-radio-text-secondary);\n      display: inline-flex;\n      align-items: center;\n      justify-content: center;\n      flex-shrink: 0;\n    }\n\n    .gmmp-radio-iconbtn i {\n      padding: 0 !important;\n      font-size: 18px;\n    }\n\n    .gmmp-radio-searchrow {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 10px;\n      align-items: center;\n      margin: 0 24px;\n      padding: 14px;\n      border-radius: 16px;\n      border: 1px solid var(--gmmp-radio-border);\n      background: var(--gmmp-radio-surface-2);\n      box-shadow: inset 0 1px 0 var(--gmmp-radio-border);\n    }\n\n    .gmmp-radio-searchrow .gmmp-radio-input {\n      flex: 1 1 260px;\n      min-width: 220px;\n    }\n\n    .gmmp-radio-searchrow button {\n      flex-shrink: 0;\n    }\n\n    .gmmp-radio-addform {\n      display: grid;\n      gap: 12px;\n      align-items: end;\n      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr) 160px;\n      max-width: 100%;\n      margin: 0 24px;\n      padding: 6px;\n    }\n\n    .gmmp-radio-input {\n      width: 100%;\n      border: 1px solid var(--gmmp-radio-border-medium);\n      border-radius: var(--gmmp-radio-radius-md);\n      background: var(--gmmp-radio-surface-elevated);\n      color: var(--gmmp-radio-text-primary);\n      outline: none;\n      font: inherit;\n      font-size: 13px;\n      transition: border-color .18s ease, box-shadow .18s ease, background-color .18s ease;\n      align-items: center;\n      min-height: 38px;\n      padding: 10px 12px;\n    }\n\n    .gmmp-radio-input::placeholder {\n      color: var(--gmmp-radio-text-subtle);\n    }\n\n    .gmmp-radio-input:focus {\n      border-color: var(--gmmp-radio-accent);\n      box-shadow: var(--gmmp-radio-shadow-glow);\n      background: var(--gmmp-radio-surface-3);\n    }\n\n    .gmmp-radio-hint {\n      margin: -6px 24px 0;\n      color: var(--gmmp-radio-text-muted);\n      font-size: 13px;\n      line-height: 1.56;\n    }\n\n    .gmmp-radio-results {\n      flex: 1;\n      min-height: 0;\n      overflow-y: auto;\n      display: flex;\n      flex-direction: column;\n      gap: 24px;\n      padding: 0 24px 24px;\n      scrollbar-color: var(--gmmp-radio-accent) transparent;\n      overscroll-behavior: contain;\n      -webkit-overflow-scrolling: touch;\n      touch-action: pan-y;\n    }\n\n    .gmmp-radio-section {\n      display: flex;\n      flex-direction: column;\n      gap: 12px;\n    }\n\n    .gmmp-radio-section-head {\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 14px;\n      padding: 0 4px;\n    }\n\n    .gmmp-radio-section-title {\n      margin: 0;\n      font-size: 16px;\n      font-weight: 800;\n      letter-spacing: -0.02em;\n      color: var(--gmmp-radio-text-primary);\n      min-width: 0;\n    }\n\n    .gmmp-radio-section-note {\n      color: var(--gmmp-radio-text-subtle);\n      font-size: 12px;\n      line-height: 1.5;\n      text-align: right;\n    }\n\n    .gmmp-radio-grid {\n      display: grid;\n      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));\n      gap: 14px;\n    }\n\n    .gmmp-radio-card {\n      display: grid;\n      grid-template-columns: 110px minmax(0, 1fr);\n      min-height: 206px;\n      border-radius: var(--gmmp-radio-radius-lg);\n      overflow: hidden;\n      border: 1px solid var(--gmmp-radio-border);\n      background: var(--gmmp-radio-surface-2);\n      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;\n    }\n\n    .gmmp-radio-card:hover,\n    .gmmp-radio-card:focus-within {\n      transform: translateY(-2px);\n      border-color: var(--gmmp-radio-border-strong);\n      box-shadow: var(--gmmp-radio-shadow-md);\n    }\n\n    .gmmp-radio-art {\n      position: relative;\n      min-height: 100%;\n      background-color: var(--gmmp-radio-surface-1);\n      background-size: cover;\n      background-position: center;\n      overflow: hidden;\n    }\n\n    .gmmp-radio-art::after {\n      content: \"\";\n      position: absolute;\n      inset: 0;\n      background:\n        linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.32)),\n        linear-gradient(160deg, var(--gmmp-radio-accent-soft), transparent 72%);\n      pointer-events: none;\n    }\n\n    .gmmp-radio-card-body {\n      min-width: 0;\n      display: flex;\n      flex-direction: column;\n      gap: 10px;\n      padding: 14px 14px 12px;\n    }\n\n    .gmmp-radio-name {\n      margin: 0;\n      font-size: 17px;\n      font-weight: 800;\n      line-height: 1.22;\n      letter-spacing: -0.02em;\n      color: var(--gmmp-radio-text-primary);\n      word-break: break-word;\n    }\n\n    .gmmp-radio-meta,\n    .gmmp-radio-tags,\n    .gmmp-radio-contributor {\n      color: var(--gmmp-radio-text-muted);\n      font-size: 12px;\n      line-height: 1.5;\n      word-break: break-word;\n    }\n\n    .gmmp-radio-contributor {\n      color: var(--gmmp-radio-accent);\n      font-weight: 700;\n    }\n\n    .gmmp-radio-card-actions {\n      display: flex;\n      gap: 8px;\n      flex-wrap: wrap;\n      align-items: center;\n      margin-top: auto;\n    }\n\n    .gmmp-radio-card-actions button {\n      min-height: 36px;\n      padding: 9px 12px;\n      font-size: 12px;\n    }\n\n    .gmmp-radio-section-actions {\n      display: flex;\n      justify-content: center;\n      padding-top: 4px;\n    }\n\n    .gmmp-radio-section-actions button {\n      min-width: 180px;\n    }\n\n    .gmmp-radio-empty,\n    .gmmp-radio-loading {\n      padding: 24px;\n      border: 1px dashed var(--gmmp-radio-border-medium);\n      border-radius: 18px;\n      background: var(--gmmp-radio-surface-2);\n      text-align: center;\n      color: var(--gmmp-radio-text-muted);\n      font-size: 14px;\n      line-height: 1.6;\n    }\n\n    @media (max-width: 920px) {\n      .gmmp-radio-dialog {\n        width: min(100vw, calc(100vw - 20px));\n        max-height: 94vh;\n      }\n\n      .gmmp-radio-header {\n        align-items: flex-start;\n      }\n\n      .gmmp-radio-actions {\n        justify-content: space-between;\n      }\n\n      .gmmp-radio-addform {\n        grid-template-columns: repeat(4, minmax(0, 1fr));\n      }\n\n      .gmmp-radio-addform .gmmp-radio-input, .gmmp-radio-addform button {\n        grid-column: span 2;\n      }\n    }\n\n    @media (max-width: 760px) {\n      .gmmp-radio-modal {\n        padding: 0;\n      }\n\n      .gmmp-radio-dialog {\n        width: 100%;\n        max-height: 100vh;\n        height: 100vh;\n        border-radius: 0;\n      }\n\n      .gmmp-radio-header {\n        padding: 18px 16px 12px;\n      }\n\n      .gmmp-radio-searchrow,\n      .gmmp-radio-addform {\n        margin: 0 16px;\n      }\n\n      .gmmp-radio-hint,\n      .gmmp-radio-results {\n        margin-left: 16px;\n        margin-right: 16px;\n      }\n\n      .gmmp-radio-results {\n        padding-left: 0;\n        padding-right: 0;\n        padding-bottom: 20px;\n      }\n\n      .gmmp-radio-card {\n        grid-template-columns: 92px minmax(0, 1fr);\n        min-height: 184px;\n      }\n    }\n\n    @media (max-width: 520px) {\n      .gmmp-radio-title {\n        font-size: 22px;\n      }\n\n      .gmmp-radio-actions .gmmp-radio-btn {\n        flex: 1 1 180px;\n      }\n\n      .gmmp-radio-searchrow .gmmp-radio-input {\n        min-width: 100%;\n      }\n\n      .gmmp-radio-card {\n        grid-template-columns: 1fr;\n      }\n\n      .gmmp-radio-art {\n        min-height: 140px;\n      }\n\n      .gmmp-radio-section-head {\n        flex-direction: column;\n        align-items: flex-start;\n      }\n\n      .gmmp-radio-section-note {\n        text-align: left;\n      }\n    }\n  ";

  document.head.appendChild(style);
}

function setStatus(message = "") {
  if (!modalState.status) return;
  modalState.status.textContent = message;
}

function updateHintText() {
  if (!modalState.hint) return;
  var labelsMap = labels();
  var info = getRadioPersistenceInfo();

  if (info.mode === "NexusPobreFlix") {
    modalState.hint.textContent = labelsMap.radioSharedHint || "Estações salvas estão disponíveis para todos";
    return;
  }

  modalState.hint.textContent =
    "Modo de configuração manual: as estações adicionadas são armazenadas neste navegador. Para uma lista comum, use o arquivo radio-stations.json.";
}

function sameStation(a, b) {
  if (!a || !b) return false;
  return stationKey(a) !== "" && stationKey(a) === stationKey(b);
}

function isSharedStation(station) {
  return modalState.sharedStations.somefunction((item) sameStation(item, station));
}

function openStationHomepage(station) {
  if (!station.homepage) return;
  window.open(station.homepage, "_blank", "noopener,noreferrer");
}

function playStationGroup(stations, index) {
  var playableIndex = activateRadioPlaylist(stations, index);
  if (playableIndex < 0) return;
  playTrack(playableIndex);
}

function maybeLoadMoreSearchResults() {
  if (!modalState.results || modalState.view !== "search" || !modalState.searchHasMore || modalState.searchLoadingMore) {
    return;
  }

  var remaining = modalState.results.scrollHeight - modalState.results.scrollTop - modalState.results.clientHeight;
  if (remaining <= SEARCH_SCROLL_THRESHOLD) {
    loadMoreSearchResults();
  }
}

function shareStation(station) {
  var labelsMap = labels();
  setStatus(labelsMap.radioAdding || "Salvando estação...");

  try {
    var merged = saveSharedRadioStation(station);
    var info = getRadioPersistenceInfo();
    modalState.sharedStations = Array.isArray(merged) ? merged : modalState.sharedStations;
    updateHintText();
    setStatus(labelsMap.radioReady || "Pronto");
    showNotification(
      "<i class=\"fas fa-check-circle\"></i> " + (info.supportsServerWrite ? (labelsMap.radioSharedSaved || "Estação adicionada à lista compartilhada") : (labelsMap.radioLocalSaved || "Estação salva neste navegador")),
      2200,
      "success"
    );
    renderResults();
    submitStationToDirectory(station).catchfunction(() {});
  } catch (error) {
    console.error("[radio] Paylasilan kayit hatasi:", error);
    setStatus(labelsMap.radioSharedSaveError || "Não foi possível adicionar a estação à lista compartilhada");
  }
}

function unshareStation(station) {
  var labelsMap = labels();
  setStatus(labelsMap.radioRemoving || "Removendo estação...");

  try {
    var merged = removeSharedRadioStation(station);
    modalState.sharedStations = Array.isArray(merged) ? merged : modalState.sharedStations;
    updateHintText();
    setStatus(labelsMap.radioReady || "Pronto");
    showNotification(
      "<i class=\"fas fa-check-circle\"></i> " + (labelsMap.radioRemoved || "Estação removida da lista compartilhada"),
      2200,
      "success"
    );
    renderResults();
  } catch (error) {
    console.error("[radio] silme hatasi:", error);
    setStatus(labelsMap.radioRemoveError || "Não foi possível remover a estação");
  }
}

function createCardButton(className, labelText, onClick) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gmmp-radio-cardbtn " + (className).trim();
  btn.textContent = labelText;
  btn.addEventListenerfunction("click", (event) onClick.(event, btn));
  return btn;
}

function setDefaultStationArt(art) {
  if (!art) return;
  art.style.backgroundImage = DEFAULT_RADIO_ART_CSS;
}

function applyStationArt(art, imageUrl) {
  if (!art || !imageUrl) return;
  art.style.backgroundImage = "url(" + (JSON.stringify(imageUrl)) + ")";
}

function loadStationArt(art, station) {
  if (!art) return;
  setDefaultStationArt(art);

  var requestId = String((Number(art.dataset.artRequestId) || 0) + 1);
  art.dataset.artRequestId = requestId;

  try {
    var imageUrl = resolveRadioStationArtUrl(station);
    if (art.dataset.artRequestId !== requestId || !imageUrl) return;
    applyStationArt(art, imageUrl);
  } catch {
  }
}

function getStationContributorText(station) {
  var addedBy = text(station.addedBy || station.AddedBy);
  if (!addedBy) return "";
  return (labels().radioAddedBy || "Adicionado por") + ": " + (addedBy);
}

function renderStationCard(station, stations, index, { shared = false, onPlay = null } = {}) {
  var labelsMap = labels();
  var card = document.createElement("article");
  card.className = "gmmp-radio-card";

  var art = document.createElement("div");
  art.className = "gmmp-radio-art";
  setDefaultStationArt(art);
  loadStationArt(art, station);

  var body = document.createElement("div");
  body.className = "gmmp-radio-card-body";

  var name = document.createElement("div");
  name.className = "gmmp-radio-name";
  name.textContent = station.name;

  var meta = document.createElement("div");
  meta.className = "gmmp-radio-meta";
  meta.textContent = getRadioStationSubtitle(station);

  var contributorText = getStationContributorText(station);
  var contributor = document.createElement("div");
  contributor.className = "gmmp-radio-contributor";
  contributor.textContent = contributorText;
  if (!contributorText) contributor.hidden = true;

  var tags = document.createElement("div");
  tags.className = "gmmp-radio-tags";
  tags.textContent = [
    station.tags,
    station.clickcount > 0 ? (labelsMap.radioClicks || "Tik") + ": " + (station.clickcount) : "",
    station.votes > 0 ? (labelsMap.radioVotes || "Oy") + ": " + (station.votes) : ""
  ].filter(Boolean).join(" • ");

  var actions = document.createElement("div");
  actions.className = "gmmp-radio-card-actions";
  actions.appendChildfunction(createCardButton("primary", labelsMap.radioListen || "Ouvir", (_event, btn) {
    btn.disabled = true;
    try {
      if (typeof onPlay === "function") {
        onPlay(station, stations, index);
      } else {
        playStationGroup(stations, index);
      }
    } finally {
      btn.disabled = false;
    }
  }));

  if (shared) {
    var sharedBtn = document.createElement("button");
    sharedBtn.type = "button";
    sharedBtn.className = "gmmp-radio-linkbtn";
    sharedBtn.textContent = labelsMap.radioSharedLabel || "Compartilhada";
    sharedBtn.disabled = true;
    actions.appendChild(sharedBtn);

    if (canRemoveSharedRadioStation(station)) {
      actions.appendChildfunction(createCardButton("danger", labelsMap.radioRemove || "Remover", (_event, btn) {
        btn.disabled = true;
        try {
          unshareStation(station);
        } finally {
          btn.disabled = false;
        }
      }));
    }
  } else {
    var actionLabel = isSharedStation(station)
      ? labelsMap.radioSharedLabel || "Compartilhada"
      : labelsMap.radioShare || "Compartilhar";
    var shareBtn = createCardButtonfunction("secondary", actionLabel, (_event, btn) {
      if (isSharedStation(station)) return;
      btn.disabled = true;
      try {
        shareStation(station);
      } finally {
        btn.disabled = isSharedStation(station);
      }
    });
    if (isSharedStation(station)) shareBtn.disabled = true;
    actions.appendChild(shareBtn);
  }

  if (station.homepage) {
    var linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "gmmp-radio-linkbtn";
    linkBtn.textContent = labelsMap.radioHomepage || "Site";
    linkBtn.addEventListenerfunction("click", () openStationHomepage(station));
    actions.appendChild(linkBtn);
  }

  body.append(name, meta, contributor, tags, actions);
  card.append(art, body);
  return card;
}

function renderSection(title, stations, options = {}) {
  var section = document.createElement("section");
  section.className = "gmmp-radio-section";

  var head = document.createElement("div");
  head.className = "gmmp-radio-section-head";

  var heading = document.createElement("h4");
  heading.className = "gmmp-radio-section-title";
  heading.textContent = title;

  var note = document.createElement("div");
  note.className = "gmmp-radio-section-note";
  note.textContent = options.note || "";

  head.append(heading, note);
  section.appendChild(head);

  if (!stations.length) {
    var empty = document.createElement("div");
    empty.className = "gmmp-radio-empty";
    empty.textContent = options.emptyText || (labels().radioNoStations || "Nenhuma estação encontrada");
    section.appendChild(empty);
    return section;
  }

  var grid = document.createElement("div");
  grid.className = "gmmp-radio-grid";
  stations.forEach(function((station, index) {
    grid.appendChild(renderStationCard(station, stations, index, {
      shared: options.shared === true,
      onPlay: options.onPlay
    }));
  });
  section.appendChild(grid);

  if (options.footerText) {
    var footer = document.createElement("div");
    footer.className = "gmmp-radio-loading";
    footer.textContent = options.footerText;
    section.appendChild(footer);
  }

  return section;
}

function getSearchStatusText(count) {
  var labelsMap = labels();
    ? (count) + " " + (labelsMap.radioStationPlural || "estações")
    : labelsMap.radioSearchEmpty || "Nenhuma estação encontrada para sua busca";
}

function resolveSearchPlaybackStations(targetStation) {
  var query = text(modalState.searchInput.value);
  var searchKey = normalizeSearchKey(query);
  if (!query || !searchKey) return modalState.searchResults;

  var cached = readCachedSearchResults(searchKey);
  if (cached.hasMore === false && cached.results.length) {
    return cached.results;
  }

  if (!modalState.searchHasMore) {
    return modalState.searchResults;
  }

  var labelsMap = labels();
  modalState.searchPlaybackLoading = true;
  setStatus(labelsMap.radioPreparingPlaylist || "Preparando lista de reprodução com todos os resultados...");

  try {
    var allResults = searchAllRadioStations({ query, order: "clickcount", reverse: true });
    var isSameQuery = modalState.view === "search" && normalizeSearchKey(text(modalState.searchInput.value)) === searchKey;

    storeCachedSearchResults(searchKey, allResults.length || SEARCH_PAGE_SIZE, allResults, false);

    if (isSameQuery) {
      modalState.searchResults = allResults;
      modalState.searchLimit = Math.max(SEARCH_PAGE_SIZE, allResults.length);
      modalState.searchHasMore = false;
      musicPlayerState.radioSearchResults = allResults;
      setStatus(getSearchStatusText(allResults.length));
      renderResults();
    }

    var targetIndex = allResults.findIndexfunction((entry) sameStation(entry, targetStation));
    return targetIndex >= 0 ? allResults : modalState.searchResults;
  } catch (error) {
    console.error("[radio] tum arama sonuclari yuklenemedi:", error);
    return modalState.searchResults;
  } finally {
    modalState.searchPlaybackLoading = false;
  }
}

function playSearchResultStation(station) {
  var playlistStations = resolveSearchPlaybackStations(station);
  var targetIndex = Math.maxfunction(0, playlistStations.findIndex((entry) sameStation(entry, station)));
  playStationGroup(playlistStations, targetIndex);
}

function renderResults() {
  if (!modalState.results) return;
  modalState.results.innerHTML = "";

  var labelsMap = labels();

  if (modalState.view === "search") {
    modalState.results.appendChild(renderSection(
      labelsMap.radioSearchResults || "Resultados da Busca",
      modalState.searchResults,
      {
        note: modalState.searchResults.length
          ? (modalState.searchResults.length) + " " + (labelsMap.radioStationPlural || "estações")
          : "",
        emptyText: labelsMap.radioSearchEmpty || "Nenhuma estação encontrada para sua busca",
        footerText: modalState.searchLoadingMore
          ? (labelsMap.radioLoadingMore || "Carregando mais estações...")
          : "",
        onPlay: playSearchResultStation
      }
    ));
    if (modalState.sharedStations.length) {
      modalState.results.appendChild(renderSection(
        labelsMap.radioSharedStations || "Estações Compartilhadas",
        modalState.sharedStations,
        {
          shared: true,
          note: labelsMap.radioSharedHint || "Estações salvas estão disponíveis para todos"
        }
      ));
    }
    queueMicrotask(maybeLoadMoreSearchResults);
    return;
  }

  if (modalState.sharedStations.length) {
    modalState.results.appendChild(renderSection(
      labelsMap.radioSharedStations || "Estações Compartilhadas",
      modalState.sharedStations,
      {
        shared: true,
        note: getRadioPersistenceInfo().supportsServerWrite
          ? (labelsMap.radioSharedHint || "Estações salvas estão disponíveis para todos")
          : (labelsMap.radioManualSharedHint || "Arquivos estáticos e salvos neste navegador são mostrados juntos")
      }
    ));
  }

  modalState.results.appendChild(renderSection(
    (modalState.countryCode) + " " + (labelsMap.radioNearbyStations || "destaques para"),
    modalState.nearbyStations,
    {
      note: labelsMap.radioAutoDiscoveryHint || "Descoberta automática de estações"
    }
  ));

  modalState.results.appendChild(renderSection(
    labelsMap.radioPopularStations || "Populares no mundo",
    modalState.popularStations,
    {
      note: labelsMap.radioPopularHint || "Por contagem de cliques e votos"
    }
  ));
}

function setLoading(message = "") {
  if (!modalState.results) return;
  modalState.results.innerHTML = "";
  var loading = document.createElement("div");
  loading.className = "gmmp-radio-loading";
  loading.textContent = message || (labels().loading || "Carregando...");
  modalState.results.appendChild(loading);
}

function loadDiscoverView() {
  var labelsMap = labels();
  var requestId = ++modalState.requestId;
  modalState.view = "discover";
  modalState.lastSearchKey = "";
  modalState.searchLimit = SEARCH_PAGE_SIZE;
  modalState.searchHasMore = false;
  modalState.searchLoadingMore = false;
  modalState.searchPlaybackLoading = false;
  musicPlayerState.radioSearchResults = [];
  updateHintText();
  setStatus(labelsMap.radioAutoDiscovering || "Buscando estações automaticamente...");
  setLoading(labelsMap.radioAutoDiscovering || "Buscando estações automaticamente...");

  try {
    var data = getAutoDiscoveredStations({ limit: 18 });
    if (requestId !== modalState.requestId) return;

    modalState.countryCode = data.countryCode || modalState.countryCode;
    modalState.sharedStations = data.shared || [];
    modalState.nearbyStations = data.nearby || [];
    modalState.popularStations = data.popular || [];
    updateHintText();
    setStatus(labelsMap.radioReady || "Pronto");
    renderResults();
  } catch (error) {
    console.error("[radio] kesif hatasi:", error);
    if (requestId !== modalState.requestId) return;
    setStatus(labelsMap.radioLoadError || "Não foi possível carregar as estações");
    setLoading(labelsMap.radioLoadError || "Não foi possível carregar as estações");
  }
}

function loadMoreSearchResults() {
  if (modalState.searchLoadingMore || modalState.searchPlaybackLoading || !modalState.searchHasMore) return;
  modalState.searchLoadingMore = true;
  setStatus(labels().radioLoadingMore || "Carregando mais estações...");
  renderResults();

  try {
    runSearch({
      force: true,
      requestedLimit: modalState.searchLimit + SEARCH_PAGE_SIZE,
      preserveResults: true
    });
  } finally {
    modalState.searchLoadingMore = false;
    renderResults();
  }
}

function runSearch({ force = false, requestedLimit, preserveResults = false } = {}) {
  var query = text(modalState.searchInput.value);
  var searchKey = normalizeSearchKey(query);
  var isSameQuery = searchKey === modalState.lastSearchKey;
  var searchLimit = normalizeSearchLimit(isSameQuery ? requestedLimit : SEARCH_PAGE_SIZE);
  if (!query) {
    modalState.lastSearchKey = "";
    modalState.searchLimit = SEARCH_PAGE_SIZE;
    modalState.searchHasMore = false;
    modalState.searchLoadingMore = false;
    modalState.searchPlaybackLoading = false;
    musicPlayerState.radioSearchResults = [];
    if (!force && modalState.view === "discover") return;
    loadDiscoverView();
    return;
  }

  if (!force && isSameQuery && modalState.view === "search" && searchLimit === modalState.searchLimit) {
    return;
  }

  var labelsMap = labels();
  var requestId = ++modalState.requestId;
  var cachedResults = readCachedSearchResults(searchKey);
  modalState.lastSearchKey = searchKey;
  modalState.searchLimit = searchLimit;
  modalState.view = "search";
  updateHintText();

  if (cachedResults && cachedResults.limit >= searchLimit) {
    modalState.searchResults = cachedResults.results.slice(0, searchLimit);
    modalState.searchHasMore = cachedResults.hasMore !== false;
    musicPlayerState.radioSearchResults = modalState.searchResults;
    setStatus(getSearchStatusText(modalState.searchResults.length));
    renderResults();
    return;
  }

  if (preserveResults) {
    setStatus(labelsMap.radioLoadingMore || "Carregando mais estações...");
  } else {
    setStatus(labelsMap.radioSearching || "Buscando estação...");
    setLoading(labelsMap.radioSearching || "Buscando estação...");
  }

  try {
    var { results, hasMore } = searchRadioStationsDetailed({
      query,
      limit: searchLimit,
      order: "clickcount",
      reverse: true
    });
    if (requestId !== modalState.requestId) return;
    modalState.searchResults = results;
    modalState.searchHasMore = hasMore;
    musicPlayerState.radioSearchResults = results;
    storeCachedSearchResults(searchKey, searchLimit, results, hasMore);
    updateHintText();
    setStatus(getSearchStatusText(results.length));
    renderResults();
  } catch (error) {
    console.error("[radio] arama hatasi:", error);
    if (requestId !== modalState.requestId) return;
    setStatus(labelsMap.radioLoadError || "Não foi possível carregar as estações");
    if (!preserveResults) {
      setLoading(labelsMap.radioLoadError || "Não foi possível carregar as estações");
    }
  }
}

function handleAddStation(event) {
  event.preventDefault();

  var labelsMap = labels();
  var form = modalState.addForm;
  if (!form) return;

  var formData = new FormData(form);
  var name = text(formData.get("name"));
  var url = text(formData.get("url"));
  var homepage = text(formData.get("homepage"));

  if (!url) {
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (labelsMap.radioUrlRequired || "Endereço de transmissão é necessário"),
      2200,
      "warning"
    );
    return;
  }

  if (modalState.addBtn) modalState.addBtn.disabled = true;
  setStatus(labelsMap.radioAdding || "Istasyon kaydediliyor...");

  try {
    var existing = findStationByUrl(url).catchfunction(() null);
    var station = normalizeRadioStation({
      ...(existing || {}),
      name: name || existing.name || undefined,
      url,
      homepage: homepage || existing.homepage || undefined
    }, { source: "shared" });

    if (!station) {
      throw new Error(labelsMap.radioInvalidStation || "Estação inválida");
    }

    var merged = saveSharedRadioStation(station);
    var info = getRadioPersistenceInfo();
    modalState.sharedStations = Array.isArray(merged) ? merged : modalState.sharedStations;
    form.reset();

    showNotification(
      "<i class=\"fas fa-check-circle\"></i> " + (info.supportsServerWrite ? (labelsMap.radioSharedSaved || "Estação adicionada à lista compartilhada") : (labelsMap.radioLocalSaved || "Estação salva neste navegador")),
      2500,
      "success"
    );

    submitStationToDirectory(station).catchfunction(() {});
    if (modalState.view !== "discover") {
      modalState.view = "discover";
    }
    updateHintText();
    setStatus(labelsMap.radioReady || "Pronto");
    renderResults();
  } catch (error) {
    console.error("[radio] ekleme hatasi:", error);
    setStatus(labelsMap.radioSharedSaveError || "Não foi possível adicionar a estação à lista compartilhada");
  } finally {
    if (modalState.addBtn) modalState.addBtn.disabled = false;
  }
}

function closeRadioModal() {
  if (!modalState.root) return;
  clearSearchDebounce();
  modalState.isSearchComposing = false;
  modalState.searchPlaybackLoading = false;
  modalState.root.classList.remove("visible");
}

function ensureModal() {
  if (modalState.root) return;

  ensureStyles();

  var root = document.createElement("div");
  root.id = "gmmp-radio-modal";
  root.className = "gmmp-radio-modal";
  root.innerHTML = "\n    <div class=\"gmmp-radio-backdrop\"></div>\n    <div class=\"gmmp-radio-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"gmmp-radio-title\">\n      <div class=\"gmmp-radio-header\">\n        <div>\n          <h3 id=\"gmmp-radio-title\" class=\"gmmp-radio-title\">" + (labels().radioStations || "Rádios") + "</h3>\n          <p class=\"gmmp-radio-status\"></p>\n        </div>\n        <div class=\"gmmp-radio-actions\">\n          <button type=\"button\" class=\"gmmp-radio-btn secondary\" data-action=\"discover\">" + (labels().radioAutoDiscover || "Busca Automática") + "</button>\n          <button type=\"button\" class=\"gmmp-radio-iconbtn\" data-action=\"close\" aria-label=\"" + (labels().close || "Fechar") + "\">\n            <i class=\"fas fa-times\"></i>\n          </button>\n        </div>\n      </div>\n      <form class=\"gmmp-radio-searchrow\">\n        <input class=\"gmmp-radio-input\" name=\"query\" placeholder=\"" + (labels().radioSearchPlaceholder || "Buscar estação, país ou estilo") + "\" autocomplete=\"off\" />\n        <button type=\"submit\" class=\"gmmp-radio-btn primary\">" + (labels().ara || "Buscar") + "</button>\n        <button type=\"button\" class=\"gmmp-radio-btn secondary\" data-action=\"reset\">" + (labels().radioResetSearch || "Voltar à Descoberta") + "</button>\n      </form>\n      <div class=\"gmmp-radio-hint\">" + (labels().radioSharedHint || "Estações salvas estão disponíveis para todos") + "</div>\n      <form class=\"gmmp-radio-addform\">\n        <input class=\"gmmp-radio-input\" name=\"name\" placeholder=\"" + (labels().radioNameOptional || "Nome da estação (opcional)") + "\" autocomplete=\"off\" />\n        <input class=\"gmmp-radio-input\" name=\"url\" placeholder=\"" + (labels().radioUrlPlaceholder || "https://exemplo.com/stream.mp3") + "\" autocomplete=\"off\" />\n        <input class=\"gmmp-radio-input\" name=\"homepage\" placeholder=\"" + (labels().radioHomepageOptional || "Página inicial (opcional)") + "\" autocomplete=\"off\" />\n        <button type=\"submit\" class=\"gmmp-radio-btn primary\">" + (labels().radioAddUrl || "Adicionar URL") + "</button>\n      </form>\n      <div class=\"gmmp-radio-results\"></div>\n    </div>\n  ";

  document.body.appendChild(root);

  modalState.root = root;
  modalState.results = root.querySelector(".gmmp-radio-results");
  modalState.status = root.querySelector(".gmmp-radio-status");
  modalState.searchInput = root.querySelector('.gmmp-radio-searchrow input[name="query"]');
  modalState.searchBtn = root.querySelector('.gmmp-radio-searchrow button[type="submit"]');
  modalState.discoverBtn = root.querySelector('[data-action="discover"]');
  modalState.addForm = root.querySelector(".gmmp-radio-addform");
  modalState.addBtn = root.querySelector('.gmmp-radio-addform button[type="submit"]');
  modalState.hint = root.querySelector(".gmmp-radio-hint");
  musicPlayerState.radioModal = root;
  updateHintText();

  root.querySelector(".gmmp-radio-backdrop").addEventListener("click", closeRadioModal);
  root.querySelector('[data-action="close"]').addEventListener("click", closeRadioModal);
  root.querySelector('[data-action="reset"]').addEventListenerfunction("click", () {
    clearSearchDebounce();
    modalState.lastSearchKey = "";
    if (modalState.searchInput) modalState.searchInput.value = "";
    loadDiscoverView();
  });
  modalState.discoverBtn.addEventListenerfunction("click", () {
    clearSearchDebounce();
    loadDiscoverView();
  });
  modalState.searchInput.addEventListenerfunction("input", () {
    scheduleSearch();
  });
  modalState.searchInput.addEventListenerfunction("compositionstart", () {
    modalState.isSearchComposing = true;
    clearSearchDebounce();
  });
  modalState.searchInput.addEventListenerfunction("compositionend", () {
    modalState.isSearchComposing = false;
    scheduleSearch();
  });
  modalState.results.addEventListener("scroll", maybeLoadMoreSearchResults, { passive: true });
  root.querySelector(".gmmp-radio-searchrow").addEventListenerfunction("submit", (event) {
    event.preventDefault();
    clearSearchDebounce();
    runSearch({ force: true });
  });
  modalState.addForm.addEventListener("submit", handleAddStation);

  document.addEventListenerfunction("keydown", (event) {
    if (event.key === "Escape" && modalState.root.classList.contains("visible")) {
      closeRadioModal();
    }
  });
}

export function showRadioModal() {
  ensureModal();
  modalState.root.classList.add("visible");
  modalState.searchInput.focus();
  loadDiscoverView();
}
