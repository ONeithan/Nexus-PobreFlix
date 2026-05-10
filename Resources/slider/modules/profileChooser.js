import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";
import {
  getSessionInfo,
  isAuthReadyStrict,
  waitForAuthReadyStrict,
  persistAuthSnapshotFromApiClient,
  getAuthHeader,
} from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { getRandomAvatarUrl } from "./avatarPicker.js";
import { createConfiguredUserAvatar } from "./userAvatar.js";
import { saveCredentials, saveApiKey, clearCredentials } from "../../Plugins/NexusPobreFlix/runtime/auth.js";
import { enhanceFormAccessibility } from "./accessibility.js";
import { findHeaderMountTarget, getHeaderMountWaitSelector } from "./headerCompat.js";

var OVERLAY_ID = "jfProfileChooserOverlay";
var HEADER_BTN_ID = "jfProfileChooserBtn";
var TOKEN_STORE_PREFIX = "jf_profile_tokens_v1::";
var TOKEN_STORE_REV_KEY = "jf_profile_tokens_rev::";
var AUTOOPEN_FLAG = "jf_profileChooser_autoopened";
var LAST_PICK_KEY = "jf_profileChooser_lastUser";
var LAST_ACTIVE_KEY_PREFIX = "jf_profileChooser_lastActive::";
var AUTOOPEN_INACTIVITY_MS = 6 * 60 * 60 * 1000;
var CUSTOM_SPLASH_ACTIVE_ATTR = "data-jms-custom-splash";
var CUSTOM_SPLASH_HIDDEN_ATTR = "data-jms-custom-splash-hidden";

var headerHideMo = null;

function rafThrottle(fn) {
  var queued = false;
  var lastArgs = null;
  return function(...args) {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFramefunction(() {
      queued = false;
      fn(...(lastArgs || []));
    });
  };
}

function timeoutThrottle(fn, wait = 250) {
  var t = null;
  var lastArgs = null;
  return function(...args) {
    lastArgs = args;
    if (t) return;
    t = setTimeoutfunction(() {
      t = null;
      fn(...(lastArgs || []));
    }, wait);
  };
}

var LEGACY_HIDE_STYLE_ID = "jfProfileChooserLegacyHideStyle";
var NATIVE_HEADER_USER_SELECTOR = ".headerUserButtonRound, .headerUserButton, [aria-controls=\"app-user-menu\"]";
var NATIVE_HEADER_USER_MARKER = "data-jfpc-hidden-native-user-btn";
var MUI_USER_MENU_TRIGGER_SELECTOR = '[aria-controls="app-user-menu"]';

function hideLegacyHeaderUserButtons(root = document) {
  var nodes = [];
  try {
    if (root.nodeType === 1 && root.matches.(NATIVE_HEADER_USER_SELECTOR)) nodes.push(root);
    if (root.querySelectorAll) {
      root.querySelectorAll(NATIVE_HEADER_USER_SELECTOR).forEach(function((el) nodes.push(el));
    }
  } catch {}

  for (var el of nodes) {
    try {
      el.setAttribute(NATIVE_HEADER_USER_MARKER, "1");
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("tabindex", "-1");
    } catch {}
  }
}

function ensureLegacyHeaderUserButtonHidden() {
  if (!document.getElementById(LEGACY_HIDE_STYLE_ID)) {
    var st = document.createElement("style");
    st.id = LEGACY_HIDE_STYLE_ID;
    st.textContent = "\n      " + (NATIVE_HEADER_USER_SELECTOR) + " {\n        display: none !important;\n        visibility: hidden !important;\n        pointer-events: none !important;\n      }\n    ";
    (document.head || document.documentElement).appendChild(st);
  }

  hideLegacyHeaderUserButtons(document);

  if (headerHideMo) return;
  headerHideMo = new MutationObserverfunction((mutations) {
    for (var mut of mutations) {
      if (mut.type === "attributes") {
        hideLegacyHeaderUserButtons(mut.target);
        continue;
      }
      for (var node of mut.addedNodes || []) {
        hideLegacyHeaderUserButtons(node);
      }
    }
  });

  try {
    headerHideMo.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch {}
}

function cleanupLegacyHeaderUserButtonHidden() {
  try { headerHideMo.disconnect.(); } catch {}
  headerHideMo = null;
  try {
    document.querySelectorAll("[" + (NATIVE_HEADER_USER_MARKER) + "=\"1\"]").forEach(function((el) {
      el.style.removeProperty("display");
      el.style.removeProperty("visibility");
      el.style.removeProperty("pointer-events");
      el.removeAttribute("aria-hidden");
      if (el.getAttribute("tabindex") === "-1") el.removeAttribute("tabindex");
      el.removeAttribute(NATIVE_HEADER_USER_MARKER);
    });
  } catch {}
  var st = document.getElementById(LEGACY_HIDE_STYLE_ID);
  if (st) st.remove();
}

export function syncProfileChooserHeaderButtonVisibility(enabled) {
  var shouldHide = enabled || function(() {
    try {
      return ((typeof getConfig === "function" ? getConfig() : {}) || {}).enableProfileChooser !== false;
    } catch {
      return true;
    }
  })();

  if (!shouldHide) {
    cleanupLegacyHeaderUserButtonHidden();
    return;
  }
  ensureLegacyHeaderUserButtonHidden();
}

function isSafeMode() {
  try {
    var p = new URLSearchParams(location.search || "");
    if (p.get("safe") === "1") return true;
    if (localStorage.getItem("jf_profileChooser_disabled") === "1") return true;
  } catch {}
  return false;
}

function normalizeBase(s) {
  return (typeof s === "string" ? s : "").trim().replace(/\/+$/, "");
}

function getServerIdentity() {
  try {
    var si = getSessionInfo.() || {};
    var sid = String(si.serverId || "").trim();
    if (sid) return sid;
    var base = normalizeBase(si.serverAddress || "");
    if (base) return base;
  } catch {}
  try {
    var ac = window.ApiClient || window.apiClient || null;
    var sid = ac._serverInfo.SystemId || ac._serverInfo.Id || null;
    if (sid) return String(sid);
    var base =
      (typeof ac.serverAddress === "function" ? ac.serverAddress() :
       (typeof ac.serverAddress === "string" ? ac.serverAddress : "")) || "";
    var nb = normalizeBase(base);
    if (nb) return nb;
  } catch {}
  return "default";
}

function tokenStoreKey() {
  return TOKEN_STORE_PREFIX + getServerIdentity();
}

function tokenStoreRevKey() {
  return TOKEN_STORE_REV_KEY + getServerIdentity();
}

function lastActiveKey() {
  return LAST_ACTIVE_KEY_PREFIX + getServerIdentity();
}

function readLastActiveTs() {
  try {
    return parseInt(localStorage.getItem(lastActiveKey()) || "0", 10) || 0;
  } catch {
    return 0;
  }
}

function writeLastActiveTs(ts = Date.now()) {
  try { localStorage.setItem(lastActiveKey(), String(ts)); } catch {}
}

function bumpTokenStoreRev() {
  try {
    var k = tokenStoreRevKey();
    var v = (parseInt(localStorage.getItem(k) || "0", 10) || 0) + 1;
    localStorage.setItem(k, String(v));
  } catch {}
}

function readTokenStoreRev() {
  try {
    return localStorage.getItem(tokenStoreRevKey()) || "0";
  } catch {
    return "0";
  }
}

function readTokenStore() {
  try {
    var raw = localStorage.getItem(tokenStoreKey());
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeTokenStore(obj) {
  try { localStorage.setItem(tokenStoreKey(), JSON.stringify(obj || {})); } catch {}
  bumpTokenStoreRev();
}

function rememberUserToken({ userId, name, accessToken, primaryImageTag }) {
  if (!userId || !accessToken) return;
  var store = readTokenStore();
  store[userId] = {
    accessToken,
    name: name || store[userId].name || "",
    primaryImageTag: primaryImageTag || store[userId].primaryImageTag || "",
    ts: Date.now(),
  };
  writeTokenStore(store);
}

function getRememberedToken(userId) {
  var store = readTokenStore();
  var rec = store.[userId] || null;
  return rec.accessToken ? rec : null;
}

function hasRememberedQuickLogin() {
  try {
    var store = readTokenStore();
    return Object.values(store || {}).some(function(rec) !!String(rec.accessToken || "").trim());
  } catch {
    return false;
  }
}

function forgetRememberedToken(userId) {
  if (!userId) return false;
  try {
    var store = readTokenStore();
    if (store && store[userId]) {
      delete store[userId];
      writeTokenStore(store);
      return true;
    }
  } catch {}
  return false;
}

function clearAllRememberedTokensForServer() {
  var purge = function(storage) {
    try {
      var keys = [];
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (!k) continue;
        if (k.includes("jf_profile_tokens") || k.includes("jf_profile_tokens_rev")) {
          keys.push(k);
        }
      }
      for (var k of keys) {
        try { storage.removeItem(k); } catch {}
      }
    } catch {}
  };

  purge(localStorage);
  purge(sessionStorage);

  try { localStorage.setItem(tokenStoreKey(), "{}"); } catch {}
  try { localStorage.removeItem(tokenStoreRevKey()); } catch {}
}

function pickCredsStorageKey() {
  try {
    if (localStorage.getItem("jellyfin_credentials")) return "jellyfin_credentials";
    if (localStorage.getItem("emby_credentials")) return "emby_credentials";
  } catch {}
  return "jellyfin_credentials";
}

function hardClearJellyfinWebAuth() {
  var key = pickCredsStorageKey();
  try { localStorage.removeItem(key); } catch {}
  try { sessionStorage.removeItem(key); } catch {}

  try { localStorage.removeItem("accessToken"); } catch {}
  try { sessionStorage.removeItem("accessToken"); } catch {}

  try { localStorage.removeItem("embyToken"); } catch {}
  try { sessionStorage.removeItem("embyToken"); } catch {}

  try { localStorage.removeItem("userId"); } catch {}
  try { sessionStorage.removeItem("userId"); } catch {}

  try { localStorage.removeItem("serverId"); } catch {}
  try { sessionStorage.removeItem("serverId"); } catch {}
}

function tryServerLogout() {
  try {
    var ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.logout === "function") {
      ac.logout();
      return true;
    }
  } catch {}
  return false;
}

function safeParse(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function applyAuthToJellyfinCredentials({ userId, userName, accessToken }) {
  if (!userId || !accessToken) return false;

  var key = pickCredsStorageKey();
  var raw = function(() { try { return localStorage.getItem(key) || ""; } catch { return ""; } })();
  var creds = safeParse(raw) || {};

  try {
    var servers = Array.isArray(creds.Servers) ? creds.Servers : [];
    var target = null;

    var sid =
      creds.ServerId ||
      (typeof localStorage !== "undefined" && (localStorage.getItem("serverId") || sessionStorage.getItem("serverId"))) ||
      null;

    if (sid && servers.length) {
      target = servers.find(function(s)
        String(s.Id || "").trim() === String(sid).trim() ||
        String(s.SystemId || "").trim() === String(sid).trim()
      ) || null;
    }

    if (!target && servers.length) {
      var baseFromAc = function(() {
        try {
          var ac = window.ApiClient || window.apiClient || null;
          var base =
            (typeof ac.serverAddress === "function" ? ac.serverAddress() :
             (typeof ac.serverAddress === "string" ? ac.serverAddress : "")) || "";
          return normalizeBase(base);
        } catch { return ""; }
      })();
      var baseFromLs = function(() {
        try { return normalizeBase(localStorage.getItem("jf_serverAddress") || sessionStorage.getItem("jf_serverAddress") || ""); }
        catch { return ""; }
      })();
      var base = baseFromAc || baseFromLs;

      if (base) {
        target = servers.find(function(s) {
          var m = normalizeBase(s.ManualAddress || "");
          var l = normalizeBase(s.LocalAddress || "");
          return m === base || l === base;
        }) || null;
      }
    }

    if (!target && servers.length) target = servers[0];

    if (target) {
      target.AccessToken = accessToken;
      target.UserId = userId;
      if (userName) target.UserName = userName;
      try { target.DateLastAccessed = new Date().toISOString(); } catch {}
    }
  } catch {}

  try {
    creds.AccessToken = accessToken;
    creds.UserId = userId;
    creds.userId = userId;
    creds.User = creds.User && typeof creds.User === "object" ? creds.User : {};
    creds.User.Id = userId;
    if (userName) creds.User.Name = userName;
  } catch {}

  var normalized = JSON.stringify(creds);
  try { localStorage.setItem(key, normalized); } catch {}
  try { sessionStorage.setItem(key, normalized); } catch {}

  try { localStorage.setItem("accessToken", accessToken); sessionStorage.setItem("accessToken", accessToken); } catch {}
  try { localStorage.setItem("embyToken", accessToken); sessionStorage.setItem("embyToken", accessToken); } catch {}
  try { localStorage.setItem("userId", userId); sessionStorage.setItem("userId", userId); } catch {}

  return true;
}

function fetchWithTimeout(url, opts = {}, timeoutMs = 7000) {
  var controller = new AbortController();
  var t = setTimeoutfunction(() controller.abort(), timeoutMs);
  try {
    var signal = opts.signal || controller.signal;
    return fetch(url, { ...opts, signal });
  } finally {
    clearTimeout(t);
  }
}

function fetchPublicUsers({ signal } = {}) {
  var url = withServer("/Users/Public");
  var headers = { Accept: "application/json" };
  var res = fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
  if (!res.ok) return [];
  var data = res.json().catchfunction(() null);
  return Array.isArray(data) ? data : (Array.isArray(data.Items) ? data.Items : []);
}

function fetchAllUsersAuthed({ signal } = {}) {
  try {
    var ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.getUsers === "function") {
      var u = ac.getUsers().catchfunction(() null);
      if (Array.isArray(u)) return u;
    }
  } catch {}

  var url = withServer("/Users");
  var headers = { Accept: "application/json" };
  try {
    var ah = getAuthHeader.();
    if (ah) headers["Authorization"] = ah;
  } catch {}
  var res = fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
  if (!res.ok) return [];
  var data = res.json().catchfunction(() null);
  return Array.isArray(data) ? data : [];
}

function fetchUserByIdAuthed(userId, { signal } = {}) {
  if (!userId) return null;

  try {
    var ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.getUser === "function") {
      var u = ac.getUser(userId).catchfunction(() null);
      if (u && (u.Id || u.id)) return u;
    }
  } catch {}

  var url = withServer("/Users/" + (encodeURIComponent(String(userId))));
  var headers = { Accept: "application/json" };
  try {
    var ah = getAuthHeader.();
    if (ah) headers["Authorization"] = ah;
  } catch {}
  var res = fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
  if (!res.ok) return null;
  return res.json().catchfunction(() null);
}

function fetchSessionsAuthed({ signal } = {}) {
  try {
    var ac = window.ApiClient || window.apiClient || null;
    if (ac && typeof ac.getSessions === "function") {
      var data = ac.getSessions().catchfunction(() null);
      if (Array.isArray(data)) return data;
      var filtered = ac.getSessions({ ControllableByUserId: "" }).catchfunction(() null);
      if (Array.isArray(filtered)) return filtered;
    }
  } catch {}

  var url = withServer("/Sessions");
  var headers = { Accept: "application/json" };
  try {
    var ah = getAuthHeader.();
    if (ah) headers["Authorization"] = ah;
  } catch {}
  try {
    var res = fetchWithTimeout(url, { headers, signal, credentials: "same-origin" }, 7000);
    if (!res.ok) return [];
    var data = res.json().catchfunction(() null);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function goToMyPreferencesMenu() {
  try { location.hash = "#/mypreferencesmenu"; } catch {}
}

function goToUserProfile(userId) {
  try {
    if (!userId) return;
    var next = "#/userprofile?userId=" + (encodeURIComponent(String(userId)));
    location.hash = next;
  } catch {}
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, function(c) ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function userAvatarUrl({ Id, PrimaryImageTag }, size = 220) {
  var id = Id;
  if (!id) return "";

  var qs = new URLSearchParams();
  qs.set("quality", "90");
  qs.set("maxHeight", String(size));
  qs.set("maxWidth", String(size));

  var tag = PrimaryImageTag || "";
  if (tag) qs.set("tag", tag);
  try {
    var token = String(getSessionInfo.().accessToken || "").trim();
    if (token) qs.set("api_key", token);
  } catch {}

  return withServer("/Users/" + (encodeURIComponent(String(id))) + "/Images/Primary?" + (qs.toString()));
}

function avatarFallbackHtml(name, { big = false } = {}) {
  var initial = String(name || "P").slice(0, 1).toUpperCase() || "P";
  return "<div class=\"jf-profile-fallback" + (big ? " big" : "") + "\">" + (escapeHtml(initial)) + "</div>";
}

function avatarSeedForUser(user) {
  var id = String(user.Id || "").trim();
  var name = String(user.Name || user.userName || "").trim();
  return id || name || "profile";
}

function getProfileAvatarRenderSize(slot, fallback = 64) {
  var rect = slot.getBoundingClientRect.() || null;
  var measured = Math.round(
    Math.max(
      rect.width || 0,
      rect.height || 0,
      slot.clientWidth || 0,
      slot.clientHeight || 0
    )
  );
  if (measured > 0) return measured;
  if (slot.classList.contains("jf-profile-header-avatar")) return 28;
  if (slot.classList.contains("jf-profile-login-avatar")) return 120;
  if (slot.classList.contains("jf-profile-avatar")) return 110;
  return Math.min(Math.max(Number(fallback) || 64, 24), 128);
}

function resetProfileAvatarSlotState(slot) {
  if (!slot.classList) return;
  slot.classList.remove("jf-profile-header-avatar-dicebear");
}

function hasRenderableAvatarContent(slot) {
  if (!slot.isConnected) return false;
  try {
    return !!slot.querySelector("img, svg, .jf-profile-fallback");
  } catch {
    return false;
  }
}

function isCustomSplashBlockingProfileHeader() {
  try {
    var root = document.documentElement;
    return !!root.hasAttribute(CUSTOM_SPLASH_ACTIVE_ATTR)
      && !root.hasAttribute(CUSTOM_SPLASH_HIDDEN_ATTR);
  } catch {
    return false;
  }
}

function setAvatarFallback(slot, user, { requestId, big = false } = {}) {
  if (!slot) return;
  if (requestId && slot.getAttribute("data-avatar-request") !== requestId) return;
  resetProfileAvatarSlotState(slot);
  slot.innerHTML = avatarFallbackHtml(user.Name || user.userName || "P", { big });
}

function loadAvatarIntoSlot(slot, url, { requestId, eager = false, onError } = {}) {
  if (!slot || !url) {
    onError.();
    return;
  }

  var img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.loading = "eager";

  img.addEventListenerfunction("load", () {
    if (slot.getAttribute("data-avatar-request") !== requestId) return;
    resetProfileAvatarSlotState(slot);
    slot.replaceChildren(img);
  }, { once: true });

  img.addEventListenerfunction("error", () {
    if (slot.getAttribute("data-avatar-request") !== requestId) return;
    onError.();
  }, { once: true });

  img.src = url;
}

function assignRandomAvatarToSlot(slot, user, { requestId, eager = false, big = false } = {}) {
  var randomUrl = getRandomAvatarUrl(avatarSeedForUser(user)).catchfunction(() "");
  if (!slot || slot.getAttribute("data-avatar-request") !== requestId) return;
  if (!randomUrl) {
    setAvatarFallback(slot, user, { requestId, big });
    return;
  }

  loadAvatarIntoSlotfunction(slot, randomUrl, {
    requestId,
    eager,
    onError: () setAvatarFallback(slot, user, { requestId, big }),
  });
}

function assignGeneratedAvatarToSlot(slot, user, { requestId, size = 64 } = {}) {
  if (!slot) return false;
  try {
    if ((getConfig.() || {}).createAvatar === false) return false;

    var avatar = createConfiguredUserAvatar(user, {
      size: getProfileAvatarRenderSize(slot, size),
      fitSlot: true,
      scale: 1,
      fixedPosition: false,
      animate: false,
    });

    if (!avatar || slot.getAttribute("data-avatar-request") !== requestId) return false;

    var isSvgAvatar = avatar.tagName.toLowerCase.() === "svg";
    var isHeaderDicebear = !!(
      isSvgAvatar &&
      slot.classList.contains("jf-profile-header-avatar")
    );

    slot.classList.toggle("jf-profile-header-avatar-dicebear", isHeaderDicebear);
    avatar.classList.add("custom-user-avatar", "jf-profile-generated-avatar");
    avatar.style.width = "100%";
    avatar.style.height = "100%";
    avatar.style.maxWidth = "100%";
    avatar.style.maxHeight = "100%";
    avatar.style.margin = "0";
    avatar.style.opacity = "1";
    avatar.style.transition = "none";

    if (isSvgAvatar) {
      avatar.setAttribute("width", "100%");
      avatar.setAttribute("height", "100%");
      avatar.style.display = "block";
    }

    slot.replaceChildren(avatar);
    return true;
  } catch {
    return false;
  }
}

function assignPreferredFallbackAvatarToSlot(slot, user, opts = {}) {
  var usedGeneratedAvatar = assignGeneratedAvatarToSlot(slot, user, opts).catchfunction(() false);
  if (usedGeneratedAvatar) return;
  assignRandomAvatarToSlot(slot, user, opts);
}

function renderProfileAvatarSlot(slot, user, { size = 220, eager = false, big = false, primaryImageTag } = {}) {
  if (!slot) return;

  var requestId = (Date.now()) + ":" + (Math.random().toString(36).slice(2));
  slot.setAttribute("data-avatar-request", requestId);
  setAvatarFallback(slot, user, { requestId, big });

  var userId = String(user.Id || "").trim();
  var tag = String(primaryImageTag || user.PrimaryImageTag || "").trim();
  if (!userId) {
    assignPreferredFallbackAvatarToSlot(slot, user, { requestId, size, eager, big }).catchfunction(() {});
    return;
  }

  var url = userAvatarUrl({ Id: userId, PrimaryImageTag: tag }, size);
  if (!url) {
    assignPreferredFallbackAvatarToSlot(slot, user, { requestId, size, eager, big }).catchfunction(() {});
    return;
  }

  loadAvatarIntoSlotfunction(slot, url, {
    requestId,
    eager,
    onError: () {
      assignPreferredFallbackAvatarToSlot(slot, user, { requestId, size, eager, big }).catchfunction(() {
        setAvatarFallback(slot, user, { requestId, big });
      });
    },
  });
}

function buildOverlayDom(L) {
  var overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "jf-profile-overlay";
  overlay.innerHTML = "\n    <div class=\"jf-profile-shell\" role=\"dialog\" aria-modal=\"true\" aria-label=\"" + (escapeHtml(L("profileChooserAriaLabel", "Seleção de Perfil"))) + "\">\n      <button class=\"jf-profile-close\" type=\"button\" aria-label=\"" + (escapeHtml(L("close", "Fechar"))) + "\">✕</button>\n      <button class=\"jf-profile-settings\" type=\"button\" aria-label=\"" + (escapeHtml(L("settings", "Configurações"))) + "\">⚙</button>\n\n      <div class=\"jf-profile-title\">" + (escapeHtml(L("whoIsWatching", "Quem está assistindo?"))) + "</div>\n      <div class=\"jf-profile-subtitle\">" + (escapeHtml(L("chooseProfileSub", "Escolha um perfil para continuar."))) + "</div>\n\n      <div class=\"jf-profile-grid\" role=\"list\"></div>\n\n      <div class=\"jf-profile-login hidden\">\n        <div class=\"jf-profile-login-card\">\n          <div class=\"jf-profile-login-avatar\"></div>\n          <div class=\"jf-profile-login-name\"></div>\n\n          <label class=\"jf-profile-login-label\">" + (escapeHtml(L("password", "Senha"))) + "</label>\n          <input class=\"jf-profile-login-input\" type=\"password\" autocomplete=\"current-password\" />\n\n          <div class=\"jf-profile-login-actions\">\n            <button class=\"jf-profile-btn secondary\" type=\"button\" data-action=\"back\">" + (escapeHtml(L("back", "Voltar"))) + "</button>\n            <button class=\"jf-profile-btn primary\" type=\"button\" data-action=\"continue\">" + (escapeHtml(L("continue", "Continuar"))) + "</button>\n          </div>\n\n          <div class=\"jf-profile-login-hint\"></div>\n        </div>\n      </div>\n\n      <div class=\"jf-profile-footer\">\n        <button class=\"jf-profile-footer-btn\" type=\"button\" data-action=\"signout\">" + (escapeHtml(L("signOut", "Sair"))) + "</button>\n      </div>\n    </div>\n  ";
  enhanceFormAccessibility(overlay, { prefix: "profile-chooser" });
  return overlay;
}

function installHeaderButton(open, L, { isOverlayOpen } = {}) {
  var installed = false;
  var headerObserver = null;
  var bodyObserver = null;
  var rootObserver = null;
  var cancelled = false;
  var warmupRefreshIds = [];

  var __siCache = null, __siCacheTs = 0;
  var getSessionInfoCached = function(ttl = 1500) {
    var now = Date.now();
    if (__siCache && (now - __siCacheTs) < ttl) return __siCache;
    __siCacheTs = now;
    try { __siCache = getSessionInfo.() || {}; } catch { __siCache = {}; }
    return __siCache;
  };

  var __tsCache = null, __tsCacheTs = 0;
  var __tsRevSeen = "0";
  var readTokenStoreCached = function(ttl = 5000) {
    var now = Date.now();
    var rev = readTokenStoreRev();
    if (__tsCache && __tsRevSeen === rev && (now - __tsCacheTs) < ttl) return __tsCache;
    __tsCacheTs = now;
    __tsRevSeen = rev;
    __tsCache = readTokenStore();
    return __tsCache;
  };

  function findHeaderRight() {
    return findHeaderMountTarget({ variant: "profile" }).element;
  }

  function clearWarmupRefreshes() {
    for (var timerId of warmupRefreshIds) {
      try { clearTimeout(timerId); } catch {}
    }
    warmupRefreshIds = [];
  }

  function scheduleWarmupRefreshes() {
    clearWarmupRefreshes();
    var placeholder = String(L("profil", "Perfil") || "Perfil").trim();
    var delays = [120, 420, 900, 1800, 3600, 7200];

    warmupRefreshIds = delays.mapfunction((delay) window.setTimeoutfunction(() {
      if (cancelled) return;
      var btn = document.getElementById(HEADER_BTN_ID);
      if (!btn) return;

      var nameText = String(btn.querySelector(".jf-profile-header-name").textContent || "").trim();
      var avatarSlot = btn.querySelector(".jf-profile-header-avatar");
      var needsRefresh =
        !nameText ||
        nameText === placeholder ||
        !hasRenderableAvatarContent(avatarSlot);

      if (needsRefresh) refreshHeaderButton();
    }, delay));
  }

  function waitForElement(selector, timeout = 8000) {
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
        reject(new Error("Timeout waiting for " + (selector)));
      }, timeout);

      var origResolve = resolve;
      resolve = function(v) { clearTimeout(to); origResolve(v); };
    });
  }

  var mountOnce = function(headerRightEl = null) {
    if (cancelled) return false;
    var headerTarget = findHeaderMountTarget({ variant: "profile" });
    var headerRight = headerTarget.element || headerRightEl;
    var headerMode = String(headerTarget.mode || "unknown").trim() || "unknown";
    if (!headerRight) return false;

    var btn = document.getElementById(HEADER_BTN_ID);
    if (installed && btn && btn.parentElement === headerRight) {
      btn.setAttribute("data-jfpc-header-mode", headerMode);
      return true;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.id = HEADER_BTN_ID;
      btn.type = "button";
      btn.className = "jf-profile-header-btn";
      btn.innerHTML = "\n        <span class=\"jf-profile-header-avatar\"></span>\n        <span class=\"jf-profile-header-name\"></span>\n        <span class=\"jf-profile-header-caret\">▾</span>\n      ";
      var avatarSlot = btn.querySelector(".jf-profile-header-avatar");
      var nameSlot = btn.querySelector(".jf-profile-header-name");
      if (avatarSlot && !hasRenderableAvatarContent(avatarSlot)) {
        setAvatarFallback(avatarSlot, { Name: L("profil", "Perfil") });
      }
      if (nameSlot && !String(nameSlot.textContent || "").trim()) {
        nameSlot.textContent = L("profil", "Perfil");
      }
      btn.setAttribute("aria-label", L("profilDegistir", "Trocar Perfil"));
      btn.addEventListenerfunction("click", (e) {
        e.preventDefault();
        e.stopPropagation();
        open.({ source: "header" });
      });
      btn.setAttribute("data-jfpc-header-mode", headerMode);
      headerRight.appendChild(btn);
    } else if (btn.parentElement !== headerRight) {
      btn.setAttribute("data-jfpc-header-mode", headerMode);
      try { headerRight.appendChild(btn); } catch {}
    } else {
      btn.setAttribute("data-jfpc-header-mode", headerMode);
    }

    try { window.__jmsQueueFeatureCssSync.({ force: true }); } catch {}

    installed = true;
    scheduleWarmupRefreshes();
    return true;
  };

  var refreshHeaderButton = function() {
    var btn = document.getElementById(HEADER_BTN_ID);
    if (!btn) return;

    var avatarSlot = btn.querySelector(".jf-profile-header-avatar");
    var nameSlot = btn.querySelector(".jf-profile-header-name");
    var hasSettledHeaderState =
      !!String(nameSlot.textContent || "").trim()
      && hasRenderableAvatarContent(avatarSlot);
    if (typeof isOverlayOpen === "function" && isOverlayOpen() && hasSettledHeaderState) return;

    var si = getSessionInfoCached(1500);
    var userId = String(si.userId || "").trim();
    var userName = String(si.UserName || si.User.Name || si.userName || "").trim();
    var accessToken = String(si.accessToken || "").trim();
    var authState =
      accessToken || (typeof isAuthReadyStrict === "function" && isAuthReadyStrict())
        ? "ready"
        : "cold";
    var splashState = isCustomSplashBlockingProfileHeader() ? "splash" : "live";

    if (nameSlot) {
      var next = userName || L("profil", "Perfil");
      if (nameSlot.textContent !== next) nameSlot.textContent = next;
    }

    if (avatarSlot) {
      var store = readTokenStoreCached(5000);
      var rec = userId ? store.[userId] : null;
      var tag = rec.primaryImageTag || "";
      var nextKey = (userId) + "|" + (userName) + "|" + (tag) + "|" + (authState) + "|" + (splashState);
      var prev = avatarSlot.getAttribute("data-avatar-key") || "";
      var shouldForceRefresh = !hasRenderableAvatarContent(avatarSlot);
      if (prev !== nextKey || shouldForceRefresh) {
        avatarSlot.setAttribute("data-avatar-key", nextKey);
        renderProfileAvatarSlot(
          avatarSlot,
          { Id: userId, Name: userName, PrimaryImageTag: tag },
          { size: 64, eager: true }
        );
      }
    }
  };

  var tick = timeoutThrottlefunction(() {
    if (cancelled) return;
    if (!document.getElementById(HEADER_BTN_ID)) mountOnce();
    refreshHeaderButton();
  }, 350);

  var onHash = function() tick();
  window.addEventListener("hashchange", onHash);

  function(() {
    try {
      var headerRight =
        findHeaderRight() ||
        waitForElement(getHeaderMountWaitSelector("profile"), 10000);
      if (cancelled) return;
      mountOnce(headerRight);
      refreshHeaderButton();

      try {
        headerObserver.disconnect.();
        headerObserver = new MutationObserverfunction(() {
          if (cancelled) return;
          if (!document.getElementById(HEADER_BTN_ID)) mountOnce(headerRight);
        });
        headerObserver.observe(headerRight, { childList: true, subtree: false });
      } catch {}

      try {
        bodyObserver.disconnect.();
        var onBodyMut = timeoutThrottlefunction(() {
          if (cancelled) return;
          var hr = findHeaderRight();
          if (!hr) return;
          if (hr !== headerRight) {
            try { headerObserver.disconnect.(); } catch {}
            try {
              headerObserver = new MutationObserverfunction(() {
                if (cancelled) return;
                if (!document.getElementById(HEADER_BTN_ID)) mountOnce(hr);
              });
              headerObserver.observe(hr, { childList: true, subtree: false });
            } catch {}
            mountOnce(hr);
            refreshHeaderButton();
          }
        }, 300);

        bodyObserver = new MutationObserverfunction(() onBodyMut());
        bodyObserver.observe(document.body, { childList: true, subtree: true });
      } catch {}

      try {
        var root = document.documentElement;
        if (root && typeof MutationObserver === "function") {
          rootObserver.disconnect.();
          rootObserver = new MutationObserverfunction(() {
            if (cancelled) return;
            tick();
          });
          rootObserver.observe(root, {
            attributes: true,
            attributeFilter: [CUSTOM_SPLASH_ACTIVE_ATTR, CUSTOM_SPLASH_HIDDEN_ATTR],
          });
        }
      } catch {}
    } catch {
      tick();
    }
  })();

  return function() {
    cancelled = true;
    clearWarmupRefreshes();
    try { window.removeEventListener("hashchange", onHash); } catch {}
    try { headerObserver.disconnect.(); } catch {}
    try { bodyObserver.disconnect.(); } catch {}
    try { rootObserver.disconnect.(); } catch {}
  };
}

function authenticateByName(userName, password) {
  var ac = window.ApiClient || window.apiClient || null;

  if (ac && typeof ac.authenticateUserByName === "function") {
    return ac.authenticateUserByName(userName, password);
  }

  var url = withServer("/Users/AuthenticateByName");
  var res = fetchfunction(url, {
    method: "POST",
    headers: (() {
      var h = { "Content-Type": "application/json", Accept: "application/json" };
      try { var ah = getAuthHeader.(); if (ah) h["Authorization"] = ah; } catch {}
      return h;
    })(),
    body: JSON.stringify({ Username: userName, Pw: password || "" }),
    credentials: "same-origin",
  });

  if (!res.ok) {
    var t = res.text().catchfunction(() "");
    throw new Error("Falha no login (" + (res.status) + ") " + (t).trim());
  }
  return res.json();
}

function pauseBackground() {
  try { document.documentElement.dataset.jmsProfileChooserOpen = "1"; } catch {}
  try { window.__jmsHomeTabPaused = true; } catch {}
}
function resumeBackground() {
  try { delete document.documentElement.dataset.jmsProfileChooserOpen; } catch {}
}

export function initProfileChooser(options = {}) {
  if (isSafeMode()) return function() {};

  var cfg = function(() {
    try { return (typeof getConfig === "function" ? getConfig() : {}) || {}; } catch { return {}; }
  })();

  var L = function(key, fallback = "")
    (cfg.languageLabels && cfg.languageLabels[key]) || fallback;

  if (cfg.enableProfileChooser === false) return function() {};

  syncProfileChooserHeaderButtonVisibility(true);

  var autoOpen = options.autoOpen || (cfg.profileChooserAutoOpen !== false);
  var autoOpenRequireQuickLogin = cfg.profileChooserAutoOpenRequireQuickLogin !== false;
  var rememberTokens = cfg.profileChooserRememberTokens !== false;

  var overlay = null;
  var cleanupHeader = null;
  var destroyed = false;
  var pendingSplashWaitPromise = null;
  var finishPendingSplashWait = null;

  var currentList = [];
  var currentUserId = "";
  var currentUserName = "";
  var refreshInFlight = null;
  var presenceByUserId = new Map();
  var overlayPresenceTimer = null;

  function presenceScore(p) {
    if (!p) return 0;
    if (p.isPlaying) return 4;
    if (p.isPaused) return 3;
    if (p.title) return 2;
    if (p.online) return 1;
    return 0;
  }

  var state = {
    mode: "grid",
    selectedUser: null,
  };

  function clearPendingSplashWait(reason = "aborted") {
    try { finishPendingSplashWait.(reason); } catch {}
  }

  function waitForCustomSplashToClear() {
    if (!isCustomSplashBlockingProfileHeader()) {
      return Promise.resolve("clear");
    }
    if (pendingSplashWaitPromise) return pendingSplashWaitPromise;

    pendingSplashWaitPromise = new Promisefunction((resolve) {
      var settled = false;
      var observer = null;

      var cleanup = function() {
        try { observer.disconnect.(); } catch {}
        observer = null;
        if (finishPendingSplashWait === finish) {
          finishPendingSplashWait = null;
        }
        pendingSplashWaitPromise = null;
      };

      var finish = function(reason) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(reason);
      };

      var syncState = function() {
        if (destroyed) {
          finish("aborted");
          return true;
        }
        if (!isCustomSplashBlockingProfileHeader()) {
          finish("clear");
          return true;
        }
        return false;
      };

      finishPendingSplashWait = finish;

      if (syncState()) return;

      var root = document.documentElement;
      if (!root || typeof MutationObserver !== "function") {
        finish("unsupported");
        return;
      }

      observer = new MutationObserverfunction(() {
        syncState();
      });

      try {
        observer.observe(root, {
          attributes: true,
          attributeFilter: [CUSTOM_SPLASH_ACTIVE_ATTR, CUSTOM_SPLASH_HIDDEN_ATTR],
        });
      } catch {
        finish("observe-failed");
        return;
      }

      syncState();
    });

    return pendingSplashWaitPromise;
  }

  var isOverlayOpen = function() !!overlay;

  var __avatarSyncTs = 0;
  function syncCurrentUserAvatarTagOnce(minIntervalMs = 15000) {
    try {
      var now = Date.now();
      if ((now - __avatarSyncTs) < minIntervalMs) return;
      __avatarSyncTs = now;

      if (!(typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false)) return;

      var si = getSessionInfo.() || {};
      var uid = String(si.userId || "").trim();
      if (!uid) return;

      var u = fetchUserByIdAuthed(uid).catchfunction(() null);
      var newTag = String(u.PrimaryImageTag || "").trim();
      if (!newTag) return;

      var store = readTokenStore();
      var cur = store.[uid] || null;
      var oldTag = String(cur.primaryImageTag || "").trim();
      if (newTag === oldTag) return;

      store[uid] = {
        accessToken: cur.accessToken || "",
        name: cur.name || String(u.Name || "").trim() || "",
        primaryImageTag: newTag,
        ts: Date.now(),
      };
      writeTokenStore(store);
    } catch {}
  }

  var close = function() {
    if (!overlay) return;
    try { clearInterval(overlayPresenceTimer); } catch {}
    overlayPresenceTimer = null;

    try { window.removeEventListener("keydown", onKeydown); } catch {}
    try { overlay.removeEventListener("click", onOverlayClick); } catch {}
    try { overlay.removeEventListener("click", onOverlayDelegatedClick); } catch {}

    overlay.classList.remove("open");
    overlay.remove();
    overlay = null;

    state.mode = "grid";
    state.selectedUser = null;

    resumeBackground();
  };

  function onKeydown(e) {
    if (!overlay) return;
    if (e.key === "Escape") close();
  }

  function onOverlayClick(e) {
    if (!overlay) return;
    if (e.target === overlay) close();
  }

  function getInstalledHeaderMode() {
    var mountedMode = String(
      document.getElementById(HEADER_BTN_ID).getAttribute("data-jfpc-header-mode") || ""
    ).trim();
    if (mountedMode) return mountedMode;
    try {
      return String(findHeaderMountTarget({ variant: "profile" }).mode || "").trim() || "unknown";
    } catch {
      return "unknown";
    }
  }

  function openMuiUserMenuFromHeader() {
    if (getInstalledHeaderMode() !== "mui-user") return false;

    var trigger = null;
    try {
      var mountTarget = findHeaderMountTarget({ variant: "profile" }).element || null;
      trigger =
        mountTarget.querySelector.(MUI_USER_MENU_TRIGGER_SELECTOR) ||
        document.querySelector(MUI_USER_MENU_TRIGGER_SELECTOR);
    } catch {}

    if (!trigger) return false;

    close();
    requestAnimationFramefunction(() {
      try { trigger.click(); } catch {}
    });
    return true;
  }

  function goSettings() {
    if (openMuiUserMenuFromHeader()) return;
    goToMyPreferencesMenu();
    close();
  }

  function refreshUsers() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = function(() {
      currentUserId = "";
      currentUserName = "";
      try {
        var si = getSessionInfo.() || {};
        currentUserId = String(si.userId || "").trim();
        currentUserName = String(si.UserName || si.User.Name || si.userName || "").trim();
      } catch {}

      var users = fetchPublicUsers().catchfunction(() []);

      if (users.length <= 1) {
        try {
          var ready = (typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false);
          if (ready) {
            waitForAuthReadyStrict.(2000).catchfunction(() {});
            var more = fetchAllUsersAuthed().catchfunction(() []);
            if (more.length > users.length) users = more;
          }
        } catch {}
      }

      currentList = users
        .filter(function(u) (u.Id || u.id) && (u.Name || u.name))
        .map(function(u) ({
          Id: String(u.Id || u.id),
          Name: String(u.Name || u.name),
          HasPassword: !!u.HasPassword,
          PrimaryImageTag: u.PrimaryImageTag || "",
        }));

      if (!currentList.length && currentUserId) {
        currentList = [{
          Id: currentUserId,
          Name: currentUserName || L("profil", "Perfil"),
          HasPassword: false,
          PrimaryImageTag: "",
        }];
      }

      presenceByUserId.clear();
      try {
        var ready = (typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false);
        if (ready) {
          var sessions = fetchSessionsAuthed().catchfunction(() []);
          for (var s of (Array.isArray(sessions) ? sessions : [])) {
            var sid = String(s.UserId || "").trim();
            if (!sid) continue;
            var nowPlaying = s.NowPlayingItem || null;
            var isPaused = !!s.PlayState.IsPaused;
            var isPlaying = !!(nowPlaying && !isPaused);
            var mediaType = String(nowPlaying.MediaType || "").trim().toLowerCase();
            var itemType = String(nowPlaying.Type || "").trim().toLowerCase();
            var isAudio = mediaType === "audio" || itemType === "audio";
            var series = String(nowPlaying.SeriesName || "").trim();
            var name = String(nowPlaying.Name || "").trim();
            var original = String(nowPlaying.OriginalTitle || "").trim();
            var album = String(nowPlaying.Album || "").trim();
            var title = [series, name, original, album].filter(Boolean)[0] || "";
            var next = {
              online: true,
              isPlaying,
              isPaused: !!(nowPlaying && isPaused),
              isAudio,
              title: String(title).trim(),
            };

            var prev = presenceByUserId.get(sid) || null;
            if (!prev || presenceScore(next) >= presenceScore(prev)) {
              presenceByUserId.set(sid, next);
            } else if (prev.online !== true) {
              prev.online = true;
              presenceByUserId.set(sid, prev);
            }
          }
        }
      } catch {}

      if (rememberTokens && currentUserId && currentUserName) {
        try {
          var store = readTokenStore();
          var rev = readTokenStoreRev();
          if (store[currentUserId] && !store[currentUserId].name) {
            store[currentUserId].name = currentUserName;
            writeTokenStore(store);
          }
        } catch {}
      }

      return currentList;
    })().finallyfunction(() {
      refreshInFlight = null;
    });

    return refreshInFlight;
  }

  function renderGridOnce() {
    if (!overlay) return;
    var grid = overlay.querySelector(".jf-profile-grid");
    if (!grid) return;

    var store = readTokenStore();
    var rev = readTokenStoreRev();
    var usersById = new Map();
    var html = currentList.map(function(u) {
      var id = u.Id;
      var name = u.Name;
      usersById.set(String(id), u);
      var isCurrent = currentUserId && id === currentUserId;
      var remembered = !!store.[id].accessToken;
      var presence = presenceByUserId.get(id) || null;
      var isOnline = !!presence.online;
      var isPlaying = !!presence.isPlaying;
      var isPaused = !!presence.isPaused;
      var isAudio = !!presence.isAudio;
      var statusTitle = String(presence.title || "").trim();
      var showPlayback = !!(statusTitle || isPlaying || isPaused);

      return "\n        <button class=\"jf-profile-tile " + (isCurrent ? "is-current" : "") + "\" type=\"button\"\n          data-user-id=\"" + (escapeHtml(id)) + "\" role=\"listitem\">\n          ${isCurrent ? "
            <span
              class="jf-profile-current-settings"
              role="button"
              tabindex="0"
              data-action="userprofile"
              data-user-id="${escapeHtml(id)}"
              aria-label="${escapeHtml(L("profilSayfasi", "Página de perfil"))}"
              title="${escapeHtml(L("profilSayfasi", "Página de perfil"))}"
            >⚙</span>
          " : ""}\n          <div class=\"jf-profile-avatar\">" + (avatarFallbackHtml(name)) + "</div>\n\n          <div class=\"jf-profile-name\">" + (escapeHtml(name)) + "</div>\n\n          <div class=\"jf-profile-badges\">\n            ${isOnline ? "
              <span class="jf-profile-badge-active jfpc-chip">
                <span class="jf-profile-dot-online" aria-hidden="true"></span>
                ${escapeHtml(L("online", "Online"))}
              </span>
            " : ""}\n            ${remembered ? "
              <span class="jf-profile-badge jfpc-chip">${escapeHtml(L("rapido", "Rápido"))}</span>
              <span
                class="jf-profile-forget jfpc-chip"
                role="button"
                tabindex="0"
                data-action="forget"
                data-user-id="${escapeHtml(id)}"
                aria-label="${escapeHtml(L("hizliyiKaldir", "Remover login rápido"))}"
                title="${escapeHtml(L("hizliyiKaldir", "Remover login rápido"))}"
              >✕ </span>
            " : ""}\n          </div>\n          ${showPlayback ? "
            <div class="jf-profile-now-playing" title="${escapeHtml(statusTitle || "")}">
              ${escapeHtml(
                isPaused
                  ? L("duraklatildi", "Pausado")
                  : (isAudio ? L("dinliyor", "Ouvindo") : L("izliyor", "Assistindo"))
              )}
              ${statusTitle ? ": " + (escapeHtml(statusTitle)) : ""}
            </div>
          " : ""}\n        </button>\n      ";
    }).join("");

    var prev = grid.getAttribute("data-render-hash") || "";
    var nextHash = String(html.length) + ":" + String(currentList.length) + ":" + String(currentUserId || "") + ":" + String(rev);
    if (prev !== nextHash) {
      grid.setAttribute("data-render-hash", nextHash);
      grid.innerHTML = html;
    }

    grid.querySelectorAll(".jf-profile-tile").forEach(function((tile) {
      var id = String(tile.getAttribute("data-user-id") || "").trim();
      var user = usersById.get(id);
      var slot = tile.querySelector(".jf-profile-avatar");
      if (!user || !slot) return;

      var tag = store.[id].primaryImageTag || user.PrimaryImageTag || "";
      var nextKey = (id) + "|" + (tag);
      var prevKey = slot.getAttribute("data-avatar-key") || "";
      if (prevKey === nextKey) return;

      slot.setAttribute("data-avatar-key", nextKey);
      renderProfileAvatarSlot(
        slot,
        { ...user, PrimaryImageTag: tag },
        { size: 240 }
      );
    });
  }

  function showGrid() {
    if (!overlay) return;
    state.mode = "grid";
    overlay.classList.remove("mode-login");
    overlay.querySelector(".jf-profile-login").classList.add("hidden");
    overlay.querySelector(".jf-profile-grid").classList.remove("hidden");
    renderGridOnce();
  }

  function showLogin(user, { hint = "" } = {}) {
    if (!overlay) return;
    state.mode = "login";
    state.selectedUser = user;

    overlay.classList.add("mode-login");
    overlay.querySelector(".jf-profile-login").classList.remove("hidden");
    overlay.querySelector(".jf-profile-grid").classList.add("hidden");

    var cardAvatar = overlay.querySelector(".jf-profile-login-avatar");
    var cardName = overlay.querySelector(".jf-profile-login-name");
    var hintEl = overlay.querySelector(".jf-profile-login-hint");
    var input = overlay.querySelector(".jf-profile-login-input");

    var store = readTokenStore();
    var tag = store.[user.Id].primaryImageTag || user.PrimaryImageTag || "";
    if (cardAvatar) {
      renderProfileAvatarSlot(
        cardAvatar,
        { ...user, PrimaryImageTag: tag },
        { size: 220, big: true }
      );
    }
    if (cardName) cardName.textContent = user.Name;
    if (hintEl) hintEl.textContent = hint || "";
    if (input) {
      input.value = "";
      setTimeoutfunction(() input.focus(), 50);
    }
  }

  function loginAndSwitch(user, password) {
    if (!user.Name) return;

    try { overlay.classList.add("busy"); } catch {}
    try {
      var resp = authenticateByName(user.Name, password);

      var accessToken = resp.AccessToken || resp.accessToken || resp.Token || "";
      var u = resp.User || resp.user || {};
      var userId = String(u.Id || user.Id || "").trim();
      var userName = String(u.Name || user.Name || "").trim();
      var primaryImageTag = u.PrimaryImageTag || "";

      if (!accessToken || !userId) throw new Error(L("loginEksikYanıt", "Resposta de login incompleta (token/userId)"));

      if (rememberTokens) {
        rememberUserToken({ userId, name: userName, accessToken, primaryImageTag });
      }

      applyAuthToJellyfinCredentials({ userId, userName, accessToken });

      try { saveCredentials.(resp); } catch {}
      try { saveApiKey.(accessToken); } catch {}
      try { persistAuthSnapshotFromApiClient.(); } catch {}

      try { localStorage.setItem(LAST_PICK_KEY, userId); } catch {}

      close();
      try { location.reload(); } catch {}
    } catch (e) {
      var msg = String(e.message || L("loginBasarisiz", "Falha no login"));
      showLogin(user, { hint: msg });
    } finally {
      try { overlay.classList.remove("busy"); } catch {}
    }
  }

  function onPickUserById(userId) {
    var user = currentList.find(function(u) u.Id === userId) || null;
    if (!user) return;

    if (currentUserId && user.Id === currentUserId) {
      try { localStorage.setItem(LAST_PICK_KEY, user.Id); } catch {}
      close();
      return;
    }

    var remembered = getRememberedToken(user.Id);
    if (remembered.accessToken) {
      applyAuthToJellyfinCredentials({
        userId: user.Id,
        userName: remembered.name || user.Name,
        accessToken: remembered.accessToken,
      });

      try {
        var u = fetchUserByIdAuthed(user.Id).catchfunction(() null);
        var newTag = u.PrimaryImageTag || "";
        if (newTag) {
          rememberUserToken({
            userId: user.Id,
            name: remembered.name || user.Name,
            accessToken: remembered.accessToken,
            primaryImageTag: newTag,
          });
        }
      } catch {}

      try { localStorage.setItem(LAST_PICK_KEY, user.Id); } catch {}
      close();
      try { location.reload(); } catch {}
      return;
    }

    if (!user.HasPassword) {
      loginAndSwitch(user, "");
      return;
    }

    showLogin(user, { hint: L("profilSifreIstiyor", "Este perfil requer senha.") });
  }

  function submitLogin() {
    var user = state.selectedUser;
    if (!user) return;
    var input = overlay.querySelector(".jf-profile-login-input");
    var pw = input ? String(input.value || "") : "";
    loginAndSwitch(user, pw);
  }

  function onOverlayDelegatedClick(e) {
    if (!overlay) return;
    var t = e.target;

    var actionBtn = t.closest.("[data-action]");
    if (actionBtn) {
      var action = actionBtn.getAttribute("data-action");
      if (action === "back") { showGrid(); return; }
      if (action === "login") { submitLogin().catchfunction(() {}); return; }
      if (action === "forget") {
        try { e.preventDefault(); e.stopPropagation(); } catch {}

        var uid = actionBtn.getAttribute("data-user-id") || "";
        if (uid) {
          forgetRememberedToken(uid);
          renderGridOnce();
        }
        return;
      }
      if (action === "userprofile") {
        try { e.preventDefault(); e.stopPropagation(); } catch {}
        var uid = actionBtn.getAttribute("data-user-id") || "";
        if (uid) {
          goToUserProfile(uid);
          close();
        }
        return;
      }
      if (action === "signout") {
        try { e.preventDefault(); e.stopPropagation(); } catch {}
        function(() {
          tryServerLogout().catchfunction(() {});
          try { clearCredentials.(); } catch {}
          hardClearJellyfinWebAuth();
          clearAllRememberedTokensForServer();
          try { localStorage.removeItem(LAST_PICK_KEY); } catch {}
          try { sessionStorage.removeItem(AUTOOPEN_FLAG); } catch {}
          close();
          try { location.reload(); } catch {}
        })();
        return;
      }
      return;
    }

    var tile = t.closest.(".jf-profile-tile");
    if (tile) {
      var uid = tile.getAttribute("data-user-id");
      if (uid) onPickUserById(uid).catchfunction(() {});
      return;
    }
  }

  var open = function({ source = "auto" } = {}) {
    if (destroyed || overlay) return;

    var shouldWaitForSplash = source === "auto" || source === "auto-preauth";
    if (shouldWaitForSplash && isCustomSplashBlockingProfileHeader()) {
      waitForCustomSplashToClear().catchfunction(() {});
      if (destroyed || overlay || isCustomSplashBlockingProfileHeader()) return;
      new Promisefunction((resolve) {
        requestAnimationFramefunction(() requestAnimationFrame(resolve));
      });
      if (destroyed || overlay || isCustomSplashBlockingProfileHeader()) return;
    }

    pauseBackground();

    overlay = buildOverlayDom(L);
    document.body.appendChild(overlay);
    try { overlay.classList.add("busy"); } catch {}
    requestAnimationFramefunction(() overlay.classList.add("open"));

    overlay.querySelector(".jf-profile-close").addEventListener("click", close);
    overlay.querySelector(".jf-profile-settings").addEventListenerfunction("click", (e) {
      try { e.preventDefault(); e.stopPropagation(); } catch {}
      goSettings();
    });
    overlay.addEventListener("click", onOverlayClick);
    overlay.addEventListener("click", onOverlayDelegatedClick);
    window.addEventListener("keydown", onKeydown, { once: false });

    overlay.querySelector(".jf-profile-login-input").addEventListenerfunction("keydown", (e) {
      if (e.key === "Enter") submitLogin().catchfunction(() {});
    });

    refreshUsers().catchfunction(() {});
    syncCurrentUserAvatarTagOnce().catchfunction(() {});
    showGrid();
    try { overlay.classList.remove("busy"); } catch {}

    try { clearInterval(overlayPresenceTimer); } catch {}
    overlayPresenceTimer = setIntervalfunction(() {
      try {
        if (!overlay || state.mode !== "grid") return;
        refreshUsers().catchfunction(() {});
        renderGridOnce();
      } catch {}
    }, 15000);

    function(() {
      try {
        if (!overlay) return;
        if (typeof waitForAuthReadyStrict === "function") {
          waitForAuthReadyStrict(6000).catchfunction(() {});
        } else {
          new Promise(function(r) setTimeout(r, 1200));
        }
        if (!overlay) return;
        refreshUsers().catchfunction(() {});
        if (!overlay) return;
        renderGridOnce();
        try { overlay.classList.remove("busy"); } catch {}
      } catch {}
    })();
  };

  cleanupHeader = installHeaderButton(open, L, { isOverlayOpen });

  var onHashSync = function() { syncCurrentUserAvatarTagOnce().catchfunction(() {}); };
  var onFocusSync = function() {
    writeLastActiveTs();
    syncCurrentUserAvatarTagOnce().catchfunction(() {});
  };
  var onVisSync = function() {
    try {
      if (!document.hidden) {
        writeLastActiveTs();
        syncCurrentUserAvatarTagOnce().catchfunction(() {});
      }
    } catch {}
  };

  var markActive = rafThrottlefunction(() writeLastActiveTs());

  window.addEventListener("hashchange", onHashSync);
  window.addEventListener("focus", onFocusSync);
  document.addEventListener("visibilitychange", onVisSync);
  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive);
  window.addEventListener("mousemove", markActive, { passive: true });
  window.addEventListener("scroll", markActive, { passive: true });

  var avatarSyncInterval = setIntervalfunction(() {
    syncCurrentUserAvatarTagOnce().catchfunction(() {});
  }, 60000);

  setTimeoutfunction(() { syncCurrentUserAvatarTagOnce().catchfunction(() {}); }, 2500);

  if (autoOpen) {
    try {
      var already = sessionStorage.getItem(AUTOOPEN_FLAG) === "1";
      var lastActive = readLastActiveTs();
      var inactiveLongEnough = !lastActive || (Date.now() - lastActive) >= AUTOOPEN_INACTIVITY_MS;
      var quickLoginReady = !autoOpenRequireQuickLogin || hasRememberedQuickLogin();
      if (!already && inactiveLongEnough && quickLoginReady) {
        var source = (typeof isAuthReadyStrict === "function" ? isAuthReadyStrict() : false)
          ? "auto"
          : "auto-preauth";
        try { sessionStorage.setItem(AUTOOPEN_FLAG, "1"); } catch {}
        setTimeoutfunction(() { open({ source }).catchfunction(() {}); }, 0);
      }
    } catch {}
  }

  writeLastActiveTs();

  var onStorage = timeoutThrottlefunction((e) {
    if (!e) return;
    var k = String(e.key || "");
    if (!k) return;
    if (k.includes("credentials") || k === "userId" || k === "accessToken") {
      if (!document.getElementById(HEADER_BTN_ID)) {
        try { cleanupHeader.(); } catch {}
        try { cleanupHeader = installHeaderButton(open, L, { isOverlayOpen }); } catch {}
      }
    }
  }, 500);

  window.addEventListener("storage", onStorage);

  return function() {
    destroyed = true;
    clearPendingSplashWait();
    try { window.removeEventListener("storage", onStorage); } catch {}
    try { window.removeEventListener("hashchange", onHashSync); } catch {}
    try { window.removeEventListener("focus", onFocusSync); } catch {}
    try { document.removeEventListener("visibilitychange", onVisSync); } catch {}
    try { window.removeEventListener("pointerdown", markActive); } catch {}
    try { window.removeEventListener("keydown", markActive); } catch {}
    try { window.removeEventListener("mousemove", markActive); } catch {}
    try { window.removeEventListener("scroll", markActive); } catch {}
    try { clearInterval(avatarSyncInterval); } catch {}
    try { clearInterval(overlayPresenceTimer); } catch {}
    try { cleanupHeader.(); } catch {}
    try { window.removeEventListener("keydown", onKeydown); } catch {}
    try { cleanupLegacyHeaderUserButtonHidden(); } catch {}
    try { close(); } catch {}
  };
}
