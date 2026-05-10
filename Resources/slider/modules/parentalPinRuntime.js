import { getConfig } from "./config.js";
import { getDefaultLanguage, getLanguageLabels } from "../language/index.js";
import {
  fetchCurrentUserParentalPinPolicy,
  getParentalPinErrorMessage,
  verifyParentalPin
} from "./parentalPinApi.js";
import {
  doesRatingRequirePin,
  formatResolvedRating,
  formatThresholdLabel
} from "./parentalPinShared.js";
import { showNotification } from "./player/ui/notification.js";

var STYLE_ID = "jms-parental-pin-style";
var NATIVE_PLAY_CONTEXT_TTL_MS = 20_000;
var NATIVE_PLAY_ACTIONS = new Set([
  "play",
  "resume",
  "playallfromhere"
]);
var NATIVE_PLAY_ICON_TEXTS = new Set([
  "play_arrow",
  "play_circle",
  "play_circle_filled",
  "play_circle_outline",
  "smart_display",
  "replay"
]);
var NATIVE_NON_PLAY_ACTIONS = new Set([
  "favorite",
  "favourite",
  "unfavorite",
  "unfavourite",
  "like",
  "rating",
  "rate",
  "userrating",
  "watchlist",
  "playlist",
  "queue",
  "download",
  "share",
  "markplayed",
  "markunplayed",
  "watched",
  "unwatched"
]);
var NATIVE_NON_PLAY_ICON_TEXTS = new Set([
  "favorite",
  "favorite_border",
  "favorite_outline",
  "heart_plus",
  "heart_minus",
  "heart_check",
  "star",
  "star_border",
  "star_outline",
  "grade",
  "thumb_up",
  "thumb_up_off_alt",
  "playlist_add",
  "playlist_add_check",
  "queue_music",
  "download",
  "download_for_offline",
  "share",
  "ios_share",
  "library_add",
  "library_add_check",
  "bookmark",
  "bookmark_border"
]);
var NATIVE_MENU_ACTIONS = new Set([
  "more",
  "options",
  "menu",
  "detailsmenu",
  "contextmenu"
]);
var NATIVE_MENU_ICON_TEXTS = new Set([
  "more_vert",
  "more_horiz",
  "more_horizon",
  "expand_more",
  "arrow_drop_down"
]);
var nativePlayInterceptorInstalled = false;
var activePromptPromise = null;
var lastKnownPolicy = null;
var lastNativePlayContext = {
  itemId: "",
  at: 0
};

function getLabels() {
  var cfg = getConfig.() || {};
  var lang = cfg.defaultLanguage || getDefaultLanguage.();
  return getLanguageLabels(lang) || cfg.languageLabels || {};
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatLabelTemplate(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, function(_, key) String(values[key] || ""));
}

function getRemainingLockMinutes(lockedUntilUtc) {
  var remainingMs = Math.max(0, Number(lockedUntilUtc || 0) - Date.now());
  return Math.max(1, Math.ceil(remainingMs / 60_000));
}

function getLockMessage(labels, lockedUntilUtc) {
  return formatLabelTemplate(
    labels.parentalPinLockedWithMinutes || "Too many failed attempts. Try again in {minutes} minutes.",
    { minutes: getRemainingLockMinutes(lockedUntilUtc) }
  );
}

function getInvalidAttemptMessage(labels, response) {
  if (response.isLocked) {
    return getLockMessage(labels, response.lockedUntilUtc);
  }

  var remainingAttempts = Number(response.remainingAttempts || 0);
  if (remainingAttempts > 0) {
    return formatLabelTemplate(
      labels.parentalPinAttemptsLeft || "Incorrect PIN. {count} attempts remaining.",
      { count: remainingAttempts }
    );
  }

  return labels.parentalPinInvalid || "Incorrect PIN.";
}

function buildMetaCard(label, value, iconClass) {
  return "\n    <div class=\"jms-parental-pin-meta-card\">\n      <span class=\"jms-parental-pin-meta-icon\" aria-hidden=\"true\"><i class=\"fas " + (iconClass) + "\"></i></span>\n      <div class=\"jms-parental-pin-meta-copy\">\n        <span class=\"jms-parental-pin-meta-label\">" + (escapeHtml(label)) + "</span>\n        <strong class=\"jms-parental-pin-meta-value\">" + (escapeHtml(value)) + "</strong>\n      </div>\n    </div>\n  ";
}

function buildPinSlots(slotCount = 8) {
  return Array.fromfunction({ length: slotCount }, (_, index)
    "<span class=\"jms-parental-pin-slot\" data-slot-index=\"" + (index) + "\"></span>"
  ).join("");
}

function ensurePromptStyles() {
  if (document.getElementById(STYLE_ID)) return;

  var style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = "\n    .jms-parental-pin-backdrop {\n    --jms-pin-accent: #ffd260;\n    --jms-pin-accent-strong: #ffdf87;\n    --jms-pin-accent-soft: rgba(255, 210, 96, 0.16);\n    --jms-pin-accent-cool: rgba(114, 170, 255, 0.14);\n    --jms-pin-surface: rgba(15, 18, 27, 0.98);\n    --jms-pin-surface-alt: rgba(255, 255, 255, 0.06);\n    --jms-pin-surface-strong: rgba(255, 255, 255, 0.1);\n    --jms-pin-border: rgba(255, 255, 255, 0.1);\n    --jms-pin-text-muted: rgba(255, 255, 255, 0.72);\n    --jms-pin-text-soft: rgba(255, 255, 255, 0.55);\n    --jms-pin-danger: #ff9b9b;\n    --jms-pin-danger-soft: rgba(255, 120, 120, 0.12);\n    position: fixed;\n    inset: 0;\n    background: rgba(7, 9, 14, 0.72);\n    backdrop-filter: blur(10px);\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    padding: 18px;\n    box-sizing: border-box;\n    overflow-x: hidden;\n    overflow-y: auto;\n    -webkit-overflow-scrolling: touch;\n    z-index: 100000;\n  }\n\n  .jms-parental-pin-dialog {\n    position: relative;\n    isolation: isolate;\n    overflow: hidden;\n    width: min(480px, calc(100vw - 36px));\n    max-width: 100%;\n    background:\n      radial-gradient(circle at top right, rgba(255, 210, 96, 0.22), transparent 32%),\n      radial-gradient(circle at bottom left, rgba(114, 170, 255, 0.12), transparent 30%),\n      linear-gradient(180deg, rgba(29, 33, 43, 0.98), rgba(12, 15, 22, 0.99));\n    border: 1px solid var(--jms-pin-border);\n    border-radius: 24px;\n    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);\n    color: #fff;\n    padding: 24px;\n    animation: jms-parental-pin-enter 180ms cubic-bezier(0.22, 0.86, 0.34, 1);\n  }\n\n  .jms-parental-pin-dialog::before {\n    content: \"\";\n    position: absolute;\n    inset: 0;\n    background:\n      linear-gradient(135deg, rgba(255, 255, 255, 0.06), transparent 26%),\n      linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 40%);\n    pointer-events: none;\n    z-index: -1;\n  }\n\n  .jms-parental-pin-close {\n    position: absolute;\n    top: 16px;\n    right: 16px;\n    width: 36px;\n    height: 36px;\n    border: 0;\n    border-radius: 999px;\n    background: rgba(255, 255, 255, 0.08);\n    color: rgba(255, 255, 255, 0.88);\n    cursor: pointer;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    transition: transform 0.18s ease, background 0.18s ease, color 0.18s ease;\n    flex: 0 0 auto;\n  }\n\n  .jms-parental-pin-close:hover {\n    transform: translateY(-1px);\n    background: rgba(255, 255, 255, 0.14);\n    color: #fff;\n  }\n\n  .jms-parental-pin-close:disabled {\n    cursor: wait;\n    opacity: 0.7;\n    transform: none;\n  }\n\n  .jms-parental-pin-hero {\n    display: grid;\n    grid-template-columns: minmax(0, 1fr) auto;\n    gap: 16px;\n    align-items: center;\n    margin-right: 44px;\n  }\n\n  .jms-parental-pin-badge {\n    display: inline-flex;\n    align-items: center;\n    gap: 8px;\n    padding: 6px 12px;\n    border-radius: 999px;\n    border: 1px solid rgba(255, 210, 96, 0.22);\n    background: rgba(255, 210, 96, 0.1);\n    color: var(--jms-pin-accent-strong);\n    font-size: 0.78rem;\n    font-weight: 700;\n    letter-spacing: 0.04em;\n    text-transform: uppercase;\n    width: fit-content;\n    max-width: 100%;\n    box-sizing: border-box;\n  }\n\n  .jms-parental-pin-hero-copy {\n    min-width: 0;\n  }\n\n  .jms-parental-pin-dialog h3 {\n    margin: 12px 0 8px;\n    font-size: 1.34rem;\n    line-height: 1.2;\n    overflow-wrap: anywhere;\n  }\n\n  .jms-parental-pin-dialog p {\n    margin: 0;\n    line-height: 1.5;\n    color: rgba(255, 255, 255, 0.84);\n    max-width: 38ch;\n    overflow-wrap: anywhere;\n  }\n\n  .jms-parental-pin-hero-icon {\n    width: 72px;\n    height: 72px;\n    border-radius: 22px;\n    background:\n      radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.22), transparent 30%),\n      linear-gradient(145deg, rgba(255, 210, 96, 0.24), rgba(114, 170, 255, 0.12));\n    border: 1px solid rgba(255, 255, 255, 0.1);\n    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 20px 30px rgba(0, 0, 0, 0.18);\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    font-size: 1.5rem;\n    color: var(--jms-pin-accent-strong);\n    flex: 0 0 auto;\n  }\n\n  .jms-parental-pin-featured {\n    margin-top: 18px;\n    padding: 14px 16px;\n    border-radius: 18px;\n    background:\n      linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.04));\n    border: 1px solid rgba(255, 255, 255, 0.08);\n    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);\n    min-width: 0;\n  }\n\n  .jms-parental-pin-featured-label {\n    display: inline-block;\n    margin-bottom: 6px;\n    color: var(--jms-pin-text-soft);\n    font-size: 0.78rem;\n    font-weight: 600;\n    letter-spacing: 0.04em;\n    text-transform: uppercase;\n  }\n\n  .jms-parental-pin-featured-title {\n    display: block;\n    font-size: 1.08rem;\n    font-weight: 700;\n    line-height: 1.4;\n    overflow-wrap: anywhere;\n    word-break: break-word;\n  }\n\n  .jms-parental-pin-meta {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    gap: 10px;\n    margin-top: 14px;\n  }\n\n  .jms-parental-pin-meta-card {\n    min-width: 0;\n    display: grid;\n    grid-template-columns: auto minmax(0, 1fr);\n    gap: 12px;\n    align-items: start;\n    padding: 13px 14px;\n    border-radius: 16px;\n    background: rgba(255, 255, 255, 0.05);\n    border: 1px solid rgba(255, 255, 255, 0.06);\n  }\n\n  .jms-parental-pin-meta-icon {\n    width: 36px;\n    height: 36px;\n    border-radius: 12px;\n    background: linear-gradient(145deg, rgba(255, 210, 96, 0.18), rgba(114, 170, 255, 0.08));\n    color: var(--jms-pin-accent-strong);\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    flex: none;\n  }\n\n  .jms-parental-pin-meta-copy {\n    min-width: 0;\n  }\n\n  .jms-parental-pin-meta-label {\n    display: block;\n    color: var(--jms-pin-text-soft);\n    font-size: 0.78rem;\n    margin-bottom: 3px;\n    text-transform: uppercase;\n    letter-spacing: 0.04em;\n  }\n\n  .jms-parental-pin-meta-value {\n    display: block;\n    font-size: 0.96rem;\n    line-height: 1.4;\n    overflow-wrap: anywhere;\n    word-break: break-word;\n  }\n\n  .jms-parental-pin-status-row {\n    display: flex;\n    gap: 10px;\n    flex-wrap: wrap;\n    margin-top: 14px;\n  }\n\n  .jms-parental-pin-status-pill {\n    min-width: 0;\n    flex: 1 1 150px;\n    padding: 10px 12px;\n    border-radius: 14px;\n    background: rgba(255, 255, 255, 0.04);\n    border: 1px solid rgba(255, 255, 255, 0.06);\n    box-sizing: border-box;\n  }\n\n  .jms-parental-pin-status-pill span {\n    display: block;\n    color: var(--jms-pin-text-soft);\n    font-size: 0.76rem;\n    letter-spacing: 0.04em;\n    text-transform: uppercase;\n  }\n\n  .jms-parental-pin-status-pill strong {\n    display: block;\n    margin-top: 4px;\n    font-size: 0.98rem;\n    color: rgba(255, 255, 255, 0.94);\n    overflow-wrap: anywhere;\n  }\n\n  .jms-parental-pin-input {\n    margin-top: 18px;\n  }\n\n  .jms-parental-pin-input-head {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    gap: 10px;\n    margin-bottom: 10px;\n  }\n\n  .jms-parental-pin-input label {\n    display: block;\n    font-size: 0.92rem;\n    font-weight: 600;\n  }\n\n  .jms-parental-pin-input-help {\n    color: var(--jms-pin-text-soft);\n    font-size: 0.84rem;\n    text-align: right;\n  }\n\n  .jms-parental-pin-input-frame {\n    padding: 14px;\n    border-radius: 18px;\n    border: 1px solid rgba(255, 255, 255, 0.08);\n    background:\n      linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03));\n    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);\n    transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;\n    box-sizing: border-box;\n  }\n\n  .jms-parental-pin-input input {\n    width: 100%;\n    max-width: 100%;\n    padding: 14px 16px;\n    border-radius: 14px;\n    border: 1px solid rgba(255, 255, 255, 0.12);\n    background: rgba(0, 0, 0, 0.24);\n    color: #fff;\n    outline: none;\n    box-sizing: border-box;\n    font-size: 1.08rem;\n    font-weight: 700;\n    font-variant-numeric: tabular-nums;\n    letter-spacing: 0.34em;\n    text-align: center;\n    transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;\n  }\n\n  .jms-parental-pin-input input:focus {\n    border-color: rgba(255, 210, 96, 0.8);\n    box-shadow: 0 0 0 3px rgba(255, 210, 96, 0.16);\n  }\n\n  .jms-parental-pin-slots {\n    display: grid;\n    grid-template-columns: repeat(8, minmax(0, 1fr));\n    gap: 8px;\n    margin-top: 12px;\n  }\n\n  .jms-parental-pin-slot {\n    height: 9px;\n    border-radius: 999px;\n    background: rgba(255, 255, 255, 0.1);\n    transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;\n  }\n\n  .jms-parental-pin-slot.is-active {\n    background: linear-gradient(90deg, var(--jms-pin-accent), var(--jms-pin-accent-strong));\n    box-shadow: 0 0 0 1px rgba(255, 210, 96, 0.18), 0 6px 18px rgba(255, 210, 96, 0.2);\n    transform: translateY(-1px);\n  }\n\n  .jms-parental-pin-error {\n    min-height: 22px;\n    margin-top: 12px;\n    color: var(--jms-pin-danger);\n    font-size: 0.9rem;\n    line-height: 1.45;\n    overflow-wrap: anywhere;\n  }\n\n  .jms-parental-pin-actions {\n    display: flex;\n    gap: 12px;\n    justify-content: flex-end;\n    margin-top: 18px;\n  }\n\n  .jms-parental-pin-actions button {\n    border: 0;\n    border-radius: 999px;\n    min-height: 46px;\n    padding: 11px 18px;\n    cursor: pointer;\n    font-weight: 600;\n    transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease, opacity 0.18s ease;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    gap: 10px;\n    min-width: 0;\n    box-sizing: border-box;\n  }\n\n  .jms-parental-pin-cancel {\n    background: rgba(255, 255, 255, 0.12);\n    color: #fff;\n  }\n\n  .jms-parental-pin-cancel:hover {\n    transform: translateY(-1px);\n    background: rgba(255, 255, 255, 0.16);\n  }\n\n  .jms-parental-pin-confirm {\n    background: linear-gradient(135deg, var(--jms-pin-accent), var(--jms-pin-accent-strong));\n    color: #171717;\n    box-shadow: 0 14px 30px rgba(255, 210, 96, 0.22);\n  }\n\n  .jms-parental-pin-confirm:hover {\n    transform: translateY(-1px);\n    box-shadow: 0 18px 36px rgba(255, 210, 96, 0.28);\n  }\n\n  .jms-parental-pin-confirm.is-loading {\n    box-shadow: none;\n  }\n\n  .jms-parental-pin-actions button:disabled {\n    cursor: wait;\n    opacity: 0.74;\n    transform: none;\n    box-shadow: none;\n  }\n\n  .jms-parental-pin-spinner {\n    width: 15px;\n    height: 15px;\n    border-radius: 999px;\n    border: 2px solid currentColor;\n    border-right-color: transparent;\n    display: none;\n    animation: jms-parental-pin-spin 0.6s linear infinite;\n  }\n\n  .jms-parental-pin-confirm.is-loading .jms-parental-pin-spinner {\n    display: inline-block;\n  }\n\n  .jms-parental-pin-dialog.has-error .jms-parental-pin-input-frame {\n    border-color: rgba(255, 120, 120, 0.26);\n    background:\n      linear-gradient(180deg, rgba(255, 120, 120, 0.08), rgba(255, 255, 255, 0.03));\n    box-shadow: 0 0 0 1px rgba(255, 120, 120, 0.1);\n  }\n\n  .jms-parental-pin-dialog.has-error .jms-parental-pin-input input {\n    border-color: rgba(255, 120, 120, 0.36);\n    box-shadow: 0 0 0 3px rgba(255, 120, 120, 0.1);\n  }\n\n  @keyframes jms-parental-pin-enter {\n    from {\n      opacity: 0;\n      transform: translateY(10px) scale(0.98);\n    }\n    to {\n      opacity: 1;\n      transform: translateY(0) scale(1);\n    }\n  }\n\n  @keyframes jms-parental-pin-spin {\n    to {\n      transform: rotate(360deg);\n    }\n  }\n\n  @media (max-width: 560px) {\n    .jms-parental-pin-backdrop {\n      align-items: flex-start;\n      padding: 12px;\n    }\n\n    .jms-parental-pin-dialog {\n      width: 100%;\n      max-width: 100%;\n      margin: 0;\n      padding: 18px;\n      border-radius: 20px;\n      max-height: 92vh\n    }\n\n    .jms-parental-pin-hero {\n      gap: 14px;\n      margin-right: 0;\n      display: flex;\n      align-items: center;\n      padding: 10px;\n    }\n\n    .jms-parental-pin-hero-icon {\n      width: 60px;\n      height: 60px;\n      border-radius: 18px;\n    }\n\n    .jms-parental-pin-meta {\n      grid-template-columns: 1fr;\n    }\n\n    .jms-parental-pin-status-row {\n      flex-direction: column;\n    }\n\n    .jms-parental-pin-status-pill {\n      flex: 1 1 auto;\n      width: 100%;\n    }\n\n    .jms-parental-pin-input-head,\n    .jms-parental-pin-actions {\n      align-items: stretch;\n    }\n\n    .jms-parental-pin-input-help {\n      text-align: left;\n    }\n\n    .jms-parental-pin-actions button {\n      width: 100%;\n    }\n\n    .jms-parental-pin-dialog h3 {\n      font-size: 1.18rem;\n    }\n\n    .jms-parental-pin-dialog p {\n      max-width: 100%;\n    }\n  }\n\n  @media (max-width: 400px) {\n    .jms-parental-pin-backdrop {\n      padding: 8px;\n    }\n\n    .jms-parental-pin-dialog {\n      width: 100%;\n      padding: 16px;\n      border-radius: 18px;\n    }\n\n    .jms-parental-pin-close {\n      top: 12px;\n      right: 12px;\n      width: 34px;\n      height: 34px;\n    }\n\n    .jms-parental-pin-badge {\n      font-size: 0.72rem;\n      padding: 6px 10px;\n    }\n\n    .jms-parental-pin-dialog h3 {\n      margin-top: 10px;\n      font-size: 1.06rem;\n      padding-right: 36px;\n    }\n\n    .jms-parental-pin-meta-card,\n    .jms-parental-pin-status-pill,\n    .jms-parental-pin-input-frame {\n      padding-left: 12px;\n      padding-right: 12px;\n    }\n\n    .jms-parental-pin-featured {\n      padding: 7px 8px;\n      margin: 4px;\n    }\n\n    .jms-parental-pin-input input {\n      padding: 12px;\n      font-size: 1rem;\n      letter-spacing: 0.22em;\n    }\n\n    .jms-parental-pin-slots {\n      gap: 6px;\n    }\n\n    .jms-parental-pin-slot {\n      height: 8px;\n    }\n\n    .jms-parental-pin-actions {\n      gap: 10px;\n    }\n\n    .jms-parental-pin-actions button {\n      min-height: 44px;\n      padding: 10px 14px;\n    }\n  }\n  ";

  document.head.appendChild(style);
}

function parseIdFromHref(href) {
  var raw = String(href || "").trim();
  if (!raw) return "";
  try {
    var match = raw.match(/[?#&]id=([^&#]+)/i);
    return match.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function getCurrentRouteItemId() {
  return parseIdFromHref(window.location.hash || window.location.href);
}

function normalizeActionText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,:;!?]+$/g, "")
    .trim();
}

function isReservedNativeActionToken(value) {
  var normalized = normalizeActionText(value);
  if (!normalized) return false;

  return (
    NATIVE_PLAY_ACTIONS.has(normalized) ||
    NATIVE_NON_PLAY_ACTIONS.has(normalized.replace(/\s+/g, "")) ||
    NATIVE_MENU_ACTIONS.has(normalized.replace(/\s+/g, ""))
  );
}

function rememberNativePlayContext(itemId) {
  var normalized = String(itemId || "").trim();
  if (!normalized) return "";
  lastNativePlayContext = {
    itemId: normalized,
    at: Date.now()
  };
  return normalized;
}

function getRememberedNativePlayContextItemId() {
  if (!lastNativePlayContext.itemId) return "";
  if ((Date.now() - Number(lastNativePlayContext.at || 0)) > NATIVE_PLAY_CONTEXT_TTL_MS) {
    lastNativePlayContext = { itemId: "", at: 0 };
    return "";
  }
  return String(lastNativePlayContext.itemId || "").trim();
}

function collectEventElements(event) {
  var out = [];
  var seen = new Set();
  var add = function(value) {
    var element = value.nodeType === 1 ? value : value.parentElement;
    if (!element || seen.has(element)) return;
    seen.add(element);
    out.push(element);
  };

  try {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (var entry of path) {
      add(entry);
    }
  } catch {}

  add(event.target);
  return out;
}

function hasNativePlayIcon(element) {
  if (!element) return false;

  var iconTexts = [
    element.getAttribute.("icon"),
    element.dataset.icon,
    element.querySelector.(".material-icons, .md-icon, .cardOverlayButtonIcon").textContent
  ]
    .map(normalizeActionText)
    .filter(Boolean);

  if function(iconTexts.some((text) NATIVE_PLAY_ICON_TEXTS.has(text))) {
    return true;
  }

  var classBlob = [
    String(element.className || ""),
    String(element.querySelector.(".material-icons, .md-icon, .cardOverlayButtonIcon").className || "")
  ].join(" ");

  return /\b(play_arrow|play_circle|play-circle|fa-play|fa-circle-play|fa-play-circle)\b/i.test(classBlob);
}

function hasExplicitNonPlayIcon(element) {
  if (!element) return false;

  var iconTexts = [
    element.getAttribute.("icon"),
    element.dataset.icon,
    element.querySelector.(".material-icons, .md-icon, .cardOverlayButtonIcon").textContent
  ]
    .map(normalizeActionText)
    .filter(Boolean);

  if function(iconTexts.some((text) NATIVE_NON_PLAY_ICON_TEXTS.has(text))) {
    return true;
  }

  var classBlob = [
    String(element.className || ""),
    String(element.querySelector.(".material-icons, .md-icon, .cardOverlayButtonIcon").className || "")
  ].join(" ");

  return /\b(fa-heart|fa-star|fa-bookmark|fa-download|fa-share|favorite|favorite_border|star_border|playlist_add|queue_music)\b/i.test(classBlob);
}

function hasMenuLauncherIcon(element) {
  if (!element) return false;

  var iconTexts = [
    element.getAttribute.("icon"),
    element.dataset.icon,
    element.querySelector.(".material-icons, .md-icon, .cardOverlayButtonIcon").textContent
  ]
    .map(normalizeActionText)
    .filter(Boolean);

  if function(iconTexts.some((text) NATIVE_MENU_ICON_TEXTS.has(text))) {
    return true;
  }

  var classBlob = [
    String(element.className || ""),
    String(element.querySelector.(".material-icons, .md-icon, .cardOverlayButtonIcon").className || "")
  ].join(" ");

  return /\b(more_vert|more_horiz|more-horizontal|fa-ellipsis|fa-ellipsis-h|fa-ellipsis-v)\b/i.test(classBlob);
}

function isMenuLauncherElement(element) {
  if (!element) return false;

  var action = normalizeActionText(
    element.getAttribute.("data-action") ||
    element.dataset.action ||
    ""
  ).replace(/\s+/g, "");

  if (action && NATIVE_MENU_ACTIONS.has(action)) {
    return true;
  }

  return hasMenuLauncherIcon(element);
}

function isExplicitlyNonPlayActionElement(element) {
  if (!element) return false;

  var action = normalizeActionText(
    element.getAttribute.("data-action") ||
    element.dataset.action ||
    ""
  ).replace(/\s+/g, "");

  if (action && (NATIVE_NON_PLAY_ACTIONS.has(action) || NATIVE_MENU_ACTIONS.has(action))) {
    return true;
  }

  var className = String(element.className || "");
  if (/\b(btnFavorite|btnUserRating|btnPlaylist|btnDownload|btnShare|btnShuffle|btnMenu)\b/i.test(className)) {
    return true;
  }

  return hasExplicitNonPlayIcon(element) || isMenuLauncherElement(element);
}

function isLikelyInteractiveActionElement(element) {
  if (!element) return false;

  var tagName = String(element.tagName || "").toLowerCase();
  var role = String(element.getAttribute.("role") || "").toLowerCase();
  var className = String(element.className || "");

  return (
    tagName === "button" ||
    tagName === "a" ||
    role === "button" ||
    role === "menuitem" ||
    role === "menuitemradio" ||
    /\b(itemAction|cardOverlayButton|listItem|actionSheet|paper-icon-button-light|btnPlay|btnResume)\b/i.test(className)
  );
}

function isActionSheetElement(element) {
  if (!element.closest) return false;
  return !!element.closest([
    ".actionSheet",
    ".actionSheetMenu",
    ".actionSheetContainer",
    ".actionSheetDialog",
    ".actionsheetListItemBody"
  ].join(", "));
}

function resolveMenuLauncherElement(target) {
  return target.closest.([
    "[data-action=\"menu\"]",
    "[data-action=\"more\"]",
    "[data-action=\"options\"]",
    ".cardOverlayButton[data-action=\"menu\"]",
    ".paper-icon-button-light[data-action=\"menu\"]"
  ].join(", ")) || null;
}

function isNativePlayActionElement(element) {
  if (!element) return false;
  var action = normalizeActionText(
    element.getAttribute.("data-action") ||
    element.dataset.action ||
    ""
  );
  var dataId = normalizeActionText(
    element.getAttribute.("data-id") ||
    element.dataset.id ||
    ""
  );
  var className = String(element.className || "");
  if (isMenuLauncherElement(element) || isExplicitlyNonPlayActionElement(element)) {
    return false;
  }

  if (
    NATIVE_PLAY_ACTIONS.has(action) ||
    NATIVE_PLAY_ACTIONS.has(dataId) ||
    /\bbtnPlay\b/.test(className) ||
    /\bbtnResume\b/.test(className)
  ) {
    return true;
  }

  if (!isLikelyInteractiveActionElement(element)) {
    return false;
  }

  return (
    hasNativePlayIcon(element) &&
    (
      isActionSheetElement(element) ||
      /\b(cardOverlayButton|itemAction|paper-icon-button-light|listItem|actionSheetMenuItem)\b/i.test(className)
    )
  );
}

function shouldIgnoreNativePlayInterception(element) {
  if (!element.closest) return false;
  return !!element.closest([
    "#settings-modal",
    "#jms-details-modal-root",
    "#monwui-watchlist-modal-root",
    ".video-preview-modal",
    ".monwui-trailer-modal-overlay",
    ".monwui-castmodal",
    ".jms-cast-modal",
    ".monwui-main-button-container",
    ".monwui-dot-play-container",
    ".preview-play-button",
    ".jms-parental-pin-backdrop"
  ].join(", "));
}

function resolveNativePlayButton(target) {
  var candidates = [];
  var seen = new Set();

  var add = function(element) {
    if (!element || seen.has(element)) return;
    seen.add(element);
    candidates.push(element);
  };

  add(target);

  add(target.closest.([
    "[data-action=\"play\"]",
    "[data-action=\"resume\"]",
    "[data-action=\"playallfromhere\"]",
    ".btnPlay",
    ".btnResume"
  ].join(", ")));

  add(target.closest.([
    ".itemAction",
    ".listItem",
    ".actionSheetMenuItem",
    ".actionSheetItem",
    ".actionSheet .listItem",
    ".actionSheetMenu .listItem",
    ".actionSheetContainer .listItem",
    ".actionSheetDialog .listItem",
    "[role=\"menuitem\"]",
    "[role=\"menuitemradio\"]"
  ].join(", ")));

  add(target.closest.(".actionsheetListItemBody"));

  var current = target.parentElement || null;
  var depth = 0;
  while (current && depth < 12) {
    add(current);
    current = current.parentElement;
    depth += 1;
  }

  for (var element of candidates) {
    if (isNativePlayActionElement(element) && !shouldIgnoreNativePlayInterception(element)) {
      return element;
    }
  }

  return null;
}

function resolveAudioListPlayAllFromHereElement(target) {
  var row = target.closest.(".listItem[data-action=\"playallfromhere\"]");
  if (!row) return null;

  var blocked = target.closest.([
    ".listViewUserDataButtons",
    "button",
    "[data-action=\"menu\"]",
    "[data-action=\"addtoplaylist\"]",
    "[is=\"emby-ratingbutton\"]"
  ].join(", "));

  return blocked ? null : row;
}

function resolveNativePlayButtonFromEvent(event) {
  for (var element of collectEventElements(event)) {
    var audioListRow = resolveAudioListPlayAllFromHereElement(element);
    if (audioListRow && !shouldIgnoreNativePlayInterception(audioListRow)) {
      return audioListRow;
    }

    if (resolveMenuLauncherElement(element)) {
      return null;
    }

    if (isExplicitlyNonPlayActionElement(element)) {
      return null;
    }

    var button = resolveNativePlayButton(element);
    if (button) {
      return button;
    }

    if (isLikelyInteractiveActionElement(element)) {
      return null;
    }
  }

  return null;
}

function extractItemIdFromElement(
  element,
  {
    includeRoute = false,
    includeRememberedContext = false,
    allowDescendantSearch = true
  } = {}
) {
  if (!element) return "";

  var candidates = [];
  var pushCandidate = function(value) {
    var normalized = String(value || "").trim();
    if (!normalized || isReservedNativeActionToken(normalized)) return;
    candidates.push(normalized);
  };

  var lineage = [];
  var current = element;
  var depth = 0;
  while (current && depth < 12) {
    lineage.push(current);
    current = current.parentElement;
    depth += 1;
  }

  var nestedCarrier = allowDescendantSearch
    ? element.querySelector.([
      "[data-id]",
      "[data-itemid]",
      "[data-item-id]",
      "[itemid]",
      "[item-id]",
      "[href*=\"id=\"]"
    ].join(", "))
    : null;

  pushCandidate(element.getAttribute.("data-id"));
  pushCandidate(element.getAttribute.("data-itemid"));
  pushCandidate(element.getAttribute.("data-item-id"));
  pushCandidate(element.getAttribute.("itemid"));
  pushCandidate(element.getAttribute.("item-id"));
  pushCandidate(element.dataset.id);
  pushCandidate(element.dataset.itemid);
  pushCandidate(element.dataset.itemId);
  pushCandidate(element.itemId);
  pushCandidate(element.__itemId);
  pushCandidate(element.item.Id);
  pushCandidate(element.__data.Id);
  pushCandidate(nestedCarrier.getAttribute.("data-id"));
  pushCandidate(nestedCarrier.getAttribute.("data-itemid"));
  pushCandidate(nestedCarrier.getAttribute.("data-item-id"));
  pushCandidate(nestedCarrier.getAttribute.("itemid"));
  pushCandidate(nestedCarrier.getAttribute.("item-id"));
  pushCandidate(parseIdFromHref(element.getAttribute.("href")));
  pushCandidate(parseIdFromHref(nestedCarrier.getAttribute.("href")));

  for (var node of lineage) {
    pushCandidate(node.getAttribute.("data-id"));
    pushCandidate(node.getAttribute.("data-itemid"));
    pushCandidate(node.getAttribute.("data-item-id"));
    pushCandidate(node.getAttribute.("itemid"));
    pushCandidate(node.getAttribute.("item-id"));
    pushCandidate(node.dataset.id);
    pushCandidate(node.dataset.itemid);
    pushCandidate(node.dataset.itemId);
    pushCandidate(node.itemId);
    pushCandidate(node.__itemId);
    pushCandidate(node.item.Id);
    pushCandidate(node.__data.Id);
    pushCandidate(parseIdFromHref(node.getAttribute.("href")));
  }

  if (includeRememberedContext && isActionSheetElement(element)) {
    pushCandidate(getRememberedNativePlayContextItemId());
  }

  if (includeRoute) {
    pushCandidate(getCurrentRouteItemId());
  }

  if (includeRememberedContext && !isActionSheetElement(element)) {
    pushCandidate(getRememberedNativePlayContextItemId());
  }

  for (var candidate of candidates) {
    var itemId = String(candidate || "").trim();
    if (itemId) return itemId;
  }

  return "";
}

function extractItemIdFromNativePlayButton(element) {
  return extractItemIdFromElement(element, {
    includeRoute: true,
    includeRememberedContext: true,
    allowDescendantSearch: true
  });
}

function rememberNativePlayContextFromEvent(event) {
  for (var element of collectEventElements(event)) {
    if (shouldIgnoreNativePlayInterception(element)) {
      continue;
    }

    var itemId = extractItemIdFromElement(element, {
      includeRoute: false,
      includeRememberedContext: false,
      allowDescendantSearch: false
    });

    if (itemId) {
      return rememberNativePlayContext(itemId);
    }
  }

  return "";
}

function installNativePlayInterceptor() {
  if (nativePlayInterceptorInstalled || typeof document === "undefined") {
    return;
  }

  nativePlayInterceptorInstalled = true;

  var lastIntercept = {
    itemId: "",
    at: 0
  };

  var runPlayNow = function(itemId) {
    try {
      var apiModule = import("../../Plugins/NexusPobreFlix/runtime/api.js");
      apiModule.playNow.(itemId);
    } catch (error) {
      console.error("Native Jellyfin play interception failed:", error);
    }
  };

  var interceptNativePlayEvent = function(event) {
    if (!event.isTrusted) return false;

    rememberNativePlayContextFromEvent(event);

    var button = resolveNativePlayButtonFromEvent(event);
    if (!button) return false;

    var itemId = extractItemIdFromNativePlayButton(button);
    if (!itemId) return false;

    rememberNativePlayContext(itemId);

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    var now = Date.now();
    if (lastIntercept.itemId === itemId && (now - lastIntercept.at) < 750) {
      return true;
    }

    lastIntercept = {
      itemId,
      at: now
    };

    queueMicrotaskfunction(() runPlayNow(itemId));
    return true;
  };

  document.addEventListenerfunction("contextmenu", (event) {
    if (!event.isTrusted) return;
    rememberNativePlayContextFromEvent(event);
  }, true);

  document.addEventListener("pointerdown", interceptNativePlayEvent, true);
  document.addEventListener("mousedown", interceptNativePlayEvent, true);
  document.addEventListener("touchstart", interceptNativePlayEvent, true);
  document.addEventListener("click", interceptNativePlayEvent, true);
  document.addEventListener("dblclick", interceptNativePlayEvent, true);

  document.addEventListenerfunction("keydown", (event) {
    if (!event.isTrusted) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    interceptNativePlayEvent(event);
  }, true);
}

function showPinPrompt({ itemName, officialRating, threshold, ruleLabel }) {
  ensurePromptStyles();

  return new Promisefunction((resolve) {
    var labels = getLabels();
    var closeLabel = labels.kapat || "Close";
    var continueLabel = labels.devam || "Continue";
    var checkingLabel = labels.parentalPinChecking || "Checking...";
    var inputHint = labels.parentalPinDialogHint || labels.parentalPinNewPlaceholder || "Enter 4 to 8 digits";
    var protectedBadge = labels.parentalPinProtectedBadge || "Protected content";
    var attemptsBadge = labels.parentalPinAttemptsBadge || "Attempts left";
    var trustBadge = labels.parentalPinTrustBadge || "Remember";
    var minutesShort = labels.parentalPinMinutesShort || "min";
    var featuredTitle = itemName || labels.untitled || "Untitled";
    var resolvedRating = formatResolvedRating(officialRating) || officialRating || "-";
    var maxAttempts = Math.max(0, Number(lastKnownPolicy.maxAttempts || 0));
    var trustMinutes = Math.max(0, Number(lastKnownPolicy.trustMinutes || 0));
    var backdrop = document.createElement("div");
    backdrop.className = "jms-parental-pin-backdrop";

    var dialog = document.createElement("div");
    dialog.className = "jms-parental-pin-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "jms-parental-pin-title");
    dialog.setAttribute("aria-describedby", "jms-parental-pin-description");

    dialog.innerHTML = "\n      <button type=\"button\" class=\"jms-parental-pin-close\" aria-label=\"" + (escapeHtml(closeLabel)) + "\">\n        <i class=\"fas fa-times\" aria-hidden=\"true\"></i>\n      </button>\n      <div class=\"jms-parental-pin-hero\">\n        <div class=\"jms-parental-pin-hero-copy\">\n          <span class=\"jms-parental-pin-badge\">\n            <i class=\"fas fa-shield-alt\" aria-hidden=\"true\"></i>\n            " + (escapeHtml(protectedBadge)) + "\n          </span>\n          <h3 id=\"jms-parental-pin-title\">" + (escapeHtml(labels.parentalPinDialogTitle || "PIN required")) + "</h3>\n          <p id=\"jms-parental-pin-description\">" + (escapeHtml(labels.parentalPinDialogText || "Administrator PIN is required for this content.")) + "</p>\n        </div>\n        <div class=\"jms-parental-pin-hero-icon\" aria-hidden=\"true\">\n          <i class=\"fas fa-lock\"></i>\n        </div>\n      </div>\n      <div class=\"jms-parental-pin-featured\">\n        <span class=\"jms-parental-pin-featured-label\">" + (escapeHtml(labels.content || "Content")) + "</span>\n        <strong class=\"jms-parental-pin-featured-title\">" + (escapeHtml(featuredTitle)) + "</strong>\n      </div>\n      <div class=\"jms-parental-pin-meta\">\n        " + (buildMetaCard(labels.showOfficialRating || "Certification", resolvedRating, "fa-certificate")) + "\n        " + (buildMetaCard(labels.parentalPinThresholdLabel || "Active rule", ruleLabel || formatThresholdLabel(threshold, labels), "fa-sliders-h")) + "\n      </div>\n      <div class=\"jms-parental-pin-status-row\">\n        <div class=\"jms-parental-pin-status-pill\">\n          <span>" + (escapeHtml(attemptsBadge)) + "</span>\n          <strong data-pin-attempts-value></strong>\n        </div>\n        ${trustMinutes > 0 ? "
          <div class="jms-parental-pin-status-pill">
            <span>${escapeHtml(trustBadge)}</span>
            <strong>${escapeHtml((trustMinutes) + " " + (minutesShort))}</strong>
          </div>
        " : \"\"}\n      </div>\n      <div class=\"jms-parental-pin-input\">\n        <div class=\"jms-parental-pin-input-head\">\n          <label for=\"jms-parental-pin-input\">" + (escapeHtml(labels.parentalPinInputLabel || "PIN")) + "</label>\n          <span class=\"jms-parental-pin-input-help\">" + (escapeHtml(inputHint)) + "</span>\n        </div>\n        <div class=\"jms-parental-pin-input-frame\">\n          <input\n            id=\"jms-parental-pin-input\"\n            type=\"password\"\n            inputmode=\"numeric\"\n            autocomplete=\"off\"\n            maxlength=\"8\"\n            placeholder=\"" + (escapeHtml(labels.parentalPinNewPlaceholder || "4-8 digits")) + "\"\n          />\n          <div class=\"jms-parental-pin-slots\" aria-hidden=\"true\">\n            " + (buildPinSlots()) + "\n          </div>\n        </div>\n      </div>\n      <div class=\"jms-parental-pin-error\" aria-live=\"polite\"></div>\n      <div class=\"jms-parental-pin-actions\">\n        <button type=\"button\" class=\"jms-parental-pin-cancel\">" + (escapeHtml(closeLabel)) + "</button>\n        <button type=\"button\" class=\"jms-parental-pin-confirm\">\n          <span class=\"jms-parental-pin-spinner\" aria-hidden=\"true\"></span>\n          <span class=\"jms-parental-pin-confirm-label\">" + (escapeHtml(continueLabel)) + "</span>\n        </button>\n      </div>\n    ";

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    var input = dialog.querySelector("input");
    var errorEl = dialog.querySelector(".jms-parental-pin-error");
    var closeBtn = dialog.querySelector(".jms-parental-pin-close");
    var cancelBtn = dialog.querySelector(".jms-parental-pin-cancel");
    var confirmBtn = dialog.querySelector(".jms-parental-pin-confirm");
    var confirmLabelEl = dialog.querySelector(".jms-parental-pin-confirm-label");
    var attemptValueEl = dialog.querySelector("[data-pin-attempts-value]");
    var slotEls = Array.from(dialog.querySelectorAll(".jms-parental-pin-slot"));
    var prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    var closed = false;

    var refreshAttemptValue = function() {
      if (!attemptValueEl) return;
      var effectiveMax = maxAttempts > 0 ? maxAttempts : Math.max(0, Number(lastKnownPolicy.maxAttempts || 0));
      var effectiveRemaining = effectiveMax > 0
        ? Math.max(0, Math.min(effectiveMax, Number(lastKnownPolicy.remainingAttempts || effectiveMax)))
        : 0;
      attemptValueEl.textContent = effectiveMax > 0
        ? (effectiveRemaining) + "/" + (effectiveMax)
        : "-";
    };

    var updatePinSlots = function() {
      var filledCount = String(input.value || "").length;
      slotEls.forEach(function((slotEl, index) {
        slotEl.classList.toggle("is-active", index < filledCount);
      });
    };

    var setError = function(message = "") {
      var hasError = !!String(message || "").trim();
      errorEl.textContent = hasError ? String(message) : "";
      dialog.classList.toggle("has-error", hasError);
    };

    var requestClose = function() {
      if (dialog.classList.contains("is-busy")) return;
      cleanup(false);
    };

    var cleanup = function(result) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", handleKeydown, true);
      document.body.style.overflow = prevOverflow;
      backdrop.remove();
      resolve(result);
    };

    var setBusy = function(busy) {
      dialog.classList.toggle("is-busy", busy);
      confirmBtn.classList.toggle("is-loading", busy);
      confirmBtn.disabled = busy;
      cancelBtn.disabled = busy;
      closeBtn.disabled = busy;
      input.disabled = busy;
      confirmLabelEl.textContent = busy ? checkingLabel : continueLabel;
    };

    var submit = function() {
      var pin = String(input.value || "").trim();
      if (!/^\d{4,8}$/.test(pin)) {
        setError(labels.parentalPinInvalidFormat || "PIN must be 4 to 8 digits.");
        input.focus();
        input.select.();
        return;
      }

      setBusy(true);
      setError("");

      try {
        var response = verifyParentalPin(pin);
        if (lastKnownPolicy) {
          lastKnownPolicy = {
            ...lastKnownPolicy,
            ...response,
            remainingAttempts: Number(response.remainingAttempts || 0),
            lockedUntilUtc: Number(response.lockedUntilUtc || 0),
            trustedUntilUtc: Number(response.trustedUntilUtc || 0),
            isLocked: response.isLocked === true,
            isTrusted: response.isTrusted === true
          };
        }
        refreshAttemptValue();

        if (response.valid === true) {
          cleanup(true);
          return;
        }

        if (response.isLocked) {
          setError(getLockMessage(labels, response.lockedUntilUtc));
          input.value = "";
          updatePinSlots();
          setTimeoutfunction(() cleanup(false), 900);
          return;
        }

        setError(getInvalidAttemptMessage(labels, response));
        input.value = "";
        updatePinSlots();
        input.focus();
        input.select.();
      } catch (error) {
        setError(
          getParentalPinErrorMessage(error, labels, labels.parentalPinVerifyFailed || "PIN verification failed.")
        );
      } finally {
        if (!closed) {
          setBusy(false);
        }
      }
    };

    var handleKeydown = function(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };

    document.addEventListener("keydown", handleKeydown, true);
    backdrop.addEventListenerfunction("click", (event) {
      if (event.target === backdrop) requestClose();
    });
    closeBtn.addEventListener("click", requestClose);
    cancelBtn.addEventListener("click", requestClose);
    confirmBtn.addEventListener("click", submit);
    input.addEventListenerfunction("input", () {
      var numericValue = String(input.value || "").replace(/\D+/g, "").slice(0, 8);
      if (numericValue !== input.value) {
        input.value = numericValue;
      }
      updatePinSlots();
      if (dialog.classList.contains("has-error")) {
        setError("");
      }
    });

    refreshAttemptValue();
    updatePinSlots();
    setTimeoutfunction(() input.focus(), 20);
  });
}

export function ensureParentalPinBeforePlayback(item, { bypassItemId = null } = {}) {
  void bypassItemId;

  var evaluate = function() {
    var labels = getLabels();
    var policy = null;

    try {
      policy = fetchCurrentUserParentalPinPolicy();
      if (policy) {
        lastKnownPolicy = policy;
      }
    } catch (error) {
      if (!lastKnownPolicy) {
        showNotification(
          "<i class=\"fas fa-triangle-exclamation jms-notification-icon\"></i> " + (getParentalPinErrorMessage(error, labels, labels.parentalPinPolicyFetchFailed || "PIN policy could not be checked.")),
          4200,
          "error"
        );
        return false;
      }

      policy = lastKnownPolicy;
    }

    var officialRating = String(item.OfficialRating || "").trim();
    var threshold = Number(policy.rule.ratingThreshold || 0);
    var requireUnratedPin = policy.rule.requireUnratedPin === true;
    var shouldPrompt =
      officialRating
        ? doesRatingRequirePin(officialRating, threshold)
        : requireUnratedPin;

    if (!(policy.hasPin === true) || (!requireUnratedPin && !(threshold > 0))) return true;
    if (!shouldPrompt) return true;
    if (policy.isTrusted === true && Number(policy.trustedUntilUtc || 0) > Date.now()) return true;
    if (policy.isLocked === true && Number(policy.lockedUntilUtc || 0) > Date.now()) {
      showNotification(
        "<i class=\"fas fa-triangle-exclamation jms-notification-icon\"></i> " + (getLockMessage(labels, policy.lockedUntilUtc)),
        4200,
        "error"
      );
      return false;
    }

    var confirmed = showPinPrompt({
      itemName: item.Name || labels.untitled || "Untitled",
      officialRating: officialRating || labels.derecelendirmeyok || "No rating",
      threshold,
      ruleLabel: officialRating
        ? formatThresholdLabel(threshold, labels)
        : (labels.parentalPinUnratedLabel || "Require PIN when certification is missing")
    });

    return confirmed === true;
  };

  if (!activePromptPromise) {
    activePromptPromise = evaluate().finallyfunction(() {
      activePromptPromise = null;
    });
  }

  return activePromptPromise;
}

installNativePlayInterceptor();
