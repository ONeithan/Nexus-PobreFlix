const USER_SETTINGS_URL = "/Plugins/JMSFusion/UserSettings";
const SAVE_URL = "/Plugins/JMSFusion/UserSettings/Publish";
const SAVE_DEBOUNCE_MS = 500;

const EXPLICIT_KEYS = new Set([
  "jms:settingsTargetProfile",
  "settings.allowedTabs.v1",
  "lyricsMode",
  "lyricsOverwrite"
]);

const DENY_KEYS = new Set([
  "json-credentials",
  "api-key",
  "accessToken",
  "serverId",
  "userId",
  "deviceId",
  "sessionId",
  "jf_serverAddress",
  "jf_userId",
  "jf_api_deviceId",
  "persist_user_id",
  "persist_device_id",
  "persist_server_id",
  "serverAddress",
  "currentUserIsAdmin",
  "emby.device.id",
  "emby.session.id",
  "jellyfin_credentials",
  "emby_credentials"
]);

const DENY_PREFIXES = [
  "persist_",
  "jf:",
  "emby."
];

const managedKeys = new Set(EXPLICIT_KEYS);
const profile = detectProfile();

let forceGlobal = false;
let rev = 0;
let state = {};
let serverSnapshotEmpty = true;
let saveTimer = null;
let savePromise = null;
let suspendSync = false;
let bootstrappedLocal = false;
let snapshotLoaded = false;
let lastLifecycleFlushAt = 0;

const storage = window.localStorage;
const originalGetItem = storage.getItem.bind(storage);
const originalSetItem = storage.setItem.bind(storage);
const originalRemoveItem = storage.removeItem.bind(storage);
const originalClear = storage.clear.bind(storage);

function detectProfile() {
  try {
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
    const small = window.matchMedia?.("(max-width: 900px)")?.matches === true;
    const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return (coarse || (small && uaMobile)) ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

function isDeniedKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized) return true;
  if (DENY_KEYS.has(normalized)) return true;
  if (DENY_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
  if (/token|credential|session/i.test(normalized)) return true;
  return false;
}

function registerKeys(keys = []) {
  for (const key of keys) {
    const normalized = String(key || "").trim();
    if (!normalized || isDeniedKey(normalized)) continue;
    managedKeys.add(normalized);
    if (snapshotLoaded && !serverSnapshotEmpty && !Object.prototype.hasOwnProperty.call(state, normalized)) {
      suspendSync = true;
      try {
        originalRemoveItem(normalized);
      } finally {
        suspendSync = false;
      }
    }
  }
}

function shouldPersistKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized || isDeniedKey(normalized)) return false;
  return managedKeys.has(normalized);
}

function normalizeValueForStorage(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return String(value);
}

function normalizeSnapshot(source) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (isDeniedKey(key)) continue;
    const normalizedValue = normalizeValueForStorage(value);
    if (normalizedValue === null) continue;
    out[key] = normalizedValue;
  }
  return out;
}

function applySnapshotToStorage(snapshot) {
  registerKeys(Object.keys(snapshot || {}));
  suspendSync = true;
  try {
    for (const [key, value] of Object.entries(snapshot || {})) {
      if (!shouldPersistKey(key)) continue;
      originalSetItem(key, value);
    }
  } finally {
    suspendSync = false;
  }
}

function buildSnapshotFromStorage() {
  const out = {};
  for (const key of managedKeys) {
    if (!shouldPersistKey(key)) continue;
    const raw = originalGetItem(key);
    if (raw !== null) {
      out[key] = raw;
    }
  }
  return out;
}

async function persistSnapshot(snapshot, options = {}) {
  const payload = normalizeSnapshot(snapshot);
  state = payload;
  serverSnapshotEmpty = Object.keys(payload).length === 0;

  const requestInit = {
    keepalive: options?.keepalive === true,
    method: "POST",
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      global: payload,
      profile
    })
  };

  savePromise = fetch(`${SAVE_URL}?profile=${encodeURIComponent(profile)}&ts=${Date.now()}`, requestInit).then(async response => {
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `UserSettings publish HTTP ${response.status}`);
    }
    return response.json().catch(() => ({}));
  }).then(result => {
    rev = Number(result?.rev || rev || 0);
    bridge.bootstrapOverride = { forceGlobal, global: payload, rev, profile };
    return result;
  }).catch(error => {
    console.warn("[JMSFusion] Managed storage persist failed:", error);
    throw error;
  }).finally(() => {
    savePromise = null;
  });

  return savePromise;
}

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistSnapshot(buildSnapshotFromStorage());
  }, SAVE_DEBOUNCE_MS);
}

function flushPendingSnapshotOnPageLifecycle() {
  if (!snapshotLoaded) return;
  if (saveTimer == null && !savePromise) return;

  const now = Date.now();
  if ((now - lastLifecycleFlushAt) < 1000) return;
  lastLifecycleFlushAt = now;

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  void persistSnapshot(buildSnapshotFromStorage(), { keepalive: true });
}

function patchLocalStorage() {
  storage.setItem = function patchedSetItem(key, value) {
    const normalizedKey = String(key || "");
    const normalizedValue = String(value);
    originalSetItem(normalizedKey, normalizedValue);
    if (suspendSync) return;
    if (!shouldPersistKey(normalizedKey)) return;
    state[normalizedKey] = normalizedValue;
    schedulePersist();
  };

  storage.removeItem = function patchedRemoveItem(key) {
    const normalizedKey = String(key || "");
    originalRemoveItem(normalizedKey);
    if (suspendSync) return;
    if (!shouldPersistKey(normalizedKey)) return;
    delete state[normalizedKey];
    schedulePersist();
  };

  storage.clear = function patchedClear() {
    originalClear();
    if (suspendSync) return;
    let changed = false;
    for (const key of [...managedKeys]) {
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        delete state[key];
        changed = true;
      }
    }
    if (changed) schedulePersist();
  };
}

async function loadServerSnapshot() {
  try {
    const response = await fetch(`${USER_SETTINGS_URL}?profile=${encodeURIComponent(profile)}&ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`UserSettings HTTP ${response.status}`);
    }

    const payload = await response.json().catch(() => ({}));
    forceGlobal = payload?.forceGlobal === true;
    rev = Number(payload?.rev || 0);

    const snapshot = normalizeSnapshot(payload?.global || {});
    state = snapshot;
    serverSnapshotEmpty = Object.keys(snapshot).length === 0;
    applySnapshotToStorage(snapshot);
    bridge.bootstrapOverride = { forceGlobal, global: snapshot, rev, profile };
  } catch (error) {
    console.warn("[JMSFusion] Managed storage preload failed:", error);
    bridge.bootstrapOverride = { forceGlobal: false, global: {}, rev: 0, profile };
  } finally {
    snapshotLoaded = true;
  }
}

const bridge = {
  bootstrapOverride: { forceGlobal: false, global: {}, rev: 0, profile },
  registerKeys,
  maybeBootstrapFromLocal(snapshot) {
    if (!serverSnapshotEmpty || bootstrappedLocal) return;
    const normalized = normalizeSnapshot(snapshot);
    if (!Object.keys(normalized).length) return;
    bootstrappedLocal = true;
    registerKeys(Object.keys(normalized));
    state = normalized;
    schedulePersist();
  },
  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await persistSnapshot(buildSnapshotFromStorage());
  },
  get profile() {
    return profile;
  },
  get forceGlobal() {
    return forceGlobal;
  },
  get serverSnapshotEmpty() {
    return serverSnapshotEmpty;
  },
  get state() {
    return { ...state };
  }
};

window.__JMS_MANAGED_STORAGE__ = bridge;
patchLocalStorage();
window.addEventListener("pagehide", flushPendingSnapshotOnPageLifecycle, { capture: true });
window.addEventListener("beforeunload", flushPendingSnapshotOnPageLifecycle, { capture: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushPendingSnapshotOnPageLifecycle();
  }
});
loadServerSnapshot().catch(err => console.error("[JMSFusion] Preload snapshot initialization failed:", err));

// =========================================================================
// NEXUS POBREFLIX - INJEÇÃO GLOBAL E INCONDICIONAL DE ESTILIZAÇÃO E DESIGN SYSTEM
// =========================================================================
(function injectNexusSystem() {
  const styleId = "nexus-pobreflix-premium-system";
  if (document.getElementById(styleId)) return;

  const styleEl = document.createElement("style");
  styleEl.id = styleId;
  styleEl.textContent = `﻿/* 1. IMPORTS & FONTS
   - Override this to customise font of abyss for your setup. */

@import url('https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&display=swap');

/* 2. THEME VARIABLES
   — Override these to customise abyss for your setup. */

:root {
    /* Primary accent colour — used for highlights, active states, progress bars.
       Format: R, G, B (no rgb() wrapper) so opacity variants work cleanly.
       Substituído com o Roxo Nexus para manter o rebrand premium */
    --abyss-accent: 122, 92, 255;

    /* Corner rounding applied globally */
    --abyss-radius: 12px;

    /* Fixed defaults */

    /* Indicator pill background (episode count, etc.) */
    --abyss-indicator: 55, 55, 55;

    /* Backgorund for drawers and dialogs */
    --abyss-glass-tint: 42, 42, 42;

    /* Custom cubic-bezier */
    --abyss-ease: cubic-bezier(0.16, 1, 0.3, 1);
    --abyss-ease-snappy: cubic-bezier(0.4, 0.0, 0.2, 1);
}


/* 3. BASE / GLOBAL */

#reactRoot {
    scrollbar-gutter: stable;
}

body {
    font-family: "Google Sans", sans-serif;
    font-optical-sizing: auto;
    font-style: normal;
    font-variation-settings: "GRAD" 0;
    overscroll-behavior: none;
}


* {
    scrollbar-color: rgba(var(--abyss-accent), 0.8) #0000 !important;
}

::-webkit-scrollbar-track-piece {
    background-color: #0000;
}

::-webkit-scrollbar-corner {
    background-color: #0000;
}

::-webkit-scrollbar-thumb {
    background: rgba(var(--abyss-accent), 0.8) !important;
    border-radius: var(--abyss-radius);
}

fieldset {
    border: 1px solid rgba(40, 40, 40, 0.8);
    border-radius: 0.4em;
}

progress {
    border-radius: var(--abyss-radius);
    background: rgba(0, 0, 0, 0.5) !important;
    border: 1px solid rgba(var(--abyss-accent), 0.22);
}

progress::-webkit-progress-bar {
    border-radius: var(--abyss-radius);
    background: rgba(0, 0, 0, 0.5) !important;
    border: 0px solid rgba(var(--abyss-accent), 0.22);
}

progress::-moz-progress-bar {
    border-radius: var(--abyss-radius);
    background-color: rgba(var(--abyss-accent), 0.75);
}

progress::-webkit-progress-value {
    border-radius: var(--abyss-radius);
    background-color: rgba(var(--abyss-accent), 0.75);
}

.taskProgressOuter,
.taskProgressInner {
    border-radius: var(--abyss-radius) !important;
}

.taskProgressOuter {
    background: rgba(0, 0, 0, 0.5) !important;
    border: 1px solid rgba(var(--abyss-accent), 0.22);
}

.taskProgressInner,
#videoOsdPage .sliderMarker.watched {
    background: rgba(var(--abyss-accent), 1) !important;
}

#videoOsdPage .sliderMarker.unwatched {
    background: hsl(0deg 0% 30%) !important;
}

.mdl-slider-background-flex {
    background: hsl(0deg 0% 30%) !important;
}

#divRunningTasks span {
    color: rgba(var(--abyss-accent), 0.75) !important;
}

#scheduledTasksPage span {
    color: rgba(var(--abyss-accent), 0.75) !important;
}

/* Override browser default blue focus/selection colour */
::selection {
    background: rgba(var(--abyss-accent), 0.25);
    color: rgb(var(--abyss-accent));
}

::-moz-selection {
    background: rgba(var(--abyss-accent), 0.25);
    color: rgb(var(--abyss-accent));
}

:focus-visible {
    outline-color: rgba(var(--abyss-accent), 0.6) !important;
}

input:focus,
textarea:focus,
select:focus,
.emby-input:focus,
.emby-textarea:focus,
.emby-select:focus,
.emby-select-withcolor:focus,
.checkboxOutline:focus {
    border-color: rgba(var(--abyss-accent), 0.4) !important;
}

input[type="checkbox"]:checked,
input[type="radio"]:checked {
    accent-color: rgb(var(--abyss-accent));
}

/* Override Chromium/Electron blue accent globally */
* {
    accent-color: rgb(var(--abyss-accent));
}

/* 4. TYPOGRAPHY */


.pageTitle {
    margin-top: auto;
    margin-bottom: auto;
    font-size: x-large;
    opacity: 0.8;
    font-weight: 500;
    border-radius: 12px;
    padding: 0 12px;
}

.pageTitle.pageTitleWithLogo.pageTitleWithDefaultLogo {
    display: none !important;
}


#tvRecommendedPage .pageTitle,
#moviesPage .pageTitle,
#musicRecommendedPage .pageTitle,
#itemDetailPage .pageTitle {
    display: none !important;
}

#videoOsdPage .pageTitle {
    display: flex !important;
}

.sectionTitle {
    font-weight: 600;
}

.homeScreenSettingsContainer .sectionTitle,
#quickConnectPreferencesPage .sectionTitle,
.settingsContainer .sectionTitle {
    font-size: xx-large;
}

#favoritesTab .sectionTitle,
.homeSectionsContainer .sectionTitle {
    margin-left: .4em !important;
    margin-top: .2em !important;
    margin-bottom: .2em !important;
}

.sectionTitleTextButton>.material-icons {
    margin: 0;
}

.sectionTitleTextButton:not(.padded-left) {
    padding: 4px 12px 6px 6px !important;
    margin-left: -6px !important;
    border-radius: var(--abyss-radius);
}

.sectionTitleTextButton>.sectionTitle {
    margin-right: 16px;
}

.inputLabel,
.selectLabel,
.checkboxLabel {
    font-weight: 500;
}

.cardText {
    padding: .06em .5em 0 .06em;
    font-weight: 200;
    font-size: medium;
    opacity: 0.8;
}

.cardText-first {
    margin-top: 4px !important;
    font-weight: 600;
    font-size: larger !important;
    opacity: 1 !important;
}

.cardTextCentered,
.cardTextCentered>.textActionButton {
    text-align: left !important;
}

.itemName {
    margin: .5em 0 !important;
}

.starIcon {
    color: rgba(var(--abyss-accent), .8);
}

.dialog {
    font-weight: 500;
}

.formDialogHeaderTitle {
    font-weight: bold !important;
    margin-left: 0 !important;
}

#dialogToc {
    overflow: clip;
    display: flex;
    flex-direction: column;
}

#dialogToc .toc {
    overflow-y: scroll;
}

#dialogToc .toc li {
    margin-bottom: 12px;
}


/* 5. LAYOUT & STRUCTURE */



/* Main content */
.withSectionTabs .backdropImage {
    filter: blur(23px) saturate(120%) contrast(120%) brightness(25%);
}

body:has(#itemDetailPage) .backdropImage {
    filter: blur(23px) saturate(120%) contrast(120%) brightness(25%);
}

.backdropContainer {
    width: 100vw;
    height: 100vh;
    overflow: visible;
}

.backgroundContainer.withBackdrop {
    background-color: rgba(0, 0, 0, 0);
}



/* Navigation / drawer */
.editPageSidebar,
.mainDrawer {
    background-color: rgba(var(--abyss-glass-tint), 0.69);
    margin: 24px 0;
    border-radius: 32px;
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
    border: solid 1px rgba(245, 245, 247, 0.2) !important;
}

.mainDrawer.drawer-open {
    margin: 24px;
}

.sidebarHeader {
    margin: 0.9em 0 0.2em;
    letter-spacing: 0.02em;
    opacity: 0.5;
    font-weight: 600;
}

[dir=ltr] .sidebarHeader {
    padding-left: 0.8em;
}


.navMenuOptionText {
    margin-top: 0;
    font-weight: 500;
    font-size: large;
}

.navMenuOptionIcon,
.listItemIcon {
    background: #cccccf69;
    border-radius: 50px;
    padding: 10px;
}

[dir=ltr] .navMenuOptionIcon {
    margin-right: 0.75em;
}

[dir=ltr] .listItemIcon {
    background: #cccccf69 !important;
    border-radius: 50px !important;
    padding: 10px !important;
}

[dir=ltr] .navMenuOption {
    padding: 0.5em 0.9em !important;
    margin-bottom: 2px !important;
    border-radius: 12px !important;
}

.scrollContainer {
    padding: 36px 12px 0 12px;
}

/* Footer */
.appfooter {
    background: rgba(0, 0, 0, 0.9);
    margin: 24px;
    border-radius: 24px;
}

/* Backdrop / detail ribbon */
.itemBackdrop {
    height: 31vh !important;
    display: inherit;
}

.layout-desktop .detailRibbon {
    background: rgba(0, 0, 0, .2) !important;
    margin-top: 0;
    padding-top: .5em;
    padding-bottom: .5em;
}

.itemBackdrop::after {
    background: rgba(0, 0, 0, .5) !important;
}

/* Detail logo */
.detailLogo {
}


    /* =========================================
       IMPORTAÇÃO DE TIPOGRAFIA
       ========================================= */
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;700;900&display=swap');

    /* =========================================
       POBREFLIX - LOGIN SAGRADO (INTOCÁVEL E RESTAURADO)
       ========================================= */
    body:has(#loginPage:not(.hide)) { overflow: hidden !important; }
    body:has(#loginPage:not(.hide)) .backgroundContainer, 
    body:has(#loginPage:not(.hide)) .backdropContainer { background: transparent !important; filter: none !important; }
    body:has(#loginPage:not(.hide)) .skinHeader { display: none !important; }

    /* Blindagem absoluta baseada na classe dinâmica de logout */
    body.jms-logged-out { overflow: hidden !important; }
    body.jms-logged-out .backgroundContainer, 
    body.jms-logged-out .backdropContainer { background: transparent !important; filter: none !important; }
    body.jms-logged-out .skinHeader { display: none !important; }

    #loginPage:not(.hide), #loginPage:not(.hide) .padded-left.padded-right.padded-bottom-page,
    #loginPage:not(.hide) .readOnlyContent, #loginPage:not(.hide) form,
    #loginPage:not(.hide) .manualLoginForm, #loginPage:not(.hide) .visual-card {
        background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important;
    }

    #loginPage:not(.hide) {
        position: absolute !important; top: 50% !important; left: 50% !important;
        transform: translate(-50%, calc(-50% + 8vh)) !important;
        width: 90% !important; max-width: 360px !important;
    }

    #loginPage:not(.hide) .pageTitle { text-align: center !important; font-size: 24px !important; color: #fff !important; text-shadow: 0 0 15px rgba(122, 92, 255, 0.7) !important; }
    #loginPage:not(.hide) .emby-input { width: 100% !important; background: rgba(15, 15, 35, 0.6) !important; border: 1px solid rgba(122, 92, 255, 0.5) !important; border-radius: 12px !important; color: #fff !important; }
    #loginPage:not(.hide) button[type="submit"] { width: 100% !important; background: transparent !important; border: 2px solid #7a5cff !important; border-radius: 12px !important; color: #fff !important; font-weight: bold !important; text-transform: uppercase !important; margin-top: 15px !important; }

    /* =========================================
       CABECALHO E MARCA (LOGO POBREFLIX LOCAL DIRETA)
       ========================================= */
    /* Injeta a logo Nexus via background-image nos seletores de marca de forma proporcional */
    .headerLogo,
    .logoHeader,
    .headerLogoWithText {
        background-image: url('/Plugins/JMSFusion/assets/LogoPng') !important;
        background-size: contain !important;
        background-repeat: no-repeat !important;
        background-position: left center !important;
        display: inline-block !important;
        min-width: 140px !important;
        min-height: 24px !important;
        vertical-align: middle !important;
    }
    /* Oculta as tags img ou svg de logo para que não dupliquem ou causem sobreposição, sem dar display:none no link pai */
    .headerLogo img,
    .headerLogo svg,
    .logoHeader img,
    .logoHeader svg,
    .headerLogoWithText img,
    .headerLogoWithText svg {
        display: none !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        pointer-events: none !important;
    }

    /* =========================
       📱 LOGIN CENTRALIZADO NO MOBILE
       ========================= */
    @media (max-width: 768px) {
        #loginPage:not(.hide) { left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; }
    }
  `;
  document.head.appendChild(styleEl);

  // Observador de estado de login dinâmico — CORRIGIDO para evitar tempestade de callbacks
  // Problema anterior: setInterval(500ms) + MutationObserver(subtree+style) no documentElement
  // criava loop circular que travava a aba completamente.
  (function observeSessionState() {
    let _lastLoginVisible = null;

    function updateSessionClass() {
      if (!document.body) return;
      const loginPage = document.getElementById("loginPage");
      // Usa apenas classList — evita getComputedStyle que é extremamente cara num observer
      const isLoginVisible = loginPage
        && !loginPage.classList.contains("hide")
        && !loginPage.classList.contains("hidden");

      if (isLoginVisible === _lastLoginVisible) return; // sem mudança, não toca o DOM
      _lastLoginVisible = isLoginVisible;

      if (isLoginVisible) {
        document.body.classList.add("jms-logged-out");
      } else {
        document.body.classList.remove("jms-logged-out");
      }
    }

    updateSessionClass();

    // Observer CIRÚRGICO: só observa o loginPage (quando existir), apenas class
    function attachLoginObserver() {
      const loginPage = document.getElementById("loginPage");
      if (!loginPage) return;

      const obs = new MutationObserver(updateSessionClass);
      obs.observe(loginPage, {
        attributes: true,
        attributeFilter: ["class"]
        // SEM subtree, SEM style, SEM childList — mínimo necessário
      });
    }

    // Aguarda o loginPage aparecer no DOM para attachar o observer
    if (document.getElementById("loginPage")) {
      attachLoginObserver();
    } else {
      const bodyObs = new MutationObserver(function(_, obs) {
        if (document.getElementById("loginPage")) {
          obs.disconnect();
          attachLoginObserver();
          updateSessionClass();
        }
      });
      bodyObs.observe(document.body || document.documentElement, {
        childList: true,
        subtree: false // só filhos diretos do body
      });
    }

    // Eventos nativos leves para detectar transições de rota
    window.addEventListener("hashchange", updateSessionClass, { passive: true });
    window.addEventListener("pageshow", updateSessionClass, { passive: true });
  })();
})();

